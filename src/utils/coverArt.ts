import jsmediatags from '@probityrules/jsmediatags';

export interface CoverResult {
  title: string;
  artist: string;
  covers: string[];
}

/** Lee los tags ID3 de un File y devuelve la carátula embebida (si existe) */
function readTags(file: File): Promise<{
  title?: string;
  artist?: string;
  pictureUrl?: string;
}> {
  return new Promise((resolve) => {
    jsmediatags.read(file, {
      onSuccess: (tag: any) => {
        const t = tag.tags;
        let pictureUrl: string | undefined;
        if (t.picture) {
          const bytes = new Uint8Array(t.picture.data);
          const blob = new Blob([bytes], { type: t.picture.format });
          pictureUrl = URL.createObjectURL(blob);
        }
        resolve({ title: t.title, artist: t.artist, pictureUrl });
      },
      onError: () => resolve({}),
    });
  });
}

/** Busca en MusicBrainz (Prioridad 1) */
async function searchCoverOnlineMusicBrainz(
  artist: string,
  title: string
): Promise<string[]> {
  // Limpiamos el título de sufijos comunes como "(Official Video)", "[Live]", etc.
  const cleanTitle = title.replace(/\s*[\(\[].[^\)\]]*[\)\]]\s*/g, " ").trim();
  const query = `recording:"${cleanTitle}" AND artist:"${artist}"`;
  const url = `https://musicbrainz.org/ws/2/recording?query=${encodeURIComponent(query)}&fmt=json&limit=8`;

  try {
    let data: any;
    if (window.mozzie?.fetchUrl) {
      const res = await window.mozzie.fetchUrl(url);
      if (!res.ok) return [];
      data = res.data;
    } else {
      const res = await fetch(url);
      if (!res.ok) return [];
      data = await res.json();
    }

    // Recopilamos todos los IDs de los lanzamientos (álbumes) asociados
    const releaseIds = (data.recordings || [])
      .flatMap((rec: any) => rec.releases || [])
      .map((rel: any) => rel.id)
      .filter((id: string | undefined) => id);

    // Quitamos duplicados y nos quedamos con los primeros 8
    const uniqueReleaseIds = Array.from(new Set(releaseIds)).slice(0, 8);
    const covers: string[] = [];

    for (const mbid of uniqueReleaseIds) {
      // El Cover Art Archive usa este formato. La imagen puede ser jpg o png.
      const coverUrl = `https://coverartarchive.org/release/${mbid}/front-500`;
      covers.push(coverUrl);
    }

    return covers;
  } catch (err) {
    console.warn("Error buscando en MusicBrainz:", err);
    return [];
  }
}

/** Fallback: Busca en Deezer */
async function searchCoverOnlineDeezer(
  artist: string,
  title: string
): Promise<string[]> {
  const cleanTitle = title.replace(/\s*[\(\[].[^\)\]]*[\)\]]\s*/g, " ").trim();
  const query = `${artist} ${cleanTitle}`.trim();
  if (!query) return [];

  const url = `https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=8`;

  try {
    let data: any;
    if (window.mozzie?.fetchUrl) {
      const res = await window.mozzie.fetchUrl(url);
      if (!res.ok) return [];
      data = res.data;
    } else {
      const res = await fetch(`https://corsproxy.io/?${encodeURIComponent(url)}`);
      if (!res.ok) return [];
      data = await res.json();
    }

    return (data.data || [])
      .map((item: any) => item.album?.cover_xl || item.album?.cover_big || "")
      .filter((url: string) => url.length > 0);
  } catch {
    return [];
  }
}

export async function getCoverArt(
  file: File,
  searchTitleOverride?: string,   // ← NUEVO
  searchArtistOverride?: string, // ← NUEVO
): Promise<CoverResult> {
  const tags = await readTags(file);
  const fallbackTitle = file.name.replace(/\.[^.]+$/, '');
  const title =
    searchTitleOverride?.trim() ||  // ← NUEVO
    tags.title ||
    fallbackTitle;
  const artist = searchArtistOverride?.trim() || tags.artist || ''; // ← Modificado

  const covers: string[] = [];

  // 1. Carátula embebida en el MP3 (Máxima prioridad, no depende de la búsqueda)
  if (tags.pictureUrl) covers.push(tags.pictureUrl);

  // 2. MusicBrainz
  if (title) {
    const mbUrls = await searchCoverOnlineMusicBrainz(artist, title);
    for (const url of mbUrls) {
      if (!covers.includes(url)) covers.push(url);
    }
  }

  // 3. Deezer
  if (covers.length < 8 && title) {
    const deezerUrls = await searchCoverOnlineDeezer(artist, title);
    for (const url of deezerUrls) {
      if (!covers.includes(url)) covers.push(url);
    }
  }

  // 4. iTunes
  if (covers.length < 8 && title) {
    const cleanTitle = title.replace(/\s*[\(\[].[^\)\]]*[\)\]]\s*/g, ' ').trim();
    const query = `${artist} ${cleanTitle}`.trim();
    try {
      const res = await fetch(
        `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=song&limit=8`,
      );
      if (res.ok) {
        const data = await res.json();
        const urls =
          data.results?.map((r: any) =>
            r.artworkUrl100.replace('100x100bb', '600x600bb'),
          ) || [];
        for (const u of urls) {
          if (u && !covers.includes(u)) covers.push(u);
        }
      }
    } catch {}
  }

  return { title, artist, covers };
}