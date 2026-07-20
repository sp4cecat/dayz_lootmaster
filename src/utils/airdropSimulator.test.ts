import { describe, it, expect } from 'vitest';
import {
  getWeightedRandom,
  missionSelectionOdds,
  containerCandidates,
  containerSelectionOdds,
  rollContainer,
  resolveLootSource,
  rollLoot,
  aggregateLoot,
  type ExpansionLoot,
  type MissionInput,
  type SimSettings,
  type Rng,
} from './airdropSimulator';

/** A deterministic rng that returns the given values in order, repeating the last. */
function seqRng(values: number[]): Rng {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

/** mulberry32 — a tiny seedable PRNG for reproducibility tests. */
function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('getWeightedRandom', () => {
  it('selects the index whose cumulative band the roll lands in', () => {
    // weights [1,1,2], sum 4. rnd = rng()*4.
    expect(getWeightedRandom([1, 1, 2], seqRng([0]))).toBe(0); // rnd 0   -> band 0
    expect(getWeightedRandom([1, 1, 2], seqRng([0.3]))).toBe(1); // rnd 1.2 -> band 1
    expect(getWeightedRandom([1, 1, 2], seqRng([0.9]))).toBe(2); // rnd 3.6 -> band 2
  });

  it('returns -1 when every weight is zero', () => {
    expect(getWeightedRandom([0, 0, 0], seqRng([0.5]))).toBe(-1);
  });
});

describe('missionSelectionOdds', () => {
  const mk = (file: string, Weight: number, Enabled = 1): MissionInput => ({
    file,
    data: { MissionName: file, Weight, Enabled },
  });

  it('gives each enabled mission its weight share, summing to 1', () => {
    const { rows, noneWillSpawn } = missionSelectionOdds([mk('a', 10), mk('b', 30), mk('c', 60)]);
    expect(noneWillSpawn).toBe(false);
    expect(rows.map((r) => r.prob)).toEqual([0.1, 0.3, 0.6]);
    expect(rows.reduce((s, r) => s + r.prob, 0)).toBeCloseTo(1, 10);
  });

  it('excludes disabled and corrupt missions from the denominator', () => {
    const rows = missionSelectionOdds([
      mk('a', 50),
      mk('b', 50, 0), // disabled
      { file: 'c', corrupt: true, data: { Weight: 100 } },
    ]).rows;
    const a = rows.find((r) => r.file === 'a')!;
    const b = rows.find((r) => r.file === 'b')!;
    const c = rows.find((r) => r.file === 'c')!;
    expect(a.prob).toBe(1); // only enabled, non-corrupt mission
    expect(b.prob).toBe(0);
    expect(b.enabled).toBe(false);
    expect(c.prob).toBe(0);
    expect(c.enabled).toBe(false);
  });

  it('flags noneWillSpawn when all enabled weights are zero', () => {
    expect(missionSelectionOdds([mk('a', 0), mk('b', 0)]).noneWillSpawn).toBe(true);
  });
});

describe('container selection', () => {
  const settings: SimSettings = {
    ItemCount: 50,
    Containers: [
      { Container: 'Regular', Usage: 0, Weight: 5, ItemCount: 30, Loot: [] },
      { Container: 'Medical', Usage: 0, Weight: 10, ItemCount: 25, Loot: [] },
      { Container: 'Basebuilding', Usage: 1, Weight: 15, ItemCount: 50, Loot: [] },
      { Container: 'Military', Usage: 0, Weight: 20, ItemCount: 50, Loot: [] },
      { Container: 'PlayerOnly', Usage: 2, Weight: 99, ItemCount: 50, Loot: [] },
    ],
  };

  it('"Random" matches every Usage 0/1 container and excludes Usage 2', () => {
    const cands = containerCandidates({ Container: 'Random' }, settings);
    expect(cands.map((c) => c.Container)).toEqual(['Regular', 'Medical', 'Basebuilding', 'Military']);
  });

  it('a named container matches only itself', () => {
    const cands = containerCandidates({ Container: 'Medical' }, settings);
    expect(cands.map((c) => c.Container)).toEqual(['Medical']);
  });

  it('computes the exact adjusted-weight probabilities for the default crates', () => {
    // mission Weight 54, weights [5,10,15,20]: maxW 20, sumW 50, weight (54+50-20)/4 = 21.
    // weight-maxW = 1 >= 0 -> cweights [6,11,16,21], sum 54.
    const cands = containerCandidates({ Container: 'Random', Weight: 54 }, settings);
    const odds = containerSelectionOdds({ Container: 'Random', Weight: 54 }, cands);
    expect(odds.map((o) => o.cweight)).toEqual([6, 11, 16, 21]);
    expect(odds.map((o) => o.prob)).toEqual([6 / 54, 11 / 54, 16 / 54, 21 / 54]);
    expect(odds.reduce((s, o) => s + o.prob, 0)).toBeCloseTo(1, 10);
    // Military (highest container weight) is the most likely pick.
    expect(odds[3].prob).toBeGreaterThan(odds[0].prob);
  });

  it('rollContainer honours the weighted bands', () => {
    const cands = containerCandidates({ Container: 'Random', Weight: 54 }, settings);
    // cweights [6,11,16,21] sum 54. rng 0 -> first band (Regular).
    expect(rollContainer({ Container: 'Random', Weight: 54 }, cands, seqRng([0]))!.Container).toBe('Regular');
    // rng 0.99 -> last band (Military).
    expect(rollContainer({ Container: 'Random', Weight: 54 }, cands, seqRng([0.99]))!.Container).toBe('Military');
  });

  it('returns null when there are no candidates', () => {
    expect(rollContainer({ Container: 'Nope' }, [], seqRng([0.5]))).toBeNull();
  });
});

describe('resolveLootSource', () => {
  const settings: SimSettings = { ItemCount: 50, Containers: [] };
  const container = { Container: 'C', ItemCount: 25, Loot: [{ Name: 'FromContainer' }] };

  it('uses container loot and container ItemCount when the mission has no loot', () => {
    const r = resolveLootSource({ Container: 'Random', ItemCount: -1 }, container, settings);
    expect(r.loot[0].Name).toBe('FromContainer');
    expect(r.lootFromContainer).toBe(true);
    expect(r.itemCount).toBe(25);
    expect(r.itemCountSource).toBe('container');
  });

  it('prefers the mission ItemCount and mission loot when present', () => {
    const r = resolveLootSource({ Container: 'Random', ItemCount: 7, Loot: [{ Name: 'Own' }] }, container, settings);
    expect(r.loot[0].Name).toBe('Own');
    expect(r.lootFromContainer).toBe(false);
    expect(r.itemCount).toBe(7);
    expect(r.itemCountSource).toBe('mission');
  });

  it('falls back to global settings ItemCount with no container', () => {
    const r = resolveLootSource({ Container: 'Random', ItemCount: -1, Loot: [{ Name: 'Own' }] }, null, settings);
    expect(r.itemCount).toBe(50);
    expect(r.itemCountSource).toBe('settings');
  });

  it('a self-contained unique-loot mission (ItemCount -1) rolls its own loot at the global count', () => {
    // Mirrors "Elite North Islands": own Loot + Infected, ItemCount -1, Container not in
    // settings. The engine skips the container lookup and uses the global ItemCount.
    const mission = { Container: 'ExpansionAirdropContainer_Military_WinterCamo', ItemCount: -1, Loot: [{ Name: 'STAG_RepairKit', Chance: 0.68 }] };
    const r = resolveLootSource(mission, null, { ItemCount: 25, Containers: [] });
    expect(r.loot[0].Name).toBe('STAG_RepairKit');
    expect(r.lootFromContainer).toBe(false);
    expect(r.itemCount).toBe(25);
    expect(r.itemCountSource).toBe('settings');
    expect(rollLoot(r.loot, r.itemCount, () => 0.5)).toHaveLength(25); // non-empty crate
  });
});

describe('rollLoot', () => {
  it('force-spawns Min copies and fills the rest up to itemCount', () => {
    const loot: ExpansionLoot[] = [{ Name: 'Solo', Chance: 1, Min: 2 }];
    const crate = rollLoot(loot, 5, mulberry32(1));
    expect(crate).toHaveLength(5);
    expect(crate.every((i) => i.name === 'Solo')).toBe(true);
  });

  it('drops an entry from the pool once its Max is exhausted', () => {
    const loot: ExpansionLoot[] = [
      { Name: 'Rare', Chance: 1, Min: 1, Max: 1 }, // one guaranteed, then exhausted
      { Name: 'Common', Chance: 1 },
    ];
    const crate = rollLoot(loot, 4, mulberry32(42));
    expect(crate.filter((i) => i.name === 'Rare')).toHaveLength(1);
    expect(crate.filter((i) => i.name === 'Common')).toHaveLength(3);
  });

  it('resolves Variants as a weighted select-one with an implicit parent slot', () => {
    // Single entry, Min 1 -> the only rng call is the variant roll. chances [0.5, 0.5].
    const loot: ExpansionLoot[] = [{ Name: 'Parent', Chance: 1, Min: 1, Variants: [{ Name: 'Variant', Chance: 0.5 }] }];
    expect(rollLoot(loot, 1, seqRng([0.2]))[0].name).toBe('Variant'); // rnd 0.2 -> variant band
    expect(rollLoot(loot, 1, seqRng([0.8]))[0].name).toBe('Parent'); // rnd 0.8 -> parent band
  });

  it('includes guaranteed attachments and rolls chance-based ones independently', () => {
    const loot: ExpansionLoot[] = [
      {
        Name: 'Weapon',
        Chance: 1,
        Min: 1,
        Attachments: [
          { Name: 'Guaranteed', Chance: 1 },
          { Name: 'Maybe', Chance: 0.5 },
          { Name: 'Unlikely', Chance: 0.5 },
        ],
      },
    ];
    // Guaranteed consumes no rng; Maybe rolls 0.4 (0.5>0.4 -> in); Unlikely rolls 0.6 (0.5>0.6 -> out).
    const crate = rollLoot(loot, 1, seqRng([0.4, 0.6]));
    expect(crate[0].attachments.map((a) => a.name)).toEqual(['Guaranteed', 'Maybe']);
  });

  it('never spawns an attachment\'s own nested attachments (engine passes NULL)', () => {
    const loot: ExpansionLoot[] = [
      { Name: 'Bag', Chance: 1, Min: 1, Attachments: [{ Name: 'Pouch', Chance: 1, Attachments: [{ Name: 'Nested', Chance: 1 }] }] },
    ];
    const crate = rollLoot(loot, 1, mulberry32(3));
    expect(crate[0].attachments[0].name).toBe('Pouch');
    expect(crate[0].attachments[0].attachments).toHaveLength(0);
  });

  it('is reproducible for a fixed seed', () => {
    const loot: ExpansionLoot[] = [
      { Name: 'A', Chance: 3 },
      { Name: 'B', Chance: 1 },
    ];
    const a = rollLoot(loot, 20, mulberry32(123)).map((i) => i.name);
    const b = rollLoot(loot, 20, mulberry32(123)).map((i) => i.name);
    expect(a).toEqual(b);
  });

  it('maps QuantityPercent sentinels to display kinds', () => {
    const crate = rollLoot(
      [
        { Name: 'Def', Chance: 1, Min: 1, QuantityPercent: -1 },
        { Name: 'Eco', Chance: 1, Min: 1, QuantityPercent: -2 },
        { Name: 'Pct', Chance: 1, Min: 1, QuantityPercent: 75 },
      ],
      3,
      mulberry32(9),
    );
    const byName = Object.fromEntries(crate.map((i) => [i.name, i.quantity]));
    expect(byName['Def'].kind).toBe('default');
    expect(byName['Eco'].kind).toBe('economy');
    expect(byName['Pct']).toEqual({ kind: 'percent', percent: 75 });
  });
});

describe('aggregateLoot', () => {
  it('reports higher frequency for higher-Chance items and ~100% for Min>0 items', () => {
    const loot: ExpansionLoot[] = [
      { Name: 'Always', Chance: 0.01, Min: 1 }, // guaranteed via Min
      { Name: 'Heavy', Chance: 10 },
      { Name: 'Light', Chance: 1 },
    ];
    const stats = aggregateLoot(loot, 6, 2000, mulberry32(7));
    const byName = Object.fromEntries(stats.map((s) => [s.name, s]));
    expect(byName['Always'].frequencyPct).toBe(100);
    expect(byName['Heavy'].avgCount).toBeGreaterThan(byName['Light'].avgCount);
  });
});
