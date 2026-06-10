import { Loadout, LoadoutNode } from '@/types/loadouts';
import { XMLNodeKind } from '@/types/xml';

/**
 * Converts a LoadoutNode to the internal structure used for spawnable types.
 * Since vanilla spawnabletypes.xml doesn't support deep nesting in the same way,
 * we might need to handle it or warn. For now, we'll try to map it as best as possible.
 */
export function loadoutNodeToSpawnableSection(node: LoadoutNode, kind: XMLNodeKind.ATTACHMENTS | XMLNodeKind.CARGO) {
  return {
    kind,
    chance: node.chance,
    preset: node.type === 'template' ? node.name : '',
    attrs: {
      chance: node.chance.toFixed(2),
      ...(node.type === 'template' ? { preset: node.name } : {})
    },
    items: node.type === 'item' ? [{
      kind: XMLNodeKind.ITEM,
      name: node.name,
      chance: 1.0,
      attrs: {
        name: node.name,
        chance: '1.00'
      }
    }] : []
  };
}

/**
 * Resolves a loadout node, expanding templates if provided.
 */
export function resolveLoadoutNode(node: LoadoutNode, allLoadouts: Loadout[]): LoadoutNode {
  if (node.type === 'template') {
    const template = allLoadouts.find(l => l.id === node.name);
    if (template) {
      // Create a virtual node that combines template's items
      // Note: This is a simplification. Usually a template might have multiple root items.
      // We'll take the first one or wrap them.
      if (template.items.length > 0) {
        return {
          ...template.items[0],
          chance: node.chance // Override with node's chance
        };
      }
    }
  }
  
  return {
    ...node,
    attachments: node.attachments.map(n => resolveLoadoutNode(n, allLoadouts)),
    cargo: node.cargo.map(n => resolveLoadoutNode(n, allLoadouts))
  };
}

/**
 * Converts a full Loadout to Expansion Airdrop Loot format
 */
export function loadoutToExpansionAirdrop(loadout: Loadout, allLoadouts: Loadout[]) {
  const mapNode = (node: LoadoutNode): any => {
    const resolved = resolveLoadoutNode(node, allLoadouts);
    return {
      Name: resolved.name,
      Chance: resolved.chance,
      Attachments: resolved.attachments.map(mapNode),
      QuantityPercent: resolved.quantity?.percent ?? -1.0,
      Max: resolved.quantity?.max ?? -1,
      Min: resolved.quantity?.min ?? 0,
      Variants: [] // Not supported in the designer yet
    };
  };

  return loadout.items.map(mapNode);
}

/**
 * Converts a Loadout to Vanilla spawnabletypes XML fragment
 */
export function loadoutToVanillaXml(loadout: Loadout, allLoadouts: Loadout[]) {
  const lines: string[] = [];

  const mapNode = (node: LoadoutNode, indent: number) => {
    const resolved = resolveLoadoutNode(node, allLoadouts);
    const space = ' '.repeat(indent);
    
    // Vanilla usually has <attachments chance="X"> or <cargo chance="X">
    // Here we wrap items in these tags if they have children.
    
    if (resolved.attachments.length > 0) {
      lines.push(`${space}<attachments chance="${resolved.chance.toFixed(2)}">`);
      resolved.attachments.forEach(child => {
         lines.push(`${space}  <item name="${child.name}" chance="${child.chance.toFixed(2)}"/>`);
         // Note: Vanilla nesting is limited in spawnabletypes.xml, 
         // so we don't recurse here for standard vanilla.
      });
      lines.push(`${space}</attachments>`);
    }

    if (resolved.cargo.length > 0) {
      lines.push(`${space}<cargo chance="${resolved.chance.toFixed(2)}">`);
      resolved.cargo.forEach(child => {
         lines.push(`${space}  <item name="${child.name}" chance="${child.chance.toFixed(2)}"/>`);
      });
      lines.push(`${space}</cargo>`);
    }
  };

  loadout.items.forEach(item => mapNode(item, 0));

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
      list.push({
        id: crypto.randomUUID(),
        type: 'template',
        name: section.preset,
        chance: section.chance ?? 1.0,
        attachments: [],
        cargo: []
      });
    } else if (section.items) {
      section.items.forEach((item: any) => {
        list.push({
          id: crypto.randomUUID(),
          type: item.preset ? 'template' : 'item',
          name: item.preset || item.name,
          chance: (item.chance ?? 1.0) * (section.chance ?? 1.0), // Flatten chance for designer
          attachments: [],
          cargo: []
        });
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
    items: rootItems,
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
      attachments: (item.Attachments || []).map(mapNode),
      cargo: (item.Cargo || []).map(mapNode) // Expansion sometimes uses Cargo too
    };
  };

  return {
    id: crypto.randomUUID(),
    label: label,
    items: lootItems.map(mapNode),
    updatedAt: Date.now()
  };
}
