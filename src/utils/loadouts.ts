import { Loadout, LoadoutNode } from '@/types/loadouts';
import { XMLNodeKind } from '@/types/xml';

/**
 * Converts a LoadoutNode to the internal structure used for spawnable types.
 * Since vanilla spawnabletypes.xml doesn't support deep nesting in the same way,
 * we might need to handle it or warn. For now, we'll try to map it as best as possible.
 */
export function loadoutNodeToSpawnableSection(node: LoadoutNode, kind: XMLNodeKind.ATTACHMENTS | XMLNodeKind.CARGO) {
  // Maps a single child of a root item's attachments/cargo list to one
  // <attachments>/<cargo> block (a "section").
  const itemFromNode = (child: LoadoutNode) => ({
    kind: XMLNodeKind.ITEM,
    name: child.type === 'template' ? '' : child.name,
    preset: child.type === 'template' ? child.name : '',
    chance: child.chance,
    attrs: {
      ...(child.type === 'template' ? { preset: child.name } : { name: child.name }),
      chance: child.chance.toFixed(2)
    }
  });

  // Inline group: one block with its members as items (chances kept verbatim).
  if (node.type === 'group') {
    return {
      kind,
      chance: node.chance,
      preset: '',
      attrs: { chance: node.chance.toFixed(2) },
      items: (node.attachments || []).map(itemFromNode)
    };
  }

  // Named group reference (random preset / template): <attachments preset="..." />.
  if (node.type === 'template') {
    return {
      kind,
      chance: node.chance,
      preset: node.name,
      attrs: {
        chance: node.chance.toFixed(2),
        preset: node.name
      },
      items: []
    };
  }

  // Legacy bare item: wrap it in its own single-item block.
  return {
    kind,
    chance: node.chance,
    preset: '',
    attrs: {
      chance: node.chance.toFixed(2)
    },
    items: [{
      kind: XMLNodeKind.ITEM,
      name: node.name,
      chance: 1.0,
      attrs: {
        name: node.name,
        chance: '1.00'
      }
    }]
  };
}

/**
 * Resolves a loadout node, expanding templates if provided.
 */
export function resolveLoadoutNode(
  node: LoadoutNode, 
  allLoadouts: Loadout[],
  randomPresets: any[] = [],
  expansionAirdrops: any = null,
  spawnableTypesByGroup: any = null
): LoadoutNode {
  if (node.type === 'template') {
    if (node.templateSource === 'loadout' || !node.templateSource) {
      const template = allLoadouts.find(l => l.id === node.name);
      if (template && template.items.length > 0) {
        return {
          ...template.items[0],
          id: node.id,
          chance: node.chance // Override with node's chance
        };
      }
    } else if (node.templateSource === 'preset') {
      const preset = randomPresets.find(p => p.name === node.name);
      if (preset) {
        // Create a virtual container node for the preset items
        return {
          ...node,
          name: node.name,
          attachments: (preset.items || []).map((item: any) => ({
             id: crypto.randomUUID(),
             type: item.preset ? 'template' : 'item',
             templateSource: item.preset ? 'preset' : undefined,
             name: item.preset || item.name,
             chance: item.chance ?? 1.0,
             attachments: [],
             cargo: []
          }))
        };
      }
    } else if (node.templateSource === 'airdrop' && expansionAirdrops) {
      const containers = expansionAirdrops.Containers || [];
      const airdrop = containers.find((l: any) => l.Container === node.name);
      if (airdrop) {
        const mapAirdropNode = (item: any): LoadoutNode => ({
           id: crypto.randomUUID(),
           type: 'item',
           name: item.Name,
           chance: item.Chance ?? 1.0,
           attachments: (item.Attachments || []).map((a: any) => mapAirdropNode(a)),
           cargo: (item.Cargo || []).map((c: any) => mapAirdropNode(c))
        });
        return {
          ...node,
          name: airdrop.Container,
          attachments: (airdrop.Loot || []).map((a: any) => mapAirdropNode(a)),
          cargo: []
        };
      }
    } else if (node.templateSource === 'spawnable' && spawnableTypesByGroup) {
      // Search for the type in all groups
      let foundType = null;
      for (const group of Object.values(spawnableTypesByGroup)) {
        foundType = (group as any).types?.find((t: any) => t.name === node.name);
        if (foundType) break;
      }

      if (foundType) {
        const imported = vanillaSpawnableToLoadout(foundType);
        if (imported.items.length > 0) {
          return {
            ...imported.items[0],
            id: node.id,
            chance: node.chance
          };
        }
      }
    }
  }
  
  return {
    ...node,
    attachments: (node.attachments || []).map(n => resolveLoadoutNode(n, allLoadouts, randomPresets, expansionAirdrops, spawnableTypesByGroup)),
    cargo: (node.cargo || []).map(n => resolveLoadoutNode(n, allLoadouts, randomPresets, expansionAirdrops, spawnableTypesByGroup))
  };
}

/**
 * Converts a full Loadout to Expansion Airdrop Loot format
 */
export function loadoutToExpansionAirdrop(
  loadout: Loadout, 
  allLoadouts: Loadout[],
  randomPresets: any[] = [],
  expansionAirdrops: any = null
) {
  // Expansion airdrop JSON has no concept of an anonymous chance-bearing group, so
  // inline group nodes are flattened into individual entries: each member's chance is
  // multiplied by its group's chance.
  const expandGroups = (nodes: LoadoutNode[]): LoadoutNode[] => {
    const out: LoadoutNode[] = [];
    for (const n of (nodes || [])) {
      if (n.type === 'group') {
        for (const m of (n.attachments || [])) {
          out.push({ ...m, chance: (n.chance ?? 1) * (m.chance ?? 1) });
        }
      } else {
        out.push(n);
      }
    }
    return out;
  };

  const mapNode = (node: LoadoutNode): any => {
    const resolved = resolveLoadoutNode(node, allLoadouts, randomPresets, expansionAirdrops);
    // Field order matches Expansion's ExpansionLoot class (ExpansionLoot.c):
    // Name, Chance, Attachments (from base/variant) then QuantityPercent, Max,
    // Min, Variants. There is deliberately NO Cargo — Expansion airdrop loot has
    // no Cargo member; the engine's JSON loader silently ignores unknown keys.
    return {
      Name: resolved.name,
      Chance: resolved.chance,
      Attachments: expandGroups(resolved.attachments || []).map(mapNode),
      QuantityPercent: resolved.quantity?.percent ?? -1.0,
      Max: resolved.quantity?.max ?? -1,
      Min: resolved.quantity?.min ?? 0,
      Variants: resolved.variants || []
    };
  };

  return loadout.items.map(mapNode);
}

/**
 * Converts a Loadout to Vanilla spawnabletypes XML fragment
 */
export function loadoutToVanillaXml(
  loadout: Loadout, 
  allLoadouts: Loadout[],
  randomPresets: any[] = [],
  expansionAirdrops: any = null
) {
  const lines: string[] = [];

  // Renders one child of a root item's attachments/cargo list as a single
  // <attachments>/<cargo> block. A child can be a group (inline block), a preset
  // template (named reference), or a legacy bare item (wrapped in its own block).
  const renderBlock = (tag: 'attachments' | 'cargo', node: LoadoutNode, space: string) => {
    // Named group reference, e.g. <attachments preset="MyPreset" chance="0.5" />
    if (node.type === 'template' && node.templateSource === 'preset') {
      lines.push(`${space}<${tag} preset="${node.name}" chance="${node.chance.toFixed(2)}" />`);
      return;
    }

    // Inline group -> one block with its members as items (verbatim chances).
    if (node.type === 'group') {
      lines.push(`${space}<${tag} chance="${node.chance.toFixed(2)}">`);
      (node.attachments || []).forEach(child => {
        if (child.type === 'template' && child.templateSource === 'preset') {
          lines.push(`${space}  <item preset="${child.name}" chance="${child.chance.toFixed(2)}"/>`);
        } else {
          lines.push(`${space}  <item name="${child.name}" chance="${child.chance.toFixed(2)}"/>`);
        }
      });
      lines.push(`${space}</${tag}>`);
      return;
    }

    // Other template (loadout/airdrop/spawnable) -> resolve and emit its members.
    if (node.type === 'template') {
      const resolved = resolveLoadoutNode(node, allLoadouts, randomPresets, expansionAirdrops);
      const members = tag === 'attachments' ? (resolved.attachments || []) : (resolved.cargo || []);
      lines.push(`${space}<${tag} chance="${node.chance.toFixed(2)}">`);
      members.forEach(child => {
        if (child.type === 'template' && child.templateSource === 'preset') {
          lines.push(`${space}  <item preset="${child.name}" chance="${child.chance.toFixed(2)}"/>`);
        } else {
          lines.push(`${space}  <item name="${child.name}" chance="${child.chance.toFixed(2)}"/>`);
        }
      });
      lines.push(`${space}</${tag}>`);
      return;
    }

    // Legacy bare item -> its own single-item block.
    lines.push(`${space}<${tag} chance="${node.chance.toFixed(2)}">`);
    lines.push(`${space}  <item name="${node.name}" chance="1.00"/>`);
    lines.push(`${space}</${tag}>`);
  };

  const mapRoot = (node: LoadoutNode, indent: number) => {
    const space = ' '.repeat(indent);
    lines.push(`${space}<type name="${node.name}">`);
    if (node.damage) {
      lines.push(`${space}  <damage min="${node.damage.min.toFixed(2)}" max="${node.damage.max.toFixed(2)}"/>`);
    }
    (node.attachments || []).forEach(child => renderBlock('attachments', child, `${space}  `));
    (node.cargo || []).forEach(child => renderBlock('cargo', child, `${space}  `));
    lines.push(`${space}</type>`);
  };

  loadout.items.forEach(item => mapRoot(item, 0));

  return lines.join('\n');
}

/**
 * Import utilities
 */

export function vanillaSpawnableToLoadout(spawnableType: any): Loadout {
  const rootNode: LoadoutNode = {
    id: crypto.randomUUID(),
    type: 'item',
    name: spawnableType.name,
    chance: 1.0,
    attachments: [],
    cargo: []
  };

  if (spawnableType.damage) {
    rootNode.damage = {
      min: spawnableType.damage.min ?? 0,
      max: spawnableType.damage.max ?? 0
    };
  }

  (spawnableType.sections || []).forEach((section: any) => {
    const list = section.kind === 'attachments' ? rootNode.attachments : 
                 section.kind === 'cargo' ? rootNode.cargo : null;
    
    if (!list) return;

    if (section.preset) {
      // <attachments preset="X" chance="Y"/> -> kept as a live preset reference.
      list.push({
        id: crypto.randomUUID(),
        type: 'template',
        templateSource: 'preset',
        name: section.preset,
        chance: section.chance ?? 1.0,
        attachments: [],
        cargo: []
      });
    } else {
      // <attachments chance="Y"> ...items... </attachments> -> one group node whose
      // members carry their original chances verbatim (no flattening). One member is
      // selected by weighted chance when the group (chance Y) is rolled.
      const members: LoadoutNode[] = (section.items || []).map((item: any) => ({
        id: crypto.randomUUID(),
        type: item.preset ? 'template' : 'item',
        templateSource: item.preset ? 'preset' : undefined,
        name: item.preset || item.name,
        chance: item.chance ?? 1.0,
        attachments: [],
        cargo: []
      }));
      list.push({
        id: crypto.randomUUID(),
        type: 'group',
        name: '',
        chance: section.chance ?? 1.0,
        attachments: members,
        cargo: []
      });
    }
  });

  return {
    id: crypto.randomUUID(),
    label: `Imported ${spawnableType.name}`,
    items: [rootNode],
    updatedAt: Date.now()
  };
}

export function vanillaPresetToLoadout(preset: any): Loadout {
  const rootItems: LoadoutNode[] = (preset.items || []).map((item: any) => ({
    id: crypto.randomUUID(),
    type: item.preset ? 'template' : 'item',
    name: item.preset || item.name,
    chance: item.chance ?? 1.0,
    attachments: [],
    cargo: []
  }));

  return {
    id: crypto.randomUUID(),
    label: `Preset: ${preset.name}`,
    items: rootItems.slice(0, 1),
    updatedAt: Date.now()
  };
}

export function expansionAirdropToLoadout(label: string, lootItems: any[]): Loadout {
  const mapNode = (item: any): LoadoutNode => {
    return {
      id: crypto.randomUUID(),
      type: 'item',
      name: item.Name,
      chance: item.Chance ?? 1.0,
      quantity: item.QuantityPercent !== undefined ? {
        min: item.Min ?? 0,
        max: item.Max ?? 0,
        percent: item.QuantityPercent
      } : undefined,
      variants: item.Variants || [],
      attachments: (item.Attachments || []).map(mapNode),
      cargo: [] // Expansion airdrop loot has no Cargo member; never read it back
    };
  };

  return {
    id: crypto.randomUUID(),
    label: label,
    items: lootItems.map(mapNode),
    updatedAt: Date.now()
  };
}

/**
 * Converts a Loadout to a Random Preset structure for cfgrandompresets.xml
 */
export function loadoutToRandomPreset(loadout: Loadout): any {
  return {
    kind: 'attachments', // Default
    name: loadout.label,
    chance: 1.0,
    items: loadout.items.map(node => ({
      kind: 'item',
      name: node.type === 'item' ? node.name : undefined,
      preset: node.type === 'template' ? node.name : undefined,
      chance: node.chance,
      attrs: {
        ...(node.type === 'item' ? { name: node.name } : { preset: node.name }),
        chance: node.chance.toFixed(2)
      }
    }))
  };
}

/**
 * Converts a Loadout to a full Spawnable Type entry
 */
export function loadoutToSpawnableEntry(loadout: Loadout): any {
  if (loadout.items.length === 0) return null;
  const root = loadout.items[0];
  
  const sections: any[] = [];
  
  if (root.damage) {
    sections.push({
      kind: XMLNodeKind.DAMAGE,
      attrs: {
        min: root.damage.min.toFixed(2),
        max: root.damage.max.toFixed(2)
      }
    });
  }

  const mapToSection = (nodes: LoadoutNode[], kind: XMLNodeKind.ATTACHMENTS | XMLNodeKind.CARGO) => {
     if (nodes.length === 0) return;

     // Each direct child of the root item maps to one <attachments>/<cargo> block:
     // a group node -> a block with its members; a preset template -> a preset reference;
     // a legacy bare item -> a single-item block.
     nodes.forEach(node => {
        sections.push(loadoutNodeToSpawnableSection(node, kind));
     });
  };

  mapToSection(root.attachments, XMLNodeKind.ATTACHMENTS);
  mapToSection(root.cargo, XMLNodeKind.CARGO);

  return {
    name: root.name,
    sections
  };
}
