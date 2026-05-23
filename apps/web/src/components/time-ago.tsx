import { useNow } from "@/hooks/use-now.js";
import { formatDuration } from "@/lib/time.js";

interface Props {
  /** ISO timestamp to measure elapsed time from. */
  iso: string;
  /** Append to non-"just now" outputs (e.g. " ago"). */
  suffix?: string;
  /** Below this many ms, render "just now" instead of "0s". */
  justNowMs?: number;
  /** Rendered when `iso` doesn't parse. Defaults to empty string. */
  fallback?: string;
}

/**
 * Re-renders once per second with the elapsed time since `iso`.
 *
 * Why a leaf: every card on the dashboard used to call `useNow()` at
 * the card root, so every `useNow` tick re-rendered every card whole.
 * Pushing the subscription down to this single-text leaf means a tick
 * only re-renders the duration string. Parents stay still.
 */
export function TimeAgo({ iso, suffix, justNowMs, fallback = "" }: Props) {
  const now = useNow();
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return <>{fallback}</>;
  return (
    <>
      {formatDuration(now - t, {
        ...(suffix !== undefined ? { suffix } : {}),
        ...(justNowMs !== undefined ? { justNowMs } : {}),
      })}
    </>
  );
}
