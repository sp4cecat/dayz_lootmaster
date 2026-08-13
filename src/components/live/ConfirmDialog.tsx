import React from 'react';
import { Modal } from '../base/modal/modal';
import { Button } from '../base/button/button';
import { AlertTriangle, HelpCircle } from 'lucide-react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  /** What is about to happen, stated concretely (names, coordinates). */
  message: React.ReactNode;
  confirmLabel?: string;
  /** Destructive styling (red confirm) for kill/kick-grade actions. */
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Small confirmation gate for live-server admin actions. */
export default function ConfirmDialog({
  open, title, message, confirmLabel = 'Confirm', destructive = false, busy = false, onConfirm, onCancel,
}: ConfirmDialogProps) {
  if (!open) return null;
  return (
    <Modal
      isOpen={open}
      onClose={onCancel}
      title={title}
      icon={destructive ? AlertTriangle : HelpCircle}
      iconVariant={destructive ? 'error' : 'primary'}
      maxWidth="max-w-md"
      footer={
        <>
          <Button variant="secondary-gray" size="sm" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button variant={destructive ? 'error' : 'primary'} size="sm" onClick={onConfirm} disabled={busy}>
            {busy ? 'Working…' : confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-sm text-gray-600 dark:text-gray-300">{message}</div>
    </Modal>
  );
}
