import { promises as fs } from "node:fs";
import type { Dirent } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AgentState, HookEnvelope, HookPayload } from "@agent-zoo/shared";
import { logger } from "./logger.js";
import { reduce } from "./reducer.js";
import type { Store } from "./state.js";

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
const THIRTY_MINUTES_MS = 30 * 60 * 1000;
const TAIL_LINES = 200;

/**
 * Parse a sub-agent's `agent-<id>.meta.json` contents.
 *
 * Returns `null` when the input isn't a plain object. Otherwise returns
 * an object with the recognised fields, omitting any that aren't a
 * non-empty string. The `agentId` arg is for diagnostics only — it isn't
 * read but kept in the signature so callers don't have to pass it
 * separately to the consumer that combines this with the transcript
 * parser.
 */
export function parseSubagentMeta(
  agentId: string,
  meta: unknown,
): { agentType?: string; description?: string } | null {
  void agentId;
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
 * Walk one session's `subagents/` directory and recover every
 * sub-agent inside as `status: "ended"`. Synthesises the same hook
 * envelopes the live reducer expects so the agent's `label`, `prompt`,
 * and lifecycle timestamps follow the same code path as live events.
 * Numeric counters (`tool_calls_count`, `error_count`, `model`) are
 * patched in place after the reducer creates the agent — they don't
 * have natural hook envelopes that would set them in one pass.
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
    const meta = parseSubagentMeta(agentId, metaRaw);
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
    const description = meta.description;
    const prompt = transcript.prompt;
    const startedAt = transcript.started_at ?? receivedAt;
    const lastEventAt = transcript.last_event_at ?? startedAt;

    // 1. PreToolUse(Agent) — populates the FIFO queue with description + prompt.
    if (description !== undefined) {
      reduce(store, {
        received_at: startedAt,
        payload: {
          hook_event_name: "PreToolUse",
          session_id: sessionId,
          cwd: "",
          transcript_path: "",
          tool_name: "Agent",
          tool_use_id: `backfill-${agentId}`,
          tool_input: {
            description,
            ...(prompt !== undefined ? { prompt } : {}),
            subagent_type: agentType,
          },
        },
      });
    }

    // 2. SubagentStart — reducer creates the agent and pops the FIFO entry.
    reduce(store, {
      received_at: startedAt,
      payload: {
        hook_event_name: "SubagentStart",
        session_id: sessionId,
        cwd: "",
        transcript_path: "",
        agent_id: agentId,
        agent_type: agentType,
        agent_transcript_path: jsonlPath ?? "",
      },
    });

    // 3. Patch numeric counters + model (no natural hook envelope for these).
    const session = store.sessions.get(sessionId);
    const agent = session?.agents[agentId];
    if (agent) {
      agent.tool_calls_count = transcript.tool_calls_count;
      agent.error_count = transcript.error_count;
      if (transcript.model !== undefined) agent.model = transcript.model;
    }

    // 4. SubagentStop — mark ended.
    reduce(store, {
      received_at: lastEventAt,
      payload: {
        hook_event_name: "SubagentStop",
        session_id: sessionId,
        cwd: "",
        transcript_path: "",
        agent_id: agentId,
        agent_type: agentType,
        agent_transcript_path: jsonlPath ?? "",
      },
    });

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
    const parent =
      "parentPath" in entry && typeof entry.parentPath === "string"
        ? entry.parentPath
        : projectsDir;
    const fullPath = path.join(parent, entry.name);
    try {
      const stat = await fs.stat(fullPath);
      if (stat.mtimeMs >= cutoff) jsonlFiles.push({ path: fullPath, mtimeMs: stat.mtimeMs });
    } catch {
      // ignore unreadable files
    }
  }

  for (const { path: file, mtimeMs } of jsonlFiles) {
    try {
      await replayJsonl(store, file, mtimeMs);
    } catch (err) {
      logger.error({ err: String(err), file }, "jsonl backfill failed");
    }
  }

  const ageLimit = THIRTY_MINUTES_MS;
  const now = Date.now();
  for (const session of store.sessions.values()) {
    const last = Date.parse(session.last_event_at);
    if (Number.isNaN(last) || now - last > ageLimit) {
      session.status = "ended";
      if (session.ended_at === undefined) {
        session.ended_at = session.last_event_at;
      }
    }
  }

  logger.info({ files: jsonlFiles.length, sessions: store.sessions.size }, "backfill complete");
}

async function replayJsonl(store: Store, file: string, fileMtimeMs: number): Promise<void> {
  const content = await fs.readFile(file, "utf8");
  const lines = content.split("\n").filter((l) => l.trim().length > 0);
  const tail = lines.slice(-TAIL_LINES);
  const touchedSessionIds = new Set<string>();

  for (const line of tail) {
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
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
    if (model) {
      const session = store.sessions.get(synth.payload.session_id);
      const main = session?.agents.main;
      if (main) main.model = model;
    }
  }

  // Bump last_event_at on every touched session to the file's mtime when newer.
  // The JSONL is written for tool calls and tool results too — events we
  // intentionally skip during synthesis but which still indicate liveness.
  const fileMtimeIso = new Date(fileMtimeMs).toISOString();
  for (const sessionId of touchedSessionIds) {
    const session = store.sessions.get(sessionId);
    if (!session) continue;
    const current = Date.parse(session.last_event_at);
    if (Number.isNaN(current) || current < fileMtimeMs) {
      session.last_event_at = fileMtimeIso;
    }
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
  const targets: { id: string; main: AgentState }[] = [];
  for (const session of store.sessions.values()) {
    const main = session.agents.main;
    if (main && !main.model) targets.push({ id: session.id, main });
  }
  if (targets.length === 0) return;

  const home = process.env.CLAUDE_HOME ?? path.join(os.homedir(), ".claude");
  const projectsDir = path.join(home, "projects");

  let entries: Dirent[];
  try {
    entries = await fs.readdir(projectsDir, { withFileTypes: true, recursive: true });
  } catch {
    return;
  }

  const cutoff = Date.now() - TWENTY_FOUR_HOURS_MS;
  const pending = new Map(targets.map((t) => [t.id, t.main]));

  for (const entry of entries) {
    if (pending.size === 0) break;
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
    const parent =
      "parentPath" in entry && typeof entry.parentPath === "string"
        ? entry.parentPath
        : projectsDir;
    const fullPath = path.join(parent, entry.name);
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
        if (!sessionId) continue;
        const main = pending.get(sessionId);
        if (!main) continue;
        const model = extractModel(parsed);
        if (model) {
          main.model = model;
          pending.delete(sessionId);
          break;
        }
      }
    } catch (err) {
      logger.warn({ err: String(err), file: fullPath }, "model refresh failed");
    }
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
