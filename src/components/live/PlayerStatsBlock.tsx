import type { CfToolsPlayerStats } from '@/hooks/useCfToolsPlayerStats';

const fmtM = (v?: number) => (typeof v === 'number' ? `${Math.round(v)} m` : '—');
const fmtNum = (v?: number) => (typeof v === 'number' ? v.toLocaleString() : '—');
const fmtHours = (seconds?: number) =>
  typeof seconds === 'number' ? `${(seconds / 3600).toFixed(1)} h` : '—';

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-gray-100 dark:border-gray-800 last:border-0">
      <span className="text-xs text-gray-500 dark:text-gray-400">{label}</span>
      <span className="text-xs font-medium text-gray-900 dark:text-white text-right">{value}</span>
    </div>
  );
}

/**
 * CF Tools profile and combat stats for one player, as two row groups.
 *
 * Presentational: takes the hook's result so the leaderboard drawer (a modal)
 * and the live map's Stats tab (a rail) render exactly the same rows.
 */
export default function PlayerStatsBlock({ loading, error, omega, dayz }: CfToolsPlayerStats) {
  if (loading) return <p className="text-sm text-gray-400">Loading player stats…</p>;
  if (error) return <p className="text-sm text-gray-500 dark:text-gray-400">{error}</p>;
  return (
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
  );
}
