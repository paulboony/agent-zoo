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

export interface Store {
  sessions: Map<string, SessionState>;
  seq: number;
  subscribers: Set<(msg: SseMessage) => void>;
  recent_events: CircularBuffer<HookPayload>;
}

export function createStore(): Store {
  return {
    sessions: new Map(),
    seq: 0,
    subscribers: new Set(),
    recent_events: createCircularBuffer<HookPayload>(1000),
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
