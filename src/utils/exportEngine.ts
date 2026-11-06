import { PDFDocument } from 'pdf-lib';
import { DocumentRecord, DocumentPage } from '../types/document';

export type ExportFormat = 'pdf' | 'jpg';
export type ExportQuality = 'small' | 'standard' | 'hd' | '4k';
export type WatermarkMode = 'none' | 'custom' | 'anticounterfeit';
export type WatermarkLayout = 'single' | 'tiled';

export interface WatermarkConfig {
  mode: WatermarkMode;
  text: string;
  purpose: string; // Used for anti-counterfeit
  color: string;
  opacity: number; // 0.05 to 0.70
  fontSize: number; // 14 to 64
  layout: WatermarkLayout;
}

export interface ExportOptions {
  format: ExportFormat;
  quality: ExportQuality;
  watermark: WatermarkConfig;
}

// Maximum pixel dimension per quality tier
export const QUALITY_CONFIG: Record<ExportQuality, { maxDimension: number; jpegQuality: number; label: string; description: string }> = {
  small: {
    maxDimension: 1024,
    jpegQuality: 0.65,
    label: 'Small',
    description: 'Quick email & WhatsApp sharing (lowest file size)',
  },
  standard: {
    maxDimension: 1600,
    jpegQuality: 0.82,
    label: 'Standard',
    description: 'Balanced clarity and moderate file size',
  },
  hd: {
    maxDimension: 2480, // A4 standard at 300 DPI
    jpegQuality: 0.92,
    label: 'HD (300 DPI)',
    description: 'High-definition for print and official archives',
  },
  '4k': {
    maxDimension: 3840,
    jpegQuality: 0.96,
    label: '4K Ultra',
    description: 'Maximum resolution preservation',
  },
};

/**
 * Returns formatted today date string YYYY-MM-DD
 */
export function getTodayDateString(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Clean file name for downloads
 */
export function sanitizeFilename(name: string): string {
  return name.replace(/[/\\?%*:|"<>]/g, '_').trim() || 'Document';
}

/**
 * Resolves the final watermark text based on mode
 */
export function getEffectiveWatermarkText(cfg: WatermarkConfig): string {
  if (cfg.mode === 'none') return '';
  if (cfg.mode === 'anticounterfeit') {
    const purpose = cfg.purpose.trim() || 'official verification';
    const dateStr = getTodayDateString();
    return `For ${purpose} only · ${dateStr}`;
  }
  return cfg.text.trim();
}

/**
 * Draws watermarked image on a canvas with target quality scaling
 */
export async function renderPageToCanvas(
  page: DocumentPage,
  quality: ExportQuality,
  watermark: WatermarkConfig
): Promise<HTMLCanvasElement> {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = reject;
    img.src = page.dataUrl;
  });

  const rotation = (page.rotation || 0) % 360;
  const is90or270 = rotation === 90 || rotation === 270;
  const srcWidth = is90or270 ? img.naturalHeight : img.naturalWidth;
  const srcHeight = is90or270 ? img.naturalWidth : img.naturalHeight;

  const targetMax = QUALITY_CONFIG[quality].maxDimension;
  const scale = Math.min(1, targetMax / Math.max(srcWidth, srcHeight));
  const finalWidth = Math.round(srcWidth * scale);
  const finalHeight = Math.round(srcHeight * scale);

  const canvas = document.createElement('canvas');
  canvas.width = finalWidth;
  canvas.height = finalHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get 2D canvas context');

  // Background white
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, finalWidth, finalHeight);

  // Draw rotated source image
  ctx.save();
  ctx.translate(finalWidth / 2, finalHeight / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  if (is90or270) {
    ctx.drawImage(img, -finalHeight / 2, -finalWidth / 2, finalHeight, finalWidth);
  } else {
    ctx.drawImage(img, -finalWidth / 2, -finalHeight / 2, finalWidth, finalHeight);
  }
  ctx.restore();

  // Watermark drawing
  const text = getEffectiveWatermarkText(watermark);
  if (watermark.mode !== 'none' && text) {
    drawWatermarkOnCanvas(ctx, finalWidth, finalHeight, text, watermark, scale);
  }

  return canvas;
}

/**
 * Draws either single diagonal or tiled anti-counterfeit watermark lattice
 */
function drawWatermarkOnCanvas(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  text: string,
  config: WatermarkConfig,
  scale: number
) {
  ctx.save();
  const scaledFontSize = Math.max(12, Math.round(config.fontSize * (width / 800) * 0.9));
  ctx.font = `bold ${scaledFontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
  ctx.fillStyle = config.color;
  ctx.globalAlpha = config.opacity;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const angle = (-32 * Math.PI) / 180;

  if (config.layout === 'single') {
    // Single centered diagonal watermark
    ctx.translate(width / 2, height / 2);
    ctx.rotate(angle);
    ctx.fillText(text, 0, 0);
  } else {
    // Tiled repeating lattice across whole page
    ctx.rotate(angle);

    const metrics = ctx.measureText(text);
    const textWidth = metrics.width;
    const stepX = Math.max(textWidth + 60 * scale, 160);
    const stepY = Math.max(scaledFontSize * 3.8, 80);

    // Cover expanded bounds due to rotation
    const diag = Math.hypot(width, height);
    const startX = -diag;
    const endX = diag * 1.5;
    const startY = -diag;
    const endY = diag * 1.5;

    let rowIndex = 0;
    for (let y = startY; y < endY; y += stepY) {
      const offsetX = (rowIndex % 2) * (stepX / 2);
      for (let x = startX; x < endX; x += stepX) {
        ctx.fillText(text, x + offsetX, y);
      }
      rowIndex++;
    }
  }

  ctx.restore();
}

/**
 * Generates single-page or multi-page PDF using pdf-lib
 */
export async function generateExportPdfWithPdfLib(
  doc: DocumentRecord,
  quality: ExportQuality,
  watermark: WatermarkConfig
): Promise<File> {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle(doc.name);
  pdfDoc.setAuthor('Phantom Scanner');
  pdfDoc.setProducer('Phantom Scanner (built by Aakash Saleem)');
  pdfDoc.setCreationDate(new Date(doc.created));
  pdfDoc.setModificationDate(new Date());

  const jpegQuality = QUALITY_CONFIG[quality].jpegQuality;

  for (let i = 0; i < doc.pages.length; i++) {
    const page = doc.pages[i];
    const canvas = await renderPageToCanvas(page, quality, watermark);

    // Convert canvas to JPEG blob and arrayBuffer
    const jpgBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Canvas export failed'))),
        'image/jpeg',
        jpegQuality
      );
    });

    const jpgBytes = new Uint8Array(await jpgBlob.arrayBuffer());
    const embeddedImage = await pdfDoc.embedJpg(jpgBytes);

    // Match PDF page points to image dimensions (standard 72 pt/in layout)
    const pdfPage = pdfDoc.addPage([canvas.width, canvas.height]);
    pdfPage.drawImage(embeddedImage, {
      x: 0,
      y: 0,
      width: canvas.width,
      height: canvas.height,
    });
  }

  const pdfBytes = await pdfDoc.save();
  const filename = `${sanitizeFilename(doc.name)}.pdf`;

  return new File([pdfBytes as unknown as BlobPart], filename, { type: 'application/pdf' });
}

/**
 * Generates an array of JPG Files (one per page)
 */
export async function generateExportJpgFiles(
  doc: DocumentRecord,
  quality: ExportQuality,
  watermark: WatermarkConfig
): Promise<File[]> {
  const files: File[] = [];
  const jpegQuality = QUALITY_CONFIG[quality].jpegQuality;
  const baseName = sanitizeFilename(doc.name);

  for (let i = 0; i < doc.pages.length; i++) {
    const page = doc.pages[i];
    const canvas = await renderPageToCanvas(page, quality, watermark);

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Canvas export failed'))),
        'image/jpeg',
        jpegQuality
      );
    });

    const filename =
      doc.pages.length > 1 ? `${baseName}_page_${i + 1}.jpg` : `${baseName}.jpg`;

    files.push(new File([blob], filename, { type: 'image/jpeg' }));
  }

  return files;
}

/**
 * Triggers direct browser download for a File
 */
export function downloadFile(file: File) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * Shares file(s) via Web Share API or falls back to direct download
 */
export async function shareOrDownloadFiles(
  files: File[],
  title: string
): Promise<{ method: 'shared' | 'downloaded' }> {
  if (
    typeof navigator !== 'undefined' &&
    navigator.share &&
    navigator.canShare &&
    navigator.canShare({ files })
  ) {
    try {
      await navigator.share({
        files,
        title,
        text: `${title} (${files.length} ${files.length === 1 ? 'file' : 'files'})`,
      });
      return { method: 'shared' };
    } catch (err: unknown) {
      if ((err as Error)?.name === 'AbortError') {
        return { method: 'shared' };
      }
      // If user cancelled or failed, fall through to download
    }
  }

  // Fallback: download sequentially
  files.forEach((f) => downloadFile(f));
  return { method: 'downloaded' };
}
