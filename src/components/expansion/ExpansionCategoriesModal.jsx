import React, { useEffect, useMemo, useState } from 'react';
import { listMarketFiles, getMarketFile, saveMarketFile, deleteMarketFile } from '../../utils/expansionApi.js';

export default function ExpansionCategoriesModal({ onClose }) {
  const [files, setFiles] = useState([]);
  const [selected, setSelected] = useState('');
  const [data, setData] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function refreshList() {
    try {
      setError('');
      const f = await listMarketFiles();
      setFiles(f);
      if (f.length && !selected) setSelected(f[0]);
    } catch (e) {
      setError(String(e));
    }
  }

  useEffect(() => { refreshList(); }, []);

  useEffect(() => {
    if (!selected) { setData(null); return; }
    setLoading(true);
    getMarketFile(selected).then(setData).catch(e => setError(String(e))).finally(() => setLoading(false));
    setDirty(false);
  }, [selected]);

  const items = useMemo(() => Array.isArray(data?.Items) ? data.Items : [], [data]);

  const setField = (k, v) => { setData(d => ({ ...(d || {}), [k]: v })); setDirty(true); };
  const updateItem = (idx, patch) => {
    const next = items.map((it, i) => i === idx ? ({ ...it, ...patch }) : it);
    setField('Items', next);
  };
  const addItem = () => { setField('Items', [...items, {
    ClassName: '', MaxPriceThreshold: 0, MinPriceThreshold: 0, SellPricePercent: -1,
    MaxStockThreshold: 0, MinStockThreshold: 0, QuantityPercent: -1, SpawnAttachments: [], Variants: []
  }]); };
  const removeItem = (idx) => { setField('Items', items.filter((_, i) => i !== idx)); };

  const rgbHex = (data?.Color || '').slice(0, 6) || 'FFFFFF';
  const alphaHex = (data?.Color || '').slice(6, 8) || 'FF';

  const onSave = async () => {
    if (!selected) return;
    try {
      setError('');
      // Ensure color format RRGGBBAA
      const color = `${rgbHex}${alphaHex}`.toUpperCase();
      const body = { ...(data || {}), Color: color };
      await saveMarketFile(selected, body);
      setDirty(false);
      await refreshList();
      alert('Saved.');
    } catch (e) { setError(String(e)); }
  };

  const onDelete = async () => {
    if (!selected) return;
    if (!window.confirm(`Delete category file ${selected}.json?`)) return;
    try {
      await deleteMarketFile(selected);
      setSelected('');
      setData(null);
      await refreshList();
    } catch (e) { setError(String(e)); }
  };

  const onCreate = async () => {
    const name = prompt('New category file name (without .json):');
    if (!name) return;
    const base = {
      m_Version: 12,
      DisplayName: 'New Category',
      Icon: 'Deliver',
      Color: 'FFFFFFFF',
      IsExchange: 0,
      InitStockPercent: 100.0,
      Items: []
    };
    try {
      await saveMarketFile(name, base);
      setSelected(name);
      await refreshList();
    } catch (e) { setError(String(e)); }
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Expansion Categories">
      <div className="modal" style={{ maxWidth: 980, width: '90vw' }}>
        <div className="modal-header">
          <h2>Expansion: Market Categories</h2>
          <div className="spacer" />
          <button className="btn" onClick={onClose} aria-label="Close" title="Close">Close</button>
        </div>
        <div className="modal-body" style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 12, minHeight: 420 }}>
          <div style={{ borderRight: '1px solid var(--border)', paddingRight: 8 }}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <button className="btn" onClick={onCreate}>New</button>
              <button className="btn" onClick={refreshList}>Refresh</button>
            </div>
            <div className="list" style={{ maxHeight: 380, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 6 }}>
              {files.length === 0 && <div className="muted" style={{ padding: 8 }}>No files.</div>}
              {files.map(f => (
                <div key={f} className={`list-row ${selected === f ? 'selected' : ''}`} onClick={() => setSelected(f)} style={{ padding: '6px 8px', cursor: 'pointer' }}>
                  {f}
                </div>
              ))}
            </div>
          </div>

          <div>
            {!selected && <div className="muted">Select a file on the left or create one.</div>}
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
                      <div className="control">
                        <label>Display Name</label>
                        <input value={data.DisplayName || ''} onChange={e => setField('DisplayName', e.target.value)} />
                      </div>
                      <div className="control">
                        <label>Icon</label>
                        <input value={data.Icon || ''} onChange={e => setField('Icon', e.target.value)} />
                      </div>
                      <div className="control">
                        <label>Color</label>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <input type="color" value={`#${rgbHex}`} onChange={e => setField('Color', `${e.target.value.replace('#','')}${alphaHex}`)} />
                          <input type="range" min={0} max={255} value={parseInt(alphaHex || 'FF', 16)} onChange={e => setField('Color', `${rgbHex}${Number(e.target.value).toString(16).toUpperCase().padStart(2,'0')}`)} />
                          <span className="mono">#{(data.Color||'FFFFFFFF').toUpperCase()}</span>
                        </div>
                      </div>
                      <div className="control">
                        <label>Is Exchange</label>
                        <input type="checkbox" checked={!!data.IsExchange} onChange={e => setField('IsExchange', e.target.checked ? 1 : 0)} />
                      </div>
                      <div className="control">
                        <label>Init Stock %</label>
                        <input type="number" step="0.1" value={data.InitStockPercent ?? 100} onChange={e => setField('InitStockPercent', Number(e.target.value))} />
                      </div>
                    </div>

                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <h4 style={{ margin: 0 }}>Items</h4>
                        <div className="spacer" />
                        <button className="btn" onClick={addItem}>Add item</button>
                      </div>
                      {items.length === 0 && <div className="muted">No items.</div>}
                      {items.map((it, idx) => (
                        <div key={idx} className="card" style={{ padding: 8, marginTop: 8 }}>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                            <div className="control">
                              <label>ClassName</label>
                              <input value={it.ClassName || ''} onChange={e => updateItem(idx, { ClassName: e.target.value })} />
                            </div>
                            <div className="control">
                              <label>Quantity %</label>
                              <input type="number" value={it.QuantityPercent ?? -1} onChange={e => updateItem(idx, { QuantityPercent: Number(e.target.value) })} />
                            </div>
                            <div className="control">
                              <label>Max Price</label>
                              <input type="number" value={it.MaxPriceThreshold ?? 0} onChange={e => updateItem(idx, { MaxPriceThreshold: Number(e.target.value) })} />
                            </div>
                            <div className="control">
                              <label>Min Price</label>
                              <input type="number" value={it.MinPriceThreshold ?? 0} onChange={e => updateItem(idx, { MinPriceThreshold: Number(e.target.value) })} />
                            </div>
                            <div className="control">
                              <label>Max Stock</label>
                              <input type="number" value={it.MaxStockThreshold ?? 0} onChange={e => updateItem(idx, { MaxStockThreshold: Number(e.target.value) })} />
                            </div>
                            <div className="control">
                              <label>Min Stock</label>
                              <input type="number" value={it.MinStockThreshold ?? 0} onChange={e => updateItem(idx, { MinStockThreshold: Number(e.target.value) })} />
                            </div>
                            <div className="control">
                              <label>Sell Price %</label>
                              <input type="number" step="0.1" value={it.SellPricePercent ?? -1} onChange={e => updateItem(idx, { SellPricePercent: Number(e.target.value) })} />
                            </div>
                            <div className="control">
                              <label>Spawn Attachments (comma)</label>
                              <input value={(it.SpawnAttachments || []).join(', ')} onChange={e => updateItem(idx, { SpawnAttachments: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} />
                            </div>
                            <div className="control">
                              <label>Variants (comma)</label>
                              <input value={(it.Variants || []).join(', ')} onChange={e => updateItem(idx, { Variants: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} />
                            </div>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <button className="btn" onClick={() => removeItem(idx)}>Remove</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
