import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { voteOffset, rowsForFile, UNRESOLVED_PREFIX, DEFAULT_OFFSET_MINUTES } from '../../server/adm-import.js';
import { parseAdmFile } from '../../server/adm-parse.js';
import * as history from '../../server/history-store.js';

const file = (offsetMinutes, source, confident = true) => ({
    confident,
    detected: offsetMinutes === null ? null : { offsetMinutes, source, rawMinutes: offsetMinutes },
});

describe('voteOffset', () => {
    it('takes the majority answer', () => {
        expect(voteOffset([file(660, 'mtime'), file(660, 'mtime'), file(600, 'mtime')]))
            .toMatchObject({ offsetMinutes: 660, votes: 2, disagreement: 1 });
    });

    it('lets the tight signal outrank the loose one regardless of count', () => {
        // Real archives contain near-empty rotations whose only usable signal is the
        // log folder, which is stamped at boot rather than at the header. Letting
        // those outvote the mtime signal put a whole archive 3 hours out.
        const files = [
            file(660, 'mtime'),
            file(480, 'logdir'), file(480, 'logdir'), file(480, 'logdir'),
        ];
        expect(voteOffset(files)).toMatchObject({ offsetMinutes: 660, source: 'mtime', votes: 1 });
    });

    it('does not count a weaker signal as disagreement', () => {
        const files = [file(660, 'mtime'), file(330, 'logdir')];
        expect(voteOffset(files).disagreement).toBe(0);
    });

    it('falls back to the folder signal when nothing has a usable mtime', () => {
        expect(voteOffset([file(480, 'logdir'), file(480, 'logdir')]))
            .toMatchObject({ offsetMinutes: 480, source: 'logdir' });
    });

    it('falls back to the documented default when nothing is detectable', () => {
        expect(voteOffset([file(null), file(660, 'mtime', false)]))
            .toMatchObject({ offsetMinutes: DEFAULT_OFFSET_MINUTES, source: 'default', votes: 0 });
    });

    it('handles an empty archive', () => {
        expect(voteOffset([])).toMatchObject({ source: 'default', total: 0 });
    });
});

describe('rowsForFile', () => {
    const header = { y: 2025, mon: 0, d: 4, h: 0, mi: 0, s: 0 };
    const build = (lines) => rowsForFile(parseAdmFile(lines.join('\n')), header, 0);

    it('places rows at the header date plus the line clock', () => {
        const { rows } = build(['10:00:00 | Player "A" (id=G1 pos=<100, 200, 300>)']);
        expect(new Date(rows[0].ts).toISOString()).toBe('2025-01-04T10:00:00.000Z');
        expect(rows[0]).toMatchObject({ x: 100, z: 200, y: 300, guid: 'G1' });
    });

    it('merges two readings for the same player-second into one row', () => {
        // (srv, pid, ts) is the primary key, so a roster line and a hit line in the
        // same second MUST collapse — and the merge has to keep the health that
        // only one of them carries.
        const { rows } = build([
            '10:00:00 | Player "A" (id=G1 pos=<100, 200, 300>)',
            '10:00:00 | Player "A" (id=G1 pos=<100, 200, 300>)[HP: 42] hit by Infected into Torso(1) for 5 damage (MeleeInfected)',
        ]);
        expect(rows).toHaveLength(1);
        expect(rows[0].health).toBe(42);
    });

    it('never resurrects a player who died in the same second', () => {
        const { rows } = build([
            '10:00:00 | Player "A" (DEAD) (id=G1 pos=<1, 2, 3>) died. Stats> Water: 5 Energy: 6 Bleed sources: 0',
            '10:00:00 | Player "A" (id=G1 pos=<1, 2, 3>)',
        ]);
        expect(rows[0].alive).toBe(false);
        expect(rows[0].water).toBe(5);
    });

    it('marks the sample after a reconnect as the start of a new run', () => {
        // This is the only authoritative statement of absence the format contains.
        // Without it the map draws a straight line across a logout.
        const { rows, events } = build([
            '10:00:00 | Player "A" (id=G1 pos=<100, 200, 300>)',
            '10:05:00 | Player "A"(id=G1) has been disconnected',
            '11:00:00 | Player "A"(id=G1) is connected',
            '11:00:05 | Player "A" (id=G1 pos=<900, 900, 300>)',
        ]);
        expect(events).toBe(2);
        expect(rows).toHaveLength(2);
        expect(rows[0].runStart).toBeNull();
        expect(rows[1].runStart).toBe(1);
    });

    it('drops observations with no position', () => {
        // A connect line places nobody; keeping it would put a row at 0,0.
        const { rows } = build(['10:00:00 | Player "A"(id=G1) is connected']);
        expect(rows).toEqual([]);
    });

    it('returns rows in time order even when the log interleaves', () => {
        // Lines a few seconds out of order happen when two subsystems flush
        // together. That must reorder, NOT be read as midnight — the rollover rule
        // only applies past a minute, which is why this stays inside it.
        const { rows } = build([
            '10:00:30 | Player "A" (id=G1 pos=<1, 1, 1>)',
            '10:00:05 | Player "B" (id=G2 pos=<2, 2, 2>)',
        ]);
        expect(rows.map(r => r.guid)).toEqual(['G2', 'G1']);
        expect(rows[1].ts - rows[0].ts).toBe(25_000);
    });
});

describe('import into the store', () => {
    beforeEach(() => { history._openForTest(':memory:'); });
    afterEach(() => { history.close(); });

    const admRow = (over = {}) => ({
        pid: `${UNRESOLVED_PREFIX}G1`, steamId: null, name: 'A',
        ts: 1_700_000_000_000, x: 100, y: 300, z: 200,
        health: null, blood: null, shock: null, energy: null, water: null,
        alive: null, runStart: null,
        ...over,
    });

    it('tags imported rows so they are distinguishable from the live stream', () => {
        history.recordAdmRows([admRow()]);
        expect(history.stats().bySrc).toMatchObject({ adm: 1 });
    });

    it('is idempotent, so re-importing an archive changes nothing', () => {
        expect(history.recordAdmRows([admRow()])).toBe(1);
        expect(history.recordAdmRows([admRow()])).toBe(0);
    });

    it('never overwrites a mod sample with an imported one', () => {
        // The mod's row has blood, shock and hands that ADM cannot supply. A
        // colliding import must lose, or a live tick gets downgraded to a log entry.
        const at = 1_700_000_000_000;
        history.recordSnapshot({
            players: [{
                name: 'Survivor', id: '76561198000000001', steamId: '76561198000000001',
                pos: [100, 300, 200], health: 100, blood: 5000, shock: 100, alive: 1, hands: 'M4A1',
            }],
        }, at);
        history.recordAdmRows([admRow({ pid: '76561198000000001', ts: at, health: 12 })]);

        const [track] = history.queryTrack({ pids: ['76561198000000001'], from: at - 1, to: at + 1 });
        expect(track.points[0].health).toBe(100);
        expect(track.points[0].hands).toBe('M4A1');
        expect(track.points[0].src).toBe('mod');
    });

    it('does not flag a normal 5-minute roster cadence as an absence', () => {
        // The whole reason src exists. Under the mod's 60 s rule every one of these
        // would be a gap, the path would shatter into single points, and the map
        // would render nothing at all.
        const t = 1_700_000_000_000;
        history.recordAdmRows([0, 1, 2, 3].map(i => admRow({ ts: t + i * 300_000, x: 100 + i })));
        const [track] = history.queryTrack({ pids: [`${UNRESOLVED_PREFIX}G1`], from: t - 1, to: t + 10 * 300_000 });
        expect(track.points).toHaveLength(4);
        expect(track.points.filter(p => p.gap)).toHaveLength(0);
    });

    it('still flags a real absence in imported data', () => {
        const t = 1_700_000_000_000;
        history.recordAdmRows([
            admRow({ ts: t }),
            admRow({ ts: t + 6 * 3600_000, x: 900 }),
        ]);
        const [track] = history.queryTrack({ pids: [`${UNRESOLVED_PREFIX}G1`], from: t - 1, to: t + 7 * 3600_000 });
        expect(track.points[1].gap).toBe(true);
    });

    it('honours an explicit run boundary even when the samples are close together', () => {
        // A reconnect 10 seconds later is still a new session; only the log knows.
        const t = 1_700_000_000_000;
        history.recordAdmRows([
            admRow({ ts: t }),
            admRow({ ts: t + 10_000, x: 900, runStart: 1 }),
        ]);
        const [track] = history.queryTrack({ pids: [`${UNRESOLVED_PREFIX}G1`], from: t - 1, to: t + 60_000 });
        expect(track.points[1].gap).toBe(true);
    });

    it('exempts imported rows from age-based retention', () => {
        // An archive is almost always older than the drop cutoff. Without the
        // exemption the first hourly prune deletes everything just imported.
        const ancient = Date.now() - 400 * 24 * 3600_000;
        history.recordAdmRows([admRow({ ts: ancient })]);
        history.prune(Date.now());
        expect(history.stats().rows).toBe(1);
    });

    it('still prunes mod rows of the same age', () => {
        const ancient = Date.now() - 400 * 24 * 3600_000;
        history.recordSnapshot({
            players: [{ name: 'S', id: '765', steamId: '765', pos: [1, 2, 3], alive: 1 }],
        }, ancient);
        const before = history.stats().rows;
        history.prune(Date.now());
        expect(history.stats().rows).toBeLessThan(before);
    });

    it('widens the seen-range rather than clobbering it', () => {
        // Importing an old archive after the mod has been running must extend
        // first_seen backwards, not overwrite the live last_seen.
        const now = 1_700_000_000_000;
        history.recordSnapshot({
            players: [{ name: 'S', id: '765', steamId: '765', pos: [1, 2, 3], alive: 1 }],
        }, now);
        history.recordAdmRows([admRow({ pid: '765', ts: now - 90 * 24 * 3600_000 })]);
        const [p] = history.listPlayers({ from: 0, to: now + 1 });
        expect(p.firstTs).toBeLessThan(now);
        expect(p.lastTs).toBe(now);
    });

    it('skips rows with an unusable position instead of storing NaN', () => {
        expect(history.recordAdmRows([admRow({ x: NaN }), admRow({ ts: 1, z: undefined })])).toBe(0);
    });

    it('accepts an empty batch', () => {
        expect(history.recordAdmRows([])).toBe(0);
    });
});
