import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Search,
  Volume2,
  VolumeX,
  Share2,
  Wrench,
  Bookmark,
  Moon,
  Sun,
  ZoomIn,
  ZoomOut,
  Maximize2,
  X,
  Lock,
  Loader2,
  FileText,
  Table,
  Presentation,
  Check,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import * as pdfjsLib from 'pdfjs-dist';
import { renderAsync as renderDocx } from 'docx-preview';
import {
  SupportedFileType,
  RecentFileRecord,
  DocumentRecord,
} from '../types/document';
import { triggerHaptic } from '../utils/haptics';
import { useWindowWidth } from '../hooks/useWindowWidth';
import {
  parsePptxFile,
  parseXlsxFile,
  PptxParsedWorkbook,
  XlsxParsedWorkbook,
} from '../utils/fileParser';
import { updateRecentFilePage, toggleRecentFileBookmark } from '../db/db';
import { PdfToolsModal } from './PdfToolsModal';
import { shareOrDownloadFiles } from '../utils/exportEngine';
import { recognizeImageText } from '../utils/tesseractOcr';

// Configure pdfjs worker to matching version
if (typeof window !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
}

interface FileViewerModalProps {
  isOpen: boolean;
  fileRecord: RecentFileRecord;
  onClose: () => void;
  onOpenScannerDocument?: (doc: DocumentRecord) => void;
}

export const FileViewerModal: React.FC<FileViewerModalProps> = ({
  isOpen,
  fileRecord,
  onClose,
  onOpenScannerDocument,
}) => {
  const { isDesktop } = useWindowWidth();

  // Navigation & Page state
  const [currentPage, setCurrentPage] = useState<number>(fileRecord.lastPageRead || 1);
  const [totalPages, setTotalPages] = useState<number>(fileRecord.totalPages || 1);
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [panPos, setPanPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Reading Modes
  const [isNightMode, setIsNightMode] = useState<boolean>(false);
  const [bookmarks, setBookmarks] = useState<number[]>(fileRecord.bookmarks || []);

  // Search state
  const [isSearchOpen, setIsSearchOpen] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchMatches, setSearchMatches] = useState<{ page: number; text: string }[]>([]);
  const [currentMatchIdx, setCurrentMatchIdx] = useState<number>(0);

  // Speech synthesis
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);

  // Tools Modal
  const [isToolsOpen, setIsToolsOpen] = useState<boolean>(false);

  // Password Prompt for protected PDFs
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState<boolean>(false);
  const [passwordDraft, setPasswordDraft] = useState<string>('');
  const [pdfPassword, setPdfPassword] = useState<string>('');

  // Toast feedback
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // PDF Engine State
  const [pdfDocProxy, setPdfDocProxy] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [pdfPageImages, setPdfPageImages] = useState<string[]>([]);
  const [isPdfLoading, setIsPdfLoading] = useState<boolean>(false);
  const pdfCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const pdfTextLayerRef = useRef<Record<number, string>>({});

  // Office Document States
  const [docxLoading, setDocxLoading] = useState<boolean>(false);
  const docxContainerRef = useRef<HTMLDivElement | null>(null);

  const [xlsxData, setXlsxData] = useState<XlsxParsedWorkbook | null>(null);
  const [activeXlsxSheet, setActiveXlsxSheet] = useState<string>('');

  const [pptxData, setPptxData] = useState<PptxParsedWorkbook | null>(null);

  // Touch gesture tracking for pinch zoom & swipe
  const touchStartRef = useRef<{
    x: number;
    y: number;
    time: number;
    distance?: number;
    initialZoom?: number;
  } | null>(null);
  const lastTapRef = useRef<number>(0);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  // Keyboard Navigation: Arrow keys for page, Esc to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        if (currentPage < totalPages) handlePageChange(currentPage + 1);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        if (currentPage > 1) handlePageChange(currentPage - 1);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentPage, totalPages, onClose]);

  // Page Change helper + IndexedDB persistence
  const handlePageChange = useCallback(
    (newPage: number) => {
      setZoomLevel(1);
      setPanPos({ x: 0, y: 0 });
      setCurrentPage(newPage);
      triggerHaptic('light');
      updateRecentFilePage(fileRecord.id, newPage, totalPages);
    },
    [fileRecord.id, totalPages]
  );

  // Toggle Bookmark
  const handleToggleBookmark = async () => {
    triggerHaptic('medium');
    const updated = await toggleRecentFileBookmark(fileRecord.id, currentPage);
    setBookmarks(updated);
    showToast(
      updated.includes(currentPage)
        ? `Page ${currentPage} bookmarked`
        : `Removed bookmark for page ${currentPage}`
    );
  };

  // ==========================================
  // 1. PDF LOADING & RENDERING (pdfjs-dist)
  // ==========================================
  useEffect(() => {
    if (fileRecord.type !== 'pdf' || !fileRecord.data) return;

    let isCancelled = false;
    setIsPdfLoading(true);

    async function loadPdf() {
      try {
        const loadingTask = pdfjsLib.getDocument({
          data: new Uint8Array(fileRecord.data),
          password: pdfPassword || undefined,
        });

        loadingTask.onPassword = (callback: (password: string) => void, reason: number) => {
          setIsPasswordModalOpen(true);
        };

        const pdf = await loadingTask.promise;
        if (isCancelled) return;

        setPdfDocProxy(pdf);
        setTotalPages(pdf.numPages);
        updateRecentFilePage(fileRecord.id, currentPage, pdf.numPages);

        // Pre-render page images for scanner/tools
        const images: string[] = [];
        for (let i = 1; i <= Math.min(pdf.numPages, 30); i++) {
          const page = await pdf.getPage(i);
          const viewport = page.getViewport({ scale: 1.5 });
          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            await (page.render({ canvasContext: ctx, viewport, canvas } as any)).promise;
            images.push(canvas.toDataURL('image/jpeg', 0.85));
          }

          // Extract text layer
          const textContent = await page.getTextContent();
          const pageText = textContent.items
            .map((item: any) => item.str || '')
            .join(' ');
          pdfTextLayerRef.current[i] = pageText;
        }

        if (!isCancelled) {
          setPdfPageImages(images);
          setIsPdfLoading(false);
        }
      } catch (err: any) {
        if (err?.name === 'PasswordException') {
          setIsPasswordModalOpen(true);
        } else {
          console.error('PDF load error:', err);
        }
        setIsPdfLoading(false);
      }
    }

    loadPdf();

    return () => {
      isCancelled = true;
    };
  }, [fileRecord.data, fileRecord.type, pdfPassword]);

  // Render current PDF page on canvas
  useEffect(() => {
    if (!pdfDocProxy || fileRecord.type !== 'pdf') return;

    let isMounted = true;

    async function renderPage() {
      try {
        const page = await pdfDocProxy!.getPage(currentPage);
        if (!isMounted) return;

        const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
        const scale = (isDesktop ? 1.6 : 1.2) * zoomLevel * dpr;
        const viewport = page.getViewport({ scale });

        const canvas = pdfCanvasRef.current;
        if (!canvas) return;

        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width = `${viewport.width / dpr}px`;
        canvas.style.height = `${viewport.height / dpr}px`;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        await (page.render({ canvasContext: ctx, viewport, canvas } as any)).promise;

        // If page has no text layer, run background OCR for search and speech
        if (!pdfTextLayerRef.current[currentPage]?.trim()) {
          const imgUrl = canvas.toDataURL('image/jpeg', 0.8);
          recognizeImageText(imgUrl).then((text: string) => {
            if (isMounted) {
              pdfTextLayerRef.current[currentPage] = text;
            }
          });
        }
      } catch (err) {
        console.error('PDF page render error:', err);
      }
    }

    renderPage();

    return () => {
      isMounted = false;
    };
  }, [pdfDocProxy, currentPage, zoomLevel, isDesktop, fileRecord.type]);

  // ==========================================
  // 2. WORD (.docx) RENDERING (docx-preview)
  // ==========================================
  useEffect(() => {
    if (fileRecord.type !== 'docx' || !fileRecord.data || !docxContainerRef.current) return;

    setDocxLoading(true);
    const container = docxContainerRef.current;
    container.innerHTML = '';

    renderDocx(fileRecord.data, container, undefined, {
      className: 'docx-rendered-page',
      inWrapper: true,
      ignoreWidth: false,
      ignoreHeight: false,
      breakPages: true,
      useBase64URL: true,
    })
      .then(() => {
        setDocxLoading(false);
      })
      .catch((err) => {
        console.error('Docx render error:', err);
        setDocxLoading(false);
      });
  }, [fileRecord.data, fileRecord.type]);

  // ==========================================
  // 3. EXCEL (.xlsx) RENDERING (SheetJS)
  // ==========================================
  useEffect(() => {
    if (fileRecord.type !== 'xlsx' || !fileRecord.data) return;

    try {
      const parsed = parseXlsxFile(fileRecord.data);
      setXlsxData(parsed);
      if (parsed.sheetNames.length > 0) {
        setActiveXlsxSheet(parsed.sheetNames[0]);
      }
    } catch (err) {
      console.error('Excel parse error:', err);
    }
  }, [fileRecord.data, fileRecord.type]);

  // ==========================================
  // 4. POWERPOINT (.pptx) RENDERING (JSZip)
  // ==========================================
  useEffect(() => {
    if (fileRecord.type !== 'pptx' || !fileRecord.data) return;

    parsePptxFile(fileRecord.data, fileRecord.name)
      .then((parsed) => {
        setPptxData(parsed);
        setTotalPages(parsed.slides.length);
        updateRecentFilePage(fileRecord.id, currentPage, parsed.slides.length);
      })
      .catch((err) => {
        console.error('PPTX parse error:', err);
      });
  }, [fileRecord.data, fileRecord.type, fileRecord.name]);

  // ==========================================
  // 5. SEARCH LOGIC (Text layer & highlights)
  // ==========================================
  const handlePerformSearch = (query: string) => {
    setSearchQuery(query);
    if (!query.trim()) {
      setSearchMatches([]);
      setCurrentMatchIdx(0);
      return;
    }

    const q = query.toLowerCase();
    const matches: { page: number; text: string }[] = [];

    if (fileRecord.type === 'pdf') {
      Object.entries(pdfTextLayerRef.current).forEach(([pStr, text]) => {
        const pageNum = parseInt(pStr, 10);
        if (text.toLowerCase().includes(q)) {
          matches.push({ page: pageNum, text });
        }
      });
    } else if (fileRecord.type === 'pptx' && pptxData) {
      pptxData.slides.forEach((s) => {
        const combined = `${s.title} ${s.bullets.join(' ')} ${s.paragraphs.join(' ')}`;
        if (combined.toLowerCase().includes(q)) {
          matches.push({ page: s.slideNumber, text: combined });
        }
      });
    } else if (fileRecord.type === 'xlsx' && xlsxData) {
      Object.values(xlsxData.sheets).forEach((sheet, idx) => {
        const hasMatch = sheet.rows.some((row) =>
          row.some((cell) => cell.toLowerCase().includes(q))
        );
        if (hasMatch) {
          matches.push({ page: idx + 1, text: sheet.name });
        }
      });
    }

    setSearchMatches(matches);
    setCurrentMatchIdx(0);
    if (matches.length > 0) {
      handlePageChange(matches[0].page);
    }
  };

  const handleNextMatch = () => {
    if (searchMatches.length === 0) return;
    triggerHaptic('light');
    const nextIdx = (currentMatchIdx + 1) % searchMatches.length;
    setCurrentMatchIdx(nextIdx);
    handlePageChange(searchMatches[nextIdx].page);
  };

  const handlePrevMatch = () => {
    if (searchMatches.length === 0) return;
    triggerHaptic('light');
    const prevIdx = (currentMatchIdx - 1 + searchMatches.length) % searchMatches.length;
    setCurrentMatchIdx(prevIdx);
    handlePageChange(searchMatches[prevIdx].page);
  };

  // ==========================================
  // 6. LISTEN (Speech Synthesis)
  // ==========================================
  const handleToggleListen = () => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      alert('Speech synthesis is not supported on this device.');
      return;
    }

    if (isSpeaking) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      triggerHaptic('light');
      return;
    }

    let textToRead = '';
    if (fileRecord.type === 'pdf') {
      textToRead = pdfTextLayerRef.current[currentPage] || fileRecord.name;
    } else if (fileRecord.type === 'pptx' && pptxData) {
      const slide = pptxData.slides[currentPage - 1];
      if (slide) {
        textToRead = `${slide.title}. ${slide.bullets.join('. ')}. ${slide.paragraphs.join('. ')}`;
      }
    } else if (fileRecord.type === 'docx') {
      textToRead = docxContainerRef.current?.innerText || fileRecord.name;
    } else if (fileRecord.type === 'xlsx' && xlsxData && activeXlsxSheet) {
      const sheet = xlsxData.sheets[activeXlsxSheet];
      textToRead = sheet?.rows.slice(0, 5).map((r) => r.join(', ')).join('. ') || fileRecord.name;
    }

    if (!textToRead.trim()) {
      showToast('No readable text on this page.');
      return;
    }

    triggerHaptic('medium');
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(textToRead);
    utterance.rate = 1.0;
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    window.speechSynthesis.speak(utterance);
    setIsSpeaking(true);
    showToast('Reading aloud...');
  };

  // Clean speech synthesis on unmount
  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  // ==========================================
  // 7. SHARE / EXPORT
  // ==========================================
  const handleShareFile = async () => {
    triggerHaptic('light');
    const file = new File([fileRecord.data], fileRecord.name, {
      type: fileRecord.type === 'pdf' ? 'application/pdf' : 'application/octet-stream',
    });
    const result = await shareOrDownloadFiles([file], fileRecord.name);
    if (result.method === 'shared') {
      showToast(`Shared "${fileRecord.name}"`);
    } else {
      showToast(`Downloaded "${fileRecord.name}"`);
    }
  };

  // Double tap to zoom
  const handleDoubleTap = () => {
    triggerHaptic('light');
    if (zoomLevel > 1) {
      setZoomLevel(1);
      setPanPos({ x: 0, y: 0 });
    } else {
      setZoomLevel(2.5);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#F2F2F7] dark:bg-[#000000] text-gray-900 dark:text-gray-100 select-none overflow-hidden font-sans">
      {/* Toast Notification */}
      <AnimatePresence>
        {toastMessage && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed top-4 inset-x-4 max-w-sm mx-auto z-50 bg-[#1C1C1E]/95 text-white text-xs font-semibold px-4 py-2.5 rounded-full shadow-2xl flex items-center justify-center gap-2 border border-white/15 backdrop-blur-md"
          >
            <Check className="w-4 h-4 text-emerald-400" />
            <span>{toastMessage}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* TOP NAVIGATION BAR */}
      <header className="pt-safe px-4 py-2.5 bg-white/90 dark:bg-[#1C1C1E]/90 backdrop-blur-xl border-b border-[#E5E5EA] dark:border-[#2C2C2E] flex items-center justify-between shrink-0 z-20">
        {/* Back / Close button */}
        <button
          onClick={() => {
            triggerHaptic('light');
            onClose();
          }}
          className="ios-press flex items-center gap-1 text-[#5856D6] dark:text-[#7D7AFF] font-medium text-sm sm:text-base hover:opacity-80"
        >
          <ChevronLeft className="w-5 h-5 stroke-[2.5]" />
          <span>Files</span>
        </button>

        {/* Center: File Name & Page Indicator */}
        <div className="flex-1 max-w-xs sm:max-w-md mx-2 text-center">
          <h2 className="text-xs sm:text-sm font-bold truncate text-gray-900 dark:text-white">
            {fileRecord.name}
          </h2>
          <div className="text-[10px] text-gray-500 dark:text-gray-400 flex items-center justify-center gap-1.5 mt-0.5">
            <span className="uppercase font-semibold text-[#5856D6] dark:text-[#7D7AFF]">
              {fileRecord.type}
            </span>
            <span>•</span>
            <span>
              {fileRecord.type === 'pptx' ? 'Slide' : fileRecord.type === 'xlsx' ? 'Sheet' : 'Page'}{' '}
              {currentPage} / {totalPages}
            </span>
          </div>
        </div>

        {/* Top Controls: Night reading, Bookmark, Search, Desktop Top Tools */}
        <div className="flex items-center gap-1 sm:gap-2">
          {/* Night Mode Toggle */}
          <button
            onClick={() => {
              triggerHaptic('light');
              setIsNightMode(!isNightMode);
            }}
            className={`p-2 rounded-xl transition-colors ios-press ${
              isNightMode
                ? 'bg-amber-500/20 text-amber-500'
                : 'bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-300'
            }`}
            title="Night Reading Mode (Inverted Colors)"
          >
            {isNightMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>

          {/* Bookmark Toggle */}
          <button
            onClick={handleToggleBookmark}
            className={`p-2 rounded-xl transition-colors ios-press ${
              bookmarks.includes(currentPage)
                ? 'bg-amber-500/20 text-amber-500'
                : 'bg-gray-100 dark:bg-white/10 text-gray-400'
            }`}
            title="Bookmark this page"
          >
            <Bookmark
              className={`w-4 h-4 ${bookmarks.includes(currentPage) ? 'fill-amber-500' : ''}`}
            />
          </button>

          {/* Desktop Top Toolbar items */}
          {isDesktop && (
            <>
              {/* Search */}
              <button
                onClick={() => setIsSearchOpen(!isSearchOpen)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold ios-press ${
                  isSearchOpen
                    ? 'bg-[#5856D6] text-white'
                    : 'bg-gray-100 dark:bg-white/10 text-gray-700 dark:text-gray-200'
                }`}
              >
                <Search className="w-3.5 h-3.5" />
                <span>Search</span>
              </button>

              {/* Listen */}
              <button
                onClick={handleToggleListen}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold ios-press ${
                  isSpeaking
                    ? 'bg-amber-500 text-white'
                    : 'bg-gray-100 dark:bg-white/10 text-gray-700 dark:text-gray-200'
                }`}
              >
                {isSpeaking ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                <span>{isSpeaking ? 'Stop' : 'Listen'}</span>
              </button>

              {/* PDF Tools */}
              {fileRecord.type === 'pdf' && (
                <button
                  onClick={() => setIsToolsOpen(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gray-100 dark:bg-white/10 hover:bg-gray-200 text-xs font-semibold ios-press"
                >
                  <Wrench className="w-3.5 h-3.5 text-[#5856D6]" />
                  <span>Tools</span>
                </button>
              )}

              {/* Share */}
              <button
                onClick={handleShareFile}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#5856D6] text-white hover:bg-[#6866E6] text-xs font-semibold ios-press shadow-xs"
              >
                <Share2 className="w-3.5 h-3.5" />
                <span>Share</span>
              </button>
            </>
          )}
        </div>
      </header>

      {/* SEARCH BAR DRAWER */}
      <AnimatePresence>
        {isSearchOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="px-4 py-2 bg-white/95 dark:bg-[#1C1C1E]/95 border-b border-[#E5E5EA] dark:border-[#2C2C2E] flex items-center gap-2 z-20 shrink-0"
          >
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                autoFocus
                value={searchQuery}
                onChange={(e) => handlePerformSearch(e.target.value)}
                placeholder="Search text or OCR on pages..."
                className="w-full pl-9 pr-8 py-1.5 rounded-xl bg-black/5 dark:bg-white/10 text-xs text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#5856D6]"
              />
              {searchQuery && (
                <button
                  onClick={() => handlePerformSearch('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {searchMatches.length > 0 && (
              <div className="flex items-center gap-1 text-xs text-gray-500 shrink-0">
                <span className="font-mono font-semibold">
                  {currentMatchIdx + 1} / {searchMatches.length}
                </span>
                <button
                  onClick={handlePrevMatch}
                  className="p-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/10"
                >
                  <ArrowUp className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={handleNextMatch}
                  className="p-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/10"
                >
                  <ArrowDown className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* MAIN VIEWER CANVAS / CONTENT */}
      <main
        onDoubleClick={handleDoubleTap}
        className={`flex-1 relative flex items-center justify-center overflow-auto p-4 transition-colors ${
          isNightMode ? 'bg-[#0B0B10] invert hue-rotate-180' : 'bg-[#E5E5EA]/40 dark:bg-[#000000]'
        }`}
      >
        {/* PDF VIEW */}
        {fileRecord.type === 'pdf' && (
          <div className="relative flex items-center justify-center max-w-full max-h-full">
            {isPdfLoading && (
              <div className="flex flex-col items-center gap-2 text-gray-400">
                <Loader2 className="w-8 h-8 animate-spin text-[#5856D6]" />
                <span className="text-xs">Loading PDF pages...</span>
              </div>
            )}

            <canvas
              ref={pdfCanvasRef}
              className={`rounded-xl shadow-2xl transition-transform ${
                isPdfLoading ? 'hidden' : 'block'
              }`}
              style={{
                transform: `scale(${zoomLevel}) translate(${panPos.x}px, ${panPos.y}px)`,
                transformOrigin: 'center center',
              }}
            />
          </div>
        )}

        {/* WORD (.docx) VIEW */}
        {fileRecord.type === 'docx' && (
          <div className="w-full h-full flex flex-col items-center overflow-y-auto ios-scroll">
            {docxLoading && (
              <div className="flex flex-col items-center gap-2 text-gray-400 my-auto">
                <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
                <span className="text-xs">Rendering Word document layout...</span>
              </div>
            )}
            <div
              ref={docxContainerRef}
              className="bg-white text-black p-6 rounded-2xl shadow-xl max-w-3xl w-full my-4 docx-container select-text"
              style={{
                transform: `scale(${zoomLevel})`,
                transformOrigin: 'top center',
              }}
            />
          </div>
        )}

        {/* EXCEL (.xlsx) VIEW */}
        {fileRecord.type === 'xlsx' && xlsxData && (
          <div className="w-full h-full flex flex-col bg-white dark:bg-[#1C1C1E] rounded-2xl shadow-xl overflow-hidden border border-[#E5E5EA] dark:border-[#2C2C2E]">
            {/* Sheet Tabs */}
            <div className="p-2 border-b border-[#E5E5EA] dark:border-[#2C2C2E] flex items-center gap-1.5 overflow-x-auto no-scrollbar shrink-0 bg-gray-50 dark:bg-black/30">
              {xlsxData.sheetNames.map((name, sIdx) => {
                const isActive = activeXlsxSheet === name;
                return (
                  <button
                    key={name}
                    onClick={() => {
                      triggerHaptic('light');
                      setActiveXlsxSheet(name);
                      handlePageChange(sIdx + 1);
                    }}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold shrink-0 transition-all ios-press flex items-center gap-1.5 ${
                      isActive
                        ? 'bg-[#10B981] text-white shadow-xs'
                        : 'bg-white dark:bg-white/10 text-gray-600 dark:text-gray-300'
                    }`}
                  >
                    <Table className="w-3.5 h-3.5" />
                    <span>{name}</span>
                  </button>
                );
              })}
            </div>

            {/* Table Matrix with A/B/C column headers & 1/2/3 row numbers */}
            {activeXlsxSheet && xlsxData.sheets[activeXlsxSheet] && (
              <div className="flex-1 overflow-auto ios-scroll">
                <table className="w-full border-collapse text-xs font-mono">
                  <thead>
                    <tr className="bg-gray-100 dark:bg-black/50 sticky top-0 z-10">
                      <th className="p-2 border border-[#E5E5EA] dark:border-[#2C2C2E] text-gray-400 w-12 text-center bg-gray-100 dark:bg-black/50">
                        #
                      </th>
                      {Array.from({ length: xlsxData.sheets[activeXlsxSheet].maxCols }, (_, i) => (
                        <th
                          key={i}
                          className="p-2 border border-[#E5E5EA] dark:border-[#2C2C2E] text-gray-600 dark:text-gray-300 min-w-[90px] text-left uppercase font-semibold"
                        >
                          {String.fromCharCode(65 + (i % 26))}
                          {i >= 26 ? Math.floor(i / 26) : ''}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {xlsxData.sheets[activeXlsxSheet].rows.map((row, rIdx) => (
                      <tr key={rIdx} className="hover:bg-emerald-50/50 dark:hover:bg-emerald-950/20">
                        <td className="p-2 border border-[#E5E5EA] dark:border-[#2C2C2E] bg-gray-50 dark:bg-black/30 text-gray-400 text-center font-bold sticky left-0">
                          {rIdx + 1}
                        </td>
                        {Array.from({ length: xlsxData.sheets[activeXlsxSheet].maxCols }, (_, cIdx) => {
                          const cellVal = row[cIdx] || '';
                          const isMatch =
                            searchQuery.trim() &&
                            cellVal.toLowerCase().includes(searchQuery.toLowerCase());
                          return (
                            <td
                              key={cIdx}
                              className={`p-2 border border-[#E5E5EA] dark:border-[#2C2C2E] text-gray-800 dark:text-gray-200 select-text ${
                                isMatch ? 'bg-amber-300 text-black font-bold' : ''
                              }`}
                            >
                              {cellVal}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* POWERPOINT (.pptx) VIEW (Slides as Cards) */}
        {fileRecord.type === 'pptx' && pptxData && (
          <div className="w-full max-w-2xl flex flex-col items-center">
            {pptxData.slides[currentPage - 1] && (
              <div className="w-full bg-white dark:bg-[#1C1C1E] rounded-3xl p-6 sm:p-8 shadow-2xl border border-[#E5E5EA] dark:border-[#2C2C2E] space-y-5">
                <div className="flex items-center justify-between pb-3 border-b border-gray-100 dark:border-white/10">
                  <div className="flex items-center gap-2">
                    <Presentation className="w-5 h-5 text-amber-500" />
                    <span className="text-xs font-bold text-gray-400">
                      Slide {currentPage} of {pptxData.slides.length}
                    </span>
                  </div>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 font-semibold">
                    PowerPoint Presentation
                  </span>
                </div>

                {/* Slide Title */}
                <h3 className="text-xl sm:text-2xl font-extrabold text-gray-900 dark:text-white">
                  {pptxData.slides[currentPage - 1].title}
                </h3>

                {/* Bullets */}
                {pptxData.slides[currentPage - 1].bullets.length > 0 && (
                  <ul className="space-y-2 text-sm text-gray-700 dark:text-gray-300 list-disc list-inside">
                    {pptxData.slides[currentPage - 1].bullets.map((b, bIdx) => (
                      <li key={bIdx} className="leading-relaxed">
                        {b}
                      </li>
                    ))}
                  </ul>
                )}

                {/* Paragraphs */}
                {pptxData.slides[currentPage - 1].paragraphs.length > 0 && (
                  <div className="space-y-2 text-sm text-gray-600 dark:text-gray-400">
                    {pptxData.slides[currentPage - 1].paragraphs.map((p, pIdx) => (
                      <p key={pIdx}>{p}</p>
                    ))}
                  </div>
                )}

                {/* Slide Images */}
                {pptxData.slides[currentPage - 1].images.length > 0 && (
                  <div className="grid grid-cols-2 gap-3 pt-2">
                    {pptxData.slides[currentPage - 1].images.map((imgUrl, iIdx) => (
                      <img
                        key={iIdx}
                        src={imgUrl}
                        alt=""
                        className="rounded-xl border border-gray-200 dark:border-white/10 shadow-sm max-h-48 object-contain bg-gray-50 dark:bg-black/30"
                      />
                    ))}
                  </div>
                )}

                {/* Slide Tables */}
                {pptxData.slides[currentPage - 1].tables.length > 0 && (
                  <div className="pt-2 overflow-x-auto">
                    {pptxData.slides[currentPage - 1].tables.map((tbl, tIdx) => (
                      <table key={tIdx} className="w-full text-xs border border-gray-200 dark:border-white/10">
                        <tbody>
                          {tbl.map((r, rIdx) => (
                            <tr key={rIdx} className={rIdx === 0 ? 'bg-gray-100 dark:bg-white/10 font-bold' : ''}>
                              {r.map((c, cIdx) => (
                                <td key={cIdx} className="p-2 border border-gray-200 dark:border-white/10">
                                  {c}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Floating Zoom & Page Controls */}
        <div className="fixed bottom-20 sm:bottom-24 inset-x-0 flex items-center justify-center pointer-events-none z-20">
          <div className="pointer-events-auto bg-[#1C1C1E]/90 text-white backdrop-blur-xl px-4 py-2 rounded-full shadow-2xl flex items-center gap-3 border border-white/15 text-xs font-semibold">
            {/* Prev Page */}
            <button
              disabled={currentPage <= 1}
              onClick={() => handlePageChange(currentPage - 1)}
              className="p-1 rounded-full hover:bg-white/20 disabled:opacity-30 ios-press"
              title="Previous Page"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            {/* Page display */}
            <span>
              {currentPage} / {totalPages}
            </span>

            {/* Next Page */}
            <button
              disabled={currentPage >= totalPages}
              onClick={() => handlePageChange(currentPage + 1)}
              className="p-1 rounded-full hover:bg-white/20 disabled:opacity-30 ios-press"
              title="Next Page"
            >
              <ChevronRight className="w-4 h-4" />
            </button>

            <div className="w-[1px] h-4 bg-white/20" />

            {/* Zoom Out */}
            <button
              onClick={() => setZoomLevel((z) => Math.max(1, z - 0.25))}
              className="p-1 rounded-full hover:bg-white/20 ios-press"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>

            {/* Zoom In */}
            <button
              onClick={() => setZoomLevel((z) => Math.min(4, z + 0.25))}
              className="p-1 rounded-full hover:bg-white/20 ios-press"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </main>

      {/* MOBILE BOTTOM TOOLBAR (< 900px) */}
      {!isDesktop && (
        <nav className="pb-safe pt-2 px-6 bg-white/90 dark:bg-[#1C1C1E]/90 backdrop-blur-xl border-t border-[#E5E5EA] dark:border-[#2C2C2E] flex items-center justify-around z-30 select-none">
          {/* Search */}
          <button
            onClick={() => setIsSearchOpen(!isSearchOpen)}
            className={`flex flex-col items-center gap-1 ios-press ${
              isSearchOpen ? 'text-[#5856D6]' : 'text-gray-600 dark:text-gray-300'
            }`}
          >
            <Search className="w-5 h-5" />
            <span className="text-[10px] font-semibold">Search</span>
          </button>

          {/* Listen */}
          <button
            onClick={handleToggleListen}
            className={`flex flex-col items-center gap-1 ios-press ${
              isSpeaking ? 'text-amber-500' : 'text-gray-600 dark:text-gray-300'
            }`}
          >
            {isSpeaking ? <VolumeX className="w-5 h-5 animate-pulse" /> : <Volume2 className="w-5 h-5" />}
            <span className="text-[10px] font-semibold">{isSpeaking ? 'Stop' : 'Listen'}</span>
          </button>

          {/* Tools (for PDF) */}
          {fileRecord.type === 'pdf' && (
            <button
              onClick={() => setIsToolsOpen(true)}
              className="flex flex-col items-center gap-1 text-[#5856D6] dark:text-[#7D7AFF] ios-press"
            >
              <Wrench className="w-5 h-5" />
              <span className="text-[10px] font-semibold">Tools</span>
            </button>
          )}

          {/* Share */}
          <button
            onClick={handleShareFile}
            className="flex flex-col items-center gap-1 text-gray-600 dark:text-gray-300 ios-press"
          >
            <Share2 className="w-5 h-5" />
            <span className="text-[10px] font-semibold">Share</span>
          </button>
        </nav>
      )}

      {/* PDF TOOLS MODAL */}
      {fileRecord.type === 'pdf' && (
        <PdfToolsModal
          isOpen={isToolsOpen}
          pdfBuffer={fileRecord.data}
          fileName={fileRecord.name}
          pageCount={totalPages}
          currentPage={currentPage}
          bookmarks={bookmarks}
          pageImages={pdfPageImages}
          onClose={() => setIsToolsOpen(false)}
          onJumpToPage={(p) => handlePageChange(p)}
          onOpenNewDocument={(doc) => {
            onClose();
            if (onOpenScannerDocument) onOpenScannerDocument(doc);
          }}
          onToast={showToast}
        />
      )}

      {/* PASSWORD PROMPT MODAL */}
      <AnimatePresence>
        {isPasswordModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md">
            <div className="w-full max-w-sm bg-[#1C1C1E] border border-white/15 rounded-3xl p-5 shadow-2xl text-white">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center shrink-0">
                  <Lock className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold">Protected PDF</h3>
                  <p className="text-xs text-gray-400">Enter password to unlock this file</p>
                </div>
              </div>

              <input
                type="password"
                autoFocus
                value={passwordDraft}
                onChange={(e) => setPasswordDraft(e.target.value)}
                placeholder="Password..."
                className="w-full bg-white/10 px-3.5 py-2.5 rounded-xl border border-white/20 text-sm mb-4 focus:outline-none focus:border-[#5856D6]"
              />

              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setIsPasswordModalOpen(false);
                    onClose();
                  }}
                  className="flex-1 py-2.5 rounded-xl bg-white/10 text-xs font-semibold hover:bg-white/20"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    setPdfPassword(passwordDraft);
                    setIsPasswordModalOpen(false);
                  }}
                  className="flex-1 py-2.5 rounded-xl bg-[#5856D6] text-xs font-semibold text-white shadow-md hover:bg-[#6866E6]"
                >
                  Unlock
                </button>
              </div>
            </div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
