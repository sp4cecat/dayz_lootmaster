import { describe, it, expect } from 'vitest';
import {
  TRAIL_HOLD_MS, absenceSpans, indexAtOrBefore, nextPresence, presenceSegments,
  sampleTrackAt, trailPoints,
} from '../../src/utils/trackSampling';
import type { HistoryPoint } from '../../src/types/history';

const pt = (ts: number, x: number, z: number, over: Partial<HistoryPoint> = {}): HistoryPoint => ({
  ts, x, y: 300, z,
  health: 100, blood: 5000, shock: 100, energy: null, water: null,
  alive: true, hands: null, gap: false,
  ...over,
});

// A five-sample walk east, one mod tick (5 s) apart.
const walk = [
  pt(1000, 0, 0),
  pt(6000, 10, 0),
  pt(11000, 20, 0),
  pt(16000, 30, 0),
  pt(21000, 40, 0),
];

describe('indexAtOrBefore', () => {
  it('finds the bracketing sample', () => {
    expect(indexAtOrBefore(walk, 1000)).toBe(0);
    expect(indexAtOrBefore(walk, 8000)).toBe(1);
    expect(indexAtOrBefore(walk, 21000)).toBe(4);
    expect(indexAtOrBefore(walk, 99999)).toBe(4);
  });

  it('reports -1 before the track starts', () => {
    expect(indexAtOrBefore(walk, 0)).toBe(-1);
  });

  it('handles an empty track', () => {
    expect(indexAtOrBefore([], 1000)).toBe(-1);
  });
});

describe('sampleTrackAt', () => {
  it('returns an exact sample without interpolating', () => {
    const s = sampleTrackAt(walk, 6000)!;
    expect(s.x).toBe(10);
    expect(s.interpolated).toBe(false);
  });

  it('interpolates between two samples', () => {
    const s = sampleTrackAt(walk, 8500)!;   // halfway between 6000 and 11000
    expect(s.x).toBeCloseTo(15);
    expect(s.interpolated).toBe(true);
  });

  it('takes non-positional fields from the real sample, not the interpolation', () => {
    // Health cannot be meaningfully averaged across a tick, and a made-up reading
    // shown next to a real timestamp is worse than a slightly stale true one.
    const t = [pt(0, 0, 0, { health: 100, hands: 'M4A1' }), pt(5000, 10, 0, { health: 20 })];
    const s = sampleTrackAt(t, 2500)!;
    expect(s.point.health).toBe(100);
    expect(s.point.hands).toBe('M4A1');
  });

  it('returns null before the track begins', () => {
    expect(sampleTrackAt(walk, 0)).toBeNull();
  });

  it('holds the final position briefly, then drops the marker', () => {
    expect(sampleTrackAt(walk, 21000 + 10_000)).not.toBeNull();
    expect(sampleTrackAt(walk, 21000 + TRAIL_HOLD_MS + 1)).toBeNull();
  });

  it('refuses to glide across a flagged absence', () => {
    // The single most misleading thing this view could do is draw a survivor
    // smoothly crossing the map during six hours of being logged out.
    const split = [pt(0, 0, 0), pt(6 * 3600_000, 10000, 10000, { gap: true })];
    // Just after the first sample: still shown at their last known spot.
    expect(sampleTrackAt(split, 10_000)!.x).toBe(0);
    // Deep inside the absence: gone, not halfway across the map.
    expect(sampleTrackAt(split, 3 * 3600_000)).toBeNull();
  });

  it('interpolates across a long interval that is NOT flagged as an absence', () => {
    // The regression that a duration-based test causes on real data: decimation
    // collapses an hour of straight walking to two points, and reading that
    // interval as a logout renders nobody at all.
    const decimated = [pt(0, 0, 0), pt(3600_000, 3600, 0)];
    const mid = sampleTrackAt(decimated, 1800_000);
    expect(mid).not.toBeNull();
    expect(mid!.x).toBeCloseTo(1800);
    expect(mid!.interpolated).toBe(true);
  });

  it('resumes after an absence ends', () => {
    const rejoin = [
      pt(0, 0, 0),
      pt(6 * 3600_000, 9000, 9000, { gap: true }),
      pt(6 * 3600_000 + 5000, 9010, 9000),
    ];
    const after = sampleTrackAt(rejoin, 6 * 3600_000 + 2500)!;
    expect(after.x).toBeCloseTo(9005);
  });

  it('handles an empty track', () => {
    expect(sampleTrackAt([], 1000)).toBeNull();
  });

  it('does not divide by zero on duplicate timestamps', () => {
    const dupes = [pt(1000, 5, 5), pt(1000, 7, 7)];
    expect(() => sampleTrackAt(dupes, 1000)).not.toThrow();
  });
});

describe('trailPoints', () => {
  it('returns a flat x,z list of the recent past', () => {
    const trail = trailPoints(walk, 21000, 20000);
    expect(trail.length % 2).toBe(0);
    expect(trail.length / 2).toBeGreaterThan(1);
    // Ends at the current position.
    expect(trail.slice(-2)).toEqual([40, 0]);
  });

  it('honours the trail window', () => {
    const short = trailPoints(walk, 21000, 6000);   // ~1 tick back
    const long = trailPoints(walk, 21000, 30000);   // the whole track
    expect(short.length).toBeLessThan(long.length);
  });

  it('stops at a flagged absence rather than drawing across it', () => {
    const split = [pt(0, 0, 0), pt(5000, 10, 0), pt(6 * 3600_000, 9000, 9000, { gap: true })];
    const trail = trailPoints(split, 6 * 3600_000, 24 * 3600_000);
    // Only the point after the absence survives, so there is no segment to draw.
    expect(trail.length / 2).toBeLessThanOrEqual(1);
  });

  it('spans a long unflagged interval, because that is continuous movement', () => {
    const decimated = [pt(0, 0, 0), pt(3600_000, 3600, 0)];
    const trail = trailPoints(decimated, 3600_000, 24 * 3600_000);
    expect(trail.length / 2).toBeGreaterThanOrEqual(2);
  });

  it('returns nothing before the track starts', () => {
    expect(trailPoints(walk, 0, 60000)).toEqual([]);
  });

  it('returns nothing for a zero-length window', () => {
    expect(trailPoints(walk, 21000, 0)).toEqual([]);
  });

  it('handles an empty track', () => {
    expect(trailPoints([], 1000, 60000)).toEqual([]);
  });
});

describe('presenceSegments', () => {
    const HOUR = 3600_000;

    it('turns one unbroken track into one segment', () => {
        const [seg] = presenceSegments([{ points: walk }]);
        expect(seg).toEqual({ from: 1000, to: 21000 + TRAIL_HOLD_MS });
    });

    it('splits on a flagged absence, not on a long quiet interval', () => {
        // The distinction the whole playback path turns on: decimation leaves big
        // intervals inside continuous movement, and only `gap` means "was gone".
        const points = [
            pt(0, 0, 0), pt(HOUR, 100, 0),                       // decimated, still present
            pt(6 * HOUR, 200, 0, { gap: true }), pt(7 * HOUR, 300, 0),
        ];
        const segs = presenceSegments([{ points }]);
        expect(segs).toHaveLength(2);
        expect(segs[0]).toEqual({ from: 0, to: HOUR + TRAIL_HOLD_MS });
        expect(segs[1].from).toBe(6 * HOUR);
    });

    it('merges overlapping presence across players', () => {
        // Two players online together is one stretch worth watching, not two.
        const a = [pt(0, 0, 0), pt(HOUR, 1, 0)];
        const b = [pt(HOUR / 2, 5, 5), pt(2 * HOUR, 6, 5)];
        expect(presenceSegments([{ points: a }, { points: b }]))
            .toEqual([{ from: 0, to: 2 * HOUR + TRAIL_HOLD_MS }]);
    });

    it('keeps separate players apart when they never overlap', () => {
        const a = [pt(0, 0, 0), pt(HOUR, 1, 0)];
        const b = [pt(10 * HOUR, 5, 5), pt(11 * HOUR, 6, 5)];
        expect(presenceSegments([{ points: a }, { points: b }])).toHaveLength(2);
    });

    it('returns nothing for an empty selection', () => {
        expect(presenceSegments([])).toEqual([]);
        expect(presenceSegments([{ points: [] }])).toEqual([]);
    });
});

describe('nextPresence', () => {
    const segs = [{ from: 100, to: 200 }, { from: 1000, to: 1100 }];

    it('leaves a time inside a segment alone', () => {
        expect(nextPresence(segs, 150)).toBe(150);
        expect(nextPresence(segs, 100)).toBe(100);
        expect(nextPresence(segs, 200)).toBe(200);
    });

    it('jumps forward over dead air', () => {
        // The reason playback was unusable over an imported archive: 46 hours of
        // nothing between the window start and the first sample.
        expect(nextPresence(segs, 0)).toBe(100);
        expect(nextPresence(segs, 500)).toBe(1000);
    });

    it('reports the end once the last segment has passed', () => {
        expect(nextPresence(segs, 2000)).toBeNull();
    });

    it('never moves the playhead backwards', () => {
        for (const ts of [0, 99, 100, 150, 201, 999, 1050, 1101]) {
            const next = nextPresence(segs, ts);
            if (next !== null) expect(next).toBeGreaterThanOrEqual(ts);
        }
    });

    it('is a no-op without segments', () => {
        expect(nextPresence([], 1234)).toBeNull();
    });
});

describe('absenceSpans', () => {
    // The walk above, then a logout, then a second session ten minutes later.
    const away = [
        pt(600000, 100, 0, { gap: true }),
        pt(605000, 110, 0),
    ];

    it('is the whole window when nobody was ever present', () => {
        expect(absenceSpans([], 0, 1000)).toEqual([{ from: 0, to: 1000 }]);
    });

    it('is empty when presence covers the window', () => {
        expect(absenceSpans([{ from: 0, to: 1000 }], 0, 1000)).toEqual([]);
    });

    it('finds the interior gap between two sessions', () => {
        expect(absenceSpans([{ from: 100, to: 200 }, { from: 500, to: 900 }], 100, 900))
            .toEqual([{ from: 200, to: 500 }]);
    });

    it('reports dead air at either end of the window', () => {
        expect(absenceSpans([{ from: 300, to: 400 }], 0, 1000))
            .toEqual([{ from: 0, to: 300 }, { from: 400, to: 1000 }]);
    });

    it('clamps segments that overhang the window rather than emitting negatives', () => {
        // The bar is handed the playback span, which is clipped to the first and
        // last sample — so a segment reaching past either end is the normal case,
        // not a malformed one.
        expect(absenceSpans([{ from: -500, to: 200 }, { from: 800, to: 5000 }], 0, 1000))
            .toEqual([{ from: 200, to: 800 }]);
        for (const s of absenceSpans([{ from: -500, to: 5000 }], 0, 1000)) {
            expect(s.to).toBeGreaterThan(s.from);
        }
    });

    it('is empty for an inverted or zero-width window', () => {
        expect(absenceSpans([], 1000, 1000)).toEqual([]);
        expect(absenceSpans([], 1000, 0)).toEqual([]);
    });

    it('complements presenceSegments over a real track with a logout', () => {
        // The end-to-end shape: a walk, an absence, another walk.
        const segs = presenceSegments([{ points: [...walk, ...away] }]);
        const gaps = absenceSpans(segs, segs[0].from, segs[segs.length - 1].to);
        expect(gaps).toEqual([{ from: 21000 + TRAIL_HOLD_MS, to: 600000 }]);
    });
});
