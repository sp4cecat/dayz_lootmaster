import React, { useEffect, useMemo, useState } from 'react';
import { Modal } from './base/modal/modal';
import { Button } from './base/button/button';
import { Input } from './base/input/input';
import { Select } from './base/select/select';
import { 
    Search as SearchIcon, 
    Trash01, 
    Edit01, 
    Check, 
    XClose, 
    Save01, 
    Filter,
    ChevronDown,
    ChevronUp,
    ShoppingBag01,
    Delete01
} from '@untitledui/icons';
import { cx } from '@/utils/cx';

interface MarketItem {
  ClassName: string;
  MaxPriceThreshold: number;
  MinPriceThreshold: number;
  SellPricePercent: number;
  MaxStockThreshold: number;
  MinStockThreshold: number;
  QuantityPercent: number;
  [key: string]: any;
}

interface MarketCategoryEditorModalProps {
  onClose: () => void;
  selectedProfileId: string;
  isPanel?: boolean;
}

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

const EDIT_FIELDS = [
  'MaxPriceThreshold',
  'MinPriceThreshold',
  'SellPricePercent',
  'MaxStockThreshold',
  'MinStockThreshold',
  'QuantityPercent',
] as const;

function dedupeItemsByClassName(list: MarketItem[]) {
  const out: MarketItem[] = [];
  const seen = new Set();
  for (const it of Array.isArray(list) ? list : []) {
    const name = String(it && it.ClassName || '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...it, ClassName: it.ClassName });
  }
  return out;
}

export default function MarketCategoryEditorModal({ onClose, selectedProfileId, isPanel = false }: MarketCategoryEditorModalProps) {
  const API_BASE = useApiBase();
  const editorID = useEditorID();

  const [categoryNames, setCategoryNames] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState('');

  const [categoryJson, setCategoryJson] = useState<any>(null);
  const [items, setItems] = useState<MarketItem[]>([]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Filter and sorting
  const [filterText, setFilterText] = useState('');
  const [sortKey, setSortKey] = useState<string>('ClassName');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  // Inline edit state
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Partial<Record<typeof EDIT_FIELDS[number], string>>>({});

  // Bulk edit state
  const [bulkDraft, setBulkDraft] = useState<Record<typeof EDIT_FIELDS[number], string>>({
    MaxPriceThreshold: '',
    MinPriceThreshold: '',
    SellPricePercent: '',
    MaxStockThreshold: '',
    MinStockThreshold: '',
    QuantityPercent: ''
  });

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/market/categories`, {
          headers: { 'X-Profile-ID': selectedProfileId }
        });
        const json = await res.json().catch(() => ({ categories: [] }));
        const names = Array.isArray(json.categories) ? json.categories : [];
        setCategoryNames(names);
        if (names.length > 0) setSelectedCategory(names[0]);
      } catch (e) {
        setError(String(e));
      }
    })();
  }, [API_BASE, selectedProfileId]);

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
        const res = await fetch(`${API_BASE}/api/market/category/${encodeURIComponent(selectedCategory)}`, {
          headers: { 'X-Profile-ID': selectedProfileId }
        });
        if (!res.ok) throw new Error(`Failed to load category ${selectedCategory}`);
        const json = await res.json();
        setCategoryJson(json);
        const arr = Array.isArray(json.Items) ? json.Items : [];
        const deduped = dedupeItemsByClassName(arr);
        setItems(deduped.map(x => ({ ...x })));
        const removed = arr.length - deduped.length;
        if (removed > 0) {
          setNotice(`Removed ${removed} duplicate item${removed === 1 ? '' : 's'} by ClassName (first kept).`);
        }
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
  }, [API_BASE, selectedCategory, selectedProfileId]);

  const filteredItems = useMemo(() => {
    const f = (filterText || '').trim().toLowerCase();
    const base = Array.isArray(items) ? items : [];
    const subset = f ? base.filter(it => String(it.ClassName || '').toLowerCase().includes(f)) : base;
    const dir = sortDir === 'desc' ? -1 : 1;
    const key = sortKey;
    const isNumeric = key !== 'ClassName';
    return [...subset].sort((a, b) => {
      const av = a && a[key];
      const bv = b && b[key];
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
  }, [items, filterText, sortKey, sortDir]);

  const onHeaderClick = (key: string) => {
    setSortKey(prevKey => {
      if (prevKey === key) {
        setSortDir(prevDir => (prevDir === 'asc' ? 'desc' : 'asc'));
        return prevKey;
      }
      setSortDir('asc');
      return key;
    });
  };

  const persistCategory = async (nextItems: MarketItem[], successMsg?: string) => {
    if (!categoryJson || !selectedCategory) return false;
    try {
      setBusy(true);
      setError(null);
      setNotice(null);
      const deduped = dedupeItemsByClassName(nextItems);
      const removed = nextItems.length - deduped.length;
      setItems(deduped);
      const payload = { ...categoryJson, Items: deduped };
      const res = await fetch(`${API_BASE}/api/market/category/${encodeURIComponent(selectedCategory)}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Editor-ID': editorID || 'unknown',
          'X-Profile-ID': selectedProfileId
        },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const msg = await res.text().catch(() => '');
        throw new Error(`Save failed (${res.status}) ${msg}`);
      }
      if (successMsg) {
        setNotice(removed > 0 ? `${successMsg} (removed ${removed} duplicate item${removed === 1 ? '' : 's'})` : successMsg);
      } else if (removed > 0) {
        setNotice(`Removed ${removed} duplicate item${removed === 1 ? '' : 's'} by ClassName.`);
      }
      return true;
    } catch (e) {
      setError(String(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (row: MarketItem) => {
    setEditingKey(row.ClassName);
    const draft: any = {};
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
        if (!Number.isFinite(num)) continue;
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

  const removeItemFromCategory = async (className: string) => {
    if (!window.confirm(`Are you sure you want to remove "${className}" from this category?`)) return;
    const nextItems = items.filter(it => String(it.ClassName).toLowerCase() !== String(className).toLowerCase());
    setItems(nextItems);
    await persistCategory(nextItems, `Removed ${className} from category.`);
  };

  const removeItemFromMarketplaceCompletely = async (className: string) => {
    if (!window.confirm(`Are you sure you want to remove "${className}" from ALL category files and ALL trader zone stock records?\n\nThis action is irreversible.`)) return;
    try {
      setBusy(true);
      setError(null);
      setNotice(null);
      const res = await fetch(`${API_BASE}/api/market/remove-item-completely`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Editor-ID': editorID || 'unknown',
          'X-Profile-ID': selectedProfileId
        },
        body: JSON.stringify({ className })
      });
      if (!res.ok) {
        const msg = await res.text().catch(() => '');
        throw new Error(`Removal failed (${res.status}) ${msg}`);
      }
      const json = await res.json();
      let msg = `Successfully removed "${className}" from ${json.results.marketFiles} market files and ${json.results.traderZoneFiles} trader zones.`;
      if (json.results.traderFiles > 0) {
        msg += ` Also removed from ${json.results.traderFiles} trader profiles.`;
      }
      setNotice(msg);
      setItems(prev => prev.filter(it => String(it.ClassName).toLowerCase() !== String(className).toLowerCase()));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

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
    await persistCategory(items, 'Category saved successfully.');
  };

  const renderHeaderCell = (label: string, key: string) => (
    <th
      role="columnheader"
      onClick={() => onHeaderClick(key)}
      className="px-4 py-3 cursor-pointer select-none hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors group"
      title={`Sort by ${label}`}
    >
      <div className={cx("flex items-center gap-1", key !== 'ClassName' && "justify-end")}>
        <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">{label}</span>
        <div className="text-gray-400 group-hover:text-gray-600">
          {sortKey === key ? (
            sortDir === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />
          ) : (
            <div className="size-3.5" />
          )}
        </div>
      </div>
    </th>
  );

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title="Market Categories"
      description="Manage items within a market category and perform bulk price updates."
      icon={ShoppingBag01}
      inline={isPanel}
      maxWidth="max-w-none w-[95vw]"
      className="h-[95vh]"
      footer={
        <div className="flex gap-3">
          <Button variant="secondary" onClick={onClose}>Close</Button>
          <Button variant="primary" onClick={onSave} disabled={busy || !selectedCategory} icon={Save01}>
            {busy ? 'Saving...' : 'Save Category'}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col h-full space-y-6">
        {/* Top Controls */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Select 
            label="Selected Category" 
            value={selectedCategory} 
            onChange={e => setSelectedCategory(e.target.value)}
            disabled={busy}
            options={categoryNames.map(n => ({ label: `${n}.json`, value: n }))}
          />
          <Input 
            label="Filter Items" 
            value={filterText} 
            onChange={e => setFilterText(e.target.value)} 
            placeholder="Search by class name..." 
            icon={SearchIcon}
          />
        </div>

        {/* Bulk Edit Panel */}
        <div className="bg-gray-50 dark:bg-gray-900/50 p-4 rounded-xl border border-gray-200 dark:border-gray-800 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
              <Filter size={18} className="text-primary-600" />
              Bulk Edit ({filteredItems.length} filtered items)
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {EDIT_FIELDS.map((field) => (
              <Input
                key={field}
                label={field}
                size="sm"
                type="number"
                step="any"
                value={bulkDraft[field]}
                onChange={e => setBulkDraft(prev => ({ ...prev, [field]: e.target.value }))}
                placeholder="No change"
              />
            ))}
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="secondary" size="sm" onClick={clearBulk} disabled={busy}>Clear</Button>
            <Button variant="primary" size="sm" onClick={applyBulk} disabled={busy}>Apply to Filtered</Button>
          </div>
        </div>

        {/* Messages */}
        {error && (
          <div className="p-3 bg-error-50 border border-error-200 rounded-lg text-sm text-error-700 flex items-center gap-2 dark:bg-error-900/20 dark:border-error-800 dark:text-error-400">
            <XClose size={18} />
            {error}
          </div>
        )}
        {notice && (
          <div className="p-3 bg-primary-50 border border-primary-200 rounded-lg text-sm text-primary-700 flex items-center justify-between dark:bg-primary-900/20 dark:border-primary-800 dark:text-primary-400">
            <span>{notice}</span>
            <button onClick={() => setNotice(null)} className="text-xs font-bold uppercase hover:underline">Dismiss</button>
          </div>
        )}

        {/* Table Container */}
        <div className="flex-1 min-h-0 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden shadow-sm flex flex-col bg-white dark:bg-gray-950">
          <div className="overflow-auto flex-1 scrollbar-thin">
            <table className="w-full text-sm text-left border-separate border-spacing-0">
              <thead className="bg-gray-50 dark:bg-gray-900/80 sticky top-0 z-10">
                <tr>
                  {renderHeaderCell('ClassName', 'ClassName')}
                  {renderHeaderCell('Max Price', 'MaxPriceThreshold')}
                  {renderHeaderCell('Min Price', 'MinPriceThreshold')}
                  {renderHeaderCell('Sell %', 'SellPricePercent')}
                  {renderHeaderCell('Max Stock', 'MaxStockThreshold')}
                  {renderHeaderCell('Min Stock', 'MinStockThreshold')}
                  {renderHeaderCell('Qty %', 'QuantityPercent')}
                  <th className="w-24 px-4 py-3 bg-gray-50 dark:bg-gray-900/80"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {filteredItems.map(row => {
                  const isEditing = editingKey === row.ClassName;
                  return (
                    <tr key={row.ClassName} className="hover:bg-gray-50 dark:hover:bg-gray-900/30 transition-colors group">
                      <td className="px-4 py-2 font-mono text-xs text-gray-900 dark:text-gray-100">{row.ClassName}</td>
                      {EDIT_FIELDS.map((field) => (
                        <td key={field} className="px-2 py-1 text-right">
                          {isEditing ? (
                            <input
                              type="number"
                              step="any"
                              value={editDraft[field]}
                              onChange={e => setEditDraft(prev => ({ ...prev, [field]: e.target.value }))}
                              className="w-24 px-2 py-1 text-right text-xs bg-white dark:bg-gray-800 border border-primary-500 rounded focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                              autoFocus={field === EDIT_FIELDS[0]}
                            />
                          ) : (
                            <span className="text-gray-600 dark:text-gray-400">{row[field]}</span>
                          )}
                        </td>
                      ))}
                      <td className="px-4 py-1 text-right">
                        {!isEditing ? (
                          <div className="flex gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                            <button 
                                onClick={() => startEdit(row)} 
                                className="p-1.5 text-gray-400 hover:text-primary-600 transition-colors"
                                title="Edit Item"
                            >
                              <Edit01 size={16} />
                            </button>
                            <button 
                                onClick={() => removeItemFromCategory(row.ClassName)} 
                                className="p-1.5 text-gray-400 hover:text-error-600 transition-colors"
                                title="Remove from Category"
                            >
                              <Trash01 size={16} />
                            </button>
                            <button 
                                onClick={() => removeItemFromMarketplaceCompletely(row.ClassName)} 
                                className="p-1.5 text-gray-400 hover:text-error-700 transition-colors"
                                title="Delete from Marketplace"
                            >
                              <Delete01 size={16} />
                            </button>
                          </div>
                        ) : (
                          <div className="flex gap-2 justify-end">
                            <button onClick={applyEdit} className="text-success-600 hover:text-success-700 transition-colors">
                              <Check size={18} />
                            </button>
                            <button onClick={cancelEdit} className="text-error-600 hover:text-error-700 transition-colors">
                              <XClose size={18} />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {filteredItems.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-12 text-center text-gray-500 italic">
                      No items found matching your filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Modal>
  );
}
