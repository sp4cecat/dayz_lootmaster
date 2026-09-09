import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
    voteOffset, rowsForFile, checkZone, toZone, UNRESOLVED_PREFIX, DEFAULT_OFFSET_MINUTES,
    admDamageSource, admSessionTag, makePidFor,
} from '../../server/adm-import.js';
import { parseAdmFile, parseAdmLine } from '../../server/adm-parse.js';
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

describe('admDamageSource', () => {
    const c = (line) => parseAdmLine(line)[0].combat;
    const hit = (tail) => c(`10:00:00 | Player "A" (id=G1 pos=<1, 2, 3>)[HP: 50] hit by ${tail}`);

    it('classifies by the ammo token before the display name', () => {
        // A mod can call its zombie anything; the ammo it swings with is a config
        // class and does not lie. Verified across 26,929 hit lines.
        expect(admDamageSource(hit('Infected into Torso(1) for 2.6775 damage (MeleeSoldierInfected)'))).toBe('infected');
        expect(admDamageSource(hit('Infected into Head(0) for 10 damage (Dummy_Light)'))).toBe('infected');
        expect(admDamageSource(hit('Brown Bear into Head(0) for 12.5 damage (MeleeBearShock)'))).toBe('animal');
        expect(admDamageSource(hit('Dog into Head(0) for 5.5 damage (MeleeWolf)'))).toBe('animal');
        expect(admDamageSource(hit('FallDamageHealth'))).toBe('fall');
        expect(admDamageSource(hit('Fireplace with FireDamage'))).toBe('fire');
        expect(admDamageSource(hit('Boat_01_Blue with TransportHit'))).toBe('vehicle');
        expect(admDamageSource(hit('BBP_Bwall with BarbedWireHit'))).toBe('area');
        expect(admDamageSource(hit('explosion (GasCanister_Ammo)'))).toBe('explosion');
    });

    it('reads a fire-breathing zombie as fire, because that is what burned them', () => {
        expect(admDamageSource(hit('InfectedSoldierHardJMC2 with FireDamage'))).toBe('fire');
    });

    it('does not read a bear trap as a bear', () => {
        expect(admDamageSource(hit('BearTrap into LeftLeg(3) for 10 damage (BearTrapHit)'))).toBe('area');
    });

    it('names players and AI by source type', () => {
        expect(admDamageSource(hit('Player "B" (id=G2 pos=<4, 5, 6>) into Head(0) for 1 damage (MeleeFist)'))).toBe('player');
        expect(admDamageSource(hit('AI "Elias" (group=2 faction="X" pos=<4, 5, 6>) into Head(0) for 1 damage (Bullet_556x45) with AUG A1 from 9 meters '))).toBe('ai');
    });

    it('falls back to the name for an ammo it has not met', () => {
        expect(admDamageSource(hit('Wolf into Head(0) for 5 damage (SomeModAmmo)'))).toBe('animal');
        expect(admDamageSource(hit('ZmbM_Custom into Head(0) for 5 damage (SomeModAmmo)'))).toBe('infected');
    });

    it('says other when it honestly does not know', () => {
        // Environmental damage names the victim's own survivor class as the parent.
        expect(admDamageSource(hit('SurvivorF_Keiko with EnviroDmg'))).toBe('other');
        expect(admDamageSource(hit('jmc_mjolnir into (-1) for 0 damage (MeleeMjolnir)'))).toBe('other');
        expect(admDamageSource(null)).toBe('other');
    });
});

describe('admSessionTag', () => {
    it('uses the parent folder and the file name, whichever slashes the path had', () => {
        // Rotated names are only unique within one log folder; two crash dirs can
        // each hold a DayZServer_x64_….ADM of the same name.
        expect(admSessionTag('C:\\srv\\log_storage\\1736004650\\DayZServer_x64_2025_01_04_175050457.ADM'))
            .toBe('adm:1736004650/DayZServer_x64_2025_01_04_175050457.ADM');
        expect(admSessionTag('/srv/log_storage/1736004650/x.ADM')).toBe('adm:1736004650/x.ADM');
    });
});

describe('rowsForFile: combat and death rows', () => {
    const header = { y: 2025, mon: 0, d: 4, h: 0, mi: 0, s: 0 };
    const SESSION = 'adm:dir/file.ADM';
    const build = (lines, pidFor) => rowsForFile(parseAdmFile(lines.join('\n')), header, 0, SESSION, pidFor);
    const HIT = '18:06:50 | Player "pie eater 32" (id=mHaN2IhgZWUlGEfl6G3OesRSCLBZr6tuiY-V-HFfAJc= pos=<6294.7, 1548.2, 216.8>)[HP: 5.95662] hit by Player "Peachman5" (id=dxNkGeV7h4_1Fz_H-yCa4Qs7JOuIpxiIr1VZuVC8M6I= pos=<6297.4, 1529.5, 216.7>) into LeftArm(18) for 102.351 damage (Bullet_762x39) with IZH-18 from 18.8819 meters';

    it('turns a PvP hit into the attacker\'s hit row, in the mod\'s contract', () => {
        // Verbatim line. Damage and range to one decimal, `at=` rounded, every key
        // present — the same string the mod would have written for this shot.
        const { actions } = build([HIT]);
        expect(actions).toHaveLength(1);
        const [a] = actions;
        expect(a).toMatchObject({
            kind: 'hit',
            pid: `${UNRESOLVED_PREFIX}dxNkGeV7h4_1Fz_H-yCa4Qs7JOuIpxiIr1VZuVC8M6I=`,
            cls: null,
            x: 6297.4, y: 216.7, z: 1529.5,            // the attacker's position
            session: SESSION,
            n: 1 * 2 + 0,
        });
        expect(a.detail).toBe(
            `victim=player:${UNRESOLVED_PREFIX}mHaN2IhgZWUlGEfl6G3OesRSCLBZr6tuiY-V-HFfAJc=;`
            + 'zone=LeftArm;dmg=102.4;ammo=Bullet_762x39;with=IZH-18;dist=18.9;at=6295,217,1548',
        );
        expect(new Date(a.ts).toISOString()).toBe('2025-01-04T18:06:50.000Z');
    });

    it('writes empty values as empty so the key set is stable', () => {
        const { actions } = build([
            '10:00:00 | Player "A" (id=G1 pos=<1, 2, 3>)[HP: 90] hit by Player "B" (id=G2 pos=<4, 5, 6>) into (-1) for 0 damage (MeleeFist)',
        ]);
        expect(actions[0].detail).toBe(`victim=player:${UNRESOLVED_PREFIX}G1;zone=;dmg=0.0;ammo=MeleeFist;with=;dist=;at=1,3,2`);
    });

    it('emits nothing for the lethal PvP hit, because the kill line that follows is the record', () => {
        const { actions } = build([
            '10:00:00 | Player "A" (DEAD) (id=G1 pos=<1, 2, 3>)[HP: 0] hit by Player "B" (id=G2 pos=<4, 5, 6>) into Head(0) for 90 damage (Bullet_556x45) with AUG A1 from 5 meters ',
            '10:00:00 | Player "A" (DEAD) (id=G1 pos=<1, 2, 3>) killed by Player "B" (id=G2 pos=<4, 5, 6>) with AUG A1 from 5 meters ',
        ]);
        expect(actions.map(a => a.kind)).toEqual(['kill', 'death']);
    });

    it('turns a PvP kill into a kill for the attacker and a death for the victim', () => {
        // Two actors, two rows, matching what the mod emits from EEHitBy and
        // EEKilled. Slots 0 and 1 keep n unique for the one line.
        const { actions } = build([
            'x', 'x',
            '10:00:00 | Player "A" (DEAD) (id=G1 pos=<1, 2, 3>) killed by Player "B" (id=G2 pos=<4, 5, 6>) with (MeleeFist)',
        ]);
        expect(actions).toHaveLength(2);
        expect(actions[0]).toMatchObject({
            kind: 'kill', pid: `${UNRESOLVED_PREFIX}G2`, cls: null, x: 4, y: 6, z: 5, n: 3 * 2 + 0,
            detail: `victim=player:${UNRESOLVED_PREFIX}G1;zone=;dmg=;ammo=MeleeFist;with=;dist=;at=1,3,2`,
        });
        expect(actions[1]).toMatchObject({
            kind: 'death', pid: `${UNRESOLVED_PREFIX}G1`, cls: null, x: 1, y: 3, z: 2, n: 3 * 2 + 1,
            detail: `killer=${UNRESOLVED_PREFIX}G2`,
        });
        expect(actions[0].ts).toBe(actions[1].ts);
    });

    it('turns a non-player hit into the victim\'s damaged row', () => {
        // The existing merge fixture: the same line that carries the victim's
        // health now also records what bit them.
        const { rows, actions } = build([
            '10:00:00 | Player "A" (id=G1 pos=<100, 200, 300>)',
            '10:00:00 | Player "A" (id=G1 pos=<100, 200, 300>)[HP: 42] hit by Infected into Torso(1) for 5 damage (MeleeInfected)',
        ]);
        expect(rows).toHaveLength(1);
        expect(actions).toHaveLength(1);
        expect(actions[0]).toMatchObject({
            kind: 'damaged', pid: `${UNRESOLVED_PREFIX}G1`, cls: 'Infected', x: 100, y: 300, z: 200, n: 2 * 2,
            detail: 'by=infected;zone=Torso;dmg=5.0;ammo=MeleeInfected;with=',
        });
    });

    it('marks a lethal non-player blow and names an AI attacker', () => {
        const { actions } = build([
            '10:00:00 | Player "A" (DEAD) (id=G1 pos=<1, 2, 3>)[HP: 0] hit by AI "Mirek" (group=6 faction="Mercenaries" pos=<4, 5, 6>) into Torso(16) for 6 damage (MeleeSpear) with Skull Staff - Basic',
            '10:00:01 | Player "B" (id=G2 pos=<1, 2, 3>)[HP: 80] hit by FallDamageHealth',
            '10:00:02 | Player "B" (id=G2 pos=<1, 2, 3>)[HP: 70] hit by Fireplace with FireDamage',
        ]);
        expect(actions.map(a => [a.kind, a.cls, a.detail])).toEqual([
            ['damaged', null, 'by=ai;zone=Torso;dmg=6.0;ammo=MeleeSpear;with=Skull Staff - Basic;lethal=1;src=Mirek'],
            ['damaged', 'FallDamageHealth', 'by=fall;zone=;dmg=;ammo=FallDamageHealth;with='],
            ['damaged', 'Fireplace', 'by=fire;zone=;dmg=;ammo=FireDamage;with='],
        ]);
    });

    it('records deaths by creatures, AI and the environment with what to blame', () => {
        const { actions } = build([
            '10:00:00 | Player "A" (DEAD) (id=G1 pos=<1, 2, 3>) killed by ZmbM_usSoldier_Woodland2_Bitterroot',
            '10:00:01 | Player "A" (DEAD) (id=G1 pos=<1, 2, 3>) killed by AI "Mirek" (group=6 faction="Mercenaries" pos=<4, 5, 6>) with Skull Staff - Basic',
            '10:00:02 | Player "A" (DEAD) (id=G1 pos=<1, 2, 3>) killed by  with Fireplace',
            '10:00:03 | Player "A" (DEAD) (id=G1 pos=<1, 2, 3>) drowned. Stats> Water: 1 Energy: 2 Bleed sources: 0',
            '10:00:04 | Player "A" (DEAD) (id=G1 pos=<1, 2, 3>) bled out',
            '10:00:05 | Player "A" (DEAD) (id=G1 pos=<1, 2, 3>) died. Stats> Water: 1 Energy: 2 Bleed sources: 0',
        ]);
        expect(actions.every(a => a.kind === 'death' && a.pid === `${UNRESOLVED_PREFIX}G1`)).toBe(true);
        expect(actions.map(a => a.detail)).toEqual([
            'cause=ZmbM_usSoldier_Woodland2_Bitterroot', 'killer=ai:Mirek', 'cause=Fireplace',
            'cause=drowned', 'cause=bleeding', null,
        ]);
        expect(actions.map(a => a.n)).toEqual([2, 4, 6, 8, 10, 12]);
    });

    it('does not turn a suicide line into a death row', () => {
        // Always paired with a `died.` the same second; two rows would be a lie.
        const { actions } = build([
            '10:00:00 | Player "A" (id=G1 pos=<1, 2, 3>) committed suicide',
            '10:00:00 | Player "A" (DEAD) (id=G1 pos=<1, 2, 3>) died. Stats> Water: 1 Energy: 2 Bleed sources: 0',
        ]);
        expect(actions).toHaveLength(1);
    });

    it('resolves actor, victim and killer through the same ledger', () => {
        // One function for all three, or a hit could name its victim under one id
        // and the victim's own death under another.
        const ledger = new Map([['G1', { steamId: '76561198000000001', name: 'A' }], ['G2', { steamId: '76561198000000002', name: 'B' }]]);
        const { actions } = build([
            '10:00:00 | Player "A" (DEAD) (id=G1 pos=<1, 2, 3>) killed by Player "B" (id=G2 pos=<4, 5, 6>) with Brass Knuckles',
        ], makePidFor(ledger));
        expect(actions[0]).toMatchObject({ pid: '76561198000000002', detail: 'victim=player:76561198000000001;zone=;dmg=;ammo=;with=Brass Knuckles;dist=;at=1,3,2' });
        expect(actions[1]).toMatchObject({ pid: '76561198000000001', detail: 'killer=76561198000000002' });
    });

    it('leaves session and n null when no session tag is given', () => {
        const { actions } = rowsForFile(parseAdmFile('10:00:00 | Player "A" (DEAD) (id=G1 pos=<1, 2, 3>) bled out'), header, 0);
        expect(actions[0]).toMatchObject({ session: null, kind: 'death' });
    });

    it('reports the span of instants the file covers', () => {
        const { span } = build([
            '10:00:00 | Player "A" (id=G1 pos=<1, 2, 3>)',
            '10:05:00 | Player "A" (DEAD) (id=G1 pos=<1, 2, 3>) bled out',
        ]);
        expect(span.to - span.from).toBe(5 * 60_000);
    });
});

describe('rowsForFile in a zone that observes daylight saving', () => {
    const SYD = 'Australia/Sydney';
    const at = (t, x = 1) => `${t} | Player "A" (id=G1 pos=<${x}, 2, 3>)`;
    const build = (date, lines) => rowsForFile(parseAdmFile(lines.join('\n')), date, SYD);

    it('places a kill inside the repeated hour at the same instant as its position row', () => {
        // Both come off one resolver call per line. A second resolver for the
        // actions would see the 02:00 line first and put the death an hour before
        // the corpse was placed.
        const { rows, actions } = build({ y: 2025, mon: 3, d: 6 }, [
            at('02:30:00', 1),
            '02:00:00 | Player "A" (DEAD) (id=G1 pos=<2, 2, 3>) killed by ZmbM_X',
        ]);
        expect(actions).toHaveLength(1);
        expect(actions[0].ts).toBe(rows[1].ts);
        expect(actions[0].ts).toBeGreaterThan(rows[0].ts);
    });

    it('reads the same wall clock as a different instant either side of the change', () => {
        // The live server is Australia/Sydney: +11:00 in January, +10:00 in July.
        // A fixed offset is silently an hour out for half of every archive.
        const jan = build({ y: 2025, mon: 0, d: 4 }, [at('17:50:50')]);
        const jul = build({ y: 2025, mon: 6, d: 4 }, [at('17:50:50')]);
        expect(new Date(jan.rows[0].ts).toISOString()).toBe('2025-01-04T06:50:50.000Z');
        expect(new Date(jul.rows[0].ts).toISOString()).toBe('2025-07-04T07:50:50.000Z');
    });

    it('keeps a track moving forwards through the hour the clock repeats', () => {
        // 2025-04-06: 03:00 AEDT becomes 02:00 AEST. The log replays 02:00-02:59,
        // and reading the second pass as the first sends the player back in time.
        const { rows, ambiguous } = build({ y: 2025, mon: 3, d: 6 }, [
            at('01:59:00', 1), at('02:30:00', 2), at('02:00:00', 3), at('02:40:00', 4), at('03:10:00', 5),
        ]);
        expect(rows.map(r => r.x)).toEqual([1, 2, 3, 4, 5]);
        for (let i = 1; i < rows.length; i++) expect(rows[i].ts).toBeGreaterThan(rows[i - 1].ts);
        // Three readings fell inside the repeated hour and could not have been
        // placed by the wall clock alone.
        expect(ambiguous).toBe(3);
    });

    it('does not read the repeated hour as a new day', () => {
        const { rows } = build({ y: 2025, mon: 3, d: 6 }, [at('02:30:00', 1), at('02:00:00', 2)]);
        expect(rows[1].ts - rows[0].ts).toBe(30 * 60_000);
    });
});

describe('checkZone', () => {
    const SYD = 'Australia/Sydney';
    const file = (mon, d, detectedOffset) => ({
        header: { y: 2025, mon, d, h: 12, mi: 0, s: 0 },
        confident: detectedOffset !== undefined,
        detected: detectedOffset === undefined ? null : { offsetMinutes: detectedOffset, source: 'mtime' },
    });

    it('confirms a zone the files own timestamps agree with', () => {
        const r = checkZone([file(0, 4, 660), file(0, 5, 660)], SYD);
        expect(r).toMatchObject({ timeZone: SYD, agree: 2, conflict: 0 });
        expect(r.offsets).toEqual([{ minutes: 660, files: 2, label: 'AEDT' }]);
    });

    it('reports a zone the files contradict, and what they said instead', () => {
        // Australia/Brisbane never leaves +10:00, so a January archive written at
        // +11:00 is evidence the wrong state was picked.
        const r = checkZone([file(0, 4, 660), file(0, 5, 660)], 'Australia/Brisbane');
        expect(r).toMatchObject({ agree: 0, conflict: 2, conflictOffset: 660 });
    });

    it('shows both offsets when the archive straddles a change', () => {
        const r = checkZone([file(2, 1), file(4, 1)], SYD);
        expect(r.offsets.map(o => o.label)).toEqual(['AEST', 'AEDT']);
    });

    it('ignores the loose folder signal as evidence', () => {
        const loose = { ...file(0, 4, 480), detected: { offsetMinutes: 480, source: 'logdir' } };
        expect(checkZone([loose], SYD)).toMatchObject({ agree: 0, conflict: 0 });
    });

    it('describes a fixed offset without pretending it is a zone', () => {
        const r = checkZone([file(0, 4, 600)], toZone({ offsetMinutes: 600 }));
        expect(r).toMatchObject({ timeZone: null, offsetMinutes: 600, agree: 1 });
        expect(r.offsets[0].label).toBe('UTC+10:00');
    });
});

describe('toZone', () => {
    it('takes a zone name, a bare offset, or an offset object', () => {
        expect(toZone('Australia/Sydney')).toBe('Australia/Sydney');
        expect(toZone(660)).toEqual({ offsetMinutes: 660 });
        expect(toZone({ offsetMinutes: 0 })).toEqual({ offsetMinutes: 0 });
    });

    it('reads 0 as UTC rather than falling back to this machine', () => {
        // A silent fallback here would put a whole archive out by however many
        // hours the Lootmaster host happens to sit from the game server.
        expect(toZone(0)).toEqual({ offsetMinutes: 0 });
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

describe('import of combat and death rows into the store', () => {
    beforeEach(() => { history._openForTest(':memory:'); });
    afterEach(() => { history.close(); });

    const T0 = 1_700_000_000_000;
    const action = (over = {}) => ({
        ts: T0, pid: `${UNRESOLVED_PREFIX}G2`, kind: 'hit', cls: null,
        x: 4, y: 6, z: 5, detail: 'victim=player:guid:G1;zone=Head;dmg=1.0;ammo=;with=;dist=;at=1,3,2',
        session: 'adm:dir/file.ADM', n: 2,
        ...over,
    });
    const all = () => history.queryActions({ from: 0, to: T0 + 1000 }).items;

    it('stores rows and reports how many', () => {
        expect(history.recordAdmActions([action(), action({ n: 4, kind: 'death' })])).toBe(2);
        expect(all().map(a => a.kind).sort()).toEqual(['death', 'hit']);
    });

    it('is idempotent, so re-importing an archive doubles nothing', () => {
        // (srv, session, n) is the store's dedup key and n comes off the line
        // number. A re-run of the same file inserts zero rows.
        expect(history.recordAdmActions([action()])).toBe(1);
        expect(history.recordAdmActions([action()])).toBe(0);
        expect(all()).toHaveLength(1);
    });

    it('throws and rolls the whole file back rather than storing half of it', () => {
        // A foreground import the user is watching must fail loudly; and a file
        // that half-landed would re-import as "already present" forever.
        expect(() => history.recordAdmActions([action(), action({ n: 4, pid: {} })])).toThrow();
        expect(all()).toHaveLength(0);
    });

    it('accepts an empty batch', () => {
        expect(history.recordAdmActions([])).toBe(0);
    });

    it('asks per kind group whether the mod was already recording', () => {
        // A mod build that logged deaths but predates combat support has death
        // rows and no hit rows over the same hours; the hits must still backfill.
        history.recordEvents({ session: 'run-a', seq: 1, events: [{ n: 1, age: 0, pid: 'a', kind: 'death', cls: '', pos: [1, 2, 3], detail: '' }] }, T0);
        const window = { from: T0 - 3600_000, to: T0 + 3600_000 };
        expect(history.hasLiveActions({ ...window, kinds: ['death'] })).toBe(true);
        expect(history.hasLiveActions({ ...window, kinds: ['hit', 'kill'] })).toBe(false);
        expect(history.hasLiveActions({ ...window, kinds: ['damaged'] })).toBe(false);
        expect(history.hasLiveActions({ from: T0 + 1, to: T0 + 3600_000, kinds: ['death'] })).toBe(false);
    });

    it('does not count imported rows as the mod having been there', () => {
        history.recordAdmActions([action({ kind: 'death' })]);
        expect(history.hasLiveActions({ from: T0 - 1, to: T0 + 1, kinds: ['death'] })).toBe(false);
    });

    it('exempts imported actions from age-based retention', () => {
        // Same reasoning as imported positions: an archive is almost always older
        // than the drop cutoff, and without this the first hourly prune after an
        // import would delete every kill it had just backfilled.
        const ancient = Date.now() - 400 * 24 * 3600_000;
        history.recordAdmActions([action({ ts: ancient })]);
        history.recordAction({ ts: ancient, pid: 'a', kind: 'pickup' });
        const result = history.prune(Date.now());
        expect(result.actionsDropped).toBe(1);
        const left = history.queryActions({ from: 0, to: Date.now() }).items;
        expect(left.map(a => a.kind)).toEqual(['hit']);
    });
});
