import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal } from '../base/modal/modal';
import { Badge } from '../base/badges/badges';
import { Button } from '../base/button/button';
import { MapZoomControls } from '../MapZoomControls';
import MapImageLayer from '../map/MapImageLayer';
import {
  Radio, Users, Car, MapPin, Flag, Bot, Settings, Clock, Thermometer,
  Copy, FileCode, Ruler, LocateFixed, Eye, Trash2, X,
  Navigation, PackagePlus, Plane, Skull,
} from 'lucide-react';
import { cx } from '@/utils/cx';
import { apiFetch } from '@/utils/api';
import {
  compassPoint, distanceBearing, formatDistance, formatPosXml, formatWorldPos,
  type WorldPoint,
} from '@/utils/mapGeo';
import { centreOnContent } from '@/utils/mapTransform';
import { useMapMetadata } from '@/hooks/useMapMetadata';
import { useMapPanZoom, type MapPanZoom } from '@/hooks/useMapPanZoom';
import { useCfToolsStatus } from '@/hooks/useCfToolsStatus';
import { useLiveSnapshot } from '@/hooks/useLiveSnapshot';
import { useCfToolsActions } from '@/hooks/useCfToolsActions';
import type { LiveLayerKey, LivePlayer, LiveWorldInfo } from '@/types/cftools';
import LiveSidePanel from './LiveSidePanel';
import PlayerActionsBar from './PlayerActionsBar';
import RawActionPanel, { type RawActionTarget } from './RawActionPanel';
import ConfirmDialog from './ConfirmDialog';
import MapContextMenu, { type MapMenuItem } from './MapContextMenu';
import MapSpawnPicker, { type SpawnPickerOption } from './MapSpawnPicker';
import { buildSpawnTree, countSpawnTree, flattenSpawnTree } from '@/utils/loadoutSpawn';
import { resolveLoadoutNode } from '@/utils/loadouts';
import type { Loadout } from '@/types/loadouts';
import {
  AiMarker, EventMarker, PlayerMarker, TerritoryMarker, VehicleMarker, territoryAtPoint,
  type MarkerSelection,
} from './LiveMarkers';

interface LiveMapViewProps {
  onClose: () => void;
  selectedProfileId?: string;
  missionName?: string;
  isPanel?: boolean;
  /** Navigate to the Profiles screen (where CF Tools is configured). */
  onOpenSettings?: () => void;
  /**
   * For the "spawn a loadout here" action. Passed down rather than refetched:
   * App already holds these (useLootData), and a second fetch could disagree
   * with what the Loadout Designer is showing.
   */
  loadouts?: Loadout[];
}

const LAYER_META: { key: LiveLayerKey; label: string; icon: React.ElementType }[] = [
  { key: 'players', label: 'Players', icon: Users },
  { key: 'ai', label: 'AI', icon: Bot },
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
  // Mod-sourced layers — these describe the companion mod, not CF Tools.
  mod_offline: 'The spacecat_dayz_server_api mod is not reporting — check it is loaded and its baseUrl points here.',
  mod_no_ai: 'The mod is connected but sent no AI list — set "ai": true in $profile:spacecat/spacecat_api.json.',
};

/** A ruler laid on the map. `to` is null between arming the tool and the second click. */
interface Measurement {
  from: WorldPoint;
  to: WorldPoint | null;
}

/** A user-dropped marker. Session-scoped — deliberately not persisted anywhere. */
interface Pin extends WorldPoint {
  id: number;
}

interface ContextMenuState {
  /** Anchor in viewport px, i.e. relative to the map box. Never overlay space. */
  x: number;
  y: number;
  /** Where the cursor was, in world metres. */
  at: WorldPoint;
  /** The marker under the cursor, if any. */
  target: MarkerSelection | null;
}

/** What a right-clicked marker resolves to. Position is absent for a loading-in player. */
interface MarkerInfo {
  label: string;
  position: WorldPoint | null;
  steamId?: string | null;
  /** Only entities that move are worth following. */
  followable: boolean;
}

const KIND_LABELS: Record<MarkerSelection['kind'], string> = {
  player: 'Player', vehicle: 'Vehicle', ai: 'AI', event: 'Event', territory: 'Territory',
};

/**
 * A server-side action armed by the right-click menu, holding the world point it
 * will fire at. Kept as one nullable slot rather than a flag per action so two
 * dialogs can never be open at once — they all fire against the live server.
 */
type PendingAction =
  | { kind: 'teleport'; at: WorldPoint; steam64: string; name: string }
  | { kind: 'teleport-all'; at: WorldPoint; players: { steam64: string; name: string }[] }
  | { kind: 'spawn-ai'; at: WorldPoint }
  | { kind: 'airdrop'; at: WorldPoint }
  | { kind: 'loadout'; at: WorldPoint };

/** What the AI spawn form collects. Faction/loadout only apply to eAI patrols. */
interface AiSpawnForm {
  kind: 'infected' | 'eai';
  count: number;
  faction: string;
}

/** One Airdrop_*.json as the missions endpoint returns it. */
interface AirdropMissionFile {
  file: string;
  data: { MissionName?: string; Container?: string; Enabled?: number } | null;
  error?: string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * The in-game calendar date, e.g. "14 Aug".
 *
 * Formatted by hand rather than through Date/Intl on purpose: this is a world date,
 * not an instant. Feeding it to Date would apply the VIEWER's timezone to a server's
 * fictional calendar and could shift the day across a boundary — and the in-game year
 * is whatever the mission sets, which is not guaranteed to be a year Date can hold.
 */
function formatWorldDate(date: NonNullable<LiveWorldInfo['date']>): string {
  const month = MONTHS[date.month - 1];
  return month ? `${date.day} ${month}` : `${date.day}/${date.month}`;
}

const formatWorldTime = (time: NonNullable<LiveWorldInfo['time']>) =>
  `${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}`;

/**
 * Ambient temperature to the nearest whole degree.
 *
 * `|| 0` is not redundancy: Math.round(-0.4) is -0, which renders as "-0°C".
 */
const formatWorldTemp = (celsius: number) => `${Math.round(celsius) || 0}°C`;

const MEASURE_SHADOW = '[filter:drop-shadow(0_1px_1.5px_rgba(0,0,0,0.85))]';

const MeasureEnd = ({ px, py }: { px: number; py: number }) => (
  <span
    className={cx('absolute -translate-x-1/2 -translate-y-1/2 block size-2 rounded-full border border-amber-100 bg-amber-300/70', MEASURE_SHADOW)}
    style={{ left: px, top: py }}
  />
);

/**
 * The ruler: two endpoints, a dashed line and a distance/bearing readout.
 *
 * Lives on the marker overlay, so `project()` (pan-free, zoom-aware) is the right transform
 * for the endpoints. The `<svg>` is `inset-0` with `overflow-visible` so a line running off
 * the map square isn't clipped at the overlay's edge.
 */
function MeasureLayer({ measure, view }: { measure: Measurement; view: MapPanZoom }) {
  const a = view.project(measure.from.x, measure.from.z);
  const b = measure.to ? view.project(measure.to.x, measure.to.z) : null;
  const stats = measure.to ? distanceBearing(measure.from, measure.to) : null;

  return (
    <>
      {b && (
        <svg className="absolute inset-0 overflow-visible" aria-hidden="true">
          <line
            x1={a.px} y1={a.py} x2={b.px} y2={b.py}
            className="stroke-amber-300" strokeWidth={1.5} strokeDasharray="5 4"
          />
        </svg>
      )}
      <MeasureEnd px={a.px} py={a.py} />
      {b && <MeasureEnd px={b.px} py={b.py} />}
      {b && stats && (
        <span
          data-testid="measure-readout"
          className="absolute -translate-x-1/2 -translate-y-1/2 px-1.5 py-0.5 rounded bg-black/80 text-[10px] font-medium text-amber-100 whitespace-nowrap shadow-lg"
          style={{ left: (a.px + b.px) / 2, top: (a.py + b.py) / 2 }}
        >
          {formatDistance(stats.metres)} · {Math.round(stats.bearingDeg)}° {compassPoint(stats.bearingDeg)}
        </span>
      )}
    </>
  );
}

/**
 * Live server map: players, vehicles, world events and territory flags from
 * the CF Tools Cloud Data API (+ GameLabs), plotted on the shared pan/zoom map
 * infrastructure. Read-only marker selection with a detail side panel; admin
 * actions slot in via LiveSidePanel's playerActions (Phase 3).
 */
export default function LiveMapView({
  onClose, selectedProfileId, missionName, isPanel = false, onOpenSettings, loadouts,
}: LiveMapViewProps) {
  const map = useMapMetadata(missionName);
  const { status } = useCfToolsStatus(selectedProfileId);

  const [enabledLayers, setEnabledLayers] = useState<Set<LiveLayerKey>>(
    () => new Set<LiveLayerKey>(['players', 'ai', 'vehicles', 'events', 'territories']),
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
    const world: RawActionTarget = { context: 'world', referenceKey: null, label: null, className: null };
    if (!selection || !snapshot) return world;
    if (selection.kind === 'player') {
      const pl = snapshot.players?.items.find(p => (p.sessionId || p.steamId || p.name) === selection.id);
      return pl?.steamId ? { context: 'player', referenceKey: pl.steamId, label: pl.name, className: null } : world;
    }
    if (selection.kind === 'vehicle') {
      const v = snapshot.vehicles?.items.find((x, i) => (x.id || String(i)) === selection.id);
      return v?.id
        ? { context: 'vehicle', referenceKey: v.id, label: v.displayName || v.className || 'Vehicle', className: v.className }
        : world;
    }
    // AI have no steam64 and no GameLabs entity reference, so no contextual action can
    // target one. Explicit rather than relying on the lookup below failing to find the
    // id and falling through to `world` by accident.
    if (selection.kind === 'ai') return world;
    const list = selection.kind === 'territory' ? snapshot.territories?.items : snapshot.events?.items;
    const e = list?.find((x, i) => (x.id || String(i)) === selection.id);
    return e?.id
      ? { context: 'object', referenceKey: e.id, label: e.displayName || e.className || e.type, className: e.className }
      : world;
  }, [selection, snapshot]);

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

  // Right-click extras. All client-side: nothing here touches the live server.
  // `measure` is armed from the context menu and completed by the next left-click;
  // `pins` and `following` are session-scoped view state.
  const [measure, setMeasure] = useState<Measurement | null>(null);
  const [pins, setPins] = useState<Pin[]>([]);
  const [following, setFollowing] = useState<MarkerSelection | null>(null);
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Server-side right-click actions. Unlike the extras above, every one of these
  // changes the live server, so each is armed here and only fires after its
  // confirm dialog or picker.
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [aiForm, setAiForm] = useState<AiSpawnForm>({ kind: 'infected', count: 3, faction: '' });
  const [missions, setMissions] = useState<AirdropMissionFile[] | null>(null);
  const [missionsLoading, setMissionsLoading] = useState(false);

  const worldActions = status.capabilities?.worldActions;

  /**
   * Airdrop missions have no shared store — every consumer fetches them. Loaded
   * lazily on first need rather than with the map, since most sessions never open
   * this menu, and cached until the profile changes.
   *
   * The in-flight guard is a ref rather than the `missionsLoading` state, and the
   * effect deliberately does not cancel on close. Both were bugs: with the state in
   * the dependency array, setting it re-ran the effect, and the re-run's cleanup
   * cancelled the request it had itself just started — so `setMissions` never fired
   * and the picker sat on "Loading…" forever. Cancelling on close would have been
   * the same trap one level up, since the ref would already be claimed and reopening
   * would never retry. Only unmount stops us writing state.
   */
  const missionsFetchedFor = useRef<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const airdropPickerOpen = pending?.kind === 'airdrop';

  useEffect(() => {
    if (!airdropPickerOpen || !selectedProfileId) return;
    if (missionsFetchedFor.current === selectedProfileId) return;
    missionsFetchedFor.current = selectedProfileId;
    setMissionsLoading(true);
    (async () => {
      let list: AirdropMissionFile[] | null = null;
      try {
        const res = await apiFetch('/api/expansion/airdrop-missions', { profileId: selectedProfileId });
        const body = res.ok ? await res.json() : null;
        if (Array.isArray(body)) list = body;
      } catch { /* handled below */ }
      // A failed load releases the claim, so closing and reopening the picker
      // retries instead of showing the "none configured" message forever.
      if (!list) missionsFetchedFor.current = null;
      if (!mounted.current) return;
      setMissions(list || []);
      setMissionsLoading(false);
    })();
  }, [airdropPickerOpen, selectedProfileId]);

  // onBackgroundClick is captured by the pan/zoom hook; read live values via refs.
  const teleportTargetRef = useRef<LivePlayer | null>(null);
  teleportTargetRef.current = teleportTarget;
  const measureRef = useRef<Measurement | null>(null);
  measureRef.current = measure;

  const view = useMapPanZoom({
    worldSize: map.worldSize,
    nativeSize: map.tiles?.nativeSize,
    keyboardZoom: true,
    // A manual pan means the admin wants to look somewhere else — stop fighting them for
    // the viewport. setFollowing is stable, so this closure never goes stale.
    onPanStart: () => setFollowing(null),
    onBackgroundClick: (hit) => {
      // In teleport mode a background click picks the destination; otherwise it
      // selects the territory it landed in, or clears the selection.
      setTeleportDest((dest) => {
        if (!teleportTargetRef.current || dest) return dest;
        return { x: Math.round(hit.x), z: Math.round(hit.z) };
      });
      if (teleportTargetRef.current) return;
      // Measuring: this click is the second point. Takes priority over selection so the
      // gesture can't be stolen by a territory circle the ruler happens to end inside.
      const pending = measureRef.current;
      if (pending && !pending.to) {
        setMeasure({ from: pending.from, to: { x: hit.x, z: hit.z } });
        return;
      }
      // A flag glyph is hard to hit when players and vehicles cluster on it, so
      // the circle counts as part of the target. This runs on the background
      // gesture rather than a hit area on the circle itself: markers stop the
      // gesture arming at all, so they keep winning a click they overlap, and a
      // drag that starts inside a circle still pans instead of selecting.
      const items = enabledLayers.has('territories') ? snapshot?.territories?.items : undefined;
      const i = territoryAtPoint(items, territoryRadius, hit.x, hit.z);
      setSelection(i === null || !items
        ? null
        : { kind: 'territory', id: items[i].id || String(i) });
    },
  });

  // One callback per layer rather than one per marker: the markers are memoised, and a
  // closure freshly allocated on every render would defeat that entirely. They take the
  // id as an argument for the same reason.
  const selectTerritory = useCallback((id: string) => setSelection({ kind: 'territory', id }), []);
  const selectEvent = useCallback((id: string) => setSelection({ kind: 'event', id }), []);
  const selectVehicle = useCallback((id: string) => setSelection({ kind: 'vehicle', id }), []);
  const selectAi = useCallback((id: string) => setSelection({ kind: 'ai', id }), []);
  const selectPlayer = useCallback((id: string) => setSelection({ kind: 'player', id }), []);

  const dragTeleport = useCallback((player: LivePlayer, dest: { x: number; z: number }) => {
    // A drop off the map edge clamps to the world bounds.
    const clamp = (v: number) => Math.min(Math.max(v, 0), Math.round(map.worldSize));
    setTeleportTarget(player);
    setTeleportDest({ x: clamp(dest.x), z: clamp(dest.z) });
  }, [map.worldSize]);

  // --- Right-click menu ------------------------------------------------------
  // Every item here is computed from state the app already holds: no CF Tools call, no
  // GameLabs action, nothing that can alter the live server. Server-side actions
  // (teleport-here, spawn-here) are meant to slot in as extra groups in `menuGroups`.

  // `view` is a fresh object every render, so the centring path reads it through a ref
  // rather than closing over it: centring writes a transform, and depending on the
  // transform it just wrote would loop.
  const viewRef = useRef(view);
  viewRef.current = view;

  /** Pin keys. A counter rather than crypto.randomUUID — pins never leave this component. */
  const nextPinId = useRef(1);

  const worldSize = map.worldSize;

  /** Pan (keeping the zoom) so a world position sits at the centre of the viewport. */
  const centreOnWorld = useCallback((x: number, z: number) => {
    const v = viewRef.current;
    if (!v.size) return;
    v.applyTransform(centreOnContent(
      v.transform,
      (x / worldSize) * v.size,
      // Screen Y is inverted relative to world Z.
      (1 - z / worldSize) * v.size,
      v.viewportBox.w,
      v.viewportBox.h,
    ));
  }, [worldSize]);

  /** Resolve a marker selection against the current snapshot. */
  const markerInfo = useCallback((sel: MarkerSelection | null): MarkerInfo | null => {
    if (!sel || !snapshot) return null;
    const at = (p: [number, number, number]): WorldPoint => ({ x: p[0], z: p[2] });
    if (sel.kind === 'player') {
      const pl = snapshot.players?.items.find(p => (p.sessionId || p.steamId || p.name) === sel.id);
      if (!pl) return null;
      return {
        label: pl.name,
        position: pl.position ? at(pl.position) : null,
        steamId: pl.steamId,
        followable: true,
      };
    }
    if (sel.kind === 'vehicle') {
      const v = snapshot.vehicles?.items.find((x, i) => (x.id || String(i)) === sel.id);
      if (!v) return null;
      return {
        label: v.displayName || v.className || 'Vehicle', position: at(v.position), followable: true,
      };
    }
    if (sel.kind === 'ai') {
      const a = snapshot.ai?.items.find((x, i) => (x.id || String(i)) === sel.id);
      return a ? { label: a.name, position: at(a.position), followable: true } : null;
    }
    const list = sel.kind === 'territory' ? snapshot.territories?.items : snapshot.events?.items;
    const e = list?.find((x, i) => (x.id || String(i)) === sel.id);
    if (!e) return null;
    return {
      label: e.displayName || e.className || e.type,
      position: at(e.position),
      // Events and territory flags don't move; following one would just be "centre here".
      followable: false,
    };
  }, [snapshot]);

  const openContextMenu = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    // Suppress the browser menu whether or not we can resolve the point — a half-working
    // right-click that sometimes shows Chrome's menu over the map is worse than neither.
    e.preventDefault();
    const rect = viewRef.current.viewportEl?.getBoundingClientRect();
    const hit = viewRef.current.toWorld(e.clientX, e.clientY);
    if (!rect || !hit) return;
    // Markers don't stop `contextmenu` (only pointerdown/click), so a right-click on one
    // lands here with the marker in the event path — identify it by data attribute.
    const el = (e.target as Element | null)?.closest?.('[data-marker-kind]');
    const kind = el?.getAttribute('data-marker-kind') as MarkerSelection['kind'] | undefined;
    setMenu({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      at: { x: hit.x, z: hit.z },
      target: kind ? { kind, id: el?.getAttribute('data-marker-id') || '' } : null,
    });
  }, []);

  const notify = useCallback((text: string) => {
    setFeedback(text);
    window.setTimeout(() => setFeedback(f => (f === text ? null : f)), 4000);
  }, []);

  const copy = useCallback(async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      notify(`Copied ${what}.`);
    } catch {
      notify('Clipboard unavailable.');
    }
  }, [notify]);

  /**
   * Report a server action's outcome. Batched actions (teleport-all, the flat
   * pile) report per-target, so summarise rather than showing a bare "failed":
   * on a full server the useful answer is *which* targets didn't take.
   */
  const report = useCallback((result: { ok: boolean; error?: string; results?: { ok: boolean }[] }, done: string) => {
    if (result.results?.length) {
      const failed = result.results.filter(r => !r.ok).length;
      notify(failed === 0
        ? `${done} (${result.results.length}).`
        : `${done} — ${result.results.length - failed} of ${result.results.length} succeeded, ${failed} failed.`);
      return;
    }
    notify(result.ok ? `${done}.` : (result.error || 'Action failed.'));
  }, [notify]);

  /** All connected players with a steam64 — the only ones any action can target. */
  const targetablePlayers = useMemo(
    () => (snapshot?.players?.items || [])
      .filter(p => !!p.steamId)
      .map(p => ({ steam64: p.steamId as string, name: p.name })),
    [snapshot],
  );

  const loadoutOptions = useMemo((): SpawnPickerOption[] => (loadouts || []).map(l => ({
    id: l.id,
    label: l.label,
    detail: `${l.items?.length ?? 0} top-level item${(l.items?.length ?? 0) === 1 ? '' : 's'}`,
  })), [loadouts]);

  const missionOptions = useMemo((): SpawnPickerOption[] => (missions || []).map(m => ({
    id: m.data?.MissionName || m.file,
    label: m.data?.MissionName || m.file.replace(/^Airdrop_/, '').replace(/\.json$/i, ''),
    detail: m.data?.Container ? `Container: ${m.data.Container}` : undefined,
    // A mission the server can't parse would fail at FindMission, so say so here
    // rather than letting the action come back with an opaque no-op.
    disabledReason: m.data ? undefined : (m.error || 'File could not be read'),
  })), [missions]);

  /**
   * Fire a loadout as a ground pile. The tree is rolled here — chances, group
   * picks and quantity ranges all resolve client-side — so the mod receives a
   * decided list. Without the mod's spawn action we fall back to one world spawn
   * per item, which loses the nesting but still puts the right things on the floor.
   */
  const spawnLoadoutPile = useCallback(async (loadoutId: string, at: WorldPoint) => {
    const loadout = (loadouts || []).find(l => l.id === loadoutId);
    if (!loadout) { notify('That loadout no longer exists.'); return; }
    const resolved = (loadout.items || []).map(n => resolveLoadoutNode(n, loadouts || []));
    const tree = buildSpawnTree(resolved);
    if (tree.length === 0) { notify(`${loadout.label} rolled empty — nothing spawned.`); return; }
    const count = countSpawnTree(tree);
    const result = worldActions?.spawnPile
      ? await actions.spawnPile(at.x, at.z, tree)
      : await actions.spawnPileFlat(at.x, at.z, flattenSpawnTree(tree));
    report(result, `Spawned ${loadout.label} (${count} item${count === 1 ? '' : 's'})`);
  }, [loadouts, actions, worldActions, notify, report]);

  // Following: recentre whenever the followed entity's position changes. Keyed on the
  // coordinates rather than on `view`, so the transform this writes can't retrigger it.
  const followed = following ? markerInfo(following) : null;
  const followX = followed?.position?.x ?? null;
  const followZ = followed?.position?.z ?? null;
  useEffect(() => {
    if (followX == null || followZ == null) return;
    centreOnWorld(followX, followZ);
  }, [followX, followZ, centreOnWorld]);

  const menuTarget = menu ? markerInfo(menu.target) : null;

  const menuGroups = useMemo((): MapMenuItem[][] => {
    if (!menu) return [];
    const { at } = menu;
    const marker: MapMenuItem[] = [];

    if (menu.target && menuTarget) {
      const sel = menu.target;
      // Ids are only unique within a layer — an AI and an event could both be "3".
      const isFollowed = !!following && following.kind === sel.kind && following.id === sel.id;
      if (menuTarget.followable) {
        marker.push({
          key: 'follow',
          label: isFollowed ? 'Stop following' : 'Follow',
          icon: Eye,
          isDisabled: !menuTarget.position,
          onSelect: () => setFollowing(isFollowed ? null : sel),
        });
      }
      if (sel.kind === 'player' && menuTarget.steamId) {
        marker.push({
          key: 'copy-steam',
          label: 'Copy Steam64',
          icon: Copy,
          onSelect: () => copy(menuTarget.steamId!, 'Steam64 ID'),
        });
      }
      if (menuTarget.position) {
        const p = menuTarget.position;
        marker.push({
          key: 'copy-marker-pos',
          label: 'Copy its position',
          icon: Copy,
          onSelect: () => copy(formatWorldPos(p.x, p.z), `${menuTarget.label}'s position`),
        });
      }
    }

    // Actions that change the live server. Each is hidden unless the server
    // actually advertises the backing GameLabs action, so a stock GameLabs
    // install shows teleport and the item spawn, and nothing that would 404.
    const server: MapMenuItem[] = [];
    if (status.capabilities?.gameLabs) {
      // Prefer the right-clicked marker; otherwise act on the current selection,
      // which is what makes this the inverse of the drag gesture — pick the
      // player first, then right-click where they should end up.
      const sel = menu.target?.kind === 'player' ? menuTarget
        : (selection?.kind === 'player' ? markerInfo(selection) : null);
      if (sel?.steamId) {
        server.push({
          key: 'teleport-here',
          label: `Teleport ${sel.label} here`,
          icon: Navigation,
          onSelect: () => setPending({
            kind: 'teleport', at, steam64: sel.steamId!, name: sel.label,
          }),
        });
      }
      if (targetablePlayers.length > 1) {
        server.push({
          key: 'teleport-all',
          label: `Teleport all ${targetablePlayers.length} players here`,
          icon: Users,
          onSelect: () => setPending({ kind: 'teleport-all', at, players: targetablePlayers }),
        });
      }
    }
    if (worldActions?.spawnAi) {
      server.push({
        key: 'spawn-ai',
        label: 'Spawn AI here…',
        icon: Skull,
        onSelect: () => setPending({ kind: 'spawn-ai', at }),
      });
    }
    if (worldActions?.airdrop) {
      server.push({
        key: 'airdrop',
        label: 'Start airdrop here…',
        icon: Plane,
        onSelect: () => setPending({ kind: 'airdrop', at }),
      });
    }
    // The flat fallback still needs the stock world spawn, so require one of the two.
    if (worldActions?.spawnPile || worldActions?.spawnItem) {
      server.push({
        key: 'spawn-loadout',
        label: 'Spawn loadout here…',
        icon: PackagePlus,
        isDisabled: !loadouts?.length,
        onSelect: () => setPending({ kind: 'loadout', at }),
      });
    }

    const here: MapMenuItem[] = [
      {
        key: 'copy-pos',
        label: 'Copy coordinates',
        icon: Copy,
        onSelect: () => copy(formatWorldPos(at.x, at.z), 'coordinates'),
      },
      {
        key: 'copy-xml',
        label: 'Copy as <pos> XML',
        icon: FileCode,
        onSelect: () => copy(formatPosXml(at.x, at.z), '<pos> element'),
      },
      {
        key: 'measure',
        label: 'Measure from here',
        icon: Ruler,
        onSelect: () => { setMeasure({ from: at, to: null }); setSelection(null); },
      },
      {
        key: 'pin',
        label: 'Drop pin',
        icon: MapPin,
        onSelect: () => setPins(p => [...p, { id: nextPinId.current++, x: at.x, z: at.z }]),
      },
      {
        key: 'centre',
        label: 'Centre here',
        icon: LocateFixed,
        onSelect: () => centreOnWorld(at.x, at.z),
      },
    ];

    const clear: MapMenuItem[] = [];
    if (measure) {
      clear.push({
        key: 'clear-measure', label: 'Clear measurement', icon: X,
        onSelect: () => setMeasure(null),
      });
    }
    if (pins.length) {
      clear.push({
        key: 'clear-pins', label: `Clear ${pins.length} pin${pins.length === 1 ? '' : 's'}`,
        icon: Trash2, onSelect: () => setPins([]),
      });
    }
    // Only when the marker group above doesn't already offer it for this exact entity.
    const followedIsTarget = !!following && following.kind === menu.target?.kind
      && following.id === menu.target?.id;
    if (following && !followedIsTarget) {
      clear.push({
        key: 'clear-follow', label: `Stop following ${markerInfo(following)?.label ?? ''}`.trim(),
        icon: X, onSelect: () => setFollowing(null),
      });
    }

    return [marker, server, here, clear];
  }, [
    menu, menuTarget, following, measure, pins.length, copy, centreOnWorld, markerInfo,
    selection, status.capabilities?.gameLabs, worldActions, targetablePlayers, loadouts,
  ]);

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
  const world = snapshot?.world;

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

          {/* In-game clock and ambient temperature. Two badges rather than one string
              because the readings are independently available: a mod build predating
              `temperature` still reports the date and time, and showing that is better
              than showing nothing until the operator redeploys. */}
          {(world?.date || world?.time) && (
            <span title="In-game world date and time, reported by the companion mod.">
              <Badge color="gray" size="sm">
                <Clock size={11} className="mr-1 shrink-0" />
                {[
                  world.date && formatWorldDate(world.date),
                  world.time && formatWorldTime(world.time),
                ].filter(Boolean).join(' · ')}
              </Badge>
            </span>
          )}
          {typeof world?.temperature === 'number' && (
            <span title="Ambient air temperature at sea level, including cloud and fog effects.">
              <Badge color="gray" size="sm">
                <Thermometer size={11} className="mr-1 shrink-0" />
                {formatWorldTemp(world.temperature)}
              </Badge>
            </span>
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
              onContextMenu={openContextMenu}
              className={cx(
                'relative flex-1 min-w-0 bg-black rounded-xl overflow-hidden border border-gray-200 dark:border-gray-800 select-none touch-none',
                view.isPanning ? 'cursor-grabbing'
                  : (teleportTarget || (measure && !measure.to)) ? 'cursor-crosshair'
                    : 'cursor-grab',
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
                <MapImageLayer view={view} map={map} />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-xs text-gray-400 pointer-events-none">
                  No map preview for "{map.displayName}"
                </div>
              )}

              {/* Overlay: carries the pan, not the zoom, so markers keep a constant
                  on-screen size and a drag re-renders none of them. */}
              {view.size > 0 && snapshot && (
                <div style={view.overlayStyle} className="pointer-events-none">
                  {enabledLayers.has('territories') && snapshot.territories?.items.map((t, i) => {
                    const id = t.id || String(i);
                    const p = view.project(t.position[0], t.position[2]);
                    return (
                      <TerritoryMarker
                        key={`t-${id}`}
                        id={id}
                        territory={t}
                        px={p.px}
                        py={p.py}
                        /* The mod reports the radius its own scan used, per flag. That
                           matters when two territory mods with different sizes are
                           live — one server-wide setting is then wrong for half of
                           them. Falls back to the Expansion setting. */
                        radiusPx={view.projectLen(t.territory?.radius ?? territoryRadius)}
                        selected={isSel('territory', id)}
                        dimmed={snapshot.territories?.stale}
                        onSelect={selectTerritory}
                      />
                    );
                  })}

                  {enabledLayers.has('events') && snapshot.events?.items.map((e, i) => {
                    const id = e.id || String(i);
                    const p = view.project(e.position[0], e.position[2]);
                    return (
                      <EventMarker
                        key={`e-${id}`}
                        id={id}
                        event={e}
                        px={p.px}
                        py={p.py}
                        selected={isSel('event', id)}
                        dimmed={snapshot.events?.stale}
                        stored={e.moved === true}
                        onSelect={selectEvent}
                      />
                    );
                  })}

                  {enabledLayers.has('vehicles') && snapshot.vehicles?.items.map((v, i) => {
                    const id = v.id || String(i);
                    const p = view.project(v.position[0], v.position[2]);
                    return (
                      <VehicleMarker
                        key={`v-${id}`}
                        id={id}
                        vehicle={v}
                        px={p.px}
                        py={p.py}
                        selected={isSel('vehicle', id)}
                        dimmed={snapshot.vehicles?.stale}
                        onSelect={selectVehicle}
                      />
                    );
                  })}

                  {/* Between vehicles and players on purpose: under players so a bot
                      never hides a survivor, over vehicles so an AI in a car stays
                      clickable. */}
                  {enabledLayers.has('ai') && snapshot.ai?.items.map((a, i) => {
                    const id = a.id || String(i);
                    const p = view.project(a.position[0], a.position[2]);
                    return (
                      <AiMarker
                        key={`a-${id}`}
                        id={id}
                        ai={a}
                        px={p.px}
                        py={p.py}
                        selected={isSel('ai', id)}
                        dimmed={snapshot.ai?.stale}
                        onSelect={selectAi}
                      />
                    );
                  })}

                  {enabledLayers.has('players') && snapshot.players?.items.map((pl) => {
                    if (!pl.position) return null;
                    const id = pl.sessionId || pl.steamId || pl.name;
                    const p = view.project(pl.position[0], pl.position[2]);
                    const canDragTeleport = !!status.capabilities?.gameLabs && !!pl.steamId;
                    return (
                      <PlayerMarker
                        key={`p-${id}`}
                        id={id}
                        player={pl}
                        px={p.px}
                        py={p.py}
                        selected={isSel('player', id)}
                        dimmed={snapshot.players?.stale}
                        onSelect={selectPlayer}
                        toWorld={canDragTeleport ? view.toWorld : undefined}
                        onDragTeleport={canDragTeleport ? dragTeleport : undefined}
                      />
                    );
                  })}
                </div>
              )}

              {/* Ruler and pins: their own overlay so they survive a snapshot-less map, and
                  drawn over the markers. Same overlayStyle, so they pan with the map and
                  keep a constant on-screen size — never project() into viewport space. */}
              {view.size > 0 && (measure || pins.length > 0) && (
                <div style={view.overlayStyle} className="pointer-events-none">
                  {measure && <MeasureLayer measure={measure} view={view} />}
                  {pins.map((pin) => {
                    const p = view.project(pin.x, pin.z);
                    return (
                      <span
                        key={pin.id}
                        data-testid="map-pin"
                        className="absolute -translate-x-1/2 -translate-y-full flex flex-col items-center"
                        style={{ left: p.px, top: p.py }}
                      >
                        <MapPin
                          size={16}
                          strokeWidth={2.25}
                          className="text-amber-300 [filter:drop-shadow(0_1px_1.5px_rgba(0,0,0,0.85))]"
                        />
                      </span>
                    );
                  })}
                </div>
              )}

              {loading && !snapshot && (
                <div className="absolute inset-0 flex items-center justify-center text-xs text-gray-300 bg-black/30 pointer-events-none">
                  Loading live data…
                </div>
              )}

              {/* Measure mode banner, mirroring the teleport one. */}
              {measure && !measure.to && (
                <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-primary-600 text-white text-xs font-medium shadow-lg">
                  Click a second point to measure
                  <button
                    type="button"
                    className="underline decoration-white/50 hover:decoration-white"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => { e.stopPropagation(); setMeasure(null); }}
                  >
                    cancel
                  </button>
                </div>
              )}

              {feedback && (
                <div className="absolute bottom-3 left-3 z-20 px-2.5 py-1.5 rounded-lg bg-gray-900/90 text-[11px] font-medium text-gray-100 shadow-lg pointer-events-none">
                  {feedback}
                </div>
              )}

              {view.canZoom && <MapZoomControls map={view} />}

              <MapContextMenu
                open={!!menu}
                x={menu?.x ?? 0}
                y={menu?.y ?? 0}
                header={menu?.target && menuTarget
                  ? `${KIND_LABELS[menu.target.kind]} — ${menuTarget.label}`
                  : formatWorldPos(menu?.at.x ?? 0, menu?.at.z ?? 0)}
                groups={menuGroups}
                onClose={() => setMenu(null)}
              />
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
              // This result used to be discarded, so a rejected teleport looked
              // exactly like a successful one.
              const result = await actions.teleport(teleportTarget.steamId, teleportDest.x, teleportDest.z);
              report(result, `Teleported ${teleportTarget.name}`);
            }
            setTeleportDest(null);
            setTeleportTarget(null);
          }}
        />

        {/* --- Right-click server actions. One at a time, each stating the point. --- */}

        <ConfirmDialog
          open={pending?.kind === 'teleport'}
          title="Teleport player"
          message={pending?.kind === 'teleport' ? (
            <>Teleport <b>{pending.name}</b> to <b>{formatWorldPos(pending.at.x, pending.at.z)}</b>?</>
          ) : null}
          confirmLabel="Teleport"
          busy={actions.busy}
          onCancel={() => setPending(null)}
          onConfirm={async () => {
            if (pending?.kind !== 'teleport') return;
            const { steam64, name, at } = pending;
            setPending(null);
            report(await actions.teleport(steam64, at.x, at.z), `Teleported ${name}`);
          }}
        />

        <ConfirmDialog
          open={pending?.kind === 'teleport-all'}
          title="Teleport every player"
          destructive
          message={pending?.kind === 'teleport-all' ? (
            <>
              Teleport all <b>{pending.players.length}</b> connected players to{' '}
              <b>{formatWorldPos(pending.at.x, pending.at.z)}</b>?
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                Everyone on the server is moved, one at a time. This cannot be undone —
                nothing records where they were.
              </p>
            </>
          ) : null}
          confirmLabel="Teleport everyone"
          busy={actions.busy}
          onCancel={() => setPending(null)}
          onConfirm={async () => {
            if (pending?.kind !== 'teleport-all') return;
            const { players, at } = pending;
            setPending(null);
            report(await actions.teleportAll(players, at.x, at.z), 'Teleported players');
          }}
        />

        {/* AI spawn needs a count and a kind, so the confirm carries a small form
            rather than adding a third modal component for three fields. */}
        <ConfirmDialog
          open={pending?.kind === 'spawn-ai'}
          title="Spawn AI"
          message={pending?.kind === 'spawn-ai' ? (
            <div className="flex flex-col gap-3">
              <p>Spawn at <b>{formatWorldPos(pending.at.x, pending.at.z)}</b>.</p>
              <label className="flex items-center justify-between gap-3">
                <span>Type</span>
                <select
                  value={aiForm.kind}
                  onChange={e => setAiForm(f => ({ ...f, kind: e.target.value as AiSpawnForm['kind'] }))}
                  className="rounded-lg border border-gray-300 bg-white px-2 py-1 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                >
                  <option value="infected">Infected</option>
                  <option value="eai">Expansion AI patrol</option>
                </select>
              </label>
              <label className="flex items-center justify-between gap-3">
                <span>Count</span>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={aiForm.count}
                  onChange={e => setAiForm(f => ({ ...f, count: Number(e.target.value) || 1 }))}
                  className="w-24 rounded-lg border border-gray-300 bg-white px-2 py-1 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                />
              </label>
              {aiForm.kind === 'eai' && (
                <label className="flex items-center justify-between gap-3">
                  <span>Faction</span>
                  <input
                    type="text"
                    value={aiForm.faction}
                    placeholder="default"
                    onChange={e => setAiForm(f => ({ ...f, faction: e.target.value }))}
                    className="w-40 rounded-lg border border-gray-300 bg-white px-2 py-1 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                  />
                </label>
              )}
            </div>
          ) : null}
          confirmLabel="Spawn"
          busy={actions.busy}
          onCancel={() => setPending(null)}
          onConfirm={async () => {
            if (pending?.kind !== 'spawn-ai') return;
            const { at } = pending;
            setPending(null);
            report(
              await actions.spawnAi(at.x, at.z, { kind: aiForm.kind, count: aiForm.count, faction: aiForm.faction }),
              `Spawned ${aiForm.count} ${aiForm.kind === 'eai' ? 'AI' : 'infected'}`,
            );
          }}
        />

        <MapSpawnPicker
          isOpen={pending?.kind === 'airdrop'}
          title="Start an airdrop here"
          confirmLabel="Start airdrop"
          at={pending?.at ?? { x: 0, z: 0 }}
          options={missionOptions}
          loading={missionsLoading}
          emptyMessage="No airdrop missions configured for this map. Add one in Addons → Expansion → Air Drops."
          busy={actions.busy}
          notice="The drop runs this mission's container and loot, but at the coordinates you clicked instead of its configured drop zone."
          onCancel={() => setPending(null)}
          onConfirm={async (mission) => {
            if (pending?.kind !== 'airdrop') return;
            const { at } = pending;
            setPending(null);
            report(await actions.startAirdrop(at.x, at.z, mission), `Airdrop "${mission}" inbound`);
          }}
        />

        <MapSpawnPicker
          isOpen={pending?.kind === 'loadout'}
          title="Spawn a loadout here"
          confirmLabel="Spawn"
          at={pending?.at ?? { x: 0, z: 0 }}
          options={loadoutOptions}
          emptyMessage="No loadouts saved for this map yet."
          busy={actions.busy}
          notice={worldActions?.spawnPile ? undefined
            : 'Attachments and cargo will land as a loose pile — nesting needs the spacecat_gamelabs spawn action, which this server does not advertise.'}
          onCancel={() => setPending(null)}
          onConfirm={async (id) => {
            if (pending?.kind !== 'loadout') return;
            const { at } = pending;
            setPending(null);
            await spawnLoadoutPile(id, at);
          }}
        />
      </div>
    </Modal>
  );
}
