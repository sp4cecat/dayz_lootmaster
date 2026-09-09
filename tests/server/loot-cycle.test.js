import { describe, it, expect } from 'vitest';
import {
    createState, ingest, evaluate, sweep, nextFlag, buildHomeZones, severityFor,
    WEIGHTS, LOG_MAX, SEVERITY_BANDS,
    WINDOW_MS, PAIR_WINDOW_MS, CYCLE_MAX_HELD_MS, QUICK_MS, LOAD_GRACE_MS,
    DUMP_MIN, DUMP_SPAN_MS, SPAWN_RADIUS_M, OPEN_MAX, IDLE_EVICT_MS, HOME_CLUSTER_M,
    RAISE_CONSECUTIVE, HOLD_MARGIN, DECAY_PER_HOUR,
} from '../../server/loot-cycle.js';

/**
 * The pairing rules are the part of this detector that can be wrong without
 * looking wrong — a mis-paired drop still produces a plausible number. So every
 * case below builds rows directly, in the exact shape the runner reads from the
 * `action` table, and each corresponds to something a real player does.
 */

const SEC = 1000;
const MIN = 60_000;
const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 7, 20, 12, 0, 0);

let seq = 0;
const row = (kind, pid, ts, cls, { x = 100, z = 200, iid = null, fresh = null, held = null, detail = null, dropped = null } = {}) => ({
    id: ++seq, ts, pid, kind, cls, x, y: 50, z, detail, iid, fresh, held, dropped,
});

/** Rows must arrive ascending by (ts, id) — the runner reads them that way. */
const sorted = (rows) => [...rows].sort((a, b) => (a.ts - b.ts) || (a.id - b.id));

const CAPABLE = { iid: true, fresh: true };

function run(rows, { homeZones = null, capable = CAPABLE, now = null, weights = null } = {}) {
    const state = createState();
    const list = sorted(rows);
    ingest(state, list, { homeZones });
    const at = now ?? (list.length ? list[list.length - 1].ts : T0);
    const out = evaluate(state, { now: at, capable, weights, timeZone: 'UTC' });
    return { state, out, at };
}

const player = (out, pid) => out.players.find(p => p.pid === pid);
const factor = (p, key) => p.factors.find(f => f.key === key);

/** Twelve fresh pickups, each dropped 5–12 s later within 3 m — the textbook cycler. */
function classicCycler(pid, start = T0, { fresh = 1, iid = true } = {}) {
    const rows = [];
    for (let i = 0; i < 12; i++) {
        const pick = start + i * 10 * SEC;
        const id = iid ? i + 1 : null;
        rows.push(row('pickup', pid, pick, `Item${i}`, { x: 100 + (i % 3), z: 200, iid: id, fresh }));
        rows.push(row('drop', pid, pick + (5 + (i % 8)) * SEC, `Item${i}`, { x: 101 + (i % 3), z: 200, iid: id }));
    }
    return rows;
}

describe('constants', () => {
    it('keeps the normaliser in step with the weights', () => {
        const sum = Object.values(WEIGHTS).reduce((s, w) => s + w.max, 0);
        expect(sum).toBe(LOG_MAX);
    });

    it('exports the tuning knobs the spec names', () => {
        expect(WINDOW_MS).toBe(60 * MIN);
        expect(PAIR_WINDOW_MS).toBe(30 * MIN);
        expect(CYCLE_MAX_HELD_MS).toBe(10 * MIN);
        expect(QUICK_MS).toBe(20 * SEC);
        expect(LOAD_GRACE_MS).toBe(90 * SEC);
        expect(DUMP_MIN).toBe(5);
        expect(DUMP_SPAN_MS).toBe(60 * SEC);
        expect(SPAWN_RADIUS_M).toBe(15);
        expect(OPEN_MAX).toBe(400);
        expect(IDLE_EVICT_MS).toBe(2 * HOUR);
        expect(HOME_CLUSTER_M).toBe(50);
        expect(RAISE_CONSECUTIVE).toBe(2);
        expect(HOLD_MARGIN).toBe(10);
        expect(DECAY_PER_HOUR).toBe(15);
        expect(SEVERITY_BANDS[0].key).toBe('critical');
    });

    it('never lets a factor exceed its cap however extreme the input', () => {
        const rows = [];
        for (let i = 0; i < 120; i++) {
            const pick = T0 + i * 4 * SEC;
            rows.push(row('pickup', 'p', pick, `C${i}`, { iid: i + 1, fresh: 1 }));
            rows.push(row('drop', 'p', pick + 2 * SEC, `C${i}`, { iid: i + 1 }));
        }
        const { out } = run(rows);
        const p = player(out, 'p');
        for (const f of p.factors) {
            expect(f.points).toBeLessThanOrEqual(WEIGHTS[f.key].max);
            expect(f.points).toBeGreaterThan(0);
        }
        expect(factor(p, 'quickCycles').points).toBeLessThan(WEIGHTS.quickCycles.max);
        expect(factor(p, 'cycleRatio').points).toBe(WEIGHTS.cycleRatio.max);
        expect(p.score).toBeLessThanOrEqual(100);
        expect(p.cycles.length).toBeLessThanOrEqual(200);
    });
});

describe('pairing', () => {
    it('pairs by item identity before class order', () => {
        // Two rags in hand; the second one is dropped. FIFO by class would blame
        // the first pickup and get the held time wrong.
        const { out } = run([
            row('pickup', 'p', T0, 'Rag', { iid: 1 }),
            row('pickup', 'p', T0 + 5 * MIN, 'Rag', { iid: 2 }),
            row('drop', 'p', T0 + 5 * MIN + 5 * SEC, 'Rag', { iid: 2 }),
        ]);
        const p = player(out, 'p');
        expect(p.counts.cycles).toBe(1);
        expect(p.cycles[0].matched).toBe('iid');
        expect(p.cycles[0].iid).toBe(2);
        expect(p.cycles[0].heldMs).toBe(5 * SEC);
    });

    it('falls back to class FIFO when identity is missing', () => {
        const { out } = run([
            row('pickup', 'p', T0, 'Rag'),
            row('pickup', 'p', T0 + 10 * SEC, 'Rag'),
            row('drop', 'p', T0 + 15 * SEC, 'Rag'),
            row('drop', 'p', T0 + 20 * SEC, 'Rag'),
        ]);
        const p = player(out, 'p');
        expect(p.counts.cycles).toBe(2);
        expect(p.cycles.map(c => c.matched)).toEqual(['cls', 'cls']);
        expect(p.cycles[0].pickTs).toBe(T0);
        expect(p.cycles[0].heldMs).toBe(15 * SEC);
        expect(p.cycles[1].pickTs).toBe(T0 + 10 * SEC);
        expect(p.cycles[1].heldMs).toBe(10 * SEC);
    });

    it('treats a drop with no pickup inside the pair window as an orphan', () => {
        const { out } = run([
            row('pickup', 'p', T0, 'Rag'),
            row('drop', 'p', T0 + PAIR_WINDOW_MS + MIN, 'Rag'),
        ]);
        const p = player(out, 'p');
        expect(p.counts.cycles).toBe(0);
        expect(p.counts.orphanDrops).toBe(1);
        expect(p.counts.totalDrops).toBe(1);
    });

    it('replaces an open pickup when the same identity is picked up again', () => {
        // We missed the item leaving the inventory; the newer pickup is the truth,
        // otherwise the held time would read five minutes instead of five seconds.
        const { out } = run([
            row('pickup', 'p', T0, 'Rag', { iid: 7 }),
            row('pickup', 'p', T0 + 5 * MIN, 'Rag', { iid: 7 }),
            row('drop', 'p', T0 + 5 * MIN + 5 * SEC, 'Rag', { iid: 7 }),
        ]);
        const p = player(out, 'p');
        expect(p.counts.cycles).toBe(1);
        expect(p.cycles[0].pickTs).toBe(T0 + 5 * MIN);
        expect(p.cycles[0].heldMs).toBe(5 * SEC);
        expect(p.counts.orphanDrops).toBe(0);
    });

    it('prefers the mod-reported held time over the timestamp delta', () => {
        const { out } = run([
            row('pickup', 'p', T0, 'Rag', { iid: 1 }),
            row('drop', 'p', T0 + 5 * MIN, 'Rag', { iid: 1, held: 3 * SEC }),
        ]);
        const c = player(out, 'p').cycles[0];
        expect(c.heldMs).toBe(3 * SEC);
        expect(factor(player(out, 'p'), 'quickCycles').value).toBe(1);
    });

    it('does not count anything held longer than the cycle limit', () => {
        const { out } = run([
            row('pickup', 'p', T0, 'Rag', { iid: 1 }),
            row('drop', 'p', T0 + CYCLE_MAX_HELD_MS + SEC, 'Rag', { iid: 1 }),
        ]);
        const p = player(out, 'p');
        expect(p.counts.cycles).toBe(0);
        expect(p.counts.orphanDrops).toBe(0);
        expect(p.counts.totalDrops).toBe(1);
    });

    it('ignores pickups inside the connect grace period', () => {
        const { out } = run([
            row('connect', 'p', T0, null),
            row('pickup', 'p', T0 + 30 * SEC, 'Rag', { iid: 1 }),
            row('drop', 'p', T0 + 40 * SEC, 'Rag', { iid: 1 }),
            row('pickup', 'p', T0 + LOAD_GRACE_MS + 10 * SEC, 'Rag', { iid: 2 }),
            row('drop', 'p', T0 + LOAD_GRACE_MS + 15 * SEC, 'Rag', { iid: 2 }),
        ]);
        const p = player(out, 'p');
        expect(p.counts.pickups).toBe(1);
        expect(p.counts.cycles).toBe(1);
        expect(p.counts.orphanDrops).toBe(1);
        expect(p.cycles[0].iid).toBe(2);
    });

    it('records every field of a cycle', () => {
        const { out } = run([
            row('pickup', 'p', T0, 'Rag', { iid: 3, fresh: 1, x: 100, z: 200 }),
            row('drop', 'p', T0 + 4 * SEC, 'Rag', { iid: 3, x: 103, z: 204 }),
        ]);
        expect(player(out, 'p').cycles[0]).toEqual({
            pid: 'p', cls: 'Rag', iid: 3, pickTs: T0, dropTs: T0 + 4 * SEC, heldMs: 4 * SEC,
            fresh: 1, pickX: 100, pickZ: 200, dropX: 103, dropZ: 204, distM: 5,
            kind: 'drop', matched: 'iid',
        });
    });
});

describe('archetypes', () => {
    it('flags the classic cycler as critical', () => {
        const { out } = run(classicCycler('cycler'));
        const p = player(out, 'cycler');
        expect(p.counts.cycles).toBe(12);
        expect(p.score).toBeGreaterThanOrEqual(75);
        expect(p.severity).toBe('critical');
        expect(p.silent).toBeNull();
        expect(p.excuse.multiplier).toBe(1);
        expect(factor(p, 'quickCycles').value).toBe(12);
        expect(factor(p, 'quickCycles').detail).toMatch(/12 items dropped within 20 s of pickup \(median [\d.]+ s\)/);
        expect(factor(p, 'freshCycles').value).toBe(12);
        expect(factor(p, 'spawnZoneDrops').value).toBe(12);
        expect(factor(p, 'cycleRate').detail).toMatch(/^peak 12 cycles in 10 min \(12:00–12:0\d\)$/);
        expect(factor(p, 'cycleRatio').detail).toBe('100% of 12 pickups discarded within 10 min');
        expect(out.summary.flagged).toBe(1);
        expect(out.summary.topScore).toBe(p.score);
    });

    it('flags the en-masse dumper through the burst factor', () => {
        // Fifteen fresh pickups spread over six minutes, then pockets emptied in 35 s.
        const rows = [];
        for (let i = 0; i < 15; i++) {
            rows.push(row('pickup', 'dumper', T0 + i * 24 * SEC, `Junk${i}`, { x: 100 + i * 5, z: 300, iid: 100 + i, fresh: 1 }));
        }
        for (let i = 0; i < 15; i++) {
            rows.push(row('drop', 'dumper', T0 + 6 * MIN + 30 * SEC + i * 2500, `Junk${i}`, { x: 100, z: 300, iid: 100 + i }));
        }
        const { out } = run(rows);
        const p = player(out, 'dumper');
        expect(p.counts.cycles).toBe(15);
        expect(factor(p, 'quickCycles').value).toBe(0);
        expect(factor(p, 'dumpBursts').value).toBe(1);
        expect(factor(p, 'dumpBursts').detail).toMatch(/^1 dump: 15 items in 35 s at 12:06$/);
        expect(p.severity).toBe('high');
    });

    it('never confuses a burst of drops that did not pair with a dump', () => {
        const rows = [];
        for (let i = 0; i < 10; i++) rows.push(row('drop', 'p', T0 + i * SEC, `Stored${i}`, { iid: 500 + i }));
        const { out } = run(rows);
        const p = player(out, 'p');
        expect(factor(p, 'dumpBursts').value).toBe(0);
        expect(p.score).toBe(0);
    });
});

describe('base triage and home zones', () => {
    const triage = () => {
        const rows = [
            row('pickup', 'builder', T0, 'A', { x: 100, z: 100, iid: 1, fresh: 0 }),
            row('pickup', 'builder', T0 + 5 * SEC, 'B', { x: 100, z: 100, iid: 2, fresh: 0 }),
            row('pickup', 'builder', T0 + 10 * SEC, 'C', { x: 100, z: 100, iid: 3, fresh: 0 }),
        ];
        const withPick = ['A', 'B', 'C'];
        for (let i = 0; i < 30; i++) {
            const cls = i < 3 ? withPick[i] : `Stored${i}`;
            rows.push(row('drop', 'builder', T0 + MIN + i * 2 * SEC, cls, { x: 500 + (i % 5), z: 500, iid: i < 3 ? i + 1 : 50 + i }));
        }
        return rows;
    };
    const deploys = [
        { x: 502, z: 498, ts: T0 - 3 * HOUR }, { x: 495, z: 505, ts: T0 - 2 * HOUR }, { x: 500, z: 500, ts: T0 - HOUR },
    ];

    it('scores zero when the drops land in the builder\'s own base', () => {
        const homeZones = new Map([['builder', buildHomeZones(deploys)]]);
        const { out } = run(triage(), { homeZones });
        const p = player(out, 'builder');
        expect(p.counts.homeDrops).toBe(30);
        expect(p.counts.cycles).toBe(0);
        expect(p.counts.orphanDrops).toBe(27);
        expect(p.score).toBe(0);
        expect(p.severity).toBe('none');
        expect(p.excuse.reasons).toContain('atHome');
    });

    it('halves the score on triage evidence alone when no home zone is known', () => {
        const { out } = run(triage());
        const p = player(out, 'builder');
        expect(p.counts.cycles).toBe(3);
        expect(p.counts.homeDrops).toBe(0);
        expect(p.excuse.multiplier).toBe(0.5);
        expect(p.excuse.reasons).toEqual(['triage']);
        expect(p.score).toBeGreaterThan(0);
        expect(p.score).toBeLessThan(25);
    });

    it('excuses a territory member but not a stranger at the same flag', () => {
        const zone = [{ x: 1000, z: 1000, r: 150, source: 'territory' }];
        const homeZones = new Map([['member', zone]]);
        const rows = [];
        for (const pid of ['member', 'stranger']) {
            for (let i = 0; i < 6; i++) {
                const pick = T0 + i * 10 * SEC;
                rows.push(row('pickup', pid, pick, `Thing${i}`, { x: 1010, z: 1005, iid: (pid === 'member' ? 10 : 20) + i, fresh: 1 }));
                rows.push(row('drop', pid, pick + 5 * SEC, `Thing${i}`, { x: 1012, z: 1005, iid: (pid === 'member' ? 10 : 20) + i }));
            }
        }
        const { out } = run(rows, { homeZones });
        const member = player(out, 'member');
        const stranger = player(out, 'stranger');
        expect(member.counts.cycles).toBe(0);
        expect(member.counts.homeDrops).toBe(6);
        expect(member.score).toBe(0);
        expect(stranger.counts.cycles).toBe(6);
        expect(stranger.counts.homeDrops).toBe(0);
        expect(stranger.score).toBeGreaterThan(0);
    });

    it('never raises a score when home zones are supplied', () => {
        const rows = classicCycler('p');
        const bare = run(rows).out.players[0].score;
        const far = run(rows, { homeZones: new Map([['p', [{ x: 9000, z: 9000, r: 50, source: 'storage' }]]]) }).out.players[0].score;
        expect(far).toBe(bare);
    });
});

describe('buildHomeZones', () => {
    it('clusters greedily and drops thin clusters', () => {
        const zones = buildHomeZones([
            { x: 500, z: 500, ts: 1 }, { x: 510, z: 495, ts: 2 }, { x: 490, z: 505, ts: 3 },
            { x: 3000, z: 3000, ts: 4 },
        ]);
        expect(zones).toHaveLength(1);
        expect(zones[0]).toMatchObject({ r: 50, source: 'storage', count: 3 });
        expect(zones[0].x).toBeCloseTo(500, 0);
        expect(zones[0].z).toBeCloseTo(500, 0);
    });

    it('honours minEvents and radius overrides', () => {
        const zones = buildHomeZones([{ x: 1, z: 1, ts: 1 }], { minEvents: 1, r: 80 });
        expect(zones).toEqual([{ x: 1, z: 1, r: 80, count: 1, source: 'storage' }]);
        expect(buildHomeZones([])).toEqual([]);
    });
});

describe('capability silence', () => {
    it('stays silent on a mod that predates item identity', () => {
        const rows = classicCycler('old', T0, { iid: false });
        const { out } = run(rows, { capable: { iid: false, fresh: false } });
        const p = player(out, 'old');
        expect(p.silent).toBe('legacy-mod');
        expect(p.score).toBe(0);
        expect(p.severity).toBe('none');
        // Pairings are still computed for display — by class, since there is no iid.
        expect(p.counts.cycles).toBe(12);
        expect(p.cycles.every(c => c.matched === 'cls')).toBe(true);
        for (const f of p.factors) {
            expect(f.points).toBe(0);
            expect(f.detail).toBe('mod predates item identity; not scored');
        }
        expect(out.summary.flagged).toBe(0);
    });

    it('silences only the fresh factor when the fresh flag is unavailable', () => {
        const rows = classicCycler('p', T0, { fresh: null });
        const { out } = run(rows, { capable: { iid: true, fresh: false } });
        const p = player(out, 'p');
        expect(p.silent).toBeNull();
        expect(factor(p, 'freshCycles').points).toBe(0);
        expect(factor(p, 'freshCycles').detail).toBe('fresh flag unavailable');
        expect(factor(p, 'quickCycles').points).toBeGreaterThan(0);
        expect(p.score).toBeGreaterThan(0);
    });

    it('falls back to the timestamp delta when held is null on a capable mod', () => {
        const { out } = run([
            row('pickup', 'p', T0, 'Rag', { iid: 1, fresh: 1 }),
            row('drop', 'p', T0 + 6 * SEC, 'Rag', { iid: 1, held: null }),
        ]);
        expect(player(out, 'p').cycles[0].heldMs).toBe(6 * SEC);
    });
});

describe('state resets', () => {
    it('makes every drop after a death an orphan', () => {
        const rows = [];
        for (let i = 0; i < 5; i++) rows.push(row('pickup', 'p', T0 + i * SEC, `C${i}`, { iid: i + 1, fresh: 1 }));
        rows.push(row('death', 'p', T0 + 10 * SEC, null));
        for (let i = 0; i < 5; i++) rows.push(row('drop', 'p', T0 + 11 * SEC + i * SEC, `C${i}`, { iid: i + 1 }));
        const { out } = run(rows);
        const p = player(out, 'p');
        expect(p.counts.cycles).toBe(0);
        expect(p.counts.orphanDrops).toBe(5);
        expect(p.counts.pickups).toBe(5);
    });

    it('makes every drop after a relog an orphan', () => {
        const rows = [];
        for (let i = 0; i < 5; i++) rows.push(row('pickup', 'p', T0 + i * SEC, `C${i}`, { iid: i + 1, fresh: 1 }));
        rows.push(row('disconnect', 'p', T0 + 10 * SEC, null));
        rows.push(row('connect', 'p', T0 + 30 * SEC, null));
        for (let i = 0; i < 5; i++) rows.push(row('drop', 'p', T0 + 3 * MIN + i * SEC, `C${i}`, { iid: i + 1 }));
        const { out } = run(rows);
        const p = player(out, 'p');
        expect(p.counts.cycles).toBe(0);
        expect(p.counts.orphanDrops).toBe(5);
    });

    it('keeps banked cycles across a disconnect', () => {
        // A dump-then-relog must still score: the cycles ring survives the reset.
        const rows = classicCycler('p');
        rows.push(row('disconnect', 'p', T0 + 5 * MIN, null));
        rows.push(row('connect', 'p', T0 + 6 * MIN, null));
        const { out } = run(rows);
        expect(player(out, 'p').counts.cycles).toBe(12);
    });

    it('closes a pickup quietly when the item is deployed', () => {
        const { out } = run([
            row('pickup', 'p', T0, 'Barrel', { iid: 1 }),
            row('deploy', 'p', T0 + 5 * SEC, 'Barrel'),
            row('drop', 'p', T0 + 10 * SEC, 'Barrel', { iid: 9 }),
        ]);
        const p = player(out, 'p');
        expect(p.counts.cycles).toBe(0);
        expect(p.counts.orphanDrops).toBe(1);
    });
});

describe('stashing', () => {
    it('counts a quick stash as a cycle and a slow one as organising', () => {
        const { out } = run([
            row('pickup', 'p', T0, 'A', { iid: 1, fresh: 1 }),
            row('stash', 'p', T0 + 10 * SEC, 'A', { iid: 1 }),
            row('pickup', 'p', T0 + MIN, 'B', { iid: 2, fresh: 1 }),
            row('stash', 'p', T0 + 2 * MIN, 'B', { iid: 2 }),
        ]);
        const p = player(out, 'p');
        expect(p.counts.cycles).toBe(1);
        expect(p.cycles[0].kind).toBe('stash');
        expect(p.counts.stashDrops).toBe(2);
        expect(p.counts.orphanDrops).toBe(0);
    });

    it('discounts a player whose pairings mostly end in storage', () => {
        const rows = [];
        for (let i = 0; i < 6; i++) {
            rows.push(row('pickup', 'p', T0 + i * 30 * SEC, `C${i}`, { iid: i + 1, fresh: 1 }));
            rows.push(row(i < 3 ? 'stash' : 'drop', 'p', T0 + i * 30 * SEC + 5 * SEC, `C${i}`, { iid: i + 1 }));
        }
        const { out } = run(rows);
        const p = player(out, 'p');
        expect(p.excuse.reasons).toEqual(['stashing']);
        expect(p.excuse.multiplier).toBe(0.7);
    });

    it('clamps stacked excuses at the floor', () => {
        const homeZones = new Map([['p', [{ x: 100, z: 200, r: 50, source: 'storage' }]]]);
        const rows = [];
        for (let i = 0; i < 4; i++) {
            rows.push(row('pickup', 'p', T0 + i * SEC, `C${i}`, { iid: i + 1, x: 900, z: 900 }));
            rows.push(row('stash', 'p', T0 + 10 * SEC + i * SEC, `C${i}`, { iid: i + 1 }));
        }
        for (let i = 0; i < 6; i++) rows.push(row('drop', 'p', T0 + 20 * SEC + i * SEC, `Store${i}`, { iid: 90 + i }));
        const { out } = run(rows, { homeZones });
        const p = player(out, 'p');
        expect(p.excuse.reasons).toEqual(['triage', 'atHome', 'stashing']);
        expect(p.excuse.multiplier).toBe(0.3);
    });
});

describe('bounds and lifecycle', () => {
    it('forgets cycles older than the window', () => {
        const { state } = run(classicCycler('p'));
        const inside = evaluate(state, { now: T0 + 30 * MIN, capable: CAPABLE });
        expect(inside.players[0].counts.cycles).toBe(12);
        const later = evaluate(state, { now: T0 + WINDOW_MS + 5 * MIN, capable: CAPABLE });
        expect(later.players[0].counts.cycles).toBe(0);
        expect(later.players[0].score).toBe(0);
        expect(later.players[0].counts.pickups).toBe(0);
    });

    it('prunes the per-player lists as rows arrive', () => {
        const state = createState();
        ingest(state, sorted(classicCycler('p')));
        ingest(state, [row('pickup', 'p', T0 + WINDOW_MS + 10 * MIN, 'Late', { iid: 999 })]);
        const p = state.players.get('p');
        expect(p.cycles).toHaveLength(0);
        expect(p.pickups).toHaveLength(1);
        expect(p.totalDrops).toHaveLength(0);
    });

    it('evicts the oldest open pickup past OPEN_MAX', () => {
        const rows = [];
        for (let i = 0; i < OPEN_MAX + 1; i++) rows.push(row('pickup', 'p', T0 + i * 10, `C${i}`, { iid: i + 1 }));
        rows.push(row('drop', 'p', T0 + 20 * SEC, 'C0', { iid: 1 }));
        rows.push(row('drop', 'p', T0 + 21 * SEC, 'C1', { iid: 2 }));
        const { state, out } = run(rows);
        const p = player(out, 'p');
        expect(p.counts.orphanDrops).toBe(1);
        expect(p.counts.cycles).toBe(1);
        expect(p.cycles[0].iid).toBe(2);
        expect(state.players.get('p').open.size).toBe(OPEN_MAX - 1);
        expect(state.players.get('p').openCount).toBe(OPEN_MAX - 1);
    });

    it('sweeps idle players and reports how many went', () => {
        const state = createState();
        ingest(state, sorted([
            ...classicCycler('active', T0 + 3 * HOUR),
            ...classicCycler('idle', T0),
        ]));
        expect(state.players.size).toBe(2);
        expect(sweep(state, T0 + 3 * HOUR + 5 * MIN)).toBe(1);
        expect(state.players.has('active')).toBe(true);
        expect(state.players.has('idle')).toBe(false);
        expect(sweep(state, T0 + 3 * HOUR + 5 * MIN)).toBe(0);
    });

    it('marks the window lossy when a batch reported dropped events', () => {
        const rows = classicCycler('p');
        rows.push(row('pickup', 'other', T0 + MIN, 'Rag', { iid: 77, dropped: 3 }));
        const { state, out } = run(rows);
        expect(out.summary.lossy).toBe(true);
        expect(player(out, 'p').lossy).toBe(true);
        const later = evaluate(state, { now: T0 + WINDOW_MS + 2 * MIN, capable: CAPABLE });
        expect(later.summary.lossy).toBe(false);
    });

    it('ignores kinds it does not know and rows without a timestamp', () => {
        const state = createState();
        ingest(state, [
            { id: 1, ts: T0, pid: 'p', kind: 'chat', cls: null },
            { id: 2, ts: NaN, pid: 'p', kind: 'pickup', cls: 'Rag' },
            null,
        ]);
        expect(state.players.size).toBe(0);
        expect(evaluate(state, { now: T0 }).summary).toEqual({ players: 0, flagged: 0, topScore: 0, lossy: false });
    });

    it('merges weight overrides per key', () => {
        const rows = classicCycler('p');
        const base = run(rows).out.players[0];
        const tuned = run(rows, { weights: { freshCycles: { max: 0 } } }).out.players[0];
        expect(factor(tuned, 'freshCycles').points).toBe(0);
        expect(factor(tuned, 'freshCycles').max).toBe(0);
        expect(factor(tuned, 'quickCycles').max).toBe(WEIGHTS.quickCycles.max);
        expect(tuned.score).not.toBe(base.score);
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

describe('nextFlag hysteresis', () => {
    const STEP = 30 * SEC;

    it('starts from nothing when there is no previous flag', () => {
        const f = nextFlag(null, { score: 0, ts: T0 });
        expect(f).toMatchObject({ level: 'none', smoothed: 0, hits: 0, candidate: null, raisedAt: null, lastEvalTs: T0, peak: 0, changed: false });
    });

    it('needs two consecutive readings above the band before promoting', () => {
        const a = nextFlag(null, { score: 80, ts: T0, factors: [{ key: 'x' }] });
        expect(a.level).toBe('none');
        expect(a.candidate).toBe('critical');
        expect(a.hits).toBe(1);
        expect(a.changed).toBe(false);
        expect(a.lastFactors).toBeNull();

        const b = nextFlag(a, { score: 80, ts: T0 + STEP, factors: [{ key: 'y' }] });
        expect(b.level).toBe('critical');
        expect(b.changed).toBe(true);
        expect(b.raisedAt).toBe(T0 + STEP);
        expect(b.hits).toBe(0);
        expect(b.candidate).toBeNull();
        expect(b.peak).toBe(80);
        expect(b.lastFactors).toEqual([{ key: 'y' }]);
    });

    it('resets the run when a clean reading interrupts it', () => {
        const a = nextFlag(null, { score: 80, ts: T0 });
        const b = nextFlag(a, { score: 0, ts: T0 + STEP });
        expect(b.level).toBe('none');
        expect(b.hits).toBe(0);
        expect(b.candidate).toBeNull();
        const c = nextFlag(b, { score: 80, ts: T0 + 2 * STEP });
        expect(c.level).toBe('none');
        expect(c.hits).toBe(1);
    });

    it('promotes to the lowest band the whole run agreed on', () => {
        const a = nextFlag(null, { score: 30, ts: T0 });
        const b = nextFlag(a, { score: 60, ts: T0 + STEP });
        expect(b.level).toBe('medium');
        const c = nextFlag(b, { score: 60, ts: T0 + 2 * STEP });
        expect(c.level).toBe('medium');
        expect(c.candidate).toBe('high');
        const d = nextFlag(c, { score: 60, ts: T0 + 3 * STEP });
        expect(d.level).toBe('high');
    });

    it('decays through the ladder on clean play per the worked example', () => {
        // 80, 80 -> critical; then nothing but zeroes, evaluated every 30 s.
        let f = nextFlag(null, { score: 80, ts: T0 });
        f = nextFlag(f, { score: 80, ts: T0 + STEP });
        expect(f.level).toBe('critical');

        const trail = [];
        let last = f.level;
        for (let ts = T0 + 2 * STEP; ts <= T0 + 6 * HOUR; ts += STEP) {
            f = nextFlag(f, { score: 0, ts });
            if (f.level !== last) {
                expect(f.changed).toBe(true);
                trail.push({ level: f.level, at: ts - T0 });
                last = f.level;
            } else {
                expect(f.changed).toBe(false);
            }
        }
        expect(trail.map(t => t.level)).toEqual(['high', 'medium', 'low', 'none']);

        const at = (level) => trail.find(t => t.level === level).at;
        // critical holds to 75 - 10 = 65, i.e. one hour of decay at 15/h from
        // the second 80 (which landed at T0 + STEP)...
        expect(at('high')).toBeGreaterThanOrEqual(HOUR);
        expect(at('high')).toBeLessThanOrEqual(HOUR + 2 * STEP);
        // ...high to 40, medium to 15, low until the score is spent.
        expect(at('medium')).toBeGreaterThan(at('high'));
        expect(at('low')).toBeGreaterThan(at('medium'));
        expect(at('none')).toBeGreaterThan(5 * HOUR);
        expect(at('none')).toBeLessThanOrEqual(5 * HOUR + 20 * MIN);

        // The spec's snapshots: high at 2 h, medium at 3 h, none by ~5 h 20 min.
        const levelAt = (t) => {
            let g = nextFlag(null, { score: 80, ts: T0 });
            g = nextFlag(g, { score: 80, ts: T0 + STEP });
            for (let ts = T0 + 2 * STEP; ts <= T0 + t; ts += STEP) g = nextFlag(g, { score: 0, ts });
            return g;
        };
        expect(levelAt(2 * HOUR).level).toBe('high');
        expect(levelAt(3 * HOUR).level).toBe('medium');
        expect(levelAt(4 * HOUR + 30 * MIN).level).toBe('low');
        expect(levelAt(5 * HOUR + 20 * MIN).level).toBe('none');
        expect(levelAt(5 * HOUR + 20 * MIN).peak).toBe(80);
        expect(levelAt(5 * HOUR + 20 * MIN).smoothed).toBeLessThan(1);
        expect(levelAt(5 * HOUR + 30 * MIN).smoothed).toBe(0);
    });

    it('keeps the peak and does not decay backwards in time', () => {
        let f = nextFlag(null, { score: 60, ts: T0 });
        f = nextFlag(f, { score: 60, ts: T0 + STEP });
        f = nextFlag(f, { score: 0, ts: T0 - HOUR });
        expect(f.smoothed).toBe(60);
        expect(f.peak).toBe(60);
        expect(f.level).toBe('high');
    });
});
