import React, { useEffect, useMemo, useState } from 'react';
import { listTraderZoneFiles, getTraderZoneFile, saveTraderZoneFile, deleteTraderZoneFile } from '../../utils/expansionApi.js';

export default function ExpansionTraderZonesModal({ onClose }) {
  const [files, setFiles] = useState([]);
  const [selected, setSelected] = useState('');
  const [data, setData] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function refreshList() {
    try {
      setError('');
      const f = await listTraderZoneFiles();
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
    getTraderZoneFile(selected).then(setData).catch(e => setError(String(e))).finally(() => setLoading(false));
    setDirty(false);
  }, [selected]);

  const stockEntries = useMemo(() => {
    const s = data?.Stock || {};
    return Object.entries(s).sort((a,b) => a[0].localeCompare(b[0]));
  }, [data]);

  const setField = (k, v) => { setData(d => ({ ...(d || {}), [k]: v })); setDirty(true); };
  const setStock = (o) => { setField('Stock', o); };

  const addStock = () => {
    const name = prompt('Type class to add to stock:');
    if (!name) return;
    const qtyStr = prompt('Initial quantity (integer):', '1');
    if (qtyStr == null) return;
    const qty = Number(qtyStr);
    const next = { ...(data?.Stock || {}) };
    next[name] = Number.isFinite(qty) ? qty : 1;
    setStock(next);
  };
  const updateStockQty = (name, qtyStr) => {
    const next = { ...(data?.Stock || {}) };
    const n = Number(qtyStr);
    next[name] = Number.isFinite(n) ? n : '';
    setStock(next);
  };
  const removeStock = (name) => {
    const next = { ...(data?.Stock || {}) };
    delete next[name];
    setStock(next);
  };

  const onSave = async () => {
    if (!selected) return;
    try {
      setError('');
      await saveTraderZoneFile(selected, data || {});
      setDirty(false);
      await refreshList();
      alert('Saved.');
    } catch (e) { setError(String(e)); }
  };

  const onDelete = async () => {
    if (!selected) return;
    if (!window.confirm(`Delete trader zone ${selected}.json?`)) return;
    try {
      await deleteTraderZoneFile(selected);
      setSelected('');
      setData(null);
      await refreshList();
    } catch (e) { setError(String(e)); }
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Expansion Trader Zones">
      <div className="modal" style={{ maxWidth: 1040, width: '92vw' }}>
        <div className="modal-header">
          <h2>Expansion: Trader Zones</h2>
          <div className="spacer" />
          <button className="btn" onClick={onClose} aria-label="Close" title="Close">Close</button>
        </div>
        <div className="modal-body" style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 12, minHeight: 440 }}>
          <div style={{ borderRight: '1px solid var(--border)', paddingRight: 8 }}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <button className="btn" onClick={refreshList}>Refresh</button>
            </div>
            <div className="list" style={{ maxHeight: 390, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 6 }}>
              {files.length === 0 && <div className="muted" style={{ padding: 8 }}>No files.</div>}
              {files.map(f => (
                <div key={f} className={`list-row ${selected === f ? 'selected' : ''}`} onClick={() => setSelected(f)} style={{ padding: '6px 8px', cursor: 'pointer' }}>
                  {f}
                </div>
              ))}
            </div>
          </div>

          <div>
            {!selected && <div className="muted">Choose a trader zone on the left.</div>}
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
                        <input value={data.m_DisplayName ?? ''} onChange={e => setField('m_DisplayName', e.target.value)} placeholder="Zone name" />
                      </div>
                      <div className="control">
                        <label>Position (X,Y,Z)</label>
                        <div style={{ display: 'flex', gap: 6 }}>
                          {(data.Position || [0,0,0]).map((v, i) => (
                            <input key={i} type="number" step={i===1?1:0.01} value={Number(v) || 0} onChange={e => {
                              const arr = Array.isArray(data.Position) ? [...data.Position] : [0,0,0];
                              arr[i] = Number(e.target.value);
                              setField('Position', arr);
                            }} />
                          ))}
                        </div>
                      </div>
                      <div className="control">
                        <label>Radius</label>
                        <input type="number" step="0.1" value={data.Radius ?? 0} onChange={e => setField('Radius', Number(e.target.value))} />
                      </div>
                      <div className="control">
                        <label>Buy Price %</label>
                        <input type="number" step="0.1" value={data.BuyPricePercent ?? 100} onChange={e => setField('BuyPricePercent', Number(e.target.value))} />
                      </div>
                      <div className="control">
                        <label>Sell Price %</label>
                        <input type="number" step="0.1" value={data.SellPricePercent ?? -1} onChange={e => setField('SellPricePercent', Number(e.target.value))} />
                      </div>
                    </div>

                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <h4 style={{ margin: 0 }}>Stock</h4>
                        <div className="spacer" />
                        <button className="btn" onClick={addStock}>Add</button>
                      </div>
                      {stockEntries.length === 0 && <div className="muted">No stock entries.</div>}
                      {stockEntries.map(([name, qty]) => (
                        <div key={name} className="row" style={{ display: 'grid', gridTemplateColumns: '1fr 140px 80px', gap: 8, alignItems: 'center', paddingTop: 6 }}>
                          <div className="mono">{name}</div>
                          <input type="number" value={qty} onChange={e => updateStockQty(name, e.target.value)} style={{ width: 60 }} />
                          <button className="btn" onClick={() => removeStock(name)}>Remove</button>
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
