import { describe, it, expect } from 'vitest';
import {
  actorTypeLabel, describeCombat, humaniseZone, parseKv, parseVictim,
} from '../../src/utils/actionDetail';

describe('parseKv', () => {
  it('reads a complete key=value list, keeping empty values as empty strings', () => {
    // The mod writes `zone=;` rather than dropping the key so the key set is
    // stable; an empty string is the honest reading, not a missing key.
    expect(parseKv('victim=infected;zone=;dmg=5;with=')).toEqual({
      victim: 'infected', zone: '', dmg: '5', with: '',
    });
  });

  it('tolerates a trailing separator and whitespace', () => {
    expect(parseKv('a=1; b=2 ;')).toEqual({ a: '1', b: '2' });
  });

  it('splits on the first = only, so a value may contain one', () => {
    expect(parseKv('at=1,2,3;with=x=y')).toEqual({ at: '1,2,3', with: 'x=y' });
  });

  it('refuses free text, so a caller falls back to showing it verbatim', () => {
    // Half-parsing `killer=abc;something` into a confident sentence with a piece
    // missing is worse than the raw text.
    expect(parseKv('garbage')).toBeNull();
    expect(parseKv('killer=1;not a pair')).toBeNull();
    expect(parseKv('=novalue')).toBeNull();
  });

  it('is null for nothing at all', () => {
    expect(parseKv(null)).toBeNull();
    expect(parseKv('')).toBeNull();
    expect(parseKv(';')).toBeNull();
  });
});

describe('parseVictim', () => {
  it('separates the type from a player id', () => {
    expect(parseVictim({ victim: 'player:76561198000000002' })).toEqual({ type: 'player', pid: '76561198000000002' });
  });

  it('has no id for creatures and bots', () => {
    expect(parseVictim({ victim: 'infected' })).toEqual({ type: 'infected', pid: null });
    expect(parseVictim({ victim: 'ai:' })).toEqual({ type: 'ai', pid: null });
  });

  it('is null without a victim key', () => {
    expect(parseVictim({ by: 'fall' })).toBeNull();
    expect(parseVictim({ victim: '' })).toBeNull();
  });
});

describe('humaniseZone', () => {
  it('splits CamelCase and sentence-cases it', () => {
    expect(humaniseZone('LeftArm')).toBe('Left arm');
    expect(humaniseZone('RightLeg')).toBe('Right leg');
    expect(humaniseZone('Head')).toBe('Head');
    expect(humaniseZone('')).toBe('');
  });
});

describe('actorTypeLabel', () => {
  it('capitalises the one initialism and leaves the words alone', () => {
    expect(actorTypeLabel('ai')).toBe('AI');
    expect(actorTypeLabel('infected')).toBe('infected');
  });
});

describe('describeCombat', () => {
  it('reads a hit on a creature with zone, damage, weapon and range', () => {
    const kv = parseKv('victim=infected;zone=Head;dmg=102.4;ammo=Bullet_556x45;with=M4A1;dist=18.9;at=1,2,3')!;
    expect(describeCombat('hit', kv)).toBe('Hit infected · Head · 102 dmg · M4A1 · 19 m');
  });

  it('names the player on a kill', () => {
    const kv = parseKv('victim=player:76561198000000002;zone=Torso;dmg=80;ammo=Bullet_762x39;with=AKM;dist=40.2;at=1,2,3')!;
    expect(describeCombat('kill', kv)).toBe('Killed player 76561198000000002 · Torso · 80 dmg · AKM · 40 m');
    expect(describeCombat('kill', kv)!.startsWith('Killed player 76561198000000002')).toBe(true);
  });

  it('says "fists" when nothing was in hand and the ammo is a punch', () => {
    // A hit with no weapon part reads as "weapon unknown"; a punch is a known thing.
    const kv = parseKv('victim=infected;zone=Head;dmg=6;ammo=MeleeFist;with=;dist=1.1;at=1,2,3')!;
    expect(describeCombat('hit', kv)).toBe('Hit infected · Head · 6 dmg · fists · 1 m');
    const heavy = parseKv('victim=infected;zone=Head;dmg=9;ammo=MeleeFist_Heavy;with=;dist=1;at=1,2,3')!;
    expect(describeCombat('hit', heavy)).toContain('fists');
  });

  it('does not call an infected bite "fists"', () => {
    const kv = parseKv('by=infected;zone=Torso;dmg=5;ammo=MeleeInfected;with=')!;
    expect(describeCombat('damaged', kv)).toBe('By infected · Torso · 5 dmg');
  });

  it('gives a fall its article and drops the empty zone', () => {
    const kv = parseKv('by=fall;zone=;dmg=12.3;ammo=FallDamageHealth;with=')!;
    expect(describeCombat('damaged', kv)).toBe('By a fall · 12 dmg');
  });

  it('names the bot on an AI attack', () => {
    const kv = parseKv('by=ai;zone=Torso;dmg=20;ammo=Bullet_556x45;with=AUG A1;src=Mirek')!;
    expect(describeCombat('damaged', kv)).toBe('By AI Mirek · Torso · 20 dmg · AUG A1');
  });

  it('humanises the zone', () => {
    const kv = parseKv('victim=player:1;zone=LeftArm;dmg=30;ammo=Bullet_9x19;with=CZ75;dist=5;at=1,2,3')!;
    expect(describeCombat('hit', kv)).toContain('· Left arm ·');
  });

  it('labels every source in the by= vocabulary', () => {
    const line = (by: string) => describeCombat('damaged', { by, zone: '', dmg: '1', ammo: '', with: '' });
    expect(line('fire')).toBe('By fire · 1 dmg');
    expect(line('vehicle')).toBe('By a vehicle · 1 dmg');
    expect(line('explosion')).toBe('By an explosion · 1 dmg');
    expect(line('area')).toBe('By area damage · 1 dmg');
    expect(line('animal')).toBe('By animal · 1 dmg');
    expect(line('other')).toBe('By other · 1 dmg');
  });

  it('marks a lethal damaged row', () => {
    const kv = parseKv('by=fall;zone=;dmg=140;ammo=FallDamageHealth;with=;lethal=1')!;
    expect(describeCombat('damaged', kv)).toBe('By a fall · 140 dmg · lethal');
  });

  it('is null when the key set has no subject, or the kind is not combat', () => {
    expect(describeCombat('hit', { zone: 'Head' })).toBeNull();
    expect(describeCombat('damaged', { zone: 'Head' })).toBeNull();
    expect(describeCombat('pickup', { victim: 'infected' })).toBeNull();
  });
});
