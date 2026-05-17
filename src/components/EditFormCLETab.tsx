import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { validateTypeAgainstDefinitions } from '@/utils/validation';
import { formatLifetime } from '@/utils/time';
import { Badge } from '@/components/base/badges/badges';
import { Input } from '@/components/base/input/input';
import { Button } from '@/components/base/button/button';
import { Clock, Info, AlertCircle, AlertTriangle } from 'lucide-react';
import { Checkbox } from '@/components/base/checkbox/checkbox';
import { cx } from '@/utils/cx';
import type { Type } from '@/utils/xml';

interface EditFormCLETabProps {
  definitions: {
    categories: string[];
    usageflags: string[];
    valueflags: string[];
    tags: string[];
  };
  selectedTypes: Type[];
  onSave: (apply: (t: Type) => Type) => void;
  onCanSaveChange?: (can: boolean) => void;
  registerSaveHandler?: (fn: null | (() => void)) => void;
  selectedProfileId: string;
  selectedProfile?: { id: string; addons?: string[] };
  getApiBase: () => string;
}

export default function EditFormCLETab({ 
  definitions, 
  selectedTypes, 
  onSave, 
  onCanSaveChange, 
  registerSaveHandler, 
  selectedProfileId, 
  selectedProfile, 
  getApiBase 
}: EditFormCLETabProps) {
  const base = selectedTypes[0];

  // Initialize local form state with mixed awareness
  const initial = useMemo(() => {
    const nums = ['nominal', 'min', 'lifetime', 'restock', 'quantmin', 'quantmax'] as const;
    const obj: any = {};
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

  const [errors, setErrors] = useState<Record<string, string>>({});

  // Deerisle Diving Loot Addon support
  const [divingConfig, setDivingConfig] = useState<any>(null);
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
  const lifetimeRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close the popover on outside click
  useEffect(() => {
    if (!showLifetimePicker) return;
    const onDown = (e: MouseEvent) => {
      const pop = popoverRef.current;
      const trigger = lifetimeRef.current;
      if (pop && pop.contains(e.target as Node)) return;
      if (trigger && trigger.contains(e.target as Node)) return;
      setShowLifetimePicker(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [showLifetimePicker]);

  const setNum = (key: string, strVal: string) => {
    const v = strVal === '' ? '' : Number(strVal);
    setForm((f: any) => ({ ...f, [key]: v }));
  };

  const toggleFlag = (key: string) => {
    setForm((f: any) => ({ ...f, flags: { ...f.flags, [key]: !f.flags[key] } }));
  };

  const cycleTri = (group: string, key: string) => {
    setForm((f: any) => {
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
    return issues.length === 0;
  }, [form, selectedTypes, definitions]);

  useEffect(() => {
    onCanSaveChange?.(canSave);
  }, [canSave, onCanSaveChange]);

  const handleSave = useCallback(() => {
    if (!canSave) return;
    onSave((t: Type) => applyToType(t, form, definitions));
    
    // Also save diving config if present and dirty
    if (divingConfigDirty && divingConfig) {
      saveDivingConfig();
    }
  }, [canSave, onSave, form, definitions, divingConfig, divingConfigDirty]);

  useEffect(() => {
    registerSaveHandler?.(handleSave);
  }, [handleSave, registerSaveHandler]);

  // Deerisle Diving Loot Logic
  useEffect(() => {
    const isDeerisle = selectedProfile?.addons?.includes('deerisle') || selectedProfileId.toLowerCase().includes('deerisle');
    setHasDivingConfig(isDeerisle);

    if (isDeerisle) {
      loadDivingConfig();
    }
  }, [selectedProfileId, selectedProfile]);

  const loadDivingConfig = async () => {
    try {
      const res = await fetch(`${getApiBase()}/api/deerisle/diving-loot`, {
        headers: { 'X-Profile-ID': selectedProfileId }
      });
      if (res.ok) {
        const data = await res.json();
        setDivingConfig(data);
      }
    } catch (e) {
      console.error('Failed to load diving config', e);
    }
  };

  const saveDivingConfig = async () => {
    try {
      await fetch(`${getApiBase()}/api/deerisle/diving-loot`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-Profile-ID': selectedProfileId 
        },
        body: JSON.stringify(divingConfig)
      });
      setDivingConfigDirty(false);
    } catch (e) {
      console.error('Failed to save diving config', e);
    }
  };

  const toggleDiving = (name: string) => {
    if (!divingConfig) return;
    const items = [...(divingConfig.Items || [])];
    const idx = items.indexOf(name);
    if (idx >= 0) items.splice(idx, 1);
    else items.push(name);

    setDivingConfig({ ...divingConfig, Items: items });
    setDivingConfigDirty(true);
  };

  const allSelectedInDiving = selectedTypes.every(t => divingConfig?.Items?.includes(t.name));
  const someSelectedInDiving = selectedTypes.some(t => divingConfig?.Items?.includes(t.name));

  const applyLifetime = () => {
    const total = (lp.weeks * 604800) + (lp.days * 86400) + (lp.hours * 3600) + (lp.minutes * 60) + lp.seconds;
    setForm((f: any) => ({ ...f, lifetime: total }));
    setShowLifetimePicker(false);
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-500">
      {/* Basics Section */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <Badge color="brand" size="sm" type="modern">Basic Properties</Badge>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Input 
            label="Nominal" 
            type="number" 
            value={form.nominal ?? ''} 
            placeholder={form.nominal === null ? 'Mixed' : '0'}
            onChange={e => setNum('nominal', e.target.value)} 
          />
          <Input 
            label="Min" 
            type="number" 
            value={form.min ?? ''} 
            placeholder={form.min === null ? 'Mixed' : '0'}
            onChange={e => setNum('min', e.target.value)} 
          />
          
          <div className="relative" ref={lifetimeRef}>
            <Input 
              label="Lifetime" 
              type="text" 
              readOnly
              value={form.lifetime === null ? 'Mixed' : formatLifetime(form.lifetime)} 
              onClick={() => setShowLifetimePicker(!showLifetimePicker)}
              icon={Clock}
              className="cursor-pointer"
            />
            
            {showLifetimePicker && (
              <div ref={popoverRef} className="absolute z-50 top-full mt-2 left-0 w-72 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl shadow-xl p-4 animate-in zoom-in-95 duration-200">
                <div className="flex items-center justify-between mb-4">
                  <h4 className="font-bold text-sm text-gray-900 dark:text-white">Lifetime Picker</h4>
                  <button onClick={() => setShowLifetimePicker(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                    <Info size={16} />
                  </button>
                </div>
                
                <div className="grid grid-cols-3 gap-3 mb-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-gray-500 uppercase">Weeks</label>
                    <input 
                      type="number" 
                      value={lp.weeks} 
                      onChange={e => setLp({...lp, weeks: Math.max(0, parseInt(e.target.value)||0)})}
                      className="w-full bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-md p-1.5 text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-gray-500 uppercase">Days</label>
                    <input 
                      type="number" 
                      value={lp.days} 
                      onChange={e => setLp({...lp, days: Math.max(0, parseInt(e.target.value)||0)})}
                      className="w-full bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-md p-1.5 text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-gray-500 uppercase">Hours</label>
                    <input 
                      type="number" 
                      value={lp.hours} 
                      onChange={e => setLp({...lp, hours: Math.max(0, parseInt(e.target.value)||0)})}
                      className="w-full bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-md p-1.5 text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-gray-500 uppercase">Mins</label>
                    <input 
                      type="number" 
                      value={lp.minutes} 
                      onChange={e => setLp({...lp, minutes: Math.max(0, parseInt(e.target.value)||0)})}
                      className="w-full bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-md p-1.5 text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-gray-500 uppercase">Secs</label>
                    <input 
                      type="number" 
                      value={lp.seconds} 
                      onChange={e => setLp({...lp, seconds: Math.max(0, parseInt(e.target.value)||0)})}
                      className="w-full bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-md p-1.5 text-sm"
                    />
                  </div>
                </div>
                
                <div className="flex gap-2">
                  <Button size="sm" className="flex-1" onClick={applyLifetime}>Apply</Button>
                  <Button size="sm" variant="secondary-gray" onClick={() => setShowLifetimePicker(false)}>Cancel</Button>
                </div>
              </div>
            )}
          </div>

          <Input 
            label="Restock" 
            type="number" 
            value={form.restock ?? ''} 
            placeholder={form.restock === null ? 'Mixed' : '0'}
            onChange={e => setNum('restock', e.target.value)} 
          />
          
          <Input 
            label="Quant Min (%)" 
            type="number" 
            value={form.quantmin ?? ''} 
            placeholder={form.quantmin === null ? 'Mixed' : '-1'}
            onChange={e => setNum('quantmin', e.target.value)} 
          />
          <Input 
            label="Quant Max (%)" 
            type="number" 
            value={form.quantmax ?? ''} 
            placeholder={form.quantmax === null ? 'Mixed' : '-1'}
            onChange={e => setNum('quantmax', e.target.value)} 
          />

          <div className="col-span-2">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Category</label>
            <select 
              value={form.category} 
              onChange={e => setForm((f: any) => ({ ...f, category: e.target.value }))}
              className="w-full h-10 px-3 py-1 bg-white border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-4 focus:ring-primary-100 focus:border-primary-300 transition-all dark:bg-gray-950 dark:border-gray-700 dark:text-white dark:focus:ring-primary-900/30 dark:focus:border-primary-500"
            >
              <option value="">(None)</option>
              {definitions.categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
      </section>

      {/* Flags Section */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <Badge color="brand" size="sm" type="modern">Economic Flags</Badge>
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 bg-gray-50 dark:bg-gray-950/20 p-4 rounded-xl border border-gray-100 dark:border-gray-800">
          {Object.keys(form.flags).map(flag => (
            <Checkbox
              key={flag}
              label={flag.replace('count_in_', '').replace('_', ' ')}
              checked={form.flags[flag]}
              onChange={() => toggleFlag(flag)}
            />
          ))}
        </div>
      </section>

      {/* Attributes Section */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <TriStatePanel 
          title="Usage" 
          group="usage" 
          options={definitions.usageflags} 
          state={form.usage} 
          onToggle={key => cycleTri('usage', key)} 
        />
        <TriStatePanel 
          title="Value" 
          group="value" 
          options={definitions.valueflags} 
          state={form.value} 
          onToggle={key => cycleTri('value', key)} 
        />
        <TriStatePanel 
          title="Tags" 
          group="tag" 
          options={definitions.tags} 
          state={form.tag} 
          onToggle={key => cycleTri('tag', key)} 
        />
      </section>

      {/* Deerisle Specifics */}
      {hasDivingConfig && (
        <section className="p-4 bg-primary-50 dark:bg-primary-900/10 rounded-xl border border-primary-100 dark:border-primary-900/20">
          <div className="flex items-center gap-2 mb-4">
            <Badge color="brand" size="sm" type="modern">Deerisle Diving Loot</Badge>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="size-10 bg-white dark:bg-gray-900 rounded-lg flex items-center justify-center text-primary-600 shadow-sm border border-primary-100 dark:border-primary-900/30">
                <AlertCircle size={20} />
              </div>
              <div>
                <p className="text-sm font-bold text-gray-900 dark:text-white">Diving Config</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">Include items in the deep-sea diving loot pool.</p>
              </div>
            </div>
            <Checkbox 
              label={allSelectedInDiving ? "Included" : someSelectedInDiving ? "Mixed" : "Excluded"}
              checked={allSelectedInDiving}
              indeterminate={!allSelectedInDiving && someSelectedInDiving}
              onChange={() => {
                const next = !allSelectedInDiving;
                selectedTypes.forEach(t => {
                  const currentlyIn = divingConfig?.Items?.includes(t.name);
                  if (next && !currentlyIn) toggleDiving(t.name);
                  else if (!next && currentlyIn) toggleDiving(t.name);
                });
              }}
            />
          </div>
        </section>
      )}
    </div>
  );
}

function TriStatePanel({ title, options, state, onToggle }: { title: string, options: string[], state: any, onToggle: (k: string) => void }) {
  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl shadow-sm overflow-hidden">
      <div className="px-4 py-3 bg-gray-50 dark:bg-gray-950/20 border-b border-gray-200 dark:border-gray-800">
        <h4 className="text-sm font-bold text-gray-900 dark:text-white">{title}</h4>
      </div>
      <div className="p-4 space-y-2 flex-1 overflow-y-auto max-h-64 scrollbar-thin">
        {options.map(opt => {
          const val = state[opt];
          return (
            <div 
              key={opt}
              onClick={() => onToggle(opt)}
              className={cx(
                "flex items-center justify-between p-2 rounded-lg cursor-pointer transition-all border",
                val === true 
                  ? "bg-primary-50 border-primary-200 text-primary-700 dark:bg-primary-900/20 dark:border-primary-800 dark:text-primary-300"
                  : val === 'mixed'
                    ? "bg-gray-50 border-gray-200 text-gray-600 italic dark:bg-gray-800 dark:border-gray-700 dark:text-gray-400"
                    : "bg-white border-transparent text-gray-500 hover:bg-gray-50 dark:bg-gray-900 dark:hover:bg-gray-800"
              )}
            >
              <span className="text-xs font-medium">{opt}</span>
              {val === true && <div className="size-1.5 rounded-full bg-primary-600 dark:bg-primary-400" />}
              {val === 'mixed' && <AlertTriangle size={12} className="text-warning-500" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function allSameField(arr: (string|undefined|null)[]) {
  if (arr.length === 0) return '';
  const first = arr[0];
  return arr.every(x => x === first) ? (first || '') : '';
}

function makeTriState(options: string[], selectedArrays: (string[]|undefined)[]) {
  const obj: any = {};
  options.forEach(opt => {
    const presentCount = selectedArrays.filter(arr => (arr || []).includes(opt)).length;
    if (presentCount === 0) obj[opt] = false;
    else if (presentCount === selectedArrays.length) obj[opt] = true;
    else obj[opt] = 'mixed';
  });
  return obj;
}

function applyToType(t: Type, form: any, definitions: any): Type {
  const next = { ...t };
  const nums = ['nominal', 'min', 'lifetime', 'restock', 'quantmin', 'quantmax'] as const;
  nums.forEach(k => {
    if (form[k] !== null && form[k] !== '') {
      next[k] = form[k];
    }
  });

  if (form.category !== null) next.category = form.category;
  
  next.flags = { ...next.flags, ...form.flags };

  // Helper to apply tri-state back to array
  const applyTri = (group: string, currentArr: string[] | undefined) => {
    let arr = [...(currentArr || [])];
    Object.keys(form[group]).forEach(key => {
      const val = form[group][key];
      if (val === true && !arr.includes(key)) arr.push(key);
      else if (val === false && arr.includes(key)) arr = arr.filter(x => x !== key);
    });
    return arr;
  };

  next.usage = applyTri('usage', t.usage);
  next.value = applyTri('value', t.value);
  next.tag = applyTri('tag', t.tag);

  return next;
}

function splitSecondsToUnits(total: number) {
  let s = total;
  const weeks = Math.floor(s / 604800);
  s %= 604800;
  const days = Math.floor(s / 86400);
  s %= 86400;
  const hours = Math.floor(s / 3600);
  s %= 3600;
  const minutes = Math.floor(s / 60);
  const seconds = s % 60;
  return { weeks, days, hours, minutes, seconds };
}
