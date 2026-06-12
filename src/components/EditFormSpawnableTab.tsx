import React, { useState } from 'react';
import { findSpawnableEntryForType, ROOT_SPAWNABLE_GROUP } from '@/utils/xml';
import { Slider } from '@/components/base/slider/slider';
import { Badge } from '@/components/base/badges/badges';
import { Button } from '@/components/base/button/button';
import { 
  Plus, 
  Trash2, 
  Settings2, 
  Percent, 
  ChevronRight,
  Package,
  AlertCircle 
} from 'lucide-react';
import type { Type } from '@/utils/xml';
import { SpawnableSlotModal } from './SpawnableSlotModal';
import { XMLNodeKind } from '@/types/xml';
import { Loadout, LoadoutNode } from '@/types/loadouts';
import { loadoutNodeToSpawnableSection } from '@/utils/loadouts';

interface EditFormSpawnableTabProps {
  selectedTypes: Type[];
  spawnableTypesByGroup: Record<string, Record<string, any>>;
  setSpawnableTypesByGroup: (next: any) => void;
  randomPresets: { presets: any[] };
  globalsDefaults: { LootDamageMin: number | null; LootDamageMax: number | null };
  typeOptions: string[];
  loadouts: any[];
}

function chancePercent(value: any) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(Math.min(1, Math.max(0, n)) * 1000) / 10 : 0;
}

import { HierarchicalTree } from './hierarchical/HierarchicalTree';
import { HierarchicalProperties } from './hierarchical/HierarchicalProperties';
import { vanillaSpawnableToLoadout, loadoutToSpawnableEntry } from '@/utils/loadouts';
import { updateNodeInList, findNode } from '@/utils/tree';

export default function EditFormSpawnableTab({ 
  selectedTypes, 
  spawnableTypesByGroup, 
  setSpawnableTypesByGroup,
  randomPresets,
  globalsDefaults,
  typeOptions,
  loadouts = []
}: EditFormSpawnableTabProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [editingSlot, setEditingSlot] = useState<{ idx: number; kind: XMLNodeKind.ATTACHMENTS | XMLNodeKind.CARGO } | null>(null);
  const [selectedLoadoutId, setSelectedLoadoutId] = useState<string>('');
  const [viewMode, setViewMode] = useState<'tiles' | 'tree'>('tree');

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [editingNode, setEditingNode] = useState<LoadoutNode | null>(null);
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [templateModalTarget, setTemplateModalTarget] = useState<{nodeId: string, list: 'attachments' | 'cargo'} | null>(null);

  const handleUpdateNode = (updatedNode: LoadoutNode) => {
    const currentLoadout = vanillaSpawnableToLoadout(entry);
    const updatedLoadout = {
      ...currentLoadout,
      items: updateNodeInList(currentLoadout.items, updatedNode)
    };
    
    const nextEntry = loadoutToSpawnableEntry(updatedLoadout);
    if (nextEntry) {
      updateSpawnableEntry(() => ({
        ...nextEntry,
        damage: entry.damage // Preserve damage if it wasn't in the loadout root (it should be)
      }));
    }
    
    if (selectedNodeId === updatedNode.id) {
      setEditingNode(updatedNode);
    }
  };

  const isMulti = selectedTypes.length > 1;

  const type = selectedTypes[0];
  const result = findSpawnableEntryForType(spawnableTypesByGroup, type.group, type.name);

  const effectiveGroup = result ? result.group : (
    (type.group === 'vanilla' || type.group === 'vanilla_overrides') ? ROOT_SPAWNABLE_GROUP : type.group
  );

  const effectiveFile = result?.file || (
    effectiveGroup === ROOT_SPAWNABLE_GROUP ? 'cfgspawnabletypes.xml' : 'spawnabletypes.xml'
  );

  const entry = result?.entry || {
    name: type.name,
    sections: [],
    damage: null,
    attachments: [],
    cargo: []
  };

  const updateSpawnableEntry = (updater: (entry: any) => any) => {
    const nextGroups = { ...spawnableTypesByGroup };
    if (!nextGroups[effectiveGroup]) {
      nextGroups[effectiveGroup] = {};
    }
    const groupFiles = { ...nextGroups[effectiveGroup] };
    if (!groupFiles[effectiveFile]) {
      groupFiles[effectiveFile] = { types: [] };
    }
    const fileData = { ...groupFiles[effectiveFile] };
    const existingIdx = fileData.types.findIndex((t: any) => t.name.toLowerCase() === type.name.toLowerCase());
    
    let currentEntry;
    if (existingIdx === -1) {
      currentEntry = {
        name: type.name,
        sections: [],
        damage: null,
        attachments: [],
        cargo: []
      };
    } else {
      currentEntry = { ...fileData.types[existingIdx] };
    }
    
    const nextEntry = updater(currentEntry);
    
    // Recalculate helper properties
    const damageSection = nextEntry.sections?.find((s: any) => s.kind === XMLNodeKind.DAMAGE);
    nextEntry.damage = damageSection ? {
      min: damageSection.attrs.min !== undefined ? Number(damageSection.attrs.min) : null,
      max: damageSection.attrs.max !== undefined ? Number(damageSection.attrs.max) : null
    } : null;
    nextEntry.attachments = nextEntry.sections?.filter((s: any) => s.kind === XMLNodeKind.ATTACHMENTS) || [];
    nextEntry.cargo = nextEntry.sections?.filter((s: any) => s.kind === XMLNodeKind.CARGO) || [];

    if (existingIdx === -1) {
      fileData.types = [...fileData.types, nextEntry];
    } else {
      fileData.types = fileData.types.map((t: any, i: number) => i === existingIdx ? nextEntry : t);
    }
    
    groupFiles[effectiveFile] = fileData;
    nextGroups[effectiveGroup] = groupFiles;
    setSpawnableTypesByGroup(nextGroups);
  };

  const handleDamageChange = (key: 'min' | 'max', val: number) => {
    const newVal = val / 100;
    const formatted = newVal.toFixed(3);
    
    updateSpawnableEntry(current => {
      const nextSections = [...(current.sections || [])];
      let damageIdx = nextSections.findIndex(s => s.kind === XMLNodeKind.DAMAGE);
      
      if (damageIdx === -1) {
        nextSections.push({
          kind: XMLNodeKind.DAMAGE,
          chance: null,
          preset: '',
          attrs: {
            min: String(globalsDefaults.LootDamageMin ?? '0.000'),
            max: String(globalsDefaults.LootDamageMax ?? '0.000'),
            [key]: formatted
          },
          items: []
        });
      } else {
        nextSections[damageIdx] = {
          ...nextSections[damageIdx],
          attrs: {
            ...nextSections[damageIdx].attrs,
            [key]: formatted
          }
        };
      }
      return { ...current, sections: nextSections };
    });
  };

  const handleAddAttachmentSlot = () => {
    updateSpawnableEntry(current => ({
      ...current,
      sections: [...(current.sections || []), {
        kind: XMLNodeKind.ATTACHMENTS,
        chance: 1.0,
        preset: '',
        attrs: { chance: '1.00' },
        items: []
      }]
    }));
  };

  const handleRemoveSection = (sectionIndexInKind: number, kind: string) => {
    updateSpawnableEntry(current => {
      let count = 0;
      const nextSections = (current.sections || []).filter((s: any) => {
        if (s.kind === kind) {
          if (count === sectionIndexInKind) {
            count++;
            return false;
          }
          count++;
        }
        return true;
      });
      return { ...current, sections: nextSections };
    });
  };

  const handleAddCargo = () => {
    updateSpawnableEntry(current => ({
      ...current,
      sections: [...(current.sections || []), {
        kind: XMLNodeKind.CARGO,
        chance: 1.0,
        preset: '',
        attrs: { chance: '1.00' },
        items: []
      }]
    }));
  };

  const handleEditSlot = (idx: number, kind: XMLNodeKind.ATTACHMENTS | XMLNodeKind.CARGO) => {
    setEditingSlot({ idx, kind });
    setModalOpen(true);
  };

  const handleSaveSlot = (nextSlot: any) => {
    if (!editingSlot) return;
    updateSpawnableEntry(current => {
      let count = 0;
      const nextSections = (current.sections || []).map((s: any) => {
        if (s.kind === editingSlot.kind) {
          if (count === editingSlot.idx) {
            count++;
            return nextSlot;
          }
          count++;
        }
        return s;
      });
      return { ...current, sections: nextSections };
    });
  };

  const handleApplyLoadout = () => {
    const loadout = loadouts.find(l => l.id === selectedLoadoutId);
    if (!loadout) return;

    updateSpawnableEntry(current => {
      const nextSections = [...(current.sections || [])];
      
      // Map root items of the loadout to attachments/cargo
      loadout.items.forEach((itemNode: LoadoutNode) => {
        // We assume top-level items in a loadout are applied as attachments or cargo
        // If they have attachments/cargo themselves, we'd need to flatten or handle it
        // For now, let's treat root items with children as slots
        const kind = itemNode.cargo.length > 0 ? XMLNodeKind.CARGO : XMLNodeKind.ATTACHMENTS;
        nextSections.push(loadoutNodeToSpawnableSection(itemNode, kind));
      });

      return { ...current, sections: nextSections };
    });
    setSelectedLoadoutId('');
  };

  const handleAddDamage = () => {
    handleDamageChange('min', (globalsDefaults.LootDamageMin ?? 0) * 100);
  };

  if (isMulti) {
    return (
      <div className="p-12 text-center bg-gray-50 dark:bg-gray-950/20 rounded-2xl border border-dashed border-gray-200 dark:border-gray-800">
        <div className="size-16 bg-white dark:bg-gray-900 rounded-2xl flex items-center justify-center text-gray-400 mx-auto mb-4 shadow-sm border border-gray-100 dark:border-gray-800">
          <Settings2 size={32} />
        </div>
        <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">Multi-Item Editing Not Supported</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 max-w-md mx-auto">
          Spawnable and cargo configuration is currently only available for single-item selection to ensure configuration accuracy.
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div className="flex items-center justify-between px-4 py-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-900/30 rounded-xl mb-6">
        <div className="flex items-center gap-2">
          <Settings2 size={16} className="text-blue-600 dark:text-blue-400" />
          <span className="text-sm font-medium text-blue-900 dark:text-blue-100">
            Source: <span className="font-bold">{effectiveGroup === ROOT_SPAWNABLE_GROUP ? 'Mission Root' : `Group: ${effectiveGroup}`}</span>
            {(!result) && <span className="ml-2 italic text-xs">(New Entry)</span>}
          </span>
        </div>
        <Badge color={result ? "blue" : "warning"} size="sm">{result ? "Active" : "Virtual"}</Badge>
      </div>

      {/* Loadout Template Section */}
      {loadouts.length > 0 && (
        <section className="p-4 bg-primary-50 dark:bg-primary-900/10 border border-primary-100 dark:border-primary-900/30 rounded-xl">
          <div className="flex items-center gap-2 mb-3">
            <Package size={16} className="text-primary-600 dark:text-primary-400" />
            <h4 className="text-sm font-bold text-primary-900 dark:text-primary-100 text-uppercase tracking-wider">Quick Apply Loadout</h4>
          </div>
          <div className="flex gap-2">
            <select 
              className="flex-1 h-9 px-3 text-sm rounded-lg border border-primary-200 dark:border-primary-800 bg-white dark:bg-gray-900 outline-none focus:ring-2 focus:ring-primary-500"
              value={selectedLoadoutId}
              onChange={e => setSelectedLoadoutId(e.target.value)}
            >
              <option value="">Select a loadout template...</option>
              {loadouts.map(l => (
                <option key={l.id} value={l.id}>{l.label}</option>
              ))}
            </select>
            <Button 
              size="sm" 
              disabled={!selectedLoadoutId}
              onClick={handleApplyLoadout}
            >
              Apply
            </Button>
          </div>
        </section>
      )}

      {/* Damage Section */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <Badge color="brand" size="sm" type="modern">Item Condition</Badge>
        </div>
        {entry.damage ? (
          <div className="grid grid-cols-2 gap-6 bg-gray-50 dark:bg-gray-950/20 p-6 rounded-xl border border-gray-100 dark:border-gray-800">
            <Slider 
              label="Min Damage" 
              value={[chancePercent(entry.damage?.min ?? globalsDefaults.LootDamageMin)]} 
              maxValue={100} 
              step={1}
              onValueChange={(vals) => handleDamageChange('min', vals[0])}
              helperText="Minimum damage when spawned"
            />
            <Slider 
              label="Max Damage" 
              value={[chancePercent(entry.damage?.max ?? globalsDefaults.LootDamageMax)]} 
              maxValue={100} 
              step={1}
              onValueChange={(vals) => handleDamageChange('max', vals[0])}
              helperText="Maximum damage when spawned"
            />
          </div>
        ) : (
          <div className="flex items-center justify-center p-8 bg-gray-50 dark:bg-gray-950/20 border border-dashed border-gray-200 dark:border-gray-800 rounded-xl">
            <Button 
              variant="secondary-gray" 
              icon={Plus} 
              onClick={handleAddDamage}
            >
              Set Spawn Damage
            </Button>
          </div>
        )}
      </section>

      {/* View Toggle */}
      <div className="flex justify-end gap-2 mb-4">
        <Button 
          size="xs" 
          variant={viewMode === 'tiles' ? 'primary' : 'secondary-gray'}
          onClick={() => setViewMode('tiles')}
        >
          Tiles View
        </Button>
        <Button 
          size="xs" 
          variant={viewMode === 'tree' ? 'primary' : 'secondary-gray'}
          onClick={() => setViewMode('tree')}
        >
          Hierarchical View
        </Button>
      </div>

      {viewMode === 'tree' ? (
        <section className="space-y-6">
          <div className="flex items-center gap-2 mb-4">
            <Badge color="brand" size="sm" type="modern">Hierarchical Config</Badge>
          </div>
          
          <div className="p-4 bg-gray-50 dark:bg-gray-950/20 rounded-xl border border-gray-100 dark:border-gray-800 relative">
            <HierarchicalTree 
              items={vanillaSpawnableToLoadout(entry).items}
              onUpdate={(newNodes) => {
                const nextEntry = loadoutToSpawnableEntry({
                  id: crypto.randomUUID(),
                  label: entry.name,
                  items: newNodes,
                  updatedAt: Date.now()
                });
                if (nextEntry) {
                  updateSpawnableEntry(() => ({
                    ...nextEntry,
                    damage: entry.damage
                  }));
                }
              }}
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
              spawnableTypesByGroup={spawnableTypesByGroup}
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
                  title: 'Spawnable Item Properties',
                  showQuantity: false,
                  showDamage: true,
                  showVariants: false
                }}
              />
            </div>
          )}

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
                      {randomPresets.presets.map((p: any, i: number) => (
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
                            
                            const loadout = vanillaSpawnableToLoadout(entry);
                            const targetNode = findNode(loadout.items, nodeId);
                            
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
                              
                              const loadout = vanillaSpawnableToLoadout(entry);
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
        </section>
      ) : (
        <>
          {/* Attachments Section */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Badge color="brand" size="sm" type="modern">Attachments</Badge>
            <span className="text-xs text-gray-400 font-medium">({entry.attachments?.length || 0} slots)</span>
          </div>
          <Button size="sm" variant="secondary-gray" icon={Plus} onClick={handleAddAttachmentSlot}>Add Slot</Button>
        </div>
        
        <div className="space-y-3">
          {entry.attachments?.map((slot: any, idx: number) => (
            <div key={idx} className="flex items-center gap-4 p-4 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl shadow-sm group hover:border-primary-300 dark:hover:border-primary-800 transition-all">
              <div className="size-10 bg-gray-50 dark:bg-gray-950 rounded-lg flex items-center justify-center text-gray-400 shrink-0">
                <Settings2 size={20} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <p className="text-sm font-bold text-gray-900 dark:text-white truncate">Slot {idx + 1}</p>
                  <Badge color="gray" size="sm">{chancePercent(slot.chance)}% Chance</Badge>
                  {slot.preset && <Badge color="blue" size="sm">Preset: {slot.preset}</Badge>}
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                  {slot.items?.length || 0} possible items in this slot
                </p>
              </div>
              <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button size="sm" variant="tertiary" className="p-2" onClick={() => handleEditSlot(idx, XMLNodeKind.ATTACHMENTS)}>
                  <ChevronRight size={18} />
                </Button>
                <Button 
                  size="sm" 
                  variant="tertiary" 
                  className="p-2 text-error-600 hover:text-error-700 hover:bg-error-50 dark:hover:bg-error-900/20"
                  onClick={() => handleRemoveSection(idx, XMLNodeKind.ATTACHMENTS)}
                >
                  <Trash2 size={18} />
                </Button>
              </div>
            </div>
          ))}
          {!entry.attachments?.length && (
            <div className="py-8 text-center text-gray-400 italic bg-gray-50/50 dark:bg-gray-950/10 rounded-xl border border-dashed border-gray-200 dark:border-gray-800">
              No attachment slots configured
            </div>
          )}
        </div>
      </section>

      {/* Cargo Section */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Badge color="brand" size="sm" type="modern">Cargo</Badge>
            <span className="text-xs text-gray-400 font-medium">({entry.cargo?.length || 0} items)</span>
          </div>
          <Button size="sm" variant="secondary-gray" icon={Plus} onClick={handleAddCargo}>Add Cargo</Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {entry.cargo?.map((item: any, idx: number) => (
            <div key={idx} className="flex items-center gap-3 p-3 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl shadow-sm group hover:border-primary-300 dark:hover:border-primary-800 transition-all">
              <div className="size-8 bg-gray-50 dark:bg-gray-950 rounded-lg flex items-center justify-center text-gray-400 shrink-0">
                <Percent size={16} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-gray-900 dark:text-white truncate">Cargo Item {idx + 1}</p>
                <div className="flex items-center gap-2">
                  <p className="text-xs text-gray-500 dark:text-gray-400">{chancePercent(item.chance)}% chance</p>
                  {item.preset && <Badge color="blue" size="xs">Preset: {item.preset}</Badge>}
                </div>
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button 
                  size="sm" 
                  variant="tertiary" 
                  className="p-1.5"
                  onClick={() => handleEditSlot(idx, XMLNodeKind.CARGO)}
                >
                  <ChevronRight size={16} />
                </Button>
                <Button 
                  size="sm" 
                  variant="tertiary" 
                  className="p-1.5 text-error-600 hover:text-error-700 hover:bg-error-50 dark:hover:bg-error-900/20"
                  onClick={() => handleRemoveSection(idx, XMLNodeKind.CARGO)}
                >
                  <Trash2 size={16} />
                </Button>
              </div>
            </div>
          ))}
          {!entry.cargo?.length && (
            <div className="col-span-2 py-8 text-center text-gray-400 italic bg-gray-50/50 dark:bg-gray-950/10 rounded-xl border border-dashed border-gray-200 dark:border-gray-800">
              No cargo configured
            </div>
          )}
        </div>
      </section>

      {modalOpen && editingSlot && (
        <SpawnableSlotModal
          isOpen={modalOpen}
          onClose={() => { setModalOpen(false); setEditingSlot(null); }}
          slot={entry[editingSlot.kind][editingSlot.idx]}
          onSave={handleSaveSlot}
          presets={randomPresets.presets?.filter((p: any) => p.kind === editingSlot.kind) || []}
          typeOptions={typeOptions}
          kind={editingSlot.kind}
        />
      )}
        </>
      )}
    </div>
  );
}
