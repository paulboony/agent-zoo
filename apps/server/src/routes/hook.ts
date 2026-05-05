import type { HookEnvelope } from "@agent-zoo/shared";
import { Hono } from "hono";
import { logger } from "../logger.js";
import { reduce } from "../reducer.js";
import { type Store, emit } from "../state.js";

export function hookRoute(store: Store): Hono {
  const app = new Hono();
  app.post("/", async (c) => {
    const env = (await c.req.json().catch(() => null)) as HookEnvelope | null;
    if (!env?.payload?.hook_event_name || !env?.payload?.session_id) {
      return c.json({ error: "missing hook_event_name or session_id" }, 400);
    }
    try {
      const updated = reduce(store, env);
      if (updated) {
        store.seq += 1;
        emit(store, {
          type: "session_upsert",
          seq: store.seq,
          session: updated,
        });
      }
    } catch (err) {
      logger.error({ err }, "reducer threw");
    }
    return c.body(null, 204);
  });
  return app;
}
