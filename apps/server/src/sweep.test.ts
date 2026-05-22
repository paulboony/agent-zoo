import type { AgentState, HookEnvelope, SessionState } from "@agent-zoo/shared";
import { describe, expect, it } from "vitest";
import { reduce } from "./reducer.js";
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

  it("ends every non-ended agent when a session is swept to ended", () => {
    const store = createStore();
    const lastEvent = new Date(Date.now() - 31 * 60_000).toISOString();
    const agent: AgentState = {
      id: "main",
      status: "running",
      started_at: lastEvent,
      last_event_at: lastEvent,
      tool_calls_count: 3,
      error_count: 0,
    };
    store.sessions.set("s-end", {
      id: "s-end",
      cwd: "/tmp",
      cwd_basename: "tmp",
      started_at: lastEvent,
      last_event_at: lastEvent,
      status: "running",
      agents: { main: agent },
    });

    startStaleSweep(store);

    const session = store.sessions.get("s-end");
    expect(session?.status).toBe("ended");
    expect(session?.agents.main?.status).toBe("ended");
    // ended_at on each agent so timestamp UX makes sense
    expect(session?.agents.main?.ended_at).toBeDefined();
  });

  it("marks running agents stale when a session is swept to stale", () => {
    const store = createStore();
    const lastEvent = new Date(Date.now() - 11 * 60_000).toISOString();
    const running: AgentState = {
      id: "main",
      status: "running",
      started_at: lastEvent,
      last_event_at: lastEvent,
      tool_calls_count: 1,
      error_count: 0,
    };
    const ended: AgentState = {
      id: "a1",
      status: "ended",
      started_at: lastEvent,
      last_event_at: lastEvent,
      ended_at: lastEvent,
      tool_calls_count: 0,
      error_count: 0,
    };
    store.sessions.set("s-stale", {
      id: "s-stale",
      cwd: "/tmp",
      cwd_basename: "tmp",
      started_at: lastEvent,
      last_event_at: lastEvent,
      status: "running",
      agents: { main: running, a1: ended },
    });

    startStaleSweep(store);

    const session = store.sessions.get("s-stale");
    expect(session?.status).toBe("stale");
    expect(session?.agents.main?.status).toBe("stale");
    // Already-ended sub-agents stay ended
    expect(session?.agents.a1?.status).toBe("ended");
  });

  it("preserves the swept ended status when a stray late event arrives", () => {
    // Regression: rollupSessionStatus runs on every reduce(), so if the
    // sweep flips session.status to "ended" but leaves agents in
    // "running", a late Notification re-runs rollup and the session
    // ping-pongs back to "running". After the sweep agents must be
    // ended too, so rollup keeps the session ended.
    const store = createStore();
    const lastEvent = new Date(Date.now() - 31 * 60_000).toISOString();
    store.sessions.set("s-late", {
      id: "s-late",
      cwd: "/tmp",
      cwd_basename: "tmp",
      started_at: lastEvent,
      last_event_at: lastEvent,
      status: "running",
      agents: {
        main: {
          id: "main",
          status: "running",
          started_at: lastEvent,
          last_event_at: lastEvent,
          tool_calls_count: 0,
          error_count: 0,
        },
      },
    });

    startStaleSweep(store);
    expect(store.sessions.get("s-late")?.status).toBe("ended");

    // Stray Notification with a subtype that does NOT transition the agent.
    // (Other subtypes flip to "blocked"; a benign one leaves agent.status alone.)
    const env: HookEnvelope = {
      received_at: new Date().toISOString(),
      payload: {
        hook_event_name: "Notification",
        session_id: "s-late",
        cwd: "/tmp",
        transcript_path: "",
        notification_type: "auth_success",
        message: "fyi",
      },
    };
    reduce(store, env);

    expect(store.sessions.get("s-late")?.status).toBe("ended");
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
