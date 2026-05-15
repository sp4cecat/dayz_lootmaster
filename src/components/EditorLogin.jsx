import React, { useMemo, useState } from 'react';
import { Database, UserPlus, History } from 'lucide-react';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { ThemeToggle } from './ThemeToggle.jsx';

/**
 * Simple login screen to choose or create an editorID.
 *
 * @param {{
 *   existingIDs: string[],
 *   onSelect: (id: string) => void
 * }} props
 */
export default function EditorLogin({ existingIDs, onSelect }) {
  const [value, setValue] = useState('');
  const sorted = useMemo(() => [...(existingIDs || [])].sort((a, b) => a.localeCompare(b)), [existingIDs]);

  const create = () => {
    const v = value.trim();
    if (!v) return;
    onSelect(v);
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-6 dark:bg-gray-950">
      <div className="absolute bottom-6 left-6">
        <ThemeToggle />
      </div>

      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-gray-100 p-8 dark:bg-gray-900 dark:border-gray-800">
        <div className="flex flex-col items-center text-center mb-8">
          <div className="size-12 bg-primary-600 rounded-xl flex items-center justify-center text-white mb-4">
            <Database size={28} />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 tracking-tight dark:text-white">Choose Editor ID</h2>
          <p className="text-gray-500 mt-2 dark:text-gray-400">
            Select a previous ID or create a new one to continue.
          </p>
        </div>

        {sorted.length > 0 && (
          <div className="mb-8">
            <div className="flex items-center gap-2 mb-3 text-sm font-semibold text-gray-700 dark:text-gray-300">
              <History size={16} className="text-gray-400" />
              <span>Previous IDs</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {sorted.map(id => (
                <button
                  type="button"
                  key={id}
                  onClick={() => onSelect(id)}
                  className="px-3 py-1.5 bg-gray-50 text-gray-700 rounded-lg text-sm font-medium border border-gray-200 hover:bg-gray-100 hover:border-gray-300 transition-all dark:bg-gray-950 dark:text-gray-300 dark:border-gray-700 dark:hover:bg-gray-800"
                  title={`Use "${id}"`}
                >
                  {id}
                </button>
              ))}
            </div>
          </div>
        )}

        <div>
          <div className="flex items-center gap-2 mb-3 text-sm font-semibold text-gray-700 dark:text-gray-300">
            <UserPlus size={16} className="text-gray-400" />
            <span>New ID</span>
          </div>
          <div className="flex gap-3">
            <Input
              value={value}
              onChange={e => setValue(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') create(); }}
              placeholder="Enter a new editor ID"
              className="flex-1"
            />
            <Button onClick={create}>
              Create
            </Button>
          </div>
        </div>
      </div>
      
      <p className="mt-8 text-sm text-gray-400 dark:text-gray-600">
        Lootmaster &copy; {new Date().getFullYear()}
      </p>
    </div>
  );
}
