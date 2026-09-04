import { useEffect, useImperativeHandle, useRef, useState, forwardRef } from 'react';
import { Icon, type IconName } from '../../../components/Icon';
import type { DrawOp } from '../../../lib/types';

export const CANVAS_W = 560;
export const CANVAS_H = 400;
export const PAPER = '#f7f7f4';

/**
 * Drawings are stored as an ordered list of operations, not as pixels. A few
 * kilobytes instead of a few hundred, they scale to any canvas size, and the
 * album can replay them. It also means a paint bucket works: a fill is just
 * another op, applied to the canvas in sequence at replay time.
 */

export type Tool = 'brush' | 'eraser' | 'fill' | 'line' | 'rect' | 'ellipse' | 'picker';

const TOOLS: { id: Tool; icon: IconName; label: string }[] = [
  { id: 'brush', icon: 'pencil', label: 'Brush' },
  { id: 'eraser', icon: 'eraser', label: 'Eraser' },
  { id: 'fill', icon: 'palette', label: 'Paint bucket' },
  { id: 'line', icon: 'send', label: 'Line' },
  { id: 'rect', icon: 'palette2', label: 'Rectangle' },
  { id: 'ellipse', icon: 'circle', label: 'Ellipse' },
  { id: 'picker', icon: 'search', label: 'Pick a colour' },
];

const PRESETS = [
  '#111114', '#5b5b66', '#ffffff', '#e0574f', '#e8833a',
  '#e6b422', '#6bbf59', '#3fb6a8', '#4a9de0', '#9b5de5',
];

const SIZES = [2, 5, 11, 22, 40];

export interface DrawCanvasHandle {
  getOps: () => DrawOp[];
  isEmpty: () => boolean;
}

/* ------------------------------------------------------------- painting -- */

function drawOp(ctx: CanvasRenderingContext2D, op: DrawOp): void {
  const kind = op.t ?? 'stroke';

  if (kind === 'fill') {
    floodFill(ctx, Math.round(op.x ?? 0), Math.round(op.y ?? 0), op.c);
    return;
  }

  ctx.strokeStyle = op.c;
  ctx.fillStyle = op.c;
  ctx.lineWidth = op.w ?? 4;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (kind === 'stroke') {
    const p = op.p ?? [];
    if (p.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(p[0], p[1]);
    if (p.length === 2) ctx.lineTo(p[0] + 0.1, p[1]); // a tap still leaves a dot
    else for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
    ctx.stroke();
    return;
  }

  const { x1 = 0, y1 = 0, x2 = 0, y2 = 0 } = op;
  ctx.beginPath();
  if (kind === 'line') {
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
  } else if (kind === 'rect') {
    ctx.rect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
  } else if (kind === 'ellipse') {
    ctx.ellipse(
      (x1 + x2) / 2,
      (y1 + y2) / 2,
      Math.abs(x2 - x1) / 2,
      Math.abs(y2 - y1) / 2,
      0,
      0,
      Math.PI * 2,
    );
  }
  if (op.f) ctx.fill();
  else ctx.stroke();
}

/** Replay a whole drawing onto a fresh paper-coloured canvas. */
export function renderOps(ctx: CanvasRenderingContext2D, ops: DrawOp[]): void {
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  for (const op of ops) drawOp(ctx, op);
}

/** Scanline flood fill with a small tolerance, so anti-aliased edges hold. */
function floodFill(ctx: CanvasRenderingContext2D, x: number, y: number, hex: string): void {
  const { width, height } = ctx.canvas;
  if (x < 0 || y < 0 || x >= width || y >= height) return;

  const img = ctx.getImageData(0, 0, width, height);
  const d = img.data;
  const at = (px: number, py: number) => (py * width + px) * 4;

  const start = at(x, y);
  const target = [d[start], d[start + 1], d[start + 2], d[start + 3]];
  const fill = hexToRgb(hex);
  if (
    Math.abs(target[0] - fill[0]) < 4 &&
    Math.abs(target[1] - fill[1]) < 4 &&
    Math.abs(target[2] - fill[2]) < 4
  ) {
    return; // already this colour
  }

  const tol = 32;
  const matches = (i: number) =>
    Math.abs(d[i] - target[0]) <= tol &&
    Math.abs(d[i + 1] - target[1]) <= tol &&
    Math.abs(d[i + 2] - target[2]) <= tol &&
    Math.abs(d[i + 3] - target[3]) <= tol;

  const stack: [number, number][] = [[x, y]];
  while (stack.length) {
    const [sx, sy] = stack.pop()!;
    let west = sx;
    while (west > 0 && matches(at(west - 1, sy))) west--;
    let east = sx;
    while (east < width - 1 && matches(at(east + 1, sy))) east++;

    for (let px = west; px <= east; px++) {
      const i = at(px, sy);
      d[i] = fill[0];
      d[i + 1] = fill[1];
      d[i + 2] = fill[2];
      d[i + 3] = 255;
      if (sy > 0 && matches(at(px, sy - 1))) stack.push([px, sy - 1]);
      if (sy < height - 1 && matches(at(px, sy + 1))) stack.push([px, sy + 1]);
    }
  }
  ctx.putImageData(img, 0, 0);
}

function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [
    parseInt(h.slice(0, 2), 16) || 0,
    parseInt(h.slice(2, 4), 16) || 0,
    parseInt(h.slice(4, 6), 16) || 0,
  ];
}

function hsvToHex(h: number, s: number, v: number): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    const val = v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
    return Math.round(val * 255)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(5)}${f(3)}${f(1)}`;
}

/* ------------------------------------------------------------- component -- */

export const DrawCanvas = forwardRef<DrawCanvasHandle, { disabled?: boolean }>(
  function DrawCanvas({ disabled }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const opsRef = useRef<DrawOp[]>([]);
    const redoRef = useRef<DrawOp[]>([]);
    const draftRef = useRef<DrawOp | null>(null);
    const drawingRef = useRef(false);

    const [tool, setTool] = useState<Tool>('brush');
    const [color, setColor] = useState('#111114');
    const [width, setWidth] = useState(5);
    const [filled, setFilled] = useState(false);
    const [hue, setHue] = useState(0);
    const [sat, setSat] = useState(1);
    const [val, setVal] = useState(0.08);
    const [recent, setRecent] = useState<string[]>([]);
    const [, bump] = useState(0);

    useImperativeHandle(
      ref,
      () => ({
        getOps: () => opsRef.current,
        isEmpty: () => opsRef.current.length === 0,
      }),
      [],
    );

    const repaint = () => {
      const ctx = canvasRef.current?.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;
      renderOps(ctx, opsRef.current);
      if (draftRef.current) drawOp(ctx, draftRef.current);
    };

    useEffect(repaint, []);

    const commit = (op: DrawOp) => {
      opsRef.current = [...opsRef.current, op];
      redoRef.current = [];
      setRecent((r) => [op.c, ...r.filter((c) => c !== op.c)].slice(0, 8));
      repaint();
      bump((n) => n + 1);
    };

    const point = (e: React.PointerEvent): [number, number] => {
      const rect = canvasRef.current!.getBoundingClientRect();
      return [
        Math.round(((e.clientX - rect.left) / rect.width) * CANVAS_W),
        Math.round(((e.clientY - rect.top) / rect.height) * CANVAS_H),
      ];
    };

    const applyColor = (hex: string) => {
      setColor(hex);
      setRecent((r) => [hex, ...r.filter((c) => c !== hex)].slice(0, 8));
    };

    const onDown = (e: React.PointerEvent) => {
      if (disabled) return;
      canvasRef.current?.setPointerCapture(e.pointerId);
      const [x, y] = point(e);

      if (tool === 'picker') {
        const ctx = canvasRef.current?.getContext('2d', { willReadFrequently: true });
        if (ctx) {
          const px = ctx.getImageData(x, y, 1, 1).data;
          applyColor(
            `#${[px[0], px[1], px[2]].map((n) => n.toString(16).padStart(2, '0')).join('')}`,
          );
        }
        setTool('brush');
        return;
      }

      if (tool === 'fill') {
        commit({ t: 'fill', c: color, x, y });
        return;
      }

      drawingRef.current = true;
      const paint = tool === 'eraser' ? PAPER : color;

      if (tool === 'brush' || tool === 'eraser') {
        draftRef.current = { t: 'stroke', c: paint, w: width, p: [x, y] };
      } else {
        draftRef.current = { t: tool, c: paint, w: width, x1: x, y1: y, x2: x, y2: y, f: filled };
      }
      repaint();
    };

    const onMove = (e: React.PointerEvent) => {
      if (!drawingRef.current || !draftRef.current) return;
      const [x, y] = point(e);
      const d = draftRef.current;

      if (d.t === 'stroke') {
        const p = d.p!;
        // Skip sub-pixel jitter; it triples the payload for no visible gain.
        if (Math.abs(x - p[p.length - 2]) + Math.abs(y - p[p.length - 1]) < 2) return;
        p.push(x, y);
      } else {
        d.x2 = x;
        d.y2 = y;
      }
      repaint();
    };

    const onUp = () => {
      if (!drawingRef.current || !draftRef.current) return;
      drawingRef.current = false;
      const op = draftRef.current;
      draftRef.current = null;
      commit(op);
    };

    const undo = () => {
      const last = opsRef.current[opsRef.current.length - 1];
      if (!last) return;
      redoRef.current = [last, ...redoRef.current];
      opsRef.current = opsRef.current.slice(0, -1);
      repaint();
      bump((n) => n + 1);
    };

    const redo = () => {
      const [first, ...rest] = redoRef.current;
      if (!first) return;
      redoRef.current = rest;
      opsRef.current = [...opsRef.current, first];
      repaint();
      bump((n) => n + 1);
    };

    const clear = () => {
      redoRef.current = [];
      opsRef.current = [];
      repaint();
      bump((n) => n + 1);
    };

    /* ------------------------------------------------------ colour wheel -- */
    const wheelPick = (e: React.PointerEvent<HTMLDivElement>) => {
      const r = e.currentTarget.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      const h = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
      const next = (h + 360) % 360;
      setHue(next);
      applyColor(hsvToHex(next, sat, val));
    };

    const svPick = (e: React.PointerEvent<HTMLDivElement>) => {
      const r = e.currentTarget.getBoundingClientRect();
      const s = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      const v = 1 - Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
      setSat(s);
      setVal(v);
      applyColor(hsvToHex(hue, s, v));
    };

    return (
      <>
        <div className="canvas-frame" style={{ background: PAPER }}>
          <canvas
            ref={canvasRef}
            width={CANVAS_W}
            height={CANVAS_H}
            style={{ cursor: disabled ? 'default' : tool === 'picker' ? 'copy' : 'crosshair' }}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
          />
        </div>

        <div className="draw-tools">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              className="tool-btn"
              data-on={tool === t.id}
              title={t.label}
              aria-label={t.label}
              onClick={() => setTool(t.id)}
            >
              <Icon name={t.icon} size={16} />
            </button>
          ))}

          <span className="tool-sep" />

          {SIZES.map((w) => (
            <button
              key={w}
              className="tool-btn"
              data-on={w === width}
              title={`Size ${w}`}
              aria-label={`Brush size ${w}`}
              onClick={() => setWidth(w)}
            >
              <span
                style={{
                  width: Math.min(w, 18),
                  height: Math.min(w, 18),
                  borderRadius: '50%',
                  background: 'currentColor',
                  display: 'block',
                }}
              />
            </button>
          ))}

          {(tool === 'rect' || tool === 'ellipse') && (
            <>
              <span className="tool-sep" />
              <button
                className="tool-btn"
                data-on={filled}
                title="Filled shape"
                onClick={() => setFilled((f) => !f)}
              >
                <Icon name={filled ? 'circle' : 'ban'} size={15} />
              </button>
            </>
          )}

          <span className="tool-sep" />

          <button className="tool-btn" onClick={undo} disabled={opsRef.current.length === 0} title="Undo">
            <Icon name="undo" size={16} />
          </button>
          <button className="tool-btn" onClick={redo} disabled={redoRef.current.length === 0} title="Redo">
            <Icon name="undo" size={16} style={{ transform: 'scaleX(-1)' }} />
          </button>
          <button className="tool-btn" onClick={clear} disabled={opsRef.current.length === 0} title="Clear">
            <Icon name="trash" size={16} />
          </button>
        </div>

        <div className="color-panel">
          <div
            className="wheel"
            onPointerDown={wheelPick}
            onPointerMove={(e) => e.buttons === 1 && wheelPick(e)}
            role="slider"
            aria-label="Hue"
            aria-valuenow={Math.round(hue)}
            tabIndex={0}
          >
            <div
              className="wheel-knob"
              style={{ transform: `rotate(${hue}deg) translateY(-30px)` }}
            />
            <div className="wheel-hole" style={{ background: color }} />
          </div>

          <div
            className="sv"
            style={{
              background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${hue} 100% 50%))`,
            }}
            onPointerDown={svPick}
            onPointerMove={(e) => e.buttons === 1 && svPick(e)}
            role="slider"
            aria-label="Saturation and brightness"
            aria-valuenow={Math.round(sat * 100)}
            tabIndex={0}
          >
            <div className="sv-knob" style={{ left: `${sat * 100}%`, top: `${(1 - val) * 100}%` }} />
          </div>

          <div style={{ flex: 1, minWidth: 130 }}>
            <div className="label" style={{ padding: '0 0 6px' }}>Palette</div>
            <div className="swatches">
              {PRESETS.map((c) => (
                <button
                  key={c}
                  className="swatch"
                  style={{ ['--sw' as string]: c, width: 22, height: 22 }}
                  data-sel={c === color}
                  onClick={() => applyColor(c)}
                  aria-label={`Colour ${c}`}
                />
              ))}
            </div>

            {recent.length > 0 && (
              <>
                <div className="label" style={{ padding: '10px 0 6px' }}>Recent</div>
                <div className="swatches">
                  {recent.map((c) => (
                    <button
                      key={c}
                      className="swatch"
                      style={{ ['--sw' as string]: c, width: 22, height: 22 }}
                      data-sel={c === color}
                      onClick={() => applyColor(c)}
                      aria-label={`Recent colour ${c}`}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </>
    );
  },
);

/** Replay a finished drawing at whatever size the album needs. */
export function StrokeReplay({ ops, width = 440 }: { ops: DrawOp[]; width?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    renderOps(ctx, ops ?? []);
  }, [ops]);

  return (
    <div className="canvas-frame" style={{ width, background: PAPER }}>
      <canvas ref={ref} width={CANVAS_W} height={CANVAS_H} style={{ width: '100%' }} />
    </div>
  );
}
