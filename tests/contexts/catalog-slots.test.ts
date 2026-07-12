import { describe, it, expect } from 'vitest';
import { bySlotCaseInsensitive, inferGroupSlot, MAGAZINE_SLOT, deriveItemCapabilities } from '../../src/contexts/CatalogContext';
import type { AttachmentGraph, TypeDetail } from '../../src/contexts/CatalogContext';

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

  const mags = ['Mag_AK_30Rnd', 'Mag_AK_Drum75Rnd'];

  it('resolves a group of magazines to the synthetic magazines slot', () => {
    expect(inferGroupSlot(graph, ['Mag_AK_30Rnd'], mags)).toBe(MAGAZINE_SLOT);
    expect(inferGroupSlot(graph, ['mag_ak_30rnd', 'MAG_AK_DRUM75RND'], mags)).toBe(MAGAZINE_SLOT);
  });

  it('works with magazines even when there is no accepts graph', () => {
    expect(inferGroupSlot(null, ['Mag_AK_30Rnd'], mags)).toBe(MAGAZINE_SLOT);
  });

  it('prefers a real attachment slot over magazines for non-magazine members', () => {
    expect(inferGroupSlot(graph, ['AK_WoodHndgrd', 'AK_RailHndgrd'], mags)).toBe('WeaponHandguardAK');
  });

  it('returns null when members are neither attachments nor magazines', () => {
    expect(inferGroupSlot(graph, ['SomethingElse'], mags)).toBeNull();
  });

  it('ignores magazines when the list is empty or absent', () => {
    expect(inferGroupSlot(graph, ['Mag_AK_30Rnd'], [])).toBeNull();
    expect(inferGroupSlot(graph, ['Mag_AK_30Rnd'])).toBeNull();
  });
});

describe('deriveItemCapabilities', () => {
  // Minimal detail factory: the derivation only reads exposesSlots, cargoSize, isContainer.
  const detail = (over: Partial<TypeDetail>): TypeDetail => ({
    name: 'X', displayName: null, description: null, accepts: null, fitsInto: null,
    exposesSlots: null, occupiesSlots: null, cargoSize: null, magazines: null,
    hitpoints: null, armor: null, ...over,
  });

  it('reports cargo for a positive grid (e.g. a jacket [6,4] / teddy bear [2,3])', () => {
    expect(deriveItemCapabilities(detail({ cargoSize: [2, 3] })).holdsCargo).toBe(true);
    expect(deriveItemCapabilities(detail({ cargoSize: [6, 4] })).holdsCargo).toBe(true);
  });

  it('reports no cargo for a zeroed grid (weapons ship [0,0])', () => {
    expect(deriveItemCapabilities(detail({ cargoSize: [0, 0] })).holdsCargo).toBe(false);
  });

  it('reports no cargo for an empty grid on a non-container (hats/knives ship [])', () => {
    expect(deriveItemCapabilities(detail({ cargoSize: [] })).holdsCargo).toBe(false);
  });

  it('reports cargo for a Container_Base descendant even with an empty grid (SeaChest/Barrel)', () => {
    expect(deriveItemCapabilities(detail({ cargoSize: [], isContainer: true })).holdsCargo).toBe(true);
  });

  it('still reports cargo when a grid is present regardless of isContainer:false', () => {
    expect(deriveItemCapabilities(detail({ cargoSize: [2, 3], isContainer: false })).holdsCargo).toBe(true);
  });

  it('treats a missing/non-array cargoSize as unknown (null), not a definitive "no cargo"', () => {
    expect(deriveItemCapabilities(detail({ cargoSize: null })).holdsCargo).toBeNull();
    // isContainer:true rescues even the unknown case.
    expect(deriveItemCapabilities(detail({ cargoSize: null, isContainer: true })).holdsCargo).toBe(true);
  });

  it('returns all-null for a missing detail', () => {
    expect(deriveItemCapabilities(undefined)).toEqual({ acceptsAttachments: null, holdsCargo: null });
  });

  it('derives acceptsAttachments from exposesSlots', () => {
    expect(deriveItemCapabilities(detail({ exposesSlots: ['Vest'] })).acceptsAttachments).toBe(true);
    expect(deriveItemCapabilities(detail({ exposesSlots: [] })).acceptsAttachments).toBe(false);
    expect(deriveItemCapabilities(detail({ exposesSlots: null })).acceptsAttachments).toBeNull();
  });
});
