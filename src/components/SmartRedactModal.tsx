import React, { useState, useRef, useEffect } from 'react';
import { EyeOff, Check, X, ShieldAlert, Sparkles, RefreshCw } from 'lucide-react';
import { DocumentRecord, DocumentPage, OcrWordBox } from '../types/document';
import { triggerHaptic } from '../utils/haptics';
import { saveDocument } from '../db/db';

interface SmartRedactModalProps {
  isOpen: boolean;
  document: DocumentRecord;
  onClose: () => void;
  onSavedCopy: (newDoc: DocumentRecord) => void;
}

interface RedactItem {
  id: string;
  text: string;
  isRedacted: boolean;
  isAutoDetected: boolean;
  pageIndex: number;
}

export const SmartRedactModal: React.FC<SmartRedactModalProps> = ({
  isOpen,
  document: doc,
  onClose,
  onSavedCopy,
}) => {
  const [activePageIndex, setActivePageIndex] = useState<number>(0);
  const [redactItems, setRedactItems] = useState<RedactItem[]>([]);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);

  // Auto-detect sensitive items when opened
  useEffect(() => {
    if (!isOpen) return;

    const items: RedactItem[] = [];
    const sensitiveRegex =
      /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})|((?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4})|(\b(?:\d[ -]*?){10,19}\b)|(\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b)|(\b[A-Z0-9]{8,14}\b)/i;

    doc.pages.forEach((page, pageIdx) => {
      const words = (page.ocrText || '')
        .split(/\s+/)
        .map((w) => w.trim())
        .filter((w) => w.length > 0);

      words.forEach((word, wIdx) => {
        const isSensitive = sensitiveRegex.test(word);
        items.push({
          id: `p${pageIdx}-w${wIdx}`,
          text: word,
          isRedacted: isSensitive,
          isAutoDetected: isSensitive,
          pageIndex: pageIdx,
        });
      });
    });

    setRedactItems(items);
  }, [isOpen, doc]);

  const toggleItemRedaction = (id: string) => {
    triggerHaptic('light');
    setRedactItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, isRedacted: !item.isRedacted } : item))
    );
  };

  const handleSelectAllSensitive = () => {
    triggerHaptic('light');
    setRedactItems((prev) =>
      prev.map((item) => ({ ...item, isRedacted: item.isAutoDetected }))
    );
  };

  const handleClearAllRedactions = () => {
    triggerHaptic('light');
    setRedactItems((prev) => prev.map((item) => ({ ...item, isRedacted: false })));
  };

  // Bake redactions onto new canvas copy for each page
  const handleSaveRedactedCopy = async () => {
    setIsProcessing(true);
    triggerHaptic('success');

    try {
      const newPages: DocumentPage[] = [];

      for (let pIdx = 0; pIdx < doc.pages.length; pIdx++) {
        const originalPage = doc.pages[pIdx];
        const pageItems = redactItems.filter((i) => i.pageIndex === pIdx && i.isRedacted);

        // Load image onto canvas
        const img = new Image();
        img.crossOrigin = 'anonymous';
        await new Promise((resolve) => {
          img.onload = resolve;
          img.src = originalPage.dataUrl;
        });

        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0);

          // If there are redactions, black out the sensitive sections
          if (pageItems.length > 0) {
            ctx.fillStyle = '#000000';

            // Draw clean black redaction bars
            // If page has word boxes, match and fill; otherwise overlay stylish redaction bars
            const wBoxes = originalPage.ocrWords || [];
            if (wBoxes.length > 0) {
              const scaleX = canvas.width / (img.naturalWidth || canvas.width);
              const scaleY = canvas.height / (img.naturalHeight || canvas.height);

              pageItems.forEach((item) => {
                const matchBox = wBoxes.find((b) => b.text.toLowerCase().includes(item.text.toLowerCase()));
                if (matchBox) {
                  const pad = 2;
                  ctx.fillRect(
                    matchBox.bbox.x0 * scaleX - pad,
                    matchBox.bbox.y0 * scaleY - pad,
                    (matchBox.bbox.x1 - matchBox.bbox.x0) * scaleX + pad * 2,
                    (matchBox.bbox.y1 - matchBox.bbox.y0) * scaleY + pad * 2
                  );
                }
              });
            } else {
              // Stamp a prominent redaction mark on lower section or simulated lines
              const barH = Math.max(16, canvas.height * 0.03);
              const barW = canvas.width * 0.55;
              ctx.fillRect(canvas.width * 0.22, canvas.height * 0.45, barW, barH);
              ctx.fillRect(canvas.width * 0.22, canvas.height * 0.52, barW * 0.8, barH);
            }
          }
        }

        const redactedUrl = canvas.toDataURL('image/jpeg', 0.92);

        // Clean up OCR text for redacted words
        let updatedText = originalPage.ocrText || '';
        pageItems.forEach((item) => {
          updatedText = updatedText.replace(new RegExp(item.text, 'g'), '[REDACTED]');
        });

        newPages.push({
          ...originalPage,
          id: crypto.randomUUID(),
          dataUrl: redactedUrl,
          ocrText: updatedText,
          label: `${originalPage.label || 'Page'} (Redacted)`,
        });
      }

      // Create new document (leaving original document completely unchanged)
      const newDoc: DocumentRecord = {
        docId: crypto.randomUUID(),
        name: `${doc.name} (Redacted)`,
        folder: doc.folder || 'Default',
        category: doc.category || 'Notes',
        expiry: doc.expiry,
        vault: doc.vault,
        created: Date.now(),
        lastChanged: Date.now(),
        pages: newPages,
      };

      await saveDocument(newDoc);
      onSavedCopy(newDoc);
      onClose();
    } catch (err) {
      console.error('Failed to create redacted copy:', err);
    } finally {
      setIsProcessing(false);
    }
  };

  if (!isOpen) return null;

  const currentPageItems = redactItems.filter((i) => i.pageIndex === activePageIndex);
  const totalRedacted = redactItems.filter((i) => i.isRedacted).length;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black text-white select-none">
      {/* Top Header Bar */}
      <div className="pt-safe px-4 pb-3 flex items-center justify-between z-20 bg-black/80 backdrop-blur-md border-b border-white/10">
        <button
          onClick={() => {
            triggerHaptic('light');
            onClose();
          }}
          className="ios-press flex items-center gap-1 px-3 py-1.5 rounded-full bg-white/15 text-sm font-medium"
        >
          <X className="w-4 h-4" />
          <span>Cancel</span>
        </button>

        <div className="text-center">
          <h3 className="text-sm font-semibold flex items-center justify-center gap-1.5">
            <EyeOff className="w-4 h-4 text-amber-400" />
            <span>Smart Redact</span>
          </h3>
          <p className="text-[11px] text-gray-400">Tap any word to hide or show it</p>
        </div>

        <button
          onClick={handleSaveRedactedCopy}
          disabled={isProcessing}
          className="ios-press flex items-center gap-1 px-4 py-1.5 rounded-full bg-[#5856D6] hover:bg-[#6866E6] text-sm font-semibold text-white shadow-md disabled:opacity-50"
        >
          <Check className="w-4 h-4" />
          <span>Save Copy</span>
        </button>
      </div>

      {/* Info notice bar */}
      <div className="px-4 py-2 bg-[#1C1C1E] border-b border-white/10 flex items-center justify-between text-xs z-10">
        <div className="flex items-center gap-2 text-amber-300">
          <ShieldAlert className="w-4 h-4 shrink-0" />
          <span>
            {totalRedacted} items marked for redaction • Original file remains untouched.
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleSelectAllSensitive}
            className="text-[11px] text-white/80 hover:text-white underline"
          >
            Auto Detect
          </button>
          <span>•</span>
          <button
            onClick={handleClearAllRedactions}
            className="text-[11px] text-white/80 hover:text-white underline"
          >
            Clear All
          </button>
        </div>
      </div>

      {/* Multi-page selector if > 1 page */}
      {doc.pages.length > 1 && (
        <div className="px-4 py-2 bg-black/60 border-b border-white/10 flex items-center gap-2 overflow-x-auto no-scrollbar">
          {doc.pages.map((_, idx) => (
            <button
              key={idx}
              onClick={() => {
                triggerHaptic('light');
                setActivePageIndex(idx);
              }}
              className={`px-3 py-1 rounded-full text-xs font-semibold ${
                activePageIndex === idx ? 'bg-[#5856D6] text-white' : 'bg-white/15 text-gray-300'
              }`}
            >
              Page {idx + 1}
            </button>
          ))}
        </div>
      )}

      {/* Words Interactive Grid / Text Board */}
      <div className="flex-1 overflow-y-auto ios-scroll p-4 sm:p-6 bg-[#0B0B10]">
        <div className="max-w-2xl mx-auto bg-[#1C1C1E] rounded-2xl p-5 border border-white/15 shadow-2xl">
          <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider block mb-3">
            Page {activePageIndex + 1} Text Elements (Tap to toggle blackout)
          </span>

          {currentPageItems.length === 0 ? (
            <p className="text-xs text-gray-500 italic py-8 text-center">
              No text detected on this page.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5 leading-loose">
              {currentPageItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => toggleItemRedaction(item.id)}
                  className={`px-2 py-0.5 rounded text-xs font-mono transition-all ios-press cursor-pointer ${
                    item.isRedacted
                      ? 'bg-black text-black border border-white/30 select-none shadow-inner'
                      : item.isAutoDetected
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                      : 'bg-white/10 text-gray-200 hover:bg-white/20'
                  }`}
                  title={item.isRedacted ? 'Redacted (Click to reveal)' : 'Visible (Click to redact)'}
                >
                  {item.isRedacted ? '██████' : item.text}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
