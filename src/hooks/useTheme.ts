'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import type { ThemePreference } from '@/src/lib/content-logic';

const STORAGE_KEY = 'slatevault_theme';
const EVENT = 'cv-theme-change';

function readPref(): ThemePreference {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === 'light' || saved === 'dark' || saved === 'system') return saved;
  } catch {
    // Storage unavailable
  }
  return 'system';
}

function apply(pref: ThemePreference) {
  const dark = pref === 'dark' || (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
}

function subscribe(onChange: () => void) {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const handler = () => {
    apply(readPref());
    onChange();
  };
  window.addEventListener(EVENT, handler);
  window.addEventListener('storage', handler);
  mq.addEventListener('change', handler);
  return () => {
    window.removeEventListener(EVENT, handler);
    window.removeEventListener('storage', handler);
    mq.removeEventListener('change', handler);
  };
}

/** Theme preference shared by every page (landing, sign-in, app) and persisted in localStorage. */
export function useTheme() {
  const theme = useSyncExternalStore(subscribe, readPref, () => 'system' as ThemePreference);

  useEffect(() => {
    apply(theme);
  }, [theme]);

  const setTheme = useCallback((next: ThemePreference) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage unavailable
    }
    apply(next);
    window.dispatchEvent(new Event(EVENT));
  }, []);

  return { theme, setTheme };
}
