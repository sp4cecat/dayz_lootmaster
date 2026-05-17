import React, { useMemo, useState } from 'react';
import { Modal } from '@/components/base/modal/modal';
import { Button } from '@/components/base/button/button';
import { Badge } from '@/components/base/badges/badges';
import { Input } from '@/components/base/input/input';
import { Plus, X, AlertTriangle } from 'lucide-react';

export type DefinitionKind = 'usage' | 'value' | 'tag';

interface ManageDefinitionsModalProps {
  kind: DefinitionKind;
  entries: string[];
  countRefs: (kind: DefinitionKind, entry: string) => number;
  removeEntry: (kind: DefinitionKind, entry: string) => void;
  addEntry: (kind: DefinitionKind, entry: string) => void;
  onClose: () => void;
}

export const ManageDefinitionsModal: React.FC<ManageDefinitionsModalProps> = ({ 
  kind, 
  entries, 
  countRefs, 
  removeEntry, 
  addEntry, 
  onClose 
}) => {
  const label = kind === 'usage' ? 'Usage' : kind === 'value' ? 'Value' : 'Tag';
  const [newEntry, setNewEntry] = useState('');

  const isCapped = kind === 'usage' || kind === 'value';
  const cap = 32;
  const count = entries.length;

  const entryCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const e of entries) m[e] = countRefs(kind, e);
    return m;
  }, [entries, kind, countRefs]);

  const onRemoveClick = (entry: string) => {
    const refCount = countRefs(kind, entry);
    const proceed = window.confirm(
      refCount > 0
        ? `${refCount} type(s) currently reference "${entry}" in ${label.toLowerCase()}. Removing it will delete this value from those types. Do you want to proceed?`
        : `Remove "${entry}" from ${label.toLowerCase()}?`
    );
    if (!proceed) return;
    removeEntry(kind, entry);
  };

  const onAdd = () => {
    const v = newEntry.trim();
    if (!v) return;
    if (entries.includes(v)) {
      window.alert(`"${v}" already exists in ${label.toLowerCase()}.`);
      return;
    }
    if (isCapped && count >= cap) {
      window.alert(`${label} has a maximum of ${cap} entries. Remove an entry before adding another.`);
      return;
    }
    addEntry(kind, v);
    setNewEntry('');
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onAdd();
    }
  };

  const footer = (
    <Button variant="secondary-gray" onClick={onClose}>Close</Button>
  );

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title={`Manage ${label} Flags`}
      description={`Add or remove ${label.toLowerCase()} definitions used across types.`}
      footer={footer}
    >
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Current entries: <span className="font-bold dark:text-white">{count}</span>
            {isCapped && <span className="text-gray-400 font-normal dark:text-gray-500"> / {cap} limit</span>}
          </div>
          {isCapped && (
            <Badge color={count >= cap ? "error" : "brand"} size="sm">
              {Math.max(0, cap - count)} remaining
            </Badge>
          )}
        </div>

        <div className="flex gap-3">
          <Input
            value={newEntry}
            onChange={e => setNewEntry(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={`Add new ${label.toLowerCase()}...`}
            className="flex-1"
          />
          <Button onClick={onAdd} disabled={!newEntry.trim() || (isCapped && count >= cap)}>
            <Plus size={18} className="mr-2" /> Add
          </Button>
        </div>

        {isCapped && count >= cap && (
          <div className="p-3 bg-error-50 rounded-lg border border-error-100 flex items-center gap-2 text-sm text-error-700 dark:bg-error-900/10 dark:border-error-800 dark:text-error-400">
            <AlertTriangle size={16} />
            <span>Maximum of {cap} entries reached. Remove an entry to add a new one.</span>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 pt-2">
          {entries.map(e => (
            <div 
              key={e} 
              className="group flex items-center justify-between p-3 bg-white border border-gray-200 rounded-lg hover:border-primary-300 transition-colors shadow-sm dark:bg-gray-800 dark:border-gray-700 dark:hover:border-primary-600"
            >
              <div className="flex flex-col min-w-0">
                <span className="font-semibold text-gray-900 truncate dark:text-white" title={e}>{e}</span>
                <span className="text-xs text-gray-500 dark:text-gray-400">{entryCounts[e] || 0} references</span>
              </div>
              <button
                onClick={() => onRemoveClick(e)}
                className="p-1.5 text-gray-400 hover:text-error-600 hover:bg-error-50 rounded-md transition-all opacity-0 group-hover:opacity-100 dark:hover:text-error-400 dark:hover:bg-error-900/30"
                title={`Remove ${e}`}
              >
                <X size={16} />
              </button>
            </div>
          ))}
          {entries.length === 0 && (
            <div className="col-span-full py-8 text-center text-gray-400 italic bg-gray-50 rounded-xl border border-dashed border-gray-200 dark:bg-gray-800/50 dark:border-gray-700 dark:text-gray-500">
              No entries defined.
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
};
