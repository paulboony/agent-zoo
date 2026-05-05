import type { SseMessage } from "@agent-zoo/shared";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { logger } from "../logger.js";
import type { Store } from "../state.js";

export function streamRoute(store: Store): Hono {
  const app = new Hono();
  app.get("/", (c) =>
    streamSSE(c, async (stream) => {
      const send = async (msg: SseMessage) => {
        await stream.writeSSE({ data: JSON.stringify(msg) });
      };

      const subscriber = (msg: SseMessage) => {
        send(msg).catch((err) =>
          logger.warn({ err }, "sse write failed; subscriber will be dropped on disconnect"),
        );
      };

      await send({
        type: "snapshot",
        seq: store.seq,
        sessions: Array.from(store.sessions.values()),
      });

      store.subscribers.add(subscriber);
      logger.info({ subs: store.subscribers.size }, "sse client connected");

      const heartbeat = setInterval(() => {
        store.seq += 1;
        send({ type: "heartbeat", seq: store.seq }).catch(() => {});
      }, 15_000);

      await new Promise<void>((resolve) => {
        stream.onAbort(() => resolve());
      });

      clearInterval(heartbeat);
      store.subscribers.delete(subscriber);
      logger.info({ subs: store.subscribers.size }, "sse client disconnected");
    }),
  );
  return app;
}
