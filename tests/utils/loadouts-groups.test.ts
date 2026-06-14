import { describe, it, expect } from 'vitest';
import { parseSpawnableTypesXml } from '../../src/utils/xml.ts';
import {
  vanillaSpawnableToLoadout,
  loadoutToSpawnableEntry,
  loadoutToVanillaXml,
  loadoutToExpansionAirdrop,
} from '../../src/utils/loadouts.ts';

// The FAL example from the issue: three separate <attachments> groups, each with
// its own chance, and items with their own chances inside.
const FAL_XML = `<spawnabletypes>
  <type name="FAL">
    <damage min="0.45" max="0.85"/>
    <attachments chance="1.00">
      <item name="Fal_FoldingBttstck" chance="0.50"/>
      <item name="Fal_OeBttstck" chance="1.00"/>
    </attachments>
    <attachments chance="0.20">
      <item name="BUISOptic" chance="0.20"/>
      <item name="M68Optic" chance="0.20"/>
    </attachments>
    <attachments chance="0.10">
      <item name="Mag_FAL_20Rnd" chance="1.00"/>
    </attachments>
  </type>
</spawnabletypes>`;

describe('Spawnable attachment groups -> Loadout group nodes', () => {
  it('imports each <attachments> block as a distinct group node (chances verbatim)', () => {
    const parsed = parseSpawnableTypesXml(FAL_XML);
    const loadout = vanillaSpawnableToLoadout(parsed.types[0]);

    const root = loadout.items[0];
    expect(root.name).toBe('FAL');

    // Three separate groups (the extra level), not a single flattened list.
    expect(root.attachments).toHaveLength(3);
    expect(root.attachments.every(g => g.type === 'group')).toBe(true);

    const [g1, g2, g3] = root.attachments;
    // Group chances preserved.
    expect(g1.chance).toBe(1.0);
    expect(g2.chance).toBe(0.2);
    expect(g3.chance).toBe(0.1);

    // Member item chances preserved verbatim (NOT multiplied by group chance).
    expect(g1.attachments.map(i => i.name)).toEqual(['Fal_FoldingBttstck', 'Fal_OeBttstck']);
    expect(g1.attachments.map(i => i.chance)).toEqual([0.5, 1.0]);
    expect(g2.attachments.map(i => i.chance)).toEqual([0.2, 0.2]);
    expect(g3.attachments.map(i => i.name)).toEqual(['Mag_FAL_20Rnd']);
  });

  it('round-trips back to a spawnable entry preserving the group structure', () => {
    const parsed = parseSpawnableTypesXml(FAL_XML);
    const loadout = vanillaSpawnableToLoadout(parsed.types[0]);
    const entry = loadoutToSpawnableEntry(loadout);

    const attachmentSections = entry.sections.filter((s: any) => s.kind === 'attachments');
    expect(attachmentSections).toHaveLength(3);
    expect(attachmentSections[0].chance).toBe(1.0);
    expect(attachmentSections[0].items.map((i: any) => i.name)).toEqual(['Fal_FoldingBttstck', 'Fal_OeBttstck']);
    expect(attachmentSections[0].items.map((i: any) => i.chance)).toEqual([0.5, 1.0]);
    expect(attachmentSections[2].chance).toBe(0.1);
  });

  it('exports vanilla XML with one <attachments> block per group', () => {
    const parsed = parseSpawnableTypesXml(FAL_XML);
    const loadout = vanillaSpawnableToLoadout(parsed.types[0]);
    const xml = loadoutToVanillaXml(loadout, []);

    // Three separate blocks, not one merged list.
    expect((xml.match(/<attachments /g) || []).length).toBe(3);
    expect(xml).toContain('<attachments chance="1.00">');
    expect(xml).toContain('<attachments chance="0.20">');
    expect(xml).toContain('<attachments chance="0.10">');
    expect(xml).toContain('<item name="Fal_FoldingBttstck" chance="0.50"/>');
  });

  it('flattens groups when exporting to Expansion airdrop format (chance multiplied)', () => {
    const parsed = parseSpawnableTypesXml(FAL_XML);
    const loadout = vanillaSpawnableToLoadout(parsed.types[0]);
    const airdrop = loadoutToExpansionAirdrop(loadout, []);

    const root = airdrop[0];
    expect(root.Name).toBe('FAL');
    // All members flattened up into Attachments (2 + 2 + 1 = 5).
    expect(root.Attachments).toHaveLength(5);
    const buis = root.Attachments.find((a: any) => a.Name === 'BUISOptic');
    // 0.20 (group) * 0.20 (item) = 0.04
    expect(buis.Chance).toBeCloseTo(0.04, 5);
  });
});
