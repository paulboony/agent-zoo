import type { AgentState, SessionState } from "@agent-zoo/shared";
import { rollupSessionStatus } from "@agent-zoo/shared";
import { logger } from "./logger.js";
import { type Store, emit } from "./state.js";

const STALE_DEFAULT_MIN = 10;   // running > N min idle → stale
const ENDED_DEFAULT_MIN = 30;   // any non-ended > N min idle → ended
const SWEEP_INTERVAL_MS = 60 * 1000;
// running + no current_tool + idle > N seconds → awaiting_user.
// Catches dropped Stop hooks: when Claude Code's Stop hook fails to
// deliver (handler timeout, network blip, focus-suspend in some
// scenarios), the session would otherwise stay "running" until the
// stale/ended thresholds kick in. 30s is well above typical
// inter-tool / final-response generation time, but tight enough that
// the dashboard self-corrects within a sweep.
const IDLE_PROMOTE_MS = Number(process.env.IDLE_PROMOTE_SEC ?? 30) * 1000;

const STALE_THRESHOLD_MS = readThresholdMs("STALE_SESSION_MIN", STALE_DEFAULT_MIN);
const ENDED_THRESHOLD_MS = readThresholdMs("ENDED_SESSION_MIN", ENDED_DEFAULT_MIN);

function readThresholdMs(envVar: string, defaultMin: number): number {
  const raw = process.env[envVar];
  if (raw === undefined) return defaultMin * 60_000;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    logger.warn({ envVar, raw }, `invalid ${envVar}; falling back to default ${defaultMin}m`);
    return defaultMin * 60_000;
  }
  return parsed * 60_000;
}

export function startStaleSweep(store: Store): NodeJS.Timeout {
  sweep(store);                          // run once immediately on boot
  const handle = setInterval(() => sweep(store), SWEEP_INTERVAL_MS);
  handle.unref();
  return handle;
}

function sweep(store: Store): void {
  const now = Date.now();
  for (const [id, session] of store.sessions) {
    const last = Date.parse(session.last_event_at);
    if (Number.isNaN(last)) continue;
    const age = now - last;

    if (age > ENDED_THRESHOLD_MS && session.status !== "ended") {
      // End every non-ended agent too. `rollupSessionStatus` recomputes
      // session.status from agent.status on every reduce() — if we leave
      // agents in "running" while flipping the session to "ended", a
      // stray late event will roll the session right back to "running".
      // Closing the agents keeps the rollup consistent until a legit
      // new event explicitly reanimates one.
      const endedAt = session.ended_at ?? session.last_event_at;
      const nextAgents: SessionState["agents"] = {};
      for (const [aid, agent] of Object.entries(session.agents)) {
        nextAgents[aid] =
          agent.status === "ended"
            ? agent
            : { ...agent, status: "ended", ended_at: agent.ended_at ?? endedAt };
      }
      const next: SessionState = {
        ...session,
        status: "ended",
        ended_at: endedAt,
        agents: nextAgents,
      };
      commitSweep(store, id, next, "ended");
      continue;
    }

    // Self-heal stuck "running" before stale fires. Conditions:
    //   - session.status === running
    //   - main agent's current_tool is undefined (no in-flight tool)
    //   - age > IDLE_PROMOTE_MS
    // We only flip the main agent (and re-rollup) — sub-agents have
    // their own SubagentStart/Stop lifecycle and aren't covered here.
    if (age > IDLE_PROMOTE_MS && session.status === "running") {
      const main = session.agents.main;
      if (main && main.status === "running" && main.current_tool === undefined) {
        const nextMain: AgentState = { ...main, status: "awaiting_user" };
        const nextAgents = { ...session.agents, main: nextMain };
        const nextStatus = rollupSessionStatus(nextAgents);
        const next: SessionState = {
          ...session,
          status: nextStatus,
          agents: nextAgents,
        };
        commitSweep(store, id, next, "idle_promote");
        continue;
      }
    }

    if (age > STALE_THRESHOLD_MS && session.status === "running") {
      // Same reason as above: rollup needs stale agents to keep the
      // session stale across subsequent reduce() calls. Only the
      // currently-running agents need flipping; ended sub-agents stay
      // ended, blocked stays blocked, etc.
      const minutes = Math.floor(age / 60_000);
      const nextAgents: SessionState["agents"] = {};
      for (const [aid, agent] of Object.entries(session.agents)) {
        nextAgents[aid] =
          agent.status === "running" ? { ...agent, status: "stale" } : agent;
      }
      const next: SessionState = {
        ...session,
        status: "stale",
        current_activity: `stale: no events for ${minutes}m`,
        agents: nextAgents,
      };
      commitSweep(store, id, next, "stale");
    }
  }
}

function commitSweep(
  store: Store,
  id: string,
  next: SessionState,
  reason: "stale" | "ended" | "idle_promote",
): void {
  store.sessions.set(id, next);
  store.seq += 1;
  emit(store, { type: "session_upsert", seq: store.seq, session: next });
  logger.info({ session_id: id, reason }, "session swept");
}
