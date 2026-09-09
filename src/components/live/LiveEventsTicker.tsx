import { useMemo } from 'react';
import { Activity, Loader2 } from 'lucide-react';
import { useHistoryActions } from '@/hooks/useHistoryData';
import { TICKER_KINDS, TICKER_SPAN_MS } from '@/utils/liveWindow';
import { actionKindStyle } from '@/utils/actionKinds';
import { actorTypeLabel, parseKv, parseVictim } from '@/utils/actionDetail';
import { formatDuration } from '@/utils/duration';
import { cx } from '@/utils/cx';
import type { LivePlayer } from '@/types/cftools';
import type { HistoryAction } from '@/types/history';
import { livePlayerId } from './LiveMarkers';

interface LiveEventsTickerProps {
  /** From `useQuantisedNow`. */
  now: number;
  /** History backend available. */
  enabled: boolean;
  /** Why it is not, when it is not ('disabled' | 'error' | null). */
  historyReason: string | null;
  players: LivePlayer[];
  onSelectPlayer: (id: string) => void;
}

const NO_IDS: string[] = [];

/**
 * The other party in a row, for the small line under the actor: ` · by Bob` on a
 * death, ` · Bob` (or ` · infected`) on a kill. A steam id becomes a name only when
 * that player is online right now — the ticker has no other name source and a
 * 17-digit id is still more useful than nothing.
 */
function subline(a: HistoryAction, nameBySteam: Map<string, string>): string {
  const kv = parseKv(a.detail);
  if (!kv) return '';
  if (kv.killer) return ` · by ${nameBySteam.get(kv.killer) ?? kv.killer}`;
  if (a.kind === 'kill') {
    const victim = parseVictim(kv);
    if (!victim) return '';
    if (victim.type === 'player' && victim.pid) return ` · ${nameBySteam.get(victim.pid) ?? victim.pid}`;
    return ` · ${actorTypeLabel(victim.type)}`;
  }
  return '';
}

/**
 * What just happened, server-wide: the last quarter hour of deaths, kills, connects
 * and enforcement across everybody, for the rail's no-selection state.
 *
 * An empty `ids` list is a deliberate server-wide query here (the backend reads
 * it as "everyone"); `enabled` is what stops it running with history off.
 */
export default function LiveEventsTicker({ now, enabled, historyReason, players, onSelectPlayer }: LiveEventsTickerProps) {
  const { actions, loading, error } = useHistoryActions(NO_IDS, now - TICKER_SPAN_MS, now, TICKER_KINDS, null, enabled);

  // Newest first — the opposite of a feed you scroll through, because this one
  // is glanced at.
  const rows = useMemo(() => [...actions].reverse(), [actions]);
  const onlineBySteam = useMemo(
    () => new Map(players.filter(p => p.steamId).map(p => [p.steamId as string, livePlayerId(p)])),
    [players],
  );
  const nameBySteam = useMemo(
    () => new Map(players.filter(p => p.steamId && p.name).map(p => [p.steamId as string, p.name as string])),
    [players],
  );

  return (
    <div data-testid="live-events-ticker" className="mt-3">
      <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1">
        <Activity size={11} /> Last {Math.round(TICKER_SPAN_MS / 60_000)} min
        {loading && <Loader2 size={10} className="animate-spin" />}
      </p>
      {!enabled ? (
        <p className="text-[11px] text-gray-400 dark:text-gray-500">
          {historyReason === 'disabled'
            ? 'History recording is off — set HISTORY_ENABLED=1 on the backend for a live event feed.'
            : 'History is unavailable, so there is no event feed.'}
        </p>
      ) : error ? (
        <p className="text-[11px] text-error-600 dark:text-error-400">{error}</p>
      ) : !loading && rows.length === 0 ? (
        <p className="text-[11px] text-gray-400 dark:text-gray-500">Nothing recorded in the last 15 minutes.</p>
      ) : (
        <ul className="space-y-0.5">
          {rows.map((a) => {
            const style = actionKindStyle(a.kind);
            const Icon = style.icon;
            const target = a.pid ? onlineBySteam.get(a.pid) : undefined;
            const body = (
              <>
                <Icon size={12} className="mt-0.5 shrink-0" style={{ color: style.color }} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[11px] text-gray-800 dark:text-gray-200 truncate">
                    <span className="font-medium">{a.name || a.pid || 'Unattributed'}</span>
                    <span className="text-gray-500 dark:text-gray-400"> · {style.label.toLowerCase()}</span>
                  </span>
                  <span className="block text-[10px] text-gray-400 dark:text-gray-500 tabular-nums truncate">
                    {formatDuration(Math.max(0, now - a.ts))} ago
                    {subline(a, nameBySteam)}
                  </span>
                </span>
              </>
            );
            return (
              <li key={a.id}>
                {target ? (
                  <button
                    type="button"
                    data-testid="ticker-row"
                    onClick={() => onSelectPlayer(target)}
                    className={cx('w-full flex items-start gap-1.5 rounded px-1 py-0.5 text-left',
                      'hover:bg-gray-100 dark:hover:bg-gray-800/60')}
                    title="Select this player"
                  >
                    {body}
                  </button>
                ) : (
                  <div data-testid="ticker-row" className="flex items-start gap-1.5 px-1 py-0.5 opacity-80">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
