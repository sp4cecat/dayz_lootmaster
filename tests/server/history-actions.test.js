import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as history from '../../server/history-store.js';

/**
 * The action log and inventory snapshots — the half of the history store fed by
 * the mod's event hooks rather than its 5 s snapshot tick.
 *
 * Same in-memory DB seam as history-store.test.js. The recurring theme in here is
 * that these two streams are evidence in a way positions are not: a re-sent
 * position is a position we already had, but a re-sent pickup is a second pickup
 * that never happened, and a short inventory tree presented as complete is what
 * turns a rollback into a silent theft.
 */

const T0 = 1_700_000_000_000;

const ev = (over = {}) => ({
    n: 1,
    age: 0,
    pid: '76561198000000001',
    kind: 'pickup',
    cls: 'M4A1',
    pos: [7500, 300, 2500],
    detail: '',
    ...over,
});

const batch = (events, over = {}) => ({ session: 'run-a', seq: 1, events, ...over });

beforeEach(() => { history._openForTest(':memory:'); });
afterEach(() => { history.close(); });

describe('recordEvents', () => {
    it('stores a batch and reports how many rows it added', () => {
        const stored = history.recordEvents(
            batch([ev({ n: 1 }), ev({ n: 2, kind: 'drop' })]),
            T0,
        );
        expect(stored).toBe(2);
        expect(history.queryActions({ from: T0 - 1000, to: T0 + 1000 }).items).toHaveLength(2);
    });

    it('dates an event by how long ago it happened, not when the batch arrived', () => {
        // The mod has no wall clock — GetGame().GetTime() counts from mission start —
        // so it reports an age and the backend anchors it to its own receive time.
        // Getting this wrong bunches a whole flush interval onto one timestamp.
        history.recordEvents(batch([ev({ n: 1, age: 4000 })]), T0);
        const [row] = history.queryActions({ from: T0 - 10000, to: T0 + 10000 }).items;
        expect(row.ts).toBe(T0 - 4000);
    });

    it('refuses to believe an absurd age', () => {
        // An age past the cap would back-date a row into the middle of an imported
        // archive, where it is indistinguishable from real evidence.
        history.recordEvents(batch([ev({ n: 1, age: 999 * 3600_000 })]), T0);
        const [row] = history.queryActions({ from: 0, to: T0 + 1000 }).items;
        expect(row.ts).toBe(T0 - 60 * 60 * 1000);
    });

    it('ignores a re-sent batch instead of duplicating it', () => {
        // The mod re-queues a batch it never saw acknowledged. Without the
        // (session, n) dedup, a dropped ack invents history.
        const b = batch([ev({ n: 1 }), ev({ n: 2 })]);
        expect(history.recordEvents(b, T0)).toBe(2);
        expect(history.recordEvents(b, T0 + 5000)).toBe(0);
        expect(history.queryActions({ from: 0, to: T0 + 10000 }).items).toHaveLength(2);
    });

    it('keeps identical event numbers from different mission runs apart', () => {
        // The mod's counter restarts at every mission load, so the session is what
        // makes n unique. Without it, a restart silently swallows the first events
        // of the new run.
        history.recordEvents(batch([ev({ n: 1 })], { session: 'run-a' }), T0);
        history.recordEvents(batch([ev({ n: 1 })], { session: 'run-b' }), T0 + 5000);
        expect(history.queryActions({ from: 0, to: T0 + 10000 }).items).toHaveLength(2);
    });

    it('drops an event with no verb rather than storing a blank row', () => {
        expect(history.recordEvents(batch([ev({ kind: '' })]), T0)).toBe(0);
    });

    it('stores a positionless event, and excludes it from area questions', () => {
        // A connect has no meaningful location. It is still history — but it cannot
        // honestly be claimed to have happened inside a circle.
        history.recordEvents(batch([
            ev({ n: 1, kind: 'connect', cls: '', pos: null }),
            ev({ n: 2, kind: 'drop', pos: [7500, 300, 2500] }),
        ]), T0);
        expect(history.queryActions({ from: 0, to: T0 + 1000 }).items).toHaveLength(2);
        const near = history.queryActions({
            from: 0, to: T0 + 1000, x: 7500, z: 2500, radius: 50,
        });
        expect(near.items.map(i => i.kind)).toEqual(['drop']);
    });
});

describe('queryActions', () => {
    beforeEach(() => {
        history.recordEvents(batch([
            ev({ n: 1, kind: 'pickup', pid: 'a', pos: [7500, 300, 2500] }),
            ev({ n: 2, kind: 'drop', pid: 'b', pos: [7520, 300, 2510] }),
            ev({ n: 3, kind: 'death', pid: 'a', pos: [200, 300, 200] }),
        ]), T0);
    });

    it('returns the feed oldest-first even though the limit runs newest-first', () => {
        // The LIMIT has to take the NEWEST rows, but a feed reads forwards. Getting
        // this backwards makes a truncated feed show the wrong end of the window.
        const { items } = history.queryActions({ from: 0, to: T0 + 1000 });
        expect(items.map(i => i.ts)).toEqual([...items.map(i => i.ts)].sort((x, y) => x - y));
    });

    it('filters by player and by kind', () => {
        expect(history.queryActions({ from: 0, to: T0 + 1000, pids: ['a'] }).items)
            .toHaveLength(2);
        expect(history.queryActions({ from: 0, to: T0 + 1000, kinds: ['drop'] }).items)
            .toHaveLength(1);
    });

    it('answers "what happened at this base" through the cell index', () => {
        const { items } = history.queryActions({
            from: 0, to: T0 + 1000, x: 7500, z: 2500, radius: 100,
        });
        expect(items.map(i => i.kind).sort()).toEqual(['drop', 'pickup']);
    });

    it('discards the corners of the covered cells', () => {
        // The cell index is a 256 m grid, so it over-selects. Without the exact
        // distance re-test, a 10 m query would return things 300 m away.
        const { items } = history.queryActions({
            from: 0, to: T0 + 1000, x: 7500, z: 2500, radius: 5,
        });
        expect(items.map(i => i.kind)).toEqual(['pickup']);
    });

    it('says when the limit bit rather than looking like the end of the data', () => {
        expect(history.queryActions({ from: 0, to: T0 + 1000, limit: 2 }))
            .toMatchObject({ truncated: true });
        expect(history.queryActions({ from: 0, to: T0 + 1000, limit: 100 }))
            .toMatchObject({ truncated: false });
    });

    it('reports the limit as bitten even when the circle then discards rows', () => {
        // Same 256 m cell as the other two, but 155 m from the centre — so SQL
        // returns it and the exact distance test throws it away. Truncation is
        // measured on the SQL result, not the filtered one: the database had more
        // to give either way, and saying otherwise presents a partial feed as whole.
        history.recordEvents(batch([ev({ n: 4, kind: 'stash', pos: [7650, 300, 2540] })]), T0);
        const r = history.queryActions({
            from: 0, to: T0 + 1000, x: 7500, z: 2500, radius: 100, limit: 2,
        });
        expect(r.items.map(i => i.kind).sort()).toEqual(['drop', 'pickup']);
        expect(r.truncated).toBe(true);
    });

    it('resolves player names from the roster the position stream builds', () => {
        history.recordSnapshot({
            players: [{ name: 'Survivor', id: 'a', steamId: 'a', pos: [1, 2, 3] }],
        }, T0);
        const { items } = history.queryActions({ from: 0, to: T0 + 1000, pids: ['a'] });
        expect(items[0].name).toBe('Survivor');
    });

    it('lists the kinds actually present, for the filter chips', () => {
        expect(history.actionKinds({ from: 0, to: T0 + 1000 }).map(k => k.kind).sort())
            .toEqual(['death', 'drop', 'pickup']);
    });
});

describe('normalizeTree', () => {
    const node = (over = {}) => ({
        cls: 'TacticalBaconCan', slot: '', where: 'cargo',
        health01: 1, healthLevel: 0, quantity: -1, quantityMax: -1,
        row: -1, col: -1, displayName: 'Tactical Bacon', children: [], ...over,
    });

    it('collapses the mod sentinels the same way the position stream does', () => {
        const { tree } = history.normalizeTree([node()]);
        expect(tree[0]).toMatchObject({
            cls: 'TacticalBaconCan', slot: null, quantity: null, row: null,
        });
    });

    it('drops a node it cannot name', () => {
        // A classname is the only thing a restore can actually act on. A node
        // without one would be silently skipped at rebuild time anyway; better to
        // never claim it was captured.
        const { tree } = history.normalizeTree([node({ cls: '' }), node()]);
        expect(tree).toHaveLength(1);
    });

    it('caps total nodes and says so', () => {
        const many = Array.from({ length: history.INV_MAX_NODES + 50 }, () => node());
        const { tree, state } = history.normalizeTree(many);
        expect(tree.length).toBe(history.INV_MAX_NODES);
        expect(state.truncated).toBe(true);
    });

    it('caps depth and says so', () => {
        let deep = node();
        for (let i = 0; i < history.INV_MAX_DEPTH + 3; i++) deep = node({ children: [deep] });
        const { state } = history.normalizeTree([deep]);
        expect(state.truncated).toBe(true);
    });

    it('leaves a tree within the caps unflagged', () => {
        const { state } = history.normalizeTree([node({ children: [node()] })]);
        expect(state.truncated).toBe(false);
    });
});

describe('inventory snapshots', () => {
    const tree = [
        {
            cls: 'MountainBag', slot: 'Back', where: 'attachment', health01: 1,
            healthLevel: 0, quantity: -1, quantityMax: -1, row: -1, col: -1,
            displayName: 'Mountain Backpack',
            children: [
                {
                    cls: 'M4A1', slot: '', where: 'cargo', health01: 0.8, healthLevel: 1,
                    quantity: -1, quantityMax: -1, row: 0, col: 0, displayName: 'M4-A1',
                    children: [{
                        cls: 'Mag_STANAG_30Rnd', slot: 'magazine', where: 'attachment',
                        health01: 1, healthLevel: 0, quantity: 30, quantityMax: 30,
                        row: -1, col: -1, displayName: 'STANAG', children: [],
                    }],
                },
            ],
        },
    ];

    const snapshot = (over = {}) => ({
        session: 'run-a', n: 1, pid: '76561198000000001', reason: 'death', age: 0,
        pos: [7500, 300, 2500],
        stats: { health: 0, blood: 0, shock: 0, energy: 1500, water: 1200 },
        tree, truncated: false, ...over,
    });

    it('round-trips a nested tree', () => {
        const id = history.recordInventory(snapshot(), T0);
        const back = history.getInventory(id);
        expect(back.tree[0].cls).toBe('MountainBag');
        expect(back.tree[0].children[0].children[0].quantity).toBe(30);
    });

    it('counts every node so the list view never parses a tree', () => {
        const id = history.recordInventory(snapshot(), T0);
        expect(history.listInventory({ pid: '76561198000000001' })[0].items).toBe(3);
        expect(history.getInventory(id).items).toBe(3);
    });

    it('keeps the mod\'s own truncation flag', () => {
        // Ours and the mod's are OR-ed: short for either reason is short, and a
        // rollback has to refuse either way.
        const id = history.recordInventory(snapshot({ truncated: true }), T0);
        expect(history.getInventory(id).truncated).toBe(true);
    });

    it('omits the tree from the list, and includes it from the detail', () => {
        history.recordInventory(snapshot(), T0);
        const [row] = history.listInventory({ pid: '76561198000000001' });
        expect(row.tree).toBeUndefined();
        expect(history.getInventory(row.id).tree).toHaveLength(1);
    });

    it('lists newest first, filtered by player and window', () => {
        history.recordInventory(snapshot({ n: 1, reason: 'connect' }), T0);
        history.recordInventory(snapshot({ n: 2, reason: 'death' }), T0 + 60000);
        history.recordInventory(snapshot({ n: 3, pid: 'other' }), T0 + 30000);
        const rows = history.listInventory({ pid: '76561198000000001', from: 0, to: T0 + 100000 });
        expect(rows.map(r => r.reason)).toEqual(['death', 'connect']);
    });

    it('ignores a re-sent snapshot', () => {
        expect(history.recordInventory(snapshot(), T0)).toBeTruthy();
        expect(history.recordInventory(snapshot(), T0 + 1000)).toBeNull();
        expect(history.listInventory({})).toHaveLength(1);
    });

    it('refuses a snapshot it cannot attribute', () => {
        expect(history.recordInventory(snapshot({ pid: '' }), T0)).toBeNull();
    });

    it('returns null for a snapshot that does not exist', () => {
        expect(history.getInventory(999)).toBeNull();
    });
});

describe('the rollback audit row', () => {
    it('is written into the same log as the events that motivated it', () => {
        history.recordAction({
            ts: T0, pid: 'a', kind: 'rollback', pos: [7500, 300, 2500],
            detail: JSON.stringify({ snapshotId: 4 }),
        });
        const { items } = history.queryActions({ from: 0, to: T0 + 1000, kinds: ['rollback'] });
        expect(items).toHaveLength(1);
        expect(JSON.parse(items[0].detail).snapshotId).toBe(4);
    });

    it('carries no session, so it can never collide with a mod sequence number', () => {
        history.recordEvents(batch([ev({ n: 1 })]), T0);
        history.recordAction({ ts: T0, pid: 'a', kind: 'rollback' });
        history.recordAction({ ts: T0, pid: 'a', kind: 'rollback' });
        expect(history.queryActions({ from: 0, to: T0 + 1000, kinds: ['rollback'] }).items)
            .toHaveLength(2);
    });
});

describe('retention of actions and inventories', () => {
    it('deletes them outright past the drop cutoff rather than thinning them', () => {
        // Thinning a position stream loses resolution; thinning an action log loses
        // events, and "he picked it up at 04:12" has no coarser version still true.
        // Written through recordAction rather than a batch: MAX_EVENT_AGE_MS caps
        // how far back a mod-reported age is believed, so an event can never claim
        // to be 200 days old in the first place.
        const old = T0 - 200 * 24 * 3600_000;
        history.recordAction({ ts: old, pid: 'a', kind: 'pickup' });
        history.recordEvents(batch([ev({ n: 2 })]), T0);
        expect(history.queryActions({ from: 0, to: T0 + 1000 }).items).toHaveLength(2);

        const result = history.prune(T0);
        expect(result.actionsDropped).toBe(1);
        expect(history.queryActions({ from: 0, to: T0 + 1000 }).items).toHaveLength(1);
    });

    it('reports zero when there is nothing old enough to drop', () => {
        history.recordEvents(batch([ev({ n: 1 })]), T0);
        expect(history.prune(T0)).toMatchObject({ actionsDropped: 0, inventoriesDropped: 0 });
    });
});
