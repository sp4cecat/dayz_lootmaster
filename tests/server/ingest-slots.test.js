import { describe, it, expect, beforeEach } from 'vitest';
import { setCatalog, listOccupiableSlots, getItemsForSlot } from '../../server/ingest-store.js';

// The ingest store is a module singleton; reset it before each test so cases don't bleed.
beforeEach(() => {
  setCatalog({
    reset: true,
    items: [
      { name: 'AK_WoodBttstck', displayName: 'AK Wooden Buttstock', inventorySlot: ['weaponButtstockAK'] },
      { name: 'AK_PlasticBttstck', displayName: 'AK Plastic Buttstock', inventorySlot: ['WeaponButtstockAK'] },
      { name: 'AK_Suppressor', displayName: 'AK Suppressor', inventorySlot: ['weaponMuzzleAK'] },
      // A weapon exposes slots (attachments[]) but occupies none — it must not appear in the vocab.
      { name: 'AKM', displayName: 'AKM', attachments: ['weaponButtstockAK', 'weaponMuzzleAK'] },
    ],
  });
});

describe('listOccupiableSlots', () => {
  it('unions items\' inventorySlot[] with counts, keeping first-seen casing', () => {
    expect(listOccupiableSlots()).toEqual([
      { slot: 'weaponButtstockAK', count: 2 },
      { slot: 'weaponMuzzleAK', count: 1 },
    ]);
  });

  it('does not include slots that objects merely expose (attachments[])', () => {
    const slots = listOccupiableSlots().map(s => s.slot.toLowerCase());
    // No slot is contributed by AKM (it exposes, doesn't occupy); both slots come from items.
    expect(slots).toEqual(['weaponbuttstockak', 'weaponmuzzleak']);
  });
});

describe('getItemsForSlot', () => {
  it('returns items that occupy the slot, sorted by label', () => {
    expect(getItemsForSlot('weaponButtstockAK').map(i => i.name))
      .toEqual(['AK_PlasticBttstck', 'AK_WoodBttstck']);
  });

  it('matches case-insensitively (engine slot casing is inconsistent)', () => {
    expect(getItemsForSlot('WEAPONBUTTSTOCKAK').map(i => i.name))
      .toEqual(['AK_PlasticBttstck', 'AK_WoodBttstck']);
  });

  it('returns [] for an unknown or empty slot', () => {
    expect(getItemsForSlot('WeaponOpticAK')).toEqual([]);
    expect(getItemsForSlot('')).toEqual([]);
    expect(getItemsForSlot(undefined)).toEqual([]);
  });
});
