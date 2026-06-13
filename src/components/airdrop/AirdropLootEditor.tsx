import React, { useState } from 'react';
import { Button } from '@/components/base/button/button';
import { Modal } from '@/components/base/modal/modal';
import { Plus, Package, PlusCircle } from '@untitledui/icons';
import { HierarchicalTree } from '../hierarchical/HierarchicalTree';
import { HierarchicalProperties } from '../hierarchical/HierarchicalProperties';
import { loadoutToExpansionAirdrop, expansionAirdropToLoadout } from '@/utils/loadouts';
import { updateNodeInList, findNode } from '@/utils/tree';
import { LoadoutNode, Loadout } from '@/types/loadouts';

interface AirdropLootEditorProps {
  initialLoot: any[];
  onChange: (loot: any[]) => void;
  typeOptions: string[];
  randomPresets: any;
  loadouts: Loadout[];
}

/**
 * Self-contained loot editor for an Airdrop container or mission. Holds the
 * normalized LoadoutNode tree in local state (seeded once from `initialLoot`)
 * so node ids stay stable across renders. Remount via a `key` to reset for a
 * different source. Converts back to Expansion loot format on every change.
 */
export const AirdropLootEditor: React.FC<AirdropLootEditorProps> = ({
  initialLoot,
  onChange,
  typeOptions,
  randomPresets,
  loadouts,
}) => {
  const [nodes, setNodes] = useState<LoadoutNode[]>(
    () => expansionAirdropToLoadout('loot', initialLoot || []).items
  );
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [editingNode, setEditingNode] = useState<LoadoutNode | null>(null);
  const [templateTarget, setTemplateTarget] = useState<{ nodeId: string; list: 'attachments' | 'cargo' } | null>(null);

  const commit = (next: LoadoutNode[]) => {
    setNodes(next);
    const tempLoadout: Loadout = { id: 'temp', label: 'loot', items: next, updatedAt: Date.now() };
    onChange(loadoutToExpansionAirdrop(tempLoadout, loadouts, randomPresets?.presets));
  };

  const handleUpdateNode = (updated: LoadoutNode) => {
    commit(updateNodeInList(nodes, updated));
    if (selectedNodeId === updated.id) setEditingNode(updated);
  };

  const addRootItem = () => {
    const newNode: LoadoutNode = {
      id: crypto.randomUUID(),
      type: 'item',
      name: 'NewItem',
      chance: 1.0,
      attachments: [],
      cargo: [],
    };
    commit([...nodes, newNode]);
    setSelectedNodeId(newNode.id);
    setEditingNode(newNode);
  };

  const addTemplate = (source: 'preset' | 'loadout', name: string) => {
    if (!templateTarget) return;
    const newNode: LoadoutNode = {
      id: crypto.randomUUID(),
      type: 'template',
      templateSource: source,
      name,
      chance: 1.0,
      attachments: [],
      cargo: [],
    };
    const target = findNode(nodes, templateTarget.nodeId);
    if (target) {
      const updated = {
        ...target,
        [templateTarget.list]: [...(target[templateTarget.list] || []), newNode],
      };
      handleUpdateNode(updated);
    }
    setTemplateTarget(null);
  };

  return (
    <div className="flex gap-4">
      <div className="flex-1 min-w-0 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-wider text-gray-400">Loot Contents</span>
          <Button size="xs" variant="secondary-gray" icon={Plus} onClick={addRootItem}>
            Add Item
          </Button>
        </div>
        {nodes.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-700 p-8 text-center text-sm text-gray-400">
            No loot configured. Add an item to begin.
          </div>
        ) : (
          <HierarchicalTree
            items={nodes}
            onUpdate={commit}
            onSelect={(node) => {
              setSelectedNodeId(node.id);
              setEditingNode(node);
            }}
            onAddTemplate={(nodeId, list) => setTemplateTarget({ nodeId, list })}
            selectedNodeId={selectedNodeId}
            randomPresets={randomPresets}
            allLoadouts={loadouts}
          />
        )}
      </div>

      {selectedNodeId && editingNode && (
        <div className="w-[360px] shrink-0">
          <HierarchicalProperties
            node={editingNode}
            onUpdate={handleUpdateNode}
            onClose={() => setSelectedNodeId(null)}
            typeOptions={typeOptions}
            availableTemplates={loadouts}
            randomPresets={randomPresets}
            config={{
              title: 'Airdrop Item Properties',
              showQuantity: true,
              showDamage: false,
              showVariants: true,
            }}
          />
        </div>
      )}

      {templateTarget && (
        <Modal isOpen={!!templateTarget} onClose={() => setTemplateTarget(null)} title="Select Template" maxWidth="max-w-md">
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-gray-400">Random Presets</label>
              <div className="grid grid-cols-1 gap-2 max-h-64 overflow-auto p-1">
                {(randomPresets?.presets || []).map((p: any, i: number) => (
                  <Button key={i} variant="secondary-gray" className="justify-start font-mono text-xs" icon={PlusCircle} onClick={() => addTemplate('preset', p.name)}>
                    {p.name}
                  </Button>
                ))}
              </div>
            </div>
            {loadouts.length > 0 && (
              <div className="space-y-2 border-t border-gray-100 dark:border-gray-800 pt-2">
                <label className="text-xs font-bold uppercase tracking-wider text-gray-400">Saved Loadouts</label>
                <div className="grid grid-cols-1 gap-2 max-h-64 overflow-auto p-1">
                  {loadouts.map((l: any, i: number) => (
                    <Button key={i} variant="secondary-gray" className="justify-start font-mono text-xs" icon={Package} onClick={() => addTemplate('loadout', l.id)}>
                      {l.label}
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
};
