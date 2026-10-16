export {};

declare global {
  interface Window {
    mozzie?: {
      openFiles: () => Promise<string[]>;
      openFolder: () => Promise<string[]>;
      readFile: (
        path: string,
      ) => Promise<{ ok: true; data: ArrayBuffer } | { ok: false; error: string }>;
      exists: (path: string) => Promise<boolean>;
    };
  }
}