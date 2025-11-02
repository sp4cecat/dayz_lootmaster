import React, { useEffect, useMemo, useState } from 'react';
import { listTraderFiles, getTraderFile, saveTraderFile, deleteTraderFile } from '../../utils/expansionApi.js';

export default function ExpansionTradersModal({ onClose, onOpenAppearance }) {
  const [files, setFiles] = useState([]);
  const [selected, setSelected] = useState('');
  const [data, setData] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

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

  const categoriesCsv = useMemo(() => (arrField(data?.Categories)).join(', '), [data]);
  const currenciesCsv = useMemo(() => (arrField(data?.Currencies)).join(', '), [data]);

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

  // Edit Items raw JSON for now for flexibility
  const [itemsRaw, setItemsRaw] = useState('');
  useEffect(() => {
    if (!data) { setItemsRaw(''); return; }
    setItemsRaw(JSON.stringify(data.Items || {}, null, 2));
  }, [data]);

  const syncItemsFromRaw = () => {
    try {
      const obj = JSON.parse(itemsRaw || '{}');
      setField('Items', obj);
    } catch {
      alert('Invalid JSON in Items.');
    }
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Expansion Traders">
      <div className="modal" style={{ maxWidth: 1100, width: '94vw' }}>
        <div className="modal-header">
          <h2>Expansion: Traders</h2>
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
                      <div className="control"><label>Categories (comma) e.g. Ammo:2</label><input value={categoriesCsv} onChange={e => updateArrayFromCsv('Categories', e.target.value)} /></div>
                      {onOpenAppearance && (
                        <div className="control">
                          <button className="btn" onClick={() => onOpenAppearance()}>Open Appearance Editor…</button>
                        </div>
                      )}
                    </div>
                    <div>
                      <div className="control">
                        <label>Items (raw JSON)</label>
                        <textarea rows={18} value={itemsRaw} onChange={e => setItemsRaw(e.target.value)} style={{ width: '100%', fontFamily: 'var(--font-mono)' }} />
                        <div style={{ textAlign: 'right', marginTop: 6 }}>
                          <button className="btn" onClick={syncItemsFromRaw}>Apply Items JSON</button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
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
