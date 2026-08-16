import { describe, it, expect } from 'vitest';
import { vanillaSpawnableToLoadout, loadoutToSpawnableEntry } from '../../src/utils/loadouts';
import { parseSpawnableTypesXml, generateSpawnableTypesXml } from '../../src/utils/xml';

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

  // An absent bound is not zero: DayZ falls back to globals.xml LootDamageMin/Max for it.
  // Collapsing null to 0 would silently pin the item to "always spawns pristine".
  it('keeps an absent bound null rather than collapsing it to 0', () => {
    const entry = { name: 'PartialDamage', sections: [{ kind: 'damage', attrs: { min: '0.1' } }] };
    expect(vanillaSpawnableToLoadout(entry).items[0].damage).toEqual({ min: 0.1, max: null });
  });

  it('maps a bare <damage/> to both bounds null', () => {
    const entry = { name: 'BareDamage', sections: [{ kind: 'damage', attrs: {} }] };
    expect(vanillaSpawnableToLoadout(entry).items[0].damage).toEqual({ min: null, max: null });
  });

  it('maps a non-numeric bound to null, never NaN', () => {
    const entry = { name: 'JunkDamage', sections: [{ kind: 'damage', attrs: { min: 'abc', max: '' } }] };
    expect(vanillaSpawnableToLoadout(entry).items[0].damage).toEqual({ min: null, max: null });
  });
});

// Regression: SpawnableTypesManager stores whatever loadoutToSpawnableEntry returns straight into
// spawnableTypesByGroup (and thence IndexedDB). When that shape omitted the `damage` helper,
// EditFormSpawnableTab read it as "no damage set" and re-seeded min from the globals default.
describe('loadoutToSpawnableEntry entry shape', () => {
  it('emits the same helper fields as a freshly parsed entry', () => {
    const parsed = parseSpawnableTypesXml(
      '<spawnabletypes><type name="X"><damage min="0.1" max="0.8"/>' +
      '<attachments chance="0.5"><item name="A" chance="1.0"/></attachments></type></spawnabletypes>'
    ).types[0];

    const entry = loadoutToSpawnableEntry(vanillaSpawnableToLoadout(parsed));

    expect(entry.damage).toEqual(parsed.damage);
    expect(entry.attachments).toHaveLength(parsed.attachments.length);
    expect(entry.cargo).toHaveLength(parsed.cargo.length);
  });
});

describe('<damage> survives a full parse -> tree -> serialise round-trip', () => {
  const roundTrip = (typeXml: string) => {
    const parsed = parseSpawnableTypesXml(`<spawnabletypes>${typeXml}</spawnabletypes>`).types[0];
    const entry = loadoutToSpawnableEntry(vanillaSpawnableToLoadout(parsed));
    return generateSpawnableTypesXml({ types: [entry] });
  };

  it('preserves both bounds', () => {
    expect(roundTrip('<type name="X"><damage min="0.100" max="0.800"/></type>'))
      .toContain('<damage min="0.100" max="0.800"/>');
  });

  it('does not invent the absent bound', () => {
    const out = roundTrip('<type name="X"><damage min="0.100"/></type>');
    expect(out).toContain('<damage min="0.100"/>');
    expect(out).not.toContain('max=');
  });

  it('keeps a bare <damage/> bare', () => {
    expect(roundTrip('<type name="X"><damage/></type>')).toContain('<damage/>');
  });

  it('normalises loose mod-file formatting to 3 decimals without adding attributes', () => {
    expect(roundTrip('<type name="X"><damage min="0.0" max="0.3" /></type>'))
      .toContain('<damage min="0.000" max="0.300"/>');
  });
});
