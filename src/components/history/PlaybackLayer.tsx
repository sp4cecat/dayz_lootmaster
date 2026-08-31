import { memo } from 'react';
import type { MapPanZoom } from '@/hooks/useMapPanZoom';
import type { HistoryPoint } from '@/types/history';

/**
 * The players being replayed, drawn at the playhead: a trail each, a dot each, and a
 * name on every one of them.
 *
 * ## Why the names are always on
 *
 * With one player selected the map is unambiguous and a hover tooltip is enough. With
 * four it is not: the whole question a multi-player replay answers is who was where
 * relative to whom, and a colour swatch in a rail 700 px away is not an answer you
 * can read while the clock is running. So the name rides with the marker, and the
 * tooltip keeps the detail (coordinates, health, hands) that would be noise on every
 * marker at once.
 *
 * Labels are `pointer-events-none` and there is no collision solver — two players
 * standing together get overlapping labels. That is tolerable only because the
 * selection is capped at the palette size (MAX_TRACKS); it would not be at fifty.
 *
 * ## Why one <svg>
 *
 * The trails changed every frame either way, but this used to mount one <svg> element
 * PER PLAYER per frame. One element with a polyline per player costs the same to draw
 * and far less to reconcile.
 *
 * No viewport culling here, deliberately — unlike ActionsLayer, which culls because
 * its server ceiling is 5,000 markers. The ceiling here is MAX_TRACKS, and running a
 * measure-and-compare per frame to skip at most eight nodes costs more than it saves.
 */

export interface PlaybackMarker {
  pid: string;
  name: string | null;
  color: string;
  x: number;
  z: number;
  /** The real sample at or before the playhead — stats come from here, never interpolated. */
  point: HistoryPoint;
  /** Flat [x, z, x, z, ...] behind the player; see trailPoints. */
  trail: number[];
}

interface PlaybackLayerProps {
  markers: PlaybackMarker[];
  view: MapPanZoom;
}

interface DotProps {
  name: string;
  color: string;
  px: number;
  py: number;
  /** Already rounded to whole metres — the only precision the tooltip shows. */
  x: number;
  z: number;
  hp: number | null;
  hands: string | null;
}

/**
 * Memoised on primitives only — never on the marker object, and never on the trail
 * array, which is a fresh allocation every frame and would defeat memo outright.
 *
 * Every value is pre-rounded to the precision actually rendered — whole pixels for
 * the position, whole metres for the readout, which is what the tooltip showed
 * anyway. At full precision an interpolating marker re-renders on every frame for a
 * movement of a hundredth of a pixel; rounded, a stationary or slow player re-renders
 * only when something visibly changes. Campers and AFK players are a large share of
 * any real selection.
 */
const PlaybackDot = memo(function PlaybackDot({
  name, color, px, py, x, z, hp, hands,
}: DotProps) {
  return (
    <div
      className="absolute -translate-x-1/2 -translate-y-1/2 group pointer-events-auto"
      style={{ left: px, top: py }}
    >
      <div
        className="h-3.5 w-3.5 rounded-full ring-2 ring-white/80 dark:ring-gray-900/80"
        style={{ backgroundColor: color }}
      />
      {/* The pill is what keeps the name readable over both snow and dark forest;
          coloured text alone disappears against half the map. */}
      <div
        className="absolute left-4 top-1/2 -translate-y-1/2 whitespace-nowrap px-1 py-px rounded bg-gray-900/75 text-[10px] leading-none font-medium pointer-events-none"
        style={{ color }}
      >
        {name}
      </div>
      {/* Below the dot, so it never lands on top of the label above. */}
      <div className="absolute left-1/2 -translate-x-1/2 top-5 hidden group-hover:block whitespace-nowrap px-1.5 py-1 rounded bg-gray-900/90 text-white text-[10px] z-10">
        <div className="font-medium">{name}</div>
        <div className="text-gray-300">
          {x}, {z}
          {hp !== null && ` · HP ${Math.round(hp)}`}
        </div>
        {hands && <div className="text-gray-300">Hands: {hands}</div>}
      </div>
    </div>
  );
});

export default function PlaybackLayer({ markers, view }: PlaybackLayerProps) {
  const { project } = view;
  if (!view.size) return null;

  return (
    <>
      <svg className="absolute inset-0 w-full h-full pointer-events-none">
        {markers.map((m) => {
          const pts: string[] = [];
          for (let i = 0; i < m.trail.length; i += 2) {
            const p = project(m.trail[i], m.trail[i + 1]);
            pts.push(`${p.px},${p.py}`);
          }
          if (pts.length < 2) return null;
          return (
            <polyline
              key={`trail-${m.pid}`}
              points={pts.join(' ')}
              fill="none"
              stroke={m.color}
              strokeWidth={2}
              strokeLinecap="round"
              opacity={0.55}
            />
          );
        })}
      </svg>

      {markers.map((m) => {
        const p = project(m.x, m.z);
        return (
          <PlaybackDot
            key={`m-${m.pid}`}
            name={m.name || m.pid}
            color={m.color}
            px={Math.round(p.px)}
            py={Math.round(p.py)}
            x={Math.round(m.x)}
            z={Math.round(m.z)}
            hp={m.point.health}
            hands={m.point.hands}
          />
        );
      })}
    </>
  );
}
