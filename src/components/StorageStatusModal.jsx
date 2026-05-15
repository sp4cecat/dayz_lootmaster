import React from 'react';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';
import { Badge } from './ui/Badge';
import { FileDiff, List, FileCode, CheckCircle2, AlertTriangle } from 'lucide-react';

/**
 * @param {{
 *  diff: {
 *    definitions: { categories: boolean, usageflags: boolean, valueflags: boolean, tags: boolean },
 *    files: Record<string, Record<string, { changed: boolean, added: number, removed: number, modified: number, changedCount: number }>>,
 *    mission?: { spawnableGroups?: Record<string, boolean>, randomPresets?: boolean }
 *  },
 *  onClose: () => void
 * }} props
 */
export default function StorageStatusModal({ diff, onClose }) {
  const defChanged = diff.definitions.categories || diff.definitions.usageflags || diff.definitions.valueflags || diff.definitions.tags;
  const groups = Object.keys(diff.files)
    .filter(g => Object.values(diff.files[g]).some(info => info.changed))
    .sort((a, b) => a.localeCompare(b));
  const spawnableGroups = Object.entries(diff.mission?.spawnableGroups || {})
    .filter(([, changed]) => changed)
    .map(([group]) => group)
    .sort((a, b) => a.localeCompare(b));
  const missionChanged = !!diff.mission?.randomPresets || spawnableGroups.length > 0;

  const footer = (
    <Button onClick={onClose}>Close</Button>
  );

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title="Storage Status"
      description="Comparing current in-memory state with the baseline files on disk."
      footer={footer}
      maxWidth="max-w-3xl"
    >
      <div className="space-y-8">
        <section>
          <div className="flex items-center gap-2 mb-4">
            <List size={18} className="text-primary-600" />
            <h4 className="font-bold text-gray-900">Definitions</h4>
          </div>
          {defChanged ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {diff.definitions.categories && <Badge variant="warning">Categories Changed</Badge>}
              {diff.definitions.usageflags && <Badge variant="warning">Usage Flags Changed</Badge>}
              {diff.definitions.valueflags && <Badge variant="warning">Value Flags Changed</Badge>}
              {diff.definitions.tags && <Badge variant="warning">Tags Changed</Badge>}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-gray-500 italic px-4 py-3 bg-gray-50 rounded-lg border border-dashed border-gray-200">
              <CheckCircle2 size={16} className="text-success-500" />
              No definition changes detected.
            </div>
          )}
        </section>

        <section>
          <div className="flex items-center gap-2 mb-4">
            <FileDiff size={18} className="text-primary-600" />
            <h4 className="font-bold text-gray-900">Types Files</h4>
          </div>
          {groups.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-gray-500 italic px-4 py-3 bg-gray-50 rounded-lg border border-dashed border-gray-200">
              <CheckCircle2 size={16} className="text-success-500" />
              No types changes detected.
            </div>
          ) : (
            <div className="space-y-4">
              {groups.map(g => {
                const files = diff.files[g];
                const fileKeys = Object.keys(files)
                  .filter(f => files[f].changed)
                  .sort((a, b) => a.localeCompare(b));
                if (fileKeys.length === 0) return null;
                return (
                  <div key={g} className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
                    <div className="bg-gray-50 px-4 py-2 border-b border-gray-200 flex items-center justify-between">
                      <span className="font-bold text-gray-900">{g}</span>
                      <Badge variant="primary">{fileKeys.length} files</Badge>
                    </div>
                    <div className="divide-y divide-gray-100">
                      {fileKeys.map(f => {
                        const info = files[f];
                        return (
                          <div key={f} className="px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors">
                            <div className="flex items-center gap-2">
                              <FileCode size={16} className="text-gray-400" />
                              <code className="text-sm font-semibold text-gray-700">{f}.xml</code>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="text-xs font-medium text-gray-500">
                                {info.changedCount} total changes
                              </span>
                              <div className="flex gap-1">
                                {info.added > 0 && <Badge variant="success" className="text-[10px] px-1.5">+{info.added}</Badge>}
                                {info.removed > 0 && <Badge variant="error" className="text-[10px] px-1.5">-{info.removed}</Badge>}
                                {info.modified > 0 && <Badge variant="primary" className="text-[10px] px-1.5">~{info.modified}</Badge>}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section>
          <div className="flex items-center gap-2 mb-4">
            <FileCode size={18} className="text-primary-600" />
            <h4 className="font-bold text-gray-900">Mission Files</h4>
          </div>
          {!missionChanged ? (
            <div className="flex items-center gap-2 text-sm text-gray-500 italic px-4 py-3 bg-gray-50 rounded-lg border border-dashed border-gray-200">
              <CheckCircle2 size={16} className="text-success-500" />
              No mission file changes detected.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {diff.mission?.randomPresets && (
                <div className="p-3 bg-white border border-warning-200 rounded-lg flex items-center gap-3">
                  <AlertTriangle size={16} className="text-warning-500" />
                  <code className="text-xs font-bold text-gray-700">cfgrandompresets.xml</code>
                </div>
              )}
              {spawnableGroups.map(group => (
                <div key={group} className="p-3 bg-white border border-warning-200 rounded-lg flex items-center gap-3">
                  <AlertTriangle size={16} className="text-warning-500" />
                  <code className="text-xs font-bold text-gray-700">{group}/cfgspawnabletypes.xml</code>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </Modal>
  );
}
