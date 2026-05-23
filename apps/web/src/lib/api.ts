import type { SseMessage } from "@agent-zoo/shared";
import { useStore } from "./store.js";

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
