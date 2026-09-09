import { memo, useCallback, useMemo, useState } from 'react';
import {
  Loader2, AlertTriangle, ShieldAlert, Settings2, ChevronDown, ChevronRight, Trash2, RefreshCw,
} from 'lucide-react';
import { Button } from '../base/button/button';
import { cx } from '@/utils/cx';
import { severityChipClass, severityLabel, severityRank } from '@/utils/flagSeverity';
import { useEnforce, useFlagDetail, useFlags, useLootCyclePolicy } from '@/hooks/useHistoryData';
import ConfirmDialog from '../live/ConfirmDialog';
import FactorList from './FactorList';
import LootCyclePolicyModal from './LootCyclePolicyModal';
import type {
  CycleEvidence, EnforcementRow, FlagEvidence, LadderRung, LootCycleDetectorStats, PlayerFlag,
} from '@/types/history';

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

/** "just now", "4 min ago", "3 h ago", or a date once it is old enough to need one. */
function ago(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return formatTime(ts);
}

function fmtHeld(ms: number): string {
  if (ms < 90_000) return `${Math.round(ms / 1000)} s`;
  return `${Math.round(ms / 60_000)} min`;
}

function fmtMinutes(min: number): string {
  if (min % 1440 === 0) return `${min / 1440} d`;
  if (min % 60 === 0) return `${min / 60} h`;
  return `${min} min`;
}

/** The excuse keys the scorer emits, in the operator's words. */
const EXCUSE_LABELS: Record<string, string> = {
  triage: 'dropping things never picked up',
  atHome: 'dropping inside their own base',
  stashing: 'mostly stashing, not dropping',
};

const ACTION_LABELS: Record<string, string> = {
  notice: 'Notice',
  warning: 'Warning',
  kick: 'Kick',
  tempban: 'Temp ban',
  webhook: 'Webhook',
};

/** Button text for a rung not yet fired. */
function rungButtonLabel(rung: LadderRung): string {
  switch (rung.action) {
    case 'notice': return 'Send notice';
    case 'warning': return 'Send warning';
    case 'kick': return 'Kick';
    case 'tempban': return `Temp ban ${fmtMinutes(rung.minutes ?? 1440)}`;
    default: return rung.action;
  }
}

/** "Rag · stashed · held 6 s · 3 m from pickup · fresh" */
function describeCycle(c: CycleEvidence): string {
  const bits = [c.cls];
  if (c.kind === 'stash') bits.push('stashed');
  bits.push(`held ${fmtHeld(c.heldMs)}`);
  if (c.distM != null) bits.push(`${Math.round(c.distM)} m from pickup`);
  if (c.fresh === true) bits.push('fresh');
  else if (c.fresh === false) bits.push('not fresh');
  return bits.join(' · ');
}

/**
 * One line about the detector, so an empty list can be read as "nothing
 * flagged" or "nothing could be flagged" — the two look identical otherwise.
 */
function detectorStatus(
  detector: LootCycleDetectorStats | null, available: boolean, reason: string | null,
): { text: string; tone: 'ok' | 'warn' | 'off' } {
  if (!available) {
    return { text: reason === 'disabled' ? 'History recording is off' : 'History unavailable', tone: 'off' };
  }
  if (!detector) return { text: 'Detector status unknown', tone: 'off' };
  if (!detector.enabled) return { text: 'Detector off', tone: 'off' };
  if (detector.lastError) return { text: `Detector stopped: ${detector.lastError}`, tone: 'warn' };
  if (detector.capable.rows > 0 && !detector.capable.iid) {
    return { text: 'Mod predates item identity — nothing scored', tone: 'warn' };
  }
  if (!detector.running) return { text: 'Detector not running', tone: 'warn' };
  const players = `${detector.players} player${detector.players === 1 ? '' : 's'} tracked`;
  const last = detector.lastRunAt ? ` · ran ${ago(detector.lastRunAt)}` : '';
  return { text: `Running · ${players}${last}`, tone: 'ok' };
}

interface FlagsPanelProps {
  /** Recorder-level action count, so an empty list can explain itself honestly. */
  totalRecorded?: number;
  /** Whether the companion mod is pushing at all; shapes the empty state. */
  modConnected?: boolean;
  /**
   * A cycle line is under the cursor (or none is). The pid comes along because
   * the parent's action markers are keyed by actor, not by cycle.
   */
  onHoverCycle?: (cycle: CycleEvidence | null, pid: string) => void;
}

/**
 * The loot-cycling rail: every live flag, worst first, each expandable to the
 * evidence that earned it and the ladder rungs still available.
 *
 * The evidence is shown in full — factors, the cycles behind them, the excuses
 * that pulled the score down — because a rung fired from here reaches a real
 * player, and an operator should be able to check the accusation before sending
 * it rather than trusting a number.
 */
export default function FlagsPanel({ totalRecorded, modConnected, onHoverCycle }: FlagsPanelProps) {
  const flags = useFlags(15000, { minSeverity: 'low' });
  const policy = useLootCyclePolicy();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [policyOpen, setPolicyOpen] = useState(false);

  const sorted = useMemo(
    () => [...flags.items].sort((a, b) =>
      severityRank(b.severity) - severityRank(a.severity)
      || b.score - a.score
      || b.updatedAt - a.updatedAt),
    [flags.items],
  );

  const ladderSize = policy.policy?.ladder.length ?? 0;
  const status = detectorStatus(flags.detector, flags.available, flags.reason);

  const toggle = useCallback((pid: string) => setExpanded(prev => (prev === pid ? null : pid)), []);

  const openPolicy = useCallback(() => { policy.reload(); setPolicyOpen(true); }, [policy]);

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-800 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">
            Loot cycling
          </h4>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => flags.refresh()}
              title="Re-read the flags now"
              className="p-1 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:text-gray-200 dark:hover:bg-gray-800"
            >
              <RefreshCw size={12} />
            </button>
            <button
              type="button"
              onClick={openPolicy}
              title="Detection policy: ladder, webhook, CF Tools profile"
              aria-label="Loot-cycle policy"
              className="p-1 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:text-gray-200 dark:hover:bg-gray-800"
            >
              <Settings2 size={13} />
            </button>
          </div>
        </div>
        <p
          className={cx(
            'text-[11px] truncate',
            status.tone === 'ok' && 'text-gray-400 dark:text-gray-500',
            status.tone === 'warn' && 'text-warning-600 dark:text-warning-400',
            status.tone === 'off' && 'text-gray-400 dark:text-gray-500 italic',
          )}
          title={status.text}
        >
          {status.text}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        {flags.loading && (
          <div className="flex items-center gap-2 px-3 py-3 text-xs text-gray-500">
            <Loader2 size={13} className="animate-spin" /> Loading flags…
          </div>
        )}

        {!flags.loading && flags.error && (
          <div className="flex items-start gap-2 px-3 py-3 text-xs text-error-600 dark:text-error-400">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {flags.error}
          </div>
        )}

        {!flags.loading && !flags.error && sorted.length === 0 && (
          <EmptyState
            available={flags.available}
            reason={flags.reason}
            detector={flags.detector}
            totalRecorded={totalRecorded}
            modConnected={modConnected}
          />
        )}

        {!flags.loading && sorted.map((f) => (
          <FlagRow
            key={f.pid}
            flag={f}
            ladderSize={ladderSize}
            open={expanded === f.pid}
            onToggle={toggle}
            onChanged={flags.refresh}
            onHoverCycle={onHoverCycle}
          />
        ))}
      </div>

      <LootCyclePolicyModal
        open={policyOpen}
        onClose={() => setPolicyOpen(false)}
        policy={policy.policy}
        loading={policy.loading}
        error={policy.error}
        save={policy.save}
      />
    </div>
  );
}

/**
 * Why there is nothing here. Each cause has a different fix, so each gets its
 * own sentence rather than sharing a "no results".
 */
function EmptyState({ available, reason, detector, totalRecorded, modConnected }: {
  available: boolean; reason: string | null; detector: LootCycleDetectorStats | null;
  totalRecorded?: number; modConnected?: boolean;
}) {
  let text: string;
  if (!available) {
    text = reason === 'disabled'
      ? 'History recording is disabled. Set HISTORY_ENABLED=1 on the backend; the loot-cycle '
        + 'detector scores the recorded action log.'
      : `History is unavailable${reason ? ` (${reason})` : ''}, so nothing can be scored.`;
  } else if (totalRecorded === 0) {
    text = 'No actions have ever been recorded. The companion mod needs to be running a build '
      + 'with the event hooks (spacecat_dayz_server_api 1.2.0 or newer) before anything can be scored.';
  } else if (detector && !detector.enabled) {
    text = 'The loot-cycle detector is switched off. Turn it on from the policy (gear icon above) '
      + 'to start scoring pickups and drops.';
  } else if (detector && detector.capable.rows > 0 && !detector.capable.iid) {
    text = 'The running companion mod predates item identity (spacecat_dayz_server_api 1.4.0). '
      + 'Pickups and drops are recorded, but without an item id they cannot be paired reliably, '
      + 'so nothing is scored.';
  } else if (detector && !detector.modConnected && modConnected === false) {
    text = 'Nothing flagged. The companion mod is not connected right now, so no new pickups or '
      + 'drops are arriving to score.';
  } else {
    text = 'Nothing flagged. Players whose pickups and drops look like loot cycling — pick up, '
      + 'drop seconds later, repeat — appear here as the detector scores them.';
  }
  return (
    <div className="flex flex-col items-center justify-center gap-2 text-center px-6 py-10">
      <ShieldAlert size={26} className="text-gray-300 dark:text-gray-600" />
      <p className="text-xs text-gray-500 dark:text-gray-400">{text}</p>
    </div>
  );
}

function SeverityChip({ severity, className }: { severity: string; className?: string }) {
  return (
    <span className={cx(
      'px-1.5 py-0.5 rounded-md text-[10px] font-medium border shrink-0',
      severityChipClass(severity), className,
    )}>
      {severityLabel(severity)}
    </span>
  );
}

interface FlagRowProps {
  flag: PlayerFlag;
  ladderSize: number;
  open: boolean;
  onToggle: (pid: string) => void;
  /** An enforcement or a dismissal changed this flag; the list should re-read. */
  onChanged: () => void;
  onHoverCycle?: (cycle: CycleEvidence | null, pid: string) => void;
}

/**
 * Memoised: the list re-reads every 15 s, and only the rows whose flag object
 * actually changed need to re-render.
 */
const FlagRow = memo(function FlagRow({
  flag, ladderSize, open, onToggle, onChanged, onHoverCycle,
}: FlagRowProps) {
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <div className="border-b border-gray-100 dark:border-gray-800/60">
      <button
        type="button"
        onClick={() => onToggle(flag.pid)}
        aria-expanded={open}
        className="w-full text-left flex items-start gap-2 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors"
      >
        <Chevron size={13} className="mt-0.5 shrink-0 text-gray-400" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-medium text-gray-800 dark:text-gray-200 truncate">
              {flag.name || flag.pid}
            </span>
            <SeverityChip severity={flag.severity} className="ml-auto" />
            <span className="text-[11px] font-semibold tabular-nums text-gray-700 dark:text-gray-300 shrink-0">
              {flag.score}
            </span>
          </div>
          <div className="text-[10px] text-gray-400 dark:text-gray-500 tabular-nums flex items-center gap-1.5">
            <span>rung {flag.rung}/{ladderSize || '?'}</span>
            <span>·</span>
            <span title={formatTime(flag.updatedAt)}>updated {ago(flag.updatedAt)}</span>
            {flag.evidence?.silent && <span className="text-warning-600 dark:text-warning-400">· not scored</span>}
            {flag.evidence?.lossy && <span className="text-warning-600 dark:text-warning-400">· feed had gaps</span>}
          </div>
        </div>
      </button>

      {open && (
        <FlagDetail flag={flag} onChanged={onChanged} onHoverCycle={onHoverCycle} />
      )}
    </div>
  );
});

/** Newest first; the list item's evidence is the fallback while the detail loads. */
const CYCLES_SHOWN = 8;

function FlagDetail({ flag, onChanged, onHoverCycle }: {
  flag: PlayerFlag;
  onChanged: () => void;
  onHoverCycle?: (cycle: CycleEvidence | null, pid: string) => void;
}) {
  const [nonce, setNonce] = useState(0);
  const detail = useFlagDetail(flag.pid, nonce);
  const enforceApi = useEnforce();
  const [confirm, setConfirm] = useState<LadderRung | null>(null);

  const live = detail.flag ?? flag;
  const evidence: FlagEvidence | null = live.evidence ?? flag.evidence;

  const factors = useMemo(() => {
    if (!evidence) return [];
    // A silent (legacy-mod) evaluation emits every factor at 0 points with a
    // detail explaining why; showing them is the explanation.
    return evidence.silent ? evidence.factors : evidence.factors.filter(f => f.points > 0);
  }, [evidence]);

  const cycles = useMemo(
    () => (evidence?.cycles ?? []).slice().sort((a, b) => b.dropTs - a.dropTs).slice(0, CYCLES_SHOWN),
    [evidence],
  );

  const pending = useMemo(
    () => detail.ladder.filter(r => r.rung > live.rung),
    [detail.ladder, live.rung],
  );

  const fire = useCallback(async () => {
    if (!confirm) return;
    const row = await enforceApi.enforce(flag.pid, confirm.rung);
    setConfirm(null);
    if (row) { setNonce(n => n + 1); onChanged(); }
  }, [confirm, enforceApi, flag.pid, onChanged]);

  const dismiss = useCallback(async () => {
    if (await enforceApi.clear(flag.pid)) onChanged();
  }, [enforceApi, flag.pid, onChanged]);

  const destructive = confirm?.action === 'kick' || confirm?.action === 'tempban';

  return (
    <div className="px-3 pb-3 space-y-3 text-xs">
      {detail.loading && !detail.flag && (
        <div className="flex items-center gap-2 py-1 text-gray-500">
          <Loader2 size={12} className="animate-spin" /> Loading evidence…
        </div>
      )}
      {detail.error && (
        <div className="flex items-start gap-2 text-error-600 dark:text-error-400">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {detail.error}
        </div>
      )}

      {evidence?.silent && (
        <p className="text-[11px] text-warning-700 dark:text-warning-400">
          The mod build that recorded this predates item identity; pairings are shown but
          nothing is scored.
        </p>
      )}
      {evidence?.lossy && (
        <p className="text-[11px] text-warning-700 dark:text-warning-400">
          Feed had gaps: the mod dropped events in this window, so the score is a floor
          and the detector will not escalate on it.
        </p>
      )}

      {/* What pulled the score down. Shown before the factors: an operator
          should see the excuse before the accusation. The backend's sentences
          are preferred; the short keys are the fallback for older builds. */}
      {evidence && (evidence.excuse.notes?.length || evidence.excuse.reasons.length > 0) && (
        <div>
          <div className="font-semibold text-gray-700 dark:text-gray-300 mb-1">
            Score reduced ×{evidence.excuse.multiplier.toFixed(2)}
          </div>
          {evidence.excuse.notes?.length ? (
            <ul className="space-y-0.5 text-[11px] text-gray-600 dark:text-gray-400">
              {evidence.excuse.notes.map((n, i) => <li key={i}>{n}</li>)}
            </ul>
          ) : (
            <div className="flex flex-wrap gap-1">
              {evidence.excuse.reasons.map(r => (
                <span key={r} className="px-1.5 py-0.5 rounded-md text-[10px] border bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700">
                  {EXCUSE_LABELS[r] ?? r}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      <div>
        <div className="font-semibold text-gray-700 dark:text-gray-300 mb-1">Why this score</div>
        <FactorList
          factors={factors}
          showPoints
          emptyText={evidence ? 'No factor scored in the last hour.' : 'No evidence stored for this flag.'}
        />
        {evidence && (
          <div className="mt-1 text-[10px] text-gray-400 dark:text-gray-500 tabular-nums">
            {evidence.counts.cycles} cycles · {evidence.counts.pickups} pickups
            {' · '}{evidence.counts.orphanDrops} unmatched drops
            {evidence.counts.homeDrops > 0 && ` · ${evidence.counts.homeDrops} at home`}
            {' · '}peak {live.peak}
          </div>
        )}
      </div>

      {cycles.length > 0 && (
        <div>
          <div className="font-semibold text-gray-700 dark:text-gray-300 mb-1">
            Last cycles
          </div>
          <ul className="space-y-0.5">
            {cycles.map((c, i) => (
              <li
                key={`${c.iid ?? c.cls}-${c.dropTs}-${i}`}
                onMouseEnter={() => onHoverCycle?.(c, flag.pid)}
                onMouseLeave={() => onHoverCycle?.(null, flag.pid)}
                title={`${formatTime(c.pickTs)} → ${formatTime(c.dropTs)}${c.matched === 'cls' ? ' · matched by classname' : ''}`}
                className="text-[11px] text-gray-600 dark:text-gray-400 truncate rounded px-1 -mx-1 hover:bg-gray-100 dark:hover:bg-gray-800/60"
              >
                {describeCycle(c)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {detail.enforcement.length > 0 && (
        <div>
          <div className="font-semibold text-gray-700 dark:text-gray-300 mb-1">Enforcement</div>
          <ul className="space-y-0.5">
            {detail.enforcement.map(e => <EnforcementLine key={e.id} row={e} />)}
          </ul>
        </div>
      )}

      {enforceApi.error && (
        <div className="flex items-start gap-2 text-error-600 dark:text-error-400">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {enforceApi.error}
        </div>
      )}

      <div className="flex flex-wrap gap-1.5 pt-1">
        {pending.map(r => (
          <Button
            key={r.rung}
            size="sm"
            variant={r.action === 'kick' || r.action === 'tempban' ? 'error-secondary' : 'secondary-gray'}
            disabled={enforceApi.busy}
            onClick={() => { enforceApi.reset(); setConfirm(r); }}
            title={`Rung ${r.rung} (${r.severity}${r.auto ? ', automatic' : ', manual'})`}
          >
            {rungButtonLabel(r)}
          </Button>
        ))}
        <Button
          size="sm"
          variant="tertiary"
          disabled={enforceApi.busy}
          onClick={dismiss}
          title="Clear this flag. It comes back if the player keeps cycling."
        >
          <Trash2 size={12} />
          <span className="ml-1">Dismiss</span>
        </Button>
      </div>

      <ConfirmDialog
        open={!!confirm}
        title={confirm ? `${rungButtonLabel(confirm)} — ${flag.name || flag.pid}` : ''}
        destructive={destructive}
        busy={enforceApi.busy}
        confirmLabel={confirm ? rungButtonLabel(confirm) : 'Confirm'}
        onConfirm={fire}
        onCancel={() => setConfirm(null)}
        message={confirm && (
          <div className="space-y-2">
            <p>
              Fire rung {confirm.rung} ({ACTION_LABELS[confirm.action] ?? confirm.action}) for
              {' '}<b>{flag.name || flag.pid}</b>, currently <b>{severityLabel(flag.severity)}</b> at {flag.score}.
            </p>
            {confirm.text && (
              <blockquote className="border-l-2 border-gray-300 dark:border-gray-700 pl-2 text-gray-500 dark:text-gray-400 whitespace-pre-wrap">
                {confirm.text}
              </blockquote>
            )}
            {confirm.action === 'tempban' && (
              <p className="text-gray-500 dark:text-gray-400">
                Bans through CF Tools RCon for {fmtMinutes(confirm.minutes ?? 1440)}; needs a
                profile with a linked server in the policy.
              </p>
            )}
          </div>
        )}
      />
    </div>
  );
}

function EnforcementLine({ row }: { row: EnforcementRow }) {
  const failed = !!row.result && row.result !== 'ok';
  return (
    <li className="text-[11px] text-gray-600 dark:text-gray-400 tabular-nums truncate" title={row.detail ?? undefined}>
      <span className="text-gray-800 dark:text-gray-200">{ACTION_LABELS[row.action] ?? row.action}</span>
      {' · '}rung {row.rung}
      {' · '}{row.auto ? 'auto' : 'manual'}
      {' · '}{formatTime(row.ts)}
      {' · '}
      <span className={cx(failed && 'text-error-600 dark:text-error-400')}>
        {row.result ?? 'pending'}
      </span>
      {row.expires && ` · until ${formatTime(row.expires)}`}
    </li>
  );
}
