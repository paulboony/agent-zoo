import type { SessionState } from "./state.js";

export type SseMessage =
  | { type: "snapshot"; seq: number; sessions: SessionState[] }
  | { type: "session_upsert"; seq: number; session: SessionState }
  | { type: "session_remove"; seq: number; id: string }
  | { type: "heartbeat"; seq: number };
