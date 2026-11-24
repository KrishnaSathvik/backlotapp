'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { LayoutGrid, List } from 'lucide-react';
import { cx } from './ui';

export type LayoutMode = 'grid' | 'list';

const STORAGE_KEY = 'backlot_layout';
const EVENT = 'backlot-layout';

function readMode(): LayoutMode {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === 'list' || saved === 'grid') return saved;
  } catch {
    // Storage unavailable
  }
  return 'grid';
}

function subscribe(onChange: () => void) {
  const handler = () => onChange();
  window.addEventListener(EVENT, handler);
  window.addEventListener('storage', handler);
  return () => {
    window.removeEventListener(EVENT, handler);
    window.removeEventListener('storage', handler);
  };
}

/** Grid or list, shared by Library and Ideas and kept on this browser. */
export function useLayoutMode(): [LayoutMode, (mode: LayoutMode) => void] {
  const mode = useSyncExternalStore(subscribe, readMode, () => 'grid' as LayoutMode);
  const setMode = useCallback((next: LayoutMode) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage unavailable
    }
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return [mode, setMode];
}

/** Switches a page between the card grid and a compact list. */
export function LayoutToggle({ mode, onChange }: { mode: LayoutMode; onChange: (mode: LayoutMode) => void }) {
  const options = [
    { key: 'grid' as const, label: 'Grid', icon: LayoutGrid },
    { key: 'list' as const, label: 'List', icon: List },
  ];
  return (
    <div role="group" aria-label="Layout" className="flex h-10 shrink-0 items-center rounded-xl border border-border bg-surface p-1">
      {options.map(({ key, label, icon: Icon }) => {
        const on = mode === key;
        return (
          <button
            key={key}
            type="button"
            aria-pressed={on}
            aria-label={`${label} view`}
            onClick={() => onChange(key)}
            className={cx(
              'flex h-8 w-8 items-center justify-center rounded-lg transition-colors',
              on ? 'bg-text text-bg' : 'text-muted hover:text-text'
            )}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}
