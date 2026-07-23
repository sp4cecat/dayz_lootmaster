import React, { useMemo, useState } from 'react';
import { Button } from '@/components/base/button/button';
import { ComboBox, ComboBoxItem } from '@/components/base/combobox/combobox';
import { Plus, Trash01, AlertTriangle } from '@untitledui/icons';
import { useCatalog } from '@/contexts/CatalogContext';

interface ItemChipGridProps {
  label: string;
  /** Current classnames, rendered as removable chips. */
  values: string[];
  onChange: (next: string[]) => void;
  /** Full types.xml classname list — the suggestion source (and the fallback when deployable
   *  scoping is requested but the mod isn't reporting the flag). */
  typeOptions: string[];
  /** When true, scope suggestions to catalog-flagged deployable items. Falls back to the full
   *  list (with a note) when the companion mod predates the isDeployable flag. */
  deployableOnly?: boolean;
  placeholder?: string;
  /** Shown when the list is empty. */
  emptyText?: string;
  /** Optional helper line under the label. */
  hint?: string;
}

const MAX_SUGGESTIONS = 50;

/**
 * A searchable, catalog-backed chip grid for editing a list of item classnames. Generalizes the
 * airdrop editor's InfectedList: a ComboBox (searchable by classname or display name, with
 * allowsCustomValue so any class can still be typed) plus removable chips.
 *
 * With `deployableOnly`, suggestions are scoped to items the companion mod flagged as deployable
 * (base-building kits, tents, traps, deployable containers). If the mod hasn't reported the flag
 * for any item, it degrades to the full type list and shows an inline note, so the picker is never
 * empty and free entry always works.
 */
export const ItemChipGrid: React.FC<ItemChipGridProps> = ({
  label, values, onChange, typeOptions, deployableOnly = false, placeholder, emptyText, hint,
}) => {
  const { displayNameFor, deployableNames } = useCatalog();
  const [draft, setDraft] = useState('');

  const deployableAvailable = deployableOnly && deployableNames.size > 0;

  // Suggestion source: the catalog's deployable set when scoping (and available), otherwise the
  // full types.xml list.
  const sourceNames = useMemo(() => {
    if (deployableAvailable) return Array.from(deployableNames).sort();
    return typeOptions;
  }, [deployableAvailable, deployableNames, typeOptions]);

  const suggestions = useMemo(() => {
    const d = draft.trim().toLowerCase();
    if (!d) return [] as { id: string; displayName: string }[];
    const out: { id: string; displayName: string }[] = [];
    for (const n of sourceNames) {
      if (values.includes(n)) continue;
      const dn = displayNameFor(n) || '';
      if (n.toLowerCase().includes(d) || dn.toLowerCase().includes(d)) {
        out.push({ id: n, displayName: dn });
        if (out.length >= MAX_SUGGESTIONS) break;
      }
    }
    return out;
  }, [draft, sourceNames, values, displayNameFor]);

  const addItem = (item: string) => {
    const trimmed = item.trim();
    if (trimmed && !values.includes(trimmed)) onChange([...values, trimmed]);
    setDraft('');
  };

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {label}
          {values.length > 0 && <span className="ml-1.5 font-normal text-gray-400">({values.length})</span>}
        </span>
      </div>
      {hint && <p className="text-xs text-gray-500 dark:text-gray-400">{hint}</p>}

      {deployableOnly && !deployableAvailable && (
        <p className="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          Deployable-item list unavailable (the server-API mod isn't reporting it) — showing all items.
          Any classname can still be added.
        </p>
      )}

      <div className="flex gap-2">
        <div className="flex-1">
          <ComboBox
            aria-label={label}
            placeholder={placeholder || 'Search items by name or class…'}
            items={suggestions}
            inputValue={draft}
            onInputChange={setDraft}
            allowsCustomValue
            menuTrigger="focus"
            onSelectionChange={(key) => { if (key) setDraft(String(key)); }}
          >
            {(item: { id: string; displayName: string }) => (
              <ComboBoxItem id={item.id} textValue={`${item.id} ${item.displayName}`}>
                <span className="font-mono text-xs">{item.id}</span>
                {item.displayName && <span className="ml-2 text-gray-400">{item.displayName}</span>}
              </ComboBoxItem>
            )}
          </ComboBox>
        </div>
        <Button variant="secondary-gray" icon={Plus} onClick={() => addItem(draft)} className="h-10 shrink-0" />
      </div>

      <div className="flex flex-wrap gap-2">
        {values.map((v, i) => (
          <span
            key={i}
            title={displayNameFor(v) || undefined}
            className="inline-flex items-center gap-1.5 rounded-md bg-gray-100 dark:bg-gray-800 px-2 py-1 text-xs font-mono text-gray-700 dark:text-gray-300"
          >
            {v}
            <button
              onClick={() => onChange(values.filter((_, j) => j !== i))}
              className="text-gray-400 hover:text-error-600"
              aria-label={`Remove ${v}`}
            >
              <Trash01 size={12} />
            </button>
          </span>
        ))}
        {values.length === 0 && (
          <span className="text-xs text-gray-400 italic">{emptyText || 'None configured.'}</span>
        )}
      </div>
    </div>
  );
};
