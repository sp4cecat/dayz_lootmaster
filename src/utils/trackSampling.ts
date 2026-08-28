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

/** A stretch of wall-clock time in which at least one track has a position. */
export interface PresenceSegment {
  from: number;
  to: number;
}

/**
 * When the selected players were actually present, as merged intervals.
 *
 * Playback windows are set by the range picker, but presence is set by the data,
 * and the two can differ by orders of magnitude. A backfilled admin-log archive
 * spans weeks while any one player is online for a few percent of it, so a
 * playhead advancing at a fixed multiple of real time spends almost all of its
 * time on an empty map. These intervals are what lets the transport skip that
 * dead air, and what the scrubber draws so an operator can see where the data is
 * instead of inferring it from a marker that never appears.
 *
 * Segment ends carry the same `holdMs` grace `sampleTrackAt` applies, so a
 * segment covers exactly the span in which a marker is drawn — no more.
 */
export function presenceSegments(
  tracks: { points: HistoryPoint[] }[],
  holdMs = TRAIL_HOLD_MS,
): PresenceSegment[] {
  const raw: PresenceSegment[] = [];

  for (const t of tracks) {
    const points = t.points;
    let runStart = -1;
    for (let i = 0; i < points.length; i++) {
      // `gap` marks the first sample AFTER an absence, so it closes the run
      // before it rather than opening one.
      if (points[i].gap && runStart >= 0) {
        raw.push({ from: points[runStart].ts, to: points[i - 1].ts + holdMs });
        runStart = i;
      } else if (runStart < 0) {
        runStart = i;
      }
    }
    if (runStart >= 0 && points.length) {
      raw.push({ from: points[runStart].ts, to: points[points.length - 1].ts + holdMs });
    }
  }

  raw.sort((a, b) => a.from - b.from);

  const merged: PresenceSegment[] = [];
  for (const seg of raw) {
    const last = merged[merged.length - 1];
    if (last && seg.from <= last.to) last.to = Math.max(last.to, seg.to);
    else merged.push({ ...seg });
  }
  return merged;
}

/**
 * `ts` itself when someone is present then, otherwise the start of the next
 * stretch of presence — or null once the last one has passed.
 *
 * The playhead is only ever moved forwards, never back, so a caller can use this
 * to advance without ever re-showing time the viewer has already watched.
 */
export function nextPresence(segments: PresenceSegment[], ts: number): number | null {
  for (const seg of segments) {
    if (ts < seg.from) return seg.from;
    if (ts <= seg.to) return ts;
  }
  return null;
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
