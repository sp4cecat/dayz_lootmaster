import React, { useEffect, useState } from 'react';
import { Sun, Moon } from 'lucide-react';
import { Button } from '@/components/base/button/button';

export const ThemeToggle: React.FC = () => {
  const [theme, setTheme] = useState(() => {
    if (typeof window !== 'undefined') {
      return document.documentElement.getAttribute('data-theme') || 'dark';
    }
    return 'dark';
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
      root.setAttribute('data-theme', 'dark');
    } else {
      root.classList.remove('dark');
      root.setAttribute('data-theme', 'light');
    }
    localStorage.setItem('dayz-types-editor:theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => (prev === 'dark' ? 'light' : 'dark'));
  };

  return (
    <Button
      variant="secondary-gray"
      size="sm"
      onClick={toggleTheme}
      title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
      className="w-10 h-10 p-0 flex items-center justify-center border-gray-200 dark:border-gray-700 shrink-0"
    >
      {theme === 'dark' ? (
        <Sun size={20} className="text-gray-500 dark:text-gray-400" />
      ) : (
        <Moon size={20} className="text-gray-500 dark:text-gray-400" />
      )}
    </Button>
  );
};
