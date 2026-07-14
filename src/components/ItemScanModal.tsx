import React, { useMemo, useRef, useState } from 'react';
import { Modal } from './base/modal/modal';
import { Button } from './base/button/button';
import { Input } from './base/input/input';
import { Slider } from './base/slider/slider';
import { Badge } from './base/badges/badges';
import { Boxes, Crosshair, Zap, AlertCircle, User } from 'lucide-react';
import { cx } from '@/utils/cx';
import { useMapMetadata } from '../hooks/useMapMetadata';
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

  const mapRef = useRef<HTMLDivElement>(null);

  // World -> percentage of the square map (Z axis inverted vs screen Y, matching the Heat Map / Airdrop tools).
  const toPct = (x: number, z: number) => ({
    left: (x / map.worldSize) * 100,
    top: (1 - z / map.worldSize) * 100,
  });

  const handleMapClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = mapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const relX = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const relY = Math.max(0, Math.min(e.clientY - rect.top, rect.height));
    setCenter({
      x: Math.round((relX / rect.width) * map.worldSize),
      z: Math.round((1 - relY / rect.height) * map.worldSize),
    });
  };

  const centerPct = useMemo(() => toPct(center.x, center.z), [center, map.worldSize]);
  const radiusPct = (radius / map.worldSize) * 100; // radius as % of half-extent width

  const items: ItemInfo[] = result?.items ?? [];

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
          <div className="relative flex-1 min-w-0 bg-black rounded-xl overflow-hidden border border-gray-200 dark:border-gray-800">
            <div
              ref={mapRef}
              className="relative w-full h-full cursor-crosshair select-none"
              onClick={handleMapClick}
            >
              {map.imagePath && (
                <img src={map.imagePath} alt={`${map.displayName} map`} className="w-full h-full object-contain pointer-events-none" />
              )}

              {/* Scan area */}
              <div
                className="absolute rounded-full border-2 border-primary-400/80 bg-primary-400/10 pointer-events-none"
                style={{
                  left: `${centerPct.left}%`,
                  top: `${centerPct.top}%`,
                  width: `${radiusPct * 2}%`,
                  paddingBottom: `${radiusPct * 2}%`,
                  transform: 'translate(-50%, -50%)',
                }}
              />
              <Crosshair
                size={16}
                className="absolute text-primary-400 pointer-events-none"
                style={{ left: `${centerPct.left}%`, top: `${centerPct.top}%`, transform: 'translate(-50%, -50%)' }}
              />

              {/* Item markers */}
              {items.map((it, i) => {
                const p = toPct(it.pos[0], it.pos[2]);
                return (
                  <button
                    key={i}
                    type="button"
                    title={`${it.displayName || it.cls} (${it.damageState || 'unknown'})`}
                    onClick={(e) => { e.stopPropagation(); setSelected(i); }}
                    className={cx(
                      'absolute w-2.5 h-2.5 rounded-full border border-white/70 -translate-x-1/2 -translate-y-1/2 hover:scale-150 transition-transform',
                      selected === i && 'ring-2 ring-white scale-150',
                    )}
                    style={{
                      left: `${p.left}%`,
                      top: `${p.top}%`,
                      backgroundColor: markerColor(it.damageState),
                    }}
                  />
                );
              })}
            </div>
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
