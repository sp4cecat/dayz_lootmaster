import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import PlaybackBar from '../../src/components/history/PlaybackBar';
import { usePlaybackClock } from '../../src/hooks/usePlaybackClock';
import type { PresenceSegment } from '../../src/utils/trackSampling';

// @ts-expect-error - test-only global flag not in the ambient types
global.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
    // The clock schedules rAF as soon as it plays; nothing here presses play, but
    // stubbing keeps a stray frame from firing between tests.
    vi.stubGlobal('requestAnimationFrame', () => 1);
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

// Two one-hour sessions inside a four-hour window: present, gone for two hours,
// present again. The shape the ribbon exists to show.
const FROM = T0;
const TO = T0 + 4 * HOUR;
const SEGMENTS: PresenceSegment[] = [
    { from: T0, to: T0 + HOUR },
    { from: T0 + 3 * HOUR, to: T0 + 4 * HOUR },
];

function Harness({ segments }: { segments: PresenceSegment[] }) {
    const clock = usePlaybackClock(FROM, TO, { segments });
    return <PlaybackBar clock={clock} from={FROM} to={TO} segments={segments} />;
}

function mount(segments: PresenceSegment[]) {
    act(() => { root.render(<Harness segments={segments} />); });
}

/** The ribbon is the only element carrying this title. */
const ribbon = () =>
    container.querySelector<HTMLDivElement>('[title^="Real elapsed time"]');

/** The presence strip behind the scrubber, which is positioned rather than static. */
const strip = () => container.querySelector<HTMLDivElement>('div.absolute.overflow-hidden');

// jsdom's CSS parser rejects `max(2px, …%)` and drops the whole width declaration,
// so the spans' widths are unreadable here. Their `left` is what distinguishes the
// two scales anyway, and browsers render the width fine.
const leftOf = (el: Element | null) => (el as HTMLDivElement | null)?.style.left ?? '';

describe('PlaybackBar wall-clock ribbon', () => {
    it('draws each session at its true position in the window', () => {
        mount(SEGMENTS);
        const spans = [...ribbon()!.querySelectorAll('.bg-primary-300')];
        expect(spans).toHaveLength(2);
        // The second session starts 3h into a 4h window.
        expect(leftOf(spans[0])).toBe('0%');
        expect(leftOf(spans[1])).toBe('75%');
    });

    it('the scrubber above still runs on the compressed scale', () => {
        // Guards the split this whole feature rests on: the ribbon is calendar
        // time, the scrubber is elapsed presence, and neither has been made to
        // follow the other. The same session that sits at 75% on the ribbon sits
        // at 50% here, because the two-hour absence between them is not played.
        mount(SEGMENTS);
        const spans = [...strip()!.querySelectorAll('.bg-primary-300')];
        expect(spans).toHaveLength(2);
        expect(leftOf(spans[0])).toBe('0%');
        expect(leftOf(spans[1])).toBe('50%');
    });

    it('labels the gap with how long the player was away', () => {
        mount(SEGMENTS);
        const gap = ribbon()!.querySelector('[title^="Logged out"]');
        expect(gap?.getAttribute('title')).toBe('Logged out · 2h 0m');
        expect(leftOf(gap)).toBe('25%');
    });

    it('is not rendered when the player never logged out', () => {
        mount([{ from: FROM, to: TO }]);
        expect(ribbon()).toBeNull();
        // The scrubber's own strip is still there — only the ribbon is suppressed.
        expect(strip()).not.toBeNull();
    });

    it('is not rendered without any presence at all', () => {
        mount([]);
        expect(ribbon()).toBeNull();
    });
});
