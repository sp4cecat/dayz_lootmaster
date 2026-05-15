import React, {useMemo, useState} from 'react';
import { cn } from '../utils/cn';
import { Badge } from './ui/Badge';
import { Input } from './ui/Input';
import { Button } from './ui/Button';
import { ChevronDown, ChevronRight, X, Search, Settings, Filter } from 'lucide-react';

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

    const hasNonVanillaGroups = useMemo(() => groups.some(g => g !== 'vanilla'), [groups]);

    const [usageOpen, setUsageOpen] = useState(false);
    const [valueOpen, setValueOpen] = useState(false);
    const [flagsOpen, setFlagsOpen] = useState(false);
    const [tagOpen, setTagOpen] = useState(false);

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

    const selectedGroupsSet = new Set(filters.groups);
    const allGroupsSelected = filters.groups.length === 0;

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

    const AccordionItem = ({ title, isOpen, onToggle, onManage, children }) => (
        <div className="border-b border-gray-100 last:border-0 dark:border-gray-800">
            <div className="flex items-center justify-between py-3 px-4">
                <button
                    onClick={onToggle}
                    className="flex items-center gap-2 text-sm font-semibold text-gray-700 hover:text-gray-900 transition-colors dark:text-gray-300 dark:hover:text-white"
                >
                    {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    {title}
                </button>
                {onManage && (
                    <button
                        onClick={onManage}
                        className="text-gray-400 hover:text-primary-600 transition-colors dark:hover:text-primary-400"
                        title="Manage"
                    >
                        <Settings size={14} />
                    </button>
                )}
            </div>
            {isOpen && <div className="px-4 pb-4">{children}</div>}
        </div>
    );

    return (
        <div className="flex flex-col">
            <div className="p-4 border-b border-gray-100 dark:border-gray-800">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2 text-gray-900 dark:text-white">
                        <Filter size={18} />
                        <h2 className="text-lg font-bold">Filters</h2>
                    </div>
                    <Button variant="link" size="sm" onClick={clearFilters}>Clear all</Button>
                </div>
                
                <div className="space-y-4">
                    <div>
                        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5 dark:text-gray-400">Search Types</label>
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                            <Input 
                                value={filters.name}
                                onChange={e => setField('name', e.target.value)}
                                placeholder="e.g. Ammo* or *Dressing"
                                className="pl-9 pr-9"
                            />
                            {filters.name?.length > 0 && (
                                <button
                                    onClick={() => setField('name', '')}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                                >
                                    <X size={16} />
                                </button>
                            )}
                        </div>
                    </div>

                    <div>
                        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5 dark:text-gray-400">Category</label>
                        <select
                            value={filters.category}
                            onChange={e => setField('category', e.target.value)}
                            className="w-full h-10 px-3 py-2 text-sm bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-4 focus:ring-primary-100 focus:border-primary-300 transition-all appearance-none bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20fill%3D%22none%22%20viewBox%3D%220%200%2020%2020%22%3E%3Cpath%20stroke%3D%22%236B7280%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%20stroke-width%3D%221.5%22%20d%3D%22m6%208%204%204%204-4%22%2F%3E%3C%2Fsvg%3E')] bg-[length:20px_20px] bg-right-3 bg-no-repeat dark:bg-gray-800 dark:border-gray-700 dark:text-white dark:focus:ring-primary-900/30 dark:focus:border-primary-500"
                        >
                            {allCategoryOptions.map(opt => (
                                <option key={opt} value={opt}>{opt}</option>
                            ))}
                        </select>
                    </div>

                    <div className="flex items-center gap-2 pt-2">
                        <Button 
                            variant={filters.changedOnly ? "primary" : "secondary"} 
                            size="sm" 
                            className="w-full"
                            onClick={() => setField('changedOnly', !filters.changedOnly)}
                        >
                            Show changed only
                        </Button>
                        <Badge variant="primary" className="py-1">{matchingCount}</Badge>
                    </div>
                </div>
            </div>

            <div className="overflow-y-auto max-h-[calc(100vh-400px)]">
                {hasNonVanillaGroups && (
                    <AccordionItem title="Types Groups" isOpen={true} onToggle={() => {}}>
                        <div className="flex flex-wrap gap-2">
                            <Badge 
                                className="cursor-pointer" 
                                variant={allGroupsSelected ? "primary" : "gray"}
                                onClick={() => setField('groups', [])}
                            >
                                All
                            </Badge>
                            {groups.map(g => (
                                <Badge 
                                    key={g}
                                    className="cursor-pointer" 
                                    variant={selectedGroupsSet.has(g) ? "primary" : "gray"}
                                    onClick={() => toggleGroup(g)}
                                >
                                    {g}
                                </Badge>
                            ))}
                        </div>
                    </AccordionItem>
                )}

                <AccordionItem 
                    title="Usage" 
                    isOpen={usageOpen} 
                    onToggle={() => setUsageOpen(!usageOpen)}
                    onManage={() => onManage('usage')}
                >
                    <div className="flex flex-wrap gap-2">
                        <Badge 
                            variant={filters.usage.includes('None') ? "primary" : "gray"}
                            className="cursor-pointer"
                            onClick={() => toggleUsage('None')}
                        >
                            None
                        </Badge>
                        {[...definitions.usageflags].sort((a, b) => a.localeCompare(b)).map(opt => (
                            <Badge 
                                key={opt}
                                variant={filters.usage.includes(opt) ? "primary" : "gray"}
                                className="cursor-pointer"
                                onClick={() => toggleUsage(opt)}
                            >
                                {opt}
                            </Badge>
                        ))}
                    </div>
                </AccordionItem>

                <AccordionItem 
                    title="Value" 
                    isOpen={valueOpen} 
                    onToggle={() => setValueOpen(!valueOpen)}
                    onManage={() => onManage('value')}
                >
                    <div className="flex flex-wrap gap-2">
                        <Badge 
                            variant={filters.value.includes('None') ? "primary" : "gray"}
                            className="cursor-pointer"
                            onClick={() => toggleValue('None')}
                        >
                            None
                        </Badge>
                        {[...definitions.valueflags].sort((a, b) => {
                            const ma = /^tier\s*(\d+)$/i.exec(String(a).trim());
                            const mb = /^tier\s*(\d+)$/i.exec(String(b).trim());
                            if (ma && mb) return Number(ma[1]) - Number(mb[1]);
                            return String(a).localeCompare(String(b));
                        }).map(opt => (
                            <Badge 
                                key={opt}
                                variant={filters.value.includes(opt) ? "primary" : "gray"}
                                className="cursor-pointer"
                                onClick={() => toggleValue(opt)}
                            >
                                {opt}
                            </Badge>
                        ))}
                    </div>
                </AccordionItem>

                <AccordionItem 
                    title="Tags" 
                    isOpen={tagOpen} 
                    onToggle={() => setTagOpen(!tagOpen)}
                    onManage={() => onManage('tag')}
                >
                    <div className="grid grid-cols-2 gap-2">
                        {definitions.tags.map(opt => {
                            const selected = filters.tag.includes(opt);
                            return (
                                <label key={opt} className="flex items-center gap-2 cursor-pointer group">
                                    <div className={cn(
                                        "size-4 rounded border flex items-center justify-center transition-all",
                                        selected ? "bg-primary-600 border-primary-600 dark:bg-primary-500 dark:border-primary-500" : "bg-white border-gray-300 group-hover:border-primary-300 dark:bg-gray-800 dark:border-gray-700 dark:group-hover:border-primary-500"
                                    )}>
                                        {selected && <div className="size-1.5 bg-white rounded-full" />}
                                    </div>
                                    <input
                                        type="checkbox"
                                        className="hidden"
                                        checked={selected}
                                        onChange={e => {
                                            const curr = filters.tag;
                                            const next = e.target.checked ? [...curr, opt] : curr.filter(x => x !== opt);
                                            setField('tag', next);
                                        }}
                                    />
                                    <span className={cn("text-sm", selected ? "text-gray-900 font-medium dark:text-white" : "text-gray-600 dark:text-gray-400")}>{opt}</span>
                                </label>
                            );
                        })}
                    </div>
                </AccordionItem>

                <AccordionItem 
                    title="Flags" 
                    isOpen={flagsOpen} 
                    onToggle={() => setFlagsOpen(!flagsOpen)}
                >
                    <div className="flex flex-wrap gap-2">
                        <Badge 
                            variant={(filters.flags || []).includes('None') ? "primary" : "gray"}
                            className="cursor-pointer"
                            onClick={() => toggleFlag('None')}
                        >
                            None
                        </Badge>
                        {flagsList.map(key => (
                            <Badge 
                                key={key}
                                variant={(filters.flags || []).includes(key) ? "primary" : "gray"}
                                className="cursor-pointer"
                                onClick={() => toggleFlag(key)}
                            >
                                {key}
                            </Badge>
                        ))}
                    </div>
                </AccordionItem>
            </div>
        </div>
    );
}
