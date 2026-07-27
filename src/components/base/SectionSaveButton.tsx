import { useState } from 'react';
import { Save01, CheckCircle, AlertCircle } from '@untitledui/icons';
import { Button, type ButtonSize } from '@/components/base/button/button';

type SaveState = { kind: 'idle' | 'saving' | 'ok' | 'error'; message?: string };

interface SectionSaveButtonProps {
  /** Whether the section has unsaved changes; controls whether Save is enabled. */
  dirty: boolean;
  /** Persist this section. Resolve with { ok } / { ok:false, error } — never throw. */
  onSave: () => Promise<{ ok: boolean; error?: string }>;
  label?: string;
  size?: ButtonSize;
}

/**
 * Primary Save button with an inline Saving… / Saved / Error indicator. Each editable section
 * owns its own persistence, so this renders one self-contained control per section header.
 */
export function SectionSaveButton({ dirty, onSave, label = 'Save', size = 'md' }: SectionSaveButtonProps) {
  const [saveState, setSaveState] = useState<SaveState>({ kind: 'idle' });

  const flash = (kind: SaveState['kind'], message?: string) => {
    setSaveState({ kind, message });
    if (kind === 'ok') setTimeout(() => setSaveState({ kind: 'idle' }), 2500);
  };

  const handleSave = async () => {
    setSaveState({ kind: 'saving' });
    try {
      const res = await onSave();
      if (!res?.ok) throw new Error(res?.error || 'Save failed');
      flash('ok');
    } catch (e: any) {
      flash('error', e?.message || 'Save failed');
    }
  };

  const saving = saveState.kind === 'saving';

  return (
    <div className="flex items-center gap-3">
      {saveState.kind === 'ok' && (
        <span className="flex items-center gap-1.5 text-sm text-success-600"><CheckCircle size={16} /> Saved</span>
      )}
      {saveState.kind === 'error' && (
        <span className="flex items-center gap-1.5 text-sm text-error-600"><AlertCircle size={16} /> {saveState.message}</span>
      )}
      <Button
        variant="primary"
        size={size}
        icon={Save01}
        onClick={handleSave}
        disabled={!dirty || saving}
      >
        {saving ? 'Saving…' : label}
      </Button>
    </div>
  );
}
