import React from 'react';
import { LoadoutNode, Loadout } from '@/types/loadouts';
import { HierarchicalNodeItem, ChildListConfig } from './HierarchicalNodeItem';

interface HierarchicalTreeProps {
  items: LoadoutNode[];
  onUpdate: (items: LoadoutNode[]) => void;
  onSelect: (node: LoadoutNode) => void;
  onAddTemplate: (nodeId: string, list: 'attachments' | 'cargo') => void;
  selectedNodeId: string | null;
  childLists?: ChildListConfig[];
  
  // Template resolution data
  allLoadouts?: Loadout[];
  randomPresets?: { presets: any[] };
  expansionAirdrops?: any;
  spawnableTypesByGroup?: any;
  isReadOnly?: boolean;
}

export const HierarchicalTree: React.FC<HierarchicalTreeProps> = ({
  items,
  onUpdate,
  onSelect,
  onAddTemplate,
  selectedNodeId,
  childLists,
  allLoadouts,
  randomPresets,
  expansionAirdrops,
  spawnableTypesByGroup,
  isReadOnly = false
}) => {
  const updateItem = (index: number, updatedItem: LoadoutNode) => {
    const next = [...items];
    next[index] = updatedItem;
    onUpdate(next);
  };

  const deleteItem = (index: number) => {
    const next = [...items];
    next.splice(index, 1);
    onUpdate(next);
  };

  return (
    <div className="space-y-2">
      {items.map((item, idx) => (
        <HierarchicalNodeItem
          key={item.id}
          node={item}
          onUpdate={(updated) => updateItem(idx, updated)}
          onDelete={() => deleteItem(idx)}
          onSelect={onSelect}
          onAddTemplate={(list) => onAddTemplate(item.id, list)}
          selectedNodeId={selectedNodeId}
          childLists={childLists}
          allLoadouts={allLoadouts}
          randomPresets={randomPresets}
          expansionAirdrops={expansionAirdrops}
          spawnableTypesByGroup={spawnableTypesByGroup}
          isReadOnly={isReadOnly}
        />
      ))}
    </div>
  );
};
