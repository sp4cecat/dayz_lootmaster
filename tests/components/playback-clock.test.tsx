import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import {
    fitSpeed, usePlaybackClock, type PlaybackClock, type PlaybackOptions,
} from '../../src/hooks/usePlaybackClock';

// @ts-expect-error - test-only global flag not in the ambient types
global.IS_REACT_ACT_ENVIRONMENT = true;

/**
 * The clock advances off requestAnimationFrame timestamps, so the frames are
 * driven by hand here. Real rAF would make these tests depend on how long the
 * suite happens to take.
 */
let frames: FrameRequestCallback[];

function pumpFrame(now: number) {
    const due = frames;
    frames = [];
    act(() => { due.forEach((f) => f(now)); });
}

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let clock: PlaybackClock;

// One stable component type, so a second render is a re-render rather than a
// remount — otherwise every hook state resets and nothing about persistence can
// be tested.
let props: { from: number; to: number; opts?: PlaybackOptions };

function Probe() {
    clock = usePlaybackClock(props.from, props.to, props.opts);
    return null;
}

function mount(from: number, to: number, opts?: PlaybackOptions) {
    props = { from, to, opts };
    act(() => { root.render(<Probe />); });
}

/** Same tree, new props: what happens when the selection changes underneath. */
const rerender = mount;

beforeEach(() => {
    frames = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
        frames.push(cb);
        return frames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
});

const HOUR = 3600_000;
const T0 = 1_700_000_000_000;

// A window two days wide in which the players are present for one hour, twice —
// the shape a backfilled admin-log archive actually has.
const WINDOW = { from: T0, to: T0 + 48 * HOUR };
const SEGMENTS = [
    { from: T0 + 24 * HOUR, to: T0 + 25 * HOUR },
    { from: T0 + 40 * HOUR, to: T0 + 41 * HOUR },
];

describe('usePlaybackClock without presence data', () => {
    it('starts at the window start and advances at the chosen speed', () => {
        mount(WINDOW.from, WINDOW.from + 1000 * 60);
        expect(clock.ts).toBe(WINDOW.from);

        act(() => clock.play());
        pumpFrame(5000);         // first frame only establishes a baseline
        pumpFrame(6000);         // 1 s of real time later
        expect(clock.ts).toBe(WINDOW.from + 1000 * clock.speed);
    });

    it('offers no skip control when there is nothing to skip', () => {
        mount(WINDOW.from, WINDOW.to);
        expect(clock.canSkipEmpty).toBe(false);
    });
});

describe('usePlaybackClock over sparse presence', () => {
    it('starts where the data starts, not where the window does', () => {
        // The reported bug: a fortnight-wide range put the playhead 46 hours before
        // the selected player's first sample, so the map stayed empty for hours of
        // real time while the clock readout ticked away.
        mount(WINDOW.from, WINDOW.to, { segments: SEGMENTS });
        expect(clock.ts).toBe(SEGMENTS[0].from);
    });

    it('jumps the gap between two sessions instead of playing it out', () => {
        mount(WINDOW.from, WINDOW.to, { segments: SEGMENTS });
        act(() => clock.seek(SEGMENTS[0].to - 1000));
        act(() => clock.play());

        pumpFrame(5000);
        pumpFrame(6000);         // 16 s of playback: enough to leave the first session

        expect(clock.ts).toBe(SEGMENTS[1].from);
    });

    it('plays the dead air when asked to', () => {
        // The skip is a convenience, not a claim about the data, so it can be
        // turned off and the window watched in full.
        mount(WINDOW.from, WINDOW.to, { segments: SEGMENTS });
        act(() => clock.setSkipEmpty(false));
        act(() => clock.seek(SEGMENTS[0].to - 1000));
        act(() => clock.play());

        pumpFrame(5000);
        pumpFrame(6000);

        expect(clock.ts).toBeLessThan(SEGMENTS[1].from);
        expect(clock.ts).toBeGreaterThan(SEGMENTS[0].to);
    });

    it('moves to the next session when play is pressed in dead air', () => {
        mount(WINDOW.from, WINDOW.to, { segments: SEGMENTS });
        act(() => clock.seek(T0 + 30 * HOUR));      // scrubbed into the empty middle
        expect(clock.ts).toBe(T0 + 30 * HOUR);      // the scrub itself is honoured

        act(() => clock.play());
        expect(clock.ts).toBe(SEGMENTS[1].from);
    });

    it('stops at the end once the last session has played out', () => {
        mount(WINDOW.from, WINDOW.to, { segments: SEGMENTS });
        act(() => clock.seek(SEGMENTS[1].to - 1000));
        act(() => clock.play());

        pumpFrame(5000);
        pumpFrame(6000);

        expect(clock.playing).toBe(false);
        expect(clock.ts).toBe(WINDOW.to);
    });

    it('re-anchors when the selection changes under it', () => {
        mount(WINDOW.from, WINDOW.to, { segments: SEGMENTS });
        act(() => clock.seek(SEGMENTS[1].from));

        const later = [{ from: T0 + 44 * HOUR, to: T0 + 45 * HOUR }];
        rerender(WINDOW.from, WINDOW.to, { segments: later });
        expect(clock.ts).toBe(later[0].from);
    });

    it('offers the skip control only while presence is sparse', () => {
        mount(WINDOW.from, WINDOW.to, { segments: SEGMENTS });
        expect(clock.canSkipEmpty).toBe(true);

        rerender(WINDOW.from, WINDOW.to, { segments: [{ from: WINDOW.from, to: WINDOW.to }] });
        expect(clock.canSkipEmpty).toBe(false);
    });
});

describe('the scrubber scale', () => {
    it('measures the material being played, not the calendar', () => {
        // Two one-hour sessions in a two-day window. Wall-clock scaling puts the
        // whole of the first session inside 2% of the bar, which is what made the
        // control read as frozen; presence scaling puts it in the first half.
        mount(WINDOW.from, WINDOW.to, { segments: SEGMENTS });
        expect(clock.progress).toBe(0);
        expect(clock.positionOf(SEGMENTS[0].to)).toBeCloseTo(0.5, 5);
        expect(clock.positionOf(SEGMENTS[1].from)).toBeCloseTo(0.5, 5);
        expect(clock.positionOf(SEGMENTS[1].to)).toBeCloseTo(1, 5);
    });

    it('lands a drag on data rather than on an empty Tuesday', () => {
        mount(WINDOW.from, WINDOW.to, { segments: SEGMENTS });
        act(() => clock.seekProgress(0.75));
        // Three quarters through the material is halfway through the second session.
        expect(clock.ts).toBe(SEGMENTS[1].from + HOUR / 2);
    });

    it('reverts to a wall-clock scale when the skip is turned off', () => {
        // With every second being played, the bar has to represent every second.
        mount(WINDOW.from, WINDOW.to, { segments: SEGMENTS });
        act(() => clock.setSkipEmpty(false));
        expect(clock.positionOf(SEGMENTS[0].from)).toBeCloseTo(24 / 48, 5);
        act(() => clock.seekProgress(0.5));
        expect(clock.ts).toBe(WINDOW.from + 24 * HOUR);
    });

    it('is a plain wall-clock scale when there is no presence data', () => {
        mount(WINDOW.from, WINDOW.to);
        expect(clock.positionOf(WINDOW.from + 24 * HOUR)).toBeCloseTo(0.5, 5);
    });
});

describe('the starting speed', () => {
    it('fits the amount there is to watch', () => {
        // A live-server afternoon and a fortnight of imported archive cannot share
        // one default: 16x replays a day of accumulated presence in 90 minutes.
        expect(fitSpeed(2 * 60_000)).toBe(1);
        expect(fitSpeed(30 * 60_000)).toBe(16);
        expect(fitSpeed(29 * HOUR)).toBe(240);
    });

    it('is taken from the presence total, not the width of the window', () => {
        mount(WINDOW.from, WINDOW.to, { segments: SEGMENTS });
        expect(clock.speed).toBe(fitSpeed(2 * HOUR));
    });

    it('never overrides a speed the operator picked', () => {
        mount(WINDOW.from, WINDOW.to, { segments: SEGMENTS });
        act(() => clock.setSpeed(1));
        // A re-render with different material must not silently undo the choice.
        rerender(WINDOW.from, WINDOW.to, { segments: [{ from: T0, to: T0 + 40 * HOUR }] });
        expect(clock.speed).toBe(1);
    });

    it('honours an explicit initial speed', () => {
        mount(WINDOW.from, WINDOW.to, { segments: SEGMENTS, initialSpeed: 4 });
        expect(clock.speed).toBe(4);
    });
});
