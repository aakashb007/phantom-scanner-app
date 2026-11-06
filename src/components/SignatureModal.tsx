import React, { useState, useRef, useEffect } from 'react';
import { PenTool, Check, X, RotateCcw, Move, Sliders } from 'lucide-react';
import { triggerHaptic } from '../utils/haptics';
import { getSavedSignatures, addSignature, trimCanvas } from '../utils/signatures';

interface SignatureModalProps {
  isOpen: boolean;
  pageDataUrl: string;
  onApply: (newDataUrl: string) => void;
  onClose: () => void;
}

export type SignatureColor = 'original' | 'black' | 'blue' | 'red' | 'green';

export const SignatureModal: React.FC<SignatureModalProps> = ({
  isOpen,
  pageDataUrl,
  onApply,
  onClose,
}) => {
  // Step: 'draw' | 'place'
  const [step, setStep] = useState<'draw' | 'place'>('draw');
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);
  const [selectedColor, setSelectedColor] = useState<SignatureColor>('black');

  // Placement state
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: 50, y: 70 }); // % coordinates
  const [scale, setScale] = useState<number>(1);
  const [isDragging, setIsDragging] = useState<boolean>(false);

  const drawCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const pageContainerRef = useRef<HTMLDivElement | null>(null);
  const isDrawingRef = useRef<boolean>(false);

  const [savedSigs, setSavedSigs] = useState<string[]>([]);

  useEffect(() => {
    if (isOpen) {
      getSavedSignatures().then(setSavedSigs);
      setStep('draw');
      setSignatureDataUrl(null);
      setPos({ x: 50, y: 70 });
      setScale(1);
    }
  }, [isOpen]);

  // Canvas drawing functions
  const startDrawing = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const canvas = drawCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    isDrawingRef.current = true;
    canvas.setPointerCapture?.(e.pointerId);
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) * canvas.width) / rect.width;
    const y = ((e.clientY - rect.top) * canvas.height) / rect.height;

    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.strokeStyle = getColorHex(selectedColor);
    ctx.lineWidth = 3.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  };

  const draw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current) return;
    const canvas = drawCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) * canvas.width) / rect.width;
    const y = ((e.clientY - rect.top) * canvas.height) / rect.height;
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const stopDrawing = () => {
    isDrawingRef.current = false;
  };

  const clearCanvas = () => {
    triggerHaptic('light');
    const canvas = drawCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  };

  function getColorHex(c: SignatureColor): string {
    switch (c) {
      case 'blue':
        return '#0047AB';
      case 'red':
        return '#C41E3A';
      case 'green':
        return '#008000';
      case 'black':
      default:
        return '#000000';
    }
  }

  // Recolor transparent signature image
  const recolorSignature = (dataUrl: string, color: SignatureColor): Promise<string> => {
    return new Promise((resolve) => {
      if (color === 'original') return resolve(dataUrl);
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        const ctx = c.getContext('2d');
        if (!ctx) return resolve(dataUrl);

        ctx.drawImage(img, 0, 0);
        ctx.globalCompositeOperation = 'source-in';
        ctx.fillStyle = getColorHex(color);
        ctx.fillRect(0, 0, c.width, c.height);
        resolve(c.toDataURL('image/png'));
      };
      img.src = dataUrl;
    });
  };

  const handleDoneDrawing = () => {
    const canvas = drawCanvasRef.current;
    if (!canvas) return;
    triggerHaptic('light');
    const trimmed = trimCanvas(canvas);
    if (!trimmed) return;
    const dataUrl = trimmed.toDataURL('image/png');
    addSignature(dataUrl); // remember it for next time
    setSignatureDataUrl(dataUrl);
    setStep('place');
  };

  // Drag signature on page
  const handlePointerDownSig = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMovePage = (e: React.PointerEvent) => {
    if (!isDragging || !pageContainerRef.current) return;
    const rect = pageContainerRef.current.getBoundingClientRect();
    const nx = Math.max(10, Math.min(90, ((e.clientX - rect.left) / rect.width) * 100));
    const ny = Math.max(10, Math.min(90, ((e.clientY - rect.top) / rect.height) * 100));
    setPos({ x: nx, y: ny });
  };

  const handlePointerUpPage = (e: React.PointerEvent) => {
    if (isDragging) {
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {}
      setIsDragging(false);
    }
  };

  // Stamp signature onto background page
  const handleApplySignature = async () => {
    if (!signatureDataUrl) return;
    triggerHaptic('success');

    const coloredSigUrl = await recolorSignature(signatureDataUrl, selectedColor);

    const baseImg = new Image();
    baseImg.crossOrigin = 'anonymous';
    await new Promise((res) => {
      baseImg.onload = res;
      baseImg.src = pageDataUrl;
    });

    const sigImg = new Image();
    sigImg.crossOrigin = 'anonymous';
    await new Promise((res) => {
      sigImg.onload = res;
      sigImg.src = coloredSigUrl;
    });

    const canvas = document.createElement('canvas');
    canvas.width = baseImg.naturalWidth || baseImg.width;
    canvas.height = baseImg.naturalHeight || baseImg.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(baseImg, 0, 0);

    // Calculate position in real pixels
    const sigTargetW = canvas.width * 0.32 * scale;
    const sigTargetH = (sigImg.naturalHeight / sigImg.naturalWidth) * sigTargetW;
    const destX = (pos.x / 100) * canvas.width - sigTargetW / 2;
    const destY = (pos.y / 100) * canvas.height - sigTargetH / 2;

    ctx.drawImage(sigImg, destX, destY, sigTargetW, sigTargetH);

    const stamped = canvas.toDataURL('image/jpeg', 0.94);
    onApply(stamped);
    onClose();
  };

  if (!isOpen) return null;

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
          <span>Cancel</span>
        </button>

        <span className="text-sm font-semibold flex items-center gap-1.5">
          <PenTool className="w-4 h-4 text-[#5856D6]" />
          <span>{step === 'draw' ? 'Draw Signature' : 'Position Signature'}</span>
        </span>

        {step === 'draw' ? (
          <button
            onClick={handleDoneDrawing}
            className="ios-press flex items-center gap-1 px-4 py-1.5 rounded-full bg-[#5856D6] hover:bg-[#6866E6] text-sm font-semibold text-white shadow-md"
          >
            <span>Next</span>
          </button>
        ) : (
          <button
            onClick={handleApplySignature}
            className="ios-press flex items-center gap-1 px-4 py-1.5 rounded-full bg-[#5856D6] hover:bg-[#6866E6] text-sm font-semibold text-white shadow-md"
          >
            <Check className="w-4 h-4" />
            <span>Apply</span>
          </button>
        )}
      </div>

      {/* Step 1: Draw Signature Canvas */}
      {step === 'draw' && (
        <div className="flex-1 flex flex-col items-center justify-center p-6 bg-[#0B0B10]">
          {savedSigs.length > 0 && (
            <div className="w-full max-w-lg mb-4">
              <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider block mb-2">
                Saved signatures
              </span>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {savedSigs.map((sig, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      triggerHaptic('light');
                      setSignatureDataUrl(sig);
                      setStep('place');
                    }}
                    className="shrink-0 h-16 w-32 bg-white rounded-xl p-1.5 ios-press flex items-center justify-center"
                  >
                    <img src={sig} alt={`Saved signature ${i + 1}`} className="max-h-full max-w-full object-contain" />
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="w-full max-w-lg bg-white rounded-3xl p-4 shadow-2xl relative">
            <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider block mb-2 text-center">
              Sign inside the box below
            </span>
            <canvas
              ref={drawCanvasRef}
              width={480}
              height={220}
              onPointerDown={startDrawing}
              onPointerMove={draw}
              onPointerUp={stopDrawing}
              className="w-full h-52 border-2 border-dashed border-gray-300 rounded-2xl touch-none bg-white cursor-crosshair"
            />
            <div className="mt-3 flex items-center justify-between">
              <button
                onClick={clearCanvas}
                className="text-xs text-red-500 font-semibold flex items-center gap-1 hover:underline"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Clear</span>
              </button>
              <span className="text-[11px] text-gray-400">Finger or stylus</span>
            </div>
          </div>
        </div>
      )}

      {/* Step 2: Place & Scale Signature on Page */}
      {step === 'place' && (
        <div
          ref={pageContainerRef}
          onPointerMove={handlePointerMovePage}
          onPointerUp={handlePointerUpPage}
          className="relative flex-1 flex items-center justify-center p-4 bg-[#07070A] overflow-hidden"
        >
          <div className="relative max-w-full max-h-full flex items-center justify-center">
            <img
              src={pageDataUrl}
              alt="Page to sign"
              className="max-h-[calc(100vh-220px)] max-w-[calc(100vw-32px)] object-contain shadow-2xl rounded"
            />

            {/* Draggable Signature Overlay */}
            {signatureDataUrl && (
              <div
                style={{
                  left: `${pos.x}%`,
                  top: `${pos.y}%`,
                  transform: `translate(-50%, -50%) scale(${scale})`,
                }}
                onPointerDown={handlePointerDownSig}
                className="absolute cursor-move border-2 border-dashed border-[#5856D6] bg-[#5856D6]/10 p-2 rounded-xl shadow-xl flex items-center justify-center touch-none group"
              >
                <img
                  src={signatureDataUrl}
                  alt="Signature"
                  style={{
                    filter:
                      selectedColor === 'blue'
                        ? 'invert(18%) sepia(99%) saturate(4000%) hue-rotate(210deg)'
                        : selectedColor === 'red'
                        ? 'invert(15%) sepia(90%) saturate(6000%) hue-rotate(350deg)'
                        : selectedColor === 'green'
                        ? 'invert(25%) sepia(80%) saturate(3000%) hue-rotate(100deg)'
                        : 'none',
                  }}
                  className="w-36 pointer-events-none select-none"
                />
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-[#5856D6] text-white text-[9px] px-1.5 py-0.2 rounded-full font-bold">
                  Drag to Move
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Bottom Controls Bar: Ink Color & Resize Slider */}
      <div className="pb-safe pt-3 px-6 bg-black/80 backdrop-blur-md border-t border-white/10 flex flex-wrap items-center justify-between gap-4 text-xs z-20">
        {/* Colors: Original, Black, Blue, Red, Green */}
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-gray-400 mr-1">Ink:</span>
          {(['black', 'blue', 'red', 'green', 'original'] as SignatureColor[]).map((c) => (
            <button
              key={c}
              onClick={() => {
                triggerHaptic('light');
                setSelectedColor(c);
              }}
              className={`w-7 h-7 rounded-full border-2 transition-transform ios-press ${
                selectedColor === c ? 'scale-125 border-white shadow-md' : 'border-transparent'
              }`}
              style={{
                backgroundColor:
                  c === 'black'
                    ? '#000000'
                    : c === 'blue'
                    ? '#0047AB'
                    : c === 'red'
                    ? '#C41E3A'
                    : c === 'green'
                    ? '#008000'
                    : '#8E8E93',
              }}
              title={c}
            />
          ))}
        </div>

        {/* Resize slider (in place mode) */}
        {step === 'place' && (
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-gray-400">Size:</span>
            <input
              type="range"
              min="0.5"
              max="2.2"
              step="0.1"
              value={scale}
              onChange={(e) => setScale(parseFloat(e.target.value))}
              className="w-28 accent-[#5856D6]"
            />
          </div>
        )}

        {step === 'place' && (
          <button
            onClick={() => setStep('draw')}
            className="text-xs text-[#5856D6] hover:underline flex items-center gap-1"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Redraw</span>
          </button>
        )}
      </div>
    </div>
  );
};
