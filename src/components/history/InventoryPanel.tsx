import { useCallback, useEffect, useState } from 'react';
import {
  Backpack, Loader2, RotateCcw, Camera, AlertTriangle, Skull, LogIn, LogOut, Hand,
} from 'lucide-react';
import { Badge } from '../base/badges/badges';
import { Button } from '../base/button/button';
import {
  useInventoryDetail, useInventorySnapshots, usePlayerRestore,
} from '@/hooks/useHistoryData';
import InventoryTree from './InventoryTree';
import RollbackDialog from './RollbackDialog';
import type { InventorySummary } from '@/types/history';

const REASON_ICONS = {
  connect: LogIn,
  disconnect: LogOut,
  death: Skull,
  manual: Hand,
} as const;

const REASON_LABELS = {
  connect: 'Connected',
  disconnect: 'Disconnected',
  death: 'Died',
  manual: 'Manual',
} as const;

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

interface InventoryPanelProps {
  /** The player whose loadouts these are; null when none is selected. */
  pid: string | null;
  name: string | null;
  from: number;
  to: number;
  /** Whether this player has a loaded character right now. */
  online: boolean;
  /** Whether the mod is pushing at all — capture and rollback both need it. */
  modConnected: boolean;
}

/**
 * A player's captured loadouts, and the gate to putting one back.
 *
 * The list is deliberately metadata-only until a row is opened: a season of
 * snapshots is tens of megabytes of JSON, and the questions the list answers
 * (when, why, how many items) are all answered by the row itself.
 */
export default function InventoryPanel({
  pid, name, from, to, online, modConnected,
}: InventoryPanelProps) {
  // Bumped after a manual capture. The snapshot arrives asynchronously over
  // /ingest/inventory a flush interval after the mod acks, so there is nothing to
  // await — the list is simply re-read.
  const [nonce, setNonce] = useState(0);

  /**
   * A capture the operator just asked for happens NOW, and the chosen window almost
   * always ends in the past — so bounding the list by `to` would drop the one
   * snapshot they were waiting for and make the button look broken. The upper bound
   * is stretched to cover it; the lower bound, which is what the window is actually
   * for, is untouched.
   */
  const [capturedAt, setCapturedAt] = useState(0);
  const effectiveTo = Math.max(to, capturedAt);
  const { snapshots, loading } = useInventorySnapshots(pid, from, effectiveTo, nonce);
  const [openId, setOpenId] = useState<number | null>(null);
  const { snapshot, loading: detailLoading } = useInventoryDetail(openId);

  const [rollbackFor, setRollbackFor] = useState<number | null>(null);
  const { snapshot: rollbackSnap } = useInventoryDetail(rollbackFor);

  // The "what are they carrying now" side of the diff: the newest manual capture,
  // which is what the dialog's re-read button produces.
  const [currentId, setCurrentId] = useState<number | null>(null);
  const { snapshot: current } = useInventoryDetail(currentId);
  const restore = usePlayerRestore();

  // A newly arrived manual capture becomes the "now" side. Watched rather than
  // returned by the capture call, because the id is assigned on arrival at
  // /ingest/inventory and is not knowable when the command is acked.
  useEffect(() => {
    const newest = snapshots.find(s => s.reason === 'manual');
    if (newest && newest.id !== currentId) setCurrentId(newest.id);
  }, [snapshots, currentId]);

  const captureNow = useCallback(async () => {
    if (!pid) return;
    const ok = await restore.captureNow(pid);
    if (!ok) return;
    // Widen the window before re-reading, or the snapshot lands outside it.
    setCapturedAt(Date.now() + 60_000);
    // The mod flushes on its own cadence (default 5 s), so give it a beat, then
    // re-read. Polling harder would just miss it faster.
    setTimeout(() => setNonce(n => n + 1), 6000);
  }, [pid, restore]);

  const applyRollback = useCallback(
    async (opts: { allowTruncated: boolean; restoreStats: boolean }) => {
      if (rollbackFor === null || !pid) return;
      await restore.rollback(rollbackFor, { playerId: pid, ...opts });
      setNonce(n => n + 1);
    },
    [rollbackFor, pid, restore],
  );

  const closeRollback = useCallback(() => {
    setRollbackFor(null);
    restore.reset();
  }, [restore]);

  if (!pid) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center px-6">
        <Backpack size={28} className="text-gray-300 dark:text-gray-600" />
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Select a player to see their captured loadouts.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-800 shrink-0 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h4 className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">
            Loadouts
          </h4>
          <p className="text-[11px] text-gray-400 dark:text-gray-500 truncate">
            {name || pid}
          </p>
        </div>
        <Button
          variant="secondary-gray"
          size="sm"
          onClick={captureNow}
          disabled={!online || !modConnected || restore.busy}
          // Both preconditions produce the same disabled button, so the reason for
          // it has to be in the tooltip or it looks broken.
          title={!modConnected
            ? 'The companion mod is not connected, so nothing can read the live inventory.'
            : !online
              ? 'This player is not online; there is no loaded character to read.'
              : 'Ask the mod to capture what this player is carrying right now.'}
        >
          {restore.busy ? <Loader2 size={12} className="animate-spin" /> : <Camera size={12} />}
          <span className="ml-1">Capture now</span>
        </Button>
      </div>

      {restore.error && !rollbackSnap && (
        <div className="flex items-start gap-2 px-3 py-2 text-[11px] text-error-600 dark:text-error-400 border-b border-gray-200 dark:border-gray-800">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          {restore.error}
        </div>
      )}

      <div className="flex-1 overflow-y-auto min-h-0">
        {loading && (
          <div className="flex items-center gap-2 px-3 py-3 text-xs text-gray-500">
            <Loader2 size={13} className="animate-spin" /> Loading loadouts…
          </div>
        )}

        {!loading && snapshots.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-2 text-center px-6 py-10">
            <Backpack size={24} className="text-gray-300 dark:text-gray-600" />
            <p className="text-xs text-gray-500 dark:text-gray-400">
              No loadouts captured for this player in this window. Captures happen on
              connect, disconnect and death — or on demand, above.
            </p>
          </div>
        )}

        {snapshots.map((s: InventorySummary) => {
          const Icon = REASON_ICONS[s.reason] ?? Hand;
          const open = openId === s.id;
          return (
            <div key={s.id} className="border-b border-gray-100 dark:border-gray-800/60">
              <button
                type="button"
                onClick={() => setOpenId(open ? null : s.id)}
                className="w-full text-left flex items-start gap-2 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors"
              >
                <Icon size={13} className="mt-0.5 shrink-0 text-gray-400" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-[11px] font-medium text-gray-800 dark:text-gray-200">
                      {REASON_LABELS[s.reason] ?? s.reason}
                    </span>
                    <span className="text-[10px] text-gray-400 tabular-nums">
                      {formatTime(s.ts)}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <Badge color="gray" size="sm">{s.items} items</Badge>
                    {s.truncated && <Badge color="warning" size="sm">Truncated</Badge>}
                  </div>
                </div>
              </button>

              {open && (
                <div className="px-3 pb-3">
                  {detailLoading && (
                    <div className="flex items-center gap-2 py-2 text-xs text-gray-500">
                      <Loader2 size={12} className="animate-spin" /> Loading…
                    </div>
                  )}
                  {!detailLoading && snapshot && (
                    <>
                      <InventoryTree tree={snapshot.tree} truncated={snapshot.truncated} />
                      <div className="mt-2 flex justify-end">
                        <Button
                          variant="secondary-color"
                          size="sm"
                          onClick={() => { restore.reset(); setRollbackFor(s.id); }}
                          disabled={!modConnected || snapshot.tree.length === 0}
                          title={!modConnected
                            ? 'The companion mod is not connected, so nothing can apply a rollback.'
                            : 'Put this loadout back onto the player.'}
                        >
                          <RotateCcw size={12} />
                          <span className="ml-1">Roll back to this</span>
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {rollbackFor !== null && rollbackSnap && (
        <RollbackDialog
          open
          snapshot={rollbackSnap}
          // Never the snapshot being restored: diffing something against itself
          // would report "nothing changes" for every rollback.
          current={current && current.id !== rollbackSnap.id ? current : null}
          currentLoading={restore.busy}
          playerOnline={online && modConnected}
          busy={restore.busy}
          error={restore.error}
          result={restore.result}
          onCaptureCurrent={captureNow}
          onConfirm={applyRollback}
          onClose={closeRollback}
        />
      )}
    </div>
  );
}
