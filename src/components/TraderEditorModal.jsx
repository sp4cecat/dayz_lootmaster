import React, { useEffect, useMemo, useState } from 'react';

const ENTITY_CLASSES = [
  'ExpansionTraderAIMirek',
  'ExpansionTraderAIDenis',
  'ExpansionTraderAIBoris',
  'ExpansionTraderAICyril',
  'ExpansionTraderAIElias',
  'ExpansionTraderAIFrancis',
  'ExpansionTraderAIGuo',
  'ExpansionTraderAIHassan',
  'ExpansionTraderAIIndar',
  'ExpansionTraderAIJose',
  'ExpansionTraderAIKaito',
  'ExpansionTraderAILewis',
  'ExpansionTraderAIManua',
  'ExpansionTraderAINiki',
  'ExpansionTraderAIOliver',
  'ExpansionTraderAIPeter',
  'ExpansionTraderAIQuinn',
  'ExpansionTraderAIRolf',
  'ExpansionTraderAISeth',
  'ExpansionTraderAITaiki',
  'ExpansionTraderAILinda',
  'ExpansionTraderAIMaria',
  'ExpansionTraderAIFrida',
  'ExpansionTraderAIGabi',
  'ExpansionTraderAIHelga',
  'ExpansionTraderAIIrena',
  'ExpansionTraderAIJudy',
  'ExpansionTraderAIKeiko',
  'ExpansionTraderAIEva',
  'ExpansionTraderAINaomi',
  'ExpansionTraderAIBaty',
];

function useApiBase() {
  const savedBase = typeof localStorage !== 'undefined' ? localStorage.getItem('dayz-editor:apiBase') : null;
  const defaultBase = `${window.location.protocol}//${window.location.hostname}:4317`;
  return (savedBase && savedBase.trim()) ? savedBase.trim().replace(/\/+$/, '') : defaultBase;
}

function useEditorID() {
  try {
    return localStorage.getItem('dayz-editor:editorID:selected') || 'unknown';
  } catch {
    return 'unknown';
  }
}

function parseCategories(arr) {
  /** @type {{name:string, flag:number}[]} */
  const out = [];
  const seen = new Set(); // case-insensitive de-dupe (first occurrence wins)
  for (const v of Array.isArray(arr) ? arr : []) {
    if (typeof v !== 'string') continue;
    const idx = v.lastIndexOf(':');
    const rawName = idx >= 0 ? v.slice(0, idx) : v;
    const rawFlag = idx >= 0 ? v.slice(idx + 1) : '';
    const name = String(rawName).trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    const f = Number(rawFlag);
    const flag = Number.isFinite(f) ? f : 1;
    seen.add(key);
    out.push({ name, flag });
  }
  return out;
}

function dedupeCategoryList(list) {
  /** @type {{name:string, flag:number}[]} */
  const out = [];
  const seen = new Set();
  for (const item of Array.isArray(list) ? list : []) {
    const name = String(item && item.name || '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const flagNum = Number(item && item.flag);
    out.push({ name, flag: Number.isFinite(flagNum) ? flagNum : 1 });
  }
  return out;
}

function serializeCategories(list) {
  return list.map(({ name, flag }) => `${name}:${Number(flag) | 0}`);
}

export default function TraderEditorModal({ onClose, selectedProfileId }) {
  const API_BASE = useApiBase();
  const editorID = useEditorID();

  const [traders, setTraders] = useState([]);
  const [profiles, setProfiles] = useState([]);

  const [selectedTrader, setSelectedTrader] = useState('');

  const [className, setClassName] = useState(ENTITY_CLASSES[0]);
  const [traderFileName, setTraderFileName] = useState('');
  const [position, setPosition] = useState([0, 0, 0]);
  const [orientation, setOrientation] = useState([0, 0, 0]);
  const [attachments, setAttachments] = useState('');

  const [profileJson, setProfileJson] = useState(null);
  const [categories, setCategories] = useState([]); // {name, flag}
  const [marketCategories, setMarketCategories] = useState([]);
  const [newCategory, setNewCategory] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const [tRes, pRes, mRes] = await Promise.all([
          fetch(`${API_BASE}/api/traders`, { headers: { 'X-Profile-ID': selectedProfileId } }),
          fetch(`${API_BASE}/api/trader-profiles`, { headers: { 'X-Profile-ID': selectedProfileId } }),
          fetch(`${API_BASE}/api/market/categories`, { headers: { 'X-Profile-ID': selectedProfileId } }),
        ]);
        const tJson = await tRes.json().catch(() => ({ traders: [] }));
        const pJson = await pRes.json().catch(() => ({ profiles: [] }));
        const mJson = await mRes.json().catch(() => ({ categories: [] }));
        setTraders(Array.isArray(tJson.traders) ? tJson.traders : []);
        setProfiles(Array.isArray(pJson.profiles) ? pJson.profiles : []);
        setMarketCategories(Array.isArray(mJson.categories) ? mJson.categories : []);
        if (Array.isArray(tJson.traders) && tJson.traders.length > 0) {
          setSelectedTrader(tJson.traders[0]);
        }
      } catch (e) {
        setError(String(e));
      }
    })();
  }, [API_BASE, selectedProfileId]);

  // Load selected trader
  useEffect(() => {
    if (!selectedTrader) return;
    (async () => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch(`${API_BASE}/api/traders/${encodeURIComponent(selectedTrader)}`, {
          headers: { 'X-Profile-ID': selectedProfileId }
        });
        if (!res.ok) throw new Error(`Failed to load trader ${selectedTrader}`);
        const json = await res.json();
        setClassName(json.className || ENTITY_CLASSES[0]);
        setTraderFileName(json.traderFileName || '');
        setPosition(Array.isArray(json.position) ? json.position : [0, 0, 0]);
        setOrientation(Array.isArray(json.orientation) ? json.orientation : [0, 0, 0]);
        setAttachments(Array.isArray(json.gear) ? json.gear.join(',') : '');
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(false);
      }
    })();
  }, [API_BASE, selectedTrader]);

  // Load profile JSON when traderFileName changes
  useEffect(() => {
    if (!traderFileName) {
      setProfileJson(null);
      setCategories([]);
      return;
    }
    (async () => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch(`${API_BASE}/api/trader-profile/${encodeURIComponent(traderFileName)}`, {
          headers: { 'X-Profile-ID': selectedProfileId }
        });
        if (!res.ok) throw new Error(`Failed to load profile ${traderFileName}`);
        const json = await res.json();
        setProfileJson(json);
        setCategories(parseCategories(json.Categories));
      } catch (e) {
        setError(String(e));
        setProfileJson(null);
        setCategories([]);
      } finally {
        setBusy(false);
      }
    })();
  }, [API_BASE, traderFileName]);

  const setAllFlags = (flag) => {
    setCategories(prev => prev.map(c => ({ ...c, flag })));
  };

  const onDeleteCategory = (name) => {
    const ok = window.confirm(`Remove category '${name}' from this trader?`);
    if (!ok) return;
    setCategories(prev => prev.filter(c => c.name !== name));
  };

  const onSave = async () => {
    try {
      setBusy(true);
      setError(null);
      setNotice(null);
      // Save .map
      const payloadMap = {
        className,
        traderFileName,
        position: position.map(Number),
        orientation: orientation.map(Number),
        gear: attachments.split(',').map(s => s.trim()).filter(Boolean),
      };
      const mapRes = await fetch(`${API_BASE}/api/traders/${encodeURIComponent(selectedTrader)}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Editor-ID': editorID || 'unknown',
          'X-Profile-ID': selectedProfileId
        },
        body: JSON.stringify(payloadMap),
      });
      if (!mapRes.ok) {
        const msg = await mapRes.text().catch(() => '');
        throw new Error(`Save trader map failed (${mapRes.status}) ${msg}`);
      }
      // Save profile
      if (profileJson) {
        const deduped = dedupeCategoryList(categories);
        const updated = { ...profileJson, Categories: serializeCategories(deduped) };
        const profRes = await fetch(`${API_BASE}/api/trader-profile/${encodeURIComponent(traderFileName)}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'X-Editor-ID': editorID || 'unknown',
            'X-Profile-ID': selectedProfileId
          },
          body: JSON.stringify(updated),
        });
        if (!profRes.ok) {
          const msg = await profRes.text().catch(() => '');
          throw new Error(`Save trader profile failed (${profRes.status}) ${msg}`);
        }
      }
      setNotice('Saved trader entity and profile.');
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const attachmentsList = useMemo(() => attachments.split(',').map(s => s.trim()).filter(Boolean), [attachments]);

  // Ensure the current class from the .map file is selectable even if not in our predefined list
  const entityClassOptions = useMemo(() => {
    const base = [...ENTITY_CLASSES];
    if (className && !base.includes(className)) {
      return [className, ...base];
    }
    return base;
  }, [className]);

  const addableCategories = useMemo(() => {
    const existing = new Set((categories || []).map(c => String(c.name).toLowerCase()));
    return (marketCategories || [])
      .filter((n) => {
        const name = String(n || '').trim();
        if (!name) return false;
        return !existing.has(name.toLowerCase());
      })
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }, [marketCategories, categories]);

  useEffect(() => {
    if (!newCategory && addableCategories.length > 0) {
      setNewCategory(addableCategories[0]);
    }
    if (newCategory && addableCategories.indexOf(newCategory) === -1) {
      setNewCategory(addableCategories[0] || '');
    }
  }, [addableCategories, newCategory]);

  const onAddCategory = () => {
    const name = (newCategory || '').trim();
    if (!name) return;
    const exists = categories.some(c => String(c.name).toLowerCase() === name.toLowerCase());
    if (exists) return;
    setCategories(prev => [...prev, { name, flag: 1 }]);
    setNewCategory('');
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Trader editor">
      <div className="modal">
        <div className="modal-header">
          <h3>Trader editor</h3>
          <div className="spacer" />
          <button className="btn" onClick={onClose}>Close</button>
        </div>
        <div className="modal-body">
          {/* Trader selection */}
          <div className="controls-row" style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <label className="control" style={{ minWidth: 220 }}>
              <span>Trader file (.map)</span>
              <select value={selectedTrader} onChange={e => setSelectedTrader(e.target.value)}>
                {traders.map(t => <option key={t} value={t}>{t}.map</option>)}
              </select>
            </label>
            <label className="control" style={{ minWidth: 240 }}>
              <span>Entity class</span>
              <select value={className} onChange={e => setClassName(e.target.value)}>
                {entityClassOptions.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label className="control" style={{ minWidth: 260 }}>
              <span>Trader profile</span>
              <select value={traderFileName} onChange={e => setTraderFileName(e.target.value)}>
                <option value="" disabled>Select profile…</option>
                {profiles.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
          </div>

          {/* Position and orientation */}
          <div className="controls-row" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 8 }}>
            <fieldset className="control" style={{ minWidth: 420 }}>
              <legend>Position (x y z)</legend>
              <div style={{ display: 'flex', gap: 8 }}>
                {['X', 'Y', 'Z'].map((label, idx) => (
                  <input
                    key={label}
                    type="number"
                    step="any"
                    value={position[idx]}
                    onChange={e => {
                      const v = Number(e.target.value);
                      setPosition(prev => prev.map((p, i) => i === idx ? v : p));
                    }}
                    aria-label={`Position ${label}`}
                    style={{ width: 120 }}
                  />
                ))}
              </div>
            </fieldset>
            <fieldset className="control" style={{ minWidth: 420 }}>
              <legend>Orientation (x y z)</legend>
              <div style={{ display: 'flex', gap: 8 }}>
                {['X', 'Y', 'Z'].map((label, idx) => (
                  <input
                    key={label}
                    type="number"
                    step="any"
                    value={orientation[idx]}
                    onChange={e => {
                      const v = Number(e.target.value);
                      setOrientation(prev => prev.map((p, i) => i === idx ? v : p));
                    }}
                    aria-label={`Orientation ${label}`}
                    style={{ width: 120 }}
                  />
                ))}
              </div>
            </fieldset>
          </div>

          {/* Attachments */}
          <div className="controls-row" style={{ marginTop: 8 }}>
            <label className="control" style={{ width: '100%' }}>
              <span>Attachments (comma separated)</span>
              <input
                type="text"
                value={attachments}
                onChange={e => setAttachments(e.target.value)}
                placeholder="Jeans_Blue,Shirt_GreenCheck,..."
              />
              <div className="muted" style={{ marginTop: 4 }}>
                {attachmentsList.length > 0 ? `Items: ${attachmentsList.join(', ')}` : 'No attachments'}
              </div>
            </label>
          </div>

          {/* Categories editor */}
          <div style={{ marginTop: 16 }}>
            <h4>Categories</h4>
              <div className="muted" style={{ marginBottom: 12, marginTop: 0, textAlign: 'right' }}>
                  0=Buy only, 1=Buy & Sell, 2=Sell only, 3=Hidden (customization/attachments).
              </div>
            {!profileJson && <div className="muted">Select a trader profile to view categories.</div>}
            {profileJson && (
              <>
                <div style={{ overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
                  <table className="table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: 'left', padding: '8px' }}>Categories</th>
                        {[0,1,2,3].map(flag => (
                          <th key={flag} style={{ textAlign: 'center', padding: '8px', whiteSpace: 'nowrap' }}>
                            <label style={{ cursor: 'pointer' }} title={`Set all to ${flag}`}>
                              <input
                                type="radio"
                                name={`master-flag`}
                                onChange={() => setAllFlags(flag)}
                                style={{ marginRight: 6 }}
                              />
                              {flag}
                            </label>
                          </th>
                        ))}
                        <th style={{ width: 40 }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {categories.map(cat => (
                        <tr key={cat.name}>
                          <td style={{ padding: '8px' }}>{cat.name}</td>
                          {[0,1,2,3].map(flag => (
                            <td key={flag} style={{ textAlign: 'center' }}>
                              <input
                                type="radio"
                                name={`flag-${cat.name}`}
                                checked={Number(cat.flag) === flag}
                                onChange={() => setCategories(prev => prev.map(c => c.name === cat.name ? { ...c, flag } : c))}
                                aria-label={`Set ${cat.name} to ${flag}`}
                              />
                            </td>
                          ))}
                          <td style={{ textAlign: 'center' }}>
                            <button
                              className="link"
                              onClick={() => onDeleteCategory(cat.name)}
                              title="Remove category"
                              aria-label={`Remove ${cat.name}`}
                              style={{ color: 'var(--danger, #b00)', backgroundColor: 'rgba(255, 255, 255, 0.3)', padding: '0 3px', textDecoration: 'none', borderRadius: 4 }}
                            >
                              x
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="controls-row" style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <label className="control" style={{ minWidth: 320 }}>
                    <span>Add category</span>
                    <select value={newCategory} onChange={e => setNewCategory(e.target.value)} disabled={busy || addableCategories.length === 0}>
                      {addableCategories.map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </label>
                  <button className="btn" onClick={onAddCategory} disabled={busy || !newCategory || addableCategories.length === 0}>Add</button>
                  {addableCategories.length === 0 && (
                    <span className="muted">No more categories to add.</span>
                  )}
                </div>
              </>
            )}
          </div>

          {error && <div className="banner error" role="alert" style={{ marginTop: 12 }}>{String(error)}</div>}
          {notice && (
            <div className="banner" role="status" aria-live="polite" style={{ marginTop: 12 }}>
              <span>{String(notice)}</span>
              <div className="spacer" />
              <button className="link" onClick={() => setNotice(null)} title="Dismiss">Dismiss</button>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn primary" onClick={onSave} disabled={busy || !selectedTrader || !traderFileName}>
            {busy ? 'Saving…' : 'Save'}
          </button>
          <button className="btn" onClick={onClose} disabled={busy}>Close</button>
        </div>
      </div>
    </div>
  );
}
