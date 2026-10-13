import jsmediatags from '@probityrules/jsmediatags';

export interface CoverResult {
  title: string;
  artist: string;
  coverUrl: string | null;
  source: 'embedded' | 'itunes' | 'none';
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

/** Busca la portada en el iTunes Search API (gratis, sin API key) */
async function searchCoverOnline(
  artist: string,
  title: string
): Promise<string | null> {
  // Limpiar título: quitar (feat. X), [Remastered], etc.
  const cleanTitle = title.replace(/\s*[\(\[].[^\)\]]*[\)\]]\s*/g, ' ').trim();
  const term = encodeURIComponent(`${artist} ${cleanTitle}`.trim());
  if (!term) return null;

  try {
    const res = await fetch(
      `https://itunes.apple.com/search?term=${term}&entity=song&limit=1`
    );
    if (!res.ok) return null;
    const data = await res.json();
    const art: string | undefined = data.results?.[0]?.artworkUrl100;
    if (!art) return null;

    // iTunes devuelve 100x100; podemos pedir 600x600 sustituyendo
    return art.replace('100x100bb', '600x600bb');
  } catch (err) {
    console.warn('iTunes search failed:', err);
    return null;
  }
}

/** Descarga una URL externa y la convierte en blob URL para evitar CORS */
async function toBlobUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { mode: 'cors' });
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}

/** Flujo completo: intenta embebida, si no, online. Devuelve también metadatos */
export async function getCoverArt(file: File): Promise<CoverResult> {
  const tags = await readTags(file);

  const fallbackTitle = file.name.replace(/\.[^.]+$/, ''); // sin extensión
  const title = tags.title || fallbackTitle;
  const artist = tags.artist || '';

  // 1. Carátula embebida en el MP3
  if (tags.pictureUrl) {
    return { title, artist, coverUrl: tags.pictureUrl, source: 'embedded' };
  }

  // 2. Búsqueda online por artista + título
  if (title) {
    const remoteUrl = await searchCoverOnline(artist, title);
    if (remoteUrl) {
      const blobUrl = await toBlobUrl(remoteUrl);
      if (blobUrl) {
        return { title, artist, coverUrl: blobUrl, source: 'itunes' };
      }
    }
  }

  return { title, artist, coverUrl: null, source: 'none' };
}