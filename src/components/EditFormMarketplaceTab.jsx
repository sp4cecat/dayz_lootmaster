import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { Badge } from './base/badges/badges';
import { Checkbox } from './base/checkbox/checkbox';
import { 
  Store, 
  MapPin, 
  Plus, 
  Trash2, 
  Save, 
  Info, 
  AlertCircle, 
  ExternalLink,
  Search,
  Package,
  ArrowRight,
  RefreshCw,
  X
} from 'lucide-react';
import { cx } from '../utils/cx';

/**
 * @typedef {import('../utils/xml.js').Type} Type
 */

/**
 * Marketplace tab: Expansion Market + Trader Zones stock levels. All state/effects are local here.
 * @param {{
 *   selectedTypes: Type[],
 *   typeOptions?: string[],
 *   typeOptionsByCategory?: Record<string, string[]>,
 *   activated?: boolean,
 *   selectedProfileId: string
 * }} props
 */
export default function EditFormMarketplaceTab({ selectedTypes, typeOptions = [], typeOptionsByCategory = {}, activated = false, selectedProfileId }) {
  // ---------------- Expansion Market categories integration ----------------
  const [marketLoading, setMarketLoading] = useState(false);
  const [marketSaving, setMarketSaving] = useState(false);
  const [marketError, setMarketError] = useState('');
  const [marketCategories, setMarketCategories] = useState(/** @type {string[]} */([]));
  const [marketFiles, setMarketFiles] = useState(/** @type {Record<string, any>} */({}));
  const [selectedMarketCats, setSelectedMarketCats] = useState(/** @type {string[]} */([]));

  // ---------------- Trader Zones (Stock levels) ----------------
  const [tzLoading, setTzLoading] = useState(false);
  const [tzSaving, setTzSaving] = useState(false);
  const [tzError, setTzError] = useState('');
  const [traderZones, setTraderZones] = useState(/** @type {string[]} */([]));
  const [traderZoneFiles, setTraderZoneFiles] = useState(/** @type {Record<string, any>} */({}));
  // Per-zone input values ('' => untouched / mixed placeholder)
  const [tzForm, setTzForm] = useState(/** @type {Record<string, string>} */({}));
  // Per-zone add toggles: when true, add missing selected types to that zone with the tzForm value
  const [tzAddMissing, setTzAddMissing] = useState(/** @type {Record<string, boolean>} */({}));

  function getApiBase() {
    const saved = typeof window !== 'undefined' ? localStorage.getItem('dayz-editor:apiBase') : null;
    const fallback = typeof window !== 'undefined' ? `${window.location.protocol}//${window.location.hostname}:4317` : 'http://localhost:4317';
    return (saved && saved.trim()) ? saved.trim().replace(/\/+$/,'') : fallback;
  }

  // Stable fingerprint of current selection (names + categories)
  const selectionFp = useMemo(() => {
    const parts = selectedTypes.map(t => `${String(t.name || '')}|${String(t.category || '')}`);
    parts.sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
    return parts.join(',');
  }, [selectedTypes]);

  // Shared category across selected types (non-empty only if all selected share the same category string)
  const sharedCategory = useMemo(() => {
    const cats = selectedTypes.map(t => String(t.category || ''));
    return cats.every(c => c === cats[0]) ? cats[0] : '';
  }, [selectionFp]);
  const allSelectedSameCategory = !!sharedCategory;

  // Load market categories and their JSON files after first activation and when selection changes
  useEffect(() => {
    if (!activated) return;
    let aborted = false;
    async function load() {
      setMarketLoading(true);
      setMarketError('');
      try {
        const API = getApiBase();
        const r = await fetch(`${API}/api/market/categories`, {
          headers: { 'X-Profile-ID': selectedProfileId }
        });
        if (!r.ok) throw new Error(`Failed to list categories (${r.status})`);
        const list = await r.json();
        const names = Array.isArray(list.categories) ? list.categories : [];
        // Fetch all JSONs
        const entries = await Promise.all(names.map(async (name) => {
          try {
            const rr = await fetch(`${API}/api/market/category/${encodeURIComponent(name)}`, {
              headers: { 'X-Profile-ID': selectedProfileId }
            });
            if (!rr.ok) throw new Error('bad');
            const json = await rr.json();
            return [name, json];
          } catch {
            return [name, null];
          }
        }));
        if (aborted) return;
        const files = Object.fromEntries(entries.filter(e => e[1] != null));
        setMarketCategories(names);
        setMarketFiles(files);
        // Determine initial selected categories: any cat that contains at least one of the selected types
        const selectedNames = names.filter(cat => {
          const file = files[cat];
          if (!file || !Array.isArray(file.Items)) return false;
          const items = file.Items;
          return selectedTypes.some(t => items.some(it => (it.ClassName || '').toLowerCase() === String(t.name || '').toLowerCase()));
        });
        setSelectedMarketCats(selectedNames);
      } catch (e) {
        if (!aborted) setMarketError(String(e && e.message ? e.message : 'Failed to load market categories'));
      } finally {
        if (!aborted) setMarketLoading(false);
      }
    }
    load();
    return () => { aborted = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activated, selectedProfileId]);

  // Recompute preselected categories when selection changes (no refetch)
  useEffect(() => {
    if (!activated) return;
    if (!marketCategories.length) return;
    const selectedNames = marketCategories.filter(cat => {
      const file = marketFiles[cat];
      if (!file || !Array.isArray(file.Items)) return false;
      const items = file.Items;
      return selectedTypes.some(t => items.some(it => String(it.ClassName || '').toLowerCase() === String(t.name || '').toLowerCase()));
    });
    setSelectedMarketCats(selectedNames);
  }, [activated, selectionFp, marketFiles, marketCategories, selectedTypes]);

  // Load trader zones and their JSON files
  useEffect(() => {
    if (!activated) return;
    let aborted = false;
    async function loadZones() {
      setTzLoading(true);
      setTzError('');
      try {
        const API = getApiBase();
        const r = await fetch(`${API}/api/traderzones`, {
          headers: { 'X-Profile-ID': selectedProfileId }
        });
        if (!r.ok) throw new Error(`Failed to list trader zones (${r.status})`);
        const list = await r.json();
        const names = Array.isArray(list.zones) ? list.zones : [];
        const entries = await Promise.all(names.map(async (name) => {
          try {
            const rr = await fetch(`${API}/api/traderzones/${encodeURIComponent(name)}`, {
              headers: { 'X-Profile-ID': selectedProfileId }
            });
            if (!rr.ok) throw new Error('bad');
            const json = await rr.json();
            return [name, json];
          } catch {
            return [name, null];
          }
        }));
        if (aborted) return;
        const files = Object.fromEntries(entries.filter(e => e[1] != null));
        setTraderZones(names);
        setTraderZoneFiles(files);
      } catch (e) {
        if (!aborted) setTzError(String(e && e.message ? e.message : 'Failed to load trader zones'));
      } finally {
        if (!aborted) setTzLoading(false);
      }
    }
    loadZones();
    return () => { aborted = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activated, selectedProfileId]);

  const uncategorizedCount = useMemo(() => {
    const files = marketFiles;
    return selectedTypes.reduce((acc, t) => {
      const name = String(t.name || '').toLowerCase();
      const inAny = Object.values(files).some(file => Array.isArray(file.Items) && file.Items.some(it => String(it.ClassName || '').toLowerCase() === name));
      return acc + (inAny ? 0 : 1);
    }, 0);
  }, [marketFiles, selectionFp]);

  // ----- Trader zones aggregation -----
  const tzAggregate = useMemo(() => {
    /** @type {Record<string, { present:number, missing:number, value:number|null|undefined }>} */
    const agg = {};
    const names = traderZones || [];
    const sel = selectedTypes.map(t => ({ name: String(t.name || ''), lower: String(t.name || '').toLowerCase() }));
    for (const zone of names) {
      const file = traderZoneFiles[zone];
      const stockObj = file && (file.stock || file.Stock) && typeof (file.stock || file.Stock) === 'object' ? (file.stock || file.Stock) : {};
      let present = 0; let missing = 0;
      let firstSet = false; let firstVal = 0; let mixed = false;
      for (const t of sel) {
        // case-insensitive lookup in stock map
        let found = false; let val = 0;
        for (const [k, v] of Object.entries(stockObj)) {
          if (String(k).toLowerCase() === t.lower) { found = true; val = Number(v) || 0; break; }
        }
        if (found) {
          present++;
          if (!firstSet) { firstSet = true; firstVal = val; }
          else if (firstVal !== val) { mixed = true; }
        } else {
          missing++;
        }
      }
      agg[zone] = { present, missing, value: present === 0 ? undefined : (mixed ? null : firstVal) };
    }
    return agg;
  }, [traderZoneFiles, traderZones, selectionFp]);

  // Rehydrate per-zone input values based on aggregation
  useEffect(() => {
    const next = {};
    for (const z of traderZones) {
      const info = tzAggregate[z];
      if (!info) continue;
      if (info.value === undefined || info.value === null) next[z] = '';
      else next[z] = String(info.value);
    }
    setTzForm(next);
    // Default addMissing flags off
    const adds = {};
    setTzAddMissing(adds);
  }, [tzAggregate, traderZones]);

  // Aggregate existing entries for selected types across all categories
  const marketAggregate = useMemo(() => {
    /** @type {{ MaxPriceThreshold:any, MinPriceThreshold:any, SellPricePercent:any, MaxStockThreshold:any, MinStockThreshold:any, QuantityPercent:any, SpawnAttachments:any, Variants:any }} */
    const agg = {
      MaxPriceThreshold: undefined,
      MinPriceThreshold: undefined,
      SellPricePercent: undefined,
      MaxStockThreshold: undefined,
      MinStockThreshold: undefined,
      QuantityPercent: undefined,
      SpawnAttachments: undefined,
      Variants: undefined,
    };
    /** Collect all entries for selected types */
    const entries = [];
    const lowerNames = new Set(selectedTypes.map(t => String(t.name || '').toLowerCase()));
    Object.values(marketFiles).forEach(file => {
      if (!file || !Array.isArray(file.Items)) return;
      for (const it of file.Items) {
        if (!it || typeof it !== 'object') continue;
        const cls = String(it.ClassName || '').toLowerCase();
        if (lowerNames.has(cls)) entries.push(it);
      }
    });
    const merge = (key, norm = v => v, cmp = (a,b)=>a===b) => {
      let firstSet = false; let firstVal;
      for (const e of entries) {
        if (!(key in e)) continue;
        const v = norm(e[key]);
        if (!firstSet) { firstSet = true; firstVal = v; }
        else if (!cmp(firstVal, v)) { firstVal = null; break; }
      }
      if (!firstSet) return null; // no entries had this field
      return firstVal == null ? null : firstVal;
    };
    const arrNorm = a => Array.isArray(a) ? a.map(x=>String(x)).filter(s=>s.length>0) : [];
    const arrCmp = (a,b) => Array.isArray(a) && Array.isArray(b) && a.length===b.length && a.every((x,i)=>String(x)===String(b[i]));

    agg.MaxPriceThreshold = merge('MaxPriceThreshold', Number);
    agg.MinPriceThreshold = merge('MinPriceThreshold', Number);
    agg.SellPricePercent = merge('SellPricePercent', Number);
    agg.MaxStockThreshold = merge('MaxStockThreshold', Number);
    agg.MinStockThreshold = merge('MinStockThreshold', Number);
    agg.QuantityPercent = merge('QuantityPercent', Number);
    const sa = merge('SpawnAttachments', arrNorm, arrCmp);
    agg.SpawnAttachments = sa == null ? null : sa;
    const va = merge('Variants', arrNorm, arrCmp);
    agg.Variants = va == null ? null : va;
    return agg;
  }, [marketFiles, selectionFp]);

  const [marketForm, setMarketForm] = useState(/** @type {Record<string, any>} */({}));
  // Arrays editor state (null => Mixed/indeterminate, string[] => explicit)
  const [marketArrays, setMarketArrays] = useState(/** @type {{ SpawnAttachments: string[]|null, Variants: string[]|null }} */({ SpawnAttachments: null, Variants: null }));
  // Rehydrate form whenever aggregation changes; preserve compatible drafts
  useEffect(() => {
    const f = {};
    const fill = (k, v) => {
      if (Array.isArray(v)) f[k] = String(v.join(', '));
      else if (v === null || v === undefined) f[k] = '';
      else f[k] = String(v);
    };
    fill('MaxPriceThreshold', marketAggregate.MaxPriceThreshold);
    fill('MinPriceThreshold', marketAggregate.MinPriceThreshold);
    fill('SellPricePercent', marketAggregate.SellPricePercent);
    fill('MaxStockThreshold', marketAggregate.MaxStockThreshold);
    fill('MinStockThreshold', marketAggregate.MinStockThreshold);
    fill('QuantityPercent', marketAggregate.QuantityPercent);
    // Arrays: preserve explicit user drafts when compatible
    setMarketArrays(prev => {
      const aggSA = Array.isArray(marketAggregate.SpawnAttachments) ? [...marketAggregate.SpawnAttachments] : null;
      const aggVA = Array.isArray(marketAggregate.Variants) ? [...marketAggregate.Variants] : null;
      const next = {
        SpawnAttachments: (prev && Array.isArray(prev.SpawnAttachments)) ? prev.SpawnAttachments : aggSA,
        Variants: allSelectedSameCategory ? ((prev && Array.isArray(prev.Variants)) ? prev.Variants : aggVA) : null,
      };
      return next;
    });
    setMarketForm(f);
  }, [marketAggregate, allSelectedSameCategory, selectionFp]);


  const onApplyMarketMove = async () => {
    if (selectedMarketCats.length !== 1) return;
    const targetCat = selectedMarketCats[0];
    setMarketSaving(true);
    setMarketError('');
    try {
      const API = getApiBase();
      const lowerNames = new Set(selectedTypes.map(t => String(t.name || '').toLowerCase()));
      /** @type {string[]} */
      const changed = [];
      // Remove from all categories
      for (const cat of marketCategories) {
        const file = marketFiles[cat];
        if (!file || !Array.isArray(file.Items)) continue;
        const before = file.Items.length;
        file.Items = file.Items.filter(it => !lowerNames.has(String(it.ClassName || '').toLowerCase()));
        if (file.Items.length !== before) {
          changed.push(cat);
        }
      }
      // Add to target category
      const tgt = marketFiles[targetCat] || { Items: [] };
      if (!Array.isArray(tgt.Items)) tgt.Items = [];
      for (const t of selectedTypes) {
        const name = String(t.name || '');
        const exists = tgt.Items.some(it => String(it.ClassName || '').toLowerCase() === name.toLowerCase());
        if (!exists) {
          tgt.Items.push({
            ClassName: name,
            MaxPriceThreshold: 100,
            MinPriceThreshold: 50,
            SellPricePercent: -1.0,
            MaxStockThreshold: 100,
            MinStockThreshold: 1,
            QuantityPercent: -1,
            SpawnAttachments: [],
            Variants: []
          });
        }
      }
      marketFiles[targetCat] = tgt;
      if (!changed.includes(targetCat)) changed.push(targetCat);

      // Persist changed categories
      for (const cat of changed) {
        const body = JSON.stringify(marketFiles[cat] || { Items: [] });
        const res = await fetch(`${API}/api/market/category/${encodeURIComponent(cat)}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'X-Profile-ID': selectedProfileId
          },
          body
        });
        if (!res.ok) throw new Error(`Failed to write category ${cat} (${res.status})`);
      }
      setMarketFiles({ ...marketFiles });
    } catch (e) {
      setMarketError(String(e && e.message ? e.message : 'Failed to apply'));
    } finally {
      setMarketSaving(false);
    }
  };

  const onApplyMarketValues = async () => {
    setMarketSaving(true);
    setMarketError('');
    try {
      const API = getApiBase();
      const lowerNames = new Set(selectedTypes.map(t => String(t.name || '').toLowerCase()));
      /** @type {string[]} */
      const changed = [];
      const parseArr = (s) => (String(s || '').trim() === '' ? null : String(s).split(',').map(x => x.trim()).filter(Boolean));
      const normFromArray = (arr) => {
        if (!Array.isArray(arr)) return null;
        const set = new Set(arr.map(x => String(x).trim()).filter(Boolean));
        return Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
      };
      for (const cat of marketCategories) {
        const file = marketFiles[cat];
        if (!file || !Array.isArray(file.Items)) continue;
        let any = false;
        for (const it of file.Items) {
          const cls = String(it.ClassName || '').toLowerCase();
          if (!lowerNames.has(cls)) continue;
          // Apply numbers if provided
          const applyNum = (k) => {
            const v = marketForm[k];
            if (v === '' || v === null || v === undefined) return;
            const num = Number(v);
            if (!Number.isNaN(num)) { it[k] = num; any = true; }
          };
          applyNum('MaxPriceThreshold');
          applyNum('MinPriceThreshold');
          applyNum('SellPricePercent');
          applyNum('MaxStockThreshold');
          applyNum('MinStockThreshold');
          applyNum('QuantityPercent');
          // Arrays (pill editors take precedence)
          if (marketArrays.SpawnAttachments !== null) {
            const saArr = normFromArray(marketArrays.SpawnAttachments);
            if (saArr) { it['SpawnAttachments'] = saArr; any = true; } else { it['SpawnAttachments'] = []; any = true; }
          } else {
            const sa = parseArr(marketForm['SpawnAttachments']);
            if (sa) { it['SpawnAttachments'] = sa.sort((a,b)=>a.localeCompare(b, undefined, {sensitivity:'base'})); any = true; }
          }
          if (marketArrays.Variants !== null) {
            const vaArr = normFromArray(marketArrays.Variants);
            if (vaArr) { it['Variants'] = vaArr; any = true; } else { it['Variants'] = []; any = true; }
          } else {
            const va = parseArr(marketForm['Variants']);
            if (va) { it['Variants'] = va.sort((a,b)=>a.localeCompare(b, undefined, {sensitivity:'base'})); any = true; }
          }
        }
        if (any) changed.push(cat);
      }
      for (const cat of changed) {
        const body = JSON.stringify(marketFiles[cat]);
        const res = await fetch(`${API}/api/market/category/${encodeURIComponent(cat)}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'X-Profile-ID': selectedProfileId
          },
          body
        });
        if (!res.ok) throw new Error(`Failed to write category ${cat} (${res.status})`);
      }
      setMarketFiles({ ...marketFiles });
    } catch (e) {
      setMarketError(String(e && e.message ? e.message : 'Failed to apply values'));
    } finally {
      setMarketSaving(false);
    }
  };

  const onApplyTraderZones = async () => {
    setTzSaving(true);
    setTzError('');
    try {
      const API = getApiBase();
      const selected = selectedTypes
        .map(t => ({ name: String(t.name || ''), lower: String(t.name || '').toLowerCase() }))
        .filter(x => x.name);
      /** @type {string[]} */
      const changed = [];

      for (const zone of traderZones) {
        const valStr = tzForm[zone];
        if (typeof valStr !== 'string' || valStr.trim() === '') continue; // no change for this zone
        if (!/^\d+$/.test(valStr.trim())) continue; // ignore invalid
        const val = parseInt(valStr.trim(), 10);
        if (!Number.isFinite(val) || val < 0) continue;

        const file = traderZoneFiles[zone];
        if (!file || typeof file !== 'object') continue;

        const hasLower = Object.prototype.hasOwnProperty.call(file, 'stock');
        const hasUpper = Object.prototype.hasOwnProperty.call(file, 'Stock');
        const prop = hasLower ? 'stock' : (hasUpper ? 'Stock' : 'stock');
        let stock = file[prop];
        if (!stock || typeof stock !== 'object' || Array.isArray(stock)) stock = {};

        const lowerMap = {};
        for (const k of Object.keys(stock)) lowerMap[String(k).toLowerCase()] = k;

        let any = false;
        const addMissing = !!tzAddMissing[zone];
        for (const t of selected) {
          const existKey = lowerMap[t.lower];
          if (existKey) {
            if (Number(stock[existKey]) !== val) { stock[existKey] = val; any = true; }
          } else if (addMissing) {
            stock[t.name] = val; any = true;
          }
        }
        if (any) {
          file[prop] = stock;
          traderZoneFiles[zone] = file;
          changed.push(zone);
        }
      }

      for (const zone of changed) {
        const body = JSON.stringify(traderZoneFiles[zone] || {});
        const res = await fetch(`${API}/api/traderzones/${encodeURIComponent(zone)}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'X-Profile-ID': selectedProfileId
          },
          body
        });
        if (!res.ok) throw new Error(`Failed to write trader zone ${zone} (${res.status})`);
      }

      if (changed.length) setTraderZoneFiles({ ...traderZoneFiles });
    } catch (e) {
      setTzError(String(e && e.message ? e.message : 'Failed to apply stock'));
    } finally {
      setTzSaving(false);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      {/* Expansion Market Section */}
      <div className="p-6 bg-primary-50/30 rounded-2xl border border-primary-100 dark:bg-primary-900/5 dark:border-primary-900/10 space-y-6">
        <div className="flex items-center gap-3">
          <div className="size-10 bg-primary-100 rounded-lg flex items-center justify-center text-primary-600 dark:bg-primary-900/30 dark:text-primary-400">
            <Store size={20} />
          </div>
          <div>
            <h4 className="text-lg font-bold text-gray-900 dark:text-white">Expansion Market</h4>
            <p className="text-sm text-gray-500 dark:text-gray-400">Manage category assignments and market properties.</p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300 flex justify-between">
              Categories
              {marketLoading && <RefreshCw size={14} className="animate-spin text-primary-600" />}
            </label>
            <div className="flex gap-3">
              <select 
                multiple 
                size={Math.min(8, Math.max(4, marketCategories.length))}
                className="flex-1 h-auto p-2 text-sm bg-white border border-gray-300 rounded-xl focus:ring-4 focus:ring-primary-100 transition-all dark:bg-gray-950 dark:border-gray-700 dark:text-white min-h-[120px]"
                value={selectedMarketCats}
                onChange={e => {
                  const opts = Array.from(e.target.selectedOptions).map(o => o.value);
                  setSelectedMarketCats(opts);
                }}
                disabled={marketLoading}
              >
                {marketCategories.map(c => (
                  <option key={c} value={c} className="px-3 py-1.5 rounded-lg mb-1 last:mb-0 hover:bg-gray-50 dark:hover:bg-gray-800">{c}</option>
                ))}
              </select>
              <Button 
                variant="primary" 
                onClick={onApplyMarketMove}
                disabled={marketSaving || marketLoading || selectedMarketCats.length !== 1}
                className="self-start h-10 px-6"
                icon={ArrowRight}
                iconPosition="right"
              >
                Move
              </Button>
            </div>
            {uncategorizedCount > 0 && !marketLoading && (
              <p className="text-xs text-warning-600 dark:text-warning-400 font-medium">
                {uncategorizedCount} of {selectedTypes.length} items are not in any market category.
              </p>
            )}
            {marketError && (
              <p className="text-xs text-error-600 dark:text-error-400 flex items-center gap-1">
                <AlertCircle size={12} /> {marketError}
              </p>
            )}
          </div>

          <div className="space-y-4 pt-4 border-t border-primary-100 dark:border-primary-900/20">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider dark:text-gray-400">Item Properties</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {[
                { key: 'MaxPriceThreshold', label: 'Max Price' },
                { key: 'MinPriceThreshold', label: 'Min Price' },
                { key: 'SellPricePercent', label: 'Sell %' },
                { key: 'MaxStockThreshold', label: 'Max Stock' },
                { key: 'MinStockThreshold', label: 'Min Stock' },
                { key: 'QuantityPercent', label: 'Quantity %' },
              ].map(fld => (
                <div key={fld.key}>
                  <Input
                    label={fld.label}
                    placeholder={marketForm[fld.key] === '' ? 'Mixed' : '—'}
                    value={marketForm[fld.key] ?? ''}
                    onChange={e => setMarketForm(m => ({ ...m, [fld.key]: e.target.value }))}
                    className="h-9"
                  />
                </div>
              ))}
            </div>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Spawn Attachments</label>
                <PillArrayEditor
                  key={`sa-${selectionFp}`}
                  value={marketArrays.SpawnAttachments}
                  onChange={(arr) => setMarketArrays(s => ({ ...s, SpawnAttachments: arr }))}
                  options={typeOptions}
                  allowEditWhenMixed={true}
                  allowClear
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Variants</label>
                <PillArrayEditor
                  key={`va-${selectionFp}-${sharedCategory}`}
                  value={marketArrays.Variants}
                  onChange={(arr) => setMarketArrays(s => ({ ...s, Variants: arr }))}
                  options={allSelectedSameCategory ? (typeOptionsByCategory[sharedCategory] || []) : []}
                  allowEditWhenMixed={allSelectedSameCategory}
                  disabled={!allSelectedSameCategory}
                  allowClear
                />
                {!allSelectedSameCategory && (
                  <p className="text-[10px] text-gray-400 italic">Select items with the same category to edit variants.</p>
                )}
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <Button 
                variant="secondary-color" 
                size="md" 
                onClick={onApplyMarketValues} 
                disabled={marketSaving || marketLoading}
                icon={Save}
              >
                Apply Values
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Stock Levels Section */}
      <div className="p-6 bg-gray-50 rounded-2xl border border-gray-200 dark:bg-gray-900 dark:border-gray-800 space-y-6">
        <div className="flex items-center gap-3">
          <div className="size-10 bg-white rounded-lg flex items-center justify-center text-gray-600 shadow-sm border border-gray-100 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-400">
            <Package size={20} />
          </div>
          <div>
            <h4 className="text-lg font-bold text-gray-900 dark:text-white">Trader Stock Levels</h4>
            <p className="text-sm text-gray-500 dark:text-gray-400">Manage per-zone stock for selected items.</p>
          </div>
        </div>

        {tzError && (
          <div className="p-3 bg-error-50 border border-error-100 rounded-xl text-error-700 text-sm flex items-center gap-2">
            <AlertCircle size={16} /> {tzError}
          </div>
        )}

        <div className="space-y-3">
          <div className="grid grid-cols-12 gap-4 px-4 text-xs font-bold text-gray-500 uppercase tracking-wider dark:text-gray-400">
            <div className="col-span-5">Trader Zone</div>
            <div className="col-span-3">Stock</div>
            <div className="col-span-4 text-right">Actions</div>
          </div>

          <div className="space-y-2">
            {traderZones.map(zone => {
              const info = tzAggregate[zone] || { present: 0, missing: selectedTypes.length, value: undefined };
              const mixed = info.value === null;
              const nonePresent = info.present === 0 && info.missing > 0;
              
              return (
                <div key={zone} className="grid grid-cols-12 gap-4 p-4 bg-white rounded-xl border border-gray-100 shadow-sm items-center dark:bg-gray-950 dark:border-gray-800">
                  <div className="col-span-5 min-w-0">
                    <p className="text-sm font-bold text-gray-900 truncate dark:text-white">{zone}</p>
                    <div className="flex gap-2 mt-1">
                      {info.present > 0 && <Badge color="success" size="sm">{info.present} present</Badge>}
                      {info.missing > 0 && <Badge color="gray" size="sm">{info.missing} missing</Badge>}
                    </div>
                  </div>
                  <div className="col-span-3">
                    <Input
                      placeholder={mixed ? 'Mixed' : '—'}
                      value={tzForm[zone] ?? ''}
                      onChange={e => setTzForm(f => ({ ...f, [zone]: e.target.value }))}
                      className="h-9"
                    />
                  </div>
                  <div className="col-span-4 flex justify-end">
                    <div className="flex items-center gap-3">
                      {nonePresent ? (
                        <div className="flex items-center gap-2">
                          <Checkbox
                            isSelected={!!tzAddMissing[zone]}
                            onChange={c => setTzAddMissing(prev => ({ ...prev, [zone]: c }))}
                            label="Add"
                            size="sm"
                          />
                        </div>
                      ) : (
                        info.missing > 0 && (
                          <div className="flex items-center gap-2">
                             <Checkbox
                              isSelected={!!tzAddMissing[zone]}
                              onChange={c => setTzAddMissing(prev => ({ ...prev, [zone]: c }))}
                              label="Missing"
                              size="sm"
                            />
                          </div>
                        )
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex justify-end pt-4 border-t border-gray-100 dark:border-gray-800">
          <Button 
            variant="primary" 
            onClick={onApplyTraderZones} 
            disabled={tzSaving || tzLoading}
            icon={Save}
          >
            {tzSaving ? 'Saving...' : 'Apply Stock'}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Lightweight pill/chip multi-select editor with optional Mixed behavior.
 */
function PillArrayEditor({ value, onChange, options, allowEditWhenMixed = false, disabled = false, allowClear = false }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const [activated, setActivated] = useState(false); 
  const [hoverIndex, setHoverIndex] = useState(-1);

  useEffect(() => {
    const onDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const current = Array.isArray(value) ? value : [];
  const lowerSelected = new Set(current.map(v => String(v).toLowerCase()));
  const canonOptions = Array.isArray(options) ? options : [];
  const filteredOptions = canonOptions
    .filter(o => !lowerSelected.has(String(o).toLowerCase()))
    .filter(o => query.trim() === '' ? true : String(o).toLowerCase().includes(query.trim().toLowerCase()))
    .slice(0, 200);

  const canInteract = !disabled && (Array.isArray(value) || allowEditWhenMixed);
  const isMixed = value === null;

  const openDialog = () => {
    if (!canInteract) return;
    setOpen(true);
    setQuery('');
    setTimeout(() => { if (inputRef.current) inputRef.current.focus(); }, 0);
  };

  const onAdd = (name) => {
    const canonical = canonOptions.find(o => String(o).toLowerCase() === String(name).toLowerCase()) || name;
    const next = [...new Set([...current, String(canonical)])];
    onChange(next);
    setOpen(false);
    setQuery('');
    setHoverIndex(-1);
  };

  const onRemove = (name) => {
    const next = current.filter(x => String(x).toLowerCase() !== String(name).toLowerCase());
    onChange(next);
  };

  if (isMixed && !allowEditWhenMixed) {
    return (
      <div className="flex h-10 items-center px-3 border border-gray-300 rounded-lg bg-gray-50/50 dark:bg-gray-950/20 dark:border-gray-700 opacity-60">
        <span className="text-sm text-gray-500 italic">Mixed values</span>
      </div>
    );
  }

  const showAddOnly = isMixed && allowEditWhenMixed && !activated;

  return (
    <div ref={rootRef} className="relative">
      <div
        className={cx(
          "flex flex-wrap gap-2 p-2 border rounded-xl transition-all min-h-12 items-center bg-white dark:bg-gray-950",
          canInteract ? "cursor-text hover:border-primary-300 dark:hover:border-primary-500" : "cursor-default",
          open ? "border-primary-600 ring-4 ring-primary-100 dark:ring-primary-900/20" : "border-gray-300 dark:border-gray-700",
          disabled && "opacity-60 grayscale"
        )}
        onMouseDown={() => {
          if (disabled) return;
          if (showAddOnly) { setActivated(true); setTimeout(openDialog, 0); }
          else if (canInteract) openDialog();
        }}
      >
        {current.map(v => (
          <Badge key={v} color="gray" size="md" type="modern" className="pr-1 gap-1">
            {v}
            {!disabled && (
              <button 
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); onRemove(v); }}
                className="hover:text-error-600 rounded-full p-0.5"
              >
                <X size={14} />
              </button>
            )}
          </Badge>
        ))}

        {canInteract && !showAddOnly && (
          <Button 
            variant="tertiary" 
            size="sm" 
            className="h-7 px-2 text-xs" 
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); openDialog(); }}
          >
            <Plus size={14} className="mr-1" /> Add
          </Button>
        )}

        {allowClear && current.length > 0 && !disabled && (
          <Button 
            variant="tertiary" 
            size="sm" 
            className="h-7 px-2 text-xs text-error-600 hover:text-error-700" 
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onChange([]); }}
          >
            Clear
          </Button>
        )}

        {showAddOnly && (
          <span className="text-xs text-primary-600 font-medium italic animate-pulse px-2">Mixed — Click to manage</span>
        )}
      </div>

      {open && canInteract && (
        <div className="absolute top-full left-0 mt-2 z-50 bg-white border border-gray-200 rounded-xl shadow-xl w-72 flex flex-col overflow-hidden dark:bg-gray-900 dark:border-gray-800 animate-in zoom-in-95 duration-150">
          <div className="p-2 border-b border-gray-100 dark:border-gray-800 flex items-center gap-2">
            <Search size={16} className="text-gray-400 ml-2" />
            <input
              ref={inputRef}
              className="flex-1 h-9 bg-transparent border-none focus:ring-0 text-sm dark:text-white"
              placeholder="Search items..."
              value={query}
              onChange={e => { setQuery(e.target.value); setHoverIndex(0); }}
              onKeyDown={e => {
                if (e.key === 'Escape') setOpen(false);
                if (e.key === 'Enter') {
                  const choice = filteredOptions[Math.max(0, hoverIndex)] || filteredOptions[0];
                  if (choice) onAdd(choice);
                }
                if (e.key === 'ArrowDown') { e.preventDefault(); setHoverIndex(i => Math.min(i + 1, filteredOptions.length - 1)); }
                if (e.key === 'ArrowUp') { e.preventDefault(); setHoverIndex(i => Math.max(i - 1, 0)); }
              }}
            />
          </div>
          <div className="max-h-60 overflow-y-auto p-1 scrollbar-thin">
            {filteredOptions.length === 0 ? (
              <div className="p-3 text-xs text-center text-gray-500 italic">No matches found</div>
            ) : (
              filteredOptions.map((opt, i) => (
                <button
                  key={opt}
                  className={cx(
                    "w-full text-left px-3 py-2 text-sm rounded-lg transition-colors",
                    i === hoverIndex ? "bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300" : "hover:bg-gray-50 dark:hover:bg-gray-800 dark:text-gray-300"
                  )}
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); onAdd(opt); }}
                  onMouseEnter={() => setHoverIndex(i)}
                >
                  {opt}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
