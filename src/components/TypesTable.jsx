import React, {useEffect, useMemo, useRef, useState} from 'react';
import { formatLifetime } from '../utils/time.js';
import { Table, TableCard } from './application/table/table';
import { Badge } from './base/badges/badges';
import { cx } from '../utils/cx';
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
  const rowHeight = 56; // Matching Untitled UI 'sm' size
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
    return sort.dir === 'asc' ? <ArrowUp size={14} className="ml-1 text-primary-600 dark:text-brand-400" /> : <ArrowDown size={14} className="ml-1 text-primary-600 dark:text-brand-400" />;
  };

  return (
    <TableCard.Root className={cx("h-full border-none shadow-none ring-0 rounded-none bg-white dark:bg-gray-950 flex flex-col", condensed && "w-fit")}>
      <Table 
        size="sm"
        aria-label="Types" 
        className="flex-1 flex flex-col min-h-0"
      >
        <Table.Header 
          className="grid shrink-0 select-none border-b border-secondary"
          style={{ gridTemplateColumns }}
        >
          <Table.Head 
            className="flex items-center cursor-pointer hover:bg-secondary transition-colors group px-4"
            onClick={() => handleSort('name')}
          >
            <span className="text-xs font-semibold uppercase tracking-wider text-tertiary">Name</span>
            <SortIcon column="name" />
            <button
              onClick={(e) => { e.stopPropagation(); selection.size > 0 ? clearSelection() : selectAll(); }}
              className="ml-auto text-[10px] font-bold text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300 transition-colors"
            >
              {selection.size > 0 ? 'CLEAR SELECTION' : 'SELECT ALL'}
            </button>
          </Table.Head>
          {showGroupColumn && !condensed && (
            <Table.Head 
              className="flex items-center cursor-pointer hover:bg-secondary transition-colors group px-4"
              onClick={() => handleSort('group')}
            >
              <span className="text-xs font-semibold uppercase tracking-wider text-tertiary">Group</span>
              <SortIcon column="group" />
            </Table.Head>
          )}
          <Table.Head 
            className="flex items-center cursor-pointer hover:bg-secondary transition-colors text-right justify-end group px-4"
            onClick={() => handleSort('nominal')}
          >
            <span className="text-xs font-semibold uppercase tracking-wider text-tertiary">Nom</span>
            <SortIcon column="nominal" />
          </Table.Head>
          <Table.Head className="text-right px-4 justify-end">
            <span className="text-xs font-semibold uppercase tracking-wider text-tertiary">Min</span>
          </Table.Head>
          
          {!condensed && (
            <>
              <Table.Head 
                className="flex items-center cursor-pointer hover:bg-secondary transition-colors text-right justify-end group px-4"
                onClick={() => handleSort('lifetime')}
              >
                <span className="text-xs font-semibold uppercase tracking-wider text-tertiary">Lifetime</span>
                <SortIcon column="lifetime" />
              </Table.Head>
              <Table.Head className="px-4">
                <span className="text-xs font-semibold uppercase tracking-wider text-tertiary">Category</span>
              </Table.Head>
              <Table.Head className="px-4">
                <span className="text-xs font-semibold uppercase tracking-wider text-tertiary">Usage</span>
              </Table.Head>
              <Table.Head className="px-4">
                <span className="text-xs font-semibold uppercase tracking-wider text-tertiary">Value</span>
              </Table.Head>
            </>
          )}
        </Table.Header>

        <Table.Body 
          className="flex-1 overflow-auto scrollbar-thin divide-y-0 relative block" 
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
              <Table.Row
                key={`${t.name}-${globalIndex}`}
                className={cx(
                  "grid border-b border-secondary hover:bg-secondary transition-colors",
                  t.hasUnknown && "bg-warning-50/30 dark:bg-warning-900/5",
                  selected && "bg-brand-50/50 dark:bg-brand-900/10"
                )}
                style={{ height: `${rowHeight}px`, gridTemplateColumns }}
                onClick={e => onRowClick(e, globalIndex, t.name)}
              >
                <Table.Cell 
                  className="gap-3 px-4 flex items-center"
                >
                  <div className={cx(
                    "size-4 rounded border flex items-center justify-center shrink-0 transition-all",
                    selected ? "bg-brand-600 border-brand-600 dark:bg-brand-500 dark:border-brand-500" : "bg-white border-secondary group-hover:border-brand-300 dark:bg-gray-800 dark:border-gray-700 dark:group-hover:border-brand-500"
                  )}>
                    {selected && <Check size={12} className="text-white" strokeWidth={3} />}
                  </div>
                  <span className={cx(
                    "truncate font-medium",
                    selected ? "text-brand-700 dark:text-brand-300" : "text-gray-900 dark:text-gray-100",
                    isModified && "text-brand-600 dark:text-brand-400"
                  )}>
                    {t.name}
                  </span>
                  {(() => {
                    const groups = duplicatesByName[t.name] || [];
                    const count = groups.filter(g => g !== t.group).length;
                    return count > 0 && <Badge color="warning" size="sm">+{count}</Badge>;
                  })()}
                  {t.hasUnknown && <AlertCircle size={14} className="text-warning-500 shrink-0" />}
                </Table.Cell>

                {showGroupColumn && !condensed && (
                  <Table.Cell className="px-4 flex items-center">
                    <Badge color="gray" size="sm">{t.group || 'vanilla'}</Badge>
                  </Table.Cell>
                )}

                <Table.Cell className="justify-end font-mono text-gray-700 dark:text-gray-300 px-4 flex items-center">{t.nominal}</Table.Cell>
                <Table.Cell className="justify-end font-mono text-gray-400 dark:text-gray-500 px-4 flex items-center">{t.min}</Table.Cell>

                {!condensed && (
                  <>
                    <Table.Cell className="justify-end font-mono text-gray-500 dark:text-gray-400 px-4 flex items-center">
                      {formatLifetime(Number(t.lifetime))}
                    </Table.Cell>
                    <Table.Cell className="px-4 flex items-center">
                      {t.category ? (
                        <Badge color={definitions.categories.includes(t.category) ? "brand" : "error"} size="sm">
                          {t.category}
                        </Badge>
                      ) : <span className="text-gray-300 dark:text-gray-700">—</span>}
                    </Table.Cell>
                    <Table.Cell className="gap-1 px-4 flex items-center">
                      {t.usage?.slice(0, 2).map(u => (
                        <Badge key={u} color="gray" size="sm">{u}</Badge>
                      ))}
                      {(t.usage?.length || 0) > 2 && <Badge color="gray" size="sm">+{t.usage.length - 2}</Badge>}
                      {(t.usage?.length || 0) === 0 && <span className="text-gray-300 dark:text-gray-700">—</span>}
                    </Table.Cell>
                    <Table.Cell className="gap-1 px-4 flex items-center">
                      {t.value?.slice(0, 2).map(v => (
                        <Badge key={v} color="gray" size="sm">{v}</Badge>
                      ))}
                      {(t.value?.length || 0) > 2 && <Badge color="gray" size="sm">+{t.value.length - 2}</Badge>}
                      {(t.value?.length || 0) === 0 && <span className="text-gray-300 dark:text-gray-700">—</span>}
                    </Table.Cell>
                  </>
                )}
              </Table.Row>
            );
          })}
          
          <div style={{ height: `${bottomPad}px` }} />
        </Table.Body>
      </Table>

      <div className="flex items-center justify-between px-6 py-4 border-t border-secondary shrink-0 bg-primary dark:bg-gray-950">
        <div className="text-sm text-tertiary">
          Showing <span className="font-semibold text-primary">{rows.length}</span> types
          {selection.size > 0 && (
            <>
              {' '}&bull;{' '}
              <span className="font-semibold text-brand-600 dark:text-brand-400">{selection.size}</span> selected
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          {condensed && <Badge color="success" size="sm" className="animate-pulse">Condensed View</Badge>}
        </div>
      </div>
    </TableCard.Root>
  );
}
