import { useMemo } from 'react';
import { LoadoutNode, Loadout } from '@/types/loadouts';
import { vanillaSpawnableToLoadout } from '@/utils/loadouts';

export function useResolvedNode(
  node: LoadoutNode,
  allLoadouts: Loadout[] = [],
  randomPresets?: { presets: any[] },
  expansionAirdrops?: any,
  spawnableTypesByGroup?: any
) {
  return useMemo(() => {
    if (node.type !== 'template') return { attachments: node.attachments, cargo: node.cargo };

    if (node.templateSource === 'loadout') {
      const template = allLoadouts.find(l => l.id === node.name);
      if (template && template.items.length > 0) {
        return { 
          attachments: template.items[0].attachments, 
          cargo: template.items[0].cargo 
        };
      }
    } else if (node.templateSource === 'preset' && randomPresets) {
      const preset = randomPresets.presets.find((p: any) => p.name === node.name);
      if (preset) {
        return { 
          attachments: (preset.items || []).map((item: any, idx: number) => ({
             id: `${node.id}-p-${idx}`,
             type: item.preset ? 'template' : 'item',
             templateSource: item.preset ? 'preset' : undefined,
             name: item.preset || item.name,
             chance: item.chance ?? 1.0,
             attachments: [],
             cargo: []
          })), 
          cargo: [] 
        };
      }
    } else if (node.templateSource === 'airdrop' && expansionAirdrops) {
       const containers = expansionAirdrops.Containers || [];
       const airdrop = containers.find((l: any) => l.Container === node.name);
       if (airdrop) {
         const mapAirdropNode = (item: any, idx: number): LoadoutNode => ({
            id: `${node.id}-a-${idx}`,
            type: 'item',
            name: item.Name,
            chance: item.Chance ?? 1.0,
            attachments: (item.Attachments || []).map((a: any, i: number) => mapAirdropNode(a, i)),
            cargo: (item.Cargo || []).map((c: any, i: number) => mapAirdropNode(c, i))
         });
         return {
           attachments: (airdrop.Loot || []).map((a: any, i: number) => mapAirdropNode(a, i)),
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
            attachments: imported.items[0].attachments,
            cargo: imported.items[0].cargo
          };
        }
      }
    }
    return { attachments: [], cargo: [] };
  }, [node, allLoadouts, randomPresets, expansionAirdrops, spawnableTypesByGroup]);
}
