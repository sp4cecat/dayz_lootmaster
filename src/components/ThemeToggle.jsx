import React, { useState, useEffect } from 'react';
import { Sun, Moon } from 'lucide-react';
import { Button } from './ui/Button.jsx';

export function ThemeToggle() {
  const THEME_KEY = 'dayz-types-editor:theme';

  const [theme, setTheme] = useState(() => {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved === 'dark' || saved === 'light') return saved;
    } catch { /* ignore */ }
    
    // Default to dark to match index.html logic
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
    
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch { /* ignore */ }
  }, [theme]);

  const toggle = (e) => {
    if (e) {
        e.preventDefault();
        e.stopPropagation();
    }
    setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  };

  return (
    <Button 
      variant="secondary" 
      size="sm" 
      onClick={toggle} 
      className="w-10 h-10 p-0 flex items-center justify-center border-gray-200 dark:border-gray-700 shrink-0"
      title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {theme === 'dark' ? (
        <Sun size={20} className="text-gray-500 dark:text-gray-400" />
      ) : (
        <Moon size={20} className="text-gray-500 dark:text-gray-400" />
      )}
    </Button>
  );
}
