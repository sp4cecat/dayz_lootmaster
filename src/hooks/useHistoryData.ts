import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/utils/api';
import type {
  ActionKindCount, AreaSelection, AreaVisit, EnforcementRow, HistoryAction, HistoryPlayer,
  HistoryStats, HistoryTrack, InventorySnapshot, InventorySummary, LadderRung,
  LootCycleDetectorStats, LootCyclePolicy, LootCyclePolicyUpdate, PlayerFlag, RollbackResult,
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
  pids: readonly string[],
  from: number,
  to: number,
  kinds: readonly string[] = [],
  area: AreaSelection | null = null,
  /**
   * False parks the hook: state clears and nothing is fetched. Needed because an
   * EMPTY `pids` is not "nobody" — the backend reads it as "everybody" — so a
   * caller with no selection cannot express "fetch nothing" through the ids alone.
   */
  enabled = true,
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
    if (!enabled) {
      setActions([]); setKindCounts([]); setTruncated(false); setError(null); setLoading(false);
      return;
    }
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
  }, [idsKey, kindsKey, areaKey, from, to, area, enabled]);

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
  // The server caps the list; this says whether the cap bit, so the panel can
  // tell the operator the oldest rows are missing rather than letting the list
  // read as the whole history.
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!pid) { setSnapshots([]); setTruncated(false); return; }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await apiFetch(
          `/api/history/inventory?pid=${encodeURIComponent(pid)}&from=${from}&to=${to}`,
        );
        const body = res.ok ? await res.json() : null;
        if (!cancelled) {
          setSnapshots(body?.items ?? []);
          setTruncated(!!body?.truncated);
        }
      } catch {
        if (!cancelled) { setSnapshots([]); setTruncated(false); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [pid, from, to, nonce]);

  return { snapshots, truncated, loading };
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

/* ------------------------------------------------------------------------- */
/* Loot-cycle flags                                                            */
/* ------------------------------------------------------------------------- */

export interface UseFlagsOptions {
  /** Lowest band to include; the backend filters, so "high" is cheap to poll. */
  minSeverity?: string;
  /** Include flags an operator has dismissed. */
  includeCleared?: boolean;
}

/**
 * Live player flags, with the detector's own health alongside them.
 *
 * Polled, like `useHistoryStats`, because flags describe the present: the runner
 * re-evaluates every 30 s and a flag that appeared since the last read is exactly
 * what an operator watching this list is waiting for. Pauses on a hidden tab.
 *
 * `available: false` is the recorder being off, not a fetch failure — the two are
 * split so the panel can say "turn HISTORY_ENABLED on" for one and "the backend is
 * unreachable" for the other.
 */
export function useFlags(pollMs = 15000, opts: UseFlagsOptions = {}) {
  const { minSeverity, includeCleared } = opts;
  const [items, setItems] = useState<PlayerFlag[]>([]);
  const [detector, setDetector] = useState<LootCycleDetectorStats | null>(null);
  const [available, setAvailable] = useState(true);
  const [reason, setReason] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Set once the backend says history is disabled: nothing will change until a
  // restart, so the timer stops rather than asking the same question all day.
  const stopRef = useRef(false);

  const load = useCallback(async () => {
    if (stopRef.current) return;
    const params = new URLSearchParams({ kind: 'loot_cycle' });
    if (minSeverity) params.set('minSeverity', minSeverity);
    if (includeCleared) params.set('includeCleared', '1');
    try {
      const res = await apiFetch(`/api/history/flags?${params}`);
      const body = res.ok ? await res.json() : null;
      if (!body) {
        setError(`The flags could not be read (HTTP ${res.status}).`);
        return;
      }
      if (body.available === false) {
        setAvailable(false);
        setReason(body.reason ?? null);
        setItems([]);
        setDetector(body.detector ?? null);
        setError(null);
        if (body.reason === 'disabled') stopRef.current = true;
        return;
      }
      setAvailable(true);
      setReason(null);
      setItems(body.items ?? []);
      setDetector(body.detector ?? null);
      setError(null);
    } catch {
      setError('Could not reach the server.');
    } finally {
      setLoading(false);
    }
  }, [minSeverity, includeCleared]);

  useEffect(() => {
    stopRef.current = false;
    load();
    if (!pollMs) return;
    const id = setInterval(() => { if (!document.hidden) load(); }, pollMs);
    return () => clearInterval(id);
  }, [load, pollMs]);

  return { items, detector, available, reason, loading, error, refresh: load };
}

/**
 * One player's flag in full: its cycles, its enforcement history, and the ladder
 * the policy currently defines (so the panel knows which rungs are left).
 *
 * `nonce` is what an enforcement or a dismissal bumps: both change the rows this
 * returns, and neither returns them, so the detail is simply re-read.
 */
export function useFlagDetail(pid: string | null, nonce = 0) {
  const [flag, setFlag] = useState<PlayerFlag | null>(null);
  const [enforcement, setEnforcement] = useState<EnforcementRow[]>([]);
  const [ladder, setLadder] = useState<LadderRung[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!pid) { setFlag(null); setEnforcement([]); setLadder([]); setError(null); return; }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await apiFetch(`/api/history/flags/${encodeURIComponent(pid)}`);
        const body = res.ok ? await res.json() : null;
        if (cancelled) return;
        if (!body || body.available === false) {
          setFlag(null); setEnforcement([]); setLadder([]);
          setError(body?.error || body?.reason || 'The flag could not be read.');
        } else {
          setFlag(body.flag ?? null);
          setEnforcement(body.enforcement ?? []);
          setLadder(body.ladder ?? []);
          setError(null);
        }
      } catch {
        if (!cancelled) { setFlag(null); setEnforcement([]); setError('Could not reach the server.'); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [pid, nonce]);

  return { flag, enforcement, ladder, loading, error };
}

/**
 * The loot-cycle policy: ladder, cooldown, webhook and the CF Tools profile.
 *
 * The webhook URL never comes back — the backend redacts it to `set: true` — so
 * `save` sends `webhook.url` only when the operator typed a new one (or `null`
 * to clear it). Omitting it is read as "no change", which is the default we want.
 */
export function useLootCyclePolicy() {
  const [policy, setPolicy] = useState<LootCyclePolicy | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/history/loot-cycle/policy');
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.policy) {
        setPolicy(null);
        setError(body?.error || body?.reason || `The policy could not be read (HTTP ${res.status}).`);
      } else {
        setPolicy(body.policy);
        setError(null);
      }
    } catch {
      setPolicy(null);
      setError('Could not reach the server.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = useCallback(async (partial: LootCyclePolicyUpdate): Promise<boolean> => {
    setError(null);
    try {
      const res = await apiFetch('/api/history/loot-cycle/policy', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(partial),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.policy) {
        setError(body?.error || body?.reason || `The policy was not saved (HTTP ${res.status}).`);
        return false;
      }
      setPolicy(body.policy);
      return true;
    } catch {
      setError('Could not reach the server.');
      return false;
    }
  }, []);

  return { policy, loading, error, save, reload: load };
}

/** The backend's `{ error, reason }` for a failed rung, in operator words. */
function describeEnforceError(status: number, body: { error?: string; reason?: string } | null): string {
  const reason = body?.reason || body?.error || '';
  switch (reason) {
    case 'no_binding':
      return 'No CF Tools binding: pick a profile with a linked server in the loot-cycle policy.';
    case 'player_not_found':
      return 'The player is not on the server, so nothing could be sent.';
    case 'mod_offline':
      return 'The companion mod is not connected, so no message can reach the player.';
    case 'rung_fired':
      return 'That rung has already fired for this episode.';
    default:
      if (reason) return reason;
      if (status === 504) return 'The mod did not acknowledge in time.';
      if (status === 503) return 'The mod or CF Tools is unavailable right now.';
      return `The action failed (HTTP ${status}).`;
  }
}

/**
 * The two operator actions on a flag: fire a ladder rung by hand, and dismiss.
 *
 * POSTs that reach a real player, so like `usePlayerRestore` they surface the
 * backend's reason (`no_binding`, `player_not_found`, a mod timeout) rather than
 * degrading to silence — a kick that quietly did nothing is the worst outcome.
 */
export function useEnforce() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enforce = useCallback(async (pid: string, rung: number): Promise<EnforcementRow | null> => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/history/flags/${encodeURIComponent(pid)}/enforce`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rung }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) {
        setError(describeEnforceError(res.status, body));
        return null;
      }
      return body.enforcement ?? null;
    } catch {
      setError('Could not reach the server.');
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  const clear = useCallback(async (pid: string): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/history/flags/${encodeURIComponent(pid)}/clear`, { method: 'POST' });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) {
        setError(body?.error || body?.reason || `The flag was not dismissed (HTTP ${res.status}).`);
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

  const reset = useCallback(() => setError(null), []);

  return { enforce, clear, busy, error, reset };
}
