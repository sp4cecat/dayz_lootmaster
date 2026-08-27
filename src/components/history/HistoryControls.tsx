import { CalendarDateTime, fromDate, getLocalTimeZone, toCalendarDateTime } from '@internationalized/date';
import { Route, Play, Circle, Loader2 } from 'lucide-react';
import { DatePicker } from '../base/datepicker/datepicker';
import { Badge } from '../base/badges/badges';
import { cx } from '@/utils/cx';
import { trackColor } from '@/utils/trackColors';
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
  onTogglePlayer: (pid: string) => void;
  onSelectOnly: (pid: string) => void;
  onClearPlayers: () => void;
  onHoverPlayer?: (pid: string | null) => void;
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
export default function HistoryControls({
  mode, onModeChange, from, to, onRangeChange,
  players, playersLoading, selected, onTogglePlayer, onSelectOnly, onClearPlayers,
  onHoverPlayer,
}: HistoryControlsProps) {
  const selectedSet = new Set(selected);
  const indexOf = (pid: string) => selected.indexOf(pid);

  const applyPreset = (hours: number) => {
    const now = Date.now();
    onRangeChange(now - hours * 3600_000, now);
  };

  return (
    <div className="flex flex-col gap-3 min-h-0">
      {/* Mode */}
      <div className="flex items-center gap-1">
        {MODES.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => onModeChange(key)}
            className={cx(
              'flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-xs font-medium border transition-colors',
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
        </div>
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
          {!playersLoading && <Badge color="gray" size="sm">{players.length}</Badge>}
        </div>
        {selected.length > 0 && (
          <button
            type="button"
            onClick={onClearPlayers}
            className="text-[11px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 underline decoration-dotted"
          >
            clear
          </button>
        )}
      </div>

      <div className="flex-1 overflow-auto min-h-0 -mx-1">
        {!playersLoading && players.length === 0 && (
          <p className="px-1 text-xs text-gray-400 dark:text-gray-500">
            No players recorded in this window.
          </p>
        )}
        {players.map((p) => {
          const on = selectedSet.has(p.pid);
          const i = indexOf(p.pid);
          return (
            <button
              key={p.pid}
              type="button"
              onClick={() => onTogglePlayer(p.pid)}
              onDoubleClick={() => onSelectOnly(p.pid)}
              onMouseEnter={() => onHoverPlayer?.(p.pid)}
              onMouseLeave={() => onHoverPlayer?.(null)}
              title={`${p.name || p.pid}\n${p.samples} samples\nDouble-click to isolate`}
              className={cx(
                'w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition-colors',
                on
                  ? 'bg-gray-100 dark:bg-gray-800'
                  : 'hover:bg-gray-50 dark:hover:bg-gray-800/50',
              )}
            >
              <span
                className={cx('h-2.5 w-2.5 rounded-full shrink-0 border',
                  on ? 'border-transparent' : 'border-gray-300 dark:border-gray-600')}
                // Colour has to agree with TrackLayer, which keys off the selection
                // order — so the swatch is only meaningful once a player is selected.
                style={{ backgroundColor: on && i >= 0 ? trackColor(i) : 'transparent' }}
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
}
