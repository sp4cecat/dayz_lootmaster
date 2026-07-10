import { describe, it, expect } from 'vitest';
import { bySlotCaseInsensitive } from '../../src/contexts/CatalogContext';
import type { AttachmentGraph } from '../../src/contexts/CatalogContext';

const graph: AttachmentGraph = {
  slots: ['WeaponHandguardAK', 'weaponMuzzleAK'],
  bySlot: {
    WeaponHandguardAK: [{ name: 'AK_WoodHndgrd' }, { name: 'AK_RailHndgrd' }],
    weaponMuzzleAK: [{ name: 'AK_Suppressor' }],
  },
};

describe('bySlotCaseInsensitive', () => {
  it('returns the exact-case match directly', () => {
    const refs = bySlotCaseInsensitive(graph, 'WeaponHandguardAK');
    expect(refs?.map(r => r.name)).toEqual(['AK_WoodHndgrd', 'AK_RailHndgrd']);
  });

  it('matches ignoring case (server keys can differ from raw attachments[] casing)', () => {
    expect(bySlotCaseInsensitive(graph, 'weaponhandguardak')?.map(r => r.name))
      .toEqual(['AK_WoodHndgrd', 'AK_RailHndgrd']);
    expect(bySlotCaseInsensitive(graph, 'WEAPONMUZZLEAK')?.map(r => r.name))
      .toEqual(['AK_Suppressor']);
  });

  it('returns null for an unknown slot or missing graph', () => {
    expect(bySlotCaseInsensitive(graph, 'WeaponOpticAK')).toBeNull();
    expect(bySlotCaseInsensitive(null, 'WeaponHandguardAK')).toBeNull();
    expect(bySlotCaseInsensitive(undefined, 'WeaponHandguardAK')).toBeNull();
    expect(bySlotCaseInsensitive({ slots: [], bySlot: {} }, 'x')).toBeNull();
  });
});
