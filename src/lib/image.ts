/**
 * Client-side image shrinking.
 *
 * An avatar is displayed at 118px at its very largest, so uploading a 24MB
 * phone photo wastes the storage bucket, everyone's bandwidth on every page
 * load, and the person's time. Rather than rejecting big files, we re-encode
 * them in the browser before they ever reach the network — the size limit
 * stops being something the user has to work around.
 */

/** Beyond this a decode risks running the tab out of memory, so refuse early. */
export const MAX_SOURCE_BYTES = 64 * 1024 * 1024;

export interface ShrinkOptions {
  /** Longest edge of the result, in pixels. */
  maxDim: number;
  /** Keep re-encoding until the result fits under this. */
  targetBytes: number;
}

export const AVATAR_SHRINK: ShrinkOptions = { maxDim: 512, targetBytes: 400 * 1024 };
export const CHAT_SHRINK: ShrinkOptions = { maxDim: 2048, targetBytes: 4 * 1024 * 1024 };

/** Does this browser encode WebP? Worth knowing: it keeps alpha and is small. */
let webpSupported: boolean | null = null;
function supportsWebp(): boolean {
  if (webpSupported === null) {
    const c = document.createElement('canvas');
    c.width = 1;
    c.height = 1;
    webpSupported = c.toDataURL('image/webp').startsWith('data:image/webp');
  }
  return webpSupported;
}

async function decode(file: File): Promise<ImageBitmap | HTMLImageElement> {
  // createImageBitmap is the fast path and handles EXIF orientation.
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      /* fall through to the <img> path */
    }
  }

  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () =>
        reject(
          new Error(
            "This browser can't read that image format. HEIC photos from an iPhone often need " +
              'converting to JPEG first.',
          ),
        );
      img.src = url;
    });
  } finally {
    // Safe once decoding has finished either way.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Re-encode `file` so it fits `opts`. Returns the original untouched when it is
 * already small enough and in a format browsers render natively.
 */
export async function shrinkImage(file: File, opts: ShrinkOptions): Promise<File> {
  if (!file.type.startsWith('image/')) throw new Error('That needs to be an image.');
  if (file.size > MAX_SOURCE_BYTES) {
    throw new Error('That file is enormous — over 64 MB. Try a smaller one.');
  }

  // Animated GIFs would lose their animation on a canvas round trip, so they
  // pass through untouched or not at all.
  if (file.type === 'image/gif') {
    if (file.size <= opts.targetBytes) return file;
    throw new Error('That GIF is too large. Try a shorter or smaller one.');
  }

  const source = await decode(file);
  const srcW = 'width' in source ? source.width : 0;
  const srcH = 'height' in source ? source.height : 0;
  if (!srcW || !srcH) throw new Error('That image seems to be empty.');

  const alreadySmall =
    file.size <= opts.targetBytes &&
    Math.max(srcW, srcH) <= opts.maxDim &&
    (file.type === 'image/jpeg' || file.type === 'image/png' || file.type === 'image/webp');
  if (alreadySmall) {
    if ('close' in source) source.close();
    return file;
  }

  const type = supportsWebp() ? 'image/webp' : 'image/jpeg';
  const ext = type === 'image/webp' ? 'webp' : 'jpg';

  let dim = opts.maxDim;
  // Step the quality down, then the dimensions, until it fits. Three rounds is
  // plenty: each dimension halving cuts the pixel count by four.
  for (let attempt = 0; attempt < 3; attempt++) {
    const scale = Math.min(1, dim / Math.max(srcW, srcH));
    const w = Math.max(1, Math.round(srcW * scale));
    const h = Math.max(1, Math.round(srcH * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not process that image.');

    // JPEG has no alpha, so flatten onto white rather than onto black.
    if (type === 'image/jpeg') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
    }
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source as CanvasImageSource, 0, 0, w, h);

    for (const quality of [0.9, 0.8, 0.7, 0.6]) {
      const blob = await toBlob(canvas, type, quality);
      if (blob && blob.size <= opts.targetBytes) {
        if ('close' in source) source.close();
        const name = file.name.replace(/\.[^.]+$/, '') || 'image';
        return new File([blob], `${name}.${ext}`, { type });
      }
    }
    dim = Math.round(dim / 2);
  }

  if ('close' in source) source.close();
  throw new Error('Could not get that image small enough. Try cropping it first.');
}

/** "3.4 MB" */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
