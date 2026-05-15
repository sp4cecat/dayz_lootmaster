import React from 'react';

function chancePercent(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(Math.min(1, Math.max(0, n)) * 1000) / 10 : 0;
}

function fromPercent(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n / 100)) : 0;
}

export default function RandomPresetsModal({ randomPresets, setRandomPresets, spawnableTypesByGroup = {}, setSpawnableTypesByGroup = () => {}, onClose }) {
  const presets = randomPresets?.presets || [];
  const presetNames = new Set(presets.map(p => p.name).filter(Boolean));

  const updatePreset = (index, apply) => {
    setRandomPresets(prev => {
      const next = { ...(prev || { presets: [] }), presets: [...(prev?.presets || [])] };
      next.presets[index] = apply(next.presets[index]);
      return next;
    });
  };

  const renamePresetReferences = (oldName, newName) => {
    if (!oldName || !newName || oldName === newName) return;
    setSpawnableTypesByGroup(prev => Object.fromEntries(Object.entries(prev || {}).map(([group, data]) => [
      group,
      {
        ...(data || {}),
        types: (data?.types || []).map(type => ({
          ...type,
          sections: (type.sections || []).map(section => section.preset === oldName
            ? { ...section, preset: newName, attrs: { ...(section.attrs || {}), preset: newName } }
            : section)
        }))
      }
    ])));
  };

  const transferPresetToReferences = (preset) => {
    if (!preset?.name) return;
    setSpawnableTypesByGroup(prev => Object.fromEntries(Object.entries(prev || {}).map(([group, data]) => [
      group,
      {
        ...(data || {}),
        types: (data?.types || []).map(type => ({
          ...type,
          sections: (type.sections || []).map(section => section.preset === preset.name
            ? {
              ...section,
              preset: '',
              chance: preset.chance ?? section.chance,
              attrs: { ...(section.attrs || {}), preset: '', chance: String(preset.chance ?? section.chance ?? '') },
              items: (preset.items || []).map(item => ({ ...item, attrs: { ...(item.attrs || {}) } }))
            }
            : section)
        }))
      }
    ])));
  };

  const countReferences = (name) => Object.values(spawnableTypesByGroup || {}).reduce((count, data) => count + (data?.types || []).reduce((inner, type) => inner + (type.sections || []).filter(section => section.preset === name).length, 0), 0);

  const addPreset = () => {
    let i = presets.length + 1;
    let name = `NewPreset${i}`;
    while (presetNames.has(name)) {
      i += 1;
      name = `NewPreset${i}`;
    }
    setRandomPresets(prev => ({
      ...(prev || {}),
      presets: [...(prev?.presets || []), { kind: 'attachments', name, chance: 1, attrs: { name, chance: '1' }, items: [] }]
    }));
  };

  const duplicatePreset = (preset) => {
    let i = 2;
    let name = `${preset.name}_copy`;
    while (presetNames.has(name)) {
      name = `${preset.name}_copy${i}`;
      i += 1;
    }
    setRandomPresets(prev => ({
      ...(prev || {}),
      presets: [...(prev?.presets || []), { ...preset, name, attrs: { ...(preset.attrs || {}), name }, items: (preset.items || []).map(item => ({ ...item, attrs: { ...(item.attrs || {}) } })) }]
    }));
  };

  const removePreset = (index) => {
    const preset = presets[index];
    const refs = countReferences(preset?.name);
    const ok = window.confirm(`Delete preset "${preset?.name || ''}"?${refs ? ` It is referenced ${refs} time(s) by spawnabletypes.` : ''}`);
    if (!ok) return;
    if (refs && window.confirm('Transfer this preset\'s chance/items directly into referencing spawnabletypes entries before deleting?')) {
      transferPresetToReferences(preset);
    }
    setRandomPresets(prev => ({ ...(prev || {}), presets: (prev?.presets || []).filter((_, i) => i !== index) }));
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal wide">
        <div className="modal-header">
          <h2>Mission Files · Random Presets</h2>
          <button className="btn" onClick={onClose}>Close</button>
        </div>
        <div className="toolbar" style={{ marginBottom: 12 }}>
          <button className="btn primary" onClick={addPreset}>Add preset group</button>
          <span className="muted">Chance sliders save as XML values from 0.000 to 1.000.</span>
        </div>
        <div className="stack" style={{ maxHeight: '70vh', overflow: 'auto' }}>
          {presets.map((preset, index) => (
            <section key={`${preset.kind}-${preset.name}-${index}`} className="card">
              <div className="row wrap">
                <label>Node type <input value={preset.kind || ''} onChange={e => updatePreset(index, p => ({ ...p, kind: e.target.value || 'attachments' }))}/></label>
                <label>Name <input value={preset.name || ''} onChange={e => updatePreset(index, p => { renamePresetReferences(p.name, e.target.value); return { ...p, name: e.target.value, attrs: { ...(p.attrs || {}), name: e.target.value } }; })}/></label>
                <button className="btn" onClick={() => duplicatePreset(preset)}>Duplicate</button>
                <button className="btn danger" onClick={() => removePreset(index)}>Delete</button>
              </div>
              <label className="slider-row">
                Group chance {chancePercent(preset.chance)}%
                <input type="range" min="0" max="100" step="0.1" value={chancePercent(preset.chance)} onChange={e => updatePreset(index, p => ({ ...p, chance: fromPercent(e.target.value), attrs: { ...(p.attrs || {}), chance: String(fromPercent(e.target.value)) } }))}/>
                <input type="number" min="0" max="100" step="0.1" value={chancePercent(preset.chance)} onChange={e => updatePreset(index, p => ({ ...p, chance: fromPercent(e.target.value), attrs: { ...(p.attrs || {}), chance: String(fromPercent(e.target.value)) } }))}/>
              </label>
              <div className="stack small">
                {(preset.items || []).map((item, itemIndex) => (
                  <div key={`${item.name}-${itemIndex}`} className="row wrap">
                    <input value={item.kind || 'item'} onChange={e => updatePreset(index, p => ({ ...p, items: (p.items || []).map((it, i) => i === itemIndex ? { ...it, kind: e.target.value || 'item' } : it) }))}/>
                    <input value={item.name || ''} onChange={e => updatePreset(index, p => ({ ...p, items: (p.items || []).map((it, i) => i === itemIndex ? { ...it, name: e.target.value, attrs: { ...(it.attrs || {}), name: e.target.value } } : it) }))}/>
                    <input type="range" min="0" max="100" step="0.1" value={chancePercent(item.chance)} onChange={e => updatePreset(index, p => ({ ...p, items: (p.items || []).map((it, i) => i === itemIndex ? { ...it, chance: fromPercent(e.target.value), attrs: { ...(it.attrs || {}), chance: String(fromPercent(e.target.value)) } } : it) }))}/>
                    <span>{chancePercent(item.chance)}%</span>
                  </div>
                ))}
                <button className="btn" onClick={() => updatePreset(index, p => ({ ...p, items: [...(p.items || []), { kind: 'item', name: '', chance: 1, attrs: { chance: '1' } }] }))}>Add item</button>
              </div>
            </section>
          ))}
          {!presets.length && <div className="empty">No random presets loaded. Add a preset group to create `cfgrandompresets.xml` content.</div>}
        </div>
      </div>
    </div>
  );
}