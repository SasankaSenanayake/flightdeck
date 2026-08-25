'use client';

import { useEffect, useState } from 'react';

type Mode = 'system' | 'light' | 'dark';

/**
 * Three-state theme control. "system" removes the attribute entirely so the
 * prefers-color-scheme media query takes over; an explicit choice stamps
 * data-theme on <html> and wins in both directions.
 */
export function ThemeToggle() {
  const [mode, setMode] = useState<Mode>('system');

  useEffect(() => {
    const saved = (localStorage.getItem('theme') as Mode) ?? 'system';
    setMode(saved);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (mode === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', mode);
    localStorage.setItem('theme', mode);
  }, [mode]);

  const opts: { key: Mode; label: string }[] = [
    { key: 'light', label: 'Light' },
    { key: 'system', label: 'Auto' },
    { key: 'dark', label: 'Dark' },
  ];

  return (
    <div role="group" aria-label="Theme" className="flex rounded-lg border border-line bg-surface-1 p-0.5">
      {opts.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => setMode(o.key)}
          aria-pressed={mode === o.key}
          className={`cursor-pointer rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-s1 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-1 ${
            mode === o.key ? 'bg-surface-2 text-ink' : 'text-ink-3 hover:text-ink-2'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
