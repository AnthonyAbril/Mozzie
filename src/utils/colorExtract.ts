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
  const toHex = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function toDarkBg(h: number, s: number, targetL: number, satBoost = 1): string {
  const boosted = s * 0.95 * satBoost;
  const sat = Math.min(Math.max(boosted, 0.35), 0.85);
  return hslToHex(h, sat, targetL);
}

const FALLBACK: [string, string, string] = ['#0e0e12', '#15151b', '#0a0a0f'];

export function extractPaletteFromImage(
  imageUrl: string,
  satBoost = 1,
  brightness = 0,
  grayscale = false, // <--- NUEVO
  grayscaleDarkness: [number, number, number] = [0.12, 0.3, 0.45] // <--- NUEVO
): Promise<[string, string, string]> { // <--- Ahora devuelve 3
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const size = 64;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) { resolve(FALLBACK); return; }
        ctx.drawImage(img, 0, 0, size, size);
        const { data } = ctx.getImageData(0, 0, size, size);

        const buckets = Array.from({ length: 15 }, () => ({
          h: 0, s: 0, count: 0, satSum: 0, satMax: 0,
        }));

        for (let i = 0; i < data.length; i += 4) {
          const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
          if (a < 128) continue;
          const [h, s, l] = rgbToHsl(r, g, b);
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
            score: b.count * (b.satMax + 0.3),
          }))
          .filter((b) => b.count >= 5)
          .sort((a, b) => b.score - a.score);

        if (ranked.length === 0) {
           resolve(FALLBACK);
           return;
        }

        const l1 = Math.min(0.08 + brightness * 0.22, 0.12);   
        const l2 = Math.min(0.24 + brightness * 0.22, 0.30);   
        const l3 = Math.min(0.38 + brightness * 0.22, 0.45);

        let c1, c2, c3;

        if (grayscale) {
          // ✅ Usa los valores del usuario
          const base = ranked[0];
          c1 = toDarkBg(base.h, base.s, grayscaleDarkness[0], satBoost);
          c2 = toDarkBg(base.h, base.s, grayscaleDarkness[1], satBoost);
          c3 = toDarkBg(base.h, base.s, grayscaleDarkness[2], satBoost);
        } else {
          // Colores distintos: buscamos 3 tonos diferentes
          const first = ranked[0];
          const second = ranked.find((b) => {
            const dist = Math.min(Math.abs(b.i - first.i), 15 - Math.abs(b.i - first.i));
            return dist >= 2;
          }) || first;
          const third = ranked.find((b) => {
            const dist1 = Math.min(Math.abs(b.i - first.i), 15 - Math.abs(b.i - first.i));
            const dist2 = Math.min(Math.abs(b.i - second.i), 15 - Math.abs(b.i - second.i));
            return dist1 >= 2 && dist2 >= 2;
          }) || second;

          c1 = toDarkBg(first.h, first.s, l1, satBoost);
          c2 = toDarkBg(second.h, second.s * 0.75, l2, satBoost);
          c3 = toDarkBg(third.h, third.s * 0.85, l3, satBoost);
        }

        resolve([c1, c2, c3]);
      } catch {
        resolve(FALLBACK);
      }
    };
    img.onerror = () => resolve(FALLBACK);
    img.src = imageUrl;
  });
}