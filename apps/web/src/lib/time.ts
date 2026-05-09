/**
 * Format a duration in milliseconds as `s` / `m` / `h` / `d` buckets.
 * `suffix` is appended to non-"just now" outputs (e.g. ` ago`).
 * `justNowMs` (when set) returns "just now" for any non-negative duration
 * shorter than that threshold.
 */
export function formatDuration(
  ms: number,
  opts?: { suffix?: string; justNowMs?: number },
): string {
  if (Number.isNaN(ms)) return "";
  const justNowMs = opts?.justNowMs;
  if (justNowMs !== undefined && ms >= 0 && ms < justNowMs) return "just now";
  const suffix = opts?.suffix ?? "";
  const abs = Math.abs(ms);
  const s = Math.floor(abs / 1000);
  if (s < 60) return `${s}s${suffix}`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m${suffix}`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h${suffix}`;
  const d = Math.floor(h / 24);
  return `${d}d${suffix}`;
}
