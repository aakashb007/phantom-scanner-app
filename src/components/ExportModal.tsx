import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Share2,
  Download,
  FileText,
  Image as ImageIcon,
  ShieldCheck,
  Type,
  Eye,
  Sliders,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Check,
  Loader2,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { DocumentRecord, DocumentPage } from '../types/document';
import { triggerHaptic } from '../utils/haptics';
import { useWindowWidth } from '../hooks/useWindowWidth';
import {
  ExportFormat,
  ExportQuality,
  WatermarkMode,
  WatermarkLayout,
  WatermarkConfig,
  QUALITY_CONFIG,
  getTodayDateString,
  getEffectiveWatermarkText,
  renderPageToCanvas,
  generateExportPdfWithPdfLib,
  generateExportJpgFiles,
  shareOrDownloadFiles,
  downloadFile,
} from '../utils/exportEngine';

interface ExportModalProps {
  isOpen: boolean;
  document: DocumentRecord;
  onClose: () => void;
  onSuccessToast?: (msg: string) => void;
}

const PRESET_WATERMARK_TEXTS = ['CONFIDENTIAL', 'DO NOT COPY', 'FOR REVIEW', 'DRAFT', 'ORIGINAL'];

const PRESET_PURPOSES = [
  'bank account opening',
  'KYC verification',
  'loan application',
  'visa application',
  'official verification',
  'rental agreement',
];

const PRESET_COLORS = [
  { label: 'Slate', value: '#64748B' },
  { label: 'Charcoal', value: '#1E293B' },
  { label: 'Red', value: '#EF4444' },
  { label: 'Blue', value: '#3B82F6' },
  { label: 'Green', value: '#10B981' },
  { label: 'Violet', value: '#8B5CF6' },
];

export const ExportModal: React.FC<ExportModalProps> = ({
  isOpen,
  document: doc,
  onClose,
  onSuccessToast,
}) => {
  const { isDesktop } = useWindowWidth();

  // Export options state
  const [format, setFormat] = useState<ExportFormat>('pdf');
  const [quality, setQuality] = useState<ExportQuality>('standard');
  const [previewPageIndex, setPreviewPageIndex] = useState<number>(0);

  // Watermark state
  const [watermarkMode, setWatermarkMode] = useState<WatermarkMode>('none');
  const [customText, setCustomText] = useState<string>('CONFIDENTIAL');
  const [purpose, setPurpose] = useState<string>('bank account opening');
  const [color, setColor] = useState<string>('#64748B');
  const [opacity, setOpacity] = useState<number>(0.22);
  const [fontSize, setFontSize] = useState<number>(24);
  const [layout, setLayout] = useState<WatermarkLayout>('tiled');

  // Generation status
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [processStatus, setProcessStatus] = useState<string>('');

  // Live preview canvas ref
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Construct current watermark config
  const watermarkConfig: WatermarkConfig = {
    mode: watermarkMode,
    text: customText,
    purpose,
    color,
    opacity,
    fontSize,
    layout: watermarkMode === 'anticounterfeit' ? 'tiled' : layout,
  };

  // Safe page access
  const activePage: DocumentPage | undefined = doc.pages[previewPageIndex] || doc.pages[0];

  // Render Live Preview
  useEffect(() => {
    if (!isOpen || !activePage) return;

    let isMounted = true;

    async function updatePreview() {
      try {
        const rendered = await renderPageToCanvas(activePage!, quality, watermarkConfig);
        if (!isMounted || !previewCanvasRef.current) return;

        const target = previewCanvasRef.current;
        target.width = rendered.width;
        target.height = rendered.height;
        const ctx = target.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, target.width, target.height);
          ctx.drawImage(rendered, 0, 0);
        }
      } catch (err) {
        console.error('Preview render error:', err);
      }
    }

    updatePreview();

    return () => {
      isMounted = false;
    };
  }, [isOpen, activePage, quality, watermarkMode, customText, purpose, color, opacity, fontSize, layout]);

  if (!isOpen) return null;

  // Handle Export: Share
  const handleShare = async () => {
    try {
      triggerHaptic('medium');
      setIsProcessing(true);
      setProcessStatus(format === 'pdf' ? 'Creating PDF with pdf-lib...' : 'Generating JPG images...');

      let filesToExport: File[] = [];

      if (format === 'pdf') {
        const pdfFile = await generateExportPdfWithPdfLib(doc, quality, watermarkConfig);
        filesToExport = [pdfFile];
      } else {
        filesToExport = await generateExportJpgFiles(doc, quality, watermarkConfig);
      }

      setProcessStatus('Sharing...');
      const result = await shareOrDownloadFiles(filesToExport, doc.name);

      if (result.method === 'shared') {
        onSuccessToast?.(`Shared "${doc.name}"`);
      } else {
        onSuccessToast?.(`Downloaded "${doc.name}"`);
      }

      onClose();
    } catch (err) {
      console.error('Export error:', err);
      alert('Could not complete export. Please try again.');
    } finally {
      setIsProcessing(false);
      setProcessStatus('');
    }
  };

  // Handle Export: Save (Download)
  const handleSave = async () => {
    try {
      triggerHaptic('medium');
      setIsProcessing(true);
      setProcessStatus(format === 'pdf' ? 'Building PDF with pdf-lib...' : 'Exporting JPG images...');

      if (format === 'pdf') {
        const pdfFile = await generateExportPdfWithPdfLib(doc, quality, watermarkConfig);
        downloadFile(pdfFile);
        onSuccessToast?.(`Saved "${pdfFile.name}"`);
      } else {
        const jpgFiles = await generateExportJpgFiles(doc, quality, watermarkConfig);
        jpgFiles.forEach((f) => downloadFile(f));
        onSuccessToast?.(`Saved ${jpgFiles.length} JPG ${jpgFiles.length === 1 ? 'image' : 'images'}`);
      }

      onClose();
    } catch (err) {
      console.error('Export error:', err);
      alert('Could not save file. Please try again.');
    } finally {
      setIsProcessing(false);
      setProcessStatus('');
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
          isDesktop ? 'max-w-4xl max-h-[90vh] rounded-3xl' : 'max-h-[92dvh] rounded-t-[32px]'
        } bg-[#1C1C1E] text-white border border-white/15 shadow-2xl flex flex-col overflow-hidden`}
      >
        {/* Mobile Grab Handle */}
        {!isDesktop && (
          <div className="w-full pt-3 pb-1 flex justify-center shrink-0">
            <div className="w-10 h-1 rounded-full bg-white/20" />
          </div>
        )}

        {/* Modal Header */}
        <header className="px-5 py-3.5 border-b border-white/10 flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-base sm:text-lg font-bold flex items-center gap-2">
              <Download className="w-5 h-5 text-[#5856D6] dark:text-[#7D7AFF]" />
              <span>Export Document</span>
            </h2>
            <p className="text-xs text-gray-400 mt-0.5 truncate max-w-xs sm:max-w-md">
              {doc.name} • {doc.pages.length} {doc.pages.length === 1 ? 'page' : 'pages'}
            </p>
          </div>

          <button
            onClick={() => {
              triggerHaptic('light');
              onClose();
            }}
            className="p-1.5 rounded-full text-gray-400 hover:text-white hover:bg-white/10 ios-press"
          >
            <X className="w-5 h-5" />
          </button>
        </header>

        {/* Modal Body: Two columns on desktop, stacked on mobile */}
        <div className="flex-1 overflow-y-auto ios-scroll flex flex-col md:flex-row divide-y md:divide-y-0 md:divide-x divide-white/10">
          {/* LEFT COLUMN: Live Preview */}
          <div className="md:w-1/2 p-4 sm:p-5 flex flex-col items-center justify-center bg-black/40">
            <div className="w-full flex items-center justify-between mb-2 px-1 text-xs text-gray-400">
              <span className="flex items-center gap-1.5 font-semibold text-gray-300">
                <Eye className="w-3.5 h-3.5 text-[#5856D6]" />
                <span>Live Preview</span>
              </span>

              {/* Page Navigator for multi-page documents */}
              {doc.pages.length > 1 && (
                <div className="flex items-center gap-2 bg-white/10 px-2 py-0.5 rounded-full text-[11px]">
                  <button
                    disabled={previewPageIndex === 0}
                    onClick={() => {
                      triggerHaptic('light');
                      setPreviewPageIndex((p) => Math.max(0, p - 1));
                    }}
                    className="disabled:opacity-30 hover:text-white"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </button>
                  <span>
                    {previewPageIndex + 1} / {doc.pages.length}
                  </span>
                  <button
                    disabled={previewPageIndex === doc.pages.length - 1}
                    onClick={() => {
                      triggerHaptic('light');
                      setPreviewPageIndex((p) => Math.min(doc.pages.length - 1, p + 1));
                    }}
                    className="disabled:opacity-30 hover:text-white"
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>

            {/* Canvas Preview Container */}
            <div className="relative w-full max-h-[280px] sm:max-h-[380px] flex items-center justify-center bg-black/50 rounded-2xl p-2 border border-white/10 overflow-hidden shadow-inner">
              <canvas
                ref={previewCanvasRef}
                className="max-w-full max-h-[260px] sm:max-h-[360px] object-contain rounded-lg shadow-lg border border-white/10"
              />

              {watermarkMode !== 'none' && (
                <div className="absolute bottom-3 left-3 right-3 bg-black/75 backdrop-blur-md px-2.5 py-1 rounded-xl text-[10px] text-gray-300 border border-white/15 flex items-center justify-between">
                  <span className="truncate">
                    Watermark: <strong>{getEffectiveWatermarkText(watermarkConfig)}</strong>
                  </span>
                  <span className="shrink-0 text-amber-400 font-semibold uppercase text-[9px] ml-1">
                    {watermarkMode === 'anticounterfeit' ? 'Protected' : layout}
                  </span>
                </div>
              )}
            </div>

            <div className="mt-2 text-center text-[11px] text-gray-400">
              Format: <span className="text-white font-semibold uppercase">{format}</span> • Quality:{' '}
              <span className="text-white font-semibold">{QUALITY_CONFIG[quality].label}</span>
            </div>
          </div>

          {/* RIGHT COLUMN: Controls */}
          <div className="md:w-1/2 p-4 sm:p-5 space-y-4">
            {/* 1. Format: PDF or JPG */}
            <div>
              <label className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider block mb-1.5">
                Export Format
              </label>
              <div className="grid grid-cols-2 p-1 bg-white/10 rounded-xl gap-1">
                <button
                  onClick={() => {
                    triggerHaptic('light');
                    setFormat('pdf');
                  }}
                  className={`flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-semibold transition-all ios-press ${
                    format === 'pdf'
                      ? 'bg-[#5856D6] text-white shadow-md'
                      : 'text-gray-300 hover:text-white'
                  }`}
                >
                  <FileText className="w-4 h-4" />
                  <span>PDF Document</span>
                </button>

                <button
                  onClick={() => {
                    triggerHaptic('light');
                    setFormat('jpg');
                  }}
                  className={`flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-semibold transition-all ios-press ${
                    format === 'jpg'
                      ? 'bg-[#5856D6] text-white shadow-md'
                      : 'text-gray-300 hover:text-white'
                  }`}
                >
                  <ImageIcon className="w-4 h-4" />
                  <span>JPG Images</span>
                </button>
              </div>
            </div>

            {/* 2. Quality & Size: Small, Standard, HD, 4K */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                  Quality & Size
                </label>
                <span className="text-[11px] text-[#7D7AFF] font-medium">
                  {QUALITY_CONFIG[quality].label}
                </span>
              </div>

              <div className="grid grid-cols-4 gap-1 p-1 bg-white/10 rounded-xl">
                {(['small', 'standard', 'hd', '4k'] as ExportQuality[]).map((q) => {
                  const isSelected = quality === q;
                  return (
                    <button
                      key={q}
                      onClick={() => {
                        triggerHaptic('light');
                        setQuality(q);
                      }}
                      className={`py-2 rounded-lg text-xs font-semibold capitalize transition-all ios-press ${
                        isSelected
                          ? 'bg-[#5856D6] text-white shadow-sm'
                          : 'text-gray-300 hover:text-white'
                      }`}
                    >
                      {q === 'hd' ? 'HD' : q === '4k' ? '4K' : q}
                    </button>
                  );
                })}
              </div>
              <p className="text-[11px] text-gray-400 mt-1 pl-1">
                {QUALITY_CONFIG[quality].description}
              </p>
            </div>

            {/* 3. Watermark Mode: None, Custom, Anti-counterfeit */}
            <div className="pt-2 border-t border-white/10">
              <label className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider block mb-1.5">
                Watermark Protection
              </label>

              <div className="grid grid-cols-3 gap-1 p-1 bg-white/10 rounded-xl mb-2.5">
                <button
                  onClick={() => {
                    triggerHaptic('light');
                    setWatermarkMode('none');
                  }}
                  className={`py-1.5 rounded-lg text-xs font-semibold transition-all ios-press ${
                    watermarkMode === 'none'
                      ? 'bg-white/20 text-white'
                      : 'text-gray-400 hover:text-white'
                  }`}
                >
                  Off
                </button>

                <button
                  onClick={() => {
                    triggerHaptic('light');
                    setWatermarkMode('custom');
                  }}
                  className={`py-1.5 rounded-lg text-xs font-semibold transition-all ios-press flex items-center justify-center gap-1 ${
                    watermarkMode === 'custom'
                      ? 'bg-[#5856D6] text-white shadow-sm'
                      : 'text-gray-300 hover:text-white'
                  }`}
                >
                  <Type className="w-3.5 h-3.5" />
                  <span>Custom</span>
                </button>

                <button
                  onClick={() => {
                    triggerHaptic('light');
                    setWatermarkMode('anticounterfeit');
                    setLayout('tiled');
                  }}
                  className={`py-1.5 rounded-lg text-xs font-semibold transition-all ios-press flex items-center justify-center gap-1 ${
                    watermarkMode === 'anticounterfeit'
                      ? 'bg-amber-600 text-white shadow-sm'
                      : 'text-amber-400 hover:text-white'
                  }`}
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>Anti-Counterfeit</span>
                </button>
              </div>

              {/* Watermark Details depending on mode */}
              {watermarkMode === 'anticounterfeit' && (
                <div className="p-3 bg-amber-500/15 border border-amber-500/30 rounded-2xl space-y-2.5">
                  <div className="flex items-start gap-2 text-xs text-amber-200">
                    <ShieldCheck className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <span>
                      Repeats purpose + today&apos;s date across the page so the copy cannot be reused.
                    </span>
                  </div>

                  <div>
                    <span className="text-[10px] font-semibold text-gray-300 block mb-1">
                      Select or type purpose:
                    </span>
                    <input
                      type="text"
                      value={purpose}
                      onChange={(e) => setPurpose(e.target.value)}
                      placeholder="e.g. bank account opening"
                      className="w-full px-3 py-1.5 bg-black/40 border border-amber-500/40 rounded-xl text-xs text-white placeholder:text-gray-500 focus:outline-none focus:border-amber-400"
                    />

                    {/* Purpose quick presets */}
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {PRESET_PURPOSES.map((p) => (
                        <button
                          key={p}
                          onClick={() => {
                            triggerHaptic('light');
                            setPurpose(p);
                          }}
                          className={`text-[10px] px-2 py-0.5 rounded-lg transition-colors ${
                            purpose === p
                              ? 'bg-amber-500 text-black font-bold'
                              : 'bg-white/10 text-amber-200 hover:bg-white/20'
                          }`}
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="text-[11px] font-mono text-amber-300 bg-black/50 p-2 rounded-lg border border-amber-500/20 truncate">
                    Preview: &quot;For {purpose || 'official verification'} only · {getTodayDateString()}&quot;
                  </div>
                </div>
              )}

              {watermarkMode === 'custom' && (
                <div className="p-3 bg-white/5 border border-white/10 rounded-2xl space-y-2.5">
                  <div>
                    <label className="text-[10px] font-semibold text-gray-400 block mb-1">
                      Watermark text:
                    </label>
                    <input
                      type="text"
                      value={customText}
                      onChange={(e) => setCustomText(e.target.value)}
                      placeholder="Enter watermark text..."
                      className="w-full px-3 py-1.5 bg-black/40 border border-white/20 rounded-xl text-xs text-white placeholder:text-gray-500 focus:outline-none focus:border-[#5856D6]"
                    />

                    {/* Presets */}
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {PRESET_WATERMARK_TEXTS.map((t) => (
                        <button
                          key={t}
                          onClick={() => {
                            triggerHaptic('light');
                            setCustomText(t);
                          }}
                          className={`text-[10px] px-2 py-0.5 rounded-lg transition-colors ${
                            customText === t
                              ? 'bg-[#5856D6] text-white font-bold'
                              : 'bg-white/10 text-gray-300 hover:bg-white/20'
                          }`}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Single or Tiled */}
                  <div className="flex items-center justify-between text-xs pt-1">
                    <span className="text-gray-400">Layout:</span>
                    <div className="flex items-center gap-1 bg-black/30 p-0.5 rounded-lg border border-white/10">
                      <button
                        onClick={() => {
                          triggerHaptic('light');
                          setLayout('single');
                        }}
                        className={`px-2.5 py-1 rounded-md text-[11px] font-semibold ${
                          layout === 'single' ? 'bg-[#5856D6] text-white' : 'text-gray-400'
                        }`}
                      >
                        Single
                      </button>
                      <button
                        onClick={() => {
                          triggerHaptic('light');
                          setLayout('tiled');
                        }}
                        className={`px-2.5 py-1 rounded-md text-[11px] font-semibold ${
                          layout === 'tiled' ? 'bg-[#5856D6] text-white' : 'text-gray-400'
                        }`}
                      >
                        Tiled
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Common watermark color & opacity styling */}
              {watermarkMode !== 'none' && (
                <div className="mt-2.5 space-y-2 bg-white/5 p-3 rounded-2xl border border-white/10">
                  {/* Colors */}
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-semibold text-gray-400 uppercase">Color</span>
                    <div className="flex items-center gap-1.5">
                      {PRESET_COLORS.map((c) => (
                        <button
                          key={c.value}
                          onClick={() => {
                            triggerHaptic('light');
                            setColor(c.value);
                          }}
                          className={`w-5 h-5 rounded-full transition-transform ${
                            color === c.value ? 'scale-125 ring-2 ring-white ring-offset-2 ring-offset-[#1C1C1E]' : ''
                          }`}
                          style={{ backgroundColor: c.value }}
                          title={c.label}
                        />
                      ))}
                    </div>
                  </div>

                  {/* Opacity slider */}
                  <div>
                    <div className="flex items-center justify-between text-[10px] text-gray-400 mb-1">
                      <span>Opacity</span>
                      <span>{Math.round(opacity * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min="0.06"
                      max="0.65"
                      step="0.02"
                      value={opacity}
                      onChange={(e) => setOpacity(parseFloat(e.target.value))}
                      className="w-full accent-[#5856D6]"
                    />
                  </div>

                  {/* Font Size slider */}
                  <div>
                    <div className="flex items-center justify-between text-[10px] text-gray-400 mb-1">
                      <span>Size</span>
                      <span>{fontSize} pt</span>
                    </div>
                    <input
                      type="range"
                      min="14"
                      max="52"
                      step="2"
                      value={fontSize}
                      onChange={(e) => setFontSize(parseInt(e.target.value, 10))}
                      className="w-full accent-[#5856D6]"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Modal Footer / Action Buttons */}
        <footer className="p-4 sm:p-5 border-t border-white/10 bg-[#1C1C1E] flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
          <div className="text-xs text-gray-400 hidden sm:block truncate">
            Exporting as <strong>{format.toUpperCase()}</strong> ({QUALITY_CONFIG[quality].label})
          </div>

          <div className="w-full sm:w-auto flex items-center gap-2">
            {/* Share Button (Web Share API) */}
            <button
              onClick={handleShare}
              disabled={isProcessing}
              className="flex-1 sm:flex-initial py-2.5 px-4 rounded-xl bg-white/10 hover:bg-white/20 text-white font-semibold text-xs sm:text-sm flex items-center justify-center gap-1.5 transition-colors ios-press disabled:opacity-50"
            >
              {isProcessing ? (
                <Loader2 className="w-4 h-4 animate-spin text-[#7D7AFF]" />
              ) : (
                <Share2 className="w-4 h-4" />
              )}
              <span>Share</span>
            </button>

            {/* Save (Download) Button */}
            <button
              onClick={handleSave}
              disabled={isProcessing}
              className="flex-1 sm:flex-initial py-2.5 px-5 rounded-xl bg-[#5856D6] hover:bg-[#6866E6] text-white font-semibold text-xs sm:text-sm shadow-md flex items-center justify-center gap-1.5 transition-all ios-press disabled:opacity-50"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-white" />
                  <span>{processStatus || 'Exporting...'}</span>
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  <span>Save ({format.toUpperCase()})</span>
                </>
              )}
            </button>
          </div>
        </footer>
      </motion.div>
    </div>
  );
};
