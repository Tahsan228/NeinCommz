import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { AVATAR_SHRINK, formatBytes } from '../../lib/image';

const OUT = 512;
const VIEW = 300;

/**
 * Crop, zoom and straighten a picture before it becomes an avatar.
 *
 * Avatars are drawn as a circle everywhere, so letting the browser centre-crop
 * whatever was uploaded means faces end up half out of frame. This puts the
 * framing in the hands of the person whose face it is.
 *
 * The output is always a square, which is what a circular mask actually needs.
 */
export function AvatarCropper({
  file,
  onCancel,
  onDone,
}: {
  file: File;
  onCancel: () => void;
  onDone: (cropped: File) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  /* -------------------------------------------------------------- load -- */
  useEffect(() => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      setReady(true);
    };
    img.onerror = () =>
      setError(
        "This browser can't read that image. HEIC photos from an iPhone usually need converting to JPEG first.",
      );
    img.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  /* ------------------------------------------------------------- paint -- */
  // Draws the working square at OUT resolution; the canvas is displayed
  // smaller, so what you frame is exactly what gets saved.
  const paint = useCallback(
    (target: HTMLCanvasElement, size: number, withMask: boolean) => {
      const img = imgRef.current;
      const ctx = target.getContext('2d');
      if (!img || !ctx) return;

      const scale = size / OUT;
      ctx.save();
      ctx.fillStyle = '#15151a';
      ctx.fillRect(0, 0, size, size);

      ctx.translate(size / 2 + offset.x * scale, size / 2 + offset.y * scale);
      ctx.rotate((rotation * Math.PI) / 180);

      // Start by covering the square, then apply the zoom on top.
      const cover = Math.max(OUT / img.width, OUT / img.height) * zoom * scale;
      const w = img.width * cover;
      const h = img.height * cover;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, -w / 2, -h / 2, w, h);
      ctx.restore();

      if (withMask) {
        // Dim everything outside the circle so the crop is obvious.
        ctx.save();
        ctx.fillStyle = 'rgba(10,10,14,0.62)';
        ctx.beginPath();
        ctx.rect(0, 0, size, size);
        ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2, true);
        ctx.fill();

        ctx.beginPath();
        ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
      }
    },
    [offset, rotation, zoom],
  );

  useEffect(() => {
    if (!ready || !canvasRef.current) return;
    paint(canvasRef.current, VIEW, true);
  }, [ready, paint]);

  /* --------------------------------------------------------- dragging -- */
  const onDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
  };

  const onMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    // The canvas is shown at VIEW but framed at OUT, so drags scale up.
    const k = OUT / VIEW;
    setOffset({ x: d.ox + (e.clientX - d.x) * k, y: d.oy + (e.clientY - d.y) * k });
  };

  const onUp = () => {
    dragRef.current = null;
  };

  /* ------------------------------------------------------------- save -- */
  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const out = document.createElement('canvas');
      out.width = OUT;
      out.height = OUT;
      paint(out, OUT, false);

      const type = 'image/webp';
      const blob = await new Promise<Blob | null>((r) => out.toBlob(r, type, 0.9));
      if (!blob) throw new Error('Could not save that crop.');

      if (blob.size > AVATAR_SHRINK.targetBytes * 3) {
        throw new Error('That came out unexpectedly large. Try a smaller source image.');
      }

      const name = file.name.replace(/\.[^.]+$/, '') || 'avatar';
      onDone(new File([blob], `${name}.webp`, { type }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that crop.');
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Frame your picture"
      onClose={onCancel}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn btn-accent" onClick={() => void save()} disabled={!ready || busy}>
            <Icon name="check" size={15} />
            Use this
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
        <canvas
          ref={canvasRef}
          width={VIEW}
          height={VIEW}
          className="cropper"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onWheel={(e) => setZoom((z) => Math.min(4, Math.max(1, z - e.deltaY * 0.0012)))}
        />

        <div style={{ width: '100%', maxWidth: 320 }}>
          <label style={{ display: 'block', fontSize: 12, color: 'var(--ink-dim)', marginBottom: 6 }}>
            Zoom
          </label>
          <input
            className="slider"
            style={{ width: '100%' }}
            type="range"
            min={1}
            max={4}
            step={0.01}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            aria-label="Zoom"
          />
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
          <button className="btn btn-sm" onClick={() => setRotation((r) => r - 90)}>
            <Icon name="undo" size={15} />
            Rotate left
          </button>
          <button className="btn btn-sm" onClick={() => setRotation((r) => r + 90)}>
            <Icon name="undo" size={15} style={{ transform: 'scaleX(-1)' }} />
            Rotate right
          </button>
          <button
            className="btn btn-sm btn-ghost"
            onClick={() => {
              setZoom(1);
              setRotation(0);
              setOffset({ x: 0, y: 0 });
            }}
          >
            Reset
          </button>
        </div>

        <p className="row-sub" style={{ textAlign: 'center', margin: 0 }}>
          Drag to move, scroll to zoom. Saved as a {OUT}×{OUT} square —
          about {formatBytes(AVATAR_SHRINK.targetBytes)} at most.
        </p>

        {error && <p className="err">{error}</p>}
      </div>
    </Modal>
  );
}
