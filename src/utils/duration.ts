/**
 * Human-readable elapsed time.
 *
 * Shared rather than per-component so the area panel's visit durations and the
 * playback ribbon's logout durations cannot drift into two different dialects of
 * the same number.
 */
export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}
