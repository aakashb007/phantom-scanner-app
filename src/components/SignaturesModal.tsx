import React, { useEffect, useRef, useState } from 'react';
import { X, Camera, PenTool, Trash2, RotateCcw, Check, Loader2 } from 'lucide-react';
import { triggerHaptic } from '../utils/haptics';
import { addSignature, getSavedSignatures, photoToSignature, removeSignature, trimCanvas } from '../utils/signatures';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

/** Manage saved signatures: draw one, or photograph one on paper (the paper is removed). */
export const SignaturesModal: React.FC<Props> = ({ isOpen, onClose }) => {
  const [list, setList] = useState<string[]>([]);
  const [drawing, setDrawing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const down = useRef(false);

  const reload = () => getSavedSignatures().then(setList);
  useEffect(() => {
    if (isOpen) {
      reload();
      setDrawing(false);
      setError('');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * c.width) / r.width, y: ((e.clientY - r.top) * c.height) / r.height };
  };

  const onPhoto = async (f?: File) => {
    if (!f) return;
    setBusy(true);
    setError('');
    try {
      await addSignature(await photoToSignature(f));
      triggerHaptic('success');
      await reload();
    } catch (e: any) {
      setError(e?.message || 'Could not read the signature');
    } finally {
      setBusy(false);
    }
  };

  const saveDrawing = async () => {
    const t = trimCanvas(canvasRef.current!);
    if (!t) return setError('Draw your signature first');
    await addSignature(t.toDataURL('image/png'));
    triggerHaptic('success');
    setDrawing(false);
    reload();
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/50 flex items-end lg:items-center justify-center">
      <div className="w-full lg:max-w-lg max-h-[90dvh] bg-[#F2F2F7] dark:bg-[#1C1C1E] rounded-t-3xl lg:rounded-3xl overflow-hidden flex flex-col pb-safe text-gray-900 dark:text-white">
        <header className="flex items-center justify-between px-5 py-4 border-b border-black/5 dark:border-white/10">
          <h2 className="text-lg font-bold">Signatures</h2>
          <button onClick={onClose} className="p-2 rounded-full bg-black/5 dark:bg-white/10 ios-press" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto ios-scroll p-5 space-y-4">
          {drawing ? (
            <div className="bg-white rounded-2xl p-3">
              <canvas
                ref={canvasRef}
                width={900}
                height={360}
                className="w-full h-44 border-2 border-dashed border-gray-300 rounded-xl touch-none"
                onPointerDown={(e) => {
                  down.current = true;
                  e.currentTarget.setPointerCapture(e.pointerId);
                  const ctx = canvasRef.current!.getContext('2d')!;
                  const p = pos(e);
                  ctx.strokeStyle = '#000';
                  ctx.lineWidth = 6;
                  ctx.lineCap = 'round';
                  ctx.lineJoin = 'round';
                  ctx.beginPath();
                  ctx.moveTo(p.x, p.y);
                }}
                onPointerMove={(e) => {
                  if (!down.current) return;
                  const ctx = canvasRef.current!.getContext('2d')!;
                  const p = pos(e);
                  ctx.lineTo(p.x, p.y);
                  ctx.stroke();
                }}
                onPointerUp={() => (down.current = false)}
              />
              <div className="flex justify-between mt-3">
                <button
                  onClick={() => canvasRef.current!.getContext('2d')!.clearRect(0, 0, 900, 360)}
                  className="text-sm text-red-500 font-semibold flex items-center gap-1"
                >
                  <RotateCcw className="w-4 h-4" /> Clear
                </button>
                <button onClick={saveDrawing} className="text-sm text-white bg-[#5856D6] px-4 py-1.5 rounded-full font-semibold flex items-center gap-1 ios-press">
                  <Check className="w-4 h-4" /> Save
                </button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => setDrawing(true)} className="ios-press bg-white dark:bg-[#2C2C2E] rounded-2xl p-4 flex flex-col items-center gap-2">
                <PenTool className="w-6 h-6 text-[#5856D6]" />
                <span className="text-sm font-semibold">Draw</span>
              </button>
              <button onClick={() => photoRef.current?.click()} className="ios-press bg-white dark:bg-[#2C2C2E] rounded-2xl p-4 flex flex-col items-center gap-2">
                {busy ? <Loader2 className="w-6 h-6 animate-spin text-[#5856D6]" /> : <Camera className="w-6 h-6 text-[#5856D6]" />}
                <span className="text-sm font-semibold">Photo of paper</span>
              </button>
            </div>
          )}
          <input ref={photoRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { onPhoto(e.target.files?.[0]); e.target.value = ''; }} />
          {error && <p className="text-sm text-red-500">{error}</p>}

          <p className="text-xs font-semibold uppercase text-gray-500 pt-2">Saved ({list.length})</p>
          {list.length === 0 && <p className="text-sm text-gray-500">No signatures yet. They appear in a document's Sign tool.</p>}
          <div className="grid grid-cols-2 gap-3">
            {list.map((s, i) => (
              <div key={i} className="relative bg-white rounded-xl h-24 p-2 flex items-center justify-center">
                <img src={s} alt={`Signature ${i + 1}`} className="max-h-full max-w-full object-contain" />
                <button
                  onClick={async () => { await removeSignature(i); reload(); }}
                  className="absolute top-1 right-1 p-1.5 rounded-full bg-red-500 text-white ios-press"
                  aria-label="Delete signature"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
