import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useHistoryActions, useHistoryTracks } from '@/hooks/useHistoryData';
import {
  CONNECT_KINDS, SESSION_LOOKUP_MS, SESSION_LOOKUP_STEP_MS, quantiseNow, sessionStartFrom,
  windowFor, type SessionKind, type WindowPreset,
} from '@/utils/liveWindow';
import { TRACK_COLORS } from '@/utils/trackColors';
import type { ActionKindCount, CycleEvidence, HistoryAction, HistoryTrack } from '@/types/history';

/** Points per track. The trail is context beside a live dot, not the analysis view. */
const TRACK_BUDGET = 800;

export interface SelectedPlayerHistory {
  /** History is on and a player with a steam64 is selected. */
  enabled: boolean;
  pid: string | null;
  from: number;
  to: number;
  preset: WindowPreset;
  setPreset: (p: WindowPreset) => void;
  sessionStart: number | null;
  sessionKind: SessionKind;
  /** The session lookup has answered; until then the window is provisional. */
  sessionReady: boolean;
  tracks: HistoryTrack[];
  tracksLoading: boolean;
  tracksError: string | null;
  actions: HistoryAction[];
  kindCounts: ActionKindCount[];
  truncated: boolean;
  actionsLoading: boolean;
  actionsError: string | null;
  kinds: string[];
  toggleKind: (kind: string) => void;
  clearKinds: () => void;
  /** Feed row under the cursor; its marker on the map is enlarged. */
  hoveredId: number | null;
  setHoveredId: (id: number | null) => void;
  /** A loot-cycle line under the cursor: light up the drop that closed it. */
  hoverCycle: (cycle: CycleEvidence | null, pid: string) => void;
  /** Colour per pid for TrackLayer. */
  colors: ReadonlyMap<string, string>;
}

interface Options {
  pid: string | null;
  /** From `useQuantisedNow`, never `Date.now()` — see liveWindow.ts. */
  now: number;
  /** History backend available (from `useFlags().available`). */
  enabled: boolean;
}

const NO_IDS: string[] = [];

/**
 * The selected live player's recorded path and action feed over a session-sized
 * window, for the Live Map's player card.
 *
 * Two fetch stages. First a cheap connect lookup over the last day decides where
 * the session begins; only once it has answered do the track and the feed fetch,
 * so selecting a player costs one small query and then one of each — not a
 * provisional pair that is thrown away seconds later when the real window arrives.
 *
 * Every key here derives from `pid`, the preset, the chips and the quantised
 * clock. Nothing is keyed on the 5 s snapshot.
 */
export function useSelectedPlayerHistory({ pid, now, enabled }: Options): SelectedPlayerHistory {
  const active = enabled && !!pid;
  const ids = useMemo(() => (pid ? [pid] : NO_IDS), [pid]);

  const [preset, setPreset] = useState<WindowPreset>('session');
  const [kinds, setKinds] = useState<string[]>([]);
  const [hoveredId, setHoveredId] = useState<number | null>(null);

  // A new player is a new question: the preset, chips and hover all belong to
  // the previous one.
  useEffect(() => {
    setPreset('session');
    setKinds([]);
    setHoveredId(null);
  }, [pid]);

  // Session lookup. Keyed on a 5 min grain: a session start does not move, so
  // asking every 30 s would be waste.
  const anchor = quantiseNow(now, SESSION_LOOKUP_STEP_MS);
  const lookup = useHistoryActions(ids, anchor - SESSION_LOOKUP_MS, anchor, CONNECT_KINDS, null, active);
  // The feed is chronological, so the newest connect is the last row.
  const newestConnect = lookup.actions.length ? lookup.actions[lookup.actions.length - 1].ts : null;
  const modEmitsConnects = lookup.kindCounts.some(k => k.kind === 'connect');
  const { sessionStart, sessionKind } = sessionStartFrom(newestConnect, modEmitsConnects, now);

  /**
   * Ready means the lookup has ANSWERED for this pid — not merely "is not loading",
   * which is also true before it has started (the hook's initial state) and would
   * let the track fetch fire on the fallback window, then again on the real one.
   * Watching the loading edge catches the first answer; keying on the pid alone
   * (not the 5 min anchor) keeps the trail up while a later refresh is in flight.
   */
  const [settledFor, setSettledFor] = useState<string | null>(null);
  const wasLoading = useRef(false);
  useEffect(() => {
    if (lookup.loading) { wasLoading.current = true; return; }
    if (wasLoading.current) { wasLoading.current = false; setSettledFor(pid); }
  }, [lookup.loading, pid]);
  const sessionReady = active && settledFor === pid;

  const { from, to } = windowFor(preset, now, sessionStart);

  const tracksQuery = useHistoryTracks(sessionReady ? ids : NO_IDS, from, to, TRACK_BUDGET);
  const feed = useHistoryActions(ids, from, to, kinds, null, sessionReady);

  const toggleKind = useCallback((kind: string) => {
    setKinds(prev => (prev.includes(kind) ? prev.filter(k => k !== kind) : [...prev, kind]));
  }, []);
  const clearKinds = useCallback(() => setKinds([]), []);

  // Same pairing the scorer used: actor, class and the drop's timestamp. Only the
  // drop, and only when it is inside the loaded window.
  const hoverCycle = useCallback((cycle: CycleEvidence | null, actor: string) => {
    if (!cycle) { setHoveredId(null); return; }
    const hit = feed.actions.find(a =>
      a.pid === actor && a.cls === cycle.cls && a.ts === cycle.dropTs
      && (a.kind === 'drop' || a.kind === 'stash'));
    setHoveredId(hit ? hit.id : null);
  }, [feed.actions]);

  // Sky, not the palette's first orange: the trail ends at an orange live dot and
  // must be told apart from it.
  const colors = useMemo(
    () => new Map<string, string>(pid ? [[pid, TRACK_COLORS[1]]] : []),
    [pid],
  );

  return {
    enabled: active,
    pid,
    from, to,
    preset, setPreset,
    sessionStart, sessionKind, sessionReady,
    tracks: active ? tracksQuery.tracks : [],
    tracksLoading: tracksQuery.loading,
    tracksError: tracksQuery.error,
    actions: active ? feed.actions : [],
    kindCounts: feed.kindCounts,
    truncated: feed.truncated,
    actionsLoading: (active && lookup.loading) || feed.loading,
    actionsError: feed.error ?? lookup.error,
    kinds, toggleKind, clearKinds,
    hoveredId, setHoveredId,
    hoverCycle,
    colors,
  };
}

export default useSelectedPlayerHistory;
