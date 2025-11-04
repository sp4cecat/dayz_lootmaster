import React, { useEffect, useMemo, useRef, useState } from 'react';
import { validateTypeAgainstDefinitions } from '../utils/validation.js';
import { formatLifetime } from '../utils/time.js';

/**
 * @typedef {import('../utils/xml.js').Type} Type
 */

/**
 * @param {{
 *  definitions: {categories: string[], usageflags: string[], valueflags: string[], tags: string[]},
 *  selectedTypes: Type[],
 *  onCancel: () => void,
 *  onSave: (apply: (t: Type) => Type) => void,
 *  typeOptions?: string[],
 *  typeOptionsByCategory?: Record<string, string[]>
 * }} props
 */
export default function EditForm({ definitions, selectedTypes, onCancel, onSave, typeOptions = [], typeOptionsByCategory = {} }) {
  const base = selectedTypes[0];

  // Initialize local form state with mixed awareness
  const initial = useMemo(() => {
    const nums = ['nominal', 'min', 'lifetime', 'restock', 'quantmin', 'quantmax'];
    /** @type {Record<string, any>} */
    const obj = {};
    nums.forEach(k => {
      const allSame = selectedTypes.every(t => t[k] === selectedTypes[0][k]);
      obj[k] = allSame ? selectedTypes[0][k] : null; // null => Mixed placeholder
    });
    obj.category = allSameField(selectedTypes.map(t => t.category)) || '';
    obj.flags = { ...base.flags };
    // Calculate tri-state for arrays: on/off/mixed label handling happens in UI via map
    obj.usage = makeTriState(definitions.usageflags, selectedTypes.map(t => t.usage));
    obj.value = makeTriState(definitions.valueflags, selectedTypes.map(t => t.value));
    obj.tag = makeTriState(definitions.tags, selectedTypes.map(t => t.tag));
    return obj;
  }, [selectedTypes, definitions, base]);

  const [form, setForm] = useState(initial);
  useEffect(() => setForm(initial), [initial]);

  const [errors, setErrors] = useState({});

  // Lifetime popover state
  const [showLifetimePicker, setShowLifetimePicker] = useState(false);
  const [lp, setLp] = useState({ weeks: 0, days: 0, hours: 0, minutes: 0, seconds: 0 });

  // Initialize picker values from current lifetime when opening
  useEffect(() => {
    if (showLifetimePicker) {
      const secs = Number(form.lifetime || 0);
      const u = splitSecondsToUnits(isFinite(secs) ? secs : 0);
      setLp(u);
    }
  }, [showLifetimePicker, form.lifetime]);

  // Refs for outside-click handling
  const lifetimeRef = useRef(null);
  const popoverRef = useRef(null);

  // Close the popover on outside click
  useEffect(() => {
    if (!showLifetimePicker) return;
    const onDown = (e) => {
      const pop = popoverRef.current;
      const trigger = lifetimeRef.current;
      if (pop && pop.contains(e.target)) return;
      if (trigger && trigger.contains(e.target)) return;
      setShowLifetimePicker(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [showLifetimePicker]);

  const setNum = (key, strVal) => {
    const v = strVal === '' ? '' : Number(strVal);
    setForm(f => ({ ...f, [key]: v }));
  };

  const toggleFlag = (key) => {
    setForm(f => ({ ...f, flags: { ...f.flags, [key]: !f.flags[key] } }));
  };

  const cycleTri = (group, key) => {
    setForm(f => {
      const cur = f[group][key];
      // On user click: mixed or false -> true, true -> false
      const next = cur === true ? false : true;
      return { ...f, [group]: { ...f[group], [key]: next } };
    });
  };

  const canSave = useMemo(() => {
    // Build a representative type to validate; for multi-selection, only validate when fields are set (not null)
    const sample = applyToType(selectedTypes[0], form, definitions);
    const issues = validateTypeAgainstDefinitions(sample, definitions);
    setErrors(issues);
    return Object.keys(issues).length === 0;
  }, [form, selectedTypes, definitions]);

  const onSaveClick = () => {
    const apply = (t) => applyToType(t, form, definitions);
    onSave(apply);
  };

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

  // Load market categories and their JSON files when edit form opens or selection changes
  useEffect(() => {
    let aborted = false;
    async function load() {
      setMarketLoading(true);
      setMarketError('');
      try {
        const API = getApiBase();
        const r = await fetch(`${API}/api/market/categories`);
        if (!r.ok) throw new Error(`Failed to list categories (${r.status})`);
        const list = await r.json();
        const names = Array.isArray(list.categories) ? list.categories : [];
        // Fetch all JSONs
        const entries = await Promise.all(names.map(async (name) => {
          try {
            const rr = await fetch(`${API}/api/market/category/${encodeURIComponent(name)}`);
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
  }, [selectedTypes.map(t => t.name).join('|')]);

  // Load trader zones and their JSON files
  useEffect(() => {
    let aborted = false;
    async function loadZones() {
      setTzLoading(true);
      setTzError('');
      try {
        const API = getApiBase();
        const r = await fetch(`${API}/api/traderzones`);
        if (!r.ok) throw new Error(`Failed to list trader zones (${r.status})`);
        const list = await r.json();
        const names = Array.isArray(list.zones) ? list.zones : [];
        const entries = await Promise.all(names.map(async (name) => {
          try {
            const rr = await fetch(`${API}/api/traderzones/${encodeURIComponent(name)}`);
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
  }, [selectedTypes.map(t => t.name).join('|')]);

  const uncategorizedCount = useMemo(() => {
    const files = marketFiles;
    return selectedTypes.reduce((acc, t) => {
      const name = String(t.name || '').toLowerCase();
      const inAny = Object.values(files).some(file => Array.isArray(file.Items) && file.Items.some(it => String(it.ClassName || '').toLowerCase() === name));
      return acc + (inAny ? 0 : 1);
    }, 0);
  }, [marketFiles, selectedTypes]);

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
  }, [traderZoneFiles, traderZones, selectedTypes]);

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
  }, [marketFiles, selectedTypes]);

  const [marketForm, setMarketForm] = useState(/** @type {Record<string, any>} */({}));
  // Arrays editor state (null => Mixed/indeterminate, string[] => explicit)
  const [marketArrays, setMarketArrays] = useState(/** @type {{ SpawnAttachments: string[]|null, Variants: string[]|null }} */({ SpawnAttachments: null, Variants: null }));
  // Rehydrate form whenever aggregation changes
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
    // Arrays: keep separate state for pill editor
    setMarketArrays({
      SpawnAttachments: Array.isArray(marketAggregate.SpawnAttachments) ? [...marketAggregate.SpawnAttachments] : null,
      Variants: Array.isArray(marketAggregate.Variants) ? [...marketAggregate.Variants] : null,
    });
    setMarketForm(f);
  }, [marketAggregate]);

  // Shared category across selected types (non-empty only if all selected share the same category string)
  const sharedCategory = useMemo(() => {
    const cats = selectedTypes.map(t => String(t.category || ''));
    return cats.every(c => c === cats[0]) ? cats[0] : '';
  }, [selectedTypes]);
  const allSelectedSameCategory = !!sharedCategory;

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
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body
        });
        if (!res.ok) throw new Error(`Failed to write category ${cat} (${res.status})`);
      }
      // Refresh selection/membership counts by reloading
      // Simple local recompute instead of refetch
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
      // For each category, update only entries that exist for selected types
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
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body
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
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body
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
    <div className="edit-form">
      <div className="edit-form-header">
        <h3>Edit {selectedTypes.length} item{selectedTypes.length > 1 ? 's' : ''}</h3>
        <div className="spacer" />
        <button className="btn" onClick={onCancel}>Cancel</button>
        <button className="btn primary" onClick={onSaveClick} disabled={!canSave}>Save</button>
      </div>

      <div className="form-grid">
        <div className="basics-stack">
          <label className={`control ${form.category && !definitions.categories.includes(form.category) ? 'error' : ''}`}>
            <span>Category</span>
            <select
              value={form.category}
              onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
            >
              <option value="">—</option>
              {definitions.categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>

          {['nominal', 'min', 'lifetime', 'restock', 'quantmin', 'quantmax'].map(k => (
            <label
              key={k}
              className={`control ${form[k] === null ? 'mixed' : ''}`}
              style={{ position: 'relative' }}
              ref={k === 'lifetime' ? lifetimeRef : null}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {labelFor(k)}
                {k === 'lifetime' && (
                  <button
                    type="button"
                    className="link"
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowLifetimePicker(true); }}
                    title="Open lifetime picker"
                    aria-label="Open lifetime picker"
                    style={{ textDecoration: 'none', padding: 0, display: 'inline-flex', alignItems: 'center' }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5"/>
                      <path d="M12 7v5l4 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </button>
                )}
              </span>
              <input
                type="number"
                placeholder={form[k] === null ? 'Mixed' : ''}
                value={form[k] === null ? '' : form[k]}
                onChange={e => setNum(k, e.target.value)}
              />

              {k === 'lifetime' && showLifetimePicker && (
                <div
                  className="lifetime-popover"
                  role="dialog"
                  aria-label="Lifetime picker"
                  ref={popoverRef}
                  style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    marginTop: 6,
                    zIndex: 2,
                    background: 'var(--bg)',
                    color: 'var(--text)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    padding: 10,
                    boxShadow: '0 4px 18px rgba(0,0,0,.2)',
                    minWidth: 260
                  }}
                >
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
                    {[
                      { key: 'weeks', label: 'Weeks' },
                      { key: 'days', label: 'Days' },
                      { key: 'hours', label: 'Hours' },
                      { key: 'minutes', label: 'Minutes' },
                      { key: 'seconds', label: 'Seconds' },
                    ].map(f => (
                      <label key={f.key} className="control" style={{ margin: 0 }}>
                        <span style={{ fontSize: 11 }}>{f.label}</span>
                        <input
                          type="number"
                          min={0}
                          value={lp[f.key]}
                          onChange={e => setLp(prev => ({ ...prev, [f.key]: Math.max(0, Number(e.target.value || 0)) }))}
                        />
                      </label>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 10 }}>
                    <button
                      type="button"
                      className="btn"
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowLifetimePicker(false); }}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="btn primary"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const total = unitsToSeconds(lp);
                        setNum('lifetime', String(total));
                        setShowLifetimePicker(false);
                        if (document && document.activeElement instanceof HTMLElement) {
                          document.activeElement.blur();
                        }
                      }}
                    >
                      Apply
                    </button>
                  </div>
                </div>
              )}

              {k === 'lifetime' && form[k] !== null && form[k] !== '' && Number.isFinite(Number(form[k])) && (
                <div className="muted" style={{ fontSize: '11px' }}>
                  ≈ {formatLifetime(Number(form[k]))}
                </div>
              )}
            </label>
          ))}


        </div>

        <div className="panels-wrap">
          {renderTriStateGroup('usage', form, definitions.usageflags, cycleTri)}
          {renderTriStateGroup('value', form, definitions.valueflags, cycleTri)}

          <fieldset className="control panels-item">
            <legend>Flags</legend>
            <div className="checkbox-grid">
              {Object.keys(base.flags).map(k => (
                <label key={k} className="checkbox">
                  <input type="checkbox" checked={!!form.flags[k]} onChange={() => toggleFlag(k)} />
                  <span>{k}</span>
                </label>
              ))}
            </div>
          </fieldset>

          {renderTriStateGroup('tag', form, definitions.tags, cycleTri)}
        </div>

          <div style={{"display": "flex", "gap": "10px"}}>

        <fieldset className="control" style={{ marginTop: 10, background: 'var(--market-section-bg, rgba(255, 215, 0, 0.06))', padding: 10, borderRadius: 6 }}>
          <legend>Expansion Market</legend>
          <label className="control" style={{ alignItems: 'stretch' }}>
            <span>Categories</span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
              <select multiple size={Math.min(8, Math.max(3, marketCategories.length))}
                      value={selectedMarketCats}
                      onChange={e => {
                        const opts = Array.from(e.target.selectedOptions).map(o => o.value);
                        setSelectedMarketCats(opts);
                      }}
                      style={{ flex: 1 }}
                      disabled={marketLoading}
              >
                {marketCategories.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <button type="button" className="btn" onClick={onApplyMarketMove}
                      disabled={marketSaving || marketLoading || selectedMarketCats.length !== 1}
                      title={selectedMarketCats.length !== 1 ? 'Select exactly one category to apply' : 'Move selected types to this category'}
              >Apply</button>
            </div>
            <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
              {marketLoading ? 'Loading categories…' : (uncategorizedCount ? `${uncategorizedCount} of ${selectedTypes.length} not categorised` : '')}
              {marketError ? <span className="error-line"> — {marketError}</span> : null}
            </div>
          </label>

          <div className="market-props" style={{ marginTop: 10 }}>
            <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
              Edit item properties for existing category entries. Leave a field blank to keep it unchanged.
            </div>
            <div className="grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
              {[
                { key: 'MaxPriceThreshold', label: 'Max Price' },
                { key: 'MinPriceThreshold', label: 'Min Price' },
                { key: 'SellPricePercent', label: 'Sell %' },
                { key: 'MaxStockThreshold', label: 'Max Stock' },
                { key: 'MinStockThreshold', label: 'Min Stock' },
                { key: 'QuantityPercent', label: 'Quantity %' },
              ].map(fld => (
                <label key={fld.key} className={`control ${marketForm[fld.key] === '' ? 'mixed' : ''}`}>
                  <span>{fld.label}</span>
                  <input
                    type="text"
                    placeholder={marketForm[fld.key] === '' ? 'Mixed' : ''}
                    value={marketForm[fld.key] ?? ''}
                    onChange={e => setMarketForm(m => ({ ...m, [fld.key]: e.target.value }))}
                  />
                </label>
              ))}

                <div style={{"display": "flex", "justifyContent": "space-between", "gap": "10px","width": "100%", "marginTop": "10px", "flexwrap": "wrap"}}>
              {/* SpawnAttachments pill editor */}
              <div className={`control ${marketArrays.SpawnAttachments === null ? 'mixed' : ''}`}>
                <span>Spawn Attachments</span>
                <PillArrayEditor
                  value={marketArrays.SpawnAttachments}
                  onChange={(arr) => setMarketArrays(s => ({ ...s, SpawnAttachments: arr }))}
                  options={typeOptions}
                  allowEditWhenMixed={true}
                  allowClear
                />
              </div>

              {/* Variants pill editor (restricted to same-category types) */}
              <div className={`control ${marketArrays.Variants === null ? 'mixed' : ''}`}>
                <span>Variants</span>
                <PillArrayEditor
                  value={marketArrays.Variants}
                  onChange={(arr) => setMarketArrays(s => ({ ...s, Variants: arr }))}
                  options={allSelectedSameCategory ? (typeOptionsByCategory[sharedCategory] || []) : []}
                  allowEditWhenMixed={allSelectedSameCategory}
                  disabled={!allSelectedSameCategory}
                  allowClear
                />
                {!allSelectedSameCategory && (
                  <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>Select items with the same category to edit variants.</div>
                )}
              </div>
                </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
              <button type="button" className="btn" onClick={onApplyMarketValues} disabled={marketSaving || marketLoading}>Apply values</button>
            </div>
          </div>
        </fieldset>

        {/* Stock levels (Trader Zones) */}
        <fieldset className="control" style={{ marginTop: 10, background: 'var(--market-section-bg, rgba(255, 215, 0, 0.06))', padding: 10, borderRadius: 6 }}>
          <legend>Stock levels</legend>
          <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
            Manage per-zone stock for the selected item(s). Enter a value to update existing entries. Use “Add”/“Add missing” to create entries for absent types.
          </div>
          {tzError && (
            <div className="error-line" role="alert" style={{ marginBottom: 6 }}>{tzError}</div>
          )}
          <div className="grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(140px, 1fr) 180px 1fr', gap: 8, alignItems: 'center' }}>
            <div className="muted" style={{ fontSize: 12 }}>Trader zone</div>
            <div className="muted" style={{ fontSize: 12 }}>Stock</div>
            <div className="muted" style={{ fontSize: 12 }}>Actions</div>
            {traderZones.map(zone => {
              const info = tzAggregate[zone] || { present: 0, missing: selectedTypes.length, value: undefined };
              const mixed = info.value === null;
              const nonePresent = info.present === 0 && info.missing > 0;
              const someMissing = info.present > 0 && info.missing > 0;
              return (
                <React.Fragment key={zone}>
                  <div className="muted">{zone}</div>
                  <label className={`control ${mixed ? 'mixed' : ''}`} style={{ margin: 0 }}>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      placeholder={mixed ? 'Mixed' : ''}
                      value={tzForm[zone] ?? ''}
                      onChange={e => {
                        const v = e.target.value;
                        // Allow empty string for no change; else keep only digits
                        if (v === '') setTzForm(f => ({ ...f, [zone]: '' }));
                        else if (/^\d+$/.test(v)) setTzForm(f => ({ ...f, [zone]: v }));
                      }}
                    />
                    <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                      {info.present} present, {info.missing} missing
                    </div>
                  </label>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    {nonePresent && (
                      <button type="button" className={`btn ${tzAddMissing[zone] ? 'primary' : ''}`}
                              onClick={() => setTzAddMissing(m => ({ ...m, [zone]: !m[zone] }))}
                              title="Add selected item(s) to this zone when applying">
                        {tzAddMissing[zone] ? 'Will add' : 'Add'}
                      </button>
                    )}
                    {someMissing && (
                      <button type="button" className={`btn ${tzAddMissing[zone] ? 'primary' : ''}`}
                              onClick={() => setTzAddMissing(m => ({ ...m, [zone]: !m[zone] }))}
                              title="Add missing selected item(s) to this zone when applying">
                        {tzAddMissing[zone] ? 'Will add missing' : 'Add missing'}
                      </button>
                    )}
                  </div>
                </React.Fragment>
              );
            })}
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            {tzLoading ? 'Loading trader zones…' : null}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
            <button type="button" className="btn" onClick={onApplyTraderZones} disabled={tzSaving || tzLoading}>Apply stock</button>
          </div>
        </fieldset>
      </div>
      </div>

      {Object.keys(errors).length > 0 && (
        <div className="errors">
          {Object.entries(errors).map(([k, msg]) => (
            <div key={k} className="error-line">{msg}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function labelFor(k) {
  switch (k) {
    case 'nominal': return 'Nominal';
    case 'min': return 'Min';
    case 'lifetime': return 'Lifetime';
    case 'restock': return 'Restock';
    case 'quantmin': return 'Quant Min';
    case 'quantmax': return 'Quant Max';
    default: return k;
  }
}

function allSameField(arr) {
  return arr.every(v => v === arr[0]) ? arr[0] : null;
}

function makeTriState(allOptions, arrays) {
  /** @type {Record<string, boolean|'mixed'>} */
  const m = {};
  allOptions.forEach(opt => {
    const presentCount = arrays.reduce((acc, a) => acc + (a.includes(opt) ? 1 : 0), 0);
    m[opt] = presentCount === 0 ? false : presentCount === arrays.length ? true : 'mixed';
  });
  return m;
}

function renderTriStateGroup(group, form, options, cycleTri) {
  return (
    <fieldset className={`control panels-item ${group}-panel`}>
      <legend>{group[0].toUpperCase() + group.slice(1)}</legend>
      <div className="checkbox-grid">
        {options.map(opt => {
          const state = form[group][opt];
          const indeterminate = state === 'mixed';
          return (
            <label key={opt} className={`checkbox ${indeterminate ? 'indeterminate' : state ? 'checked' : ''}`}>
              <input
                type="checkbox"
                checked={state === true}
                ref={el => { if (el) el.indeterminate = indeterminate; }}
                onChange={() => cycleTri(group, opt)}
              />
              <span>{opt}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/**
 * Apply local form edits to a Type, respecting mixed states for multi-selection.
 * @param {Type} t
 * @param {any} form
 * @param {{usageflags: string[], valueflags: string[], tags: string[]}} defs
 * @returns {Type}
 */
function applyToType(t, form, defs) {
  const next = { ...t };
  const edited = { ...(t._edited || {}) };

  // Category
  if (form.category !== null && form.category !== undefined && form.category !== '') {
    if (form.category !== t.category) edited.category = true;
    next.category = form.category;
  }

  // Numeric
  ['nominal', 'min', 'lifetime', 'restock', 'quantmin', 'quantmax'].forEach(k => {
    if (form[k] !== null && form[k] !== '') {
      const nv = Number(form[k]);
      if (nv !== t[k]) edited[k] = true;
      next[k] = nv;
    }
  });

  // Flags
  const mergedFlags = { ...t.flags, ...form.flags };
  const flagsChanged = Object.keys(mergedFlags).some(k => mergedFlags[k] !== t.flags[k]);
  if (flagsChanged) edited.flags = true;
  next.flags = mergedFlags;

  // Arrays: apply tri-state
  const applyTri = (groupKey, allowed) => {
    const tri = form[groupKey];
    let set = new Set(t[groupKey]);
    Object.entries(tri).forEach(([name, state]) => {
      if (state === true) set.add(name);
      else if (state === false) set.delete(name);
      // mixed => leave as is
    });
    // Filter to allowed space
    set = new Set(Array.from(set).filter(x => allowed.includes(x)));
    const arr = Array.from(set).sort();
    // Mark edited if the array actually changed
    if (JSON.stringify(arr) !== JSON.stringify(t[groupKey])) edited[groupKey] = true;
    next[groupKey] = arr;
  };
  applyTri('usage', defs.usageflags);
  applyTri('value', defs.valueflags);
  applyTri('tag', defs.tags);

  next._edited = edited;
  return next;
}


/**
 * Split seconds into units for the lifetime picker.
 * @param {number} secs
 * @returns {{weeks:number,days:number,hours:number,minutes:number,seconds:number}}
 */
function splitSecondsToUnits(secs) {
  let total = Math.max(0, Math.floor(secs));
  const WEEK = 7 * 24 * 60 * 60;
  const DAY = 24 * 60 * 60;
  const HOUR = 60 * 60;

  const weeks = Math.floor(total / WEEK);
  total %= WEEK;
  const days = Math.floor(total / DAY);
  total %= DAY;
  const hours = Math.floor(total / HOUR);
  total %= HOUR;
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return { weeks, days, hours, minutes, seconds };
}

/**
 * Convert unit parts to seconds for the lifetime picker.
 * @param {{weeks:number,days:number,hours:number,minutes:number,seconds:number}} u
 * @returns {number}
 */
function unitsToSeconds(u) {
  return (
    (u.weeks || 0) * 7 * 24 * 60 * 60 +
    (u.days || 0) * 24 * 60 * 60 +
    (u.hours || 0) * 60 * 60 +
    (u.minutes || 0) * 60 +
    (u.seconds || 0)
  );
}


// -------------------- PillArrayEditor --------------------
/**
 * Lightweight pill/chip multi-select editor with optional Mixed behavior.
 * - value: null => Mixed/indeterminate; string[] => explicit values
 * - allowEditWhenMixed: when true and value is null, clicking the field activates an add-only mode
 * - options: available canonical options; duplicates filtered; case-insensitive matching
 * - disabled: render read-only (no add/remove)
 * - allowClear: show a Clear action to set []
 */
function PillArrayEditor({ value, onChange, options, allowEditWhenMixed = false, disabled = false, allowClear = false }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const [activated, setActivated] = useState(false); // used when value === null and allowEditWhenMixed
  const [hoverIndex, setHoverIndex] = useState(-1);

  // Close on outside click
  useEffect(() => {
    const onDown = (e) => {
      const r = rootRef.current;
      if (!r) return;
      if (r.contains(e.target)) return;
      setOpen(false);
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
    const set = new Set(current.map(x => String(x)));
    set.add(String(canonical));
    const arr = Array.from(set);
    onChange(arr);
    setOpen(false);
    setQuery('');
    setHoverIndex(-1);
  };

  const onRemove = (name) => {
    const next = current.filter(x => String(x).toLowerCase() !== String(name).toLowerCase());
    onChange(next);
  };

  const onKeyDown = (e) => {
    if (!open) return;
    if (e.key === 'Escape') { setOpen(false); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setHoverIndex(i => Math.min(i + 1, filteredOptions.length - 1)); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setHoverIndex(i => Math.max(i - 1, 0)); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      const choice = filteredOptions[Math.max(0, hoverIndex)] || filteredOptions[0];
      if (choice) onAdd(choice);
      return;
    }
  };

  // Mixed read-only state
  if (isMixed && !allowEditWhenMixed) {
    return (
      <div ref={rootRef} className="input" style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 30, border: '1px solid var(--border)', borderRadius: 4, padding: '4px 6px', background: 'transparent', opacity: disabled ? 0.6 : 1 }}>
        <span className="muted" style={{ fontSize: 12 }}>Mixed</span>
      </div>
    );
  }

  // When Mixed and allowEditWhenMixed, require user activation (focus/click) to show Add-only
  const showAddOnly = isMixed && allowEditWhenMixed && !activated;

  return (
    <div ref={rootRef} className={`pill-array ${disabled ? 'disabled' : ''}`} style={{ position: 'relative' }}>
      <div
        className={`pill-input ${isMixed ? 'mixed' : ''}`}
        style={{ display: 'flex', flexWrap: 'wrap', gap: 6, minHeight: 30, border: '1px solid var(--border)', borderRadius: 4, padding: '4px 6px', background: 'transparent', cursor: canInteract ? 'text' : 'default' }}
        onMouseDown={() => {
          if (disabled) return;
          if (showAddOnly) {
            setActivated(true);
            // After activation, show Add and open immediately
            setTimeout(openDialog, 0);
          } else if (canInteract) {
            openDialog();
          }
        }}
        role="group"
        aria-label="Pill editor"
      >
        {/* Chips when we have explicit values */}
        {Array.isArray(value) && value.map(v => (
          <span key={v} className="chip" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '2px 8px', borderRadius: 999, border: '1px solid var(--border)', background: 'var(--chip-bg, rgba(128,128,128,.12))' }}>
            <span>{v}</span>
            {!disabled && (
              <button type="button" className="link" aria-label={`Remove ${v}`} 
                onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); onRemove(v); }} 
                style={{ lineHeight: 1 }}>
                ×
              </button>
            )}
          </span>
        ))}

        {/* Add pill */}
        {canInteract && (
          <button
            type="button"
            className="btn"
            onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); openDialog(); }}
            style={{ padding: '2px 10px', borderRadius: 999, background: 'var(--chip-add-bg, rgba(0,128,255,.12))', border: '1px solid var(--border)', fontSize: 12 }}
            aria-haspopup="dialog"
            aria-expanded={open}
          >
            add
          </button>
        )}

        {/* Clear action */}
        {allowClear && Array.isArray(value) && !disabled && (
          <button
            type="button"
            className="btn"
            onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onChange([]); }}
            title="Clear all"
            style={{ padding: '2px 10px', borderRadius: 999, background: 'var(--chip-clear-bg, rgba(255,0,0,.08))', border: '1px solid var(--border)', fontSize: 12 }}
          >
            clear
          </button>
        )}

        {/* Mixed hint when awaiting activation */}
        {showAddOnly && (
          <span className="muted" style={{ fontSize: 12 }}>Mixed — click to add</span>
        )}
      </div>

      {open && canInteract && (
        <div
          className="popover"
          role="dialog"
          aria-label="Choose value"
          onKeyDown={onKeyDown}
          style={{ position: 'absolute', top: '100%', left: 0, marginTop: 6, zIndex: 5, background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8, padding: 8, boxShadow: '0 4px 18px rgba(0,0,0,.2)', minWidth: 260 }}
        >
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setHoverIndex(0); }}
            placeholder="Search..."
            style={{ width: '100%', marginBottom: 6 }}
          />
          <div role="listbox" style={{ maxHeight: 220, overflow: 'auto', borderTop: '1px solid var(--border)', paddingTop: 6 }}>
            {filteredOptions.length === 0 && (
              <div className="muted" style={{ fontSize: 12 }}>No matches</div>
            )}
            {filteredOptions.map((opt, i) => (
              <div
                key={opt}
                role="option"
                aria-selected={i === hoverIndex}
                onMouseEnter={() => setHoverIndex(i)}
                onMouseDown={(e) => { e.preventDefault(); /* keep focus */ }}
                onClick={(e) => { e.preventDefault(); onAdd(opt); }}
                style={{ padding: '4px 6px', background: i === hoverIndex ? 'var(--row-hover, rgba(128,128,128,.1))' : 'transparent', borderRadius: 4, cursor: 'pointer' }}
              >
                {opt}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}