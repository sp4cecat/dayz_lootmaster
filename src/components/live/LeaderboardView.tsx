import { useCallback, useEffect, useState } from 'react';
import { Modal } from '../base/modal/modal';
import { Badge } from '../base/badges/badges';
import { Select } from '../base/select/select';
import { Trophy } from 'lucide-react';
import { cx } from '@/utils/cx';
import { apiFetch } from '@/utils/api';
import { useCfToolsStatus } from '@/hooks/useCfToolsStatus';
import PlayerDetailDrawer from './PlayerDetailDrawer';

interface LeaderboardViewProps {
  onClose: () => void;
  selectedProfileId?: string;
  isPanel?: boolean;
}

interface LeaderboardEntry {
  rank: number;
  cftools_id: string;
  latest_name: string;
  kills: number;
  deaths: number;
  kdratio: number;
  longest_kill: number;
  longest_shot: number;
  playtime: number;
  suicides: number;
  hits: number;
}

const STATS = [
  { value: 'kills', label: 'Kills' },
  { value: 'deaths', label: 'Deaths' },
  { value: 'kdratio', label: 'K/D ratio' },
  { value: 'longest_kill', label: 'Longest kill' },
  { value: 'longest_shot', label: 'Longest shot' },
  { value: 'playtime', label: 'Playtime' },
  { value: 'suicides', label: 'Suicides' },
];

const hours = (s: number) => `${(s / 3600).toFixed(1)} h`;

/** Server leaderboard via CF Tools; row click opens the per-player detail drawer. */
export default function LeaderboardView({ onClose, selectedProfileId, isPanel = false }: LeaderboardViewProps) {
  const { status } = useCfToolsStatus(selectedProfileId);
  const [stat, setStat] = useState('kills');
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [reason, setReason] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ id: string; name: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch(`/api/cftools/leaderboard?stat=${stat}&order=DESC&limit=50`, {
        profileId: selectedProfileId,
      });
      const body = res.ok ? await res.json() : null;
      if (body?.connected) {
        setEntries(Array.isArray(body.leaderboard) ? body.leaderboard : []);
        setReason(null);
      } else {
        setEntries([]);
        setReason(body?.reason || 'unreachable');
      }
    } catch {
      setEntries([]);
      setReason('unreachable');
    } finally {
      setLoading(false);
    }
  }, [selectedProfileId, stat]);

  useEffect(() => { load(); }, [load]);

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title="Leaderboard"
      description="Player rankings via the CF Tools Cloud Data API."
      icon={Trophy}
      inline={isPanel}
    >
      <div className="flex flex-col h-full gap-4">
        <div className="flex items-center gap-3 shrink-0">
          {status.connected
            ? <Badge color="success" size="sm">Connected{status.nickname ? ` — ${status.nickname}` : ''}</Badge>
            : <Badge color="gray" size="sm">Not connected</Badge>}
          <div className="w-44 ml-auto">
            <Select size="sm" options={STATS} value={stat} onChange={e => setStat(e.target.value)} />
          </div>
        </div>

        {loading ? (
          <p className="text-sm text-gray-400">Loading leaderboard…</p>
        ) : entries.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {reason ? 'Leaderboard unavailable — check the CF Tools connection.' : 'No ranked players yet.'}
          </p>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto rounded-xl border border-gray-200 dark:border-gray-800">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-gray-50 dark:bg-gray-900 text-left">
                <tr className="text-[11px] uppercase tracking-wider text-gray-400">
                  <th className="px-3 py-2 w-12">#</th>
                  <th className="px-3 py-2">Player</th>
                  <th className="px-3 py-2 text-right">Kills</th>
                  <th className="px-3 py-2 text-right">Deaths</th>
                  <th className="px-3 py-2 text-right">K/D</th>
                  <th className="px-3 py-2 text-right">Longest kill</th>
                  <th className="px-3 py-2 text-right">Playtime</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {entries.map(entry => (
                  <tr
                    key={entry.cftools_id}
                    onClick={() => setDetail({ id: entry.cftools_id, name: entry.latest_name })}
                    className={cx(
                      'cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-900/60',
                      entry.rank <= 3 && 'font-semibold',
                    )}
                  >
                    <td className="px-3 py-2 text-gray-400">{entry.rank}</td>
                    <td className="px-3 py-2 text-gray-900 dark:text-white">{entry.latest_name}</td>
                    <td className="px-3 py-2 text-right">{entry.kills?.toLocaleString?.() ?? entry.kills}</td>
                    <td className="px-3 py-2 text-right">{entry.deaths?.toLocaleString?.() ?? entry.deaths}</td>
                    <td className="px-3 py-2 text-right">{typeof entry.kdratio === 'number' ? entry.kdratio.toFixed(2) : '—'}</td>
                    <td className="px-3 py-2 text-right">{typeof entry.longest_kill === 'number' ? `${Math.round(entry.longest_kill)} m` : '—'}</td>
                    <td className="px-3 py-2 text-right">{typeof entry.playtime === 'number' ? hours(entry.playtime) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {detail && (
        <PlayerDetailDrawer
          cftoolsId={detail.id}
          playerName={detail.name}
          selectedProfileId={selectedProfileId}
          onClose={() => setDetail(null)}
        />
      )}
    </Modal>
  );
}
