import { useEffect, useState } from 'react';
import { CheckCircle, AlertCircle, ChevronDown } from '@untitledui/icons';
import { cx } from '@/utils/cx';
import { Button } from '@/components/base/button/button';
import { useBootProgress, type BootStep } from '@/stores/bootProgress';

/**
 * Global boot indicator: a thin determinate bar pinned to the top of the viewport plus a
 * status strip naming the current step.
 *
 * Mounted on every screen. The only prior loading UI was gated on `view === 'cle'`, so a
 * reload straight into the live map or loadout designer showed nothing at all while ~80
 * requests ran — that silence is what this replaces.
 */
export function BootProgress() {
    const boot = useBootProgress();
    const [expanded, setExpanded] = useState(false);
    const [visible, setVisible] = useState(false);

    const { status } = boot;

    // Hold the strip on screen briefly after a successful run so the summary is readable,
    // then unmount. Errors stay until the user reloads.
    useEffect(() => {
        if (status === 'running' || status === 'error') {
            setVisible(true);
            return;
        }
        if (status === 'ready') {
            setVisible(true);
            const id = setTimeout(() => {
                setVisible(false);
                setExpanded(false);
            }, 2500);
            return () => clearTimeout(id);
        }
        setVisible(false);
    }, [status]);

    if (!visible) return null;

    const isError = status === 'error';
    const isReady = status === 'ready';
    const indeterminate = status === 'running' && !boot.determinate;

    return (
        <>
            {/* Fixed rather than in-flow: the shell at App.tsx is a h-screen flex row with
                [contain:layout], and a bar in the document flow would shift it by 2px. */}
            <div
                aria-hidden
                className={cx(
                    'fixed top-0 inset-x-0 z-50 h-0.5 overflow-hidden bg-transparent transition-opacity duration-500',
                    isReady ? 'opacity-0' : 'opacity-100',
                )}
            >
                {indeterminate ? (
                    <div className="h-full w-1/3 bg-primary-600 animate-boot-indeterminate" />
                ) : (
                    <div
                        className={cx(
                            'h-full transition-[width] duration-300 ease-out',
                            isError ? 'bg-error-600' : 'bg-primary-600',
                        )}
                        style={{ width: `${boot.percent}%` }}
                    />
                )}
            </div>

            <div
                data-boot-progress={status}
                className="shrink-0 border-b border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900"
            >
                <div className="flex items-center gap-3 px-6 py-2">
                    <StatusDot status={status} />

                    <div className="flex min-w-0 flex-1 items-baseline gap-2">
                        <span
                            className={cx(
                                'text-xs font-medium truncate',
                                isError ? 'text-error-700 dark:text-error-400' : 'text-gray-700 dark:text-gray-300',
                            )}
                        >
                            {boot.phaseLabel}
                            {boot.stepLabel ? ` — ${boot.stepLabel}` : ''}
                        </span>
                        {boot.counter && (
                            <span className="shrink-0 text-xs tabular-nums text-gray-500 dark:text-gray-400">
                                {boot.counter}
                            </span>
                        )}
                    </div>

                    <div className="flex shrink-0 items-center gap-3 text-[10px] text-gray-400 dark:text-gray-500">
                        {boot.sourceHint && <span>{boot.sourceHint}</span>}
                        {status === 'running' && boot.inFlight > 0 && <span>{boot.inFlight} in flight</span>}
                        {boot.failed > 0 && (
                            <span className="text-warning-600 dark:text-warning-500">
                                {boot.failed} failed
                            </span>
                        )}
                    </div>

                    {isError && (
                        <Button
                            variant="link-gray"
                            size="sm"
                            className="shrink-0 text-error-600 hover:text-error-800 dark:text-error-400 dark:hover:text-error-300"
                            onClick={() => window.location.reload()}
                        >
                            Retry
                        </Button>
                    )}

                    {boot.steps.length > 0 && (
                        <button
                            type="button"
                            onClick={() => setExpanded((v) => !v)}
                            aria-expanded={expanded}
                            aria-label={expanded ? 'Hide load detail' : 'Show load detail'}
                            className="shrink-0 rounded p-0.5 text-gray-400 transition-colors hover:text-gray-700 dark:hover:text-gray-200"
                        >
                            <ChevronDown
                                size={14}
                                className={cx('transition-transform', expanded && 'rotate-180')}
                            />
                        </button>
                    )}
                </div>

                {expanded && <BootDetail steps={boot.steps} />}
            </div>
        </>
    );
}

function StatusDot({ status }: { status: string }) {
    if (status === 'ready') {
        return <CheckCircle size={14} className="shrink-0 text-success-600" />;
    }
    if (status === 'error') {
        return <AlertCircle size={14} className="shrink-0 text-error-600" />;
    }
    return <span className="size-1.5 shrink-0 rounded-full bg-primary-500 animate-pulse" />;
}

/** Per-file ledger, grouped by track so the duplicate baseline pass is visible for what it is. */
function BootDetail({ steps }: { steps: BootStep[] }) {
    const tracks: { key: 'session' | 'baseline'; title: string }[] = [
        { key: 'session', title: 'Session' },
        { key: 'baseline', title: 'Baseline (diff reference)' },
    ];

    return (
        <div className="max-h-64 overflow-auto border-t border-gray-100 bg-gray-50 px-6 py-2 dark:border-gray-800 dark:bg-gray-950">
            {tracks.map(({ key, title }) => {
                const rows = steps.filter((s) => s.track === key);
                if (rows.length === 0) return null;
                const settled = rows.filter((s) => s.status === 'done' || s.status === 'failed').length;

                return (
                    <div key={key} className="mb-2 last:mb-0">
                        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
                            {title} — {settled} / {rows.length}
                        </p>
                        <ul className="space-y-px">
                            {rows.map((s) => (
                                <li
                                    key={s.id}
                                    className="flex items-center gap-2 text-[11px] text-gray-600 dark:text-gray-400"
                                >
                                    <span
                                        className={cx(
                                            'size-1 shrink-0 rounded-full',
                                            s.status === 'done' && 'bg-success-500',
                                            s.status === 'failed' && 'bg-error-500',
                                            s.status === 'active' && 'bg-primary-500 animate-pulse',
                                            s.status === 'pending' && 'bg-gray-300 dark:bg-gray-700',
                                        )}
                                    />
                                    <span className="min-w-0 flex-1 truncate">{s.label}</span>
                                    {s.source && (
                                        <span
                                            className={cx(
                                                'shrink-0 rounded px-1 text-[9px] font-medium',
                                                s.source === 'cache'
                                                    ? 'bg-gray-200 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                                                    : 'bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300',
                                            )}
                                        >
                                            {s.source}
                                        </span>
                                    )}
                                    <span className="w-14 shrink-0 text-right tabular-nums text-gray-400 dark:text-gray-600">
                                        {formatDuration(s)}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </div>
                );
            })}
        </div>
    );
}

function formatDuration(s: BootStep): string {
    if (s.startedAt == null || s.endedAt == null) return '';
    const ms = s.endedAt - s.startedAt;
    return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`;
}

export default BootProgress;
