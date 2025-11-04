import React, { useEffect, useMemo, useState } from 'react';

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

// Editable numeric columns in market item rows
const EDIT_FIELDS = [
  'MaxPriceThreshold',
  'MinPriceThreshold',
  'SellPricePercent',
  'MaxStockThreshold',
  'MinStockThreshold',
  'QuantityPercent',
];


export default function MarketCategoryEditorModal({ onClose }) {
  const API_BASE = useApiBase();
  const editorID = useEditorID();

  const [categoryNames, setCategoryNames] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState('');

  const [categoryJson, setCategoryJson] = useState(null);
  const [items, setItems] = useState([]); // array of item objects as-is from JSON

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  // Filter and sorting
  const [filterText, setFilterText] = useState('');
  const [sortKey, setSortKey] = useState('ClassName');
  const [sortDir, setSortDir] = useState('asc'); // 'asc' | 'desc'

  // Inline edit state
  const [editingKey, setEditingKey] = useState(null); // ClassName of row being edited
  const [editDraft, setEditDraft] = useState({}); // { field: value }

  // Bulk edit state (text inputs; empty string means do not change that field)
  const [bulkDraft, setBulkDraft] = useState({
    MaxPriceThreshold: '',
    MinPriceThreshold: '',
    SellPricePercent: '',
    MaxStockThreshold: '',
    MinStockThreshold: '',
    QuantityPercent: ''
  });

  // Load category list once
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/market/categories`);
        const json = await res.json().catch(() => ({ categories: [] }));
        const names = Array.isArray(json.categories) ? json.categories : [];
        setCategoryNames(names);
        if (names.length > 0) setSelectedCategory(names[0]);
      } catch (e) {
        setError(String(e));
      }
    })();
  }, [API_BASE]);

  // Load selected category JSON
  useEffect(() => {
    if (!selectedCategory) {
      setCategoryJson(null);
      setItems([]);
      return;
    }
    (async () => {
      try {
        setBusy(true);
        setError(null);
        setNotice(null);
        const res = await fetch(`${API_BASE}/api/market/category/${encodeURIComponent(selectedCategory)}`);
        if (!res.ok) throw new Error(`Failed to load category ${selectedCategory}`);
        const json = await res.json();
        setCategoryJson(json);
        const arr = Array.isArray(json.Items) ? json.Items : [];
        // Defensive clone to avoid mutation of original object references
        setItems(arr.map(x => ({ ...x })));
        setEditingKey(null);
        setEditDraft({});
      } catch (e) {
        setError(String(e));
        setCategoryJson(null);
        setItems([]);
      } finally {
        setBusy(false);
      }
    })();
  }, [API_BASE, selectedCategory]);

  const filteredItems = useMemo(() => {
    const f = (filterText || '').trim().toLowerCase();
    const base = Array.isArray(items) ? items : [];
    const subset = f ? base.filter(it => String(it.ClassName || '').toLowerCase().includes(f)) : base;
    const dir = sortDir === 'desc' ? -1 : 1;
    const key = sortKey;
    const isNumeric = key !== 'ClassName';
    const arr = [...subset].sort((a, b) => {
      const av = a && Object.prototype.hasOwnProperty.call(a, key) ? a[key] : undefined;
      const bv = b && Object.prototype.hasOwnProperty.call(b, key) ? b[key] : undefined;
      if (isNumeric) {
        const an = Number(av);
        const bn = Number(bv);
        if (Number.isNaN(an) && Number.isNaN(bn)) return 0;
        if (Number.isNaN(an)) return -1 * dir;
        if (Number.isNaN(bn)) return 1 * dir;
        return an === bn ? 0 : (an < bn ? -1 : 1) * dir;
      }
      const as = String(av || '').toLowerCase();
      const bs = String(bv || '').toLowerCase();
      return as === bs ? 0 : (as < bs ? -1 : 1) * dir;
    });
    return arr;
  }, [items, filterText, sortKey, sortDir]);

  const onHeaderClick = (key) => {
    setSortKey(prevKey => {
      if (prevKey === key) {
        setSortDir(prevDir => (prevDir === 'asc' ? 'desc' : 'asc'));
        return prevKey;
      }
      setSortDir('asc');
      return key;
    });
  };

  // Persist helper: PUT category JSON immediately and reload to reflect canonical formatting
  const persistCategory = async (nextItems, successMsg) => {
    if (!categoryJson || !selectedCategory) return false;
    try {
      setBusy(true);
      setError(null);
      setNotice(null);
      const payload = { ...categoryJson, Items: nextItems };
      const res = await fetch(`${API_BASE}/api/market/category/${encodeURIComponent(selectedCategory)}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Editor-ID': editorID || 'unknown',
        },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const msg = await res.text().catch(() => '');
        throw new Error(`Save failed (${res.status}) ${msg}`);
      }
      // Reload to reflect server-side formatting
      try {
        const r = await fetch(`${API_BASE}/api/market/category/${encodeURIComponent(selectedCategory)}`);
        if (r.ok) {
          const j = await r.json();
          setCategoryJson(j);
          const arr = Array.isArray(j.Items) ? j.Items : [];
          setItems(arr.map(x => ({ ...x })));
        }
      } catch {
        // ignore reload errors
      }
      if (successMsg) setNotice(successMsg);
      return true;
    } catch (e) {
      setError(String(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  // Inline edit handlers
  const startEdit = (row) => {
    setEditingKey(row.ClassName);
    const draft = {};
    for (const k of EDIT_FIELDS) {
      draft[k] = row[k] ?? '';
    }
    setEditDraft(draft);
  };

  const cancelEdit = () => {
    setEditingKey(null);
    setEditDraft({});
  };

  const applyEdit = async () => {
    if (!editingKey) return;
    const prevItems = items;
    const nextItems = items.map(it => {
      if (String(it.ClassName) !== String(editingKey)) return it;
      const next = { ...it };
      for (const k of EDIT_FIELDS) {
        const v = editDraft[k];
        const num = Number(v);
        if (!Number.isFinite(num)) continue; // skip invalid values
        next[k] = num;
      }
      return next;
    });
    setItems(nextItems);
    setEditingKey(null);
    setEditDraft({});
    const ok = await persistCategory(nextItems, `Saved ${editingKey}.`);
    if (!ok) {
      setItems(prevItems);
    }
  };

  const filteredCount = filteredItems.length;

  const applyBulk = async () => {
    const keys = EDIT_FIELDS.filter(k => String(bulkDraft[k]).trim() !== '');
    if (keys.length === 0) return;
    const f = (filterText || '').trim().toLowerCase();
    const prevItems = items;
    const nextItems = items.map(it => {
      const matches = !f || String(it.ClassName || '').toLowerCase().includes(f);
      if (!matches) return it;
      const next = { ...it };
      for (const k of keys) {
        const num = Number(bulkDraft[k]);
        if (Number.isFinite(num)) next[k] = num;
      }
      return next;
    });
    setItems(nextItems);
    const affected = nextItems.filter((it, idx) => it !== prevItems[idx]).length;
    const ok = await persistCategory(nextItems, affected > 0 ? `Bulk changes saved for ${affected} item${affected === 1 ? '' : 's'}.` : 'No items changed.');
    if (!ok) {
      setItems(prevItems);
    }
  };

  const clearBulk = () => {
    setBulkDraft({
      MaxPriceThreshold: '',
      MinPriceThreshold: '',
      SellPricePercent: '',
      MaxStockThreshold: '',
      MinStockThreshold: '',
      QuantityPercent: ''
    });
  };

  const onSave = async () => {
    if (!categoryJson) return;
    try {
      setBusy(true);
      setError(null);
      setNotice(null);
      // Rebuild JSON preserving everything but Items replaced by our edited array
      const payload = { ...categoryJson, Items: items };
      const res = await fetch(`${API_BASE}/api/market/category/${encodeURIComponent(selectedCategory)}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Editor-ID': editorID || 'unknown',
        },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const msg = await res.text().catch(() => '');
        throw new Error(`Save failed (${res.status}) ${msg}`);
      }
      setNotice('Category saved.');
      // Optionally reload to reflect server formatting
      try {
        const r = await fetch(`${API_BASE}/api/market/category/${encodeURIComponent(selectedCategory)}`);
        if (r.ok) {
          const j = await r.json();
          setCategoryJson(j);
          const arr = Array.isArray(j.Items) ? j.Items : [];
          setItems(arr.map(x => ({ ...x })));
        }
      } catch {
        // ignore
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  // Render helpers
  const renderHeaderCell = (label, key) => (
    <th
      role="columnheader"
      onClick={() => onHeaderClick(key)}
      style={{ cursor: 'pointer', padding: '8px', whiteSpace: 'nowrap', textAlign: key === 'ClassName' ? 'left' : 'right' }}
      title={`Sort by ${label}`}
    >
      {label}
      {sortKey === key && (
        <span className="muted" style={{ marginLeft: 6 }}>{sortDir === 'asc' ? '▲' : '▼'}</span>
      )}
    </th>
  );

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Market categories editor">
      <div className="modal fullscreen-modal">
        <div className="modal-header">
          <h3>Market Categories</h3>
          <div className="spacer" />
          <button className="btn" onClick={onClose} disabled={busy}>Close</button>
        </div>
        <div className="modal-body">
          {/* Category selection and filter */}
          <div className="controls-row" style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <label className="control" style={{ minWidth: 280 }}>
              <span>Category</span>
              <select value={selectedCategory} onChange={e => setSelectedCategory(e.target.value)} disabled={busy}>
                {categoryNames.map(n => <option key={n} value={n}>{n}.json</option>)}
              </select>
            </label>
            <label className="control" style={{ minWidth: 280 }}>
              <span>Filter by ClassName</span>
              <input type="text" value={filterText} onChange={e => setFilterText(e.target.value)} placeholder="Type to filter..." />
            </label>
          </div>

          {/* Bulk edit */}
          <fieldset className="control" style={{ marginTop: 8 }}>
            <legend>Bulk edit (applies to {filteredCount} filtered row{filteredCount === 1 ? '' : 's'})</legend>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {EDIT_FIELDS.map((field) => (
                <label key={field} className="control" style={{ minWidth: 180 }}>
                  <span>{field}</span>
                  <input
                    type="number"
                    step="any"
                    value={bulkDraft[field]}
                    onChange={e => setBulkDraft(prev => ({ ...prev, [field]: e.target.value }))}
                    placeholder="(no change)"
                    aria-label={`Bulk ${field}`}
                  />
                </label>
              ))}
            </div>
            <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
              <button className="btn" onClick={applyBulk} disabled={busy}>Apply to filtered</button>
              <button className="btn" onClick={clearBulk} disabled={busy}>Clear</button>
            </div>
          </fieldset>

          {error && <div className="banner warn" style={{ marginTop: 8 }}>{String(error)}</div>}
          {notice && <div className="banner" style={{ marginTop: 8 }}>{String(notice)}</div>}

          {/* Items table */}
          <div style={{ marginTop: 12, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
            <table className="table" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {renderHeaderCell('ClassName', 'ClassName')}
                  {renderHeaderCell('MaxPriceThreshold', 'MaxPriceThreshold')}
                  {renderHeaderCell('MinPriceThreshold', 'MinPriceThreshold')}
                  {renderHeaderCell('SellPricePercent', 'SellPricePercent')}
                  {renderHeaderCell('MaxStockThreshold', 'MaxStockThreshold')}
                  {renderHeaderCell('MinStockThreshold', 'MinStockThreshold')}
                  {renderHeaderCell('QuantityPercent', 'QuantityPercent')}
                  <th style={{ width: 80 }}></th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map(row => {
                  const isEditing = editingKey === row.ClassName;
                  return (
                    <tr key={row.ClassName}>
                      <td style={{ padding: '8px', textAlign: 'left', fontFamily: 'monospace' }}>{row.ClassName}</td>
                      {EDIT_FIELDS.map((field) => (
                        <td key={field} style={{ padding: '4px 8px', textAlign: 'right' }}>
                          {isEditing ? (
                            <input
                              type="number"
                              step="any"
                              value={editDraft[field]}
                              onChange={e => setEditDraft(prev => ({ ...prev, [field]: e.target.value }))}
                              style={{ width: 120 }}
                              aria-label={`${row.ClassName} ${field}`}
                            />
                          ) : (
                            <span>{Number.isFinite(Number(row[field])) ? row[field] : ''}</span>
                          )}
                        </td>
                      ))}
                      <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                        {!isEditing ? (
                          <button className="link" title="Edit row" onClick={() => startEdit(row)} aria-label={`Edit ${row.ClassName}`}>
                            ✎
                          </button>
                        ) : (
                          <>
                            <button className="link" title="Apply" onClick={applyEdit} style={{ marginRight: 6 }}>Save</button>
                            <button className="link" title="Cancel" onClick={cancelEdit}>Cancel</button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {filteredItems.length === 0 && (
                  <tr>
                    <td colSpan={8} className="muted" style={{ padding: 12 }}>No items match the filter.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn primary" onClick={onSave} disabled={busy || !selectedCategory}>
            {busy ? 'Saving…' : 'Save'}
          </button>
          <button className="btn" onClick={onClose} disabled={busy}>Close</button>
        </div>
      </div>
    </div>
  );
}
