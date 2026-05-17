import { describe, it, expect } from 'vitest';
import {
  formatChance,
  generateRandomPresetsXml,
  generateSpawnableTypesXml,
  parseGlobalsXml,
  parseLimitsXml,
  parseRandomPresetsXml,
  parseSpawnableTypesXml,
  parseTypesXml,
  generateTypesXml,
  ROOT_SPAWNABLE_GROUP,
  findSpawnableEntryForType,
  renameSpawnablePresetReferences,
  validateSpawnableReferences
} from '../../src/utils/xml.js';

describe('xml parsing', () => {
  const limitsXml = `
  <limitsDefinition>
    <categories><category name="food"/><category name="tools"/></categories>
    <usageflags><flag name="Town"/><flag name="Village"/></usageflags>
    <valueflags><flag name="Tier1"/><flag name="Tier2"/></valueflags>
    <tags><tag name="dynamic"/><tag name="static"/></tags>
  </limitsDefinition>`;

  const typesXml = `
  <types>
    <type name="BandageDressing">
      <nominal>30</nominal>
      <min>5</min>
      <lifetime>7200</lifetime>
      <restock>0</restock>
      <quantmin>-1</quantmin>
      <quantmax>-1</quantmax>
      <flags count_in_cargo="1" count_in_hoarder="1" count_in_map="1" count_in_player="1" crafted="0" deloot="0"/>
      <category name="tools"/>
      <usage name="Village"/>
      <value name="Tier1"/>
      <tag name="dynamic"/>
    </type>
  </types>`;

  it('parses limits xml', () => {
    const defs = parseLimitsXml(limitsXml);
    expect(defs.categories).toContain('food');
    expect(defs.usageflags).toContain('Town');
    expect(defs.valueflags).toContain('Tier2');
    expect(defs.tags).toContain('static');
  });

  it('parses types xml and generates xml', () => {
    const types = parseTypesXml(typesXml);
    expect(types).toHaveLength(1);
    expect(types[0].name).toBe('BandageDressing');
    expect(types[0].usage).toContain('Village');
    const out = generateTypesXml(types);
    expect(out).toContain('<types>');
    expect(out).toContain('BandageDressing');
    expect(out).toContain('<usage name="Village"/>');
  });
});

describe('minimal types persistence', () => {
  it('emits only lifetime for minimal type and adds new elements only when edited', () => {
    const minimal = '<types>\n  <type name="SurvivorF_Baty">\n    <lifetime>86400</lifetime>\n  </type>\n</types>';
    const types = parseTypesXml(minimal);
    expect(types).toHaveLength(1);
    const t = types[0];
    // Presence map should reflect only lifetime
    expect(t._present?.lifetime).toBe(true);
    expect(t._present?.nominal).toBeFalsy();
    expect(t._present?.flags).toBeFalsy();

    // Generate without edits: should NOT include nominal/min/restock/quant*/flags
    const out1 = generateTypesXml(types);
    expect(out1).toContain('<lifetime>86400</lifetime>');
    expect(out1).not.toContain('<nominal>');
    expect(out1).not.toContain('<min>');
    expect(out1).not.toContain('<restock>');
    expect(out1).not.toContain('<quantmin>');
    expect(out1).not.toContain('<quantmax>');
    expect(out1).not.toContain('<flags ');

    // Simulate an edit: set nominal and mark edited
    t.nominal = 1;
    t._edited = { ...(t._edited || {}), nominal: true };
    const out2 = generateTypesXml([t]);
    expect(out2).toContain('<nominal>1</nominal>');
  });
});

describe('spawnabletypes utilities', () => {
  const xml = `
<spawnabletypes>
  <type name="Rifle_A">
    <attachments chance="0.5">
      <item name="Optic_A" chance="0.125"/>
    </attachments>
    <cargo preset="MedicalPreset"/>
  </type>
  <type name="Orphan_Item">
    <cargo chance="1"/>
  </type>
</spawnabletypes>`;

  it('parses and generates chance and preset settings', () => {
    const parsed = parseSpawnableTypesXml(xml);
    expect(parsed.types).toHaveLength(2);
    expect(parsed.types[0].sections[0].kind).toBe('attachments');
    expect(parsed.types[0].sections[0].chance).toBe(0.5);
    expect(parsed.types[0].sections[0].items[0].chance).toBe(0.125);
    expect(parsed.types[0].sections[1].preset).toBe('MedicalPreset');

    parsed.types[0].sections[0].chance = 0.3333;
    const out = generateSpawnableTypesXml(parsed);
    expect(out).toContain('<attachments chance="0.333">');
    expect(out).toContain('<cargo preset="MedicalPreset"/>');
  });

  it('parses and generates damage min/max attributes', () => {
    const damageXml = `
<spawnabletypes>
  <type name="jmc_mjolnir_head">
    <damage min="0.3" max="0.7"/>
  </type>
</spawnabletypes>`;
    const parsed = parseSpawnableTypesXml(damageXml);
    expect(parsed.types[0].sections[0].kind).toBe('damage');
    expect(parsed.types[0].sections[0].attrs.min).toBe('0.3');
    expect(parsed.types[0].sections[0].attrs.max).toBe('0.7');
    
    // Check structured accessors
    expect(parsed.types[0].damage?.min).toBe(0.3);
    expect(parsed.types[0].damage?.max).toBe(0.7);

    parsed.types[0].sections[0].attrs.min = '0.4567';
    const out = generateSpawnableTypesXml(parsed);
    expect(out).toContain('<damage min="0.457" max="0.700"/>');
  });

  it('validates orphan entries, missing presets, and missing item type references', () => {
    const warnings = validateSpawnableReferences(
      parseSpawnableTypesXml(xml),
      [{ name: 'Rifle_A' }],
      { presets: [] }
    );
    expect(warnings.map(w => w.kind)).toContain('orphan-spawnable');
    expect(warnings.map(w => w.kind)).toContain('missing-preset');
    expect(warnings.map(w => w.kind)).toContain('missing-item-type');
  });

  it('renames preset references', () => {
    const renamed = renameSpawnablePresetReferences(parseSpawnableTypesXml(xml), 'MedicalPreset', 'MedicalPreset2');
    expect(renamed.types[0].sections[1].preset).toBe('MedicalPreset2');
    expect(generateSpawnableTypesXml(renamed)).toContain('preset="MedicalPreset2"');
  });

  it('finds selected type entries from the mission-root spawnable file fallback', () => {
    const rootSpawnable = parseSpawnableTypesXml(`
<spawnabletypes>
  <type name="jmc_mjolnir_head"><attachments chance="0.75"/></type>
</spawnabletypes>`);
    const found = findSpawnableEntryForType({
      weapons: { types: [] },
      [ROOT_SPAWNABLE_GROUP]: rootSpawnable
    }, 'weapons', 'JMC_MJOLNIR_HEAD');

    expect(found?.group).toBe(ROOT_SPAWNABLE_GROUP);
    expect(found?.entry.name).toBe('jmc_mjolnir_head');
    expect(found?.entry.sections[0].chance).toBe(0.75);
  });

  it('finds selected type entries from vanilla group redirecting to root', () => {
    const rootSpawnable = parseSpawnableTypesXml(`
<spawnabletypes>
  <type name="jmc_mjolnir_head"><attachments chance="0.75"/></type>
</spawnabletypes>`);
    // In our app, 'vanilla' group is explicitly loaded and might point to root
    const found = findSpawnableEntryForType({
      vanilla: rootSpawnable,
      [ROOT_SPAWNABLE_GROUP]: rootSpawnable
    }, 'vanilla', 'jmc_mjolnir_head');

    expect(found?.group).toBe('vanilla');
    expect(found?.entry.name).toBe('jmc_mjolnir_head');
  });
});

describe('random presets and globals utilities', () => {
  it('parses and generates all random preset node kinds generically', () => {
    const parsed = parseRandomPresetsXml(`
<randompresets>
  <attachments name="Optics" chance="0.75">
    <item name="Optic_A" chance="0.25"/>
  </attachments>
  <cargo name="Medical"/>
</randompresets>`);
    expect(parsed.presets[0].kind).toBe('attachments');
    expect(parsed.presets[0].chance).toBe(0.75);
    expect(parsed.presets[0].items[0].chance).toBe(0.25);
    parsed.presets[0].items[0].chance = 0.12345;
    const out = generateRandomPresetsXml(parsed);
    expect(out).toContain('<attachments name="Optics" chance="0.750">');
    expect(out).toContain('<item name="Optic_A" chance="0.123"/>');
  });

  it('parses damage defaults from globals and formats chance precision', () => {
    const globals = parseGlobalsXml('<variables><var name="LootDamageMin" value="0.15"/><var name="LootDamageMax" value="0.85"/></variables>');
    expect(globals.LootDamageMin).toBe(0.15);
    expect(globals.LootDamageMax).toBe(0.85);
    expect(formatChance(2)).toBe('1.000');
    expect(formatChance(0.12345)).toBe('0.123');
  });
});
