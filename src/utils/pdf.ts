import { jsPDF } from 'jspdf';
import { DocumentRecord, DocumentPage } from '../types/document';

/**
 * Creates a valid PDF File object for a given document using jsPDF
 */
export async function createPdfFileForDocument(doc: DocumentRecord): Promise<File> {
  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'pt',
    format: 'a4',
  });

  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();

  for (let i = 0; i < doc.pages.length; i++) {
    const page = doc.pages[i];
    if (i > 0) {
      pdf.addPage('a4', 'portrait');
    }

    try {
      // Draw image to fill A4 with margin
      const margin = 20;
      const targetW = pageWidth - margin * 2;
      const targetH = pageHeight - margin * 2;
      const rotation = page.rotation || 0;

      // Add image to pdf
      pdf.addImage(page.dataUrl, 'JPEG', margin, margin, targetW, targetH, undefined, 'FAST', rotation);
    } catch (e) {
      console.warn('Failed to add page to PDF:', e);
      pdf.text(`[Page ${i + 1} Image]`, 40, 40);
    }
  }

  const blob = pdf.output('blob');
  const safeName = (doc.name.replace(/[/\\?%*:|"<>]/g, '_') || 'document') + '.pdf';
  return new File([blob], safeName, { type: 'application/pdf' });
}

/**
 * Sends each selected document as its own PDF, all together:
 * Uses Web Share API with files if supported; falls back to automatic downloads.
 */
export async function shareDocumentsAsPdfs(docs: DocumentRecord[]): Promise<boolean> {
  if (!docs || docs.length === 0) return false;

  const pdfFiles: File[] = [];
  for (const doc of docs) {
    const file = await createPdfFileForDocument(doc);
    pdfFiles.push(file);
  }

  // Attempt Web Share API with files
  if (navigator.canShare && navigator.canShare({ files: pdfFiles })) {
    try {
      await navigator.share({
        files: pdfFiles,
        title: docs.length === 1 ? docs[0].name : `${docs.length} Scanned Documents`,
        text: 'Shared from Phantom Scanner',
      });
      return true;
    } catch (err: unknown) {
      if ((err as Error)?.name === 'AbortError') return true;
    }
  }

  // Fallback: Trigger download for each generated PDF
  for (const file of pdfFiles) {
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return true;
}

/**
 * Merge selected documents in the order they were selected into a new document record.
 */
export function mergeDocumentsInOrder(orderedDocs: DocumentRecord[]): DocumentRecord {
  const mergedPages: DocumentPage[] = [];

  orderedDocs.forEach((doc) => {
    doc.pages.forEach((page, pIdx) => {
      mergedPages.push({
        ...page,
        id: crypto.randomUUID(),
        label: `${doc.name} - Page ${pIdx + 1}`,
      });
    });
  });

  const names = orderedDocs.map((d) => d.name).join(' + ');
  const truncatedNames = names.length > 40 ? names.substring(0, 37) + '...' : names;

  return {
    docId: crypto.randomUUID(),
    name: `Merged (${truncatedNames})`,
    folder: orderedDocs[0]?.folder || 'Default',
    category: orderedDocs[0]?.category || 'Notes',
    expiry: null,
    vault: false,
    created: Date.now(),
    lastChanged: Date.now(),
    pages: mergedPages,
  };
}
