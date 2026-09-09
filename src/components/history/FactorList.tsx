import { cx } from '@/utils/cx';

/**
 * The shape every scorer's factor takes (`server/stash-report.js`,
 * `server/loot-cycle.js`). Structural rather than one of the wire types so the
 * stash report and the flags rail can share the rendering without one importing
 * the other's model.
 */
export interface ScoredFactor {
  key: string;
  label: string;
  value: number;
  unit: string | null;
  points: number;
  max: number;
  detail: string | null;
}

interface FactorListProps {
  factors: ScoredFactor[];
  /** Print `points/max` next to the value; off for the stash report, which never did. */
  showPoints?: boolean;
  /** What to say when there is nothing to show; omit to render nothing. */
  emptyText?: string;
  className?: string;
}

/**
 * Why a score is what it is: one bar per factor.
 *
 * Bars rather than a bare number, so the shape of the suspicion is visible — many
 * small factors reads very differently from one large one, and the accusation an
 * operator acts on should be checkable at a glance.
 */
export default function FactorList({ factors, showPoints = false, emptyText, className }: FactorListProps) {
  if (factors.length === 0) {
    return emptyText
      ? <p className={cx('text-xs text-gray-500 italic', className)}>{emptyText}</p>
      : null;
  }
  return (
    <div className={cx('space-y-2', className)}>
      {factors.map(f => (
        <div key={f.key}>
          <div className="flex items-baseline justify-between gap-2 text-xs">
            <span className="text-gray-700 dark:text-gray-300">{f.label}</span>
            <span className="tabular-nums text-gray-500 shrink-0">
              {f.value}{f.unit ? ` ${f.unit}` : ''}
              {showPoints && (
                <span className="text-gray-400 dark:text-gray-500"> · {f.points}/{f.max}</span>
              )}
            </span>
          </div>
          <div className="mt-1 h-1.5 rounded-full bg-gray-200 dark:bg-gray-800 overflow-hidden">
            <div
              className="h-full rounded-full bg-primary-500"
              style={{ width: `${f.max > 0 ? Math.round((f.points / f.max) * 100) : 0}%` }}
            />
          </div>
          {f.detail && <div className="mt-0.5 text-[11px] text-gray-500">{f.detail}</div>}
        </div>
      ))}
    </div>
  );
}
