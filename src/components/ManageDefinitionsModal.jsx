import React from 'react';

/**
 * Modal to manage entries in usage/value/tags definitions.
 * Renders entries as chips with an 'x' button to remove.
 *
 * @param {{
 *  kind: 'usage'|'value'|'tag',
 *  entries: string[],
 *  countRefs: (kind: 'usage'|'value'|'tag', entry: string) => number,
 *  removeEntry: (kind: 'usage'|'value'|'tag', entry: string) => void,
 *  onClose: () => void
 * }} props
 */
export default function ManageDefinitionsModal({ kind, entries, countRefs, removeEntry, onClose }) {
  const label = kind === 'usage' ? 'Usage' : kind === 'value' ? 'Value' : 'Tag';

  const onRemoveClick = (entry) => {
    const count = countRefs(kind, entry);
    const proceed = window.confirm(
      count > 0
        ? `${count} type(s) currently reference "${entry}" in ${label.toLowerCase()}. Removing it will delete this value from those types. Do you want to proceed?`
        : `Remove "${entry}" from ${label.toLowerCase()}?`
    );
    if (!proceed) return;
    removeEntry(kind, entry);
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={`Manage ${label}`}>
      <div className="modal">
        <div className="modal-header">
          <h2>Manage {label}</h2>
        </div>
        <div className="modal-body">
          {entries.length === 0 ? (
            <p className="muted">No entries.</p>
          ) : (
            <div className="chips">
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
