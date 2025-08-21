import React, { useMemo, useRef, useState } from 'react';

/**
 * @typedef {import('../utils/xml.js').Type} Type
 */

/**
 * @param {{
 *  definitions: {categories: string[], usageflags: string[], valueflags: string[], tags: string[]},
 *  types: Type[],
 *  selection: Set<string>,
 *  setSelection: (sel: Set<string>) => void,
 *  unknowns: { byType: Record<string, { category?: string[], usage: string[], value: string[], tag: string[] }>}
 *  condensed?: boolean,
 *  duplicatesByName?: Record<string, string[]>
 * }} props
 */
export default function TypesTable({ definitions, types, selection, setSelection, unknowns, condensed: condensedProp, duplicatesByName = {} }) {
  const [sort, setSort] = useState(/** @type {{key: null | 'name' | 'group' | 'nominal' | 'lifetime' | 'restock' | 'usage' | 'value', dir: 'asc' | 'desc'}} */({ key: 'name', dir: 'asc' }));

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

  const handleSort = (key) => {
    setSort(prev => {
      if (prev.key !== key) return { key, dir: 'asc' };
      if (prev.dir === 'asc') return { key, dir: 'desc' };
      // cycle to unsorted
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
        // Toggle each in the range
        rangeNames.forEach(n => next.has(n) ? next.delete(n) : next.add(n));
      } else {
        // Replace with the range
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

  const condensed = typeof condensedProp === 'boolean' ? condensedProp : (selection.size > 0);

  return (
    <div className={`types-table ${condensed ? 'condensed' : ''}`}>
      <div className="table-header">
        <div
          className="th name sortable"
          onClick={() => handleSort('name')}
          title="Sort by name"
        >
          <span>Name</span>
          {sort.key === 'name' && <span className="sort-ind">{sort.dir === 'asc' ? '▲' : '▼'}</span>}
          <button
            type="button"
            className="link select-all-link"
            onClick={(e) => { e.stopPropagation(); selectAll(); }}
            disabled={rows.length === 0}
            title="Select all filtered types"
          >
            Select all
          </button>
        </div>
        {!condensed && (
          <>
            <div
              className="th group sortable"
              onClick={() => handleSort('group')}
              title="Sort by group"
            >
              <span>Group</span>
              {sort.key === 'group' && <span className="sort-ind">{sort.dir === 'asc' ? '▲' : '▼'}</span>}
            </div>
            <div
              className="th nums sortable"
              onClick={() => handleSort('nominal')}
              title="Sort by nominal"
            >
              <span>Nom</span>
              {sort.key === 'nominal' && <span className="sort-ind">{sort.dir === 'asc' ? '▲' : '▼'}</span>}
            </div>
            <div className="th nums">Min</div>
            <div
              className="th nums sortable"
              onClick={() => handleSort('lifetime')}
              title="Sort by lifetime"
            >
              <span>Lifetime</span>
              {sort.key === 'lifetime' && <span className="sort-ind">{sort.dir === 'asc' ? '▲' : '▼'}</span>}
            </div>
            <div
              className="th nums sortable"
              onClick={() => handleSort('restock')}
              title="Sort by restock"
            >
              <span>Restock</span>
              {sort.key === 'restock' && <span className="sort-ind">{sort.dir === 'asc' ? '▲' : '▼'}</span>}
            </div>
            <div className="th category">Category</div>
            <div
              className="th usage sortable"
              onClick={() => handleSort('usage')}
              title="Sort by usage"
            >
              <span>Usage</span>
              {sort.key === 'usage' && <span className="sort-ind">{sort.dir === 'asc' ? '▲' : '▼'}</span>}
            </div>
            <div
              className="th value sortable"
              onClick={() => handleSort('value')}
              title="Sort by value"
            >
              <span>Value</span>
              {sort.key === 'value' && <span className="sort-ind">{sort.dir === 'asc' ? '▲' : '▼'}</span>}
            </div>
            <div className="th tag">Tag</div>
          </>
        )}
      </div>
      <div className="table-body" role="list">
        {rows.map((t, i) => {
          const selected = selection.has(t.name);
          return (
            <div
              key={t.name}
              role="listitem"
              className={`tr ${selected ? 'selected' : ''}`}
              onClick={e => onRowClick(e, i, t.name)}
              title={t.hasUnknown ? 'Contains unknown entries' : undefined}
            >
              <div className="td name">
                {t.name}
                {(() => {
                  const groups = duplicatesByName[t.name] || [];
                  const others = groups.filter(g => g !== t.group);
                  const count = others.length;
                  return count > 0 ? (
                    <span
                      className="chip"
                      title={`Also in: ${others.join(', ')}`}
                      aria-label={`Also in ${others.join(', ')}`}
                      style={{ marginLeft: '6px' }}
                    >
                      +{count}
                    </span>
                  ) : null;
                })()}
                {t.hasUnknown && <span className="chip warn">Unknown</span>}
              </div>

              {!condensed && (
                <>
                  <div className="td group">{t.group || '—'}</div>
                  <div className="td nums">{t.nominal}</div>
                  <div className="td nums">{t.min}</div>
                  <div className="td nums">{t.lifetime}</div>
                  <div className="td nums">{t.restock}</div>
                  <div className="td category">
                    <span className={!definitions.categories.includes(t.category || '') ? 'warn-text' : ''}>
                      {t.category || '—'}
                    </span>
                  </div>
                  <div className="td usage">
                    <GroupChips values={t.usage} unknown={(unknowns.byType[t.name]?.usage) || []} />
                  </div>
                  <div className="td value">
                    <GroupChips values={t.value} unknown={(unknowns.byType[t.name]?.value) || []} />
                  </div>
                  <div className="td tag">
                    <GroupChips values={t.tag} unknown={(unknowns.byType[t.name]?.tag) || []} />
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function GroupChips({ label, values, unknown }) {
  return (
    <div className="chips">
      {label ? <span className="chip muted">{label}</span> : null}
      {values.map(v => (
        <span key={v} className={`chip ${unknown.includes(v) ? 'warn' : ''}`}>{v}</span>
      ))}
      {values.length === 0 && <span className="muted">—</span>}
    </div>
  );
}
