import React, { useCallback, useEffect, useRef, useState } from 'react';
import { cx } from '@/utils/cx';
import { MapMetadata } from '@/consts/maps';

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
}

type DragMode = 'center' | 'radius' | null;

/**
 * Interactive top-down map for editing Expansion Airdrop DropLocations.
 *
 * World coordinates are scaled to the rendered square using the standard
 * Lootmaster formula: px = (worldPos / worldSize) * size. The DayZ Z axis is
 * inverted relative to screen Y, matching the Heatmap tool.
 *
 * Drag the center handle to reposition a drop, or drag the outer handle to
 * resize its landing radius. Clicking empty map area moves the selected drop.
 */
export const AirdropDropLocationMap: React.FC<AirdropDropLocationMapProps> = ({
  map,
  locations,
  selectedIndex,
  onSelect,
  onChange,
  fill = false,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ mode: DragMode; index: number }>({ mode: null, index: -1 });
  const [, forceRender] = useState(0);
  // Native image size, measured on load, used to cap fill-mode zoom at 100% (never
  // upscale the map image beyond its intrinsic pixels).
  const [naturalSize, setNaturalSize] = useState<number | null>(null);

  const worldSize = map.worldSize || 15360;

  const getRect = () => containerRef.current?.getBoundingClientRect();

  const worldToPx = (pos: number, size: number) => (pos / worldSize) * size;
  const pxToWorld = (px: number, size: number) => (px / size) * worldSize;

  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

  const applyDrag = useCallback((clientX: number, clientY: number) => {
    const { mode, index } = dragRef.current;
    if (!mode || index < 0) return;
    const rect = getRect();
    if (!rect) return;
    const size = rect.width; // square
    const relX = clamp(clientX - rect.left, 0, size);
    const relY = clamp(clientY - rect.top, 0, size);

    const next = locations.map((l) => ({ ...l }));
    const loc = next[index];
    if (!loc) return;

    if (mode === 'center') {
      loc.x = Math.round(pxToWorld(relX, size));
      // Screen Y is inverted relative to world Z
      loc.z = Math.round(worldSize - pxToWorld(relY, size));
    } else if (mode === 'radius') {
      const centerPx = worldToPx(loc.x, size);
      const centerPy = size - worldToPx(loc.z, size);
      const dist = Math.hypot(relX - centerPx, relY - centerPy);
      loc.Radius = Math.max(0, Math.round(pxToWorld(dist, size)));
    }
    onChange(next);
  }, [locations, onChange, worldSize]);

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

  const handleBackgroundClick = (e: React.PointerEvent) => {
    if (selectedIndex === null) return;
    const rect = getRect();
    if (!rect) return;
    const size = rect.width;
    const relX = clamp(e.clientX - rect.left, 0, size);
    const relY = clamp(e.clientY - rect.top, 0, size);
    const next = locations.map((l) => ({ ...l }));
    const loc = next[selectedIndex];
    if (!loc) return;
    loc.x = Math.round(pxToWorld(relX, size));
    loc.z = Math.round(worldSize - pxToWorld(relY, size));
    onChange(next);
  };

  return (
    <div
      ref={containerRef}
      onPointerDown={handleBackgroundClick}
      style={fill && naturalSize ? { maxWidth: naturalSize, maxHeight: naturalSize } : undefined}
      className={cx(
        'relative aspect-square overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-100 dark:bg-gray-900 select-none touch-none',
        // Fill mode: square driven by the parent's height (capped at native size via
        // the inline max-*). Default: full-width square.
        fill ? 'h-full max-w-full max-h-full' : 'w-full'
      )}
    >
      {map.imagePath ? (
        <img
          src={map.imagePath}
          alt={map.displayName}
          draggable={false}
          onLoad={(e) => {
            const { naturalWidth, naturalHeight } = e.currentTarget;
            const n = Math.min(naturalWidth || 0, naturalHeight || 0);
            if (n > 0) setNaturalSize(n);
          }}
          className="absolute inset-0 h-full w-full object-cover opacity-90 pointer-events-none"
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-gray-400 pointer-events-none">
          No map preview for "{map.displayName}"
        </div>
      )}

      {/* Radius circles (HTML overlay so percentages scale with the square) */}
      {locations.map((loc, i) => {
        const cxPct = (loc.x / worldSize) * 100;
        const cyPct = (1 - loc.z / worldSize) * 100;
        const diaPct = Math.max(((loc.Radius || 0) / worldSize) * 200, 0.6);
        const isSel = i === selectedIndex;
        return (
          <div
            key={`circle-${i}`}
            style={{ left: `${cxPct}%`, top: `${cyPct}%`, width: `${diaPct}%`, height: `${diaPct}%` }}
            className={cx(
              'absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 pointer-events-none',
              isSel ? 'border-primary-500 bg-primary-500/15' : 'border-gray-400/70 bg-gray-400/10'
            )}
          />
        );
      })}

      {/* Interactive handles (HTML overlay so pointer events work reliably) */}
      {locations.map((loc, i) => {
        const cxPct = (loc.x / worldSize) * 100;
        const cyPct = (1 - loc.z / worldSize) * 100;
        const rPct = ((loc.Radius || 0) / worldSize) * 100;
        const isSel = i === selectedIndex;
        return (
          <React.Fragment key={i}>
            {/* Center handle */}
            <div
              onPointerDown={startDrag('center', i)}
              title={loc.Name || `Drop ${i + 1}`}
              style={{ left: `${cxPct}%`, top: `${cyPct}%` }}
              className={cx(
                'absolute z-20 -translate-x-1/2 -translate-y-1/2 cursor-move rounded-full border-2 border-white shadow-md',
                isSel ? 'h-3.5 w-3.5 bg-primary-600' : 'h-3 w-3 bg-gray-500'
              )}
            />
            {/* Radius handle (right edge of the circle), only when selected */}
            {isSel && (
              <div
                onPointerDown={startDrag('radius', i)}
                title="Drag to resize radius"
                style={{ left: `${cxPct + rPct}%`, top: `${cyPct}%` }}
                className="absolute z-20 -translate-x-1/2 -translate-y-1/2 h-3 w-3 cursor-ew-resize rounded-sm border-2 border-white bg-primary-400 shadow-md"
              />
            )}
            {isSel && (
              <div
                style={{ left: `${cxPct}%`, top: `${cyPct}%` }}
                className="absolute z-10 -translate-x-1/2 translate-y-3 whitespace-nowrap rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white pointer-events-none"
              >
                {loc.Name || `Drop ${i + 1}`}
              </div>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
};
