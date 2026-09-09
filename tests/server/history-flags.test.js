import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as history from '../../server/history-store.js';

/**
 * Schema v4: item identity on actions, the batch loss counter, and the flag /
 * enforcement tables the loot-cycle detector persists into.
 */

const T0 = 1_700_000_000_000;
const PID = '76561198000000001';

const ev = (over = {}) => ({
    n: 1, age: 0, pid: PID, kind: 'pickup', cls: 'Rag', pos: [7500, 300, 2500], detail: '', ...over,
});
const batch = (events, over = {}) => ({ session: 'run-a', seq: 1, events, ...over });

beforeEach(() => { history._openForTest(':memory:'); });
afterEach(() => { history.close(); });

describe('item identity columns', () => {
    it('stores iid / fresh / held and collapses the mod sentinels to null', () => {
        history.recordEvents(batch([
            ev({ n: 1, iid: 7, fresh: 1, held: -1 }),
            ev({ n: 2, kind: 'drop', iid: 7, fresh: 0, held: 6500 }),
            ev({ n: 3, kind: 'connect', cls: '', iid: 0, fresh: -1, held: -1 }),
            ev({ n: 4, kind: 'pickup', cls: 'Old' }),                     // pre-1.4 mod: keys absent
        ]), T0);
        const rows = history.queryActions({ from: T0 - 1, to: T0 + 1 }).items;
        const byN = Object.fromEntries(rows.map((r, i) => [i + 1, r]));
        expect(byN[1]).toMatchObject({ iid: 7, fresh: true, held: null });
        expect(byN[2]).toMatchObject({ iid: 7, fresh: false, held: 6500 });
        expect(byN[3]).toMatchObject({ iid: null, fresh: null, held: null });
        expect(byN[4]).toMatchObject({ iid: null, fresh: null, held: null });
    });

    it('carries batch.dropped on the first stored row only', () => {
        history.recordEvents(batch([ev({ n: 1 }), ev({ n: 2, kind: 'drop' })], { dropped: 4 }), T0);
        const rows = history.actionsSince({ afterId: 0 });
        expect(rows.map(r => r.dropped)).toEqual([4, null]);
        // A retried batch inserts nothing, so it cannot re-report the same loss.
        history.recordEvents(batch([ev({ n: 1 }), ev({ n: 2, kind: 'drop' })], { dropped: 4 }), T0);
        expect(history.actionsSince({ afterId: 0 })).toHaveLength(2);
    });

    it('reports whether the feeding mod sends identity at all', () => {
        expect(history.capableSince({ since: 0 })).toEqual({ rows: 0, iid: false, fresh: false });
        history.recordEvents(batch([ev({ n: 1 })]), T0);
        expect(history.capableSince({ since: 0 }).iid).toBe(false);
        history.recordEvents(batch([ev({ n: 2, iid: 3, fresh: 1 })]), T0);
        expect(history.capableSince({ since: 0 })).toEqual({ rows: 2, iid: true, fresh: true });
    });
});

describe('cursor and range reads', () => {
    it('actionsSince walks forward from an id in arrival order', () => {
        history.recordEvents(batch([ev({ n: 1 }), ev({ n: 2 }), ev({ n: 3 })]), T0);
        const all = history.actionsSince({ afterId: 0 });
        expect(all.map(r => r.id)).toEqual([1, 2, 3]);
        expect(history.actionsSince({ afterId: 2 }).map(r => r.id)).toEqual([3]);
        expect(history.maxActionId()).toBe(3);
    });

    it('actionsInRange is ascending and honest about its cap', () => {
        history.recordEvents(batch([ev({ n: 1, age: 3000 }), ev({ n: 2, age: 1000 }), ev({ n: 3, age: 2000 })]), T0);
        const { items, truncated } = history.actionsInRange({ from: 0, to: T0, limit: 2 });
        expect(items.map(r => r.ts)).toEqual([T0 - 3000, T0 - 2000]);
        expect(truncated).toBe(true);
    });

    it('homeEvents returns only deploy/stash rows with a position', () => {
        history.recordEvents(batch([
            ev({ n: 1, kind: 'deploy', cls: 'TentBase' }),
            ev({ n: 2, kind: 'stash', cls: 'Rag', detail: 'SeaChest' }),
            ev({ n: 3, kind: 'drop' }),
            ev({ n: 4, kind: 'deploy', pos: null }),
        ]), T0);
        expect(history.homeEvents({ pid: PID, now: T0 }).map(r => r.kind)).toEqual(['deploy', 'stash']);
    });
});

describe('flags', () => {
    const verdict = (over = {}) => ({
        pid: PID, kind: 'loot_cycle', score: 60, severity: 'high', peak: 60, rung: 0,
        evidence: { factors: [] }, state: { level: 'high' }, now: T0, raised: true, ...over,
    });

    it('upserts, lists worst-first and filters by severity', () => {
        history.upsertFlag(verdict());
        history.upsertFlag(verdict({ pid: 'p2', score: 10, severity: 'low' }));
        history.upsertFlag(verdict({ pid: 'p3', score: 90, severity: 'critical' }));
        expect(history.listFlags({ minSeverity: 'low' }).map(f => f.pid)).toEqual(['p3', PID, 'p2']);
        expect(history.listFlags({ minSeverity: 'high' }).map(f => f.pid)).toEqual(['p3', PID]);
        expect(history.stats().flags).toBe(3);
    });

    it('keeps first_at and peak across updates and counts episodes only on a raise', () => {
        history.upsertFlag(verdict({ now: T0 }));
        history.upsertFlag(verdict({ score: 30, severity: 'medium', peak: 30, now: T0 + 1000, raised: false }));
        const f = history.getFlag({ pid: PID });
        expect(f.firstAt).toBe(T0);
        expect(f.updatedAt).toBe(T0 + 1000);
        expect(f.peak).toBe(60);
        expect(f.episodes).toBe(1);
        expect(f.score).toBe(30);
    });

    it('clearing hides the flag until it is raised again', () => {
        history.upsertFlag(verdict());
        history.setFlagRung({ pid: PID, rung: 2 });
        expect(history.clearFlag({ pid: PID, now: T0 + 5 })).toBe(true);
        expect(history.clearFlag({ pid: PID, now: T0 + 6 })).toBe(false);       // already cleared
        expect(history.listFlags({ minSeverity: 'low' })).toHaveLength(0);
        expect(history.listFlags({ minSeverity: 'low', includeCleared: true })).toHaveLength(1);
        expect(history.getFlag({ pid: PID }).rung).toBe(0);
        history.upsertFlag(verdict({ now: T0 + 10, raised: true, uncleared: true }));
        const f = history.getFlag({ pid: PID });
        expect(f.clearedAt).toBeNull();
        expect(f.episodes).toBe(2);
    });

    it('records enforcement newest-first', () => {
        history.recordEnforcement({ ts: T0, pid: PID, rung: 1, action: 'notice', auto: true, result: 'ok', detail: 'a' });
        history.recordEnforcement({ ts: T0 + 1, pid: PID, rung: 2, action: 'warning', auto: false, result: 'ok', detail: 'b' });
        const rows = history.listEnforcement({ pid: PID });
        expect(rows.map(r => [r.rung, r.auto])).toEqual([[2, false], [1, true]]);
    });

    it('prunes stale flags and enforcement with the actions they explain', () => {
        const old = T0 - 400 * 86_400_000;
        history.upsertFlag(verdict({ now: old }));
        history.recordEnforcement({ ts: old, pid: PID, rung: 1, action: 'notice', auto: true });
        history.prune(T0);
        expect(history.getFlag({ pid: PID })).toBeNull();
        expect(history.listEnforcement({ pid: PID })).toHaveLength(0);
    });
});
