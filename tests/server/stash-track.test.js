import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as history from '../../server/history-store.js';
import {
    analyseApproach, annotateApproaches, trackAvailability,
    APPROACH_LOOKBACK_MS, PRIOR_RADIUS_M,
} from '../../server/stash-track.js';

/**
 * These tests exist to keep the cross-check honest rather than clever. The whole
 * risk here is asymmetric: a false beeline accuses a real player of cheating on
 * the strength of a sparse log, so most of what is asserted below is about the
 * cases where the analysis must REFUSE to draw a conclusion.
 */

const T0 = 1_700_000_000_000;
const MIN = 60_000;
const PID = 'guid:ABC=';

beforeEach(() => { history._openForTest(':memory:'); });
afterEach(() => { history.close(); });

/** Lay down a track of samples, `stepMs` apart, ending at `to`. Always src='adm'. */
const lay = (points, { pid = PID, to = T0, stepMs = 30_000 } = {}) => {
    const rows = points.map((p, i) => ({
        pid, name: 'Survivor',
        ts: to - (points.length - 1 - i) * stepMs,
        x: p[0], y: 100, z: p[1],
        health: 100, energy: -1, water: -1, alive: 1,
        runStart: i === 0 ? 1 : null,
        ...(p[2] || {}),
    }));
    history.recordAdmRows(rows);
    return rows;
};

/** A straight run of `n` samples closing on (x, z) from `fromM` metres west. */
const beelineTo = (x, z, { n = 12, fromM = 600 } = {}) =>
    Array.from({ length: n }, (_, i) => [x - fromM * (1 - i / (n - 1)), z]);

const entry = (over = {}) => ({
    ts: T0, x: 5000, z: 6000, owner: 'foreign',
    digger: { id: 'ABC=', alias: 'suspect' },
    bury: { ts: T0 - 60 * MIN, id: 'victim', alias: 'victim' },
    ...over,
});

describe('trackAvailability', () => {
    it('reports an empty store as unusable rather than as a clean result', () => {
        // A report that silently scores everyone at multiplier 1 because the DB is
        // empty looks identical to one where every player checked out clean.
        expect(trackAvailability()).toMatchObject({ available: false, reason: 'empty' });
    });

    it('becomes available once there are samples', () => {
        lay([[0, 0], [1, 1]]);
        expect(trackAvailability()).toMatchObject({ available: true, rows: 2 });
    });
});

describe('analyseApproach — shape', () => {
    it('recognises a straight run onto the stash', () => {
        lay(beelineTo(5000, 6000));
        const a = analyseApproach(entry(), PID);
        expect(a.available).toBe(true);
        expect(a.straightness).toBeGreaterThan(0.95);
        expect(a.turns).toBeLessThanOrEqual(1);
        expect(a.finalM).toBeLessThan(30);
        expect(a.beeline).toBe(true);
    });

    it('does not call a search pattern a beeline', () => {
        // Someone genuinely hunting for a stash wanders. This is the case that must
        // not be flagged, and it is the reason turns are counted at all.
        const wander = [];
        for (let i = 0; i < 16; i++) {
            wander.push([5000 - 300 + i * 20, 6000 + (i % 2 ? 120 : -120)]);
        }
        const a = analyseApproach(entry(), PID);
        lay(wander);
        const b = analyseApproach(entry(), PID);
        expect(a.beeline).not.toBe(true);
        expect(b.straightness).toBeLessThan(0.7);
        expect(b.turns).toBeGreaterThan(3);
        expect(b.beeline).toBe(false);
    });

    it('measures only the run that ends at the dig, not one across a logout', () => {
        // A player who was 8 km away, logged off, and reconnected next to the stash
        // would otherwise read as a perfectly straight 8 km approach.
        lay([[13000, 6000], [12900, 6000], [12800, 6000]],
            { to: T0 - 15 * MIN, stepMs: 30_000 });
        lay(beelineTo(5000, 6000, { n: 8, fromM: 400 }), { to: T0, stepMs: 20_000 });
        const a = analyseApproach(entry(), PID);
        expect(a.approachM).toBeLessThan(1000);
    });

    it('refuses to describe the shape of one or two samples', () => {
        lay([[4900, 6000], [5000, 6000]]);
        const a = analyseApproach(entry(), PID);
        expect(a.beeline).toBeUndefined();
        expect(a.reason).toBe('too-few-samples');
    });

    it('marks an admin-log track as coarse', () => {
        lay(beelineTo(5000, 6000));
        expect(analyseApproach(entry(), PID).resolution).toBe('coarse');
    });
});

describe('analyseApproach — prior presence', () => {
    it('finds a player who has been here before the stash was buried', () => {
        lay([[5010, 6005], [5005, 6002], [5008, 6001]], { to: T0 - 240 * MIN });
        const a = analyseApproach(entry(), PID);
        expect(a.everBeforeBury).toBe(true);
        expect(a.priorVisits).toBeGreaterThan(0);
        expect(a.priorClosestM).toBeLessThan(PRIOR_RADIUS_M);
    });

    it('separates "went elsewhere" from "was never logged"', () => {
        // Absence is only evidence when the player was demonstrably being sampled.
        // Without this distinction, a server that imported only last week's logs
        // would mark every long-time resident a stranger.
        lay([[100, 100], [200, 200], [300, 300]], { to: T0 - 240 * MIN });
        const a = analyseApproach(entry(), PID);
        expect(a.everBeforeBury).toBe(false);
        expect(a.priorMeaningful).toBe(true);

        const b = analyseApproach(entry(), 'guid:NEVER-SEEN=');
        expect(b.everBeforeBury).toBe(false);
        expect(b.priorMeaningful).toBe(false);
    });
});

describe('annotateApproaches', () => {
    const ledgerOf = (n = 1) => Array.from({ length: n }, (_, i) => entry({
        ts: T0 - i * 1000,
        digger: { id: `P${i}=`, alias: `p${i}` },
    }));

    it('leaves scores alone when there is no history at all', () => {
        const entries = ledgerOf(2);
        return annotateApproaches(entries, { serverPath: '/nope' }).then(({ meta, tracks }) => {
            expect(meta.available).toBe(false);
            expect(meta.reason).toBe('empty');
            expect(tracks.size).toBe(0);
        });
    });

    it('raises the multiplier for a stranger who beelines', async () => {
        lay(beelineTo(5000, 6000), { pid: 'guid:P0=' });
        const entries = ledgerOf(1);
        const { tracks } = await annotateApproaches(entries, { serverPath: '/nope' });
        const t = tracks.get('P0=');
        expect(t.multiplier).toBeGreaterThan(1);
        expect(entries[0].approach.beeline).toBe(true);
    });

    it('lowers the multiplier for someone digging where they already live', async () => {
        lay([[5010, 6005], [5005, 6002], [5008, 6001], [5002, 6003]],
            { pid: 'guid:P0=', to: T0 - 240 * MIN });
        const { tracks } = await annotateApproaches(ledgerOf(1), { serverPath: '/nope' });
        expect(tracks.get('P0=').multiplier).toBeLessThan(1);
    });

    it('halves the deviation on a coarse track', async () => {
        // A five-minute roster cannot see wandering, so it over-reports straightness.
        // Claiming a beeline off six roster dumps is exactly the confident-but-wrong
        // result the store's src/stride/gap flags exist to prevent.
        lay(beelineTo(5000, 6000), { pid: 'guid:P0=' });
        const { tracks } = await annotateApproaches(ledgerOf(1), { serverPath: '/nope' });
        const t = tracks.get('P0=');
        expect(t.resolution).toBe('coarse');
        // The approach itself scores 1 + 0.20 for the beeline. The stranger bonus
        // does NOT apply: these samples all post-date the bury, so the store cannot
        // say whether the player knew the area, and unknown must not read as guilty.
        // Coarse resolution then halves what is left: 1 + 0.20 / 2 = 1.10.
        expect(t.multiplier).toBeCloseTo(1.10, 2);
    });

    it('spends a limited budget on the most suspicious digs first', async () => {
        lay(beelineTo(5000, 6000), { pid: 'guid:P0=' });
        const entries = [
            entry({ ts: T0 - 5000, owner: 'unknown', bury: null, digger: { id: 'P1=', alias: 'p1' } }),
            entry({ ts: T0, owner: 'foreign', digger: { id: 'P0=', alias: 'p0' } }),
        ];
        const { meta } = await annotateApproaches(entries, { serverPath: '/nope', maxLookups: 1 });
        expect(meta.budgetHit).toBe(true);
        // The confirmed theft is the one that got looked at.
        expect(entries[1].approach.reason).not.toBe('budget');
        expect(entries[0].approach.reason).toBe('budget');
    });

    it('does not waste lookups explaining someone digging up their own stash', async () => {
        lay(beelineTo(5000, 6000), { pid: 'guid:P0=' });
        const entries = [entry({ owner: 'own', digger: { id: 'P0=', alias: 'p0' } })];
        const { meta } = await annotateApproaches(entries, { serverPath: '/nope' });
        expect(meta.lookups).toBe(0);
        expect(entries[0].approach.reason).toBe('not-analysed');
    });

    it('uses the default lookback when none is given', async () => {
        lay(beelineTo(5000, 6000), { pid: 'guid:P0=', stepMs: APPROACH_LOOKBACK_MS });
        const entries = ledgerOf(1);
        await annotateApproaches(entries, { serverPath: '/nope' });
        // Samples older than the lookback are excluded, so the run is short.
        expect(entries[0].approach.samples ?? 0).toBeLessThan(12);
    });
});
