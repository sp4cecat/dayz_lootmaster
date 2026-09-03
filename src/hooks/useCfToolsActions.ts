import { useCallback, useState } from 'react';
import { apiFetch } from '../utils/api';

/** One entry of a batched action's per-target outcome. */
export interface ActionItemResult {
  ok: boolean;
  error?: string;
  /** Set by the item-spawning routes. */
  className?: string;
  /** Set by teleport-all, so a partial failure can name who didn't move. */
  steam64?: string;
  name?: string;
}

export interface ActionResult {
  ok: boolean;
  error?: string;
  /** Per-target results from the batched routes (spawn-loadout, spawn-pile, teleport-all). */
  results?: ActionItemResult[];
}

/** A node of the full-fidelity ground-pile tree. Mirrors what the mod's Execute walks. */
export interface SpawnTreeNode {
  className: string;
  quantity?: number;
  attachments?: SpawnTreeNode[];
  cargo?: SpawnTreeNode[];
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

    // --- World-context: these target a map point, not an entity. ---
    teleportAll: (players: { steam64: string; name?: string }[], x: number, z: number) =>
      post('actions/teleport-all', { players, x, z }),
    spawnItemWorld: (x: number, z: number, className: string, quantity = 1) =>
      post('actions/spawn-world-item', { x, z, className, quantity }),
    spawnAi: (x: number, z: number, opts: { kind?: string; count?: number; faction?: string; loadout?: string } = {}) =>
      post('actions/spawn-ai', { x, z, ...opts }),
    startAirdrop: (x: number, z: number, mission: string) =>
      post('actions/airdrop', { x, z, mission }),
    /** Full-fidelity pile — one call, nesting preserved. Needs the spacecat action PBO. */
    spawnPile: (x: number, z: number, tree: SpawnTreeNode[]) =>
      post('actions/spawn-pile', { x, z, tree }),
    /** Flat fallback for servers without the mod: one world spawn per item. */
    spawnPileFlat: (x: number, z: number, items: { className: string; quantity?: number }[]) =>
      post('actions/spawn-pile', { x, z, items }),
  };
}

export default useCfToolsActions;
