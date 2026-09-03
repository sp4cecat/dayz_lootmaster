import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal } from '../base/modal/modal';
import { Button } from '../base/button/button';
import { Search, AlertTriangle } from 'lucide-react';
import { cx } from '@/utils/cx';
import { formatWorldPos } from '@/utils/mapGeo';
import type { WorldPoint } from '@/utils/mapGeo';

/**
 * The "pick one thing, then fire it at these coordinates" modal, shared by the
 * airdrop and loadout entries in the Live Map's right-click menu.
 *
 * ## Why a modal and not a submenu
 *
 * Both lists are open-ended — a server can have dozens of loadouts and a mission
 * per drop zone — so they need filtering, and a nested menu that needs a search
 * box has stopped being a menu. The app already spawns loadouts through a modal
 * with a list and a confirm footer (`PlayerActionsBar.tsx`), so this matches a
 * pattern that exists rather than introducing menu nesting for one case.
 *
 * It doubles as the confirmation gate: the coordinates being fired at are in the
 * header, so there is no separate ConfirmDialog step for these two actions.
 */

export interface SpawnPickerOption {
  id: string;
  label: string;
  /** Secondary line — item count, drop-zone name, whatever identifies it. */
  detail?: string;
  /** Blocks selection and explains why, e.g. a mission file that won't parse. */
  disabledReason?: string;
}

interface MapSpawnPickerProps {
  isOpen: boolean;
  title: string;
  /** Verb for the confirm button, e.g. "Start airdrop". */
  confirmLabel: string;
  /** Where the action will fire, shown so the modal is its own confirmation. */
  at: WorldPoint;
  options: SpawnPickerOption[];
  /** Shown instead of the list when there is nothing to choose. */
  emptyMessage: string;
  /** Rendered under the list — used for the degraded flat-spawn warning. */
  notice?: React.ReactNode;
  busy?: boolean;
  loading?: boolean;
  onConfirm: (id: string) => void;
  onCancel: () => void;
}

export default function MapSpawnPicker({
  isOpen, title, confirmLabel, at, options, emptyMessage, notice,
  busy = false, loading = false, onConfirm, onCancel,
}: MapSpawnPickerProps) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Reopening at a different point must not inherit the last selection: the
  // confirm button would then be armed for a choice the user can't see.
  useEffect(() => {
    if (isOpen) { setQuery(''); setSelected(null); searchRef.current?.focus(); }
  }, [isOpen]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(o =>
      o.label.toLowerCase().includes(q) || (o.detail || '').toLowerCase().includes(q));
  }, [options, query]);

  const chosen = options.find(o => o.id === selected);
  const canConfirm = !!chosen && !chosen.disabledReason && !busy;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onCancel}
      title={title}
      description={`Fires at ${formatWorldPos(at.x, at.z)}`}
      maxWidth="max-w-lg"
      footer={
        <>
          <Button variant="secondary-gray" size="sm" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => chosen && onConfirm(chosen.id)}
            disabled={!canConfirm}
          >
            {busy ? 'Working…' : confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {options.length > 6 && (
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-gray-400" />
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Filter…"
              aria-label="Filter list"
              className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-primary-500 focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            />
          </div>
        )}

        <div className="max-h-72 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-800">
          {loading ? (
            <p className="p-4 text-sm text-gray-500 dark:text-gray-400">Loading…</p>
          ) : options.length === 0 ? (
            <p className="p-4 text-sm text-gray-500 dark:text-gray-400">{emptyMessage}</p>
          ) : filtered.length === 0 ? (
            <p className="p-4 text-sm text-gray-500 dark:text-gray-400">Nothing matches “{query}”.</p>
          ) : (
            <ul>
              {filtered.map(option => (
                <li key={option.id}>
                  <button
                    type="button"
                    disabled={!!option.disabledReason}
                    onClick={() => setSelected(option.id)}
                    aria-pressed={selected === option.id}
                    className={cx(
                      'flex w-full flex-col items-start gap-0.5 border-b border-gray-100 px-4 py-2.5 text-left last:border-b-0 dark:border-gray-800/50',
                      option.disabledReason
                        ? 'cursor-not-allowed opacity-50'
                        : 'hover:bg-gray-50 dark:hover:bg-gray-800/50',
                      selected === option.id && 'bg-primary-50 dark:bg-primary-900/20',
                    )}
                  >
                    <span className="text-sm font-medium text-gray-900 dark:text-white">{option.label}</span>
                    {(option.disabledReason || option.detail) && (
                      <span className={cx(
                        'text-xs',
                        option.disabledReason
                          ? 'text-error-600 dark:text-error-400'
                          : 'text-gray-500 dark:text-gray-400',
                      )}>
                        {option.disabledReason || option.detail}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {notice && (
          <div className="flex items-start gap-2 rounded-lg bg-warning-50 p-3 text-xs text-warning-800 dark:bg-warning-900/20 dark:text-warning-300">
            <AlertTriangle className="mt-px size-4 shrink-0" />
            <div>{notice}</div>
          </div>
        )}
      </div>
    </Modal>
  );
}
