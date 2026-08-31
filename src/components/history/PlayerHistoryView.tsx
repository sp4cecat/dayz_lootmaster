import { useCallback, useMemo, useState } from 'react';
import { Modal } from '../base/modal/modal';
import { Badge } from '../base/badges/badges';
import { MapZoomControls } from '../MapZoomControls';
import { History, Database, AlertTriangle } from 'lucide-react';
import { cx } from '@/utils/cx';
import { useMapMetadata } from '@/hooks/useMapMetadata';
import { useMapPanZoom } from '@/hooks/useMapPanZoom';
import {
  useAreaQuery, useHistoryActions, useHistoryPlayers, useHistoryStats, useHistoryTracks,
  useModOnline,
} from '@/hooks/useHistoryData';
import { usePlaybackClock } from '@/hooks/usePlaybackClock';
import { presenceSegments, sampleTrackAt, trailPoints } from '@/utils/trackSampling';
import type { AreaSelection, HistoryMode } from '@/types/history';
import HistoryControls from './HistoryControls';
import TrackLayer from './TrackLayer';
import MapImageLayer from '../map/MapImageLayer';
import { MAX_TRACKS, TRACK_COLORS, trackColors } from '@/utils/trackColors';
import PlaybackBar from './PlaybackBar';
import PlaybackLayer from './PlaybackLayer';
import AreaSelectLayer from './AreaSelectLayer';
import AreaResultsPanel from './AreaResultsPanel';
import ActionsLayer from './ActionsLayer';
import ActionFeed from './ActionFeed';
import InventoryPanel from './InventoryPanel';

interface PlayerHistoryViewProps {
  onClose: () => void;
  selectedProfileId?: string;
  missionName?: string;
  isPanel?: boolean;
  /** Navigate to the ADM Records tool, for windows that predate the recording. */
  onOpenAdmRecords?: () => void;
}

/** How much of the past to trail behind a marker during playback. Adjustable. */
const DEFAULT_TRAIL_MS = 5 * 60 * 1000;

function formatBytes(n: number | null): string {
  if (n === null) return '—';
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/**
 * Player History: recorded movement from the companion mod's snapshot stream.
 *
 * Three modes over one map — draw whole paths, replay them on a clock, or select an
 * area and ask who was in it.
 *
 * Unlike the Live Map this does NOT gate on CF Tools. Every sample it renders came
 * from the companion mod via /ingest/snapshot, so requiring a CF Tools binding would
 * withhold the feature from servers that have everything it actually needs — the
 * limitation documented at the end of docs/cftools-gamelabs-spacecat.md. It gates on
 * the recorder instead.
 */
export default function PlayerHistoryView({
  onClose, missionName, isPanel = false, onOpenAdmRecords,
}: PlayerHistoryViewProps) {
  const map = useMapMetadata(missionName);
  const { stats, loading: statsLoading } = useHistoryStats();

  const [mode, setMode] = useState<HistoryMode>('paths');
  const [range, setRange] = useState(() => {
    const now = Date.now();
    return { from: now - 6 * 3600_000, to: now };
  });
  const [selected, setSelected] = useState<string[]>([]);
  const [hovered, setHovered] = useState<string | null>(null);
  const [area, setArea] = useState<AreaSelection | null>(null);
  const [kinds, setKinds] = useState<string[]>([]);
  const [hoveredAction, setHoveredAction] = useState<number | null>(null);
  const [trailMs, setTrailMs] = useState(DEFAULT_TRAIL_MS);
  // The Actions rail carries two different things about the same players, and
  // stacking them in a 288 px column would leave neither readable.
  const [rail, setRail] = useState<'feed' | 'loadouts'>('feed');

  const { players, loading: playersLoading } = useHistoryPlayers(range.from, range.to);
  const { tracks, loading: tracksLoading, error: tracksError } =
    useHistoryTracks(selected, range.from, range.to);
  const areaQuery = useAreaQuery();
  const { online, connected: modConnected } = useModOnline();

  /**
   * The action log for the selection.
   *
   * Confined to the area circle only while the Area mode owns it — carrying that
   * filter into Actions mode would silently hide every event outside a circle the
   * operator can no longer see.
   */
  const actionsQuery = useHistoryActions(
    selected, range.from, range.to, kinds, mode === 'area' ? area : null,
  );

  // Presence of whoever is selected, which is what playback is actually about.
  const segments = useMemo(() => presenceSegments(tracks), [tracks]);

  /**
   * Playback runs over the selected players' own data, not the picked range.
   *
   * The two are the same length for a live server watched over an afternoon, and
   * wildly different for a backfilled archive: a fortnight-wide range in which
   * one player appears for 8% of the time leaves the playhead days short of the
   * first sample, on an empty map, with no indication anything is working.
   */
  const playback = useMemo(() => {
    if (!segments.length) return { from: range.from, to: range.to };
    return { from: segments[0].from, to: segments[segments.length - 1].to };
  }, [segments, range.from, range.to]);

  const clock = usePlaybackClock(playback.from, playback.to, { segments });

  // The area mode owns the drag, so the pan/zoom hook must yield the pointer to it.
  // `isGestureBlocked` is the seam the hook provides for exactly this.
  const view = useMapPanZoom({
    worldSize: map.worldSize,
    nativeSize: map.tiles?.nativeSize,
    keyboardZoom: true,
    isGestureBlocked: () => mode === 'area',
  });

  // Stable identities for everything handed to the memoised rails (HistoryControls,
  // ActionFeed). An inline arrow here is a new prop every render, which during playback
  // means re-rendering the whole roster sixty times a second for no reason.
  const onRangeChange = useCallback((from: number, to: number) => setRange({ from, to }), []);
  const selectOnlyPlayer = useCallback((pid: string) => setSelected([pid]), []);
  const clearPlayers = useCallback(() => setSelected([]), []);
  const clearKinds = useCallback(() => setKinds([]), []);

  // Capped at the palette size: past it two players wear the same colour, and the
  // colour is the only thing tying a marker to a name. Removal is never blocked.
  const togglePlayer = useCallback((pid: string) => {
    setSelected((prev) => {
      if (prev.includes(pid)) return prev.filter(p => p !== pid);
      return prev.length >= MAX_TRACKS ? prev : [...prev, pid];
    });
  }, []);

  const selectShownPlayers = useCallback(
    (pids: string[]) => setSelected(pids.slice(0, MAX_TRACKS)),
    [],
  );

  const toggleKind = useCallback((kind: string) => {
    setKinds(prev => prev.includes(kind) ? prev.filter(k => k !== kind) : [...prev, kind]);
  }, []);

  const runAreaQuery = useCallback((next: AreaSelection) => {
    areaQuery.run(next, range.from, range.to);
  }, [areaQuery, range.from, range.to]);

  /**
   * The one colour assignment every consumer reads — roster swatch, path, marker.
   *
   * Keyed off the SELECTION, not `tracks`: the server returns tracks sorted by pid
   * and filtered to whoever actually had samples, so deriving a colour from a
   * position in that array made the roster swatch and the line on the map disagree
   * as soon as a second player was selected. Selection order also means adding a
   * player never recolours the ones already being watched.
   */
  const colorOf = useMemo(() => trackColors(selected), [selected]);

  // Playback: interpolate each track to the playhead. Returns null for players who
  // were not present at that instant, so a logged-out survivor leaves the map rather
  // than freezing in place.
  const playbackMarkers = useMemo(() => {
    if (mode !== 'playback') return [];
    return tracks
      .map((t) => {
        const at = sampleTrackAt(t.points, clock.ts);
        if (!at) return null;
        return {
          pid: t.pid,
          name: t.name,
          color: colorOf.get(t.pid) ?? TRACK_COLORS[0],
          x: at.x,
          z: at.z,
          point: at.point,
          trail: trailPoints(t.points, clock.ts, trailMs),
        };
      })
      .filter((m): m is NonNullable<typeof m> => m !== null);
  }, [mode, tracks, clock.ts, colorOf, trailMs]);

  /**
   * Per-player presence for the transport lanes, alongside the merged `segments`.
   *
   * The clock keeps the merged set — skip-empty must not skip a stretch in which
   * somebody else was online. But merged presence can only say "somebody was here",
   * and with several players the question is whose sessions overlapped.
   */
  const lanes = useMemo(
    () => tracks.map(t => ({
      pid: t.pid,
      name: t.name,
      color: colorOf.get(t.pid) ?? TRACK_COLORS[0],
      segments: presenceSegments([t]),
    })),
    [tracks, colorOf],
  );

  // Selected players the recorder has nothing for in this window. queryTrack simply
  // omits them, so without this you click a name and the map does nothing.
  const missing = useMemo(() => {
    const have = new Set(tracks.map(t => t.pid));
    return selected.filter(pid => !have.has(pid));
  }, [selected, tracks]);

  // The loadouts rail is single-player. First selected rather than last, so it does
  // not move under the operator every time they add someone to the path view.
  const focusPid = selected[0] ?? null;
  const focusName = useMemo(
    () => players.find(p => p.pid === focusPid)?.name ?? null,
    [players, focusPid],
  );

  const highlighted = useMemo(
    () => (hovered ? new Set([hovered]) : undefined),
    [hovered],
  );

  const showImage = !!map.imagePath && !view.imageFailed;
  const recording = stats?.enabled && stats?.ready;
  const hasData = !!stats && stats.rows > 0;

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title={`${map.displayName} Player History`}
      description="Recorded movement, paths and area presence from the companion mod."
      icon={History}
      inline={isPanel}
      className={cx(!isPanel && 'h-[90vh] max-w-none w-[90vw]')}
    >
      <div className="flex flex-col h-full gap-3">
        {/* Recorder status */}
        <div className="flex flex-wrap items-center gap-3 bg-gray-50 dark:bg-gray-900/50 p-3 rounded-xl border border-gray-200 dark:border-gray-800 shrink-0">
          {recording
            ? <Badge color="success" size="sm">Recording</Badge>
            : <Badge color="gray" size="sm">Not recording</Badge>}
          {stats && hasData && (
            <>
              <Badge color="brand" size="sm">{stats.rows.toLocaleString()} samples</Badge>
              <Badge color="gray" size="sm">{stats.players} players</Badge>
              {/* Imported rows are ~5 min apart against the mod's ~5 s, so the mix
                  changes what a track means. Say so rather than implying one source. */}
              {!!stats.bySrc?.adm && (
                <span title="Backfilled from admin logs (~5 min resolution)">
                  <Badge color="warning" size="sm">
                    {stats.bySrc.adm.toLocaleString()} imported
                  </Badge>
                </span>
              )}
            </>
          )}
          {stats && (
            <span className="text-[11px] text-gray-400 dark:text-gray-500 ml-auto flex items-center gap-1.5">
              <Database size={11} />
              {formatBytes(stats.bytes)} · keeps {stats.retention.fullDays}d full,
              {' '}{stats.retention.thinDays}d thinned
            </span>
          )}
        </div>

        {/* The recorder failing is a distinct state from having no data yet, and the
            fix for each is different — say which one it is. */}
        {!statsLoading && !recording ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-gray-300 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-900/30 px-6">
            <AlertTriangle size={36} className="text-gray-300 dark:text-gray-600" />
            <div className="text-center max-w-md">
              <h3 className="text-base font-bold text-gray-900 dark:text-white mb-1">
                {stats?.enabled === false ? 'History recording is disabled' : 'History recorder is unavailable'}
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {stats?.enabled === false
                  ? 'Set HISTORY_ENABLED=1 on the backend to record the companion mod’s snapshot stream.'
                  : stats?.lastError
                    ? `The history database could not be opened: ${stats.lastError}`
                    : 'The backend is not reachable, or is too old to record history (Node 22.5+ required).'}
              </p>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex gap-3 min-h-0">
            {/* Left rail: mode, range, roster */}
            <div className="w-64 shrink-0 flex flex-col gap-3 min-h-0 border-r border-gray-200 dark:border-gray-800 pr-3">
              <HistoryControls
                mode={mode}
                onModeChange={setMode}
                from={range.from}
                to={range.to}
                onRangeChange={onRangeChange}
                players={players}
                playersLoading={playersLoading}
                selected={selected}
                colors={colorOf}
                maxSelected={MAX_TRACKS}
                onTogglePlayer={togglePlayer}
                onSelectOnly={selectOnlyPlayer}
                onSelectShown={selectShownPlayers}
                onClearPlayers={clearPlayers}
                onHoverPlayer={setHovered}
                dataFrom={stats?.from ?? null}
                dataTo={stats?.to ?? null}
              />
            </div>

            {/* Map + transport */}
            <div className="flex-1 flex flex-col gap-3 min-w-0 min-h-0">
              <div
                ref={view.viewportRef}
                {...view.viewportHandlers}
                className={cx(
                  'relative flex-1 min-h-0 bg-black rounded-xl overflow-hidden border border-gray-200 dark:border-gray-800 select-none touch-none',
                  mode === 'area' ? '' : view.isPanning ? 'cursor-grabbing' : 'cursor-grab',
                )}
              >
                {showImage ? (
                  <MapImageLayer view={view} map={map}>
                    {/* Paths live INSIDE the content box so the browser transforms
                        them; see TrackLayer for why they are not on the overlay. */}
                    {mode !== 'area' && (
                      <TrackLayer
                        // Dimmed context under the action markers rather than the
                        // subject, so a pickup is placed on the route that led to it.
                        tracks={mode === 'playback' ? [] : tracks}
                        worldSize={map.worldSize}
                        colors={colorOf}
                        highlighted={highlighted}
                      />
                    )}
                  </MapImageLayer>
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center text-xs text-gray-400 pointer-events-none">
                    No map preview for "{map.displayName}"
                  </div>
                )}

                {/* Overlay: carries the pan, not the zoom, so markers keep a constant size. */}
                {view.size > 0 && (
                  <div style={view.overlayStyle} className="pointer-events-none">
                    {/* Trails and named markers at the playhead, drawn per-frame in
                        viewport space — they change every frame anyway, so there is
                        no static geometry for the browser to cache. */}
                    {mode === 'playback' && (
                      <PlaybackLayer markers={playbackMarkers} view={view} />
                    )}

                    {/* Action markers. Live in Actions mode, and alongside an area
                        query so "who was here" and "what happened here" are one
                        picture rather than two tabs. */}
                    {(mode === 'actions' || mode === 'area') && (
                      <ActionsLayer
                        actions={actionsQuery.actions}
                        view={view}
                        hoveredId={hoveredAction}
                        onHoverAction={setHoveredAction}
                      />
                    )}

                    {/* Path endpoints: where each track starts and stops. */}
                    {mode === 'paths' && tracks.map((t) => {
                      if (!t.points.length) return null;
                      const first = t.points[0];
                      const last = t.points[t.points.length - 1];
                      const a = view.project(first.x, first.z);
                      const b = view.project(last.x, last.z);
                      const color = colorOf.get(t.pid) ?? TRACK_COLORS[0];
                      const dim = !!hovered && hovered !== t.pid;
                      return (
                        <div key={`ends-${t.pid}`} style={{ opacity: dim ? 0.2 : 1 }}>
                          <div
                            className="absolute h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-1 ring-white/70"
                            style={{ left: a.px, top: a.py, backgroundColor: color }}
                            title={`${t.name || t.pid} — start`}
                          />
                          <div
                            className="absolute h-[8.4px] w-[8.4px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/80"
                            style={{ left: b.px, top: b.py, backgroundColor: color }}
                            title={`${t.name || t.pid} — end`}
                          />
                        </div>
                      );
                    })}
                  </div>
                )}

                {mode === 'area' && (
                  <AreaSelectLayer
                    view={view}
                    area={area}
                    onChange={setArea}
                    onCommit={runAreaQuery}
                  />
                )}

                {tracksLoading && (
                  <div className="absolute top-3 left-3 px-2 py-1 rounded bg-black/60 text-white text-[11px] pointer-events-none">
                    Loading tracks…
                  </div>
                )}
                {tracksError && (
                  <div className="absolute top-3 left-3 px-2 py-1 rounded bg-error-600 text-white text-[11px] pointer-events-none">
                    {tracksError}
                  </div>
                )}
                {/* A decimated path is a shape, not every reading. Say so, rather
                    than letting it be mistaken for the full record. */}
                {(mode === 'paths' || mode === 'playback') && tracks.some(t => t.simplified) && (
                  <div className="absolute bottom-3 left-3 px-2 py-1 rounded bg-black/50 text-white/80 text-[10px] pointer-events-none">
                    Tracks simplified for display
                  </div>
                )}

                {view.canZoom && <MapZoomControls map={view} />}
              </div>

              {mode === 'playback' && (
                <PlaybackBar
                  clock={clock}
                  from={playback.from}
                  to={playback.to}
                  segments={segments}
                  lanes={lanes}
                  trailMs={trailMs}
                  onTrailChange={setTrailMs}
                  status={
                    selected.length === 0
                      ? 'Select players to replay'
                      : `${playbackMarkers.length} of ${tracks.length} present`
                      + (missing.length ? ` · ${missing.length} with no samples here` : '')
                  }
                />
              )}
            </div>

            {/* Right rail: area results, or the action feed and loadouts. The
                roster always lives on the left. */}
            {mode === 'area' && (
              <div className="w-72 shrink-0 flex flex-col min-h-0 border-l border-gray-200 dark:border-gray-800">
                <AreaResultsPanel
                  area={area}
                  visits={areaQuery.visits}
                  loading={areaQuery.loading}
                  error={areaQuery.error}
                  onHoverPlayer={setHovered}
                  onSearchAdm={onOpenAdmRecords}
                  recordedFrom={stats?.from ?? null}
                  windowFrom={range.from}
                />
              </div>
            )}

            {mode === 'actions' && (
              <div className="w-80 shrink-0 flex flex-col min-h-0 border-l border-gray-200 dark:border-gray-800">
                <div className="flex items-center gap-1 p-2 border-b border-gray-200 dark:border-gray-800 shrink-0">
                  {(['feed', 'loadouts'] as const).map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setRail(tab)}
                      className={cx(
                        'flex-1 px-2 py-1 rounded-md text-[11px] font-medium border transition-colors capitalize',
                        rail === tab
                          ? 'bg-primary-50 text-primary-700 border-primary-200 dark:bg-primary-900/20 dark:text-primary-300 dark:border-primary-800'
                          : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50 dark:bg-gray-900 dark:text-gray-400 dark:border-gray-700',
                      )}
                    >
                      {tab}
                    </button>
                  ))}
                </div>

                {rail === 'feed' ? (
                  <ActionFeed
                    actions={actionsQuery.actions}
                    kindCounts={actionsQuery.kindCounts}
                    selectedKinds={kinds}
                    onToggleKind={toggleKind}
                    onClearKinds={clearKinds}
                    loading={actionsQuery.loading}
                    error={actionsQuery.error}
                    truncated={actionsQuery.truncated}
                    onHoverAction={setHoveredAction}
                    totalRecorded={stats?.actions}
                  />
                ) : (
                  <InventoryPanel
                    // One player at a time: a loadout belongs to somebody, and a
                    // merged list of four players' snapshots answers no question
                    // anyone asks. The roster stays multi-select for the paths.
                    pid={focusPid}
                    name={focusName}
                    from={range.from}
                    to={range.to}
                    online={!!focusPid && online.has(focusPid)}
                    modConnected={modConnected}
                  />
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
