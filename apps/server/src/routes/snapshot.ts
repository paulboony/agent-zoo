import { Hono } from "hono";
import type { Store } from "../state.js";

export function snapshotRoutes(store: Store): Hono {
  const app = new Hono();

  app.get("/sessions", (c) =>
    c.json({
      seq: store.seq,
      sessions: Array.from(store.sessions.values()),
    }),
  );

  app.get("/sessions/:id", (c) => {
    const id = c.req.param("id");
    const session = store.sessions.get(id);
    if (!session) return c.json({ error: "not found" }, 404);
    return c.json({
      seq: store.seq,
      session,
      recent_events: store.recent_events.toArray().filter((p) => p.session_id === id),
    });
  });

  return app;
}
