import React from 'react';
import { ZoomIn, ZoomOut, RefreshCcw01 } from '@untitledui/icons';
import { cx } from '@/utils/cx';
import type { MapPanZoom } from '@/hooks/useMapPanZoom';

interface MapZoomControlsProps {
  map: MapPanZoom;
  /** Override the default top-right placement. */
  className?: string;
}

const BTN = 'flex h-7 w-7 items-center justify-center rounded-md bg-gray-900/70 text-white '
  + 'backdrop-blur-sm transition-colors hover:bg-gray-900/90 disabled:opacity-40 '
  + 'disabled:hover:bg-gray-900/70';

/**
 * The zoom button cluster shared by every map tool, so the controls sit in the same place
 * and read the same way in the Airdrop, Zones, Heat Map and Item Scan views.
 *
 * Render it as a child of the map viewport; the caller decides whether to show it at all
 * (see `MapPanZoom.canZoom`).
 */
export const MapZoomControls: React.FC<MapZoomControlsProps> = ({ map, className }) => (
  // stopPropagation on pointerdown, or pressing a button also arms the viewport's background
  // gesture and, in the editors, teleports the selected marker on release.
  <div
    onPointerDown={(e) => e.stopPropagation()}
    className={cx('absolute top-2 right-2 z-30 flex flex-col items-center gap-1', className)}
  >
    <button
      type="button" title="Zoom in" disabled={map.atMax}
      onClick={() => map.zoomByStep(1)} className={BTN}
    >
      <ZoomIn size={14} />
    </button>
    <button
      type="button" title="Zoom out" disabled={map.atMin}
      onClick={() => map.zoomByStep(-1)} className={BTN}
    >
      <ZoomOut size={14} />
    </button>
    <button
      type="button" title="Reset to fit" disabled={map.atMin}
      onClick={map.resetZoom} className={BTN}
    >
      <RefreshCcw01 size={14} />
    </button>
    {/* Percent of native resolution, so 100% means one image pixel per CSS pixel. */}
    <span
      title="Zoom, as a percentage of the map image's native resolution"
      className="rounded bg-gray-900/70 px-1 py-0.5 text-[10px] font-mono text-white backdrop-blur-sm"
    >
      {Math.round((map.transform.scale / map.maxScale) * 100)}%
    </span>
  </div>
);
