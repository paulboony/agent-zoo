import type { SessionState } from "@agent-zoo/shared";
import { logger } from "./logger.js";
import { type Store, emit } from "./state.js";

const STALE_DEFAULT_MIN = 10;   // running > N min idle → stale
const ENDED_DEFAULT_MIN = 30;   // any non-ended > N min idle → ended
const SWEEP_INTERVAL_MS = 60 * 1000;

const STALE_THRESHOLD_MS = readThresholdMs("STALE_SESSION_MIN", STALE_DEFAULT_MIN);
const ENDED_THRESHOLD_MS = readThresholdMs("ENDED_SESSION_MIN", ENDED_DEFAULT_MIN);

function readThresholdMs(envVar: string, defaultMin: number): number {
  const raw = process.env[envVar];
  if (raw === undefined) return defaultMin * 60_000;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    logger.warn({ envVar, raw }, `invalid ${envVar}; falling back to default ${defaultMin}m`);
    return defaultMin * 60_000;
  }
  return parsed * 60_000;
}

export function startStaleSweep(store: Store): NodeJS.Timeout {
  sweep(store);                          // run once immediately on boot
  const handle = setInterval(() => sweep(store), SWEEP_INTERVAL_MS);
  handle.unref();
  return handle;
}

function sweep(store: Store): void {
  const now = Date.now();
  for (const [id, session] of store.sessions) {
    const last = Date.parse(session.last_event_at);
    if (Number.isNaN(last)) continue;
    const age = now - last;

    if (age > ENDED_THRESHOLD_MS && session.status !== "ended") {
      const next: SessionState = {
        ...session,
        status: "ended",
        ended_at: session.ended_at ?? session.last_event_at,
      };
      commitSweep(store, id, next, "ended");
      continue;
    }

    if (age > STALE_THRESHOLD_MS && session.status === "running") {
      const minutes = Math.floor(age / 60_000);
      const next: SessionState = {
        ...session,
        status: "stale",
        current_activity: `stale: no events for ${minutes}m`,
      };
      commitSweep(store, id, next, "stale");
    }
  }
}

function commitSweep(
  store: Store,
  id: string,
  next: SessionState,
  reason: "stale" | "ended",
): void {
  store.sessions.set(id, next);
  store.seq += 1;
  emit(store, { type: "session_upsert", seq: store.seq, session: next });
  logger.info({ session_id: id, reason }, "session swept");
}
