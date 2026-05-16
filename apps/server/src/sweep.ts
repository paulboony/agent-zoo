import { logger } from "./logger.js";
import { type Store, emit } from "./state.js";

export function startStaleSweep(store: Store): NodeJS.Timeout {
  const raw = process.env.STALE_SESSION_MIN;
  const parsed = raw === undefined ? 10 : Number(raw);
  const limitMin = Number.isFinite(parsed) && parsed > 0 ? parsed : 10;
  if (raw !== undefined && limitMin !== parsed) {
    logger.warn({ raw }, "invalid STALE_SESSION_MIN; falling back to 10");
  }
  const limitMs = limitMin * 60_000;

  const handle = setInterval(() => {
    const now = Date.now();
    for (const [id, session] of store.sessions) {
      if (session.status !== "running") continue;
      const last = Date.parse(session.last_event_at);
      if (Number.isNaN(last) || now - last < limitMs) continue;
      const next = {
        ...session,
        // TODO(group-c): "awaiting_user" here conflates "stale" with "post-Stop
        // paused-on-user". Group C will split these into a distinct "stale" status.
        status: "awaiting_user" as const,
        current_activity: `stale: no events for ${limitMin}m`,
      };
      store.sessions.set(id, next);
      store.seq += 1;
      emit(store, { type: "session_upsert", seq: store.seq, session: next });
      logger.info({ id }, "session swept to awaiting_user (stale)");
    }
  }, 60_000);

  handle.unref();
  return handle;
}
