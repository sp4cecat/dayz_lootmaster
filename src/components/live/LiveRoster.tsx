import { memo, useMemo, useState } from 'react';
import { Search, Skull, Loader2, Users } from 'lucide-react';
import { Badge } from '../base/badges/badges';
import { Input } from '../base/input/input';
import { cx } from '@/utils/cx';
import { VITAL_MAX } from '@/utils/liveWindow';
import { severityChipClass, severityLabel, severityRank } from '@/utils/flagSeverity';
import type { LivePlayer } from '@/types/cftools';
import type { PlayerFlag } from '@/types/history';
import { livePlayerId } from './LiveMarkers';
import { VitalBar } from './VitalMeters';

export type RosterSort = 'name' | 'health' | 'ping' | 'flag';
export type RosterFilter = 'flagged' | 'dead' | 'loading';

const SORTS: { key: RosterSort; label: string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'health', label: 'Health' },
  { key: 'ping', label: 'Ping' },
  { key: 'flag', label: 'Flag' },
];

const FILTERS: { key: RosterFilter; label: string }[] = [
  { key: 'flagged', label: 'Flagged' },
  { key: 'dead', label: 'Dead' },
  { key: 'loading', label: 'Loading in' },
];

const CHIP_ON = 'bg-primary-50 text-primary-700 border-primary-200 dark:bg-primary-900/20 dark:text-primary-300 dark:border-primary-800';
const CHIP_OFF = 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50 dark:bg-gray-900 dark:text-gray-400 dark:border-gray-700';

/** Nulls always sort last: an unknown health is not a low one. */
function byNullable(a: number | null, b: number | null, dir: 1 | -1): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return (a - b) * dir;
}

const byName = (a: LivePlayer, b: LivePlayer) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });

/**
 * Sort a roster. Exported so the ordering rules can be tested without rendering.
 * Every sort ties back to name so the list never jitters between snapshot polls.
 */
export function sortRoster(
  players: LivePlayer[],
  sort: RosterSort,
  flags: ReadonlyMap<string, PlayerFlag>,
): LivePlayer[] {
  const flagOf = (p: LivePlayer) => (p.steamId ? flags.get(p.steamId) ?? null : null);
  const out = [...players];
  switch (sort) {
    case 'health':
      // Lowest first: the one about to die is the one worth looking at.
      out.sort((a, b) => byNullable(a.health, b.health, 1) || byName(a, b));
      break;
    case 'ping':
      // Worst first, for the same reason.
      out.sort((a, b) => byNullable(a.ping, b.ping, -1) || byName(a, b));
      break;
    case 'flag':
      out.sort((a, b) => {
        const fa = flagOf(a); const fb = flagOf(b);
        return byNullable(fa ? severityRank(fa.severity) : null, fb ? severityRank(fb.severity) : null, -1)
          || byNullable(fa?.score ?? null, fb?.score ?? null, -1)
          || byName(a, b);
      });
      break;
    default:
      out.sort(byName);
  }
  return out;
}

interface LiveRosterProps {
  players: LivePlayer[];
  /** The players layer is being served from cache during an outage. */
  stale?: boolean;
  /** The players layer failed upstream; `players` is then empty for a reason. */
  layerError?: string;
  /** Marker id of the selected player (see `livePlayerId`), or null. */
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Live loot-cycle flags keyed by steam64. */
  flags: ReadonlyMap<string, PlayerFlag>;
}

/**
 * Everyone connected right now, as a left rail on the Live Map.
 *
 * Reads only the snapshot the map already polls, so it works on a CF-Tools-only
 * server with no history at all; the flag chips and health bars simply stay absent
 * when their sources are. Memoised because the snapshot re-renders the map every
 * 5 s and the rail has nothing to do with most of what changes.
 */
const LiveRoster = memo(function LiveRoster({
  players, stale, layerError, selectedId, onSelect, flags,
}: LiveRosterProps) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<RosterSort>('name');
  const [filters, setFilters] = useState<Set<RosterFilter>>(() => new Set());

  const toggleFilter = (key: RosterFilter) => setFilters(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = players.filter((p) => {
      if (q && !p.name.toLowerCase().includes(q) && !(p.steamId || '').includes(q)) return false;
      if (filters.has('flagged') && !(p.steamId && flags.has(p.steamId))) return false;
      if (filters.has('dead') && p.alive !== false) return false;
      if (filters.has('loading') && (p.loaded || p.position)) return false;
      return true;
    });
    return sortRoster(list, sort, flags);
  }, [players, query, filters, sort, flags]);

  const filtering = !!query.trim() || filters.size > 0;

  return (
    <div
      data-testid="live-roster"
      className={cx(
        'w-64 shrink-0 flex flex-col gap-2 min-h-0 border-r border-gray-200 dark:border-gray-800 pr-3',
        stale && 'opacity-75',
      )}
    >
      <div className="flex items-center gap-1.5 shrink-0">
        <Users size={14} className="text-primary-600 dark:text-primary-400" />
        <h3 className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">
          Online
        </h3>
        <Badge color="gray" size="sm">
          {filtering && shown.length !== players.length ? `${shown.length} / ${players.length}` : players.length}
        </Badge>
        {stale && <Badge color="warning" size="sm">stale</Badge>}
      </div>

      <Input
        size="sm"
        icon={Search}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onClear={() => setQuery('')}
        placeholder="Filter players..."
        aria-label="Filter players"
        className="shrink-0"
      />

      {/* Sort and filter chips. Two rows rather than a dropdown: with four of each
          they fit, and the state is visible without opening anything. */}
      <div className="flex flex-wrap items-center gap-1 shrink-0" role="group" aria-label="Sort by">
        <span className="text-[10px] text-gray-400 mr-0.5">Sort</span>
        {SORTS.map(s => (
          <button
            key={s.key}
            type="button"
            aria-pressed={sort === s.key}
            onClick={() => setSort(s.key)}
            className={cx('px-1.5 py-0.5 rounded-md text-[10px] font-medium border transition-colors', sort === s.key ? CHIP_ON : CHIP_OFF)}
          >
            {s.label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1 shrink-0" role="group" aria-label="Filter">
        <span className="text-[10px] text-gray-400 mr-0.5">Show</span>
        {FILTERS.map(f => (
          <button
            key={f.key}
            type="button"
            aria-pressed={filters.has(f.key)}
            onClick={() => toggleFilter(f.key)}
            className={cx('px-1.5 py-0.5 rounded-md text-[10px] font-medium border transition-colors', filters.has(f.key) ? CHIP_ON : CHIP_OFF)}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto min-h-0 -mx-1">
        {layerError && (
          <p className="px-1 text-xs text-warning-700 dark:text-warning-400">
            Player list unavailable ({layerError}).
          </p>
        )}
        {!layerError && players.length === 0 && (
          <p className="px-1 text-xs text-gray-400 dark:text-gray-500">Nobody is online.</p>
        )}
        {players.length > 0 && shown.length === 0 && (
          <p className="px-1 text-xs text-gray-400 dark:text-gray-500">No players match.</p>
        )}
        {shown.map((p) => {
          const id = livePlayerId(p);
          const on = id === selectedId;
          const flag = p.steamId ? flags.get(p.steamId) ?? null : null;
          const loadingIn = !p.loaded && !p.position;
          return (
            <button
              key={id}
              type="button"
              data-testid="roster-row"
              aria-pressed={on}
              onClick={() => onSelect(id)}
              title={[p.name, p.steamId, p.health != null ? `HP ${Math.round(p.health)}` : null]
                .filter(Boolean).join('\n')}
              className={cx(
                'w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition-colors',
                on ? 'bg-primary-50 dark:bg-primary-900/20' : 'hover:bg-gray-50 dark:hover:bg-gray-800/50',
              )}
            >
              <span className="min-w-0 flex-1">
                <span className={cx('flex items-center gap-1.5 text-xs truncate',
                  on ? 'text-primary-700 dark:text-primary-300 font-medium' : 'text-gray-900 dark:text-white')}>
                  {p.alive === false && <Skull size={11} className="shrink-0 text-error-500" />}
                  <span className="truncate" data-testid="roster-name">{p.name}</span>
                </span>
                <span className="flex items-center gap-1.5 mt-0.5">
                  {p.health != null && (
                    <VitalBar compact value={p.health} max={VITAL_MAX.health} tone="bg-success-500" title={`HP ${Math.round(p.health)}`} />
                  )}
                  {p.ping != null && (
                    <span className="text-[10px] text-gray-400 tabular-nums">{p.ping} ms</span>
                  )}
                  {loadingIn && (
                    <span className="inline-flex items-center gap-0.5 text-[10px] text-gray-400">
                      <Loader2 size={9} className="animate-spin" /> loading in
                    </span>
                  )}
                </span>
              </span>
              {flag && (
                <span
                  className={cx('px-1.5 py-0.5 rounded-md text-[10px] font-medium border shrink-0', severityChipClass(flag.severity))}
                  title={`Loot cycling: ${severityLabel(flag.severity)} (${flag.score})`}
                >
                  {severityLabel(flag.severity)}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
});

export default LiveRoster;
