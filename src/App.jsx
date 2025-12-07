import React, {useMemo, useRef, useState} from 'react';
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
import EditorLogin from './components/EditorLogin.jsx';
import AdmRecordsModal from './components/AdmRecordsModal.jsx';
import StashReportModal from './components/StashReportModal.jsx';
import TraderEditorModal from './components/TraderEditorModal.jsx';
import MarketCategoryEditorModal from './components/MarketCategoryEditorModal.jsx';
import {generateTypesXml, generateLimitsXml} from './utils/xml.js';

/**
 * @typedef {import('./utils/xml.js').Type} Type
 */

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
        loadWarnings
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
    const [toolsOpen, setToolsOpen] = useState(false);
    const [showAdm, setShowAdm] = useState(false);
    const [showStash, setShowStash] = useState(false);
    const [marketOpen, setMarketOpen] = useState(false);
    const [showTraderEditor, setShowTraderEditor] = useState(false);
    const [showMarketCategories, setShowMarketCategories] = useState(false);

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
                  'X-Editor-ID': editorID || 'unknown'
                },
                body: defsXml
            });
            if (!defsRes.ok) {
                throw new Error(`Failed to save cfglimitsdefinition.xml (${defsRes.status})`);
            }

            // Save all group type files (skip vanilla base file entirely)
            for (const g of groups) {
              if (g === 'vanilla') continue; // do not persist ./data/db/types.xml
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
                    'X-Editor-ID': editorID || 'unknown'
                  },
                  body: xml
                });
                if (!res.ok) {
                  throw new Error(`Failed to save ${g}/${file}.xml (${res.status})`);
                }
              }
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

    // Inactivity timeout: sign out after 10 minutes of no user activity
    React.useEffect(() => {
      if (!editorID) return;
      const TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
      let timerId;

      const resetTimer = () => {
        if (timerId) clearTimeout(timerId);
        timerId = setTimeout(() => {
          // Auto sign out on inactivity
          signOut();
          // Reset filters when session ends
          setFilters({
            category: 'all',
            name: '',
            usage: [],
            value: [],
            tag: [],
            flags: [],
            changedOnly: false,
            groups: []
          });
        }, TIMEOUT_MS);
      };

      const events = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'];
      events.forEach(evt => window.addEventListener(evt, resetTimer, { passive: true }));
      // Start timer immediately
      resetTimer();

      return () => {
        if (timerId) clearTimeout(timerId);
        events.forEach(evt => window.removeEventListener(evt, resetTimer));
      };
    }, [editorID, signOut, setFilters]);

    // Resizable left pane (filters)
    const [leftWidth, setLeftWidth] = useState(300); // default 300px
    const dragStartXRef = useRef(0);
    const startWidthRef = useRef(300);
    const draggingRef = useRef(false);

    const onResizeStart = (e) => {
        draggingRef.current = true;
        dragStartXRef.current = e.clientX;
        startWidthRef.current = leftWidth;
        window.addEventListener('mousemove', onResizing);
        window.addEventListener('mouseup', onResizeEnd);
    };
    const onResizing = (e) => {
        if (!draggingRef.current) return;
        const delta = e.clientX - dragStartXRef.current;
        const next = Math.max(300, Math.min(600, startWidthRef.current + delta));
        setLeftWidth(next);
    };
    const onResizeEnd = () => {
        draggingRef.current = false;
        window.removeEventListener('mousemove', onResizing);
        window.removeEventListener('mouseup', onResizeEnd);
    };

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

    // Dismissible warnings: hide current warnings until new alerts are generated
    const [dismissedWarningsKey, setDismissedWarningsKey] = useState(/** @type {string|null} */(null));
    const warningsKey = useMemo(() => {
        const parts = [];
        if (unknowns?.hasAny) parts.push('unknowns');
        if (lwKey) parts.push(lwKey);
        if (noFlagsCount > 0) parts.push(`noflags:${noFlagsCount}`);
        return parts.join(';');
    }, [unknowns?.hasAny, lwKey, noFlagsCount]);
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
                <div>Failed to load: {String(error)}</div>
            </div>
        );
    }
    if (!definitions || !lootTypes) return null;

    return (
        <div className="app">
            <header className="app-header">
                <div className="brand">
                    <h1>DayZ Lootmaster</h1>
                </div>
                <div className="header-actions">
                    <button
                        className={`btn icon-only ${storageDirty ? 'status-warn' : 'icon-muted'}`}
                        onClick={() => setShowStorage(true)}
                        title={storageDirty ? 'Changes detected — click to view' : 'Storage status (click to view differences)'}
                        aria-label={storageDirty ? 'Changes detected — storage status' : 'Storage status'}
                    >
                        {storageDirty ? (
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                <path d="M12 3.5l9.5 17a1 1 0 0 1-.87 1.5H3.37a1 1 0 0 1-.87-1.5L12 3.5Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/>
                                <path d="M12 9v5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
                                <circle cx="12" cy="16.5" r="1" fill="currentColor"/>
                            </svg>
                        ) : (
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                <path d="M4 7a2 2 0 0 1 2-2h9l5 5v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7Z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                                <path d="M14 5v6H6V5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                        )}
                    </button>
                    <button
                        className="btn"
                        onClick={undo}
                        disabled={!canUndo}
                        title="Undo (Ctrl/Cmd+Z)"
                        aria-label="Undo"
                    >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                            <path d="M8 7H5V4M5 7l4.5-4.5M5 7h8a6 6 0 1 1 0 12h-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                    </button>
                    <button
                        className="btn"
                        onClick={redo}
                        disabled={!canRedo}
                        title="Redo (Ctrl/Cmd+Shift+Z)"
                        aria-label="Redo"
                    >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                            <path d="M16 7h3V4M19 7l-4.5-4.5M19 7h-8a6 6 0 1 0 0 12h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                    </button>
                    <button
                        className={saving || !storageDirty ? "btn muted" : "btn primary"}
                        disabled={saving || !storageDirty}
                        onClick={() => setShowExport(true)}>Export XML
                    </button>
                    <button
                        className={saving || !storageDirty ? "btn muted" : "btn primary"}
                        onClick={persistAllToFiles}
                        disabled={saving || !storageDirty}
                        title={storageDirty ? 'Persist current state to XML files on disk' : 'No changes to save'}
                        aria-label="Save changes permanently"
                    >
                        {saving ? 'Saving…' : 'Set Changes Live'}
                    </button>
                    <button
                        className="btn"
                        onClick={() => {
                            const ok = window.confirm('Warning: All data will be reloaded from files and any existing changes will be lost. This will reset in-memory state, IndexedDB (including edit logs), and re-parse from /samples.\n\nDo you want to continue?');
                            if (ok) reloadFromFiles();
                        }}
                        title="Reload from Files"
                        aria-label="Reload from Files"
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{marginRight: 6}}>
                            <path d="M4 4v6h6M20 20v-6h-6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                            <path d="M20 10a8 8 0 0 0-13.66-5.66L4 6M4 14a8 8 0 0 0 13.66 5.66L20 18" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                        Reload from Files
                    </button>

                    {/* Marketplace dropdown */}
                    <div className="dropdown" style={{ position: 'relative', display: 'inline-block', marginRight: 8 }}>
                      <button
                        className="btn"
                        onClick={() => setMarketOpen(v => !v)}
                        aria-haspopup="menu"
                        aria-expanded={marketOpen}
                        title="Marketplace"
                      >
                        Marketplace ▾
                      </button>
                      {marketOpen && (
                        <div
                          className="dropdown-menu"
                          role="menu"
                          style={{
                            position: 'absolute',
                            right: 0,
                            top: '100%',
                            background: 'var(--bg)',
                            border: '1px solid var(--border)',
                            borderRadius: 8,
                            padding: 8,
                            minWidth: 200,
                            zIndex: 10
                          }}
                        >
                          <div style={{ fontWeight: 600, padding: '4px 6px', opacity: 0.7 }}>Marketplace</div>
                          <button className="link" role="menuitem" onClick={() => { setShowTraderEditor(true); setMarketOpen(false); }}>Traders</button>
                          <button className="link" role="menuitem" onClick={() => { setShowMarketCategories(true); setMarketOpen(false); }}>Categories</button>
                        </div>
                      )}
                    </div>

                    {/* Tools dropdown */}
                    <div className="dropdown" style={{ position: 'relative', display: 'inline-block' }}>
                      <button
                        className="btn"
                        onClick={() => setToolsOpen(v => !v)}
                        aria-haspopup="menu"
                        aria-expanded={toolsOpen}
                        title="Tools"
                      >
                        Tools ▾
                      </button>
                      {toolsOpen && (
                        <div
                          className="dropdown-menu"
                          role="menu"
                          style={{
                            position: 'absolute',
                            right: 0,
                            top: '100%',
                            background: 'var(--bg)',
                            border: '1px solid var(--border)',
                            borderRadius: 8,
                            padding: 8,
                            minWidth: 180,
                            zIndex: 10
                          }}
                        >
                          <button className="link" role="menuitem" onClick={() => { setShowAdm(true); setToolsOpen(false); }}>ADM records</button>
                          <button className="link" role="menuitem" onClick={() => { setShowStash(true); setToolsOpen(false); }}>Stash report</button>
                        </div>
                      )}
                    </div>

                    <ThemeToggle/>
                    <div className="profile" ref={profileRef}>
                        <button
                            className="btn profile-btn"
                            onClick={() => setProfileOpen(v => !v)}
                            title="Profile"
                            aria-haspopup="menu"
                            aria-expanded={profileOpen}
                        >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                <circle cx="12" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.6"/>
                                <path d="M4 19c1.5-3.5 4.5-5 8-5s6.5 1.5 8 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
                            </svg>
                            <span className="profile-id">{editorID}</span>
                        </button>
                        {profileOpen && (
                            <div className="dropdown-menu" role="menu">
                                <button className="link" role="menuitem" onClick={signOut}>Sign out</button>
                            </div>
                        )}
                    </div>
                </div>
            </header>

            {unknowns.hasAny && (
                <div className="banner warn">
                    Unknown entries detected in usage/value/tag or category not in definitions.
                    <button className="link" onClick={() => resolveUnknowns.open()}>Review</button>
                </div>
            )}
            {warningsKey !== dismissedWarningsKey && noFlagsCount > 0 && (
                <div className="banner warn" role="status" aria-live="polite">
                    {noFlagsCount} type{noFlagsCount === 1 ? '' : 's'} have no flags set.
                    <div className="spacer"/>
                    <button className="link" onClick={dismissWarnings} title="Dismiss warnings">Dismiss</button>
                </div>
            )}
            {saveNotice && (
                <div className="banner" role="status" aria-live="polite">
                    <span>{saveNotice}</span>
                    <div className="spacer"/>
                    <button className="link" onClick={() => setSaveNotice(null)} title="Dismiss">Dismiss</button>
                </div>
            )}

            <main className="content two-pane">
                <aside className="left-pane" style={{width: `${leftWidth}px`}}>
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
                </aside>
                <div
                    className="pane-resizer"
                    role="separator"
                    aria-orientation="vertical"
                    aria-valuemin={300}
                    aria-valuemax={600}
                    aria-valuenow={leftWidth}
                    onMouseDown={onResizeStart}
                    title="Drag to resize filters panel"
                />
                <section className="right-pane">
                    <div className={`table-and-form ${selectedTypes.length > 0 ? 'has-form' : ''}`}>
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
                        {selectedTypes.length > 0 && (
                            <div className="edit-form-container" key={editKey}>
                                <EditForm
                                    definitions={definitions}
                                    selectedTypes={selectedTypes}
                                    onCancel={onCancelEdit}
                                    onSave={onSaveEdit}
                                    typeOptions={allTypeNames}
                                    typeOptionsByCategory={typeNamesByCategory}
                                />
                            </div>
                        )}
                    </div>
                </section>
            </main>

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
              <AdmRecordsModal onClose={() => setShowAdm(false)} />
            )}
            {showStash && (
              <StashReportModal onClose={() => setShowStash(false)} />
            )}
            {showTraderEditor && (
              <TraderEditorModal onClose={() => setShowTraderEditor(false)} />
            )}
            {showMarketCategories && (
              <MarketCategoryEditorModal onClose={() => setShowMarketCategories(false)} />
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
