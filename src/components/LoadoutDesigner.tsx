import React, { useState, useEffect } from 'react';
import { Loadout, LoadoutNode } from '@/types/loadouts';
import { loadAllLoadouts, saveLoadout, deleteLoadout } from '@/utils/idb';
import { Button } from '@/components/base/button/button';
import { Input } from '@/components/base/input/input';
import { Plus, Trash2, Save, Download, Upload, ChevronRight, ChevronDown, Package, FileCode, Search, Edit2 } from 'lucide-react';
import { cx } from '@/utils/cx';
import { Badge } from '@/components/base/badges/badges';
import { LoadoutNodeItem } from './LoadoutNodeItem';
import { LoadoutItemProperties } from './LoadoutItemProperties';
import { loadoutToExpansionAirdrop, loadoutToVanillaXml, vanillaSpawnableToLoadout, vanillaPresetToLoadout, expansionAirdropToLoadout } from '@/utils/loadouts';
import { Dropdown } from '@/components/base/dropdown/dropdown';
import { MenuTrigger, Button as AriaButton } from 'react-aria-components';
import { Modal } from '@/components/base/modal/modal';

interface LoadoutDesignerProps {
  onClose: () => void;
  typeOptions: string[];
  randomPresets?: { presets: any[] };
  spawnableTypesByGroup?: Record<string, any>;
  selectedProfileId?: string;
  getApiBase?: () => string;
}

export const LoadoutDesigner: React.FC<LoadoutDesignerProps> = ({ 
  onClose, 
  typeOptions,
  randomPresets,
  spawnableTypesByGroup,
  selectedProfileId,
  getApiBase
}) => {
  const [loadouts, setLoadouts] = useState<Loadout[]>([]);
  const [selectedLoadoutId, setSelectedLoadoutId] = useState<string | null>(null);
  const [editingLoadout, setEditingLoadout] = useState<Loadout | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  
  // Import from existing state
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importSource, setImportSource] = useState<'spawnable' | 'preset' | 'expansion' | null>(null);
  const [importSearch, setImportSearch] = useState('');
  const [expansionAirdrops, setExpansionAirdrops] = useState<any>(null);
  const [loadingAirdrops, setLoadingAirdrops] = useState(false);

  useEffect(() => {
    loadAllLoadouts().then(setLoadouts);
  }, []);

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

  const findAndReplaceNode = (nodes: LoadoutNode[], targetId: string, updated: LoadoutNode): LoadoutNode[] => {
    return nodes.map(node => {
      if (node.id === targetId) return updated;
      return {
        ...node,
        attachments: findAndReplaceNode(node.attachments, targetId, updated),
        cargo: findAndReplaceNode(node.cargo, targetId, updated)
      };
    });
  };

  const findNode = (nodes: LoadoutNode[], targetId: string): LoadoutNode | null => {
    for (const node of nodes) {
      if (node.id === targetId) return node;
      const found = findNode([...node.attachments, ...node.cargo], targetId);
      if (found) return found;
    }
    return null;
  };

  const handleUpdateNode = (updated: LoadoutNode) => {
    if (!editingLoadout) return;
    setEditingLoadout({
      ...editingLoadout,
      items: findAndReplaceNode(editingLoadout.items, updated.id, updated)
    });
  };

  const handleAddRootItem = () => {
    if (!editingLoadout) return;
    const newNode: LoadoutNode = {
      id: crypto.randomUUID(),
      type: 'item',
      name: 'New Item',
      chance: 1.0,
      attachments: [],
      cargo: []
    };
    setEditingLoadout({
      ...editingLoadout,
      items: [...editingLoadout.items, newNode]
    });
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
      const expansionData = loadoutToExpansionAirdrop(editingLoadout, loadouts);
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
      content = loadoutToVanillaXml(editingLoadout, loadouts);
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
            const imported = { ...data, id: crypto.randomUUID(), updatedAt: Date.now() };
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

  const openImportModal = (source: 'spawnable' | 'preset' | 'expansion') => {
    setImportSource(source);
    setImportModalOpen(true);
    setImportSearch('');
    if (source === 'expansion') fetchAirdrops();
  };

  const handleImportFromExisting = (data: any) => {
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
            <Dropdown.Root>
              <AriaButton className="w-full inline-flex items-center justify-center rounded-lg font-semibold transition-all focus:outline-none focus:ring-4 focus:ring-primary-100 disabled:opacity-50 disabled:cursor-not-allowed bg-white text-gray-700 hover:bg-gray-50 border border-gray-300 shadow-sm dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700 dark:hover:bg-gray-700 px-3 py-2 text-sm gap-2">
                <Plus size={16} />
                Create New
                <ChevronDown size={16} className="ml-auto" />
              </AriaButton>
              <Dropdown.Popover>
                <Dropdown.Menu onAction={(key) => {
                  if (key === 'new') handleCreate();
                  else openImportModal(key as any);
                }}>
                  <Dropdown.Item id="new" label="New Empty Loadout" />
                  <Dropdown.Section title="Create from Existing">
                    <Dropdown.Item id="spawnable" label="Vanilla Spawnable" />
                    <Dropdown.Item id="preset" label="Random Preset" />
                    <Dropdown.Item id="expansion" label="Expansion Airdrop" />
                  </Dropdown.Section>
                </Dropdown.Menu>
              </Dropdown.Popover>
            </Dropdown.Root>
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
                    {!editingLoadout.config?.limitToSingleRoot && (
                      <Button onClick={handleAddRootItem} variant="secondary" size="sm">
                        <Plus size={16} className="mr-2" />
                        Add Root Item
                      </Button>
                    )}
                  </div>
                  <div className="p-6 space-y-4 min-h-[400px]">
                    {editingLoadout.items.length > 0 ? (
                      editingLoadout.items.map((item, idx) => (
                        <LoadoutNodeItem 
                          key={item.id}
                          node={item}
                          onUpdate={(updated) => handleUpdateNode(updated)}
                          onDelete={() => {
                            const nextItems = [...editingLoadout.items];
                            nextItems.splice(idx, 1);
                            setEditingLoadout({ ...editingLoadout, items: nextItems });
                          }}
                          onSelect={(node) => setSelectedNodeId(node.id)}
                          selectedNodeId={selectedNodeId}
                        />
                      ))
                    ) : (
                      <div className="text-center text-gray-500 py-12 flex flex-col items-center gap-4">
                        <Package size={32} className="opacity-20" />
                        <p>No items in this loadout yet.</p>
                        <Button onClick={handleAddRootItem} variant="secondary" size="sm">
                          Add your first item
                        </Button>
                      </div>
                    )}
                  </div>
                </div>

                {selectedNode && (
                  <LoadoutItemProperties 
                    node={selectedNode}
                    onUpdate={handleUpdateNode}
                    onClose={() => setSelectedNodeId(null)}
                    typeOptions={typeOptions}
                    availableTemplates={loadouts.filter(l => l.id !== editingLoadout.id)}
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
        title={`Import from ${importSource === 'spawnable' ? 'Vanilla Spawnable' : importSource === 'preset' ? 'Random Preset' : 'Expansion Airdrop'}`}
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
              Object.entries(spawnableTypesByGroup).flatMap(([group, data]) => 
                (data.types || [])
                  .filter((t: any) => 
                    t.name.toLowerCase().includes(importSearch.toLowerCase()) && 
                    (t.sections?.length > 1)
                  )
                  .map((t: any) => (
                    <div 
                      key={`${group}:${t.name}`}
                      onClick={() => handleImportFromExisting(t)}
                      className="p-3 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer flex items-center justify-between"
                    >
                      <div>
                        <div className="font-medium text-gray-900 dark:text-white">{t.name}</div>
                        <div className="text-xs text-gray-500">{group}</div>
                      </div>
                      <Badge variant="gray" size="sm">{(t.sections?.length || 0)} sections</Badge>
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
                    <Badge variant="gray" size="sm">{(p.items?.length || 0)} items</Badge>
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
                      <Badge variant="gray" size="sm">{(c.Loot?.length || 0)} items</Badge>
                    </div>
                  ))
              ) : (
                <div className="p-8 text-center text-gray-500">No airdrop settings found or Expansion not active.</div>
              )
            )}
          </div>
        </div>
      </Modal>
    </div>
  );
};
