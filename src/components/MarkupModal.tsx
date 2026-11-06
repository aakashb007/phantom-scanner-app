import React, { useState, useRef, useEffect } from 'react';
import { Pen, Highlighter, Type, Undo, Check, X, Palette } from 'lucide-react';
import { triggerHaptic } from '../utils/haptics';

interface MarkupModalProps {
  isOpen: boolean;
  pageDataUrl: string;
  onApply: (newDataUrl: string) => void;
  onClose: () => void;
}

type ToolType = 'pen' | 'highlighter' | 'text';

interface TextElement {
  id: string;
  text: string;
  x: number;
  y: number;
  color: string;
  size: number;
}

export const MarkupModal: React.FC<MarkupModalProps> = ({
  isOpen,
  pageDataUrl,
  onApply,
  onClose,
}) => {
  const [activeTool, setActiveTool] = useState<ToolType>('pen');
  const [selectedColor, setSelectedColor] = useState<string>('#FFCC00'); // Highlighter yellow
  const [strokeSize, setStrokeSize] = useState<number>(4);

  // Typed text elements
  const [textElements, setTextElements] = useState<TextElement[]>([]);
  const [activeTextId, setActiveTextId] = useState<string | null>(null);

  // Undo history stack
  const [history, setHistory] = useState<ImageData[]>([]);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDrawingRef = useRef<boolean>(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);

  // Initialize canvas with page image
  useEffect(() => {
    if (!isOpen) return;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0);
        setHistory([ctx.getImageData(0, 0, canvas.width, canvas.height)]);
      }
    };
    img.src = pageDataUrl;
    setTextElements([]);
    setActiveTextId(null);
  }, [isOpen, pageDataUrl]);

  const saveHistoryStep = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    setHistory((prev) => [...prev.slice(-15), data]);
  };

  const handleUndo = () => {
    if (history.length <= 1) return;
    triggerHaptic('light');

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const nextHistory = [...history];
    nextHistory.pop(); // Remove current
    const prevState = nextHistory[nextHistory.length - 1];
    ctx.putImageData(prevState, 0, 0);
    setHistory(nextHistory);
  };

  // Canvas drawing handlers
  const getCanvasCoords = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const startDraw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (activeTool === 'text') {
      const coords = getCanvasCoords(e);
      const newElem: TextElement = {
        id: crypto.randomUUID(),
        text: 'Type text here',
        x: coords.x,
        y: coords.y,
        color: selectedColor === '#FFCC00' ? '#000000' : selectedColor,
        size: strokeSize * 6,
      };
      setTextElements((prev) => [...prev, newElem]);
      setActiveTextId(newElem.id);
      return;
    }

    e.preventDefault();
    isDrawingRef.current = true;
    const coords = getCanvasCoords(e);
    lastPointRef.current = coords;
  };

  const drawMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current || !lastPointRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const coords = getCanvasCoords(e);

    ctx.beginPath();
    ctx.moveTo(lastPointRef.current.x, lastPointRef.current.y);
    ctx.lineTo(coords.x, coords.y);

    if (activeTool === 'pen') {
      ctx.strokeStyle = selectedColor;
      ctx.lineWidth = strokeSize * 2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.globalAlpha = 1.0;
    } else if (activeTool === 'highlighter') {
      ctx.strokeStyle = selectedColor;
      ctx.lineWidth = strokeSize * 7;
      ctx.lineCap = 'square';
      ctx.lineJoin = 'miter';
      ctx.globalAlpha = 0.35; // semi-transparent highlight
    }

    ctx.stroke();
    ctx.globalAlpha = 1.0;
    lastPointRef.current = coords;
  };

  const endDraw = () => {
    if (isDrawingRef.current) {
      isDrawingRef.current = false;
      lastPointRef.current = null;
      saveHistoryStep();
    }
  };

  // Apply markup onto canvas and save
  const handleApply = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    triggerHaptic('success');

    const ctx = canvas.getContext('2d');
    if (ctx) {
      // Stamp text elements onto canvas
      textElements.forEach((el) => {
        ctx.font = `bold ${el.size}px -apple-system, sans-serif`;
        ctx.fillStyle = el.color;
        ctx.fillText(el.text, el.x, el.y);
      });
    }

    const result = canvas.toDataURL('image/jpeg', 0.94);
    onApply(result);
    onClose();
  };

  const colors = [
    '#FFCC00', // Yellow
    '#34C759', // Green
    '#007AFF', // Blue
    '#FF3B30', // Red
    '#AF52DE', // Purple
    '#000000', // Black
    '#FFFFFF', // White
  ];

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

        <div className="flex items-center gap-1 bg-white/10 p-1 rounded-2xl">
          <button
            onClick={() => {
              triggerHaptic('light');
              setActiveTool('pen');
            }}
            className={`p-2 rounded-xl ios-press ${
              activeTool === 'pen' ? 'bg-[#5856D6] text-white shadow-sm' : 'text-gray-300'
            }`}
            title="Pen"
          >
            <Pen className="w-4 h-4" />
          </button>

          <button
            onClick={() => {
              triggerHaptic('light');
              setActiveTool('highlighter');
            }}
            className={`p-2 rounded-xl ios-press ${
              activeTool === 'highlighter' ? 'bg-[#5856D6] text-white shadow-sm' : 'text-gray-300'
            }`}
            title="Highlighter"
          >
            <Highlighter className="w-4 h-4" />
          </button>

          <button
            onClick={() => {
              triggerHaptic('light');
              setActiveTool('text');
            }}
            className={`p-2 rounded-xl ios-press ${
              activeTool === 'text' ? 'bg-[#5856D6] text-white shadow-sm' : 'text-gray-300'
            }`}
            title="Type Text"
          >
            <Type className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleUndo}
            disabled={history.length <= 1}
            className="p-2 rounded-full bg-white/15 text-white disabled:opacity-30 ios-press"
            title="Undo"
          >
            <Undo className="w-4 h-4" />
          </button>

          <button
            onClick={handleApply}
            className="ios-press flex items-center gap-1 px-4 py-1.5 rounded-full bg-[#5856D6] hover:bg-[#6866E6] text-sm font-semibold text-white shadow-md"
          >
            <Check className="w-4 h-4" />
            <span>Apply</span>
          </button>
        </div>
      </div>

      {/* Main Canvas Viewport */}
      <div className="relative flex-1 flex items-center justify-center p-4 bg-[#07070A] overflow-hidden">
        <canvas
          ref={canvasRef}
          onPointerDown={startDraw}
          onPointerMove={drawMove}
          onPointerUp={endDraw}
          className="max-h-[calc(100vh-210px)] max-w-[calc(100vw-32px)] object-contain shadow-2xl rounded touch-none cursor-crosshair bg-white"
        />

        {/* Text Element Overlay Inputs */}
        {textElements.map((el) => (
          <div
            key={el.id}
            style={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              transform: 'translate(-50%, -50%)',
            }}
            className="z-30"
          >
            <input
              type="text"
              value={el.text}
              onChange={(e) =>
                setTextElements((prev) =>
                  prev.map((t) => (t.id === el.id ? { ...t, text: e.target.value } : t))
                )
              }
              style={{ color: el.color }}
              className="bg-black/60 px-3 py-1.5 rounded-lg border border-white/20 text-sm font-semibold shadow-lg focus:outline-none focus:ring-2 focus:ring-[#5856D6]"
            />
          </div>
        ))}
      </div>

      {/* Bottom Color & Size Picker */}
      <div className="pb-safe pt-3 px-6 bg-black/80 backdrop-blur-md border-t border-white/10 flex flex-wrap items-center justify-between gap-4 text-xs z-20">
        {/* Colors */}
        <div className="flex items-center gap-2">
          {colors.map((c) => (
            <button
              key={c}
              onClick={() => {
                triggerHaptic('light');
                setSelectedColor(c);
              }}
              style={{ backgroundColor: c }}
              className={`w-7 h-7 rounded-full border-2 transition-transform ios-press ${
                selectedColor === c ? 'scale-125 border-white shadow-md' : 'border-black/40'
              }`}
            />
          ))}
        </div>

        {/* Stroke Size Slider */}
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-gray-400">Size:</span>
          <input
            type="range"
            min="1"
            max="10"
            value={strokeSize}
            onChange={(e) => setStrokeSize(parseInt(e.target.value))}
            className="w-28 accent-[#5856D6]"
          />
        </div>
      </div>
    </div>
  );
};
