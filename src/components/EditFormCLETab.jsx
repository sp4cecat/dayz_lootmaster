import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { validateTypeAgainstDefinitions } from '../utils/validation.js';
import { formatLifetime } from '../utils/time.js';
import { Badge } from './base/badges/badges';
import { Input } from './ui/Input';
import { Button } from './ui/Button';
import { Clock, Info, AlertCircle, AlertTriangle } from 'lucide-react';
import { Checkbox } from './base/checkbox/checkbox';
import { cx } from '../utils/cx';

/**
 * @typedef {import('../utils/xml.js').Type} Type
 */

/**
 * CLE (types/XML) editing tab. Owns all CLE state and persistence; shares only selectedTypes with other tabs.
 * @param {{
 *  definitions: {categories: string[], usageflags: string[], valueflags: string[], tags: string[]},
 *  selectedTypes: Type[],
 *  onSave: (apply: (t: Type) => Type) => void,
 *  onCanSaveChange?: (can: boolean) => void,
 *  registerSaveHandler?: (fn: null | (() => void)) => void,
 *  selectedProfileId: string,
 *  selectedProfile?: {id: string, addons?: string[]},
 *  getApiBase: () => string
 * }} props
 */
export default function EditFormCLETab({ definitions, selectedTypes, onSave, onCanSaveChange, registerSaveHandler, selectedProfileId, selectedProfile, getApiBase }) {
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

  // Deerisle Diving Loot Addon support
  const [divingConfig, setDivingConfig] = useState(null);
  const [divingConfigDirty, setDivingConfigDirty] = useState(false);
  const [hasDivingConfig, setHasDivingConfig] = useState(false);

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
      const next = cur !== true;
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

  const onSaveClick = useCallback(async () => {
    if (hasDivingConfig && divingConfigDirty && divingConfig) {
      try {
        const API_BASE = getApiBase();
        const res = await fetch(`${API_BASE}/api/addons/deerisle/file/DivingLootConfig`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'X-Profile-ID': selectedProfileId
          },
          body: JSON.stringify(divingConfig)
        });
        if (!res.ok) throw new Error('Failed to save DivingLootConfig');
      } catch (e) {
        console.error(e);
        alert('Failed to save Deerisle Diving Loot configuration.');
      }
    }
    const apply = (t) => applyToType(t, form, definitions);
    onSave(apply);
  }, [form, definitions, onSave, divingConfig, divingConfigDirty, hasDivingConfig, getApiBase, selectedProfileId]);

  // Notify parent of canSave changes so it can enable/disable header Save button
  useEffect(() => {
    if (onCanSaveChange) onCanSaveChange(!!canSave);
  }, [canSave, onCanSaveChange]);

  // Provide parent with a save handler it can invoke from the header button
  useEffect(() => {
    if (registerSaveHandler) registerSaveHandler(onSaveClick);
    return () => { if (registerSaveHandler) registerSaveHandler(null); };
  }, [registerSaveHandler, onSaveClick]);

  useEffect(() => {
    if (!selectedProfile?.addons?.includes('deerisle')) {
        setHasDivingConfig(false);
        return;
    }
    (async () => {
        try {
            const API_BASE = getApiBase();
            // Check if DivingLootConfig.json exists by fetching it
            const res = await fetch(`${API_BASE}/api/addons/deerisle/file/DivingLootConfig`, {
                headers: { 'X-Profile-ID': selectedProfileId }
            });
            if (res.ok) {
                const json = await res.json();
                setDivingConfig(json);
                setHasDivingConfig(true);
            } else {
                setHasDivingConfig(false);
            }
        } catch (e) {
            console.error('Error fetching DivingLootConfig:', e);
            setHasDivingConfig(false);
        }
    })();
  }, [selectedProfileId, selectedProfile, getApiBase]);

  const divingCounts = useMemo(() => {
    if (!divingConfig) return { normal: 0, elite: 0 };
    const getCount = (listName) => {
      const list = divingConfig[listName] || [];
      const counts = selectedTypes.map(t => list.filter(n => n === t.name).length);
      const first = counts[0];
      const allSame = counts.every(c => c === first);
      return allSame ? first : null;
    };
    return {
      normal: getCount('divingLootListNormal'),
      elite: getCount('divingLootListElite')
    };
  }, [divingConfig, selectedTypes]);

  const setDivingCount = (listName, val) => {
      const num = val === '' ? 0 : Math.max(0, parseInt(val, 10) || 0);
      setDivingConfig(prev => {
          if (!prev) return prev;
          let newList = [...(prev[listName] || [])];
          selectedTypes.forEach(t => {
              // Remove all existing occurrences of this type
              newList = newList.filter(n => n !== t.name);
              // Add it num times
              for (let i = 0; i < num; i++) {
                  newList.push(t.name);
              }
          });
          setDivingConfigDirty(true);
          return { ...prev, [listName]: newList };
      });
  };

  return (
    <div className="space-y-8">
      {/* Basic Properties */}
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1.5">Category</label>
          <select
            className="w-full h-10 px-3 py-2 text-sm bg-white border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-4 focus:ring-primary-100 focus:border-primary-300 transition-all dark:bg-gray-950 dark:border-gray-700 dark:text-white"
            value={form.category === null ? '' : form.category}
            onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
          >
            <option value="">{form.category === null ? 'Mixed' : '—'}</option>
            {definitions.categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        {['nominal', 'min', 'lifetime', 'restock', 'quantmin', 'quantmax'].map(k => (
          <div key={k} className="relative" ref={k === 'lifetime' ? lifetimeRef : null}>
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-1.5 mb-1.5">
              {labelFor(k)}
              {k === 'lifetime' && (
                <button
                  type="button"
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowLifetimePicker(true); }}
                  className="text-gray-400 hover:text-primary-600 transition-colors"
                  title="Open lifetime picker"
                >
                  <Clock size={14} />
                </button>
              )}
            </label>
            <Input
              type="number"
              placeholder={form[k] === null ? 'Mixed' : ''}
              value={form[k] === null ? '' : form[k]}
              onChange={e => setNum(k, e.target.value)}
              error={errors[k]}
              className={cx(form[k] === null && "placeholder:text-primary-600 placeholder:font-bold")}
            />

            {k === 'lifetime' && showLifetimePicker && (
              <div
                className="absolute top-full left-0 mt-2 z-50 bg-white border border-gray-200 rounded-xl shadow-xl p-4 w-72 animate-in zoom-in-95 duration-200 dark:bg-gray-900 dark:border-gray-800"
                role="dialog"
                ref={popoverRef}
              >
                <div className="flex items-center gap-2 mb-4">
                  <div className="size-8 bg-primary-100 rounded-lg flex items-center justify-center text-primary-600 dark:bg-primary-900/30 dark:text-primary-400">
                    <Clock size={18} />
                  </div>
                  <h4 className="font-bold text-gray-900 dark:text-white">Lifetime Picker</h4>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {[
                    { key: 'weeks', label: 'Weeks' },
                    { key: 'days', label: 'Days' },
                    { key: 'hours', label: 'Hours' },
                    { key: 'minutes', label: 'Minutes' },
                    { key: 'seconds', label: 'Seconds' },
                  ].map(f => (
                    <div key={f.key}>
                      <label className="text-xs font-semibold text-gray-500 uppercase mb-1 block dark:text-gray-400">{f.label}</label>
                      <Input
                        type="number"
                        min={0}
                        value={lp[f.key]}
                        onChange={e => setLp(prev => ({ ...prev, [f.key]: Math.max(0, Number(e.target.value || 0)) }))}
                        className="h-9 px-2"
                      />
                    </div>
                  ))}
                </div>

                <div className="flex gap-2 mt-6">
                  <Button
                    variant="primary"
                    size="sm"
                    className="flex-1"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const total = unitsToSeconds(lp);
                      setNum('lifetime', String(total));
                      setShowLifetimePicker(false);
                    }}
                  >
                    Apply
                  </Button>
                  <Button
                    variant="secondary-gray"
                    size="sm"
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowLifetimePicker(false); }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {k === 'lifetime' && form[k] !== null && form[k] !== '' && Number.isFinite(Number(form[k])) && (
              <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                ≈ {formatLifetime(Number(form[k]))}
              </p>
            )}
          </div>
        ))}
      </div>

      {/* Property Groups */}
      <div className="space-y-8">
        {renderTriStateGroup('usage', form, definitions.usageflags, cycleTri)}
        {renderTriStateGroup('value', form, definitions.valueflags, cycleTri)}
        {renderTriStateGroup('tag', form, definitions.tags, cycleTri)}

        <div className="space-y-3">
          <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider dark:text-gray-400">
            Flags
          </h4>
          <div className="grid grid-cols-2 gap-3 p-4 bg-gray-50 rounded-xl border border-gray-100 dark:bg-gray-950/20 dark:border-gray-800">
            {Object.keys(form.flags).sort().map(key => (
              <Checkbox 
                key={key}
                label={key.replace(/_/g, ' ')}
                isSelected={form.flags[key]}
                onChange={() => toggleFlag(key)}
                size="sm"
              />
            ))}
          </div>
        </div>

        {hasDivingConfig && (
          <div className="space-y-3">
            <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider dark:text-gray-400">
              Deerisle Diving Loot
            </h4>
            <div className="p-4 bg-gray-50 rounded-xl border border-gray-100 space-y-4 dark:bg-gray-950/20 dark:border-gray-800">
              {['divingLootListNormal', 'divingLootListElite'].map(listName => {
                const label = listName === 'divingLootListNormal' ? 'Normal Diving Loot' : 'Elite Diving Loot';
                const typeKey = listName === 'divingLootListNormal' ? 'normal' : 'elite';
                const count = divingCounts[typeKey];
                return (
                  <div key={listName}>
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1.5">{label}</label>
                    <Input
                      type="number"
                      min="0"
                      value={count === null ? '' : count}
                      placeholder={count === null ? 'Mixed' : ''}
                      onChange={e => setDivingCount(listName, e.target.value)}
                      hint="Number of times in list"
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {Object.keys(errors).length > 0 && (
        <div className="p-4 bg-error-50 rounded-xl border border-error-100 space-y-2 dark:bg-error-900/10 dark:border-error-900/20">
          <div className="flex items-center gap-2 text-error-700 dark:text-error-400 mb-1">
            <AlertCircle size={18} />
            <span className="font-bold">Validation Issues</span>
          </div>
          {Object.entries(errors).map(([k, msg]) => (
            <div key={k} className="text-sm text-error-600 dark:text-error-400 flex items-start gap-2">
              <span className="mt-1 size-1 bg-error-400 rounded-full shrink-0" />
              {msg}
            </div>
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
    <div className="space-y-3">
      <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider dark:text-gray-400">
        {group[0].toUpperCase() + group.slice(1)}
      </h4>
      <div className="grid grid-cols-2 gap-3 p-4 bg-gray-50 rounded-xl border border-gray-100 dark:bg-gray-950/20 dark:border-gray-800">
        {options.map(opt => {
          const state = form[group][opt];
          const isSelected = state === true;
          const isIndeterminate = state === 'mixed';
          
          return (
            <Checkbox 
              key={opt}
              label={opt}
              isSelected={isSelected}
              isIndeterminate={isIndeterminate}
              onChange={() => cycleTri(group, opt)}
              size="sm"
            />
          );
        })}
      </div>
    </div>
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
