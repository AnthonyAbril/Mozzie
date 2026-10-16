const PLAYLISTS_KEY = "mozzie:playlists";

export interface Playlist {
  id: string;
  name: string;
  description: string;
  coverUrl: string | null;       // por defecto, la del primer track
  trackPaths: string[];          // rutas absolutas
  createdAt: number;
}

export function loadPlaylists(): Playlist[] {
  try {
    const raw = localStorage.getItem(PLAYLISTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function savePlaylists(playlists: Playlist[]) {
  try {
    localStorage.setItem(PLAYLISTS_KEY, JSON.stringify(playlists));
  } catch (err) {
    console.warn("savePlaylists failed:", err);
  }
}

export function createPlaylist(
  name: string,
  description: string,
  trackPaths: string[],
  coverUrl: string | null,
): Playlist {
  return {
    id: crypto.randomUUID(),
    name,
    description,
    coverUrl,
    trackPaths,
    createdAt: Date.now(),
  };
}