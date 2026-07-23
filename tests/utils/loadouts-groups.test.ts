import { describe, it, expect } from 'vitest';
import { parseSpawnableTypesXml } from '../../src/utils/xml.ts';
import {
  vanillaSpawnableToLoadout,
  loadoutToSpawnableEntry,
  loadoutToVanillaXml,
  loadoutToExpansionAirdrop,
  expansionAirdropToLoadout,
  migrateVariantNodes,
} from '../../src/utils/loadouts.ts';
import type { Loadout, LoadoutNode } from '../../src/types/loadouts.ts';

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

  it('keeps a group\'s linked slot in native JSON but never emits it to vanilla XML', () => {
    const parsed = parseSpawnableTypesXml(FAL_XML);
    const loadout = vanillaSpawnableToLoadout(parsed.types[0]);

    // Link the first group to an exposed slot (design-time metadata).
    loadout.items[0].attachments[0].slot = 'WeaponHandguardFAL';

    // Native JSON round-trip preserves the slot (whole node persisted to IndexedDB).
    const cloned = JSON.parse(JSON.stringify(loadout));
    expect(cloned.items[0].attachments[0].slot).toBe('WeaponHandguardFAL');

    // Serialization to the XML store and to vanilla XML must not leak the slot.
    const entry = loadoutToSpawnableEntry(loadout);
    expect(JSON.stringify(entry)).not.toContain('WeaponHandguardFAL');
    expect(entry.sections.find((s: any) => s.kind === 'attachments')?.attrs?.slot).toBeUndefined();

    const xml = loadoutToVanillaXml(loadout, []);
    expect(xml).not.toContain('WeaponHandguardFAL');
    expect(xml).not.toContain('slot=');
    // Structure is otherwise unchanged (still three blocks).
    expect((xml.match(/<attachments /g) || []).length).toBe(3);
  });

  it('flattens attachment-level groups when exporting to Expansion airdrop format (chance multiplied)', () => {
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
    // Attachments use the slim ExpansionLootVariant shape — no loot-item-only fields.
    expect(buis).not.toHaveProperty('QuantityPercent');
    expect(buis).not.toHaveProperty('Max');
    expect(buis).not.toHaveProperty('Min');
    expect(buis).not.toHaveProperty('Variants');
    expect(Object.keys(buis).sort()).toEqual(['Attachments', 'Chance', 'Name']);
  });
});

describe('Linked random preset inside attachments -> flattened (Expansion airdrop)', () => {
  // A weapon whose attachments link a random preset (cfgrandompresets.xml). Expansion has
  // no exclusive attachment primitive, so the preset's members must flatten into
  // independent attachment rolls — NOT leak through as an attachment named after the
  // preset with the real members nested beneath it.
  const RANDOM_PRESETS = [
    {
      name: 'ar_scopes',
      items: [
        { name: 'ACOGOptic', chance: 0.5 },
        { name: 'M68Optic', chance: 0.3 },
      ],
    },
  ];

  const tavor: Loadout = {
    id: 't',
    label: 't',
    updatedAt: 0,
    items: [
      {
        id: 'root',
        type: 'item',
        name: 'TTC_TAVOR_DMR',
        chance: 1.0,
        attachments: [
          {
            id: 'p',
            type: 'template',
            templateSource: 'preset',
            name: 'ar_scopes',
            chance: 0.4,
            attachments: [],
            cargo: [],
          },
        ],
        cargo: [],
      },
    ],
  };

  it('flattens the preset members into independent rolls (chance multiplied); no preset-named attachment', () => {
    const out = loadoutToExpansionAirdrop(tavor, [], RANDOM_PRESETS);
    const root = out[0];
    expect(root.Name).toBe('TTC_TAVOR_DMR');
    // The preset name never appears as an attachment; its members are lifted up instead.
    expect(root.Attachments.some((a: any) => a.Name === 'ar_scopes')).toBe(false);
    expect(root.Attachments.map((a: any) => a.Name)).toEqual(['ACOGOptic', 'M68Optic']);
    // preset chance (0.4) * member chance.
    expect(root.Attachments[0].Chance).toBeCloseTo(0.2, 5); // 0.4 * 0.5
    expect(root.Attachments[1].Chance).toBeCloseTo(0.12, 5); // 0.4 * 0.3
    // Slim ExpansionLootVariant shape (no loot-item-only fields, no nested wrapper).
    expect(Object.keys(root.Attachments[0]).sort()).toEqual(['Attachments', 'Chance', 'Name']);
    expect(root.Attachments[0].Attachments).toEqual([]);
  });
});

describe('Item-level group -> Expansion Variants (exclusive select-one)', () => {
  // A group sitting at the loot-list root is a weighted select-one over whole items.
  // Expansion's exclusive primitive is Variants (base + Variants weighted pick).
  const groupLoadout: Loadout = {
    id: 'g',
    label: 'g',
    updatedAt: 0,
    items: [
      {
        id: 'grp',
        type: 'group',
        name: '',
        chance: 0.8, // whether the slot rolls at all
        attachments: [
          { id: 'a', type: 'item', name: 'AKM', chance: 0.5, attachments: [], cargo: [] },
          { id: 'b', type: 'item', name: 'M4A1', chance: 0.3, attachments: [], cargo: [] },
          { id: 'c', type: 'item', name: 'SKS', chance: 0.2, attachments: [], cargo: [] },
        ],
        cargo: [],
      },
    ],
  };

  it('emits one loot entry: first member as base, the rest as Variants', () => {
    const airdrop = loadoutToExpansionAirdrop(groupLoadout, []);
    expect(airdrop).toHaveLength(1);

    const entry = airdrop[0];
    expect(entry.Name).toBe('AKM'); // base = first member
    expect(entry.Chance).toBe(0.8); // group chance governs the slot
    // Remaining members become weighted Variants (base absorbs 1 - sum per AddItem).
    expect(entry.Variants.map((v: any) => v.Name)).toEqual(['M4A1', 'SKS']);
    expect(entry.Variants.map((v: any) => v.Chance)).toEqual([0.3, 0.2]);
    // Base has no attachments here.
    expect(entry.Attachments).toEqual([]);
  });

  it('drops an empty group instead of emitting a nameless entry', () => {
    const empty: Loadout = {
      id: 'e',
      label: 'e',
      updatedAt: 0,
      items: [{ id: 'grp', type: 'group', name: '', chance: 1.0, attachments: [], cargo: [] }],
    };
    expect(loadoutToExpansionAirdrop(empty, [])).toEqual([]);
  });
});

describe('Variants as item nodes (inline authoring)', () => {
  // Variants are authored inline as their own item nodes. Import maps each Variants[] entry —
  // and its own Attachments — into a LoadoutNode; export maps it back to the slim shape.
  it('imports a variant (with its own attachments) as an item node and round-trips it', () => {
    const loadout = expansionAirdropToLoadout('t', [
      {
        Name: 'AKM',
        Chance: 1.0,
        Attachments: [],
        QuantityPercent: -1,
        Max: -1,
        Min: 0,
        Variants: [{ Name: 'SKS', Chance: 0.3, Attachments: [{ Name: 'PABlackHandguard', Chance: 1.0, Attachments: [] }] }],
      },
    ]);
    // A variant is a real item node with a name and its Attachments as child nodes.
    const variant = loadout.items[0].variants![0];
    expect(variant.type).toBe('item');
    expect(variant.name).toBe('SKS');
    expect(variant.chance).toBe(0.3);
    expect(variant.attachments.map((a) => a.name)).toEqual(['PABlackHandguard']);

    // Export folds it back to the slim ExpansionLootVariant shape.
    const out = loadoutToExpansionAirdrop(loadout, []);
    expect(out[0].Variants).toHaveLength(1);
    expect(out[0].Variants[0]).toEqual({
      Name: 'SKS',
      Chance: 0.3,
      Attachments: [{ Name: 'PABlackHandguard', Chance: 1.0, Attachments: [] }],
    });
  });

  it('migrateVariantNodes upgrades legacy object/string variants to item nodes (idempotent)', () => {
    // A stored node whose variants still hold the OLD object + string shapes.
    const stored = [
      {
        id: 'root',
        type: 'item',
        name: 'AKM',
        chance: 1,
        attachments: [],
        cargo: [],
        variants: [
          { Name: 'SKS', Chance: 0.3, Attachments: [{ Name: 'PABlackHandguard', Chance: 1, Attachments: [] }] },
          'M4A1',
        ],
      },
    ] as unknown as LoadoutNode[];

    const migrated = migrateVariantNodes(stored);
    const variants = migrated[0].variants!;
    expect(variants.map((v) => v.type)).toEqual(['item', 'item']);
    expect(variants.map((v) => v.name)).toEqual(['SKS', 'M4A1']);
    expect(variants[0].attachments.map((a) => a.name)).toEqual(['PABlackHandguard']);
    expect(typeof variants[0].id).toBe('string');

    // Idempotent: re-running on already-migrated nodes keeps them as nodes (same names/ids).
    const again = migrateVariantNodes(migrated);
    expect(again[0].variants!.map((v) => v.name)).toEqual(['SKS', 'M4A1']);
    expect(again[0].variants![0].id).toBe(variants[0].id);
  });
});

describe('Expansion airdrop string-vs-object attachment duality', () => {
  it('imports legacy string attachments (m_Version < 5) without corruption', () => {
    const loadout = expansionAirdropToLoadout('t', [
      { Name: 'AKM', Chance: 1.0, Attachments: ['AKM_Suppressor', 'AK_PlasticBttstck'] },
    ]);
    const root = loadout.items[0];
    expect(root.name).toBe('AKM');
    expect(root.attachments.map((a) => a.name)).toEqual(['AKM_Suppressor', 'AK_PlasticBttstck']);
    // String form implies chance 1.0 and no nested attachments.
    expect(root.attachments.every((a) => a.chance === 1.0 && a.attachments.length === 0)).toBe(true);
  });

  it('exports object attachments in the slim shape (no loot-item fields leak)', () => {
    const loadout = expansionAirdropToLoadout('t', [
      {
        Name: 'AKM',
        Chance: 1.0,
        Attachments: [{ Name: 'AKM_Suppressor', Chance: 0.5, Attachments: [] }],
        QuantityPercent: -1,
        Max: -1,
        Min: 0,
      },
    ]);
    const att = loadoutToExpansionAirdrop(loadout, [])[0].Attachments[0];
    expect(att).toEqual({ Name: 'AKM_Suppressor', Chance: 0.5, Attachments: [] });
  });

  it('normalizes string attachments inside Variants on both import and export', () => {
    const loadout = expansionAirdropToLoadout('t', [
      {
        Name: 'SKS',
        Chance: 0.5,
        Attachments: [],
        QuantityPercent: -1,
        Max: -1,
        Min: 0,
        Variants: [{ Name: 'SKS', Chance: 0.2, Attachments: ['PABlackHandguard'] }],
      },
    ]);
    // Import maps the variant to an item node; its string attachment becomes a child item node.
    const variant = loadout.items[0].variants![0];
    expect(variant.name).toBe('SKS');
    expect(variant.attachments.map((a) => a.name)).toEqual(['PABlackHandguard']);
    // Export normalizes it back to the slim object shape.
    const out = loadoutToExpansionAirdrop(loadout, []);
    expect(out[0].Variants[0].Attachments[0]).toEqual({ Name: 'PABlackHandguard', Chance: 1.0, Attachments: [] });
  });

  it('coerces a fully-string variant entry to an object', () => {
    const loadout = expansionAirdropToLoadout('t', [
      { Name: 'SKS', Chance: 0.5, Attachments: [], QuantityPercent: -1, Max: -1, Min: 0, Variants: ['SKS'] },
    ]);
    const out = loadoutToExpansionAirdrop(loadout, []);
    expect(out[0].Variants[0]).toEqual({ Name: 'SKS', Chance: 1.0, Attachments: [] });
  });
});

describe('Cargo folds into Expansion Attachments', () => {
  // Expansion spawns loot children via ExpansionCreateInInventory (attachment slot OR
  // cargo), so a container's cargo contents must export as "attachments". A FirstAidKit
  // imported from spawnabletypes stores BandageDressing in a cargo *group*.
  const FIRSTAIDKIT_XML = `<spawnabletypes>
    <type name="FirstAidKit">
      <cargo chance="1.00">
        <item name="BandageDressing" chance="1.00"/>
      </cargo>
    </type>
  </spawnabletypes>`;

  it('exports cargo group members as Attachments (not dropped)', () => {
    const parsed = parseSpawnableTypesXml(FIRSTAIDKIT_XML);
    const loadout = vanillaSpawnableToLoadout(parsed.types[0]);
    const out = loadoutToExpansionAirdrop(loadout, []);

    expect(out).toHaveLength(1);
    expect(out[0].Name).toBe('FirstAidKit');
    expect(out[0].Attachments).toEqual([{ Name: 'BandageDressing', Chance: 1, Attachments: [] }]);
  });

  it('folds both attachments and cargo into one Attachments list', () => {
    const loadout: Loadout = {
      id: 'c',
      label: 'c',
      updatedAt: 0,
      items: [
        {
          id: 'root',
          type: 'item',
          name: 'AKM',
          chance: 1.0,
          attachments: [{ id: 'a', type: 'item', name: 'AKM_Suppressor', chance: 1.0, attachments: [], cargo: [] }],
          cargo: [{ id: 'c1', type: 'item', name: 'Mag_AKM_30Rnd', chance: 1.0, attachments: [], cargo: [] }],
        },
      ],
    };
    const out = loadoutToExpansionAirdrop(loadout, []);
    expect(out[0].Attachments.map((a: any) => a.Name)).toEqual(['AKM_Suppressor', 'Mag_AKM_30Rnd']);
  });
});
