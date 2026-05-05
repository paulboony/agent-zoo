import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { logger } from "./logger.js";
import { hookRoute } from "./routes/hook.js";
import { snapshotRoutes } from "./routes/snapshot.js";
import { streamRoute } from "./routes/stream.js";
import { createStore } from "./state.js";

const HOST = process.env.HOST ?? "127.0.0.1";
const PORT = Number(process.env.PORT ?? 7777);

async function main(): Promise<void> {
  const store = createStore();

  const app = new Hono();
  app.get("/healthz", (c) => c.json({ ok: true }));
  app.route("/hook", hookRoute(store));
  app.route("/stream", streamRoute(store));
  app.route("/api", snapshotRoutes(store));

  serve({ fetch: app.fetch, hostname: HOST, port: PORT }, (info) => {
    logger.info({ host: info.address, port: info.port }, "agent-zoo server listening");
  });
}

main().catch((err) => {
  logger.error({ err }, "server boot failed");
  process.exit(1);
});
