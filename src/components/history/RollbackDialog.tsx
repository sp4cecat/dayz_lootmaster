import { useMemo, useState } from 'react';
import { Modal } from '../base/modal/modal';
import { Button } from '../base/button/button';
import { Badge } from '../base/badges/badges';
import { AlertTriangle, RotateCcw, RefreshCw, Loader2, Check } from 'lucide-react';
import { cx } from '@/utils/cx';
import { diffInventories, type ItemCount } from '@/utils/inventoryDiff';
import type { InventorySnapshot, RollbackResult } from '@/types/history';

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

const REASON_LABELS: Record<string, string> = {
  connect: 'on connect',
  disconnect: 'on disconnect',
  death: 'on death',
  manual: 'captured manually',
};

function ItemList({ items, tone }: { items: ItemCount[]; tone: 'gain' | 'loss' }) {
  if (!items.length) {
    return <p className="text-[11px] text-gray-400 dark:text-gray-500 px-1">Nothing.</p>;
  }
  return (
    <ul className="space-y-0.5 max-h-40 overflow-y-auto">
      {items.map((i) => (
        <li key={i.cls} className="flex items-baseline gap-1.5 text-[11px] px-1">
          <span className={cx(
            'tabular-nums font-medium shrink-0',
            tone === 'gain'
              ? 'text-success-600 dark:text-success-400'
              : 'text-error-600 dark:text-error-400',
          )}>
            {tone === 'gain' ? '+' : '−'}{i.count}
          </span>
          <span className="text-gray-700 dark:text-gray-300 truncate">{i.label}</span>
        </li>
      ))}
    </ul>
  );
}

interface RollbackDialogProps {
  open: boolean;
  snapshot: InventorySnapshot;
  /**
   * What the player is carrying right now, from a just-taken capture. Null when
   * nothing has been captured — which is NOT the same as an empty inventory, and
   * the dialog must not let it read that way.
   */
  current: InventorySnapshot | null;
  currentLoading: boolean;
  /** A capture needs a loaded character, so the button is off when they are away. */
  playerOnline: boolean;
  busy: boolean;
  error: string | null;
  result: RollbackResult | null;
  onCaptureCurrent: () => void;
  onConfirm: (opts: { allowTruncated: boolean; restoreStats: boolean }) => void;
  onClose: () => void;
}

/**
 * Confirmation gate for applying a stored loadout back onto a live player.
 *
 * This is not ConfirmDialog with different words. A rollback is the only action in
 * the product that both DESTROYS what a player is carrying and DUPLICATES items
 * they may since have traded away, so the dialog's job is to show that trade
 * concretely — item by item — rather than ask "are you sure".
 *
 * The duplication is stated plainly and not buried. There is no way around it: the
 * economy has no memory of where an item came from, so restoring a rifle a player
 * sold last week puts a second one into circulation. An operator who does that
 * should do it knowingly.
 */
export default function RollbackDialog({
  open, snapshot, current, currentLoading, playerOnline, busy, error, result,
  onCaptureCurrent, onConfirm, onClose,
}: RollbackDialogProps) {
  const [allowTruncated, setAllowTruncated] = useState(false);
  const [restoreStats, setRestoreStats] = useState(false);

  const diff = useMemo(
    () => diffInventories(snapshot.tree, current?.tree ?? []),
    [snapshot.tree, current],
  );

  // A death snapshot records health 0. Offering to restore that would offer to kill
  // the character being restored, so the option is simply not there.
  const statsAreFatal = (snapshot.stats.health ?? 0) <= 0;
  const blockedByTruncation = snapshot.truncated && !allowTruncated;

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      title="Roll back this loadout"
      icon={AlertTriangle}
      iconVariant="error"
      maxWidth="max-w-lg"
      footer={
        result ? (
          <Button variant="secondary-gray" size="sm" onClick={onClose}>Close</Button>
        ) : (
          <>
            <Button variant="secondary-gray" size="sm" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="error"
              size="sm"
              onClick={() => onConfirm({ allowTruncated, restoreStats })}
              disabled={busy || blockedByTruncation || !playerOnline}
            >
              {busy ? 'Applying…' : 'Apply rollback'}
            </Button>
          </>
        )
      }
    >
      <div className="space-y-3 text-sm">
        {/* What is being restored, onto whom */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-gray-900 dark:text-white">
            {snapshot.name || snapshot.pid}
          </span>
          <Badge color="gray" size="sm">
            {formatTime(snapshot.ts)} · {REASON_LABELS[snapshot.reason] || snapshot.reason}
          </Badge>
          <Badge color="brand" size="sm">{snapshot.items} items</Badge>
          {snapshot.truncated && <Badge color="warning" size="sm">Truncated</Badge>}
        </div>

        {!result && (
          <>
            {!playerOnline && (
              <div className="flex items-start gap-2 px-2.5 py-2 rounded-md bg-warning-50 text-warning-800 border border-warning-200 dark:bg-warning-900/20 dark:text-warning-300 dark:border-warning-800 text-xs">
                <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                <span>
                  This player is not online. A character that is not loaded has no
                  inventory to rebuild, so the rollback cannot be applied yet.
                </span>
              </div>
            )}

            {/* The diff */}
            <div className="rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden">
              <div className="flex items-center justify-between px-2.5 py-1.5 bg-gray-50 dark:bg-gray-900/50 border-b border-gray-200 dark:border-gray-800">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-400">
                  What changes
                </span>
                <Button
                  variant="tertiary"
                  size="sm"
                  onClick={onCaptureCurrent}
                  disabled={currentLoading || !playerOnline}
                >
                  {currentLoading
                    ? <Loader2 size={12} className="animate-spin" />
                    : <RefreshCw size={12} />}
                  <span className="ml-1">Re-read what they carry</span>
                </Button>
              </div>

              {!current ? (
                <div className="px-2.5 py-3 text-xs text-gray-500 dark:text-gray-400">
                  {/* Distinguished from "carrying nothing", which would make the
                      destroy list read as empty when it is merely unknown. */}
                  Nothing has been captured for this player, so what they are carrying
                  now is <strong>unknown</strong>. The rollback will still clear it.
                  Read it first to see exactly what would be destroyed.
                </div>
              ) : (
                <div className="grid grid-cols-2 divide-x divide-gray-200 dark:divide-gray-800">
                  <div className="px-2.5 py-2">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-success-700 dark:text-success-400 mb-1">
                      Restored
                    </div>
                    <ItemList items={diff.gained} tone="gain" />
                  </div>
                  <div className="px-2.5 py-2">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-error-700 dark:text-error-400 mb-1">
                      Destroyed
                    </div>
                    <ItemList items={diff.lost} tone="loss" />
                  </div>
                </div>
              )}
              {current && (
                <div className="px-2.5 py-1.5 text-[10px] text-gray-400 dark:text-gray-500 border-t border-gray-200 dark:border-gray-800">
                  Compared against a capture from {formatTime(current.ts)}.
                  {diff.unchanged.length > 0 && ` ${diff.unchanged.length} item types unchanged.`}
                </div>
              )}
            </div>

            {/* The thing there is no way around */}
            <div className="flex items-start gap-2 px-2.5 py-2 rounded-md bg-error-50 text-error-800 border border-error-200 dark:bg-error-900/20 dark:text-error-300 dark:border-error-800 text-xs">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              <span>
                <strong>This duplicates items.</strong> Anything in the snapshot that the
                player has since spent, dropped or traded away comes back into the
                economy as a second copy. There is no way to avoid that — the game keeps
                no record of where an item came from.
              </span>
            </div>

            {snapshot.truncated && (
              <label className="flex items-start gap-2 text-xs text-gray-600 dark:text-gray-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={allowTruncated}
                  onChange={(e) => setAllowTruncated(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  Apply anyway, knowing this capture is incomplete and some of the
                  player’s original items are not in it.
                </span>
              </label>
            )}

            <label className={cx(
              'flex items-start gap-2 text-xs cursor-pointer',
              statsAreFatal ? 'text-gray-400 dark:text-gray-600' : 'text-gray-600 dark:text-gray-300',
            )}>
              <input
                type="checkbox"
                checked={restoreStats && !statsAreFatal}
                disabled={statsAreFatal}
                onChange={(e) => setRestoreStats(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                Also restore health, blood, shock, energy and water.
                {statsAreFatal && ' Unavailable: this snapshot recorded no health, so '
                  + 'applying it would kill the character it just restored.'}
              </span>
            </label>
          </>
        )}

        {error && !result && (
          <div className="flex items-start gap-2 px-2.5 py-2 rounded-md bg-error-50 text-error-700 border border-error-200 dark:bg-error-900/20 dark:text-error-300 dark:border-error-800 text-xs">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Outcome. Counts, not a tick: a rollback can succeed partially, and
            reporting that as success is how someone believes they undid a bug they
            only half undid. */}
        {result && (
          <div className={cx(
            'rounded-lg border px-2.5 py-2 text-xs space-y-1',
            result.applied
              ? 'bg-success-50 border-success-200 text-success-800 dark:bg-success-900/20 dark:border-success-800 dark:text-success-300'
              : 'bg-error-50 border-error-200 text-error-800 dark:bg-error-900/20 dark:border-error-800 dark:text-error-300',
          )}>
            <div className="flex items-center gap-1.5 font-medium">
              {result.applied ? <Check size={13} /> : <AlertTriangle size={13} />}
              {result.applied ? 'Rollback applied' : 'Rollback did not complete'}
            </div>
            <div>
              {result.created ?? 0} of {result.expected} items rebuilt
              {result.removed ? `, ${result.removed} cleared first` : ''}.
            </div>
            {!!result.failed && (
              <div>
                {result.failed} could not be created — their contents were skipped too.
              </div>
            )}
            {!!result.misplaced && (
              <div>
                {result.misplaced} went into cargo because the recorded slot would not
                take them. The items are back; the loadout is not the shape it was.
              </div>
            )}
            {result.error && <div>{result.error}</div>}
            <div className="pt-1 flex items-center gap-1 opacity-80">
              <RotateCcw size={11} /> Recorded in the action log.
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
