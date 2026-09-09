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

/**
 * Combat tails, every one copied verbatim from the example archive (trailing
 * spaces included — the engine leaves one after `meters`). Each form below was
 * found by grepping 26,929 real hit lines; the grammar is only knowable from
 * output, and several of these (the empty zone, the empty killer, the quoted
 * weapon name) would have been guessed wrong.
 */
const HIT_FIST = '18:38:23 | Player ":otter:" (id=yp1YndwpeREFi61qcZxSjdiEhjNTSdfgCT1mP5aFgxo= pos=<10363.9, 5560.0, 5.5>)[HP: 81.0343] hit by Player "Josss" (id=1-YDlq5L3ZgdMml0NzVq5EKoMMb0VUR5LA-SKxjZ7KU= pos=<10364.8, 5559.4, 5.5>) into RightArm(31) for 8.5 damage (MeleeFist)';
const HIT_MELEE = '00:29:32 | Player "Aussie Gamer" (id=xQCP1yBpxPdNOJtfNr39G23kIoOOkE61FVn3fXFNxGE= pos=<5348.8, 9173.6, 5.1>)[HP: 83.3487] hit by Player "Zoophobia" (id=0GbipreHlksvvpSSsmxk2Jet5oRyqHXHuLl7U5RJxSQ= pos=<5350.4, 9173.6, 5.1>) into Head(0) for 6.05 damage (MeleeSharpLight_4) with Hunting Knife';
const HIT_BLAZE = '19:16:30 | Player "Gum" (id=dkm4VqgLm9dYdWz11AKW85OvhQzOrM08OHlRn0wg4ZU= pos=<13013.6, 1564.6, 24.9>)[HP: 87.1269] hit by Player "cheese" (id=dlF9-LAt83DfBP_EbPXrHYJHEpWziBTGmInXoSGo9mA= pos=<13038.8, 1668.8, 30.9>) into LeftArm(32) for 128.731 damage (Bullet_308WinTracer) with B950 \'Blaze\' from 107.408 meters ';
const HIT_DEAD = '18:58:10 | Player "OreaBR" (DEAD) (id=yUROOl0fD5f9q5BeSl5x7wxJN7f6OyUwcZ1g9_cR-O8= pos=<12922.1, 1594.1, 21.5>)[HP: 0] hit by Player "cheese" (id=dlF9-LAt83DfBP_EbPXrHYJHEpWziBTGmInXoSGo9mA= pos=<12787.6, 1623.1, 39.9>) into Head(0) for 31.2114 damage (Bullet_308Win) with B950 \'Blaze\' from 138.802 meters ';
const HIT_INFECTED = '23:18:24 | Player "Fruit" (id=5uxvqz9Rz9iHyBbqrA7VWlCimG5sAZEKlc8JwEvKaF0= pos=<9921.3, 3646.0, 45.2>)[HP: 97.3225] hit by Infected into Torso(1) for 2.6775 damage (MeleeSoldierInfected)';
const HIT_BEAR = '23:31:20 | Player "Zoophobia" (id=0GbipreHlksvvpSSsmxk2Jet5oRyqHXHuLl7U5RJxSQ= pos=<6570.6, 9144.8, 33.3>)[HP: 75] hit by Brown Bear into Head(0) for 12.5 damage (MeleeBearShock)';
const HIT_AI = '11:40:03 | Player "JERRY 007" (id=sBwUbTNDm1PU76ycBIAWlcuIBd_hWHTydOnPCHDY1_M= pos=<11239, 2792.7, 5.2>)[HP: 59.1085] hit by AI "Elias" (group=2 faction="Mercenaries" pos=<11275, 2875.2, 2.9>) into Head(0) for 20.4457 damage (Bullet_556x45) with AUG A1 from 89.9843 meters ';
const HIT_NOZONE = '12:42:11 | Player "Nuckyyyy" (id=bYKq-ZJUSoCEFs7FNmsB0fI0FpX09gMrlnoo9gN6SGo= pos=<1991.9, 9014.4, 37.8>)[HP: 100] hit by jmc_mjolnir into (-1) for 0 damage (MeleeMjolnir)';
const HIT_FIRE = '01:43:01 | Player "Atlis" (id=3ICqG_9qGc5p29L5fiuXwHWyy1qz_8laM5wAUq1OHY0= pos=<4550.6, 2763.6, 3.8>)[HP: 91.7775] hit by InfectedSoldierHardJMC2 with FireDamage';
const HIT_BOAT = '13:03:05 | Player "debel" (id=xy9xS0-UL2L66wUwf29T3r3sjkUYi7ucDSldwLBjyD8= pos=<1475.3, 11884.8, -0.2>)[HP: 99.3685] hit by Boat_01_Blue with TransportHit';
const HIT_WIRE = '18:02:55 | Player "LeMoNz" (id=I-jfBhSZQooQ4EIG2PKJr81FJbpAki2Vx1Wfl_1yrac= pos=<7056.3, 14176.9, 20.1>)[HP: 99.85] hit by BBP_Bwall with BarbedWireHit';
const HIT_FALL = '23:29:41 | Player "Darknoddy" (id=NwC0YLqzE89DqCECwya6q1R3gMX-SOnOR_loNDAdazg= pos=<7176.4, 11645.3, 399.8>)[HP: 99.9907] hit by FallDamageHealth';
const HIT_EXPLOSION = '20:28:52 | Player "Foxdemic" (DEAD) (id=cC7kfxN3olfNoMBVRtdE6tZJHKEMEW1ZNaTyhmoF3sQ= pos=<9981.9, 6754.7, 37.1>)[HP: 0] hit by explosion (GasCanister_Ammo)';
const KILL_RIFLE = '15:08:36 | Player "Monty" (DEAD) (id=7erZCmX6wD6SUte3jfDyabAjHXiOndra7CkU2ljAS1Q= pos=<5141.7, 3163.2, 74.0>) killed by Player "Maniac" (id=KanCrpyVJmCQXsVUvKMQAPS-0p6eR824Vf-BcGv0_J4= pos=<5136.1, 3163.4, 74.0>) with AUG A1 from 5.55484 meters ';
const KILL_MELEE = '23:50:03 | Player "Halador" (DEAD) (id=kMQah52ywW6rOToNzujuFxEiN5EfglGa38-C4Ysob-w= pos=<5466.2, 895.1, 6.9>) killed by Player "stevo" (id=i3nEYZQaEL4olcc_07gLkDUx7wO-2mxD-bHyOXMcQd8= pos=<5467.1, 894.3, 6.9>) with Brass Knuckles';
const KILL_FIST = '21:37:57 | Player "Kakarot" (DEAD) (id=kFF43EB8kPrV4V3ltRFGVJhRTuPMcvKZY7gjf-lBmik= pos=<6337.6, 1369.5, 4.5>) killed by Player "Ninetails" (id=fWGlL43r1u-sNmqT--Fl4lEYI0FeE3TBztf41NwJJr4= pos=<6336.7, 1370.2, 4.5>) with (MeleeFist)';
const KILL_ZOMBIE = '15:08:26 | Player "Crabe Extra" (DEAD) (id=Kisk_O-f2ohnydIt9zRJnSInr4jQ5tW3uFTr6_FYUjc= pos=<5495.7, 1031.4, 6.5>) killed by ZmbM_usSoldier_Woodland2_Bitterroot';
const KILL_NOBODY = '22:26:55 | Player "Free Weekend" (DEAD) (id=KkqEPHg7b7QHitKcxts1LhB3SIfbep8kvIkReRiqDNs= pos=<8460.8, 2071.2, 25.8>) killed by  with Fireplace';
const KILL_AI = '11:54:41 | Player "JERRY 007" (DEAD) (id=sBwUbTNDm1PU76ycBIAWlcuIBd_hWHTydOnPCHDY1_M= pos=<10966.4, 2546.3, 8.6>) killed by AI "Mirek" (group=6 faction="Mercenaries" pos=<10965.7, 2545.5, 8.7>) with Skull Staff - Basic';
const DROWNED = '15:54:54 | Player "Parky" (DEAD) (id=4WQ_t8B-V94abvs3uKyj1eH7rsByxu30ai0Xmyc7iZs= pos=<9004.8, 2515.3, -9.2>) drowned. Stats> Water: 394.838 Energy: 331.116 Bleed sources: 0';
const BLED_OUT = '11:46:47 | Player "Ninetails" (DEAD) (id=fWGlL43r1u-sNmqT--Fl4lEYI0FeE3TBztf41NwJJr4= pos=<3796.3, 9337.9, 12.5>) bled out';
const SUICIDE = '14:42:27 | Player "Crabe Extra" (id=Kisk_O-f2ohnydIt9zRJnSInr4jQ5tW3uFTr6_FYUjc= pos=<7018.4, 1557.7, 12.6>) committed suicide';
const SUICIDE_DIED = '14:42:27 | Player "Crabe Extra" (DEAD) (id=Kisk_O-f2ohnydIt9zRJnSInr4jQ5tW3uFTr6_FYUjc= pos=<7018.4, 1557.7, 12.6>) died. Stats> Water: 332.534 Energy: 117.48 Bleed sources: 0';
const DROWNED_UNCON = '20:42:35 | Player "Jimbob" (id=UWp2J3H0ytSTNr2YHj7e_L73ZgEd6dyeWnteLhBmgDo= pos=<4086.7, 15396.5, -0.1>) has drowned while unconscious';

const combat = (line) => parseAdmLine(line)[0].combat;

describe('parseAdmLine combat: hits', () => {
    it('reads a rifle hit: attacker, zone, damage, ammo, weapon and range', () => {
        const c = combat(HIT);
        expect(c.event).toBe('hit');
        expect(c.source).toMatchObject({
            type: 'player', name: 'Peachman5', guid: 'dxNkGeV7h4_1Fz_H-yCa4Qs7JOuIpxiIr1VZuVC8M6I=',
            x: 6297.4, z: 1529.5, y: 216.7,
        });
        expect(c).toMatchObject({
            zone: 'LeftArm', component: 18, dmg: 102.351, ammo: 'Bullet_762x39',
            weapon: 'IZH-18', dist: 18.8819, lethal: false,
        });
    });

    it('reads a fist hit with no weapon clause', () => {
        expect(combat(HIT_FIST)).toMatchObject({ ammo: 'MeleeFist', weapon: null, dist: null });
    });

    it('reads a melee weapon, which has a name but no range', () => {
        expect(combat(HIT_MELEE)).toMatchObject({ ammo: 'MeleeSharpLight_4', weapon: 'Hunting Knife', dist: null });
    });

    it('keeps the quotes in a weapon name and survives the trailing space', () => {
        // `B950 'Blaze'` is a real display name. A regex that stopped at the quote
        // or choked on the space the engine leaves after `meters` would lose the
        // weapon on every shot from this rifle.
        expect(combat(HIT_BLAZE)).toMatchObject({ weapon: "B950 'Blaze'", dist: 107.408 });
    });

    it('reads a creature by its display name and flags it as one', () => {
        // Hit lines name creatures as the player sees them; kill lines use the
        // config class. A consumer has to know which it is holding.
        const c = combat(HIT_INFECTED);
        expect(c.source).toMatchObject({ type: 'named', name: 'Infected', display: 'Infected', guid: null });
        expect(c).toMatchObject({ zone: 'Torso', component: 1, dmg: 2.6775, ammo: 'MeleeSoldierInfected' });
    });

    it('does not split a two-word display name', () => {
        expect(combat(HIT_BEAR).source.name).toBe('Brown Bear');
        expect(combat(HIT_BEAR).ammo).toBe('MeleeBearShock');
    });

    it('reads an Expansion AI attacker, who has a name and a position but no id', () => {
        const c = combat(HIT_AI);
        expect(c.source).toMatchObject({ type: 'ai', name: 'Elias', guid: null, x: 11275, z: 2875.2, y: 2.9 });
        expect(c).toMatchObject({ zone: 'Head', dmg: 20.4457, ammo: 'Bullet_556x45', weapon: 'AUG A1', dist: 89.9843 });
        // No GUID, so no second observation: a bot can never become a pid.
        expect(parseAdmLine(HIT_AI)).toHaveLength(1);
    });

    it('accepts an empty zone', () => {
        expect(combat(HIT_NOZONE)).toMatchObject({ zone: '', component: -1, dmg: 0, ammo: 'MeleeMjolnir' });
    });

    it('reads the parent-with-ammo forms for fire, vehicles and wire', () => {
        expect(combat(HIT_FIRE)).toMatchObject({ source: { type: 'named', name: 'InfectedSoldierHardJMC2', display: null }, ammo: 'FireDamage', zone: null, dmg: null });
        expect(combat(HIT_BOAT)).toMatchObject({ source: { name: 'Boat_01_Blue' }, ammo: 'TransportHit' });
        expect(combat(HIT_WIRE)).toMatchObject({ source: { name: 'BBP_Bwall' }, ammo: 'BarbedWireHit' });
    });

    it('reads a bare fall', () => {
        expect(combat(HIT_FALL)).toMatchObject({ source: { type: 'ammo', name: 'FallDamageHealth' }, ammo: 'FallDamageHealth' });
    });

    it('reads an explosion', () => {
        expect(combat(HIT_EXPLOSION)).toMatchObject({ source: { type: 'explosion' }, ammo: 'GasCanister_Ammo', lethal: true });
    });

    it('marks the killing blow lethal from the (DEAD) marker and zero health', () => {
        expect(combat(HIT_DEAD).lethal).toBe(true);
        expect(combat(HIT_BLAZE).lethal).toBe(false);
        const [o] = parseAdmLine(HIT_DEAD);
        expect(o.alive).toBe(false);
        expect(o.health).toBe(0);
    });

    it('keeps the observation and reports no combat for a tail it cannot read', () => {
        // Health and position are already good; guessing an attacker would not be.
        const [o] = parseAdmLine('10:00:00 | Player "A" (id=G1 pos=<1, 2, 3>)[HP: 42] hit by something this parser has never seen');
        expect(o).toMatchObject({ kind: 'hit', health: 42, x: 1, combat: null });
    });

    it('reports no combat on lines that are not about combat', () => {
        for (const line of [LIST, CONNECT, DISCONNECT, UNCONSCIOUS]) {
            expect(parseAdmLine(line)[0].combat).toBeNull();
        }
    });
});

describe('parseAdmLine combat: kills', () => {
    it('reads a rifle kill with weapon and range', () => {
        const [o] = parseAdmLine(KILL_RIFLE);
        expect(o.kind).toBe('death');
        expect(o.combat).toMatchObject({
            event: 'kill', lethal: true, weapon: 'AUG A1', dist: 5.55484, zone: null, dmg: null,
            source: { type: 'player', name: 'Maniac', guid: 'KanCrpyVJmCQXsVUvKMQAPS-0p6eR824Vf-BcGv0_J4=', x: 5136.1 },
        });
    });

    it('reads a melee kill', () => {
        expect(combat(KILL_MELEE)).toMatchObject({ weapon: 'Brass Knuckles', dist: null });
    });

    it('folds `with (MeleeFist)` into the ammo so fists look the same on a hit and a kill', () => {
        // The engine writes the ammo where the weapon goes because bare hands have
        // no item. Left as a weapon called "(MeleeFist)" every fist kill would
        // render differently from every fist hit.
        expect(combat(KILL_FIST)).toMatchObject({ ammo: 'MeleeFist', weapon: null });
    });

    it('reads a creature killer by config class', () => {
        expect(combat(KILL_ZOMBIE)).toMatchObject({
            source: { type: 'named', name: 'ZmbM_usSoldier_Woodland2_Bitterroot', display: null },
            cause: 'ZmbM_usSoldier_Woodland2_Bitterroot',
        });
    });

    it('reads the empty-source form and blames the weapon', () => {
        // `killed by  with Fireplace` — two spaces, nothing between them. The
        // engine had no entity to name, only the thing that did the damage.
        expect(combat(KILL_NOBODY)).toMatchObject({ source: { type: 'none' }, weapon: 'Fireplace', cause: 'Fireplace' });
    });

    it('reads an AI killer', () => {
        expect(combat(KILL_AI)).toMatchObject({ source: { type: 'ai', name: 'Mirek', guid: null }, weapon: 'Skull Staff - Basic' });
    });
});

describe('parseAdmLine combat: deaths with nobody to blame', () => {
    it('reads drowned. as a death with a reason and its stats', () => {
        const [o] = parseAdmLine(DROWNED);
        expect(o).toMatchObject({ kind: 'death', alive: false, water: 394.838, energy: 331.116 });
        expect(o.combat).toMatchObject({ event: 'self', cause: 'drowned' });
    });

    it('reads bled out as a death', () => {
        const [o] = parseAdmLine(BLED_OUT);
        expect(o.kind).toBe('death');
        expect(o.combat).toMatchObject({ event: 'self', cause: 'bleeding' });
    });

    it('gives a plain died. no cause', () => {
        expect(combat(DEATH)).toMatchObject({ event: 'self', cause: null });
    });

    it('does NOT read committed suicide or has drowned while unconscious as deaths', () => {
        // Both are always paired with a `died.` line the same second. Counting them
        // would record every such death twice.
        expect(parseAdmLine(SUICIDE)[0]).toMatchObject({ kind: 'list', combat: null });
        expect(parseAdmLine(DROWNED_UNCON)[0]).toMatchObject({ kind: 'list', combat: null });
        expect(parseAdmLine(SUICIDE_DIED)[0].kind).toBe('death');
    });
});

describe('parseAdmFile', () => {
    it('tags every observation with its 1-based line number', () => {
        // The importer derives an action's sequence number from it; that is the
        // only thing about a hit that is stable across two imports of one file.
        const text = ['garbage', LIST, '', HIT].join('\n');
        const obs = parseAdmFile(text);
        expect(obs.map(o => o.line)).toEqual([2, 4, 4]);
    });

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
