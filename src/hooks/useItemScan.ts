import { useCallback, useState } from 'react';
import type { ItemScan } from '../types/items';

/**
 * Resolve the app's backend base URL (same rule as useTypeCatalog/useLootData):
 * the 4317 backend by default, overridable via localStorage['dayz-editor:apiBase'].
 */
function getApiBase(): string {
  const savedBase = typeof window !== 'undefined' ? localStorage.getItem('dayz-editor:apiBase') : null;
  const defaultBase = typeof window !== 'undefined'
    ? `${window.location.protocol}//${window.location.hostname}:4317`
    : 'http://localhost:4317';
  return (savedBase && savedBase.trim()) ? savedBase.trim().replace(/\/+$/, '') : defaultBase;
}

/** Turn a non-2xx scan response into a friendly message. */
async function messageForError(res: Response): Promise<string> {
  let serverMsg: string | null = null;
  try {
    const body = await res.json();
    serverMsg = body && typeof body.error === 'string' ? body.error : null;
  } catch { /* no JSON body */ }
  switch (res.status) {
    case 400: return serverMsg || 'Invalid scan coordinates.';
    case 404: return serverMsg || 'Player not found or offline.';
    case 503: return serverMsg || 'Companion mod not connected; live scan unavailable.';
    case 504: return serverMsg || 'The mod did not respond in time. Try again.';
    default: return serverMsg || `Scan failed (HTTP ${res.status}).`;
  }
}

/**
 * On-demand live world-item scanning via the backend's /items routes. Each scan
 * enqueues a scanItems command for the companion mod and blocks on the round-trip
 * (~2-4 s), so `loading` stays true for the duration.
 */
export function useItemScan() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ItemScan | null>(null);

  const run = useCallback(async (path: string): Promise<ItemScan | null> => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${getApiBase()}${path}`);
      if (!res.ok) {
        setError(await messageForError(res));
        return null;
      }
      const scan = (await res.json()) as ItemScan;
      setResult(scan);
      return scan;
    } catch {
      setError('Error connecting to server.');
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  /** Scan a region centred on world (x, z). radius defaults server-side to 30, capped at 200. */
  const scanRegion = useCallback((x: number, z: number, radius?: number) => {
    const params = new URLSearchParams({ x: String(x), z: String(z) });
    if (radius != null) params.set('radius', String(radius));
    return run(`/items?${params.toString()}`);
  }, [run]);

  /** Scan a region centred on an online player's current position. */
  const scanNearPlayer = useCallback((playerId: string, radius?: number) => {
    const params = new URLSearchParams();
    if (radius != null) params.set('radius', String(radius));
    const qs = params.toString();
    return run(`/items/near/${encodeURIComponent(playerId)}${qs ? `?${qs}` : ''}`);
  }, [run]);

  return { loading, error, result, scanRegion, scanNearPlayer };
}
