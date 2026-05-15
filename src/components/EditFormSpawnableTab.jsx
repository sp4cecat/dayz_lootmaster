import React from 'react';
import { ROOT_SPAWNABLE_GROUP, findSpawnableEntryForType } from '../utils/xml.js';

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
    <div className="spawnable-tab">
      <p className="muted">Edit `cfgspawnabletypes.xml` entries. You can adjust chances, presets, and damage ranges, or add/remove sections and items.</p>
      {selectedTypes.length > 1 && (
        <section className="card subtle">
          <h4>Bulk spawnable edits</h4>
          <p className="muted">Applies only to existing spawnable entries for the selected types. Missing entries still use the clickable default sliders below.</p>
          <div className="row wrap">
            <label>Chance % <input type="number" min="0" max="100" step="0.1" value={bulkChance} onChange={e => setBulkChance(e.target.value)} placeholder="0-100" /></label>
            <button className="btn" disabled={bulkChance === ''} onClick={() => updateSelectedBlockChances(fromPercent(bulkChance))}>Apply to block chances</button>
            <button className="btn" disabled={bulkChance === ''} onClick={() => updateSelectedItemChances(fromPercent(bulkChance))}>Apply to item chances</button>
            <select value={bulkPreset} onChange={e => setBulkPreset(e.target.value)}>
              <option value="">Choose preset…</option>
              {presetNames.map(name => <option key={name} value={name}>{name}</option>)}
            </select>
            <button className="btn" disabled={!bulkPreset} onClick={() => updateSelectedPresets(bulkPreset)}>Apply preset to sections</button>
            <button className="btn" onClick={() => updateSelectedPresets('')}>Clear section presets</button>
          </div>
        </section>
      )}
      {Object.entries(selectedByGroup).map(([group, types]) => {
        return (
          <section key={group} className="card">
            <h4>{group}</h4>
            {types.map(type => {
              const found = findSpawnableEntryForType(spawnableTypesByGroup, group, type.name);
              const entry = found?.entry;
              const sourceGroup = found?.group;
              if (!entry) {
                return (
                  <div key={type.name} className="card subtle" onClick={() => addSection(group, type.name, 'damage')} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') addSection(group, type.name, 'damage'); }} role="button" tabIndex={0}>
                    <strong>{type.name}</strong>
                    <div className="muted">No explicit spawnable entry. Default loot damage range from globals.xml is shown. Click to create an explicit entry.</div>
                    <label className="slider-row disabled">
                      Loot damage min {chancePercent(globalsDefaults?.LootDamageMin)}%
                      <input type="range" min="0" max="100" step="0.1" value={chancePercent(globalsDefaults?.LootDamageMin)} readOnly />
                    </label>
                    <label className="slider-row disabled">
                      Loot damage max {chancePercent(globalsDefaults?.LootDamageMax)}%
                      <input type="range" min="0" max="100" step="0.1" value={chancePercent(globalsDefaults?.LootDamageMax)} readOnly />
                    </label>
                  </div>
                );
              }
              return (
                <div key={type.name} className="card subtle">
                  <strong>{type.name}</strong>
                  {sourceGroup === ROOT_SPAWNABLE_GROUP && <div className="muted">Using mission-root cfgspawnabletypes.xml entry.</div>}
                  {(entry.sections || []).map((section, sectionIndex) => (
                    <div key={`${section.kind}-${sectionIndex}`} className="stack small card subtle" style={{ border: '1px dashed var(--border)' }}>
                      <div className="row wrap space-between">
                        <div className="row wrap">
                          <span className="badge">{section.kind}</span>
                          {section.kind !== 'damage' && (
                            <select value={section.preset || ''} onChange={e => updateSection(group, type.name, sectionIndex, s => ({ ...s, preset: e.target.value, attrs: { ...(s.attrs || {}), preset: e.target.value } }))}>
                              <option value="">No preset</option>
                              {presetNames.map(name => <option key={name} value={name}>{name}</option>)}
                            </select>
                          )}
                        </div>
                        <button className="btn btn-danger btn-small" title="Remove section" onClick={() => removeSection(group, type.name, sectionIndex)}>×</button>
                      </div>

                      {section.kind === 'damage' && (
                        <>
                          <label className="slider-row">
                            Min damage {chancePercent(section.attrs?.min)}%
                            <input type="range" min="0" max="100" step="0.1" value={chancePercent(section.attrs?.min)} onChange={e => updateSection(group, type.name, sectionIndex, s => ({ ...s, attrs: { ...(s.attrs || {}), min: String(fromPercent(e.target.value)) } }))}/>
                            <input type="number" min="0" max="100" step="0.1" value={chancePercent(section.attrs?.min)} onChange={e => updateSection(group, type.name, sectionIndex, s => ({ ...s, attrs: { ...(s.attrs || {}), min: String(fromPercent(e.target.value)) } }))}/>
                          </label>
                          <label className="slider-row">
                            Max damage {chancePercent(section.attrs?.max)}%
                            <input type="range" min="0" max="100" step="0.1" value={chancePercent(section.attrs?.max)} onChange={e => updateSection(group, type.name, sectionIndex, s => ({ ...s, attrs: { ...(s.attrs || {}), max: String(fromPercent(e.target.value)) } }))}/>
                            <input type="number" min="0" max="100" step="0.1" value={chancePercent(section.attrs?.max)} onChange={e => updateSection(group, type.name, sectionIndex, s => ({ ...s, attrs: { ...(s.attrs || {}), max: String(fromPercent(e.target.value)) } }))}/>
                          </label>
                        </>
                      )}

                      {section.chance != null && section.kind !== 'damage' && (
                        <label className="slider-row">
                          Block chance {chancePercent(section.chance)}%
                          <input type="range" min="0" max="100" step="0.1" value={chancePercent(section.chance)} onChange={e => updateSection(group, type.name, sectionIndex, s => ({ ...s, chance: fromPercent(e.target.value), attrs: { ...(s.attrs || {}), chance: String(fromPercent(e.target.value)) } }))}/>
                          <input type="number" min="0" max="100" step="0.1" value={chancePercent(section.chance)} onChange={e => updateSection(group, type.name, sectionIndex, s => ({ ...s, chance: fromPercent(e.target.value), attrs: { ...(s.attrs || {}), chance: String(fromPercent(e.target.value)) } }))}/>
                        </label>
                      )}

                      {(section.items || []).map((item, itemIndex) => (
                        <div key={`${item.name}-${itemIndex}`} className="row wrap">
                          <label className="slider-row grow">
                            <input className="grow" type="text" value={item.name} onChange={e => updateItem(group, type.name, sectionIndex, itemIndex, it => ({ ...it, name: e.target.value, attrs: { ...(it.attrs || {}), name: e.target.value } }))} placeholder="Item name" />
                            {chancePercent(item.chance)}%
                            <input type="range" min="0" max="100" step="0.1" value={chancePercent(item.chance)} onChange={e => updateItem(group, type.name, sectionIndex, itemIndex, it => ({ ...it, chance: fromPercent(e.target.value), attrs: { ...(it.attrs || {}), chance: String(fromPercent(e.target.value)) } }))}/>
                          </label>
                          <button className="btn btn-danger btn-small" title="Remove item" onClick={() => removeItem(group, type.name, sectionIndex, itemIndex)}>×</button>
                        </div>
                      ))}

                      {section.kind !== 'damage' && !section.preset && (
                        <button className="btn btn-small" onClick={() => addItem(group, type.name, sectionIndex)}>+ Add item</button>
                      )}
                    </div>
                  ))}
                  <div className="row wrap">
                    <button className="btn btn-small" onClick={() => addSection(group, type.name, 'damage')}>+ Add damage</button>
                    <button className="btn btn-small" onClick={() => addSection(group, type.name, 'attachments')}>+ Add attachments</button>
                    <button className="btn btn-small" onClick={() => addSection(group, type.name, 'cargo')}>+ Add cargo</button>
                  </div>
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}