import React, { useEffect, useMemo, useRef, useState } from 'react';
import { validateTypeAgainstDefinitions } from '../utils/validation.js';

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
  const single = selectedTypes.length === 1;
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
            <label key={k} className={`control ${form[k] === null ? 'mixed' : ''}`}>
              <span>{labelFor(k)}</span>
              <input
                type="number"
                placeholder={form[k] === null ? 'Mixed' : ''}
                value={form[k] === null ? '' : form[k]}
                onChange={e => setNum(k, e.target.value)}
              />
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

  // Category
  if (form.category !== null && form.category !== undefined && form.category !== '') {
    next.category = form.category;
  }

  // Numeric
  ['nominal', 'min', 'lifetime', 'restock', 'quantmin', 'quantmax'].forEach(k => {
    if (form[k] !== null && form[k] !== '') next[k] = Number(form[k]);
  });

  // Flags
  next.flags = { ...t.flags, ...form.flags };

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
    next[groupKey] = Array.from(set).sort();
  };
  applyTri('usage', defs.usageflags);
  applyTri('value', defs.valueflags);
  applyTri('tag', defs.tags);

  return next;
}
