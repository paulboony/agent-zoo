import type { SessionState, SseMessage } from "@agent-zoo/shared";
import { statusUrgency } from "@agent-zoo/shared";
import { create } from "zustand";

export type ConnectionState = "connecting" | "open" | "closed";

export interface SessionTransition {
  session: SessionState;
  prevStatus: SessionState["status"] | null;
  isNew: boolean;
  /**
   * Sub-agent ids added by this upsert. Empty when `isNew` is true (first sight
   * of a session counts as session-start, not as subagent spawns). Excludes `"main"`.
   */
  newAgentIds: string[];
}

interface ClientState {
  sessions: Record<string, SessionState>;
  seq: number;
  connection: ConnectionState;
  lastTransition: SessionTransition | null;
  applySnapshot: (seq: number, sessions: SessionState[]) => void;
  applyMessage: (msg: SseMessage) => void;
  setConnection: (c: ConnectionState) => void;
}

export const useStore = create<ClientState>((set) => ({
  sessions: {},
  seq: 0,
  connection: "connecting",
  lastTransition: null,

  applySnapshot: (seq, sessions) =>
    set((state) => {
      if (seq <= state.seq) return state;
      const map: Record<string, SessionState> = {};
      for (const s of sessions) map[s.id] = s;
      return { seq, sessions: map, lastTransition: null };
    }),

  applyMessage: (msg) =>
    set((state) => {
      if (msg.seq <= state.seq) return state;
      switch (msg.type) {
        case "snapshot": {
          const map: Record<string, SessionState> = {};
          for (const s of msg.sessions) map[s.id] = s;
          return { seq: msg.seq, sessions: map, lastTransition: null };
        }
        case "session_upsert": {
          const prevSession = state.sessions[msg.session.id];
          const prevStatus = prevSession?.status ?? null;
          const isNew = !prevSession;
          const prevAgentIds = new Set(prevSession ? Object.keys(prevSession.agents) : []);
          const newAgentIds = isNew
            ? []
            : Object.keys(msg.session.agents).filter(
                (id) => id !== "main" && !prevAgentIds.has(id),
              );
          return {
            seq: msg.seq,
            sessions: { ...state.sessions, [msg.session.id]: msg.session },
            lastTransition: {
              session: msg.session,
              prevStatus,
              isNew,
              newAgentIds,
            },
          };
        }
        case "session_remove": {
          const next = { ...state.sessions };
          delete next[msg.id];
          return { seq: msg.seq, sessions: next, lastTransition: null };
        }
        case "heartbeat":
          return { seq: msg.seq };
        default: {
          const _exhaustive: never = msg;
          void _exhaustive;
          return state;
        }
      }
    }),

  setConnection: (connection) => set({ connection }),
}));

export function sortSessions(sessions: Record<string, SessionState>): SessionState[] {
  return Object.values(sessions).sort((a, b) => {
    const ua = statusUrgency(a.status);
    const ub = statusUrgency(b.status);
    if (ua !== ub) return ub - ua;
    return Date.parse(b.last_event_at) - Date.parse(a.last_event_at);
  });
}
