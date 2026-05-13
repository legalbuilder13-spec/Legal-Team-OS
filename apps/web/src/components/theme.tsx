'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Moon, Sun, Monitor, type LucideIcon } from 'lucide-react';

type Theme = 'light' | 'dark' | 'system';
type Resolved = 'light' | 'dark';

interface ThemeContextValue {
  theme: Theme;
  resolved: Resolved;
  setTheme: (t: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function resolveTheme(t: Theme): Resolved {
  if (t !== 'system') return t;
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(resolved: Resolved) {
  const root = document.documentElement;
  if (resolved === 'dark') root.classList.add('dark');
  else root.classList.remove('dark');
  root.style.colorScheme = resolved;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('system');
  const [resolved, setResolved] = useState<Resolved>('light');

  useEffect(() => {
    const saved = (localStorage.getItem('theme') as Theme | null) ?? 'system';
    setThemeState(saved);
    const r = resolveTheme(saved);
    setResolved(r);
    applyTheme(r);

    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      if ((localStorage.getItem('theme') as Theme | null) === 'system') {
        const r2 = mq.matches ? 'dark' : 'light';
        setResolved(r2);
        applyTheme(r2);
      }
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    localStorage.setItem('theme', t);
    const r = resolveTheme(t);
    setResolved(r);
    applyTheme(r);
  }, []);

  const value = useMemo(() => ({ theme, resolved, setTheme }), [theme, resolved, setTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  const options: Array<{ value: Theme; icon: LucideIcon; label: string }> = [
    { value: 'light', icon: Sun, label: 'Light' },
    { value: 'system', icon: Monitor, label: 'System' },
    { value: 'dark', icon: Moon, label: 'Dark' },
  ];

  return (
    <div
      className="inline-flex items-center rounded-full bg-ink-100 dark:bg-ink-800 p-0.5"
      role="radiogroup"
      aria-label="Theme"
    >
      {options.map(({ value, icon: Icon, label }) => {
        const active = theme === value;
        return (
          <button
            key={value}
            onClick={() => setTheme(value)}
            role="radio"
            aria-checked={active}
            title={label}
            className={`inline-flex items-center justify-center w-6 h-6 rounded-full transition-colors duration-150 ${
              active
                ? 'bg-white dark:bg-ink-700 text-ink-900 dark:text-ink-50 shadow-soft'
                : 'text-ink-500 dark:text-ink-400 hover:text-ink-700 dark:hover:text-ink-200'
            }`}
          >
            <Icon size={12} />
          </button>
        );
      })}
    </div>
  );
}

// Server-rendered string for anti-flash. Reads localStorage + system pref
// synchronously before React hydrates, so the initial paint matches.
export const themeBootScript = `
(function(){try{
  var t = localStorage.getItem('theme') || 'system';
  var dark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  if(dark) document.documentElement.classList.add('dark');
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
}catch(_){}})();
`;
