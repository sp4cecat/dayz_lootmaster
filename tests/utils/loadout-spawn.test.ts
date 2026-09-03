import { describe, it, expect } from 'vitest';
import type { LoadoutNode } from '../../src/utils/../types/loadouts';
import { buildSpawnTree, flattenSpawnTree, countSpawnTree } from '../../src/utils/loadoutSpawn';

/** Minimal item node — the tree type demands more fields than any test cares about. */
function item(name: string, extra: Partial<LoadoutNode> = {}): LoadoutNode {
  return {
    id: name, type: 'item', name, chance: 1, attachments: [], cargo: [], ...extra,
  } as LoadoutNode;
}

/**
 * A scripted rng. Every roll is spelled out in the test that uses it, so a
 * failure points at the decision that changed rather than at "randomness".
 * Runs off the end deliberately return 0 (always-take).
 */
const rolls = (...values: number[]) => {
  let i = 0;
  return () => (i < values.length ? values[i++] : 0);
};

describe('buildSpawnTree', () => {
  it('keeps attachment and cargo nesting, unlike the flat player-spawn path', () => {
    const tree = buildSpawnTree([
      item('M4A1', {
        attachments: [item('ACOGOptic'), item('M4_Suppressor')],
        cargo: [item('Mag_STANAG_30Rnd')],
      }),
    ], rolls());

    expect(tree).toEqual([{
      className: 'M4A1',
      quantity: 1,
      attachments: [
        { className: 'ACOGOptic', quantity: 1, attachments: [], cargo: [] },
        { className: 'M4_Suppressor', quantity: 1, attachments: [], cargo: [] },
      ],
      cargo: [{ className: 'Mag_STANAG_30Rnd', quantity: 1, attachments: [], cargo: [] }],
    }]);
  });

  it('drops a node whose chance loses the roll, and keeps one that wins', () => {
    const nodes = [item('Lucky', { chance: 0.5 }), item('Unlucky', { chance: 0.5 })];
    // 0.2 < 0.5 → kept. 0.9 >= 0.5 → dropped.
    const tree = buildSpawnTree(nodes, rolls(0.2, 0.9));
    expect(tree.map(n => n.className)).toEqual(['Lucky']);
  });

  it('takes a chance-1 node without consuming a roll', () => {
    // If chance 1 consumed a roll, the second node would see 0.9 and be dropped.
    const tree = buildSpawnTree([item('Always'), item('Also', { chance: 0.5 })], rolls(0.9));
    expect(tree.map(n => n.className)).toEqual(['Always']);
  });

  it('losing a chance roll removes the whole subtree, not just the node', () => {
    const tree = buildSpawnTree([
      item('Backpack', { chance: 0.5, cargo: [item('Gold'), item('Silver')] }),
    ], rolls(0.9));
    expect(tree).toEqual([]);
  });

  describe('group nodes', () => {
    const group = (members: LoadoutNode[], chance = 1): LoadoutNode => ({
      id: 'g', type: 'group', name: '', chance, attachments: members, cargo: [],
    } as LoadoutNode);

    it('picks exactly one member, never all of them', () => {
      const tree = buildSpawnTree([group([item('A'), item('B'), item('C')])], rolls(0.5));
      expect(tree).toHaveLength(1);
      expect(['A', 'B', 'C']).toContain(tree[0].className);
    });

    it('weights the pick by member chance', () => {
      const members = [item('Rare', { chance: 0.1 }), item('Common', { chance: 0.9 })];
      // Total weight 1.0. A roll of 0.05 lands in Rare's slice, 0.5 in Common's.
      expect(buildSpawnTree([group(members)], rolls(0.05))[0].className).toBe('Rare');
      expect(buildSpawnTree([group(members)], rolls(0.5))[0].className).toBe('Common');
    });

    it('can never pick a zero-chance member', () => {
      const members = [item('Never', { chance: 0 }), item('Always', { chance: 1 })];
      for (const roll of [0, 0.001, 0.5, 0.999]) {
        expect(buildSpawnTree([group(members)], rolls(roll))[0].className).toBe('Always');
      }
    });

    it('yields nothing when every member has zero weight', () => {
      const members = [item('A', { chance: 0 }), item('B', { chance: 0 })];
      expect(buildSpawnTree([group(members)], rolls(0.5))).toEqual([]);
    });

    it('respects the group\'s own chance before picking a member', () => {
      const g = group([item('A')], 0.5);
      expect(buildSpawnTree([g], rolls(0.9))).toEqual([]);
    });
  });

  describe('quantity', () => {
    it('rolls a count within the min/max range', () => {
      const node = item('Ammo', { quantity: { min: 2, max: 4, percent: -1 } });
      // rolls(): chance is 1 so no roll consumed; 0.5 → 2 + floor(0.5 * 3) = 3.
      expect(buildSpawnTree([node], rolls(0.5))[0].quantity).toBe(3);
    });

    it('treats a positive percent as a fill level, not a count', () => {
      const node = item('Canteen', { quantity: { min: 1, max: 1, percent: 65 } });
      const [spawned] = buildSpawnTree([node], rolls());
      expect(spawned).toMatchObject({ quantity: 1, quantityPercent: 65 });
    });

    it('omits quantityPercent for the -1 default and -2 economy sentinels', () => {
      for (const percent of [-1, -2]) {
        const [spawned] = buildSpawnTree([item('X', { quantity: { min: 1, max: 1, percent } })], rolls());
        expect(spawned).not.toHaveProperty('quantityPercent');
      }
    });

    it('never spawns zero of something', () => {
      const node = item('X', { quantity: { min: 0, max: 0, percent: -1 } });
      expect(buildSpawnTree([node], rolls())[0].quantity).toBe(1);
    });
  });

  it('contributes nothing for an unresolved template rather than spawning its id', () => {
    // resolveLoadoutNode turns these into real items; one that survives means the
    // source loadout is gone. Spawning `node.name` would try to create an item
    // classed after a loadout id.
    const template: LoadoutNode = {
      id: 't', type: 'template', templateSource: 'loadout', name: 'some-loadout-uuid',
      chance: 1, attachments: [], cargo: [],
    } as LoadoutNode;
    expect(buildSpawnTree([template], rolls())).toEqual([]);
  });

  it('ignores variants — they are alternates of the parent, not extra items', () => {
    const node = item('M4A1', { variants: [item('M4A1_Black'), item('M4A1_Green')] });
    const tree = buildSpawnTree([node], rolls());
    expect(tree).toHaveLength(1);
    expect(tree[0].className).toBe('M4A1');
  });

  it('tolerates a missing node list', () => {
    expect(buildSpawnTree(undefined)).toEqual([]);
  });
});

describe('flattenSpawnTree', () => {
  // The flat path is what fires when the spacecat spawn action is absent. Deriving
  // it from the same rolled tree is what keeps the two paths spawning the same set.
  const tree = buildSpawnTree([
    item('M4A1', {
      attachments: [item('ACOGOptic')],
      cargo: [item('Mag_STANAG_30Rnd', { quantity: { min: 3, max: 3, percent: -1 } })],
    }),
    item('Rag'),
  ], rolls());

  it('includes nested items, flattened, with their quantities', () => {
    expect(flattenSpawnTree(tree)).toEqual([
      { className: 'M4A1', quantity: 1 },
      { className: 'ACOGOptic', quantity: 1 },
      { className: 'Mag_STANAG_30Rnd', quantity: 3 },
      { className: 'Rag', quantity: 1 },
    ]);
  });

  it('counts every item in the tree for the confirmation message', () => {
    expect(countSpawnTree(tree)).toBe(4);
  });
});
