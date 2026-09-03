import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';

// @ts-expect-error - test-only global flag not in the ambient types
global.IS_REACT_ACT_ENVIRONMENT = true;

import { BootProgress } from '@/components/layout/BootProgress';
import {
    beginRun,
    declareSteps,
    startStep,
    finishStep,
    endRun,
    __resetBootProgressForTests,
} from '@/stores/bootProgress';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    __resetBootProgressForTests();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
});

function render() {
    act(() => {
        root.render(React.createElement(BootProgress));
    });
}

/**
 * Mutate the store and let React's subscription flush.
 *
 * bootProgress coalesces notifications onto a microtask so a 24-step declareSteps
 * burst yields one render. That means subscribers wake one microtask after the
 * mutation, so assertions must go through an async act() to drain it.
 */
async function update(fn: () => void) {
    await act(async () => {
        fn();
    });
}

describe('BootProgress', () => {
    it('renders nothing when no run is in progress', async () => {
        render();
        expect(container.textContent).toBe('');
    });

    it('shows an indeterminate bar before the work is enumerated', async () => {
        await update(() => beginRun('p1'));
        render();

        expect(container.querySelector('.animate-boot-indeterminate')).not.toBeNull();
        expect(container.textContent).toContain('Starting up');
    });

    it('switches to a real width once steps are declared, and names the current file', async () => {
        await update(() => {
            beginRun('p1');
            declareSteps('session', 'types', [
                { id: 'a', label: 'weapons/types' },
                { id: 'b', label: 'clothes/types' },
            ]);
        });
        render();

        await update(() => {
            finishStep('a', { source: 'network' });
            startStep('b');
        });

        expect(container.querySelector('.animate-boot-indeterminate')).toBeNull();
        expect(container.textContent).toContain('Loading loot types');
        expect(container.textContent).toContain('clothes/types');
        expect(container.textContent).toContain('(2 / 2)');
        expect(container.textContent).toContain('from network');

        const bar = container.querySelector<HTMLElement>('[style*="width"]');
        expect(bar?.style.width).toBe('50%');
    });

    it('reports the cache/network split when the run completes', async () => {
        await update(() => {
            beginRun('p1');
            declareSteps('session', 'types', [
                { id: 'a', label: 'a' },
                { id: 'b', label: 'b' },
                { id: 'c', label: 'c' },
            ]);
        });
        render();

        await update(() => {
            finishStep('a', { source: 'cache' });
            finishStep('b', { source: 'cache' });
            finishStep('c', { source: 'network' });
            endRun('ready');
        });

        expect(container.textContent).toContain('Ready');
        expect(container.textContent).toContain('3 files (2 cached, 1 network)');
    });

    it('shows a Retry affordance and the failing detail on error', async () => {
        await update(() => {
            beginRun('p1');
            endRun('error', 'Live data API is unavailable.');
        });
        render();

        expect(container.textContent).toContain('Load failed');
        expect(container.textContent).toContain('Live data API is unavailable.');
        expect(container.textContent).toContain('Retry');
    });

    it('surfaces failed files without claiming the whole load failed', async () => {
        await update(() => {
            beginRun('p1');
            declareSteps('session', 'types', [
                { id: 'a', label: 'a' },
                { id: 'b', label: 'b' },
            ]);
        });
        render();

        await update(() => {
            finishStep('a', { error: 'HTTP 404' });
            startStep('b');
        });

        expect(container.textContent).toContain('1 failed');
        expect(container.textContent).not.toContain('Load failed');
    });

    it('expands to a per-file ledger split by track', async () => {
        await update(() => {
            beginRun('p1');
            declareSteps('session', 'types', [{ id: 's1', label: 'session-file' }]);
            declareSteps('baseline', 'types', [{ id: 'b1', label: 'baseline-file' }]);
            finishStep('s1', { source: 'cache' });
        });
        render();

        const toggle = container.querySelector<HTMLButtonElement>('button[aria-expanded]');
        expect(toggle).not.toBeNull();
        expect(container.textContent).not.toContain('Baseline (diff reference)');

        act(() => {
            toggle!.click();
        });

        expect(container.textContent).toContain('Session');
        // The duplicate baseline pass is visible for what it is — the point of the split.
        expect(container.textContent).toContain('Baseline (diff reference)');
        expect(container.textContent).toContain('session-file');
        expect(container.textContent).toContain('baseline-file');
        expect(container.textContent).toContain('cache');
    });
});
