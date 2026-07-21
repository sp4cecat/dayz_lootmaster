import { describe, it, expect } from 'vitest';
import { loadoutToVanillaXml } from '../../src/utils/loadouts';
import { Loadout } from '../../src/types/loadouts';

describe('loadoutToVanillaXml preset chance handling', () => {
  const loadout: Loadout = {
    id: 'l1',
    label: 'Test',
    updatedAt: 0,
    items: [
      {
        id: 'root1',
        type: 'item',
        name: 'Rifle_A',
        chance: 1.0,
        attachments: [
          // Section-level preset reference.
          { id: 'a1', type: 'template', templateSource: 'preset', name: 'glassesVillage', chance: 1.0, attachments: [], cargo: [] },
        ],
        cargo: [
          // Inline group with an item-level preset ref alongside a plain item.
          {
            id: 'g1', type: 'group', name: '', chance: 0.35,
            attachments: [
              { id: 'i1', type: 'template', templateSource: 'preset', name: 'foodCity', chance: 0.5, attachments: [], cargo: [] },
              { id: 'i2', type: 'item', name: 'Apple', chance: 0.5, attachments: [], cargo: [] },
            ],
            cargo: [],
          },
        ],
      },
    ],
  };

  it('omits chance on section- and item-level preset references, keeps it elsewhere', () => {
    const out = loadoutToVanillaXml(loadout, [], [], null);

    // Preset references carry no chance — it lives on the cfgrandompresets entry.
    expect(out).toContain('<attachments preset="glassesVillage" />');
    expect(out).not.toMatch(/preset="glassesVillage"\s+chance/);
    expect(out).toContain('<item preset="foodCity"/>');
    expect(out).not.toMatch(/preset="foodCity"\s+chance/);

    // Inline group and plain items keep their chance.
    expect(out).toContain('<cargo chance="0.35">');
    expect(out).toContain('<item name="Apple" chance="0.50"/>');
  });
});
