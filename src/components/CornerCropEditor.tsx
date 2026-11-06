import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Check, X, Sparkles, Maximize2, Crop } from 'lucide-react';
import { Point, detectDocumentCorners, defaultCorners, warpPerspective } from '../utils/imageProcessing';
import { triggerHaptic } from '../utils/haptics';

interface CornerCropEditorProps {
  imageDataUrl: string;
  onApply: (croppedDataUrl: string, corners: Point[]) => void;
  onCancel: () => void;
}

export const CornerCropEditor: React.FC<CornerCropEditorProps> = ({
  imageDataUrl,
  onApply,
  onCancel,
}) => {
  const [corners, setCorners] = useState<Point[]>(defaultCorners());
  const [activeCornerIdx, setActiveCornerIdx] = useState<number | null>(null);
  const [imageLoaded, setImageLoaded] = useState<boolean>(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);

  // Auto detect corners when image loads
  const handleImageLoad = () => {
    if (imageRef.current) {
      const detected = detectDocumentCorners(imageRef.current);
      setCorners(detected);
      setImageLoaded(true);
    }
  };

  const handleResetCorners = () => {
    triggerHaptic('light');
    setCorners([
      { x: 0.04, y: 0.04 },
      { x: 0.96, y: 0.04 },
      { x: 0.96, y: 0.96 },
      { x: 0.04, y: 0.96 },
    ]);
  };

  const handleAutoDetect = () => {
    if (imageRef.current) {
      triggerHaptic('light');
      const detected = detectDocumentCorners(imageRef.current);
      setCorners(detected);
    }
  };

  // Convert client coordinates to normalized image coords [0..1]
  const clientToNormalized = useCallback((clientX: number, clientY: number): Point => {
    if (!imageRef.current) return { x: 0.5, y: 0.5 };
    const rect = imageRef.current.getBoundingClientRect();
    const nx = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const ny = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    return { x: nx, y: ny };
  }, []);

  const handlePointerDown = (idx: number, e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    triggerHaptic('light');
    setActiveCornerIdx(idx);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (activeCornerIdx === null) return;
    const pt = clientToNormalized(e.clientX, e.clientY);
    setCorners((prev) => {
      const next = [...prev];
      next[activeCornerIdx] = pt;
      return next;
    });
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (activeCornerIdx !== null) {
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {}
      setActiveCornerIdx(null);
    }
  };

  const handleApply = () => {
    if (!imageRef.current) return;
    triggerHaptic('success');
    const warped = warpPerspective(imageRef.current, corners);
    const croppedUrl = warped.toDataURL('image/jpeg', 0.92);
    onApply(croppedUrl, corners);
  };

  // SVG polygon points string in percentage
  const polygonPoints = corners
    .map((c) => `${c.x * 100}%,${c.y * 100}%`)
    .join(' ');

  const cornerLabels = ['TL', 'TR', 'BR', 'BL'];

  return (
    <div
      ref={containerRef}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      className="fixed inset-0 z-50 bg-black flex flex-col select-none text-white overflow-hidden"
    >
      {/* Top Bar with Safe Area */}
      <div className="pt-safe px-4 pb-3 flex items-center justify-between z-20 bg-black/70 backdrop-blur-md border-b border-white/10">
        <button
          onClick={() => {
            triggerHaptic('light');
            onCancel();
          }}
          className="ios-press flex items-center gap-1 px-3 py-1.5 rounded-full bg-white/15 text-sm font-medium text-white"
        >
          <X className="w-4 h-4" />
          <span>Cancel</span>
        </button>

        <span className="text-sm font-semibold flex items-center gap-1.5">
          <Crop className="w-4 h-4 text-[#5856D6]" />
          <span>Adjust Document Corners</span>
        </span>

        <button
          onClick={handleApply}
          className="ios-press flex items-center gap-1 px-4 py-1.5 rounded-full bg-[#5856D6] hover:bg-[#6866E6] text-sm font-semibold text-white shadow-md"
        >
          <Check className="w-4 h-4" />
          <span>Done</span>
        </button>
      </div>

      {/* Center Image Container with Corner Handles */}
      <div className="relative flex-1 flex items-center justify-center p-4 bg-[#07070A] overflow-hidden">
        <div className="relative max-w-full max-h-full flex items-center justify-center">
          <img
            ref={imageRef}
            src={imageDataUrl}
            alt="Scan crop preview"
            onLoad={handleImageLoad}
            className="max-h-[calc(100vh-170px)] max-w-[calc(100vw-32px)] object-contain shadow-2xl rounded"
          />

          {imageLoaded && (
            <svg
              className="absolute inset-0 w-full h-full pointer-events-none"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
            >
              {/* Semi-transparent mask outside crop area */}
              <polygon
                points={polygonPoints}
                fill="rgba(88, 86, 214, 0.22)"
                stroke="#5856D6"
                strokeWidth="0.8"
                strokeDasharray="2,1"
              />
            </svg>
          )}

          {/* Interactive 4-corner handles */}
          {imageLoaded &&
            corners.map((corner, idx) => (
              <div
                key={idx}
                onPointerDown={(e) => handlePointerDown(idx, e)}
                style={{
                  left: `${corner.x * 100}%`,
                  top: `${corner.y * 100}%`,
                }}
                className="absolute -translate-x-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center cursor-move touch-none z-30"
              >
                {/* Loupe magnifier when dragging */}
                {activeCornerIdx === idx && (
                  <div className="absolute -top-16 left-1/2 -translate-x-1/2 w-14 h-14 rounded-full border-2 border-white shadow-2xl bg-black/90 flex items-center justify-center pointer-events-none animate-in zoom-in-75">
                    <span className="text-[11px] font-bold text-[#5856D6]">
                      {cornerLabels[idx]}
                    </span>
                  </div>
                )}

                {/* Corner Handle Circle */}
                <div className="w-6 h-6 rounded-full border-2 border-white bg-[#5856D6] shadow-lg flex items-center justify-center hover:scale-125 transition-transform" />
              </div>
            ))}
        </div>
      </div>

      {/* Bottom Actions Bar */}
      <div className="pb-safe pt-3 px-6 bg-black/80 backdrop-blur-md border-t border-white/10 flex items-center justify-between text-xs z-20">
        <button
          onClick={handleAutoDetect}
          className="ios-press flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/15 hover:bg-white/25 text-white font-medium"
        >
          <Sparkles className="w-4 h-4 text-amber-400" />
          <span>Auto Detect</span>
        </button>

        <span className="text-[11px] text-gray-400 hidden sm:inline">
          Drag corners to match paper edges
        </span>

        <button
          onClick={handleResetCorners}
          className="ios-press flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/15 hover:bg-white/25 text-white font-medium"
        >
          <Maximize2 className="w-4 h-4" />
          <span>Full Image</span>
        </button>
      </div>
    </div>
  );
};
