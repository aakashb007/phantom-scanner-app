export interface OcrWordBox {
  text: string;
  bbox: {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  };
  confidence?: number;
}

export interface DocumentPage {
  id: string;
  dataUrl: string;
  rotation?: number;
  aspectRatio?: number;
  label?: string;
  ocrText?: string;
  ocrWords?: OcrWordBox[];
  scanWarning?: 'blurry' | 'too_dark' | 'cut_off' | null;
  filter?: 'original' | 'clean' | 'grayscale' | 'enhanced';
  corners?: { x: number; y: number }[]; // 4 points: TL, TR, BR, BL
}

export interface DocumentRecord {
  docId: string;
  name: string;
  folder: string;
  category: string;
  expiry: number | null;
  vault: boolean;
  created: number;
  lastChanged: number;
  pages: DocumentPage[];
}

export interface DeletedDocRecord {
  docId: string;
  name: string;
  deletedAt: number;
}

export type ThemeMode = 'system' | 'light' | 'dark';

export type ActiveTab = 'files' | 'scan' | 'tools';
export type DesktopSection = 'documents' | 'folders' | 'vault' | 'tools' | 'settings';

export interface SearchMatchResult {
  doc: DocumentRecord;
  pageIndex: number;
  matchingLine: string;
  matchedWord: string;
}

export type SupportedFileType = 'pdf' | 'docx' | 'xlsx' | 'pptx' | 'image' | 'other';

export interface RecentFileRecord {
  id: string;
  name: string;
  type: SupportedFileType;
  size: number;
  lastOpened: number;
  lastPageRead: number;
  totalPages?: number;
  data: ArrayBuffer;
  bookmarks?: number[];
}
