import React, { useEffect, useMemo, useRef, useState } from 'react';
import { validateTypeAgainstDefinitions } from '../utils/validation.js';
import { formatLifetime } from '../utils/time.js';
import { listMarketFiles, getMarketFile, saveMarketFile, listTraderZoneFiles, getTraderZoneFile, saveTraderZoneFile } from '../utils/expansionApi.js';

/**
 * @typedef {import('../utils/xml.js').Type} Type
 */

/**
 * @param {{
 *  definitions: {categories: string[], usageflags: string[], valueflags: string[], tags: string[]},
 *  selectedTypes: Type[],
 *  onCancel: () => void,
 *  onSave: (apply: (t: Type) => Type) => void
 * }} props
 */
export default function EditForm({ definitions, selectedTypes, onCancel, onSave }) {
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

  // --- Expansion integration state & data ---
  const [expMarketFiles, setExpMarketFiles] = useState(/** @type {string[]} */([]));
  const [expZoneFiles, setExpZoneFiles] = useState(/** @type {string[]} */([]));
  const [expSelCategory, setExpSelCategory] = useState('');
  const [expPickedZones, setExpPickedZones] = useState(/** @type {Set<string>} */(new Set()));
  const [expZoneQty, setExpZoneQty] = useState(1);
  const [expBusy, setExpBusy] = useState(false);
  const [expStatus, setExpStatus] = useState('');
  const [expError, setExpError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setExpError('');
        const [cats, zones] = await Promise.all([
          listMarketFiles().catch(() => []),
          listTraderZoneFiles().catch(() => []),
        ]);
        if (cancelled) return;
        setExpMarketFiles(Array.isArray(cats) ? cats : []);
        setExpZoneFiles(Array.isArray(zones) ? zones : []);
        if (!expSelCategory && cats && cats.length) setExpSelCategory(cats[0]);
      } catch (e) {
        if (!cancelled) setExpError(String(e));
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleZonePick = (name) => {
    setExpPickedZones(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  async function addSelectedTypesToCategory() {
    if (!expSelCategory) { setExpError('Pick a market category file first.'); return; }
    setExpBusy(true); setExpError(''); setExpStatus('');
    try {
      const json = await getMarketFile(expSelCategory);
      const items = Array.isArray(json?.Items) ? [...json.Items] : [];
      const have = new Set(items.map(it => String(it?.ClassName || '')));
      let added = 0;
      for (const t of selectedTypes) {
        if (!have.has(t.name)) {
          items.push({
            ClassName: t.name,
            MaxPriceThreshold: 0,
            MinPriceThreshold: 0,
            SellPricePercent: -1.0,
            MaxStockThreshold: 0,
            MinStockThreshold: 0,
            QuantityPercent: -1,
            SpawnAttachments: [],
            Variants: []
          });
          added++;
        }
      }
      await saveMarketFile(expSelCategory, { ...(json || {}), Items: items });
      setExpStatus(added ? `Added ${added} item(s) to ${expSelCategory}.` : 'Nothing to add. All present.');
    } catch (e) {
      setExpError(String(e));
    } finally {
      setExpBusy(false);
    }
  }

  async function removeSelectedTypesFromCategory() {
    if (!expSelCategory) { setExpError('Pick a market category file first.'); return; }
    setExpBusy(true); setExpError(''); setExpStatus('');
    try {
      const json = await getMarketFile(expSelCategory);
      const before = Array.isArray(json?.Items) ? json.Items : [];
      const names = new Set(selectedTypes.map(t => t.name));
      const after = before.filter(it => !names.has(String(it?.ClassName || '')));
      const removed = before.length - after.length;
      await saveMarketFile(expSelCategory, { ...(json || {}), Items: after });
      setExpStatus(removed ? `Removed ${removed} item(s) from ${expSelCategory}.` : 'Nothing to remove.');
    } catch (e) {
      setExpError(String(e));
    } finally {
      setExpBusy(false);
    }
  }

  async function zonesAdd() {
    if (expPickedZones.size === 0) { setExpError('Pick one or more Trader Zones.'); return; }
    setExpBusy(true); setExpError(''); setExpStatus('');
    try {
      let totalChanged = 0; let filesTouched = 0;
      for (const z of expPickedZones) {
        const json = await getTraderZoneFile(z);
        const stock = json && typeof json.Stock === 'object' && json.Stock !== null ? { ...json.Stock } : {};
        let changed = 0;
        for (const t of selectedTypes) {
          if (!(t.name in stock)) { stock[t.name] = Number(expZoneQty) || 1; changed++; }
        }
        if (changed) {
          await saveTraderZoneFile(z, { ...(json || {}), Stock: stock });
          filesTouched++; totalChanged += changed;
        }
      }
      setExpStatus(filesTouched ? `Added ${totalChanged} entr${totalChanged===1?'y':'ies'} across ${filesTouched} zone file(s).` : 'Nothing to add.');
    } catch (e) {
      setExpError(String(e));
    } finally { setExpBusy(false); }
  }

  async function zonesSet() {
    if (expPickedZones.size === 0) { setExpError('Pick one or more Trader Zones.'); return; }
    setExpBusy(true); setExpError(''); setExpStatus('');
    try {
      let totalSet = 0; let filesTouched = 0;
      for (const z of expPickedZones) {
        const json = await getTraderZoneFile(z);
        const stock = json && typeof json.Stock === 'object' && json.Stock !== null ? { ...json.Stock } : {};
        for (const t of selectedTypes) {
          stock[t.name] = Number(expZoneQty) || 1;
          totalSet++;
        }
        await saveTraderZoneFile(z, { ...(json || {}), Stock: stock });
        filesTouched++;
      }
      setExpStatus(`Set quantity for ${totalSet} entr${totalSet===1?'y':'ies'} across ${filesTouched} zone file(s).`);
    } catch (e) { setExpError(String(e)); } finally { setExpBusy(false); }
  }

  async function zonesRemove() {
    if (expPickedZones.size === 0) { setExpError('Pick one or more Trader Zones.'); return; }
    setExpBusy(true); setExpError(''); setExpStatus('');
    try {
      let totalRemoved = 0; let filesTouched = 0;
      for (const z of expPickedZones) {
        const json = await getTraderZoneFile(z);
        const stock = json && typeof json.Stock === 'object' && json.Stock !== null ? { ...json.Stock } : {};
        let removedHere = 0;
        for (const t of selectedTypes) {
          if (t.name in stock) { delete stock[t.name]; removedHere++; }
        }
        if (removedHere) {
          await saveTraderZoneFile(z, { ...(json || {}), Stock: stock });
          filesTouched++; totalRemoved += removedHere;
        }
      }
      setExpStatus(filesTouched ? `Removed ${totalRemoved} entr${totalRemoved===1?'y':'ies'} across ${filesTouched} zone file(s).` : 'Nothing to remove.');
    } catch (e) { setExpError(String(e)); } finally { setExpBusy(false); }
  }

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
      </div>

      {/* Expansion integration */}
      <div className="card" style={{ marginTop: 12, padding: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <h4 style={{ margin: 0 }}>Expansion</h4>
          <span className="muted">Quickly manage Expansion Market and Trader Zone stock for the selected type(s).</span>
          <div className="spacer" />
          {expStatus && <span className="chip" title="Status">{expStatus}</span>}
          {expError && <span className="chip warn" title="Error">{expError}</span>}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 10 }}>
          {/* Market Category block */}
          <div className="control" style={{ borderRight: '1px solid var(--border)', paddingRight: 12 }}>
            <label style={{ display: 'block' }}>
              <span>Market category file</span>
              <select
                value={expSelCategory}
                onChange={e => setExpSelCategory(e.target.value)}
              >
                {expMarketFiles.length === 0 && <option value="">— No market files found —</option>}
                {expMarketFiles.map(f => (
                  <option key={f} value={f}>{f}.json</option>
                ))}
              </select>
            </label>
            <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
              <button
                className="btn"
                onClick={addSelectedTypesToCategory}
                disabled={expBusy || !expSelCategory}
                aria-label="Add selected types to market category"
                title="Add selected types to market category"
              >
                Add to category
              </button>
              <button
                className="btn"
                onClick={removeSelectedTypesFromCategory}
                disabled={expBusy || !expSelCategory}
                aria-label="Remove selected types from market category"
                title="Remove selected types from market category"
              >
                Remove from category
              </button>
            </div>
            <div className="muted" style={{ marginTop: 6 }}>
              Types: {selectedTypes.map(t => t.name).join(', ')}
            </div>
          </div>

          {/* Trader Zones block */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <h5 style={{ margin: 0 }}>Trader Zones</h5>
              <div className="spacer" />
              <label className="control" style={{ margin: 0, minWidth: 160 }}>
                <span>Quantity</span>
                <input
                  type="number"
                  value={expZoneQty}
                  onChange={e => setExpZoneQty(Number(e.target.value))}
                  title="Quantity to set when adding/setting stock"
                  aria-label="Stock quantity"
                  min={0}
                />
              </label>
            </div>
            <div className="list" style={{ maxHeight: 160, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 6, marginTop: 6 }}>
              {expZoneFiles.length === 0 && <div className="muted" style={{ padding: 8 }}>No trader zone files found.</div>}
              {expZoneFiles.map(z => (
                <label key={z} className="list-row" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px' }}>
                  <input type="checkbox" checked={expPickedZones.has(z)} onChange={() => toggleZonePick(z)} /> {z}.json
                </label>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button
                className="btn"
                onClick={zonesAdd}
                disabled={expBusy || expPickedZones.size === 0}
                aria-label="Add selected types to zone stock if missing"
                title="Add selected types to zone stock if missing"
              >
                Add if missing
              </button>
              <button
                className="btn"
                onClick={zonesSet}
                disabled={expBusy || expPickedZones.size === 0}
                aria-label="Set quantity for selected types in zones"
                title="Set quantity for selected types in zones"
              >
                Set quantity
              </button>
              <button
                className="btn"
                onClick={zonesRemove}
                disabled={expBusy || expPickedZones.size === 0}
                aria-label="Remove selected types from zones"
                title="Remove selected types from zones"
              >
                Remove
              </button>
            </div>
          </div>
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
