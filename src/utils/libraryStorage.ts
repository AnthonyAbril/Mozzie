const LIBRARY_KEY = "mozzie:library";

export interface LibraryEntry {
  path: string;
  name: string;
}

export function loadLibrary(): LibraryEntry[] {
  try {
    const raw = localStorage.getItem(LIBRARY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveLibrary(entries: LibraryEntry[]) {
  try {
    localStorage.setItem(LIBRARY_KEY, JSON.stringify(entries));
  } catch (err) {
    console.warn("saveLibrary failed:", err);
  }
}