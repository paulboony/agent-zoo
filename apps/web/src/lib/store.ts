import type { SessionState, SseMessage } from "@agent-zoo/shared";
import { statusUrgency } from "@agent-zoo/shared";
import { create } from "zustand";

export type ConnectionState = "connecting" | "open" | "closed";

interface ClientState {
  sessions: Record<string, SessionState>;
  seq: number;
  selectedSessionId: string | null;
  connection: ConnectionState;
  applySnapshot: (seq: number, sessions: SessionState[]) => void;
  applyMessage: (msg: SseMessage) => void;
  setConnection: (c: ConnectionState) => void;
  selectSession: (id: string | null) => void;
}

export const useStore = create<ClientState>((set) => ({
  sessions: {},
  seq: 0,
  selectedSessionId: null,
  connection: "connecting",

  applySnapshot: (seq, sessions) =>
    set(() => {
      const map: Record<string, SessionState> = {};
      for (const s of sessions) map[s.id] = s;
      return { seq, sessions: map };
    }),

  applyMessage: (msg) =>
    set((state) => {
      if (msg.seq <= state.seq) return state;
      switch (msg.type) {
        case "snapshot": {
          const map: Record<string, SessionState> = {};
          for (const s of msg.sessions) map[s.id] = s;
          return { seq: msg.seq, sessions: map };
        }
        case "session_upsert":
          return {
            seq: msg.seq,
            sessions: { ...state.sessions, [msg.session.id]: msg.session },
          };
        case "session_remove": {
          const next = { ...state.sessions };
          delete next[msg.id];
          return { seq: msg.seq, sessions: next };
        }
        case "heartbeat":
          return { seq: msg.seq };
      }
    }),

  setConnection: (connection) => set({ connection }),
  selectSession: (id) => set({ selectedSessionId: id }),
}));

export function selectSortedSessions(state: ClientState): SessionState[] {
  return Object.values(state.sessions).sort((a, b) => {
    const ua = statusUrgency(a.status);
    const ub = statusUrgency(b.status);
    if (ua !== ub) return ub - ua;
    return Date.parse(b.last_event_at) - Date.parse(a.last_event_at);
  });
}
