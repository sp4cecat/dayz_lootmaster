import { describe, it, expect, beforeEach } from 'vitest';
import {
    beginRun,
    declareSteps,
    startStep,
    finishStep,
    relabelStep,
    step,
    endRun,
    noteRequest,
    noteResponse,
    getBootSnapshot,
    __resetBootProgressForTests,
} from './bootProgress';

beforeEach(() => {
    __resetBootProgressForTests();
});

describe('percent', () => {
    it('never moves backwards when totalWeight grows mid-run', () => {
        beginRun('p1');

        // Early phase: one small step, finished. Percent is high because the pipeline
        // does not yet know how much work is coming.
        declareSteps('session', 'connect', [{ id: 'a', label: 'a' }]);
        finishStep('a', { source: 'network' });
        const afterFirst = getBootSnapshot().percent;
        expect(afterFirst).toBe(100);

        // cfgeconomycore.xml lands and reveals 24 more files. A naive done/total would
        // now read 4%, which looks like the bar broke.
        declareSteps(
            'session',
            'types',
            Array.from({ length: 24 }, (_, i) => ({ id: `t${i}`, label: `f${i}` })),
        );
        expect(getBootSnapshot().percent).toBe(afterFirst);

        finishStep('t0', { source: 'network' });
        expect(getBootSnapshot().percent).toBeGreaterThanOrEqual(afterFirst);
    });

    it('weights heavy files above small ones', () => {
        beginRun('p1');
        declareSteps('session', 'vanilla', [{ id: 'v', label: 'db/types.xml', weight: 8 }]);
        declareSteps('session', 'types', [
            { id: 'x', label: 'x' },
            { id: 'y', label: 'y' },
        ]);

        finishStep('x', { source: 'network' });
        // 1 of 10 weight, not 1 of 3.
        expect(getBootSnapshot().percent).toBeCloseTo(10, 5);
    });

    it('flips from indeterminate to determinate once work is declared', () => {
        beginRun('p1');
        expect(getBootSnapshot().determinate).toBe(false);
        declareSteps('session', 'types', [{ id: 'a', label: 'a' }]);
        expect(getBootSnapshot().determinate).toBe(true);
    });
});

describe('source attribution', () => {
    it('counts cache and network hits separately', () => {
        beginRun('p1');
        declareSteps('session', 'types', [
            { id: 'a', label: 'a' },
            { id: 'b', label: 'b' },
            { id: 'c', label: 'c' },
        ]);

        finishStep('a', { source: 'cache' });
        finishStep('b', { source: 'network' });
        finishStep('c', { error: 'HTTP 404' });

        const snap = getBootSnapshot();
        expect(snap.fromCache).toBe(1);
        expect(snap.fromNetwork).toBe(1);
        expect(snap.failed).toBe(1);
    });

    it('reports a failed step without aborting the run', () => {
        beginRun('p1');
        declareSteps('baseline', 'types', [
            { id: 'a', label: 'a' },
            { id: 'b', label: 'b' },
        ]);
        finishStep('a', { error: 'request failed' });
        finishStep('b', { source: 'network' });

        const snap = getBootSnapshot();
        expect(snap.failed).toBe(1);
        expect(snap.status).not.toBe('error');
    });
});

describe('run lifecycle', () => {
    it('is idempotent against StrictMode double-invoked effects', () => {
        beginRun('p1');
        declareSteps('session', 'types', [{ id: 'a', label: 'a' }]);
        finishStep('a', { source: 'network' });
        const runId = getBootSnapshot().runId;

        // Second pass: same profile, immediately after. Must not reset the ledger or
        // rewind a completed step.
        beginRun('p1');
        startStep('a');
        finishStep('a', { source: 'cache' });

        const snap = getBootSnapshot();
        expect(snap.runId).toBe(runId);
        expect(snap.fromNetwork).toBe(1);
        expect(snap.fromCache).toBe(0);
    });

    it('resets when a different profile starts loading', () => {
        beginRun('p1');
        declareSteps('session', 'types', [{ id: 'a', label: 'a' }]);
        finishStep('a', { source: 'network' });
        const firstRun = getBootSnapshot().runId;

        beginRun('p2');
        const snap = getBootSnapshot();
        expect(snap.runId).toBeGreaterThan(firstRun);
        expect(snap.steps).toHaveLength(0);
        expect(snap.percent).toBe(0);
    });

    it('waits for the baseline pass before reporting ready', () => {
        beginRun('p1');
        declareSteps('session', 'types', [{ id: 's1', label: 's1' }]);
        declareSteps('baseline', 'types', [{ id: 'b1', label: 'b1' }]);

        finishStep('s1', { source: 'cache' });
        endRun('ready');
        // The session pass is done but the baseline pass is still grinding over the
        // wire — claiming "ready" here is exactly the lie this guards against.
        expect(getBootSnapshot().status).toBe('running');

        finishStep('b1', { source: 'network' });
        const snap = getBootSnapshot();
        expect(snap.status).toBe('ready');
        expect(snap.percent).toBe(100);
    });

    it('surfaces the error message on failure', () => {
        beginRun('p1');
        endRun('error', 'Live data API is unavailable.');
        const snap = getBootSnapshot();
        expect(snap.status).toBe('error');
        expect(snap.stepLabel).toBe('Live data API is unavailable.');
    });
});

describe('labels', () => {
    it('prefers the session track for the headline label', () => {
        beginRun('p1');
        declareSteps('baseline', 'types', [{ id: 'b1', label: 'baseline-file' }]);
        declareSteps('session', 'spawnable', [{ id: 's1', label: 'session-file' }]);

        startStep('b1');
        expect(getBootSnapshot().stepLabel).toBe('baseline-file');

        // Once the session pass has something active it wins: it is what the user is
        // actually waiting on.
        startStep('s1');
        expect(getBootSnapshot().stepLabel).toBe('session-file');
        expect(getBootSnapshot().phaseLabel).toBe('Loading spawnable types');
    });

    it('counts within the active track and phase only', () => {
        beginRun('p1');
        declareSteps('session', 'types', [
            { id: 'a', label: 'a' },
            { id: 'b', label: 'b' },
            { id: 'c', label: 'c' },
        ]);
        declareSteps('baseline', 'types', [{ id: 'z', label: 'z' }]);

        finishStep('a', { source: 'network' });
        startStep('b');
        expect(getBootSnapshot().counter).toBe('(2 / 3)');
    });

    it('relabels a step once the real count is known', () => {
        beginRun('p1');
        const s = step('session', 'cache', 'session:cache:types', 'loot type files');
        relabelStep('session:cache:types', 'restored 24 loot type files');
        s.done({ source: 'cache' });
        expect(getBootSnapshot().steps[0].label).toBe('restored 24 loot type files');
    });
});

describe('ambient request counter', () => {
    it('tracks in-flight requests without affecting percent', () => {
        beginRun('p1');
        declareSteps('session', 'types', [{ id: 'a', label: 'a' }]);

        noteRequest();
        noteRequest();
        expect(getBootSnapshot().inFlight).toBe(2);
        expect(getBootSnapshot().percent).toBe(0);

        noteResponse();
        expect(getBootSnapshot().inFlight).toBe(1);

        // Never goes negative even if responses outnumber tracked requests.
        noteResponse();
        noteResponse();
        expect(getBootSnapshot().inFlight).toBe(0);
    });
});

describe('snapshot identity', () => {
    it('returns a stable reference between mutations', () => {
        beginRun('p1');
        declareSteps('session', 'types', [{ id: 'a', label: 'a' }]);
        const first = getBootSnapshot();
        expect(getBootSnapshot()).toBe(first);

        finishStep('a', { source: 'network' });
        expect(getBootSnapshot()).not.toBe(first);
    });
});
