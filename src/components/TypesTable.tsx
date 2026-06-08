import { useEffect, useMemo, useRef, useState, type UIEvent, type CSSProperties } from 'react';
import { Selection } from 'react-aria-components';
import { formatLifetime } from '@/utils/time';
import { Table, TableCard } from '@/components/application/table/table';
import { Badge } from '@/components/base/badges/badges';
import { cx } from '@/utils/cx';
import { AlertCircle, Milk } from 'lucide-react';
import { Button } from '@/components/base/button/button';
import type { Type } from '@/utils/xml';

interface TypesTableProps {
  types: (Type & { group?: string; file?: string })[];
  selection: Set<string>;
  setSelection: (sel: Set<string>) => void;
  lastClickedId: string | null;
  setLastClickedId: (id: string | null) => void;
  unknowns: {
    byType: Record<string, { category?: string[]; usage: string[]; value: string[]; tag: string[] }>;
  };
  storageDiff?: {
    files: Record<string, Record<string, { changedNames?: string[] }>>;
  };
  showGroupColumn?: boolean;
}

type SortKey = 'name' | 'group' | 'nominal' | 'lifetime' | 'restock' | 'usage' | 'value';

export default function TypesTable({
  types,
  selection,
  setSelection,
  lastClickedId,
  setLastClickedId,
  unknowns,
  storageDiff,
  showGroupColumn = true,
}: TypesTableProps) {
  const [sort, setSort] = useState<{ key: SortKey | null; dir: 'asc' | 'desc' }>({
    key: 'name',
    dir: 'asc',
  });

  // Virtualization state
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rowHeight = 56; // Matching Untitled UI 'sm' size
  const [viewportHeight, setViewportHeight] = useState(600);
  const [scrollTop, setScrollTop] = useState(0);
  const overscan = 10;
  const lastEventWasShift = useRef(false);

  const rows = useMemo(() => {
    const arr = types.map((t) => {
      const unk = unknowns.byType[t.name] || { usage: [], value: [], tag: [] };
      const hasUnknown =
        (unk.usage?.length || 0) +
          (unk.value?.length || 0) +
          (unk.tag?.length || 0) +
          (unk.category ? 1 : 0) >
        0;
      return { ...t, hasUnknown, unk };
    });

    if (sort.key) {
      const currentKey = sort.key;
      const getVal = (r: any) => {
        if (currentKey === 'usage' || currentKey === 'value') {
          return (r[currentKey] || []).join(',').toLowerCase();
        }
        if (currentKey === 'name') {
          return String(r.name).toLowerCase();
        }
        if (currentKey === 'group') {
          return String(r.group || '').toLowerCase();
        }
        return Number(r[currentKey] ?? 0);
      };
      arr.sort((a, b) => {
        const av = getVal(a);
        const bv = getVal(b);
        const cmp = (typeof av === 'number' && typeof bv === 'number')
          ? av - bv
          : (av < bv ? -1 : av > bv ? 1 : 0);
        return sort.dir === 'asc' ? cmp : -cmp;
      });
    }

    return arr;
  }, [types, unknowns, sort]);

  const maxNameWidth = useMemo(() => {
    if (rows.length === 0) return 20;
    let max = 0;
    for (const r of rows) {
      let width = r.name.length;
      if (r.hasUnknown) width += 10;
      if (r.group === 'vanilla_overrides') width += 4;
      if (width > max)
      {
        max = width;
      }
    }
    // Header needs space for "Name" + "All" button
    const headerWidth = 14;
    return Math.min(Math.max(max, headerWidth) + 4, 40);
  }, [rows]);

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

  const handleScroll = (e: UIEvent<HTMLDivElement>) => {
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

  const handleSort = (key: SortKey) => {
    setSort((prev) => {
      if (prev.key !== key) return { key, dir: 'asc' };
      if (prev.dir === 'asc') return { key, dir: 'desc' };
      return { key: null, dir: 'asc' };
    });
  };

  const handleSelectionChange = (keys: Selection) => {
    let nextSelection: Set<string>;
    if (keys === 'all') {
      nextSelection = new Set(rows.map((r) => r.name));
    } else {
      nextSelection = new Set(Array.from(keys).map(String));
    }

    if (lastEventWasShift.current && lastClickedId && keys !== 'all') {
      // Determine what was just toggled
      const added = Array.from(nextSelection).find(k => !selection.has(k));
      const removed = Array.from(selection).find(k => !nextSelection.has(k));
      const target = added || removed;

      if (target && target !== lastClickedId) {
        const currentIndex = rows.findIndex((r) => r.name === target);
        const lastIndex = rows.findIndex((r) => r.name === lastClickedId);

        if (currentIndex !== -1 && lastIndex !== -1) {
          const start = Math.min(currentIndex, lastIndex);
          const end = Math.max(currentIndex, lastIndex);
          for (let i = start; i <= end; i++) {
            if (added) {
              nextSelection.add(rows[i].name);
            } else {
              nextSelection.delete(rows[i].name);
            }
          }
        }
      }
    }

    setSelection(nextSelection);
  };

  const isAnySelected = selection.size > 0;
  const columnWidths = useMemo(() => {
    const cols = [];
    cols.push('2.25rem'); // Selection column
    cols.push(`${maxNameWidth}ch`); // Name
    if (!isAnySelected && showGroupColumn) cols.push('7.5rem'); // Group
    cols.push('4.5rem'); // Nominal
    cols.push('4.5rem'); // Min
    if (!isAnySelected) {
      cols.push('5rem'); // Lifetime
      cols.push('7.5rem'); // Category
      cols.push('minmax(120px, 1fr)'); // Usage
      cols.push('minmax(120px, 1fr)'); // Value
    }
    return cols.join(' ');
  }, [maxNameWidth, showGroupColumn, isAnySelected]);

  const gridStyle = { '--grid-template-columns': columnWidths } as CSSProperties;

  const ariaSortDir = sort.dir === 'asc' ? 'ascending' as const : 'descending' as const;

  return (
    <TableCard className="flex-1 min-h-0 flex flex-col p-0">
      <Table
        ref={containerRef}
        aria-label="Types"
        selectionMode="multiple"
        selectionBehavior="toggle"
        size="sm"
        selectedKeys={selection}
        onSelectionChange={handleSelectionChange}
        onScroll={handleScroll}
        className="w-full min-h-full flex flex-col"
        containerClassName="flex-1 min-h-0"
        style={gridStyle}
      >
        <Table.Header 
          className="block [&>tr]:grid [&>tr]:[grid-template-columns:var(--grid-template-columns)] [&>tr]:items-stretch [&>tr]:h-full h-11 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800"
          style={{ '--grid-template-columns': columnWidths } as CSSProperties}
        >
          <Table.Column 
            isRowHeader 
            allowsSorting 
            sortDirection={sort.key === 'name' ? ariaSortDir : undefined} 
            onPress={() => handleSort('name')}
            className="px-3"
          >
            Name
            <div className="ml-auto flex items-center gap-2">
              <Button
                variant="link-gray"
                size="sm"
                className="text-[10px] uppercase tracking-tighter"
                onClick={(e) => {
                  e.stopPropagation();
                  setSelection(new Set(rows.map((r) => r.name)));
                }}
              >
                All
              </Button>
            </div>
          </Table.Column>
          {showGroupColumn && !isAnySelected && (
            <Table.Column 
              allowsSorting 
              sortDirection={sort.key === 'group' ? ariaSortDir : undefined} 
              onPress={() => handleSort('group')}
              className="px-3"
            >
              Group
            </Table.Column>
          )}
          <Table.Column 
            allowsSorting 
            sortDirection={sort.key === 'nominal' ? ariaSortDir : undefined} 
            onPress={() => handleSort('nominal')}
            className="px-3"
          >
            Nom
          </Table.Column>
          <Table.Column className="px-3">Min</Table.Column>
          {!isAnySelected && (
            <>
              <Table.Column 
                allowsSorting 
                sortDirection={sort.key === 'lifetime' ? ariaSortDir : undefined} 
                onPress={() => handleSort('lifetime')}
                className="px-3"
              >
                Lifetime
              </Table.Column>
              <Table.Column className="px-3">Category</Table.Column>
              <Table.Column 
                allowsSorting 
                sortDirection={sort.key === 'usage' ? ariaSortDir : undefined} 
                onPress={() => handleSort('usage')}
                className="px-3"
              >
                Usage
              </Table.Column>
              <Table.Column 
                allowsSorting 
                sortDirection={sort.key === 'value' ? ariaSortDir : undefined} 
                onPress={() => handleSort('value')}
                className="px-3"
              >
                Value
              </Table.Column>
            </>
          )}
        </Table.Header>

        <Table.Body
          className="flex-1 divide-y-0 relative block"
          style={{
            paddingTop: `${topPad}px`,
            paddingBottom: `${bottomPad}px`,
          }}
        >
          {visibleRows.map((row) => {
            const isSelected = selection.has(row.name);
            const isModified = storageDiff?.files[row.group || 'vanilla']?.[row.file || 'types']?.changedNames?.includes(row.name);
            const isOverride = row.group === 'vanilla_overrides';

            return (
              <Table.Row
                key={row.name}
                id={row.name}
                onPointerDown={(e) => {
                  lastEventWasShift.current = e.shiftKey;
                  // If not shifting, or if no previous anchor, this becomes the new anchor
                  if (!e.shiftKey || !lastClickedId) {
                    setLastClickedId(row.name);
                  }
                }}
                className={cx(
                  'grid items-stretch cursor-pointer transition-colors outline-none focus-visible:bg-primary-50 dark:focus-visible:bg-primary-900/10',
                  isSelected
                    ? 'bg-primary-50/50 dark:bg-primary-900/10'
                    : 'bg-white hover:bg-gray-50 dark:bg-gray-900 dark:hover:bg-gray-800/50'
                )}
                style={{
                  gridTemplateColumns: columnWidths,
                  height: `${rowHeight}px`,
                }}
              >
                <Table.Cell className="px-3 py-2 flex items-center">
                  <div className="flex items-center gap-3 flex-1">
                    <span
                      className={cx(
                        'text-sm font-semibold truncate',
                        isSelected ? 'text-primary-700 dark:text-primary-300' : 'text-gray-900 dark:text-gray-100',
                        isModified && 'text-warning-600 dark:text-warning-400'
                      )}
                      title={row.name}
                    >
                      {row.name}
                    </span>
                    {row.hasUnknown && (
                      <Badge color="error" size="sm" type="modern">
                        <AlertCircle size={12} className="mr-1" /> Unknown
                      </Badge>
                    )}
                    {isOverride && (
                        <Milk size={12} className="mr-1" />
                    )}
                  </div>
                </Table.Cell>
                {showGroupColumn && !isAnySelected && (
                  <Table.Cell className="px-3 py-2 flex items-center text-sm text-gray-500 dark:text-gray-400 truncate">
                    {row.group || '-'}
                  </Table.Cell>
                )}
                <Table.Cell className="px-3 py-2 flex items-center justify-end text-sm font-bold text-gray-900 dark:text-white">
                  {row.nominal}
                </Table.Cell>
                <Table.Cell className="px-3 py-2 flex items-center justify-end text-sm text-gray-500 dark:text-gray-400">
                  {row.min}
                </Table.Cell>
                {!isAnySelected && (
                  <>
                    <Table.Cell className="px-3 py-2 flex items-center justify-end text-sm text-gray-500 dark:text-gray-400 font-mono">
                      {formatLifetime(row.lifetime)}
                    </Table.Cell>
                    <Table.Cell className="px-3 py-2 flex items-center text-sm text-gray-500 dark:text-gray-400 truncate">
                      {row.category || '-'}
                    </Table.Cell>
                    <Table.Cell className="px-3 py-2 flex items-center gap-1 flex-wrap overflow-hidden">
                      {(row.usage || []).length > 0 ? (
                        row.usage.map((u: string) => (
                          <Badge
                            key={u}
                            color={row.unk.usage?.includes(u) ? 'error' : 'gray'}
                            size="sm"
                            className="whitespace-nowrap"
                          >
                            {u}
                          </Badge>
                        ))
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </Table.Cell>
                    <Table.Cell className="px-3 py-2 flex items-center gap-1 flex-wrap overflow-hidden">
                      {(row.value || []).length > 0 ? (
                        row.value.map((v: string) => (
                          <Badge
                            key={v}
                            color={row.unk.value?.includes(v) ? 'error' : 'gray'}
                            size="sm"
                            className="whitespace-nowrap"
                          >
                            {v}
                          </Badge>
                        ))
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </Table.Cell>
                  </>
                )}
              </Table.Row>
            );
          })}
        </Table.Body>
      </Table>
    </TableCard>
  );
}
