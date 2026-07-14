import React, { useState } from 'react';
import { Modal } from '@/components/base/modal/modal';
import { Button } from '@/components/base/button/button';
import { Input } from '@/components/base/input/input';
import { Badge } from '@/components/base/badges/badges';
import { Slider } from '@/components/base/slider/slider';
import { Plus, Trash2, Copy, Layers, Search, AlertTriangle, ChevronRight, Package } from 'lucide-react';
import { cx } from '@/utils/cx';
import { XMLNodeKind } from '@/types/xml';

import { Select } from '@/components/base/select/select';

interface PresetItem {
  kind: string;
  name: string;
  chance: number | null;
  attrs: Record<string, string>;
  attachments?: LoadoutNode[];
  cargo?: LoadoutNode[];
}

interface Preset {
  kind: string;
  name: string;
  chance: number | null;
  attrs: Record<string, string>;
  items: PresetItem[];
}

interface RandomPresetsModalProps {
  onClose: () => void;
  randomPresets: { presets: Preset[] };
  setRandomPresets: (next: any) => void;
  spawnableTypesByGroup?: Record<string, Record<string, any>>;
  setSpawnableTypesByGroup?: (next: any) => void;
  inline?: boolean;
  typeOptions?: string[];
  loadouts?: any[];
}

function chancePercent(value: any) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(Math.min(1, Math.max(0, n)) * 1000) / 10 : 0;
}

function fromPercent(value: any) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n / 100)) : 0;
}

import { HierarchicalTree } from './hierarchical/HierarchicalTree';
import { HierarchicalProperties } from './hierarchical/HierarchicalProperties';
import { LoadoutNode } from '@/types/loadouts';

import { updateNodeInList, findNode } from '@/utils/tree';

export const RandomPresetsModal: React.FC<RandomPresetsModalProps> = ({
  onClose,
  randomPresets,
  setRandomPresets,
  spawnableTypesByGroup = {},
  setSpawnableTypesByGroup = () => {},
  inline = false,
  typeOptions = [],
  loadouts = []
}) => {
  const presets = randomPresets?.presets || [];
  const presetNames = new Set(presets.map(p => p.name).filter(Boolean));
  const [pendingDelete, setPendingDelete] = useState<{ index: number; name: string; refs: number } | null>(null);
  const [pendingRename, setPendingRename] = useState<{ index: number; oldName: string; newName: string; refs: number } | null>(null);
  const [transferOnDelete, setTransferOnDelete] = useState(false);
  const [updateRefsOnRename, setUpdateRefsOnRename] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [localName, setLocalName] = useState<{ index: number; name: string } | null>(null);
  const [expandedNames, setExpandedNames] = useState<Set<string>>(new Set());
  
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [editingNode, setEditingNode] = useState<LoadoutNode | null>(null);
  const [editingPresetIndex, setEditingPresetIndex] = useState<number | null>(null);
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [templateModalTarget, setTemplateModalTarget] = useState<{index: number, nodeId: string, list: 'attachments' | 'cargo'} | null>(null);

  const handleUpdateNode = (updatedNode: LoadoutNode, presetIndex: number) => {
    updatePreset(presetIndex, p => ({
      ...p,
      items: nodesToItems(updateNodeInList(itemsToNodes(p.items), updatedNode))
    }));
    if (selectedNodeId === updatedNode.id) {
      setEditingNode(updatedNode);
    }
  };

  const toggleExpand = (name: string) => {
    setExpandedNames(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const itemsToNodes = (items: PresetItem[]): LoadoutNode[] => {
    return (items || []).map(item => {
      // A nested `<preset .../>` reference (kind === 'preset') maps to a template node;
      // a plain `<item .../>` maps to an item node. (The name attribute holds either name.)
      const isPreset = item.kind === 'preset';
      return {
        id: crypto.randomUUID(),
        type: isPreset ? 'template' : 'item',
        templateSource: isPreset ? 'preset' : undefined,
        name: item.name,
        chance: item.chance ?? 1.0,
        attachments: item.attachments || [],
        cargo: item.cargo || [],
        isExpanded: false
      };
    });
  };

  const nodesToItems = (nodes: LoadoutNode[]): PresetItem[] => {
    return nodes.map(node => ({
      // Preserve the item/preset distinction via `kind` — this is what the serializer
      // (generateRandomPresetsXml) reads to emit <item> vs <preset>. name/chance are
      // re-applied by the serializer, so attrs can stay empty here.
      kind: node.type === 'template' ? 'preset' : 'item',
      name: node.name,
      chance: node.chance,
      attrs: {},
      attachments: node.attachments,
      cargo: node.cargo
    }));
  };

  const updatePreset = (index: number, apply: (p: Preset) => Preset) => {
    setRandomPresets((prev: any) => {
      const nextPresets = [...(prev?.presets || [])];
      if (nextPresets[index]) {
        nextPresets[index] = apply(nextPresets[index]);
      }
      return { ...prev, presets: nextPresets };
    });
  };

  const renamePresetReferences = (oldName: string, newName: string) => {
    if (!oldName || !newName || oldName === newName) return;
    
    // Update spawnable types
    setSpawnableTypesByGroup((prev: any) => {
      const next = { ...prev };
      for (const group in next) {
        for (const file in next[group]) {
          if (next[group][file]?.types) {
            next[group][file] = {
              ...next[group][file],
              types: next[group][file].types.map((type: any) => ({
                ...type,
                sections: (type.sections || []).map((section: any) => section.preset === oldName
                  ? { ...section, preset: newName, attrs: { ...(section.attrs || {}), preset: newName } }
                  : section)
              }))
            };
          }
        }
      }
      return next;
    });

    // Update other presets' references in cfgrandompresets.xml
    setRandomPresets((prev: any) => {
      if (!prev?.presets) return prev;
      return {
        ...prev,
        presets: prev.presets.map((p: Preset) => ({
          ...p,
          items: (p.items || []).map((item: PresetItem) => 
            ((item.kind === XMLNodeKind.ATTACHMENTS || item.kind === XMLNodeKind.CARGO) && item.name === oldName)
              ? { ...item, name: newName, attrs: { ...(item.attrs || {}), name: newName } }
              : item
          )
        }))
      };
    });
  };

  const handleRename = (index: number, oldName: string, newName?: string) => {
    if (!newName || oldName === newName) {
      setLocalName(null);
      return;
    }

    const refs = countReferences(oldName);
    if (refs > 0) {
      setPendingRename({ index, oldName, newName, refs });
      setUpdateRefsOnRename(true);
    } else {
      // Just update it directly if no references
      updatePreset(index, p => ({ ...p, name: newName, attrs: { ...(p.attrs || {}), name: newName } }));
      setLocalName(null);
      
      // Update expanded names to follow the rename
      setExpandedNames(prev => {
        const next = new Set(prev);
        if (next.has(oldName)) {
          next.delete(oldName);
          next.add(newName);
        }
        return next;
      });
    }
  };

  const confirmRename = () => {
    if (!pendingRename) return;
    const { index, oldName, newName } = pendingRename;

    if (updateRefsOnRename) {
      renamePresetReferences(oldName, newName);
    }

    // Update the preset itself in the main presets list
    updatePreset(index, p => ({ ...p, name: newName, attrs: { ...(p.attrs || {}), name: newName } }));

    // Update expanded names to follow the rename
    setExpandedNames(prev => {
      const next = new Set(prev);
      if (next.has(oldName)) {
        next.delete(oldName);
        next.add(newName);
      }
      return next;
    });

    setPendingRename(null);
    setLocalName(null);
  };

  const transferPresetToReferences = (preset: Preset) => {
    if (!preset?.name) return;
    setSpawnableTypesByGroup((prev: any) => {
      const next = { ...prev };
      for (const group in next) {
        for (const file in next[group]) {
          if (next[group][file]?.types) {
            next[group][file] = {
              ...next[group][file],
              types: next[group][file].types.map((type: any) => ({
                ...type,
                sections: (type.sections || []).map((section: any) => section.preset === preset.name
                  ? {
                    ...section,
                    preset: '',
                    chance: preset.chance ?? section.chance,
                    attrs: { ...(section.attrs || {}), preset: '', chance: String(preset.chance ?? section.chance ?? '') },
                    items: (preset.items || []).map(item => ({ ...item, attrs: { ...(item.attrs || {}) } }))
                  }
                  : section)
              }))
            };
          }
        }
      }
      return next;
    });
  };

  const countReferences = (name: string) => {
    let total = 0;
    // References in spawnable types
    for (const group in spawnableTypesByGroup) {
      for (const file in spawnableTypesByGroup[group]) {
        const data = spawnableTypesByGroup[group][file];
        if (data?.types) {
          for (const type of data.types) {
            if (type.sections) {
              total += type.sections.filter((s: any) => s.preset === name).length;
            }
          }
        }
      }
    }
    // References in other presets (cfgrandompresets.xml)
    for (const p of presets) {
      if (p.items) {
        total += p.items.filter(item => 
          (item.kind === XMLNodeKind.ATTACHMENTS || item.kind === XMLNodeKind.CARGO) && item.name === name
        ).length;
      }
    }
    return total;
  };

  const addPreset = () => {
    let i = presets.length + 1;
    let name = `NewPreset${i}`;
    while (presetNames.has(name)) {
      i += 1;
      name = `NewPreset${i}`;
    }
    setRandomPresets({
      ...randomPresets,
      presets: [...presets, { kind: XMLNodeKind.ATTACHMENTS, name, chance: 1, attrs: { name, chance: '1' }, items: [] }]
    });
    setExpandedNames(prev => new Set(prev).add(name));
  };

  const duplicatePreset = (preset: Preset) => {
    let i = 2;
    let name = `${preset.name}_copy`;
    while (presetNames.has(name)) {
      name = `${preset.name}_copy${i}`;
      i += 1;
    }
    setRandomPresets({
      ...randomPresets,
      presets: [...presets, { ...preset, name, attrs: { ...(preset.attrs || {}), name }, items: (preset.items || []).map(item => ({ ...item, attrs: { ...(item.attrs || {}) } })) }]
    });
    setExpandedNames(prev => new Set(prev).add(name));
  };

  const requestRemovePreset = (index: number) => {
    const preset = presets[index];
    const refs = countReferences(preset?.name || '');
    setPendingDelete({ index, name: preset?.name || '', refs });
    setTransferOnDelete(false);
  };

  const confirmRemovePreset = () => {
    if (!pendingDelete) return;
    const preset = presets[pendingDelete.index];
    if (!preset) {
      setPendingDelete(null);
      return;
    }
    if (pendingDelete.refs && transferOnDelete) transferPresetToReferences(preset);
    const nextPresets = presets.filter((_, i) => i !== pendingDelete.index);
    setRandomPresets({ ...randomPresets, presets: nextPresets });
    setExpandedNames(prev => {
      const next = new Set(prev);
      next.delete(preset.name);
      return next;
    });
    setPendingDelete(null);
    setTransferOnDelete(false);
  };

  const filteredPresets = searchTerm 
    ? presets.map((p, i) => ({ ...p, originalIndex: i })).filter(p => p.name.toLowerCase().includes(searchTerm.toLowerCase()))
    : presets.map((p, i) => ({ ...p, originalIndex: i }));

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title="Random Loot Presets"
      description="Define groups of items that can be referenced by spawnable types configuration."
      icon={Layers}
      maxWidth="max-w-4xl"
      footer={<Button variant="primary" onClick={onClose}>Done</Button>}
      inline={inline}
    >
      <div className="space-y-6 relative">
        {selectedNodeId && editingNode && editingPresetIndex !== null && (
          <div className="fixed top-0 right-0 bottom-0 z-[100] animate-in slide-in-from-right duration-300">
            <HierarchicalProperties 
              node={editingNode}
              onUpdate={(updated) => handleUpdateNode(updated, editingPresetIndex)}
              onClose={() => setSelectedNodeId(null)}
              typeOptions={typeOptions}
              availableTemplates={loadouts}
              randomPresets={randomPresets}
              config={{
                title: 'Preset Item Properties',
                showQuantity: false,
                showDamage: false,
                showVariants: false
              }}
            />
          </div>
        )}

        <div className="flex items-center justify-between gap-4">
          <div className="flex-1 max-w-sm">
            <Input
              placeholder="Search presets..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              icon={Search}
              size="sm"
            />
          </div>
          <Button variant="primary" size="sm" icon={Plus} onClick={addPreset}>
            Add Preset Group
          </Button>
        </div>

        {pendingDelete && (
          <div className="p-4 bg-error-50 dark:bg-error-900/20 border border-error-200 dark:border-error-800 rounded-xl space-y-4">
            <div className="flex gap-3">
              <AlertTriangle className="text-error-600 shrink-0" size={20} />
              <div>
                <h4 className="text-sm font-bold text-error-900 dark:text-error-100">Delete preset “{pendingDelete.name}”?</h4>
                {pendingDelete.refs > 0 ? (
                  <div className="mt-2 space-y-3">
                    <p className="text-sm text-error-700 dark:text-error-300">
                      This preset is referenced by {pendingDelete.refs} entry/entries in spawnable types.
                    </p>
                    <label className="flex items-center gap-2 cursor-pointer group">
                      <input 
                        type="checkbox" 
                        className="rounded border-error-300 text-error-600 focus:ring-error-500"
                        checked={transferOnDelete} 
                        onChange={e => setTransferOnDelete(e.target.checked)} 
                      />
                      <span className="text-xs text-error-800 dark:text-error-200">
                        Transfer this preset's items directly into referencing entries before deleting.
                      </span>
                    </label>
                  </div>
                ) : (
                  <p className="text-sm text-error-700 dark:text-error-300 mt-1">This preset is unused.</p>
                )}
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="secondary-gray" size="sm" onClick={() => setPendingDelete(null)}>Cancel</Button>
              <Button variant="error" size="sm" onClick={confirmRemovePreset}>Delete Permanently</Button>
            </div>
          </div>
        )}

        {pendingRename && (
          <div className="p-4 bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-800 rounded-xl space-y-4">
            <div className="flex gap-3">
              <AlertTriangle className="text-primary-600 shrink-0" size={20} />
              <div>
                <h4 className="text-sm font-bold text-primary-900 dark:text-primary-100">Rename preset “{pendingRename.oldName}”?</h4>
                <div className="mt-2 space-y-3">
                  <p className="text-sm text-primary-700 dark:text-primary-300">
                    This preset is referenced by {pendingRename.refs} entry/entries.
                  </p>
                  <label className="flex items-center gap-2 cursor-pointer group">
                    <input 
                      type="checkbox" 
                      className="rounded border-primary-300 text-primary-600 focus:ring-primary-500"
                      checked={updateRefsOnRename} 
                      onChange={e => setUpdateRefsOnRename(e.target.checked)} 
                    />
                    <span className="text-xs text-primary-800 dark:text-primary-200">
                      Update all references to use the new name “{pendingRename.newName}”.
                    </span>
                  </label>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="secondary-gray" size="sm" onClick={() => { setPendingRename(null); setLocalName(null); }}>Cancel</Button>
              <Button variant="primary" size="sm" onClick={confirmRename}>Rename & Update</Button>
            </div>
          </div>
        )}

        <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-2 scrollbar-thin">
          {filteredPresets.map((preset) => {
            const index = preset.originalIndex;
            const refs = countReferences(preset.name);
            const isExpanded = expandedNames.has(preset.name);

            return (
              <div key={`${preset.kind}-${preset.name}-${index}`} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-sm overflow-hidden">
                <div 
                  className={cx(
                    "flex items-center justify-between gap-4 p-4 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors",
                    isExpanded && "border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/20"
                  )}
                  onClick={() => toggleExpand(preset.name)}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={cx(
                      "p-1 rounded-lg transition-colors",
                      isExpanded ? "bg-primary-50 text-primary-600 dark:bg-primary-900/20 dark:text-primary-400" : "bg-gray-100 text-gray-400 dark:bg-gray-800"
                    )}>
                      <ChevronRight className={cx("size-4 transition-transform duration-200", isExpanded && "rotate-90")} />
                    </div>
                    <div className="flex flex-col min-w-0">
                      <span className="font-semibold text-sm text-gray-900 dark:text-gray-100 truncate">{preset.name}</span>
                      <div className="flex items-center gap-2 mt-0.5">
                        <Badge color={preset.kind === XMLNodeKind.ATTACHMENTS ? 'blue' : 'orange'} size="sm">
                          {preset.kind}
                        </Badge>
                        <Badge color={refs > 0 ? 'blue' : 'gray'} size="sm">
                          {refs ? `${refs} reference${refs === 1 ? '' : 's'}` : 'unused'}
                        </Badge>
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                    <Button variant="tertiary" size="sm" icon={Copy} className="p-2" onClick={() => duplicatePreset(preset)} />
                    <Button variant="tertiary" size="sm" icon={Trash2} className="p-2 text-error-400 hover:text-error-600 dark:text-gray-500 dark:hover:text-error-400" onClick={() => requestRemovePreset(index)} />
                  </div>
                </div>

                {isExpanded && (
                  <div className="p-5 space-y-6">
                    <div className="grid grid-cols-3 gap-4">
                      <Input
                        label="Preset Name"
                        value={localName?.index === index ? localName.name : preset.name}
                        onChange={e => setLocalName({ index, name: e.target.value })}
                        onBlur={() => handleRename(index, preset.name, localName?.name)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            handleRename(index, preset.name, localName?.name);
                            (e.target as HTMLInputElement).blur();
                          }
                        }}
                        size="sm"
                      />
                      <Select
                        label="XML Node Kind"
                        value={preset.kind}
                        size="sm"
                        onChange={e => updatePreset(index, p => ({ ...p, kind: e.target.value as XMLNodeKind }))}
                        options={[
                          { label: 'Attachments', value: XMLNodeKind.ATTACHMENTS },
                          { label: 'Cargo', value: XMLNodeKind.CARGO }
                        ]}
                      />
                      <Slider
                        label={`Group Chance (${chancePercent(preset.chance)}%)`}
                        value={chancePercent(preset.chance)}
                        onChange={v => updatePreset(index, p => ({ 
                          ...p, 
                          chance: fromPercent(v), 
                          attrs: { ...(p.attrs || {}), chance: String(fromPercent(v)) } 
                        }))}
                        minValue={0}
                        maxValue={100}
                        suffix="%"
                      />
                    </div>

                    <div className="space-y-3 p-4 bg-gray-50 dark:bg-gray-950/20 rounded-xl border border-gray-100 dark:border-gray-800">
                      <div className="flex items-center justify-between mb-2">
                        <h5 className="text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Preset Items</h5>
                        <Button variant="secondary-gray" size="xs" icon={Plus} onClick={() => {
                          const newNode: LoadoutNode = {
                            id: crypto.randomUUID(),
                            type: 'item',
                            name: '',
                            chance: 1.0,
                            attachments: [],
                            cargo: []
                          };
                          updatePreset(index, p => ({
                            ...p,
                            items: nodesToItems([...itemsToNodes(p.items), newNode])
                          }));
                          setSelectedNodeId(newNode.id);
                          setEditingNode(newNode);
                          setEditingPresetIndex(index);
                        }}>
                          Add Item
                        </Button>
                      </div>
                      
                      <HierarchicalTree 
                        items={itemsToNodes(preset.items)}
                        onUpdate={(newNodes) => {
                          updatePreset(index, p => ({
                            ...p,
                            items: nodesToItems(newNodes)
                          }));
                        }}
                        onSelect={(node) => {
                          setSelectedNodeId(node.id);
                          setEditingNode(node);
                          setEditingPresetIndex(index);
                        }}
                        onAddTemplate={(nodeId, list) => {
                          setTemplateModalTarget({ index, nodeId, list });
                          setTemplateModalOpen(true);
                        }}
                        selectedNodeId={selectedNodeId}
                        randomPresets={randomPresets}
                        allLoadouts={loadouts}
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {filteredPresets.length === 0 && (
            <div className="py-20 text-center bg-gray-50 dark:bg-gray-950/20 rounded-2xl border border-dashed border-gray-200 dark:border-gray-800">
              <Layers className="size-12 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500 dark:text-gray-400">No presets found matching your search.</p>
            </div>
          )}
        </div>
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
                   {presets.map((p, i) => (
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
                         
                         const currentPreset = presets[templateModalTarget.index];
                         const nodes = itemsToNodes(currentPreset.items);
                         const targetNode = findNode(nodes, templateModalTarget.nodeId);
                         
                         if (targetNode) {
                           const updatedNode = {
                             ...targetNode,
                             [templateModalTarget.list]: [...(targetNode[templateModalTarget.list] || []), newNode]
                           };
                           handleUpdateNode(updatedNode, templateModalTarget.index);
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
                    {loadouts.map((l, i) => (
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
                          
                          const currentPreset = presets[templateModalTarget.index];
                          const nodes = itemsToNodes(currentPreset.items);
                          const targetNode = findNode(nodes, templateModalTarget.nodeId);
                          
                          if (targetNode) {
                            const updatedNode = {
                              ...targetNode,
                              [templateModalTarget.list]: [...(targetNode[templateModalTarget.list] || []), newNode]
                            };
                            handleUpdateNode(updatedNode, templateModalTarget.index);
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
    </Modal>
  );
};
