export interface StoredDiscTheme {
  mode: 'disc' | 'custom';
  customColors: [string, string] | null;
}

export type PlayMode = 'single' | 'continuous' | 'loop';

export interface StoredGlobalTheme {
  primary: string;
  themeColor1: string;
  themeColor2: string;
  discThemeMode: boolean;
  satBoost: number;
  brightness: number;
  singlePlayback: boolean;    
  playMode: PlayMode;         // ← nuevo
  vinylSpinDirection: 1 | -1;   // ← NUEVO
}

export const DEFAULT_GLOBAL_THEME: StoredGlobalTheme = {
  primary: '#3b82f6',
  themeColor1: '#0e0e12',
  themeColor2: '#15151b',
  discThemeMode: true,
  satBoost: 1.15,
  brightness: 0,
  singlePlayback: false,      // ← por defecto, multi-play (como ahora)
  playMode: 'single',         // ← por defecto: se queda esperando
  vinylSpinDirection: -1,       // ← por defecto antihorario (más realista)
};

const DISCS_KEY = 'mozzie:discThemes';
const GLOBAL_KEY = 'mozzie:globalTheme';

export function loadAllDiscThemes(): Record<string, StoredDiscTheme> {
  try {
    const raw = localStorage.getItem(DISCS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

export function saveDiscTheme(key: string, theme: StoredDiscTheme) {
  try {
    const all = loadAllDiscThemes();
    all[key] = theme;
    localStorage.setItem(DISCS_KEY, JSON.stringify(all));
  } catch (err) { console.warn('saveDiscTheme failed:', err); }
}

export function loadGlobalTheme(): StoredGlobalTheme {
  try {
    const raw = localStorage.getItem(GLOBAL_KEY);
    return raw
      ? { ...DEFAULT_GLOBAL_THEME, ...JSON.parse(raw) }
      : { ...DEFAULT_GLOBAL_THEME };
  } catch { return { ...DEFAULT_GLOBAL_THEME }; }
}

export function saveGlobalTheme(theme: StoredGlobalTheme) {
  try { localStorage.setItem(GLOBAL_KEY, JSON.stringify(theme)); }
  catch (err) { console.warn('saveGlobalTheme failed:', err); }
}