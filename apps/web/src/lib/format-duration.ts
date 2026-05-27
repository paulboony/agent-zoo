/**
 * Compact human duration for the activity chip.
 *
 *   < 60 s  → "12s"
 *   < 60 m  → "4m"
 *   ≥ 60 m  → "1h 12m"
 *
 * Inputs <= 0 (clock skew, fresh event) are reported as "0s" rather
 * than negative so the UI never shows weird strings.
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0s";
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const totalMin = Math.floor(totalSec / 60);
  if (totalMin < 60) return `${totalMin}m`;
  const hours = Math.floor(totalMin / 60);
  const remMin = totalMin - hours * 60;
  return `${hours}h ${remMin}m`;
}
