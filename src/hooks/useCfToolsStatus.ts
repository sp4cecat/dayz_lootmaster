import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../utils/api';

/**
 * Which map-point actions this server advertises. Separate from `gameLabs`
 * because only `spawnItem` is stock: the other three come from the spacecat
 * action PBOs, so a plain GameLabs server has gameLabs=true and the rest false.
 * The Live Map hides the menu items it can't fire rather than showing duds.
 */
export interface CfToolsWorldActions {
  /** Stock CFCloud_SpawnItemWorld — spawn one item at coordinates. */
  spawnItem: boolean;
  spawnAi: boolean;
  airdrop: boolean;
  /** Nested loadout tree in one call; without it the map falls back to spawnItem. */
  spawnPile: boolean;
}

export interface CfToolsCapabilities {
  /** Session/player data (GSM) available on this grant. */
  gsm: boolean;
  /** GameLabs mod installed — vehicles/events layers + admin actions. */
  gameLabs: boolean;
  worldActions?: CfToolsWorldActions;
}

export interface CfToolsStatus {
  connected: boolean;
  /** Degradation reason when disconnected (house vocabulary). */
  reason?: 'not_configured' | 'no_api_id' | 'no_profile' | 'auth_failed' | 'no_grant' | 'rate_limited' | 'unreachable';
  stale?: boolean;
  apiId?: string | null;
  nickname?: string | null;
  capabilities?: CfToolsCapabilities;
}

const DISCONNECTED: CfToolsStatus = { connected: false, reason: 'unreachable' };

/**
 * Polls /api/cftools/status every 10s (mirrors the catalog health poll).
 * Everything degrades gracefully: an unreachable backend or unconfigured
 * CF Tools app yields { connected:false, reason } — consumers gate features
 * per-capability, never crash.
 */
export function useCfToolsStatus(selectedProfileId?: string | null) {
  const [status, setStatus] = useState<CfToolsStatus>(DISCONNECTED);
  const [reloadTick, setReloadTick] = useState(0);

  const reload = useCallback(() => setReloadTick(t => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await apiFetch('/api/cftools/status', { profileId: selectedProfileId ?? undefined });
        const body = res.ok ? await res.json() : null;
        if (!cancelled) setStatus(body && typeof body.connected === 'boolean' ? body : DISCONNECTED);
      } catch {
        if (!cancelled) setStatus(DISCONNECTED);
      }
    };
    poll();
    const id = setInterval(poll, 10000);
    return () => { cancelled = true; clearInterval(id); };
  }, [selectedProfileId, reloadTick]);

  return { status, reload };
}

export default useCfToolsStatus;
