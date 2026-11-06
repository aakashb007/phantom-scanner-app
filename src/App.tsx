import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  FileText,
  Camera,
  Folder,
  Lock,
  Wrench,
  Settings,
  Plus,
  Search,
  CheckCircle2,
  Trash2,
  X,
  UploadCloud,
  SlidersHorizontal,
  ChevronRight,
  Share2,
  QrCode,
  Sparkles,
  GitMerge,
  Edit2,
  FolderInput,
  FolderOpen,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { DocumentRecord, ActiveTab, DesktopSection, SearchMatchResult, RecentFileRecord } from './types/document';
import {
  getAllDocuments,
  deleteDocument,
  deleteDocuments,
  saveDocument,
  updateDocument,
  getSetting,
  saveRecentFile,
} from './db/db';
import { triggerHaptic } from './utils/haptics';
import { useTheme, ThemeProvider } from './context/ThemeContext';
import { useWindowWidth } from './hooks/useWindowWidth';
import { usePWA } from './hooks/usePWA';
import { ViewfinderIcon } from './components/ViewfinderIcon';
import { DocumentCard } from './components/DocumentCard';
import { DocumentViewer } from './components/DocumentViewer';
import { ScannerModal } from './components/ScannerModal';
import { QRScannerModal } from './components/QRScannerModal';
import { DocumentContextMenu } from './components/DocumentContextMenu';
import { SettingsScreen } from './components/SettingsScreen';
import { VaultScreen } from './components/VaultScreen';
import { FoldersScreen } from './components/FoldersScreen';
import { ToolsScreen } from './components/ToolsScreen';
import { ExpiringSoonBanner } from './components/ExpiringSoonBanner';
import { FilesSheetModal } from './components/FilesSheetModal';
import { FileViewerModal } from './components/FileViewerModal';
import { detectFileType } from './utils/fileParser';
import { IOSAlert } from './components/ui/IOSAlert';
import { searchDocumentsWithOcr } from './utils/ocr';
import { shareDocumentsAsPdfs, mergeDocumentsInOrder } from './utils/pdf';

function PhantomScannerApp() {
  const { isDesktop } = useWindowWidth();
  const { isStandalone, showIOSTip, dismissIOSTip } = usePWA();

  // Navigation states
  const [activeTab, setActiveTab] = useState<ActiveTab>('files');
  const [desktopSection, setDesktopSection] = useState<DesktopSection>('documents');

  // Documents state
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [selectedFilter, setSelectedFilter] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Groq API Key state (controls visibility of ✨ Ask AI)
  const [groqKey, setGroqKey] = useState<string>('');
  const [showAskAIModal, setShowAskAIModal] = useState<boolean>(false);

  // Selection mode for batch actions (ordered array to preserve exact selection sequence)
  const [isSelectionMode, setIsSelectionMode] = useState<boolean>(false);
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([]);

  // Active viewing/modals
  const [activeDocument, setActiveDocument] = useState<DocumentRecord | null>(null);
  const [activeViewerPageIndex, setActiveViewerPageIndex] = useState<number>(0);
  const [activeViewerHighlight, setActiveViewerHighlight] = useState<string>('');

  // Modals
  const [isScannerOpen, setIsScannerOpen] = useState<boolean>(false);
  const [isQROpen, setIsQROpen] = useState<boolean>(false);
  const [isFilesSheetOpen, setIsFilesSheetOpen] = useState<boolean>(false);
  const [activeFileRecord, setActiveFileRecord] = useState<RecentFileRecord | null>(null);
  const [scanInitialVault, setScanInitialVault] = useState<boolean>(false);

  // Desktop Context Menu
  const [contextMenuState, setContextMenuState] = useState<{
    x: number;
    y: number;
    doc: DocumentRecord | null;
  }>({ x: 0, y: 0, doc: null });

  // Dialogs
  const [renameDoc, setRenameDoc] = useState<DocumentRecord | null>(null);
  const [renameValue, setRenameValue] = useState<string>('');

  const [moveDoc, setMoveDoc] = useState<DocumentRecord | null>(null);
  const [moveFolderValue, setMoveFolderValue] = useState<string>('Default');

  const [deleteConfirmDoc, setDeleteConfirmDoc] = useState<DocumentRecord | null>(null);
  const [isBatchDeleteConfirm, setIsBatchDeleteConfirm] = useState<boolean>(false);

  // Drag and drop overlay
  const [isDraggingOver, setIsDraggingOver] = useState<boolean>(false);
  const [statusToast, setStatusToast] = useState<string | null>(null);

  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // Show status toast
  const showToast = (msg: string) => {
    setStatusToast(msg);
    setTimeout(() => setStatusToast(null), 3000);
  };

  // Load documents from IndexedDB and check Groq Key
  const refreshDocuments = useCallback(async () => {
    try {
      const docs = await getAllDocuments();
      setDocuments(docs);
      const savedGroq = await getSetting<string>('groq_api_key', '');
      setGroqKey(savedGroq || '');
    } catch (err) {
      console.error('Failed to load documents:', err);
    }
  }, []);

  useEffect(() => {
    refreshDocuments();
  }, [refreshDocuments]);

  // Global Keyboard Shortcuts (Desktop habits)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+F / Cmd+F -> Focus Search
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
      // Delete key -> delete selected documents
      if (e.key === 'Delete' && selectedDocIds.length > 0 && !activeDocument) {
        setIsBatchDeleteConfirm(true);
      }
      // Esc -> close search / selection / menu
      if (e.key === 'Escape') {
        if (contextMenuState.doc) setContextMenuState({ x: 0, y: 0, doc: null });
        if (isSelectionMode) {
          setIsSelectionMode(false);
          setSelectedDocIds([]);
        }
        if (searchQuery) setSearchQuery('');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedDocIds, activeDocument, contextMenuState, isSelectionMode, searchQuery]);

  // Drag and drop file import
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDraggingOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(false);

    const allFiles = Array.from(e.dataTransfer.files);
    if (allFiles.length === 0) return;

    // Check if first file is PDF, Word, Excel, or PowerPoint
    const firstFile = allFiles[0];
    const ext = firstFile.name.split('.').pop()?.toLowerCase();
    if (['pdf', 'docx', 'xlsx', 'xls', 'pptx'].includes(ext || '')) {
      triggerHaptic('medium');
      firstFile.arrayBuffer().then(async (ab) => {
        const type = detectFileType(firstFile.name, firstFile.type);
        const saved = await saveRecentFile({
          name: firstFile.name,
          type,
          size: firstFile.size,
          lastOpened: Date.now(),
          lastPageRead: 1,
          totalPages: 1,
          data: ab,
          bookmarks: [],
        });
        setActiveFileRecord(saved);
      });
      return;
    }

    const files = allFiles.filter(
      (f) => f.type.startsWith('image/') || f.type === 'application/pdf'
    );

    if (files.length === 0) return;

    triggerHaptic('medium');
    const pages: { id: string; dataUrl: string; rotation: number; label: string; ocrText: string }[] = [];
    let processed = 0;

    files.forEach((file, idx) => {
      const reader = new FileReader();
      reader.onload = async (ev) => {
        const dataUrl = ev.target?.result as string;
        if (dataUrl) {
          const docTitle = files[0].name.replace(/\.[^/.]+$/, '') || 'Imported Document';
          pages.push({
            id: crypto.randomUUID(),
            dataUrl,
            rotation: 0,
            label: file.name,
            ocrText: `${docTitle} - Page ${idx + 1}\nImported from ${file.name}\nStored locally.`,
          });
        }
        processed++;
        if (processed === files.length && pages.length > 0) {
          const newDoc: DocumentRecord = {
            docId: crypto.randomUUID(),
            name: files[0].name.replace(/\.[^/.]+$/, '') || 'Imported Document',
            folder: 'Default',
            category: 'Notes',
            expiry: null,
            vault: false,
            created: Date.now(),
            lastChanged: Date.now(),
            pages,
          };
          await saveDocument(newDoc);
          await refreshDocuments();
          setActiveDocument(newDoc);
          setActiveViewerPageIndex(0);
          setActiveViewerHighlight('');
        }
      };
      reader.readAsDataURL(file);
    });
  };

  // Rule 8: Documents in the Vault NEVER appear here or in search
  const homeDocuments = documents.filter((doc) => !doc.vault);

  // Extract all categories and folders for filter pills
  const categoriesList = ['Notes', 'Receipts', 'Invoices', 'Contracts', 'ID & Cards', 'Other'];
  const foldersList = Array.from(
    new Set(['Default', ...homeDocuments.map((d) => d.folder || 'Default')])
  );

  // Filter pills logic
  const filteredDocuments = homeDocuments.filter((doc) => {
    if (selectedFilter === 'All') return true;
    if (selectedFilter.startsWith('folder:')) {
      const folderName = selectedFilter.replace('folder:', '');
      return (doc.folder || 'Default').toLowerCase() === folderName.toLowerCase();
    }
    // Category pill
    return doc.category.toLowerCase() === selectedFilter.toLowerCase();
  });

  // OCR and Document Name search results (Vault docs excluded)
  const ocrSearchResults: SearchMatchResult[] = searchQuery.trim()
    ? searchDocumentsWithOcr(homeDocuments, searchQuery)
    : [];

  // Handle Document Click
  const handleDocClick = (e: React.MouseEvent, doc: DocumentRecord) => {
    if (isSelectionMode || e.ctrlKey || e.metaKey || e.shiftKey) {
      toggleDocSelection(doc.docId);
      if (!isSelectionMode) setIsSelectionMode(true);
    } else {
      setActiveDocument(doc);
      setActiveViewerPageIndex(0);
      setActiveViewerHighlight('');
    }
  };

  // Toggle selection preserving exact selection order
  const toggleDocSelection = (docId: string) => {
    triggerHaptic('light');
    setSelectedDocIds((prev) => {
      if (prev.includes(docId)) {
        return prev.filter((id) => id !== docId);
      }
      return [...prev, docId]; // Append in order of selection
    });
  };

  // Long-press handler to enter select mode
  const handleDocLongPress = (doc: DocumentRecord) => {
    if (!isSelectionMode) {
      setIsSelectionMode(true);
      setSelectedDocIds([doc.docId]);
    } else {
      toggleDocSelection(doc.docId);
    }
  };

  // Open right-click context menu
  const handleContextMenu = (e: React.MouseEvent, doc: DocumentRecord) => {
    setContextMenuState({ x: e.clientX, y: e.clientY, doc });
  };

  // Document single actions
  const handleDeleteDoc = async (docId: string) => {
    await deleteDocument(docId);
    triggerHaptic('warning');
    await refreshDocuments();
    showToast('Document moved to trash');
  };

  // Selection actions: Merge
  const handleMergeSelected = async () => {
    if (selectedDocIds.length < 2) return;
    triggerHaptic('success');

    // Retrieve documents in the exact order they were selected
    const orderedDocs: DocumentRecord[] = [];
    selectedDocIds.forEach((id) => {
      const found = homeDocuments.find((d) => d.docId === id);
      if (found) orderedDocs.push(found);
    });

    const merged = mergeDocumentsInOrder(orderedDocs);
    await saveDocument(merged);
    await refreshDocuments();

    setIsSelectionMode(false);
    setSelectedDocIds([]);
    setActiveDocument(merged);
    setActiveViewerPageIndex(0);
    setActiveViewerHighlight('');
    showToast(`Merged ${orderedDocs.length} documents into "${merged.name}"`);
  };

  // Selection actions: Share
  const handleShareSelected = async () => {
    if (selectedDocIds.length === 0) return;
    triggerHaptic('light');

    const docsToShare: DocumentRecord[] = [];
    selectedDocIds.forEach((id) => {
      const found = homeDocuments.find((d) => d.docId === id);
      if (found) docsToShare.push(found);
    });

    await shareDocumentsAsPdfs(docsToShare);
  };

  // Selection actions: Batch Delete
  const handleBatchDelete = async () => {
    await deleteDocuments(selectedDocIds);
    triggerHaptic('warning');
    setSelectedDocIds([]);
    setIsSelectionMode(false);
    setIsBatchDeleteConfirm(false);
    await refreshDocuments();
    showToast('Deleted documents');
  };

  // Selection actions: Rename first selected
  const handleRenameSelected = () => {
    if (selectedDocIds.length === 0) return;
    const targetDoc = homeDocuments.find((d) => d.docId === selectedDocIds[0]);
    if (targetDoc) {
      setRenameDoc(targetDoc);
      setRenameValue(targetDoc.name);
    }
  };

  // Selection actions: Move to folder
  const handleMoveSelected = () => {
    if (selectedDocIds.length === 0) return;
    const targetDoc = homeDocuments.find((d) => d.docId === selectedDocIds[0]);
    setMoveDoc(targetDoc || homeDocuments[0]);
    setMoveFolderValue(targetDoc?.folder || 'Default');
  };

  const handleSaveRename = async () => {
    if (!renameDoc || !renameValue.trim()) return;
    await updateDocument(renameDoc.docId, { name: renameValue.trim() });
    setRenameDoc(null);
    await refreshDocuments();
    showToast('Document renamed');
  };

  const handleSaveMove = async () => {
    if (moveFolderValue.trim()) {
      for (const id of selectedDocIds) {
        await updateDocument(id, { folder: moveFolderValue.trim() });
      }
      setMoveDoc(null);
      await refreshDocuments();
      setIsSelectionMode(false);
      setSelectedDocIds([]);
      showToast(`Moved to "${moveFolderValue.trim()}"`);
    }
  };

  const handleToggleVault = async (doc: DocumentRecord) => {
    await updateDocument(doc.docId, { vault: !doc.vault });
    await refreshDocuments();
    showToast(doc.vault ? 'Removed from Vault' : 'Moved to Vault');
  };

  // Open search result directly at matching page and highlighted query
  const handleSearchResultClick = (result: SearchMatchResult) => {
    triggerHaptic('light');
    setActiveDocument(result.doc);
    setActiveViewerPageIndex(result.pageIndex);
    setActiveViewerHighlight(result.matchedWord);
  };

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className="relative w-full h-[100dvh] flex flex-col md:flex-row bg-[#F2F2F7] dark:bg-[#000000] text-gray-900 dark:text-gray-100 overflow-hidden font-sans"
    >
      {/* Toast Banner */}
      <AnimatePresence>
        {statusToast && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed top-4 inset-x-4 max-w-sm mx-auto z-50 bg-[#1C1C1E]/95 text-white text-xs font-semibold px-4 py-2.5 rounded-full shadow-2xl flex items-center justify-center gap-2 border border-white/15 backdrop-blur-md"
          >
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>{statusToast}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Drag & Drop Overlay */}
      <AnimatePresence>
        {isDraggingOver && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-[#5856D6]/85 backdrop-blur-md flex flex-col items-center justify-center text-white pointer-events-none p-6 text-center"
          >
            <UploadCloud className="w-20 h-20 mb-4 animate-bounce" />
            <h2 className="text-2xl font-bold">Drop files here to import</h2>
            <p className="text-sm opacity-90 mt-1">Photos, receipts, and PDF documents</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* iPhone Safari One-Time Add to Home Screen Banner Tip */}
      <AnimatePresence>
        {showIOSTip && (
          <motion.div
            initial={{ y: -60, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -60, opacity: 0 }}
            className="fixed top-0 inset-x-0 z-50 pt-safe px-4 pb-2 bg-[#5856D6] text-white shadow-lg flex items-center justify-between text-xs"
          >
            <div className="flex items-center gap-2">
              <Share2 className="w-4 h-4 shrink-0" />
              <span>
                Tap <strong>Share → Add to Home Screen</strong> to use Phantom Scanner as an app
              </span>
            </div>
            <button
              onClick={dismissIOSTip}
              className="p-1 rounded-full hover:bg-white/20 ios-press"
            >
              <X className="w-4 h-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* DESKTOP SIDEBAR (>= 900px) */}
      {isDesktop && (
        <aside className="w-64 bg-white dark:bg-[#1C1C1E] border-r border-[#E5E5EA] dark:border-[#2C2C2E] flex flex-col justify-between shrink-0 select-none z-20">
          <div className="p-4 space-y-4">
            {/* Brand Logo & Name */}
            <div className="flex items-center gap-3 px-1">
              <ViewfinderIcon size={38} rounded="rounded-xl" />
              <div>
                <h1 className="text-[16px] font-bold tracking-tight text-gray-900 dark:text-white leading-snug">
                  Phantom Scanner
                </h1>
                <p className="text-[11px] text-gray-400 font-medium">v1.7.3 • Offline</p>
              </div>
            </div>

            {/* Primary Action Button: Scan / Import */}
            <button
              onClick={() => {
                triggerHaptic('light');
                setScanInitialVault(desktopSection === 'vault');
                setIsScannerOpen(true);
              }}
              className="w-full ios-press flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-[#5856D6] hover:bg-[#6866E6] text-white text-sm font-semibold shadow-sm transition-all"
            >
              <Camera className="w-4 h-4" />
              <span>Scan / Import</span>
            </button>

            {/* Desktop Navigation Menu */}
            <nav className="space-y-1 pt-2">
              <button
                onClick={() => {
                  triggerHaptic('light');
                  setDesktopSection('documents');
                }}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm font-medium transition-colors ${
                  desktopSection === 'documents'
                    ? 'bg-[#5856D6]/10 text-[#5856D6] dark:text-[#7D7AFF] font-semibold'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/5'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <FileText className="w-4 h-4" />
                  <span>Documents</span>
                </div>
                <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-white/10 text-gray-500 dark:text-gray-400">
                  {homeDocuments.length}
                </span>
              </button>

              <button
                onClick={() => {
                  triggerHaptic('light');
                  setIsFilesSheetOpen(true);
                }}
                className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm font-medium transition-colors text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/5"
              >
                <div className="flex items-center gap-2.5">
                  <FolderOpen className="w-4 h-4 text-[#5856D6]" />
                  <span>Files &amp; Recents</span>
                </div>
              </button>

              <button
                onClick={() => {
                  triggerHaptic('light');
                  setDesktopSection('folders');
                }}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm font-medium transition-colors ${
                  desktopSection === 'folders'
                    ? 'bg-[#5856D6]/10 text-[#5856D6] dark:text-[#7D7AFF] font-semibold'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/5'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Folder className="w-4 h-4" />
                  <span>Folders</span>
                </div>
              </button>

              <button
                onClick={() => {
                  triggerHaptic('light');
                  setDesktopSection('vault');
                }}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm font-medium transition-colors ${
                  desktopSection === 'vault'
                    ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 font-semibold'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/5'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Lock className="w-4 h-4" />
                  <span>Vault</span>
                </div>
                {documents.filter((d) => d.vault).length > 0 && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-700 dark:text-amber-300">
                    {documents.filter((d) => d.vault).length}
                  </span>
                )}
              </button>

              <button
                onClick={() => {
                  triggerHaptic('light');
                  setDesktopSection('tools');
                }}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm font-medium transition-colors ${
                  desktopSection === 'tools'
                    ? 'bg-[#5856D6]/10 text-[#5856D6] dark:text-[#7D7AFF] font-semibold'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/5'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Wrench className="w-4 h-4" />
                  <span>Tools</span>
                </div>
              </button>

              <button
                onClick={() => {
                  triggerHaptic('light');
                  setDesktopSection('settings');
                }}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm font-medium transition-colors ${
                  desktopSection === 'settings'
                    ? 'bg-[#5856D6]/10 text-[#5856D6] dark:text-[#7D7AFF] font-semibold'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/5'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Settings className="w-4 h-4" />
                  <span>Settings</span>
                </div>
              </button>
            </nav>
          </div>

          <div className="p-4 border-t border-[#E5E5EA] dark:border-[#2C2C2E] text-xs text-gray-400">
            <p className="font-medium text-gray-500 dark:text-gray-400">Phantom Scanner</p>
            <p className="text-[11px] text-gray-400 mt-0.5">Built by Aakash Saleem</p>
          </div>
        </aside>
      )}

      {/* MAIN CONTENT AREA */}
      <main className="flex-1 flex flex-col h-full overflow-hidden relative">
        {/* SECTION 1: HOME SCREEN HEADER & TOOLBAR */}
        {(!isDesktop || desktopSection === 'documents') && activeTab === 'files' && (
          <header className="pt-safe px-4 sm:px-6 pb-2 shrink-0 bg-[#F2F2F7]/90 dark:bg-[#000000]/90 backdrop-blur-md z-10 border-b border-[#E5E5EA]/60 dark:border-[#2C2C2E]/60">
            {/* Top row: Large Title & Top bar controls: ✨ Ask AI, QR scanner, Select, Settings */}
            <div className="flex items-center justify-between py-1">
              <div>
                <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-gray-900 dark:text-white">
                  Phantom Scanner
                </h1>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {homeDocuments.length} {homeDocuments.length === 1 ? 'document' : 'documents'}
                </p>
              </div>

              {/* Top bar controls */}
              <div className="flex items-center gap-1.5 sm:gap-2">
                {/* ✨ Ask AI (Hidden until Groq key added in Settings) */}
                {groqKey.trim() !== '' && (
                  <button
                    onClick={() => {
                      triggerHaptic('light');
                      setShowAskAIModal(true);
                    }}
                    className="ios-press flex items-center gap-1 px-3 py-1.5 rounded-full bg-gradient-to-r from-purple-500 to-indigo-500 text-white text-xs font-semibold shadow-xs"
                    title="Ask AI"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Ask AI</span>
                  </button>
                )}

                {/* Files Sheet Button */}
                <button
                  onClick={() => {
                    triggerHaptic('light');
                    setIsFilesSheetOpen(true);
                  }}
                  className="p-2 rounded-full bg-white dark:bg-[#1C1C1E] text-gray-700 dark:text-gray-300 shadow-xs hover:bg-gray-100 dark:hover:bg-[#2C2C2E] ios-press flex items-center gap-1.5 text-xs font-medium"
                  title="Files & Recents"
                >
                  <FolderOpen className="w-4 h-4 text-[#5856D6] dark:text-[#7D7AFF]" />
                  <span className="hidden sm:inline">Files</span>
                </button>

                {/* QR Scanner Button */}
                <button
                  onClick={() => {
                    triggerHaptic('light');
                    setIsQROpen(true);
                  }}
                  className="p-2 rounded-full bg-white dark:bg-[#1C1C1E] text-gray-700 dark:text-gray-300 shadow-xs hover:bg-gray-100 dark:hover:bg-[#2C2C2E] ios-press flex items-center gap-1.5 text-xs font-medium"
                  title="QR Scanner"
                >
                  <QrCode className="w-4 h-4 text-[#5856D6] dark:text-[#7D7AFF]" />
                  <span className="hidden sm:inline">QR Scan</span>
                </button>

                {/* Select Mode Toggle */}
                {homeDocuments.length > 0 && (
                  <button
                    onClick={() => {
                      triggerHaptic('light');
                      setIsSelectionMode(!isSelectionMode);
                      if (isSelectionMode) setSelectedDocIds([]);
                    }}
                    className={`px-3 py-1.5 rounded-full text-xs font-semibold ios-press transition-colors ${
                      isSelectionMode
                        ? 'bg-[#5856D6] text-white shadow-xs'
                        : 'bg-white dark:bg-[#1C1C1E] text-gray-700 dark:text-gray-300 shadow-xs hover:bg-gray-100 dark:hover:bg-[#2C2C2E]'
                    }`}
                  >
                    {isSelectionMode ? 'Done' : 'Select'}
                  </button>
                )}

                {/* Settings Icon */}
                <button
                  onClick={() => {
                    triggerHaptic('light');
                    if (isDesktop) {
                      setDesktopSection('settings');
                    } else {
                      setActiveTab('tools');
                    }
                  }}
                  className="p-2 rounded-full bg-white dark:bg-[#1C1C1E] text-gray-700 dark:text-gray-300 shadow-xs hover:bg-gray-100 dark:hover:bg-[#2C2C2E] ios-press"
                  title="Settings"
                >
                  <Settings className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Desktop Selection Action Toolbar (when Select mode active on Desktop) */}
            {isDesktop && isSelectionMode && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="pt-2 pb-1 border-t border-gray-200 dark:border-white/10 mt-1 flex items-center justify-between"
              >
                <div className="flex items-center gap-2 text-xs font-semibold text-gray-700 dark:text-gray-300">
                  <span className="w-5 h-5 rounded-full bg-[#5856D6] text-white flex items-center justify-center text-[10px]">
                    {selectedDocIds.length}
                  </span>
                  <span>documents selected</span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={handleMergeSelected}
                    disabled={selectedDocIds.length < 2}
                    className={`ios-press flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                      selectedDocIds.length >= 2
                        ? 'bg-[#5856D6] text-white hover:bg-[#6866E6]'
                        : 'bg-gray-200 dark:bg-white/10 text-gray-400 cursor-not-allowed'
                    }`}
                    title="Merge selected documents in order"
                  >
                    <GitMerge className="w-3.5 h-3.5" />
                    <span>Merge ({selectedDocIds.length})</span>
                  </button>

                  <button
                    onClick={handleShareSelected}
                    disabled={selectedDocIds.length === 0}
                    className={`ios-press flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                      selectedDocIds.length > 0
                        ? 'bg-blue-600 text-white hover:bg-blue-500'
                        : 'bg-gray-200 dark:bg-white/10 text-gray-400 cursor-not-allowed'
                    }`}
                    title="Share each as PDF"
                  >
                    <Share2 className="w-3.5 h-3.5" />
                    <span>Share PDFs</span>
                  </button>

                  {selectedDocIds.length === 1 && (
                    <button
                      onClick={handleRenameSelected}
                      className="ios-press flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-white/10 hover:bg-gray-200 text-xs font-semibold"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                      <span>Rename</span>
                    </button>
                  )}

                  <button
                    onClick={handleMoveSelected}
                    disabled={selectedDocIds.length === 0}
                    className="ios-press flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-white/10 hover:bg-gray-200 text-xs font-semibold"
                  >
                    <FolderInput className="w-3.5 h-3.5" />
                    <span>Move</span>
                  </button>

                  <button
                    onClick={() => setIsBatchDeleteConfirm(true)}
                    disabled={selectedDocIds.length === 0}
                    className="ios-press flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500/20 text-xs font-semibold"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete</span>
                  </button>
                </div>
              </motion.div>
            )}

            {/* SEARCH BAR (Full Width, iOS style) */}
            <div className="py-2">
              <div className="relative">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search document names and every word on pages (OCR)..."
                  className="w-full pl-10 pr-9 py-2 rounded-xl bg-white dark:bg-[#1C1C1E] border border-gray-200 dark:border-[#2C2C2E] text-sm text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#5856D6] shadow-2xs"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* FILTER PILLS: All, Categories, Folders */}
            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-1">
              <button
                onClick={() => {
                  triggerHaptic('light');
                  setSelectedFilter('All');
                }}
                className={`shrink-0 px-3 py-1 rounded-full text-xs font-semibold transition-all ios-press ${
                  selectedFilter === 'All'
                    ? 'bg-[#5856D6] text-white shadow-xs'
                    : 'bg-white/80 dark:bg-[#1C1C1E] text-gray-600 dark:text-gray-300 hover:bg-white dark:hover:bg-[#2C2C2E]'
                }`}
              >
                All
              </button>

              {/* Category Pills */}
              {categoriesList.map((cat) => {
                const isSelected = selectedFilter === cat;
                return (
                  <button
                    key={cat}
                    onClick={() => {
                      triggerHaptic('light');
                      setSelectedFilter(cat);
                    }}
                    className={`shrink-0 px-3 py-1 rounded-full text-xs font-semibold transition-all ios-press ${
                      isSelected
                        ? 'bg-[#5856D6] text-white shadow-xs'
                        : 'bg-white/80 dark:bg-[#1C1C1E] text-gray-600 dark:text-gray-300 hover:bg-white dark:hover:bg-[#2C2C2E]'
                    }`}
                  >
                    {cat}
                  </button>
                );
              })}

              {/* Folder Pills */}
              {foldersList.map((folder) => {
                const key = `folder:${folder}`;
                const isSelected = selectedFilter === key;
                return (
                  <button
                    key={key}
                    onClick={() => {
                      triggerHaptic('light');
                      setSelectedFilter(key);
                    }}
                    className={`shrink-0 flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold transition-all ios-press ${
                      isSelected
                        ? 'bg-amber-600 text-white shadow-xs'
                        : 'bg-white/80 dark:bg-[#1C1C1E] text-amber-700 dark:text-amber-400 hover:bg-white dark:hover:bg-[#2C2C2E]'
                    }`}
                  >
                    <Folder className="w-3 h-3" />
                    <span>{folder}</span>
                  </button>
                );
              })}
            </div>
          </header>
        )}

        {/* VIEW ROUTING */}
        {isDesktop ? (
          /* Desktop Section Router */
          <>
            {desktopSection === 'documents' && (
              <div className="flex-1 overflow-y-auto ios-scroll p-4 sm:p-6 pb-12">
                {/* Expiring Soon Banner & Drawer */}
                {!searchQuery.trim() && (
                  <ExpiringSoonBanner
                    documents={homeDocuments}
                    onOpenDocument={(doc) => {
                      setActiveDocument(doc);
                      setActiveViewerPageIndex(0);
                      setActiveViewerHighlight('');
                    }}
                  />
                )}

                {searchQuery.trim() ? (
                  /* SEARCH RESULTS VIEW */
                  <div>
                    <div className="mb-3 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 px-1">
                      <span>
                        Found {ocrSearchResults.length}{' '}
                        {ocrSearchResults.length === 1 ? 'match' : 'matches'} for &quot;
                        <strong>{searchQuery}</strong>&quot;
                      </span>
                      <button
                        onClick={() => setSearchQuery('')}
                        className="text-[#5856D6] dark:text-[#7D7AFF] hover:underline"
                      >
                        Clear Search
                      </button>
                    </div>

                    {ocrSearchResults.length === 0 ? (
                      <div className="text-center py-16 text-gray-400">
                        <Search className="w-10 h-10 mx-auto mb-2 opacity-40" />
                        <p className="text-sm font-medium">No matches found</p>
                        <p className="text-xs text-gray-400 mt-1">
                          No document names or scanned page text matched &quot;{searchQuery}&quot;.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {ocrSearchResults.map((result, idx) => {
                          const firstPage = result.doc.pages[result.pageIndex] || result.doc.pages[0];
                          return (
                            <div
                              key={`${result.doc.docId}-${result.pageIndex}-${idx}`}
                              onClick={() => handleSearchResultClick(result)}
                              className="p-3 bg-white dark:bg-[#1C1C1E] rounded-xl border border-[#E5E5EA] dark:border-[#2C2C2E] shadow-2xs hover:shadow-sm cursor-pointer transition-all flex items-center gap-3 ios-press-subtle"
                            >
                              <div className="w-12 h-14 bg-gray-200 dark:bg-gray-800 rounded-lg overflow-hidden shrink-0">
                                {firstPage ? (
                                  <img
                                    src={firstPage.dataUrl}
                                    alt=""
                                    className="w-full h-full object-cover"
                                  />
                                ) : (
                                  <FileText className="w-6 h-6 m-auto text-gray-400" />
                                )}
                              </div>

                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <h4 className="text-sm font-semibold text-gray-900 dark:text-white truncate">
                                    {result.doc.name}
                                  </h4>
                                  <span className="text-[10px] bg-[#5856D6]/10 text-[#5856D6] dark:text-[#7D7AFF] px-1.5 py-0.2 rounded font-semibold shrink-0">
                                    Page {result.pageIndex + 1}
                                  </span>
                                </div>

                                <p className="text-xs text-gray-600 dark:text-gray-300 font-mono mt-0.5 truncate">
                                  {result.matchingLine.split(new RegExp(`(${searchQuery})`, 'gi')).map((chunk, i) =>
                                    chunk.toLowerCase() === searchQuery.toLowerCase() ? (
                                      <mark
                                        key={i}
                                        className="bg-amber-300 dark:bg-amber-500 text-black dark:text-white px-0.5 rounded font-bold"
                                      >
                                        {chunk}
                                      </mark>
                                    ) : (
                                      chunk
                                    )
                                  )}
                                </p>

                                <span className="text-[10px] text-gray-400 mt-0.5 block">
                                  Folder: {result.doc.folder || 'Default'} • {result.doc.category}
                                </span>
                              </div>

                              <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ) : filteredDocuments.length === 0 ? (
                  /* Empty Document Grid */
                  <div className="h-full min-h-[360px] flex flex-col items-center justify-center text-center p-6 select-none">
                    <div className="mb-4">
                      <ViewfinderIcon size={72} rounded="rounded-2xl" />
                    </div>
                    <h3 className="text-lg font-bold text-gray-800 dark:text-gray-200">
                      {selectedFilter !== 'All' ? 'No Documents in this Filter' : 'No Documents Yet'}
                    </h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400 max-w-sm mt-1 mb-5 leading-relaxed">
                      Scan documents with your camera, or drag and drop photos and PDFs anywhere onto this window.
                    </p>
                    <button
                      onClick={() => {
                        triggerHaptic('light');
                        setIsScannerOpen(true);
                      }}
                      className="ios-press flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#5856D6] text-white font-semibold text-sm shadow-md hover:bg-[#6866E6]"
                    >
                      <Camera className="w-4 h-4" />
                      <span>Scan or Import Document</span>
                    </button>
                  </div>
                ) : (
                  /* Documents Grid */
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4">
                    {filteredDocuments.map((doc) => (
                      <DocumentCard
                        key={doc.docId}
                        document={doc}
                        isSelected={selectedDocIds.includes(doc.docId)}
                        isSelectionMode={isSelectionMode}
                        onClick={(e) => handleDocClick(e, doc)}
                        onContextMenu={handleContextMenu}
                        onLongPress={handleDocLongPress}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}

            {desktopSection === 'folders' && (
              <FoldersScreen
                documents={homeDocuments}
                onOpenDocument={(doc) => {
                  setActiveDocument(doc);
                  setActiveViewerPageIndex(0);
                  setActiveViewerHighlight('');
                }}
                onContextMenu={handleContextMenu}
                onScanInFolder={() => setIsScannerOpen(true)}
              />
            )}

            {desktopSection === 'vault' && (
              <VaultScreen
                documents={documents}
                onOpenDocument={(doc) => {
                  setActiveDocument(doc);
                  setActiveViewerPageIndex(0);
                  setActiveViewerHighlight('');
                }}
                onContextMenu={handleContextMenu}
                onScanToVault={() => {
                  setScanInitialVault(true);
                  setIsScannerOpen(true);
                }}
              />
            )}

            {desktopSection === 'tools' && (
              <ToolsScreen
                documents={homeDocuments}
                onOpenDocument={(doc) => {
                  setActiveDocument(doc);
                  setActiveViewerPageIndex(0);
                  setActiveViewerHighlight('');
                }}
              />
            )}

            {desktopSection === 'settings' && (
              <SettingsScreen onRefreshDocs={refreshDocuments} />
            )}
          </>
        ) : (
          /* Mobile Tab Router */
          <>
            {activeTab === 'files' && (
              <div className="flex-1 overflow-y-auto ios-scroll p-4 pb-28">
                {/* Expiring Soon Banner & Drawer */}
                {!searchQuery.trim() && (
                  <ExpiringSoonBanner
                    documents={homeDocuments}
                    onOpenDocument={(doc) => {
                      setActiveDocument(doc);
                      setActiveViewerPageIndex(0);
                      setActiveViewerHighlight('');
                    }}
                  />
                )}

                {searchQuery.trim() ? (
                  /* Mobile Search Results */
                  <div className="space-y-2">
                    <div className="mb-2 text-xs text-gray-500 dark:text-gray-400">
                      {ocrSearchResults.length} matches for &quot;{searchQuery}&quot;
                    </div>
                    {ocrSearchResults.map((result, idx) => {
                      const firstPage = result.doc.pages[result.pageIndex] || result.doc.pages[0];
                      return (
                        <div
                          key={`${result.doc.docId}-${result.pageIndex}-${idx}`}
                          onClick={() => handleSearchResultClick(result)}
                          className="p-3 bg-white dark:bg-[#1C1C1E] rounded-xl border border-[#E5E5EA] dark:border-[#2C2C2E] shadow-2xs flex items-center gap-3 ios-press"
                        >
                          <div className="w-12 h-14 bg-gray-200 dark:bg-gray-800 rounded-lg overflow-hidden shrink-0">
                            {firstPage ? (
                              <img
                                src={firstPage.dataUrl}
                                alt=""
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <FileText className="w-6 h-6 m-auto text-gray-400" />
                            )}
                          </div>

                          <div className="flex-1 min-w-0">
                            <h4 className="text-sm font-semibold text-gray-900 dark:text-white truncate">
                              {result.doc.name}
                            </h4>
                            <p className="text-xs text-gray-600 dark:text-gray-300 font-mono mt-0.5 truncate">
                              {result.matchingLine.split(new RegExp(`(${searchQuery})`, 'gi')).map((chunk, i) =>
                                chunk.toLowerCase() === searchQuery.toLowerCase() ? (
                                  <mark
                                    key={i}
                                    className="bg-amber-300 dark:bg-amber-500 text-black dark:text-white px-0.5 rounded font-bold"
                                  >
                                    {chunk}
                                  </mark>
                                ) : (
                                  chunk
                                )
                              )}
                            </p>
                            <span className="text-[10px] text-gray-400 mt-0.5 block">
                              Page {result.pageIndex + 1} • {result.doc.folder || 'Default'}
                            </span>
                          </div>
                          <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />
                        </div>
                      );
                    })}
                  </div>
                ) : filteredDocuments.length === 0 ? (
                  <div className="h-full min-h-[340px] flex flex-col items-center justify-center text-center p-6 select-none">
                    <div className="mb-4">
                      <ViewfinderIcon size={64} rounded="rounded-2xl" />
                    </div>
                    <h3 className="text-base font-bold text-gray-800 dark:text-gray-200">
                      {selectedFilter !== 'All' ? 'No Documents in this Filter' : 'No Documents Yet'}
                    </h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400 max-w-xs mt-1 mb-5">
                      Tap the big round Scan button below to scan your first document or receipt.
                    </p>
                    <button
                      onClick={() => {
                        triggerHaptic('light');
                        setIsScannerOpen(true);
                      }}
                      className="ios-press flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#5856D6] text-white font-semibold text-sm shadow-md"
                    >
                      <Camera className="w-4 h-4" />
                      <span>Start Scanning</span>
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {filteredDocuments.map((doc) => (
                      <DocumentCard
                        key={doc.docId}
                        document={doc}
                        isSelected={selectedDocIds.includes(doc.docId)}
                        isSelectionMode={isSelectionMode}
                        onClick={(e) => handleDocClick(e, doc)}
                        onContextMenu={handleContextMenu}
                        onLongPress={handleDocLongPress}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'tools' && (
              <SettingsScreen onRefreshDocs={refreshDocuments} />
            )}
          </>
        )}

        {/* MOBILE SELECT MODE BOTTOM TOOLBAR */}
        {!isDesktop && isSelectionMode && (
          <nav className="fixed bottom-0 inset-x-0 z-40 pb-safe bg-[#1C1C1E] text-white border-t border-white/10 flex items-center justify-around h-[72px] px-3 select-none shadow-2xl">
            {/* Merge */}
            <button
              onClick={handleMergeSelected}
              disabled={selectedDocIds.length < 2}
              className={`flex flex-col items-center gap-1 ios-press ${
                selectedDocIds.length >= 2 ? 'text-[#7D7AFF]' : 'text-gray-500 opacity-50'
              }`}
            >
              <GitMerge className="w-5 h-5" />
              <span className="text-[10px] font-semibold">Merge ({selectedDocIds.length})</span>
            </button>

            {/* Share */}
            <button
              onClick={handleShareSelected}
              disabled={selectedDocIds.length === 0}
              className={`flex flex-col items-center gap-1 ios-press ${
                selectedDocIds.length > 0 ? 'text-blue-400' : 'text-gray-500 opacity-50'
              }`}
            >
              <Share2 className="w-5 h-5" />
              <span className="text-[10px] font-semibold">Share PDF</span>
            </button>

            {/* Rename (if 1 selected) */}
            {selectedDocIds.length === 1 && (
              <button
                onClick={handleRenameSelected}
                className="flex flex-col items-center gap-1 text-gray-300 ios-press"
              >
                <Edit2 className="w-5 h-5" />
                <span className="text-[10px] font-semibold">Rename</span>
              </button>
            )}

            {/* Move */}
            <button
              onClick={handleMoveSelected}
              disabled={selectedDocIds.length === 0}
              className={`flex flex-col items-center gap-1 ios-press ${
                selectedDocIds.length > 0 ? 'text-gray-300' : 'text-gray-500 opacity-50'
              }`}
            >
              <FolderInput className="w-5 h-5" />
              <span className="text-[10px] font-semibold">Move</span>
            </button>

            {/* Delete */}
            <button
              onClick={() => setIsBatchDeleteConfirm(true)}
              disabled={selectedDocIds.length === 0}
              className={`flex flex-col items-center gap-1 ios-press ${
                selectedDocIds.length > 0 ? 'text-red-400' : 'text-gray-500 opacity-50'
              }`}
            >
              <Trash2 className="w-5 h-5" />
              <span className="text-[10px] font-semibold">Delete</span>
            </button>
          </nav>
        )}

        {/* MOBILE BOTTOM DOCK (Normal state, when not in select mode) */}
        {!isDesktop && !isSelectionMode && (
          <nav className="fixed bottom-0 inset-x-0 z-30 pb-safe bg-white/90 dark:bg-[#1C1C1E]/90 backdrop-blur-xl border-t border-[#E5E5EA] dark:border-[#2C2C2E] flex items-center justify-around h-[64px] px-6 select-none">
            {/* Tab 1: Files */}
            <button
              onClick={() => {
                triggerHaptic('light');
                setActiveTab('files');
                setIsFilesSheetOpen(true);
              }}
              className={`flex flex-col items-center gap-1 ios-press ${
                activeTab === 'files'
                  ? 'text-[#5856D6] dark:text-[#7D7AFF]'
                  : 'text-gray-400 dark:text-gray-500'
              }`}
            >
              <FileText className="w-5 h-5 stroke-[2.2]" />
              <span className="text-[10px] font-semibold">Files</span>
            </button>

            {/* Tab 2: Big Round Scan Button (Camera Shutter Style) */}
            <button
              onClick={() => {
                triggerHaptic('medium');
                setIsScannerOpen(true);
              }}
              className="relative -top-4 w-16 h-16 rounded-full bg-white dark:bg-[#1C1C1E] p-1 shadow-xl border-2 border-black/10 dark:border-white/10 ios-press"
              aria-label="Scan Document"
            >
              <div className="w-full h-full rounded-full bg-[#5856D6] flex items-center justify-center text-white shadow-inner">
                <Camera className="w-7 h-7 stroke-[2.2]" />
              </div>
            </button>

            {/* Tab 3: Tools */}
            <button
              onClick={() => {
                triggerHaptic('light');
                setActiveTab('tools');
              }}
              className={`flex flex-col items-center gap-1 ios-press ${
                activeTab === 'tools'
                  ? 'text-[#5856D6] dark:text-[#7D7AFF]'
                  : 'text-gray-400 dark:text-gray-500'
              }`}
            >
              <SlidersHorizontal className="w-5 h-5 stroke-[2.2]" />
              <span className="text-[10px] font-semibold">Tools</span>
            </button>
          </nav>
        )}
      </main>

      {/* DOCUMENT VIEWER MODAL / FULLSCREEN SCREEN */}
      <AnimatePresence>
        {activeDocument && (
          <DocumentViewer
            document={activeDocument}
            initialPageIndex={activeViewerPageIndex}
            highlightQuery={activeViewerHighlight}
            onClose={() => setActiveDocument(null)}
            onDeleteDocument={(docId) => {
              handleDeleteDoc(docId);
              setActiveDocument(null);
            }}
            onDocumentUpdated={(updated) => {
              setActiveDocument(updated);
              refreshDocuments();
            }}
          />
        )}
      </AnimatePresence>

      {/* SECTION 5: FILES SHEET MODAL */}
      <FilesSheetModal
        isOpen={isFilesSheetOpen}
        onClose={() => setIsFilesSheetOpen(false)}
        onOpenFile={(rec) => setActiveFileRecord(rec)}
      />

      {/* SECTION 5: FILE VIEWER MODAL */}
      <AnimatePresence>
        {activeFileRecord && (
          <FileViewerModal
            isOpen={!!activeFileRecord}
            fileRecord={activeFileRecord}
            onClose={() => setActiveFileRecord(null)}
            onOpenScannerDocument={(doc) => {
              setActiveDocument(doc);
              setActiveViewerPageIndex(0);
              setActiveViewerHighlight('');
              refreshDocuments();
            }}
          />
        )}
      </AnimatePresence>

      {/* SCANNER MODAL */}
      <ScannerModal
        isOpen={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
        initialVault={scanInitialVault}
        onDocumentCreated={(newDoc) => {
          refreshDocuments();
          setActiveDocument(newDoc);
          setActiveViewerPageIndex(0);
          setActiveViewerHighlight('');
        }}
      />

      {/* QR SCANNER MODAL */}
      <QRScannerModal
        isOpen={isQROpen}
        onClose={() => setIsQROpen(false)}
      />

      {/* DESKTOP RIGHT-CLICK CONTEXT MENU */}
      {contextMenuState.doc && (
        <DocumentContextMenu
          x={contextMenuState.x}
          y={contextMenuState.y}
          doc={contextMenuState.doc}
          onClose={() => setContextMenuState({ x: 0, y: 0, doc: null })}
          onOpen={(doc) => {
            setActiveDocument(doc);
            setActiveViewerPageIndex(0);
            setActiveViewerHighlight('');
          }}
          onRename={(doc) => {
            setRenameDoc(doc);
            setRenameValue(doc.name);
          }}
          onToggleVault={handleToggleVault}
          onMoveFolder={(doc) => {
            setMoveDoc(doc);
            setMoveFolderValue(doc.folder || 'Default');
          }}
          onShare={(doc) => shareDocumentsAsPdfs([doc])}
          onDelete={(doc) => setDeleteConfirmDoc(doc)}
        />
      )}

      {/* Rename Dialog */}
      <IOSAlert
        isOpen={!!renameDoc}
        onClose={() => setRenameDoc(null)}
        title="Rename Document"
        buttons={[
          {
            label: 'Cancel',
            onClick: () => setRenameDoc(null),
            variant: 'cancel',
          },
          {
            label: 'Save',
            onClick: handleSaveRename,
            variant: 'default',
            isBold: true,
          },
        ]}
      >
        <input
          type="text"
          autoFocus
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          placeholder="Document name..."
          className="w-full mt-2 px-3 py-2 rounded-lg bg-black/5 dark:bg-white/10 border border-gray-300 dark:border-white/15 text-sm text-gray-900 dark:text-white focus:outline-none focus:border-[#5856D6]"
        />
      </IOSAlert>

      {/* Move to Folder Dialog */}
      <IOSAlert
        isOpen={!!moveDoc}
        onClose={() => setMoveDoc(null)}
        title="Move to Folder"
        description="Choose or enter folder name:"
        buttons={[
          {
            label: 'Cancel',
            onClick: () => setMoveDoc(null),
            variant: 'cancel',
          },
          {
            label: 'Move',
            onClick: handleSaveMove,
            variant: 'default',
            isBold: true,
          },
        ]}
      >
        <input
          type="text"
          autoFocus
          value={moveFolderValue}
          onChange={(e) => setMoveFolderValue(e.target.value)}
          placeholder="Folder name..."
          className="w-full mt-2 px-3 py-2 rounded-lg bg-black/5 dark:bg-white/10 border border-gray-300 dark:border-white/15 text-sm text-gray-900 dark:text-white focus:outline-none focus:border-[#5856D6]"
        />
      </IOSAlert>

      {/* Delete Single Document Confirmation */}
      <IOSAlert
        isOpen={!!deleteConfirmDoc}
        onClose={() => setDeleteConfirmDoc(null)}
        title="Delete Document?"
        description={`"${deleteConfirmDoc?.name}" will be permanently removed.`}
        buttons={[
          {
            label: 'Cancel',
            onClick: () => setDeleteConfirmDoc(null),
            variant: 'cancel',
          },
          {
            label: 'Delete',
            onClick: () => {
              if (deleteConfirmDoc) handleDeleteDoc(deleteConfirmDoc.docId);
              setDeleteConfirmDoc(null);
            },
            variant: 'destructive',
            isBold: true,
          },
        ]}
      />

      {/* Batch Delete Confirmation */}
      <IOSAlert
        isOpen={isBatchDeleteConfirm}
        onClose={() => setIsBatchDeleteConfirm(false)}
        title="Delete Selected Documents?"
        description={`Are you sure you want to delete ${selectedDocIds.length} documents?`}
        buttons={[
          {
            label: 'Cancel',
            onClick: () => setIsBatchDeleteConfirm(false),
            variant: 'cancel',
          },
          {
            label: 'Delete All',
            onClick: handleBatchDelete,
            variant: 'destructive',
            isBold: true,
          },
        ]}
      />

      {/* Ask AI Information Dialog */}
      <IOSAlert
        isOpen={showAskAIModal}
        onClose={() => setShowAskAIModal(false)}
        title="✨ Ask AI Active"
        description="Your Groq API key is connected. You can query document text and run smart summaries."
        buttons={[
          {
            label: 'Done',
            onClick: () => setShowAskAIModal(false),
            variant: 'default',
            isBold: true,
          },
        ]}
      />
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <PhantomScannerApp />
    </ThemeProvider>
  );
}
