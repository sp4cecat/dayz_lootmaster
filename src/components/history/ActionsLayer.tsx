import type { MapPanZoom } from '@/hooks/useMapPanZoom';
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
 * constant on-screen size at every zoom, which means projecting it per frame.
 * There are at most a few hundred of these against a path's thousands of points,
 * so the per-marker projection is affordable here and would not be there.
 *
 * Connects and disconnects are deliberately not drawn. They carry the player's
 * position, but "where he was standing when the client handshake completed" is not
 * a place anything happened, and littering spawn points with markers buries the
 * events that do mean something.
 */
export default function ActionsLayer({
  actions, view, hoveredId, onHoverAction,
}: ActionsLayerProps) {
  if (!view.size) return null;

  return (
    <>
      {actions.map((a) => {
        if (a.x === null || a.z === null || !isPlacedKind(a.kind)) return null;
        const p = view.project(a.x, a.z);
        const style = actionKindStyle(a.kind);
        const Icon = style.icon;
        const hot = hoveredId === a.id;
        return (
          <div
            key={`act-${a.id}`}
            className="absolute -translate-x-1/2 -translate-y-1/2 group pointer-events-auto"
            style={{ left: p.px, top: p.py, zIndex: hot ? 20 : undefined }}
            onMouseEnter={() => onHoverAction?.(a.id)}
            onMouseLeave={() => onHoverAction?.(null)}
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
            <div className="absolute left-1/2 -translate-x-1/2 top-6 hidden group-hover:block whitespace-nowrap px-1.5 py-1 rounded bg-gray-900/90 text-white text-[10px] z-30">
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
          </div>
        );
      })}
    </>
  );
}
