import { describe, it, expect } from 'vitest';
import { vanillaSpawnableToLoadout } from '../../src/utils/loadouts';

// Regression: the Damage (Optional) control blanked out after a save/IDB round-trip because
// vanillaSpawnableToLoadout only read the top-level `damage` field, which loadoutToSpawnableEntry
// does not emit (damage lives inside `sections` as a <damage> section). It must fall back to sections.
describe('vanillaSpawnableToLoadout damage', () => {
  it('reads damage from the top-level field (fresh parse shape)', () => {
    const entry = {
      name: 'Jmc_Keycard',
      damage: { min: 0, max: 0.01 },
      sections: [{ kind: 'damage', attrs: { min: '0.000', max: '0.010' } }],
    };
    const node = vanillaSpawnableToLoadout(entry).items[0];
    expect(node.damage).toEqual({ min: 0, max: 0.01 });
  });

  it('recovers damage from the sections array when the top-level field is absent (post-save shape)', () => {
    const entry = {
      name: 'Jmc_Keycard',
      sections: [{ kind: 'damage', attrs: { min: '0.00', max: '0.01' } }],
    };
    const node = vanillaSpawnableToLoadout(entry).items[0];
    expect(node.damage).toEqual({ min: 0, max: 0.01 });
  });

  it('leaves damage undefined when neither source has it', () => {
    const node = vanillaSpawnableToLoadout({ name: 'NoDamageItem', sections: [] }).items[0];
    expect(node.damage).toBeUndefined();
  });
});
