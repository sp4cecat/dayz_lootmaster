import React, { useState, useEffect } from 'react';
import { Button } from '@/components/base/button/button';
import { Input } from '@/components/base/input/input';
import { Badge } from '@/components/base/badges/badges';
import { Plus, Save, Package, RefreshCw, Layers } from 'lucide-react';
import { HierarchicalTree } from './hierarchical/HierarchicalTree';
import { HierarchicalProperties } from './hierarchical/HierarchicalProperties';
import { expansionAirdropToLoadout, loadoutToExpansionAirdrop } from '@/utils/loadouts';
import { updateNodeInList, findNode } from '@/utils/tree';
import { LoadoutNode, Loadout } from '@/types/loadouts';
import { cx } from '@/utils/cx';
import { Modal } from '@/components/base/modal/modal';

interface ExpansionAirdropEditorProps {
  selectedProfileId: string;
  getApiBase: () => string;
  typeOptions: string[];
  randomPresets: any;
  loadouts: Loadout[];
}

export const ExpansionAirdropEditor: React.FC<ExpansionAirdropEditorProps> = ({
  selectedProfileId,
  getApiBase,
  typeOptions,
  randomPresets,
  loadouts
}) => {
  const [settings, setSettings] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [selectedContainerIdx, setSelectedContainerIdx] = useState<number | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [editingNode, setEditingNode] = useState<LoadoutNode | null>(null);
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [templateModalTarget, setTemplateModalTarget] = useState<{nodeId: string, list: 'attachments' | 'cargo'} | null>(null);

  const fetchSettings = async () => {
    if (!getApiBase || !selectedProfileId) return;
    setLoading(true);
    try {
      const res = await fetch(`${getApiBase()}/api/expansion/airdrop-settings`, {
        headers: { 'X-Profile-ID': selectedProfileId }
      });
      if (res.ok) {
        setSettings(await res.json());
      }
    } catch (e) {
      console.error('Failed to fetch airdrop settings', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, [selectedProfileId]);

  const handleSave = async () => {
    if (!settings || !getApiBase || !selectedProfileId) return;
    setLoading(true);
    try {
      const res = await fetch(`${getApiBase()}/api/expansion/airdrop-settings`, {
        method: 'PUT',
        headers: { 
          'X-Profile-ID': selectedProfileId,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(settings)
      });
      if (res.ok) {
        alert('Saved successfully');
      }
    } catch (e) {
      console.error('Failed to save airdrop settings', e);
    } finally {
      setLoading(false);
    }
  };

  const updateContainerLoot = (index: number, newNodes: LoadoutNode[]) => {
    const nextSettings = { ...settings };
    const container = nextSettings.Containers[index];
    
    // Create a temporary loadout to use the converter
    const tempLoadout: Loadout = {
      id: 'temp',
      label: container.Container,
      items: newNodes,
      updatedAt: Date.now()
    };
    
    container.Loot = loadoutToExpansionAirdrop(tempLoadout, loadouts, randomPresets?.presets);
    setSettings(nextSettings);
  };

  const handleUpdateNode = (updatedNode: LoadoutNode) => {
    if (selectedContainerIdx === null) return;
    const currentNodes = expansionAirdropToLoadout(settings.Containers[selectedContainerIdx].Container, settings.Containers[selectedContainerIdx].Loot).items;
    const nextNodes = updateNodeInList(currentNodes, updatedNode);
    updateContainerLoot(selectedContainerIdx, nextNodes);
    
    if (selectedNodeId === updatedNode.id) {
      setEditingNode(updatedNode);
    }
  };

  if (loading && !settings) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <RefreshCw className="animate-spin text-primary-600" size={32} />
      </div>
    );
  }

  const containers = settings?.Containers || [];

  return (
    <div className="flex-1 flex overflow-hidden h-full">
      <div className="w-80 border-r border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/50 overflow-auto">
        <header className="p-4 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between sticky top-0 bg-gray-50 dark:bg-gray-900 z-10">
          <h2 className="font-bold text-gray-900 dark:text-white">Airdrop Containers</h2>
          <Button size="xs" variant="secondary-gray" icon={Plus} onClick={() => {
             const next = { ...settings, Containers: [...containers, { Container: 'NewContainer', Loot: [] }] };
             setSettings(next);
          }} />
        </header>
        <div className="p-2 space-y-1">
          {containers.map((c: any, i: number) => (
            <div 
              key={i}
              onClick={() => setSelectedContainerIdx(i)}
              className={cx(
                "p-3 rounded-lg cursor-pointer transition-all border",
                selectedContainerIdx === i 
                  ? "bg-white dark:bg-gray-800 border-primary-200 dark:border-primary-800 shadow-sm" 
                  : "border-transparent hover:bg-gray-100 dark:hover:bg-gray-800/50"
              )}
            >
               <div className="flex items-center justify-between">
                 <span className="text-sm font-semibold truncate">{c.Container}</span>
                 <Badge size="sm" color="gray">{c.Loot?.length || 0} items</Badge>
               </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex-1 flex flex-col min-w-0 bg-white dark:bg-gray-950 relative overflow-hidden">
        {selectedContainerIdx !== null ? (
          <>
            <header className="p-6 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between shrink-0">
              <div>
                <Input 
                  value={containers[selectedContainerIdx].Container}
                  onChange={e => {
                    const next = { ...settings };
                    next.Containers[selectedContainerIdx].Container = e.target.value;
                    setSettings(next);
                  }}
                  className="font-bold text-lg border-none bg-transparent p-0 focus:ring-0 w-80 shadow-none"
                />
                <p className="text-xs text-gray-500">Recursive loot configuration</p>
              </div>
              <Button variant="primary" icon={Save} onClick={handleSave} disabled={loading}>
                Save Changes
              </Button>
            </header>
            
            <div className={cx("flex-1 overflow-auto p-6 transition-all pb-24", selectedNodeId && "mr-[400px]")}>
               <HierarchicalTree 
                 items={expansionAirdropToLoadout(containers[selectedContainerIdx].Container, containers[selectedContainerIdx].Loot).items}
                 onUpdate={(newNodes) => updateContainerLoot(selectedContainerIdx, newNodes)}
                 onSelect={(node) => {
                   setSelectedNodeId(node.id);
                   setEditingNode(node);
                 }}
                 onAddTemplate={(nodeId, list) => {
                    setTemplateModalTarget({ nodeId, list });
                    setTemplateModalOpen(true);
                 }}
                 selectedNodeId={selectedNodeId}
                 typeOptions={typeOptions}
                 randomPresets={randomPresets}
                 allLoadouts={loadouts}
               />
            </div>

            {selectedNodeId && editingNode && (
               <div className="fixed top-0 right-0 bottom-0 z-[100] animate-in slide-in-from-right duration-300">
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
                      showVariants: true
                    }}
                  />
               </div>
            )}
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
            <Package size={48} className="text-gray-200 mb-4" />
            <h3 className="text-lg font-bold text-gray-900 dark:text-white">Select a container</h3>
            <p className="text-sm text-gray-500 max-w-xs">Choose an airdrop container from the left to configure its loot contents.</p>
          </div>
        )}
      </div>

      {templateModalOpen && templateModalTarget && (
        <Modal
          isOpen={templateModalOpen}
          onClose={() => setTemplateModalOpen(false)}
          title="Select Template"
          maxWidth="max-w-md"
        >
          <div className="space-y-4">
             <div className="space-y-2">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Available Presets</label>
                <div className="grid grid-cols-1 gap-2 max-h-64 overflow-auto p-1">
                   {(randomPresets?.presets || []).map((p: any, i: number) => (
                     <Button 
                       key={i} 
                       variant="secondary-gray" 
                       className="justify-start font-mono text-xs" 
                       onClick={() => {
                         const newNode: LoadoutNode = {
                           id: crypto.randomUUID(),
                           type: 'template',
                           templateSource: 'preset',
                           name: p.name,
                           chance: 1.0,
                           attachments: [],
                           cargo: []
                         };
                         
                         const loadout = expansionAirdropToLoadout(containers[selectedContainerIdx!].Container, containers[selectedContainerIdx!].Loot);
                         const targetNode = findNode(loadout.items, templateModalTarget.nodeId);
                         
                         if (targetNode) {
                           const updatedNode = {
                             ...targetNode,
                             [templateModalTarget.list]: [...(targetNode[templateModalTarget.list] || []), newNode]
                           };
                           handleUpdateNode(updatedNode);
                         }
                         setTemplateModalOpen(false);
                       }}
                     >
                       <Layers size={14} className="mr-2 text-amber-500" /> {p.name}
                     </Button>
                   ))}
                </div>
             </div>
             {loadouts.length > 0 && (
               <div className="space-y-2 pt-2 border-t border-gray-100 dark:border-gray-800">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Saved Loadouts</label>
                  <div className="grid grid-cols-1 gap-2 max-h-64 overflow-auto p-1">
                    {loadouts.map((l: any, i: number) => (
                      <Button 
                        key={i} 
                        variant="secondary-gray" 
                        className="justify-start font-mono text-xs" 
                        onClick={() => {
                          const newNode: LoadoutNode = {
                            id: crypto.randomUUID(),
                            type: 'template',
                            templateSource: 'loadout',
                            name: l.id,
                            chance: 1.0,
                            attachments: [],
                            cargo: []
                          };
                          
                          const loadout = expansionAirdropToLoadout(containers[selectedContainerIdx!].Container, containers[selectedContainerIdx!].Loot);
                          const targetNode = findNode(loadout.items, templateModalTarget.nodeId);
                          
                          if (targetNode) {
                            const updatedNode = {
                              ...targetNode,
                              [templateModalTarget.list]: [...(targetNode[templateModalTarget.list] || []), newNode]
                            };
                            handleUpdateNode(updatedNode);
                          }
                          setTemplateModalOpen(false);
                        }}
                      >
                        <Package size={14} className="mr-2 text-blue-500" /> {l.label}
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
