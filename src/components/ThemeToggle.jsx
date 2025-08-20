import React from 'react';

export default function ThemeToggle() {
  const [theme, setTheme] = React.useState(() => {
    const saved = localStorage.getItem('theme');
    return saved || (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  });

  React.useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggle = () => setTheme(t => t === 'dark' ? 'light' : 'dark');

  return (
    <button className="btn" onClick={toggle} title="Toggle theme">
      {theme === 'dark' ? '🌙 Dark' : '☀️ Light'}
    </button>
  );
}
