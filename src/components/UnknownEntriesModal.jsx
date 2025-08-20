import React, { useState } from 'react';

/**
 * @param {{
 *  unknowns: {
 *    hasAny: boolean,
 *    sets: { usage: Set<string>, value: Set<string>, tag: Set<string>, category: Set<string> }
 *  },
 *  onApply: (opts: { add: {usage: string[], value: string[], tag: string[], category: string[]}, remove: boolean }) => void,
 *  onClose: () => void
 * }} props
 */
export default function UnknownEntriesModal({ unknowns, onApply, onClose }) {
  const [state, setState] = useState({
    addUsage: new Set(),
    addValue: new Set(),
    addTag: new Set(),
    addCategory: new Set(),
    addToDefinitions: true,
    removeUnknownFromTypes: true
  });

  const toggleSet = (key, val) => {
    setState(s => {
      const ns = new Set(s[key]);
      if (ns.has(val)) ns.delete(val);
      else ns.add(val);
      return { ...s, [key]: ns };
    });
  };

  const apply = () => {
    const add = state.addToDefinitions
      ? {
          usage: Array.from(state.addUsage),
          value: Array.from(state.addValue),
          tag: Array.from(state.addTag),
          category: Array.from(state.addCategory),
        }
      : { usage: [], value: [], tag: [], category: [] };

    onApply({
      add,
      remove: state.removeUnknownFromTypes
    });
  };

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-header">
          <h3>Resolve Unknown Entries</h3>
          <div className="spacer" />
          <button className="btn" onClick={onClose}>Close</button>
          <button className="btn primary" onClick={apply}>Apply</button>
        </div>
        <div className="modal-body">
          <p>Select entries you want to add to definitions, or choose to remove unknown entries from affected types.</p>
          <div className="resolve-grid">
            <ResolveSection
              title="Categories"
              items={Array.from(unknowns.sets.category)}
              selected={state.addCategory}
              onToggle={(v) => toggleSet('addCategory', v)}
            />
            <ResolveSection
              title="Usage flags"
              items={Array.from(unknowns.sets.usage)}
              selected={state.addUsage}
              onToggle={(v) => toggleSet('addUsage', v)}
            />
            <ResolveSection
              title="Value flags"
              items={Array.from(unknowns.sets.value)}
              selected={state.addValue}
              onToggle={(v) => toggleSet('addValue', v)}
            />
            <ResolveSection
              title="Tags"
              items={Array.from(unknowns.sets.tag)}
              selected={state.addTag}
              onToggle={(v) => toggleSet('addTag', v)}
            />
          </div>

          <label className="checkbox">
            <input
              type="checkbox"
              checked={state.addToDefinitions}
              onChange={e => setState(s => ({ ...s, addToDefinitions: e.target.checked }))}
            />
            <span>Add selected entries to definitions</span>
          </label>

          <label className="checkbox">
            <input
              type="checkbox"
              checked={state.removeUnknownFromTypes}
              onChange={e => setState(s => ({ ...s, removeUnknownFromTypes: e.target.checked }))}
            />
            <span>Remove unknown entries from affected types</span>
          </label>
        </div>
      </div>
    </div>
  );
}

function ResolveSection({ title, items, selected, onToggle }) {
  if (items.length === 0) return null;
  return (
    <div className="resolve-section">
      <h4>{title}</h4>
      <div className="chips selectable">
        {items.map(it => (
          <button
            type="button"
            key={it}
            className={`chip ${selected.has(it) ? 'selected' : ''}`}
            onClick={() => onToggle(it)}
          >
            {it}
          </button>
        ))}
      </div>
    </div>
  );
}
