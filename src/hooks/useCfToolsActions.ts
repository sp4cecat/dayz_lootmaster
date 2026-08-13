import { useCallback, useState } from 'react';
import { apiFetch } from '../utils/api';

export interface ActionResult {
  ok: boolean;
  error?: string;
  /** spawn-loadout per-item results. */
  results?: { className: string; ok: boolean; error?: string }[];
}

/**
 * POST wrappers for the /api/cftools/actions/* routes with shared busy/error
 * state. Actions are user-triggered and return real errors (unlike the read
 * routes) — surface them, don't swallow them.
 */
export function useCfToolsActions(selectedProfileId?: string | null) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const post = useCallback(async (route: string, body: Record<string, unknown>): Promise<ActionResult> => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/cftools/${route}`, {
        method: 'POST',
        profileId: selectedProfileId ?? undefined,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message = data.error || `Action failed (HTTP ${res.status})`;
        setError(message);
        return { ok: false, error: message };
      }
      return { ok: data.ok !== false, results: data.results };
    } catch {
      setError('Backend unreachable.');
      return { ok: false, error: 'Backend unreachable.' };
    } finally {
      setBusy(false);
    }
  }, [selectedProfileId]);

  return {
    busy,
    error,
    clearError: useCallback(() => setError(null), []),
    kick: (sessionId: string, reason?: string) => post('actions/kick', { sessionId, reason }),
    message: (content: string, sessionId?: string) => post('actions/message', { content, sessionId }),
    raw: (command: string) => post('actions/raw', { command }),
    teleport: (steam64: string, x: number, z: number, y = 0) => post('actions/teleport', { steam64, x, y, z }),
    heal: (steam64: string) => post('actions/heal', { steam64 }),
    kill: (steam64: string) => post('actions/kill', { steam64 }),
    spawnItem: (steam64: string, className: string, quantity = 1) =>
      post('actions/spawn-item', { steam64, className, quantity }),
    spawnLoadout: (steam64: string, items: { className: string; quantity?: number }[]) =>
      post('actions/spawn-loadout', { steam64, items }),
    gameLabsAction: (actionCode: string, actionContext: string, referenceKey: string | null, parameters: Record<string, unknown>) =>
      post('gamelabs/action', { actionCode, actionContext, referenceKey, parameters }),
  };
}

export default useCfToolsActions;
