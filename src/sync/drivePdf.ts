// Builds and reads the Google Drive PDF format shared with the Android app:
// one PDF per document, each page a JPEG image fitted inside an A4 page, no text layer.
import { PDFDocument, PDFName, PDFDict, PDFRawStream, PDFArray } from 'pdf-lib';

export type DriveSize = 'small' | 'standard' | 'hd';

export const DRIVE_SIZE_SPECS: Record<DriveSize, { longest: number; quality: number }> = {
  small: { longest: 1240, quality: 0.55 },
  standard: { longest: 1800, quality: 0.75 },
  hd: { longest: 2480, quality: 0.88 },
};

const A4_W = 595;
const A4_H = 842;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load page image'));
    img.src = src;
  });
}

/** Re-encode a page image as JPEG with the longest side limited to the Drive size. */
export async function pageToJpegBytes(dataUrl: string, size: DriveSize): Promise<{ bytes: Uint8Array; w: number; h: number }> {
  const spec = DRIVE_SIZE_SPECS[size];
  const img = await loadImage(dataUrl);
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const factor = Math.min(1, spec.longest / Math.max(iw, ih));
  const w = Math.max(1, Math.round(iw * factor));
  const h = Math.max(1, Math.round(ih * factor));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  const blob: Blob = await new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('JPEG encode failed'))), 'image/jpeg', spec.quality)
  );
  return { bytes: new Uint8Array(await blob.arrayBuffer()), w, h };
}

/** One JPEG per A4 page (landscape A4 when the image is wider than tall), image fitted and centred. */
export async function buildDrivePdf(pageDataUrls: string[], size: DriveSize): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  for (const url of pageDataUrls) {
    const { bytes, w, h } = await pageToJpegBytes(url, size);
    const jpg = await pdf.embedJpg(bytes);
    const landscape = w > h;
    const pw = landscape ? A4_H : A4_W;
    const ph = landscape ? A4_W : A4_H;
    const s = Math.min(pw / w, ph / h);
    const dw = w * s;
    const dh = h * s;
    const page = pdf.addPage([pw, ph]);
    page.drawImage(jpg, { x: (pw - dw) / 2, y: (ph - dh) / 2, width: dw, height: dh });
  }
  return pdf.save({ useObjectStreams: false });
}

function bytesToDataUrl(bytes: Uint8Array, mime: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(new Blob([bytes as BlobPart], { type: mime }));
  });
}

/** Read the embedded JPEG of each page, in page order, without re-compressing. */
export async function extractJpegPages(pdfBytes: Uint8Array): Promise<string[]> {
  const pdf = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const out: string[] = [];
  for (const page of pdf.getPages()) {
    let found: Uint8Array | null = null;
    let bestArea = 0;
    // Look at the page's images, and one or two levels into form XObjects (some PDF writers wrap images).
    const scan = (resources: PDFDict | undefined, depth: number) => {
      const xobjects = resources?.lookupMaybe(PDFName.of('XObject'), PDFDict);
      if (!xobjects) return;
      for (const [, ref] of xobjects.entries()) {
        const obj = pdf.context.lookup(ref);
        if (!(obj instanceof PDFRawStream)) continue;
        const dict = obj.dict;
        const subtype = dict.get(PDFName.of('Subtype'));
        if (subtype === PDFName.of('Form') && depth < 2) {
          scan(dict.lookupMaybe(PDFName.of('Resources'), PDFDict), depth + 1);
          continue;
        }
        if (subtype !== PDFName.of('Image')) continue;
        const filter = dict.get(PDFName.of('Filter'));
        const isDct =
          filter === PDFName.of('DCTDecode') ||
          (filter instanceof PDFArray && filter.size() === 1 && filter.get(0) === PDFName.of('DCTDecode'));
        if (!isDct) continue;
        const w = Number(dict.get(PDFName.of('Width'))?.toString() || 0);
        const h = Number(dict.get(PDFName.of('Height'))?.toString() || 0);
        if (w * h >= bestArea) {
          bestArea = w * h;
          found = obj.contents;
        }
      }
    };
    scan(page.node.Resources(), 0);
    if (!found) return []; // fall back to rendering for the whole document
    out.push(await bytesToDataUrl(found, 'image/jpeg'));
  }
  return out;
}

/** Fallback: render each PDF page to a JPEG image with pdf.js. */
export async function renderPdfPages(pdfBytes: Uint8Array): Promise<string[]> {
  const { pdfjsLib: pdfjs } = await import('../utils/pdfjsSetup');
  const doc = await pdfjs.getDocument({ data: pdfBytes.slice() }).promise;
  const out: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const vp1 = page.getViewport({ scale: 1 });
    const scale = 1800 / Math.max(vp1.width, vp1.height);
    const vp = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(vp.width);
    canvas.height = Math.round(vp.height);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await (page.render({ canvasContext: ctx, viewport: vp, canvas } as any)).promise;
    out.push(canvas.toDataURL('image/jpeg', 0.85));
  }
  return out;
}
