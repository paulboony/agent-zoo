import type { SessionState } from "@agent-zoo/shared";
import { describe, expect, it } from "vitest";
import { startStaleSweep } from "./sweep.js";
import { createStore, type Store } from "./state.js";

function seedSession(
  store: Store,
  id: string,
  status: SessionState["status"],
  lastEventOffsetMin: number,
): void {
  const lastEvent = new Date(Date.now() - lastEventOffsetMin * 60_000).toISOString();
  store.sessions.set(id, {
    id,
    cwd: "/tmp",
    cwd_basename: "tmp",
    started_at: lastEvent,
    last_event_at: lastEvent,
    status,
    agents: {},
  });
}

describe("sweep", () => {
  it("flips a running session to stale after STALE_THRESHOLD_MS", () => {
    const store = createStore();
    seedSession(store, "s1", "running", 11);
    startStaleSweep(store);
    const session = store.sessions.get("s1");
    expect(session?.status).toBe("stale");
    expect(session?.current_activity).toMatch(/stale: no events for/);
  });

  it("flips any non-ended session to ended after ENDED_THRESHOLD_MS", () => {
    const store = createStore();
    seedSession(store, "s2", "awaiting_user", 31);
    startStaleSweep(store);
    const session = store.sessions.get("s2");
    expect(session?.status).toBe("ended");
    expect(session?.ended_at).toBeDefined();
  });

  it("doesn't transition awaiting_user to stale (stale guard is running-only)", () => {
    const store = createStore();
    seedSession(store, "s3", "awaiting_user", 11);
    startStaleSweep(store);
    const session = store.sessions.get("s3");
    expect(session?.status).toBe("awaiting_user");
  });

  it("doesn't re-emit for already-ended sessions", () => {
    const store = createStore();
    seedSession(store, "s4", "ended", 31);
    const seqBefore = store.seq;
    startStaleSweep(store);
    expect(store.sessions.get("s4")?.status).toBe("ended");
    expect(store.seq).toBe(seqBefore);
  });

  it("preserves ended_at on a session that already had one", () => {
    const store = createStore();
    const existing = new Date(Date.now() - 60 * 60_000).toISOString();
    store.sessions.set("s5", {
      id: "s5",
      cwd: "/tmp",
      cwd_basename: "tmp",
      started_at: existing,
      last_event_at: existing,
      ended_at: existing,
      status: "running",
      agents: {},
    });
    startStaleSweep(store);
    expect(store.sessions.get("s5")?.ended_at).toBe(existing);
    expect(store.sessions.get("s5")?.status).toBe("ended");
  });
});
