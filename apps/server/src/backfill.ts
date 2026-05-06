import { promises as fs } from "node:fs";
import type { Dirent } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { HookEnvelope, HookPayload } from "@agent-zoo/shared";
import { logger } from "./logger.js";
import { reduce } from "./reducer.js";
import type { Store } from "./state.js";

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
const THIRTY_MINUTES_MS = 30 * 60 * 1000;
const TAIL_LINES = 200;

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
