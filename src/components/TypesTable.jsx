import React, {useEffect, useMemo, useRef, useState} from 'react';
import { Row as AriaRow } from 'react-aria-components';
import { formatLifetime } from '../utils/time.js';
import { Table, TableCard } from './application/table/table';
import { Badge } from './base/badges/badges';
import { cx } from '../utils/cx';
import { ArrowUp, ArrowDown, Check, AlertCircle, AlertTriangle } from 'lucide-react';
import { Button } from './ui/Button';

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
    <div className={cx("h-full flex flex-col bg-white dark:bg-gray-900 overflow-hidden", !condensed && "rounded-xl border border-gray-200 shadow-sm dark:border-gray-800")}>
      <div className="flex-1 overflow-hidden flex flex-col min-h-0">
        <Table 
          ref={containerRef}
          onScroll={handleScroll}
          size="sm"
          aria-label="Types" 
          containerClassName="flex-1 min-h-0"
          selectionMode="multiple"
          selectionBehavior="none"
          selectedKeys={selection}
          onSelectionChange={(keys) => {
            if (keys === 'all') {
              setSelection(new Set(rows.map(r => r.name)));
            } else {
              setSelection(new Set(keys));
            }
          }}
        >
          <Table.Header 
            className="shrink-0 [&>tr]:grid [&>tr]:[grid-template-columns:var(--grid-template-columns)] [&>tr]:select-none [&>tr]:border-b [&>tr]:border-gray-200 [&>tr]:dark:border-gray-800 [&>tr]:bg-gray-50/50 [&>tr]:dark:bg-gray-950/20"
            style={{ '--grid-template-columns': gridTemplateColumns }}
          >
            <Table.Head 
              isRowHeader
                className="flex items-center cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors group px-4"
                onClick={() => handleSort('name')}
              >
                <span className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Name</span>
                <SortIcon column="name" />
                <div className="ml-auto flex items-center gap-2">
                  <Button 
                      variant="link-gray" 
                      size="sm" 
                      onClick={(e) => { e.stopPropagation(); selection.size > 0 ? clearSelection() : selectAll(); }}
                      className="text-[10px] uppercase tracking-tighter"
                  >
                      {selection.size > 0 ? 'Clear' : 'All'}
                  </Button>
                </div>
              </Table.Head>
              {showGroupColumn && !condensed && (
                <Table.Head 
                  className="flex items-center cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors group px-4"
                  onClick={() => handleSort('group')}
                >
                  <span className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Group</span>
                  <SortIcon column="group" />
                </Table.Head>
              )}
              <Table.Head 
                className="flex items-center cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-right justify-end group px-4"
                onClick={() => handleSort('nominal')}
              >
                <span className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Nom</span>
                <SortIcon column="nominal" />
              </Table.Head>
              <Table.Head className="text-right px-4 justify-end">
                <span className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Min</span>
              </Table.Head>
              
              {!condensed && (
                <>
                  <Table.Head 
                    className="flex items-center cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-right justify-end group px-4"
                    onClick={() => handleSort('lifetime')}
                  >
                    <span className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Lifetime</span>
                    <SortIcon column="lifetime" />
                  </Table.Head>
                  <Table.Head className="px-4">
                    <span className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Category</span>
                  </Table.Head>
                  <Table.Head className="px-4">
                    <span className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Usage</span>
                  </Table.Head>
                  <Table.Head className="px-4">
                    <span className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Value</span>
                  </Table.Head>
                </>
              )}
          </Table.Header>

          <Table.Body 
            className="divide-y-0 relative block dark:bg-gray-900"
            style={{ paddingTop: topPad, paddingBottom: bottomPad }}
          >
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
                    "grid border-b border-gray-100 dark:border-gray-800 transition-all",
                    "hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer",
                    t.hasUnknown && "bg-warning-50/20 dark:bg-warning-900/5",
                    selected && "bg-primary-50/50 dark:bg-primary-900/10 hover:bg-primary-50 dark:hover:bg-primary-900/20"
                  )}
                  style={{ height: `${rowHeight}px`, gridTemplateColumns }}
                  onClick={e => onRowClick(e, globalIndex, t.name)}
                >
                  <Table.Cell 
                    className="gap-3 px-4 flex items-center"
                  >
                    <div className={cx(
                      "size-4 rounded border flex items-center justify-center shrink-0 transition-all",
                      selected ? "bg-primary-600 border-primary-600 dark:bg-primary-500 dark:border-primary-500" : "bg-white border-gray-300 dark:bg-gray-800 dark:border-gray-700"
                    )}>
                      {selected && <Check size={12} className="text-white" strokeWidth={3} />}
                    </div>
                    <span className={cx(
                      "truncate font-semibold",
                      selected ? "text-primary-700 dark:text-primary-300" : "text-gray-900 dark:text-gray-100",
                      isModified && "text-primary-600 dark:text-primary-400"
                    )}>
                      {t.name}
                    </span>
                    {(() => {
                      const groups = duplicatesByName[t.name] || [];
                      const count = groups.filter(g => g !== t.group).length;
                      return count > 0 && <Badge color="warning" size="sm">+{count}</Badge>;
                    })()}
                    {t.hasUnknown && <AlertTriangle size={14} className="text-warning-500 shrink-0" />}
                  </Table.Cell>

                  {showGroupColumn && !condensed && (
                    <Table.Cell className="px-4 flex items-center">
                      <Badge color="gray" size="sm" type="modern">{t.group || 'vanilla'}</Badge>
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
                        ) : <span className="text-gray-300 dark:text-gray-700 font-mono">—</span>}
                      </Table.Cell>
                      <Table.Cell className="gap-1 px-4 flex items-center">
                        {t.usage?.slice(0, 2).map(u => (
                          <Badge key={u} color="gray" size="sm">{u}</Badge>
                        ))}
                        {(t.usage?.length || 0) > 2 && <Badge color="gray" size="sm">+{t.usage.length - 2}</Badge>}
                        {(t.usage?.length || 0) === 0 && <span className="text-gray-300 dark:text-gray-700 font-mono">—</span>}
                      </Table.Cell>
                      <Table.Cell className="gap-1 px-4 flex items-center">
                        {t.value?.slice(0, 2).map(v => (
                          <Badge key={v} color="gray" size="sm">{v}</Badge>
                        ))}
                        {(t.value?.length || 0) > 2 && <Badge color="gray" size="sm">+{t.value.length - 2}</Badge>}
                        {(t.value?.length || 0) === 0 && <span className="text-gray-300 dark:text-gray-700 font-mono">—</span>}
                      </Table.Cell>
                    </>
                  )}
                </Table.Row>
              );
            })}
          </Table.Body>
        </Table>
      </div>

      <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 dark:border-gray-800 shrink-0 bg-gray-50/50 dark:bg-gray-950/20">
        <div className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-4">
          <span>Showing <span className="font-bold text-gray-900 dark:text-white">{rows.length}</span> types</span>
          {selection.size > 0 && (
            <div className="flex items-center gap-1.5">
              <div className="w-1 h-1 bg-gray-300 rounded-full dark:bg-gray-700" />
              <span className="font-bold text-primary-600 dark:text-primary-400">{selection.size} selected</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {condensed && <Badge color="success" size="sm" type="modern" className="animate-pulse">Active Editor</Badge>}
        </div>
      </div>
    </div>
  );
}
