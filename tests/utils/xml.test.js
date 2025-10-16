import { describe, it, expect } from 'vitest';
import { parseLimitsXml, parseTypesXml, generateTypesXml } from '../../src/utils/xml.js';

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
