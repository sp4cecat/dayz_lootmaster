import React, { useMemo } from 'react';

/**
 * @typedef {{categories: string[], usageflags: string[], valueflags: string[], tags: string[]}} Definitions
 */

/**
 * Filters panel
 * @param {{
 *  definitions: Definitions,
 *  groups: string[],
 *  filters: { category: string, name: string, usage: string[], value: string[], tag: string[], groups: string[] },
 *  onChange: (next: any) => void,
 *  onManage: (kind: 'usage'|'value'|'tag') => void,
 *  matchingCount: number
 * }} props
 */
export default function Filters({ definitions, groups, filters, onChange, onManage, matchingCount }) {
  const allCategoryOptions = useMemo(
    () => ['all', 'none', ...definitions.categories],
    [definitions.categories]
  );

  const setField = (key, value) => {
    onChange({ ...filters, [key]: value });
  };

  const clearFilters = () => {
    onChange({ category: 'all', name: '', usage: [], value: [], tag: [], groups: [] });
  };

  const toggleUsage = (opt) => {
    const curr = filters.usage;
    if (opt === 'None') {
      setField('usage', curr.includes('None') ? [] : ['None']);
      return;
    }
    const cleaned = curr.filter(x => x !== 'None');
    const next = cleaned.includes(opt) ? cleaned.filter(x => x !== opt) : [...cleaned, opt];
    setField('usage', next);
  };

  const toggleValue = (opt) => {
    const curr = filters.value;
    if (opt === 'None') {
      setField('value', curr.includes('None') ? [] : ['None']);
      return;
    }
    const cleaned = curr.filter(x => x !== 'None');
    const next = cleaned.includes(opt) ? cleaned.filter(x => x !== opt) : [...cleaned, opt];
    setField('value', next);
  };

  const toggleGroup = (g) => {
    const curr = filters.groups;
    const next = curr.includes(g) ? curr.filter(x => x !== g) : [...curr, g];
    setField('groups', next);
  };

  const selectedGroupsSet = new Set(filters.groups);
  const allGroupsSelected = filters.groups.length === 0;

  return (
    <div className="filters">
      <div className="filters-row">
        <h2 className="panel-title">Filters<br/>
            <span>Matching {matchingCount} types</span></h2>
        <div className="spacer" />
        <button type="button" className="link" onClick={clearFilters} title="Clear all filters">Clear filters</button>
      </div>

      <fieldset className="filters-group">
        <legend>Types Groups</legend>
        <div className="chips selectable">
          <button
            type="button"
            className={`chip ${allGroupsSelected ? 'selected' : ''}`}
            onClick={() => setField('groups', [])}
            aria-pressed={allGroupsSelected}
            title="Show all groups"
          >
            All
          </button>
          {groups.map(g => {
            const selected = selectedGroupsSet.has(g);
            return (
              <button
                type="button"
                key={g}
                className={`chip ${selected ? 'selected' : ''}`}
                onClick={() => toggleGroup(g)}
                aria-pressed={selected}
                title={`Toggle group ${g}`}
              >
                {g}
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className="filters-row">
        <label className="control">
          <legend>Category</legend>
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
          <legend>Filter by text (supports * and ?)</legend>
          <input
            type="text"
            value={filters.name}
            placeholder="e.g. Ammo* or *Dressing"
            onChange={e => setField('name', e.target.value)}
          />
        </label>
      </div>

      <fieldset className="filters-group">
        <legend>
          Usage
          <button
            type="button"
            className="link"
            onClick={() => onManage('usage')}
            style={{ float: 'right' }}
          >
            manage
          </button>
        </legend>
        <div className="chips selectable">
          <button
            type="button"
            className={`chip none-chip ${filters.usage.includes('None') ? 'selected' : ''}`}
            onClick={() => toggleUsage('None')}
            aria-pressed={filters.usage.includes('None')}
            title="Types with no usage"
          >
            None
          </button>
          {[...definitions.usageflags].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })).map(opt => {
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
        <legend>
          Value
          <button
            type="button"
            className="link"
            onClick={() => onManage('value')}
            style={{ float: 'right' }}
          >
            manage
          </button>
        </legend>
        <div className="chips selectable">
            <button
              type="button"
                className={`chip none-chip ${filters.value.includes('None') ? 'selected' : ''}`}
              onClick={() => toggleValue('None')}
              aria-pressed={filters.value.includes('None')}
              title="Types with no value flags"
            >
              None
            </button>
          {[...definitions.valueflags].sort((a, b) => {
            const ma = /^tier\s*(\d+)$/i.exec(String(a).trim());
            const mb = /^tier\s*(\d+)$/i.exec(String(b).trim());
            if (ma && mb) {
              const na = Number(ma[1]);
              const nb = Number(mb[1]);
              return na - nb;
            }
            return String(a).localeCompare(String(b), undefined, { sensitivity: 'base' });
          }).map(opt => {
            const selected = filters.value.includes(opt);
            return (
              <button
                type="button"
                key={opt}
                className={`chip ${selected ? 'selected' : ''}`}
                onClick={() => toggleValue(opt)}
                aria-pressed={selected}
              >
                {opt}
              </button>
            );
          })}
        </div>
      </fieldset>

      <fieldset className="filters-group">
        <legend>
          Tag
          <button
            type="button"
            className="link"
            onClick={() => onManage('tag')}
            style={{ float: 'right' }}
          >
            manage
          </button>
        </legend>
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
