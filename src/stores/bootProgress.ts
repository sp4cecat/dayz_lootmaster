/**
 * Boot progress ledger.
 *
 * The app's startup is ~80 mostly-sequential requests spread across two concurrent
 * passes in useLootData (the "session" pass that owns `loading`, and the "baseline"
 * pass that feeds the dirty-state diff). Neither pass reported anything beyond a
 * single boolean, so a slow reload — especially against a LAN share — looked like a
 * hang. This module is the ledger both passes report into.
 *
 * It deliberately lives outside React:
 *  - `refreshBaselineFromAPI` is a useCallback whose identity is the sole dependency
 *    of the effect that runs it. Threading a hook-provided reporter through it would
 *    re-trigger the whole boot pipeline on every progress tick.
 *  - ~80 setState calls during boot would re-render App and every heavy child; with a
 *    module store only the BootProgress component subscribes.
 *
 * Two channels feed it, and they are kept strictly separate so nothing double-counts:
 *  1. Determinate — explicit named steps (declareSteps/startStep/finishStep). These
 *     own the percentage, the labels and the cache-vs-network attribution.
 *  2. Ambient — a raw in-flight request counter fed from apiFetch. Display only; it
 *     never contributes to `percent`. It answers "is it stuck, or just slow?".
 */
import { useSyncExternalStore } from 'react';

export type BootTrack = 'session' | 'baseline';

export type BootPhase =
    | 'connect'
    | 'profiles'
    | 'definitions'
    | 'economycore'
    | 'vanilla'
    | 'types'
    | 'overrides'
    | 'cache'
    | 'persist'
    | 'spawnable'
    | 'presets'
    | 'globals'
    | 'done';

export type StepStatus = 'pending' | 'active' | 'done' | 'failed';

/** Where a completed step's data actually came from. IndexedDB hits issue no request at all. */
export type StepSource = 'network' | 'cache';

export interface BootStep {
    /** Track-prefixed so the two concurrent passes never collide, e.g. 'baseline:types:weapons/types'. */
    id: string;
    track: BootTrack;
    phase: BootPhase;
    label: string;
    /** Relative cost. 1 by default; vanilla types (~1 MB) is 8, the spawnabletypes root is 4. */
    weight: number;
    status: StepStatus;
    source?: StepSource;
    startedAt?: number;
    endedAt?: number;
    /** Response body length, for the detail panel and for profiling the follow-up work. */
    bytes?: number;
    error?: string;
}

export interface BootSnapshot {
    runId: number;
    status: 'idle' | 'running' | 'ready' | 'error';
    /** False until cfgeconomycore.xml reveals the file count; drives indeterminate vs real width. */
    determinate: boolean;
    /** 0..100, monotonic — never moves backwards even as totalWeight grows. */
    percent: number;
    doneWeight: number;
    totalWeight: number;
    phaseLabel: string;
    stepLabel: string;
    counter: string;
    sourceHint: string;
    fromCache: number;
    fromNetwork: number;
    failed: number;
    inFlight: number;
    startedAt: number;
    endedAt: number | null;
    error: string | null;
    steps: BootStep[];
}

const PHASE_LABELS: Record<BootPhase, string> = {
    connect: 'Connecting to server',
    profiles: 'Reading server profiles',
    definitions: 'Reading definitions',
    economycore: 'Reading economy core',
    vanilla: 'Loading vanilla types',
    types: 'Loading loot types',
    overrides: 'Loading vanilla overrides',
    cache: 'Reading local cache',
    persist: 'Saving to local cache',
    spawnable: 'Loading spawnable types',
    presets: 'Loading random presets',
    globals: 'Loading mission globals',
    done: 'Ready',
};

// --- module state -----------------------------------------------------------

const steps = new Map<string, BootStep>();
const listeners = new Set<() => void>();

let runId = 0;
let runProfileId = '';
let runStartedAt = 0;
let lastBeginAt = 0;
let status: BootSnapshot['status'] = 'idle';
let determinate = false;
let percentFloor = 0;
let inFlight = 0;
let endedAt: number | null = null;
let runError: string | null = null;
/** The session pass has called endRun; the run completes once the baseline pass drains too. */
let sessionDone = false;

let cached: BootSnapshot | null = null;
let notifyQueued = false;

/**
 * Invalidate the memoized snapshot and wake subscribers on a microtask, so a
 * declareSteps([...24]) burst yields one render rather than twenty-four.
 */
function invalidate(): void {
    cached = null;
    if (notifyQueued) return;
    notifyQueued = true;
    queueMicrotask(() => {
        notifyQueued = false;
        for (const listener of listeners) listener();
    });
}

function resetRun(profileId: string): void {
    runId += 1;
    runProfileId = profileId;
    runStartedAt = Date.now();
    steps.clear();
    status = 'running';
    determinate = false;
    percentFloor = 0;
    endedAt = null;
    runError = null;
    sessionDone = false;
    invalidate();
}

// --- mutators ---------------------------------------------------------------

/**
 * Start a boot run. Idempotent against React StrictMode's double-invoked effects:
 * a repeat call for the profile already running is a no-op rather than a reset.
 */
export function beginRun(profileId: string): void {
    const now = Date.now();
    if (status === 'running' && profileId === runProfileId) return;
    if (profileId === runProfileId && now - lastBeginAt < 100) return;
    lastBeginAt = now;
    resetRun(profileId);
}

/**
 * Register work that is now known about but has not started. This is what flips the
 * bar from indeterminate to determinate — the denominator only exists once
 * cfgeconomycore.xml has been parsed.
 */
export function declareSteps(
    track: BootTrack,
    phase: BootPhase,
    items: { id: string; label: string; weight?: number }[],
): void {
    if (items.length === 0) return;
    for (const item of items) {
        if (steps.has(item.id)) continue;
        steps.set(item.id, {
            id: item.id,
            track,
            phase,
            label: item.label,
            weight: item.weight ?? 1,
            status: 'pending',
        });
    }
    determinate = true;
    invalidate();
}

/**
 * Rename a step after the fact, for labels that only become knowable once the work is
 * done (e.g. how many files an IndexedDB read actually restored).
 */
export function relabelStep(id: string, label: string): void {
    const existing = steps.get(id);
    if (!existing) return;
    existing.label = label;
    invalidate();
}

export function startStep(id: string): void {
    const existing = steps.get(id);
    // 'done' and 'failed' are terminal: StrictMode's second pass must not rewind the bar.
    if (!existing || existing.status === 'done' || existing.status === 'failed') return;
    existing.status = 'active';
    existing.startedAt = Date.now();
    invalidate();
}

export function finishStep(
    id: string,
    opts: { source?: StepSource; bytes?: number; error?: string } = {},
): void {
    const existing = steps.get(id);
    if (!existing || existing.status === 'done' || existing.status === 'failed') return;
    existing.status = opts.error ? 'failed' : 'done';
    existing.endedAt = Date.now();
    if (opts.source) existing.source = opts.source;
    if (typeof opts.bytes === 'number') existing.bytes = opts.bytes;
    if (opts.error) existing.error = opts.error;
    maybeFinishRun();
    invalidate();
}

/**
 * One-shot helper for work that isn't worth pre-declaring. Registers the step,
 * marks it active, and hands back its terminators.
 */
export function step(
    track: BootTrack,
    phase: BootPhase,
    id: string,
    label: string,
    weight = 1,
): { done: (opts?: { source?: StepSource; bytes?: number }) => void; fail: (message: string) => void } {
    if (!steps.has(id)) {
        steps.set(id, { id, track, phase, label, weight, status: 'pending' });
    }
    startStep(id);
    return {
        done: (opts = {}) => finishStep(id, { source: opts.source ?? 'network', bytes: opts.bytes }),
        fail: (message: string) => finishStep(id, { error: message || 'failed' }),
    };
}

/**
 * The session pass is finished. The run only reports 'ready' once the baseline pass
 * has drained too — otherwise the bar would claim completion while the machine is
 * still grinding through the duplicate pass over the wire.
 */
export function endRun(next: 'ready' | 'error' | 'idle', error?: string): void {
    if (next === 'idle') {
        status = 'idle';
        sessionDone = true;
        endedAt = Date.now();
        invalidate();
        return;
    }
    if (next === 'error') {
        status = 'error';
        runError = error ?? 'Load failed';
        endedAt = Date.now();
        invalidate();
        return;
    }
    sessionDone = true;
    maybeFinishRun();
    invalidate();
}

function maybeFinishRun(): void {
    if (!sessionDone || status !== 'running') return;
    for (const s of steps.values()) {
        if (s.status === 'pending' || s.status === 'active') return;
    }
    status = 'ready';
    endedAt = Date.now();
    percentFloor = 100;
}

// --- ambient channel --------------------------------------------------------

export function noteRequest(): void {
    inFlight += 1;
    if (status === 'running') invalidate();
}

export function noteResponse(): void {
    inFlight = Math.max(0, inFlight - 1);
    if (status === 'running') invalidate();
}

// --- snapshot ---------------------------------------------------------------

function computeSnapshot(): BootSnapshot {
    const all = [...steps.values()];

    let totalWeight = 0;
    let doneWeight = 0;
    let fromCache = 0;
    let fromNetwork = 0;
    let failed = 0;

    for (const s of all) {
        totalWeight += s.weight;
        if (s.status === 'done' || s.status === 'failed') doneWeight += s.weight;
        if (s.status === 'failed') {
            failed += 1;
        } else if (s.status === 'done') {
            if (s.source === 'cache') fromCache += 1;
            else if (s.source === 'network') fromNetwork += 1;
        }
    }

    const raw = totalWeight > 0 ? (doneWeight / totalWeight) * 100 : 0;
    // totalWeight grows as the pipeline discovers work, so a naive ratio would jump
    // backwards and read as broken. Clamp to the high-water mark instead.
    percentFloor = Math.max(percentFloor, Math.min(100, raw));
    const percent = status === 'ready' ? 100 : percentFloor;

    // Prefer the session pass for the headline label: the two passes interleave, and
    // session is the one the user is actually waiting on.
    const active =
        all.find((s) => s.status === 'active' && s.track === 'session') ??
        all.find((s) => s.status === 'active') ??
        null;

    let phaseLabel = '';
    let stepLabel = '';
    let counter = '';
    let sourceHint = '';

    if (status === 'ready') {
        const seconds = ((endedAt ?? Date.now()) - runStartedAt) / 1000;
        const fileCount = fromCache + fromNetwork;
        phaseLabel = 'Ready';
        stepLabel = `${fileCount} file${fileCount === 1 ? '' : 's'} (${fromCache} cached, ${fromNetwork} network) in ${seconds.toFixed(1)} s`;
    } else if (status === 'error') {
        const failedStep = all.find((s) => s.status === 'failed');
        phaseLabel = 'Load failed';
        stepLabel = runError ?? failedStep?.error ?? '';
    } else if (active) {
        phaseLabel = PHASE_LABELS[active.phase];
        stepLabel = active.label;

        const peers = all.filter((s) => s.track === active.track && s.phase === active.phase);
        if (peers.length > 1) {
            const settled = peers.filter((s) => s.status === 'done' || s.status === 'failed').length;
            counter = `(${Math.min(settled + 1, peers.length)} / ${peers.length})`;
        }

        // Attribute from the most recent settled peer — the active step's own source
        // isn't known until it lands.
        for (let i = peers.length - 1; i >= 0; i -= 1) {
            if (peers[i].status === 'done' && peers[i].source) {
                sourceHint = peers[i].source === 'cache' ? 'from cache' : 'from network';
                break;
            }
        }
    } else if (status === 'running') {
        phaseLabel = 'Starting up';
    }

    return {
        runId,
        status,
        determinate,
        percent,
        doneWeight,
        totalWeight,
        phaseLabel,
        stepLabel,
        counter,
        sourceHint,
        fromCache,
        fromNetwork,
        failed,
        inFlight,
        startedAt: runStartedAt,
        endedAt,
        error: runError,
        steps: all,
    };
}

/** useSyncExternalStore requires a referentially stable snapshot between notifications. */
export function getBootSnapshot(): BootSnapshot {
    if (!cached) cached = computeSnapshot();
    return cached;
}

const EMPTY_SNAPSHOT: BootSnapshot = {
    runId: 0,
    status: 'idle',
    determinate: false,
    percent: 0,
    doneWeight: 0,
    totalWeight: 0,
    phaseLabel: '',
    stepLabel: '',
    counter: '',
    sourceHint: '',
    fromCache: 0,
    fromNetwork: 0,
    failed: 0,
    inFlight: 0,
    startedAt: 0,
    endedAt: null,
    error: null,
    steps: [],
};

function subscribe(callback: () => void): () => void {
    listeners.add(callback);
    return () => {
        listeners.delete(callback);
    };
}

const getServerSnapshot = () => EMPTY_SNAPSHOT;

export function useBootProgress(): BootSnapshot {
    return useSyncExternalStore(subscribe, getBootSnapshot, getServerSnapshot);
}

/** Test seam: drop all state so cases don't leak into each other. */
export function __resetBootProgressForTests(): void {
    steps.clear();
    runId = 0;
    runProfileId = '';
    runStartedAt = 0;
    lastBeginAt = 0;
    status = 'idle';
    determinate = false;
    percentFloor = 0;
    inFlight = 0;
    endedAt = null;
    runError = null;
    sessionDone = false;
    cached = null;
}
