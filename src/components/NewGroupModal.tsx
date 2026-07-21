import React, { useMemo, useState } from 'react';
import { Modal } from '@/components/base/modal/modal';
import { Button } from '@/components/base/button/button';
import { Input } from '@/components/base/input/input';
import { FolderPlus, AlertTriangle } from 'lucide-react';

interface NewGroupModalProps {
  groups: string[];
  onCreate: (name: string) => Promise<{ ok: boolean; group?: string; file?: string; error?: string }>;
  onCreated: (group: string) => void;
  onClose: () => void;
}

const RESERVED = ['vanilla', 'vanilla_overrides', '__root'];
const SAFE_NAME_RE = /^[A-Za-z0-9._-]+$/;

export const NewGroupModal: React.FC<NewGroupModalProps> = ({ groups, onCreate, onCreated, onClose }) => {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const invalidReason = useMemo(() => {
    const v = name.trim();
    if (!v) return 'Enter a group name';
    if (!SAFE_NAME_RE.test(v)) return 'Only letters, numbers, dot, dash and underscore are allowed';
    if (RESERVED.includes(v.toLowerCase())) return `"${v}" is a reserved group name`;
    if (groups.some(g => g.toLowerCase() === v.toLowerCase())) return `Group "${v}" already exists`;
    return null;
  }, [name, groups]);

  const submit = async () => {
    const v = name.trim();
    if (invalidReason) { setError(invalidReason); return; }
    setBusy(true);
    setError(null);
    const res = await onCreate(v);
    setBusy(false);
    if (!res.ok) { setError(res.error || 'Failed to create group'); return; }
    onCreated(res.group || v);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !invalidReason && !busy) {
      e.preventDefault();
      void submit();
    }
  };

  const footer = (
    <>
      <Button variant="secondary-gray" onClick={onClose} disabled={busy}>Cancel</Button>
      <Button onClick={submit} disabled={!!invalidReason || busy}>
        {busy ? 'Creating…' : 'Create Group'}
      </Button>
    </>
  );

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title="New Types Group"
      description="Create a custom loot group registered in cfgeconomycore.xml."
      icon={FolderPlus}
      footer={footer}
      maxWidth="max-w-lg"
    >
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5 dark:text-gray-300">Group name</label>
          <Input
            value={name}
            onChange={e => { setName(e.target.value); setError(null); }}
            onKeyDown={onKeyDown}
            placeholder="e.g. mortys"
            autoFocus
          />
          <p className="text-xs text-gray-500 mt-1.5 dark:text-gray-400">
            Will be created on disk at{' '}
            <code className="font-mono text-gray-700 dark:text-gray-300">db/{name.trim() || '<name>'}/</code>{' '}
            with an empty <code className="font-mono">types.xml</code> and <code className="font-mono">spawnabletypes.xml</code>.
          </p>
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

export default NewGroupModal;
