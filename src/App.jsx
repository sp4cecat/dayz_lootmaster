import React, {useMemo, useRef, useState, useEffect} from 'react';
import {useLootData} from './hooks/useLootData.js';
import Filters from './components/Filters.jsx';
import TypesTable from './components/TypesTable.jsx';
import EditForm from './components/EditForm.jsx';
import ExportModal from './components/ExportModal.jsx';
import UnknownEntriesModal from './components/UnknownEntriesModal.jsx';
import ThemeToggle from './components/ThemeToggle.jsx';
import SummaryModal from './components/SummaryModal.jsx';
import ManageDefinitionsModal from './components/ManageDefinitionsModal.jsx';
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
import {generateTypesXml, generateLimitsXml, generateRandomPresetsXml, generateSpawnableTypesXml, ROOT_SPAWNABLE_GROUP, validateSpawnableReferences} from './utils/xml.js';

import { Sidebar } from './components/layout/Sidebar.jsx';
import { Button } from './components/ui/Button.jsx';
import { Badge } from './components/ui/Badge.jsx';
import { Input } from './components/ui/Input.jsx';
import { cn } from './utils/cn.js';
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

/**
 * @typedef {import('./utils/xml.js').Type} Type
 */

const KNOWN_ADDONS = [
    { id: 'deerisle', name: 'Deerisle' }
];

/**
 * Main application component orchestrating data, filters, selection, editing and exporting.
 */
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
        const set = new Set();
        for (const t of lootTypes) {
            const n = t && t.name ? String(t.name) : '';
            if (!n) continue;
            const lower = n.toLowerCase();
            if (n.startsWith('Land_') || n.startsWith('StaticObj_') || lower.startsWith('static_')) continue;
            set.add(n);
        }
        return Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    }, [lootTypes]);

    const typeNamesByCategory = useMemo(() => {
        /** @type {Record<string, string[]>} */
        const map = {};
        if (!lootTypes) return map;
        /** @type {Record<string, Set<string>>} */
        const temp = {};
        for (const t of lootTypes) {
            const n = t && t.name ? String(t.name) : '';
            if (!n) continue;
            const lower = n.toLowerCase();
            if (n.startsWith('Land_') || n.startsWith('StaticObj_') || lower.startsWith('static_')) continue;
            const cat = t && t.category ? String(t.category) : '';
            if (!temp[cat]) temp[cat] = new Set();
            temp[cat].add(n);
        }
        for (const [cat, set] of Object.entries(temp)) {
            map[cat] = Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
        }
        return map;
    }, [lootTypes]);

    const [showExport, setShowExport] = useState(false);
    const [manageOpen, setManageOpen] = useState(false);
    const [manageKind, setManageKind] = useState(/** @type {'usage'|'value'|'tag'|null} */(null));
    const [showStorage, setShowStorage] = useState(false);
    const [showAdm, setShowAdm] = useState(false);
    const [showExpansionLog, setShowExpansionLog] = useState(false);
    const [showStash, setShowStash] = useState(false);
    const [showTraderEditor, setShowTraderEditor] = useState(false);
    const [showMarketCategories, setShowMarketCategories] = useState(false);
    const [showRandomPresets, setShowRandomPresets] = useState(false);
    const [showLint, setShowLint] = useState(false);
    const [showHeatMap, setShowHeatMap] = useState(false);
    const [activeAddon, setActiveAddon] = useState(null); // { id, name }
    const [showProfileManager, setShowProfileManager] = useState(false);
    const [activeTab, setActiveTab] = useState('cle');

    const handleTabChange = (tab) => {
      setActiveTab(tab);
      // Handle sub-tab modal triggers
      if (tab === 'marketplace:traders') setShowTraderEditor(true);
      if (tab === 'marketplace:market-categories') setShowMarketCategories(true);
      if (tab === 'map-tools:heatmap') setShowHeatMap(true);
      if (tab === 'mission-files:random-presets') setShowRandomPresets(true);
      if (tab === 'tools:adm') setShowAdm(true);
      if (tab === 'tools:expansion-log') setShowExpansionLog(true);
      if (tab === 'tools:stash-report') setShowStash(true);
      if (tab === 'tools:lint') setShowLint(true);
      
      if (tab === 'cle' || tab.startsWith('cle')) setActiveTab('cle');
    };

    useEffect(() => {
        if (!loading && !selectedProfileId) {
            setShowProfileManager(true);
        }
    }, [loading, selectedProfileId]);

    // Persist-to-files UI state
    const [saving, setSaving] = useState(false);
    const [saveNotice, setSaveNotice] = useState(/** @type {string|null} */(null));

    async function persistAllToFiles() {
        const ok = window.confirm('This will write the current definitions and all group types files to disk via the persistence server. Continue?');
        if (!ok) return;

        // Determine API base: use configured value or fallback to same host on port 4317
        const savedBase = localStorage.getItem('dayz-editor:apiBase');
        const defaultBase = `${window.location.protocol}//${window.location.hostname}:4317`;
        const API_BASE = (savedBase && savedBase.trim()) ? savedBase.trim().replace(/\/+$/, '') : defaultBase;

        setSaving(true);
        setSaveNotice(null);
        try {
            // Save definitions
            const defsXml = generateLimitsXml(definitions);
            const defsRes = await fetch(`${API_BASE}/api/definitions`, {
                method: 'PUT',
                headers: {
                  'Content-Type': 'application/xml',
                  'X-Editor-ID': editorID || 'unknown',
                  'X-Profile-ID': selectedProfileId
                },
                body: defsXml
            });
            if (!defsRes.ok) {
                throw new Error(`Failed to save cfglimitsdefinition.xml (${defsRes.status})`);
            }

            // Save all group type files (skip vanilla base file entirely)
            for (const g of groups) {
              if (g === 'vanilla') continue; // do not persist mission_path/db/types.xml
              const files = getGroupFiles(g);
              for (const { file, types } of files) {
                // Preservation fix for overrides: when persisting vanilla_overrides/types,
                // rehydrate `_present` from the baseline vanilla type so numeric fields
                // (nominal/min/restock/quantmin/quantmax) are emitted even after reloads.
                let toWrite = types;
                if (g === 'vanilla_overrides' && file === 'types') {
                  const baselineVanilla = Array.isArray(getBaselineFileTypes?.('vanilla', 'types'))
                    ? getBaselineFileTypes('vanilla', 'types')
                    : [];
                  const baseByName = new Map(baselineVanilla.map(t => [t.name, t]));
                  toWrite = types.map(t => {
                    const base = baseByName.get(t.name);
                    if (!base || !base._present) return t;
                    // Clone and replace _present with vanilla's map
                    return { ...t, _present: { ...base._present } };
                  });
                }

                const xml = generateTypesXml(toWrite);
                const res = await fetch(`${API_BASE}/api/types/${encodeURIComponent(g)}/${encodeURIComponent(file)}`, {
                  method: 'PUT',
                  headers: {
                    'Content-Type': 'application/xml',
                    'X-Editor-ID': editorID || 'unknown',
                    'X-Profile-ID': selectedProfileId
                  },
                  body: xml
                });
                if (!res.ok) {
                  throw new Error(`Failed to save ${g}/${file}.xml (${res.status})`);
                }
              }
            }

            // Save per-group spawnabletypes files alongside type changes.
            for (const g of [ROOT_SPAWNABLE_GROUP, ...groups]) {
              const spawnable = spawnableTypesByGroup?.[g];
              if (!spawnable) continue;
              const xml = generateSpawnableTypesXml(spawnable);
              const res = await fetch(`${API_BASE}/api/spawnabletypes/${encodeURIComponent(g)}`, {
                method: 'PUT',
                headers: {
                  'Content-Type': 'application/xml',
                  'X-Editor-ID': editorID || 'unknown',
                  'X-Profile-ID': selectedProfileId
                },
                body: xml
              });
              if (!res.ok) {
                throw new Error(`Failed to save ${g}/cfgspawnabletypes.xml (${res.status})`);
              }
            }

            const randomPresetsXml = generateRandomPresetsXml(randomPresets || { presets: [] });
            const randomPresetsRes = await fetch(`${API_BASE}/api/mission/randompresets`, {
              method: 'PUT',
              headers: {
                'Content-Type': 'application/xml',
                'X-Editor-ID': editorID || 'unknown',
                'X-Profile-ID': selectedProfileId
              },
              body: randomPresetsXml
            });
            if (!randomPresetsRes.ok) {
              throw new Error(`Failed to save cfgrandompresets.xml (${randomPresetsRes.status})`);
            }

            // Refresh baseline from API so storageDiff reflects the persisted state
            if (typeof refreshBaselineFromAPI === 'function') {
              await refreshBaselineFromAPI();
            }

            setSaveNotice('Changes saved to files successfully.');
        } catch (e) {
            setSaveNotice(`Save failed: ${String(e)}`);
        } finally {
            setSaving(false);
        }
    }

    // Editor ID gating
    const EDITOR_ID_SELECTED = 'dayz-editor:editorID:selected';
    const EDITOR_ID_LIST = 'dayz-editor:editorIDs';

    // Always require selecting an editor ID on each load (do not auto-load a saved selection)
    const [editorID, setEditorID] = useState(null);
    const [editorIDs, setEditorIDs] = useState(() => {
        try {
            const raw = localStorage.getItem(EDITOR_ID_LIST);
            const arr = raw ? JSON.parse(raw) : [];
            return Array.isArray(arr) ? arr : [];
        } catch {
            return [];
        }
    });

    const selectEditorID = (id) => {
        const v = String(id).trim();
        if (!v) return;
        setEditorID(v);
        try {
            localStorage.setItem(EDITOR_ID_SELECTED, v);
            const set = new Set(editorIDs);
            set.add(v);
            const list = Array.from(set);
            setEditorIDs(list);
            localStorage.setItem(EDITOR_ID_LIST, JSON.stringify(list));
        } catch {
            // ignore storage errors
        }
    };

    // Profile dropdown state
    const [profileOpen, setProfileOpen] = useState(false);
    const profileRef = useRef(null);
    // Close on outside click
    React.useEffect(() => {
        if (!profileOpen) return;
        const onDown = (e) => {
            if (profileRef.current && profileRef.current.contains(e.target)) return;
            setProfileOpen(false);
        };
        document.addEventListener('mousedown', onDown);
        return () => document.removeEventListener('mousedown', onDown);
    }, [profileOpen]);

    const signOut = () => {
        try {
            localStorage.removeItem(EDITOR_ID_SELECTED);
        } catch { /* ignore */
        }
        setProfileOpen(false);
        setEditorID(null);
        setChangeEditorID('');
    };

    // Keep hook aware of current editorID
    React.useEffect(() => {
        if (editorID) setChangeEditorID(editorID);
    }, [editorID, setChangeEditorID]);

    // Available flag options derived from current types
    const flagOptions = useMemo(() => {
        if (!lootTypes) return [];
        const set = new Set();
        for (const t of lootTypes) {
            if (!t.flags) continue;
            Object.keys(t.flags).forEach(k => set.add(k));
        }
        return Array.from(set).sort((a, b) => a.localeCompare(b));
    }, [lootTypes]);

    // Aggregate set of changed type names from storageDiff
    const changedNameSet = useMemo(() => {
        /** @type {Set<string>} */
        const set = new Set();
        if (storageDiff && storageDiff.files) {
            for (const g of Object.keys(storageDiff.files)) {
                const files = storageDiff.files[g];
                for (const f of Object.keys(files)) {
                    const names = files[f]?.changedNames || [];
                    names.forEach(n => set.add(n));
                }
            }
        }
        return set;
    }, [storageDiff]);

    const filteredTypes = useMemo(() => {
        if (!lootTypes) return [];
        const {category, name, usage, value, tag, flags, changedOnly, groups: selectedGroups} = filters;
        const selectedGroupsSet = new Set(selectedGroups);
        const namePattern = name?.trim() ? wildcardToRegExp(name.trim()) : null;

        return lootTypes.filter(t => {
            // Changed only filter
            if (changedOnly && !changedNameSet.has(t.name)) {
                return false;
            }

            // Groups filter: if none selected, treat as all; otherwise must include
            if (selectedGroups.length > 0 && t.group && !selectedGroupsSet.has(t.group)) {
                return false;
            }

            if (category && category !== 'all') {
                if (category === 'none') {
                    if (t.category) return false;
                } else if (t.category !== category) {
                    return false;
                }
            }
            if (namePattern && !namePattern.test(t.name)) return false;

            // Usage filter with 'None' handling
            if (usage.length) {
                if (usage.includes('None')) {
                    if ((t.usage?.length || 0) !== 0) return false;
                } else if (!usage.every(u => t.usage.includes(u))) {
                    return false;
                }
            }

            // Value filter with 'None' handling
            if (value.length) {
                if (value.includes('None')) {
                    if ((t.value?.length || 0) !== 0) return false;
                } else if (!value.every(v => t.value.includes(v))) {
                    return false;
                }
            }

            // Flags filter: if 'None' selected require no truthy flags; otherwise require all selected flags to be truthy
            if (flags && flags.length) {
                const f = t.flags || {};
                if (flags.includes('None')) {
                    const values = Object.values(f);
                    if (!(values.length === 0 || values.every(v => !v))) return false;
                } else {
                    if (!flags.every(key => !!f[key])) return false;
                }
            }

            return !(tag.length && !tag.every(g => t.tag.includes(g)));

        });
    }, [lootTypes, filters]);

    // Count types with no flags set (to show a warning banner)
    const noFlagsCount = useMemo(() => {
        if (!lootTypes) return 0;
        return lootTypes.filter(t => {
            const f = t.flags || {};
            const values = Object.values(f);
            return values.length === 0 || values.every(v => !v);
        }).length;
    }, [lootTypes]);

    // Safe alias for loadWarnings
    const lw = Array.isArray(loadWarnings) ? loadWarnings : [];
    const lwKey = lw.length ? `lw:${lw.join('|')}` : '';
    const spawnableWarnings = useMemo(() => {
        if (!lootTypes || !spawnableTypesByGroup) return [];
        return Object.entries(spawnableTypesByGroup).flatMap(([group, data]) => {
            const groupTypes = group === ROOT_SPAWNABLE_GROUP ? lootTypes : lootTypes.filter(type => (type.group || 'vanilla') === group);
            return validateSpawnableReferences(data, groupTypes, randomPresets).map(warning => `[${group}] ${warning.message}`);
        });
    }, [lootTypes, randomPresets, spawnableTypesByGroup]);
    const spawnableWarningsKey = spawnableWarnings.length ? `spawnable:${spawnableWarnings.join('|')}` : '';

    // Dismissible warnings: hide current warnings until new alerts are generated
    const [dismissedWarningsKey, setDismissedWarningsKey] = useState(/** @type {string|null} */(null));
    const warningsKey = useMemo(() => {
        const parts = [];
        if (unknowns?.hasAny) parts.push('unknowns');
        if (lwKey) parts.push(lwKey);
        if (spawnableWarningsKey) parts.push(spawnableWarningsKey);
        if (noFlagsCount > 0) parts.push(`noflags:${noFlagsCount}`);
        return parts.join(';');
    }, [unknowns?.hasAny, lwKey, spawnableWarningsKey, noFlagsCount]);
    const dismissWarnings = () => setDismissedWarningsKey(warningsKey);

    const selectedTypes = useMemo(() => {
        if (!lootTypes) return [];
        return lootTypes.filter(t => selection.has(t.name));
    }, [lootTypes, selection]);

    // Whether to show the Group column (hide when only vanilla exists)
    const showGroupColumn = useMemo(() => groups.some(g => g !== 'vanilla'), [groups]);

    const [editKey, setEditKey] = useState(0);
    const onCancelEdit = () => {
        setEditKey(k => k + 1); // force unmount/mount
        setSelection(new Set()); // discard selection
    };

    const onSaveEdit = (updatedPartial) => {
        // updatedPartial: function that applies updates to a Type and returns new Type
        const newTypes = lootTypes.map(t => {
            if (selection.has(t.name)) {
                // Preserve group metadata if the updater returns a fresh object
                const updated = updatedPartial(t);
                return {...t, ...updated};
            }
            return t;
        });
        setLootTypes(newTypes, {persist: true});
        pushHistory(newTypes);
        setEditKey(k => k + 1);
        // Close the edit form by clearing the selection after persisting
        setSelection(new Set());
    };

    if (!editorID) {
        return <EditorLogin existingIDs={editorIDs} onSelect={selectEditorID}/>;
    }

    const mainContent = (() => {
        if (loading) {
            return (
                <div className="app app-center">
                    <div className="spinner" aria-label="Loading"/>
                    <div>Loading configuration...</div>
                </div>
            );
        }
        if (error) {
            return (
                <div className="app app-center error">
                    <div style={{marginBottom: 16}}>Failed to load: {String(error)}</div>
                    <button className="btn" onClick={() => setShowProfileManager(true)}>
                        Switch Server Installation
                    </button>
                </div>
            );
        }
        if (!definitions || !lootTypes) {
            return (
                <div className="app app-center">
                    <div>Please select a server installation to begin.</div>
                    <button className="btn primary" style={{marginTop: 12}} onClick={() => setShowProfileManager(true)}>
                        Select Server
                    </button>
                </div>
            );
        }

        return (
            <div className="flex gap-8 items-start">
                <aside className="w-80 shrink-0 sticky top-0">
                    <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
                        <Filters
                            definitions={definitions}
                            groups={groups}
                            filters={filters}
                            onChange={setFilters}
                            onManage={(kind) => {
                                setManageKind(kind);
                                setManageOpen(true);
                            }}
                            matchingCount={filteredTypes.length}
                            flagOptions={flagOptions}
                        />
                    </div>
                </aside>
                <div className="flex-1 min-w-0">
                    <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
                        <TypesTable
                            definitions={definitions}
                            types={filteredTypes}
                            selection={selection}
                            setSelection={setSelection}
                            unknowns={unknowns}
                            condensed={selectedTypes.length > 0}
                            duplicatesByName={duplicatesByName}
                            storageDiff={storageDiff}
                            showGroupColumn={showGroupColumn}
                        />
                    </div>
                </div>
                {selectedTypes.length > 0 && (
                    <div className="fixed inset-y-0 right-0 w-[500px] bg-white shadow-2xl border-l border-gray-200 z-50 overflow-y-auto" key={editKey}>
                        <EditForm
                            definitions={definitions}
                            selectedTypes={selectedTypes}
                            onCancel={onCancelEdit}
                            onSave={onSaveEdit}
                            typeOptions={allTypeNames}
                            typeOptionsByCategory={typeNamesByCategory}
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
        );
    })();

    return (
        <div className={cn("flex h-screen bg-gray-50 overflow-hidden font-sans text-gray-900 dark:bg-gray-950 dark:text-gray-100")}>
            <Sidebar 
                activeTab={activeTab} 
                onTabChange={handleTabChange} 
                editorID={editorID} 
                onSignOut={signOut}
                selectedProfile={selectedProfile}
                onProfileClick={() => setShowProfileManager(true)}
            />
            
            <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
                {/* Warnings Area */}
                <div className="flex flex-col shrink-0 gap-px bg-gray-200 dark:bg-gray-800">
                    {unknowns.hasAny && (
                        <div className="bg-warning-50 px-6 py-3 flex items-center gap-4 transition-all hover:bg-warning-100/50 dark:bg-warning-900/10 dark:hover:bg-warning-900/20">
                            <div className="size-10 rounded-full bg-warning-100 flex items-center justify-center text-warning-600 shrink-0 dark:bg-warning-900/30 dark:text-warning-500">
                                <AlertTriangle size={20} />
                            </div>
                            <div className="flex-1">
                                <p className="text-sm font-bold text-warning-900 dark:text-warning-300">Unknown Entries Detected</p>
                                <p className="text-sm text-warning-700 dark:text-warning-400">Usage, value, tag or category entries found that are not in your definitions.</p>
                            </div>
                            <Button variant="secondary" size="sm" onClick={() => resolveUnknowns.open()} className="bg-white border-warning-200 text-warning-700 hover:bg-warning-50 dark:bg-gray-800 dark:border-warning-800 dark:text-warning-400">
                                Review & Resolve
                            </Button>
                        </div>
                    )}
                    {warningsKey !== dismissedWarningsKey && (lw.length > 0 || spawnableWarnings.length > 0 || noFlagsCount > 0) && (
                        <div className="bg-error-50 px-6 py-3 flex items-center gap-4 transition-all hover:bg-error-100/50">
                            <div className="size-10 rounded-full bg-error-100 flex items-center justify-center text-error-600 shrink-0">
                                <AlertTriangle size={20} />
                            </div>
                            <div className="flex-1">
                                <p className="text-sm font-bold text-error-900">Configuration Issues</p>
                                <p className="text-sm text-error-700">
                                    {lw.length > 0 && `Types file errors (${lw.length}). `}
                                    {spawnableWarnings.length > 0 && `Spawnable reference warnings (${spawnableWarnings.length}). `}
                                    {noFlagsCount > 0 && `${noFlagsCount} types missing flags.`}
                                </p>
                            </div>
                            <Button variant="link" size="sm" onClick={dismissWarnings} className="text-error-600 hover:text-error-800">
                                <X size={20} />
                            </Button>
                        </div>
                    )}
                    {saveNotice && (
                        <div className={cn(
                            "px-6 py-3 flex items-center gap-4 transition-all",
                            saveNotice.startsWith('Save failed') ? "bg-error-50" : "bg-success-50"
                        )}>
                            <div className={cn(
                                "size-10 rounded-full flex items-center justify-center shrink-0",
                                saveNotice.startsWith('Save failed') ? "bg-error-100 text-error-600" : "bg-success-100 text-success-600"
                            )}>
                                {saveNotice.startsWith('Save failed') ? <AlertTriangle size={20} /> : <Check size={20} />}
                            </div>
                            <div className="flex-1">
                                <p className={cn(
                                    "text-sm font-bold",
                                    saveNotice.startsWith('Save failed') ? "text-error-900" : "text-success-900"
                                )}>
                                    {saveNotice.startsWith('Save failed') ? 'Persist Failed' : 'Success'}
                                </p>
                                <p className={cn(
                                    "text-sm",
                                    saveNotice.startsWith('Save failed') ? "text-error-700" : "text-success-700"
                                )}>{saveNotice}</p>
                            </div>
                            <Button variant="link" size="sm" onClick={() => setSaveNotice(null)} className="text-gray-400 hover:text-gray-600">
                                <X size={20} />
                            </Button>
                        </div>
                    )}
                </div>

                <main className="flex-1 overflow-auto p-8">
                    {activeTab === 'cle' && (
                        <div className="max-w-[1600px] mx-auto">
                            <div className="flex items-center justify-between mb-8">
                                <div>
                                    <h1 className="text-3xl font-bold text-gray-900 tracking-tight dark:text-white">CLE Editor</h1>
                                    <p className="text-gray-500 mt-1 dark:text-gray-400">Manage loot types and economic settings for {selectedProfile?.name}.</p>
                                </div>
                                <div className="flex items-center gap-3">
                                    <div className="flex items-center bg-white border border-gray-200 rounded-lg shadow-sm p-1 dark:bg-gray-800 dark:border-gray-700">
                                        <Button 
                                            variant="tertiary" 
                                            size="sm" 
                                            onClick={undo} 
                                            disabled={!canUndo} 
                                            title="Undo"
                                        >
                                            <Undo size={18} />
                                        </Button>
                                        <div className="w-px h-4 bg-gray-200 mx-1 dark:bg-gray-700" />
                                        <Button 
                                            variant="tertiary" 
                                            size="sm" 
                                            onClick={redo} 
                                            disabled={!canRedo} 
                                            title="Redo"
                                        >
                                            <Redo size={18} />
                                        </Button>
                                    </div>
                                    <Button variant="secondary" onClick={() => setShowExport(true)} disabled={saving || !storageDirty}>
                                        <Download size={18} className="mr-2" /> Export
                                    </Button>
                                    <Button variant="primary" onClick={persistAllToFiles} disabled={saving || !storageDirty}>
                                        <Save size={18} className="mr-2" /> {saving ? 'Saving...' : 'Set Changes Live'}
                                    </Button>
                                    <Button variant="secondary" onClick={() => {
                                        if (window.confirm('Reload all data from files? Any unsaved changes will be lost.')) reloadFromFiles();
                                    }}>
                                        <RefreshCw size={18} className="mr-2" /> Reload
                                    </Button>
                                </div>
                            </div>
                            
                            {mainContent}
                        </div>
                    )}
                </main>
            </div>

            {showExport && (
                <ExportModal
                    groups={groups}
                    defaultGroup={groups[0] || 'vanilla'}
                    getGroupTypes={getGroupTypes}
                    getGroupFiles={getGroupFiles}
                    getBaselineFileTypes={getBaselineFileTypes}
                    definitions={definitions}
                    storageDiff={storageDiff}
                    onClose={() => setShowExport(false)}
                />
            )}
            {resolveUnknowns.isOpen && (
                <UnknownEntriesModal
                    unknowns={unknowns}
                    onApply={resolveUnknowns.apply}
                    onClose={resolveUnknowns.close}
                />
            )}
            {summaryOpen && summary && (
                <SummaryModal summary={summary} onClose={closeSummary}/>
            )}
            {manageOpen && manageKind && (
                <ManageDefinitionsModal
                    kind={manageKind}
                    entries={
                        manageKind === 'usage'
                            ? definitions.usageflags
                            : manageKind === 'value'
                                ? definitions.valueflags
                                : definitions.tags
                    }
                    countRefs={manage.countRefs}
                    removeEntry={(k, entry) => manage.removeEntry(k, entry)}
                    addEntry={(k, entry) => manage.addEntry(k, entry)}
                    onClose={() => {
                        setManageOpen(false);
                        setManageKind(null);
                    }}
                />
            )}
            {showStorage && storageDiff && (
                <StorageStatusModal diff={storageDiff} onClose={() => setShowStorage(false)}/>
            )}
            {showAdm && (
              <AdmRecordsModal onClose={() => setShowAdm(false)} selectedProfileId={selectedProfileId} />
            )}
            {showExpansionLog && (
              <ExpansionLogModal onClose={() => setShowExpansionLog(false)} selectedProfileId={selectedProfileId} />
            )}
            {showStash && (
              <StashReportModal onClose={() => setShowStash(false)} selectedProfileId={selectedProfileId} />
            )}
            {showLint && (
                <LintFilesModal onClose={() => setShowLint(false)} selectedProfileId={selectedProfileId} />
            )}

            {showHeatMap && (
                <HeatMapModal onClose={() => setShowHeatMap(false)} selectedProfileId={selectedProfileId} getApiBase={getApiBase} />
            )}

            {activeAddon && (
                <AddonEditorModal 
                    addonId={activeAddon.id} 
                    addonName={activeAddon.name} 
                    onClose={() => setActiveAddon(null)} 
                    selectedProfileId={selectedProfileId}
                    getApiBase={getApiBase}
                />
            )}
            {showTraderEditor && (
              <TraderEditorModal onClose={() => setShowTraderEditor(false)} selectedProfileId={selectedProfileId} />
            )}
            {showMarketCategories && (
              <MarketCategoryEditorModal onClose={() => setShowMarketCategories(false)} selectedProfileId={selectedProfileId} />
            )}
            {showRandomPresets && (
              <RandomPresetsModal
                randomPresets={randomPresets}
                setRandomPresets={setRandomPresets}
                spawnableTypesByGroup={spawnableTypesByGroup}
                setSpawnableTypesByGroup={setSpawnableTypesByGroup}
                onClose={() => setShowRandomPresets(false)}
              />
            )}
            {showProfileManager && (
                <ProfileManager
                    profiles={profiles}
                    selectedProfileId={selectedProfileId}
                    onSelect={(id) => {
                        setSelectedProfileId(id);
                        setShowProfileManager(false);
                    }}
                    onClose={() => setShowProfileManager(false)}
                    getApiBase={getApiBase}
                />
            )}
        </div>
    );
}

/**
 * Convert wildcard string (* ?) to RegExp.
 * Supports optional anchors: ^ at start, $ at end.
 * If no wildcard is provided and no anchors, match as a substring.
 * @param {string} pattern
 * @returns {RegExp}
 */
function wildcardToRegExp(pattern) {
    const raw = String(pattern || '');
    const anchoredStart = raw.startsWith('^');
    const anchoredEnd = raw.endsWith('$');

    // Strip anchors before escaping and wildcard expansion
    const core = raw.slice(anchoredStart ? 1 : 0, anchoredEnd ? raw.length - 1 : raw.length);

    const hasWildcards = /[*?]/.test(core);
    const escaped = core
        .replace(/[.+^${}()|[\]\\]/g, '\\$&') // escape regex specials except * and ?
        .replace(/\*/g, '.*')                 // expand wildcards
        .replace(/\?/g, '.');

    let regexPattern;
    if (anchoredStart || anchoredEnd) {
        // Honor explicit anchors as provided
        regexPattern = (anchoredStart ? '^' : '') + escaped + (anchoredEnd ? '$' : '');
    } else {
        // Preserve existing behavior:
        // - If wildcards present, match full string
        // - Otherwise, use substring match
        regexPattern = hasWildcards ? `^${escaped}$` : escaped;
    }

    return new RegExp(regexPattern, 'i');
}
