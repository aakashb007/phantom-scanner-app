import React, { useState, useRef, useEffect, useCallback } from 'react';
import { X, Copy, ExternalLink, Check, QrCode, Zap, RotateCcw } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import jsQR from 'jsqr';
import { triggerHaptic } from '../utils/haptics';

interface QRScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const QRScannerModal: React.FC<QRScannerModalProps> = ({ isOpen, onClose }) => {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [decodedResult, setDecodedResult] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean>(false);
  const [torchOn, setTorchOn] = useState<boolean>(false);
  const [hasTorch, setHasTorch] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  const startCamera = useCallback(async () => {
    try {
      setErrorMessage(null);
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      setStream(mediaStream);
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
      }

      // Check if torch/flashlight is supported
      const track = mediaStream.getVideoTracks()[0];
      const capabilities = track.getCapabilities ? (track.getCapabilities() as { torch?: boolean }) : {};
      if (capabilities.torch) {
        setHasTorch(true);
      }
    } catch (err) {
      console.warn('QR camera error:', err);
      setErrorMessage('Unable to access camera. Please check camera permissions.');
    }
  }, []);

  const scanFrame = useCallback(() => {
    if (!videoRef.current || !canvasRef.current || decodedResult) return;

    const video = videoRef.current;
    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: 'attemptBoth',
        });

        if (code && code.data) {
          triggerHaptic('success');
          setDecodedResult(code.data);
          return;
        }
      }
    }

    animationFrameRef.current = requestAnimationFrame(scanFrame);
  }, [decodedResult]);

  useEffect(() => {
    if (isOpen) {
      setDecodedResult(null);
      setCopied(false);
      startCamera();
    } else {
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
        setStream(null);
      }
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    }
    return () => {
      if (stream) stream.getTracks().forEach((t) => t.stop());
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [isOpen, startCamera, stream]);

  // Start continuous frame processing when video is ready
  useEffect(() => {
    if (stream && !decodedResult) {
      animationFrameRef.current = requestAnimationFrame(scanFrame);
    }
    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [stream, decodedResult, scanFrame]);

  const toggleTorch = async () => {
    if (!stream) return;
    const track = stream.getVideoTracks()[0];
    try {
      const next = !torchOn;
      // @ts-expect-error torch is non-standard but supported in WebKit/Blink
      await track.applyConstraints({ advanced: [{ torch: next }] });
      setTorchOn(next);
      triggerHaptic('light');
    } catch (e) {
      console.warn('Torch constraint failed:', e);
    }
  };

  const handleCopy = () => {
    if (!decodedResult) return;
    triggerHaptic('light');
    navigator.clipboard.writeText(decodedResult);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleOpen = () => {
    if (!decodedResult) return;
    triggerHaptic('light');
    let url = decodedResult.trim();
    if (/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(\/.*)?$/.test(url)) {
      url = 'https://' + url;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const isLink = decodedResult && /^(https?:\/\/|www\.|mailto:|tel:|[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i.test(decodedResult.trim());

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black text-white select-none">
      <canvas ref={canvasRef} className="hidden" />

      {/* Top Bar with safe area padding */}
      <div className="pt-safe px-4 pb-3 flex items-center justify-between z-20 bg-black/60 backdrop-blur-md border-b border-white/10">
        <button
          onClick={() => {
            triggerHaptic('light');
            onClose();
          }}
          className="ios-press flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/15 text-sm font-medium hover:bg-white/25 text-white"
        >
          <X className="w-4 h-4" />
          <span>Close</span>
        </button>

        <div className="flex items-center gap-2">
          <QrCode className="w-4 h-4 text-[#5856D6]" />
          <span className="text-sm font-semibold">QR Scanner</span>
        </div>

        {hasTorch ? (
          <button
            onClick={toggleTorch}
            className={`p-2 rounded-full ios-press transition-colors ${
              torchOn ? 'bg-amber-400 text-black' : 'bg-white/15 text-white hover:bg-white/25'
            }`}
            title="Toggle flashlight"
          >
            <Zap className="w-4 h-4" />
          </button>
        ) : (
          <div className="w-16" />
        )}
      </div>

      {/* Video Viewport & Scanning Reticle */}
      <div className="relative flex-1 flex items-center justify-center bg-[#07070A] overflow-hidden">
        {errorMessage ? (
          <div className="p-6 text-center max-w-sm">
            <QrCode className="w-12 h-12 mx-auto mb-3 text-red-400" />
            <h4 className="font-semibold text-base mb-1">Camera Error</h4>
            <p className="text-xs text-gray-400 mb-4">{errorMessage}</p>
            <button
              onClick={startCamera}
              className="ios-press px-4 py-2 rounded-xl bg-white/15 text-xs font-semibold"
            >
              Retry Camera
            </button>
          </div>
        ) : (
          <>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
            />

            {/* Viewfinder Target */}
            {!decodedResult && (
              <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                <div className="relative w-64 h-64 sm:w-72 sm:h-72 border-2 border-white/20 rounded-3xl flex flex-col justify-between p-2 shadow-2xl">
                  {/* Four corner markers */}
                  <div className="absolute -top-1 -left-1 w-8 h-8 border-t-4 border-l-4 border-[#5856D6] rounded-tl-xl" />
                  <div className="absolute -top-1 -right-1 w-8 h-8 border-t-4 border-r-4 border-[#5856D6] rounded-tr-xl" />
                  <div className="absolute -bottom-1 -left-1 w-8 h-8 border-b-4 border-l-4 border-[#5856D6] rounded-bl-xl" />
                  <div className="absolute -bottom-1 -right-1 w-8 h-8 border-b-4 border-r-4 border-[#5856D6] rounded-br-xl" />

                  {/* Laser scan line animation */}
                  <motion.div
                    animate={{ y: [0, 240, 0] }}
                    transition={{ repeat: Infinity, duration: 2.2, ease: 'easeInOut' }}
                    className="w-full h-0.5 bg-gradient-to-r from-transparent via-[#5856D6] to-transparent shadow-[0_0_12px_#5856D6]"
                  />

                  <div className="text-center mt-auto pb-1">
                    <span className="px-3 py-1 bg-black/60 backdrop-blur-md rounded-full text-[11px] font-medium tracking-wide text-white/90 uppercase border border-white/10">
                      Align QR code within frame
                    </span>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* Decoded Result Sheet */}
        <AnimatePresence>
          {decodedResult && (
            <motion.div
              initial={{ y: 200, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 200, opacity: 0 }}
              transition={{ type: 'spring', damping: 28, stiffness: 350 }}
              className="absolute bottom-6 inset-x-4 max-w-lg mx-auto z-30 bg-[#1C1C1E]/95 backdrop-blur-xl rounded-2xl p-5 border border-white/15 shadow-2xl"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-[#5856D6] dark:text-[#7D7AFF] flex items-center gap-1.5">
                  <QrCode className="w-3.5 h-3.5" />
                  <span>Decoded Result</span>
                </span>
                <button
                  onClick={() => {
                    triggerHaptic('light');
                    setDecodedResult(null);
                  }}
                  className="ios-press text-xs text-gray-400 hover:text-white flex items-center gap-1"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Scan again</span>
                </button>
              </div>

              {/* Decoded Content */}
              <div className="p-3 bg-black/40 rounded-xl border border-white/10 max-h-36 overflow-y-auto font-mono text-xs text-gray-200 break-all select-text mb-4">
                {decodedResult}
              </div>

              {/* Action Buttons: Copy and Open */}
              <div className="grid grid-cols-2 gap-2.5">
                <button
                  onClick={handleCopy}
                  className="ios-press flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-white/15 hover:bg-white/25 text-white font-semibold text-xs transition-colors"
                >
                  {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                  <span>{copied ? 'Copied!' : 'Copy Text'}</span>
                </button>

                {isLink ? (
                  <button
                    onClick={handleOpen}
                    className="ios-press flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-[#5856D6] hover:bg-[#6866E6] text-white font-semibold text-xs shadow-md transition-colors"
                  >
                    <ExternalLink className="w-4 h-4" />
                    <span>Open Link</span>
                  </button>
                ) : (
                  <button
                    onClick={handleOpen}
                    className="ios-press flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-white/15 hover:bg-white/25 text-white font-semibold text-xs transition-colors"
                  >
                    <ExternalLink className="w-4 h-4" />
                    <span>Search Web</span>
                  </button>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};
