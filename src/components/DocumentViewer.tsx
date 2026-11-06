import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  ChevronLeft,
  RotateCcw,
  Share2,
  Trash2,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Lock,
  Unlock,
  Printer,
  ChevronRight,
  ChevronDown,
  FileText,
  Plus,
  Sparkles,
  Sliders,
  PenTool,
  Highlighter,
  BookOpen,
  ArrowLeftRight,
  ArrowLeft,
  Volume2,
  VolumeX,
  MoreHorizontal,
  Calendar,
  Contact,
  CreditCard,
  EyeOff,
  Download,
  Check,
  Languages,
  Play,
  Pause,
  Square,
  Folder,
  X,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { DocumentRecord, DocumentPage } from '../types/document';
import { triggerHaptic } from '../utils/haptics';
import { updateDocument } from '../db/db';
import { useWindowWidth } from '../hooks/useWindowWidth';
import {
  DocFilterType,
  applySmartHD4K,
  applyDocumentFilter,
  splitBookSpread,
} from '../utils/documentFilters';
import { FilterPickerModal } from './FilterPickerModal';
import { SignatureModal } from './SignatureModal';
import { MarkupModal } from './MarkupModal';
import { TextOcrModal } from './TextOcrModal';
import { SmartRedactModal } from './SmartRedactModal';
import { ExpiryDateModal } from './ExpiryDateModal';
import { ExportModal } from './ExportModal';
import { parseBusinessCardText, shareOrDownloadVCard } from '../utils/vcard';
import { shareOrDownloadIdCardPdf } from '../utils/idCardPdf';
import { createPdfFileForDocument } from '../utils/pdf';

interface DocumentViewerProps {
  document: DocumentRecord;
  onClose: () => void;
  onDeleteDocument: (docId: string) => void;
  onDocumentUpdated: (doc: DocumentRecord) => void;
  initialPageIndex?: number;
  highlightQuery?: string;
  onAddPagesRequested?: () => void;
}

export const DocumentViewer: React.FC<DocumentViewerProps> = ({
  document: initialDoc,
  onClose,
  onDeleteDocument,
  onDocumentUpdated,
  initialPageIndex = 0,
  highlightQuery = '',
  onAddPagesRequested,
}) => {
  const [doc, setDoc] = useState<DocumentRecord>(initialDoc);
  const [activePageIndex, setActivePageIndex] = useState<number>(initialPageIndex);

  // Zoom & Pan state
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [panPos, setPanPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Title edit state
  const [isEditingTitle, setIsEditingTitle] = useState<boolean>(false);
  const [titleDraft, setTitleDraft] = useState<string>(initialDoc.name);

  // Sub-modals & Drawers
  const [showFilterPicker, setShowFilterPicker] = useState<boolean>(false);
  const [showSignatureModal, setShowSignatureModal] = useState<boolean>(false);
  const [showMarkupModal, setShowMarkupModal] = useState<boolean>(false);
  const [showTextOcrModal, setShowTextOcrModal] = useState<boolean>(false);
  const [showSmartRedactModal, setShowSmartRedactModal] = useState<boolean>(false);
  const [showExpiryModal, setShowExpiryModal] = useState<boolean>(false);
  const [showExportModal, setShowExportModal] = useState<boolean>(false);
  const [showMoreMenu, setShowMoreMenu] = useState<boolean>(false);
  const [showCategoryPicker, setShowCategoryPicker] = useState<boolean>(false);

  // Toast / feedback message
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Speech Synthesis state (Listen tool)
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);
  const [speechRate, setSpeechRate] = useState<number>(1.0);

  const { isDesktop } = useWindowWidth();

  // Hidden append file input
  const appendFileInputRef = useRef<HTMLInputElement | null>(null);

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

  useEffect(() => {
    setDoc(initialDoc);
    setTitleDraft(initialDoc.name);
  }, [initialDoc]);

  // Reset zoom & pan when page index changes
  const changePage = useCallback((newIdx: number) => {
    setZoomLevel(1);
    setPanPos({ x: 0, y: 0 });
    setActivePageIndex(newIdx);
    triggerHaptic('light');
  }, []);

  // Keyboard navigation (Desktop habits: arrow keys change page, Esc closes)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isEditingTitle) return;

      if (e.key === 'Escape') {
        if (showMoreMenu) setShowMoreMenu(false);
        else onClose();
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        if (activePageIndex < doc.pages.length - 1) changePage(activePageIndex + 1);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        if (activePageIndex > 0) changePage(activePageIndex - 1);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activePageIndex, doc.pages.length, isEditingTitle, onClose, changePage, showMoreMenu]);

  // Clean up speech synthesis on unmount
  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  const activePage: DocumentPage | undefined = doc.pages[activePageIndex];

  // PAGE TOOL: Rotate
  const handleRotateCurrentPage = async () => {
    if (!activePage) return;
    triggerHaptic('light');

    const updatedPages = doc.pages.map((p, idx) => {
      if (idx !== activePageIndex) return p;
      return { ...p, rotation: ((p.rotation || 0) + 90) % 360 };
    });

    const updated = await updateDocument(doc.docId, { pages: updatedPages });
    if (updated) {
      setDoc(updated);
      onDocumentUpdated(updated);
      showToast('Page rotated 90°');
    }
  };

  // PAGE TOOL: Move Page Left / Right
  const handleMovePageOrder = async (direction: 'left' | 'right') => {
    const newIdx = direction === 'left' ? activePageIndex - 1 : activePageIndex + 1;
    if (newIdx < 0 || newIdx >= doc.pages.length) return;
    triggerHaptic('light');

    const updatedPages = [...doc.pages];
    const [moved] = updatedPages.splice(activePageIndex, 1);
    updatedPages.splice(newIdx, 0, moved);

    const updated = await updateDocument(doc.docId, { pages: updatedPages });
    if (updated) {
      setDoc(updated);
      onDocumentUpdated(updated);
      setActivePageIndex(newIdx);
      showToast(`Page moved ${direction}`);
    }
  };

  // PAGE TOOL: Delete Page
  const handleDeleteCurrentPage = async () => {
    if (doc.pages.length <= 1) {
      if (window.confirm('This is the only page. Delete the entire document?')) {
        onDeleteDocument(doc.docId);
        onClose();
      }
      return;
    }

    triggerHaptic('warning');
    const updatedPages = doc.pages.filter((_, idx) => idx !== activePageIndex);
    const newIdx = Math.max(0, activePageIndex - 1);

    const updated = await updateDocument(doc.docId, { pages: updatedPages });
    if (updated) {
      setDoc(updated);
      onDocumentUpdated(updated);
      changePage(newIdx);
      showToast('Page deleted');
    }
  };

  // PAGE TOOL: Smart HD (4K)
  const handleSmartHD = async () => {
    if (!activePage) return;
    triggerHaptic('medium');
    showToast('Applying Smart HD (4K) paper whitening & text sharpening...');

    const processed = await applySmartHD4K(activePage.dataUrl);
    const updatedPages = doc.pages.map((p, idx) =>
      idx === activePageIndex ? { ...p, dataUrl: processed, filter: 'clean' as const } : p
    );

    const updated = await updateDocument(doc.docId, { pages: updatedPages });
    if (updated) {
      setDoc(updated);
      onDocumentUpdated(updated);
      showToast('Smart HD (4K) applied!');
    }
  };

  // PAGE TOOL: Apply Filters (This page or All pages)
  const handleApplyFilter = async (filter: DocFilterType, scope: 'page' | 'all') => {
    triggerHaptic('medium');
    showToast(`Applying ${filter} filter...`);

    let updatedPages = [...doc.pages];
    if (scope === 'page') {
      const filtered = await applyDocumentFilter(activePage.dataUrl, filter);
      updatedPages = updatedPages.map((p, idx) =>
        idx === activePageIndex ? { ...p, dataUrl: filtered } : p
      );
    } else {
      updatedPages = await Promise.all(
        updatedPages.map(async (p) => ({
          ...p,
          dataUrl: await applyDocumentFilter(p.dataUrl, filter),
        }))
      );
    }

    const updated = await updateDocument(doc.docId, { pages: updatedPages });
    if (updated) {
      setDoc(updated);
      onDocumentUpdated(updated);
      showToast(`Filter applied to ${scope === 'page' ? 'current page' : 'all pages'}`);
    }
  };

  // PAGE TOOL: Split Book Spread
  const handleSplitBook = async () => {
    if (!activePage) return;
    triggerHaptic('medium');
    showToast('Cutting book spread at fold into 2 pages...');

    const { leftUrl, rightUrl } = await splitBookSpread(activePage.dataUrl);
    const leftPage: DocumentPage = {
      ...activePage,
      id: crypto.randomUUID(),
      dataUrl: leftUrl,
      label: `${activePage.label || 'Page'} (Left)`,
    };
    const rightPage: DocumentPage = {
      ...activePage,
      id: crypto.randomUUID(),
      dataUrl: rightUrl,
      label: `${activePage.label || 'Page'} (Right)`,
    };

    const updatedPages = [...doc.pages];
    updatedPages.splice(activePageIndex, 1, leftPage, rightPage);

    const updated = await updateDocument(doc.docId, { pages: updatedPages });
    if (updated) {
      setDoc(updated);
      onDocumentUpdated(updated);
      showToast('Book split into 2 sequential pages!');
    }
  };

  // PAGE TOOL: Add Pages (File Import or Camera)
  const handleAppendFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    Array.from(files).forEach((file, fIdx) => {
      const reader = new FileReader();
      reader.onload = async (ev) => {
        const dataUrl = ev.target?.result as string;
        if (dataUrl) {
          const newPage: DocumentPage = {
            id: crypto.randomUUID(),
            dataUrl,
            rotation: 0,
            label: `Page ${doc.pages.length + fIdx + 1}`,
          };
          const nextPages = [...doc.pages, newPage];
          const updated = await updateDocument(doc.docId, { pages: nextPages });
          if (updated) {
            setDoc(updated);
            onDocumentUpdated(updated);
            changePage(nextPages.length - 1);
            showToast('Page added to document');
          }
        }
      };
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  };

  // TOOLBAR: Listen (Web Speech API speechSynthesis, offline)
  const handleToggleListen = () => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      alert('Speech Synthesis is not supported in this browser.');
      return;
    }

    if (isSpeaking) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      triggerHaptic('light');
      return;
    }

    const textToRead = activePage?.ocrText || doc.name;
    if (!textToRead.trim()) {
      showToast('No readable text on this page.');
      return;
    }

    triggerHaptic('medium');
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(textToRead);
    utterance.rate = speechRate;
    utterance.pitch = 1.0;

    // Detect language (Hindi / Devanagari vs Latin)
    if (/[\u0900-\u097F]/.test(textToRead)) {
      utterance.lang = 'hi-IN';
    } else {
      utterance.lang = 'en-US';
    }

    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);

    window.speechSynthesis.speak(utterance);
    setIsSpeaking(true);
    showToast(`Reading Page ${activePageIndex + 1} aloud...`);
  };

  // Save Title
  const handleSaveTitle = async () => {
    setIsEditingTitle(false);
    if (!titleDraft.trim() || titleDraft.trim() === doc.name) return;
    const updated = await updateDocument(doc.docId, { name: titleDraft.trim() });
    if (updated) {
      setDoc(updated);
      onDocumentUpdated(updated);
      showToast('Document renamed');
    }
  };

  // Capsule: Expiry edit
  const handleSaveExpiry = async (expiry: number | null) => {
    const updated = await updateDocument(doc.docId, { expiry });
    if (updated) {
      setDoc(updated);
      onDocumentUpdated(updated);
      showToast(expiry ? 'Expiry date updated' : 'Expiry removed');
    }
  };

  // Capsule: Vault toggle
  const handleToggleVault = async () => {
    triggerHaptic('medium');
    const updated = await updateDocument(doc.docId, { vault: !doc.vault });
    if (updated) {
      setDoc(updated);
      onDocumentUpdated(updated);
      showToast(updated.vault ? 'Moved to Vault' : 'Removed from Vault');
    }
  };

  // Capsule: Category change
  const handleSelectCategory = async (cat: string) => {
    setShowCategoryPicker(false);
    const updated = await updateDocument(doc.docId, { category: cat });
    if (updated) {
      setDoc(updated);
      onDocumentUpdated(updated);
      showToast(`Category set to ${cat}`);
    }
  };

  // Export Sheet / Modal (Section 4 with pdf-lib, watermarks, JPG/PDF)
  const handleExportPdf = () => {
    triggerHaptic('light');
    setShowExportModal(true);
  };

  // More Menu: Save as Contact (.vcf)
  const handleSaveAsContact = async () => {
    setShowMoreMenu(false);
    triggerHaptic('light');
    const fullOcr = doc.pages.map((p) => p.ocrText || '').join('\n');
    const contact = parseBusinessCardText(fullOcr, doc.name);
    await shareOrDownloadVCard(contact);
    showToast(`Contact "${contact.fullName}" exported as .vcf`);
  };

  // More Menu: ID Card PDF (Front & Back on single A4 page)
  const handleGenerateIdCard = async () => {
    setShowMoreMenu(false);
    triggerHaptic('medium');
    showToast('Generating 2-sided ID Card PDF...');
    await shareOrDownloadIdCardPdf(doc);
    showToast('ID Card PDF ready!');
  };

  // Format expiry capsule date
  const formatExpiryBadge = (timestamp: number | null) => {
    if (!timestamp) return 'No Expiry';
    const d = new Date(timestamp);
    const diffDays = Math.ceil((timestamp - Date.now()) / (1000 * 60 * 60 * 24));
    if (diffDays <= 0) return 'Expired!';
    if (diffDays <= 30) return `Expires in ${diffDays}d`;
    return `Expires ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
  };

  // Touch gesture handling: Pinch zoom, double-tap zoom, swipe pager
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      // Start Pinch
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      touchStartRef.current = {
        x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
        y: (e.touches[0].clientY + e.touches[1].clientY) / 2,
        time: Date.now(),
        distance: dist,
        initialZoom: zoomLevel,
      };
    } else if (e.touches.length === 1) {
      // Check double tap
      const now = Date.now();
      if (now - lastTapRef.current < 300) {
        // Double tap toggle
        triggerHaptic('light');
        if (zoomLevel > 1) {
          setZoomLevel(1);
          setPanPos({ x: 0, y: 0 });
        } else {
          setZoomLevel(2.5);
        }
        lastTapRef.current = 0;
        return;
      }
      lastTapRef.current = now;

      touchStartRef.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
        time: now,
      };
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!touchStartRef.current) return;

    if (e.touches.length === 2 && touchStartRef.current.distance) {
      // Pinch scaling
      const currentDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const ratio = currentDist / touchStartRef.current.distance;
      const newZoom = Math.max(1, Math.min(5, (touchStartRef.current.initialZoom || 1) * ratio));
      setZoomLevel(newZoom);
    } else if (e.touches.length === 1 && zoomLevel > 1.05) {
      // Pan while zoomed
      const dx = e.touches[0].clientX - touchStartRef.current.x;
      const dy = e.touches[0].clientY - touchStartRef.current.y;
      setPanPos((prev) => ({ x: prev.x + dx * 0.4, y: prev.y + dy * 0.4 }));
      touchStartRef.current.x = e.touches[0].clientX;
      touchStartRef.current.y = e.touches[0].clientY;
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!touchStartRef.current) return;

    // Normal zoom horizontal swipe page change
    if (zoomLevel <= 1.05 && e.changedTouches.length === 1) {
      const dx = e.changedTouches[0].clientX - touchStartRef.current.x;
      const dy = Math.abs(e.changedTouches[0].clientY - touchStartRef.current.y);

      // Left edge swipe to go back
      if (touchStartRef.current.x < 45 && dx > 80 && dy < 60) {
        triggerHaptic('light');
        onClose();
        return;
      }

      // Page swipe
      if (Math.abs(dx) > 65 && dy < 60) {
        if (dx < 0 && activePageIndex < doc.pages.length - 1) {
          changePage(activePageIndex + 1);
        } else if (dx > 0 && activePageIndex > 0) {
          changePage(activePageIndex - 1);
        }
      }
    }

    touchStartRef.current = null;
  };

  return (
    <motion.div
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', damping: 30, stiffness: 350 }}
      className="fixed inset-0 z-40 flex flex-col bg-[#F2F2F7] dark:bg-[#000000] text-gray-900 dark:text-gray-100 select-none overflow-hidden"
    >
      <input
        ref={appendFileInputRef}
        type="file"
        accept="image/*,application/pdf"
        multiple
        onChange={handleAppendFiles}
        className="hidden"
      />

      {/* Floating Status Toast */}
      <AnimatePresence>
        {toastMessage && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed top-16 inset-x-4 max-w-sm mx-auto z-50 bg-[#1C1C1E]/95 text-white text-xs font-semibold px-4 py-2.5 rounded-full shadow-2xl flex items-center justify-center gap-2 border border-white/15 backdrop-blur-md"
          >
            <span>{toastMessage}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* TOP HEADER & ACTION BAR */}
      <div className="pt-safe px-4 py-2.5 bg-white/85 dark:bg-[#1C1C1E]/85 backdrop-blur-xl border-b border-[#E5E5EA] dark:border-[#2C2C2E] flex items-center justify-between shrink-0 z-30">
        {/* Back Button */}
        <button
          onClick={() => {
            triggerHaptic('light');
            onClose();
          }}
          className="ios-press flex items-center gap-1 text-[#5856D6] dark:text-[#7D7AFF] font-medium text-[17px] hover:opacity-80"
        >
          <ChevronLeft className="w-6 h-6 stroke-[2.5]" />
          <span>Files</span>
        </button>

        {/* Center: Title & Info Capsules */}
        <div className="flex-1 max-w-md mx-2 sm:mx-4 text-center">
          {isEditingTitle ? (
            <input
              type="text"
              autoFocus
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={handleSaveTitle}
              onKeyDown={(e) => e.key === 'Enter' && handleSaveTitle()}
              className="w-full text-center font-bold text-[16px] bg-black/5 dark:bg-white/10 rounded-lg px-2 py-0.5 text-gray-900 dark:text-white focus:outline-none"
            />
          ) : (
            <div
              onClick={() => setIsEditingTitle(true)}
              className="cursor-pointer group flex items-center justify-center gap-1.5"
            >
              <h3 className="font-bold text-[15px] sm:text-[16px] text-gray-900 dark:text-white truncate">
                {doc.name}
              </h3>
              <span className="text-[11px] text-gray-400 group-hover:text-gray-600">✎</span>
            </div>
          )}

          {/* Info Capsules under the title: category, expiry date, in vault */}
          <div className="flex items-center justify-center gap-1.5 mt-1 overflow-x-auto no-scrollbar">
            {/* Category Capsule */}
            <button
              onClick={() => {
                triggerHaptic('light');
                setShowCategoryPicker(true);
              }}
              className="px-2 py-0.5 rounded-full bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-300 text-[10px] font-semibold hover:bg-gray-200 ios-press"
            >
              {doc.category}
            </button>

            {/* Expiry Capsule */}
            <button
              onClick={() => {
                triggerHaptic('light');
                setShowExpiryModal(true);
              }}
              className={`px-2 py-0.5 rounded-full text-[10px] font-semibold flex items-center gap-1 ios-press ${
                doc.expiry && doc.expiry - Date.now() < 30 * 24 * 3600 * 1000
                  ? 'bg-orange-500/15 text-orange-600 dark:text-orange-400 border border-orange-500/30'
                  : 'bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-300'
              }`}
            >
              <Calendar className="w-2.5 h-2.5" />
              <span>{formatExpiryBadge(doc.expiry)}</span>
            </button>

            {/* In Vault Capsule */}
            {doc.vault && (
              <span className="px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-400 text-[10px] font-bold flex items-center gap-1 border border-amber-500/20">
                <Lock className="w-2.5 h-2.5" />
                <span>In Vault</span>
              </span>
            )}
          </div>
        </div>

        {/* Desktop Top Toolbar Actions / Mobile Right Toolbar */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          {isDesktop ? (
            /* Desktop Full Toolbar */
            <>
              <button
                onClick={handleExportPdf}
                className="ios-press flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gray-100 dark:bg-white/10 hover:bg-gray-200 text-xs font-semibold"
                title="Export Document as PDF"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export</span>
              </button>

              <button
                onClick={handleToggleListen}
                className={`ios-press flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold ${
                  isSpeaking
                    ? 'bg-amber-500 text-white'
                    : 'bg-gray-100 dark:bg-white/10 text-gray-700 dark:text-gray-200 hover:bg-gray-200'
                }`}
                title="Listen (Read aloud offline)"
              >
                {isSpeaking ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                <span>{isSpeaking ? 'Stop' : 'Listen'}</span>
              </button>

              <button
                onClick={() => {
                  triggerHaptic('light');
                  setShowTextOcrModal(true);
                }}
                className="ios-press flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gray-100 dark:bg-white/10 hover:bg-gray-200 text-xs font-semibold"
                title="OCR Text & Translate"
              >
                <FileText className="w-3.5 h-3.5 text-[#5856D6]" />
                <span>Text</span>
              </button>

              <button
                onClick={() => setShowMoreMenu(!showMoreMenu)}
                className="ios-press p-2 rounded-xl bg-gray-100 dark:bg-white/10 hover:bg-gray-200 text-gray-700 dark:text-gray-200"
                title="More Tools"
              >
                <MoreHorizontal className="w-4 h-4" />
              </button>
            </>
          ) : (
            /* Mobile Top Right More */
            <button
              onClick={() => setShowMoreMenu(!showMoreMenu)}
              className="ios-press p-2 rounded-full bg-gray-100 dark:bg-white/10 text-gray-700 dark:text-gray-200"
              title="More"
            >
              <MoreHorizontal className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      {/* PAGE TOOLS BAR (Desktop sub-toolbar / Mobile upper tools bar) */}
      <div className="px-4 py-2 bg-white/70 dark:bg-[#1C1C1E]/70 border-b border-[#E5E5EA] dark:border-[#2C2C2E] flex items-center justify-between text-xs overflow-x-auto no-scrollbar z-20">
        <div className="flex items-center gap-1.5">
          {/* Add Pages */}
          <button
            onClick={() => {
              triggerHaptic('light');
              appendFileInputRef.current?.click();
            }}
            className="ios-press flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-gray-100 dark:bg-white/10 hover:bg-gray-200 font-medium"
            title="Add pages"
          >
            <Plus className="w-3.5 h-3.5 text-[#5856D6]" />
            <span>Add</span>
          </button>

          {/* Smart HD (4K) */}
          <button
            onClick={handleSmartHD}
            className="ios-press flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-gradient-to-r from-purple-500/15 to-indigo-500/15 text-[#5856D6] dark:text-[#7D7AFF] border border-[#5856D6]/30 font-semibold"
            title="Smart HD (4K) paper whitening & text sharpening"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span>Smart HD</span>
          </button>

          {/* Filters */}
          <button
            onClick={() => {
              triggerHaptic('light');
              setShowFilterPicker(true);
            }}
            className="ios-press flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-gray-100 dark:bg-white/10 hover:bg-gray-200 font-medium"
            title="Apply filters"
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>Filters</span>
          </button>

          {/* Sign */}
          <button
            onClick={() => {
              triggerHaptic('light');
              setShowSignatureModal(true);
            }}
            className="ios-press flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-gray-100 dark:bg-white/10 hover:bg-gray-200 font-medium"
            title="Place signature"
          >
            <PenTool className="w-3.5 h-3.5" />
            <span>Sign</span>
          </button>

          {/* Mark up */}
          <button
            onClick={() => {
              triggerHaptic('light');
              setShowMarkupModal(true);
            }}
            className="ios-press flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-gray-100 dark:bg-white/10 hover:bg-gray-200 font-medium"
            title="Pen, Highlighter & Typed Text"
          >
            <Highlighter className="w-3.5 h-3.5" />
            <span>Mark up</span>
          </button>

          {/* Split Book */}
          <button
            onClick={handleSplitBook}
            className="ios-press flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-gray-100 dark:bg-white/10 hover:bg-gray-200 font-medium"
            title="Split 2-page book spread at fold"
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span>Split Book</span>
          </button>
        </div>

        {/* Page Order & Delete Controls */}
        <div className="flex items-center gap-1 pl-2">
          {/* Rotate */}
          <button
            onClick={handleRotateCurrentPage}
            className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 ios-press"
            title="Rotate Page"
          >
            <RotateCcw className="w-4 h-4 text-gray-600 dark:text-gray-300" />
          </button>

          {/* Move Left */}
          <button
            onClick={() => handleMovePageOrder('left')}
            disabled={activePageIndex === 0}
            className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-30 ios-press"
            title="Move Page Left"
          >
            <ArrowLeft className="w-4 h-4 text-gray-600 dark:text-gray-300" />
          </button>

          {/* Move Right */}
          <button
            onClick={() => handleMovePageOrder('right')}
            disabled={activePageIndex === doc.pages.length - 1}
            className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-30 ios-press"
            title="Move Page Right"
          >
            <ChevronRight className="w-4 h-4 text-gray-600 dark:text-gray-300" />
          </button>

          {/* Delete Page */}
          <button
            onClick={handleDeleteCurrentPage}
            className="p-1.5 rounded-lg text-red-500 hover:bg-red-500/10 ios-press"
            title="Delete Current Page"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* MAIN VIEWPORT: SIDEBAR THUMBNAILS ON DESKTOP + CENTER SWIPEABLE PAGER */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Desktop Left Sidebar: Page Thumbnails */}
        {isDesktop && doc.pages.length > 1 && (
          <div className="w-56 bg-white/60 dark:bg-[#1C1C1E]/60 border-r border-[#E5E5EA] dark:border-[#2C2C2E] p-3 overflow-y-auto no-scrollbar flex flex-col gap-3 shrink-0">
            <span className="text-[12px] font-semibold text-gray-400 uppercase tracking-wider px-1">
              Pages ({doc.pages.length})
            </span>
            {doc.pages.map((page, idx) => (
              <div
                key={page.id}
                onClick={() => changePage(idx)}
                className={`relative group rounded-xl p-1.5 border-2 cursor-pointer transition-all ${
                  activePageIndex === idx
                    ? 'border-[#5856D6] bg-[#5856D6]/5 dark:bg-[#7D7AFF]/10 shadow-sm'
                    : 'border-transparent hover:border-gray-300 dark:hover:border-gray-700'
                }`}
              >
                <div className="relative aspect-[3/4] rounded-lg overflow-hidden bg-gray-200 dark:bg-gray-800 shadow-inner">
                  <img
                    src={page.dataUrl}
                    alt={`Page ${idx + 1}`}
                    style={{ transform: `rotate(${page.rotation || 0}deg)` }}
                    className="w-full h-full object-cover"
                  />
                  <span className="absolute bottom-1 right-1 bg-black/70 text-white text-[10px] px-1.5 py-0.5 rounded font-mono font-medium">
                    {idx + 1}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Center Swipeable Canvas Container */}
        <div
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          className="flex-1 relative flex items-center justify-center p-3 sm:p-6 overflow-hidden bg-[#E5E5EA]/40 dark:bg-[#121214] touch-none"
        >
          {/* Centered "2 / 5" Page Counter Badge */}
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 bg-black/60 backdrop-blur-md text-white text-xs font-semibold px-3 py-1 rounded-full shadow-lg border border-white/10 pointer-events-none">
            {activePageIndex + 1} / {doc.pages.length}
          </div>

          {/* Active Large Page Canvas */}
          {activePage ? (
            <div
              className="relative max-w-full max-h-full flex items-center justify-center transition-transform duration-100 ease-out"
              style={{
                transform: `scale(${zoomLevel}) translate(${panPos.x}px, ${panPos.y}px)`,
              }}
            >
              <img
                src={activePage.dataUrl}
                alt={activePage.label || `Page ${activePageIndex + 1}`}
                style={{
                  transform: `rotate(${activePage.rotation || 0}deg)`,
                  maxHeight: 'calc(100vh - 220px)',
                  maxWidth: 'calc(100vw - 32px)',
                }}
                className="rounded-lg shadow-2xl object-contain bg-white dark:bg-[#1C1C1E] border border-black/10 dark:border-white/10"
              />
            </div>
          ) : (
            <div className="text-gray-400 text-sm">No page selected</div>
          )}

          {/* Desktop Left/Right Page Turning Arrows */}
          {isDesktop && doc.pages.length > 1 && (
            <>
              {activePageIndex > 0 && (
                <button
                  onClick={() => changePage(activePageIndex - 1)}
                  className="absolute left-6 top-1/2 -translate-y-1/2 p-3 rounded-full bg-white/80 dark:bg-[#2C2C2E]/80 backdrop-blur-md shadow-lg border border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-200 hover:scale-110 ios-press"
                  title="Previous Page"
                >
                  <ChevronLeft className="w-5 h-5 stroke-[2.5]" />
                </button>
              )}
              {activePageIndex < doc.pages.length - 1 && (
                <button
                  onClick={() => changePage(activePageIndex + 1)}
                  className="absolute right-6 top-1/2 -translate-y-1/2 p-3 rounded-full bg-white/80 dark:bg-[#2C2C2E]/80 backdrop-blur-md shadow-lg border border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-200 hover:scale-110 ios-press"
                  title="Next Page"
                >
                  <ChevronRight className="w-5 h-5 stroke-[2.5]" />
                </button>
              )}
            </>
          )}

          {/* Zoom Level Controls (Desktop and mobile floating) */}
          <div className="absolute bottom-4 right-4 flex items-center gap-1 bg-white/80 dark:bg-[#2C2C2E]/80 backdrop-blur-md rounded-full shadow-lg border border-black/10 dark:border-white/10 p-1 z-20">
            <button
              onClick={() => setZoomLevel((z) => Math.max(1, z - 0.5))}
              className="p-1.5 rounded-full hover:bg-black/10 dark:hover:bg-white/10 ios-press"
              title="Zoom Out"
            >
              <ZoomOut className="w-4 h-4 text-gray-700 dark:text-gray-200" />
            </button>
            <button
              onClick={() => {
                setZoomLevel(1);
                setPanPos({ x: 0, y: 0 });
              }}
              className="px-2 py-0.5 text-[11px] font-semibold text-gray-700 dark:text-gray-200"
              title="Reset Zoom"
            >
              {Math.round(zoomLevel * 100)}%
            </button>
            <button
              onClick={() => setZoomLevel((z) => Math.min(5, z + 0.5))}
              className="p-1.5 rounded-full hover:bg-black/10 dark:hover:bg-white/10 ios-press"
              title="Zoom In"
            >
              <ZoomIn className="w-4 h-4 text-gray-700 dark:text-gray-200" />
            </button>
          </div>
        </div>
      </div>

      {/* MOBILE BOTTOM TOOLBAR (Hidden on Desktop) */}
      {!isDesktop && (
        <nav className="pb-safe pt-2 px-6 bg-white/90 dark:bg-[#1C1C1E]/90 backdrop-blur-xl border-t border-[#E5E5EA] dark:border-[#2C2C2E] flex items-center justify-around z-30 select-none">
          {/* Export */}
          <button
            onClick={handleExportPdf}
            className="flex flex-col items-center gap-1 text-gray-600 dark:text-gray-300 ios-press"
          >
            <Download className="w-5 h-5" />
            <span className="text-[10px] font-semibold">Export</span>
          </button>

          {/* Listen (Offline Speech) */}
          <button
            onClick={handleToggleListen}
            className={`flex flex-col items-center gap-1 ios-press ${
              isSpeaking ? 'text-amber-500' : 'text-gray-600 dark:text-gray-300'
            }`}
          >
            {isSpeaking ? <VolumeX className="w-5 h-5 animate-pulse" /> : <Volume2 className="w-5 h-5" />}
            <span className="text-[10px] font-semibold">{isSpeaking ? 'Stop' : 'Listen'}</span>
          </button>

          {/* Text (OCR / Translate) */}
          <button
            onClick={() => {
              triggerHaptic('light');
              setShowTextOcrModal(true);
            }}
            className="flex flex-col items-center gap-1 text-[#5856D6] dark:text-[#7D7AFF] ios-press"
          >
            <FileText className="w-5 h-5" />
            <span className="text-[10px] font-semibold">Text</span>
          </button>

          {/* More */}
          <button
            onClick={() => {
              triggerHaptic('light');
              setShowMoreMenu(true);
            }}
            className="flex flex-col items-center gap-1 text-gray-600 dark:text-gray-300 ios-press"
          >
            <MoreHorizontal className="w-5 h-5" />
            <span className="text-[10px] font-semibold">More</span>
          </button>
        </nav>
      )}

      {/* MORE MENU (iOS Action Sheet / Desktop Popover) */}
      <AnimatePresence>
        {showMoreMenu && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-3 bg-black/50 backdrop-blur-xs">
            <motion.div
              initial={{ y: 200, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 200, opacity: 0 }}
              className="w-full max-w-sm bg-white/95 dark:bg-[#1C1C1E]/95 backdrop-blur-xl rounded-3xl p-3 shadow-2xl border border-black/10 dark:border-white/10 text-sm select-none divide-y divide-gray-100 dark:divide-white/10"
            >
              {/* Header */}
              <div className="px-4 py-2 flex items-center justify-between pb-3">
                <span className="font-bold text-sm text-gray-900 dark:text-white">Document Actions</span>
                <button
                  onClick={() => setShowMoreMenu(false)}
                  className="p-1 rounded-full text-gray-400 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Actions List */}
              <div className="py-2 space-y-1">
                {/* Export & Watermark */}
                <button
                  onClick={() => {
                    setShowMoreMenu(false);
                    setShowExportModal(true);
                  }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                >
                  <Download className="w-5 h-5 text-[#5856D6]" />
                  <div>
                    <span className="font-semibold block text-gray-900 dark:text-white">Export &amp; Watermark</span>
                    <span className="text-[11px] text-gray-400">PDF / JPG, 4K, Watermark &amp; Anti-Counterfeit</span>
                  </div>
                </button>

                {/* Save as Contact (.vcf) */}
                <button
                  onClick={handleSaveAsContact}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                >
                  <Contact className="w-5 h-5 text-emerald-500" />
                  <div>
                    <span className="font-semibold block text-gray-900 dark:text-white">Save as Contact</span>
                    <span className="text-[11px] text-gray-400">Download business card as .vcf contact</span>
                  </div>
                </button>

                {/* ID Card PDF (Front and back on one A4) */}
                <button
                  onClick={handleGenerateIdCard}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                >
                  <CreditCard className="w-5 h-5 text-[#5856D6]" />
                  <div>
                    <span className="font-semibold block text-gray-900 dark:text-white">ID Card PDF</span>
                    <span className="text-[11px] text-gray-400">Front &amp; Back layout on one A4 page</span>
                  </div>
                </button>

                {/* Smart Redact */}
                <button
                  onClick={() => {
                    setShowMoreMenu(false);
                    setShowSmartRedactModal(true);
                  }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                >
                  <EyeOff className="w-5 h-5 text-amber-500" />
                  <div>
                    <span className="font-semibold block text-gray-900 dark:text-white">Smart Redact</span>
                    <span className="text-[11px] text-gray-400">Black out IDs, numbers &amp; emails (creates copy)</span>
                  </div>
                </button>

                {/* Expiry Date */}
                <button
                  onClick={() => {
                    setShowMoreMenu(false);
                    setShowExpiryModal(true);
                  }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                >
                  <Calendar className="w-5 h-5 text-orange-500" />
                  <div>
                    <span className="font-semibold block text-gray-900 dark:text-white">Expiry Date &amp; Reminders</span>
                    <span className="text-[11px] text-gray-400">Active reminders 30d, 7d and on day</span>
                  </div>
                </button>

                {/* Move to Vault / Remove from Vault */}
                <button
                  onClick={() => {
                    setShowMoreMenu(false);
                    handleToggleVault();
                  }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                >
                  {doc.vault ? <Unlock className="w-5 h-5 text-amber-500" /> : <Lock className="w-5 h-5 text-amber-500" />}
                  <div>
                    <span className="font-semibold block text-gray-900 dark:text-white">
                      {doc.vault ? 'Remove from Vault' : 'Move to Vault'}
                    </span>
                    <span className="text-[11px] text-gray-400">Confidential storage isolated from search</span>
                  </div>
                </button>
              </div>

              {/* Destructive: Delete Document */}
              <div className="pt-2">
                <button
                  onClick={() => {
                    setShowMoreMenu(false);
                    if (window.confirm(`Delete "${doc.name}" completely?`)) {
                      onDeleteDocument(doc.docId);
                      onClose();
                    }
                  }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left text-red-500 hover:bg-red-500/10 transition-colors font-semibold"
                >
                  <Trash2 className="w-5 h-5" />
                  <span>Delete Document</span>
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Category Picker Modal */}
      <AnimatePresence>
        {showCategoryPicker && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <div className="w-full max-w-xs bg-[#1C1C1E] border border-white/15 rounded-3xl p-4 shadow-2xl text-white">
              <div className="flex items-center justify-between pb-2 border-b border-white/10 mb-3">
                <span className="text-sm font-bold">Select Category</span>
                <button onClick={() => setShowCategoryPicker(false)} className="text-gray-400 hover:text-white">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="space-y-1">
                {['Notes', 'Receipts', 'Invoices', 'Contracts', 'ID & Cards', 'Other'].map((cat) => (
                  <button
                    key={cat}
                    onClick={() => handleSelectCategory(cat)}
                    className={`w-full text-left px-3 py-2 rounded-xl text-xs font-semibold flex items-center justify-between ${
                      doc.category === cat ? 'bg-[#5856D6] text-white' : 'hover:bg-white/10 text-gray-300'
                    }`}
                  >
                    <span>{cat}</span>
                    {doc.category === cat && <Check className="w-4 h-4" />}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </AnimatePresence>

      {/* FILTER PICKER MODAL */}
      <FilterPickerModal
        isOpen={showFilterPicker}
        onApply={handleApplyFilter}
        onClose={() => setShowFilterPicker(false)}
      />

      {/* SIGNATURE MODAL */}
      {activePage && (
        <SignatureModal
          isOpen={showSignatureModal}
          pageDataUrl={activePage.dataUrl}
          onApply={async (newDataUrl) => {
            const updatedPages = doc.pages.map((p, idx) =>
              idx === activePageIndex ? { ...p, dataUrl: newDataUrl } : p
            );
            const updated = await updateDocument(doc.docId, { pages: updatedPages });
            if (updated) {
              setDoc(updated);
              onDocumentUpdated(updated);
              showToast('Signature placed and saved!');
            }
          }}
          onClose={() => setShowSignatureModal(false)}
        />
      )}

      {/* MARKUP MODAL */}
      {activePage && (
        <MarkupModal
          isOpen={showMarkupModal}
          pageDataUrl={activePage.dataUrl}
          onApply={async (newDataUrl) => {
            const updatedPages = doc.pages.map((p, idx) =>
              idx === activePageIndex ? { ...p, dataUrl: newDataUrl } : p
            );
            const updated = await updateDocument(doc.docId, { pages: updatedPages });
            if (updated) {
              setDoc(updated);
              onDocumentUpdated(updated);
              showToast('Markup saved!');
            }
          }}
          onClose={() => setShowMarkupModal(false)}
        />
      )}

      {/* TEXT / OCR MODAL */}
      <TextOcrModal
        isOpen={showTextOcrModal}
        initialText={activePage?.ocrText || ''}
        onSaveText={async (updatedText) => {
          const updatedPages = doc.pages.map((p, idx) =>
            idx === activePageIndex ? { ...p, ocrText: updatedText } : p
          );
          const updated = await updateDocument(doc.docId, { pages: updatedPages });
          if (updated) {
            setDoc(updated);
            onDocumentUpdated(updated);
            showToast('OCR text updated!');
          }
        }}
        onClose={() => setShowTextOcrModal(false)}
      />

      {/* SMART REDACT MODAL */}
      <SmartRedactModal
        isOpen={showSmartRedactModal}
        document={doc}
        onSavedCopy={(newRedactedDoc) => {
          onDocumentUpdated(newRedactedDoc);
          showToast(`Redacted copy created: "${newRedactedDoc.name}"`);
        }}
        onClose={() => setShowSmartRedactModal(false)}
      />

      {/* EXPIRY DATE MODAL */}
      <ExpiryDateModal
        isOpen={showExpiryModal}
        currentExpiry={doc.expiry}
        onSave={handleSaveExpiry}
        onClose={() => setShowExpiryModal(false)}
      />

      {/* EXPORT MODAL (Section 4 with pdf-lib, Watermarks, Live Preview) */}
      <ExportModal
        isOpen={showExportModal}
        document={doc}
        onClose={() => setShowExportModal(false)}
        onSuccessToast={showToast}
      />
    </motion.div>
  );
};
