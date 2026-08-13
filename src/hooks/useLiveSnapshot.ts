import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../utils/api';
import type { LiveLayerKey, LiveSnapshot } from '../types/cftools';

const POLL_MS = 5000;

/**
 * Polls the combined /api/cftools/live endpoint every 5s while mounted.
 * Upstream fetch cadence is bounded by the backend's per-route TTL caches, so
 * this poll rate never multiplies CF Tools traffic. Paused while the tab is
 * hidden (document.hidden) — the map isn't visible, don't burn the budget.
 */
export function useLiveSnapshot(
  selectedProfileId: string | null | undefined,
  layers: LiveLayerKey[],
  enabled = true,
) {
  const [snapshot, setSnapshot] = useState<LiveSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  // Stable key so a re-created array with the same layers doesn't re-arm the poll.
  const layersKey = [...layers].sort().join(',');
  const firstLoadDone = useRef(false);

  useEffect(() => {
    if (!enabled || !layersKey) { setSnapshot(null); firstLoadDone.current = false; return; }
    let cancelled = false;

    const poll = async () => {
      if (document.hidden) return;
      if (!firstLoadDone.current) setLoading(true);
      try {
        const res = await apiFetch(`/api/cftools/live?layers=${layersKey}`, {
          profileId: selectedProfileId ?? undefined,
        });
        const body = res.ok ? await res.json() : null;
        if (!cancelled) {
          setSnapshot(body && typeof body.connected === 'boolean' ? body : { connected: false, reason: 'unreachable' });
        }
      } catch {
        if (!cancelled) setSnapshot({ connected: false, reason: 'unreachable' });
      } finally {
        if (!cancelled) { setLoading(false); firstLoadDone.current = true; }
      }
    };

    poll();
    const id = setInterval(poll, POLL_MS);
    // Catch up immediately when the tab becomes visible again.
    const onVisible = () => { if (!document.hidden) poll(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [selectedProfileId, layersKey, enabled]);

  return { snapshot, loading };
}

export default useLiveSnapshot;
