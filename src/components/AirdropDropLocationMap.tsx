import React, { useCallback, useEffect, useRef, useState } from 'react';
import { cx } from '@/utils/cx';
import { MapMetadata } from '@/consts/maps';
import { useMapPanZoom } from '@/hooks/useMapPanZoom';
import { MapZoomControls } from './MapZoomControls';

export interface DropLocation {
  Name?: string;
  x: number;
  z: number;
  Radius?: number;
  [key: string]: any;
}

/**
 * A normalised, reusable airdrop drop zone in Lootmaster's own locations library.
 * `id` is Lootmaster-internal (stable across renames) and is never written to
 * Expansion files — missions reference a location by `Name`. A location is a 2D
 * ground circle only; plane Height/Speed are mission-level, not part of a location.
 */
export interface AirdropLocation {
  id: string;
  Name: string;
  x: number;
  z: number;
  Radius?: number;
}

interface AirdropDropLocationMapProps {
  map: MapMetadata;
  locations: DropLocation[];
  selectedIndex: number | null;
  onSelect: (index: number) => void;
  onChange: (locations: DropLocation[]) => void;
  /**
   * When true the map sizes itself to the available vertical height (a square
   * driven by the parent's height) instead of the full container width, capped so
   * the image is never scaled beyond 100% of its native pixels. The parent must be
   * a flex container with a bounded height. Default false = full-width square.
   */
  fill?: boolean;
  /** Prefix for the default marker label when a location has no Name (e.g. "Drop 1", "Zone 1"). */
  labelPrefix?: string;
  /**
   * Enable wheel zoom and drag-to-pan. Zoom is capped at one image pixel per CSS pixel, so
   * maps whose image is smaller than the rendered box stay fixed. Default true; pass false
   * to restore the original static behaviour.
   */
  zoomable?: boolean;
  /**
   * The on-map zoom button cluster. 'auto' hides it on maps too small to host it — wheel
   * zoom and panning still work there. Default 'auto'.
   */
  zoomControls?: 'auto' | 'always' | 'hidden';
}

type DragMode = 'center' | 'radius' | null;

/** Below this box size the button cluster would crowd the map out. */
const MIN_SIZE_FOR_CONTROLS = 200;

/**
 * Interactive top-down map for editing Expansion Airdrop DropLocations and build zones.
 *
 * Pan/zoom is `useMapPanZoom`, shared with the Heat Map and Item Scanner; see that hook for
 * the three-layer structure and why zoom is a layout size rather than a CSS scale().
 *
 * Drag the center handle to reposition a drop, or the outer handle to resize its radius.
 * Clicking empty map area moves the selected drop; dragging it pans.
 */
export const AirdropDropLocationMap: React.FC<AirdropDropLocationMapProps> = ({
  map,
  locations,
  selectedIndex,
  onSelect,
  onChange,
  fill = false,
  labelPrefix = 'Drop',
  zoomable = true,
  zoomControls = 'auto',
}) => {
  const dragRef = useRef<{ mode: DragMode; index: number }>({ mode: null, index: -1 });
  const [, forceRender] = useState(0);

  const worldSize = map.worldSize || 15360;

  const moveTo = useCallback((index: number, x: number, z: number) => {
    const next = locations.map((l) => ({ ...l }));
    const loc = next[index];
    if (!loc) return;
    loc.x = Math.round(x);
    loc.z = Math.round(z);
    onChange(next);
  }, [locations, onChange]);

  const view = useMapPanZoom({
    worldSize,
    zoomable,
    isGestureBlocked: () => dragRef.current.mode !== null,
    onBackgroundClick: (hit) => {
      if (selectedIndex === null) return;
      moveTo(selectedIndex, hit.x, hit.z);
    },
  });

  // Destructured so the drag effect below depends on stable callbacks rather than the
  // whole view object (freshly allocated each render), which would otherwise rebind the
  // window listeners on every render.
  const { size, toWorld } = view;

  // --- Marker dragging -----------------------------------------------------

  const applyDrag = useCallback((clientX: number, clientY: number) => {
    const { mode, index } = dragRef.current;
    if (!mode || index < 0) return;
    const hit = toWorld(clientX, clientY);
    if (!hit) return;

    if (mode === 'center') {
      moveTo(index, hit.x, hit.z);
      return;
    }
    const next = locations.map((l) => ({ ...l }));
    const loc = next[index];
    if (!loc) return;
    // Measured in content px, so a given drag distance means the same number of
    // metres regardless of zoom.
    const centerCx = (loc.x / worldSize) * size;
    const centerCy = size - (loc.z / worldSize) * size;
    const dist = Math.hypot(hit.cx - centerCx, hit.cy - centerCy);
    loc.Radius = Math.max(0, Math.round((dist / size) * worldSize));
    onChange(next);
  }, [locations, moveTo, onChange, toWorld, size, worldSize]);

  useEffect(() => {
    const handleMove = (e: PointerEvent) => {
      if (!dragRef.current.mode) return;
      e.preventDefault();
      applyDrag(e.clientX, e.clientY);
    };
    const handleUp = () => {
      if (dragRef.current.mode) {
        dragRef.current = { mode: null, index: -1 };
        forceRender((n) => n + 1);
      }
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
  }, [applyDrag]);

  const startDrag = (mode: DragMode, index: number) => (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    onSelect(index);
    dragRef.current = { mode, index };
    forceRender((n) => n + 1);
  };

  // --- Render --------------------------------------------------------------

  const showControls = view.canZoom && zoomControls !== 'hidden'
    && (zoomControls === 'always' || size >= MIN_SIZE_FOR_CONTROLS);
  const showImage = !!map.imagePath && !view.imageFailed;

  const project = (loc: DropLocation) => {
    const { px, py } = view.project(loc.x, loc.z);
    const rPx = view.projectLen(loc.Radius || 0);
    return { px, py, rPx, dia: Math.max(rPx * 2, 4) };
  };

  return (
    <div
      ref={view.viewportRef}
      {...view.viewportHandlers}
      style={fill && view.naturalSize
        ? { maxWidth: view.naturalSize, maxHeight: view.naturalSize }
        : undefined}
      className={cx(
        'relative aspect-square overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-100 dark:bg-gray-900 select-none touch-none',
        // Fill mode: square driven by the parent's height (capped at native size via the
        // inline max-*, which also means maxScale is 1 there for small images — no zoom, and
        // no upscaling). Default: full-width square.
        fill ? 'h-full max-w-full max-h-full' : 'w-full',
        view.isPanning ? 'cursor-grabbing' : view.canZoom && !view.atMin ? 'cursor-grab' : undefined
      )}
    >
      {/* Content layer: the image only, carrying the pan/zoom. */}
      {showImage ? (
        <div style={view.contentStyle}>
          <img
            src={map.imagePath}
            alt={map.displayName}
            {...view.imageProps}
            // Stretched, not object-cover: the overlay maths assume the image spans exactly
            // 0..worldSize across the square, and cover would crop a non-square source
            // (Livonia is 3072x3015) and put every marker out by up to ~119m.
            className="block h-full w-full opacity-90 pointer-events-none"
          />
        </div>
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-gray-400 pointer-events-none">
          No map preview for "{map.displayName}"
        </div>
      )}

      {/* Overlay layer: untransformed, so handles and labels keep a constant screen size. */}
      {size > 0 && (
        <div className="absolute inset-0 pointer-events-none">
          {/* Radius circles — world-sized, so the diameter scales but the border stays 2px. */}
          {locations.map((loc, i) => {
            const { px, py, dia } = project(loc);
            const isSel = i === selectedIndex;
            return (
              <div
                key={`circle-${i}`}
                style={{ left: px, top: py, width: dia, height: dia }}
                className={cx(
                  'absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2',
                  isSel ? 'border-primary-500 bg-primary-500/15' : 'border-gray-400/70 bg-gray-400/10'
                )}
              />
            );
          })}

          {locations.map((loc, i) => {
            const { px, py, rPx } = project(loc);
            const isSel = i === selectedIndex;
            return (
              <React.Fragment key={i}>
                {/* Center handle */}
                <div
                  onPointerDown={startDrag('center', i)}
                  title={loc.Name || `${labelPrefix} ${i + 1}`}
                  style={{ left: px, top: py }}
                  className={cx(
                    'absolute z-20 -translate-x-1/2 -translate-y-1/2 cursor-move rounded-full border-2 border-white shadow-md pointer-events-auto',
                    isSel ? 'h-3.5 w-3.5 bg-primary-600' : 'h-3 w-3 bg-gray-500'
                  )}
                />
                {/* Radius handle (right edge of the circle), only when selected */}
                {isSel && (
                  <div
                    onPointerDown={startDrag('radius', i)}
                    title="Drag to resize radius"
                    style={{ left: px + rPx, top: py }}
                    className="absolute z-20 -translate-x-1/2 -translate-y-1/2 h-3 w-3 cursor-ew-resize rounded-sm border-2 border-white bg-primary-400 shadow-md pointer-events-auto"
                  />
                )}
                {isSel && (
                  <div
                    style={{ left: px, top: py }}
                    className="absolute z-10 -translate-x-1/2 translate-y-3 whitespace-nowrap rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white"
                  >
                    {loc.Name || `${labelPrefix} ${i + 1}`}
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>
      )}

      {showControls && <MapZoomControls map={view} />}
    </div>
  );
};
