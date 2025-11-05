import React, { useEffect, useMemo, useRef, useState } from 'react';

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
 * }} props
 */
export default function EditFormMarketplaceTab({ selectedTypes, typeOptions = [], typeOptionsByCategory = {}, activated = false }) {
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

  // Load market categories and their JSON files after first activation and when selection changes
  useEffect(() => {
    if (!activated) return;
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
  }, [activated, selectedTypes.map(t => t.name).join('|')]);

  // Load trader zones and their JSON files
  useEffect(() => {
    if (!activated) return;
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
  }, [activated, selectedTypes.map(t => t.name).join('|')]);

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
    <div className="marketplace-tab" style={{ display: 'flex', gap: '10px' }}>
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

            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', width: '100%', marginTop: '10px', flexWrap: 'wrap' }}>
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

  if (isMixed && !allowEditWhenMixed) {
    return (
      <div ref={rootRef} className="input" style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 30, border: '1px solid var(--border)', borderRadius: 4, padding: '4px 6px', background: 'transparent', opacity: disabled ? 0.6 : 1 }}>
        <span className="muted" style={{ fontSize: 12 }}>Mixed</span>
      </div>
    );
  }

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
            setTimeout(openDialog, 0);
          } else if (canInteract) {
            openDialog();
          }
        }}
        role="group"
        aria-label="Pill editor"
      >
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
                onMouseDown={(e) => { e.preventDefault(); }}
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
