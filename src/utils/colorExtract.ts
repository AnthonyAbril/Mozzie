/** Convierte RGB a HSL (h: 0-360, s: 0-1, l: 0-1) */
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  const d = max - min;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
    else if (max === g) h = ((b - r) / d + 2) * 60;
    else h = ((r - g) / d + 4) * 60;
  }
  return [h, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60)       [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else              [r, g, b] = [c, 0, x];
  const toHex = (v: number) =>
    Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/** Convierte un color saturado a un fondo oscuro pero VIVO */
function toDarkBg(
  h: number,
  s: number,
  targetL: number,
  satBoost = 1
): string {
  // Boost agresivo: conservamos casi toda la saturación original
  const boosted = s * 0.95 * satBoost;
  // Piso mínimo: incluso los colores poco saturados reciben un tinte visible
  const sat = Math.min(Math.max(boosted, 0.35), 0.85);
  return hslToHex(h, sat, targetL);
}

const FALLBACK: [string, string] = ['#0e0e12', '#15151b'];

/** Extrae dos colores dominantes de una portada y los convierte en fondos vivos */
export function extractPaletteFromImage(
  imageUrl: string,
  satBoost = 1,
  brightness = 0
): Promise<[string, string]> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const size = 64; // subimos de 48 a 64 para más muestras
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) { resolve(FALLBACK); return; }
        ctx.drawImage(img, 0, 0, size, size);
        const { data } = ctx.getImageData(0, 0, size, size);

        // Buckets de 24° (15 buckets) → granularidad de color más fina
        const buckets = Array.from({ length: 15 }, () => ({
          h: 0, s: 0, count: 0, satSum: 0, satMax: 0,
        }));

        for (let i = 0; i < data.length; i += 4) {
          const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
          if (a < 128) continue; // ignorar transparentes

          const [h, s, l] = rgbToHsl(r, g, b);

          // Filtros más estrictos: fuera grises y extremos de luminosidad
          if (s < 0.22) continue;
          if (l < 0.12 || l > 0.90) continue;

          const idx = Math.floor(h / 24) % 15;
          buckets[idx].h += h;
          buckets[idx].s += s;
          buckets[idx].satSum += s;
          if (s > buckets[idx].satMax) buckets[idx].satMax = s;
          buckets[idx].count++;
        }

        const ranked = buckets
          .map((b, i) => ({
            i,
            h: b.count > 0 ? b.h / b.count : 0,
            s: b.count > 0 ? b.s / b.count : 0,
            satMax: b.satMax,
            count: b.count,
            // Puntuación: premia cantidad de píxeles Y saturación máxima del bucket
            score: b.count * (b.satMax + 0.3),
          }))
          .filter((b) => b.count >= 5)
          .sort((a, b) => b.score - a.score);

        // Luminosidades dependientes de brightness
        const l1 = 0.08 + brightness * 0.22;   // fondo principal
        const l2 = 0.24 + brightness * 0.22;   // paneles

        if (ranked.length === 0) {
            const retry = buckets
                .map((b, i) => ({
                i,
                h: b.count > 0 ? b.h / b.count : 0,
                s: b.count > 0 ? b.s / b.count : 0,
                count: b.count,
                }))
                .filter((b) => b.count >= 2)
                .sort((a, b) => b.count - a.count);
            if (retry.length === 0) { resolve(FALLBACK); return; }
            const first = retry[0];
            const bg1 = toDarkBg(first.h, Math.max(first.s, 0.4), l1, satBoost);
            const bg2 = toDarkBg(
                (first.h + 20) % 360,
                Math.min(Math.max(first.s, 0.4) * 0.75, 0.55),
                l2,
                satBoost
            );
            resolve([bg1, bg2]);
            return;
        }

        const first = ranked[0];
        const second =
          ranked.find((b) => {
            const dist = Math.min(
              Math.abs(b.i - first.i),
              15 - Math.abs(b.i - first.i)
            );
            return dist >= 2;
          }) ?? ranked[1] ?? first;

        const bg1 = toDarkBg(first.h, first.s, l1, satBoost);
        const bg2 = toDarkBg(
          second.h,
          Math.min(second.s * 0.75, 0.55),
          l2,
          satBoost
        );
        resolve([bg1, bg2]);
      } catch (err) {
        console.warn('extractPalette failed:', err);
        resolve(FALLBACK);
      }
    };
    img.onerror = () => resolve(FALLBACK);
    img.src = imageUrl;
  });
}