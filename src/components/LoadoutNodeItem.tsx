import React from 'react';
import { LoadoutNode } from '@/types/loadouts';
import { ChevronRight, ChevronDown, Plus, Trash2, Package, Layers, Settings2 } from 'lucide-react';
import { Button } from '@/components/base/button/button';
import { Badge } from '@/components/base/badges/badges';
import { cx } from '@/utils/cx';

interface LoadoutNodeItemProps {
  node: LoadoutNode;
  onUpdate: (updatedNode: LoadoutNode) => void;
  onDelete: () => void;
  onSelect: (node: LoadoutNode) => void;
  onAddTemplate: (list: 'attachments' | 'cargo') => void;
  selectedNodeId: string | null;
  depth?: number;
  defaultExpanded?: boolean;
  // Template resolution data
  allLoadouts?: Loadout[];
  randomPresets?: { presets: any[] };
  expansionAirdrops?: any;
}

export const LoadoutNodeItem: React.FC<LoadoutNodeItemProps> = ({
  node,
  onUpdate,
  onDelete,
  onSelect,
  onAddTemplate,
  selectedNodeId,
  depth = 0,
  defaultExpanded = false,
  allLoadouts = [],
  randomPresets,
  expansionAirdrops
}) => {
  const isExpanded = node.isExpanded ?? defaultExpanded;
  const isSelected = selectedNodeId === node.id;

  const resolvedChildren = React.useMemo(() => {
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
    }
    return { attachments: [], cargo: [] };
  }, [node, allLoadouts, randomPresets, expansionAirdrops]);

  const handleAddChild = (list: 'attachments' | 'cargo') => {
    const newNode: LoadoutNode = {
      id: crypto.randomUUID(),
      type: 'item',
      name: '',
      chance: 1.0,
      attachments: [],
      cargo: [],
      isExpanded: false
    };

    const updatedAttachments = node.attachments.map(child => ({
      ...child,
      isExpanded: child.id === selectedNodeId ? false : child.isExpanded
    }));
    const updatedCargo = node.cargo.map(child => ({
      ...child,
      isExpanded: child.id === selectedNodeId ? false : child.isExpanded
    }));

    onUpdate({
      ...node,
      attachments: list === 'attachments' ? [...updatedAttachments, newNode] : updatedAttachments,
      cargo: list === 'cargo' ? [...updatedCargo, newNode] : updatedCargo,
      isExpanded: true
    });
    onSelect(newNode);
  };

  const updateChild = (list: 'attachments' | 'cargo', index: number, updatedChild: LoadoutNode) => {
    const newList = [...node[list]];
    newList[index] = updatedChild;
    onUpdate({ ...node, [list]: newList });
  };

  const deleteChild = (list: 'attachments' | 'cargo', index: number) => {
    const newList = [...node[list]];
    newList.splice(index, 1);
    onUpdate({ ...node, [list]: newList });
  };

  return (
    <div className="space-y-1">
      <div 
        className={cx(
          "flex items-center group px-3 py-2 rounded-lg cursor-pointer border transition-all",
          isSelected 
            ? "bg-primary-50 border-primary-200 dark:bg-primary-900/20 dark:border-primary-800" 
            : "bg-white border-gray-200 dark:bg-gray-900 dark:border-gray-800 hover:border-gray-300 dark:hover:border-gray-700"
        )}
        onClick={() => onSelect(node)}
      >
        <button 
          onClick={(e) => { e.stopPropagation(); onUpdate({ ...node, isExpanded: !isExpanded }); }}
          className="mr-2 p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded text-gray-400"
        >
          {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>

        <div className={cx(
          "p-1.5 rounded mr-3",
          node.type === 'template' ? "bg-amber-100 text-amber-600" : "bg-blue-100 text-blue-600"
        )}>
          {node.type === 'template' ? <Layers size={14} /> : <Package size={14} />}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold truncate text-sm">{node.name}</span>
            <Badge variant="gray" size="sm">{(node.chance * 100).toFixed(0)}%</Badge>
            {node.type === 'template' && <Badge variant="warning" size="sm">Template</Badge>}
          </div>
        </div>

        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button 
            variant="secondary" 
            size="sm" 
            className="h-8 w-8 p-0"
            onClick={(e) => { e.stopPropagation(); onSelect(node); }}
          >
            <Settings2 size={14} />
          </Button>
          <Button 
            variant="secondary" 
            size="sm" 
            className="h-8 w-8 p-0 text-error-600"
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
          >
            <Trash2 size={14} />
          </Button>
        </div>
      </div>

      {isExpanded && (
        <div className="ml-6 pl-4 border-l-2 border-gray-100 dark:border-gray-800 space-y-4 py-2">
          {/* Attachments Section */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Attachments</span>
              <div className="flex gap-2">
                <button 
                  onClick={() => onAddTemplate('attachments')}
                  className="text-xs text-amber-600 hover:underline flex items-center"
                >
                  <Layers size={12} className="mr-1" /> Template
                </button>
                <button 
                  onClick={() => handleAddChild('attachments')}
                  className="text-xs text-primary-600 hover:underline flex items-center"
                >
                  <Plus size={12} className="mr-1" /> Add
                </button>
              </div>
            </div>
            {resolvedChildren.attachments.length > 0 ? (
              <div className="space-y-1">
                {resolvedChildren.attachments.map((child, idx) => (
                  <LoadoutNodeItem 
                    key={child.id}
                    node={child}
                    onUpdate={(updated) => updateChild('attachments', idx, updated)}
                    onDelete={() => deleteChild('attachments', idx)}
                    onSelect={onSelect}
                    onAddTemplate={onAddTemplate}
                    selectedNodeId={selectedNodeId}
                    depth={depth + 1}
                    allLoadouts={allLoadouts}
                    randomPresets={randomPresets}
                    expansionAirdrops={expansionAirdrops}
                  />
                ))}
              </div>
            ) : (
              <div className="text-[10px] text-gray-400 italic">No attachments</div>
            )}
          </div>

          {/* Cargo Section */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Cargo</span>
              <div className="flex gap-2">
                <button 
                  onClick={() => onAddTemplate('cargo')}
                  className="text-xs text-amber-600 hover:underline flex items-center"
                >
                  <Layers size={12} className="mr-1" /> Template
                </button>
                <button 
                  onClick={() => handleAddChild('cargo')}
                  className="text-xs text-primary-600 hover:underline flex items-center"
                >
                  <Plus size={12} className="mr-1" /> Add
                </button>
              </div>
            </div>
            {resolvedChildren.cargo.length > 0 ? (
              <div className="space-y-1">
                {resolvedChildren.cargo.map((child, idx) => (
                  <LoadoutNodeItem 
                    key={child.id}
                    node={child}
                    onUpdate={(updated) => updateChild('cargo', idx, updated)}
                    onDelete={() => deleteChild('cargo', idx)}
                    onSelect={onSelect}
                    onAddTemplate={onAddTemplate}
                    selectedNodeId={selectedNodeId}
                    depth={depth + 1}
                    allLoadouts={allLoadouts}
                    randomPresets={randomPresets}
                    expansionAirdrops={expansionAirdrops}
                  />
                ))}
              </div>
            ) : (
              <div className="text-[10px] text-gray-400 italic">No cargo</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
