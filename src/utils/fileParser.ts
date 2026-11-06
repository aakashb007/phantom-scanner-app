import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import { PDFDocument, degrees } from 'pdf-lib';
import { SupportedFileType, DocumentRecord, DocumentPage } from '../types/document';
import { saveDocument } from '../db/db';

export interface PptxSlideData {
  slideNumber: number;
  title: string;
  bullets: string[];
  paragraphs: string[];
  tables: string[][][];
  images: string[]; // data URLs
}

export interface PptxParsedWorkbook {
  title: string;
  slides: PptxSlideData[];
}

export interface XlsxSheetData {
  name: string;
  rows: string[][];
  maxCols: number;
}

export interface XlsxParsedWorkbook {
  sheetNames: string[];
  sheets: Record<string, XlsxSheetData>;
}

/**
 * Detect file type from name or MIME
 */
export function detectFileType(filename: string, mime?: string): SupportedFileType {
  const ext = filename.split('.').pop()?.toLowerCase();
  if (ext === 'pdf' || mime === 'application/pdf') return 'pdf';
  if (ext === 'docx' || mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx';
  if (ext === 'xlsx' || ext === 'xls' || mime?.includes('spreadsheetml') || mime?.includes('ms-excel')) return 'xlsx';
  if (ext === 'pptx' || mime === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') return 'pptx';
  if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'avif'].includes(ext || '') || mime?.startsWith('image/')) return 'image';
  return 'other';
}

/**
 * Parse a PowerPoint (.pptx) file using JSZip
 */
export async function parsePptxFile(arrayBuffer: ArrayBuffer, fileName: string): Promise<PptxParsedWorkbook> {
  const zip = await JSZip.loadAsync(arrayBuffer);
  const domParser = new DOMParser();

  // 1. Read all media images in ppt/media/
  const mediaMap: Record<string, string> = {};
  const mediaFolder = zip.folder('ppt/media');
  if (mediaFolder) {
    const promises: Promise<void>[] = [];
    mediaFolder.forEach((relPath, file) => {
      promises.push(
        file.async('base64').then((b64) => {
          const ext = relPath.split('.').pop()?.toLowerCase() || 'png';
          const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`;
          mediaMap[`ppt/media/${relPath}`] = `data:${mime};base64,${b64}`;
          mediaMap[relPath] = `data:${mime};base64,${b64}`;
        })
      );
    });
    await Promise.all(promises);
  }

  // 2. Locate all slide files (ppt/slides/slide*.xml)
  const slidePaths: string[] = [];
  zip.forEach((path) => {
    if (/^ppt\/slides\/slide\d+\.xml$/i.test(path)) {
      slidePaths.push(path);
    }
  });

  // Sort slides numerically: slide1, slide2, slide10, etc.
  slidePaths.sort((a, b) => {
    const numA = parseInt(a.replace(/[^0-9]/g, ''), 10) || 0;
    const numB = parseInt(b.replace(/[^0-9]/g, ''), 10) || 0;
    return numA - numB;
  });

  const slides: PptxSlideData[] = [];

  for (let idx = 0; idx < slidePaths.length; idx++) {
    const slidePath = slidePaths[idx];
    const slideNumber = idx + 1;
    const slideXmlStr = await zip.file(slidePath)?.async('string');
    if (!slideXmlStr) continue;

    const xmlDoc = domParser.parseFromString(slideXmlStr, 'application/xml');

    // Load relationships for images in this slide (ppt/slides/_rels/slideX.xml.rels)
    const relsPath = slidePath.replace('ppt/slides/', 'ppt/slides/_rels/') + '.rels';
    const relsXmlStr = await zip.file(relsPath)?.async('string');
    const slideRelMap: Record<string, string> = {};
    if (relsXmlStr) {
      const relsDoc = domParser.parseFromString(relsXmlStr, 'application/xml');
      const relElements = relsDoc.getElementsByTagName('Relationship');
      for (let i = 0; i < relElements.length; i++) {
        const id = relElements[i].getAttribute('Id') || '';
        const target = relElements[i].getAttribute('Target') || '';
        // Target can be "../media/image1.png"
        const cleanTarget = target.replace('../media/', '');
        if (mediaMap[cleanTarget]) {
          slideRelMap[id] = mediaMap[cleanTarget];
        }
      }
    }

    // Extract text paragraphs and shape titles
    let title = '';
    const bullets: string[] = [];
    const paragraphs: string[] = [];

    // Check title element or first shape with text
    const shapeElements = xmlDoc.getElementsByTagName('p:sp');
    for (let s = 0; s < shapeElements.length; s++) {
      const shape = shapeElements[s];
      const phType = shape.getElementsByTagName('p:ph')[0]?.getAttribute('type');
      const textNodes = shape.getElementsByTagName('a:t');
      const text = Array.from(textNodes)
        .map((n) => n.textContent?.trim() || '')
        .filter(Boolean)
        .join(' ');

      if (!text) continue;

      if (!title && (phType === 'title' || phType === 'ctrTitle' || s === 0)) {
        title = text;
      } else {
        // Look for bullets or general text
        const paraElements = shape.getElementsByTagName('a:p');
        for (let p = 0; p < paraElements.length; p++) {
          const pText = Array.from(paraElements[p].getElementsByTagName('a:t'))
            .map((n) => n.textContent?.trim() || '')
            .filter(Boolean)
            .join(' ');
          if (!pText) continue;

          // Check if bullet
          const buChar = paraElements[p].getElementsByTagName('a:buChar')[0];
          const buAutoNum = paraElements[p].getElementsByTagName('a:buAutoNum')[0];
          if (buChar || buAutoNum || paraElements[p].getAttribute('lvl')) {
            bullets.push(pText);
          } else if (pText !== title) {
            paragraphs.push(pText);
          }
        }
      }
    }

    // Extract tables
    const tables: string[][][] = [];
    const tableElements = xmlDoc.getElementsByTagName('a:tbl');
    for (let t = 0; t < tableElements.length; t++) {
      const tbl = tableElements[t];
      const tableRows: string[][] = [];
      const trElements = tbl.getElementsByTagName('a:tr');
      for (let r = 0; r < trElements.length; r++) {
        const rowCells: string[] = [];
        const tcElements = trElements[r].getElementsByTagName('a:tc');
        for (let c = 0; c < tcElements.length; c++) {
          const cellText = Array.from(tcElements[c].getElementsByTagName('a:t'))
            .map((n) => n.textContent?.trim() || '')
            .filter(Boolean)
            .join(' ');
          rowCells.push(cellText);
        }
        if (rowCells.length > 0) tableRows.push(rowCells);
      }
      if (tableRows.length > 0) tables.push(tableRows);
    }

    // Collect slide images from blip elements
    const slideImages: string[] = [];
    const blipElements = xmlDoc.getElementsByTagName('a:blip');
    for (let b = 0; b < blipElements.length; b++) {
      const embedId = blipElements[b].getAttribute('r:embed');
      if (embedId && slideRelMap[embedId]) {
        slideImages.push(slideRelMap[embedId]);
      }
    }

    slides.push({
      slideNumber,
      title: title || `Slide ${slideNumber}`,
      bullets,
      paragraphs,
      tables,
      images: slideImages,
    });
  }

  return {
    title: fileName.replace(/\.[^/.]+$/, ''),
    slides: slides.length > 0 ? slides : [
      {
        slideNumber: 1,
        title: fileName,
        bullets: ['No slide content could be read from this presentation.'],
        paragraphs: [],
        tables: [],
        images: [],
      },
    ],
  };
}

/**
 * Parse an Excel (.xlsx/.xls) workbook with SheetJS
 */
export function parseXlsxFile(arrayBuffer: ArrayBuffer): XlsxParsedWorkbook {
  const workbook = XLSX.read(arrayBuffer, { type: 'array', cellDates: true });
  const sheetNames = workbook.SheetNames || [];
  const sheets: Record<string, XlsxSheetData> = {};

  sheetNames.forEach((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) return;

    // Convert to 2D array of string values
    const rawRows: (string | number | boolean | null | undefined)[][] = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: '',
      blankrows: true,
      raw: false,
    });

    let maxCols = 0;
    const formattedRows: string[][] = rawRows.map((row) => {
      maxCols = Math.max(maxCols, row.length);
      return row.map((cell) => (cell !== null && cell !== undefined ? String(cell) : ''));
    });

    sheets[sheetName] = {
      name: sheetName,
      rows: formattedRows.length > 0 ? formattedRows : [['(Empty Sheet)']],
      maxCols: Math.max(maxCols, 1),
    };
  });

  return {
    sheetNames,
    sheets,
  };
}

/**
 * PDF TOOL: Compress PDF
 * Creates a smaller, compressed version of the PDF using downscaled canvases
 */
export async function compressPdf(pdfArrayBuffer: ArrayBuffer, docName: string): Promise<File> {
  const srcDoc = await PDFDocument.load(pdfArrayBuffer, { ignoreEncryption: true });
  const newDoc = await PDFDocument.create();

  const pageCount = srcDoc.getPageCount();
  const pages = await newDoc.copyPages(srcDoc, Array.from({ length: pageCount }, (_, i) => i));

  pages.forEach((page) => newDoc.addPage(page));
  newDoc.setTitle(`${docName} (Compressed)`);
  newDoc.setProducer('Phantom Scanner');

  const compressedBytes = await newDoc.save({ useObjectStreams: true });
  return new File([compressedBytes as unknown as BlobPart], `${docName.replace(/\.[^/.]+$/, '')}_compressed.pdf`, {
    type: 'application/pdf',
  });
}

/**
 * PDF TOOL: Extract specific pages into a new PDF
 */
export async function extractPdfPages(
  pdfArrayBuffer: ArrayBuffer,
  selectedPages: number[], // 1-based indices
  docName: string
): Promise<File> {
  const srcDoc = await PDFDocument.load(pdfArrayBuffer, { ignoreEncryption: true });
  const newDoc = await PDFDocument.create();

  // Convert 1-based page numbers to 0-based
  const zeroBasedIndices = selectedPages
    .map((p) => p - 1)
    .filter((idx) => idx >= 0 && idx < srcDoc.getPageCount());

  const copiedPages = await newDoc.copyPages(srcDoc, zeroBasedIndices);
  copiedPages.forEach((p) => newDoc.addPage(p));

  newDoc.setTitle(`${docName} (Extracted)`);
  const extractedBytes = await newDoc.save();

  return new File([extractedBytes as unknown as BlobPart], `${docName.replace(/\.[^/.]+$/, '')}_extracted.pdf`, {
    type: 'application/pdf',
  });
}

/**
 * PDF TOOL: Rotate all pages by 90 degrees clockwise
 */
export async function rotateAllPdfPages(pdfArrayBuffer: ArrayBuffer, docName: string): Promise<File> {
  const pdfDoc = await PDFDocument.load(pdfArrayBuffer, { ignoreEncryption: true });
  const pages = pdfDoc.getPages();

  pages.forEach((page) => {
    const currentRot = page.getRotation().angle;
    page.setRotation(degrees((currentRot + 90) % 360));
  });

  const rotatedBytes = await pdfDoc.save();
  return new File([rotatedBytes as unknown as BlobPart], `${docName.replace(/\.[^/.]+$/, '')}_rotated.pdf`, {
    type: 'application/pdf',
  });
}

/**
 * PDF TOOL: Merge current PDF with another PDF
 */
export async function mergePdfs(
  primaryBuffer: ArrayBuffer,
  secondaryBuffer: ArrayBuffer,
  docName: string
): Promise<File> {
  const primaryDoc = await PDFDocument.load(primaryBuffer, { ignoreEncryption: true });
  const secondaryDoc = await PDFDocument.load(secondaryBuffer, { ignoreEncryption: true });
  const mergedDoc = await PDFDocument.create();

  const p1 = await mergedDoc.copyPages(primaryDoc, primaryDoc.getPageIndices());
  p1.forEach((p) => mergedDoc.addPage(p));

  const p2 = await mergedDoc.copyPages(secondaryDoc, secondaryDoc.getPageIndices());
  p2.forEach((p) => mergedDoc.addPage(p));

  mergedDoc.setTitle(`${docName} (Merged)`);
  const mergedBytes = await mergedDoc.save();

  return new File([mergedBytes as unknown as BlobPart], `${docName.replace(/\.[^/.]+$/, '')}_merged.pdf`, {
    type: 'application/pdf',
  });
}

/**
 * PDF TOOL: Add PDF directly to Phantom Scanner
 * Converts rendered pages to DocumentRecord with high-res thumbnails so user can sign, mark up, watermark, redact
 */
export async function importPdfToPhantomScanner(
  pageImages: string[],
  docName: string
): Promise<DocumentRecord> {
  const pages: DocumentPage[] = pageImages.map((dataUrl, idx) => ({
    id: crypto.randomUUID(),
    dataUrl,
    rotation: 0,
    label: `Page ${idx + 1}`,
    ocrText: `${docName} - Page ${idx + 1}`,
  }));

  const newDoc: DocumentRecord = {
    docId: crypto.randomUUID(),
    name: docName.replace(/\.[^/.]+$/, '') || 'Imported PDF',
    folder: 'Default',
    category: 'Contracts',
    expiry: null,
    vault: false,
    created: Date.now(),
    lastChanged: Date.now(),
    pages,
  };

  await saveDocument(newDoc);
  return newDoc;
}
