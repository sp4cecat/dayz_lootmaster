import { describe, it, expect } from 'vitest';
import { bySlotCaseInsensitive, inferGroupSlot } from '../../src/contexts/CatalogContext';
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

describe('inferGroupSlot', () => {
  it('returns the slot whose fitting items include the group members', () => {
    expect(inferGroupSlot(graph, ['AK_WoodHndgrd', 'AK_RailHndgrd'])).toBe('WeaponHandguardAK');
    expect(inferGroupSlot(graph, ['AK_Suppressor'])).toBe('weaponMuzzleAK');
  });

  it('matches members case-insensitively', () => {
    expect(inferGroupSlot(graph, ['ak_woodhndgrd', 'AK_RAILHNDGRD'])).toBe('WeaponHandguardAK');
  });

  it('still resolves when some members are unknown/modded items', () => {
    expect(inferGroupSlot(graph, ['AK_WoodHndgrd', 'SomeModdedHndgrd'])).toBe('WeaponHandguardAK');
  });

  it('returns null when no member fits any slot', () => {
    expect(inferGroupSlot(graph, ['Mag_AK_30Rnd', 'BUISOptic'])).toBeNull();
  });

  it('returns null for empty members or a missing graph', () => {
    expect(inferGroupSlot(graph, [])).toBeNull();
    expect(inferGroupSlot(null, ['AK_WoodHndgrd'])).toBeNull();
    expect(inferGroupSlot(undefined, ['AK_WoodHndgrd'])).toBeNull();
    expect(inferGroupSlot({ slots: [], bySlot: {} }, ['AK_WoodHndgrd'])).toBeNull();
  });

  it('breaks a coverage tie toward the more specific slot (fewer fitting items)', () => {
    const overlap: AttachmentGraph = {
      slots: ['WeaponHandguardAK', 'WeaponHandguardAnyRail'],
      bySlot: {
        WeaponHandguardAnyRail: [{ name: 'AK_RailHndgrd' }, { name: 'M4_RISHndgrd' }, { name: 'AUG_Hndgrd' }],
        WeaponHandguardAK: [{ name: 'AK_RailHndgrd' }],
      },
    };
    expect(inferGroupSlot(overlap, ['AK_RailHndgrd'])).toBe('WeaponHandguardAK');
  });
});
