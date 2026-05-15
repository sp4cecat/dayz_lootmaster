import React, {useMemo, useState} from 'react';

/**
 * @typedef {{categories: string[], usageflags: string[], valueflags: string[], tags: string[]}} Definitions
 */

/**
 * Filters panel
 * @param {{
 *  definitions: Definitions,
 *  groups: string[],
 *  filters: { category: string, name: string, usage: string[], value: string[], tag: string[], flags: string[], groups: string[] },
 *  onChange: (next: any) => void,
 *  onManage: (kind: 'usage'|'value'|'tag') => void,
 *  matchingCount: number,
 *  flagOptions: string[]
 * }} props
 */
export default function Filters({definitions, groups, filters, onChange, onManage, matchingCount, flagOptions = []}) {
    const allCategoryOptions = useMemo(
        () => ['all', 'none', ...definitions.categories],
        [definitions.categories]
    );

    // Whether any non-vanilla group exists (used to show/hide Types Groups panel)
    const hasNonVanillaGroups = useMemo(() => groups.some(g => g !== 'vanilla'), [groups]);

    // Accordion state (usage/value/flags default closed, tag default open)
    const [usageOpen, setUsageOpen] = useState(false);
    const [valueOpen, setValueOpen] = useState(false);
    const [flagsOpen, setFlagsOpen] = useState(false);
    const [tagOpen, setTagOpen] = useState(false);

    // Ensure flags list is available even if not provided from parent
    const flagsList = useMemo(() => {
        if (Array.isArray(flagOptions) && flagOptions.length > 0) return flagOptions;
        // Fallback to known flags
        return ['count_in_cargo', 'count_in_hoarder', 'count_in_map', 'count_in_player', 'crafted', 'deloot'];
    }, [flagOptions]);

    const setField = (key, value) => {
        onChange({...filters, [key]: value});
    };

    const clearFilters = () => {
        onChange({category: 'all', name: '', usage: [], value: [], tag: [], flags: [], changedOnly: false, groups: []});
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

    // Toggle a flag key on/off in filters.flags; 'None' is exclusive
    const toggleFlag = (key) => {
        const curr = Array.isArray(filters.flags) ? filters.flags : [];
        if (key === 'None') {
            setField('flags', curr.includes('None') ? [] : ['None']);
            return;
        }
        const cleaned = curr.filter(x => x !== 'None');
        const next = cleaned.includes(key) ? cleaned.filter(x => x !== key) : [...cleaned, key];
        setField('flags', next);
    };

    return (
        <div className="filters">
            <div className="filters-row">
                <h2 className="panel-title">Filters<br/>
                    <span>Matching {matchingCount} types</span></h2>
                <div className="spacer"/>
                <div style={{display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end"}}>
                    <button type="button" className="link" onClick={clearFilters} title="Clear all filters">Clear filters</button>
                    <button
                        type="button"
                        className="link"
                        onClick={() => setField('changedOnly', true)}
                        title="Show only changed types"
                    >
                        Show changed
                    </button>
                </div>
            </div>

            {/* Show Types Groups only if any non-vanilla group exists */}
            {hasNonVanillaGroups && (
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
            )}

            <div className="filters-row">
                <label className="control grow">
                    <legend>Filter by text (supports * and ?)</legend>
                    <div className="input-with-clear">
                        <input
                            type="text"
                            value={filters.name}
                            placeholder="e.g. Ammo* or *Dressing"
                            onChange={e => setField('name', e.target.value)}
                        />
                        {filters.name?.length > 0 && (
                            <button
                                type="button"
                                className="clear-input-btn"
                                aria-label="Clear text filter"
                                title="Clear"
                                onClick={() => setField('name', '')}
                            >
                                ×
                            </button>
                        )}
                    </div>
                </label>
            </div>
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

            <fieldset className="filters-group">
                <legend style={{display: 'flex', alignItems: 'center', gap: 8}}>
                    <button
                        type="button"
                        className="link"
                        onClick={() => setUsageOpen(o => !o)}
                        aria-expanded={usageOpen}
                        title={usageOpen ? 'Collapse Usage' : 'Expand Usage'}
                    >
                        <span className="chevron" aria-hidden="true">{usageOpen ? '▾' : '▸'}</span>
                        <span>Usage</span>
                    </button>
                    <button
                        type="button"
                        className="link manage-link"
                        onClick={() => onManage('usage')}
                        style={{marginLeft: 'auto'}}
                    >
                        manage
                    </button>
                </legend>
                {usageOpen && (
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
                        {[...definitions.usageflags].sort((a, b) => a.localeCompare(b, undefined, {sensitivity: 'base'})).map(opt => {
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
                )}
            </fieldset>

            <fieldset className="filters-group">
                <legend style={{display: 'flex', alignItems: 'center', gap: 8}}>
                    <button
                        type="button"
                        className="link"
                        onClick={() => setValueOpen(o => !o)}
                        aria-expanded={valueOpen}
                        title={valueOpen ? 'Collapse Value' : 'Expand Value'}
                    >
                        <span className="chevron" aria-hidden="true">{valueOpen ? '▾' : '▸'}</span>
                        <span>Value</span>
                    </button>
                    <button
                        type="button"
                        className="link manage-link"
                        onClick={() => onManage('value')}
                        style={{marginLeft: 'auto'}}
                    >
                        manage
                    </button>
                </legend>
                {valueOpen && (
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
                            return String(a).localeCompare(String(b), undefined, {sensitivity: 'base'});
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
                )}
            </fieldset>

            <fieldset className="filters-group">
                <legend style={{display: 'flex', alignItems: 'center', gap: 8}}>
                    <button
                        type="button"
                        className="link"
                        onClick={() => setTagOpen(o => !o)}
                        aria-expanded={tagOpen}
                        title={tagOpen ? 'Collapse Tag' : 'Expand Tag'}
                    >
                        <span className="chevron" aria-hidden="true">{tagOpen ? '▾' : '▸'}</span>
                        <span>Tags</span>
                    </button>
                    <button
                        type="button"
                        className="link manage-link"
                        onClick={() => onManage('tag')}
                        style={{marginLeft: 'auto'}}
                    >
                        manage
                    </button>
                </legend>
                {tagOpen && (
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
                )}
            </fieldset>

            <fieldset className="filters-group">
                <legend style={{display: 'flex', alignItems: 'center', gap: 8}}>
                    <button
                        type="button"
                        className="link"
                        onClick={() => setFlagsOpen(o => !o)}
                        aria-expanded={flagsOpen}
                        title={flagsOpen ? 'Collapse Flags' : 'Expand Flags'}
                    >
                        <span className="chevron" aria-hidden="true">{flagsOpen ? '▾' : '▸'}</span>
                        <span>Flags</span>
                    </button>
                </legend>
                {flagsOpen && (
                    <div className="chips selectable">
                        <button
                            type="button"
                            className={`chip none-chip ${(filters.flags || []).includes('None') ? 'selected' : ''}`}
                            onClick={() => toggleFlag('None')}
                            aria-pressed={(filters.flags || []).includes('None')}
                            title="Types with no flags set"
                        >
                            None
                        </button>
                        {flagsList.map(key => {
                            const selected = (filters.flags || []).includes(key);
                            return (
                                <button
                                    type="button"
                                    key={key}
                                    className={`chip ${selected ? 'selected' : ''}`}
                                    onClick={() => toggleFlag(key)}
                                    aria-pressed={selected}
                                    title={key}
                                >
                                    {key}
                                </button>
                            );
                        })}
                    </div>
                )}
            </fieldset>
        </div>
    );
}
