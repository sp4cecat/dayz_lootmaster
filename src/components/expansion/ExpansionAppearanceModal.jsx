import React, { useEffect, useState } from 'react';
import { listAppearanceFiles, getAppearanceFile, saveAppearanceFile, deleteAppearanceFile } from '../../utils/expansionApi.js';

export default function ExpansionAppearanceModal({ onClose }) {
  const [files, setFiles] = useState([]);
  const [selected, setSelected] = useState('');
  const [text, setText] = useState('');
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function refreshList() {
    try {
      setError('');
      const f = await listAppearanceFiles();
      setFiles(f);
      if (f.length && !selected) setSelected(f[0]);
    } catch (e) { setError(String(e)); }
  }

  useEffect(() => { refreshList(); }, []);

  useEffect(() => {
    if (!selected) { setText(''); setDirty(false); return; }
    setLoading(true);
    getAppearanceFile(selected).then(t => { setText(String(t || '')); setDirty(false); }).catch(e => setError(String(e))).finally(() => setLoading(false));
  }, [selected]);

  const onSave = async () => {
    if (!selected) return;
    try { await saveAppearanceFile(selected, text); setDirty(false); alert('Saved.'); } catch (e) { setError(String(e)); }
  };
  const onDelete = async () => {
    if (!selected) return;
    if (!window.confirm(`Delete appearance file ${selected}?`)) return;
    try { await deleteAppearanceFile(selected); setSelected(''); setText(''); await refreshList(); } catch (e) { setError(String(e)); }
  };
  const onCreate = async () => {
    const name = prompt('New appearance file name (with or without .map):');
    if (!name) return;
    const fname = name.endsWith('.map') ? name : `${name}.map`;
    try { await saveAppearanceFile(fname, text || ''); setSelected(fname); await refreshList(); } catch (e) { setError(String(e)); }
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Expansion Appearance (.map)">
      <div className="modal" style={{ maxWidth: 1000, width: '92vw' }}>
        <div className="modal-header">
          <h2>Expansion: Trader Appearance (.map)</h2>
        </div>
        <div className="modal-body" style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 12, minHeight: 480 }}>
          <div style={{ borderRight: '1px solid var(--border)', paddingRight: 8 }}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <button className="btn" onClick={onCreate}>New</button>
              <button className="btn" onClick={refreshList}>Refresh</button>
            </div>
            <div className="list" style={{ maxHeight: 410, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 6 }}>
              {files.length === 0 && <div className="muted" style={{ padding: 8 }}>No files.</div>}
              {files.map(f => (
                <div key={f} className={`list-row ${selected === f ? 'selected' : ''}`} onClick={() => setSelected(f)} style={{ padding: '6px 8px', cursor: 'pointer' }}>
                  {f}
                </div>
              ))}
            </div>
          </div>
          <div>
            {!selected && <div className="muted">Select an appearance file or create one.</div>}
            {selected && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                  <h3 style={{ margin: 0 }}>{selected}</h3>
                  {dirty && <span className="chip">Unsaved</span>}
                  <div className="spacer" />
                  <button className="btn" onClick={onDelete}>Delete</button>
                  <button className="btn primary" onClick={onSave} disabled={!dirty || loading}>Save</button>
                </div>
                {loading && <div className="muted">Loading…</div>}
                {error && <div className="banner warn">{String(error)}</div>}
                <div className="control">
                  <label>Map content</label>
                  <textarea rows={22} value={text} onChange={e => { setText(e.target.value); setDirty(true); }} style={{ width: '100%', fontFamily: 'var(--font-mono)' }} />
                </div>
                <div className="muted" style={{ marginTop: 6 }}>
                  Tip: Use attachments by listing them per Expansion docs. This is a raw editor; validation is not enforced here.
                </div>
              </>
            )}
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
