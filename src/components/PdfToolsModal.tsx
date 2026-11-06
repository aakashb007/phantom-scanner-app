import React, { useState } from 'react';
import {
  X,
  FilePlus,
  Minimize2,
  Copy,
  RotateCw,
  GitMerge,
  Images,
  Bookmark,
  Check,
  Loader2,
  ChevronRight,
  ArrowRight,
  Upload,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { triggerHaptic } from '../utils/haptics';
import {
  compressPdf,
  extractPdfPages,
  rotateAllPdfPages,
  mergePdfs,
  importPdfToPhantomScanner,
} from '../utils/fileParser';
import { downloadFile } from '../utils/exportEngine';
import { DocumentRecord } from '../types/document';

interface PdfToolsModalProps {
  isOpen: boolean;
  pdfBuffer: ArrayBuffer;
  fileName: string;
  pageCount: number;
  currentPage: number;
  bookmarks: number[];
  pageImages: string[];
  onClose: () => void;
  onJumpToPage: (page: number) => void;
  onOpenNewDocument?: (doc: DocumentRecord) => void;
  onToast: (msg: string) => void;
}

export const PdfToolsModal: React.FC<PdfToolsModalProps> = ({
  isOpen,
  pdfBuffer,
  fileName,
  pageCount,
  currentPage,
  bookmarks,
  pageImages,
  onClose,
  onJumpToPage,
  onOpenNewDocument,
  onToast,
}) => {
  const [activeSubTool, setActiveSubTool] = useState<
    'menu' | 'extract' | 'merge' | 'bookmarks'
  >('menu');
  const [selectedPages, setSelectedPages] = useState<number[]>([currentPage]);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [statusText, setStatusText] = useState<string>('');

  if (!isOpen) return null;

  // 1. Add to Phantom Scanner (to sign, mark up, watermark, redact)
  const handleAddToScanner = async () => {
    try {
      triggerHaptic('medium');
      setIsProcessing(true);
      setStatusText('Importing pages into Phantom Scanner...');

      const newDoc = await importPdfToPhantomScanner(pageImages, fileName);
      onToast(`Imported "${newDoc.name}" to Phantom Scanner!`);
      onClose();
      if (onOpenNewDocument) {
        onOpenNewDocument(newDoc);
      }
    } catch (err) {
      console.error('Import to scanner error:', err);
      alert('Could not import PDF to scanner. Please try again.');
    } finally {
      setIsProcessing(false);
      setStatusText('');
    }
  };

  // 2. Compress PDF
  const handleCompress = async () => {
    try {
      triggerHaptic('medium');
      setIsProcessing(true);
      setStatusText('Compressing PDF with pdf-lib...');

      const compressedFile = await compressPdf(pdfBuffer, fileName);
      downloadFile(compressedFile);
      onToast(`Saved compressed PDF: "${compressedFile.name}"`);
      onClose();
    } catch (err) {
      console.error('Compress error:', err);
      alert('Failed to compress PDF.');
    } finally {
      setIsProcessing(false);
      setStatusText('');
    }
  };

  // 3. Extract Pages
  const handleExtractPages = async () => {
    if (selectedPages.length === 0) {
      alert('Please select at least one page to extract.');
      return;
    }
    try {
      triggerHaptic('medium');
      setIsProcessing(true);
      setStatusText(`Extracting ${selectedPages.length} pages...`);

      const extractedFile = await extractPdfPages(pdfBuffer, selectedPages, fileName);
      downloadFile(extractedFile);
      onToast(`Saved extracted PDF: "${extractedFile.name}"`);
      onClose();
    } catch (err) {
      console.error('Extract error:', err);
      alert('Failed to extract pages.');
    } finally {
      setIsProcessing(false);
      setStatusText('');
    }
  };

  // 4. Rotate All Pages 90° Clockwise
  const handleRotateAll = async () => {
    try {
      triggerHaptic('medium');
      setIsProcessing(true);
      setStatusText('Rotating all pages 90° clockwise...');

      const rotatedFile = await rotateAllPdfPages(pdfBuffer, fileName);
      downloadFile(rotatedFile);
      onToast(`Saved rotated PDF: "${rotatedFile.name}"`);
      onClose();
    } catch (err) {
      console.error('Rotate error:', err);
      alert('Failed to rotate PDF pages.');
    } finally {
      setIsProcessing(false);
      setStatusText('');
    }
  };

  // 5. Merge with other PDF (File picker)
  const handleMergePicker = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (ev) => {
      const secondaryBuffer = ev.target?.result as ArrayBuffer;
      if (!secondaryBuffer) return;

      try {
        triggerHaptic('medium');
        setIsProcessing(true);
        setStatusText(`Merging with ${file.name}...`);

        const mergedFile = await mergePdfs(pdfBuffer, secondaryBuffer, fileName);
        downloadFile(mergedFile);
        onToast(`Saved merged PDF: "${mergedFile.name}"`);
        onClose();
      } catch (err) {
        console.error('Merge error:', err);
        alert('Could not merge PDFs. Ensure the secondary file is a valid PDF.');
      } finally {
        setIsProcessing(false);
        setStatusText('');
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  };

  // 6. Save pages as images
  const handleSavePagesAsImages = () => {
    triggerHaptic('medium');
    if (pageImages.length === 0) {
      alert('Page images are still rendering, please try in a moment.');
      return;
    }

    const baseName = fileName.replace(/\.[^/.]+$/, '');
    pageImages.forEach((dataUrl, idx) => {
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `${baseName}_page_${idx + 1}.jpg`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    });

    onToast(`Downloaded ${pageImages.length} page images.`);
    onClose();
  };

  const togglePageSelection = (p: number) => {
    triggerHaptic('light');
    setSelectedPages((prev) =>
      prev.includes(p) ? prev.filter((item) => item !== p) : [...prev, p].sort((a, b) => a - b)
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-md select-none">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="w-full sm:max-w-md bg-[#1C1C1E] text-white border border-white/15 rounded-t-[32px] sm:rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[85dvh]"
      >
        {/* Header */}
        <div className="p-4 border-b border-white/10 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            {activeSubTool !== 'menu' && (
              <button
                onClick={() => setActiveSubTool('menu')}
                className="p-1 -ml-1 rounded-lg text-gray-400 hover:text-white"
              >
                <ArrowRight className="w-4 h-4 rotate-180" />
              </button>
            )}
            <h3 className="text-base font-bold">
              {activeSubTool === 'menu' && 'PDF Tools'}
              {activeSubTool === 'extract' && 'Extract Pages'}
              {activeSubTool === 'bookmarks' && 'Bookmarks'}
            </h3>
          </div>

          <button
            onClick={() => {
              triggerHaptic('light');
              onClose();
            }}
            className="p-1.5 rounded-full text-gray-400 hover:text-white hover:bg-white/10"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Processing Spinner Overlay */}
        {isProcessing && (
          <div className="p-8 flex flex-col items-center justify-center text-center space-y-3 bg-black/40">
            <Loader2 className="w-8 h-8 animate-spin text-[#5856D6]" />
            <p className="text-sm font-semibold text-gray-200">{statusText}</p>
            <p className="text-xs text-gray-400">Creates a new file. Original remains untouched.</p>
          </div>
        )}

        {/* MAIN MENU */}
        {!isProcessing && activeSubTool === 'menu' && (
          <div className="p-4 space-y-1.5 overflow-y-auto ios-scroll">
            <p className="text-[11px] text-gray-400 font-medium px-2 mb-2">
              Every tool creates a new file. The original file is never changed.
            </p>

            {/* 1. Add to Phantom Scanner */}
            <button
              onClick={handleAddToScanner}
              className="w-full p-3 rounded-2xl bg-white/5 hover:bg-white/10 flex items-center justify-between text-left transition-colors ios-press group"
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-[#5856D6]/20 text-[#5856D6] flex items-center justify-center shrink-0">
                  <FilePlus className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-white">Add to Phantom Scanner</h4>
                  <p className="text-[11px] text-gray-400">
                    Sign, mark up, watermark, or redact pages
                  </p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-gray-500 group-hover:text-white" />
            </button>

            {/* 2. Compress PDF */}
            <button
              onClick={handleCompress}
              className="w-full p-3 rounded-2xl bg-white/5 hover:bg-white/10 flex items-center justify-between text-left transition-colors ios-press group"
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
                  <Minimize2 className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-white">Compress PDF</h4>
                  <p className="text-[11px] text-gray-400">Reduce file size using pdf-lib</p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-gray-500 group-hover:text-white" />
            </button>

            {/* 3. Extract Pages */}
            <button
              onClick={() => setActiveSubTool('extract')}
              className="w-full p-3 rounded-2xl bg-white/5 hover:bg-white/10 flex items-center justify-between text-left transition-colors ios-press group"
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-blue-500/20 text-blue-400 flex items-center justify-center shrink-0">
                  <Copy className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-white">Extract Pages</h4>
                  <p className="text-[11px] text-gray-400">Select specific pages into a new PDF</p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-gray-500 group-hover:text-white" />
            </button>

            {/* 4. Rotate All Pages */}
            <button
              onClick={handleRotateAll}
              className="w-full p-3 rounded-2xl bg-white/5 hover:bg-white/10 flex items-center justify-between text-left transition-colors ios-press group"
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-purple-500/20 text-purple-400 flex items-center justify-center shrink-0">
                  <RotateCw className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-white">Rotate All Pages</h4>
                  <p className="text-[11px] text-gray-400">Rotate 90° clockwise</p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-gray-500 group-hover:text-white" />
            </button>

            {/* 5. Merge with other PDF */}
            <label className="w-full p-3 rounded-2xl bg-white/5 hover:bg-white/10 flex items-center justify-between text-left transition-colors ios-press group cursor-pointer">
              <input
                type="file"
                accept="application/pdf"
                onChange={handleMergePicker}
                className="hidden"
              />
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center shrink-0">
                  <GitMerge className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-white">Merge with Other PDF</h4>
                  <p className="text-[11px] text-gray-400">Pick another PDF to join after this one</p>
                </div>
              </div>
              <Upload className="w-4 h-4 text-gray-500 group-hover:text-white" />
            </label>

            {/* 6. Save Pages as Images */}
            <button
              onClick={handleSavePagesAsImages}
              className="w-full p-3 rounded-2xl bg-white/5 hover:bg-white/10 flex items-center justify-between text-left transition-colors ios-press group"
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-pink-500/20 text-pink-400 flex items-center justify-center shrink-0">
                  <Images className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-white">Save Pages as Images</h4>
                  <p className="text-[11px] text-gray-400">Download each page as high-res JPG</p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-gray-500 group-hover:text-white" />
            </button>

            {/* 7. Bookmarks */}
            <button
              onClick={() => setActiveSubTool('bookmarks')}
              className="w-full p-3 rounded-2xl bg-white/5 hover:bg-white/10 flex items-center justify-between text-left transition-colors ios-press group"
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-indigo-500/20 text-indigo-400 flex items-center justify-center shrink-0">
                  <Bookmark className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-white">Bookmarks ({bookmarks.length})</h4>
                  <p className="text-[11px] text-gray-400">Quickly jump to saved pages</p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-gray-500 group-hover:text-white" />
            </button>
          </div>
        )}

        {/* SUBVIEW: EXTRACT PAGES */}
        {!isProcessing && activeSubTool === 'extract' && (
          <div className="p-4 flex flex-col flex-1 overflow-hidden">
            <div className="flex items-center justify-between mb-3 text-xs text-gray-400">
              <span>Select pages to include:</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() =>
                    setSelectedPages(Array.from({ length: pageCount }, (_, i) => i + 1))
                  }
                  className="text-[#7D7AFF] hover:underline"
                >
                  Select All
                </button>
                <span>•</span>
                <button onClick={() => setSelectedPages([])} className="text-gray-400 hover:underline">
                  Deselect
                </button>
              </div>
            </div>

            {/* Page Grid */}
            <div className="grid grid-cols-4 sm:grid-cols-5 gap-2 overflow-y-auto max-h-[300px] p-1">
              {Array.from({ length: pageCount }, (_, i) => i + 1).map((p) => {
                const isSelected = selectedPages.includes(p);
                return (
                  <button
                    key={p}
                    onClick={() => togglePageSelection(p)}
                    className={`py-3 rounded-xl border text-xs font-semibold flex flex-col items-center justify-center gap-1 transition-all ios-press ${
                      isSelected
                        ? 'bg-[#5856D6] border-white/20 text-white shadow-md'
                        : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10'
                    }`}
                  >
                    <span>Page</span>
                    <span className="text-sm font-bold">{p}</span>
                  </button>
                );
              })}
            </div>

            <div className="pt-4 border-t border-white/10 mt-3 flex items-center gap-2">
              <button
                onClick={() => setActiveSubTool('menu')}
                className="py-2.5 px-4 rounded-xl bg-white/10 text-xs font-semibold hover:bg-white/20"
              >
                Back
              </button>
              <button
                onClick={handleExtractPages}
                disabled={selectedPages.length === 0}
                className="flex-1 py-2.5 rounded-xl bg-[#5856D6] text-white font-semibold text-xs shadow-md disabled:opacity-40"
              >
                Extract {selectedPages.length} {selectedPages.length === 1 ? 'Page' : 'Pages'}
              </button>
            </div>
          </div>
        )}

        {/* SUBVIEW: BOOKMARKS */}
        {!isProcessing && activeSubTool === 'bookmarks' && (
          <div className="p-4 flex flex-col flex-1 overflow-hidden">
            {bookmarks.length === 0 ? (
              <div className="py-12 text-center text-gray-400">
                <Bookmark className="w-10 h-10 mx-auto mb-2 opacity-30" />
                <p className="text-sm font-semibold">No bookmarks yet</p>
                <p className="text-xs text-gray-500 mt-1">
                  Tap the bookmark icon on the top bar while viewing any page to save it here.
                </p>
              </div>
            ) : (
              <div className="space-y-2 overflow-y-auto max-h-[320px]">
                {bookmarks.map((p) => (
                  <div
                    key={p}
                    onClick={() => {
                      triggerHaptic('light');
                      onJumpToPage(p);
                      onClose();
                    }}
                    className="p-3 bg-white/5 hover:bg-white/10 rounded-xl flex items-center justify-between cursor-pointer ios-press transition-colors"
                  >
                    <div className="flex items-center gap-2.5">
                      <Bookmark className="w-4 h-4 text-amber-400 fill-amber-400" />
                      <span className="text-sm font-semibold text-white">Page {p}</span>
                    </div>
                    <span className="text-xs text-[#7D7AFF] font-medium">Jump to page →</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </motion.div>
    </div>
  );
};
