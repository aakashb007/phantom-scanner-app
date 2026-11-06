import * as pdfjsLib from 'pdfjs-dist';
// Bundle the pdf.js worker with the app so PDFs open offline.
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export { pdfjsLib };
