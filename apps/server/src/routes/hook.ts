import type { HookEnvelope } from "@agent-zoo/shared";
import { Hono } from "hono";
import { logger } from "../logger.js";
import { reduce } from "../reducer.js";
import { type Store, emit } from "../state.js";
import { applyWorktreeInfo, detectWorktree } from "../worktree.js";

export function hookRoute(store: Store): Hono {
  const app = new Hono();
  app.post("/", async (c) => {
    const env = (await c.req.json().catch(() => null)) as HookEnvelope | null;
    if (!env?.payload?.hook_event_name || !env?.payload?.session_id) {
      return c.json({ error: "missing hook_event_name or session_id" }, 400);
    }
    try {
      const wasKnown = store.sessions.has(env.payload.session_id);
      store.activity.record(env);
      const updated = reduce(store, env);
      if (updated) {
        store.seq += 1;
        emit(store, {
          type: "session_upsert",
          seq: store.seq,
          session: updated,
        });
        // First time we see this session — fire-and-forget worktree
        // detection. cwd doesn't change for the lifetime of a session,
        // so this only needs to run once. The result lands as a
        // separate session_upsert when it resolves.
        if (!wasKnown && updated.cwd && updated.is_worktree === undefined) {
          detectWorktree(updated.cwd)
            .then((info) => applyWorktreeInfo(store, updated.id, info))
            .catch((err) =>
              logger.debug({ err: String(err), sid: updated.id }, "worktree detect rejected"),
            );
        }
      }
    } catch (err) {
      logger.error({ err }, "reducer threw");
    }
    return c.body(null, 204);
  });
  return app;
}
