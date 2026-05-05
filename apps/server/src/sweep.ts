import { logger } from "./logger.js";
import { type Store, emit } from "./state.js";

export function startStaleSweep(store: Store): NodeJS.Timeout {
  const limitMin = Number(process.env.STALE_SESSION_MIN ?? 10);
  const limitMs = limitMin * 60_000;

  const handle = setInterval(() => {
    const now = Date.now();
    for (const [id, session] of store.sessions) {
      if (session.status !== "running") continue;
      const last = Date.parse(session.last_event_at);
      if (Number.isNaN(last) || now - last < limitMs) continue;
      const next = {
        ...session,
        status: "idle" as const,
        current_activity: `stale: no events for ${limitMin}m`,
      };
      store.sessions.set(id, next);
      store.seq += 1;
      emit(store, { type: "session_upsert", seq: store.seq, session: next });
      logger.info({ id }, "session swept to idle (stale)");
    }
  }, 60_000);

  handle.unref();
  return handle;
}
