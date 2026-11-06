import React, { useState } from 'react';
import { Copy, Share2, Download, Languages, Check, X, FileText, Save } from 'lucide-react';
import { triggerHaptic } from '../utils/haptics';

interface TextOcrModalProps {
  isOpen: boolean;
  initialText: string;
  onSaveText: (updatedText: string) => void;
  onClose: () => void;
}

export const TextOcrModal: React.FC<TextOcrModalProps> = ({
  isOpen,
  initialText,
  onSaveText,
  onClose,
}) => {
  const [text, setText] = useState<string>(initialText || '');
  const [copied, setCopied] = useState<boolean>(false);
  const [saved, setSaved] = useState<boolean>(false);

  if (!isOpen) return null;

  const handleCopy = () => {
    triggerHaptic('light');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleShare = () => {
    triggerHaptic('light');
    if (navigator.share) {
      navigator.share({
        title: 'Extracted OCR Text',
        text: text,
      }).catch(() => {});
    } else {
      handleCopy();
    }
  };

  const handleDownloadTxt = () => {
    triggerHaptic('light');
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `extracted_text_${Date.now()}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleTranslate = () => {
    triggerHaptic('light');
    // Open in Google Translate in a new tab without any API keys!
    const encoded = encodeURIComponent(text.substring(0, 4500));
    window.open(`https://translate.google.com/?sl=auto&tl=en&text=${encoded}&op=translate`, '_blank', 'noopener,noreferrer');
  };

  const handleSaveEdits = () => {
    triggerHaptic('success');
    onSaveText(text);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black text-white select-none">
      {/* Top Header */}
      <div className="pt-safe px-4 pb-3 flex items-center justify-between z-20 bg-black/80 backdrop-blur-md border-b border-white/10">
        <button
          onClick={() => {
            triggerHaptic('light');
            onClose();
          }}
          className="ios-press flex items-center gap-1 px-3 py-1.5 rounded-full bg-white/15 text-sm font-medium"
        >
          <X className="w-4 h-4" />
          <span>Close</span>
        </button>

        <span className="text-sm font-semibold flex items-center gap-1.5">
          <FileText className="w-4 h-4 text-[#5856D6]" />
          <span>Recognized Text (OCR)</span>
        </span>

        <button
          onClick={handleSaveEdits}
          className="ios-press flex items-center gap-1 px-4 py-1.5 rounded-full bg-[#5856D6] hover:bg-[#6866E6] text-sm font-semibold text-white shadow-md"
        >
          {saved ? <Check className="w-4 h-4 text-emerald-300" /> : <Save className="w-4 h-4" />}
          <span>{saved ? 'Saved' : 'Save Text'}</span>
        </button>
      </div>

      {/* Main Textarea */}
      <div className="flex-1 p-4 sm:p-6 bg-[#0B0B10] flex flex-col">
        <div className="flex-1 bg-[#1C1C1E] rounded-2xl border border-white/15 p-4 flex flex-col shadow-2xl">
          <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider block mb-2">
            English / Latin &amp; Hindi / Devanagari OCR Text (Editable)
          </span>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="No text recognized on this page..."
            className="flex-1 w-full bg-transparent text-gray-100 font-mono text-xs sm:text-sm leading-relaxed resize-none focus:outline-none select-text"
          />
        </div>
      </div>

      {/* Bottom Actions Bar */}
      <div className="pb-safe pt-3 px-6 bg-black/80 backdrop-blur-md border-t border-white/10 flex flex-wrap items-center justify-around gap-2 text-xs z-20">
        <button
          onClick={handleCopy}
          className="ios-press flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/15 hover:bg-white/25 text-white font-medium"
        >
          {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
          <span>{copied ? 'Copied!' : 'Copy'}</span>
        </button>

        <button
          onClick={handleShare}
          className="ios-press flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/15 hover:bg-white/25 text-white font-medium"
        >
          <Share2 className="w-4 h-4" />
          <span>Share</span>
        </button>

        <button
          onClick={handleDownloadTxt}
          className="ios-press flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/15 hover:bg-white/25 text-white font-medium"
        >
          <Download className="w-4 h-4" />
          <span>Save .txt</span>
        </button>

        <button
          onClick={handleTranslate}
          className="ios-press flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#5856D6] hover:bg-[#6866E6] text-white font-semibold shadow-sm"
        >
          <Languages className="w-4 h-4" />
          <span>Translate</span>
        </button>
      </div>
    </div>
  );
};
