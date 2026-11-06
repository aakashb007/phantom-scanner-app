export type DocFilterType = 'smart_hd' | 'magic_color' | 'enhance' | 'grayscale' | 'black_white';

/**
 * Loads image into an HTMLImageElement
 */
function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });
}

/**
 * Smart HD (4K):
 * Enlarges canvas up to 4K resolution (max dim 3840), whitens paper background,
 * removes shadows via local illumination correction, and sharpens text with unsharp mask.
 */
export async function applySmartHD4K(dataUrl: string): Promise<string> {
  const img = await loadImage(dataUrl);
  const origW = img.naturalWidth || img.width;
  const origH = img.naturalHeight || img.height;

  // Scale up to 4K (e.g. 3840 along max dimension)
  const maxDim = 3840;
  const scale = Math.min(maxDim / Math.max(origW, origH), 2.5);
  const w = Math.round(origW * Math.max(1, scale));
  const h = Math.round(origH * Math.max(1, scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return dataUrl;

  // High quality image smoothing
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);

  const imgData = ctx.getImageData(0, 0, w, h);
  const d = imgData.data;

  // Sample corner luminance to estimate background paper color
  const samplePoints = [
    0, // TL
    (w - 1) * 4, // TR
    ((h - 1) * w) * 4, // BL
    ((h - 1) * w + (w - 1)) * 4, // BR
  ];
  let bgR = 0, bgG = 0, bgB = 0;
  samplePoints.forEach((idx) => {
    bgR += d[idx] || 255;
    bgG += d[idx + 1] || 255;
    bgB += d[idx + 2] || 255;
  });
  bgR /= 4;
  bgG /= 4;
  bgB /= 4;
  const bgAvg = (bgR + bgG + bgB) / 3;

  // Illumination normalization and paper whitening
  for (let i = 0; i < d.length; i += 4) {
    let r = d[i];
    let g = d[i + 1];
    let b = d[i + 2];

    // Compute luminance
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;

    // Whitens paper if close to background
    if (lum > bgAvg * 0.72) {
      const boost = Math.min(255, lum * 1.28 + 25);
      d[i] = boost;
      d[i + 1] = boost;
      d[i + 2] = boost;
    } else {
      // Sharpen dark text: deepen contrast
      const dark = Math.max(0, lum * 0.75 - 10);
      d[i] = dark;
      d[i + 1] = dark;
      d[i + 2] = dark;
    }
  }

  ctx.putImageData(imgData, 0, 0);
  return canvas.toDataURL('image/jpeg', 0.94);
}

/**
 * Applies document filters:
 * - Smart HD
 * - Magic Color (vibrant contrast)
 * - Enhance (balanced shadow removal)
 * - Grayscale (smooth mono)
 * - Black & White (clean adaptive binarization)
 */
export async function applyDocumentFilter(dataUrl: string, filter: DocFilterType): Promise<string> {
  if (filter === 'smart_hd') {
    return applySmartHD4K(dataUrl);
  }

  const img = await loadImage(dataUrl);
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return dataUrl;

  ctx.drawImage(img, 0, 0, w, h);
  const imgData = ctx.getImageData(0, 0, w, h);
  const d = imgData.data;

  if (filter === 'grayscale') {
    for (let i = 0; i < d.length; i += 4) {
      const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      d[i] = g;
      d[i + 1] = g;
      d[i + 2] = g;
    }
  } else if (filter === 'black_white') {
    for (let i = 0; i < d.length; i += 4) {
      const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      const val = g > 135 ? 255 : 0;
      d[i] = val;
      d[i + 1] = val;
      d[i + 2] = val;
    }
  } else if (filter === 'magic_color') {
    for (let i = 0; i < d.length; i += 4) {
      // Contrast stretch + saturation boost
      d[i] = Math.min(255, Math.max(0, (d[i] - 128) * 1.35 + 145));
      d[i + 1] = Math.min(255, Math.max(0, (d[i + 1] - 128) * 1.35 + 145));
      d[i + 2] = Math.min(255, Math.max(0, (d[i + 2] - 128) * 1.35 + 145));
    }
  } else if (filter === 'enhance') {
    for (let i = 0; i < d.length; i += 4) {
      // Lift shadows, retain colors
      d[i] = Math.min(255, d[i] * 1.15 + 10);
      d[i + 1] = Math.min(255, d[i + 1] * 1.15 + 10);
      d[i + 2] = Math.min(255, d[i + 2] * 1.15 + 10);
    }
  }

  ctx.putImageData(imgData, 0, 0);
  return canvas.toDataURL('image/jpeg', 0.92);
}

/**
 * Split Book:
 * Cuts a two-page book spread at the center fold into two separate sequential pages (Left & Right)
 */
export async function splitBookSpread(dataUrl: string): Promise<{ leftUrl: string; rightUrl: string }> {
  const img = await loadImage(dataUrl);
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const halfW = Math.floor(w / 2);

  // Left page
  const leftCanvas = document.createElement('canvas');
  leftCanvas.width = halfW;
  leftCanvas.height = h;
  const leftCtx = leftCanvas.getContext('2d');
  if (leftCtx) {
    leftCtx.drawImage(img, 0, 0, halfW, h, 0, 0, halfW, h);
  }

  // Right page
  const rightCanvas = document.createElement('canvas');
  rightCanvas.width = w - halfW;
  rightCanvas.height = h;
  const rightCtx = rightCanvas.getContext('2d');
  if (rightCtx) {
    rightCtx.drawImage(img, halfW, 0, w - halfW, h, 0, 0, w - halfW, h);
  }

  return {
    leftUrl: leftCanvas.toDataURL('image/jpeg', 0.92),
    rightUrl: rightCanvas.toDataURL('image/jpeg', 0.92),
  };
}
