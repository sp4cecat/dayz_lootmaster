import { useState } from 'react';
import { Modal } from './base/modal/modal';
import { Button } from './base/button/button';
import { Input } from './base/input/input';
import { Slider } from './base/slider/slider';
import { Badge } from './base/badges/badges';
import { MapZoomControls } from './MapZoomControls';
import { Boxes, Crosshair, Zap, AlertCircle, User } from 'lucide-react';
import { cx } from '@/utils/cx';
import { useMapMetadata } from '../hooks/useMapMetadata';
import { useMapPanZoom } from '@/hooks/useMapPanZoom';
import { useItemScan } from '../hooks/useItemScan';
import type { DamageState, ItemInfo } from '../types/items';

interface ItemScanModalProps {
  onClose: () => void;
  missionName?: string;
  selectedProfileId?: string;
  isPanel?: boolean;
}

const DAMAGE_COLOR: Record<DamageState, 'success' | 'sky' | 'warning' | 'orange' | 'error' | 'gray'> = {
  pristine: 'success',
  worn: 'sky',
  damaged: 'warning',
  badly_damaged: 'orange',
  ruined: 'error',
  unknown: 'gray',
};

function damageColor(state?: DamageState) {
  return (state && DAMAGE_COLOR[state]) || 'gray';
}

/**
 * On-demand live world-item scanner. Enqueues a scanItems sweep for the companion
 * mod (region-scoped, radius <= 200 m) and plots the returned items on the map.
 * Click the map — or type coordinates — to set the scan centre, or scan around an
 * online player by id/name. Built as a side panel (isPanel) like the Heat Map tool.
 */
export default function ItemScanModal({ onClose, missionName, isPanel = false }: ItemScanModalProps) {
  const map = useMapMetadata(missionName);
  const { loading, error, result, scanRegion, scanNearPlayer } = useItemScan();

  const [center, setCenter] = useState<{ x: number; z: number }>({
    x: Math.round(map.worldSize / 2),
    z: Math.round(map.worldSize / 2),
  });
  const [radius, setRadius] = useState(30);
  const [playerId, setPlayerId] = useState('');
  const [selected, setSelected] = useState<number | null>(null);

  // Pan/zoom shared with the Airdrop, Zones and Heat Map tools. Clicking without dragging
  // sets the scan centre; dragging pans. Keyboard zoom is on because the map is this modal's
  // primary content and only one instance is ever mounted.
  const view = useMapPanZoom({
    worldSize: map.worldSize,
    keyboardZoom: true,
    onBackgroundClick: (hit) => setCenter({ x: Math.round(hit.x), z: Math.round(hit.z) }),
  });

  const centerPt = view.project(center.x, center.z);
  const radiusPx = view.projectLen(radius);

  const items: ItemInfo[] = result?.items ?? [];
  const showImage = !!map.imagePath && !view.imageFailed;

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title={`${map.displayName} Item Scanner`}
      description="Live region scan of spawned world items via the companion mod."
      icon={Boxes}
      inline={isPanel}
      className={cx(!isPanel && 'h-[90vh] max-w-none w-[90vw]')}
    >
      <div className="flex flex-col h-full gap-4">
        {/* Toolbar */}
        <div className="flex flex-wrap items-end gap-4 bg-gray-50 dark:bg-gray-900/50 p-4 rounded-xl border border-gray-200 dark:border-gray-800 shrink-0">
          <div className="w-28">
            <Input
              label="Center X"
              type="number"
              value={String(center.x)}
              onChange={e => setCenter(c => ({ ...c, x: Number(e.target.value) || 0 }))}
            />
          </div>
          <div className="w-28">
            <Input
              label="Center Z"
              type="number"
              value={String(center.z)}
              onChange={e => setCenter(c => ({ ...c, z: Number(e.target.value) || 0 }))}
            />
          </div>
          <div className="w-40">
            <Slider
              label="Radius"
              minValue={5}
              maxValue={200}
              value={radius}
              onChange={val => setRadius(val as number)}
              labelPosition="default"
              suffix="m"
            />
          </div>
          <div className="flex items-end h-10">
            <Button
              variant="primary"
              icon={Zap}
              disabled={loading}
              onClick={() => { setSelected(null); scanRegion(center.x, center.z, radius); }}
            >
              {loading ? 'Scanning…' : 'Scan region'}
            </Button>
          </div>

          <div className="flex items-end gap-2">
            <div className="w-44">
              <Input
                label="Player (id / name)"
                value={playerId}
                onChange={e => setPlayerId(e.target.value)}
                placeholder="online player"
              />
            </div>
            <div className="flex items-end h-10">
              <Button
                variant="secondary-gray"
                icon={User}
                disabled={loading || !playerId.trim()}
                onClick={() => { setSelected(null); scanNearPlayer(playerId.trim(), radius); }}
              >
                Near player
              </Button>
            </div>
          </div>

          {result && (
            <div className="ml-auto text-xs font-medium text-gray-500 bg-white dark:bg-gray-900 px-2 py-1 rounded border border-gray-200 dark:border-gray-800">
              Found: {result.count}
            </div>
          )}
        </div>

        {error && (
          <div className="flex items-center gap-2 p-3 bg-error-600 text-white rounded-lg shrink-0">
            <AlertCircle size={18} />
            {error}
          </div>
        )}

        {/* Map + results */}
        <div className="flex-1 flex gap-4 min-h-0">
          {/* Map */}
          <div
            ref={view.viewportRef}
            {...view.viewportHandlers}
            className={cx(
              'relative flex-1 min-w-0 bg-black rounded-xl overflow-hidden border border-gray-200 dark:border-gray-800 select-none touch-none',
              view.isPanning ? 'cursor-grabbing' : 'cursor-crosshair',
            )}
          >
            {/* Content layer: the image only, carrying the pan/zoom. Stretched to the square
                rather than object-contain — the overlay maths assume the image spans exactly
                0..worldSize, and letterboxing inside this non-square box put every marker out. */}
            {showImage ? (
              <div style={view.contentStyle}>
                <img
                  src={map.imagePath}
                  alt={`${map.displayName} map`}
                  {...view.imageProps}
                  className="w-full h-full block pointer-events-none"
                />
              </div>
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-xs text-gray-400 pointer-events-none">
                No map preview for "{map.displayName}"
              </div>
            )}

            {/* Overlay layer: untransformed, so markers keep a constant on-screen size while
                the scan circle, which is world-sized, scales with the map. */}
            {view.size > 0 && (
              <div className="absolute inset-0 pointer-events-none">
                {/* Scan area */}
                <div
                  className="absolute rounded-full border-2 border-primary-400/80 bg-primary-400/10 -translate-x-1/2 -translate-y-1/2"
                  style={{
                    left: centerPt.px,
                    top: centerPt.py,
                    width: Math.max(radiusPx * 2, 4),
                    height: Math.max(radiusPx * 2, 4),
                  }}
                />
                <Crosshair
                  size={16}
                  className="absolute text-primary-400 -translate-x-1/2 -translate-y-1/2"
                  style={{ left: centerPt.px, top: centerPt.py }}
                />

                {/* Item markers */}
                {items.map((it, i) => {
                  const p = view.project(it.pos[0], it.pos[2]);
                  return (
                    <button
                      key={i}
                      type="button"
                      title={`${it.displayName || it.cls} (${it.damageState || 'unknown'})`}
                      // Stop the press here, or it also arms the viewport's background
                      // gesture and moves the scan centre when you release.
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => { e.stopPropagation(); setSelected(i); }}
                      className={cx(
                        'absolute w-2.5 h-2.5 rounded-full border border-white/70 -translate-x-1/2 -translate-y-1/2 hover:scale-150 transition-transform pointer-events-auto',
                        selected === i && 'ring-2 ring-white scale-150',
                      )}
                      style={{
                        left: p.px,
                        top: p.py,
                        backgroundColor: markerColor(it.damageState),
                      }}
                    />
                  );
                })}
              </div>
            )}

            {view.canZoom && <MapZoomControls map={view} />}
          </div>

          {/* Results list */}
          <div className="w-80 shrink-0 overflow-y-auto rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-900/40">
            {items.length === 0 ? (
              <p className="p-4 text-xs text-gray-400">
                {result ? 'No items found in this region.' : 'Run a scan to list spawned items here.'}
              </p>
            ) : (
              <ul className="divide-y divide-gray-200 dark:divide-gray-800">
                {items.map((it, i) => (
                  <li
                    key={i}
                    onClick={() => setSelected(i)}
                    className={cx(
                      'px-3 py-2 cursor-pointer hover:bg-white/60 dark:hover:bg-gray-950/40',
                      selected === i && 'bg-white dark:bg-gray-950/60',
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-gray-900 dark:text-white truncate">
                        {it.displayName || it.cls}
                      </span>
                      <Badge size="sm" color={damageColor(it.damageState)} type="pill-color">
                        {(it.damageState || 'unknown').replace('_', ' ')}
                      </Badge>
                    </div>
                    <p className="text-[11px] font-mono text-gray-400 truncate">{it.cls}</p>
                    <p className="text-[11px] text-gray-500">
                      {Math.round(it.pos[0])}, {Math.round(it.pos[2])}
                      {typeof it.lifetimeMax === 'number' && it.lifetimeMax > 0 && (
                        <span> · CE lifetime {Math.round(it.lifetimeMax / 60)} min</span>
                      )}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}

// Raw CSS color for map dots (Badge palette isn't reachable inline).
function markerColor(state?: DamageState): string {
  switch (state) {
    case 'pristine': return '#22c55e';
    case 'worn': return '#0ea5e9';
    case 'damaged': return '#eab308';
    case 'badly_damaged': return '#f97316';
    case 'ruined': return '#ef4444';
    default: return '#9ca3af';
  }
}
