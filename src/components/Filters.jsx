import React, {useMemo, useState} from 'react';
import { cx } from '../utils/cx';
import { Badge } from './base/badges/badges';
import { Input } from './ui/Input';
import { Button } from './ui/Button';
import { ChevronDown, ChevronRight, X, Search, Settings, Filter, RotateCcw } from 'lucide-react';

/**
 * @typedef {{categories: string[], usageflags: string[], valueflags: string[], tags: string[]}} Definitions
 */

/**
 * Filters panel
 * @param {{
 *  definitions: Definitions,
 *  groups: string[],
 *  filters: { category: string, name: string, usage: string[], value: string[], tag: string[], flags: string[], groups: string[], changedOnly: boolean },
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

    const hasNonVanillaGroups = useMemo(() => groups.some(g => g !== 'vanilla'), [groups]);

    const [usageOpen, setUsageOpen] = useState(true);
    const [valueOpen, setValueOpen] = useState(true);
    const [flagsOpen, setFlagsOpen] = useState(false);
    const [tagOpen, setTagOpen] = useState(false);
    const [groupsOpen, setGroupsOpen] = useState(false);

    const flagsList = useMemo(() => {
        if (Array.isArray(flagOptions) && flagOptions.length > 0) return flagOptions;
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

    const AccordionItem = ({ title, isOpen, onToggle, onManage, badge, children }) => (
        <div className="border-b border-gray-200 dark:border-gray-800">
            <div className="flex items-center justify-between py-4 px-4">
                <button
                    onClick={onToggle}
                    className="flex items-center gap-2 text-sm font-bold text-gray-900 hover:text-primary-600 transition-colors dark:text-gray-100 dark:hover:text-primary-400"
                >
                    <ChevronDown size={18} className={cx("transition-transform text-gray-400", !isOpen && "-rotate-90")} />
                    {title}
                    {badge > 0 && (
                        <span className="ml-1 px-1.5 py-0.5 text-[10px] bg-primary-50 text-primary-700 rounded-full dark:bg-primary-900/30 dark:text-primary-400">
                            {badge}
                        </span>
                    )}
                </button>
                {onManage && (
                    <button
                        onClick={onManage}
                        className="text-gray-400 hover:text-primary-600 transition-colors p-1 rounded-md hover:bg-gray-50 dark:hover:bg-gray-800"
                        title="Manage definitions"
                    >
                        <Settings size={16} />
                    </button>
                )}
            </div>
            {isOpen && <div className="px-4 pb-4 animate-in slide-in-from-top-1 duration-200">{children}</div>}
        </div>
    );

    const Pill = ({ active, onClick, children }) => (
        <button
            onClick={onClick}
            className={cx(
                "px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all shadow-sm",
                active 
                    ? "bg-primary-600 border-primary-600 text-white dark:bg-primary-500 dark:border-primary-500" 
                    : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-700"
            )}
        >
            {children}
        </button>
    );

    return (
        <div className="flex flex-col h-full bg-white dark:bg-gray-900">
            {/* Filter Header */}
            <div className="p-4 border-b border-gray-200 dark:border-gray-800">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                        <Filter size={18} className="text-gray-400" />
                        <h2 className="text-sm font-bold text-gray-900 dark:text-white uppercase tracking-wider">Filters</h2>
                    </div>
                    <Button variant="tertiary" size="sm" onClick={clearFilters} className="h-8 px-2 text-xs">
                        <RotateCcw size={14} className="mr-1.5" /> Reset
                    </Button>
                </div>

                <div className="space-y-4">
                    <Input 
                        placeholder="Search by name..." 
                        value={filters.name}
                        onChange={e => setField('name', e.target.value)}
                        icon={Search}
                        className="h-9"
                    />

                    <div className="space-y-1.5">
                        <label className="text-xs font-bold text-gray-500 uppercase tracking-wider dark:text-gray-400">Category</label>
                        <select
                            className="w-full h-9 px-3 py-1 text-sm bg-white border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-4 focus:ring-primary-100 focus:border-primary-300 transition-all dark:bg-gray-950 dark:border-gray-700 dark:text-white dark:focus:ring-primary-900/30 dark:focus:border-primary-500"
                            value={filters.category}
                            onChange={e => setField('category', e.target.value)}
                        >
                            {allCategoryOptions.map(c => (
                                <option key={c} value={c}>{c === 'all' ? 'All Categories' : c === 'none' ? 'No Category' : c}</option>
                            ))}
                        </select>
                    </div>

                    <Button 
                        variant={filters.changedOnly ? "secondary-color" : "secondary-gray"} 
                        size="sm" 
                        className="w-full text-xs"
                        onClick={() => setField('changedOnly', !filters.changedOnly)}
                    >
                        {filters.changedOnly ? 'Showing Changed Only' : 'Show Changed Only'}
                    </Button>
                </div>
            </div>

            {/* Accordions */}
            <div className="flex-1 overflow-y-auto scrollbar-thin">
                <AccordionItem 
                    title="Usage" 
                    isOpen={usageOpen} 
                    onToggle={() => setUsageOpen(!usageOpen)}
                    onManage={() => onManage('usage')}
                    badge={filters.usage.length}
                >
                    <div className="flex flex-wrap gap-2">
                        <Pill active={filters.usage.includes('None')} onClick={() => toggleUsage('None')}>None</Pill>
                        {definitions.usageflags.map(u => (
                            <Pill key={u} active={filters.usage.includes(u)} onClick={() => toggleUsage(u)}>{u}</Pill>
                        ))}
                    </div>
                </AccordionItem>

                <AccordionItem 
                    title="Value" 
                    isOpen={valueOpen} 
                    onToggle={() => setValueOpen(!valueOpen)}
                    onManage={() => onManage('value')}
                    badge={filters.value.length}
                >
                    <div className="flex flex-wrap gap-2">
                        <Pill active={filters.value.includes('None')} onClick={() => toggleValue('None')}>None</Pill>
                        {definitions.valueflags.map(v => (
                            <Pill key={v} active={filters.value.includes(v)} onClick={() => toggleValue(v)}>{v}</Pill>
                        ))}
                    </div>
                </AccordionItem>

                <AccordionItem 
                    title="Tags" 
                    isOpen={tagOpen} 
                    onToggle={() => setTagOpen(!tagOpen)}
                    onManage={() => onManage('tag')}
                    badge={filters.tag.length}
                >
                    <div className="flex flex-wrap gap-2">
                        {definitions.tags.map(t => (
                            <Pill key={t} active={filters.tag.includes(t)} onClick={() => {
                                const curr = filters.tag;
                                const next = curr.includes(t) ? curr.filter(x => x !== t) : [...curr, t];
                                setField('tag', next);
                            }}>{t}</Pill>
                        ))}
                    </div>
                </AccordionItem>

                <AccordionItem 
                    title="Flags" 
                    isOpen={flagsOpen} 
                    onToggle={() => setFlagsOpen(!flagsOpen)}
                    badge={filters.flags.length}
                >
                    <div className="flex flex-wrap gap-2">
                        <Pill active={filters.flags.includes('None')} onClick={() => toggleFlag('None')}>None</Pill>
                        {flagsList.map(f => (
                            <Pill key={f} active={filters.flags.includes(f)} onClick={() => toggleFlag(f)}>{f}</Pill>
                        ))}
                    </div>
                </AccordionItem>

                {hasNonVanillaGroups && (
                    <AccordionItem 
                        title="Groups" 
                        isOpen={groupsOpen} 
                        onToggle={() => setGroupsOpen(!groupsOpen)}
                        badge={filters.groups.length}
                    >
                        <div className="flex flex-wrap gap-2">
                            {groups.map(g => (
                                <Pill key={g} active={filters.groups.includes(g)} onClick={() => toggleGroup(g)}>{g}</Pill>
                            ))}
                        </div>
                    </AccordionItem>
                )}
            </div>

            {/* Matching Footer */}
            <div className="p-4 bg-gray-50 border-t border-gray-200 dark:bg-gray-950 dark:border-gray-800">
                <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider dark:text-gray-400">Matching</span>
                    <Badge color={matchingCount > 0 ? 'brand' : 'gray'} size="md">{matchingCount} types</Badge>
                </div>
            </div>
        </div>
    );
}
