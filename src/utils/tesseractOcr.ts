import { createWorker } from 'tesseract.js';
import { DocumentRecord, OcrWordBox } from '../types/document';
import { getDocument, updateDocument, getSetting } from '../db/db';

let ocrWorkerPromise: Promise<Tesseract.Worker> | null = null;

async function getOcrWorker(): Promise<Tesseract.Worker> {
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = (async () => {
      // Initialize English and Hindi (eng+hin) worker
      const worker = await createWorker(['eng', 'hin']);
      return worker;
    })();
  }
  return ocrWorkerPromise;
}

/**
 * Extracts a clean title-like line from OCR text.
 * Skips symbols, tiny numbers, and extracts prominent header text.
 */
export function extractSmartTitle(ocrText: string): string | null {
  if (!ocrText) return null;
  const lines = ocrText
    .split(/\r?\n/)
    .map((l) => l.trim().replace(/^[^a-zA-Z0-9\u0900-\u097F]+/, ''))
    .filter((l) => l.length >= 3 && !/^\d+$/.test(l));

  if (lines.length === 0) return null;

  // Return the best candidate line (max 38 chars)
  const candidate = lines[0].substring(0, 38).trim();
  return candidate || null;
}

/**
 * Runs on-device OCR with Tesseract.js (eng+hin) in the background.
 * Updates the document record in IndexedDB with OCR text, word boxes, and smart naming.
 */
export async function runBackgroundOcr(
  docId: string,
  onComplete?: (updatedDoc: DocumentRecord) => void
): Promise<void> {
  try {
    const doc = await getDocument(docId);
    if (!doc || !doc.pages || doc.pages.length === 0) return;

    let hasUpdates = false;
    const updatedPages = [...doc.pages];
    let firstPageOcrText = '';

    for (let i = 0; i < updatedPages.length; i++) {
      const page = updatedPages[i];
      // Run OCR if not yet processed with word boxes
      if (!page.ocrWords || page.ocrWords.length === 0) {
        try {
          const worker = await getOcrWorker();
          const ret = await worker.recognize(page.dataUrl);

          const rawData = ret.data as unknown as {
            text?: string;
            words?: Array<{
              text: string;
              bbox: { x0: number; y0: number; x1: number; y1: number };
              confidence?: number;
            }>;
          };

          const fullText = rawData.text || '';
          // Extract word bounding boxes
          const wordBoxes: OcrWordBox[] = (rawData.words || []).map((w) => ({
            text: w.text,
            bbox: {
              x0: w.bbox.x0,
              y0: w.bbox.y0,
              x1: w.bbox.x1,
              y1: w.bbox.y1,
            },
            confidence: w.confidence,
          }));

          updatedPages[i] = {
            ...page,
            ocrText: fullText.trim() || page.ocrText,
            ocrWords: wordBoxes,
          };
          hasUpdates = true;

          if (i === 0) {
            firstPageOcrText = fullText.trim();
          }
        } catch (pageErr) {
          console.warn(`OCR error on page ${i + 1}:`, pageErr);
        }
      } else if (i === 0 && page.ocrText) {
        firstPageOcrText = page.ocrText;
      }
    }

    // Check smart naming setting (default: true)
    const isSmartNamingEnabled = await getSetting<boolean>('smart_naming', true);
    let newDocName = doc.name;

    if (isSmartNamingEnabled && firstPageOcrText) {
      const smartTitle = extractSmartTitle(firstPageOcrText);
      // Only replace if document still has default "Scan " name
      if (smartTitle && doc.name.startsWith('Scan ')) {
        newDocName = smartTitle;
        hasUpdates = true;
      }
    }

    if (hasUpdates) {
      const updated = await updateDocument(doc.docId, {
        pages: updatedPages,
        name: newDocName,
      });

      if (updated && onComplete) {
        onComplete(updated);
      }
    }
  } catch (err) {
    console.error('Background OCR execution error:', err);
  }
}

/**
 * Recognizes text from a single image dataUrl using on-device Tesseract
 */
export async function recognizeImageText(dataUrl: string): Promise<string> {
  try {
    const worker = await getOcrWorker();
    const ret = await worker.recognize(dataUrl);
    return ret.data?.text || '';
  } catch (err) {
    console.warn('OCR error:', err);
    return '';
  }
}
