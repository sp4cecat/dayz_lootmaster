import React, { useMemo, useState } from 'react';
import { useLootData } from './hooks/useLootData.js';
import Filters from './components/Filters.jsx';
import TypesTable from './components/TypesTable.jsx';
import EditForm from './components/EditForm.jsx';
import ExportModal from './components/ExportModal.jsx';
import UnknownEntriesModal from './components/UnknownEntriesModal.jsx';
import ThemeToggle from './components/ThemeToggle.jsx';
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
  } = useLootData();

  const [showExport, setShowExport] = useState(false);

  const filteredTypes = useMemo(() => {
    if (!lootTypes) return [];
    const { category, name, usage, value, tag } = filters;
    const namePattern = name?.trim() ? wildcardToRegExp(name.trim()) : null;
    return lootTypes.filter(t => {
      if (category && category !== 'all' && t.category !== category) return false;
      if (namePattern && !namePattern.test(t.name)) return false;
      if (usage.length && !usage.every(u => t.usage.includes(u))) return false;
      if (value.length && !value.every(v => t.value.includes(v))) return false;
      if (tag.length && !tag.every(g => t.tag.includes(g))) return false;
      return true;
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
        return updatedPartial(t);
      }
      return t;
    });
    setLootTypes(newTypes, { persist: true });
    pushHistory(newTypes);
    setEditKey(k => k + 1);
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

  const xmlString = generateTypesXml(lootTypes);

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <span className="logo">🧰</span>
          <h1>DayZ Types Editor</h1>
        </div>
        <div className="header-actions">
          <button className="btn" onClick={undo} disabled={!canUndo} title="Undo (Ctrl/Cmd+Z)">Undo</button>
          <button className="btn" onClick={redo} disabled={!canRedo} title="Redo (Ctrl/Cmd+Shift+Z)">Redo</button>
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
        <aside className="left-pane">
          <Filters
            definitions={definitions}
            filters={filters}
            onChange={setFilters}
          />
        </aside>
        <section className="right-pane">
          <div className="table-and-form">
            <TypesTable
              definitions={definitions}
              types={filteredTypes}
              selection={selection}
              setSelection={setSelection}
              unknowns={unknowns}
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
        <ExportModal xml={xmlString} onClose={() => setShowExport(false)} />
      )}
      {resolveUnknowns.isOpen && (
        <UnknownEntriesModal
          unknowns={unknowns}
          onApply={resolveUnknowns.apply}
          onClose={resolveUnknowns.close}
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
