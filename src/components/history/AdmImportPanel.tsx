import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/base/button/button';
import { Input } from '@/components/base/input/input';
import { Select } from '@/components/base/select/select';
import { Badge } from '@/components/base/badges/badges';
import { FileClock, FolderSearch, AlertTriangle, Clock, Users, Database } from 'lucide-react';
import { apiFetch } from '@/utils/api';
import type { AdmScan, AdmImportJob } from '@/types/admImport';
import { fmtOffset } from '@/utils/formatOffset';
import { zoneOptions } from '@/utils/timezones';

/** Poll interval while an import is running. Imports are fast; this is for honesty, not suspense. */
const POLL_MS = 700;

/**
 * Sentinel for "none of these zones — use a raw offset".
 *
 * Not a real zone, and deliberately not a valid IANA name so it can never be sent
 * to the server by accident. The escape hatch exists for archives from a server
 * whose location nobody remembers; a zone is the right answer everywhere else,
 * because only a zone knows about daylight saving.
 */
const FIXED_OFFSET = '__fixed__';

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
    const [zoneChoice, setZoneChoice] = useState<string>('');
    const [offsetOverride, setOffsetOverride] = useState<string>('600');
    const [job, setJob] = useState<AdmImportJob | null>(null);
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const zones = useMemo(
        () => [...zoneOptions(), { label: 'Fixed offset (no daylight saving)', value: FIXED_OFFSET }],
        [],
    );

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

    /**
     * `zone` overrides the profile's setting for this preview. Re-scanning on a
     * zone change is what makes the panel honest: the dates it lists and the
     * agreement count it reports are both read through the chosen zone.
     */
    const runScan = useCallback(async (zone?: string) => {
        setScanning(true);
        setError(null);
        try {
            const params = new URLSearchParams();
            if (root.trim()) params.set('root', root.trim());
            if (zone && zone !== FIXED_OFFSET) params.set('timeZone', zone);
            const qs = params.toString() ? `?${params}` : '';
            const res = await apiFetch(`/api/logs/adm/scan${qs}`, { profileId: selectedProfileId });
            const data: AdmScan = await res.json();
            if (!res.ok) throw new Error((data as unknown as { error?: string }).error || 'Scan failed');
            setScan(data);
            if (!root.trim()) setRoot(data.defaultRoot);
            setZoneChoice((prev) => prev || data.zone.timeZone || data.profileTimeZone);
            // Seed the fixed-offset box from what the files themselves suggest, so
            // switching to it starts from evidence rather than from zero.
            setOffsetOverride(String(data.offset.offsetMinutes));
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
            setScan(null);
        } finally {
            setScanning(false);
        }
    }, [root, selectedProfileId]);

    const chooseZone = useCallback((next: string) => {
        setZoneChoice(next);
        if (scan) runScan(next);
    }, [scan, runScan]);

    const startImport = useCallback(async () => {
        setError(null);
        try {
            const res = await apiFetch('/api/logs/adm/import', {
                method: 'POST',
                profileId: selectedProfileId,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(zoneChoice === FIXED_OFFSET
                    ? { root: scan?.root, offsetMinutes: Number(offsetOverride) }
                    : { root: scan?.root, timeZone: zoneChoice }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Import failed to start');
            setJob(data);
            poll();
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        }
    }, [scan, zoneChoice, offsetOverride, selectedProfileId, poll]);

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
                <Button color="secondary" onClick={() => runScan(zoneChoice || undefined)} disabled={scanning || running}>
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

                    {/*
                      * Admin logs carry a wall clock and nothing else, so the zone is a
                      * setting rather than a fact in the data. It is shown, checked
                      * against the files themselves, and left editable.
                      */}
                    <div className="p-3 rounded-lg bg-gray-50 border border-gray-200 dark:bg-gray-900/40 dark:border-gray-700">
                        <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 shrink-0">Log timezone</span>
                            <Select
                                className="w-72"
                                size="sm"
                                options={zones}
                                value={zoneChoice}
                                onChange={e => chooseZone(e.target.value)}
                                aria-label="Log timezone"
                            />
                            {zoneChoice === FIXED_OFFSET && (
                                <>
                                    <Input
                                        className="w-24"
                                        value={offsetOverride}
                                        onChange={e => setOffsetOverride(typeof e === 'string' ? e : e.target.value)}
                                        aria-label="UTC offset in minutes"
                                    />
                                    <span className="text-xs text-gray-500 dark:text-gray-400">
                                        minutes = {fmtOffset(Number(offsetOverride) || 0)}
                                    </span>
                                </>
                            )}
                            {zoneChoice !== FIXED_OFFSET && scan.zone.offsets.map(o => (
                                <Badge key={o.minutes} color="gray" size="sm">
                                    {o.label} {fmtOffset(o.minutes)} · {o.files} file(s)
                                </Badge>
                            ))}
                        </div>

                        {/* Two offsets across one archive is daylight saving, and the
                          * single reason this is a zone picker and not a number box. */}
                        {zoneChoice !== FIXED_OFFSET && scan.zone.offsets.length > 1 && (
                            <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                                This archive spans a daylight-saving change. Each file is read at the
                                offset that was in force on its own date — a single fixed offset would
                                put half of them an hour out.
                            </p>
                        )}

                        <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                            Admin logs record a wall clock with no timezone, so this is the server&apos;s
                            setting rather than something in the files. Get it wrong and every imported
                            position lands at the wrong moment.
                        </p>

                        {/* The files' own mtimes are independent evidence for the choice. */}
                        {scan.zone.conflict > 0 ? (
                            <p className="mt-1.5 text-xs text-warning-700 dark:text-warning-400 flex items-start gap-1.5">
                                <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                                {scan.zone.conflict} file(s) were last written at{' '}
                                {fmtOffset(scan.zone.conflictOffset ?? 0)}, which this timezone does not
                                account for on those dates. Either the archive was copied (which rewrites
                                the timestamps this check relies on) or the timezone is wrong.
                            </p>
                        ) : scan.zone.agree > 0 ? (
                            <p className="mt-1.5 text-xs text-success-700 dark:text-success-400">
                                Confirmed against {scan.zone.agree} file(s) whose last entry matches when
                                they were last written.
                            </p>
                        ) : (
                            <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                                No file in this archive kept a usable modification time, so nothing here
                                can check the timezone for you.
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
                            <p>
                                {fmtDate(result.firstTs)} → {fmtDate(result.lastTs)}
                                {job.timeZone && <> · read as {job.timeZone}</>}
                                {job.offsetMinutes != null && <> · read at {fmtOffset(job.offsetMinutes)}</>}
                            </p>
                            {result.ambiguous > 0 && (
                                <p>
                                    {result.ambiguous.toLocaleString()} row(s) fell in an hour daylight
                                    saving replayed and were placed by the order they appear in the log.
                                </p>
                            )}
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
