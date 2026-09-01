import { describe, it, expect } from 'vitest';
import {
    buildLedger, scoreReport, severityFor,
    WEIGHTS, LOG_MAX, MATCH_TOLERANCE_M,
} from '../../server/stash-report.js';

/**
 * The matching rules are the part of this report that can be wrong without
 * looking wrong — a mis-attributed theft still produces a plausible number. So
 * these tests build events directly rather than going near the filesystem, and
 * every case below corresponds to something that actually happens in a real log.
 */

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const T0 = Date.UTC(2026, 7, 20, 12, 0, 0);

let seq = 0;
const ev = (action, pid, ts, x, z, extra = {}) => ({
    ts, action, pid, alias: pid, cls: action === 'in' ? 'WoodenCrate' : 'UndergroundStash',
    x, z, y: 100, file: 'a.ADM', line: ++seq, fileIndex: 0, lineIndex: seq,
    ...extra,
});
const bury = (pid, ts, x, z, extra) => ev('in', pid, ts, x, z, extra);
const dig = (pid, ts, x, z, extra) => ev('out', pid, ts, x, z, extra);

const owners = (entries) => entries.map(e => e.owner);

describe('buildLedger — attribution', () => {
    it('credits a player digging up their own stash', () => {
        const { entries } = buildLedger([
            bury('alice', T0, 100, 200),
            dig('alice', T0 + HOUR, 100, 200),
        ]);
        expect(owners(entries)).toEqual(['own']);
        expect(entries[0].bury.id).toBe('alice');
        expect(entries[0].secondsSinceBury).toBe(3600);
    });

    it('names the victim when someone else digs it up', () => {
        const { entries } = buildLedger([
            bury('alice', T0, 100, 200),
            dig('bob', T0 + HOUR, 100, 200),
        ]);
        expect(entries[0].owner).toBe('foreign');
        expect(entries[0].bury.id).toBe('alice');
    });

    it('emits a dig with no bury on record instead of discarding it', () => {
        // A quarter of dig-ups in a real archive look like this — the bury simply
        // predates the logs. Dropping them silently loses a quarter of the signal.
        const { entries, stats } = buildLedger([dig('bob', T0, 100, 200)]);
        expect(entries).toHaveLength(1);
        expect(entries[0].owner).toBe('unknown');
        expect(entries[0].bury).toBeNull();
        expect(stats.unknown).toBe(1);
    });
});

describe('buildLedger — consumption', () => {
    it('does not credit one bury to every later dig at the same spot', () => {
        // The bug this replaces: a player who dug up five separate stashes in one
        // small area read as entirely innocent, because a single bury kept matching.
        const { entries } = buildLedger([
            bury('alice', T0, 100, 200),
            dig('alice', T0 + HOUR, 100, 200),
            dig('alice', T0 + 2 * HOUR, 100, 200),
            dig('alice', T0 + 3 * HOUR, 100, 200),
        ]);
        expect(owners(entries)).toEqual(['own', 'unknown', 'unknown']);
    });

    it('matches the most recent bury when several stack in one hole', () => {
        const { entries } = buildLedger([
            bury('alice', T0, 100, 200),
            bury('bob', T0 + MIN, 100, 200),
            dig('carol', T0 + 2 * MIN, 100, 200),
        ]);
        expect(entries[0].bury.id).toBe('bob');
    });

    it('counts a stacked bury rather than hiding it', () => {
        const { stats } = buildLedger([
            bury('alice', T0, 100, 200),
            bury('bob', T0 + MIN, 100, 200),
        ]);
        expect(stats.stackedBuries).toBe(1);
    });

    it('reconstructs a real re-bury chain', () => {
        // Copied from the sample archive: cheese repeatedly digs up and re-buries
        // the same hole, then 9thlifelucky takes it.
        const { entries } = buildLedger([
            bury('cheese', T0, 10618, 5001.74),
            dig('cheese', T0 + 60 * MIN, 10618, 5001.74),
            bury('cheese', T0 + 60 * MIN, 10618, 5001.74),
            dig('cheese', T0 + 350 * MIN, 10618, 5001.74),
            bury('cheese', T0 + 350 * MIN, 10618, 5001.74),
            dig('cheese', T0 + 359 * MIN, 10618, 5001.74),
            bury('cheese', T0 + 362 * MIN, 10618, 5001.74),
            dig('9thlifelucky', T0 + 367 * MIN, 10618, 5001.74),
        ]);
        expect(owners(entries)).toEqual(['own', 'own', 'own', 'foreign']);
        expect(entries[3].bury.id).toBe('cheese');
    });
});

describe('buildLedger — the window must not reach into matching', () => {
    it('matches a bury that predates the reported window', () => {
        // The defect that motivated this rewrite: filtering lines by date BEFORE
        // matching meant narrowing the range converted real thefts into zeroes.
        const events = [
            bury('alice', T0, 100, 200),
            dig('bob', T0 + 10 * DAY, 100, 200),
        ];
        const { entries } = buildLedger(events);
        const windowed = entries.filter(e => e.ts >= T0 + 9 * DAY);
        expect(windowed).toHaveLength(1);
        expect(windowed[0].owner).toBe('foreign');
        expect(windowed[0].bury.id).toBe('alice');
    });
});

describe('buildLedger — spatial matching', () => {
    it('accepts within tolerance and rejects beyond it', () => {
        const near = buildLedger([
            bury('alice', T0, 100, 200),
            dig('bob', T0 + HOUR, 100.4, 200),
        ]);
        expect(near.entries[0].owner).toBe('foreign');

        const far = buildLedger([
            bury('alice', T0, 100, 200),
            dig('bob', T0 + HOUR, 100.6, 200),
        ]);
        expect(far.entries[0].owner).toBe('unknown');
    });

    it('takes the nearest bury, not the first one found scanning back', () => {
        // Buries cluster at sub-metre spacing, so "most recent in range" and
        // "the one actually at this spot" are routinely different people's stashes.
        const { entries } = buildLedger([
            bury('alice', T0, 100.0, 200),
            bury('bob', T0 + MIN, 100.4, 200),
            dig('carol', T0 + 2 * MIN, 100.05, 200),
        ]);
        expect(entries[0].bury.id).toBe('alice');
    });

    it('matches across a grid cell boundary', () => {
        const { entries } = buildLedger([
            bury('alice', T0, 3.99, 200),
            dig('bob', T0 + HOUR, 4.01, 200),
        ]);
        expect(entries[0].owner).toBe('foreign');
    });

    it('reports exact vs tolerated matches so a loosening tolerance is visible', () => {
        const { stats } = buildLedger([
            bury('alice', T0, 100, 200),
            dig('alice', T0 + MIN, 100, 200),
            bury('alice', T0 + 2 * MIN, 300, 400),
            dig('alice', T0 + 3 * MIN, 300.2, 400),
        ]);
        expect(stats.exact).toBe(1);
        expect(stats.nearby).toBe(1);
    });
});

describe('buildLedger — time', () => {
    it('will not match a bury older than the stash lifetime', () => {
        const { entries, stats } = buildLedger([
            bury('alice', T0, 100, 200),
            dig('bob', T0 + 46 * DAY, 100, 200),
        ]);
        expect(entries[0].owner).toBe('unknown');
        expect(stats.expiredBuries).toBe(1);
    });

    it('does not let a dig consume a bury logged after it in the same second', () => {
        // Real logs write "dug out" then "dug in" at the identical timestamp when a
        // player unearths and immediately re-buries. Only file order says which way round.
        const { entries } = buildLedger([
            dig('alice', T0, 100, 200),
            bury('alice', T0, 100, 200),
        ]);
        expect(entries[0].owner).toBe('unknown');
    });
});

describe('scoring', () => {
    const ledgerFrom = T0 - 60 * DAY;
    const run = (events, opts = {}) => {
        const { entries, byOwner } = buildLedger(events);
        return scoreReport(entries, { byOwner, ledgerFrom, ...opts });
    };

    it('keeps the normaliser in step with the weights', () => {
        const sum = Object.values(WEIGHTS).reduce((s, w) => s + w.max, 0);
        expect(sum).toBe(LOG_MAX);
    });

    it('ranks a pure thief above a prolific burier', () => {
        // The old sort was by buries, so a player with no stashes of their own and
        // two confirmed thefts sorted below everyone. That is backwards.
        const events = [
            bury('victim', T0, 100, 200),
            bury('victim', T0, 300, 400),
            dig('thief', T0 + HOUR, 100, 200),
            dig('thief', T0 + 2 * HOUR, 300, 400),
        ];
        for (let i = 0; i < 20; i++) {
            events.push(bury('hoarder', T0 + i * MIN, 1000 + i * 100, 1000));
            events.push(dig('hoarder', T0 + (i + 30) * MIN, 1000 + i * 100, 1000));
        }
        const { players } = run(events);
        expect(players[0].id).toBe('thief');
        expect(players[0].counts.dugForeign).toBe(2);
        expect(players.find(p => p.id === 'hoarder').score)
            .toBeLessThan(players[0].score);
    });

    it('flags a cluster of finds even with no attributable victim', () => {
        // The most suspicious player in the sample archive has zero classifiable
        // digs — every victim's bury predates the logs. Behaviour has to carry it.
        const { players } = run([
            dig('grunter', T0, 8286, 11917.5),
            dig('grunter', T0 + MIN, 8283.9, 11919.8),
            dig('grunter', T0 + 19 * MIN, 8289.1, 11916.9),
            dig('grunter', T0 + 20 * MIN, 8291.7, 11916.9),
            dig('grunter', T0 + 38 * MIN, 8289.0, 11919.1),
        ]);
        const g = players.find(p => p.id === 'grunter');
        expect(g.counts.dugUnknown).toBe(5);
        expect(g.severity).not.toBe('none');
        expect(g.factors.find(f => f.key === 'digDensity').points).toBeGreaterThan(0);
        expect(g.factors.find(f => f.key === 'tightCluster').points).toBeGreaterThan(0);
    });

    it('treats vehicle-speed travel as unremarkable and teleports as damning', () => {
        const at = (v) => {
            const dt = 10 * MIN;
            const dist = v * (dt / 1000);
            const { players } = run([
                dig('x', T0, 0, 0),
                dig('x', T0 + dt, dist, 0),
            ]);
            return players[0].factors.find(f => f.key === 'impliedSpeed').points;
        };
        expect(at(25)).toBe(0);
        expect(at(50)).toBe(WEIGHTS.impliedSpeed.max);
    });

    it('ignores the foreign ratio until there is enough to divide', () => {
        const { players } = run([
            bury('victim', T0, 100, 200),
            dig('thief', T0 + HOUR, 100, 200),
        ]);
        expect(players.find(p => p.id === 'thief')
            .factors.find(f => f.key === 'foreignRatio').points).toBe(0);
    });

    it('reports low confidence when the ledger is too young to explain the digs', () => {
        const { players } = run(
            [dig('bob', T0, 100, 200), dig('bob', T0 + HOUR, 300, 400)],
            { ledgerFrom: T0 - HOUR },
        );
        const p = players.find(x => x.id === 'bob');
        expect(p.confidence).toBeLessThan(0.1);
        expect(p.confidenceNote).toMatch(/predate the bury ledger/);
        // The unowned-digs factor is the one that scales with coverage, because on a
        // young archive we cannot honestly assert the stash was not theirs.
        expect(p.factors.find(f => f.key === 'unownedDigs').points).toBeLessThan(1);
    });

    it('excuses digging around your own camp', () => {
        const { players } = run([
            bury('alice', T0, 100, 200),
            dig('alice', T0 + HOUR, 130, 210),
        ]);
        expect(players[0].factors.find(f => f.key === 'unownedDigs').value).toBe(0);
    });

    it('never raises a score on missing track data', () => {
        const events = [
            bury('victim', T0, 100, 200),
            dig('thief', T0 + HOUR, 100, 200),
        ];
        const bare = run(events).players[0].score;
        const withTrack = run(events, {
            tracks: new Map([['thief', { available: true, analysed: 1, multiplier: 1 }]]),
        }).players[0].score;
        expect(withTrack).toBe(bare);
    });

    it('raises a score for a beeline and lowers it for a familiar area', () => {
        const events = [
            bury('victim', T0, 100, 200),
            bury('victim', T0, 300, 400),
            bury('victim', T0, 500, 600),
            dig('thief', T0 + HOUR, 100, 200),
            dig('thief', T0 + 2 * HOUR, 300, 400),
            dig('thief', T0 + 3 * HOUR, 500, 600),
        ];
        const base = run(events).players[0].score;
        const up = run(events, {
            tracks: new Map([['thief', { available: true, analysed: 3, multiplier: 1.35 }]]),
        }).players[0].score;
        const down = run(events, {
            tracks: new Map([['thief', { available: true, analysed: 3, multiplier: 0.75 }]]),
        }).players[0].score;
        expect(up).toBeGreaterThan(base);
        expect(down).toBeLessThan(base);
    });

    it('counts buries against the window, not against the span of the digs', () => {
        // Those are different questions. Using the dig span meant a window with no
        // digs in it counted every bury ever made, which read as a busy report over
        // a range where nothing happened.
        const events = [
            bury('alice', T0, 100, 200),
            bury('alice', T0 + 30 * DAY, 300, 400),
        ];
        const { entries, byOwner } = buildLedger(events);
        const { players } = scoreReport(entries, {
            byOwner, ledgerFrom, window: { from: T0 - MIN, to: T0 + MIN },
        });
        const a = players.find(p => p.id === 'alice');
        expect(a.counts.buriedAllTime).toBe(2);
        expect(a.counts.buried).toBe(1);
    });

    it('keeps players who only ever buried, so a name search finds them', () => {
        const { players } = run([bury('alice', T0, 100, 200)]);
        const a = players.find(p => p.id === 'alice');
        expect(a).toBeDefined();
        expect(a.severity).toBe('none');
        expect(a.counts.buriedAllTime).toBe(1);
    });

    it('sorts deterministically regardless of input order', () => {
        const events = [];
        for (let i = 0; i < 12; i++) {
            events.push(bury(`p${i % 4}`, T0 + i * MIN, 100 + i * 50, 200));
            events.push(dig(`p${(i + 1) % 4}`, T0 + (i + 20) * MIN, 100 + i * 50, 200));
        }
        const a = run(events).players.map(p => p.id);
        const b = run([...events].sort((x, y) => x.ts - y.ts || x.line - y.line)).players.map(p => p.id);
        expect(a).toEqual(b);
    });
});

describe('severityFor', () => {
    it('bands on the documented boundaries', () => {
        expect(severityFor(0)).toBe('none');
        expect(severityFor(1)).toBe('low');
        expect(severityFor(24)).toBe('low');
        expect(severityFor(25)).toBe('medium');
        expect(severityFor(49)).toBe('medium');
        expect(severityFor(50)).toBe('high');
        expect(severityFor(74)).toBe('high');
        expect(severityFor(75)).toBe('critical');
        expect(severityFor(100)).toBe('critical');
    });
});

describe('constants', () => {
    it('keeps the grid coarse enough for a 3x3 scan to cover the tolerance disc', () => {
        // If this ever fails, findBury's neighbourhood is too small and matches at
        // the edge of tolerance will be silently missed.
        expect(MATCH_TOLERANCE_M * 2).toBeLessThan(4);
    });
});
