import React, { useState, useEffect } from 'react';
import { Loadout, LoadoutNode } from '@/types/loadouts';
import { loadAllLoadouts, saveLoadout, deleteLoadout } from '@/utils/idb';
import { Button } from '@/components/base/button/button';
import { Input } from '@/components/base/input/input';
import { Plus, Trash2, Save, Download, Upload, ChevronDown, Package, FileCode, Search, Layers } from 'lucide-react';
import { cx } from '@/utils/cx';
import { Badge } from '@/components/base/badges/badges';
import { HierarchicalTree } from './hierarchical/HierarchicalTree';
import { HierarchicalProperties } from './hierarchical/HierarchicalProperties';
import { updateNodeInList, findNode } from '@/utils/tree';
import { loadoutToExpansionAirdrop, loadoutToVanillaXml, vanillaSpawnableToLoadout, vanillaPresetToLoadout, expansionAirdropToLoadout } from '@/utils/loadouts';
import { Dropdown } from '@/components/base/dropdown/dropdown';
import { Button as AriaButton } from 'react-aria-components';
import { Modal } from '@/components/base/modal/modal';

const formatModName = (name: string) => {
  if (name === 'all') return 'All Spawnable Types';
  if (name === 'vanilla') return 'Vanilla (Root)';
  if (name === 'vanilla_overrides') return 'Vanilla Overrides';
  if (name === '__root') return 'Root';
  
  const lowerCaseParticles = ['and', 'of', 'the', 'in', 'on', 'with', 'by', 'at'];
  
  return name
    .replace(/_/g, ' ')
    .split(' ')
    .map((word, index) => {
      const lower = word.toLowerCase();
      if (index > 0 && lowerCaseParticles.includes(lower)) {
        return lower;
      }
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
};

interface LoadoutDesignerProps {
  onClose: () => void;
  typeOptions: string[];
  randomPresets?: { presets: any[] };
  spawnableTypesByGroup?: Record<string, any>;
  selectedProfileId?: string;
  getApiBase?: () => string;
  loadouts?: Loadout[];
  setLoadouts?: (l: Loadout[]) => void;
}

export const LoadoutDesigner: React.FC<LoadoutDesignerProps> = ({ 
  onClose, 
  typeOptions,
  randomPresets,
  spawnableTypesByGroup,
  selectedProfileId,
  getApiBase,
  loadouts: propLoadouts,
  setLoadouts: propSetLoadouts
}) => {
  const [internalLoadouts, setInternalLoadouts] = useState<Loadout[]>([]);
  
  const loadouts = propLoadouts || internalLoadouts;
  const setLoadouts = propSetLoadouts || setInternalLoadouts;
  const [selectedLoadoutId, setSelectedLoadoutId] = useState<string | null>(null);
  const [editingLoadout, setEditingLoadout] = useState<Loadout | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  
  // Import from existing state
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importSource, setImportSource] = useState<'spawnable' | 'preset' | 'expansion' | 'loadout' | null>(null);
  const [importGroup, setImportGroup] = useState<string | 'all' | 'vanilla'>('all');
  const [importTargetNodeId, setImportTargetNodeId] = useState<string | null>(null);
  const [importTargetList, setImportTargetList] = useState<'attachments' | 'cargo' | null>(null);
  const [importSearch, setImportSearch] = useState('');
  const [expansionAirdrops, setExpansionAirdrops] = useState<any>(null);
  const [loadingAirdrops, setLoadingAirdrops] = useState(false);
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [templateModalTarget, setTemplateModalTarget] = useState<{nodeId: string, list: 'attachments' | 'cargo'} | null>(null);
  const [createModalOpen, setCreateModalOpen] = useState(false);

  useEffect(() => {
    if (!propLoadouts) {
      loadAllLoadouts().then(setInternalLoadouts);
    }
  }, [propLoadouts]);

  const handleCreate = () => {
    const newLoadout: Loadout = {
      id: crypto.randomUUID(),
      label: 'New Loadout',
      items: [],
      updatedAt: Date.now()
    };
    setEditingLoadout(newLoadout);
    setSelectedLoadoutId(newLoadout.id);
  };

  const handleSave = async () => {
    if (!editingLoadout) return;
    await saveLoadout(editingLoadout);
    const all = await loadAllLoadouts();
    setLoadouts(all);
    setEditingLoadout(null);
    setSelectedLoadoutId(null);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this loadout?')) return;
    await deleteLoadout(id);
    const all = await loadAllLoadouts();
    setLoadouts(all);
    if (selectedLoadoutId === id) {
      setEditingLoadout(null);
      setSelectedLoadoutId(null);
    }
  };

  const handleSelect = (l: Loadout) => {
    setEditingLoadout(JSON.parse(JSON.stringify(l)));
    setSelectedLoadoutId(l.id);
    setSelectedNodeId(null);
  };

  const handleUpdateNode = (updated: LoadoutNode) => {
    if (!editingLoadout) return;
    setEditingLoadout({
      ...editingLoadout,
      items: updateNodeInList(editingLoadout.items, updated)
    });
  };

  const handleAddRootItem = () => {
    if (!editingLoadout || editingLoadout.items.length > 0) return;
    const newNode: LoadoutNode = {
      id: crypto.randomUUID(),
      type: 'item',
      name: '',
      chance: 1.0,
      attachments: [],
      cargo: [],
      isExpanded: true
    };

    const updatedItems = editingLoadout.items.map(child => ({
      ...child,
      isExpanded: child.id === selectedNodeId ? false : child.isExpanded
    }));

    setEditingLoadout({
      ...editingLoadout,
      items: [...updatedItems, newNode]
    });
    setSelectedNodeId(newNode.id);
  };

  const handleExport = (format: 'json' | 'expansion' | 'keycards' | 'vanilla') => {
    if (!editingLoadout) return;
    
    let content = '';
    let filename = `${editingLoadout.label.replace(/\s+/g, '_').toLowerCase()}`;
    let type = 'application/json';

    if (format === 'json') {
      content = JSON.stringify(editingLoadout, null, 2);
      filename += '.json';
    } else if (format === 'expansion') {
      const expansionData = loadoutToExpansionAirdrop(editingLoadout, loadouts, randomPresets?.presets, expansionAirdrops);
      content = JSON.stringify(expansionData, null, 2);
      filename += '_expansion.json';
    } else if (format === 'keycards') {
      // Mock keycards format (similar to expansion but different keys)
      const keycardsData = editingLoadout.items.map(i => ({
        ClassName: i.name,
        Chance: i.chance * 100,
        Quantity: i.quantity?.max ?? 1
      }));
      content = JSON.stringify({ Loot: keycardsData }, null, 2);
      filename += '_keycards.json';
    } else if (format === 'vanilla') {
      content = loadoutToVanillaXml(editingLoadout, loadouts, randomPresets?.presets, expansionAirdrops);
      filename += '_spawnable.xml';
      type = 'application/xml';
    }

    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e: any) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e: any) => {
        try {
          const data = JSON.parse(e.target.result);
          if (data.id && data.items) { // Native format
            const imported = { 
              ...data, 
              id: crypto.randomUUID(), 
              updatedAt: Date.now(),
              items: data.items.slice(0, 1)
            };
            setEditingLoadout(imported);
          } else if (Array.isArray(data)) { // Probably expansion
            const imported = expansionAirdropToLoadout('Imported Expansion Airdrop', data);
            setEditingLoadout(imported);
          } else if (data.Loot && Array.isArray(data.Loot)) { // Expansion container or similar
             const imported = expansionAirdropToLoadout(data.Container || 'Imported Expansion Container', data.Loot);
             setEditingLoadout(imported);
          }
        } catch (err) {
          alert('Failed to parse import file');
        }
      };
      reader.readAsText(file);
    };
    input.click();
  };

  const fetchAirdrops = async () => {
    if (expansionAirdrops || loadingAirdrops || !getApiBase || !selectedProfileId) return;
    setLoadingAirdrops(true);
    try {
      const res = await fetch(`${getApiBase()}/api/expansion/airdrop-settings`, {
        headers: { 'X-Profile-ID': selectedProfileId }
      });
      if (res.ok) {
        setExpansionAirdrops(await res.json());
      }
    } catch (e) {
      console.error('Failed to fetch airdrops', e);
    } finally {
      setLoadingAirdrops(false);
    }
  };

  const openImportModal = (
    source: 'spawnable' | 'preset' | 'expansion' | 'loadout', 
    targetNodeId: string | null = null, 
    list: 'attachments' | 'cargo' | null = null,
    group: string | 'all' | 'vanilla' = 'all'
  ) => {
    setImportSource(source);
    setImportGroup(group);
    setImportTargetNodeId(targetNodeId);
    setImportTargetList(list);
    setImportModalOpen(true);
    setImportSearch('');
    if (source === 'expansion') fetchAirdrops();
  };

  const handleImportFromExisting = (data: any) => {
    if (importTargetNodeId && importTargetList) {
      // Import as template node into existing loadout
      const newNode: LoadoutNode = {
        id: crypto.randomUUID(),
        type: 'template',
        templateSource: importSource === 'preset' ? 'preset' : importSource === 'expansion' ? 'airdrop' : importSource === 'spawnable' ? 'spawnable' : 'loadout',
        name: (importSource === 'preset' || importSource === 'expansion' || importSource === 'spawnable') ? data.name : data.id,
        chance: 1.0,
        attachments: [],
        cargo: []
      };

      if (editingLoadout) {
        const targetNode = findNode(editingLoadout.items, importTargetNodeId);
        if (targetNode) {
          const updatedNode = {
            ...targetNode,
            [importTargetList]: [newNode] // "Replace" logic
          };
          handleUpdateNode(updatedNode);
        }
      }
      setImportModalOpen(false);
      return;
    }

    // Original logic for creating new loadout from existing
    let imported: Loadout | null = null;
    if (importSource === 'spawnable') {
      imported = vanillaSpawnableToLoadout(data);
    } else if (importSource === 'preset') {
      imported = vanillaPresetToLoadout(data);
    } else if (importSource === 'expansion') {
      imported = expansionAirdropToLoadout(data.name, data.loot);
    }

    if (imported) {
      setEditingLoadout(imported);
      setSelectedLoadoutId(imported.id);
      setImportModalOpen(false);
    }
  };

  const selectedNode = editingLoadout ? findNode(editingLoadout.items, selectedNodeId || '') : null;

  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-800 overflow-hidden">
      <header className="px-6 py-4 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary-50 dark:bg-primary-900/20 rounded-lg">
            <Package className="text-primary-600 dark:text-primary-400" size={24} />
          </div>
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">Loadout Designer</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">Manage modular loadout templates</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {editingLoadout && (
            <Button onClick={handleSave} variant="primary" size="sm">
              <Save size={16} className="mr-2" />
              Save Loadout
            </Button>
          )}
          <Button onClick={onClose} variant="secondary" size="sm">Close</Button>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar: Loadout List */}
        <aside className="w-80 border-r border-gray-200 dark:border-gray-800 flex flex-col bg-gray-50 dark:bg-gray-900/50">
          <div className="p-4 border-b border-gray-200 dark:border-gray-800 space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
              <Input 
                placeholder="Search loadouts..." 
                className="pl-9" 
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
              />
            </div>
            <Button 
              onClick={() => setCreateModalOpen(true)}
              variant="secondary" 
              className="w-full"
            >
              <Plus size={16} className="mr-2" />
              Create New
            </Button>
          </div>
          <div className="flex-1 overflow-auto p-2 space-y-1">
            {loadouts
              .filter(l => l.label.toLowerCase().includes(searchTerm.toLowerCase()))
              .map(l => (
                <div 
                  key={l.id}
                  onClick={() => handleSelect(l)}
                  className={cx(
                    "group flex items-center justify-between p-3 rounded-lg cursor-pointer transition-colors",
                    selectedLoadoutId === l.id 
                      ? "bg-primary-50 text-primary-700 dark:bg-primary-900/20 dark:text-primary-300"
                      : "hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300"
                  )}
                >
                  <div className="flex items-center gap-3">
                    <FileCode size={18} className="text-gray-400" />
                    <span className="font-medium truncate max-w-[140px]">{l.label}</span>
                  </div>
                  <button 
                    onClick={(e) => { e.stopPropagation(); handleDelete(l.id); }}
                    className="opacity-0 group-hover:opacity-100 p-1 hover:text-error-600 transition-opacity"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
          </div>
        </aside>

        {/* Main Content: Editor */}
        <main className="flex-1 overflow-auto bg-gray-50 dark:bg-gray-950/20 p-6">
          {editingLoadout ? (
            <div className="max-w-4xl mx-auto space-y-6">
              <div className="bg-white dark:bg-gray-900 p-6 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex-1 max-w-md">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Loadout Label</label>
                    <Input 
                      value={editingLoadout.label} 
                      onChange={e => setEditingLoadout({ ...editingLoadout, label: e.target.value })}
                      placeholder="e.g. NATO Sniper Loadout"
                    />
                  </div>
                  <div className="flex gap-2 self-end">
                    <Dropdown.Root>
                      <AriaButton className="inline-flex items-center justify-center rounded-lg font-semibold transition-all focus:outline-none focus:ring-4 focus:ring-primary-100 disabled:opacity-50 disabled:cursor-not-allowed bg-white text-gray-700 hover:bg-gray-50 border border-gray-300 shadow-sm dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700 dark:hover:bg-gray-700 px-3 py-2 text-sm gap-2">
                        <Download size={16} />
                        Export
                        <ChevronDown size={16} />
                      </AriaButton>
                      <Dropdown.Popover>
                        <Dropdown.Menu onAction={(key) => handleExport(key as any)}>
                          <Dropdown.Item id="json" label="Native JSON (.json)" />
                          <Dropdown.Item id="expansion" label="Expansion Airdrop (.json)" />
                          <Dropdown.Item id="keycards" label="Custom Keycards (.json)" />
                          <Dropdown.Item id="vanilla" label="Vanilla Spawnable (.xml)" />
                        </Dropdown.Menu>
                      </Dropdown.Popover>
                    </Dropdown.Root>
                    <Button variant="secondary" size="sm" onClick={handleImport}>
                      <Upload size={16} className="mr-2" />
                      Import
                    </Button>
                  </div>
                </div>
              </div>

              {/* Tree View for Items */}
              <div className="flex gap-6 items-start">
                <div className="flex-1 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden">
                  <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
                    <h3 className="font-bold text-gray-900 dark:text-white">Hierarchical Structure</h3>
                  </div>
                  <div className="p-6 space-y-4 min-h-[400px]">
                    <HierarchicalTree 
                      items={editingLoadout.items}
                      onUpdate={(newNodes) => setEditingLoadout({ ...editingLoadout, items: newNodes })}
                      onSelect={(node) => setSelectedNodeId(node.id)}
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

                    {editingLoadout.items.length === 0 && (
                      <div className="text-center text-gray-500 py-12 flex flex-col items-center gap-4">
                        <Package size={32} className="opacity-20" />
                        <p>No items in this loadout yet.</p>
                        <Button onClick={handleAddRootItem} variant="secondary" size="sm">
                          Add root item
                        </Button>
                      </div>
                    )}
                  </div>
                </div>

                {selectedNodeId && findNode(editingLoadout.items, selectedNodeId) && (
                  <HierarchicalProperties 
                    node={findNode(editingLoadout.items, selectedNodeId)!}
                    onUpdate={handleUpdateNode}
                    onClose={() => setSelectedNodeId(null)}
                    typeOptions={typeOptions}
                    availableTemplates={loadouts.filter(l => l.id !== editingLoadout.id)}
                    randomPresets={randomPresets}
                    expansionAirdrops={expansionAirdrops}
                  />
                )}
              </div>
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-center space-y-4">
              <div className="p-4 bg-gray-100 dark:bg-gray-800 rounded-full">
                <Package size={48} className="text-gray-400" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-gray-900 dark:text-white">No Loadout Selected</h3>
                <p className="text-gray-500 dark:text-gray-400">Select a loadout from the sidebar or create a new one to start designing.</p>
              </div>
              <Button onClick={handleCreate} variant="primary">
                <Plus size={16} className="mr-2" />
                Create New Loadout
              </Button>
            </div>
          )}
        </main>
      </div>

      <Modal
        isOpen={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        title={`Import from ${
          importSource === 'spawnable' 
            ? formatModName(importGroup) 
            : importSource === 'preset' ? 'Random Preset' 
            : importSource === 'expansion' ? 'Expansion Airdrop'
            : 'Saved Loadout'
        }`}
        icon={Plus}
        maxWidth="max-w-2xl"
      >
        <div className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
            <Input 
              placeholder={`Search ${importSource}s...`} 
              className="pl-9" 
              value={importSearch}
              onChange={e => setImportSearch(e.target.value)}
              autoFocus
            />
          </div>

          <div className="max-h-[400px] overflow-auto border border-gray-200 dark:border-gray-800 rounded-lg divide-y divide-gray-200 dark:divide-gray-800">
            {importSource === 'spawnable' && spawnableTypesByGroup && (
              Object.entries(spawnableTypesByGroup)
                .filter(([groupName]) => {
                  if (groupName === '__root') return false;
                  if (importGroup === 'all') return true;
                  if (importGroup === 'vanilla') return groupName === 'vanilla' || groupName === 'vanilla_overrides';
                  return groupName === importGroup;
                })
                .flatMap(([groupName, data]) => 
                  (data.types || [])
                  .filter((t: any) => 
                    t.name.toLowerCase().includes(importSearch.toLowerCase()) && 
                    (t.sections?.length > 1)
                  )
                  .map((t: any) => (
                    <div 
                      key={`${groupName}:${t.name}`}
                      onClick={() => handleImportFromExisting(t)}
                      className="p-3 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer flex items-center justify-between"
                    >
                      <div>
                        <div className="font-medium text-gray-900 dark:text-white">{t.name}</div>
                        <div className="text-xs text-gray-500">{formatModName(groupName)}</div>
                      </div>
                      <Badge color="gray" size="sm">{(t.sections?.length || 0)} sections</Badge>
                    </div>
                  ))
              )
            )}

            {importSource === 'preset' && randomPresets && (
              (randomPresets.presets || [])
                .filter((p: any) => p.name.toLowerCase().includes(importSearch.toLowerCase()))
                .map((p: any) => (
                  <div 
                    key={p.name}
                    onClick={() => handleImportFromExisting(p)}
                    className="p-3 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer flex items-center justify-between"
                  >
                    <div>
                      <div className="font-medium text-gray-900 dark:text-white">{p.name}</div>
                      <div className="text-xs text-gray-500">{p.kind}</div>
                    </div>
                    <Badge color="gray" size="sm">{(p.items?.length || 0)} items</Badge>
                  </div>
                ))
            )}

            {importSource === 'expansion' && (
              loadingAirdrops ? (
                <div className="p-8 text-center text-gray-500">Loading airdrop settings...</div>
              ) : expansionAirdrops?.Containers ? (
                expansionAirdrops.Containers
                  .filter((c: any) => c.Container.toLowerCase().includes(importSearch.toLowerCase()))
                  .map((c: any) => (
                    <div 
                      key={c.Container}
                      onClick={() => handleImportFromExisting({ name: c.Container, loot: c.Loot || [] })}
                      className="p-3 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer flex items-center justify-between"
                    >
                      <div>
                        <div className="font-medium text-gray-900 dark:text-white">{c.Container}</div>
                        <div className="text-xs text-gray-500">Weight: {c.Weight}</div>
                      </div>
                      <Badge color="gray" size="sm">{(c.Loot?.length || 0)} items</Badge>
                    </div>
                  ))
              ) : (
                <div className="p-8 text-center text-gray-500">No airdrop settings found or Expansion not active.</div>
              )
            )}
            {importSource === 'loadout' && (
              loadouts
                .filter(l => l.id !== editingLoadout?.id && l.label.toLowerCase().includes(importSearch.toLowerCase()))
                .map(l => (
                  <div 
                    key={l.id}
                    onClick={() => handleImportFromExisting(l)}
                    className="p-3 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer flex items-center justify-between"
                  >
                    <div>
                      <div className="font-medium text-gray-900 dark:text-white">{l.label}</div>
                      <div className="text-xs text-gray-500">Saved Loadout</div>
                    </div>
                    <Badge color="gray" size="sm">{(l.items?.length || 0)} root items</Badge>
                  </div>
                ))
            )}
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={templateModalOpen}
        onClose={() => setTemplateModalOpen(false)}
        title="Select Template Source"
        icon={Layers}
        maxWidth="max-w-md"
      >
        <div className="grid grid-cols-1 gap-3">
          <button 
            onClick={() => {
              setTemplateModalOpen(false);
              if (templateModalTarget) openImportModal('spawnable', templateModalTarget.nodeId, templateModalTarget.list);
            }}
            className="flex items-center gap-4 p-4 rounded-xl border border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-left"
          >
            <div className="p-3 bg-blue-100 text-blue-600 rounded-lg">
              <Package size={24} />
            </div>
            <div>
              <div className="font-bold text-gray-900 dark:text-white">Spawnable Type</div>
              <div className="text-sm text-gray-500">Inject another item's hierarchy as a template</div>
            </div>
          </button>
          <button 
            onClick={() => {
              setTemplateModalOpen(false);
              if (templateModalTarget) openImportModal('preset', templateModalTarget.nodeId, templateModalTarget.list);
            }}
            className="flex items-center gap-4 p-4 rounded-xl border border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-left"
          >
            <div className="p-3 bg-amber-100 text-amber-600 rounded-lg">
              <FileCode size={24} />
            </div>
            <div>
              <div className="font-bold text-gray-900 dark:text-white">Random Presets</div>
              <div className="text-sm text-gray-500">Vanilla mpmissions/cfgspawnabletypes.xml</div>
            </div>
          </button>

          <button 
            onClick={() => {
              setTemplateModalOpen(false);
              if (templateModalTarget) openImportModal('expansion', templateModalTarget.nodeId, templateModalTarget.list);
            }}
            className="flex items-center gap-4 p-4 rounded-xl border border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-left"
          >
            <div className="p-3 bg-blue-100 text-blue-600 rounded-lg">
              <Package size={24} />
            </div>
            <div>
              <div className="font-bold text-gray-900 dark:text-white">Expansion Airdrops</div>
              <div className="text-sm text-gray-500">ExpansionMod/Settings/AirdropSettings.json</div>
            </div>
          </button>

          <button 
            onClick={() => {
              setTemplateModalOpen(false);
              if (templateModalTarget) openImportModal('loadout', templateModalTarget.nodeId, templateModalTarget.list);
            }}
            className="flex items-center gap-4 p-4 rounded-xl border border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-left"
          >
            <div className="p-3 bg-primary-100 text-primary-600 rounded-lg">
              <Layers size={24} />
            </div>
            <div>
              <div className="font-bold text-gray-900 dark:text-white">Saved Loadouts</div>
              <div className="text-sm text-gray-500">Other modular loadouts you've created</div>
            </div>
          </button>
        </div>
      </Modal>

      <Modal
        isOpen={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        title="Create New Loadout"
        icon={Plus}
        maxWidth="max-w-2xl"
      >
        <div className="space-y-6">
          <button 
            onClick={() => {
              handleCreate();
              setCreateModalOpen(false);
            }}
            className="w-full flex items-center gap-4 p-4 rounded-xl border-2 border-dashed border-gray-200 dark:border-gray-800 hover:border-primary-500 hover:bg-primary-50/50 dark:hover:bg-primary-900/10 transition-all text-left"
          >
            <div className="p-3 bg-primary-100 dark:bg-primary-900/40 text-primary-600 dark:text-primary-400 rounded-lg">
              <Plus size={24} />
            </div>
            <div>
              <div className="font-bold text-gray-900 dark:text-white text-lg">New Empty Loadout</div>
              <div className="text-sm text-gray-500 dark:text-gray-400">Start from scratch and build your own hierarchy</div>
            </div>
          </button>

          <div>
            <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3 px-1">
              Create from Existing Spawnable Type
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button 
                onClick={() => {
                  openImportModal('spawnable', null, null, 'all');
                  setCreateModalOpen(false);
                }}
                className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-left"
              >
                <div className="p-2 bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 rounded-md">
                  <Package size={18} />
                </div>
                <div className="font-medium text-gray-900 dark:text-white">All Spawnable Types</div>
              </button>

              <button 
                onClick={() => {
                  openImportModal('spawnable', null, null, 'vanilla');
                  setCreateModalOpen(false);
                }}
                className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-left"
              >
                <div className="p-2 bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400 rounded-md">
                  <FileCode size={18} />
                </div>
                <div className="font-medium text-gray-900 dark:text-white">Vanilla (Root)</div>
              </button>

              {spawnableTypesByGroup && Object.keys(spawnableTypesByGroup)
                .filter(group => {
                  if (group === 'vanilla' || group === 'vanilla_overrides' || group === '__root') return false;
                  const groupData = spawnableTypesByGroup[group];
                  return groupData?.types?.some((t: any) => t.sections?.length > 1);
                })
                .sort()
                .map(group => (
                  <button 
                    key={group}
                    onClick={() => {
                      openImportModal('spawnable', null, null, group);
                      setCreateModalOpen(false);
                    }}
                    className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-left"
                  >
                    <div className="p-2 bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400 rounded-md">
                      <Package size={18} />
                    </div>
                    <div className="font-medium text-gray-900 dark:text-white">
                      {formatModName(group)}
                    </div>
                  </button>
                ))
              }
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
};
