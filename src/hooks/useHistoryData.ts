import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/utils/api';
import type {
  ActionKindCount, AreaSelection, AreaVisit, HistoryAction, HistoryPlayer, HistoryStats,
  HistoryTrack, InventorySnapshot, InventorySummary, RollbackResult,
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

/**
 * The action log for the selected players over the window, optionally confined to
 * a circle.
 *
 * Fetched with the same request as the kind counts, because the counts describe
 * what is in the WINDOW rather than what survived the filter — a chip list built
 * from the filtered result would delete the very chips needed to widen it again.
 */
export function useHistoryActions(
  pids: string[],
  from: number,
  to: number,
  kinds: string[] = [],
  area: AreaSelection | null = null,
) {
  const [actions, setActions] = useState<HistoryAction[]>([]);
  const [kindCounts, setKindCounts] = useState<ActionKindCount[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Stable keys, so a re-created array with the same contents does not re-fetch.
  const idsKey = [...pids].sort().join(',');
  const kindsKey = [...kinds].sort().join(',');
  const areaKey = area ? `${area.x}:${area.z}:${area.radius}` : '';

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const params = new URLSearchParams({ from: String(from), to: String(to) });
      if (idsKey) params.set('ids', idsKey);
      if (kindsKey) params.set('kinds', kindsKey);
      if (area) {
        params.set('x', String(area.x));
        params.set('z', String(area.z));
        params.set('radius', String(area.radius));
      }
      try {
        const res = await apiFetch(`/api/history/actions?${params}`);
        const body = res.ok ? await res.json() : null;
        if (cancelled) return;
        if (body && body.available === false) {
          setActions([]); setKindCounts([]);
          setError(body.error || body.reason || 'History is unavailable.');
        } else {
          setActions(body?.items ?? []);
          setKindCounts(body?.kinds ?? []);
          setTruncated(!!body?.truncated);
          setError(null);
        }
      } catch {
        if (!cancelled) { setActions([]); setError('Could not reach the server.'); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // areaKey rather than `area`: the object identity changes on every drag frame.
  }, [idsKey, kindsKey, areaKey, from, to, area]);

  return { actions, kindCounts, truncated, loading, error };
}

/**
 * A player's inventory snapshots, without their trees.
 *
 * `nonce` is what a fresh capture bumps: the snapshot arrives asynchronously over
 * /ingest/inventory up to a flush interval after the mod acks, so there is nothing
 * to await — the list is simply re-read.
 */
export function useInventorySnapshots(pid: string | null, from: number, to: number, nonce = 0) {
  const [snapshots, setSnapshots] = useState<InventorySummary[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!pid) { setSnapshots([]); return; }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await apiFetch(
          `/api/history/inventory?pid=${encodeURIComponent(pid)}&from=${from}&to=${to}`,
        );
        const body = res.ok ? await res.json() : null;
        if (!cancelled) setSnapshots(body?.items ?? []);
      } catch {
        if (!cancelled) setSnapshots([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [pid, from, to, nonce]);

  return { snapshots, loading };
}

/** One snapshot with its tree. Fetched only when a row is actually opened. */
export function useInventoryDetail(id: number | null) {
  const [snapshot, setSnapshot] = useState<InventorySnapshot | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (id === null) { setSnapshot(null); return; }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await apiFetch(`/api/history/inventory/${id}`);
        const body = res.ok ? await res.json() : null;
        if (!cancelled) setSnapshot(body && body.available !== false ? body : null);
      } catch {
        if (!cancelled) setSnapshot(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  return { snapshot, loading };
}

/**
 * The two actions that reach into the live game: capture a loadout now, and put a
 * stored one back.
 *
 * Unlike everything else in this file these are POSTs that change the world, so
 * they surface real errors rather than degrading to an empty state — a rollback
 * that quietly did nothing is far worse than one that says why it refused.
 */
export function usePlayerRestore() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RollbackResult | null>(null);

  const captureNow = useCallback(async (playerId: string): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch('/api/history/capture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error || 'The capture could not be requested.');
        return false;
      }
      return true;
    } catch {
      setError('Could not reach the server.');
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const rollback = useCallback(async (
    snapshotId: number,
    opts: { playerId?: string; allowTruncated?: boolean; restoreStats?: boolean } = {},
  ): Promise<RollbackResult | null> => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await apiFetch('/api/history/rollback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snapshotId, ...opts }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error || 'The rollback failed.');
        // A partial apply still comes back with counts, and those are exactly what
        // the operator needs to see — so keep the body even on a non-2xx.
        if (body && typeof body.applied === 'boolean') setResult(body);
        return null;
      }
      setResult(body);
      return body;
    } catch {
      setError('Could not reach the server.');
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  const reset = useCallback(() => { setError(null); setResult(null); }, []);

  return { busy, error, result, captureNow, rollback, reset };
}

/**
 * Who the companion mod says is connected right now.
 *
 * Read from the mod's own live push rather than through CF Tools — this tool has
 * to work on a server with no CF Tools binding, which is the whole reason it does
 * not gate on one. Polled, unlike everything else here, because it is the only
 * thing in the tool that describes the present rather than the record.
 */
export function useModOnline(pollMs = 10000) {
  const [online, setOnline] = useState<Set<string>>(new Set());
  const [connected, setConnected] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch('/api/history/online');
      const body = res.ok ? await res.json() : null;
      setConnected(!!body?.connected);
      setOnline(new Set<string>((body?.items ?? []).map((p: { pid: string }) => p.pid)));
    } catch {
      setConnected(false);
      setOnline(new Set());
    }
  }, []);

  useEffect(() => {
    load();
    if (!pollMs) return;
    const id = setInterval(() => { if (!document.hidden) load(); }, pollMs);
    return () => clearInterval(id);
  }, [load, pollMs]);

  return { online, connected, reload: load };
}
