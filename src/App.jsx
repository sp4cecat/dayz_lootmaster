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
import { generateTypesXml } from './utils/xml.js';

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
    getGroupFiles
  } = useLootData();

  const [showExport, setShowExport] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [manageKind, setManageKind] = useState(/** @type {'usage'|'value'|'tag'|null} */(null));

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

  const filteredTypes = useMemo(() => {
    if (!lootTypes) return [];
    const { category, name, usage, value, tag, groups: selectedGroups } = filters;
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
      if (usage.length && !usage.every(u => t.usage.includes(u))) return false;
      if (value.length && !value.every(v => t.value.includes(v))) return false;
      return !(tag.length && !tag.every(g => t.tag.includes(g)));

    });
  }, [lootTypes, filters]);

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
          <ThemeToggle />
        </div>
      </header>

      {unknowns.hasAny && (
        <div className="banner warn">
          Unknown entries detected in usage/value/tag or category not in definitions.
          <button className="link" onClick={() => resolveUnknowns.open()}>Review</button>
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
          definitions={definitions}
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
    </div>
  );
}

/**
 * Convert wildcard string (* ?) to RegExp.
 * @param {string} pattern
 * @returns {RegExp}
 */
function wildcardToRegExp(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i');
}
