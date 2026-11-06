import React, { useEffect, useRef, useState } from 'react';
import { X, Camera, ImagePlus, Loader2, Download, Share2 } from 'lucide-react';
import { triggerHaptic } from '../utils/haptics';
import { shareOrDownloadFiles } from '../utils/exportEngine';

// MediaPipe runs on the device: the photo never leaves the browser.
const MP_VERSION = '1.2.2';
const WASM_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm`;
const SEG_MODEL =
  'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite';
const FACE_MODEL =
  'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/latest/blaze_face_short_range.tflite';

type SizeKey = '35x45' | '2x2' | '33x48';
const SIZES: Record<SizeKey, { label: string; note: string; wMm: number; hMm: number }> = {
  '35x45': { label: '35 × 45 mm', note: 'Pakistan, India, UK, EU', wMm: 35, hMm: 45 },
  '2x2': { label: '2 × 2 in', note: 'USA, India visa', wMm: 50.8, hMm: 50.8 },
  '33x48': { label: '33 × 48 mm', note: 'China', wMm: 33, hMm: 48 },
};
const BACKGROUNDS = [
  { key: 'white', label: 'White', color: '#FFFFFF' },
  { key: 'blue', label: 'Light blue', color: '#CFE3F6' },
  { key: 'grey', label: 'Grey', color: '#D4D6DA' },
  { key: 'red', label: 'Red', color: '#D2232A' },
];
const DPI = 300;
const mmToPx = (mm: number) => Math.round((mm / 25.4) * DPI);

let visionPromise: Promise<{ segmenter: any; face: any }> | null = null;
async function loadVision() {
  if (!visionPromise) {
    visionPromise = (async () => {
      const { FilesetResolver, ImageSegmenter, FaceDetector } = await import('@mediapipe/tasks-vision');
      const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
      const segmenter = await ImageSegmenter.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: SEG_MODEL },
        runningMode: 'IMAGE',
        outputConfidenceMasks: true,
        outputCategoryMask: false,
      });
      const face = await FaceDetector.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: FACE_MODEL },
        runningMode: 'IMAGE',
      });
      return { segmenter, face };
    })().catch((e) => {
      visionPromise = null;
      throw e;
    });
  }
  return visionPromise;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export const PassportPhotoModal: React.FC<Props> = ({ isOpen, onClose }) => {
  const [source, setSource] = useState<HTMLImageElement | null>(null);
  const [cutout, setCutout] = useState<HTMLCanvasElement | null>(null);
  const [faceBox, setFaceBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [size, setSize] = useState<SizeKey>('35x45');
  const [bg, setBg] = useState('white');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [preview, setPreview] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) {
      setSource(null);
      setCutout(null);
      setPreview('');
      setError('');
    }
  }, [isOpen]);

  const handleFile = (f?: File) => {
    if (!f) return;
    const img = new Image();
    img.onload = () => process(img);
    img.src = URL.createObjectURL(f);
  };

  const process = async (img: HTMLImageElement) => {
    setError('');
    setSource(img);
    setBusy('Finding the person… (first time downloads about 3 MB)');
    try {
      const { segmenter, face } = await loadVision();
      // Work on a copy no larger than 1600 px for speed.
      const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.round(img.naturalWidth * scale);
      const h = Math.round(img.naturalHeight * scale);
      const base = document.createElement('canvas');
      base.width = w;
      base.height = h;
      base.getContext('2d')!.drawImage(img, 0, 0, w, h);

      const faces = face.detect(base);
      const det = faces.detections?.[0]?.boundingBox;
      if (!det) throw new Error('No face found. Use a front-facing photo with the whole head visible.');
      setFaceBox({ x: det.originX, y: det.originY, w: det.width, h: det.height });

      const seg = segmenter.segment(base);
      const mask: Float32Array = seg.confidenceMasks[0].getAsFloat32Array();
      // The selfie model gives background confidence in mask 0 when it has two masks.
      let personMask: Float32Array =
        seg.confidenceMasks.length > 1 ? seg.confidenceMasks[1].getAsFloat32Array() : mask;
      // Safety check: the face centre must be "person". If not, the mask is inverted.
      const fx = Math.round(det.originX + det.width / 2);
      const fy = Math.round(det.originY + det.height / 2);
      if (personMask[fy * w + fx] < 0.5) personMask = personMask.map((v) => 1 - v);
      const out = document.createElement('canvas');
      out.width = w;
      out.height = h;
      const ctx = out.getContext('2d')!;
      ctx.drawImage(base, 0, 0);
      const data = ctx.getImageData(0, 0, w, h);
      for (let i = 0; i < w * h; i++) {
        const a = Math.min(1, Math.max(0, (personMask[i] - 0.3) / 0.4));
        data.data[i * 4 + 3] = Math.round(a * 255);
      }
      ctx.putImageData(data, 0, 0);
      seg.close?.();
      setCutout(out);
    } catch (e: any) {
      setError(e?.message || 'Could not process this photo');
    } finally {
      setBusy('');
    }
  };

  /** Crop so the face (chin to top of head) is ~70% of the photo height, eyes a little above centre. */
  const renderPhoto = (): HTMLCanvasElement | null => {
    if (!cutout || !faceBox) return null;
    const spec = SIZES[size];
    const W = mmToPx(spec.wMm);
    const H = mmToPx(spec.hMm);
    const headH = faceBox.h * 1.45; // detector box covers brow-to-chin; add hair/forehead
    const cropH = headH / 0.7;
    const cropW = cropH * (W / H);
    const headTop = faceBox.y - faceBox.h * 0.45;
    const cy = headTop - cropH * 0.1; // ~10% space above the head
    const cx = faceBox.x + faceBox.w / 2 - cropW / 2;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = BACKGROUNDS.find((b) => b.key === bg)!.color;
    ctx.fillRect(0, 0, W, H);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(cutout, cx, cy, cropW, cropH, 0, 0, W, H);
    return c;
  };

  useEffect(() => {
    const c = renderPhoto();
    setPreview(c ? c.toDataURL('image/jpeg', 0.92) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cutout, faceBox, size, bg]);

  const toBlob = (c: HTMLCanvasElement) =>
    new Promise<Blob>((res) => c.toBlob((b) => res(b!), 'image/jpeg', 0.95));

  const saveSingle = async () => {
    const c = renderPhoto();
    if (!c) return;
    triggerHaptic('success');
    const file = new File([await toBlob(c)], `Passport photo ${SIZES[size].label.replace(/\s/g, '')}.jpg`, {
      type: 'image/jpeg',
    });
    await shareOrDownloadFiles([file], 'Passport photo');
  };

  const saveSheet = async () => {
    const c = renderPhoto();
    if (!c) return;
    triggerHaptic('success');
    // 6 × 4 inch landscape sheet at 300 dpi with as many copies as fit, 2 mm gaps.
    const SW = 6 * DPI;
    const SH = 4 * DPI;
    const gap = mmToPx(2);
    const cols = Math.floor((SW - gap) / (c.width + gap));
    const rows = Math.floor((SH - gap) / (c.height + gap));
    const sheet = document.createElement('canvas');
    sheet.width = SW;
    sheet.height = SH;
    const ctx = sheet.getContext('2d')!;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, SW, SH);
    const offX = (SW - (cols * c.width + (cols - 1) * gap)) / 2;
    const offY = (SH - (rows * c.height + (rows - 1) * gap)) / 2;
    ctx.strokeStyle = '#BBBBBB';
    ctx.lineWidth = 1;
    for (let r = 0; r < rows; r++)
      for (let k = 0; k < cols; k++) {
        const x = offX + k * (c.width + gap);
        const y = offY + r * (c.height + gap);
        ctx.drawImage(c, x, y);
        ctx.strokeRect(x - 0.5, y - 0.5, c.width + 1, c.height + 1);
      }
    const file = new File([await toBlob(sheet)], `Passport photos 4x6 (${cols * rows} copies).jpg`, {
      type: 'image/jpeg',
    });
    await shareOrDownloadFiles([file], 'Passport photo sheet');
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] bg-black/50 flex items-end lg:items-center justify-center">
      <div className="w-full lg:max-w-3xl max-h-[95dvh] bg-[#F2F2F7] dark:bg-[#1C1C1E] rounded-t-3xl lg:rounded-3xl overflow-hidden flex flex-col pb-safe">
        <header className="flex items-center justify-between px-5 py-4 border-b border-black/5 dark:border-white/10">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">Passport Photo Maker</h2>
          <button onClick={onClose} className="p-2 rounded-full bg-black/5 dark:bg-white/10 ios-press" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto ios-scroll p-5 space-y-5 text-gray-900 dark:text-white">
          {!source && (
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => camRef.current?.click()} className="ios-press bg-white dark:bg-[#2C2C2E] rounded-2xl p-5 flex flex-col items-center gap-2">
                <Camera className="w-7 h-7 text-[#5856D6]" />
                <span className="text-sm font-semibold">Take photo</span>
              </button>
              <button onClick={() => fileRef.current?.click()} className="ios-press bg-white dark:bg-[#2C2C2E] rounded-2xl p-5 flex flex-col items-center gap-2">
                <ImagePlus className="w-7 h-7 text-[#5856D6]" />
                <span className="text-sm font-semibold">Choose photo</span>
              </button>
              <p className="col-span-2 text-xs text-gray-500 text-center">
                Face the camera, plain light, whole head and shoulders in the picture.
              </p>
            </div>
          )}
          <input ref={camRef} type="file" accept="image/*" capture="user" className="hidden" onChange={(e) => handleFile(e.target.files?.[0])} />
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => handleFile(e.target.files?.[0])} />

          {busy && (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Loader2 className="w-4 h-4 animate-spin" /> {busy}
            </div>
          )}
          {error && <p className="text-sm text-red-500">{error}</p>}

          {source && !busy && (
            <div className="grid lg:grid-cols-2 gap-5">
              <div className="flex items-center justify-center bg-white dark:bg-black rounded-2xl p-4 min-h-[260px]">
                {preview ? (
                  <img src={preview} alt="Passport photo preview" className="max-h-[340px] shadow-lg border border-black/10" />
                ) : (
                  <span className="text-sm text-gray-400">No preview</span>
                )}
              </div>
              <div className="space-y-4">
                <div>
                  <p className="text-xs font-semibold uppercase text-gray-500 mb-2">Size</p>
                  <div className="space-y-2">
                    {(Object.keys(SIZES) as SizeKey[]).map((k) => (
                      <button
                        key={k}
                        onClick={() => setSize(k)}
                        className={`w-full text-left px-4 py-2.5 rounded-xl ios-press ${
                          size === k ? 'bg-[#5856D6] text-white' : 'bg-white dark:bg-[#2C2C2E]'
                        }`}
                      >
                        <span className="font-semibold text-sm">{SIZES[k].label}</span>
                        <span className={`text-xs ml-2 ${size === k ? 'text-white/80' : 'text-gray-500'}`}>{SIZES[k].note}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase text-gray-500 mb-2">Background</p>
                  <div className="flex gap-3">
                    {BACKGROUNDS.map((b) => (
                      <button key={b.key} onClick={() => setBg(b.key)} className="flex flex-col items-center gap-1 ios-press">
                        <span
                          className={`w-10 h-10 rounded-full border ${bg === b.key ? 'ring-2 ring-[#5856D6] ring-offset-2' : 'border-black/10'}`}
                          style={{ background: b.color }}
                        />
                        <span className="text-[11px]">{b.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 pt-2">
                  <button onClick={saveSingle} className="ios-press flex items-center justify-center gap-1.5 py-3 rounded-xl bg-white dark:bg-[#2C2C2E] text-sm font-semibold">
                    <Download className="w-4 h-4" /> One photo
                  </button>
                  <button onClick={saveSheet} className="ios-press flex items-center justify-center gap-1.5 py-3 rounded-xl bg-[#5856D6] text-white text-sm font-semibold">
                    <Share2 className="w-4 h-4" /> 4×6 print sheet
                  </button>
                </div>
                <button onClick={() => { setSource(null); setCutout(null); }} className="w-full text-sm text-[#5856D6] dark:text-[#7D7AFF] font-semibold py-2">
                  Use another photo
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
