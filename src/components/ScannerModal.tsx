import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Camera,
  X,
  Check,
  Image as ImageIcon,
  RotateCcw,
  Trash2,
  SwitchCamera,
  Lock,
  Crop,
  AlertTriangle,
  RefreshCw,
  Sliders,
  Sparkles,
  Zap,
  ZapOff,
  Aperture,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { DocumentPage, DocumentRecord } from '../types/document';
import { triggerHaptic } from '../utils/haptics';
import { saveDocument } from '../db/db';
import { generateDefaultOcrText } from '../utils/ocr';
import {
  Point,
  ScanFilter,
  detectDocumentCorners,
  analyzeScanQuality,
  applyScanFilter,
  warpPerspective,
} from '../utils/imageProcessing';
import { CornerCropEditor } from './CornerCropEditor';
import { runBackgroundOcr } from '../utils/tesseractOcr';

interface ScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDocumentCreated: (doc: DocumentRecord) => void;
  initialVault?: boolean;
}

// iPhone/iPad Safari cannot use the flash (torch) or the full-resolution photo mode from a web page's
// live video. So on iOS the shutter opens the real iPhone Camera (full resolution, flash, focus),
// and the photo comes straight back into the scan.
const IS_IOS =
  typeof navigator !== 'undefined' &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && (navigator as any).maxTouchPoints > 1));
const IS_TOUCH = typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0);

/** Keep camera photos sharp but manageable: longest side up to 4000 px (4K class), JPEG 92%. */
async function fileToScanCanvas(file: Blob): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Could not read the photo'));
      i.src = url;
    });
    const w0 = img.naturalWidth || img.width;
    const h0 = img.naturalHeight || img.height;
    const k = Math.min(1, 4000 / Math.max(w0, h0));
    const c = document.createElement('canvas');
    c.width = Math.round(w0 * k);
    c.height = Math.round(h0 * k);
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return c;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export const ScannerModal: React.FC<ScannerModalProps> = ({
  isOpen,
  onClose,
  onDocumentCreated,
  initialVault = false,
}) => {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [hasCamera, setHasCamera] = useState<boolean>(true);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [capturedPages, setCapturedPages] = useState<DocumentPage[]>([]);
  const [selectedPageIndex, setSelectedPageIndex] = useState<number>(0);
  const [docName, setDocName] = useState<string>('');
  const [category, setCategory] = useState<string>('Notes');
  const [folder, setFolder] = useState<string>('Default');
  const [isVault, setIsVault] = useState<boolean>(initialVault);
  const [isCapturingFlash, setIsCapturingFlash] = useState<boolean>(false);

  // Rescan specific page target
  const [rescanTargetIndex, setRescanTargetIndex] = useState<number | null>(null);

  // Corner crop editor modal
  const [croppingPageIndex, setCroppingPageIndex] = useState<number | null>(null);

  // Filter selection sheet
  const [showFilterPicker, setShowFilterPicker] = useState<boolean>(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const hdCameraInputRef = useRef<HTMLInputElement | null>(null);
  const [torchSupported, setTorchSupported] = useState<boolean>(false);
  const [torchOn, setTorchOn] = useState<boolean>(false);
  const [isProcessingPhoto, setIsProcessingPhoto] = useState<boolean>(false);
  // iPhone/iPad: always use the native camera (HD + flash). Elsewhere: live camera preview.
  const useNativeCamera = IS_IOS;

  const startCamera = useCallback(async () => {
    try {
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
      if (useNativeCamera) {
        setHasCamera(true);
        return;
      }
      const constraints: MediaStreamConstraints = {
        video: {
          facingMode: { ideal: facingMode },
          // Ask for the highest resolution the camera can give (4K class)
          width: { ideal: 4096 },
          height: { ideal: 3072 },
        },
        audio: false,
      };
      const mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
      setStream(mediaStream);
      setHasCamera(true);
      const track = mediaStream.getVideoTracks()[0];
      const caps: any = track?.getCapabilities?.() || {};
      setTorchSupported(!!caps.torch);
      setTorchOn(false);
      try {
        // Continuous autofocus where supported keeps text sharp
        if (caps.focusMode?.includes?.('continuous')) {
          await track.applyConstraints({ advanced: [{ focusMode: 'continuous' } as any] });
        }
      } catch {
        /* optional */
      }
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
      }
    } catch (err) {
      console.warn('Camera not available or permission denied:', err);
      setHasCamera(false);
    }
  }, [facingMode]);

  useEffect(() => {
    if (isOpen) {
      const now = new Date();
      const defaultTitle = `Scan ${now.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
      })} ${now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
      setDocName(defaultTitle);
      setIsVault(initialVault);
      setRescanTargetIndex(null);
      startCamera();
    } else {
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
        setStream(null);
      }
      setCapturedPages([]);
    }
  }, [isOpen, initialVault, startCamera]);

  useEffect(() => {
    return () => {
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
      }
    };
  }, [stream]);

  // Capture frame from video
  const toggleTorch = async () => {
    const track = stream?.getVideoTracks()[0];
    if (!track) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: !torchOn } as any] });
      setTorchOn(!torchOn);
      triggerHaptic('light');
    } catch {
      setTorchSupported(false);
    }
  };

  const capturePhoto = async () => {
    if (useNativeCamera) {
      triggerHaptic('light');
      hdCameraInputRef.current?.click();
      return;
    }
    if (!videoRef.current) return;
    triggerHaptic('medium');
    setIsCapturingFlash(true);
    setTimeout(() => setIsCapturingFlash(false), 120);

    // Prefer a real full-resolution still photo (ImageCapture), not a video frame.
    const track = stream?.getVideoTracks()[0];
    const IC = (window as any).ImageCapture;
    if (track && IC) {
      try {
        const blob: Blob = await new IC(track).takePhoto(torchOn ? { fillLightMode: 'flash' } : {});
        addCanvasAsPage(await fileToScanCanvas(blob));
        return;
      } catch {
        /* fall back to the video frame */
      }
    }

    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    addCanvasAsPage(canvas);
  };

  /** Photo from the native camera (iPhone Camera app / Android camera): full resolution. */
  const handleHdCameraPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setIsProcessingPhoto(true);
    try {
      triggerHaptic('medium');
      addCanvasAsPage(await fileToScanCanvas(file));
    } catch (err) {
      console.warn(err);
    } finally {
      setIsProcessingPhoto(false);
    }
  };

  const addCanvasAsPage = (canvas: HTMLCanvasElement) => {

    // 1. Detect corners
    const detectedCorners = detectDocumentCorners(canvas);

    // 2. Scan check: check quality (blurry, too dark, cut off)
    const quality = analyzeScanQuality(canvas, detectedCorners);

    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);

    const pageIdxToUse = rescanTargetIndex !== null ? rescanTargetIndex : capturedPages.length;

    const newPage: DocumentPage = {
      id: crypto.randomUUID(),
      dataUrl,
      rotation: 0,
      aspectRatio: canvas.width / canvas.height,
      label: `Page ${pageIdxToUse + 1}`,
      ocrText: generateDefaultOcrText(docName || 'Document', category, pageIdxToUse + 1),
      scanWarning: quality.warning,
      corners: detectedCorners,
      filter: 'original',
    };

    if (rescanTargetIndex !== null) {
      // Replace existing flagged page
      setCapturedPages((prev) => {
        const next = [...prev];
        next[rescanTargetIndex] = newPage;
        return next;
      });
      setSelectedPageIndex(rescanTargetIndex);
      setRescanTargetIndex(null);
    } else {
      // Append as new page
      setCapturedPages((prev) => [...prev, newPage]);
      setSelectedPageIndex(capturedPages.length);
    }
  };

  // Import files from device gallery
  const handleFilesChosen = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    Array.from(files).forEach((file, idx) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const result = event.target?.result as string;
        if (result) {
          const img = new Image();
          img.onload = () => {
            const detected = detectDocumentCorners(img);
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const cCtx = canvas.getContext('2d');
            if (cCtx) cCtx.drawImage(img, 0, 0);

            const quality = analyzeScanQuality(canvas, detected);

            const newPage: DocumentPage = {
              id: crypto.randomUUID(),
              dataUrl: result,
              rotation: 0,
              label: file.name.substring(0, 20),
              ocrText: generateDefaultOcrText(
                file.name.replace(/\.[^/.]+$/, ''),
                category,
                idx + 1
              ),
              corners: detected,
              scanWarning: quality.warning,
              filter: 'original',
            };
            setCapturedPages((prev) => [...prev, newPage]);
          };
          img.src = result;
        }
      };
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  };

  const toggleCameraFacing = () => {
    triggerHaptic('light');
    setFacingMode((prev) => (prev === 'environment' ? 'user' : 'environment'));
  };

  const removePage = (index: number) => {
    triggerHaptic('light');
    setCapturedPages((prev) => prev.filter((_, i) => i !== index));
    if (selectedPageIndex >= index && selectedPageIndex > 0) {
      setSelectedPageIndex(selectedPageIndex - 1);
    }
  };

  const rotatePage = (index: number) => {
    triggerHaptic('light');
    setCapturedPages((prev) =>
      prev.map((p, i) => {
        if (i !== index) return p;
        const currentRot = p.rotation || 0;
        return { ...p, rotation: (currentRot + 90) % 360 };
      })
    );
  };

  // Apply Filter to selected page
  const handleApplyFilter = (filter: ScanFilter) => {
    triggerHaptic('light');
    const targetPage = capturedPages[selectedPageIndex];
    if (!targetPage) return;

    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0);
        const filteredCanvas = applyScanFilter(canvas, filter);
        const newUrl = filteredCanvas.toDataURL('image/jpeg', 0.92);

        setCapturedPages((prev) =>
          prev.map((p, i) => (i === selectedPageIndex ? { ...p, dataUrl: newUrl, filter } : p))
        );
      }
    };
    img.src = targetPage.dataUrl;
    setShowFilterPicker(false);
  };

  // Rescan specific page
  const handleTriggerRescan = (pageIndex: number) => {
    triggerHaptic('medium');
    setRescanTargetIndex(pageIndex);
  };

  // Apply corner adjustment and perspective warp
  const handleApplyCrop = (croppedUrl: string, corners: Point[]) => {
    if (croppingPageIndex === null) return;
    setCapturedPages((prev) =>
      prev.map((p, i) =>
        i === croppingPageIndex
          ? {
              ...p,
              dataUrl: croppedUrl,
              corners,
              scanWarning: null, // cleared after manual warp
            }
          : p
      )
    );
    setCroppingPageIndex(null);
  };

  // Save document and initiate background OCR
  const handleSave = async () => {
    if (capturedPages.length === 0) return;
    triggerHaptic('success');

    const newDoc: DocumentRecord = {
      docId: crypto.randomUUID(),
      name: docName.trim() || 'Untitled Document',
      folder: folder || 'Default',
      category: category || 'Notes',
      expiry: null,
      vault: isVault,
      created: Date.now(),
      lastChanged: Date.now(),
      pages: capturedPages,
    };

    await saveDocument(newDoc);
    onDocumentCreated(newDoc);
    onClose();

    // Trigger on-device background OCR with Tesseract.js (eng+hin) and smart naming
    runBackgroundOcr(newDoc.docId, (updated) => {
      onDocumentCreated(updated);
    });
  };

  if (!isOpen) return null;

  const activePage: DocumentPage | undefined = capturedPages[selectedPageIndex];

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black text-white select-none">
      {/* Flash overlay on shutter */}
      <AnimatePresence>
        {isCapturingFlash && (
          <motion.div
            initial={{ opacity: 0.9 }}
            animate={{ opacity: 0 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-white z-50 pointer-events-none"
          />
        )}
      </AnimatePresence>

      {/* Top Controls Bar with safe area padding */}
      <div className="pt-safe px-4 pb-3 flex items-center justify-between z-20 bg-black/60 backdrop-blur-md border-b border-white/10">
        <button
          onClick={() => {
            triggerHaptic('light');
            onClose();
          }}
          className="ios-press flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/15 text-sm font-medium hover:bg-white/25 text-white"
        >
          <X className="w-4 h-4" />
          <span>Cancel</span>
        </button>

        <div className="flex items-center gap-2">
          {!useNativeCamera && torchSupported && (
            <button
              onClick={toggleTorch}
              className={`p-2 rounded-full ios-press ${torchOn ? 'bg-yellow-400 text-black' : 'bg-white/15 hover:bg-white/25 text-white'}`}
              title={torchOn ? 'Flash off' : 'Flash on'}
              aria-label="Flash"
            >
              {torchOn ? <Zap className="w-4 h-4" /> : <ZapOff className="w-4 h-4" />}
            </button>
          )}
          {!useNativeCamera && IS_TOUCH && (
            <button
              onClick={() => hdCameraInputRef.current?.click()}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-full bg-white/15 hover:bg-white/25 text-white text-xs font-semibold ios-press"
              title="Open the phone's own camera (full resolution and flash)"
            >
              <Aperture className="w-3.5 h-3.5" />
              <span>HD</span>
            </button>
          )}
          {hasCamera && !useNativeCamera && (
            <button
              onClick={toggleCameraFacing}
              className="p-2 rounded-full bg-white/15 hover:bg-white/25 text-white ios-press"
              title="Switch camera"
            >
              <SwitchCamera className="w-4 h-4" />
            </button>
          )}

          <button
            onClick={() => {
              triggerHaptic('light');
              setIsVault(!isVault);
            }}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold ios-press transition-colors ${
              isVault
                ? 'bg-amber-500/90 text-white shadow-sm'
                : 'bg-white/15 text-white/80 hover:bg-white/25'
            }`}
          >
            <Lock className="w-3.5 h-3.5" />
            <span>Vault</span>
          </button>
        </div>

        <button
          onClick={handleSave}
          disabled={capturedPages.length === 0}
          className={`ios-press flex items-center gap-1.5 px-4 py-1.5 rounded-full font-semibold text-sm transition-all ${
            capturedPages.length > 0
              ? 'bg-[#5856D6] text-white shadow-md hover:bg-[#6866E6]'
              : 'bg-white/10 text-white/30 cursor-not-allowed'
          }`}
        >
          <Check className="w-4 h-4" />
          <span>Save ({capturedPages.length})</span>
        </button>
      </div>

      {/* Rescan target banner indicator */}
      {rescanTargetIndex !== null && (
        <div className="px-4 py-1.5 bg-amber-500 text-black text-xs font-bold flex items-center justify-between z-20">
          <span>Rescanning Page {rescanTargetIndex + 1}. Capture next photo to replace.</span>
          <button
            onClick={() => setRescanTargetIndex(null)}
            className="text-black/80 hover:text-black uppercase text-[10px]"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Document Name & Details bar */}
      <div className="px-4 py-2 bg-black/70 flex items-center gap-3 border-b border-white/10 overflow-x-auto text-xs z-10">
        <input
          type="text"
          value={docName}
          onChange={(e) => setDocName(e.target.value)}
          placeholder="Document name (smart named from scan)..."
          className="bg-white/10 text-white px-3 py-1.5 rounded-lg border border-white/15 text-sm flex-1 min-w-[140px] focus:outline-none focus:border-[#5856D6]"
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="bg-white/10 text-white px-2.5 py-1.5 rounded-lg border border-white/15 text-xs focus:outline-none"
        >
          <option value="Notes" className="bg-[#1C1C1E] text-white">Notes</option>
          <option value="Receipts" className="bg-[#1C1C1E] text-white">Receipts</option>
          <option value="Invoices" className="bg-[#1C1C1E] text-white">Invoices</option>
          <option value="Contracts" className="bg-[#1C1C1E] text-white">Contracts</option>
          <option value="ID & Cards" className="bg-[#1C1C1E] text-white">ID & Cards</option>
          <option value="Other" className="bg-[#1C1C1E] text-white">Other</option>
        </select>
      </div>

      {/* Main Viewport: Live Camera Feed or Active Page Preview */}
      <div className="relative flex-1 flex items-center justify-center bg-[#07070A] overflow-hidden">
        {useNativeCamera ? (
          capturedPages.length > 0 && capturedPages[selectedPageIndex] ? (
            <img
              src={capturedPages[selectedPageIndex].dataUrl}
              alt={`Page ${selectedPageIndex + 1}`}
              style={{ transform: `rotate(${capturedPages[selectedPageIndex].rotation || 0}deg)` }}
              className="max-w-full max-h-full object-contain p-4 pb-28"
            />
          ) : (
            <div className="flex flex-col items-center justify-center p-6 text-center max-w-sm">
              <button
                onClick={() => hdCameraInputRef.current?.click()}
                className="ios-press w-24 h-24 rounded-full bg-[#5856D6] text-white flex items-center justify-center shadow-2xl mb-5"
                aria-label="Open camera"
              >
                <Camera className="w-11 h-11" />
              </button>
              <h3 className="text-lg font-semibold mb-1">Scan with the iPhone camera</h3>
              <p className="text-sm text-gray-400">
                Full HD resolution with flash and focus. Tap the flash icon in the camera to turn it on. After each photo you come back here to add the next page.
              </p>
            </div>
          )
        ) : hasCamera ? (
          <div className="relative w-full h-full flex items-center justify-center">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
            />

            {/* Viewfinder Reticle */}
            <div className="absolute inset-8 sm:inset-16 pointer-events-none flex items-center justify-center">
              <div className="relative w-full h-full max-w-lg max-h-[80vh] border-2 border-white/20 rounded-2xl shadow-2xl flex flex-col justify-between p-3">
                <div className="absolute -top-1 -left-1 w-8 h-8 border-t-4 border-l-4 border-white rounded-tl-lg" />
                <div className="absolute -top-1 -right-1 w-8 h-8 border-t-4 border-r-4 border-white rounded-tr-lg" />
                <div className="absolute -bottom-1 -left-1 w-8 h-8 border-b-4 border-l-4 border-white rounded-bl-lg" />
                <div className="absolute -bottom-1 -right-1 w-8 h-8 border-b-4 border-r-4 border-white rounded-br-lg" />

                <div className="text-center mt-2">
                  <span className="px-3 py-1 bg-black/60 backdrop-blur-md rounded-full text-[11px] font-medium tracking-wide text-white/90 uppercase border border-white/10">
                    Auto edge detection active
                  </span>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center p-6 text-center max-w-sm">
            <div className="w-16 h-16 rounded-2xl bg-white/10 flex items-center justify-center text-white/80 mb-4">
              <Camera className="w-8 h-8" />
            </div>
            <h3 className="text-lg font-semibold mb-1">Webcam Not Available</h3>
            <p className="text-sm text-gray-400 mb-6">
              You can import photos, screenshots, or PDF files from your device.
            </p>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="ios-press flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#5856D6] text-white font-medium shadow-lg hover:bg-[#6866E6]"
            >
              <ImageIcon className="w-4 h-4" />
              <span>Import Photos or PDFs</span>
            </button>
          </div>
        )}

        {/* Selected Page Quality Warning & Tools Overlay */}
        {activePage && (
          <div className="absolute top-3 inset-x-4 flex items-center justify-between z-20 pointer-events-auto">
            {/* Scan Check Warning Badge */}
            {activePage.scanWarning ? (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-amber-500/90 text-black shadow-lg backdrop-blur-md text-xs font-bold animate-in fade-in">
                <AlertTriangle className="w-4 h-4" />
                <span>
                  {activePage.scanWarning === 'blurry' && 'Page looks Blurry'}
                  {activePage.scanWarning === 'too_dark' && 'Page is Too Dark'}
                  {activePage.scanWarning === 'cut_off' && 'Edges Cut-off'}
                </span>
                <button
                  onClick={() => handleTriggerRescan(selectedPageIndex)}
                  className="ml-2 underline hover:text-black/80 flex items-center gap-1 font-extrabold text-[11px]"
                >
                  <RefreshCw className="w-3 h-3" />
                  <span>Rescan</span>
                </button>
              </div>
            ) : (
              <div />
            )}

            {/* Page Actions: Crop, Filter, Rotate */}
            <div className="flex items-center gap-1.5 bg-black/60 backdrop-blur-md rounded-2xl p-1 border border-white/15">
              <button
                onClick={() => setCroppingPageIndex(selectedPageIndex)}
                className="p-2 rounded-xl text-white/90 hover:text-white hover:bg-white/20 ios-press"
                title="Adjust corners & perspective crop"
              >
                <Crop className="w-4 h-4" />
              </button>

              <button
                onClick={() => setShowFilterPicker(!showFilterPicker)}
                className="p-2 rounded-xl text-white/90 hover:text-white hover:bg-white/20 ios-press"
                title="Scan filters (Clean B&W, Grayscale, Color)"
              >
                <Sliders className="w-4 h-4" />
              </button>

              <button
                onClick={() => rotatePage(selectedPageIndex)}
                className="p-2 rounded-xl text-white/90 hover:text-white hover:bg-white/20 ios-press"
                title="Rotate 90°"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Filter Picker Dropdown */}
        <AnimatePresence>
          {showFilterPicker && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="absolute top-16 right-4 z-30 bg-[#1C1C1E]/95 backdrop-blur-xl rounded-2xl p-2 border border-white/15 shadow-2xl flex flex-col gap-1 text-xs"
            >
              <button
                onClick={() => handleApplyFilter('original')}
                className="px-3 py-1.5 rounded-lg text-left hover:bg-white/15"
              >
                Original Photo
              </button>
              <button
                onClick={() => handleApplyFilter('clean')}
                className="px-3 py-1.5 rounded-lg text-left hover:bg-[#5856D6] font-semibold text-white flex items-center gap-1.5"
              >
                <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                <span>Clean Scan (B&W)</span>
              </button>
              <button
                onClick={() => handleApplyFilter('grayscale')}
                className="px-3 py-1.5 rounded-lg text-left hover:bg-white/15"
              >
                Grayscale
              </button>
              <button
                onClick={() => handleApplyFilter('enhanced')}
                className="px-3 py-1.5 rounded-lg text-left hover:bg-white/15"
              >
                Enhanced Color
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {isProcessingPhoto && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/50 text-white text-sm font-semibold">
            Adding HD page…
          </div>
        )}

        {/* Multi-Page Strip Carousel Overlay */}
        {capturedPages.length > 0 && (
          <div className="absolute bottom-4 left-4 right-4 z-20 flex items-center gap-2 overflow-x-auto no-scrollbar p-2 bg-black/60 backdrop-blur-lg rounded-2xl border border-white/15">
            {capturedPages.map((page, idx) => (
              <div
                key={page.id}
                onClick={() => setSelectedPageIndex(idx)}
                className={`relative shrink-0 w-16 h-20 rounded-lg overflow-hidden border-2 cursor-pointer transition-all ${
                  selectedPageIndex === idx
                    ? 'border-[#5856D6] scale-105 shadow-md'
                    : 'border-white/20 opacity-80'
                }`}
              >
                <img
                  src={page.dataUrl}
                  alt={`Page ${idx + 1}`}
                  style={{ transform: `rotate(${page.rotation || 0}deg)` }}
                  className="w-full h-full object-cover transition-transform"
                />

                {page.scanWarning && (
                  <span className="absolute top-0.5 right-0.5 w-3 h-3 bg-amber-500 rounded-full border border-black" />
                )}

                <span className="absolute bottom-0.5 right-0.5 bg-black/75 px-1 rounded text-[10px] text-white font-mono">
                  {idx + 1}
                </span>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removePage(idx);
                  }}
                  className="absolute top-0.5 left-0.5 p-1 bg-red-600/80 rounded text-white hover:bg-red-700"
                  title="Delete page"
                >
                  <Trash2 className="w-2.5 h-2.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Bottom Shutter & Controls with Safe Area Padding */}
      <div className="pb-safe pt-4 px-6 bg-black/80 backdrop-blur-md border-t border-white/10 flex items-center justify-around z-20">
        {/* Gallery / File Picker */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,application/pdf"
          multiple
          onChange={handleFilesChosen}
          className="hidden"
        />
        <input
          ref={hdCameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleHdCameraPhoto}
          className="hidden"
        />
        <button
          onClick={() => {
            triggerHaptic('light');
            fileInputRef.current?.click();
          }}
          className="ios-press flex flex-col items-center gap-1 text-white/80 hover:text-white"
        >
          <div className="w-11 h-11 rounded-full bg-white/15 flex items-center justify-center hover:bg-white/25">
            <ImageIcon className="w-5 h-5" />
          </div>
          <span className="text-[11px] font-medium">Gallery</span>
        </button>

        {/* Shutter Button */}
        {hasCamera ? (
          <button
            onClick={capturePhoto}
            className="ios-press relative w-18 h-18 rounded-full border-4 border-white flex items-center justify-center active:scale-95 transition-transform"
            aria-label="Capture photo"
          >
            <div className="w-14 h-14 rounded-full bg-white hover:bg-gray-100 transition-colors" />
          </button>
        ) : (
          <div className="w-18" />
        )}

        {/* Multi-page counter indicator */}
        <div className="w-11 flex flex-col items-center gap-0.5">
          <div className="text-xs font-semibold text-white/90">
            {capturedPages.length} {capturedPages.length === 1 ? 'page' : 'pages'}
          </div>
          <span className="text-[10px] text-gray-400">in scan</span>
        </div>
      </div>

      {/* Interactive Corner Crop & Perspective Correction Modal */}
      {croppingPageIndex !== null && capturedPages[croppingPageIndex] && (
        <CornerCropEditor
          imageDataUrl={capturedPages[croppingPageIndex].dataUrl}
          onApply={handleApplyCrop}
          onCancel={() => setCroppingPageIndex(null)}
        />
      )}
    </div>
  );
};
