import type { SessionState, SseMessage } from "@agent-zoo/shared";
import { useStore } from "./store.js";

interface SnapshotResponse {
  seq: number;
  sessions: SessionState[];
}

export async function fetchSnapshot(): Promise<void> {
  const res = await fetch("/api/sessions");
  if (!res.ok) throw new Error(`snapshot ${res.status}`);
  const body = (await res.json()) as SnapshotResponse;
  useStore.getState().applySnapshot(body.seq, body.sessions);
}

export function openStream(): () => void {
  const store = useStore.getState();
  store.setConnection("connecting");

  const source = new EventSource("/stream");
  source.onopen = () => useStore.getState().setConnection("open");
  source.onerror = () => {
    const next = source.readyState === EventSource.CLOSED ? "closed" : "connecting";
    useStore.getState().setConnection(next);
  };
  source.onmessage = (evt) => {
    let msg: SseMessage;
    try {
      msg = JSON.parse(evt.data) as SseMessage;
    } catch {
      return;
    }
    useStore.getState().applyMessage(msg);
  };

  return () => source.close();
}
