import React, { useEffect, useMemo, useState } from 'react';
import { Modal } from '@/components/base/modal/modal';
import { Button } from '@/components/base/button/button';
import { Input } from '@/components/base/input/input';
import { FilePlus, AlertTriangle } from 'lucide-react';
import type { Type } from '../utils/xml';

interface NewTypeModalProps {
  /** Groups eligible as a target (custom groups; vanilla excluded by the caller). */
  groups: string[];
  getGroupFiles: (group: string) => { file: string; types: Type[] }[];
  categories: string[];
  /** Names already in use (case-insensitive), for live uniqueness validation. */
  existingNames: string[];
  initialGroup?: string;
  onCreate: (params: { name: string; group: string; file: string; category: string | undefined }) =>
    { ok: boolean; type?: Type; error?: string };
  onCreated: (type: Type) => void;
  onClose: () => void;
}

const SAFE_NAME_RE = /^[A-Za-z0-9._-]+$/;

const selectClass =
  'flex h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm focus:outline-none focus:ring-4 focus:ring-primary-100 focus:border-primary-300 transition-all dark:bg-gray-950 dark:border-gray-700 dark:text-gray-100 dark:focus:ring-primary-900/30 dark:focus:border-primary-500';

export const NewTypeModal: React.FC<NewTypeModalProps> = ({
  groups, getGroupFiles, categories, existingNames, initialGroup, onCreate, onCreated, onClose,
}) => {
  const [name, setName] = useState('');
  const [group, setGroup] = useState(initialGroup && groups.includes(initialGroup) ? initialGroup : (groups[0] || ''));
  const [file, setFile] = useState('');
  const [category, setCategory] = useState('');
  const [error, setError] = useState<string | null>(null);

  const files = useMemo(() => (group ? getGroupFiles(group).map(f => f.file) : []), [group, getGroupFiles]);

  // Keep the selected file valid when the group (and thus its files) changes.
  useEffect(() => {
    if (files.length === 0) { setFile(''); return; }
    if (!files.includes(file)) setFile(files[0]);
  }, [files, file]);

  const lowerNames = useMemo(() => new Set(existingNames.map(n => n.toLowerCase())), [existingNames]);

  const invalidReason = useMemo(() => {
    const v = name.trim();
    if (!v) return 'Enter a type name';
    if (!SAFE_NAME_RE.test(v)) return 'Only letters, numbers, dot, dash and underscore are allowed';
    if (lowerNames.has(v.toLowerCase())) return `A type named "${v}" already exists`;
    if (!group) return 'Choose a target group';
    if (!file) return 'Choose a target file';
    return null;
  }, [name, group, file, lowerNames]);

  const submit = () => {
    if (invalidReason) { setError(invalidReason); return; }
    const res = onCreate({ name: name.trim(), group, file, category: category || undefined });
    if (!res.ok || !res.type) { setError(res.error || 'Failed to add type'); return; }
    onCreated(res.type);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !invalidReason) {
      e.preventDefault();
      submit();
    }
  };

  const footer = (
    <>
      <Button variant="secondary-gray" onClick={onClose}>Cancel</Button>
      <Button onClick={submit} disabled={!!invalidReason}>Add Type</Button>
    </>
  );

  if (groups.length === 0) {
    return (
      <Modal isOpen={true} onClose={onClose} title="New Type" icon={FilePlus} maxWidth="max-w-lg"
        footer={<Button variant="secondary-gray" onClick={onClose}>Close</Button>}>
        <div className="p-4 bg-warning-50 rounded-lg border border-warning-100 flex items-center gap-2 text-sm text-warning-700 dark:bg-warning-900/10 dark:border-warning-800 dark:text-warning-400">
          <AlertTriangle size={16} className="shrink-0" />
          <span>Create a custom types group first — new types cannot be added to the vanilla base.</span>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title="New Type"
      description="Add a new loot type. It is staged until you Set Changes Live."
      icon={FilePlus}
      footer={footer}
      maxWidth="max-w-lg"
    >
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5 dark:text-gray-300">Type name (classname)</label>
          <Input
            value={name}
            onChange={e => { setName(e.target.value); setError(null); }}
            onKeyDown={onKeyDown}
            placeholder="e.g. Morty_Portal_Gun"
            autoFocus
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5 dark:text-gray-300">Group</label>
            <select className={selectClass} value={group} onChange={e => { setGroup(e.target.value); setError(null); }}>
              {groups.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5 dark:text-gray-300">File</label>
            <select className={selectClass} value={file} onChange={e => setFile(e.target.value)}>
              {files.map(f => <option key={f} value={f}>{f}.xml</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5 dark:text-gray-300">Category <span className="text-gray-400 font-normal">(optional)</span></label>
          <select className={selectClass} value={category} onChange={e => setCategory(e.target.value)}>
            <option value="">— none —</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        {error && (
          <div className="p-3 bg-error-50 rounded-lg border border-error-100 flex items-center gap-2 text-sm text-error-700 dark:bg-error-900/10 dark:border-error-800 dark:text-error-400">
            <AlertTriangle size={16} className="shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default NewTypeModal;
