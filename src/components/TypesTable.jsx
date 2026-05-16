import React, {useEffect, useMemo, useRef, useState} from 'react';
import { formatLifetime } from '../utils/time.js';
import { Badge } from './ui/Badge';
import { cn } from '../utils/cn';
import { ArrowUp, ArrowDown, Check, AlertCircle } from 'lucide-react';

/**
 * @typedef {import('../utils/xml.js').Type} Type
 */

/**
 * @param {{
 *  definitions: {categories: string[], usageflags: string[], valueflags: string[], tags: string[]},
 *  types: (Type & {group?: string, file?: string})[],
 *  selection: Set<string>,
 *  setSelection: (sel: Set<string>) => void,
 *  unknowns: { byType: Record<string, { category?: string[], usage: string[], value: string[], tag: string[] }>}
 *  condensed?: boolean,
 *  duplicatesByName?: Record<string, string[]>,
 *  storageDiff?: { files: Record<string, Record<string, { changedNames?: string[] }>> }
 * }} props
 */
export default function TypesTable({ definitions, types, selection, setSelection, unknowns, condensed: condensedProp, duplicatesByName = {}, storageDiff, showGroupColumn = true }) {
  const [sort, setSort] = useState(/** @type {{key: null | 'name' | 'group' | 'nominal' | 'lifetime' | 'restock' | 'usage' | 'value', dir: 'asc' | 'desc'}} */({ key: 'name', dir: 'asc' }));

  // Virtualization state
  const containerRef = useRef(/** @type {HTMLDivElement|null} */(null));
  const rowHeight = 48; // Taller rows for Untitled UI
  const [viewportHeight, setViewportHeight] = useState(600);
  const [scrollTop, setScrollTop] = useState(0);
  const overscan = 10;

  const rows = useMemo(() => {
    const arr = types.map(t => {
      const unk = unknowns.byType[t.name] || { usage: [], value: [], tag: [] };
      const hasUnknown = (unk.usage?.length || 0) + (unk.value?.length || 0) + (unk.tag?.length || 0) + (unk.category ? 1 : 0) > 0;
      return { ...t, hasUnknown, unk };
    });

    if (sort.key) {
      const getVal = (r) => {
        if (sort.key === 'usage' || sort.key === 'value') {
          return (r[sort.key] || []).join(',').toLowerCase();
        }
        if (sort.key === 'name') {
          return String(r.name).toLowerCase();
        }
        if (sort.key === 'group') {
          return String(r.group || '').toLowerCase();
        }
        return Number(r[sort.key] ?? 0);
      };
      arr.sort((a, b) => {
        const av = getVal(a);
        const bv = getVal(b);
        let cmp = 0;
        if (typeof av === 'number' && typeof bv === 'number') {
          cmp = av - bv;
        } else {
          cmp = av < bv ? -1 : av > bv ? 1 : 0;
        }
        return sort.dir === 'asc' ? cmp : -cmp;
      });
    }

    return arr;
  }, [types, unknowns, sort]);

  const maxNameWidth = useMemo(() => {
    if (types.length === 0) return 20;
    let max = 0;
    for (const t of types) {
      if (t.name && t.name.length > max) max = t.name.length;
    }
    // Add some padding for the icon (approx 4-5ch) and badges
    return Math.min(max + 10, 80);
  }, [types]);

  // Measure viewport height
  useEffect(() => {
    const updateViewport = () => {
      if (containerRef.current) {
        setViewportHeight(containerRef.current.clientHeight);
      }
    };
    updateViewport();
    window.addEventListener('resize', updateViewport);
    return () => window.removeEventListener('resize', updateViewport);
  }, []);

  const handleScroll = (e) => {
    setScrollTop(e.currentTarget.scrollTop);
  };

  // Compute visible window
  const total = rows.length;
  const visibleCount = Math.max(1, Math.ceil(viewportHeight / rowHeight) + overscan);
  const startIndex = Math.max(0, Math.min(Math.max(0, total - visibleCount), Math.floor(scrollTop / rowHeight)));
  const endIndex = Math.min(total, startIndex + visibleCount);
  const topPad = startIndex * rowHeight;
  const bottomPad = Math.max(0, (total - endIndex) * rowHeight);
  const visibleRows = rows.slice(startIndex, endIndex);

  const handleSort = (key) => {
    setSort(prev => {
      if (prev.key !== key) return { key, dir: 'asc' };
      if (prev.dir === 'asc') return { key, dir: 'desc' };
      return { key: null, dir: 'asc' };
    });
  };

  const anchorRef = useRef(null);

  const onRowClick = (e, index, name) => {
    const isToggle = e.metaKey || e.ctrlKey;
    const isRange = e.shiftKey;
    const next = new Set(selection);

    if (isRange) {
      const anchor = anchorRef.current ?? index;
      const start = Math.min(anchor, index);
      const end = Math.max(anchor, index);
      const rangeNames = rows.slice(start, end + 1).map(r => r.name);

      if (isToggle) {
        rangeNames.forEach(n => next.has(n) ? next.delete(n) : next.add(n));
      } else {
        next.clear();
        rangeNames.forEach(n => next.add(n));
      }
    } else {
      if (isToggle) {
        if (next.has(name)) next.delete(name);
        else next.add(name);
      } else {
        next.clear();
        next.add(name);
      }
      anchorRef.current = index;
    }

    setSelection(next);
  };

  const selectAll = () => {
    setSelection(new Set(rows.map(r => r.name)));
  };

  const clearSelection = () => {
    setSelection(new Set());
  };

  const condensed = typeof condensedProp === 'boolean' ? condensedProp : (selection.size > 0);

  const gridTemplateColumns = useMemo(() => {
    const parts = [`${maxNameWidth}ch`];
    if (showGroupColumn && !condensed) parts.push('8rem');
    parts.push('5rem'); // Nom
    parts.push('5rem'); // Min
    if (!condensed) {
      parts.push('6rem'); // Lifetime
      parts.push('8rem'); // Category
      parts.push('minmax(150px, 1fr)'); // Usage
      parts.push('minmax(150px, 1fr)'); // Value
    }
    return parts.join(' ');
  }, [maxNameWidth, showGroupColumn, condensed]);

  const SortIcon = ({ column }) => {
    if (sort.key !== column) return <ArrowUp size={14} className="ml-1 opacity-0 group-hover:opacity-30 transition-opacity" />;
    return sort.dir === 'asc' ? <ArrowUp size={14} className="ml-1 text-primary-600 dark:text-primary-400" /> : <ArrowDown size={14} className="ml-1 text-primary-600 dark:text-primary-400" />;
  };

  return (
    <div
      className={cn(
        "flex flex-col h-full bg-white text-sm relative dark:bg-gray-900 dark:text-gray-300",
        condensed && "condensed w-fit"
      )}
    >
      <div 
        className="grid border-b border-gray-200 bg-gray-50 sticky top-0 z-20 shrink-0 select-none dark:border-gray-800 dark:bg-gray-900/50 dark:backdrop-blur-md"
        style={{ gridTemplateColumns }}
      >
        <div 
          className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center cursor-pointer hover:bg-gray-100 transition-colors dark:text-gray-400 dark:hover:bg-gray-800 group"
          onClick={() => handleSort('name')}
        >
          <span>Name</span>
          <SortIcon column="name" />
          <button
            onClick={(e) => { e.stopPropagation(); selection.size > 0 ? clearSelection() : selectAll(); }}
            className="ml-auto text-[10px] font-bold text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300 transition-colors"
          >
            {selection.size > 0 ? 'CLEAR SELECTION' : 'SELECT ALL'}
          </button>
        </div>
        {showGroupColumn && !condensed && (
          <div 
            className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center cursor-pointer hover:bg-gray-100 transition-colors dark:text-gray-400 dark:hover:bg-gray-800 group"
            onClick={() => handleSort('group')}
          >
            <span>Group</span>
            <SortIcon column="group" />
          </div>
        )}
        <div 
          className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center cursor-pointer hover:bg-gray-100 transition-colors text-right justify-end dark:text-gray-400 dark:hover:bg-gray-800 group"
          onClick={() => handleSort('nominal')}
        >
          <span>Nom</span>
          <SortIcon column="nominal" />
        </div>
        <div className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider text-right dark:text-gray-400">Min</div>
        
        {!condensed && (
          <>
            <div 
              className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center cursor-pointer hover:bg-gray-100 transition-colors text-right justify-end dark:text-gray-400 dark:hover:bg-gray-800 group"
              onClick={() => handleSort('lifetime')}
            >
              <span>Lifetime</span>
              <SortIcon column="lifetime" />
            </div>
            <div className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider dark:text-gray-400">Category</div>
            <div className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider dark:text-gray-400">Usage</div>
            <div className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider dark:text-gray-400">Value</div>
          </>
        )}
      </div>

      <div 
        className="flex-1 overflow-auto scrollbar-thin" 
        ref={containerRef}
        onScroll={handleScroll}
      >
        <div style={{ height: `${topPad}px` }} />
        
        {visibleRows.map((t, i) => {
          const globalIndex = startIndex + i;
          const selected = selection.has(t.name);
          const isModified = (() => {
            const g = t.group || '';
            const f = t.file || 'types';
            const changedSet = storageDiff?.files?.[g]?.[f]?.changedNames || [];
            return changedSet.includes(t.name);
          })();

          return (
            <div
              key={`${t.name}-${globalIndex}`}
              className={cn(
                "grid border-b border-gray-100 hover:bg-gray-50 transition-colors cursor-pointer group dark:border-gray-800/50 dark:hover:bg-gray-900/50",
                selected && "bg-primary-50/50 hover:bg-primary-50 border-primary-100 z-10 sticky dark:bg-primary-900/10 dark:border-primary-900/50 dark:hover:bg-primary-900/20",
                t.hasUnknown && "bg-warning-50/30 dark:bg-warning-900/5"
              )}
              style={{ height: `${rowHeight}px`, gridTemplateColumns }}
              onClick={e => onRowClick(e, globalIndex, t.name)}
            >
              <div 
                className="px-4 flex items-center gap-3 overflow-hidden"
              >
                <div className={cn(
                  "size-4 rounded border flex items-center justify-center shrink-0 transition-all",
                  selected ? "bg-primary-600 border-primary-600 dark:bg-primary-500 dark:border-primary-500" : "bg-white border-gray-300 group-hover:border-primary-300 dark:bg-gray-800 dark:border-gray-700 dark:group-hover:border-primary-500"
                )}>
                  {selected && <Check size={12} className="text-white" strokeWidth={3} />}
                </div>
                <span className={cn(
                  "truncate font-medium",
                  selected ? "text-primary-700 dark:text-primary-300" : "text-gray-900 dark:text-gray-100",
                  isModified && "text-primary-600 dark:text-primary-400"
                )}>
                  {t.name}
                </span>
                {(() => {
                  const groups = duplicatesByName[t.name] || [];
                  const count = groups.filter(g => g !== t.group).length;
                  return count > 0 && <Badge variant="warning" className="px-1 py-0 text-[10px]">+{count}</Badge>;
                })()}
                {t.hasUnknown && <AlertCircle size={14} className="text-warning-500 shrink-0" />}
              </div>

              {showGroupColumn && !condensed && (
                <div className="px-4 flex items-center overflow-hidden">
                  <Badge variant="gray" className="truncate text-xs font-normal bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700">{t.group || 'vanilla'}</Badge>
                </div>
              )}

              <div className="px-4 flex items-center justify-end font-mono text-gray-700 dark:text-gray-300">{t.nominal}</div>
              <div className="px-4 flex items-center justify-end font-mono text-gray-400 dark:text-gray-500">{t.min}</div>

              {!condensed && (
                <>
                  <div className="px-4 flex items-center justify-end font-mono text-gray-500 dark:text-gray-400">
                    {formatLifetime(Number(t.lifetime))}
                  </div>
                  <div className="px-4 flex items-center overflow-hidden">
                    {t.category ? (
                      <Badge variant={definitions.categories.includes(t.category) ? "primary" : "error"} className="truncate text-xs">
                        {t.category}
                      </Badge>
                    ) : <span className="text-gray-300 dark:text-gray-700">—</span>}
                  </div>
                  <div className="px-4 flex items-center gap-1 overflow-hidden">
                    {t.usage?.slice(0, 2).map(u => (
                      <Badge key={u} variant="gray" className="truncate text-xs font-normal">{u}</Badge>
                    ))}
                    {(t.usage?.length || 0) > 2 && <Badge variant="gray" className="text-xs">+{t.usage.length - 2}</Badge>}
                    {(t.usage?.length || 0) === 0 && <span className="text-gray-300 dark:text-gray-700">—</span>}
                  </div>
                  <div className="px-4 flex items-center gap-1 overflow-hidden">
                    {t.value?.slice(0, 2).map(v => (
                      <Badge key={v} variant="gray" className="truncate text-xs font-normal">{v}</Badge>
                    ))}
                    {(t.value?.length || 0) > 2 && <Badge variant="gray" className="text-xs">+{t.value.length - 2}</Badge>}
                    {(t.value?.length || 0) === 0 && <span className="text-gray-300 dark:text-gray-700">—</span>}
                  </div>
                </>
              )}
            </div>
          );
        })}
        
        <div style={{ height: `${bottomPad}px` }} />
      </div>

      <div className="px-4 py-3 border-t border-gray-200 bg-white flex items-center justify-between text-xs text-gray-500 shrink-0 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400">
        <div>
          Showing <span className="font-semibold text-gray-900 dark:text-gray-200">{rows.length}</span> types
          {selection.size > 0 && (
            <>
              {' '}&bull;{' '}
              <span className="font-semibold text-primary-600 dark:text-primary-400">{selection.size}</span> selected
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          {condensed && <Badge variant="gray" className="text-[10px] uppercase tracking-wider font-bold py-0 px-1 border-gray-200 dark:border-gray-700">Condensed View</Badge>}
        </div>
      </div>
    </div>
  );
}
