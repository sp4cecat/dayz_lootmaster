import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as history from '../../server/history-store.js';

/**
 * The history store runs against an in-memory DB here (`_openForTest`), which is
 * also what proves the PERSIST_DISABLED guard: under Vitest `init()` refuses to
 * touch the real file, so every test must open its own.
 */

const T0 = 1_700_000_000_000; // fixed epoch; the store never calls Date.now() itself
                              // when `at` is supplied, so tests stay deterministic.

const player = (over = {}) => ({
    name: 'Survivor',
    id: '76561198000000001',
    steamId: '76561198000000001',
    pos: [7500, 300, 2500],
    health: 100,
    blood: 5000,
    shock: 100,
    energy: -1,      // sentinel: engine never declared it
    water: -1,
    heatComfort: 0,
    alive: 1,
    hands: '',       // sentinel: empty-handed
    ...over,
});

beforeEach(() => { history._openForTest(':memory:'); });
afterEach(() => { history.close(); });

describe('cell packing', () => {
    it('buckets positions into a 256 m grid', () => {
        expect(history.cellFor(0, 0)).toBe(history.cellFor(255, 255));
        expect(history.cellFor(0, 0)).not.toBe(history.cellFor(256, 0));
        expect(history.cellFor(0, 0)).not.toBe(history.cellFor(0, 256));
    });

    it('keeps x and z in separate halves of the packed integer', () => {
        // A packing bug that lets one axis bleed into the other produces false
        // positives in area queries that are very hard to spot by eye.
        expect(history.cellFor(256, 0)).toBe((1 << 16) | 0);
        expect(history.cellFor(0, 256)).toBe(1);
    });

    it('covers every cell a circle touches', () => {
        // A 300 m radius at a cell corner spans 3 cells per axis.
        const cells = history.cellsForCircle(512, 512, 300);
        expect(cells).toContain(history.cellFor(512, 512));
        expect(cells).toContain(history.cellFor(300, 300));
        expect(cells).toContain(history.cellFor(760, 760));
    });

    it('handles a circle at the world origin without wrapping', () => {
        const cells = history.cellsForCircle(10, 10, 50);
        expect(cells).toContain(history.cellFor(10, 10));
    });
});

describe('recordSnapshot', () => {
    it('stores a player row with sentinels collapsed to null', () => {
        expect(history.recordSnapshot({ players: [player()] }, T0)).toBe(true);
        const [track] = history.queryTrack({ pids: ['76561198000000001'], from: 0, to: T0 + 1 });
        expect(track.points).toHaveLength(1);
        const p = track.points[0];
        expect(p).toMatchObject({ ts: T0, x: 7500, y: 300, z: 2500, health: 100, blood: 5000 });
        // -1 is "the engine never declared this stat", not a reading of minus one.
        expect(p.energy).toBeNull();
        expect(p.water).toBeNull();
        // "" is "empty-handed", which must not render as an item called "".
        expect(p.hands).toBeNull();
        // Enforce emits bools as 1/0; it must come back out as a real boolean.
        expect(p.alive).toBe(true);
    });

    it('round-trips alive=0 as false, not as unknown', () => {
        history.recordSnapshot({ players: [player({ alive: 0 })] }, T0);
        const [track] = history.queryTrack({ pids: ['76561198000000001'], from: 0, to: T0 + 1 });
        expect(track.points[0].alive).toBe(false);
    });

    it('treats a missing alive field as unknown rather than dead', () => {
        const p = player();
        delete p.alive;
        history.recordSnapshot({ players: [p] }, T0);
        const [track] = history.queryTrack({ pids: ['76561198000000001'], from: 0, to: T0 + 1 });
        expect(track.points[0].alive).toBeNull();
    });

    it('drops rows it cannot place or attribute', () => {
        history.recordSnapshot({
            players: [
                player({ pos: null }),                    // unplaceable
                player({ id: '', steamId: '' }),          // unattributable
                player({ id: 'ok', steamId: '', pos: [1, 2, 3] }),
            ],
        }, T0);
        const players = history.listPlayers({ from: 0, to: T0 + 1 });
        expect(players.map(p => p.pid)).toEqual(['ok']);
    });

    it('records the server heartbeat alongside the players', () => {
        history.recordSnapshot({
            players: [player()],
            server: { online: 12, ai: 40, fps: 47.2, hour: 13, minute: 5, weather: { rain: 0.5 } },
        }, T0);
        const s = history.stats();
        expect(s.rows).toBe(1);
        expect(s.players).toBe(1);
    });

    it('ignores AI unless recording is enabled for them', () => {
        history.recordSnapshot({
            players: [player()],
            ai: [{ id: '12:34', pos: [100, 0, 100], health: 50 }],
        }, T0);
        // HISTORY_RECORD_AI is unset in the test env, so only the player lands.
        expect(history.listPlayers({ from: 0, to: T0 + 1 })).toHaveLength(1);
    });

    it('does not blank an established name when a later tick arrives without one', () => {
        history.recordSnapshot({ players: [player({ name: 'Kostaki' })] }, T0);
        history.recordSnapshot({ players: [player({ name: '' })] }, T0 + 5000);
        const [row] = history.listPlayers({ from: 0, to: T0 + 10000 });
        expect(row.name).toBe('Kostaki');
    });

    it('is idempotent for a repeated timestamp', () => {
        history.recordSnapshot({ players: [player()] }, T0);
        history.recordSnapshot({ players: [player({ health: 42 })] }, T0);
        const [track] = history.queryTrack({ pids: ['76561198000000001'], from: 0, to: T0 + 1 });
        expect(track.points).toHaveLength(1);
        expect(track.points[0].health).toBe(42);  // last write wins
    });

    it('returns false rather than throwing on a malformed snapshot', () => {
        expect(history.recordSnapshot(null, T0)).toBe(false);
        expect(history.recordSnapshot('nonsense', T0)).toBe(false);
    });
});

describe('queryTrack', () => {
    const walk = (n, step = 5000) => {
        for (let i = 0; i < n; i++) {
            history.recordSnapshot({
                players: [player({ pos: [7500 + i, 300, 2500 + i] })],
            }, T0 + i * step);
        }
    };

    it('returns points in time order', () => {
        walk(5);
        const [track] = history.queryTrack({ pids: ['76561198000000001'], from: 0, to: T0 + 1e6 });
        expect(track.points.map(p => p.ts)).toEqual([0, 1, 2, 3, 4].map(i => T0 + i * 5000));
        expect(track.name).toBe('Survivor');
    });

    it('strides evenly when the range exceeds the row budget', () => {
        walk(100);
        const [track] = history.queryTrack({
            pids: ['76561198000000001'], from: 0, to: T0 + 1e7, maxRows: 10,
        });
        expect(track.stride).toBeGreaterThan(1);
        expect(track.points.length).toBeLessThanOrEqual(10);
        // Still starts at the beginning of the track.
        expect(track.points[0].ts).toBe(T0);
    });

    it('strides each player independently, not the interleaved union', () => {
        // Otherwise whoever was online more gets a denser track from the same budget.
        for (let i = 0; i < 50; i++) {
            history.recordSnapshot({
                players: [
                    player({ id: 'a', steamId: 'a', pos: [i, 0, 0] }),
                    player({ id: 'b', steamId: 'b', pos: [0, 0, i] }),
                ],
            }, T0 + i * 5000);
        }
        const tracks = history.queryTrack({ pids: ['a', 'b'], from: 0, to: T0 + 1e7, maxRows: 20 });
        expect(tracks).toHaveLength(2);
        expect(tracks[0].points[0].ts).toBe(T0);
        expect(tracks[1].points[0].ts).toBe(T0);
    });

    it('does not let a busy player coarsen a quiet one', () => {
        // The version of this that shipped derived ONE stride from the combined row
        // count and then applied it per partition, so a quiet player was thinned by
        // a factor set entirely by somebody else's volume — a track well under
        // budget losing most of its points because of who else was selected.
        for (let i = 0; i < 200; i++) {
            history.recordSnapshot({
                players: [player({ id: 'busy', steamId: 'busy', pos: [i, 0, 0] })],
            }, T0 + i * 5000);
        }
        for (let i = 0; i < 10; i++) {
            history.recordSnapshot({
                players: [player({ id: 'quiet', steamId: 'quiet', pos: [0, 0, i] })],
            }, T0 + i * 5000);
        }

        const [busy, quiet] = history.queryTrack({
            pids: ['busy', 'quiet'], from: 0, to: T0 + 1e7, maxRows: 50,
        });

        // The quiet player is nowhere near the budget, so nothing is dropped.
        expect(quiet.stride).toBe(1);
        expect(quiet.points).toHaveLength(10);
        // The busy player is over it, and is thinned on their own count alone.
        expect(busy.stride).toBe(4);
    });

    it('reports the stride that was actually applied to each track', () => {
        walk(100);
        for (let i = 0; i < 10; i++) {
            history.recordSnapshot({
                players: [player({ id: 'quiet', steamId: 'quiet', pos: [0, 0, i] })],
            }, T0 + i * 5000);
        }
        const tracks = history.queryTrack({
            pids: ['76561198000000001', 'quiet'], from: 0, to: T0 + 1e7, maxRows: 25,
        });
        const byPid = Object.fromEntries(tracks.map(t => [t.pid, t.stride]));
        expect(byPid['76561198000000001']).toBe(4);
        expect(byPid.quiet).toBe(1);
    });

    it('selecting more players does not change any one player’s track', () => {
        walk(100);
        for (let i = 0; i < 100; i++) {
            history.recordSnapshot({
                players: [player({ id: 'other', steamId: 'other', pos: [0, 0, i] })],
            }, T0 + i * 5000);
        }
        const alone = history.queryTrack({
            pids: ['76561198000000001'], from: 0, to: T0 + 1e7, maxRows: 20,
        })[0];
        const together = history.queryTrack({
            pids: ['76561198000000001', 'other'], from: 0, to: T0 + 1e7, maxRows: 20,
        })[0];
        expect(together.stride).toBe(alone.stride);
        expect(together.points.map(p => p.ts)).toEqual(alone.points.map(p => p.ts));
    });

    it('returns nothing for an unknown player', () => {
        walk(3);
        expect(history.queryTrack({ pids: ['nobody'], from: 0, to: T0 + 1e6 })).toEqual([]);
    });

    it('returns nothing for an empty id list rather than every player', () => {
        walk(3);
        expect(history.queryTrack({ pids: [], from: 0, to: T0 + 1e6 })).toEqual([]);
    });

    it('flags a real absence, and only a real absence', () => {
        walk(3);                                             // T0, +5s, +10s
        // Two hours later the player comes back.
        history.recordSnapshot({ players: [player({ pos: [1, 0, 1] })] }, T0 + 2 * 3600_000);
        const [track] = history.queryTrack({ pids: ['76561198000000001'], from: 0, to: T0 + 1e7 });
        expect(track.points.map(p => p.gap)).toEqual([false, false, false, true]);
    });

    it('keeps the points either side of an absence even when strided', () => {
        // Thinning must never erase the evidence of a gap: without the dt/dtNext
        // escape the boundary rows can be strided away and the absence vanishes.
        for (let i = 0; i < 60; i++) {
            history.recordSnapshot({ players: [player({ pos: [i, 0, 0] })] }, T0 + i * 5000);
        }
        const after = T0 + 60 * 5000 + 3 * 3600_000;
        for (let i = 0; i < 60; i++) {
            history.recordSnapshot({ players: [player({ pos: [500 + i, 0, 0] })] }, after + i * 5000);
        }
        const [track] = history.queryTrack({
            pids: ['76561198000000001'], from: 0, to: after + 1e6, maxRows: 10,
        });
        expect(track.stride).toBeGreaterThan(1);
        expect(track.points.filter(p => p.gap)).toHaveLength(1);
    });

    it('does not flag a long track with no absence in it', () => {
        // An hour of continuous 5 s samples has no gap anywhere, however it is
        // strided — the flag describes presence, not sampling density.
        for (let i = 0; i < 720; i++) {
            history.recordSnapshot({ players: [player({ pos: [i, 0, i] })] }, T0 + i * 5000);
        }
        const [track] = history.queryTrack({
            pids: ['76561198000000001'], from: 0, to: T0 + 1e7, maxRows: 20,
        });
        expect(track.points.some(p => p.gap)).toBe(false);
    });
});

describe('queryAt', () => {
    it('picks the sample nearest the requested instant', () => {
        history.recordSnapshot({ players: [player({ pos: [1, 0, 1] })] }, T0);
        history.recordSnapshot({ players: [player({ pos: [2, 0, 2] })] }, T0 + 10000);
        const rows = history.queryAt({ ts: T0 + 9000, tol: 30000 });
        expect(rows).toHaveLength(1);
        expect(rows[0].x).toBe(2);
    });

    it('returns nothing outside the tolerance', () => {
        history.recordSnapshot({ players: [player()] }, T0);
        expect(history.queryAt({ ts: T0 + 500000, tol: 1000 })).toEqual([]);
    });
});

describe('queryArea', () => {
    it('collapses consecutive in-radius samples into one visit', () => {
        for (let i = 0; i < 5; i++) {
            history.recordSnapshot({ players: [player({ pos: [1000, 0, 1000] })] }, T0 + i * 5000);
        }
        const visits = history.queryArea({ x: 1000, z: 1000, radius: 50, from: 0, to: T0 + 1e6 });
        expect(visits).toHaveLength(1);
        expect(visits[0]).toMatchObject({ samples: 5, enteredAt: T0, leftAt: T0 + 20000 });
        expect(visits[0].durationMs).toBe(20000);
        expect(visits[0].name).toBe('Survivor');
    });

    it('splits a return trip into two visits across a gap', () => {
        history.recordSnapshot({ players: [player({ pos: [1000, 0, 1000] })] }, T0);
        history.recordSnapshot({ players: [player({ pos: [9000, 0, 9000] })] }, T0 + 60000);
        history.recordSnapshot({ players: [player({ pos: [1000, 0, 1000] })] }, T0 + 600000);
        const visits = history.queryArea({
            x: 1000, z: 1000, radius: 50, from: 0, to: T0 + 1e7, gapMs: 60000,
        });
        expect(visits).toHaveLength(2);
    });

    it('excludes points inside the covering cells but outside the radius', () => {
        // The cell index is coarse (256 m); the exact distance test is what makes
        // the answer correct. This point shares a cell with the centre but is 200 m
        // away from it.
        history.recordSnapshot({ players: [player({ pos: [10, 0, 10] })] }, T0);
        history.recordSnapshot({ players: [player({ pos: [200, 0, 10] })] }, T0 + 5000);
        const visits = history.queryArea({ x: 10, z: 10, radius: 50, from: 0, to: T0 + 1e6 });
        expect(visits).toHaveLength(1);
        expect(visits[0].samples).toBe(1);
    });

    it('finds a player across a cell boundary', () => {
        history.recordSnapshot({ players: [player({ pos: [255, 0, 255] })] }, T0);
        const visits = history.queryArea({ x: 260, z: 260, radius: 30, from: 0, to: T0 + 1e6 });
        expect(visits).toHaveLength(1);
    });

    it('reports the closest approach, not just presence', () => {
        history.recordSnapshot({ players: [player({ pos: [1040, 0, 1000] })] }, T0);
        history.recordSnapshot({ players: [player({ pos: [1005, 0, 1000] })] }, T0 + 5000);
        const [visit] = history.queryArea({ x: 1000, z: 1000, radius: 50, from: 0, to: T0 + 1e6 });
        expect(visit.closestM).toBe(5);
        expect(visit.closestAt).toBe(T0 + 5000);
    });

    it('ignores elevation, matching the ADM search it sits alongside', () => {
        history.recordSnapshot({ players: [player({ pos: [1000, 5000, 1000] })] }, T0);
        const visits = history.queryArea({ x: 1000, z: 1000, radius: 50, from: 0, to: T0 + 1e6 });
        expect(visits).toHaveLength(1);
    });
});

describe('prune', () => {
    const DAY = 24 * 60 * 60 * 1000;

    // Seed one sample every 10 s for a stretch, at a chosen age.
    const seedAt = (ageDays, count, stepMs = 10000) => {
        const base = T0 - ageDays * DAY;
        for (let i = 0; i < count; i++) {
            history.recordSnapshot({ players: [player({ pos: [i, 0, i] })] }, base + i * stepMs);
        }
    };

    it('leaves recent positions at full fidelity', () => {
        seedAt(1, 20);
        history.prune(T0);
        expect(history.stats().rows).toBe(20);
    });

    it('thins mid-age positions to one per minute', () => {
        // 30 samples at 10 s spacing = 5 minutes of data, aged past the full window.
        seedAt(30, 30);
        const before = history.stats().rows;
        expect(before).toBe(30);
        const result = history.prune(T0);
        expect(result.thinned).toBeGreaterThan(0);
        // 5 minutes -> 5 or 6 surviving samples depending on bucket alignment.
        const after = history.stats().rows;
        expect(after).toBeLessThanOrEqual(6);
        expect(after).toBeGreaterThanOrEqual(5);
    });

    it('keeps a real observed sample, not a synthesised average', () => {
        seedAt(30, 30);
        history.prune(T0);
        const [track] = history.queryTrack({ pids: ['76561198000000001'], from: 0, to: T0 });
        // Every surviving x came from a seeded integer position.
        for (const p of track.points) expect(Number.isInteger(p.x)).toBe(true);
    });

    it('deletes anything past the thin window entirely', () => {
        seedAt(200, 10);
        const result = history.prune(T0);
        expect(result.dropped).toBe(10);
        expect(history.stats().rows).toBe(0);
    });

    it('is safe to run against an empty database', () => {
        expect(history.prune(T0)).toMatchObject({ thinned: 0, dropped: 0 });
    });
});

describe('stats', () => {
    it('reports the span and volume of what is recorded', () => {
        history.recordSnapshot({ players: [player()] }, T0);
        history.recordSnapshot({ players: [player()] }, T0 + 60000);
        const s = history.stats();
        expect(s).toMatchObject({ rows: 2, players: 1, from: T0, to: T0 + 60000, ready: true });
        expect(s.retention.fullDays).toBeGreaterThan(0);
    });

    it('reports an empty store without claiming a span', () => {
        const s = history.stats();
        expect(s.rows).toBe(0);
        expect(s.from).toBeNull();
    });
});
