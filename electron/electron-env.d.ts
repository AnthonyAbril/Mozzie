/// <reference types="vite-electron-plugin/electron-env" />

declare namespace NodeJS {
  interface ProcessEnv {
    VSCODE_DEBUG?: "true";
    DIST_ELECTRON: string;
    DIST: string;
    /** /dist/ or /public/ */
    PUBLIC: string;
  }
}

// ── API expuesta por preload.js al renderer ──
interface MozzieAPI {
  openFiles: () => Promise<string[]>;
  openFolder: () => Promise<{ folder: string; files: string[] } | null>;
  scanFolder: (folder: string) => Promise<string[]>;
  readFile: (
    filePath: string,
  ) => Promise<
    { ok: true; data: ArrayBuffer } | { ok: false; error: string }
  >;
  fetchUrl: (url: string) => Promise<
    { ok: true; data: any } | { ok: false; status?: number; error?: string }
  >;
  exists: (filePath: string) => Promise<boolean>;
}

interface Window {
  readonly mozzie?: MozzieAPI;
}