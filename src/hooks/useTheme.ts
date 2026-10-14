import { useEffect, useState, useCallback } from 'react';
import {
  DEFAULT_GLOBAL_THEME,
  loadGlobalTheme,
  saveGlobalTheme,
  StoredGlobalTheme,
} from '../utils/themeStorage';

/** Aclara un hex hacia blanco (amount 0-1) */
export function lighten(hex: string, amount = 0.15): string {
  const m = hex.replace('#', '');
  if (m.length !== 6) return hex;
  const r = parseInt(m.substring(0, 2), 16);
  const g = parseInt(m.substring(2, 4), 16);
  const b = parseInt(m.substring(4, 6), 16);
  const up = (c: number) => Math.min(255, Math.round(c + (255 - c) * amount));
  return `#${up(r).toString(16).padStart(2, '0')}${up(g)
    .toString(16)
    .padStart(2, '0')}${up(b).toString(16).padStart(2, '0')}`;
}

export function applyThemeColors(primary: string, bg1: string, bg2: string) {
  const s = document.documentElement.style;
  s.setProperty('--primary', primary);
  s.setProperty('--primary-hover', lighten(primary, 0.18));
  s.setProperty('--bg-primary', bg1);
  s.setProperty('--bg-secondary', bg2);
  s.setProperty('--border', lighten(bg2, 0.06));
  s.setProperty('--bg-hover', lighten(bg2, 0.10));
}

export function useTheme() {
  const [globalTheme, setGlobalThemeState] = useState<StoredGlobalTheme>(
    DEFAULT_GLOBAL_THEME
  );

  useEffect(() => {
    setGlobalThemeState(loadGlobalTheme());
  }, []);

  const setGlobalTheme = useCallback((patch: Partial<StoredGlobalTheme>) => {
    setGlobalThemeState((prev) => {
      const next = { ...prev, ...patch };
      saveGlobalTheme(next);
      return next;
    });
  }, []);

  return { globalTheme, setGlobalTheme };
}