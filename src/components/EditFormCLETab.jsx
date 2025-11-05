import React, { useEffect, useMemo, useRef, useState } from 'react';
import { validateTypeAgainstDefinitions } from '../utils/validation.js';
import { formatLifetime } from '../utils/time.js';

/**
 * @typedef {import('../utils/xml.js').Type} Type
 */

/**
 * CLE (types/XML) editing tab. Owns all CLE state and persistence; shares only selectedTypes with other tabs.
 * @param {{
 *  definitions: {categories: string[], usageflags: string[], valueflags: string[], tags: string[]},
 *  selectedTypes: Type[],
 *  onSave: (apply: (t: Type) => Type) => void,
 * }} props
 */
export default function EditFormCLETab({ definitions, selectedTypes, onSave }) {
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

  return (
    <div className="cle-tab">
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

      <div className="panels-wrap" style={{display: "flex", flexDirection: "column", flexWrap: "wrap", gap: 10, marginTop: 10, flexGrow: 0}}>
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

      <div style={{ display: 'flex', flexDirection: "column", marginTop: 10 }}>
        <button className="btn primary" onClick={onSaveClick} disabled={!canSave}>Save</button>
      </div>

      {Object.keys(errors).length > 0 && (
        <div className="errors" style={{ marginTop: 8 }}>
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

function unitsToSeconds(u) {
  return (
    (u.weeks || 0) * 7 * 24 * 60 * 60 +
    (u.days || 0) * 24 * 60 * 60 +
    (u.hours || 0) * 60 * 60 +
    (u.minutes || 0) * 60 +
    (u.seconds || 0)
  );
}
