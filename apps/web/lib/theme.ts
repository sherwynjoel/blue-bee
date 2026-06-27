'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Dark-mode control (Daylight). The initial class is set before paint by the
 * inline script in app/layout.tsx (reads `bb-theme` in localStorage, else the OS
 * preference). This hook keeps a React mirror of that class and persists the
 * operator's explicit choice. jsdom-safe: it never touches matchMedia (the
 * pre-paint script owns the OS-preference read), so component tests render fine.
 */
const STORAGE_KEY = 'bb-theme';

export function isDarkNow(): boolean {
  if (typeof document === 'undefined') return false;
  return document.documentElement.classList.contains('dark');
}

export function applyTheme(dark: boolean): void {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('dark', dark);
  try {
    localStorage.setItem(STORAGE_KEY, dark ? 'dark' : 'light');
  } catch {
    /* private mode / storage blocked — the class still applied for this session */
  }
}

export function useTheme(): { dark: boolean; toggle: () => void; setDark: (d: boolean) => void } {
  const [dark, setDarkState] = useState(false);

  // Sync to the class the pre-paint script already set (avoids a hydration flash).
  useEffect(() => {
    setDarkState(isDarkNow());
  }, []);

  const setDark = useCallback((d: boolean) => {
    applyTheme(d);
    setDarkState(d);
  }, []);

  const toggle = useCallback(() => setDark(!isDarkNow()), [setDark]);

  return { dark, toggle, setDark };
}
