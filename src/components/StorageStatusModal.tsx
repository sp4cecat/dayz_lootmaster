import React from 'react';
import { Modal } from '@/components/base/modal/modal';
import { Button } from '@/components/base/button/button';
import { Badge } from '@/components/base/badges/badges';
import { FileDiff, List, FileCode, CheckCircle2, AlertTriangle } from 'lucide-react';

interface StorageStatusModalProps {
  diff: {
    files: Record<string, Record<string, { changedNames?: string[] }>>;
  } | null;
  onClose: () => void;
  onApply: () => void;
  getBaselineFileTypes: (group: string, file: string) => any[];
}

export default function StorageStatusModal({ diff, onClose, onApply, getBaselineFileTypes }: StorageStatusModalProps) {
  const fileList: { group: string; name: string; changedCount: number }[] = [];
  if (diff) {
    for (const [group, files] of Object.entries(diff.files)) {
      for (const [name, info] of Object.entries(files)) {
        if (info.changedNames && info.changedNames.length > 0) {
          fileList.push({ group, name, changedCount: info.changedNames.length });
        }
      }
    }
  }

  const footer = (
    <>
      <Button variant="secondary-gray" onClick={onClose}>Dismiss</Button>
      <Button variant="primary" onClick={onApply}>Apply All Changes</Button>
    </>
  );

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title="Pending Changes"
      description="Review unsaved changes across your XML configuration files."
      footer={footer}
      icon={FileDiff}
      iconVariant="primary"
    >
      <div className="space-y-6">
        {fileList.length > 0 ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between px-1">
              <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Affected Files</span>
              <Badge color="brand" size="sm">{fileList.length} files modified</Badge>
            </div>
            
            <div className="grid grid-cols-1 gap-3">
              {fileList.map(f => (
                <div key={`${f.group}-${f.name}`} className="flex items-center gap-4 p-4 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl shadow-sm group transition-all hover:border-primary-300 dark:hover:border-primary-800">
                  <div className="size-10 bg-gray-50 dark:bg-gray-950 rounded-lg flex items-center justify-center text-gray-400 shrink-0">
                    <FileCode size={20} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="text-sm font-bold text-gray-900 dark:text-white truncate">{f.name}.xml</p>
                      <Badge color="gray" size="sm">{f.group}</Badge>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {f.changedCount} item property changes
                    </p>
                  </div>
                  <Badge color="warning" size="sm" type="modern" className="shrink-0">
                    Pending
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="py-12 text-center">
            <div className="size-16 bg-success-50 dark:bg-success-900/20 rounded-full flex items-center justify-center text-success-600 mx-auto mb-4">
              <CheckCircle2 size={32} />
            </div>
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-1">All files are up to date</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">No unsaved changes detected in the current session.</p>
          </div>
        )}

        <div className="p-4 bg-primary-50 dark:bg-primary-900/10 rounded-xl border border-primary-100 dark:border-primary-900/20 flex items-start gap-3">
          <AlertTriangle className="text-primary-600 dark:text-primary-400 shrink-0 mt-0.5" size={18} />
          <div>
            <p className="text-sm font-bold text-primary-900 dark:text-primary-300">Persistence Note</p>
            <p className="text-xs text-primary-700 dark:text-primary-400 leading-relaxed">
              Changes are stored in your browser's local database. Applying changes will synchronize your session with the original server files.
            </p>
          </div>
        </div>
      </div>
    </Modal>
  );
}
