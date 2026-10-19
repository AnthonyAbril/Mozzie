export interface StoredDiscTheme {
  mode: 'disc' | 'custom';
  customColors: [string, string, string] | null; // <--- Ahora acepta 3
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
  playMode: PlayMode;
  vinylSpinDirection: 1 | -1;
  
  // Propiedades del tema y gradiente
  primarySource: 'color1' | 'color2' | 'auto1' | 'auto2' | 'auto3';
  bgSource: 'color1' | 'color2' | 'auto1' | 'auto2' | 'auto3';
  bgGradient: boolean;
  reactiveLights: boolean;
  
  // NUEVOS:
  gradientColorSource: 'color1' | 'color2' | 'auto1' | 'auto2' | 'auto3' | 'custom';
  gradientColor2: string;
  grayscalePalette: boolean;
  grayscaleDarkness: [number, number, number]; // <--- NUEVO (valores de 0 a 1)

  // Propiedades del Pin
  pinnedSettings: boolean;
  pinnedPreset: {
    rpm: number;
    eq: { low: number; mid: number; high: number };
    pan: number;
    reverb: number;
    volume: number; // <--- AÑADIR ESTO
  } | null;
  
  lightSmoothing: number; // 0.01 (rápido/rápido) a 0.2 (muy suave)
  blockSleep: boolean;    // Evitar que la pantalla se apague
  enableF11Fullscreen: boolean; // Atajo F11
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
  // Defaults de los nuevos campos
  
  primarySource: 'auto1',
  bgSource: 'auto2',
  bgGradient: false,
  reactiveLights: true,
  gradientColorSource: 'auto2',
  gradientColor2: '#15151b',
  grayscalePalette: false,
  grayscaleDarkness: [0.12, 0.3, 0.45], // <--- Oscuro, Medio, Claro
  pinnedSettings: false,
  pinnedPreset: null,
  lightSmoothing: 0.05,
  blockSleep: true,
  enableF11Fullscreen: true,
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