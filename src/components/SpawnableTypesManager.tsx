import React, { useMemo, useState } from 'react';
import { 
    FileCode,
    Search,
    Plus,
    Trash2,
    AlertTriangle,
    Package,
    Folder
} from 'lucide-react';
import { TableCard } from '@/components/application/table/table';
import { Button } from '@/components/base/button/button';
import { Input } from '@/components/base/input/input';
import { Modal } from '@/components/base/modal/modal';
import { ComboBox, ComboBoxItem } from '@/components/base/combobox/combobox';
import { ROOT_SPAWNABLE_GROUP } from '@/utils/xml';
import { formatModName } from '@/utils/format';
import { HierarchicalTree } from './hierarchical/HierarchicalTree';
import { HierarchicalProperties } from './hierarchical/HierarchicalProperties';
import { vanillaSpawnableToLoadout, loadoutToSpawnableEntry, nodeToStandaloneLoadout } from '@/utils/loadouts';
import { saveLoadout } from '@/utils/loadoutStore';
import { LoadoutNode } from '@/types/loadouts';
import { updateNodeInList, findNode, findParent } from '@/utils/tree';
import { useCompatibleAttachments } from '@/contexts/CatalogContext';

interface SpawnableTypesManagerProps {
    spawnableFilesByGroup: Record<string, string[]>;
    spawnableTypesByGroup: Record<string, Record<string, any>>;
    setSpawnableTypesByGroup: (next: any) => void;
    randomPresets: { presets: any[] };
    globalsDefaults: { LootDamageMin: number | null; LootDamageMax: number | null };
    typeOptions: string[];
    loadouts: any[];
    onViewCle?: (group: string) => void;
}

export function SpawnableTypesManager({ 
    spawnableFilesByGroup, 
    spawnableTypesByGroup,
    setSpawnableTypesByGroup,
    randomPresets,
    typeOptions,
    loadouts,
}: SpawnableTypesManagerProps) {
    const [searchTerm, setSearchTerm] = React.useState('');
    const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
    const [selectedFile, setSelectedFile] = useState<string | null>(null);
    const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
    const [nodes, setNodes] = useState<LoadoutNode[]>([]);
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [nodeToDelete, setNodeToDelete] = useState<string | null>(null);
    const [newTypeName, setNewTypeName] = useState('');
    const lastSavedDataRef = React.useRef<any>(null);
    const listContainerRef = React.useRef<HTMLDivElement>(null);

    const availableGroups = useMemo(() => {
        return Object.keys(spawnableFilesByGroup).sort((a, b) => {
            if (a === ROOT_SPAWNABLE_GROUP) return -1;
            if (b === ROOT_SPAWNABLE_GROUP) return 1;
            return a.localeCompare(b);
        });
    }, [spawnableFilesByGroup]);

    const availableFiles = useMemo(() => {
        if (!selectedGroup) return [];
        return (spawnableFilesByGroup[selectedGroup] || []).map(f => f.split('/').pop()!).sort();
    }, [selectedGroup, spawnableFilesByGroup]);

    // Initialize nodes when group/file selection changes
    React.useEffect(() => {
        if (selectedGroup && selectedFile) {
            const groupData = spawnableTypesByGroup[selectedGroup]?.[selectedFile];
            
            // Avoid re-initializing if the data hasn't changed from what we just saved
            if (groupData === lastSavedDataRef.current && nodes.length > 0) {
                return;
            }

            if (groupData?.types) {
                // Stabilize IDs if possible, but vanillaSpawnableToLoadout will create new ones
                setNodes(groupData.types.map((t: any) => {
                    const l = vanillaSpawnableToLoadout(t);
                    const root = l.items[0];
                    return { ...root, isExpanded: false }; // Default closed accordions
                }));
            } else {
                setNodes([]);
            }
        } else {
            setNodes([]);
        }
        setSelectedNodeId(null);
    }, [selectedGroup, selectedFile, spawnableTypesByGroup]);

    const filteredNodes = useMemo(() => {
        if (!searchTerm) return nodes;
        return nodes.filter(n => n.name.toLowerCase().includes(searchTerm.toLowerCase()));
    }, [nodes, searchTerm]);

    // When an attachment-slot node is selected, restrict its picker to compatible attachments.
    const selectedParentInfo = selectedNodeId ? findParent(nodes, selectedNodeId) : null;
    const attachmentParentName = selectedParentInfo?.list === 'attachments' ? selectedParentInfo.parent?.name : undefined;
    const compatibleClasses = useCompatibleAttachments(attachmentParentName, !!attachmentParentName);

    const handleUpdateNode = (updated: LoadoutNode) => {
        const nextNodes = updateNodeInList(nodes, updated);
        setNodes(nextNodes);
        
        // Only save if it's more than just an expansion toggle
        const originalNode = findNode(nodes, updated.id);
        const isOnlyExpansion = originalNode && 
            JSON.stringify({ ...originalNode, isExpanded: undefined }) === 
            JSON.stringify({ ...updated, isExpanded: undefined });

        if (!isOnlyExpansion) {
            saveNodes(nextNodes);
        }
    };

    const handleUpdateAllNodes = (nextFilteredNodes: LoadoutNode[]) => {
        if (!searchTerm) {
            setNodes(nextFilteredNodes);
            saveNodes(nextFilteredNodes);
            return;
        }

        // When a search term is active, we need to merge the updated filtered nodes 
        // back into the full nodes list while preserving non-matching items.
        // We find the position of the first matching item to use as an insertion point.
        const firstMatchIdx = nodes.findIndex(n => n.name.toLowerCase().includes(searchTerm.toLowerCase()));
        const nonMatchingNodes = nodes.filter(n => !n.name.toLowerCase().includes(searchTerm.toLowerCase()));
        
        const nextNodes = [...nonMatchingNodes];
        const insertIdx = firstMatchIdx === -1 ? nextNodes.length : firstMatchIdx;
        
        // Insert the entire updated filtered list at the insertion point
        nextNodes.splice(insertIdx, 0, ...nextFilteredNodes);

        setNodes(nextNodes);
        saveNodes(nextNodes);
    };

    const saveNodes = (nextNodes: LoadoutNode[]) => {
        if (!selectedGroup || !selectedFile) return;
        const nextGroups = { ...spawnableTypesByGroup };
        const types = nextNodes.map(node => loadoutToSpawnableEntry({ items: [node] } as any));
        
        const nextFileData = {
            ...nextGroups[selectedGroup]?.[selectedFile],
            types
        };

        nextGroups[selectedGroup] = { 
            ...(nextGroups[selectedGroup] || {}),
            [selectedFile]: nextFileData
        };
        
        lastSavedDataRef.current = nextFileData;
        setSpawnableTypesByGroup(nextGroups);
    };

    const handleAddSpawnableType = () => {
        if (!selectedGroup || !selectedFile || !newTypeName) return;
        
        const newNode: LoadoutNode = {
            id: crypto.randomUUID(),
            type: 'item',
            name: newTypeName,
            chance: 1.0,
            attachments: [],
            cargo: [],
            isExpanded: true
        };
        
        const nextNodes = [...nodes, newNode];
        setNodes(nextNodes);
        saveNodes(nextNodes);
        
        setIsAddModalOpen(false);
        setNewTypeName('');
        setSelectedNodeId(newNode.id);

        // The new root is appended to the end of the list; scroll it into view once the
        // updated tree has painted (double rAF so the appended row exists in the DOM).
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                const el = listContainerRef.current;
                if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
            });
        });
    };

    const handleDeleteNode = () => {
        if (!nodeToDelete) return;
        const nextNodes = nodes.filter(n => n.id !== nodeToDelete);
        setNodes(nextNodes);
        saveNodes(nextNodes);
        setIsDeleteModalOpen(false);
        setNodeToDelete(null);
        if (selectedNodeId === nodeToDelete) setSelectedNodeId(null);
    };

    const filteredTypeOptions = useMemo(() => {
        if (!newTypeName) return typeOptions.slice(0, 100);
        return typeOptions.filter(opt => 
            opt.toLowerCase().includes(newTypeName.toLowerCase())
        ).slice(0, 100);
    }, [typeOptions, newTypeName]);

    return (
        <div className="flex flex-col h-full bg-white dark:bg-gray-950 overflow-hidden">
            <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950">
                <div className="flex items-center gap-6">
                    <div>
                        <h1 className="text-display-sm font-semibold text-gray-900 dark:text-white">
                            Spawnable Types
                        </h1>
                        <p className="text-md text-gray-600 dark:text-gray-400">
                            Manage registered spawnable configuration files across CLE groups.
                        </p>
                    </div>

                    <div className="flex items-center gap-3">
                        <div className="w-64">
                            <ComboBox
                                label="Group"
                                placeholder="Select a group..."
                                items={availableGroups.map(group => ({ id: group, name: group }))}
                                selectedKey={selectedGroup}
                                onSelectionChange={(key) => {
                                    setSelectedGroup(key as string);
                                    const files = spawnableFilesByGroup[key as string] || [];
                                    if (files.length === 1) {
                                        setSelectedFile(files[0].split('/').pop()!);
                                    } else {
                                        setSelectedFile(null);
                                    }
                                }}
                            >
                                {(item) => (
                                    <ComboBoxItem id={item.id} textValue={formatModName(item.name)}>
                                        <div className="flex items-center gap-2">
                                            <Folder className="size-4 text-gray-400" />
                                            <span>{formatModName(item.name)}</span>
                                        </div>
                                    </ComboBoxItem>
                                )}
                            </ComboBox>
                        </div>

                        {selectedGroup && availableFiles.length > 1 && (
                            <div className="w-64">
                                <ComboBox
                                    label="File"
                                    placeholder="Select a file..."
                                    items={availableFiles.map(file => ({ id: file, name: file }))}
                                    selectedKey={selectedFile}
                                    onSelectionChange={(key) => setSelectedFile(key as string)}
                                >
                                    {(item) => (
                                        <ComboBoxItem id={item.id} textValue={item.name}>
                                            <div className="flex items-center gap-2">
                                                <FileCode className="size-4 text-gray-400" />
                                                <span>{item.name}</span>
                                            </div>
                                        </ComboBoxItem>
                                    )}
                                </ComboBox>
                            </div>
                        )}
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    {selectedGroup && selectedFile && (
                        <Button 
                            variant="primary" 
                            icon={Plus}
                            onClick={() => setIsAddModalOpen(true)}
                        >
                            Add Root Type
                        </Button>
                    )}
                </div>
            </div>

            <div className="flex-1 flex overflow-hidden">
                <div ref={listContainerRef} className="flex-1 overflow-auto p-6 bg-gray-50 dark:bg-gray-900/50">
                    {selectedGroup && selectedFile ? (
                        <TableCard>
                            <TableCard.Header 
                                title={`${formatModName(selectedGroup)}: ${selectedFile}`}
                                badge={nodes.length}
                                description="Root spawnable types in this file. Expand to manage attachments and cargo."
                                contentTrailing={
                                    <div className="w-80">
                                        <Input 
                                            placeholder="Search root types..." 
                                            icon={Search}
                                            value={searchTerm}
                                            onChange={(e) => setSearchTerm(e.target.value)}
                                        />
                                    </div>
                                }
                            />
                            
                            <div className="p-6">
                                <HierarchicalTree 
                                    items={filteredNodes}
                                    onUpdate={handleUpdateAllNodes}
                                    onSelect={(node) => setSelectedNodeId(node.id)}
                                    onAddTemplate={(_nodeId, _list) => {
                                        // TODO: Implement template adding if needed, 
                                        // or reuse existing modals
                                    }}
                                    selectedNodeId={selectedNodeId}
                                    randomPresets={randomPresets}
                                    spawnableTypesByGroup={spawnableTypesByGroup}
                                    allLoadouts={loadouts}
                                />

                                {filteredNodes.length === 0 && (
                                    <div className="p-12 text-center">
                                        <Package className="size-12 text-gray-300 mx-auto mb-4" />
                                        <p className="text-gray-500 dark:text-gray-400">
                                            {searchTerm ? "No matching spawnable types found." : "No spawnable types in this file."}
                                        </p>
                                    </div>
                                )}
                            </div>
                        </TableCard>
                    ) : (
                        <div className="h-full flex flex-col items-center justify-center text-center space-y-4">
                            <div className="p-4 bg-gray-100 dark:bg-gray-800 rounded-full">
                                <Folder size={48} className="text-gray-400" />
                            </div>
                            <div>
                                <h3 className="text-lg font-bold text-gray-900 dark:text-white">Select a Group and File</h3>
                                <p className="text-gray-500 dark:text-gray-400">Choose a CLE group and a spawnable file to start editing hierarchical structures.</p>
                            </div>
                        </div>
                    )}
                </div>

                {/* Properties Editor Side Panel */}
                {selectedGroup && selectedFile && selectedNodeId && (
                    <div className="w-[600px] border-l border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 flex flex-col animate-in slide-in-from-right">
                        <HierarchicalProperties 
                            node={findNode(nodes, selectedNodeId)!}
                            onUpdate={handleUpdateNode}
                            onClose={() => setSelectedNodeId(null)}
                            onExportAsLoadout={async (node) => {
                                try {
                                    const lo = nodeToStandaloneLoadout(node, [node], loadouts);
                                    await saveLoadout(lo);
                                    alert(`Saved "${lo.label}" to the loadout library.`);
                                } catch (e) {
                                    alert(`Failed to save loadout: ${e instanceof Error ? e.message : e}`);
                                }
                            }}
                            typeOptions={typeOptions}
                            compatibleClasses={compatibleClasses}
                            randomPresets={randomPresets}
                            availableTemplates={loadouts}
                        />
                        <div className="p-4 border-t border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50 flex justify-end">
                            <Button 
                                variant="tertiary" 
                                size="sm" 
                                icon={Trash2} 
                                className="text-error-600 hover:text-error-700"
                                onClick={() => {
                                    setNodeToDelete(selectedNodeId);
                                    setIsDeleteModalOpen(true);
                                }}
                            >
                                Delete Root Type
                            </Button>
                        </div>
                    </div>
                )}
            </div>

            {/* Modals */}
            <Modal 
                isOpen={isAddModalOpen} 
                onClose={() => setIsAddModalOpen(false)}
                title="Add Root Spawnable Type"
            >
                <div className="space-y-4 py-4">
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                        Select a known item from your mission's types.xml to create a new spawnable definition in the <strong>{selectedGroup && formatModName(selectedGroup)}</strong> group.
                    </p>
                    <ComboBox
                        label="Item Name"
                        placeholder="Search for an item..."
                        items={filteredTypeOptions.map(name => ({ id: name, name }))}
                        inputValue={newTypeName}
                        allowsCustomValue
                        onInputChange={setNewTypeName}
                        onSelectionChange={(key) => { if (key) setNewTypeName(key as string); }}
                    >
                        {(item) => <ComboBoxItem id={item.id}>{item.name}</ComboBoxItem>}
                    </ComboBox>
                </div>
                <div className="flex justify-end gap-3 mt-6">
                    <Button variant="secondary" onClick={() => setIsAddModalOpen(false)}>Cancel</Button>
                    <Button 
                        variant="primary" 
                        onClick={handleAddSpawnableType}
                        disabled={!newTypeName}
                    >
                        Add SpawnableType
                    </Button>
                </div>
            </Modal>

            <Modal 
                isOpen={isDeleteModalOpen} 
                onClose={() => setIsDeleteModalOpen(false)}
                title="Delete Spawnable Type"
            >
                <div className="flex items-start gap-4 py-4">
                    <div className="p-2 bg-error-100 dark:bg-error-900/30 rounded-full">
                        <AlertTriangle className="size-6 text-error-600 dark:text-error-400" />
                    </div>
                    <div>
                        <p className="text-sm font-semibold text-gray-900 dark:text-white">Confirm Deletion</p>
                        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                            Are you sure you want to delete the spawnable configuration for <strong>{nodes.find(n => n.id === nodeToDelete)?.name}</strong>? This action cannot be undone.
                        </p>
                    </div>
                </div>
                <div className="flex justify-end gap-3 mt-6">
                    <Button variant="secondary" onClick={() => setIsDeleteModalOpen(false)}>Cancel</Button>
                    <Button variant="primary" className="bg-error-600 hover:bg-error-700 border-error-600" onClick={handleDeleteNode}>
                        Delete
                    </Button>
                </div>
            </Modal>
        </div>
    );
}
