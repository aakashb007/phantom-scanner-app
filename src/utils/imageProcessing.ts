export interface Point {
  x: number;
  y: number;
}

export type ScanFilter = 'original' | 'clean' | 'grayscale' | 'enhanced';

export interface QualityCheckResult {
  warning: 'blurry' | 'too_dark' | 'cut_off' | null;
  message: string | null;
}

/**
 * Automatically detects document corners from an image or video frame.
 * Returns 4 normalized coordinates [0..1]: [Top-Left, Top-Right, Bottom-Right, Bottom-Left]
 */
export function detectDocumentCorners(
  source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement
): Point[] {
  try {
    const sw = (source as HTMLVideoElement).videoWidth || (source as HTMLImageElement).naturalWidth || source.width;
    const sh = (source as HTMLVideoElement).videoHeight || (source as HTMLImageElement).naturalHeight || source.height;

    if (!sw || !sh) {
      return defaultCorners();
    }

    const procW = 160;
    const procH = Math.round((procW * sh) / sw);
    const canvas = document.createElement('canvas');
    canvas.width = procW;
    canvas.height = procH;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return defaultCorners();

    ctx.drawImage(source, 0, 0, procW, procH);
    const imgData = ctx.getImageData(0, 0, procW, procH);
    const data = imgData.data;

    // Compute luminance
    const lum = new Float32Array(procW * procH);
    let totalLum = 0;
    for (let i = 0; i < procW * procH; i++) {
      const r = data[i * 4];
      const g = data[i * 4 + 1];
      const b = data[i * 4 + 2];
      const l = 0.299 * r + 0.587 * g + 0.114 * b;
      lum[i] = l;
      totalLum += l;
    }
    const avgLum = totalLum / (procW * procH);

    // Compute simple horizontal & vertical edge gradient
    const minX = Math.round(procW * 0.08);
    const maxX = Math.round(procW * 0.92);
    const minY = Math.round(procH * 0.08);
    const maxY = Math.round(procH * 0.92);

    // Find bounding box with high contrast
    let left = minX, right = maxX, top = minY, bottom = maxY;

    // Scan inward from left
    for (let x = 0; x < procW * 0.4; x++) {
      let colGrad = 0;
      for (let y = minY; y < maxY; y++) {
        const idx = y * procW + x;
        colGrad += Math.abs(lum[idx] - avgLum);
      }
      if (colGrad / (maxY - minY) > 28) {
        left = Math.max(minX, x);
        break;
      }
    }

    // Scan inward from right
    for (let x = procW - 1; x > procW * 0.6; x--) {
      let colGrad = 0;
      for (let y = minY; y < maxY; y++) {
        const idx = y * procW + x;
        colGrad += Math.abs(lum[idx] - avgLum);
      }
      if (colGrad / (maxY - minY) > 28) {
        right = Math.min(maxX, x);
        break;
      }
    }

    // Scan inward from top
    for (let y = 0; y < procH * 0.4; y++) {
      let rowGrad = 0;
      for (let x = minX; x < maxX; x++) {
        const idx = y * procW + x;
        rowGrad += Math.abs(lum[idx] - avgLum);
      }
      if (rowGrad / (maxX - minX) > 28) {
        top = Math.max(minY, y);
        break;
      }
    }

    // Scan inward from bottom
    for (let y = procH - 1; y > procH * 0.6; y--) {
      let rowGrad = 0;
      for (let x = minX; x < maxX; x++) {
        const idx = y * procW + x;
        rowGrad += Math.abs(lum[idx] - avgLum);
      }
      if (rowGrad / (maxX - minX) > 28) {
        bottom = Math.min(maxY, y);
        break;
      }
    }

    const nLeft = Math.max(0.04, Math.min(0.25, left / procW));
    const nRight = Math.min(0.96, Math.max(0.75, right / procW));
    const nTop = Math.max(0.04, Math.min(0.25, top / procH));
    const nBottom = Math.min(0.96, Math.max(0.75, bottom / procH));

    return [
      { x: nLeft, y: nTop },       // TL
      { x: nRight, y: nTop },      // TR
      { x: nRight, y: nBottom },   // BR
      { x: nLeft, y: nBottom },    // BL
    ];
  } catch {
    return defaultCorners();
  }
}

export function defaultCorners(): Point[] {
  return [
    { x: 0.08, y: 0.08 },
    { x: 0.92, y: 0.08 },
    { x: 0.92, y: 0.92 },
    { x: 0.08, y: 0.92 },
  ];
}

/**
 * Perspective correction: projects the quadrilateral (p0..p3) onto a flat rectangular canvas
 */
export function warpPerspective(
  sourceImage: HTMLImageElement | HTMLCanvasElement | HTMLVideoElement,
  corners: Point[], // normalized 0..1 (TL, TR, BR, BL)
  targetWidth = 1200,
  targetHeight = 1600
): HTMLCanvasElement {
  const sw = (sourceImage as HTMLImageElement).naturalWidth || (sourceImage as HTMLVideoElement).videoWidth || sourceImage.width;
  const sh = (sourceImage as HTMLImageElement).naturalHeight || (sourceImage as HTMLVideoElement).videoHeight || sourceImage.height;

  // Real pixel corners in source
  const srcPts = [
    { x: corners[0].x * sw, y: corners[0].y * sh },
    { x: corners[1].x * sw, y: corners[1].y * sh },
    { x: corners[2].x * sw, y: corners[2].y * sh },
    { x: corners[3].x * sw, y: corners[3].y * sh },
  ];

  // Desired aspect ratio from top & side edge lengths
  const topW = Math.hypot(srcPts[1].x - srcPts[0].x, srcPts[1].y - srcPts[0].y);
  const botW = Math.hypot(srcPts[2].x - srcPts[3].x, srcPts[2].y - srcPts[3].y);
  const leftH = Math.hypot(srcPts[3].x - srcPts[0].x, srcPts[3].y - srcPts[0].y);
  const rightH = Math.hypot(srcPts[2].x - srcPts[1].x, srcPts[2].y - srcPts[1].y);

  const avgW = Math.max(topW, botW);
  const avgH = Math.max(leftH, rightH);
  const aspect = avgH > 0 ? avgW / avgH : 0.75;

  const tw = Math.min(1800, Math.max(800, Math.round(targetHeight * aspect)));
  const th = targetHeight;

  // Offscreen destination canvas
  const canvas = document.createElement('canvas');
  canvas.width = tw;
  canvas.height = th;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  // Subdivided mesh projection for smooth perspective correction
  const numSteps = 16;
  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = sw;
  srcCanvas.height = sh;
  const sCtx = srcCanvas.getContext('2d');
  if (sCtx) {
    sCtx.drawImage(sourceImage, 0, 0, sw, sh);
  }

  // Bilinear interpolation across grid cells
  function lerp(a: number, b: number, t: number) {
    return a + (b - a) * t;
  }

  function getQuadPoint(u: number, v: number): Point {
    const top = {
      x: lerp(srcPts[0].x, srcPts[1].x, u),
      y: lerp(srcPts[0].y, srcPts[1].y, u),
    };
    const bot = {
      x: lerp(srcPts[3].x, srcPts[2].x, u),
      y: lerp(srcPts[3].y, srcPts[2].y, u),
    };
    return {
      x: lerp(top.x, bot.x, v),
      y: lerp(top.y, bot.y, v),
    };
  }

  for (let y = 0; y < numSteps; y++) {
    const v0 = y / numSteps;
    const v1 = (y + 1) / numSteps;
    const dy0 = v0 * th;
    const dy1 = v1 * th;

    for (let x = 0; x < numSteps; x++) {
      const u0 = x / numSteps;
      const u1 = (x + 1) / numSteps;
      const dx0 = u0 * tw;
      const dx1 = u1 * tw;

      const p00 = getQuadPoint(u0, v0);
      const p10 = getQuadPoint(u1, v0);
      const p01 = getQuadPoint(u0, v1);
      const p11 = getQuadPoint(u1, v1);

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(dx0, dy0);
      ctx.lineTo(dx1, dy0);
      ctx.lineTo(dx1, dy1);
      ctx.lineTo(dx0, dy1);
      ctx.closePath();
      ctx.clip();

      const minSx = Math.max(0, Math.min(p00.x, p10.x, p01.x, p11.x) - 1);
      const minSy = Math.max(0, Math.min(p00.y, p10.y, p01.y, p11.y) - 1);
      const maxSx = Math.min(sw, Math.max(p00.x, p10.x, p01.x, p11.x) + 1);
      const maxSy = Math.min(sh, Math.max(p00.y, p10.y, p01.y, p11.y) + 1);

      const cellSw = maxSx - minSx;
      const cellSh = maxSy - minSy;

      if (cellSw > 0 && cellSh > 0) {
        ctx.drawImage(srcCanvas, minSx, minSy, cellSw, cellSh, dx0, dy0, dx1 - dx0, dy1 - dy0);
      }
      ctx.restore();
    }
  }

  return canvas;
}

/**
 * Applies document scan filters:
 * - 'original': untouched
 * - 'clean': high-contrast black & white document enhancement
 * - 'grayscale': smooth monochrome
 * - 'enhanced': sharpened contrast & saturated color
 */
export function applyScanFilter(canvas: HTMLCanvasElement, filter: ScanFilter): HTMLCanvasElement {
  if (filter === 'original') return canvas;

  const out = document.createElement('canvas');
  out.width = canvas.width;
  out.height = canvas.height;
  const ctx = out.getContext('2d');
  if (!ctx) return canvas;

  ctx.drawImage(canvas, 0, 0);
  const imgData = ctx.getImageData(0, 0, out.width, out.height);
  const d = imgData.data;

  if (filter === 'grayscale') {
    for (let i = 0; i < d.length; i += 4) {
      const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      d[i] = g;
      d[i + 1] = g;
      d[i + 2] = g;
    }
  } else if (filter === 'clean') {
    // High-contrast document enhancement
    for (let i = 0; i < d.length; i += 4) {
      const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      // Adaptive s-curve contrast
      const val = g > 130 ? Math.min(255, g * 1.25) : Math.max(0, g * 0.7);
      d[i] = val;
      d[i + 1] = val;
      d[i + 2] = val;
    }
  } else if (filter === 'enhanced') {
    // Color enhancement
    for (let i = 0; i < d.length; i += 4) {
      d[i] = Math.min(255, Math.max(0, (d[i] - 128) * 1.25 + 138));
      d[i + 1] = Math.min(255, Math.max(0, (d[i + 1] - 128) * 1.25 + 138));
      d[i + 2] = Math.min(255, Math.max(0, (d[i + 2] - 128) * 1.25 + 138));
    }
  }

  ctx.putImageData(imgData, 0, 0);
  return out;
}

/**
 * Scan Check Quality Auditor:
 * Evaluates whether page looks blurry, too dark, or has text cut off at the edge.
 */
export function analyzeScanQuality(
  canvas: HTMLCanvasElement,
  corners?: Point[]
): QualityCheckResult {
  try {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return { warning: null, message: null };

    const w = Math.min(200, canvas.width);
    const h = Math.round((w * canvas.height) / canvas.width);

    const smallCanvas = document.createElement('canvas');
    smallCanvas.width = w;
    smallCanvas.height = h;
    const sCtx = smallCanvas.getContext('2d');
    if (!sCtx) return { warning: null, message: null };

    sCtx.drawImage(canvas, 0, 0, w, h);
    const imgData = sCtx.getImageData(0, 0, w, h);
    const d = imgData.data;

    let totalLum = 0;
    const lum = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) {
      const l = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
      lum[i] = l;
      totalLum += l;
    }

    const avgLuminance = totalLum / (w * h);

    // 1. Check Too Dark
    if (avgLuminance < 48) {
      return {
        warning: 'too_dark',
        message: 'Page is too dark. Increase lighting or avoid heavy shadows.',
      };
    }

    // 2. Check Cut-off
    if (corners) {
      const isTouchingEdge = corners.some(
        (c) => c.x <= 0.015 || c.x >= 0.985 || c.y <= 0.015 || c.y >= 0.985
      );
      if (isTouchingEdge) {
        return {
          warning: 'cut_off',
          message: 'Document corners touch the image border. Part of the text may be cut off.',
        };
      }
    }

    // 3. Check Blur (Laplacian edge variance)
    let laplacianVar = 0;
    let lapCount = 0;
    let lapSum = 0;

    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const idx = y * w + x;
        // Laplacian kernel: [0, 1, 0; 1, -4, 1; 0, 1, 0]
        const lap =
          lum[idx - 1] +
          lum[idx + 1] +
          lum[idx - w] +
          lum[idx + w] -
          4 * lum[idx];
        lapSum += Math.abs(lap);
        lapCount++;
      }
    }

    const avgLap = lapCount > 0 ? lapSum / lapCount : 0;
    if (avgLap < 4.2) {
      return {
        warning: 'blurry',
        message: 'Image appears blurry. Hold device steady and tap to refocus.',
      };
    }

    return { warning: null, message: null };
  } catch {
    return { warning: null, message: null };
  }
}
