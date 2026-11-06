import React, { useState, useEffect } from 'react';
import {
  X,
  FolderOpen,
  UploadCloud,
  FileText,
  Clock,
  Trash2,
  ChevronRight,
  BookOpen,
  Table,
  Presentation,
  File,
  Sparkles,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { RecentFileRecord } from '../types/document';
import { triggerHaptic } from '../utils/haptics';
import { getRecentFiles, deleteRecentFile, clearRecentFiles, saveRecentFile } from '../db/db';
import { detectFileType } from '../utils/fileParser';
import { useWindowWidth } from '../hooks/useWindowWidth';

interface FilesSheetModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenFile: (fileRecord: RecentFileRecord) => void;
}

export const FilesSheetModal: React.FC<FilesSheetModalProps> = ({
  isOpen,
  onClose,
  onOpenFile,
}) => {
  const { isDesktop } = useWindowWidth();
  const [recentFiles, setRecentFiles] = useState<RecentFileRecord[]>([]);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  const loadRecents = async () => {
    const list = await getRecentFiles();
    setRecentFiles(list);
  };

  useEffect(() => {
    if (isOpen) {
      loadRecents();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleFileSelected = async (file: File) => {
    triggerHaptic('medium');
    const arrayBuffer = await file.arrayBuffer();
    const type = detectFileType(file.name, file.type);

    const saved = await saveRecentFile({
      name: file.name,
      type,
      size: file.size,
      lastOpened: Date.now(),
      lastPageRead: 1,
      totalPages: 1,
      data: arrayBuffer,
      bookmarks: [],
    });

    onOpenFile(saved);
    onClose();
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileSelected(file);
    e.target.value = '';
  };

  const handleDeleteRecent = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    triggerHaptic('light');
    await deleteRecentFile(id);
    await loadRecents();
  };

  const handleClearAll = async () => {
    triggerHaptic('warning');
    if (window.confirm('Clear all recent files?')) {
      await clearRecentFiles();
      setRecentFiles([]);
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatRelativeTime = (timestamp: number): string => {
    const diffSec = Math.floor((Date.now() - timestamp) / 1000);
    if (diffSec < 60) return 'Just now';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDays = Math.floor(diffHr / 24);
    if (diffDays === 1) return 'Yesterday';
    return `${diffDays}d ago`;
  };

  const renderTypeIcon = (type: string) => {
    switch (type) {
      case 'pdf':
        return (
          <div className="w-10 h-10 rounded-xl bg-red-500/15 text-red-500 flex items-center justify-center font-bold text-xs shrink-0">
            PDF
          </div>
        );
      case 'docx':
        return (
          <div className="w-10 h-10 rounded-xl bg-blue-500/15 text-blue-500 flex items-center justify-center font-bold text-xs shrink-0">
            DOCX
          </div>
        );
      case 'xlsx':
        return (
          <div className="w-10 h-10 rounded-xl bg-emerald-500/15 text-emerald-500 flex items-center justify-center font-bold text-xs shrink-0">
            XLSX
          </div>
        );
      case 'pptx':
        return (
          <div className="w-10 h-10 rounded-xl bg-amber-500/15 text-amber-500 flex items-center justify-center font-bold text-xs shrink-0">
            PPTX
          </div>
        );
      default:
        return (
          <div className="w-10 h-10 rounded-xl bg-purple-500/15 text-purple-500 flex items-center justify-center font-bold text-xs shrink-0">
            FILE
          </div>
        );
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/65 backdrop-blur-md select-none">
      <motion.div
        initial={isDesktop ? { opacity: 0, scale: 0.95 } : { y: '100%' }}
        animate={isDesktop ? { opacity: 1, scale: 1 } : { y: 0 }}
        exit={isDesktop ? { opacity: 0, scale: 0.95 } : { y: '100%' }}
        transition={{ type: 'spring', damping: 26, stiffness: 280 }}
        className={`w-full ${
          isDesktop ? 'max-w-xl max-h-[85vh] rounded-3xl' : 'max-h-[92dvh] rounded-t-[32px]'
        } bg-[#1C1C1E] text-white border border-white/15 shadow-2xl flex flex-col overflow-hidden`}
      >
        {/* Mobile Grab Handle */}
        {!isDesktop && (
          <div className="w-full pt-3 pb-1 flex justify-center shrink-0">
            <div className="w-10 h-1 rounded-full bg-white/20" />
          </div>
        )}

        {/* Header */}
        <header className="px-5 py-3.5 border-b border-white/10 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <FolderOpen className="w-5 h-5 text-[#5856D6] dark:text-[#7D7AFF]" />
            <h2 className="text-base sm:text-lg font-bold">Files &amp; Documents</h2>
          </div>

          <div className="flex items-center gap-1">
            {recentFiles.length > 0 && (
              <button
                onClick={handleClearAll}
                className="text-xs text-red-400 hover:text-red-300 px-2 py-1 rounded-lg hover:bg-white/10 ios-press"
              >
                Clear Recents
              </button>
            )}

            <button
              onClick={() => {
                triggerHaptic('light');
                onClose();
              }}
              className="p-1.5 rounded-full text-gray-400 hover:text-white hover:bg-white/10 ios-press"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </header>

        {/* Body */}
        <div className="flex-1 overflow-y-auto ios-scroll p-4 sm:p-5 space-y-4">
          {/* Primary Action Card: Browse Files */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              const file = e.dataTransfer.files?.[0];
              if (file) handleFileSelected(file);
            }}
            onClick={() => fileInputRef.current?.click()}
            className={`p-6 rounded-2xl border-2 border-dashed flex flex-col items-center justify-center text-center cursor-pointer transition-all ios-press ${
              isDragging
                ? 'border-[#5856D6] bg-[#5856D6]/15'
                : 'border-white/20 bg-white/5 hover:bg-white/10 hover:border-white/30'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,.xlsx,.xls,.pptx,image/*"
              onChange={handleInputChange}
              className="hidden"
            />
            <div className="w-12 h-12 rounded-2xl bg-[#5856D6] text-white flex items-center justify-center shadow-lg mb-3">
              <UploadCloud className="w-6 h-6 stroke-[2.2]" />
            </div>
            <h3 className="text-sm font-bold text-white">Browse Files</h3>
            <p className="text-xs text-gray-400 mt-1 max-w-xs">
              Open PDF, Word (.docx), Excel (.xlsx), or PowerPoint (.pptx)
            </p>
            <span className="mt-3 text-[10px] font-semibold px-2.5 py-1 rounded-full bg-white/10 text-gray-300">
              Files are stored safely offline in IndexedDB
            </span>
          </div>

          {/* Recent Files Section */}
          <div>
            <div className="flex items-center justify-between mb-2 px-1">
              <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" />
                <span>Recent Files ({recentFiles.length})</span>
              </span>
              <span className="text-[11px] text-gray-500">Resumes at last page read</span>
            </div>

            {recentFiles.length === 0 ? (
              <div className="py-8 text-center text-gray-500 select-none">
                <FileText className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p className="text-xs font-medium">No recent files yet</p>
                <p className="text-[11px] text-gray-600 mt-0.5">
                  Browse or drop a PDF or Office file to open it here
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {recentFiles.map((file) => (
                  <div
                    key={file.id}
                    onClick={() => {
                      triggerHaptic('light');
                      onOpenFile(file);
                      onClose();
                    }}
                    className="p-3 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/10 flex items-center justify-between gap-3 cursor-pointer transition-all ios-press-subtle group"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {renderTypeIcon(file.type)}

                      <div className="min-w-0">
                        <h4 className="text-xs sm:text-sm font-semibold text-white truncate">
                          {file.name}
                        </h4>
                        <div className="flex items-center gap-2 text-[10px] text-gray-400 mt-0.5">
                          <span>{formatFileSize(file.size)}</span>
                          <span>•</span>
                          <span>{formatRelativeTime(file.lastOpened)}</span>
                          <span>•</span>
                          <span className="text-[#7D7AFF] font-medium">
                            {file.type === 'pptx'
                              ? `Slide ${file.lastPageRead}`
                              : file.type === 'xlsx'
                              ? `Sheet ${file.lastPageRead}`
                              : `Page ${file.lastPageRead}`}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={(e) => handleDeleteRecent(e, file.id)}
                        className="p-1.5 rounded-lg text-gray-500 hover:text-red-400 hover:bg-white/10 ios-press"
                        title="Remove from recents"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                      <ChevronRight className="w-4 h-4 text-gray-500 group-hover:text-white" />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
};
