import { useSyncExternalStore } from "react";

const TICK_MS = 1000;

let now = Date.now();
let intervalId: ReturnType<typeof setInterval> | null = null;
const subscribers = new Set<() => void>();

function ensureInterval(): void {
  if (intervalId !== null) return;
  intervalId = setInterval(() => {
    now = Date.now();
    for (const cb of subscribers) cb();
  }, TICK_MS);
}

function subscribe(cb: () => void): () => void {
  subscribers.add(cb);
  ensureInterval();
  return () => {
    subscribers.delete(cb);
    if (subscribers.size === 0 && intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
  };
}

function getSnapshot(): number {
  return now;
}

/**
 * Re-renders the calling component every second with the current `Date.now()`.
 * All callers share one interval via `useSyncExternalStore`, so adding more
 * subscribers does not multiply timer count.
 */
export function useNow(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
