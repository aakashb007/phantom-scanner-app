import { DocumentRecord, SearchMatchResult } from '../types/document';

/**
 * Searches documents (excluding vault) for matches in:
 * 1. Document title / name
 * 2. Every page's OCR text (line by line)
 */
export function searchDocumentsWithOcr(
  documents: DocumentRecord[],
  rawQuery: string
): SearchMatchResult[] {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return [];

  const results: SearchMatchResult[] = [];

  for (const doc of documents) {
    // Vault documents NEVER appear in search
    if (doc.vault) continue;

    let matchedInDoc = false;

    // 1. Search page-by-page OCR text
    if (doc.pages && doc.pages.length > 0) {
      doc.pages.forEach((page, pageIdx) => {
        if (page.ocrText) {
          const lines = page.ocrText.split(/\r?\n/);
          for (const line of lines) {
            const lowerLine = line.toLowerCase();
            const matchPos = lowerLine.indexOf(query);
            if (matchPos !== -1) {
              matchedInDoc = true;
              // Extract snippet around match
              const start = Math.max(0, matchPos - 30);
              const end = Math.min(line.length, matchPos + query.length + 45);
              const snippet = (start > 0 ? '...' : '') + line.substring(start, end).trim() + (end < line.length ? '...' : '');

              results.push({
                doc,
                pageIndex: pageIdx,
                matchingLine: snippet || line.trim(),
                matchedWord: query,
              });
              break; // One primary match line per page
            }
          }
        }
      });
    }

    // 2. Search Document Name if not already matched in OCR
    if (!matchedInDoc && doc.name.toLowerCase().includes(query)) {
      results.push({
        doc,
        pageIndex: 0,
        matchingLine: `Document title: "${doc.name}"`,
        matchedWord: query,
      });
    }
  }

  return results;
}

/**
 * Extract / synthesize realistic OCR text for newly scanned or imported documents
 * if automatic camera OCR is run.
 */
export function generateDefaultOcrText(docName: string, category: string, pageNumber: number): string {
  const timestamp = new Date().toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  switch (category.toLowerCase()) {
    case 'receipts':
      return `RECEIPT #${Math.floor(100000 + Math.random() * 900000)}\nDate: ${timestamp}\nMerchant: Phantom Store\nSubtotal: $48.50\nTax (8.25%): $4.00\nTotal Amount: $52.50\nPayment Method: Apple Pay (Contactless)\nAuth Code: 839201\nThank you for your business!`;
    case 'invoices':
      return `INVOICE INV-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}\nDate: ${timestamp}\nBilled To: Client Account\nItem description: Professional Services & Consulting\nHours: 12.0 @ $125.00/hr\nBalance Due: $1,500.00\nTerms: Net 30 Days\nWire Reference: PS-99201`;
    case 'contracts':
      return `AGREEMENT & STATEMENT OF WORK\nEffective Date: ${timestamp}\nBetween Phantom Scanner and Authorized Party\nClause 1: Confidentiality and Local Data Privacy\nClause 2: Intellectual Property and Ownership\nClause 3: Termination and Governing Law\nSigned and Executed on Page ${pageNumber}.`;
    case 'id & cards':
      return `IDENTIFICATION CARD\nName: ${docName}\nIssued Date: ${timestamp}\nCard ID: ID-${Math.floor(10000000 + Math.random() * 90000000)}\nStatus: Verified\nSecurity Code: PRIV-AUTH-902`;
    default:
      return `${docName}\nPage ${pageNumber}\nScanned on ${timestamp}\nDocument text recorded in local browser storage.\nAll content remains strictly private on device.`;
  }
}
