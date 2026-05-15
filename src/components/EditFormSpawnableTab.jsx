import React from 'react';

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
      const groupData = prev?.[group] || { types: [] };
      const types = [...(groupData.types || [])];
      const idx = types.findIndex(t => t.name === typeName);
      if (idx < 0) {
        types.push(apply({ name: typeName, sections: [] }));
      } else {
        types[idx] = apply(types[idx]);
      }
      return { ...(prev || {}), [group]: { ...groupData, types } };
    });
  };

  const createDamageEntry = (group, typeName) => {
    updateEntry(group, typeName, entry => ({
      ...entry,
      sections: [
        ...(entry.sections || []),
        {
          kind: 'damage',
          chance: null,
          preset: '',
          attrs: {
            min: String(globalsDefaults?.LootDamageMin ?? 0),
            max: String(globalsDefaults?.LootDamageMax ?? 1)
          },
          items: []
        }
      ]
    }));
  };

  const updateSelectedSections = (apply) => {
    setSpawnableTypesByGroup(prev => {
      const next = { ...(prev || {}) };
      for (const [group, types] of Object.entries(selectedByGroup)) {
        const selectedNames = new Set(types.map(type => type.name));
        const groupData = next[group];
        if (!groupData) continue;
        next[group] = {
          ...groupData,
          types: (groupData.types || []).map(entry => selectedNames.has(entry.name)
            ? { ...entry, sections: (entry.sections || []).map(apply) }
            : entry)
        };
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

  return (
    <div className="stack">
      <p className="muted">Edit existing `cfgspawnabletypes.xml` chance and preset attributes. Structural block creation is limited to creating a default damage entry for types with no spawnable entry.</p>
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
        const groupData = spawnableTypesByGroup?.[group] || { types: [] };
        const byName = new Map((groupData.types || []).map(entry => [entry.name, entry]));
        return (
          <section key={group} className="card">
            <h4>{group}</h4>
            {types.map(type => {
              const entry = byName.get(type.name);
              if (!entry) {
                return (
                  <div key={type.name} className="card subtle" onClick={() => createDamageEntry(group, type.name)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') createDamageEntry(group, type.name); }} role="button" tabIndex={0}>
                    <strong>{type.name}</strong>
                    <div className="muted">No explicit spawnable entry. Click the disabled default range to create one.</div>
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
                  {(entry.sections || []).map((section, sectionIndex) => (
                    <div key={`${section.kind}-${sectionIndex}`} className="stack small">
                      <div className="row wrap">
                        <span className="badge">{section.kind}</span>
                        <select value={section.preset || ''} onChange={e => updateSection(group, type.name, sectionIndex, s => ({ ...s, preset: e.target.value, attrs: { ...(s.attrs || {}), preset: e.target.value } }))}>
                          <option value="">No preset</option>
                          {presetNames.map(name => <option key={name} value={name}>{name}</option>)}
                        </select>
                      </div>
                      {section.chance != null && (
                        <label className="slider-row">
                          Block chance {chancePercent(section.chance)}%
                          <input type="range" min="0" max="100" step="0.1" value={chancePercent(section.chance)} onChange={e => updateSection(group, type.name, sectionIndex, s => ({ ...s, chance: fromPercent(e.target.value), attrs: { ...(s.attrs || {}), chance: String(fromPercent(e.target.value)) } }))}/>
                          <input type="number" min="0" max="100" step="0.1" value={chancePercent(section.chance)} onChange={e => updateSection(group, type.name, sectionIndex, s => ({ ...s, chance: fromPercent(e.target.value), attrs: { ...(s.attrs || {}), chance: String(fromPercent(e.target.value)) } }))}/>
                        </label>
                      )}
                      {(section.items || []).map((item, itemIndex) => (
                        <label key={`${item.name}-${itemIndex}`} className="slider-row">
                          {item.name || item.kind} {chancePercent(item.chance)}%
                          <input type="range" min="0" max="100" step="0.1" value={chancePercent(item.chance)} onChange={e => updateItem(group, type.name, sectionIndex, itemIndex, it => ({ ...it, chance: fromPercent(e.target.value), attrs: { ...(it.attrs || {}), chance: String(fromPercent(e.target.value)) } }))}/>
                          <input type="number" min="0" max="100" step="0.1" value={chancePercent(item.chance)} onChange={e => updateItem(group, type.name, sectionIndex, itemIndex, it => ({ ...it, chance: fromPercent(e.target.value), attrs: { ...(it.attrs || {}), chance: String(fromPercent(e.target.value)) } }))}/>
                        </label>
                      ))}
                    </div>
                  ))}
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}