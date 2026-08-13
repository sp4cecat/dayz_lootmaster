import { useEffect, useState } from 'react';
import { Modal } from '../base/modal/modal';
import { User } from 'lucide-react';
import { apiFetch } from '@/utils/api';

interface PlayerDetailDrawerProps {
  cftoolsId: string;
  playerName?: string;
  selectedProfileId?: string;
  onClose: () => void;
}

interface DayzStats {
  kills?: { players?: number; infected?: number; animals?: number };
  deaths?: number;
  environment_deaths?: number;
  suicides?: number;
  kdratio?: number;
  longest_kill?: number;
  longest_shot?: number;
  hits?: number;
}

const fmtM = (v?: number) => (typeof v === 'number' ? `${Math.round(v)} m` : '—');
const fmtNum = (v?: number) => (typeof v === 'number' ? v.toLocaleString() : '—');
const fmtHours = (seconds?: number) =>
  typeof seconds === 'number' ? `${(seconds / 3600).toFixed(1)} h` : '—';

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-gray-100 dark:border-gray-800 last:border-0">
      <span className="text-xs text-gray-500 dark:text-gray-400">{label}</span>
      <span className="text-xs font-medium text-gray-900 dark:text-white">{value}</span>
    </div>
  );
}

/**
 * Per-player stats from the CF Tools v2 player endpoint. The payload is keyed
 * by cftools_id ({ [id]: { omega, game: { dayz } }, identities }) — parsed
 * defensively since exact fields vary.
 */
export default function PlayerDetailDrawer({ cftoolsId, playerName, selectedProfileId, onClose }: PlayerDetailDrawerProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [omega, setOmega] = useState<{ playtime?: number; sessions?: number; name_history?: string[] } | null>(null);
  const [dayz, setDayz] = useState<DayzStats | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await apiFetch(`/api/cftools/player?ref=${encodeURIComponent(cftoolsId)}`, {
          profileId: selectedProfileId,
        });
        const body = res.ok ? await res.json() : null;
        if (cancelled) return;
        if (body?.connected && body.player) {
          const entry = body.player[cftoolsId] || Object.values(body.player).find(
            (v: unknown) => v && typeof v === 'object' && 'omega' in (v as object),
          );
          if (entry) {
            setOmega((entry as { omega?: typeof omega }).omega ?? null);
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
  }, [cftoolsId, selectedProfileId]);

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title={playerName || 'Player details'}
      description={cftoolsId}
      icon={User}
      maxWidth="max-w-md"
    >
      {loading ? (
        <p className="text-sm text-gray-400">Loading player stats…</p>
      ) : error ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">{error}</p>
      ) : (
        <div className="space-y-4">
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-1">Profile</h4>
            <Row label="Playtime" value={fmtHours(omega?.playtime)} />
            <Row label="Sessions" value={fmtNum(omega?.sessions)} />
            {!!omega?.name_history?.length && (
              <Row label="Known names" value={omega.name_history.slice(0, 5).join(', ')} />
            )}
          </div>
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-1">Combat</h4>
            <Row label="Player kills" value={fmtNum(dayz?.kills?.players)} />
            <Row label="Infected kills" value={fmtNum(dayz?.kills?.infected)} />
            <Row label="Deaths" value={fmtNum(dayz?.deaths)} />
            <Row label="Suicides" value={fmtNum(dayz?.suicides)} />
            <Row label="K/D ratio" value={typeof dayz?.kdratio === 'number' ? dayz.kdratio.toFixed(2) : '—'} />
            <Row label="Longest kill" value={fmtM(dayz?.longest_kill)} />
            <Row label="Longest shot" value={fmtM(dayz?.longest_shot)} />
            <Row label="Hits" value={fmtNum(dayz?.hits)} />
          </div>
        </div>
      )}
    </Modal>
  );
}
