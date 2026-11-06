import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

function createPNG(width, height, drawFn) {
  const buffer = Buffer.alloc(width * height * 4);
  drawFn(buffer, width, height);

  // PNG scanlines: 1 filter byte (0) + width * 4 bytes per row
  const scanlineWidth = width * 4;
  const rawData = Buffer.alloc(height * (scanlineWidth + 1));

  for (let y = 0; y < height; y++) {
    const rawOffset = y * (scanlineWidth + 1);
    rawData[rawOffset] = 0; // Filter: None
    buffer.copy(rawData, rawOffset + 1, y * scanlineWidth, (y + 1) * scanlineWidth);
  }

  const compressed = zlib.deflateSync(rawData);

  function crc32(buf) {
    let crc = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
      let byte = buf[i];
      for (let j = 0; j < 8; j++) {
        const mask = -(byte & 1);
        byte = (byte >>> 1) ^ (0xedb88320 & mask);
      }
      crc = (crc >>> 8) ^ (0xedb88320 & (-(crc & 1)));
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  // Proper CRC32
  const crcTable = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    crcTable[i] = c >>> 0;
  }

  function getCRC(chunkType, chunkData) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < chunkType.length; i++) {
      c = crcTable[(c ^ chunkType.charCodeAt(i)) & 0xFF] ^ (c >>> 8);
    }
    for (let i = 0; i < chunkData.length; i++) {
      c = crcTable[(c ^ chunkData[i]) & 0xFF] ^ (c >>> 8);
    }
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function makeChunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(getCRC(type, data), 0);
    return Buffer.concat([len, typeBuf, data, crc]);
  }

  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const ihdrChunk = makeChunk('IHDR', ihdr);
  const idatChunk = makeChunk('IDAT', compressed);
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([sig, ihdrChunk, idatChunk, iendChunk]);
}

function drawViewfinderIcon(buf, w, h, isMaskable = false) {
  // Fill background #0B0B10
  for (let i = 0; i < w * h; i++) {
    buf[i * 4 + 0] = 11;  // R
    buf[i * 4 + 1] = 11;  // G
    buf[i * 4 + 2] = 16;  // B
    buf[i * 4 + 3] = 255; // A
  }

  // Draw rounded rect corners if not maskable (squircle icon background)
  // For PWA icons, full bleed is best.

  const scale = w / 512;
  const pad = isMaskable ? 100 * scale : 56 * scale;
  const boxW = w - pad * 2;
  const boxH = h - pad * 2;
  const stroke = Math.round(18 * scale);
  const armLen = Math.round(52 * scale);

  function setPixel(x, y, r, g, b, a = 255) {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || x >= w || y < 0 || y >= h) return;
    const idx = (y * w + x) * 4;
    // Simple alpha blend
    const srcA = a / 255;
    const dstA = buf[idx + 3] / 255;
    const outA = srcA + dstA * (1 - srcA);
    if (outA > 0) {
      buf[idx + 0] = Math.round((r * srcA + buf[idx + 0] * dstA * (1 - srcA)) / outA);
      buf[idx + 1] = Math.round((g * srcA + buf[idx + 1] * dstA * (1 - srcA)) / outA);
      buf[idx + 2] = Math.round((b * srcA + buf[idx + 2] * dstA * (1 - srcA)) / outA);
      buf[idx + 3] = Math.round(outA * 255);
    }
  }

  function fillRect(x1, y1, x2, y2, r, g, b, a = 255) {
    const minX = Math.max(0, Math.min(x1, x2));
    const maxX = Math.min(w - 1, Math.max(x1, x2));
    const minY = Math.max(0, Math.min(y1, y2));
    const maxY = Math.min(h - 1, Math.max(y1, y2));
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        setPixel(x, y, r, g, b, a);
      }
    }
  }

  // White viewfinder 4 corners
  const x1 = pad;
  const y1 = pad;
  const x2 = pad + boxW;
  const y2 = pad + boxH;

  // Top-left
  fillRect(x1, y1, x1 + armLen, y1 + stroke, 255, 255, 255);
  fillRect(x1, y1, x1 + stroke, y1 + armLen, 255, 255, 255);

  // Top-right
  fillRect(x2 - armLen, y1, x2, y1 + stroke, 255, 255, 255);
  fillRect(x2 - stroke, y1, x2, y1 + armLen, 255, 255, 255);

  // Bottom-left
  fillRect(x1, y2 - stroke, x1 + armLen, y2, 255, 255, 255);
  fillRect(x1, y2 - armLen, x1 + stroke, y2, 255, 255, 255);

  // Bottom-right
  fillRect(x2 - armLen, y2 - stroke, x2, y2, 255, 255, 255);
  fillRect(x2 - stroke, y2 - armLen, x2, y2, 255, 255, 255);

  // Violet Letter "P" in center: #A78BFA (167, 139, 250)
  // Geometric P with vertical stem and loop
  const pStemX = Math.round(w / 2 - 40 * scale);
  const pStemTop = Math.round(h / 2 - 85 * scale);
  const pStemBottom = Math.round(h / 2 + 85 * scale);
  const pStemWidth = Math.round(28 * scale);

  // Stem
  fillRect(pStemX, pStemTop, pStemX + pStemWidth, pStemBottom, 167, 139, 250);

  // Loop top bar, bottom bar, right curve
  const loopTop = pStemTop;
  const loopBottom = Math.round(h / 2 + 8 * scale);
  const loopH = loopBottom - loopTop;
  const loopRadius = loopH / 2;
  const loopCenterX = pStemX + pStemWidth;
  const loopRight = Math.round(w / 2 + 50 * scale);

  // Fill loop outer
  const vr = 167, vg = 139, vb = 250;
  // Upper bar
  fillRect(pStemX, loopTop, loopRight - loopRadius, loopTop + pStemWidth, vr, vg, vb);
  // Lower bar
  fillRect(pStemX, loopBottom - pStemWidth, loopRight - loopRadius, loopBottom, vr, vg, vb);

  // Outer semicircle
  const outerR = loopRadius;
  const innerR = loopRadius - pStemWidth;
  const arcCenterX = loopRight - loopRadius;
  const arcCenterY = (loopTop + loopBottom) / 2;

  for (let y = loopTop; y <= loopBottom; y++) {
    for (let x = arcCenterX; x <= arcCenterX + outerR + 2; x++) {
      const dist = Math.hypot(x - arcCenterX, y - arcCenterY);
      if (dist <= outerR && dist >= innerR) {
        setPixel(x, y, vr, vg, vb);
      }
    }
  }
}

const publicDir = path.resolve('public');
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

fs.writeFileSync(path.join(publicDir, 'pwa-192x192.png'), createPNG(192, 192, (buf, w, h) => drawViewfinderIcon(buf, w, h, false)));
fs.writeFileSync(path.join(publicDir, 'pwa-512x512.png'), createPNG(512, 512, (buf, w, h) => drawViewfinderIcon(buf, w, h, false)));
fs.writeFileSync(path.join(publicDir, 'pwa-maskable-512x512.png'), createPNG(512, 512, (buf, w, h) => drawViewfinderIcon(buf, w, h, true)));
fs.writeFileSync(path.join(publicDir, 'apple-touch-icon.png'), createPNG(180, 180, (buf, w, h) => drawViewfinderIcon(buf, w, h, false)));

// Also create icon.svg
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" fill="#0B0B10" rx="112" />
  <!-- Scan frame corners -->
  <path d="M 64 120 L 64 64 L 120 64" fill="none" stroke="#FFFFFF" stroke-width="24" stroke-linecap="round" stroke-linejoin="round" />
  <path d="M 392 64 L 448 64 L 448 120" fill="none" stroke="#FFFFFF" stroke-width="24" stroke-linecap="round" stroke-linejoin="round" />
  <path d="M 64 392 L 64 448 L 120 448" fill="none" stroke="#FFFFFF" stroke-width="24" stroke-linecap="round" stroke-linejoin="round" />
  <path d="M 392 448 L 448 448 L 448 392" fill="none" stroke="#FFFFFF" stroke-width="24" stroke-linecap="round" stroke-linejoin="round" />
  
  <!-- Violet P -->
  <path d="M 210 160 L 210 352 M 210 160 L 285 160 C 330 160 330 250 285 250 L 210 250" 
        fill="none" stroke="#A78BFA" stroke-width="36" stroke-linecap="round" stroke-linejoin="round" />
</svg>`;

fs.writeFileSync(path.join(publicDir, 'icon.svg'), svg);
console.log('PWA icons successfully generated in public/ directory!');
