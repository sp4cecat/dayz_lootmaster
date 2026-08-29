import { Loader2, AlertTriangle, ListX } from 'lucide-react';
import { cx } from '@/utils/cx';
import { actionKindStyle } from '@/utils/actionKinds';
import type { ActionKindCount, HistoryAction } from '@/types/history';

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

/**
 * A `detail` string the mod wrote, rendered as something a human reads.
 *
 * The mod's format is deliberately loose (`killer=<id>`, a bare container class,
 * a player name), because inventing a schema for a free-text field would mean
 * versioning it. Anything unrecognised is shown verbatim rather than dropped.
 */
function describeDetail(action: HistoryAction): string | null {
  const d = action.detail;
  if (!d) return null;
  if (d.startsWith('killer=')) return `Killed by ${d.slice(7)}`;
  if (d.startsWith('cause=')) return `Cause: ${d.slice(6)}`;
  if (action.kind === 'stash') return `Into ${d}`;
  if (action.kind === 'rollback' || action.kind === 'rollback_failed') {
    try {
      const info = JSON.parse(d);
      const parts = [`snapshot #${info.snapshotId}`];
      if (info.created !== null && info.created !== undefined) {
        parts.push(`${info.created}/${info.expected} items`);
      }
      if (info.misplaced) parts.push(`${info.misplaced} misplaced`);
      if (info.removed) parts.push(`${info.removed} removed`);
      return parts.join(' · ');
    } catch {
      return d;                      // not the JSON we write; show it as it is
    }
  }
  return d;
}

interface ActionFeedProps {
  actions: HistoryAction[];
  kindCounts: ActionKindCount[];
  /** Kinds currently selected; empty means "all", not "none". */
  selectedKinds: string[];
  onToggleKind: (kind: string) => void;
  onClearKinds: () => void;
  loading: boolean;
  error: string | null;
  truncated: boolean;
  /** Reveal an event's place on the map. */
  onHoverAction?: (id: number | null) => void;
  onSelectAction?: (action: HistoryAction) => void;
  /** Recorder-level count, so an empty feed can explain itself honestly. */
  totalRecorded?: number;
}

/**
 * The action log as a chronological feed, with filter chips for what is in the
 * window.
 *
 * The chips come from the window rather than from the filtered result: a chip list
 * rebuilt from what survived the filter would delete the very chips needed to
 * widen it again, which is the classic way a filter UI traps its user.
 *
 * An empty feed is a genuinely ambiguous result — nothing happened, the filter is
 * too narrow, or the running mod has no event hooks at all — so each of those says
 * so in its own words instead of sharing one "no results".
 */
export default function ActionFeed({
  actions, kindCounts, selectedKinds, onToggleKind, onClearKinds,
  loading, error, truncated, onHoverAction, onSelectAction, totalRecorded,
}: ActionFeedProps) {
  const selected = new Set(selectedKinds);

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-800 shrink-0 space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">
            Actions
          </h4>
          {selectedKinds.length > 0 && (
            <button
              type="button"
              onClick={onClearKinds}
              className="text-[11px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
            >
              Clear filter
            </button>
          )}
        </div>
        {kindCounts.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {kindCounts.map(({ kind, count }) => {
              const style = actionKindStyle(kind);
              const on = selected.has(kind);
              const Icon = style.icon;
              return (
                <button
                  key={kind}
                  type="button"
                  onClick={() => onToggleKind(kind)}
                  aria-pressed={on}
                  className={cx(
                    'flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium border transition-colors',
                    on
                      ? style.chip
                      : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50 dark:bg-gray-900 dark:text-gray-400 dark:border-gray-700',
                  )}
                >
                  <Icon size={10} />
                  {style.label}
                  <span className="tabular-nums opacity-60">{count}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        {loading && (
          <div className="flex items-center gap-2 px-3 py-3 text-xs text-gray-500">
            <Loader2 size={13} className="animate-spin" /> Loading actions…
          </div>
        )}

        {!loading && error && (
          <div className="flex items-start gap-2 px-3 py-3 text-xs text-error-600 dark:text-error-400">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {error}
          </div>
        )}

        {!loading && !error && actions.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-2 text-center px-6 py-10">
            <ListX size={26} className="text-gray-300 dark:text-gray-600" />
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {totalRecorded === 0
                ? 'No actions have ever been recorded. The companion mod needs to be running '
                  + 'a build with the event hooks (spacecat_dayz_server_api 1.2.0 or newer).'
                : selectedKinds.length > 0
                  ? 'No actions of the selected kinds in this window.'
                  : 'No actions recorded in this window.'}
            </p>
          </div>
        )}

        {!loading && actions.map((a) => {
          const style = actionKindStyle(a.kind);
          const Icon = style.icon;
          const detail = describeDetail(a);
          return (
            <button
              key={a.id}
              type="button"
              onMouseEnter={() => onHoverAction?.(a.id)}
              onMouseLeave={() => onHoverAction?.(null)}
              onClick={() => onSelectAction?.(a)}
              className="w-full text-left flex gap-2 px-3 py-1.5 border-b border-gray-100 dark:border-gray-800/60 hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors"
            >
              <Icon size={13} className="mt-0.5 shrink-0" style={{ color: style.color }} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-[11px] font-medium text-gray-800 dark:text-gray-200 truncate">
                    {a.name || a.pid || 'Unattributed'}
                  </span>
                  <span className="text-[10px] text-gray-400 shrink-0">{style.label}</span>
                </div>
                {a.cls && (
                  <div className="text-[11px] text-gray-600 dark:text-gray-400 truncate">{a.cls}</div>
                )}
                {detail && (
                  <div className="text-[10px] text-gray-400 dark:text-gray-500 truncate">{detail}</div>
                )}
                <div className="text-[10px] text-gray-400 dark:text-gray-500 tabular-nums">
                  {formatTime(a.ts)}
                  {a.x !== null && a.z !== null && ` · ${Math.round(a.x)}, ${Math.round(a.z)}`}
                </div>
              </div>
            </button>
          );
        })}

        {/* A feed that silently stops at its limit reads as the end of the data. */}
        {!loading && truncated && (
          <div className="px-3 py-2 text-[10px] text-gray-400 dark:text-gray-500 border-t border-gray-100 dark:border-gray-800">
            Only the most recent events are shown. Narrow the window or filter by kind
            to see the rest.
          </div>
        )}
      </div>
    </div>
  );
}
