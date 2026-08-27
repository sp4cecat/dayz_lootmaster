import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/base/button/button';
import { Input } from '@/components/base/input/input';
import { Badge } from '@/components/base/badges/badges';
import { FileClock, FolderSearch, AlertTriangle, Clock, Users, Database } from 'lucide-react';
import { apiFetch } from '@/utils/api';
import type { AdmScan, AdmImportJob } from '@/types/admImport';
import { fmtOffset } from '@/utils/formatOffset';

/** Poll interval while an import is running. Imports are fast; this is for honesty, not suspense. */
const POLL_MS = 700;

const fmtBytes = (n: number) => (
    n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB`
        : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB`
            : `${Math.max(1, Math.round(n / 1e3))} KB`
);

const fmtDate = (ms: number | null | undefined) =>
    (ms ? new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—');


/**
 * Backfill the player-history store from archived DayZ admin logs.
 *
 * Lives on the Profiles screen because everything it needs hangs off the profile's
 * server path: the log archive itself, and the companion mod's GUID ledger that
 * translates the logs' player ids into the ones history is keyed on.
 */
export default function AdmImportPanel({ selectedProfileId }: { selectedProfileId: string }) {
    const [root, setRoot] = useState('');
    const [scan, setScan] = useState<AdmScan | null>(null);
    const [scanning, setScanning] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [offsetOverride, setOffsetOverride] = useState<string>('');
    const [job, setJob] = useState<AdmImportJob | null>(null);
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const stopPolling = useCallback(() => {
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    }, []);

    // A job started before this panel mounted (or survived a tab switch) is still
    // running on the server, so adopt it rather than showing an idle panel.
    useEffect(() => {
        let cancelled = false;
        apiFetch('/api/logs/adm/import', { profileId: selectedProfileId })
            .then(r => r.json())
            .then((j: AdmImportJob) => { if (!cancelled && !j.idle) setJob(j); })
            .catch(() => { /* nothing running is the normal case */ });
        return () => { cancelled = true; stopPolling(); };
    }, [selectedProfileId, stopPolling]);

    const poll = useCallback(() => {
        stopPolling();
        pollRef.current = setInterval(async () => {
            try {
                const res = await apiFetch('/api/logs/adm/import', { profileId: selectedProfileId });
                const j: AdmImportJob = await res.json();
                setJob(j);
                if (!j.running) stopPolling();
            } catch {
                stopPolling();
            }
        }, POLL_MS);
    }, [selectedProfileId, stopPolling]);

    const runScan = useCallback(async () => {
        setScanning(true);
        setError(null);
        try {
            const qs = root.trim() ? `?root=${encodeURIComponent(root.trim())}` : '';
            const res = await apiFetch(`/api/logs/adm/scan${qs}`, { profileId: selectedProfileId });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Scan failed');
            setScan(data);
            if (!root.trim()) setRoot(data.defaultRoot);
            setOffsetOverride(String(data.offset.offsetMinutes));
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
            setScan(null);
        } finally {
            setScanning(false);
        }
    }, [root, selectedProfileId]);

    const startImport = useCallback(async () => {
        setError(null);
        try {
            const res = await apiFetch('/api/logs/adm/import', {
                method: 'POST',
                profileId: selectedProfileId,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    root: scan?.root,
                    offsetMinutes: Number(offsetOverride),
                }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Import failed to start');
            setJob(data);
            poll();
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        }
    }, [scan, offsetOverride, selectedProfileId, poll]);

    const cancelImport = useCallback(async () => {
        await apiFetch('/api/logs/adm/import', { method: 'DELETE', profileId: selectedProfileId })
            .catch(() => { /* the poll will report the real state */ });
    }, [selectedProfileId]);

    const importable = scan?.files.filter(f => !f.skip) ?? [];
    const totalBytes = importable.reduce((a, f) => a + f.bytes, 0);
    const running = !!job?.running;
    const result = job?.result;

    return (
        <div className="p-5 bg-white border border-gray-200 rounded-2xl dark:bg-gray-800/50 dark:border-gray-700">
            <div className="flex items-start gap-3 mb-4">
                <div className="size-10 rounded-xl bg-gray-100 text-gray-500 flex items-center justify-center shrink-0 dark:bg-gray-800 dark:text-gray-400">
                    <FileClock size={20} />
                </div>
                <div className="flex-1">
                    <p className="text-sm font-bold text-gray-900 dark:text-white">Import history from admin logs</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                        Backfill player tracking from archived <code>.ADM</code> files, for the period before
                        the companion mod was recording. Positions come from the periodic player-list dumps,
                        so resolution is about 5 minutes rather than the mod&apos;s 5 seconds.
                    </p>
                </div>
            </div>

            <div className="flex gap-2 mb-4">
                <Input
                    value={root}
                    onChange={e => setRoot(typeof e === 'string' ? e : e.target.value)}
                    placeholder="Log folder (defaults to the profile's log_storage)"
                    aria-label="Log folder"
                />
                <Button color="secondary" onClick={runScan} disabled={scanning || running}>
                    <FolderSearch size={16} className="mr-1.5" />
                    {scanning ? 'Scanning…' : 'Scan'}
                </Button>
            </div>

            {error && (
                <div className="mb-4 p-3 rounded-lg bg-error-50 border border-error-200 text-xs text-error-700 dark:bg-error-900/20 dark:border-error-900 dark:text-error-300">
                    {error}
                </div>
            )}

            {scan && (
                <div className="space-y-4">
                    <div className="grid grid-cols-3 gap-3">
                        <Stat icon={<Database size={14} />} label="Log files" value={String(importable.length)}
                            sub={totalBytes ? fmtBytes(totalBytes) : undefined} />
                        <Stat icon={<Clock size={14} />} label="Earliest entry"
                            value={fmtDate(importable[0]?.startsAt)} />
                        <Stat icon={<Users size={14} />} label="ID ledger"
                            value={scan.ledger.ok ? `${scan.ledger.size} known` : 'Not found'} />
                    </div>

                    {/* The timezone is inferred, never recorded, so it is shown rather than assumed. */}
                    <div className="p-3 rounded-lg bg-gray-50 border border-gray-200 dark:bg-gray-900/40 dark:border-gray-700">
                        <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">Log timezone</span>
                            <Input
                                className="w-28"
                                value={offsetOverride}
                                onChange={e => setOffsetOverride(typeof e === 'string' ? e : e.target.value)}
                                aria-label="UTC offset in minutes"
                            />
                            <span className="text-xs text-gray-500 dark:text-gray-400">
                                minutes = {fmtOffset(Number(offsetOverride) || 0)}
                            </span>
                            {scan.offset.source === 'default' ? (
                                <Badge color="warning" size="sm">Not detected — assuming +10:00</Badge>
                            ) : (
                                <Badge color="success" size="sm">
                                    Detected from {scan.offset.source === 'mtime' ? 'file times' : 'log folders'}
                                    {' '}({scan.offset.votes}/{scan.offset.total} files)
                                </Badge>
                            )}
                        </div>
                        <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                            Admin logs record a wall clock with no timezone. This is inferred by comparing
                            each file&apos;s last entry against its modification time. Get it wrong and every
                            imported position lands at the wrong moment, so check it before importing.
                        </p>
                        {scan.offset.disagreement > 0 && (
                            <p className="mt-1.5 text-xs text-warning-700 dark:text-warning-400 flex items-start gap-1.5">
                                <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                                {scan.offset.disagreement} file(s) disagreed. That usually means the archive was
                                copied or edited, which rewrites the timestamps this relies on.
                            </p>
                        )}
                    </div>

                    {!scan.ledger.ok && (
                        <p className="text-xs text-warning-700 dark:text-warning-400 flex items-start gap-1.5">
                            <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                            No GUID ledger at <code className="mx-1">{scan.ledger.path}</code>. Admin logs identify
                            players by a different id than the live recorder does, so imported tracks will be listed
                            under their log name and will not merge with mod-recorded history for the same person.
                            The ledger is written by the companion mod once it has seen a player log in.
                        </p>
                    )}

                    <div className="flex items-center gap-2">
                        <Button onClick={startImport} disabled={running || !importable.length}>
                            {running ? 'Importing…' : `Import ${importable.length} file(s)`}
                        </Button>
                        {running && (
                            <Button color="secondary" onClick={cancelImport}>Cancel</Button>
                        )}
                    </div>
                </div>
            )}

            {job && !job.idle && (
                <div className="mt-4 p-3 rounded-lg bg-gray-50 border border-gray-200 dark:bg-gray-900/40 dark:border-gray-700">
                    {running ? (
                        <p className="text-xs text-gray-600 dark:text-gray-300">
                            {job.progress?.files ?? 0} of {job.totalFiles ?? 0} files ·{' '}
                            {(job.progress?.inserted ?? 0).toLocaleString()} rows stored
                        </p>
                    ) : job.error ? (
                        <p className="text-xs text-error-700 dark:text-error-400">Import failed: {job.error}</p>
                    ) : result ? (
                        <div className="text-xs text-gray-600 dark:text-gray-300 space-y-1">
                            <p className="font-semibold text-gray-900 dark:text-white">
                                {job.aborted ? 'Import cancelled' : 'Import complete'}
                            </p>
                            <p>
                                {result.inserted.toLocaleString()} rows stored from {result.files} file(s)
                                {result.rows > result.inserted && (
                                    <> · {(result.rows - result.inserted).toLocaleString()} already present</>
                                )}
                            </p>
                            <p>{fmtDate(result.firstTs)} → {fmtDate(result.lastTs)}</p>
                            {result.unresolved > 0 && (
                                <p className="text-warning-700 dark:text-warning-400">
                                    {result.unresolvedGuids} player(s) could not be matched to a Steam ID and are
                                    stored under their log id.
                                </p>
                            )}
                            {result.errors.length > 0 && (
                                <p className="text-error-700 dark:text-error-400">
                                    {result.errors.length} file(s) errored — first: {result.errors[0].error}
                                </p>
                            )}
                        </div>
                    ) : null}
                </div>
            )}
        </div>
    );
}

function Stat({ icon, label, value, sub }: {
  icon: React.ReactNode; label: string; value: string; sub?: string;
}) {
    return (
        <div className="p-3 rounded-lg bg-gray-50 border border-gray-200 dark:bg-gray-900/40 dark:border-gray-700">
            <div className="flex items-center gap-1.5 text-gray-500 dark:text-gray-400 mb-1">
                {icon}
                <span className="text-xs">{label}</span>
            </div>
            <p className="text-sm font-semibold text-gray-900 dark:text-white truncate" title={value}>{value}</p>
            {sub && <p className="text-xs text-gray-400">{sub}</p>}
        </div>
    );
}
