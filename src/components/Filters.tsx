import React, { useMemo, useState } from 'react';
import { cx } from '@/utils/cx';
import { Badge } from '@/components/base/badges/badges';
import { Input } from '@/components/base/input/input';
import { Button } from '@/components/base/button/button';
import { ChevronDown, Search, Settings, Filter, RotateCcw } from 'lucide-react';

export interface Definitions {
  categories: string[];
  usageflags: string[];
  valueflags: string[];
  tags: string[];
}

interface FilterState {
  category: string;
  name: string;
  usage: string[];
  value: string[];
  tag: string[];
  flags: string[];
  groups: string[];
  changedOnly: boolean;
}

interface FiltersProps {
  definitions: Definitions;
  groups: string[];
  filters: FilterState;
  onChange: (next: FilterState) => void;
  onManage: (kind: 'usage' | 'value' | 'tag') => void;
  matchingCount: number;
  flagOptions?: string[];
}

export default function Filters({
  definitions,
  groups,
  filters,
  onChange,
  onManage,
  matchingCount,
  flagOptions = [],
}: FiltersProps) {
  const allCategoryOptions = useMemo(
    () => ['all', 'none', ...definitions.categories],
    [definitions.categories]
  );

  const hasNonVanillaGroups = useMemo(() => groups.some((g) => g !== 'vanilla'), [groups]);

  const [usageOpen, setUsageOpen] = useState(filters.usage.length > 0);
  const [valueOpen, setValueOpen] = useState(filters.value.length > 0);
  const [flagsOpen, setFlagsOpen] = useState(filters.flags.length > 0);
  const [tagOpen, setTagOpen] = useState(filters.tag.length > 0);
  const [groupsOpen, setGroupsOpen] = useState(filters.groups.length > 0);

  const flagsList = useMemo(() => {
    if (Array.isArray(flagOptions) && flagOptions.length > 0) return flagOptions;
    return ['count_in_cargo', 'count_in_hoarder', 'count_in_map', 'count_in_player', 'crafted', 'deloot'];
  }, [flagOptions]);

  const setField = (key: keyof FilterState, value: any) => {
    onChange({ ...filters, [key]: value });
  };

  const clearFilters = () => {
    onChange({
      category: 'all',
      name: '',
      usage: [],
      value: [],
      tag: [],
      flags: [],
      changedOnly: false,
      groups: [],
    });
  };

  const toggleUsage = (opt: string) => {
    const curr = filters.usage;
    if (opt === 'None') {
      setField('usage', curr.includes('None') ? [] : ['None']);
      return;
    }
    const cleaned = curr.filter((x) => x !== 'None');
    const next = cleaned.includes(opt) ? cleaned.filter((x) => x !== opt) : [...cleaned, opt];
    setField('usage', next);
  };

  const toggleValue = (opt: string) => {
    const curr = filters.value;
    if (opt === 'None') {
      setField('value', curr.includes('None') ? [] : ['None']);
      return;
    }
    const cleaned = curr.filter((x) => x !== 'None');
    const next = cleaned.includes(opt) ? cleaned.filter((x) => x !== opt) : [...cleaned, opt];
    setField('value', next);
  };

  const toggleGroup = (g: string) => {
    const curr = filters.groups;
    const next = curr.includes(g) ? curr.filter((x) => x !== g) : [...curr, g];
    setField('groups', next);
  };

  const toggleFlag = (key: string) => {
    const curr = Array.isArray(filters.flags) ? filters.flags : [];
    if (key === 'None') {
      setField('flags', curr.includes('None') ? [] : ['None']);
      return;
    }
    const cleaned = curr.filter((x) => x !== 'None');
    const next = cleaned.includes(key) ? cleaned.filter((x) => x !== key) : [...cleaned, key];
    setField('flags', next);
  };

  const AccordionItem = ({
    title,
    isOpen,
    onToggle,
    onManage,
    badge,
    children,
  }: {
    title: string;
    isOpen: boolean;
    onToggle: () => void;
    onManage?: () => void;
    badge: number;
    children: React.ReactNode;
  }) => (
    <div className="border-b border-gray-200 dark:border-gray-800">
      <div className="flex items-center justify-between py-4 px-4">
        <button
          onClick={onToggle}
          className="flex items-center gap-2 text-sm font-bold text-gray-900 hover:text-primary-600 transition-colors dark:text-gray-100 dark:hover:text-primary-400"
        >
          <ChevronDown
            size={18}
            className={cx('transition-transform text-gray-400', !isOpen && '-rotate-90')}
          />
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
      {isOpen && (
        <div className="px-4 pb-4 animate-in slide-in-from-top-1 duration-200">
          <div className="flex flex-wrap gap-2">{children}</div>
        </div>
      )}
    </div>
  );

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm dark:bg-gray-900 dark:border-gray-800">
      <div className="flex flex-col h-full bg-white dark:bg-gray-900">
        <div className="p-4 border-b border-gray-200 dark:border-gray-800">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Filter size={18} className="text-gray-400" />
              <h2 className="text-sm font-bold text-gray-900 dark:text-white uppercase tracking-wider">Filters</h2>
            </div>
            <button
              onClick={clearFilters}
              className="inline-flex items-center justify-center rounded-lg font-semibold transition-all focus:outline-none focus:ring-4 focus:ring-primary-100 disabled:opacity-50 disabled:cursor-not-allowed bg-transparent text-gray-600 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200 py-2 gap-2 h-8 px-2 text-xs"
            >
              <RotateCcw size={14} className="mr-1.5" /> Reset
            </button>
          </div>

          <div className="space-y-4">
            <Input
              value={filters.name}
              onChange={(e) => setField('name', e.target.value)}
              placeholder="Search by name..."
              icon={Search}
              className="h-9"
            />

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-gray-500 uppercase tracking-wider dark:text-gray-400">
                Category
              </label>
              <select
                value={filters.category}
                onChange={(e) => setField('category', e.target.value)}
                className="w-full h-10 px-3 py-1 text-sm bg-white border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-4 focus:ring-primary-100 focus:border-primary-300 transition-all dark:bg-gray-950 dark:border-gray-700 dark:text-white dark:focus:ring-primary-900/30 dark:focus:border-primary-500"
              >
                {allCategoryOptions.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt === 'all' ? 'All Categories' : opt === 'none' ? 'No Category' : opt}
                  </option>
                ))}
              </select>
            </div>

            <Button
              variant={filters.changedOnly ? 'secondary-color' : 'secondary-gray'}
              className="w-full text-xs py-2 px-3"
              onClick={() => setField('changedOnly', !filters.changedOnly)}
            >
              {filters.changedOnly ? 'Showing Changed Only' : 'Show Changed Only'}
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin">
          <AccordionItem
            title="Usage"
            isOpen={usageOpen}
            onToggle={() => setUsageOpen(!usageOpen)}
            onManage={() => onManage('usage')}
            badge={filters.usage.length}
          >
            {['None', ...definitions.usageflags].map((opt) => (
              <Badge
                key={opt}
                color={filters.usage.includes(opt) ? 'brand' : 'gray'}
                size="sm"
                className="cursor-pointer py-1.5 px-3"
                onClick={() => toggleUsage(opt)}
              >
                {opt}
              </Badge>
            ))}
          </AccordionItem>

          <AccordionItem
            title="Value"
            isOpen={valueOpen}
            onToggle={() => setValueOpen(!valueOpen)}
            onManage={() => onManage('value')}
            badge={filters.value.length}
          >
            {['None', ...definitions.valueflags].map((opt) => (
              <Badge
                key={opt}
                color={filters.value.includes(opt) ? 'brand' : 'gray'}
                size="sm"
                className="cursor-pointer py-1.5 px-3"
                onClick={() => toggleValue(opt)}
              >
                {opt}
              </Badge>
            ))}
          </AccordionItem>

          <AccordionItem
            title="Tags"
            isOpen={tagOpen}
            onToggle={() => setTagOpen(!tagOpen)}
            onManage={() => onManage('tag')}
            badge={filters.tag.length}
          >
            {definitions.tags.map((opt) => (
              <Badge
                key={opt}
                color={filters.tag.includes(opt) ? 'brand' : 'gray'}
                size="sm"
                className="cursor-pointer py-1.5 px-3"
                onClick={() => {
                  const curr = filters.tag;
                  const next = curr.includes(opt) ? curr.filter((x) => x !== opt) : [...curr, opt];
                  setField('tag', next);
                }}
              >
                {opt}
              </Badge>
            ))}
          </AccordionItem>

          <AccordionItem
            title="Flags"
            isOpen={flagsOpen}
            onToggle={() => setFlagsOpen(!flagsOpen)}
            badge={filters.flags.length}
          >
            {['None', ...flagsList].map((opt) => (
              <Badge
                key={opt}
                color={filters.flags.includes(opt) ? 'brand' : 'gray'}
                size="sm"
                className="cursor-pointer py-1.5 px-3"
                onClick={() => toggleFlag(opt)}
              >
                {opt.replace('count_in_', '').replace('_', ' ')}
              </Badge>
            ))}
          </AccordionItem>

          {hasNonVanillaGroups && (
            <AccordionItem
              title="Groups"
              isOpen={groupsOpen}
              onToggle={() => setGroupsOpen(!groupsOpen)}
              badge={filters.groups.length}
            >
              {groups.map((g) => (
                <Badge
                  key={g}
                  color={filters.groups.includes(g) ? 'brand' : 'gray'}
                  size="sm"
                  className="cursor-pointer py-1.5 px-3"
                  onClick={() => toggleGroup(g)}
                >
                  {g}
                </Badge>
              ))}
            </AccordionItem>
          )}
        </div>

        <div className="p-4 bg-gray-50 border-t border-gray-200 dark:bg-gray-950 dark:border-gray-800">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider dark:text-gray-400">
              Matching
            </span>
            <span className="size-max flex items-center whitespace-nowrap rounded-full ring-1 ring-inset py-0.5 px-2.5 text-sm font-medium bg-primary-50 text-primary-700 ring-primary-200 dark:bg-primary-900/10 dark:text-primary-300 dark:ring-primary-900/20">
              {matchingCount} types
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
