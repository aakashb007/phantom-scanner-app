import React, { useEffect, useRef } from 'react';
import { Eye, Edit2, Lock, Unlock, Trash2, Share2, Folder } from 'lucide-react';
import { DocumentRecord } from '../types/document';
import { triggerHaptic } from '../utils/haptics';

interface DocumentContextMenuProps {
  x: number;
  y: number;
  doc: DocumentRecord | null;
  onClose: () => void;
  onOpen: (doc: DocumentRecord) => void;
  onRename: (doc: DocumentRecord) => void;
  onToggleVault: (doc: DocumentRecord) => void;
  onMoveFolder: (doc: DocumentRecord) => void;
  onShare: (doc: DocumentRecord) => void;
  onDelete: (doc: DocumentRecord) => void;
}

export const DocumentContextMenu: React.FC<DocumentContextMenuProps> = ({
  x,
  y,
  doc,
  onClose,
  onOpen,
  onRename,
  onToggleVault,
  onMoveFolder,
  onShare,
  onDelete,
}) => {
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    window.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  if (!doc) return null;

  // Keep menu within viewport
  const menuWidth = 200;
  const menuHeight = 220;
  const adjustedX = Math.min(x, window.innerWidth - menuWidth - 16);
  const adjustedY = Math.min(y, window.innerHeight - menuHeight - 16);

  const handleAction = (action: () => void) => {
    triggerHaptic('light');
    action();
    onClose();
  };

  return (
    <div
      ref={menuRef}
      style={{ left: adjustedX, top: adjustedY }}
      className="fixed z-50 w-52 bg-white/90 dark:bg-[#1E1E1E]/90 backdrop-blur-xl rounded-xl shadow-2xl border border-black/10 dark:border-white/10 p-1.5 text-sm select-none animate-in fade-in zoom-in-95 duration-100"
    >
      <div className="px-2.5 py-1.5 border-b border-gray-100 dark:border-white/10 mb-1">
        <p className="font-semibold text-xs text-gray-900 dark:text-white truncate">
          {doc.name}
        </p>
        <p className="text-[10px] text-gray-500 dark:text-gray-400">
          {doc.pages.length} {doc.pages.length === 1 ? 'page' : 'pages'}
        </p>
      </div>

      <button
        onClick={() => handleAction(() => onOpen(doc))}
        className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-gray-700 dark:text-gray-200 hover:bg-[#5856D6] hover:text-white transition-colors cursor-pointer"
      >
        <Eye className="w-4 h-4" />
        <span>Open</span>
      </button>

      <button
        onClick={() => handleAction(() => onRename(doc))}
        className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-gray-700 dark:text-gray-200 hover:bg-[#5856D6] hover:text-white transition-colors cursor-pointer"
      >
        <Edit2 className="w-4 h-4" />
        <span>Rename</span>
      </button>

      <button
        onClick={() => handleAction(() => onMoveFolder(doc))}
        className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-gray-700 dark:text-gray-200 hover:bg-[#5856D6] hover:text-white transition-colors cursor-pointer"
      >
        <Folder className="w-4 h-4" />
        <span>Move to Folder</span>
      </button>

      <button
        onClick={() => handleAction(() => onToggleVault(doc))}
        className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-gray-700 dark:text-gray-200 hover:bg-[#5856D6] hover:text-white transition-colors cursor-pointer"
      >
        {doc.vault ? <Unlock className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
        <span>{doc.vault ? 'Remove from Vault' : 'Move to Vault'}</span>
      </button>

      <button
        onClick={() => handleAction(() => onShare(doc))}
        className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-gray-700 dark:text-gray-200 hover:bg-[#5856D6] hover:text-white transition-colors cursor-pointer"
      >
        <Share2 className="w-4 h-4" />
        <span>Share / Export</span>
      </button>

      <div className="my-1 border-t border-gray-100 dark:border-white/10" />

      <button
        onClick={() => handleAction(() => onDelete(doc))}
        className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-red-600 dark:text-red-400 hover:bg-red-500 hover:text-white transition-colors cursor-pointer"
      >
        <Trash2 className="w-4 h-4" />
        <span>Delete</span>
      </button>
    </div>
  );
};
