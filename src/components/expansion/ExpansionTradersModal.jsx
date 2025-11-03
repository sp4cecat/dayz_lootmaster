import React, { useEffect, useMemo, useState } from 'react';
import { listTraderFiles, getTraderFile, saveTraderFile, deleteTraderFile } from '../../utils/expansionApi.js';

export default function ExpansionTradersModal({ onClose, onOpenAppearance }) {
  const [files, setFiles] = useState([]);
  const [selected, setSelected] = useState('');
  const [data, setData] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Inline legend for enum values
  const MODE_OPTIONS = [
    { value: 0, label: '0 = Buy only (cannot sell)' },
    { value: 1, label: '1 = Buy & Sell' },
    { value: 2, label: '2 = Sell only (cannot buy)' },
    { value: 3, label: '3 = Hidden (customization/attachments only)' }
  ];

  async function refreshList() {
    try {
      setError('');
      const f = await listTraderFiles();
      setFiles(f);
      if (f.length && !selected) setSelected(f[0]);
    } catch (e) { setError(String(e)); }
  }

  useEffect(() => { refreshList(); }, []);

  useEffect(() => {
    if (!selected) { setData(null); return; }
    setLoading(true);
    getTraderFile(selected).then(setData).catch(e => setError(String(e))).finally(() => setLoading(false));
    setDirty(false);
  }, [selected]);

  const setField = (k, v) => { setData(d => ({ ...(d || {}), [k]: v })); setDirty(true); };

  const arrField = (arr) => Array.isArray(arr) ? arr : [];

  const updateArrayFromCsv = (key, csv) => {
    const arr = csv.split(',').map(s => s.trim()).filter(Boolean);
    setField(key, arr);
  };

  const currenciesCsv = useMemo(() => (arrField(data?.Currencies)).join(', '), [data]);

  // ---- Categories (structured list with enum) ----
  const categoriesRows = useMemo(() => {
    const src = arrField(data?.Categories);
    return src.map(s => {
      const idx = s.lastIndexOf(':');
      const name = idx >= 0 ? s.slice(0, idx) : s;
      const raw = idx >= 0 ? s.slice(idx + 1) : '1';
      let mode = Number(raw);
      if (!Number.isInteger(mode) || mode < 0 || mode > 3) mode = 1;
      return { name, mode };
    }).sort((a, b) => a.name.localeCompare(b.name));
  }, [data]);

  function setCategoriesFromRows(rows) {
    const next = rows.map(r => `${r.name}:${Number(r.mode) | 0}`);
    setField('Categories', next);
  }

  const addCategory = () => {
    const name = prompt('New category name (e.g. Ammo)');
    if (!name) return;
    const exists = categoriesRows.some(r => r.name.toLowerCase() === name.toLowerCase());
    if (exists) { alert('Category already exists'); return; }
    setCategoriesFromRows([ ...categoriesRows, { name, mode: 1 } ]);
  };

  const removeCategory = (name) => {
    setCategoriesFromRows(categoriesRows.filter(r => r.name !== name));
  };

  const openEditCategory = (name) => {
    const row = categoriesRows.find(r => r.name === name);
    if (row) setEdit({ kind: 'cat', key: row.name, mode: row.mode });
  };

  // ---- Items (structured list with enum) ----
  const itemsEntries = useMemo(() => {
    const items = (data && data.Items && typeof data.Items === 'object') ? data.Items : {};
    return Object.keys(items)
      .map(name => {
        let mode = Number(items[name]);
        if (!Number.isInteger(mode) || mode < 0 || mode > 3) mode = 1;
        return { name, mode };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [data]);

  function setItemsFromRows(rows) {
    const next = {};
    for (const r of rows) next[r.name] = Number(r.mode) | 0;
    setField('Items', next);
  }

  const addItem = () => {
    const name = prompt('Item class name to add');
    if (!name) return;
    const exists = itemsEntries.some(r => r.name.toLowerCase() === name.toLowerCase());
    if (exists) { alert('Item already exists'); return; }
    setItemsFromRows([ ...itemsEntries, { name, mode: 1 } ]);
  };

  const removeItem = (name) => {
    setItemsFromRows(itemsEntries.filter(r => r.name !== name));
  };

  const openEditItem = (name) => {
    const row = itemsEntries.find(r => r.name === name);
    if (row) setEdit({ kind: 'item', key: row.name, mode: row.mode });
  };

  // Small popup dialog state for editing a single mode
  const [edit, setEdit] = useState(/** @type {null | { kind: 'item' | 'cat', key: string, mode: 0|1|2|3 }} */(null));

  const applyEdit = () => {
    if (!edit) return;
    if (edit.kind === 'item') {
      const rows = itemsEntries.map(r => r.name === edit.key ? { ...r, mode: edit.mode } : r);
      setItemsFromRows(rows);
    } else {
      const rows = categoriesRows.map(r => r.name === edit.key ? { ...r, mode: edit.mode } : r);
      setCategoriesFromRows(rows);
    }
    setEdit(null);
  };

  const Legend = () => (
    <div className="muted" style={{ fontSize: 12, lineHeight: 1.35, border: '1px solid var(--border)', borderRadius: 6, padding: 8, background: 'var(--bg)' }}>
      <div><strong>Legend</strong></div>
      <div>0 = Can only be bought from this trader, but not sold</div>
      <div>1 = Buy and Sell</div>
      <div>2 = Can only be sold to this trader, but not bought</div>
      <div>3 = Not visible but still available for item customisation (weapons, vests, backpacks) and attachments</div>
    </div>
  );

  const onSave = async () => {
    if (!selected) return;
    try {
      setError('');
      await saveTraderFile(selected, data || {});
      setDirty(false);
      await refreshList();
      alert('Saved.');
    } catch (e) { setError(String(e)); }
  };

  const onDelete = async () => {
    if (!selected) return;
    if (!window.confirm(`Delete trader file ${selected}.json?`)) return;
    try {
      await deleteTraderFile(selected);
      setSelected('');
      setData(null);
      await refreshList();
    } catch (e) { setError(String(e)); }
  };

  const onCreate = async () => {
    const name = prompt('New trader file name (without .json):');
    if (!name) return;
    const base = {
      m_Version: 12,
      DisplayName: 'New Trader',
      MinRequiredReputation: 0,
      MaxRequiredReputation: 2147483647,
      RequiredFaction: '',
      RequiredCompletedQuestID: -1,
      TraderIcon: 'Deliver',
      Currencies: ['expansionbanknotehryvnia'],
      DisplayCurrencyValue: 1,
      DisplayCurrencyName: '',
      Categories: [],
      Items: {}
    };
    try {
      await saveTraderFile(name, base);
      setSelected(name);
      await refreshList();
    } catch (e) { setError(String(e)); }
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Expansion Traders">
      <div className="modal" style={{ maxWidth: 1100, width: '94vw' }}>
        <div className="modal-header">
          <h2>Expansion: Traders</h2>
          <div className="spacer" />
          <button className="btn" onClick={onClose} aria-label="Close" title="Close">Close</button>
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
            {!selected && <div className="muted">Select a trader file or create one.</div>}
            {selected && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                  <h3 style={{ margin: 0 }}>{selected}.json</h3>
                  {dirty && <span className="chip" title="Unsaved changes">Unsaved</span>}
                  <div className="spacer" />
                  <button className="btn" onClick={onDelete}>Delete</button>
                  <button className="btn primary" onClick={onSave} disabled={!dirty || loading}>Save</button>
                </div>
                {loading && <div className="muted">Loading…</div>}
                {error && <div className="banner warn">{String(error)}</div>}
                {data && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div>
                      <div className="control"><label>Display Name</label><input value={data.DisplayName || ''} onChange={e => setField('DisplayName', e.target.value)} /></div>
                      <div className="control"><label>Trader Icon</label><input value={data.TraderIcon || ''} onChange={e => setField('TraderIcon', e.target.value)} /></div>
                      <div className="control"><label>Min Reputation</label><input type="number" value={data.MinRequiredReputation ?? 0} onChange={e => setField('MinRequiredReputation', Number(e.target.value))} /></div>
                      <div className="control"><label>Max Reputation</label><input type="number" value={data.MaxRequiredReputation ?? 0} onChange={e => setField('MaxRequiredReputation', Number(e.target.value))} /></div>
                      <div className="control"><label>Required Faction</label><input value={data.RequiredFaction || ''} onChange={e => setField('RequiredFaction', e.target.value)} /></div>
                      <div className="control"><label>Required Completed Quest ID</label><input type="number" value={data.RequiredCompletedQuestID ?? -1} onChange={e => setField('RequiredCompletedQuestID', Number(e.target.value))} /></div>
                      <div className="control"><label>Display Currency Name</label><input value={data.DisplayCurrencyName || ''} onChange={e => setField('DisplayCurrencyName', e.target.value)} /></div>
                      <div className="control"><label>Display Currency Value</label><input type="number" value={data.DisplayCurrencyValue ?? 1} onChange={e => setField('DisplayCurrencyValue', Number(e.target.value))} /></div>
                      <div className="control"><label>Currencies (comma)</label><input value={currenciesCsv} onChange={e => updateArrayFromCsv('Currencies', e.target.value)} /></div>

                      {/* Categories structured list */}
                      <div className="card" style={{ padding: 8, marginTop: 12 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <h4 style={{ margin: 0 }}>Categories</h4>
                          <div className="spacer" />
                          <button className="btn" onClick={addCategory}>Add</button>
                        </div>
                        <div style={{ marginTop: 6 }}>
                          <Legend />
                        </div>
                        <div className="list" style={{ maxHeight: 240, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 6, marginTop: 8 }}>
                          {categoriesRows.length === 0 && <div className="muted" style={{ padding: 8 }}>No categories.</div>}
                          {categoriesRows.map(r => (
                            <div key={r.name} className="list-row" style={{ display: 'grid', gridTemplateColumns: '1fr 140px 80px', gap: 8, padding: '6px 8px', alignItems: 'center' }}>
                              <span className="mono" style={{ cursor: 'pointer' }} onClick={() => openEditCategory(r.name)} title="Click to change mode">{r.name}</span>
                              <button className="btn" onClick={() => openEditCategory(r.name)} title="Change mode">Mode: {r.mode}</button>
                              <button className="btn" onClick={() => removeCategory(r.name)}>Remove</button>
                            </div>
                          ))}
                        </div>
                      </div>

                      {onOpenAppearance && (
                        <div className="control" style={{ marginTop: 12 }}>
                          <button className="btn" onClick={() => onOpenAppearance()}>Open Appearance Editor…</button>
                        </div>
                      )}
                    </div>

                    {/* Items structured list */}
                    <div>
                      <div className="card" style={{ padding: 8 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <h4 style={{ margin: 0 }}>Items</h4>
                          <div className="spacer" />
                          <button className="btn" onClick={addItem}>Add</button>
                        </div>
                        <div style={{ marginTop: 6 }}>
                          <Legend />
                        </div>
                        <div className="list" style={{ maxHeight: 340, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 6, marginTop: 8 }}>
                          {itemsEntries.length === 0 && <div className="muted" style={{ padding: 8 }}>No items.</div>}
                          {itemsEntries.map(r => (
                            <div key={r.name} className="list-row" style={{ display: 'grid', gridTemplateColumns: '1fr 140px 80px', gap: 8, padding: '6px 8px', alignItems: 'center' }}>
                              <span className="mono" style={{ cursor: 'pointer' }} onClick={() => openEditItem(r.name)} title="Click to change mode">{r.name}</span>
                              <button className="btn" onClick={() => openEditItem(r.name)} title="Change mode">Mode: {r.mode}</button>
                              <button className="btn" onClick={() => removeItem(r.name)}>Remove</button>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Inline popup for mode selection */}
        {edit && (
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            onClick={() => setEdit(null)}
            aria-hidden
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-label={`Set mode for ${edit.key}`}
              onClick={(e) => e.stopPropagation()}
              style={{ background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8, padding: 12, minWidth: 300, boxShadow: '0 6px 24px rgba(0,0,0,.3)' }}
            >
              <div style={{ marginBottom: 8 }}>
                <strong>{edit.kind === 'item' ? 'Item' : 'Category'}:</strong> <span className="mono">{edit.key}</span>
              </div>
              <div className="list" style={{ display: 'grid', gap: 6 }}>
                {MODE_OPTIONS.map(opt => (
                  <label key={opt.value} className="checkbox" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input
                      type="radio"
                      name="mode"
                      checked={edit.mode === opt.value}
                      onChange={() => setEdit(prev => prev ? { ...prev, mode: opt.value } : prev)}
                    />
                    <span>{opt.label}</span>
                  </label>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 10 }}>
                <button className="btn" onClick={() => setEdit(null)}>Cancel</button>
                <button className="btn primary" onClick={applyEdit}>Apply</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
