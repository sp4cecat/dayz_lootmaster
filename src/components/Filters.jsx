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
    () => ['all', ...definitions.categories],
    [definitions.categories]
  );

  const multiGroup = [
    { key: 'usage', label: 'Usage', options: definitions.usageflags },
    { key: 'value', label: 'Value', options: definitions.valueflags },
    { key: 'tag', label: 'Tag', options: definitions.tags },
  ];

  const setField = (key, value) => {
    onChange({ ...filters, [key]: value });
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
        <label className="control">
          <span>Name (supports * and ?)</span>
          <input
            type="text"
            value={filters.name}
            placeholder="e.g. Ammo* or *Dressing"
            onChange={e => setField('name', e.target.value)}
          />
        </label>
      </div>

      {multiGroup.map(group => (
        <fieldset className="filters-group" key={group.key}>
          <legend>{group.label}</legend>
          <div className="checkbox-grid">
            {group.options.map(opt => {
              const selected = filters[group.key].includes(opt);
              return (
                <label key={opt} className={`checkbox ${selected ? 'checked' : ''}`}>
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={e => {
                      const curr = filters[group.key];
                      const next = e.target.checked
                        ? [...curr, opt]
                        : curr.filter(x => x !== opt);
                      setField(group.key, next);
                    }}
                  />
                  <span>{opt}</span>
                </label>
              );
            })}
          </div>
        </fieldset>
      ))}
    </div>
  );
}
