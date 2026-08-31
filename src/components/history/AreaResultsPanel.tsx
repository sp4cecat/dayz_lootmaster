import { Users, FileText, Loader2, AlertTriangle } from 'lucide-react';
import { Badge } from '../base/badges/badges';
import { Button } from '../base/button/button';
import { cx } from '@/utils/cx';
import { formatDuration } from '@/utils/duration';
import type { AreaSelection, AreaVisit } from '@/types/history';

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

interface AreaResultsPanelProps {
  area: AreaSelection | null;
  visits: AreaVisit[] | null;
  loading: boolean;
  error: string | null;
  /** Highlight a player's whole track when their visit is hovered. */
  onHoverPlayer?: (pid: string | null) => void;
  /** Hand this area + window to the ADM log search. */
  onSearchAdm?: () => void;
  /** Oldest recorded sample, so we can say when the window predates the recording. */
  recordedFrom: number | null;
  windowFrom: number;
}

/**
 * Results of an area presence query: who was inside the circle, when, and how close.
 *
 * Visits, not points. Consecutive in-radius samples collapse server-side into one
 * row per continuous presence — a raw dump of every 5 s sample would be thousands of
 * rows all saying "this player stood here", and the questions worth asking (when,
 * for how long, how close) are interval questions.
 */
export default function AreaResultsPanel({
  area, visits, loading, error, onHoverPlayer, onSearchAdm, recordedFrom, windowFrom,
}: AreaResultsPanelProps) {
  // The recorder only knows what it was running for. A window that starts before the
  // first recorded sample will look empty for reasons that have nothing to do with
  // where players went, so say so rather than letting it read as "nobody came here".
  const predatesRecording = recordedFrom !== null && windowFrom < recordedFrom;

  if (!area) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center px-6">
        <Users size={28} className="text-gray-300 dark:text-gray-600" />
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Drag a circle on the map to see who was inside it.
        </p>
      </div>
    );
  }

  const byPlayer = new Map<string, AreaVisit[]>();
  for (const v of visits ?? []) {
    const list = byPlayer.get(v.pid);
    if (list) list.push(v); else byPlayer.set(v.pid, [v]);
  }

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-800 shrink-0">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Area presence</h3>
          {loading && <Loader2 size={13} className="animate-spin text-gray-400" />}
          {!loading && visits && (
            <Badge color={byPlayer.size ? 'brand' : 'gray'} size="sm">
              {byPlayer.size} player{byPlayer.size === 1 ? '' : 's'}
            </Badge>
          )}
        </div>
        <p className="text-[11px] text-gray-400 dark:text-gray-500 font-mono mt-0.5">
          {area.x}, {area.z} · radius {area.radius} m
        </p>
      </div>

      {error && (
        <div className="m-3 p-2.5 rounded-lg bg-error-50 dark:bg-error-900/20 border border-error-200 dark:border-error-800 flex gap-2">
          <AlertTriangle size={14} className="text-error-500 shrink-0 mt-0.5" />
          <p className="text-xs text-error-700 dark:text-error-300">{error}</p>
        </div>
      )}

      <div className="flex-1 overflow-auto min-h-0">
        {!loading && visits && visits.length === 0 && (
          <div className="p-4 text-center">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              No recorded player entered this area in the selected window.
            </p>
            {predatesRecording && (
              <p className="text-xs text-warning-600 dark:text-warning-400 mt-2">
                The window starts before recording began ({formatTime(recordedFrom!)}), so
                part of it was never captured.
              </p>
            )}
            {onSearchAdm && (
              <Button size="sm" variant="secondary-color" icon={FileText}
                className="mt-3" onClick={onSearchAdm}>
                Search ADM logs instead
              </Button>
            )}
          </div>
        )}

        {[...byPlayer.entries()].map(([pid, list]) => (
          <div
            key={pid}
            onMouseEnter={() => onHoverPlayer?.(pid)}
            onMouseLeave={() => onHoverPlayer?.(null)}
            className="px-3 py-2 border-b border-gray-100 dark:border-gray-800/60 hover:bg-gray-50 dark:hover:bg-gray-800/40"
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-medium text-gray-900 dark:text-white truncate">
                {list[0].name || pid}
              </span>
              <span className="text-[11px] text-gray-400 shrink-0">
                {list.length} visit{list.length === 1 ? '' : 's'}
              </span>
            </div>
            <div className="mt-1 space-y-0.5">
              {list.map((v, i) => (
                <div key={i} className="flex items-baseline justify-between gap-2 text-[11px]">
                  <span className="text-gray-500 dark:text-gray-400 tabular-nums">
                    {formatTime(v.enteredAt)}
                  </span>
                  <span className="text-gray-400 dark:text-gray-500 tabular-nums shrink-0">
                    {formatDuration(v.durationMs)} · {v.closestM} m
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {onSearchAdm && !!visits?.length && (
        <div className="p-2 border-t border-gray-200 dark:border-gray-800 shrink-0">
          <Button size="sm" variant="tertiary" icon={FileText}
            className={cx('w-full')} onClick={onSearchAdm}>
            Also search ADM logs for this area
          </Button>
        </div>
      )}
    </div>
  );
}
