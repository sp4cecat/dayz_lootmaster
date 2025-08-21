import React, { useState } from 'react';

/**
 * Modal to manage entries in usage/value/tags definitions.
 * Renders entries as chips with an 'x' button to remove and allows adding new entries.
 *
 * @param {{
 *  kind: 'usage'|'value'|'tag',
 *  entries: string[],
 *  countRefs: (kind: 'usage'|'value'|'tag', entry: string) => number,
 *  removeEntry: (kind: 'usage'|'value'|'tag', entry: string) => void,
 *  addEntry: (kind: 'usage'|'value'|'tag', entry: string) => void,
 *  onClose: () => void
 * }} props
 */
export default function ManageDefinitionsModal({ kind, entries, countRefs, removeEntry, addEntry, onClose }) {
  const label = kind === 'usage' ? 'Usage' : kind === 'value' ? 'Value' : 'Tag';
  const [newEntry, setNewEntry] = useState('');

  const isCapped = kind === 'usage' || kind === 'value';
  const cap = 32;
  const count = entries.length;

  const onRemoveClick = (entry) => {
    const refCount = countRefs(kind, entry);
    const proceed = window.confirm(
      refCount > 0
        ? `${refCount} type(s) currently reference "${entry}" in ${label.toLowerCase()}. Removing it will delete this value from those types. Do you want to proceed?`
        : `Remove "${entry}" from ${label.toLowerCase()}?`
    );
    if (!proceed) return;
    removeEntry(kind, entry);
  };

  const onAdd = () => {
    const v = newEntry.trim();
    if (!v) return;
    if (entries.includes(v)) {
      window.alert(`"${v}" already exists in ${label.toLowerCase()}.`);
      return;
    }
    if (isCapped && count >= cap) {
      window.alert(`${label} has a maximum of ${cap} entries. Remove an entry before adding another.`);
      return;
    }
    addEntry(kind, v);
    setNewEntry('');
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onAdd();
    }
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={`Manage ${label}`}>
      <div className="modal">
        <div className="modal-header">
          <h2>Manage {label}</h2>
        </div>
        <div className="modal-body">
          <div className="control" style={{ maxWidth: 320 }}>
            <span>Add new {label.toLowerCase()}</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="text"
                value={newEntry}
                onChange={e => setNewEntry(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder={`Enter ${label.toLowerCase()} name`}
              />
              <button className="btn primary" type="button" onClick={onAdd}>Add</button>
            </div>
          </div>

          {isCapped && count === cap && (
            <div className="banner warn" role="status" aria-live="polite">
              {label} is at the maximum of {cap} entries. Adding another will exceed the limit.
            </div>
          )}
          {isCapped && count > cap && (
            <div className="banner warn" role="status" aria-live="polite">
              {label} exceeds the maximum of {cap} entries (currently {count}). Please remove entries.
            </div>
          )}

          {entries.length === 0 ? (
            <p className="muted">No entries.</p>
          ) : (
            <div className="chips" style={{ marginTop: 12 }}>
              {entries.map(e => (
                <span key={e} className="chip">
                  {e}
                  <button
                    type="button"
                    className="chip-close"
                    aria-label={`Remove ${e}`}
                    title={`Remove ${e}`}
                    onClick={() => onRemoveClick(e)}
                    style={{
                      marginLeft: '6px',
                      border: 'none',
                      background: 'transparent',
                      cursor: 'pointer',
                      fontWeight: 'bold'
                    }}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
