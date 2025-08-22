import React, { useMemo, useState } from 'react';

/**
 * Simple login screen to choose or create an editorID.
 *
 * @param {{
 *   existingIDs: string[],
 *   onSelect: (id: string) => void
 * }} props
 */
export default function EditorLogin({ existingIDs, onSelect }) {
  const [value, setValue] = useState('');
  const sorted = useMemo(() => [...(existingIDs || [])].sort((a, b) => a.localeCompare(b)), [existingIDs]);

  const create = () => {
    const v = value.trim();
    if (!v) return;
    onSelect(v);
  };

  return (
    <div className="app app-center" style={{ padding: 24 }}>
      <div
        style={{
          width: 420,
          maxWidth: '90%',
          border: '1px solid var(--border)',
          borderRadius: 12,
          padding: 20,
          background: 'var(--bg)',
          display: 'flex',
          flexDirection: 'column',
          gap: 12
        }}
      >
        <h2 style={{ margin: 0 }}>Choose editor ID</h2>
        <p className="muted" style={{ marginTop: -6 }}>
          Select a previous ID or create a new one to continue.
        </p>

        {sorted.length > 0 && (
          <div className="control">
            <span>Previous IDs</span>
            <div className="chips" role="list">
              {sorted.map(id => (
                <button
                  type="button"
                  key={id}
                  role="listitem"
                  className="chip"
                  onClick={() => onSelect(id)}
                  title={`Use "${id}"`}
                >
                  {id}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="control">
          <span>New ID</span>
          <div className="filters-row" style={{ alignItems: 'center' }}>
            <input
              type="text"
              placeholder="Enter a new editor ID"
              value={value}
              onChange={e => setValue(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') create(); }}
              style={{ flex: 1 }}
            />
            <button className="btn primary" type="button" onClick={create} style={{ whiteSpace: 'nowrap' }}>
              Create
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
