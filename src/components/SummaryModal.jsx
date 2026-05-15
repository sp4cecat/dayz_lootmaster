import React from 'react';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';
import { Badge } from './ui/Badge';
import { Database, FileCode, Tags, Layers } from 'lucide-react';

/**
 * Summary modal to display information about consumed configuration after initial load.
 *
 * @param {{
 *  summary: { typesTotal: number, definitions: { categories: number, usageflags: number, valueflags: number, tags: number }, groups?: { name: string, count: number, files?: string[] }[] },
 *  onClose: () => void
 * }} props
 */
export default function SummaryModal({ summary, onClose }) {
  const footer = (
    <Button onClick={onClose} className="w-full sm:w-auto">Got it</Button>
  );

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title="Configuration Loaded"
      description="Parsed XML data has been loaded successfully."
      footer={footer}
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="p-4 bg-gray-50 rounded-xl border border-gray-100 dark:bg-gray-800/50 dark:border-gray-800">
          <div className="flex items-center gap-3 mb-4 text-primary-600 dark:text-primary-400">
            <Database size={20} />
            <h3 className="font-bold text-gray-900 text-lg dark:text-white">Types</h3>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold text-gray-900 dark:text-white">{summary.typesTotal}</span>
            <span className="text-gray-500 font-medium dark:text-gray-400">total types</span>
          </div>
        </div>

        <div className="p-4 bg-gray-50 rounded-xl border border-gray-100 dark:bg-gray-800/50 dark:border-gray-800">
          <div className="flex items-center gap-3 mb-4 text-primary-600 dark:text-primary-400">
            <Tags size={20} />
            <h3 className="font-bold text-gray-900 text-lg dark:text-white">Definitions</h3>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase dark:text-gray-400">Categories</p>
              <p className="text-xl font-bold text-gray-900 dark:text-white">{summary.definitions.categories}</p>
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase dark:text-gray-400">Usage Flags</p>
              <p className="text-xl font-bold text-gray-900 dark:text-white">{summary.definitions.usageflags}</p>
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase dark:text-gray-400">Value Flags</p>
              <p className="text-xl font-bold text-gray-900 dark:text-white">{summary.definitions.valueflags}</p>
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase dark:text-gray-400">Tags</p>
              <p className="text-xl font-bold text-gray-900 dark:text-white">{summary.definitions.tags}</p>
            </div>
          </div>
        </div>

        {Array.isArray(summary.groups) && summary.groups.length > 0 && (
          <div className="md:col-span-2 p-4 bg-gray-50 rounded-xl border border-gray-100 dark:bg-gray-800/50 dark:border-gray-800">
            <div className="flex items-center gap-3 mb-4 text-primary-600 dark:text-primary-400">
              <Layers size={20} />
              <h3 className="font-bold text-gray-900 text-lg dark:text-white">Groups</h3>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {summary.groups.map(g => (
                <div key={g.name} className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm dark:bg-gray-800 dark:border-gray-700">
                  <div className="flex justify-between items-center mb-1">
                    <span className="font-bold text-gray-900 dark:text-white">{g.name}</span>
                    <Badge variant="primary">{g.count}</Badge>
                  </div>
                  {Array.isArray(g.files) && g.files.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {g.files.map(f => (
                        <div key={f} className="flex items-center gap-1 text-[10px] bg-gray-100 px-1.5 py-0.5 rounded text-gray-600 font-mono dark:bg-gray-700 dark:text-gray-400">
                          <FileCode size={10} />
                          {f}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
