import { useEffect, useImperativeHandle, useRef, useState, forwardRef } from 'react';
import type { Stroke } from '../../../lib/types';

export const CANVAS_W = 520;
export const CANVAS_H = 380;

const PALETTE = [
  '#ffffff', '#111114', '#e0574f', '#e8833a', '#e6b422',
  '#6bbf59', '#3fb6a8', '#4a9de0', '#9b5de5', '#e05f9b',
];
const WIDTHS = [2, 5, 11, 20];

export interface DrawCanvasHandle {
  getStrokes: () => Stroke[];
}

/**
 * Drawings are stored as stroke arrays rather than PNGs. A few kilobytes each
 * instead of a few hundred, they scale to any canvas size, and the final album
 * can replay them — which is most of the fun of the game.
 */
export const DrawCanvas = forwardRef<DrawCanvasHandle, { disabled?: boolean }>(
  function DrawCanvas({ disabled }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const strokesRef = useRef<Stroke[]>([]);
    const currentRef = useRef<Stroke | null>(null);
    const [color, setColor] = useState(PALETTE[1]);
    const [width, setWidth] = useState(WIDTHS[1]);
    const [, forceRender] = useState(0);

    useImperativeHandle(ref, () => ({ getStrokes: () => strokesRef.current }), []);

    const repaint = () => {
      const ctx = canvasRef.current?.getContext('2d');
      if (!ctx) return;
      ctx.fillStyle = '#f7f7f4';
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const s of [...strokesRef.current, currentRef.current].filter(Boolean) as Stroke[]) {
        drawStroke(ctx, s);
      }
    };

    useEffect(repaint, []);

    const point = (e: React.PointerEvent): [number, number] => {
      const rect = canvasRef.current!.getBoundingClientRect();
      return [
        Math.round(((e.clientX - rect.left) / rect.width) * CANVAS_W),
        Math.round(((e.clientY - rect.top) / rect.height) * CANVAS_H),
      ];
    };

    const onDown = (e: React.PointerEvent) => {
      if (disabled) return;
      canvasRef.current?.setPointerCapture(e.pointerId);
      const [x, y] = point(e);
      currentRef.current = { c: color, w: width, p: [x, y] };
      repaint();
    };

    const onMove = (e: React.PointerEvent) => {
      if (!currentRef.current) return;
      const [x, y] = point(e);
      const p = currentRef.current.p;
      // Skip sub-pixel jitter; it triples the payload for no visible gain.
      if (Math.abs(x - p[p.length - 2]) + Math.abs(y - p[p.length - 1]) < 2) return;
      p.push(x, y);
      repaint();
    };

    const onUp = () => {
      if (!currentRef.current) return;
      strokesRef.current = [...strokesRef.current, currentRef.current];
      currentRef.current = null;
      repaint();
      forceRender((n) => n + 1);
    };

    const undo = () => {
      strokesRef.current = strokesRef.current.slice(0, -1);
      repaint();
      forceRender((n) => n + 1);
    };

    const clear = () => {
      strokesRef.current = [];
      repaint();
      forceRender((n) => n + 1);
    };

    return (
      <>
        <div className="canvas-frame" style={{ background: '#f7f7f4' }}>
          <canvas
            ref={canvasRef}
            width={CANVAS_W}
            height={CANVAS_H}
            style={{ cursor: disabled ? 'default' : 'crosshair' }}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
          />
        </div>

        <div className="draw-tools">
          {PALETTE.map((c) => (
            <button
              key={c}
              className="pen"
              style={{ ['--pc' as string]: c }}
              data-sel={c === color}
              onClick={() => setColor(c)}
              aria-label={`Colour ${c}`}
            />
          ))}
          <span style={{ width: 1, height: 22, background: 'var(--hairline-strong)' }} />
          {WIDTHS.map((w) => (
            <button
              key={w}
              className="btn btn-icon btn-sm"
              data-on={w === width}
              onClick={() => setWidth(w)}
              aria-label={`Brush size ${w}`}
              style={{
                background: w === width ? 'var(--accent-fill)' : undefined,
                display: 'grid',
                placeItems: 'center',
              }}
            >
              <span
                style={{
                  width: Math.min(w + 4, 18),
                  height: Math.min(w + 4, 18),
                  borderRadius: '50%',
                  background: 'currentColor',
                  display: 'block',
                }}
              />
            </button>
          ))}
          <span style={{ width: 1, height: 22, background: 'var(--hairline-strong)' }} />
          <button className="btn btn-sm" onClick={undo} disabled={strokesRef.current.length === 0}>
            Undo
          </button>
          <button className="btn btn-sm" onClick={clear} disabled={strokesRef.current.length === 0}>
            Clear
          </button>
        </div>
      </>
    );
  },
);

function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke) {
  ctx.strokeStyle = s.c;
  ctx.lineWidth = s.w;
  ctx.beginPath();
  ctx.moveTo(s.p[0], s.p[1]);
  if (s.p.length === 2) {
    // A single tap should still leave a dot.
    ctx.lineTo(s.p[0] + 0.1, s.p[1]);
  } else {
    for (let i = 2; i < s.p.length; i += 2) ctx.lineTo(s.p[i], s.p[i + 1]);
  }
  ctx.stroke();
}

/** Replay a finished drawing at whatever size the album needs. */
export function StrokeReplay({ strokes, width = 400 }: { strokes: Stroke[]; width?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#f7f7f4';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const s of strokes) drawStroke(ctx, s);
  }, [strokes]);

  return (
    <div className="canvas-frame" style={{ width, background: '#f7f7f4' }}>
      <canvas ref={ref} width={CANVAS_W} height={CANVAS_H} style={{ width: '100%' }} />
    </div>
  );
}
