// Automatic document scanning: find the page edges, flatten the page (true perspective correction),
// and clean it up so it looks like a proper HD scan (white paper, no shadows, sharp text).
import type { Point } from './imageProcessing';

type Src = HTMLImageElement | HTMLCanvasElement | HTMLVideoElement;

function srcSize(s: Src) {
  const w = (s as HTMLVideoElement).videoWidth || (s as HTMLImageElement).naturalWidth || s.width;
  const h = (s as HTMLVideoElement).videoHeight || (s as HTMLImageElement).naturalHeight || s.height;
  return { w, h };
}

const FULL: Point[] = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

// ------------------------------------------------------------------ edge detection

function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const d = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    let acc = 0;
    for (let x = -r; x <= r; x++) acc += src[y * w + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = acc / d;
      acc += src[y * w + Math.min(w - 1, x + r + 1)] - src[y * w + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / d;
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}

function otsu(values: Float32Array): number {
  const hist = new Array(256).fill(0);
  for (let i = 0; i < values.length; i++) hist[Math.max(0, Math.min(255, Math.round(values[i])))]++;
  const total = values.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, thr = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) {
      best = between;
      thr = t;
    }
  }
  return thr;
}

/** Label connected regions of mask==1 and return the pixel indices of the largest one. */
function largestComponent(mask: Uint8Array, w: number, h: number): Int32Array | null {
  const seen = new Uint8Array(w * h);
  let best: Int32Array | null = null;
  const stack = new Int32Array(w * h);
  const buf = new Int32Array(w * h);
  for (let start = 0; start < w * h; start++) {
    if (!mask[start] || seen[start]) continue;
    let sp = 0, n = 0;
    stack[sp++] = start;
    seen[start] = 1;
    while (sp) {
      const p = stack[--sp];
      buf[n++] = p;
      const x = p % w, y = (p / w) | 0;
      if (x > 0 && mask[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; stack[sp++] = p - 1; }
      if (x < w - 1 && mask[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; stack[sp++] = p + 1; }
      if (y > 0 && mask[p - w] && !seen[p - w]) { seen[p - w] = 1; stack[sp++] = p - w; }
      if (y < h - 1 && mask[p + w] && !seen[p + w]) { seen[p + w] = 1; stack[sp++] = p + w; }
    }
    if (!best || n > best.length) best = buf.slice(0, n);
  }
  return best;
}

function convexHull(pts: Point[]): Point[] {
  const p = pts.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Point[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: Point[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

function polyArea(q: Point[]): number {
  let a = 0;
  for (let i = 0; i < q.length; i++) {
    const j = (i + 1) % q.length;
    a += q[i].x * q[j].y - q[j].x * q[i].y;
  }
  return Math.abs(a) / 2;
}

/** Largest-area quadrilateral using vertices of a convex hull. */
function maxAreaQuad(hull: Point[]): Point[] | null {
  let h = hull;
  if (h.length < 4) return null;
  if (h.length > 48) {
    const step = h.length / 48;
    h = Array.from({ length: 48 }, (_, i) => hull[Math.floor(i * step)]);
  }
  const n = h.length;
  let best: Point[] | null = null;
  let bestA = 0;
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++)
      for (let k = j + 1; k < n; k++)
        for (let l = k + 1; l < n; l++) {
          const q = [h[i], h[j], h[k], h[l]];
          const a = polyArea(q);
          if (a > bestA) {
            bestA = a;
            best = q;
          }
        }
  return best;
}

function orderCorners(q: Point[]): Point[] {
  const cx = q.reduce((s, p) => s + p.x, 0) / 4;
  const cy = q.reduce((s, p) => s + p.y, 0) / 4;
  const sorted = q.slice().sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
  // sorted clockwise starting somewhere; rotate so the top-left (smallest x+y) is first
  let tl = 0;
  for (let i = 1; i < 4; i++) if (sorted[i].x + sorted[i].y < sorted[tl].x + sorted[tl].y) tl = i;
  return [0, 1, 2, 3].map((i) => sorted[(tl + i) % 4]);
}

interface Candidate {
  quad: Point[];
  score: number;
}

function candidateFromMask(mask: Uint8Array, w: number, h: number): Candidate | null {
  const comp = largestComponent(mask, w, h);
  if (!comp || comp.length < w * h * 0.12) return null;
  // boundary pixels only
  const inComp = new Uint8Array(w * h);
  for (let i = 0; i < comp.length; i++) inComp[comp[i]] = 1;
  const pts: Point[] = [];
  for (let i = 0; i < comp.length; i++) {
    const p = comp[i];
    const x = p % w, y = (p / w) | 0;
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1 || !inComp[p - 1] || !inComp[p + 1] || !inComp[p - w] || !inComp[p + w])
      pts.push({ x, y });
  }
  const hull = convexHull(pts);
  const quad = maxAreaQuad(hull);
  if (!quad) return null;
  const qa = polyArea(quad);
  const fill = comp.length / Math.max(1, polyArea(hull)); // how solid the region is
  const rect = qa / Math.max(1, polyArea(hull)); // how four-sided it is
  const areaFrac = qa / (w * h);
  if (areaFrac < 0.12 || areaFrac > 0.985 || rect < 0.88) return null;
  return { quad: orderCorners(quad), score: rect + fill * 0.5 + areaFrac };
}

export interface DetectResult {
  corners: Point[]; // normalized TL, TR, BR, BL
  found: boolean;
}

/** Find the document page in a photo. Returns the whole frame (found=false) if no page is clear. */
export function detectDocument(source: Src): DetectResult {
  try {
    const { w: sw, h: sh } = srcSize(source);
    if (!sw || !sh) return { corners: FULL, found: false };
    const k = 360 / Math.max(sw, sh);
    const w = Math.max(8, Math.round(sw * k));
    const h = Math.max(8, Math.round(sh * k));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(source, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h).data;
    const grayRaw = new Float32Array(w * h);
    const sat = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) {
      const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2];
      grayRaw[i] = 0.299 * r + 0.587 * g + 0.114 * b;
      sat[i] = Math.max(r, g, b) - Math.min(r, g, b);
    }
    const gray = boxBlur(grayRaw, w, h, 2);

    // Gradient magnitude (used to find outlines and to check that a candidate's sides are real edges)
    const mag = new Float32Array(w * h);
    for (let y = 1; y < h - 1; y++)
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const gx = gray[i + 1] - gray[i - 1] + (gray[i - w + 1] - gray[i - w - 1] + gray[i + w + 1] - gray[i + w - 1]) * 0.5;
        const gy = gray[i + w] - gray[i - w] + (gray[i + w - 1] - gray[i - w - 1] + gray[i + w + 1] - gray[i - w + 1]) * 0.5;
        mag[i] = Math.hypot(gx, gy);
      }
    const sortedMag = Float32Array.from(mag).sort();
    const et = Math.max(10, sortedMag[Math.floor(sortedMag.length * 0.9)]);

    const masks: Uint8Array[] = [];
    // 1) Bright, grey-ish paper on a darker or coloured background
    const paper = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) paper[i] = gray[i] - sat[i] * 0.6;
    const t1 = otsu(paper);
    masks.push(Uint8Array.from(paper, (v) => (v > t1 ? 1 : 0)));
    // 2) Plain brightness
    const t2 = otsu(gray);
    masks.push(Uint8Array.from(gray, (v) => (v > t2 ? 1 : 0)));
    // 3) Region enclosed by strong edges (paper on a light table)
    const edge = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) if (mag[i] > et) edge[i] = 1;
    const dil = new Uint8Array(w * h);
    for (let y = 1; y < h - 1; y++)
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (edge[i] || edge[i - 1] || edge[i + 1] || edge[i - w] || edge[i + w]) dil[i] = 1;
      }
    const outside = new Uint8Array(w * h);
    const stack: number[] = [];
    const push = (i: number) => {
      if (!outside[i] && !dil[i]) {
        outside[i] = 1;
        stack.push(i);
      }
    };
    for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % w, y = (p / w) | 0;
      if (x > 0) push(p - 1);
      if (x < w - 1) push(p + 1);
      if (y > 0) push(p - w);
      if (y < h - 1) push(p + w);
    }
    masks.push(Uint8Array.from(outside, (v) => (v ? 0 : 1)));
    // 4) Different from the surroundings: predict the table colour everywhere from the image border
    //    (handles uneven light and light-coloured tables), then keep what differs from it.
    {
      const R = new Float32Array(w * h), G = new Float32Array(w * h), B = new Float32Array(w * h);
      for (let i = 0; i < w * h; i++) { R[i] = d[i * 4]; G[i] = d[i * 4 + 1]; B[i] = d[i * 4 + 2]; }
      const ch = [boxBlur(R, w, h, 2), boxBlur(G, w, h, 2), boxBlur(B, w, h, 2)];
      const smooth1 = (a: Float32Array) => {
        const o = new Float32Array(a.length);
        for (let i = 0; i < a.length; i++) {
          let s2 = 0, n = 0;
          for (let k = -8; k <= 8; k++) { const j = i + k; if (j >= 0 && j < a.length) { s2 += a[j]; n++; } }
          o[i] = s2 / n;
        }
        return o;
      };
      const depth = 3;
      const diff = new Float32Array(w * h);
      for (const c of ch) {
        const T = smooth1(Float32Array.from({ length: w }, (_, x) => { let s2 = 0; for (let y = 0; y < depth; y++) s2 += c[y * w + x]; return s2 / depth; }));
        const Bo = smooth1(Float32Array.from({ length: w }, (_, x) => { let s2 = 0; for (let y = h - depth; y < h; y++) s2 += c[y * w + x]; return s2 / depth; }));
        const Lf = smooth1(Float32Array.from({ length: h }, (_, y) => { let s2 = 0; for (let x = 0; x < depth; x++) s2 += c[y * w + x]; return s2 / depth; }));
        const Rt = smooth1(Float32Array.from({ length: h }, (_, y) => { let s2 = 0; for (let x = w - depth; x < w; x++) s2 += c[y * w + x]; return s2 / depth; }));
        for (let y = 0; y < h; y++) {
          const v = y / (h - 1);
          for (let x = 0; x < w; x++) {
            const u = x / (w - 1);
            const pred =
              (1 - v) * T[x] + v * Bo[x] + (1 - u) * Lf[y] + u * Rt[y] -
              ((1 - u) * (1 - v) * T[0] + u * (1 - v) * T[w - 1] + (1 - u) * v * Bo[0] + u * v * Bo[w - 1]);
            const e = c[y * w + x] - pred;
            diff[y * w + x] += e * e;
          }
        }
      }
      for (let i = 0; i < w * h; i++) diff[i] = Math.min(255, Math.sqrt(diff[i]));
      const t4 = Math.max(18, otsu(diff));
      masks.push(Uint8Array.from(diff, (v) => (v > t4 ? 1 : 0)));
    }

    // How well do the four sides of a quad sit on real edges? (0..1, the weakest side counts)
    const sideSupport = (q: Point[]) => {
      let worst = 1;
      for (let s = 0; s < 4; s++) {
        const a = q[s], b = q[(s + 1) % 4];
        let hit = 0, n = 0;
        for (let t = 0.05; t <= 0.95; t += 0.02) {
          const x = Math.round(a.x + (b.x - a.x) * t), y = Math.round(a.y + (b.y - a.y) * t);
          let m = 0;
          for (let dy = -2; dy <= 2; dy++)
            for (let dx = -2; dx <= 2; dx++) {
              const xx = x + dx, yy = y + dy;
              if (xx > 0 && yy > 0 && xx < w - 1 && yy < h - 1) m = Math.max(m, mag[yy * w + xx]);
            }
          n++;
          if (m > et * 0.6) hit++;
        }
        worst = Math.min(worst, hit / n);
      }
      return worst;
    };

    const cands: Candidate[] = [];
    for (const m of masks) {
      const c = candidateFromMask(m, w, h);
      if (!c) continue;
      const sup = sideSupport(c.quad);
      if (sup < 0.7) continue; // sides are not real page edges
      const nearFull = c.quad.every((p, i) => Math.abs(p.x - [0, w, w, 0][i]) < w * 0.03 && Math.abs(p.y - [0, 0, h, h][i]) < h * 0.03);
      if (nearFull) continue;
      cands.push({ quad: c.quad, score: sup * 3 + c.score });
    }
    if (!cands.length) return { corners: FULL, found: false };
    cands.sort((a, b) => b.score - a.score);
    const q = cands[0].quad;
    return {
      corners: q.map((p) => ({ x: Math.min(1, Math.max(0, (p.x + 0.5) / w)), y: Math.min(1, Math.max(0, (p.y + 0.5) / h)) })),
      found: true,
    };
  } catch {
    return { corners: FULL, found: false };
  }
}

// ------------------------------------------------------------------ perspective correction

/** Homography mapping (u,v) in the output rectangle to (x,y) in the source. */
function homography(dst: Point[], src: Point[]): number[] {
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x: u, y: v } = dst[i];
    const { x, y } = src[i];
    A.push([u, v, 1, 0, 0, 0, -u * x, -v * x]);
    b.push(x);
    A.push([0, 0, 0, u, v, 1, -u * y, -v * y]);
    b.push(y);
  }
  // Gaussian elimination
  for (let c = 0; c < 8; c++) {
    let piv = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    [A[c], A[piv]] = [A[piv], A[c]];
    [b[c], b[piv]] = [b[piv], b[c]];
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  return b.map((v, i) => v / A[i][i]).concat(1);
}

/** True perspective correction with bilinear sampling, at full resolution (long side up to maxSide). */
export function warpDocument(source: Src, corners: Point[], maxSide = 4000): HTMLCanvasElement {
  const { w: sw, h: sh } = srcSize(source);
  const sc = document.createElement('canvas');
  sc.width = sw;
  sc.height = sh;
  const sctx = sc.getContext('2d', { willReadFrequently: true })!;
  sctx.drawImage(source, 0, 0, sw, sh);
  const sd = sctx.getImageData(0, 0, sw, sh).data;

  const P = corners.map((c) => ({ x: c.x * sw, y: c.y * sh }));
  const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
  let ow = Math.max(dist(P[0], P[1]), dist(P[3], P[2]));
  let oh = Math.max(dist(P[0], P[3]), dist(P[1], P[2]));
  // Never lose detail; gently upsample small captures so text stays crisp when zooming.
  const long = Math.max(ow, oh);
  const scale = long > maxSide ? maxSide / long : long < 2200 ? Math.min(1.6, 2200 / long) : 1;
  ow = Math.max(1, Math.round(ow * scale));
  oh = Math.max(1, Math.round(oh * scale));

  const H = homography(
    [
      { x: 0, y: 0 },
      { x: ow, y: 0 },
      { x: ow, y: oh },
      { x: 0, y: oh },
    ],
    P
  );
  const out = document.createElement('canvas');
  out.width = ow;
  out.height = oh;
  const octx = out.getContext('2d')!;
  const img = octx.createImageData(ow, oh);
  const od = img.data;
  const [a, b, c, d, e, f, g, h] = H;
  let o = 0;
  for (let y = 0; y < oh; y++) {
    const v = y + 0.5;
    for (let x = 0; x < ow; x++) {
      const u = x + 0.5;
      const den = g * u + h * v + 1;
      let sx = (a * u + b * v + c) / den - 0.5;
      let sy = (d * u + e * v + f) / den - 0.5;
      if (sx < 0) sx = 0;
      if (sy < 0) sy = 0;
      if (sx > sw - 1.001) sx = sw - 1.001;
      if (sy > sh - 1.001) sy = sh - 1.001;
      const x0 = sx | 0, y0 = sy | 0;
      const fx = sx - x0, fy = sy - y0;
      const i00 = (y0 * sw + x0) * 4, i10 = i00 + 4, i01 = i00 + sw * 4, i11 = i01 + 4;
      const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
      od[o] = sd[i00] * w00 + sd[i10] * w10 + sd[i01] * w01 + sd[i11] * w11;
      od[o + 1] = sd[i00 + 1] * w00 + sd[i10 + 1] * w10 + sd[i01 + 1] * w01 + sd[i11 + 1] * w11;
      od[o + 2] = sd[i00 + 2] * w00 + sd[i10 + 2] * w10 + sd[i01 + 2] * w01 + sd[i11 + 2] * w11;
      od[o + 3] = 255;
      o += 4;
    }
  }
  octx.putImageData(img, 0, 0);
  return out;
}

// ------------------------------------------------------------------ scan look

/**
 * "Auto scan" clean-up: removes shadows and uneven light, makes the paper white, deepens the text and
 * sharpens it. Colours (stamps, photos, signatures) are kept.
 */
export function enhanceScan(canvas: HTMLCanvasElement, mode: 'color' | 'bw' = 'color'): HTMLCanvasElement {
  const W = canvas.width, Hh = canvas.height;
  // 1. Estimate the paper (background) brightness: shrink, remove text with a max filter, blur, grow back.
  const bw = Math.max(16, Math.round(W / 24));
  const bh = Math.max(16, Math.round(Hh / 24));
  const small = document.createElement('canvas');
  small.width = bw;
  small.height = bh;
  const sctx = small.getContext('2d', { willReadFrequently: true })!;
  sctx.imageSmoothingQuality = 'high';
  sctx.drawImage(canvas, 0, 0, bw, bh);
  const sdata = sctx.getImageData(0, 0, bw, bh);
  const sd = sdata.data;
  for (let pass = 0; pass < 3; pass++) {
    const copy = new Uint8ClampedArray(sd);
    for (let y = 0; y < bh; y++)
      for (let x = 0; x < bw; x++) {
        const i = (y * bw + x) * 4;
        for (let ch = 0; ch < 3; ch++) {
          let m = 0;
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              const xx = Math.min(bw - 1, Math.max(0, x + dx));
              const yy = Math.min(bh - 1, Math.max(0, y + dy));
              const v = copy[(yy * bw + xx) * 4 + ch];
              if (v > m) m = v;
            }
          sd[i + ch] = m;
        }
      }
  }
  sctx.putImageData(sdata, 0, 0);
  const bg = document.createElement('canvas');
  bg.width = W;
  bg.height = Hh;
  const bgctx = bg.getContext('2d', { willReadFrequently: true })!;
  bgctx.imageSmoothingQuality = 'high';
  bgctx.drawImage(small, 0, 0, W, Hh);
  const bgd = bgctx.getImageData(0, 0, W, Hh).data;

  const out = document.createElement('canvas');
  out.width = W;
  out.height = Hh;
  const octx = out.getContext('2d', { willReadFrequently: true })!;
  octx.drawImage(canvas, 0, 0);
  const img = octx.getImageData(0, 0, W, Hh);
  const d = img.data;

  // 2. Normalise by the background (shadow removal) and apply a document tone curve.
  const lut = new Uint8ClampedArray(1024);
  for (let i = 0; i < 1024; i++) {
    const n = i / 1023; // 0..1 relative to paper
    let v = (n - 0.18) / (0.9 - 0.18);
    v = Math.min(1, Math.max(0, v));
    v = Math.pow(v, 1.35); // deeper text, clean white paper
    lut[i] = Math.round(v * 255);
  }
  const lum = new Float32Array(W * Hh);
  for (let p = 0, i = 0; p < W * Hh; p++, i += 4) {
    const br = Math.max(40, bgd[i]), bgG = Math.max(40, bgd[i + 1]), bb = Math.max(40, bgd[i + 2]);
    let r = lut[Math.min(1023, ((d[i] / br) * 1023) | 0)];
    let g = lut[Math.min(1023, ((d[i + 1] / bgG) * 1023) | 0)];
    let b = lut[Math.min(1023, ((d[i + 2] / bb) * 1023) | 0)];
    if (mode === 'bw') {
      const l = 0.299 * r + 0.587 * g + 0.114 * b;
      r = g = b = l;
    } else {
      // keep colours a little richer after whitening
      const l = 0.299 * r + 0.587 * g + 0.114 * b;
      r = l + (r - l) * 1.2;
      g = l + (g - l) * 1.2;
      b = l + (b - l) * 1.2;
    }
    d[i] = r;
    d[i + 1] = g;
    d[i + 2] = b;
    lum[p] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  }

  // 3. Sharpen text edges (unsharp mask on brightness).
  const amount = 0.55;
  for (let y = 1; y < Hh - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const p = y * W + x;
      const blur = (lum[p - 1] + lum[p + 1] + lum[p - W] + lum[p + W] + lum[p] * 4) / 8;
      const delta = (lum[p] - blur) * amount * 2;
      if (delta > -1 && delta < 1) continue;
      const i = p * 4;
      d[i] += delta;
      d[i + 1] += delta;
      d[i + 2] += delta;
    }
  }
  octx.putImageData(img, 0, 0);
  return out;
}

/** Remove any thin strip of table/background left at the page edges after cropping. */
export function trimDarkBorder(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const W = canvas.width, H = canvas.height;
  const k = 600 / Math.max(W, H);
  const w = Math.max(8, Math.round(W * k)), h = Math.max(8, Math.round(H * k));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(canvas, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  const L = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    return 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  };
  // typical paper brightness near each edge (75th percentile of a band 5-10% in)
  const bandRef = (vals: number[]) => vals.sort((a, b) => a - b)[Math.floor(vals.length * 0.75)] || 255;
  const maxCut = 0.05;
  const rowMean = (y: number) => { let s = 0; for (let x = 0; x < w; x++) s += L(x, y); return s / w; };
  const colMean = (x: number) => { let s = 0; for (let y = 0; y < h; y++) s += L(x, y); return s / h; };
  const ref = bandRef(Array.from({ length: Math.round(h * 0.1) }, (_, i) => rowMean(Math.round(h * 0.05) + i)).concat(
    Array.from({ length: Math.round(w * 0.1) }, (_, i) => colMean(Math.round(w * 0.05) + i))));
  const dark = (m: number) => m < ref * 0.8;
  let top = 0, bottom = h - 1, left = 0, right = w - 1;
  while (top < h * maxCut && dark(rowMean(top))) top++;
  while (bottom > h * (1 - maxCut) && dark(rowMean(bottom))) bottom--;
  while (left < w * maxCut && dark(colMean(left))) left++;
  while (right > w * (1 - maxCut) && dark(colMean(right))) right--;
  if (top === 0 && left === 0 && bottom === h - 1 && right === w - 1) return canvas;
  // one extra pixel of safety margin
  const sx = Math.round(((left ? left + 1 : 0) / w) * W);
  const sy = Math.round(((top ? top + 1 : 0) / h) * H);
  const ex = Math.round(((right < w - 1 ? right - 1 : w) / w) * W);
  const ey = Math.round(((bottom < h - 1 ? bottom - 1 : h) / h) * H);
  const out = document.createElement('canvas');
  out.width = Math.max(1, ex - sx);
  out.height = Math.max(1, ey - sy);
  out.getContext('2d')!.drawImage(canvas, sx, sy, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

export type AutoFilter = 'auto' | 'original' | 'grayscale' | 'clean';

/** Full pipeline for one page: crop + flatten + clean-up. */
export function renderPage(source: Src, corners: Point[], filter: AutoFilter): HTMLCanvasElement {
  const isFull = corners.every((c, i) => Math.abs(c.x - [0, 1, 1, 0][i]) < 0.002 && Math.abs(c.y - [0, 0, 1, 1][i]) < 0.002);
  let flat = warpDocument(source, corners);
  if (!isFull) flat = trimDarkBorder(flat);
  if (filter === 'original') return flat;
  if (filter === 'clean') return enhanceScan(flat, 'bw');
  if (filter === 'grayscale') {
    const ctx = flat.getContext('2d', { willReadFrequently: true })!;
    const im = ctx.getImageData(0, 0, flat.width, flat.height);
    const d = im.data;
    for (let i = 0; i < d.length; i += 4) {
      const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      d[i] = d[i + 1] = d[i + 2] = l;
    }
    ctx.putImageData(im, 0, 0);
    return flat;
  }
  return enhanceScan(flat, 'color');
}

/** Photo file -> finished HD scan (data URL). Used when adding pages to an existing document. */
export async function autoScanFile(file: Blob): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Could not read the photo'));
      i.src = url;
    });
    const k = Math.min(1, 4000 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * k);
    c.height = Math.round(img.naturalHeight * k);
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const { corners } = detectDocument(c);
    return renderPage(c, corners, 'auto').toDataURL('image/jpeg', 0.9);
  } finally {
    URL.revokeObjectURL(url);
  }
}
