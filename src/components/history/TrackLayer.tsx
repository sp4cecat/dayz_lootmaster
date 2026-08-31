import { useMemo } from 'react';
import { TRACK_COLORS } from '@/utils/trackColors';
import type { HistoryTrack } from '@/types/history';

/**
 * Player paths, drawn as SVG inside the map's content box.
 *
 * ## Why this is not on the marker overlay
 *
 * Every other map layer in the app positions things on an untransformed overlay via
 * `view.project()`, so markers keep a constant on-screen size at any zoom. A path
 * must not work that way: projecting thousands of points in JS on every pan frame
 * is exactly the stutter `useMapPanZoom` was written to avoid.
 *
 * Instead this renders ONE <svg> with `viewBox="0 0 worldSize worldSize"` sitting
 * inside the content box. Points go in as raw world metres and the browser does the
 * transform — for free, on the compositor, at whatever zoom the content box is
 * currently laid out at. Pan and zoom then cost nothing here at all.
 *
 * The catch is that everything inside a scaled viewBox scales, including stroke
 * width, so a zoomed-in path would render as a fat blob. `vectorEffect="non-scaling-
 * stroke"` opts the stroke out of the transform while leaving the geometry in it.
 *
 * ## The axis flip
 *
 * DayZ world Z increases north; screen Y increases down. `mapTransform.ts` handles
 * this for projected markers (`1 - z / worldSize`); inside the viewBox we do the
 * same thing directly as `y = worldSize - z`.
 */

interface TrackLayerProps {
  tracks: HistoryTrack[];
  worldSize: number;
  /** Colour per pid, from the selection. Never index a palette here — see trackColors. */
  colors: ReadonlyMap<string, string>;
  /** Ids to draw at full strength; everything else dims. Empty = all full. */
  highlighted?: Set<string>;
}

/**
 * Split a track into runs of continuous presence.
 *
 * The break comes from `point.gap`, which the backend derives from the raw sampling
 * before decimation — NOT from comparing timestamps here. A decimated track puts an
 * hour between two points of an uninterrupted straight walk, so a duration test
 * would shatter that path into single points and draw nothing at all.
 *
 * Joining across a real absence would be worse still: a straight line across the map
 * asserting a journey that never happened.
 */
function toRuns(track: HistoryTrack, worldSize: number): string[] {
  const runs: string[] = [];
  let cur: string[] = [];
  for (const p of track.points) {
    if (p.gap && cur.length) {
      if (cur.length > 1) runs.push(cur.join(' '));
      cur = [];
    }
    cur.push(`${p.x.toFixed(1)},${(worldSize - p.z).toFixed(1)}`);
  }
  if (cur.length > 1) runs.push(cur.join(' '));
  return runs;
}

export default function TrackLayer({ tracks, worldSize, colors, highlighted }: TrackLayerProps) {
  const shapes = useMemo(
    () => tracks.map((t) => ({
      pid: t.pid,
      color: colors.get(t.pid) ?? TRACK_COLORS[0],
      runs: toRuns(t, worldSize),
    })),
    [tracks, worldSize, colors],
  );

  if (!tracks.length) return null;
  const dimOthers = !!highlighted && highlighted.size > 0;

  return (
    <svg
      viewBox={`0 0 ${worldSize} ${worldSize}`}
      preserveAspectRatio="none"
      className="absolute inset-0 w-full h-full pointer-events-none"
      aria-hidden="true"
    >
      {shapes.map(({ pid, color, runs }) => {
        const dim = dimOthers && !highlighted!.has(pid);
        return (
          <g key={pid} data-pid={pid} opacity={dim ? 0.18 : 1}>
            {runs.map((points, i) => (
              <polyline
                key={i}
                points={points}
                fill="none"
                stroke={color}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                // Geometry scales with the map; the stroke must not, or a zoomed
                // path renders as a wedge instead of a line.
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </g>
        );
      })}
    </svg>
  );
}
