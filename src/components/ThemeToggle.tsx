'use client';

import React from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from '@/src/hooks/useTheme';
import type { ThemePreference } from '@/src/lib/content-logic';
import { cx } from './ui';

const OPTIONS: Array<{ key: ThemePreference; label: string; icon: React.ElementType }> = [
  { key: 'light', label: 'Light theme', icon: Sun },
  { key: 'system', label: 'System theme', icon: Monitor },
  { key: 'dark', label: 'Dark theme', icon: Moon },
];

/** Segmented Light / System / Dark switch. `compact` shows a single cycling button. */
export function ThemeToggle({ compact = false, className }: { compact?: boolean; className?: string }) {
  const { theme, setTheme } = useTheme();

  if (compact) {
    const index = OPTIONS.findIndex((o) => o.key === theme);
    const current = OPTIONS[index] ?? OPTIONS[1];
    const next = OPTIONS[(index + 1) % OPTIONS.length];
    const Icon = current.icon;
    return (
      <button
        type="button"
        onClick={() => setTheme(next.key)}
        aria-label={`${current.label}. Switch to ${next.label.toLowerCase()}`}
        title={current.label}
        className={cx(
          'flex h-9 w-9 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-600 transition-colors hover:text-zinc-950 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:text-white',
          className
        )}
      >
        <Icon key={current.key} className="h-4 w-4 animate-pop-in" aria-hidden="true" />
      </button>
    );
  }

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className={cx(
        'relative flex items-center rounded-full border border-zinc-200 bg-zinc-100/80 p-0.5 dark:border-zinc-800 dark:bg-zinc-900',
        className
      )}
    >
      {OPTIONS.map(({ key, label, icon: Icon }) => {
        const active = theme === key;
        return (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={label}
            title={label}
            onClick={() => setTheme(key)}
            className={cx(
              'flex h-7 w-7 items-center justify-center rounded-full transition-all',
              active
                ? 'bg-white text-zinc-950 shadow-sm dark:bg-zinc-700 dark:text-white'
                : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'
            )}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}
