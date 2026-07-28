import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ZoomIn, ZoomOut, RefreshCcw01 } from '@untitledui/icons';
import { cx } from '@/utils/cx';
import { MapMetadata } from '@/consts/maps';
import {
  IDENTITY_TRANSFORM, MapTransform, clamp, clampTransform, computeMaxScale, contentToWorld,
  viewportToContent, worldLenToViewport, worldToViewport, zoomAt,
} from '@/utils/mapTransform';

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

/** Pointer travel (px) that still counts as a click rather than the start of a pan. */
const CLICK_SLOP = 4;
/** Wheel delta -> zoom factor. Applied exponentially so each notch is a constant ratio. */
const WHEEL_SENSITIVITY = 0.0015;
const BUTTON_ZOOM_STEP = 1.5;
/** Ignore trivially small zoom ranges (e.g. a 554px image in a 500px box) — not worth the UI. */
const ZOOM_EPSILON = 0.05;
/** Below this box size the button cluster would crowd the map out. */
const MIN_SIZE_FOR_CONTROLS = 200;

/**
 * Interactive top-down map for editing Expansion Airdrop DropLocations and build zones.
 *
 * Structured as three layers so that zooming doesn't distort the markers:
 *   1. the viewport (this element) — untransformed, measured, clips the content;
 *   2. the content box — holds only the <img>, and carries the pan/zoom transform;
 *   3. the overlay — markers projected to viewport px in JS, so their handles, borders and
 *      labels keep a constant on-screen size at every zoom level while radius circles,
 *      which are world-sized, scale with the map.
 *
 * World coordinates map linearly onto the content square; the DayZ Z axis is inverted
 * relative to screen Y, matching the Heatmap tool. See `@/utils/mapTransform` for the maths.
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
  // A state node rather than a ref so the measurement and wheel effects can depend on it.
  const [viewportEl, setViewportEl] = useState<HTMLDivElement | null>(null);
  const dragRef = useRef<{ mode: DragMode; index: number }>({ mode: null, index: -1 });
  const [, forceRender] = useState(0);
  // Native image size, measured on load, used to cap zoom at 100% (one image pixel per
  // CSS pixel — we never upscale the map image beyond its intrinsic pixels).
  const [naturalSize, setNaturalSize] = useState<number | null>(null);
  const [imageFailed, setImageFailed] = useState(false);

  const [size, setSize] = useState(0);
  const [viewportBox, setViewportBox] = useState({ w: 0, h: 0 });
  const [transform, setTransform] = useState<MapTransform>(IDENTITY_TRANSFORM);

  const worldSize = map.worldSize || 15360;
  const maxScale = zoomable ? computeMaxScale(naturalSize, size) : 1;
  const canZoom = maxScale > 1 + ZOOM_EPSILON;

  // Background press: either a click (teleport the selection) or a pan, decided by how far
  // the pointer travels. Kept in a ref so pointermove doesn't re-render until it becomes a pan.
  const bgRef = useRef({
    active: false, panning: false, pointerId: -1,
    startX: 0, startY: 0, startTx: 0, startTy: 0,
  });

  // --- Measurement ---------------------------------------------------------
  // offsetWidth, not getBoundingClientRect: the Zones fullscreen map mounts inside Modal's
  // `animate-in zoom-in-95`, so a rect would report a 95%-scaled box for the first 200ms.
  useLayoutEffect(() => {
    if (!viewportEl) return;
    const measure = () => {
      const w = viewportEl.offsetWidth;
      const h = viewportEl.offsetHeight;
      setSize(Math.floor(w));
      setViewportBox({ w, h });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(viewportEl);
    return () => ro.disconnect();
  }, [viewportEl]);

  // Re-clamp whenever the box or the zoom ceiling changes (fullscreen toggle, window resize,
  // image load). Also snaps back to fit when zoom becomes unavailable.
  useEffect(() => {
    setTransform((t) => clampTransform(t, size, viewportBox.w, viewportBox.h, maxScale));
  }, [size, viewportBox.w, viewportBox.h, maxScale]);

  const applyTransform = useCallback((next: MapTransform) => {
    setTransform(clampTransform(next, size, viewportBox.w, viewportBox.h, maxScale));
  }, [size, viewportBox.w, viewportBox.h, maxScale]);

  // --- Coordinate helpers --------------------------------------------------

  const pointerToWorld = useCallback((clientX: number, clientY: number) => {
    if (!viewportEl || !size) return null;
    const rect = viewportEl.getBoundingClientRect();
    const { cx, cy } = viewportToContent(clientX - rect.left, clientY - rect.top, size, transform);
    return { ...contentToWorld(cx, cy, worldSize, size), cx, cy };
  }, [viewportEl, size, transform, worldSize]);

  // --- Marker dragging -----------------------------------------------------

  const applyDrag = useCallback((clientX: number, clientY: number) => {
    const { mode, index } = dragRef.current;
    if (!mode || index < 0) return;
    const hit = pointerToWorld(clientX, clientY);
    if (!hit) return;

    const next = locations.map((l) => ({ ...l }));
    const loc = next[index];
    if (!loc) return;

    if (mode === 'center') {
      loc.x = Math.round(hit.x);
      loc.z = Math.round(hit.z);
    } else if (mode === 'radius') {
      // Measured in content px, so a given drag distance means the same number of
      // metres regardless of zoom.
      const centerCx = (loc.x / worldSize) * size;
      const centerCy = size - (loc.z / worldSize) * size;
      const dist = Math.hypot(hit.cx - centerCx, hit.cy - centerCy);
      loc.Radius = Math.max(0, Math.round((dist / size) * worldSize));
    }
    onChange(next);
  }, [locations, onChange, pointerToWorld, size, worldSize]);

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

  // --- Wheel zoom ----------------------------------------------------------
  // Bound natively and non-passively: React's onWheel is registered passive at the root, so
  // preventDefault() inside it is a no-op.
  useEffect(() => {
    if (!viewportEl || !canZoom) return;
    const onWheel = (e: WheelEvent) => {
      // deltaMode 1 = lines (Firefox), 2 = pages. Without this, FF zooms ~16x slower.
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? viewportBox.h : 1;
      const factor = Math.exp(-e.deltaY * unit * WHEEL_SENSITIVITY);
      const nextScale = clamp(transform.scale * factor, 1, maxScale);
      // Already at a limit and pushing further: let the wheel scroll the page instead of
      // silently swallowing it.
      if (Math.abs(nextScale - transform.scale) < 1e-4) return;
      e.preventDefault();
      const rect = viewportEl.getBoundingClientRect();
      applyTransform(zoomAt(transform, nextScale, e.clientX - rect.left, e.clientY - rect.top));
    };
    viewportEl.addEventListener('wheel', onWheel, { passive: false });
    return () => viewportEl.removeEventListener('wheel', onWheel);
  }, [viewportEl, canZoom, transform, maxScale, viewportBox.h, applyTransform]);

  // --- Background gesture: click-to-move vs drag-to-pan --------------------

  const handleBackgroundDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || dragRef.current.mode) return;
    bgRef.current = {
      active: true, panning: false, pointerId: e.pointerId,
      startX: e.clientX, startY: e.clientY, startTx: transform.x, startTy: transform.y,
    };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const handleBackgroundMove = (e: React.PointerEvent) => {
    const g = bgRef.current;
    if (!g.active || g.pointerId !== e.pointerId) return;
    const dx = e.clientX - g.startX;
    const dy = e.clientY - g.startY;
    if (!g.panning) {
      if (Math.hypot(dx, dy) <= CLICK_SLOP) return;
      g.panning = true;
      forceRender((n) => n + 1); // swap in the grabbing cursor
    }
    // Absolute from the gesture start, not incremental: accumulating deltas against a clamp
    // makes the pan stick when you push past an edge and reverse.
    applyTransform({ ...transform, x: g.startTx + dx, y: g.startTy + dy });
  };

  const endBackgroundGesture = (e: React.PointerEvent, cancelled = false) => {
    const g = bgRef.current;
    if (!g.active || g.pointerId !== e.pointerId) return;
    const wasClick = !g.panning && !cancelled;
    bgRef.current = { ...g, active: false, panning: false, pointerId: -1 };
    if (wasClick && selectedIndex !== null) {
      // Use the press coordinates — that's what the user aimed at.
      const hit = pointerToWorld(g.startX, g.startY);
      if (hit) {
        const next = locations.map((l) => ({ ...l }));
        const loc = next[selectedIndex];
        if (loc) {
          loc.x = Math.round(hit.x);
          loc.z = Math.round(hit.z);
          onChange(next);
        }
      }
    }
    forceRender((n) => n + 1);
  };

  // --- Zoom controls -------------------------------------------------------

  const zoomByStep = (direction: 1 | -1) => {
    const factor = direction > 0 ? BUTTON_ZOOM_STEP : 1 / BUTTON_ZOOM_STEP;
    applyTransform(zoomAt(
      transform,
      clamp(transform.scale * factor, 1, maxScale),
      viewportBox.w / 2,
      viewportBox.h / 2,
    ));
  };

  const showControls = canZoom && zoomControls !== 'hidden'
    && (zoomControls === 'always' || size >= MIN_SIZE_FOR_CONTROLS);
  const atMin = transform.scale <= 1 + 1e-3;
  const atMax = transform.scale >= maxScale - 1e-3;
  const isPanning = bgRef.current.panning;
  const showImage = !!map.imagePath && !imageFailed;

  const project = (loc: DropLocation) => {
    const { px, py } = worldToViewport(loc.x, loc.z, worldSize, size, transform);
    const rPx = worldLenToViewport(loc.Radius || 0, worldSize, size, transform);
    return { px, py, rPx, dia: Math.max(rPx * 2, 4) };
  };

  return (
    <div
      ref={setViewportEl}
      onPointerDown={handleBackgroundDown}
      onPointerMove={handleBackgroundMove}
      onPointerUp={(e) => endBackgroundGesture(e)}
      onPointerCancel={(e) => endBackgroundGesture(e, true)}
      style={fill && naturalSize ? { maxWidth: naturalSize, maxHeight: naturalSize } : undefined}
      className={cx(
        'relative aspect-square overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-100 dark:bg-gray-900 select-none touch-none',
        // Fill mode: square driven by the parent's height (capped at native size via the
        // inline max-*, which also means maxScale is 1 there for small images — no zoom, and
        // no upscaling). Default: full-width square.
        fill ? 'h-full max-w-full max-h-full' : 'w-full',
        isPanning ? 'cursor-grabbing' : canZoom && !atMin ? 'cursor-grab' : undefined
      )}
    >
      {/* Content layer: the image only, carrying the pan/zoom transform. */}
      {showImage ? (
        <div
          // The zoom is expressed as a real layout size rather than `scale()`, so the browser
          // rasterises the image at the zoomed resolution. A composited scale() transform
          // (especially with will-change) resamples one fit-sized raster and the map turns to
          // mush at exactly the zoom levels this feature exists for. Only the pan is a
          // transform, which costs nothing to composite and never resamples.
          style={{
            position: 'absolute', top: 0, left: 0,
            width: size ? size * transform.scale : '100%',
            height: size ? size * transform.scale : '100%',
            transform: `translate(${transform.x}px, ${transform.y}px)`,
          }}
        >
          <img
            src={map.imagePath}
            alt={map.displayName}
            draggable={false}
            onLoad={(e) => {
              const { naturalWidth, naturalHeight } = e.currentTarget;
              const n = Math.min(naturalWidth || 0, naturalHeight || 0);
              if (n > 0) setNaturalSize(n);
            }}
            onError={() => setImageFailed(true)}
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

      {showControls && (
        // stopPropagation on pointerdown, or pressing a button also arms the background
        // gesture and teleports the selected marker on release.
        <div
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute top-2 right-2 z-30 flex flex-col items-center gap-1"
        >
          <button
            type="button" title="Zoom in" disabled={atMax} onClick={() => zoomByStep(1)}
            className="flex h-7 w-7 items-center justify-center rounded-md bg-gray-900/70 text-white backdrop-blur-sm transition-colors hover:bg-gray-900/90 disabled:opacity-40 disabled:hover:bg-gray-900/70"
          >
            <ZoomIn size={14} />
          </button>
          <button
            type="button" title="Zoom out" disabled={atMin} onClick={() => zoomByStep(-1)}
            className="flex h-7 w-7 items-center justify-center rounded-md bg-gray-900/70 text-white backdrop-blur-sm transition-colors hover:bg-gray-900/90 disabled:opacity-40 disabled:hover:bg-gray-900/70"
          >
            <ZoomOut size={14} />
          </button>
          <button
            type="button" title="Reset to fit" disabled={atMin}
            onClick={() => applyTransform(IDENTITY_TRANSFORM)}
            className="flex h-7 w-7 items-center justify-center rounded-md bg-gray-900/70 text-white backdrop-blur-sm transition-colors hover:bg-gray-900/90 disabled:opacity-40 disabled:hover:bg-gray-900/70"
          >
            <RefreshCcw01 size={14} />
          </button>
          {/* Percent of native resolution, so 100% means one image pixel per CSS pixel. */}
          <span
            title="Zoom, as a percentage of the map image's native resolution"
            className="rounded bg-gray-900/70 px-1 py-0.5 text-[10px] font-mono text-white backdrop-blur-sm"
          >
            {Math.round((transform.scale / maxScale) * 100)}%
          </span>
        </div>
      )}
    </div>
  );
};
