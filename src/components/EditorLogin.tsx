import React, { useMemo, useState } from 'react';
import { Database, UserPlus, History } from 'lucide-react';
import { Button } from '@/components/base/button/button';
import { Input } from '@/components/base/input/input';
import { ThemeToggle } from './ThemeToggle';

/**
 * Simple login screen to choose or create an editorID.
 */
interface EditorLoginProps {
  onLogin: (id: string) => void;
}

export default function EditorLogin({ onLogin }: EditorLoginProps) {
  const [editorID, setEditorID] = useState('');
  const [recentIDs] = useState<string[]>(() => {
    const saved = localStorage.getItem('dayz-editor:recent-ids');
    return saved ? JSON.parse(saved) : [];
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const id = editorID.trim();
    if (id) {
      // Save to recent IDs
      const next = [id, ...recentIDs.filter(x => x !== id)].slice(0, 5);
      localStorage.setItem('dayz-editor:recent-ids', JSON.stringify(next));
      onLogin(id);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 p-6 animate-in fade-in duration-700">
      <div className="fixed top-6 right-6">
        <ThemeToggle />
      </div>
      
      <div className="w-full max-w-md">
        <div className="text-center mb-10">
          <div className="size-16 bg-primary-600 rounded-2xl flex items-center justify-center text-white mx-auto mb-6 shadow-xl shadow-primary-200 dark:shadow-none animate-in zoom-in-50 duration-500">
            <Database size={32} />
          </div>
          <h1 className="text-4xl font-bold text-gray-900 tracking-tight dark:text-white mb-2">DayZ Lootmaster</h1>
          <p className="text-gray-500 dark:text-gray-400">Advanced CLE & Economy Editor</p>
        </div>

        <div className="bg-white rounded-3xl shadow-xl border border-gray-100 p-8 dark:bg-gray-900 dark:border-gray-800 animate-in slide-in-from-bottom-8 duration-500">
          <form onSubmit={handleSubmit} className="space-y-6">
            <Input
              label="Editor Identity"
              placeholder="Enter your name or ID"
              value={editorID}
              onChange={e => setEditorID(e.target.value)}
              icon={UserPlus}
              required
              className="text-lg py-6"
            />
            
            <Button type="submit" size="xl" className="w-full text-lg shadow-lg shadow-primary-100 dark:shadow-none">
              Start Editing
            </Button>
          </form>

          {recentIDs.length > 0 && (
            <div className="mt-10 pt-8 border-t border-gray-100 dark:border-gray-800">
              <div className="flex items-center gap-2 text-gray-400 mb-4 px-1">
                <History size={16} />
                <span className="text-xs font-bold uppercase tracking-wider">Recently Used</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {recentIDs.map(id => (
                  <button
                    key={id}
                    onClick={() => onLogin(id)}
                    className="px-4 py-2 bg-gray-50 text-gray-700 text-sm font-semibold rounded-xl border border-gray-100 hover:border-primary-300 hover:bg-primary-50 hover:text-primary-700 transition-all dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700 dark:hover:border-primary-800 dark:hover:text-primary-300"
                  >
                    {id}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        
        <p className="text-center mt-8 text-xs text-gray-400 dark:text-gray-600">
          All changes are tracked per editor ID for audit logs.
        </p>
      </div>
    </div>
  );
}
