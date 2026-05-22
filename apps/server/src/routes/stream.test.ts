import type { HookEnvelope, SseMessage } from "@agent-zoo/shared";
import { describe, expect, it } from "vitest";
import { reduce } from "../reducer.js";
import { createStore, emit } from "../state.js";
import { initStreamSubscriber } from "./stream.js";

/**
 * Direct unit test of the helper that snapshots + subscribes for a new
 * SSE client. The race we're guarding: an upsert that fires between
 * "send snapshot" and "register subscriber" is invisible to the new
 * client (snapshot stale by 1, upsert not delivered). The fix is to
 * subscribe BEFORE any await, then send the snapshot.
 */
describe("initStreamSubscriber", () => {
  it("registers the subscriber before any async snapshot send", async () => {
    const store = createStore();
    const sent: SseMessage[] = [];

    // Async send to mimic stream.writeSSE — must yield to the event loop
    // before resolving so a concurrent reduce/emit gets a chance to fire.
    const send = async (msg: SseMessage) => {
      await Promise.resolve();
      sent.push(msg);
    };

    let subscriberCountWhenSnapshotEnqueued = -1;
    const sendSpy = async (msg: SseMessage) => {
      if (msg.type === "snapshot") {
        subscriberCountWhenSnapshotEnqueued = store.subscribers.size;
      }
      await send(msg);
    };

    const { cleanup, pending } = initStreamSubscriber(store, sendSpy);

    // Before the snapshot await resolves, race in a reduce + emit that
    // a healthy subscriber would receive. Pre-fix the subscriber set is
    // empty here, so the upsert is dropped on the floor for this client.
    const env: HookEnvelope = {
      received_at: new Date().toISOString(),
      payload: {
        hook_event_name: "SessionStart",
        session_id: "s-race",
        cwd: "/tmp",
        transcript_path: "",
        source: "startup",
      },
    };
    const updated = reduce(store, env);
    expect(updated).not.toBeNull();
    store.seq += 1;
    if (updated) {
      emit(store, { type: "session_upsert", seq: store.seq, session: updated });
    }

    await pending;

    // Post-fix invariant: subscriber was registered before the snapshot
    // hit the wire, so the racing upsert was delivered to this client.
    expect(subscriberCountWhenSnapshotEnqueued).toBe(1);
    const types = sent.map((m) => m.type);
    expect(types).toContain("snapshot");
    expect(types).toContain("session_upsert");

    cleanup();
    expect(store.subscribers.size).toBe(0);
  });
});
