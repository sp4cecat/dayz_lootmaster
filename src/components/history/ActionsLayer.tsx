import { memo, useCallback, useState } from 'react';
import type { MapPanZoom } from '@/hooks/useMapPanZoom';
import { useVisibleWindow } from '@/hooks/useVisibleWindow';
import { actionKindStyle, isPlacedKind } from '@/utils/actionKinds';
import type { HistoryAction } from '@/types/history';

interface ActionsLayerProps {
  actions: HistoryAction[];
  view: MapPanZoom;
  /** Id of the feed row under the cursor; its marker is enlarged and brought forward. */
  hoveredId?: number | null;
  onHoverAction?: (id: number | null) => void;
}

/**
 * Action events as markers on the map overlay.
 *
 * On the OVERLAY, not inside the transformed content box — the opposite of
 * TrackLayer, and for the opposite reason. A path is static geometry that should
 * scale with the map, so the browser transforms it for free; a marker must keep a
 * constant on-screen size at every zoom, which means projecting it.
 *
 * Connects and disconnects are deliberately not drawn. They carry the player's
 * position, but "where he was standing when the client handshake completed" is not
 * a place anything happened, and littering spawn points with markers buries the
 * events that do mean something.
 *
 * ## Keeping the node count survivable
 *
 * The docstring here used to say "at most a few hundred of these". The server's
 * ceiling is 5,000 (see `HISTORY_MAX_ACTIONS` in server/index.js), and this layer used
 * to mount a four-div tooltip inside every single marker, hidden with `group-hover` —
 * about 35,000 DOM nodes for a query that returns the maximum. Three things keep that
 * in hand now, in order of how much they buy:
 *
 *   1. only the marker actually under the cursor renders a tooltip;
 *   2. markers outside the viewport (plus a margin) are not rendered at all;
 *   3. the marker is memoised and `view.project()` excludes the pan, so dragging the
 *      map re-renders none of them.
 */

interface MarkerProps {
  action: HistoryAction;
  px: number;
  py: number;
  /** Enlarged and brought forward — driven by the feed as well as by the map. */
  hot: boolean;
  /** Only true for the marker under the cursor, so exactly one tooltip exists. */
  showTooltip: boolean;
  onHover: (id: number | null) => void;
}

const ActionMarker = memo(function ActionMarker({
  action: a, px, py, hot, showTooltip, onHover,
}: MarkerProps) {
  const style = actionKindStyle(a.kind);
  const Icon = style.icon;
  return (
    <div
      className="absolute -translate-x-1/2 -translate-y-1/2 pointer-events-auto"
      style={{ left: px, top: py, zIndex: hot ? 20 : undefined }}
      onMouseEnter={() => onHover(a.id)}
      onMouseLeave={() => onHover(null)}
    >
      <div
        className="flex items-center justify-center rounded-full ring-2 ring-white/80 dark:ring-gray-900/80 transition-transform"
        style={{
          backgroundColor: style.color,
          width: hot ? 20 : 14,
          height: hot ? 20 : 14,
        }}
      >
        <Icon size={hot ? 12 : 9} className="text-white" />
      </div>
      {showTooltip && (
        <div className="absolute left-1/2 -translate-x-1/2 top-6 whitespace-nowrap px-1.5 py-1 rounded bg-gray-900/90 text-white text-[10px] z-30">
          <div className="font-medium">{a.name || a.pid || 'Unattributed'}</div>
          <div className="text-gray-300">
            {style.label}{a.cls ? ` · ${a.cls}` : ''}
          </div>
          <div className="text-gray-400">
            {new Date(a.ts).toLocaleString(undefined, {
              month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
            })}
          </div>
        </div>
      )}
    </div>
  );
});

export default function ActionsLayer({
  actions, view, hoveredId, onHoverAction,
}: ActionsLayerProps) {
  // Tracked here rather than reused from `hoveredId`, which the action feed also drives:
  // hovering a feed row should highlight the marker, not pop a tooltip open on the map.
  const [tooltipId, setTooltipId] = useState<number | null>(null);
  const window = useVisibleWindow(view);
  const { project } = view;

  const onHover = useCallback((id: number | null) => {
    setTooltipId(id);
    onHoverAction?.(id);
  }, [onHoverAction]);

  if (!view.size || !window) return null;

  return (
    <>
      {actions.map((a) => {
        if (a.x === null || a.z === null || !isPlacedKind(a.kind)) return null;
        const p = project(a.x, a.z);
        if (p.px < window.x0 || p.px > window.x1 || p.py < window.y0 || p.py > window.y1) {
          return null;
        }
        return (
          <ActionMarker
            key={`act-${a.id}`}
            action={a}
            px={p.px}
            py={p.py}
            hot={hoveredId === a.id}
            showTooltip={tooltipId === a.id}
            onHover={onHover}
          />
        );
      })}
    </>
  );
}
