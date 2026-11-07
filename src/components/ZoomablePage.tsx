import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ZoomIn, ZoomOut } from 'lucide-react';

interface Props {
  src: string;
  alt: string;
  rotation?: number;
  /** Swipe left/right at normal size changes page; swipe from the left edge goes back. */
  onSwipe?: (dir: 'next' | 'prev') => void;
  onEdgeBack?: () => void;
  /** Changes when the page changes, so zoom resets. */
  resetKey: string | number;
  /** Space kept free at the bottom (toolbars). */
  padding?: number;
}

const MAX = 6;

/**
 * A page that zooms like the iPhone Photos app: pinch around your fingers (up to 6×), drag to move
 * (it can't get lost off-screen), double-tap to zoom in on a spot or back out. When you stop, the page is
 * re-drawn at the real zoomed size so text stays sharp.
 */
export const ZoomablePage: React.FC<Props> = ({ src, alt, rotation = 0, onSwipe, onEdgeBack, resetKey, padding = 24 }) => {
  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [nat, setNat] = useState({ w: 0, h: 0 });
  const [view, setView] = useState({ s: 1, x: 0, y: 0 }); // what is shown
  const [base, setBase] = useState(1); // scale the <img> is laid out at (sharpness)
  const [animate, setAnimate] = useState(false);
  const viewRef = useRef(view);
  viewRef.current = view;

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const upd = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    upd();
    const ro = new ResizeObserver(upd);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    setView({ s: 1, x: 0, y: 0 });
    setBase(1);
  }, [resetKey]);

  const rotated = rotation % 180 !== 0;
  const iw = rotated ? nat.h : nat.w;
  const ih = rotated ? nat.w : nat.h;
  const fit = iw && ih && box.w && box.h ? Math.min((box.w - padding * 2) / iw, (box.h - padding * 2) / ih) : 0;
  const fw = iw * fit; // fitted size (before zoom), in CSS px
  const fh = ih * fit;

  const clamp = useCallback(
    (s: number, x: number, y: number) => {
      s = Math.min(MAX, Math.max(1, s));
      const mx = Math.max(0, (fw * s - box.w) / 2 + padding);
      const my = Math.max(0, (fh * s - box.h) / 2 + padding);
      return { s, x: Math.min(mx, Math.max(-mx, x)), y: Math.min(my, Math.max(-my, y)) };
    },
    [fw, fh, box.w, box.h, padding]
  );

  // After a gesture settles, lay the image out at the zoomed size so the browser draws it sharp.
  const settleTimer = useRef<number | null>(null);
  const settle = useCallback(() => {
    if (settleTimer.current) window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(() => setBase(Math.min(viewRef.current.s, 3)), 180);
  }, []);

  const zoomAt = useCallback(
    (newS: number, cx: number, cy: number, anim = false) => {
      // cx, cy: point relative to the box centre that must stay under the finger/cursor
      const v = viewRef.current;
      const s2 = Math.min(MAX, Math.max(1, newS));
      const k = s2 / v.s;
      const next = clamp(s2, cx - (cx - v.x) * k, cy - (cy - v.y) * k);
      setAnimate(anim);
      setView(next);
      settle();
    },
    [clamp, settle]
  );

  // ----------------------------------------------------------------- touch
  const t = useRef<{
    mode: 'none' | 'pan' | 'pinch';
    sx: number;
    sy: number;
    lx: number;
    ly: number;
    dist: number;
    s0: number;
    time: number;
    moved: boolean;
  }>({ mode: 'none', sx: 0, sy: 0, lx: 0, ly: 0, dist: 0, s0: 1, time: 0, moved: false });
  const lastTap = useRef(0);

  const rel = (clientX: number, clientY: number) => {
    const r = boxRef.current!.getBoundingClientRect();
    return { x: clientX - r.left - r.width / 2, y: clientY - r.top - r.height / 2 };
  };

  const onTouchStart = (e: React.TouchEvent) => {
    setAnimate(false);
    if (e.touches.length === 2) {
      const [a, b] = [e.touches[0], e.touches[1]];
      t.current = { ...t.current, mode: 'pinch', dist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), s0: viewRef.current.s, moved: true };
    } else if (e.touches.length === 1) {
      const p = e.touches[0];
      t.current = { mode: 'pan', sx: p.clientX, sy: p.clientY, lx: p.clientX, ly: p.clientY, dist: 0, s0: viewRef.current.s, time: Date.now(), moved: false };
    }
  };

  const onTouchMove = (e: React.TouchEvent) => {
    const st = t.current;
    if (st.mode === 'pinch' && e.touches.length === 2) {
      const [a, b] = [e.touches[0], e.touches[1]];
      const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const c = rel((a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);
      zoomAt((st.s0 * d) / Math.max(1, st.dist), c.x, c.y);
    } else if (st.mode === 'pan' && e.touches.length === 1) {
      const p = e.touches[0];
      const dx = p.clientX - st.lx;
      const dy = p.clientY - st.ly;
      st.lx = p.clientX;
      st.ly = p.clientY;
      if (Math.abs(p.clientX - st.sx) > 6 || Math.abs(p.clientY - st.sy) > 6) st.moved = true;
      if (viewRef.current.s > 1.01) {
        const v = viewRef.current;
        setView(clamp(v.s, v.x + dx, v.y + dy));
      }
    }
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    const st = t.current;
    if (st.mode === 'pan' && e.touches.length === 0) {
      const p = e.changedTouches[0];
      const dx = p.clientX - st.sx;
      const dy = p.clientY - st.sy;
      if (!st.moved) {
        // tap: double-tap toggles zoom at that spot
        const now = Date.now();
        if (now - lastTap.current < 300) {
          const c = rel(p.clientX, p.clientY);
          if (viewRef.current.s > 1.01) {
            setAnimate(true);
            setView({ s: 1, x: 0, y: 0 });
            settle();
          } else zoomAt(2.5, c.x, c.y, true);
          lastTap.current = 0;
        } else lastTap.current = now;
      } else if (viewRef.current.s <= 1.01 && Math.abs(dy) < 60) {
        if (st.sx < 40 && dx > 80) onEdgeBack?.();
        else if (dx < -65) onSwipe?.('next');
        else if (dx > 65) onSwipe?.('prev');
      }
    }
    if (e.touches.length === 0) t.current.mode = 'none';
    else if (e.touches.length === 1) {
      const p = e.touches[0];
      t.current = { ...t.current, mode: 'pan', sx: p.clientX, sy: p.clientY, lx: p.clientX, ly: p.clientY, moved: true };
    }
  };

  // ----------------------------------------------------------------- mouse (desktop)
  const drag = useRef<{ x: number; y: number } | null>(null);
  const onWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      const c = rel(e.clientX, e.clientY);
      zoomAt(viewRef.current.s * Math.exp(-e.deltaY * 0.01), c.x, c.y);
    } else if (viewRef.current.s > 1.01) {
      const v = viewRef.current;
      setAnimate(false);
      setView(clamp(v.s, v.x - e.deltaX, v.y - e.deltaY));
    }
  };

  useEffect(() => {
    // stop the browser zooming the whole page on ctrl+wheel / trackpad pinch over the document
    const el = boxRef.current;
    if (!el) return;
    const block = (ev: WheelEvent) => {
      if (ev.ctrlKey || ev.metaKey || viewRef.current.s > 1.01) ev.preventDefault();
    };
    el.addEventListener('wheel', block, { passive: false });
    return () => el.removeEventListener('wheel', block);
  }, []);

  const zoomButton = (f: number) => {
    const v = viewRef.current;
    if (f < 1 && v.s / f <= 1.01) {
      setAnimate(true);
      setView({ s: 1, x: 0, y: 0 });
    } else zoomAt(v.s * f, 0, 0, true);
    settle();
  };

  const ready = fw > 0 && fh > 0;
  const layoutScale = base;
  const visualScale = view.s / layoutScale;

  return (
    <div
      ref={boxRef}
      className="absolute inset-0 overflow-hidden touch-none select-none"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onWheel={onWheel}
      onDoubleClick={(e) => {
        const c = rel(e.clientX, e.clientY);
        if (viewRef.current.s > 1.01) {
          setAnimate(true);
          setView({ s: 1, x: 0, y: 0 });
          settle();
        } else zoomAt(2.5, c.x, c.y, true);
      }}
      onMouseDown={(e) => {
        if (viewRef.current.s > 1.01) drag.current = { x: e.clientX, y: e.clientY };
      }}
      onMouseMove={(e) => {
        if (!drag.current) return;
        const v = viewRef.current;
        setAnimate(false);
        setView(clamp(v.s, v.x + e.clientX - drag.current.x, v.y + e.clientY - drag.current.y));
        drag.current = { x: e.clientX, y: e.clientY };
      }}
      onMouseUp={() => (drag.current = null)}
      onMouseLeave={() => (drag.current = null)}
      style={{ cursor: view.s > 1.01 ? 'grab' : 'default' }}
    >
      <img
        src={src}
        alt={alt}
        draggable={false}
        onLoad={(e) => setNat({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
        className="absolute left-1/2 top-1/2 max-w-none rounded-md shadow-2xl bg-white"
        style={{
          visibility: ready ? 'visible' : 'hidden',
          width: (rotated ? fh : fw) * layoutScale,
          height: (rotated ? fw : fh) * layoutScale,
          transform: `translate(-50%, -50%) translate(${view.x}px, ${view.y}px) scale(${visualScale}) rotate(${rotation}deg)`,
          transition: animate ? 'transform 220ms cubic-bezier(.2,.8,.2,1)' : 'none',
          imageRendering: 'auto',
        }}
      />

      <div className="absolute bottom-4 right-4 flex items-center gap-1 bg-white/85 dark:bg-[#2C2C2E]/85 backdrop-blur-md rounded-full shadow-lg border border-black/10 dark:border-white/10 p-1 z-20">
        <button onClick={() => zoomButton(1 / 1.5)} className="p-1.5 rounded-full hover:bg-black/10 dark:hover:bg-white/10 ios-press" title="Zoom out" aria-label="Zoom out">
          <ZoomOut className="w-4 h-4 text-gray-700 dark:text-gray-200" />
        </button>
        <button
          onClick={() => {
            setAnimate(true);
            setView({ s: 1, x: 0, y: 0 });
            settle();
          }}
          className="px-2 py-0.5 text-[11px] font-semibold text-gray-700 dark:text-gray-200 min-w-[44px]"
          title="Fit page"
        >
          {Math.round(view.s * 100)}%
        </button>
        <button onClick={() => zoomButton(1.5)} className="p-1.5 rounded-full hover:bg-black/10 dark:hover:bg-white/10 ios-press" title="Zoom in" aria-label="Zoom in">
          <ZoomIn className="w-4 h-4 text-gray-700 dark:text-gray-200" />
        </button>
      </div>
    </div>
  );
};
