import React, { useRef } from 'react';
import { Lock, FileText, CheckCircle2, Folder } from 'lucide-react';
import { DocumentRecord } from '../types/document';
import { triggerHaptic } from '../utils/haptics';

interface DocumentCardProps {
  document: DocumentRecord;
  isSelected?: boolean;
  isSelectionMode?: boolean;
  onClick: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent, doc: DocumentRecord) => void;
  onLongPress?: (doc: DocumentRecord) => void;
}

export const DocumentCard: React.FC<DocumentCardProps> = ({
  document: doc,
  isSelected = false,
  isSelectionMode = false,
  onClick,
  onContextMenu,
  onLongPress,
}) => {
  const firstPage = doc.pages && doc.pages.length > 0 ? doc.pages[0] : null;
  const longPressTimerRef = useRef<number | null>(null);
  const isLongPressTriggeredRef = useRef<boolean>(false);

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const isToday =
      date.getDate() === now.getDate() &&
      date.getMonth() === now.getMonth() &&
      date.getFullYear() === now.getFullYear();

    if (isToday) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  const handleTouchStart = () => {
    isLongPressTriggeredRef.current = false;
    longPressTimerRef.current = window.setTimeout(() => {
      isLongPressTriggeredRef.current = true;
      triggerHaptic('medium');
      if (onLongPress) {
        onLongPress(doc);
      }
    }, 480);
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
    }
  };

  const handleCardClick = (e: React.MouseEvent) => {
    // If long press already fired on mobile touch, prevent duplicate click
    if (isLongPressTriggeredRef.current) {
      isLongPressTriggeredRef.current = false;
      return;
    }
    triggerHaptic('light');
    onClick(e);
  };

  return (
    <div
      onClick={handleCardClick}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchMove={() => {
        if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu(e, doc);
      }}
      className={`group relative flex flex-col bg-white dark:bg-[#1C1C1E] rounded-2xl p-3 shadow-xs hover:shadow-md border transition-all cursor-pointer select-none ios-press-subtle ${
        isSelected
          ? 'border-[#5856D6] ring-2 ring-[#5856D6]/30 dark:ring-[#7D7AFF]/40'
          : 'border-[#E5E5EA] dark:border-[#2C2C2E] hover:border-gray-300 dark:hover:border-[#38383A]'
      }`}
    >
      {/* Selection Checkbox in selection mode */}
      {isSelectionMode && (
        <div className="absolute top-2.5 right-2.5 z-10">
          <div
            className={`w-6 h-6 rounded-full flex items-center justify-center transition-all ${
              isSelected
                ? 'bg-[#5856D6] text-white'
                : 'bg-black/20 text-white/50 backdrop-blur-xs'
            }`}
          >
            {isSelected ? (
              <CheckCircle2 className="w-5 h-5 fill-current" />
            ) : (
              <div className="w-5 h-5 rounded-full border-2 border-white/80" />
            )}
          </div>
        </div>
      )}

      {/* Thumbnail Aspect Box */}
      <div className="relative w-full aspect-[3/4] bg-[#F2F2F7] dark:bg-[#2C2C2E] rounded-xl overflow-hidden flex items-center justify-center shadow-inner mb-2.5">
        {firstPage ? (
          <img
            src={firstPage.dataUrl}
            alt={doc.name}
            style={{ transform: `rotate(${firstPage.rotation || 0}deg)` }}
            className="w-full h-full object-cover group-hover:scale-102 transition-transform duration-300"
            loading="lazy"
          />
        ) : (
          <div className="flex flex-col items-center justify-center text-gray-400 dark:text-gray-500">
            <FileText className="w-10 h-10 stroke-[1.5] mb-1" />
            <span className="text-[11px] font-medium">Empty</span>
          </div>
        )}

        {/* Vault Badge (Vault docs should not be on home, but handled if in Vault view) */}
        {doc.vault && (
          <div className="absolute top-2 left-2 flex items-center gap-1 bg-amber-500/90 text-white px-2 py-0.5 rounded-full text-[10px] font-bold shadow-xs backdrop-blur-xs">
            <Lock className="w-2.5 h-2.5" />
            <span>Vault</span>
          </div>
        )}

        {/* Page Count Badge */}
        <div className="absolute bottom-2 right-2 bg-black/60 backdrop-blur-md text-white text-[10px] font-semibold px-1.5 py-0.5 rounded-md">
          {doc.pages?.length || 0} {doc.pages?.length === 1 ? 'page' : 'pages'}
        </div>
      </div>

      {/* Document Meta: Name, Date, Folder */}
      <div className="flex flex-col gap-1">
        <h4 className="text-[14px] font-semibold text-gray-900 dark:text-white truncate">
          {doc.name}
        </h4>
        <div className="flex items-center justify-between text-[11px] text-gray-500 dark:text-gray-400">
          <span className="truncate">{formatDate(doc.lastChanged)}</span>
          <span className="flex items-center gap-1 text-[11px] text-gray-400 dark:text-gray-400 truncate max-w-[90px]">
            <Folder className="w-3 h-3 shrink-0" />
            <span className="truncate">{doc.folder || 'Default'}</span>
          </span>
        </div>
      </div>
    </div>
  );
};
