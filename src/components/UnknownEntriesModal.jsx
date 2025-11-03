import React, { useMemo, useState } from 'react';

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
  });

  const toggleSet = (key, val) => {
    setState(s => {
      const ns = new Set(s[key]);
      if (ns.has(val)) ns.delete(val);
      else ns.add(val);
      return { ...s, [key]: ns };
    });
  };

  const selectionCount = useMemo(() =>
    state.addUsage.size + state.addValue.size + state.addTag.size + state.addCategory.size
  , [state.addUsage, state.addValue, state.addTag, state.addCategory]);

  const onAddSelected = () => {
    onApply({
      add: {
        usage: Array.from(state.addUsage),
        value: Array.from(state.addValue),
        tag: Array.from(state.addTag),
        category: Array.from(state.addCategory),
      },
      remove: false
    });
  };

  const onRemoveSelected = () => {
    onApply({
      add: { usage: [], value: [], tag: [], category: [] },
      remove: true
    });
  };

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-header">
          <h3>Resolve Unknown Entries</h3>
          <div className="spacer" />
          <button className="btn" onClick={onClose} aria-label="Close" title="Close">Close</button>
        </div>
        <div className="modal-body">
          <p>Select one or more unknown entries below, then choose an action.</p>
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

          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button
              className="btn"
              onClick={onAddSelected}
              disabled={selectionCount === 0}
              title="Add selected entries to definitions"
            >
              Add selected entries to definitions
            </button>
            <button
              className="btn"
              onClick={onRemoveSelected}
              disabled={selectionCount === 0}
              title="Remove selected entries from affected types"
            >
              Remove selected entries from affected types
            </button>
          </div>
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
