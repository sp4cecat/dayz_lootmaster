import React, { useEffect, useState } from 'react';
import { listTraderFiles, getTraderFile, saveTraderFile, listTraderZoneFiles, getTraderZoneFile, saveTraderZoneFile } from '../../utils/expansionApi.js';

/**
 * Batch apply selected type names to Expansion Traders (Items) and Trader Zones (Stock).
 * @param {{ selectedTypes: string[], onClose: () => void }} props
 */
export default function ExpansionApplyModal({ selectedTypes, onClose }) {
  const [traderFiles, setTraderFiles] = useState([]);
  const [zoneFiles, setZoneFiles] = useState([]);
  const [pickedTraders, setPickedTraders] = useState(/** @type {Set<string>} */(new Set()));
  const [pickedZones, setPickedZones] = useState(/** @type {Set<string>} */(new Set()));

  const [action, setAction] = useState('add'); // 'add' | 'remove'
  const [zoneQty, setZoneQty] = useState(1);

  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  async function loadLists() {
    try {
      const [t, z] = await Promise.all([listTraderFiles(), listTraderZoneFiles()]);
      setTraderFiles(t);
      setZoneFiles(z);
    } catch (e) { setError(String(e)); }
  }
  useEffect(() => { loadLists(); }, []);

  const togglePicked = (set, name) => {
    set(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  const apply = async () => {
    setError('');
    setStatus('');
    setRunning(true);
    try {
      // Traders
      for (const tf of pickedTraders) {
        const json = await getTraderFile(tf);
        const items = json.Items && typeof json.Items === 'object' ? { ...json.Items } : {};
        if (action === 'add') {
          for (const name of selectedTypes) {
            if (!items[name]) items[name] = {};
          }
        } else {
          for (const name of selectedTypes) delete items[name];
        }
        await saveTraderFile(tf, { ...json, Items: items });
      }
      // Zones
      for (const zf of pickedZones) {
        const json = await getTraderZoneFile(zf);
        const stock = json.Stock && typeof json.Stock === 'object' ? { ...json.Stock } : {};
        if (action === 'add') {
          for (const name of selectedTypes) stock[name] = Number(zoneQty) || 1;
        } else {
          for (const name of selectedTypes) delete stock[name];
        }
        await saveTraderZoneFile(zf, { ...json, Stock: stock });
      }
      setStatus('Applied successfully.');
    } catch (e) {
      setError(String(e));
    } finally {
      setRunning(false);
    }
  };

  const disabled = running || (pickedTraders.size === 0 && pickedZones.size === 0) || selectedTypes.length === 0;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Apply to Expansion">
      <div className="modal" style={{ maxWidth: 1000, width: '92vw' }}>
        <div className="modal-header">
          <h2>Apply to Expansion</h2>
          <div className="spacer" />
          <button className="btn" onClick={onClose} aria-label="Close" title="Close">Close</button>
        </div>
        <div className="modal-body" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, minHeight: 420 }}>
          <div>
            <h3>Traders</h3>
            <div className="list" style={{ maxHeight: 320, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 6 }}>
              {traderFiles.length === 0 && <div className="muted" style={{ padding: 8 }}>No trader files.</div>}
              {traderFiles.map(f => (
                <label key={f} className="list-row" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px' }}>
                  <input type="checkbox" checked={pickedTraders.has(f)} onChange={() => togglePicked(setPickedTraders, f)} /> {f}
                </label>
              ))}
            </div>
          </div>
          <div>
            <h3>Trader Zones</h3>
            <div className="list" style={{ maxHeight: 280, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 6 }}>
              {zoneFiles.length === 0 && <div className="muted" style={{ padding: 8 }}>No zone files.</div>}
              {zoneFiles.map(f => (
                <label key={f} className="list-row" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px' }}>
                  <input type="checkbox" checked={pickedZones.has(f)} onChange={() => togglePicked(setPickedZones, f)} /> {f}
                </label>
              ))}
            </div>
            {action === 'add' && (
              <div className="control" style={{ marginTop: 8 }}>
                <label>Stock quantity to set</label>
                <input type="number" value={zoneQty} onChange={e => setZoneQty(Number(e.target.value))} />
              </div>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '0 16px' }}>
          <div className="control" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <label>Action</label>
            <select value={action} onChange={e => setAction(e.target.value)}>
              <option value="add">Add selected type(s)</option>
              <option value="remove">Remove selected type(s)</option>
            </select>
          </div>
          <div className="muted">Types: {selectedTypes.join(', ')}</div>
          <div className="spacer" />
          {status && <span className="chip" title="Status">{status}</span>}
          {error && <span className="chip warn" title="Error">{String(error)}</span>}
          <button className="btn primary" onClick={apply} disabled={disabled}>{running ? 'Applying…' : 'Apply'}</button>
        </div>
      </div>
    </div>
  );
}
