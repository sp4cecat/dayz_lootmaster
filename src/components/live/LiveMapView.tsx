import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal } from '../base/modal/modal';
import { Badge } from '../base/badges/badges';
import { Button } from '../base/button/button';
import { MapZoomControls } from '../MapZoomControls';
import { Radio, Users, Car, MapPin, Flag, Settings } from 'lucide-react';
import { cx } from '@/utils/cx';
import { apiFetch } from '@/utils/api';
import { useMapMetadata } from '@/hooks/useMapMetadata';
import { useMapPanZoom } from '@/hooks/useMapPanZoom';
import { useCfToolsStatus } from '@/hooks/useCfToolsStatus';
import { useLiveSnapshot } from '@/hooks/useLiveSnapshot';
import { useCfToolsActions } from '@/hooks/useCfToolsActions';
import type { LiveLayerKey, LivePlayer } from '@/types/cftools';
import LiveSidePanel from './LiveSidePanel';
import PlayerActionsBar from './PlayerActionsBar';
import RawActionPanel, { type RawActionTarget } from './RawActionPanel';
import ConfirmDialog from './ConfirmDialog';
import {
  EventMarker, PlayerMarker, TerritoryMarker, VehicleMarker,
  computeStoredEventIds, type MarkerSelection,
} from './LiveMarkers';

interface LiveMapViewProps {
  onClose: () => void;
  selectedProfileId?: string;
  missionName?: string;
  isPanel?: boolean;
  /** Navigate to the Profiles screen (where CF Tools is configured). */
  onOpenSettings?: () => void;
}

const LAYER_META: { key: LiveLayerKey; label: string; icon: React.ElementType }[] = [
  { key: 'players', label: 'Players', icon: Users },
  { key: 'vehicles', label: 'Vehicles', icon: Car },
  { key: 'events', label: 'Events', icon: MapPin },
  { key: 'territories', label: 'Territories', icon: Flag },
];

const REASON_HINTS: Record<string, string> = {
  not_configured: 'Enter your CF Tools application credentials on the Profiles screen.',
  no_api_id: 'Link this profile to one of your granted servers on the Profiles screen.',
  no_profile: 'Select a server profile first.',
  auth_failed: 'CF Tools rejected the stored credentials — re-enter them on the Profiles screen.',
  no_grant: 'The CF Tools application has no grant for this server.',
  rate_limited: 'CF Tools rate limit hit — data resumes shortly.',
  unreachable: 'CF Tools Cloud is unreachable.',
};

/**
 * Live server map: players, vehicles, world events and territory flags from
 * the CF Tools Cloud Data API (+ GameLabs), plotted on the shared pan/zoom map
 * infrastructure. Read-only marker selection with a detail side panel; admin
 * actions slot in via LiveSidePanel's playerActions (Phase 3).
 */
export default function LiveMapView({
  onClose, selectedProfileId, missionName, isPanel = false, onOpenSettings,
}: LiveMapViewProps) {
  const map = useMapMetadata(missionName);
  const { status } = useCfToolsStatus(selectedProfileId);

  const [enabledLayers, setEnabledLayers] = useState<Set<LiveLayerKey>>(
    () => new Set<LiveLayerKey>(['players', 'vehicles', 'events', 'territories']),
  );
  const layers = useMemo(() => [...enabledLayers], [enabledLayers]);
  const { snapshot, loading } = useLiveSnapshot(selectedProfileId, layers, status.connected);

  const [selection, setSelection] = useState<MarkerSelection | null>(null);

  // Resolve the selected marker into a GameLabs action target. No selection →
  // world-context actions; player/vehicle/event selections narrow the raw
  // action panel to their context. referenceKeys verified against the GameLabs
  // mod source: player = steam64, vehicle/object = the entity id string the
  // entities endpoints already return.
  const rawTarget = useMemo((): RawActionTarget => {
    const world: RawActionTarget = { context: 'world', referenceKey: null, label: null };
    if (!selection || !snapshot) return world;
    if (selection.kind === 'player') {
      const pl = snapshot.players?.items.find(p => (p.sessionId || p.steamId || p.name) === selection.id);
      return pl?.steamId ? { context: 'player', referenceKey: pl.steamId, label: pl.name } : world;
    }
    if (selection.kind === 'vehicle') {
      const v = snapshot.vehicles?.items.find((x, i) => (x.id || String(i)) === selection.id);
      return v?.id ? { context: 'vehicle', referenceKey: v.id, label: v.displayName || v.className || 'Vehicle' } : world;
    }
    const list = selection.kind === 'territory' ? snapshot.territories?.items : snapshot.events?.items;
    const e = list?.find((x, i) => (x.id || String(i)) === selection.id);
    return e?.id ? { context: 'object', referenceKey: e.id, label: e.displayName || e.className || e.type } : world;
  }, [selection, snapshot]);

  // Items co-located with a tracked container/vehicle/player are stored — silver.
  const storedEventIds = useMemo(
    () => computeStoredEventIds(
      snapshot?.events?.items ?? [],
      snapshot?.vehicles?.items ?? [],
      snapshot?.players?.items ?? [],
    ),
    [snapshot],
  );

  // Admin actions (Phase 3). Teleport is a two-step map gesture: pick the
  // player, click a destination, confirm with the exact coordinates.
  const actions = useCfToolsActions(selectedProfileId);
  const [teleportTarget, setTeleportTarget] = useState<LivePlayer | null>(null);
  const [teleportDest, setTeleportDest] = useState<{ x: number; z: number } | null>(null);

  // Territory circle radius from Expansion's TerritorySize (fallback 60 m).
  const [territoryRadius, setTerritoryRadius] = useState(60);
  useEffect(() => {
    if (!selectedProfileId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch('/api/expansion/territory-settings', { profileId: selectedProfileId });
        const body = res.ok ? await res.json() : null;
        if (!cancelled && body && Number.isFinite(Number(body.TerritorySize)) && Number(body.TerritorySize) > 0) {
          setTerritoryRadius(Number(body.TerritorySize));
        }
      } catch { /* keep default */ }
    })();
    return () => { cancelled = true; };
  }, [selectedProfileId]);

  // onBackgroundClick is captured by the pan/zoom hook; read the live value via a ref.
  const teleportTargetRef = useRef<LivePlayer | null>(null);
  teleportTargetRef.current = teleportTarget;

  const view = useMapPanZoom({
    worldSize: map.worldSize,
    keyboardZoom: true,
    onBackgroundClick: (hit) => {
      // In teleport mode a background click picks the destination; otherwise it
      // clears the selection.
      setTeleportDest((dest) => {
        if (!teleportTargetRef.current || dest) return dest;
        return { x: Math.round(hit.x), z: Math.round(hit.z) };
      });
      if (!teleportTargetRef.current) setSelection(null);
    },
  });

  const toggleLayer = (key: LiveLayerKey) => {
    setEnabledLayers(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const showImage = !!map.imagePath && !view.imageFailed;
  const isSel = (kind: MarkerSelection['kind'], id: string) =>
    selection?.kind === kind && selection.id === id;

  const playerCount = snapshot?.players?.items.length;

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title={`${map.displayName} Live Map`}
      description="Live players, vehicles and events via CF Tools Cloud + GameLabs."
      icon={Radio}
      inline={isPanel}
      className={cx(!isPanel && 'h-[90vh] max-w-none w-[90vw]')}
    >
      <div className="flex flex-col h-full gap-4">
        {/* Toolbar: connection badge + layer toggles */}
        <div className="flex flex-wrap items-center gap-3 bg-gray-50 dark:bg-gray-900/50 p-3 rounded-xl border border-gray-200 dark:border-gray-800 shrink-0">
          {status.connected ? (
            <Badge color="success" size="sm">
              Connected{status.nickname ? ` — ${status.nickname}` : ''}
            </Badge>
          ) : (
            <Badge color="gray" size="sm">Not connected</Badge>
          )}
          {typeof playerCount === 'number' && (
            <Badge color="brand" size="sm">{playerCount} online</Badge>
          )}

          <div className="flex items-center gap-1 ml-auto">
            {LAYER_META.map(({ key, label, icon: Icon }) => {
              const on = enabledLayers.has(key);
              const layer = snapshot?.[key];
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => toggleLayer(key)}
                  title={layer?.error ? `${label}: unavailable (${layer.error})` : label}
                  className={cx(
                    'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors',
                    on
                      ? 'bg-primary-50 text-primary-700 border-primary-200 dark:bg-primary-900/20 dark:text-primary-300 dark:border-primary-800'
                      : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50 dark:bg-gray-900 dark:text-gray-400 dark:border-gray-700',
                    layer?.error && on && 'opacity-60',
                  )}
                >
                  <Icon size={13} />
                  {label}
                  {on && layer && !layer.error && (
                    <span className="text-[10px] text-gray-400">({layer.items.length})</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Not-connected empty state */}
        {!status.connected ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-gray-300 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-900/30">
            <Radio size={40} className="text-gray-300 dark:text-gray-600" />
            <div className="text-center max-w-sm">
              <h3 className="text-base font-bold text-gray-900 dark:text-white mb-1">CF Tools not connected</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {REASON_HINTS[status.reason || ''] || 'Configure CF Tools Cloud to see live server data.'}
              </p>
            </div>
            {onOpenSettings && (status.reason === 'not_configured' || status.reason === 'no_api_id' || status.reason === 'auth_failed') && (
              <Button size="sm" variant="secondary-color" icon={Settings} onClick={onOpenSettings}>
                Open settings
              </Button>
            )}
          </div>
        ) : (
          <div className="flex-1 flex gap-4 min-h-0">
            {/* Map */}
            <div
              ref={view.viewportRef}
              {...view.viewportHandlers}
              className={cx(
                'relative flex-1 min-w-0 bg-black rounded-xl overflow-hidden border border-gray-200 dark:border-gray-800 select-none touch-none',
                view.isPanning ? 'cursor-grabbing' : teleportTarget ? 'cursor-crosshair' : 'cursor-grab',
              )}
            >
              {/* Teleport mode banner */}
              {teleportTarget && !teleportDest && (
                <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-primary-600 text-white text-xs font-medium shadow-lg pointer-events-auto">
                  Click the map to teleport {teleportTarget.name}
                  <button
                    type="button"
                    className="underline decoration-white/50 hover:decoration-white"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => { e.stopPropagation(); setTeleportTarget(null); }}
                  >
                    cancel
                  </button>
                </div>
              )}
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

              {/* Overlay: untransformed; markers keep constant on-screen size. */}
              {view.size > 0 && snapshot && (
                <div className="absolute inset-0 pointer-events-none">
                  {enabledLayers.has('territories') && snapshot.territories?.items.map((t, i) => {
                    const id = t.id || String(i);
                    const p = view.project(t.position[0], t.position[2]);
                    return (
                      <TerritoryMarker
                        key={`t-${id}`}
                        territory={t}
                        px={p.px}
                        py={p.py}
                        radiusPx={view.projectLen(territoryRadius)}
                        selected={isSel('territory', id)}
                        dimmed={snapshot.territories?.stale}
                        onSelect={() => setSelection({ kind: 'territory', id })}
                      />
                    );
                  })}

                  {enabledLayers.has('events') && snapshot.events?.items.map((e, i) => {
                    const id = e.id || String(i);
                    const p = view.project(e.position[0], e.position[2]);
                    return (
                      <EventMarker
                        key={`e-${id}`}
                        event={e}
                        px={p.px}
                        py={p.py}
                        selected={isSel('event', id)}
                        dimmed={snapshot.events?.stale}
                        stored={storedEventIds.has(id)}
                        onSelect={() => setSelection({ kind: 'event', id })}
                      />
                    );
                  })}

                  {enabledLayers.has('vehicles') && snapshot.vehicles?.items.map((v, i) => {
                    const id = v.id || String(i);
                    const p = view.project(v.position[0], v.position[2]);
                    return (
                      <VehicleMarker
                        key={`v-${id}`}
                        vehicle={v}
                        px={p.px}
                        py={p.py}
                        selected={isSel('vehicle', id)}
                        dimmed={snapshot.vehicles?.stale}
                        onSelect={() => setSelection({ kind: 'vehicle', id })}
                      />
                    );
                  })}

                  {enabledLayers.has('players') && snapshot.players?.items.map((pl) => {
                    if (!pl.position) return null;
                    const id = pl.sessionId || pl.steamId || pl.name;
                    const p = view.project(pl.position[0], pl.position[2]);
                    return (
                      <PlayerMarker
                        key={`p-${id}`}
                        player={pl}
                        px={p.px}
                        py={p.py}
                        selected={isSel('player', id)}
                        dimmed={snapshot.players?.stale}
                        onSelect={() => setSelection({ kind: 'player', id })}
                      />
                    );
                  })}
                </div>
              )}

              {loading && !snapshot && (
                <div className="absolute inset-0 flex items-center justify-center text-xs text-gray-300 bg-black/30 pointer-events-none">
                  Loading live data…
                </div>
              )}

              {view.canZoom && <MapZoomControls map={view} />}
            </div>

            <LiveSidePanel
              snapshot={snapshot}
              status={status}
              selection={selection}
              onClearSelection={() => setSelection(null)}
              playerActions={(player) => (
                <PlayerActionsBar
                  player={player}
                  actions={actions}
                  selectedProfileId={selectedProfileId}
                  gameLabs={!!status.capabilities?.gameLabs}
                  onStartTeleport={(p) => { setTeleportTarget(p); setTeleportDest(null); }}
                />
              )}
              footer={
                status.capabilities?.gameLabs
                  ? <RawActionPanel actions={actions} selectedProfileId={selectedProfileId} target={rawTarget} />
                  : undefined
              }
            />
          </div>
        )}

        {/* Teleport confirmation with the exact destination */}
        <ConfirmDialog
          open={!!(teleportTarget && teleportDest)}
          title="Teleport player"
          message={
            <>Teleport <b>{teleportTarget?.name}</b> to <b>{teleportDest?.x}, {teleportDest?.z}</b>?</>
          }
          confirmLabel="Teleport"
          busy={actions.busy}
          onCancel={() => { setTeleportDest(null); setTeleportTarget(null); }}
          onConfirm={async () => {
            if (teleportTarget?.steamId && teleportDest) {
              await actions.teleport(teleportTarget.steamId, teleportDest.x, teleportDest.z);
            }
            setTeleportDest(null);
            setTeleportTarget(null);
          }}
        />
      </div>
    </Modal>
  );
}
