import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/utils/api';
import type {
  AreaSelection, AreaVisit, HistoryPlayer, HistoryStats, HistoryTrack,
} from '@/types/history';

/**
 * Data access for the Player History tool.
 *
 * Deliberately NOT modelled on useLiveSnapshot: that hook polls on a timer because
 * it renders the present. History is immutable once recorded, so everything here is
 * request/response, triggered by the user changing a range, a selection or a query.
 * Re-fetching a fixed past window on a timer would be pure waste.
 *
 * None of these gate on CF Tools. The recorded stream comes from the companion mod,
 * so the tool has to work on a server with no CF Tools binding at all — the exact
 * limitation the live map has (see docs/cftools-gamelabs-spacecat.md).
 */

/** Recorder health and volume. Polled slowly, because it changes as data arrives. */
export function useHistoryStats(pollMs = 30000) {
  const [stats, setStats] = useState<HistoryStats | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch('/api/history/stats');
      setStats(res.ok ? await res.json() : null);
    } catch {
      setStats(null);              // unreachable backend; the view renders its own state
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    if (!pollMs) return;
    const id = setInterval(() => { if (!document.hidden) load(); }, pollMs);
    return () => clearInterval(id);
  }, [load, pollMs]);

  return { stats, loading, reload: load };
}

/** Players with samples in [from, to]. Re-runs when the window changes. */
export function useHistoryPlayers(from: number, to: number) {
  const [players, setPlayers] = useState<HistoryPlayer[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await apiFetch(`/api/history/players?from=${from}&to=${to}`);
        const body = res.ok ? await res.json() : null;
        if (!cancelled) setPlayers(body?.items ?? []);
      } catch {
        if (!cancelled) setPlayers([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [from, to]);

  return { players, loading };
}

/**
 * Decimated tracks for the selected players over the window.
 *
 * `budget` is a point count, not a tolerance: the backend bisects to find whatever
 * tolerance hits it, because the right tolerance differs by orders of magnitude
 * between a cross-map run and an hour spent inside one building.
 */
export function useHistoryTracks(pids: string[], from: number, to: number, budget = 2000) {
  const [tracks, setTracks] = useState<HistoryTrack[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Stable key so a re-created array with the same ids doesn't re-fetch.
  const idsKey = [...pids].sort().join(',');

  useEffect(() => {
    if (!idsKey) { setTracks([]); setError(null); return; }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await apiFetch(
          `/api/history/track?ids=${encodeURIComponent(idsKey)}&from=${from}&to=${to}&max=${budget}`,
        );
        const body = res.ok ? await res.json() : null;
        if (cancelled) return;
        if (body && body.available === false) {
          setTracks([]);
          setError(body.error || body.reason || 'History is unavailable.');
        } else {
          setTracks(body?.items ?? []);
          setError(null);
        }
      } catch {
        if (!cancelled) { setTracks([]); setError('Could not reach the server.'); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [idsKey, from, to, budget]);

  return { tracks, loading, error };
}

/**
 * Area presence query. Manual rather than reactive: the circle is dragged out on
 * the map, and firing a query on every pointermove would spam the backend with
 * results the user never sees.
 */
export function useAreaQuery() {
  const [visits, setVisits] = useState<AreaVisit[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Guards against an earlier slow query overwriting a later fast one.
  const runIdRef = useRef(0);

  const run = useCallback(async (area: AreaSelection, from: number, to: number) => {
    const runId = ++runIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(
        `/api/history/area?x=${area.x}&z=${area.z}&radius=${area.radius}&from=${from}&to=${to}`,
      );
      const body = res.ok ? await res.json() : null;
      if (runId !== runIdRef.current) return;
      if (body && body.available === false) {
        setVisits([]);
        setError(body.error || body.reason || 'History is unavailable.');
      } else {
        setVisits(body?.items ?? []);
      }
    } catch {
      if (runId === runIdRef.current) { setVisits([]); setError('Could not reach the server.'); }
    } finally {
      if (runId === runIdRef.current) setLoading(false);
    }
  }, []);

  const clear = useCallback(() => {
    runIdRef.current++;           // orphan any in-flight query
    setVisits(null);
    setError(null);
    setLoading(false);
  }, []);

  return { visits, loading, error, run, clear };
}
