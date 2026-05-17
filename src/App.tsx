import React, { useMemo, useRef, useState, useEffect } from 'react';
import { useLootData } from './hooks/useLootData.js';
import Filters from './components/Filters';
import TypesTable from './components/TypesTable';
import EditForm from './components/EditForm';
import ExportModal from './components/ExportModal.jsx';
import UnknownEntriesModal from './components/UnknownEntriesModal.jsx';
import SummaryModal from './components/SummaryModal.jsx';
import { ManageDefinitionsModal } from './components/ManageDefinitionsModal.jsx';
import StorageStatusModal from './components/StorageStatusModal.jsx';
import RandomPresetsModal from './components/RandomPresetsModal.jsx';
import EditorLogin from './components/EditorLogin.jsx';
import AdmRecordsModal from './components/AdmRecordsModal.jsx';
import ExpansionLogModal from './components/ExpansionLogModal.jsx';
import StashReportModal from './components/StashReportModal.jsx';
import TraderEditorModal from './components/TraderEditorModal.jsx';
import LintFilesModal from './components/LintFilesModal.jsx';
import MarketCategoryEditorModal from './components/MarketCategoryEditorModal.jsx';
import ProfileManager from './components/ProfileManager.jsx';
import AddonEditorModal from './components/AddonEditorModal.jsx';
import HeatMapModal from './components/HeatMapModal.jsx';
import { 
  generateTypesXml, 
  generateLimitsXml, 
  generateRandomPresetsXml, 
  generateSpawnableTypesXml, 
  ROOT_SPAWNABLE_GROUP, 
  validateSpawnableReferences 
} from './utils/xml.js';

import { Sidebar } from './components/layout/Sidebar';
import { Button } from '@/components/base/button/button';
import { Badge } from '@/components/base/badges/badges';
import { cx } from './utils/cx';
import { 
    Undo, 
    Redo, 
    Save, 
    Download, 
    RefreshCw, 
    AlertTriangle, 
    ExternalLink,
    Search as SearchIcon,
    Filter,
    X
} from 'lucide-react';
import type { Type } from './utils/xml';

const KNOWN_ADDONS = [
    { id: 'deerisle', name: 'Deerisle' }
];

export default function App() {
    const {
        loading,
        error,
        definitions,
        lootTypes,
        setLootTypes,
        filters,
        setFilters,
        selection,
        setSelection,
        pushHistory,
        undo,
        redo,
        canUndo,
        canRedo,
        unknowns,
        resolveUnknowns,
        summary,
        summaryOpen,
        closeSummary,
        groups,
        duplicatesByName,
        manage,
        getGroupTypes,
        getGroupFiles,
        storageDirty,
        storageDiff,
        setChangeEditorID,
        reloadFromFiles,
        getBaselineFileTypes,
        refreshBaselineFromAPI,
        spawnableTypesByGroup,
        setSpawnableTypesByGroup,
        randomPresets,
        setRandomPresets,
        globalsDefaults,
        loadWarnings,
        // Profiles
        profiles,
        selectedProfileId,
        setSelectedProfileId,
        selectedProfile,
        getApiBase
    } = useLootData();

    // Options for pill-based editors in EditForm
    const allTypeNames = useMemo(() => {
        if (!lootTypes) return [];
        const set = new Set<string>();
        for (const t of lootTypes) {
            const n = t && t.name ? String(t.name) : '';
            if (!n) continue;
            const lower = n.toLowerCase();
            if (n.startsWith('Land_') || n.startsWith('StaticObj_') || lower.startsWith('static_')) continue;
            set.add(n);
        }
        return Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    }, [lootTypes]);

    const typeOptionsByCategory = useMemo(() => {
        if (!lootTypes) return {};
        const map: Record<string, string[]> = {};
        for (const t of lootTypes) {
            if (!t.name || !t.category) continue;
            if (!map[t.category]) map[t.category] = [];
            map[t.category].push(t.name);
        }
        return map;
    }, [lootTypes]);

    // View state
    const [editorID, setEditorID] = useState(() => localStorage.getItem('dayz-editor:id') || '');
    const [view, setView] = useState('editor'); // 'editor', 'profiles'
    const [modal, setModal] = useState<string | null>(null); // 'export', 'unknowns', 'diff', 'manage-definitions', 'addons', 'heatmap'
    const [manageDefKind, setManageDefKind] = useState<'usage' | 'value' | 'tag' | null>(null);
    const [saveCLEHandler, setSaveCLEHandler] = useState<null | (() => void)>(null);

    // Filtered types
    const filteredTypes = useMemo(() => {
        if (!lootTypes) return [];
        return lootTypes.filter(t => {
            if (filters.name && !t.name.toLowerCase().includes(filters.name.toLowerCase())) return false;
            if (filters.category !== 'all') {
                if (filters.category === 'none' && t.category) return false;
                if (filters.category !== 'none' && t.category !== filters.category) return false;
            }
            if (filters.usage.length > 0) {
                if (filters.usage.includes('None')) {
                    if (t.usage && t.usage.length > 0) return false;
                } else if (!filters.usage.some(u => t.usage?.includes(u))) {
                    return false;
                }
            }
            if (filters.value.length > 0) {
                if (filters.value.includes('None')) {
                    if (t.value && t.value.length > 0) return false;
                } else if (!filters.value.some(v => t.value?.includes(v))) {
                    return false;
                }
            }
            if (filters.tag.length > 0 && !filters.tag.some(tg => t.tag?.includes(optToTag(tg)))) return false;
            
            if (filters.flags.length > 0) {
                if (filters.flags.includes('None')) {
                    if (Object.values(t.flags).some(v => v)) return false;
                } else if (!filters.flags.some(f => t.flags[f])) {
                    return false;
                }
            }

            if (filters.groups.length > 0 && !filters.groups.includes(t.group || 'vanilla')) return false;

            if (filters.changedOnly) {
                const isModified = storageDiff?.files[t.group || 'vanilla']?.[t.file || 'types']?.changedNames?.includes(t.name);
                if (!isModified) return false;
            }

            return true;
        });
    }, [lootTypes, filters, storageDiff]);

    const selectedTypes = useMemo(() => {
        if (!lootTypes || selection.size === 0) return [];
        return lootTypes.filter(t => selection.has(t.name));
    }, [lootTypes, selection]);

    const handleSaveTypes = (apply: (t: Type) => Type) => {
        const next = lootTypes.map(t => selection.has(t.name) ? apply(t) : t);
        pushHistory(next);
        setLootTypes(next);
    };

    const handleApplyUnknowns = ({ add, remove }: { add: any, remove: boolean }) => {
        resolveUnknowns({ add, remove });
        setModal(null);
    };

    const onLogin = (id: string) => {
        setEditorID(id);
        localStorage.setItem('dayz-editor:id', id);
        setChangeEditorID(id);
    };

    const onSignOut = () => {
        setEditorID('');
        localStorage.removeItem('dayz-editor:id');
        setSelection(new Set());
    };

    if (!editorID) {
        return <EditorLogin onLogin={onLogin} />;
    }

    if (!selectedProfileId && !loading) {
        return (
            <div className="flex flex-col h-full bg-gray-50 dark:bg-gray-950">
                <header className="bg-white border-b border-gray-200 px-8 py-6 dark:bg-gray-900 dark:border-gray-800">
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Welcome, {editorID}</h1>
                </header>
                <main className="flex-1 p-8 overflow-auto">
                    <ProfileManager 
                        profiles={profiles} 
                        selectedProfileId={selectedProfileId} 
                        onSelect={setSelectedProfileId} 
                        getApiBase={getApiBase}
                    />
                </main>
            </div>
        );
    }

    return (
        <div className="flex h-screen bg-gray-50 overflow-hidden font-sans text-gray-900 dark:bg-gray-950 dark:text-gray-100">
            <Sidebar 
                activeTab={view === 'profiles' ? 'profiles' : modal === 'addons' ? 'tools:addons' : modal === 'heatmap' ? 'map-tools:heatmap' : 'cle'}
                onTabChange={(id) => {
                    if (id === 'profiles') { setView('profiles'); setModal(null); }
                    else if (id === 'tools:addons') { setModal('addons'); }
                    else if (id === 'map-tools:heatmap') { setModal('heatmap'); }
                    else if (id === 'tools:adm') { setModal('adm'); }
                    else if (id === 'tools:expansion-log') { setModal('expansion-log'); }
                    else if (id === 'tools:stash-report') { setModal('stash-report'); }
                    else if (id === 'tools:lint') { setModal('lint'); }
                    else if (id === 'marketplace:traders') { setModal('traders'); }
                    else if (id === 'marketplace:market-categories') { setModal('market-categories'); }
                    else if (id === 'mission-files:random-presets') { setModal('random-presets'); }
                    else { setView('editor'); setModal(null); }
                }}
                editorID={editorID}
                onSignOut={onSignOut}
                selectedProfile={selectedProfile}
                onProfileClick={() => setView('profiles')}
                storageDirty={storageDirty}
                onStorageClick={() => setModal('diff')}
            />

            <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
                {/* Global Warnings Banner */}
                {loadWarnings.length > 0 && (
                    <div className="flex flex-col shrink-0 gap-px bg-gray-200 dark:bg-gray-800">
                        <div className="bg-error-50 px-6 py-3 flex items-center gap-4 transition-all hover:bg-error-100/50 dark:bg-error-900/10 dark:hover:bg-error-900/20">
                            <div className="size-10 rounded-full bg-error-100 flex items-center justify-center text-error-600 shrink-0 dark:bg-error-900/30 dark:text-error-500">
                                <AlertTriangle size={20} />
                            </div>
                            <div className="flex-1">
                                <p className="text-sm font-bold text-error-900 dark:text-error-300">Configuration Issues</p>
                                <p className="text-sm text-error-700 dark:text-error-400">
                                    {loadWarnings.length === 1 ? loadWarnings[0] : `${loadWarnings[0]} (+${loadWarnings.length - 1} more)`}
                                </p>
                            </div>
                            <Button variant="link-gray" className="text-error-600 hover:text-error-800 dark:text-error-400 dark:hover:text-error-300">
                                <X size={20} />
                            </Button>
                        </div>
                    </div>
                )}

                {view === 'profiles' ? (
                    <main className="flex-1 p-8 overflow-auto">
                        <div className="max-w-5xl mx-auto">
                            <div className="flex items-center justify-between mb-8">
                                <div>
                                    <h2 className="text-3xl font-bold text-gray-900 tracking-tight dark:text-white">Server Profiles</h2>
                                    <p className="text-gray-500 mt-1 dark:text-gray-400">Manage and switch between different server configurations.</p>
                                </div>
                                <Button variant="secondary-gray" onClick={() => setView('editor')}>Back to Editor</Button>
                            </div>
                            <ProfileManager 
                                profiles={profiles} 
                                selectedProfileId={selectedProfileId} 
                                onSelect={(id) => { setSelectedProfileId(id); setView('editor'); }} 
                                getApiBase={getApiBase}
                            />
                        </div>
                    </main>
                ) : (
                    <main className="flex-1 flex flex-col min-h-0 p-8 overflow-hidden">
                        {loading ? (
                            <div className="flex-1 flex flex-col items-center justify-center text-center">
                                <div className="size-12 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin mb-4" />
                                <p className="text-lg font-medium text-gray-900 dark:text-white">Loading mission data...</p>
                                <p className="text-sm text-gray-500 dark:text-gray-400">This may take a moment for large configurations.</p>
                            </div>
                        ) : error ? (
                            <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
                                <div className="size-16 bg-error-100 rounded-2xl flex items-center justify-center text-error-600 mb-6">
                                    <AlertTriangle size={32} />
                                </div>
                                <h2 className="text-2xl font-bold text-gray-900 mb-2 dark:text-white">Failed to load data</h2>
                                <p className="text-gray-500 max-w-md mb-8 dark:text-gray-400">{error}</p>
                                <Button onClick={() => window.location.reload()}>Retry Connection</Button>
                            </div>
                        ) : (
                            <div className="flex-1 flex flex-col min-h-0 max-w-[1600px] mx-auto w-full">
                                {/* Page Header */}
                                <div className="flex items-center justify-between mb-8">
                                    <div>
                                        <h1 className="text-3xl font-bold text-gray-900 tracking-tight dark:text-white">CLE Editor</h1>
                                        <p className="text-gray-500 mt-1 dark:text-gray-400">Manage loot types and economic settings for {selectedProfile?.name || 'Current Profile'}.</p>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <div className="flex items-center bg-white border border-gray-200 rounded-xl shadow-sm p-1 dark:bg-gray-800 dark:border-gray-700">
                                            <Button 
                                                variant="tertiary" 
                                                size="sm" 
                                                disabled={!canUndo} 
                                                onClick={undo}
                                                title="Undo"
                                                className="w-9 h-9 p-0"
                                            >
                                                <Undo size={18} />
                                            </Button>
                                            <div className="w-px h-4 bg-gray-200 mx-1 dark:bg-gray-700" />
                                            <Button 
                                                variant="tertiary" 
                                                size="sm" 
                                                disabled={!canRedo} 
                                                onClick={redo}
                                                title="Redo"
                                                className="w-9 h-9 p-0"
                                            >
                                                <Redo size={18} />
                                            </Button>
                                        </div>
                                        <Button variant="secondary-gray" icon={Download} onClick={() => setModal('export')}>Export</Button>
                                        <Button variant="secondary-gray" icon={RefreshCw} onClick={reloadFromFiles}>Reload</Button>
                                        <Button 
                                            variant="primary" 
                                            icon={Save} 
                                            onClick={() => setModal('diff')}
                                            disabled={!storageDirty}
                                        >
                                            Set Changes Live
                                        </Button>
                                    </div>
                                </div>

                                <div className="flex-1 flex gap-8 min-h-0">
                                    <aside className="w-80 shrink-0 h-full overflow-y-auto scrollbar-none">
                                        <Filters 
                                            definitions={definitions}
                                            groups={groups}
                                            filters={filters}
                                            onChange={setFilters}
                                            onManage={(kind) => { setManageDefKind(kind); setModal('manage-definitions'); }}
                                            matchingCount={filteredTypes.length}
                                        />
                                    </aside>

                                    <div className="flex-1 flex flex-col min-w-0">
                                        <div className={cx(
                                            "flex-1 flex min-h-0 bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden dark:bg-gray-900 dark:border-gray-800",
                                            selection.size > 0 ? "gap-0" : ""
                                        )}>
                                            <div className="min-w-0 min-h-0 flex flex-col flex-1">
                                                <TypesTable 
                                                    definitions={definitions}
                                                    types={filteredTypes}
                                                    selection={selection}
                                                    setSelection={setSelection}
                                                    unknowns={unknowns}
                                                    duplicatesByName={duplicatesByName}
                                                    storageDiff={storageDiff}
                                                    showGroupColumn={filters.groups.length !== 1}
                                                />
                                            </div>

                                            {selection.size > 0 && (
                                                <div className="w-[450px] shrink-0 min-h-0 border-l border-gray-200 dark:border-gray-800 flex flex-col bg-gray-50 dark:bg-gray-950/20">
                                                    <EditForm 
                                                        definitions={definitions}
                                                        selectedTypes={selectedTypes}
                                                        onCancel={() => setSelection(new Set())}
                                                        onSave={handleSaveTypes}
                                                        typeOptions={allTypeNames}
                                                        typeOptionsByCategory={typeOptionsByCategory}
                                                        selectedProfileId={selectedProfileId}
                                                        selectedProfile={selectedProfile}
                                                        getApiBase={getApiBase}
                                                        spawnableTypesByGroup={spawnableTypesByGroup}
                                                        setSpawnableTypesByGroup={setSpawnableTypesByGroup}
                                                        randomPresets={randomPresets}
                                                        globalsDefaults={globalsDefaults}
                                                    />
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </main>
                )}
            </div>

            {/* Modals */}
            {modal === 'export' && (
                <ExportModal 
                    onClose={() => setModal(null)} 
                    groups={groups} 
                    getGroupTypes={getGroupTypes}
                    getGroupFiles={getGroupFiles}
                />
            )}
            {unknowns.hasAny && modal === 'unknowns' && (
                <UnknownEntriesModal 
                    unknowns={unknowns} 
                    onApply={handleApplyUnknowns} 
                    onClose={() => setModal(null)} 
                />
            )}
            {summaryOpen && (
                <SummaryModal summary={summary} onClose={closeSummary} />
            )}
            {modal === 'manage-definitions' && manageDefKind && (
                <ManageDefinitionsModal
                    kind={manageDefKind}
                    entries={definitions[`${manageDefKind}flags` as keyof typeof definitions] || definitions.tags}
                    countRefs={(kind, entry) => {
                        return lootTypes?.filter(t => {
                            if (kind === 'usage') return t.usage?.includes(entry);
                            if (kind === 'value') return t.value?.includes(entry);
                            if (kind === 'tag') return t.tag?.includes(optToTag(entry));
                            return false;
                        }).length || 0;
                    }}
                    removeEntry={(kind, entry) => {
                        const next = lootTypes?.map(t => {
                            const nt = { ...t };
                            if (kind === 'usage') nt.usage = nt.usage?.filter(x => x !== entry);
                            if (kind === 'value') nt.value = nt.value?.filter(x => x !== entry);
                            if (kind === 'tag') nt.tag = nt.tag?.filter(x => x !== optToTag(entry));
                            return nt;
                        }) || [];
                        pushHistory(next);
                        setLootTypes(next);
                        manage.remove(kind, entry);
                    }}
                    addEntry={(kind, entry) => manage.add(kind, entry)}
                    onClose={() => { setModal(null); setManageDefKind(null); }}
                />
            )}
            {modal === 'diff' && (
                <StorageStatusModal 
                    diff={storageDiff} 
                    onClose={() => setModal(null)} 
                    onApply={refreshBaselineFromAPI}
                    getBaselineFileTypes={getBaselineFileTypes}
                />
            )}
            {modal === 'random-presets' && (
                <RandomPresetsModal 
                    onClose={() => setModal(null)}
                    randomPresets={randomPresets}
                    setRandomPresets={(next: any) => {
                        setRandomPresets(next);
                        // For simplicity, we don't push to undo history for random presets yet
                    }}
                />
            )}
            {modal === 'adm' && (
                <AdmRecordsModal 
                    onClose={() => setModal(null)}
                    selectedProfileId={selectedProfileId}
                    getApiBase={getApiBase}
                />
            )}
            {modal === 'expansion-log' && (
                <ExpansionLogModal
                    onClose={() => setModal(null)}
                    selectedProfileId={selectedProfileId}
                    getApiBase={getApiBase}
                />
            )}
            {modal === 'stash-report' && (
                <StashReportModal
                    onClose={() => setModal(null)}
                    selectedProfileId={selectedProfileId}
                    getApiBase={getApiBase}
                />
            )}
            {modal === 'traders' && (
                <TraderEditorModal
                    onClose={() => setModal(null)}
                    selectedProfileId={selectedProfileId}
                    getApiBase={getApiBase}
                    typeOptions={allTypeNames}
                />
            )}
            {modal === 'lint' && (
                <LintFilesModal
                    onClose={() => setModal(null)}
                    selectedProfileId={selectedProfileId}
                    getApiBase={getApiBase}
                />
            )}
            {modal === 'market-categories' && (
                <MarketCategoryEditorModal
                    onClose={() => setModal(null)}
                    selectedProfileId={selectedProfileId}
                    getApiBase={getApiBase}
                    typeOptions={allTypeNames}
                />
            )}
            {modal === 'addons' && (
                <AddonEditorModal
                    onClose={() => setModal(null)}
                    selectedProfile={selectedProfile}
                    knownAddons={KNOWN_ADDONS}
                    onSave={(addons: string[]) => {
                        // This would call a profile update API
                        console.log('Save addons', addons);
                    }}
                />
            )}
            {modal === 'heatmap' && (
                <HeatMapModal
                    onClose={() => setModal(null)}
                    selectedProfileId={selectedProfileId}
                    getApiBase={getApiBase}
                />
            )}
        </div>
    );
}

function optToTag(opt: string) {
    return opt;
}
