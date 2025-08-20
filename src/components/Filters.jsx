import React, { useMemo } from 'react';

/**
 * @typedef {{categories: string[], usageflags: string[], valueflags: string[], tags: string[]}} Definitions
 */

/**
 * @param {{
 *  definitions: Definitions,
 *  filters: { category: string, name: string, usage: string[], value: string[], tag: string[] },
 *  onChange: (next: any) => void
 * }} props
 */
export default function Filters({ definitions, filters, onChange }) {
  const allCategoryOptions = useMemo(
    () => ['all', 'none', ...definitions.categories],
    [definitions.categories]
  );

  const setField = (key, value) => {
    onChange({ ...filters, [key]: value });
  };

  const toggleUsage = (opt) => {
    const curr = filters.usage;
    const next = curr.includes(opt) ? curr.filter(x => x !== opt) : [...curr, opt];
    setField('usage', next);
  };

  return (
    <div className="filters">
      <div className="filters-row">
        <label className="control">
          <span>Category</span>
          <select
            value={filters.category}
            onChange={e => setField('category', e.target.value)}
          >
            {allCategoryOptions.map(opt => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="filters-row">
        <label className="control grow">
          <span>Name (supports * and ?)</span>
          <input
            type="text"
            value={filters.name}
            placeholder="e.g. Ammo* or *Dressing"
            onChange={e => setField('name', e.target.value)}
          />
        </label>
      </div>

      <fieldset className="filters-group">
        <legend>Usage</legend>
        <div className="chips selectable">
          {definitions.usageflags.map(opt => {
            const selected = filters.usage.includes(opt);
            return (
              <button
                type="button"
                key={opt}
                className={`chip ${selected ? 'selected' : ''}`}
                onClick={() => toggleUsage(opt)}
                aria-pressed={selected}
              >
                {opt}
              </button>
            );
          })}
        </div>
      </fieldset>

      <fieldset className="filters-group">
        <legend>Value</legend>
        <div className="checkbox-grid">
          {definitions.valueflags.map(opt => {
            const selected = filters.value.includes(opt);
            return (
              <label key={opt} className={`checkbox ${selected ? 'checked' : ''}`}>
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={e => {
                    const curr = filters.value;
                    const next = e.target.checked ? [...curr, opt] : curr.filter(x => x !== opt);
                    setField('value', next);
                  }}
                />
                <span>{opt}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <fieldset className="filters-group">
        <legend>Tag</legend>
        <div className="checkbox-grid">
          {definitions.tags.map(opt => {
            const selected = filters.tag.includes(opt);
            return (
              <label key={opt} className={`checkbox ${selected ? 'checked' : ''}`}>
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={e => {
                    const curr = filters.tag;
                    const next = e.target.checked ? [...curr, opt] : curr.filter(x => x !== opt);
                    setField('tag', next);
                  }}
                />
                <span>{opt}</span>
              </label>
            );
          })}
        </div>
      </fieldset>
    </div>
  );
}
