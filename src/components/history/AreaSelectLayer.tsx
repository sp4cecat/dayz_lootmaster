import { useCallback, useRef } from 'react';
import type { MapPanZoom } from '@/hooks/useMapPanZoom';
import type { AreaSelection } from '@/types/history';

/**
 * Drag-out circular area selection.
 *
 * `useMapPanZoom` owns the background gesture (click vs drag-to-pan), so this takes
 * the pointer by having the parent pass `isGestureBlocked: () => mode === 'area'`.
 * That hook option exists for exactly this: a mode where something else needs the
 * drag. Without it, panning and selecting would fight over the same pointer.
 *
 * A circle rather than a rectangle, because every other spatial query in the product
 * is centre+radius — `GET /items?x&z&radius` and `POST /api/logs/adm` both take one,
 * and `/api/history/area` matches them. A rectangle here would need translating into
 * a radius at every hand-off, and "within 150 m of the flag" is the question admins
 * actually ask.
 */

interface AreaSelectLayerProps {
  view: MapPanZoom;
  area: AreaSelection | null;
  onChange: (area: AreaSelection | null) => void;
  /** Fired when a drag finishes, so the parent can run the query once. */
  onCommit: (area: AreaSelection) => void;
}

export default function AreaSelectLayer({ view, area, onChange, onCommit }: AreaSelectLayerProps) {
  // Gesture state lives in a ref, not in state — the same choice useMapPanZoom makes
  // for its own pan gesture. React batches updates, so a `dragging` state flag set in
  // pointerdown is still false inside a pointerup handler that runs in the same task,
  // and the drag silently never commits. A ref is current the instant it is written.
  const dragRef = useRef<{ active: boolean; x: number; z: number }>({ active: false, x: 0, z: 0 });

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const hit = view.toWorld(e.clientX, e.clientY);
    if (!hit) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragRef.current = { active: true, x: hit.x, z: hit.z };
    // A bare click (press and release with no travel) should still select something
    // usable, so seed a default radius rather than a zero one.
    onChange({ x: Math.round(hit.x), z: Math.round(hit.z), radius: 100 });
  }, [view, onChange]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d.active) return;
    const hit = view.toWorld(e.clientX, e.clientY);
    if (!hit) return;
    const radius = Math.round(Math.hypot(hit.x - d.x, hit.z - d.z));
    onChange({ x: Math.round(d.x), z: Math.round(d.z), radius: Math.max(10, radius) });
  }, [view, onChange]);

  const endDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d.active) return;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    dragRef.current = { active: false, x: 0, z: 0 };
    const hit = view.toWorld(e.clientX, e.clientY);
    const radius = hit ? Math.max(10, Math.round(Math.hypot(hit.x - d.x, hit.z - d.z))) : 100;
    const next = { x: Math.round(d.x), z: Math.round(d.z), radius };
    onChange(next);
    // One query per completed drag — running it on pointermove would fire dozens of
    // requests for results nobody sees.
    onCommit(next);
  }, [view, onChange, onCommit]);

  const centerPt = area ? view.project(area.x, area.z) : null;
  const radiusPx = area ? view.projectLen(area.radius) : 0;

  return (
    <div
      className="absolute inset-0 cursor-crosshair"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      {area && centerPt && (
        <>
          <div
            className="absolute rounded-full border-2 border-primary-400 bg-primary-400/15 pointer-events-none"
            style={{
              left: centerPt.px - radiusPx,
              top: centerPt.py - radiusPx,
              width: radiusPx * 2,
              height: radiusPx * 2,
            }}
          />
          <div
            className="absolute h-2 w-2 -ml-1 -mt-1 rounded-full bg-primary-500 ring-2 ring-white dark:ring-gray-900 pointer-events-none"
            style={{ left: centerPt.px, top: centerPt.py }}
          />
          <div
            className="absolute px-1.5 py-0.5 rounded bg-gray-900/80 text-white text-[10px] font-mono whitespace-nowrap pointer-events-none"
            style={{ left: centerPt.px + 8, top: centerPt.py - radiusPx - 18 }}
          >
            {area.x}, {area.z} · r {area.radius} m
          </div>
        </>
      )}

      {!area && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-lg bg-gray-900/80 text-white text-xs font-medium pointer-events-none">
          Drag on the map to select an area
        </div>
      )}
    </div>
  );
}
