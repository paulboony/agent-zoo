import type { HookPayload, SessionState, SseMessage } from "@agent-zoo/shared";

export interface CircularBuffer<T> {
  push(item: T): void;
  toArray(): T[];
}

export function createCircularBuffer<T>(capacity: number): CircularBuffer<T> {
  const buf: T[] = [];
  let head = 0;
  return {
    push(item) {
      if (buf.length < capacity) {
        buf.push(item);
      } else {
        buf[head] = item;
        head = (head + 1) % capacity;
      }
    },
    toArray() {
      if (buf.length < capacity) return buf.slice();
      return buf.slice(head).concat(buf.slice(0, head));
    },
  };
}

export interface PendingSubagent {
  description: string;
  prompt?: string;
  subagent_type: string;
}

export interface Store {
  sessions: Map<string, SessionState>;
  seq: number;
  subscribers: Set<(msg: SseMessage) => void>;
  recent_events: CircularBuffer<HookPayload>;
  /**
   * Per-session correlation buffer: tool_use_id → Task input.
   * Populated on the parent's PreToolUse for the Task tool, consumed when
   * the matching SubagentStart arrives, cleared when the session ends.
   */
  pending_subagents: Map<string, Map<string, PendingSubagent>>;
}

export function createStore(): Store {
  return {
    sessions: new Map(),
    seq: 0,
    subscribers: new Set(),
    recent_events: createCircularBuffer<HookPayload>(1000),
    pending_subagents: new Map(),
  };
}

export function emit(store: Store, msg: SseMessage): void {
  for (const fn of store.subscribers) {
    try {
      fn(msg);
    } catch {
      // one bad subscriber must not break the fan-out
    }
  }
}
