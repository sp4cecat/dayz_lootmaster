import React, { useMemo, useRef } from 'react';

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
 * }} props
 */
export default function TypesTable({ definitions, types, selection, setSelection, unknowns }) {
  const rows = useMemo(() => {
    return types.map(t => {
      const unk = unknowns.byType[t.name] || { usage: [], value: [], tag: [] };
      const hasUnknown = (unk.usage?.length || 0) + (unk.value?.length || 0) + (unk.tag?.length || 0) + (unk.category ? 1 : 0) > 0;
      return { ...t, hasUnknown, unk };
    });
  }, [types, unknowns]);

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

  const condensed = selection.size > 0;

  return (
    <div className={`types-table ${condensed ? 'condensed' : ''}`}>
      <div className="table-header">
        <div className="th name">
          <span>Name</span>
          <button
            type="button"
            className="link select-all-link"
            onClick={selectAll}
            disabled={rows.length === 0}
            title="Select all filtered types"
          >
            Select all
          </button>
        </div>
        {!condensed && (
          <>
            <div className="th nums">Nom</div>
            <div className="th nums">Min</div>
            <div className="th nums">Lifetime</div>
            <div className="th nums">Restock</div>
            <div className="th category">Category</div>
            <div className="th usage">Usage</div>
            <div className="th value">Value</div>
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
                {t.hasUnknown && <span className="chip warn">Unknown</span>}
              </div>

              {!condensed && (
                <>
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
