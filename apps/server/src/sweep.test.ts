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
    // current_tool set → the idle-promote heuristic skips this (tool
    // is still in-flight from its POV), so the stale path fires.
    const running: AgentState = {
      id: "main",
      status: "running",
      current_tool: "Bash",
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

  it("promotes a stuck running session to awaiting_user when no tool is active and idle > IDLE_THRESHOLD", () => {
    // Regression: if Claude Code's Stop hook fails to deliver (e.g.,
    // the handler timed out POSTing to /hook), the session stays
    // "running" forever even though the agent has finished its turn.
    // Sweep self-heals: running + no current_tool + idle > 30s →
    // awaiting_user. Catches up next time the user submits anyway.
    const store = createStore();
    // 1 minute idle, well past IDLE_THRESHOLD_MS but well under
    // STALE_THRESHOLD_MS (10m), so stale shouldn't fire here.
    const lastEvent = new Date(Date.now() - 60_000).toISOString();
    const agent: AgentState = {
      id: "main",
      status: "running",
      started_at: lastEvent,
      last_event_at: lastEvent,
      tool_calls_count: 3,
      error_count: 0,
      // current_tool intentionally undefined — PostToolUse cleared it.
    };
    store.sessions.set("s-stuck", {
      id: "s-stuck",
      cwd: "/tmp",
      cwd_basename: "tmp",
      started_at: lastEvent,
      last_event_at: lastEvent,
      status: "running",
      agents: { main: agent },
    });

    startStaleSweep(store);

    const session = store.sessions.get("s-stuck");
    expect(session?.status).toBe("awaiting_user");
    expect(session?.agents.main?.status).toBe("awaiting_user");
  });

  it("does NOT promote when a tool is still active (current_tool set)", () => {
    const store = createStore();
    const lastEvent = new Date(Date.now() - 60_000).toISOString();
    const agent: AgentState = {
      id: "main",
      status: "running",
      current_tool: "Bash", // in-flight tool — wait for PostToolUse
      started_at: lastEvent,
      last_event_at: lastEvent,
      tool_calls_count: 1,
      error_count: 0,
    };
    store.sessions.set("s-busy", {
      id: "s-busy",
      cwd: "/tmp",
      cwd_basename: "tmp",
      started_at: lastEvent,
      last_event_at: lastEvent,
      status: "running",
      agents: { main: agent },
    });

    startStaleSweep(store);

    expect(store.sessions.get("s-busy")?.status).toBe("running");
    expect(store.sessions.get("s-busy")?.agents.main?.status).toBe("running");
  });

  it("does NOT promote when idle window is below the threshold", () => {
    const store = createStore();
    // 10s idle — under IDLE_THRESHOLD_MS (30s), so still mid-turn.
    const lastEvent = new Date(Date.now() - 10_000).toISOString();
    const agent: AgentState = {
      id: "main",
      status: "running",
      started_at: lastEvent,
      last_event_at: lastEvent,
      tool_calls_count: 1,
      error_count: 0,
    };
    store.sessions.set("s-fresh", {
      id: "s-fresh",
      cwd: "/tmp",
      cwd_basename: "tmp",
      started_at: lastEvent,
      last_event_at: lastEvent,
      status: "running",
      agents: { main: agent },
    });

    startStaleSweep(store);

    expect(store.sessions.get("s-fresh")?.status).toBe("running");
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
