import React, { useMemo, useRef, useState } from 'react';
import { useLootData } from './hooks/useLootData.js';
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
    getBaselineFileTypes
  } = useLootData();

  const [showExport, setShowExport] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [manageKind, setManageKind] = useState(/** @type {'usage'|'value'|'tag'|null} */(null));
  const [showStorage, setShowStorage] = useState(false);

  // Editor ID gating
  const EDITOR_ID_SELECTED = 'dayz-editor:editorID:selected';
  const EDITOR_ID_LIST = 'dayz-editor:editorIDs';

  const [editorID, setEditorID] = useState(() => {
    try { return localStorage.getItem(EDITOR_ID_SELECTED) || null; } catch { return null; }
  });
  const [editorIDs, setEditorIDs] = useState(() => {
    try {
      const raw = localStorage.getItem(EDITOR_ID_LIST);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch { return []; }
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
    try { localStorage.removeItem(EDITOR_ID_SELECTED); } catch { /* ignore */ }
    setProfileOpen(false);
    setEditorID(null);
    setChangeEditorID('');
  };

  // Keep hook aware of current editorID
  React.useEffect(() => {
    if (editorID) setChangeEditorID(editorID);
  }, [editorID, setChangeEditorID]);

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

  const filteredTypes = useMemo(() => {
    if (!lootTypes) return [];
    const { category, name, usage, value, tag, flags, groups: selectedGroups } = filters;
    const selectedGroupsSet = new Set(selectedGroups);
    const namePattern = name?.trim() ? wildcardToRegExp(name.trim()) : null;

    return lootTypes.filter(t => {
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

  const selectedTypes = useMemo(() => {
    if (!lootTypes) return [];
    return lootTypes.filter(t => selection.has(t.name));
  }, [lootTypes, selection]);

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
        return { ...t, ...updated };
      }
      return t;
    });
    setLootTypes(newTypes, { persist: true });
    pushHistory(newTypes);
    setEditKey(k => k + 1);
    // Close the edit form by clearing the selection after persisting
    setSelection(new Set());
  };

  if (!editorID) {
    return <EditorLogin existingIDs={editorIDs} onSelect={selectEditorID} />;
  }

  if (loading) {
    return (
      <div className="app app-center">
        <div className="spinner" aria-label="Loading" />
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
            className={`btn icon-only ${storageDirty ? '' : 'icon-muted'}`}
            onClick={() => setShowStorage(true)}
            title="Storage status (click to view differences)"
            aria-label="Storage status"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M4 7a2 2 0 0 1 2-2h9l5 5v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7Z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M14 5v6H6V5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
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
          <button className="btn primary" onClick={() => setShowExport(true)}>Export XML</button>
          <button
            className="btn"
            onClick={() => {
              const ok = window.confirm('Warning: All data will be reloaded from files and any existing changes will be lost. This will reset in-memory state, IndexedDB (including edit logs), and re-parse from /samples.\n\nDo you want to continue?');
              if (ok) reloadFromFiles();
            }}
            title="Reload from Files"
            aria-label="Reload from Files"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ marginRight: 6 }}>
              <path d="M4 4v6h6M20 20v-6h-6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M20 10a8 8 0 0 0-13.66-5.66L4 6M4 14a8 8 0 0 0 13.66 5.66L20 18" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Reload from Files
          </button>
          <ThemeToggle />
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
      {noFlagsCount > 0 && (
        <div className="banner warn" role="status" aria-live="polite">
          {noFlagsCount} type{noFlagsCount === 1 ? '' : 's'} have no flags set.
        </div>
      )}

      <main className="content two-pane">
        <aside className="left-pane" style={{ width: `${leftWidth}px` }}>
          <Filters
            definitions={definitions}
            groups={groups}
            filters={filters}
            onChange={setFilters}
            onManage={(kind) => { setManageKind(kind); setManageOpen(true); }}
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
          <div className="table-and-form">
            <TypesTable
              definitions={definitions}
              types={filteredTypes}
              selection={selection}
              setSelection={setSelection}
              unknowns={unknowns}
              condensed={selectedTypes.length > 0}
              duplicatesByName={duplicatesByName}
              storageDiff={storageDiff}
            />
            {selectedTypes.length > 0 && (
              <div className="edit-form-container" key={editKey}>
                <EditForm
                  definitions={definitions}
                  selectedTypes={selectedTypes}
                  onCancel={onCancelEdit}
                  onSave={onSaveEdit}
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
        <SummaryModal summary={summary} onClose={closeSummary} />
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
          onClose={() => { setManageOpen(false); setManageKind(null); }}
        />
      )}
      {showStorage && storageDiff && (
        <StorageStatusModal diff={storageDiff} onClose={() => setShowStorage(false)} />
      )}
    </div>
  );
}

/**
 * Convert wildcard string (* ?) to RegExp.
 * If no wildcard is provided, match as a substring (implicit *term*).
 * @param {string} pattern
 * @returns {RegExp}
 */
function wildcardToRegExp(pattern) {
  const hasWildcards = /[*?]/.test(pattern);
  const effective = hasWildcards ? pattern : `${pattern}`;
  const escaped = effective.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  const regexPattern = hasWildcards ? `^${escaped}$` : `${escaped}`;
  console.log("Escaped = ", escaped)
  return new RegExp(regexPattern, 'i');
}
