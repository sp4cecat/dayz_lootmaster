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
  const mapNode = (node: LoadoutNode): any => {
    const resolved = resolveLoadoutNode(node, allLoadouts, randomPresets, expansionAirdrops);
    return {
      Name: resolved.name,
      Chance: resolved.chance,
      Attachments: (resolved.attachments || []).map(mapNode),
      Cargo: (resolved.cargo || []).map(mapNode),
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
export function loadoutToVanillaXml(
  loadout: Loadout, 
  allLoadouts: Loadout[],
  randomPresets: any[] = [],
  expansionAirdrops: any = null
) {
  const lines: string[] = [];

  const mapNode = (node: LoadoutNode, indent: number) => {
    const resolved = resolveLoadoutNode(node, allLoadouts, randomPresets, expansionAirdrops);
    const space = ' '.repeat(indent);
    
    // Vanilla usually has <attachments chance="X"> or <cargo chance="X">
    
    if (resolved.attachments.length > 0) {
      // If the node itself is a template of type preset, vanilla supports <attachments preset="Name"/>
      if (node.type === 'template' && node.templateSource === 'preset') {
         lines.push(`${space}<attachments preset="${node.name}" chance="${node.chance.toFixed(2)}" />`);
      } else {
        lines.push(`${space}<attachments chance="${resolved.chance.toFixed(2)}">`);
        resolved.attachments.forEach(child => {
           if (child.type === 'template' && child.templateSource === 'preset') {
             lines.push(`${space}  <item preset="${child.name}" chance="${child.chance.toFixed(2)}"/>`);
           } else {
             lines.push(`${space}  <item name="${child.name}" chance="${child.chance.toFixed(2)}"/>`);
           }
        });
        lines.push(`${space}</attachments>`);
      }
    }

    if (resolved.cargo.length > 0) {
      if (node.type === 'template' && node.templateSource === 'preset') {
        lines.push(`${space}<cargo preset="${node.name}" chance="${node.chance.toFixed(2)}" />`);
      } else {
        lines.push(`${space}<cargo chance="${resolved.chance.toFixed(2)}">`);
        resolved.cargo.forEach(child => {
          if (child.type === 'template' && child.templateSource === 'preset') {
            lines.push(`${space}  <item preset="${child.name}" chance="${child.chance.toFixed(2)}"/>`);
          } else {
            lines.push(`${space}  <item name="${child.name}" chance="${child.chance.toFixed(2)}"/>`);
          }
        });
        lines.push(`${space}</cargo>`);
      }
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
        templateSource: 'preset',
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
          templateSource: item.preset ? 'preset' : undefined,
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
      attachments: (item.Attachments || []).map(mapNode),
      cargo: (item.Cargo || []).map(mapNode) // Expansion sometimes uses Cargo too
    };
  };

  return {
    id: crypto.randomUUID(),
    label: label,
    items: lootItems.length > 0 ? [mapNode(lootItems[0])] : [],
    updatedAt: Date.now()
  };
}
