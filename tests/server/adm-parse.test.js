import { describe, it, expect } from 'vitest';
import {
    parseAdmHeader, parseAdmFilenameDate, parseAdmLine, parseAdmFile,
    fieldsToMs, snapOffsetMinutes, detectOffsetMinutes, lastWallSecond,
    parseStashLine,
} from '../../server/adm-parse.js';

/**
 * Every fixture below is copied verbatim from a real DayZ admin log, including
 * the inconsistent spacing around `(id=`. The grammar is undocumented and only
 * discoverable from output, so paraphrased samples would test the wrong thing.
 */
const LIST = '17:56:45 | Player "LoCo" (id=roLHvHBcEudumxXQEox9rgUBaeM2dY_y9qFxHrgo7o0= pos=<10201.3, 12350.3, 563.9>)';
const CONNECT = '17:51:46 | Player "LoCo"(id=roLHvHBcEudumxXQEox9rgUBaeM2dY_y9qFxHrgo7o0=) is connected';
const DISCONNECT = '17:51:44 | Player "SCURVY"(id=Ol2QaiVwNtu_flxGKlepdvIx4zcbfiyuryPKp_xqW4s=) has been disconnected';
const DEATH = '18:42:26 | Player "Rageohol" (DEAD) (id=zUSs9Ynv3iYWlBpfuwfCEUyIAOoUXo0C3DMsEutnoTE= pos=<9880.2, 666.3, 284.0>) died. Stats> Water: 0 Energy: 1115.29 Bleed sources: 0';
const HIT = '18:06:50 | Player "pie eater 32" (id=mHaN2IhgZWUlGEfl6G3OesRSCLBZr6tuiY-V-HFfAJc= pos=<6294.7, 1548.2, 216.8>)[HP: 5.95662] hit by Player "Peachman5" (id=dxNkGeV7h4_1Fz_H-yCa4Qs7JOuIpxiIr1VZuVC8M6I= pos=<6297.4, 1529.5, 216.7>) into LeftArm(18) for 102.351 damage (Bullet_762x39) with IZH-18 from 18.8819 meters';
const UNCONSCIOUS = '18:09:49 | Player "Honkey Kong" (id=mOPYgcSG6fvSuvhUimj6pfTcShuGjE15J2V2odEH2lQ= pos=<11913, 6281.4, 260.6>) is unconscious';
const UNKNOWN = '17:51:44 | Player "ecksdeechree"(id=Unknown) has been disconnected';
const BANNER = '17:56:45 | ##### PlayerList log: 21 players';

describe('parseAdmHeader', () => {
    it('reads the only date the file contains', () => {
        expect(parseAdmHeader('AdminLog started on 2025-01-04 at 17:50:50'))
            .toEqual({ y: 2025, mon: 0, d: 4, h: 17, mi: 50, s: 50 });
    });

    it('returns null when there is no header', () => {
        expect(parseAdmHeader('***** EOF *****')).toBeNull();
    });
});

describe('parseAdmFilenameDate', () => {
    it('recovers the date from a rotated filename', () => {
        expect(parseAdmFilenameDate('C:/logs/DayZServer_x64_2025_01_04_175050457.ADM'))
            .toEqual({ y: 2025, mon: 0, d: 4, h: 17, mi: 50, s: 50 });
    });

    it('is not fooled by digits in the server name', () => {
        // "x64" precedes the date and must not be read as part of it.
        expect(parseAdmFilenameDate('DayZServer_x64_2025_01_04_175050457.ADM').y).toBe(2025);
    });

    it('returns null for an undated filename', () => {
        expect(parseAdmFilenameDate('DayZServer_x64.ADM')).toBeNull();
    });
});

describe('parseAdmLine', () => {
    it('reads a player-list entry as easting, northing, elevation', () => {
        // DayZ writes pos=<x, z, y>. Getting this order wrong silently mirrors
        // every track about the map diagonal, which looks plausible on screen.
        const [o] = parseAdmLine(LIST);
        expect(o.x).toBe(10201.3);
        expect(o.z).toBe(12350.3);
        expect(o.y).toBe(563.9);
        expect(o.name).toBe('LoCo');
        expect(o.kind).toBe('list');
    });

    it('handles the missing space before (id= on connect lines', () => {
        const [o] = parseAdmLine(CONNECT);
        expect(o.kind).toBe('connect');
        expect(o.x).toBeNull();
    });

    it('classifies a disconnect', () => {
        expect(parseAdmLine(DISCONNECT)[0].kind).toBe('disconnect');
    });

    it('takes water and energy off a death line', () => {
        const [o] = parseAdmLine(DEATH);
        expect(o.kind).toBe('death');
        expect(o.alive).toBe(false);
        expect(o.water).toBe(0);
        expect(o.energy).toBe(1115.29);
    });

    it('takes health off a hit line and keeps the two players apart', () => {
        // The attacker's position appears on the same line. Attributing it to the
        // victim would teleport them across the map for one sample.
        const obs = parseAdmLine(HIT);
        expect(obs).toHaveLength(2);
        expect(obs[0].name).toBe('pie eater 32');
        expect(obs[0].health).toBeCloseTo(5.95662);
        expect(obs[0].x).toBe(6294.7);
        expect(obs[1].name).toBe('Peachman5');
        expect(obs[1].x).toBe(6297.4);
        expect(obs[1].kind).toBe('witness');
    });

    it('records an unconscious player as a normal sample', () => {
        expect(parseAdmLine(UNCONSCIOUS)[0].kind).toBe('unconscious');
    });

    it('drops the Unknown id rather than inventing a player', () => {
        // ADM writes id=Unknown for sessions it could not resolve, usually the mass
        // disconnect at shutdown. Importing them would create a phantom player.
        expect(parseAdmLine(UNKNOWN)).toEqual([]);
    });

    it('ignores non-player lines', () => {
        expect(parseAdmLine(BANNER)).toEqual([]);
        expect(parseAdmLine('')).toEqual([]);
        expect(parseAdmLine('***** EOF *****')).toEqual([]);
    });
});

describe('parseAdmFile', () => {
    it('rolls the day over when the clock goes backwards', () => {
        const text = [
            '23:59:50 | Player "A" (id=G1 pos=<1, 2, 3>)',
            '00:00:10 | Player "A" (id=G1 pos=<4, 5, 6>)',
        ].join('\n');
        const [a, b] = parseAdmFile(text);
        expect(b.offsetSec - a.offsetSec).toBe(20);
    });

    it('does not roll over when daylight saving replays an hour', () => {
        // A server in Australia/Sydney writes 02:00-02:59 twice each April. Reading
        // the repeat as midnight would move the rest of the file a day forward.
        const text = [
            '02:59:00 | Player "A" (id=G1 pos=<1, 2, 3>)',
            '02:00:00 | Player "A" (id=G1 pos=<4, 5, 6>)',
        ].join('\n');
        const [a, b] = parseAdmFile(text);
        expect(a.dayOffset).toBe(0);
        expect(b.dayOffset).toBe(0);
    });

    it('tags every observation with the day of the file it falls on', () => {
        // The day is all the parser can say; the instant needs a zone, which it
        // deliberately knows nothing about.
        const text = [
            '23:59:50 | Player "A" (id=G1 pos=<1, 2, 3>)',
            '00:00:10 | Player "A" (id=G1 pos=<4, 5, 6>)',
        ].join('\n');
        expect(parseAdmFile(text).map(o => o.dayOffset)).toEqual([0, 1]);
    });

    it('does not roll over on same-second reordering', () => {
        // Two lines written in the same second can land out of order; treating that
        // as midnight would shift the rest of the file a full day.
        const text = [
            '12:00:05 | Player "A" (id=G1 pos=<1, 2, 3>)',
            '12:00:04 | Player "A" (id=G1 pos=<4, 5, 6>)',
        ].join('\n');
        const [a, b] = parseAdmFile(text);
        expect(b.offsetSec).toBeLessThan(a.offsetSec + 60);
    });
});

describe('fieldsToMs', () => {
    it('treats the wall clock as local to the given offset', () => {
        const f = { y: 2025, mon: 0, d: 4, h: 17, mi: 50, s: 50 };
        // 17:50:50 at UTC+11 is 06:50:50Z.
        expect(new Date(fieldsToMs(f, 660)).toISOString()).toBe('2025-01-04T06:50:50.000Z');
    });
});

describe('snapOffsetMinutes', () => {
    it('snaps to the nearest quarter hour', () => {
        expect(snapOffsetMinutes(660 * 60_000 + 4_000)).toBe(660);
        expect(snapOffsetMinutes(569 * 60_000)).toBe(570);   // +9:29 -> +9:30
        expect(snapOffsetMinutes(-330 * 60_000)).toBe(-330); // -5:30 is a real zone
    });
});

describe('detectOffsetMinutes', () => {
    const header = { y: 2025, mon: 0, d: 4, h: 17, mi: 50, s: 50 };

    it('derives the offset from mtime and the last line', () => {
        // Last line 20:48:45 local; if that instant is 09:48:45Z the zone is +11.
        const lastWallSec = 20 * 3600 + 48 * 60 + 45;
        const mtimeMs = Date.parse('2025-01-04T09:48:45Z');
        expect(detectOffsetMinutes({ header, lastWallSec, mtimeMs }))
            .toMatchObject({ offsetMinutes: 660, source: 'mtime' });
    });

    it('searches the day count so a log that crosses midnight still resolves', () => {
        const lastWallSec = 2 * 3600;                          // 02:00 the NEXT day
        const mtimeMs = Date.parse('2025-01-04T15:00:00Z');    // 02:00 on the 5th at +11
        expect(detectOffsetMinutes({ header, lastWallSec, mtimeMs }))
            .toMatchObject({ offsetMinutes: 660 });
    });

    it('falls back to a unix-named log folder', () => {
        const numericDirMs = Date.UTC(2025, 0, 4, 6, 50, 50);
        expect(detectOffsetMinutes({ header, numericDirMs }))
            .toMatchObject({ offsetMinutes: 660, source: 'logdir' });
    });

    it('prefers mtime over the folder when both are available', () => {
        const lastWallSec = 17 * 3600 + 50 * 60 + 50;
        expect(detectOffsetMinutes({
            header,
            lastWallSec,
            mtimeMs: Date.parse('2025-01-04T07:50:50Z'),   // implies +10
            numericDirMs: Date.UTC(2025, 0, 4, 6, 50, 50), // implies +11
        })).toMatchObject({ offsetMinutes: 600, source: 'mtime' });
    });

    it('rejects a delta no timezone could produce', () => {
        // A file copied years later has a meaningless mtime; better to report
        // nothing than to import an archive 3 years off.
        expect(detectOffsetMinutes({
            header, lastWallSec: 0, mtimeMs: Date.parse('2030-01-01T00:00:00Z'),
        })).toBeNull();
    });

    it('returns null without a header', () => {
        expect(detectOffsetMinutes({ header: null, mtimeMs: 1 })).toBeNull();
    });
});

describe('lastWallSecond', () => {
    it('finds the final timestamped line in a tail chunk', () => {
        const tail = ['09:00:00 | Player "A" (id=G1)', 'garbage', '21:30:15 | Player "B" (id=G2)'].join('\n');
        expect(lastWallSecond(tail)).toBe(21 * 3600 + 30 * 60 + 15);
    });

    it('returns null when the chunk has no timestamps', () => {
        expect(lastWallSecond('***** EOF *****')).toBeNull();
    });
});

/**
 * Stash lines, copied verbatim from the sample archive. The two positions on one
 * line use different axis orders and the classes differ between burying and
 * digging up, so paraphrasing these would test a grammar that does not exist.
 */
const DUG_IN = '04:32:46 | Player "Ghieunit" (id=z4SMj8kPUKz4l12x_cmJe3oFluOfpEc_rtb2DJ5WvHY= pos=<3084.3, 5333.8, 4.3>)Player SurvivorBase<0x0000020E8646A080> SurvivorM_Peter:43510 Dug in WaterproofBag_Orange<0x00000210C6295370> WaterproofBag_Orange:6455 at position <3084.36,4.30308,5334.39>';
const DUG_OUT = '01:18:45 | Player "grunter" (id=C2R_pzNVPXDIHY4DSVOoTP3adfth8ZaKShogBX_VZ2k= pos=<8285.3, 11917, 187.8>)Player SurvivorBase<0x000002A1D5AB0F20> SurvivorM_Oliver:43994 Dug out UndergroundStash<0x000002A0EC07A4E0> UndergroundStash:26280 at position <8286,187.615,11917.5>';

describe('parseStashLine', () => {
    it('reads the two positions in their different axis orders', () => {
        // The whole report hangs on this. `at position` is <x, y, z> but the
        // player's `pos=` is <x, z, y>; reading one as the other mirrors every
        // stash about the map diagonal and every match silently fails.
        const s = parseStashLine(DUG_IN);
        expect(s).toMatchObject({ x: 3084.36, y: 4.30308, z: 5334.39, px: 3084.3, pz: 5333.8 });
    });

    it('captures the container class when a stash is buried', () => {
        expect(parseStashLine(DUG_IN)).toMatchObject({
            action: 'in',
            cls: 'WaterproofBag_Orange',
            entityId: 'WaterproofBag_Orange:6455',
            guid: 'z4SMj8kPUKz4l12x_cmJe3oFluOfpEc_rtb2DJ5WvHY=',
            name: 'Ghieunit',
            secOfDay: 4 * 3600 + 32 * 60 + 46,
        });
    });

    it('reads a dig-up as a stash, not as the container it will become', () => {
        expect(parseStashLine(DUG_OUT)).toMatchObject({
            action: 'out', cls: 'UndergroundStash', name: 'grunter',
            x: 8286, y: 187.615, z: 11917.5,
        });
    });

    it('accepts the snow-map stash class', () => {
        expect(parseStashLine(DUG_OUT.replace(/UndergroundStash/g, 'UndergroundStashSnow')))
            .toMatchObject({ action: 'out', cls: 'UndergroundStashSnow' });
    });

    it('does not join a bury to a dig-up by entity id', () => {
        // Burying turns a container into a stash entity, so both the class and the
        // network id change. Matching has to be positional; this documents why.
        expect(parseStashLine(DUG_IN).entityId)
            .not.toBe(parseStashLine(DUG_OUT).entityId);
    });

    it('returns null for every line that is not a dig', () => {
        for (const line of [LIST, CONNECT, DISCONNECT, DEATH, HIT, UNCONSCIOUS, BANNER, '']) {
            expect(parseStashLine(line)).toBeNull();
        }
    });

    it('rejects an unresolved identity', () => {
        expect(parseStashLine(DUG_IN.replace(/id=[^\s]+ /, 'id=Unknown '))).toBeNull();
    });
});

describe('parseAdmLine on a stash line', () => {
    it('still yields exactly one position observation', () => {
        // A Dug line carries the player's own position and the importer already
        // stores it. Adding stash parsing must not change that, and must not let
        // the `Player SurvivorBase<0x...>` fragment fabricate a second observation.
        const obs = parseAdmLine(DUG_IN);
        expect(obs).toHaveLength(1);
        expect(obs[0]).toMatchObject({ kind: 'list', x: 3084.3, z: 5333.8, y: 4.3 });
    });
});
