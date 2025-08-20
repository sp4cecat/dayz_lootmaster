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
