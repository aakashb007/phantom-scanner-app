import { getSetting, setSetting } from '../db/db';

// Saved signatures stay on this device only (they are not synced).
export async function getSavedSignatures(): Promise<string[]> {
  return getSetting<string[]>('saved_signatures', []);
}

export async function addSignature(pngDataUrl: string): Promise<void> {
  const list = await getSavedSignatures();
  if (!list.includes(pngDataUrl)) await setSetting('saved_signatures', [pngDataUrl, ...list].slice(0, 12));
}

export async function removeSignature(index: number): Promise<void> {
  const list = await getSavedSignatures();
  list.splice(index, 1);
  await setSetting('saved_signatures', list);
}

/** Trim transparent edges. Returns null if the canvas is empty. */
export function trimCanvas(src: HTMLCanvasElement): HTMLCanvasElement | null {
  const ctx = src.getContext('2d')!;
  const { width: w, height: h } = src;
  const d = ctx.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (d[(y * w + x) * 4 + 3] > 10) {
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
  if (x1 < 0) return null;
  const p = 6;
  x0 = Math.max(0, x0 - p); y0 = Math.max(0, y0 - p);
  x1 = Math.min(w - 1, x1 + p); y1 = Math.min(h - 1, y1 + p);
  const out = document.createElement('canvas');
  out.width = x1 - x0 + 1;
  out.height = y1 - y0 + 1;
  out.getContext('2d')!.drawImage(src, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

/** Photo of a signature on paper -> ink only on a transparent background. */
export async function photoToSignature(file: File): Promise<string> {
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error('Could not read the photo'));
    i.src = URL.createObjectURL(file);
  });
  const scale = Math.min(1, 1400 / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * scale);
  c.height = Math.round(img.naturalHeight * scale);
  const ctx = c.getContext('2d')!;
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const data = ctx.getImageData(0, 0, c.width, c.height);
  const px = data.data;
  // Estimate paper brightness (bright 90th percentile) and make everything near it transparent.
  const hist = new Array(256).fill(0);
  for (let i = 0; i < px.length; i += 4) hist[Math.round(0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2])]++;
  let acc = 0, paper = 255;
  const total = px.length / 4;
  for (let v = 255; v >= 0; v--) {
    acc += hist[v];
    if (acc > total * 0.4) { paper = v; break; }
  }
  const inkMax = paper * 0.62;
  const fade = paper * 0.8;
  for (let i = 0; i < px.length; i += 4) {
    const l = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    let a = 0;
    if (l <= inkMax) a = 255;
    else if (l < fade) a = Math.round(255 * (1 - (l - inkMax) / (fade - inkMax)));
    // Darken the ink a little so it prints well
    px[i] = Math.round(px[i] * 0.6);
    px[i + 1] = Math.round(px[i + 1] * 0.6);
    px[i + 2] = Math.round(px[i + 2] * 0.6);
    px[i + 3] = a;
  }
  ctx.putImageData(data, 0, 0);
  const trimmed = trimCanvas(c);
  if (!trimmed) throw new Error('No signature found in the photo');
  return trimmed.toDataURL('image/png');
}
