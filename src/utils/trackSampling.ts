/**
 * Sampling a recorded track at an arbitrary instant, for playback.
 *
 * Tracks are irregular: samples land every ~5 s while a player is online, then stop
 * dead for hours when they log out, then resume. Playback needs a position for any
 * instant the playhead lands on, so this interpolates between bracketing samples —
 * but never across an absence. Interpolating across a six-hour logout would draw a
 * survivor gliding smoothly across the map overnight, which is a fabrication.
 *
 * ## Absence is a flag, never a duration
 *
 * The obvious implementation — "if these two samples are more than a minute apart,
 * the player was gone" — is wrong, and wrong in a way that only shows up on real
 * data. Tracks arrive DECIMATED: a player walking a straight road for an hour is
 * correctly reduced to two points an hour apart, and a duration test reads that as
 * a logout, refuses to interpolate, and renders nobody at all.
 *
 * So absence comes from `point.gap`, which the backend computes from the RAW
 * sampling before decimation and force-retains through it (see queryTrack in
 * server/history-store.js). A long interval between two points with no `gap` means
 * "nothing interesting happened here", which is exactly when interpolation is safe.
 *
 * Pure and index-based (no allocation per frame), because playback calls this for
 * every track on every animation frame.
 */

import type { HistoryPoint } from '@/types/history';

/**
 * How long a marker lingers at a player's last known position after their track
 * ends or an absence begins. Purely cosmetic — it stops a survivor from vanishing
 * on the exact frame of their last sample — and deliberately short, so a player who
 * logged out hours ago is not left parked on the map.
 */
export const TRAIL_HOLD_MS = 60_000;

export interface SampledPosition {
  x: number;
  z: number;
  /** The sample at or before `ts` — the source of non-interpolatable fields. */
  point: HistoryPoint;
  /** True when x/z were interpolated rather than taken from a real sample. */
  interpolated: boolean;
}

/**
 * Index of the last point at or before `ts`, or -1 when `ts` precedes the track.
 * Binary search: a 2000-point track scanned linearly per player per frame is the
 * kind of thing that quietly makes playback stutter at 60 fps.
 */
export function indexAtOrBefore(points: HistoryPoint[], ts: number): number {
  let lo = 0;
  let hi = points.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].ts <= ts) { best = mid; lo = mid + 1; } else { hi = mid - 1; }
  }
  return best;
}

/**
 * Position of a track at `ts`, or null when the player was not present then.
 *
 * Returns null before the first sample, after the last, and inside any gap longer
 * than `maxGapMs` — all three are "this player was not here", and rendering a
 * marker for any of them would assert presence the recording does not support.
 */
export function sampleTrackAt(
  points: HistoryPoint[],
  ts: number,
  holdMs = TRAIL_HOLD_MS,
): SampledPosition | null {
  if (!points.length) return null;

  const i = indexAtOrBefore(points, ts);
  if (i === -1) return null;                        // before the track started

  const a = points[i];
  const b = points[i + 1];

  // Either the track has ended, or the next point opens an absence. Both mean the
  // player left after `a`: hold their last known spot briefly, then drop them.
  if (!b || b.gap) {
    return ts - a.ts <= holdMs
      ? { x: a.x, z: a.z, point: a, interpolated: false }
      : null;
  }

  // Continuous presence between a and b, however far apart in time. Decimation is
  // what makes that interval large, and RDP guarantees the straight line between
  // them is within tolerance of the path actually walked.
  const span = b.ts - a.ts;
  const t = span > 0 ? (ts - a.ts) / span : 0;
  return {
    x: a.x + (b.x - a.x) * t,
    z: a.z + (b.z - a.z) * t,
    point: a,                                        // stats/hands come from the real sample
    interpolated: t > 0,
  };
}

/**
 * The slice of a track within `trailMs` before `ts`, as a flat [x, z, x, z, ...].
 *
 * Flat numbers rather than objects because this feeds an SVG polyline and is rebuilt
 * every frame; allocating a few hundred point objects per track per frame is exactly
 * the kind of garbage that shows up as jank.
 */
export function trailPoints(
  points: HistoryPoint[],
  ts: number,
  trailMs: number,
  holdMs = TRAIL_HOLD_MS,
): number[] {
  const out: number[] = [];
  if (!points.length || trailMs <= 0) return out;

  const end = indexAtOrBefore(points, ts);
  if (end === -1) return out;

  const cutoff = ts - trailMs;
  let start = end;
  while (start > 0) {
    // Never draw the trail across an absence — the same fabrication sampleTrackAt
    // refuses to make. Checked before the time cutoff so the walk always stops at
    // a run boundary even when the whole run is inside the window.
    if (points[start].gap) break;
    if (points[start - 1].ts < cutoff) break;
    start--;
  }

  for (let i = start; i <= end; i++) out.push(points[i].x, points[i].z);

  // Finish at the interpolated head so the trail meets the marker.
  const head = sampleTrackAt(points, ts, holdMs);
  if (head && (head.x !== points[end].x || head.z !== points[end].z)) {
    out.push(head.x, head.z);
  }
  return out;
}
