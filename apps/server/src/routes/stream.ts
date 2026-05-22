import type { SseMessage } from "@agent-zoo/shared";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { logger } from "../logger.js";
import type { Store } from "../state.js";

/**
 * Wire a fresh SSE client to the store: register a subscriber, then
 * send the initial snapshot. The subscribe-before-snapshot order is
 * deliberate — an upsert that fires while the snapshot send is awaiting
 * `writeSSE` would otherwise be invisible to this client (not in
 * subscribers yet, snapshot already captured at the prior seq). The
 * client de-dupes via `msg.seq <= state.seq`, so an upsert arriving
 * before its companion snapshot is harmless.
 *
 * Returns the awaitable snapshot send (so the caller can serialize
 * subsequent activity behind it) and a cleanup hook that removes the
 * subscriber on disconnect.
 */
export function initStreamSubscriber(
  store: Store,
  send: (msg: SseMessage) => Promise<void>,
): { pending: Promise<void>; cleanup: () => void } {
  const subscriber = (msg: SseMessage) => {
    send(msg).catch((err) =>
      logger.warn({ err }, "sse write failed; subscriber will be dropped on disconnect"),
    );
  };
  // Capture snapshot data and subscribe synchronously — no awaits
  // between the two, so no reduce()/emit() can interleave.
  const snapshot: SseMessage = {
    type: "snapshot",
    seq: store.seq,
    sessions: Array.from(store.sessions.values()),
  };
  store.subscribers.add(subscriber);
  const pending = send(snapshot);
  return {
    pending,
    cleanup: () => {
      store.subscribers.delete(subscriber);
    },
  };
}

export function streamRoute(store: Store): Hono {
  const app = new Hono();
  app.get("/", (c) =>
    streamSSE(c, async (stream) => {
      const send = async (msg: SseMessage) => {
        await stream.writeSSE({ data: JSON.stringify(msg) });
      };

      const { pending, cleanup } = initStreamSubscriber(store, send);
      logger.info({ subs: store.subscribers.size }, "sse client connected");
      await pending;

      const heartbeat = setInterval(() => {
        send({ type: "heartbeat", seq: store.seq }).catch(() => {});
      }, 15_000);

      await new Promise<void>((resolve) => {
        stream.onAbort(() => resolve());
      });

      clearInterval(heartbeat);
      cleanup();
      logger.info({ subs: store.subscribers.size }, "sse client disconnected");
    }),
  );
  return app;
}
