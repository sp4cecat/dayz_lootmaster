import { useEffect, useState } from 'react';
import { apiFetch } from '@/utils/api';

/** The `game.dayz` block of the CF Tools v2 player payload. Fields vary by server. */
export interface DayzStats {
  kills?: { players?: number; infected?: number; animals?: number };
  deaths?: number;
  environment_deaths?: number;
  suicides?: number;
  kdratio?: number;
  longest_kill?: number;
  longest_shot?: number;
  hits?: number;
}

/** The `omega` block: CF Tools' own profile of the player on this server. */
export interface OmegaStats {
  playtime?: number;
  sessions?: number;
  name_history?: string[];
}

export interface CfToolsPlayerStats {
  loading: boolean;
  error: string | null;
  omega: OmegaStats | null;
  dayz: DayzStats | null;
}

/**
 * Per-player stats from the CF Tools v2 player endpoint, keyed by cftools_id.
 *
 * The payload is `{ [cftoolsId]: { omega, game: { dayz } }, identities }` and is
 * parsed defensively because the exact fields vary between servers. Shared by the
 * leaderboard's detail drawer and the live map's Stats tab, so the two never
 * disagree about what a field means. A null id short-circuits to an error rather
 * than a request: the caller has nothing to look up.
 */
export function useCfToolsPlayerStats(cftoolsId: string | null, profileId?: string): CfToolsPlayerStats {
  const [loading, setLoading] = useState(!!cftoolsId);
  const [error, setError] = useState<string | null>(cftoolsId ? null : 'No CF Tools id for this player.');
  const [omega, setOmega] = useState<OmegaStats | null>(null);
  const [dayz, setDayz] = useState<DayzStats | null>(null);

  useEffect(() => {
    if (!cftoolsId) {
      setLoading(false);
      setError('No CF Tools id for this player.');
      setOmega(null);
      setDayz(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await apiFetch(`/api/cftools/player?ref=${encodeURIComponent(cftoolsId)}`, { profileId });
        const body = res.ok ? await res.json() : null;
        if (cancelled) return;
        if (body?.connected && body.player) {
          const entry = body.player[cftoolsId] || Object.values(body.player).find(
            (v: unknown) => v && typeof v === 'object' && 'omega' in (v as object),
          );
          if (entry) {
            setOmega((entry as { omega?: OmegaStats }).omega ?? null);
            setDayz((entry as { game?: { dayz?: DayzStats } }).game?.dayz ?? null);
          } else {
            setError('No stats recorded for this player on this server.');
          }
        } else {
          setError('Player stats unavailable.');
        }
      } catch {
        if (!cancelled) setError('Player stats unavailable.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [cftoolsId, profileId]);

  return { loading, error, omega, dayz };
}

export default useCfToolsPlayerStats;
