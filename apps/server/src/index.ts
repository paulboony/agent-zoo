import path from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { refreshMainAgentModels, runBackfill } from "./backfill.js";
import { logger } from "./logger.js";
import { hookRoute } from "./routes/hook.js";
import { snapshotRoutes } from "./routes/snapshot.js";
import { streamRoute } from "./routes/stream.js";
import { createStore } from "./state.js";
import { startStaleSweep } from "./sweep.js";

const HOST = process.env.HOST ?? "127.0.0.1";
const PORT = Number(process.env.PORT ?? 7777);
const WEB_PORT = Number(process.env.WEB_PORT ?? 5173);

async function main(): Promise<void> {
  const store = createStore();
  await runBackfill(store);
  setInterval(() => {
    refreshMainAgentModels(store).catch((err) =>
      logger.warn({ err: String(err) }, "periodic model refresh failed"),
    );
  }, 30_000);

  const app = new Hono();
  app.get("/healthz", (c) => c.json({ ok: true }));
  app.route("/hook", hookRoute(store));
  app.route("/stream", streamRoute(store));
  app.route("/api", snapshotRoutes(store));

  startStaleSweep(store);

  serve({ fetch: app.fetch, hostname: HOST, port: PORT }, (info) => {
    logger.info({ host: info.address, port: info.port }, "agent-zoo API listening");
  });

  // Separate web listener so the published `npx` binary can serve the
  // prebuilt SPA without a Vite dev server. In repo dev mode Vite owns
  // 5173, so this second listener only starts when WEB_DIR is set
  // (the CLI bin sets it to the path of the bundled web/ dir).
  const webDir = process.env.WEB_DIR ? path.resolve(process.env.WEB_DIR) : null;
  if (webDir) {
    const web = new Hono();

    // Proxy API paths to the API listener on PORT. The web bundle
    // makes relative-URL requests (/api, /hook, /stream) so that the
    // same code works behind both Vite's dev proxy and this prod
    // listener. Mirrors apps/web/vite.config.ts's `server.proxy`.
    const proxyTo = async (c: import("hono").Context) => {
      const url = new URL(c.req.url);
      const target = `http://${HOST}:${PORT}${url.pathname}${url.search}`;
      const headers = new Headers(c.req.raw.headers);
      headers.delete("host");
      const init: RequestInit & { duplex?: "half" } = {
        method: c.req.method,
        headers,
      };
      if (c.req.method !== "GET" && c.req.method !== "HEAD") {
        init.body = c.req.raw.body;
        init.duplex = "half";
      }
      try {
        const res = await fetch(target, init);
        return new Response(res.body, { status: res.status, headers: res.headers });
      } catch (err) {
        logger.warn({ err: String(err), target }, "web→api proxy failed");
        return c.text("upstream unavailable", 502);
      }
    };
    web.all("/api/*", proxyTo);
    web.all("/hook", proxyTo);
    web.all("/hook/*", proxyTo);
    web.all("/stream", proxyTo);
    web.all("/stream/*", proxyTo);

    // Static SPA assets.
    web.use(
      "/*",
      serveStatic({
        root: path.relative(process.cwd(), webDir) || ".",
      }),
    );
    // SPA fallback — any unmatched route renders index.html so client
    // routing (e.g. /sessions/<id>) works on direct page loads /
    // refreshes.
    web.notFound(async (c) => {
      const fallback = path.join(webDir, "index.html");
      try {
        const { readFile } = await import("node:fs/promises");
        const html = await readFile(fallback, "utf8");
        return c.html(html);
      } catch {
        return c.text("agent-zoo web bundle missing", 500);
      }
    });
    serve({ fetch: web.fetch, hostname: HOST, port: WEB_PORT }, (info) => {
      logger.info(
        { host: info.address, port: info.port, root: webDir },
        "agent-zoo web listening",
      );
    });
  }
}

main().catch((err) => {
  logger.error({ err }, "server boot failed");
  process.exit(1);
});
