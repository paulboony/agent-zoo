import { promises as fs } from "node:fs";
import type { Dirent } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AgentState, HookEnvelope, HookPayload, SessionState } from "@agent-zoo/shared";
import { logger } from "./logger.js";
import { buildEndedSubAgent, reduce } from "./reducer.js";
import { type Store, emit } from "./state.js";
import { applyWorktreeInfo, detectWorktree } from "./worktree.js";

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
const TAIL_LINES = 200;
// Max transcript files read concurrently during backfill. Bounds open file
// descriptors / memory while still overlapping I/O waits across sessions.
const FILE_CONCURRENCY = 8;

/**
 * Parse a sub-agent's `agent-<id>.meta.json` contents.
 *
 * Returns `null` when the input isn't a plain object. Otherwise returns
 * an object with the recognised fields, omitting any that aren't a
 * non-empty string. Callers log the agent id at the failure site if
 * needed — this function is intentionally id-agnostic.
 */
export function parseSubagentMeta(
  meta: unknown,
): { agentType?: string; description?: string } | null {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  const obj = meta as Record<string, unknown>;
  const out: { agentType?: string; description?: string } = {};
  if (typeof obj.agentType === "string" && obj.agentType.length > 0) {
    out.agentType = obj.agentType;
  }
  if (typeof obj.description === "string" && obj.description.length > 0) {
    out.description = obj.description;
  }
  return out;
}

/**
 * Walk parsed JSONL entries from a sub-agent transcript and derive
 * the numeric counters, model, timestamps, and prompt body we need to
 * reconstruct an `AgentState` from disk.
 *
 *   - `tool_calls_count` is the number of `"type":"tool_use"` entries.
 *   - `error_count` is the number of `"type":"tool_result"` entries
 *     with `is_error: true`.
 *   - `model` is read from the most recent assistant entry that
 *     carries `message.model` (last-write-wins).
 *   - `prompt` is the text of the first `"role":"user"` (or `"type":"user"`)
 *     entry — its `message.content` may be either a string or an array
 *     of `{type, text}` content blocks.
 *   - `started_at` / `last_event_at` are the earliest / latest
 *     `timestamp` values across all entries.
 *
 * Malformed entries are skipped silently.
 */
export function parseSubagentTranscript(entries: unknown[]): {
  prompt?: string;
  tool_calls_count: number;
  error_count: number;
  model?: string;
  started_at?: string;
  last_event_at?: string;
} {
  let tool_calls_count = 0;
  let error_count = 0;
  let model: string | undefined;
  let prompt: string | undefined;
  let started_at: string | undefined;
  let last_event_at: string | undefined;

  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;

    const type = typeof e.type === "string" ? e.type : undefined;
    const role = typeof e.role === "string" ? e.role : undefined;

    if (type === "tool_use") tool_calls_count++;
    if (type === "tool_result" && e.is_error === true) error_count++;

    if (type === "assistant" || role === "assistant") {
      const msg = e.message;
      if (msg && typeof msg === "object") {
        const m = (msg as Record<string, unknown>).model;
        if (typeof m === "string" && m.length > 0) model = m;
      }
    }

    if (prompt === undefined && (type === "user" || role === "user")) {
      const msg = e.message;
      if (msg && typeof msg === "object") {
        const content = (msg as Record<string, unknown>).content;
        if (typeof content === "string" && content.length > 0) {
          prompt = content;
        } else if (Array.isArray(content)) {
          const texts: string[] = [];
          for (const block of content) {
            if (!block || typeof block !== "object") continue;
            const b = block as Record<string, unknown>;
            if (b.type === "text" && typeof b.text === "string") {
              texts.push(b.text);
            }
          }
          if (texts.length > 0) prompt = texts.join("\n");
        }
      }
    }

    const ts = typeof e.timestamp === "string" ? e.timestamp : undefined;
    if (ts) {
      if (started_at === undefined || ts < started_at) started_at = ts;
      if (last_event_at === undefined || ts > last_event_at) last_event_at = ts;
    }
  }

  const result: ReturnType<typeof parseSubagentTranscript> = {
    tool_calls_count,
    error_count,
  };
  if (prompt !== undefined) result.prompt = prompt;
  if (model !== undefined) result.model = model;
  if (started_at !== undefined) result.started_at = started_at;
  if (last_event_at !== undefined) result.last_event_at = last_event_at;
  return result;
}

/**
 * Walk parsed JSONL entries from a MAIN-session transcript and synthesise
 * the activity hook envelopes the ActivityTracker consumes:
 *
 *   - one `PreToolUse` per `tool_use` content block (assistant entries)
 *   - one `PostToolUseFailure` per errored `tool_result` content block
 *     (user entries), attributed back to the originating tool via the
 *     `tool_use_id` → tool_name correlation built up as we walk.
 *
 * Unlike sub-agent transcripts, main transcripts nest tool calls/results
 * inside `message.content[]` blocks rather than as top-level entries, and
 * carry a per-entry ISO `timestamp` we reuse as `received_at` so replayed
 * events land in the correct hour bucket (the tracker keys off
 * `received_at`, not wall-clock).
 *
 * Entries without a session id or timestamp are skipped, as are sub-agent
 * entries (which carry an `agentId`). Permission prompts and elicitations
 * are never written to transcripts, so those counters cannot be recovered
 * here — only tool-call volume and tool failures.
 */
export function extractActivityEnvelopes(entries: unknown[]): HookEnvelope[] {
  const out: HookEnvelope[] = [];
  const toolNameById = new Map<string, string>();

  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;

    if (typeof e.agentId === "string" || typeof e.agent_id === "string") continue;

    const sessionId =
      typeof e.sessionId === "string"
        ? e.sessionId
        : typeof e.session_id === "string"
          ? e.session_id
          : undefined;
    const timestamp = typeof e.timestamp === "string" ? e.timestamp : undefined;
    if (!sessionId || !timestamp) continue;

    const cwd = typeof e.cwd === "string" ? e.cwd : "";
    const transcriptPath =
      typeof e.transcriptPath === "string"
        ? e.transcriptPath
        : typeof e.transcript_path === "string"
          ? e.transcript_path
          : "";

    const msg = e.message;
    if (!msg || typeof msg !== "object") continue;
    const content = (msg as Record<string, unknown>).content;
    if (!Array.isArray(content)) continue;

    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      const b = block as Record<string, unknown>;

      if (b.type === "tool_use" && typeof b.name === "string" && b.name.length > 0) {
        const toolUseId = typeof b.id === "string" ? b.id : "";
        if (toolUseId) toolNameById.set(toolUseId, b.name);
        out.push({
          received_at: timestamp,
          payload: {
            hook_event_name: "PreToolUse",
            session_id: sessionId,
            cwd,
            transcript_path: transcriptPath,
            tool_name: b.name,
            tool_input: b.input ?? {},
            tool_use_id: toolUseId,
          },
        });
        continue;
      }

      if (b.type === "tool_result" && b.is_error === true) {
        const toolUseId = typeof b.tool_use_id === "string" ? b.tool_use_id : undefined;
        if (!toolUseId) continue;
        const toolName = toolNameById.get(toolUseId);
        if (!toolName) continue;
        out.push({
          received_at: timestamp,
          payload: {
            hook_event_name: "PostToolUseFailure",
            session_id: sessionId,
            cwd,
            transcript_path: transcriptPath,
            tool_name: toolName,
            tool_input: {},
            tool_use_id: toolUseId,
          },
        });
      }
    }
  }

  return out;
}

/**
 * Walk one session's `subagents/` directory and recover every
 * sub-agent inside as `status: "ended"`. Each recovered sub-agent is
 * constructed directly via `buildEndedSubAgent` (no synthetic hook
 * envelopes) and merged into a freshly-built session aggregate,
 * mirroring the reducer's build-then-commit pattern so live SSE
 * subscribers see either old or new state, never partial.
 *
 * Returns counts of recovered vs skipped sub-agents for logging.
 */
export async function backfillSessionSubagents(
  store: Store,
  sessionId: string,
  subagentsDir: string,
  cutoffMs: number,
  receivedAt: string,
): Promise<{ recovered: number; skipped: number }> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(subagentsDir, { withFileTypes: true });
  } catch {
    return { recovered: 0, skipped: 0 };
  }

  const pairs = new Map<string, { meta?: string; jsonl?: string }>();
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const m = entry.name.match(/^agent-(.+)\.meta\.json$/);
    if (m?.[1]) {
      const id = m[1];
      const pair = pairs.get(id) ?? {};
      pair.meta = path.join(subagentsDir, entry.name);
      pairs.set(id, pair);
      continue;
    }
    const j = entry.name.match(/^agent-(.+)\.jsonl$/);
    if (j?.[1]) {
      const id = j[1];
      const pair = pairs.get(id) ?? {};
      pair.jsonl = path.join(subagentsDir, entry.name);
      pairs.set(id, pair);
    }
  }

  let recovered = 0;
  let skipped = 0;

  for (const [agentId, { meta: metaPath, jsonl: jsonlPath }] of pairs) {
    if (!metaPath) continue;

    let metaMtime = 0;
    let jsonlMtime = 0;
    try {
      const ms = await fs.stat(metaPath);
      metaMtime = ms.mtimeMs;
    } catch {
      continue;
    }
    if (jsonlPath) {
      try {
        const js = await fs.stat(jsonlPath);
        jsonlMtime = js.mtimeMs;
      } catch {
        // jsonl unreadable; we can still recover from meta alone.
      }
    }
    if (metaMtime < cutoffMs && jsonlMtime < cutoffMs) {
      skipped++;
      continue;
    }

    let metaRaw: unknown;
    try {
      metaRaw = JSON.parse(await fs.readFile(metaPath, "utf8"));
    } catch (err) {
      logger.warn({ err: String(err), metaPath }, "subagent meta parse failed");
      continue;
    }
    const meta = parseSubagentMeta(metaRaw);
    if (!meta) continue;

    let transcript: ReturnType<typeof parseSubagentTranscript> = {
      tool_calls_count: 0,
      error_count: 0,
    };
    if (jsonlPath) {
      try {
        const content = await fs.readFile(jsonlPath, "utf8");
        const parsed: unknown[] = [];
        for (const line of content.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            parsed.push(JSON.parse(trimmed));
          } catch {
            // skip malformed line
          }
        }
        transcript = parseSubagentTranscript(parsed);
      } catch (err) {
        logger.warn({ err: String(err), jsonlPath }, "subagent transcript read failed");
      }
    }

    const agentType = meta.agentType ?? "general-purpose";
    const startedAt = transcript.started_at ?? receivedAt;
    const lastEventAt = transcript.last_event_at ?? startedAt;

    const existingSession = store.sessions.get(sessionId);
    if (!existingSession) {
      // Backfill is keyed off recovered main sessions; this should not
      // happen in practice but we skip to keep the invariant clean.
      continue;
    }

    // Skip if a live hook already populated this sub-agent.
    if (existingSession.agents[agentId] !== undefined) {
      recovered++;
      continue;
    }

    const recoveredAgent = buildEndedSubAgent({
      id: agentId,
      agent_type: agentType,
      ...(meta.description !== undefined ? { label: meta.description } : {}),
      ...(transcript.prompt !== undefined ? { prompt: transcript.prompt } : {}),
      tool_calls_count: transcript.tool_calls_count,
      error_count: transcript.error_count,
      ...(transcript.model !== undefined ? { model: transcript.model } : {}),
      started_at: startedAt,
      last_event_at: lastEventAt,
      ended_at: lastEventAt,
    });

    // Build a fresh session aggregate with the new agent merged in,
    // mirroring the reducer's "build then commit" pattern so live SSE
    // subscribers see either old or new state, never partial.
    const nextSession: SessionState = {
      ...existingSession,
      agents: { ...existingSession.agents, [agentId]: recoveredAgent },
      last_event_at:
        lastEventAt > existingSession.last_event_at ? lastEventAt : existingSession.last_event_at,
    };
    store.sessions.set(sessionId, nextSession);

    recovered++;
  }

  return { recovered, skipped };
}

export async function runBackfill(store: Store): Promise<void> {
  const home = process.env.CLAUDE_HOME ?? path.join(os.homedir(), ".claude");
  const projectsDir = path.join(home, "projects");

  let entries: Dirent[];
  try {
    entries = await fs.readdir(projectsDir, {
      withFileTypes: true,
      recursive: true,
    });
  } catch (err) {
    logger.warn({ err: String(err), projectsDir }, "no claude projects dir; skipping backfill");
    return;
  }

  const cutoff = Date.now() - TWENTY_FOUR_HOURS_MS;
  const jsonlFiles: { path: string; mtimeMs: number }[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
    // `parentPath` is guaranteed on Dirent in Node ≥ 20.12 (the repo's
    // minimum per the engines field). On older Node it would be
    // undefined and any sub-agent jsonl would be silently misrouted
    // into the main-session scan, so we require it.
    if (typeof entry.parentPath !== "string") {
      logger.warn(
        { name: entry.name },
        "Dirent.parentPath missing; refusing to process (Node ≥ 20.12 required)",
      );
      continue;
    }
    // Sub-agent transcripts live under `<session-id>/subagents/`. They
    // are NOT main-session jsonls — they're recovered separately by
    // backfillSessionSubagents — so exclude them from this scan.
    if (path.basename(entry.parentPath) === "subagents") continue;
    const fullPath = path.join(entry.parentPath, entry.name);
    try {
      const stat = await fs.stat(fullPath);
      if (stat.mtimeMs >= cutoff) jsonlFiles.push({ path: fullPath, mtimeMs: stat.mtimeMs });
    } catch {
      // ignore unreadable files
    }
  }

  // Replay files concurrently (bounded): each is independent I/O against a
  // distinct session, so overlapping the reads cuts boot time roughly with
  // the number of recent sessions.
  await runWithConcurrency(jsonlFiles, FILE_CONCURRENCY, async ({ path: file, mtimeMs }) => {
    try {
      await replayJsonl(store, file, mtimeMs, cutoff);
    } catch (err) {
      logger.error({ err: String(err), file }, "jsonl backfill failed");
    }
  });

  // For every session we just rebuilt, look for a sibling `subagents/`
  // directory next to its main jsonl and recover anything inside. The
  // `<session-id>/subagents/agent-*.jsonl` layout is what Claude Code
  // writes when sub-agents are dispatched.
  const subagentCutoff = Date.now() - TWENTY_FOUR_HOURS_MS;
  const nowIso = new Date().toISOString();
  let totalRecovered = 0;
  let totalSkipped = 0;
  await runWithConcurrency(jsonlFiles, FILE_CONCURRENCY, async ({ path: file }) => {
    const sessionId = path.basename(file, ".jsonl");
    const subagentsDir = path.join(path.dirname(file), sessionId, "subagents");
    if (!store.sessions.has(sessionId)) return;
    try {
      const result = await backfillSessionSubagents(
        store,
        sessionId,
        subagentsDir,
        subagentCutoff,
        nowIso,
      );
      // Safe under single-threaded interleaving: `+=` runs synchronously
      // between awaits, so workers never observe a torn counter.
      totalRecovered += result.recovered;
      totalSkipped += result.skipped;
    } catch (err) {
      logger.warn({ err: String(err), sessionId }, "subagent backfill failed");
    }
  });

  // Worktree detection for every recovered session whose cwd we know.
  // Bounded parallel — each call shells out to git, so we cap concurrency
  // to keep boot fast on machines with many active sessions.
  await detectWorktreesForSessions(store);

  logger.info(
    {
      files: jsonlFiles.length,
      sessions: store.sessions.size,
      subagents_recovered: totalRecovered,
      subagents_skipped: totalSkipped,
    },
    "backfill complete",
  );
}

const WORKTREE_CONCURRENCY = 8;

/**
 * Run `worker` over `items` with at most `limit` in flight at once.
 *
 * A shared cursor hands each idle worker the next item, so a slow item
 * never blocks the others — wall-clock is bounded by the busiest worker,
 * not the sum of all items. Node is single-threaded, so the only
 * interleaving happens at the worker's `await` points (I/O); synchronous
 * work between awaits still runs to completion uninterrupted. The worker
 * is responsible for its own error handling — a rejection here aborts the
 * whole batch.
 */
export async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  let cursor = 0;
  async function run(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor++;
      await worker(items[index] as T, index);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => run());
  await Promise.all(workers);
}

async function detectWorktreesForSessions(store: Store): Promise<void> {
  const targets: { id: string; cwd: string }[] = [];
  for (const session of store.sessions.values()) {
    if (session.cwd && session.is_worktree === undefined) {
      targets.push({ id: session.id, cwd: session.cwd });
    }
  }

  await runWithConcurrency(targets, WORKTREE_CONCURRENCY, async (next) => {
    try {
      const info = await detectWorktree(next.cwd);
      applyWorktreeInfo(store, next.id, info);
    } catch (err) {
      logger.debug({ err: String(err), sid: next.id }, "worktree detect rejected");
    }
  });
}

async function replayJsonl(
  store: Store,
  file: string,
  fileMtimeMs: number,
  activityCutoffMs: number,
): Promise<void> {
  const content = await fs.readFile(file, "utf8");
  const parsed: unknown[] = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      parsed.push(JSON.parse(trimmed));
    } catch {
      // skip malformed line
    }
  }

  // Rebuild the rolling activity metrics (tool-call volume + failures by
  // tool) from the WHOLE transcript — the 200-line tail used below for
  // session state is far too small to count 24h of tool calls. The tracker
  // prunes to its own 24h window on snapshot; we still gate on the cutoff
  // to avoid recording buckets we know will be pruned.
  for (const env of extractActivityEnvelopes(parsed)) {
    if (Date.parse(env.received_at) >= activityCutoffMs) store.activity.record(env);
  }

  const tail = parsed.slice(-TAIL_LINES);
  const touchedSessionIds = new Set<string>();
  const discoveredModels = new Map<string, string>();
  const discoveredPrompts = new Map<string, string>();

  for (const entry of tail) {
    // Extract user prompt before the synthesise guard; user entries return
    // null from synthesise (only assistant entries synthesise a hook event),
    // but we still need to capture the last user message per session.
    if (entry && typeof entry === "object") {
      const e = entry as Record<string, unknown>;
      const sessionId =
        typeof e.sessionId === "string"
          ? e.sessionId
          : typeof e.session_id === "string"
            ? e.session_id
            : undefined;
      if (sessionId) {
        const userPrompt = extractUserPrompt(entry);
        if (userPrompt) discoveredPrompts.set(sessionId, userPrompt);
      }
    }

    const synth = synthesise(entry);
    if (!synth) continue;
    const env: HookEnvelope = {
      received_at: synth.timestamp,
      payload: synth.payload,
    };
    reduce(store, env);
    touchedSessionIds.add(synth.payload.session_id);
    const model = extractModel(entry);
    if (model) discoveredModels.set(synth.payload.session_id, model);
  }

  // Apply the model patch, last_event_at bump, and last_user_prompt by
  // rebuilding fresh SessionState objects. Mirrors the reducer's
  // "build then commit" pattern — committed SessionStates are treated as
  // immutable so the store invariant survives future callers (and
  // post-boot subscribers).
  const fileMtimeIso = new Date(fileMtimeMs).toISOString();
  for (const sessionId of touchedSessionIds) {
    const session = store.sessions.get(sessionId);
    if (!session) continue;
    const model = discoveredModels.get(sessionId);
    const main = session.agents.main;
    const modelChanged = model !== undefined && main !== undefined && main.model !== model;
    const current = Date.parse(session.last_event_at);
    const lastEventChanged = Number.isNaN(current) || current < fileMtimeMs;
    const prompt = discoveredPrompts.get(sessionId);
    const promptChanged = prompt !== undefined && session.last_user_prompt !== prompt;
    if (!modelChanged && !lastEventChanged && !promptChanged) continue;

    const next: SessionState = {
      ...session,
      ...(promptChanged ? { last_user_prompt: prompt } : {}),
    };
    if (modelChanged && main) {
      next.agents = { ...session.agents, main: { ...main, model } };
    }
    if (lastEventChanged) {
      next.last_event_at = fileMtimeIso;
    }
    store.sessions.set(sessionId, next);
  }
}

function synthesise(entry: unknown): { timestamp: string; payload: HookPayload } | null {
  if (!entry || typeof entry !== "object") return null;
  const e = entry as Record<string, unknown>;

  if (typeof e.agentId === "string" || typeof e.agent_id === "string") return null;

  const sessionId =
    typeof e.sessionId === "string"
      ? e.sessionId
      : typeof e.session_id === "string"
        ? e.session_id
        : undefined;
  const cwd = typeof e.cwd === "string" ? e.cwd : "";
  const transcriptPath =
    typeof e.transcriptPath === "string"
      ? e.transcriptPath
      : typeof e.transcript_path === "string"
        ? e.transcript_path
        : "";
  const ts = typeof e.timestamp === "string" ? e.timestamp : new Date().toISOString();

  if (!sessionId) return null;

  const type = typeof e.type === "string" ? e.type : undefined;
  const role = typeof e.role === "string" ? e.role : undefined;

  if (type === "assistant" || role === "assistant") {
    return {
      timestamp: ts,
      payload: {
        hook_event_name: "Stop",
        session_id: sessionId,
        cwd,
        transcript_path: transcriptPath,
      },
    };
  }

  return null;
}

export async function refreshMainAgentModels(store: Store): Promise<void> {
  const pending = new Map<string, AgentState>();
  for (const session of store.sessions.values()) {
    const main = session.agents.main;
    if (main && !main.model) pending.set(session.id, main);
  }
  if (pending.size === 0) return;

  const home = process.env.CLAUDE_HOME ?? path.join(os.homedir(), ".claude");
  const projectsDir = path.join(home, "projects");

  let entries: Dirent[];
  try {
    entries = await fs.readdir(projectsDir, { withFileTypes: true, recursive: true });
  } catch {
    return;
  }

  const cutoff = Date.now() - TWENTY_FOUR_HOURS_MS;
  const discovered = new Map<string, string>();

  for (const entry of entries) {
    if (pending.size === 0) break;
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
    if (typeof entry.parentPath !== "string") continue;
    // Skip sub-agent transcripts; model refresh is main-agent-only.
    if (path.basename(entry.parentPath) === "subagents") continue;
    const fullPath = path.join(entry.parentPath, entry.name);
    try {
      const stat = await fs.stat(fullPath);
      if (stat.mtimeMs < cutoff) continue;
      const content = await fs.readFile(fullPath, "utf8");
      const tail = content
        .split("\n")
        .filter((l) => l.trim().length > 0)
        .slice(-TAIL_LINES);
      for (let i = tail.length - 1; i >= 0; i--) {
        const raw = tail[i];
        if (!raw) continue;
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          continue;
        }
        if (!parsed || typeof parsed !== "object") continue;
        const e = parsed as Record<string, unknown>;
        if (typeof e.agentId === "string" || typeof e.agent_id === "string") continue;
        const type = typeof e.type === "string" ? e.type : undefined;
        const role = typeof e.role === "string" ? e.role : undefined;
        if (type !== "assistant" && role !== "assistant") continue;
        const sessionId =
          typeof e.sessionId === "string"
            ? e.sessionId
            : typeof e.session_id === "string"
              ? e.session_id
              : undefined;
        if (!sessionId || !pending.has(sessionId)) continue;
        const model = extractModel(parsed);
        if (model) {
          discovered.set(sessionId, model);
          pending.delete(sessionId);
          break;
        }
      }
    } catch (err) {
      logger.warn({ err: String(err), file: fullPath }, "model refresh failed");
    }
  }

  // Commit through fresh SessionState objects so subscribers see either
  // old or new state (never partial), and bump seq + emit so live SSE
  // clients learn about the change. Mirrors the reducer's
  // build-then-commit pattern.
  for (const [sessionId, model] of discovered) {
    const session = store.sessions.get(sessionId);
    const main = session?.agents.main;
    if (!session || !main || main.model) continue;
    const nextMain: AgentState = { ...main, model };
    const next: SessionState = {
      ...session,
      agents: { ...session.agents, main: nextMain },
    };
    store.sessions.set(sessionId, next);
    store.seq += 1;
    emit(store, { type: "session_upsert", seq: store.seq, session: next });
  }
}

function extractModel(entry: unknown): string | undefined {
  if (!entry || typeof entry !== "object") return undefined;
  const e = entry as Record<string, unknown>;
  const message = e.message;
  if (!message || typeof message !== "object") return undefined;
  const m = (message as Record<string, unknown>).model;
  return typeof m === "string" && m.length > 0 ? m : undefined;
}

function extractUserPrompt(entry: unknown): string | undefined {
  if (!entry || typeof entry !== "object") return undefined;
  const e = entry as Record<string, unknown>;
  const type = typeof e.type === "string" ? e.type : undefined;
  const role = typeof e.role === "string" ? e.role : undefined;
  if (type !== "user" && role !== "user") return undefined;
  const msg = e.message;
  if (!msg || typeof msg !== "object") return undefined;
  const content = (msg as Record<string, unknown>).content;
  let text: string | undefined;
  if (typeof content === "string" && content.length > 0) {
    text = content;
  } else if (Array.isArray(content)) {
    const texts: string[] = [];
    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      const b = block as Record<string, unknown>;
      if (b.type === "text" && typeof b.text === "string") texts.push(b.text);
    }
    if (texts.length > 0) text = texts.join("\n");
  }
  if (!text) return undefined;
  const normalised = text.replace(/\s+/g, " ").trim();
  return normalised.length > 0 ? normalised.slice(0, 500) : undefined;
}
