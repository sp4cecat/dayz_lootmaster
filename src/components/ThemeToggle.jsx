import React from 'react';
import { Sun, Moon } from 'lucide-react';
import { Button } from './ui/Button';

export default function ThemeToggle() {
  const [theme, setTheme] = React.useState(() => {
    const saved = localStorage.getItem('theme');
    if (saved) return saved;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  React.useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggle = () => setTheme(t => t === 'dark' ? 'light' : 'dark');

  return (
    <Button 
      variant="secondary" 
      size="sm" 
      onClick={toggle} 
      className="w-10 h-10 p-0 flex items-center justify-center"
      title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {theme === 'dark' ? (
        <Sun size={20} className="text-gray-500" />
      ) : (
        <Moon size={20} className="text-gray-500" />
      )}
    </Button>
  );
}
