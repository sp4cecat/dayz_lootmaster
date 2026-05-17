import React from 'react';
import { ROOT_SPAWNABLE_GROUP, findSpawnableEntryForType } from '../utils/xml.js';
import { Slider } from '@/components/base/slider/slider';
import { Badge } from './base/badges/badges';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { Plus, Trash2, Settings2, Sparkles, Percent, AlertCircle, X, ChevronRight } from 'lucide-react';

function chancePercent(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(Math.min(1, Math.max(0, n)) * 1000) / 10 : 0;
}

function fromPercent(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n / 100)) : 0;
}

export default function EditFormSpawnableTab({ selectedTypes, spawnableTypesByGroup, setSpawnableTypesByGroup, randomPresets, globalsDefaults }) {
  const presetNames = (randomPresets?.presets || []).map(p => p.name).filter(Boolean).sort((a, b) => a.localeCompare(b));
  const [bulkChance, setBulkChance] = React.useState('');
  const [bulkPreset, setBulkPreset] = React.useState('');
  
  const selectedByGroup = selectedTypes.reduce((acc, type) => {
    const group = type.group || 'vanilla';
    if (!acc[group]) acc[group] = [];
    acc[group].push(type);
    return acc;
  }, {});

  const updateEntry = (group, typeName, apply) => {
    setSpawnableTypesByGroup(prev => {
      const source = findSpawnableEntryForType(prev, group, typeName);
      const targetGroup = source?.group || group;
      const groupData = prev?.[targetGroup] || { types: [] };
      const types = [...(groupData.types || [])];
      const idx = types.findIndex(t => String(t.name || '').toLowerCase() === String(typeName || '').toLowerCase());
      if (idx < 0) {
        types.push(apply({ name: typeName, sections: [] }));
      } else {
        types[idx] = apply(types[idx]);
      }
      return { ...(prev || {}), [targetGroup]: { ...groupData, types } };
    });
  };

  const updateSelectedSections = (apply) => {
    setSpawnableTypesByGroup(prev => {
      const next = { ...(prev || {}) };
      for (const [group, types] of Object.entries(selectedByGroup)) {
        for (const type of types) {
          const source = findSpawnableEntryForType(next, group, type.name);
          if (!source?.entry) continue;
          const groupData = next[source.group];
          next[source.group] = {
            ...groupData,
            types: (groupData?.types || []).map(entry => String(entry.name || '').toLowerCase() === String(type.name || '').toLowerCase()
              ? { ...entry, sections: (entry.sections || []).map(apply) }
              : entry)
          };
        }
      }
      return next;
    });
  };

  const updateSelectedItemChances = (chance) => {
    updateSelectedSections(section => ({
      ...section,
      items: (section.items || []).map(item => item.chance == null ? item : { ...item, chance, attrs: { ...(item.attrs || {}), chance: String(chance) } })
    }));
  };

  const updateSelectedBlockChances = (chance) => {
    updateSelectedSections(section => section.chance == null ? section : { ...section, chance, attrs: { ...(section.attrs || {}), chance: String(chance) } });
  };

  const updateSelectedPresets = (preset) => {
    updateSelectedSections(section => ({ ...section, preset, attrs: { ...(section.attrs || {}), preset } }));
  };

  const updateSection = (group, typeName, sectionIndex, apply) => {
    updateEntry(group, typeName, entry => ({
      ...entry,
      sections: (entry.sections || []).map((section, i) => i === sectionIndex ? apply(section) : section)
    }));
  };

  const updateItem = (group, typeName, sectionIndex, itemIndex, apply) => {
    updateSection(group, typeName, sectionIndex, section => ({
      ...section,
      items: (section.items || []).map((item, i) => i === itemIndex ? apply(item) : item)
    }));
  };

  const addSection = (group, typeName, kind) => {
    updateEntry(group, typeName, entry => ({
      ...entry,
      sections: [
        ...(entry.sections || []),
        {
          kind,
          chance: kind === 'damage' ? null : 1.0,
          preset: '',
          attrs: kind === 'damage' ? {
            min: String(globalsDefaults?.LootDamageMin ?? 0),
            max: String(globalsDefaults?.LootDamageMax ?? 1)
          } : { chance: '1.000' },
          items: []
        }
      ]
    }));
  };

  const removeSection = (group, typeName, sectionIndex) => {
    updateEntry(group, typeName, entry => ({
      ...entry,
      sections: (entry.sections || []).filter((_, i) => i !== sectionIndex)
    }));
  };

  const addItem = (group, typeName, sectionIndex) => {
    updateSection(group, typeName, sectionIndex, section => ({
      ...section,
      items: [
        ...(section.items || []),
        { kind: 'item', name: 'NewItem', chance: 1.0, preset: '', attrs: { name: 'NewItem', chance: '1.000' } }
      ]
    }));
  };

  const removeItem = (group, typeName, sectionIndex, itemIndex) => {
    updateSection(group, typeName, sectionIndex, section => ({
      ...section,
      items: (section.items || []).filter((_, i) => i !== itemIndex)
    }));
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      <div className="p-4 bg-primary-50 rounded-xl border border-primary-100 flex items-start gap-3 dark:bg-primary-900/10 dark:border-primary-900/20">
        <Sparkles size={18} className="text-primary-600 dark:text-primary-400 mt-0.5 shrink-0" />
        <p className="text-sm text-primary-700 dark:text-primary-300 leading-relaxed">
          Configure <strong>cfgspawnabletypes.xml</strong> entries. Adjust attachments, cargo, and damage ranges for selected types.
        </p>
      </div>

      {selectedTypes.length > 1 && (
        <div className="p-6 bg-white rounded-xl border border-gray-200 shadow-sm dark:bg-gray-800/50 dark:border-gray-700 space-y-4">
          <div className="flex items-center gap-2">
            <Settings2 size={18} className="text-gray-400" />
            <h4 className="font-bold text-gray-900 dark:text-white">Bulk Spawnable Edits</h4>
          </div>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-xs font-bold text-gray-500 uppercase tracking-wider dark:text-gray-400 flex items-center gap-1.5">
                <Percent size={12} /> Chance %
              </label>
              <div className="flex gap-2">
                <Input 
                  type="number" 
                  min="0" max="100" step="0.1" 
                  value={bulkChance} 
                  onChange={e => setBulkChance(e.target.value)} 
                  placeholder="0-100" 
                  className="h-10"
                />
                <Button variant="secondary-gray" size="sm" disabled={!bulkChance} onClick={() => updateSelectedBlockChances(fromPercent(bulkChance))}>
                  Blocks
                </Button>
                <Button variant="secondary-gray" size="sm" disabled={!bulkChance} onClick={() => updateSelectedItemChances(fromPercent(bulkChance))}>
                  Items
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold text-gray-500 uppercase tracking-wider dark:text-gray-400 flex items-center gap-1.5">
                Preset
              </label>
              <div className="flex gap-2">
                <select 
                  className="flex-1 h-10 px-3 py-2 text-sm bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-4 focus:ring-primary-100 transition-all dark:bg-gray-950 dark:border-gray-700 dark:text-white"
                  value={bulkPreset} 
                  onChange={e => setBulkPreset(e.target.value)}
                >
                  <option value="">Choose preset...</option>
                  {presetNames.map(name => <option key={name} value={name}>{name}</option>)}
                </select>
                <Button variant="secondary-gray" size="sm" disabled={!bulkPreset} onClick={() => updateSelectedPresets(bulkPreset)}>
                  Apply
                </Button>
                <Button variant="tertiary" size="sm" onClick={() => updateSelectedPresets('')} title="Clear presets">
                  <X size={16} />
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-6">
        {Object.entries(selectedByGroup).map(([group, types]) => (
          <div key={group} className="space-y-4">
            <div className="flex items-center gap-2">
              <Badge color="gray" size="md" type="modern">{group}</Badge>
              <div className="h-px flex-1 bg-gray-100 dark:bg-gray-800" />
            </div>

            <div className="grid grid-cols-1 gap-4">
              {types.map(type => {
                const found = findSpawnableEntryForType(spawnableTypesByGroup, group, type.name);
                const entry = found?.entry;
                const sourceGroup = found?.group;

                if (!entry) {
                  const defaultMin = globalsDefaults?.LootDamageMin ?? 0;
                  const defaultMax = globalsDefaults?.LootDamageMax ?? 1;
                  return (
                    <div key={type.name} className="p-4 bg-gray-50 rounded-xl border border-gray-200 dark:bg-gray-950/20 dark:border-gray-800">
                      <div className="flex items-center justify-between mb-4">
                        <span className="font-bold text-gray-900 dark:text-white">{type.name}</span>
                        <Badge color="gray" size="sm">No entry</Badge>
                      </div>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-xs font-semibold text-gray-500 uppercase tracking-wider dark:text-gray-400">
                          <span>Default Damage Range</span>
                          <span>{chancePercent(defaultMin)}% — {chancePercent(defaultMax)}%</span>
                        </div>
                        <Slider
                          value={[chancePercent(defaultMin), chancePercent(defaultMax)]}
                          onChange={(vals) => {
                            const newMin = fromPercent(vals[0]);
                            const newMax = fromPercent(vals[1]);
                            if (newMin !== defaultMin || newMax !== defaultMax) {
                              updateEntry(group, type.name, e => ({
                                ...e,
                                sections: [{
                                  kind: 'damage',
                                  chance: null,
                                  preset: '',
                                  attrs: { min: String(newMin), max: String(newMax) },
                                  items: []
                                }]
                              }));
                            }
                          }}
                          step={0.1}
                        />
                      </div>
                    </div>
                  );
                }

                return (
                  <div key={type.name} className="p-5 bg-white rounded-xl border border-gray-200 shadow-sm dark:bg-gray-800/50 dark:border-gray-700 space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-gray-900 dark:text-white">{type.name}</span>
                        {sourceGroup === ROOT_SPAWNABLE_GROUP && (
                          <Badge color="brand" size="sm">Mission Root</Badge>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <Button variant="tertiary" size="sm" onClick={() => addSection(group, type.name, 'attachments')} icon={Plus}>Attachment</Button>
                        <Button variant="tertiary" size="sm" onClick={() => addSection(group, type.name, 'cargo')} icon={Plus}>Cargo</Button>
                      </div>
                    </div>

                    <div className="space-y-3">
                      {(entry.sections || []).map((section, sectionIndex) => (
                        <div key={`${section.kind}-${sectionIndex}`} className="p-4 bg-gray-50 rounded-lg border border-gray-100 dark:bg-gray-900 dark:border-gray-800 space-y-4">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <Badge color={section.kind === 'damage' ? 'error' : 'brand'} size="sm" className="capitalize">{section.kind}</Badge>
                              {section.kind !== 'damage' && (
                                <select 
                                  className="h-8 px-2 text-xs bg-white border border-gray-300 rounded focus:ring-2 focus:ring-primary-100 dark:bg-gray-950 dark:border-gray-700 dark:text-white"
                                  value={section.preset || ''} 
                                  onChange={e => updateSection(group, type.name, sectionIndex, s => ({ ...s, preset: e.target.value, attrs: { ...(s.attrs || {}), preset: e.target.value } }))}
                                >
                                  <option value="">No preset</option>
                                  {presetNames.map(name => <option key={name} value={name}>{name}</option>)}
                                </select>
                              )}
                            </div>
                            <Button variant="tertiary" size="sm" className="text-error-600 h-8 w-8 p-0" onClick={() => removeSection(group, type.name, sectionIndex)}>
                              <Trash2 size={14} />
                            </Button>
                          </div>

                          {section.kind === 'damage' && (
                            <div className="space-y-2">
                              <div className="flex items-center justify-between text-xs font-semibold text-gray-500 dark:text-gray-400">
                                <span>Damage Range</span>
                                <span className="font-mono">{chancePercent(section.attrs?.min)}% — {chancePercent(section.attrs?.max)}%</span>
                              </div>
                              <Slider
                                value={[chancePercent(section.attrs?.min), chancePercent(section.attrs?.max)]}
                                onChange={(vals) => updateSection(group, type.name, sectionIndex, s => ({
                                  ...s,
                                  attrs: { ...s.attrs, min: String(fromPercent(vals[0])), max: String(fromPercent(vals[1])) }
                                }))}
                                step={0.1}
                              />
                            </div>
                          )}

                          {section.chance != null && section.kind !== 'damage' && (
                            <div className="space-y-2">
                              <div className="flex items-center justify-between text-xs font-semibold text-gray-500 dark:text-gray-400">
                                <span>Block Chance</span>
                                <span className="font-mono">{chancePercent(section.chance)}%</span>
                              </div>
                              <Slider
                                value={chancePercent(section.chance)}
                                onChange={(val) => updateSection(group, type.name, sectionIndex, s => ({
                                  ...s,
                                  chance: fromPercent(val),
                                  attrs: { ...s.attrs, chance: String(fromPercent(val)) }
                                }))}
                                step={0.1}
                              />
                            </div>
                          )}

                          {(section.items || []).map((item, itemIndex) => (
                            <div key={`${item.name}-${itemIndex}`} className="pl-4 border-l-2 border-gray-200 dark:border-gray-800 space-y-2">
                              <div className="flex items-center justify-between">
                                <input
                                  className="text-sm font-bold text-gray-700 bg-transparent border-none focus:ring-0 p-0 dark:text-gray-300"
                                  type="text"
                                  value={item.name}
                                  onChange={e => updateItem(group, type.name, sectionIndex, itemIndex, it => ({ ...it, name: e.target.value, attrs: { ...it.attrs, name: e.target.value } }))}
                                />
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-mono text-gray-500">{chancePercent(item.chance)}%</span>
                                  <button className="text-gray-400 hover:text-error-600" onClick={() => removeItem(group, type.name, sectionIndex, itemIndex)}>
                                    <X size={14} />
                                  </button>
                                </div>
                              </div>
                              <Slider
                                value={chancePercent(item.chance)}
                                onChange={(val) => updateItem(group, type.name, sectionIndex, itemIndex, it => ({
                                  ...it,
                                  chance: fromPercent(val),
                                  attrs: { ...it.attrs, chance: String(fromPercent(val)) }
                                }))}
                                step={0.1}
                              />
                            </div>
                          ))}

                          {section.kind !== 'damage' && !section.preset && (
                            <Button variant="tertiary" size="sm" onClick={() => addItem(group, type.name, sectionIndex)} icon={Plus}>Add Item</Button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}