import { memo, useMemo, useState } from 'react';
import { CalendarDateTime, fromDate, getLocalTimeZone, toCalendarDateTime } from '@internationalized/date';
import { Route, Play, Circle, ListTree, Loader2, Search } from 'lucide-react';
import { DatePicker } from '../base/datepicker/datepicker';
import { Badge } from '../base/badges/badges';
import { Input } from '../base/input/input';
import { cx } from '@/utils/cx';
import type { HistoryMode, HistoryPlayer } from '@/types/history';

/** Quick ranges, in hours back from now. */
const PRESETS: { label: string; hours: number }[] = [
  { label: '1h', hours: 1 },
  { label: '6h', hours: 6 },
  { label: '24h', hours: 24 },
  { label: '3d', hours: 72 },
  { label: '7d', hours: 168 },
];

const MODES: { key: HistoryMode; label: string; icon: React.ElementType }[] = [
  { key: 'paths', label: 'Paths', icon: Route },
  { key: 'playback', label: 'Playback', icon: Play },
  { key: 'area', label: 'Area', icon: Circle },
  { key: 'actions', label: 'Actions', icon: ListTree },
];

/** epoch ms -> the CalendarDateTime the shared DatePicker speaks. */
function toCalendar(ms: number): CalendarDateTime {
  return toCalendarDateTime(fromDate(new Date(ms), getLocalTimeZone()));
}

/** CalendarDateTime -> epoch ms, interpreted in the viewer's own zone. */
function fromCalendar(v: CalendarDateTime | null, fallback: number): number {
  if (!v) return fallback;
  return v.toDate(getLocalTimeZone()).getTime();
}

interface HistoryControlsProps {
  mode: HistoryMode;
  onModeChange: (mode: HistoryMode) => void;
  from: number;
  to: number;
  onRangeChange: (from: number, to: number) => void;
  players: HistoryPlayer[];
  playersLoading: boolean;
  selected: string[];
  /** Colour per selected pid. The single source; see trackColors. */
  colors: ReadonlyMap<string, string>;
  /** How many players may be selected at once. */
  maxSelected: number;
  onTogglePlayer: (pid: string) => void;
  onSelectOnly: (pid: string) => void;
  onSelectShown: (pids: string[]) => void;
  onClearPlayers: () => void;
  onHoverPlayer?: (pid: string | null) => void;
  /** Full span of recorded data, from /api/history/stats. Drives the "All" preset. */
  dataFrom?: number | null;
  dataTo?: number | null;
}

/**
 * Range picker, mode switch and player roster for the Player History tool.
 *
 * The roster lists exactly who has samples in the chosen window, which doubles as
 * the honest answer to "why is the map empty" — an empty roster means nobody was
 * recorded then, not that the selection is wrong.
 *
 * Times are handled in the viewer's local zone throughout (getLocalTimeZone), unlike
 * the ADM tooling which is pinned to UTC+10. History is stored as epoch ms precisely
 * so the presentation zone is a display concern rather than a parsing one.
 */
/**
 * Memoised: playback advances the playhead every animation frame, and this rail —
 * mode buttons, range pickers and the whole roster — has nothing to do with it. Its
 * props are stable callbacks for exactly this reason; keep them that way.
 */
const HistoryControls = memo(function HistoryControls({
  mode, onModeChange, from, to, onRangeChange,
  players, playersLoading, selected, colors, maxSelected,
  onTogglePlayer, onSelectOnly, onSelectShown, onClearPlayers,
  onHoverPlayer,
  dataFrom,
  dataTo,
}: HistoryControlsProps) {
  const selectedSet = new Set(selected);
  const atCap = selected.length >= maxSelected;

  const [query, setQuery] = useState('');

  // Sorted by the label the row actually shows, so the nameless rows (which fall back
  // to their pid) land where the operator sees them rather than where a null would.
  // The server orders by sample count; the copy is deliberate — `players` is the
  // hook's own state array.
  const sorted = useMemo(
    () => [...players].sort((a, b) => (a.name || a.pid).localeCompare(
      b.name || b.pid, undefined, { sensitivity: 'base', numeric: true },
    )),
    [players],
  );

  // steamId is matchable as well as the name: pasting a steam64 out of a ban list is
  // the other way an admin arrives at this roster.
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter(p =>
      (p.name || '').toLowerCase().includes(q)
      || p.pid.toLowerCase().includes(q)
      || (p.steamId || '').toLowerCase().includes(q));
  }, [sorted, query]);

  const applyPreset = (hours: number) => {
    const now = Date.now();
    onRangeChange(now - hours * 3600_000, now);
  };

  return (
    <div className="flex flex-col gap-3 min-h-0">
      {/* Mode. A 2x2 grid rather than one row: with four modes in a 256 px rail,
          "Playback" and "Actions" no longer fit side by side without truncating. */}
      <div className="grid grid-cols-2 gap-1">
        {MODES.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => onModeChange(key)}
            className={cx(
              'flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-xs font-medium border transition-colors',
              mode === key
                ? 'bg-primary-50 text-primary-700 border-primary-200 dark:bg-primary-900/20 dark:text-primary-300 dark:border-primary-800'
                : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50 dark:bg-gray-900 dark:text-gray-400 dark:border-gray-700',
            )}
          >
            <Icon size={13} />
            {label}
          </button>
        ))}
      </div>

      {/* Range */}
      <div className="space-y-2">
        <div className="flex items-center gap-1">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => applyPreset(p.hours)}
              className="flex-1 px-1.5 py-1 rounded-md text-[11px] font-medium border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              {p.label}
            </button>
          ))}
          {/* Imported admin logs can predate every relative preset by years, which
              leaves the map blank with no clue why. This jumps to whatever the
              store actually holds. */}
          {!!dataFrom && !!dataTo && (
            <button
              type="button"
              onClick={() => onRangeChange(dataFrom, dataTo)}
              title={`All recorded data: ${new Date(dataFrom).toLocaleString()} to ${new Date(dataTo).toLocaleString()}`}
              className="flex-1 px-1.5 py-1 rounded-md text-[11px] font-medium border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              All
            </button>
          )}
        </div>
        {/* An empty roster inside a range the data does not cover is the single most
            likely confusion after an import, so name the cause rather than showing
            an empty list. */}
        {!playersLoading && !players.length && !!dataFrom && !!dataTo
          && (from > dataTo || to < dataFrom) && (
          <p className="text-[11px] text-warning-700 dark:text-warning-400">
            No data in this range. Recorded history runs{' '}
            {new Date(dataFrom).toLocaleDateString()} – {new Date(dataTo).toLocaleDateString()}.
          </p>
        )}
        <DatePicker
          label="From"
          value={toCalendar(from)}
          onChange={(v) => onRangeChange(fromCalendar(v, from), to)}
          granularity="minute"
        />
        <DatePicker
          label="To"
          value={toCalendar(to)}
          onChange={(v) => onRangeChange(from, fromCalendar(v, to))}
          granularity="minute"
        />
      </div>

      {/* Roster */}
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-1.5">
          <h3 className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">
            Players
          </h3>
          {playersLoading && <Loader2 size={12} className="animate-spin text-gray-400" />}
          {/* While filtering, name both numbers — a bare "3" reads as a shrunken
              dataset rather than a narrowed view of it. */}
          {!playersLoading && (
            <Badge color="gray" size="sm">
              {shown.length === players.length ? players.length : `${shown.length} / ${players.length}`}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* "select visible" respects the filter above it, which is the point: it
              turns a search for a clan tag into a replay of that clan. */}
          {!playersLoading && shown.length > 1 && !atCap && (
            <button
              type="button"
              onClick={() => onSelectShown(shown.map(p => p.pid))}
              className="text-[11px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 underline decoration-dotted"
            >
              select visible
            </button>
          )}
          {selected.length > 0 && (
            <button
              type="button"
              onClick={onClearPlayers}
              className="text-[11px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 underline decoration-dotted"
            >
              {selected.length} selected · clear
            </button>
          )}
        </div>
      </div>

      {/* Multi-select is the whole point of the tool and nothing said so — the
          interaction was documented only in a row's title attribute. */}
      {!playersLoading && players.length > 0 && selected.length === 0 && (
        <p className="text-[11px] text-gray-400 dark:text-gray-500 shrink-0">
          Click to add · double-click to isolate
        </p>
      )}
      {atCap && (
        <p className="text-[11px] text-warning-700 dark:text-warning-400 shrink-0">
          {maxSelected} players maximum — colours repeat past that.
        </p>
      )}

      {/* Outside the scroll container below, so it stays pinned over a long roster. */}
      {!playersLoading && players.length > 0 && (
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
      )}

      <div className="flex-1 overflow-auto min-h-0 -mx-1">
        {!playersLoading && players.length === 0 && (
          <p className="px-1 text-xs text-gray-400 dark:text-gray-500">
            No players recorded in this window.
          </p>
        )}
        {/* An empty list under a filter is not an empty window, and saying so would
            send the operator off widening a range that was fine. */}
        {!playersLoading && players.length > 0 && shown.length === 0 && (
          <p className="px-1 text-xs text-gray-400 dark:text-gray-500">
            No players match that filter.
          </p>
        )}
        {shown.map((p) => {
          const on = selectedSet.has(p.pid);
          // Full at 8: show the refusal before the click rather than swallowing it.
          // Double-click still isolates, which is how you switch players at the cap.
          const blocked = atCap && !on;
          return (
            <button
              key={p.pid}
              type="button"
              // Dimmed rather than `disabled`: a disabled button swallows dblclick
              // too, and isolating is exactly how you swap players once full.
              aria-disabled={blocked}
              onClick={() => onTogglePlayer(p.pid)}
              onDoubleClick={() => onSelectOnly(p.pid)}
              onMouseEnter={() => onHoverPlayer?.(p.pid)}
              onMouseLeave={() => onHoverPlayer?.(null)}
              title={blocked
                ? `${p.name || p.pid}\n${p.samples} samples\nDouble-click to replay this player alone`
                : `${p.name || p.pid}\n${p.samples} samples\nDouble-click to isolate`}
              className={cx(
                'w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition-colors',
                blocked && 'opacity-50',
                on
                  ? 'bg-gray-100 dark:bg-gray-800'
                  : 'hover:bg-gray-50 dark:hover:bg-gray-800/50',
              )}
            >
              <span
                className={cx('h-2.5 w-2.5 rounded-full shrink-0 border',
                  on ? 'border-transparent' : 'border-gray-300 dark:border-gray-600')}
                // The swatch only means something once selected — an unselected row
                // has no colour, because nothing on the map is wearing one for it.
                style={{ backgroundColor: on ? colors.get(p.pid) : 'transparent' }}
              />
              <span className={cx('flex-1 truncate text-xs',
                on ? 'text-gray-900 dark:text-white font-medium' : 'text-gray-500 dark:text-gray-400')}>
                {p.name || p.pid}
              </span>
              <span className="text-[10px] text-gray-400 tabular-nums shrink-0">{p.samples}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
});

export default HistoryControls;