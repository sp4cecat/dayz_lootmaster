import { describe, it, expect } from 'vitest';
import {
    zoneOffsetMinutes, zoneLabel, fmtOffset, localFields, resolveWall, wallToMs,
    normalizeTimeZone, isValidTimeZone, createDayCounter, createWallResolver, createDayClock,
} from '../../server/log-clock.js';

/**
 * Australia/Sydney is the zone this was written for and it exercises everything
 * that matters: a daylight-saving change, in the southern hemisphere, on a date
 * that moves. In 2025 the clock goes back at 03:00 on 6 April and forward at
 * 02:00 on 5 October.
 */
const SYD = 'Australia/Sydney';
const BNE = 'Australia/Brisbane';   // same longitude, never observes DST

describe('zoneOffsetMinutes', () => {
    it('reads the offset in force at an instant, not a fixed one', () => {
        expect(zoneOffsetMinutes(Date.parse('2025-01-15T00:00:00Z'), SYD)).toBe(660);   // AEDT
        expect(zoneOffsetMinutes(Date.parse('2025-07-15T00:00:00Z'), SYD)).toBe(600);   // AEST
    });

    it('does not invent daylight saving for a zone that has none', () => {
        expect(zoneOffsetMinutes(Date.parse('2025-01-15T00:00:00Z'), BNE)).toBe(600);
        expect(zoneOffsetMinutes(Date.parse('2025-07-15T00:00:00Z'), BNE)).toBe(600);
    });

    it('handles a zone that is not a whole number of hours', () => {
        expect(zoneOffsetMinutes(Date.parse('2025-07-15T00:00:00Z'), 'Australia/Lord_Howe')).toBe(630);
        expect(zoneOffsetMinutes(Date.parse('2025-01-15T00:00:00Z'), 'Australia/Lord_Howe')).toBe(660);
    });
});

describe('zone naming', () => {
    it('labels an instant with the abbreviation an operator would recognise', () => {
        expect(zoneLabel(Date.parse('2025-01-15T00:00:00Z'), SYD)).toBe('AEDT');
        expect(zoneLabel(Date.parse('2025-07-15T00:00:00Z'), SYD)).toBe('AEST');
    });

    it('falls back to the numeric form where there is no abbreviation', () => {
        expect(zoneLabel(Date.parse('2025-01-15T00:00:00Z'), 'Etc/UTC')).toBe('UTC+00:00');
    });

    it('formats offsets with a sign and a half-hour', () => {
        expect(fmtOffset(660)).toBe('UTC+11:00');
        expect(fmtOffset(0)).toBe('UTC+00:00');
        expect(fmtOffset(-330)).toBe('UTC-05:30');
    });

    it('rejects a zone the runtime does not know', () => {
        expect(isValidTimeZone(SYD)).toBe(true);
        expect(normalizeTimeZone('Mars/Olympus_Mons')).toBeNull();
        expect(normalizeTimeZone('')).toBeNull();
        expect(normalizeTimeZone(undefined)).toBeNull();
    });
});

describe('localFields', () => {
    it('reports the calendar a zone was showing, across a date boundary', () => {
        // 2025-01-01T13:30Z is already the 2nd in Sydney.
        expect(localFields(Date.parse('2025-01-01T13:30:00Z'), SYD))
            .toEqual({ y: 2025, mon: 0, d: 2, h: 0, mi: 30, s: 0 });
    });
});

describe('resolveWall', () => {
    const at = (h, mi, d = 6, mon = 3) => ({ y: 2025, mon, d, h, mi, s: 0 });

    it('reads a wall clock in the zone it was written in', () => {
        expect(new Date(wallToMs({ y: 2025, mon: 0, d: 4, h: 17, mi: 50, s: 50 }, SYD)).toISOString())
            .toBe('2025-01-04T06:50:50.000Z');       // AEDT, +11
        expect(new Date(wallToMs({ y: 2025, mon: 6, d: 4, h: 17, mi: 50, s: 50 }, SYD)).toISOString())
            .toBe('2025-07-04T07:50:50.000Z');       // AEST, +10
    });

    it('takes a fixed offset when that is all the caller has', () => {
        expect(new Date(wallToMs({ y: 2025, mon: 0, d: 4, h: 17, mi: 50, s: 50 }, { offsetMinutes: 660 })).toISOString())
            .toBe('2025-01-04T06:50:50.000Z');
    });

    it('reports an hour that happened twice, and defaults to the first pass', () => {
        // 02:30 on 6 April 2025 occurs once on AEDT and again an hour later on AEST.
        const first = resolveWall(at(2, 30), SYD);
        expect(first.ambiguous).toBe(true);
        expect(first.offsetMinutes).toBe(660);
        expect(new Date(first.ms).toISOString()).toBe('2025-04-05T15:30:00.000Z');

        const second = resolveWall(at(2, 30), SYD, { preferLater: true });
        expect(second.offsetMinutes).toBe(600);
        expect(second.ms - first.ms).toBe(3600_000);
    });

    it('reports an hour that never happened rather than throwing', () => {
        // The clock jumped 02:00 -> 03:00 on 5 October 2025.
        const gap = resolveWall(at(2, 30, 5, 9), SYD);
        expect(gap.nonexistent).toBe(true);
        expect(new Date(gap.ms).toISOString()).toBe('2025-10-04T16:30:00.000Z');   // 03:30 AEDT
    });

    it('leaves unambiguous times alone either side of a change', () => {
        expect(resolveWall(at(1, 0), SYD).ambiguous).toBe(false);
        expect(resolveWall(at(4, 0), SYD).ambiguous).toBe(false);
    });
});

describe('createDayCounter', () => {
    const run = (secs) => secs.map(createDayCounter());

    it('rolls the day when the clock wraps past midnight', () => {
        expect(run([23 * 3600 + 3590, 10])).toEqual([0, 1]);
    });

    it('does not roll on lines written out of order', () => {
        expect(run([12 * 3600 + 5, 12 * 3600 + 4])).toEqual([0, 0]);
    });

    it('does not roll when daylight saving replays an hour', () => {
        // This is why the threshold is hours and not seconds. Reading the repeated
        // hour as midnight would move the rest of the file a full day.
        expect(run([2 * 3600 + 59 * 60, 2 * 3600])).toEqual([0, 0]);
    });

    it('rolls after a long quiet stretch across midnight', () => {
        expect(run([22 * 3600, 4 * 3600])).toEqual([0, 1]);
    });
});

describe('createWallResolver', () => {
    it('keeps a file in order through the end of daylight saving', () => {
        // Without the file's own ordering there is nothing to tell the two passes
        // through 02:00-02:59 apart, and half of them land an hour in the past.
        const resolve = createWallResolver(SYD);
        const seq = [[1, 59], [2, 30], [2, 0], [2, 40], [3, 10]]
            .map(([h, mi]) => resolve({ y: 2025, mon: 3, d: 6, h, mi, s: 0 }).ms);

        for (let i = 1; i < seq.length; i++) expect(seq[i]).toBeGreaterThan(seq[i - 1]);
        expect(new Date(seq[2]).toISOString()).toBe('2025-04-05T16:00:00.000Z');   // second pass, AEST
    });

    it('takes the earlier reading when nothing constrains it', () => {
        const resolve = createWallResolver(SYD);
        expect(new Date(resolve({ y: 2025, mon: 3, d: 6, h: 2, mi: 30, s: 0 }).ms).toISOString())
            .toBe('2025-04-05T15:30:00.000Z');
    });
});

describe('createDayClock', () => {
    it('turns seconds-of-day into instants across a midnight and a DST change', () => {
        const clock = createDayClock({ y: 2025, mon: 3, d: 5 }, SYD);
        const hhmm = (h, mi = 0) => h * 3600 + mi * 60;

        expect(new Date(clock.at(hhmm(22))).toISOString()).toBe('2025-04-05T11:00:00.000Z');
        expect(new Date(clock.at(hhmm(1))).toISOString()).toBe('2025-04-05T14:00:00.000Z');   // next day
        expect(new Date(clock.at(hhmm(2, 30))).toISOString()).toBe('2025-04-05T15:30:00.000Z');
        expect(new Date(clock.at(hhmm(2)))).toEqual(new Date('2025-04-05T16:00:00.000Z'));     // clock went back
        expect(new Date(clock.at(hhmm(3, 10))).toISOString()).toBe('2025-04-05T17:10:00.000Z');
    });

    it('agrees with a fixed offset for a zone that has no daylight saving', () => {
        const zoned = createDayClock({ y: 2025, mon: 0, d: 4 }, BNE);
        const fixed = createDayClock({ y: 2025, mon: 0, d: 4 }, { offsetMinutes: 600 });
        expect(zoned.at(17 * 3600)).toBe(fixed.at(17 * 3600));
    });
});
