/**
 * How each cosmetic actually looks.
 *
 * Prices and ownership live in the database (a client that sets its own prices
 * is not a shop). What an item *does* is behaviour, so it lives here, keyed by
 * the same id. An unknown id falls back to the plain version rather than
 * crashing the render loop, which matters because this runs 60 times a second.
 */

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';

export const RARITY_COLOR: Record<Rarity, string> = {
  common: '#8a8f98',
  rare: '#4a9de0',
  epic: '#9b5de5',
  legendary: '#e6b422',
};

export interface TrailPoint {
  x: number;
  y: number;
  /** 0 = oldest, 1 = newest. */
  age: number;
}

/* ------------------------------------------------------------------ trails */

type TrailPainter = (
  ctx: CanvasRenderingContext2D,
  points: TrailPoint[],
  accent: string,
  tick: number,
) => void;

const TRAILS: Record<string, TrailPainter> = {
  trail_none: () => {},

  trail_comet: (ctx, pts, accent) => {
    for (const p of pts) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 8 * p.age, 0, Math.PI * 2);
      ctx.fillStyle = withAlpha(accent, 0.35 * p.age);
      ctx.fill();
    }
  },

  trail_ember: (ctx, pts, accent, tick) => {
    pts.forEach((p, i) => {
      const flicker = 0.6 + 0.4 * Math.sin((tick + i * 7) / 4);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6 * p.age * flicker, 0, Math.PI * 2);
      ctx.fillStyle = withAlpha(i % 3 === 0 ? '#f0b429' : accent, 0.5 * p.age);
      ctx.fill();
    });
  },

  trail_frost: (ctx, pts) => {
    for (const p of pts) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.strokeStyle = withAlpha('#9fd8ff', 0.55 * p.age);
      ctx.lineWidth = 1.6;
      for (let a = 0; a < 3; a++) {
        const r = 7 * p.age;
        const ang = (a * Math.PI) / 3;
        ctx.beginPath();
        ctx.moveTo(-Math.cos(ang) * r, -Math.sin(ang) * r);
        ctx.lineTo(Math.cos(ang) * r, Math.sin(ang) * r);
        ctx.stroke();
      }
      ctx.restore();
    }
  },

  trail_ink: (ctx, pts) => {
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.strokeStyle = 'rgba(12,12,16,0.55)';
    ctx.lineWidth = 13;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
  },

  trail_rainbow: (ctx, pts, _accent, tick) => {
    pts.forEach((p, i) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 8 * p.age, 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${(tick * 4 + i * 22) % 360} 90% 60% / ${0.5 * p.age})`;
      ctx.fill();
    });
  },

  trail_glitch: (ctx, pts, accent, tick) => {
    pts.forEach((p, i) => {
      const jitter = ((tick + i * 13) % 7) - 3;
      ctx.fillStyle = withAlpha(i % 2 ? '#39ffd0' : accent, 0.45 * p.age);
      ctx.fillRect(p.x - 5 + jitter, p.y - 5, 10 * p.age, 10 * p.age);
    });
  },

  trail_starfield: (ctx, pts, _accent, tick) => {
    pts.forEach((p, i) => {
      const r = 7 * p.age;
      const spin = (tick + i * 9) / 18;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(spin);
      ctx.beginPath();
      for (let k = 0; k < 5; k++) {
        const a = (k * 2 * Math.PI) / 5 - Math.PI / 2;
        const b = a + Math.PI / 5;
        ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        ctx.lineTo(Math.cos(b) * r * 0.45, Math.sin(b) * r * 0.45);
      }
      ctx.closePath();
      ctx.fillStyle = withAlpha('#ffe9a8', 0.75 * p.age);
      ctx.fill();
      ctx.restore();
    });
  },
};

export function paintTrail(
  id: string | undefined,
  ctx: CanvasRenderingContext2D,
  points: TrailPoint[],
  accent: string,
  tick: number,
): void {
  if (!points.length) return;
  (TRAILS[id ?? 'trail_none'] ?? TRAILS.trail_none)(ctx, points, accent, tick);
}

/* ----------------------------------------------------------- goal effects */

type FxPainter = (
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  /** 0 at the moment of the goal, 1 when the celebration ends. */
  t: number,
  accent: string,
) => void;

/** Deterministic pseudo-random, so every client draws the same burst. */
function rand(i: number): number {
  const x = Math.sin(i * 127.1) * 43758.5453;
  return x - Math.floor(x);
}

const EFFECTS: Record<string, FxPainter> = {
  fx_none: () => {},

  fx_confetti: (ctx, w, h, t) => {
    for (let i = 0; i < 90; i++) {
      const x = rand(i) * w;
      const y = (rand(i + 99) + t * 1.5) * h - h * 0.2;
      if (y < 0 || y > h) continue;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rand(i + 7) * 6 + t * 8);
      ctx.fillStyle = `hsl(${Math.floor(rand(i + 3) * 360)} 85% 62%)`;
      ctx.fillRect(-3, -6, 6, 12);
      ctx.restore();
    }
  },

  fx_shockwave: (ctx, w, h, t, accent) => {
    for (const delay of [0, 0.18, 0.36]) {
      const p = t - delay;
      if (p <= 0 || p > 1) continue;
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, p * w * 0.7, 0, Math.PI * 2);
      ctx.strokeStyle = withAlpha(accent, (1 - p) * 0.8);
      ctx.lineWidth = 8 * (1 - p);
      ctx.stroke();
    }
  },

  fx_fireworks: (ctx, w, h, t) => {
    for (let s = 0; s < 3; s++) {
      const p = t - s * 0.22;
      if (p <= 0 || p > 1) continue;
      const cx = w * (0.25 + s * 0.25);
      const cy = h * (0.3 + rand(s) * 0.2);
      for (let i = 0; i < 26; i++) {
        const a = (i / 26) * Math.PI * 2;
        const r = p * 110;
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r + p * p * 40, 3 * (1 - p), 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${(s * 90 + i * 4) % 360} 90% 65% / ${1 - p})`;
        ctx.fill();
      }
    }
  },

  fx_flames: (ctx, w, h, t) => {
    for (let i = 0; i < 60; i++) {
      const x = rand(i) * w;
      const rise = ((rand(i + 5) + t * 2) % 1) * h;
      const y = h - rise;
      const size = 16 * (1 - rise / h);
      ctx.beginPath();
      ctx.arc(x, y, Math.max(0, size), 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${20 + rand(i + 2) * 30} 100% ${50 + rand(i) * 15}% / ${
        0.55 * (1 - rise / h)
      })`;
      ctx.fill();
    }
  },

  fx_blackhole: (ctx, w, h, t) => {
    const cx = w / 2;
    const cy = h / 2;
    const pull = Math.sin(t * Math.PI);
    for (let i = 0; i < 70; i++) {
      const a = rand(i) * Math.PI * 2 + t * 3;
      const r = (1 - pull) * (60 + rand(i + 4) * 260);
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(190,150,255,${0.7 * pull})`;
      ctx.fill();
    }
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 90 * pull + 1);
    g.addColorStop(0, `rgba(0,0,0,${0.9 * pull})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  },

  fx_aurora: (ctx, w, h, t) => {
    for (let band = 0; band < 4; band++) {
      ctx.beginPath();
      for (let x = 0; x <= w; x += 12) {
        const y =
          h * 0.22 +
          band * 26 +
          Math.sin(x / 90 + t * 4 + band) * 26 +
          Math.sin(x / 33 - t * 2) * 8;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = `hsla(${150 + band * 30} 90% 65% / ${0.42 * Math.sin(t * Math.PI)})`;
      ctx.lineWidth = 22;
      ctx.stroke();
    }
  },
};

export function paintGoalEffect(
  id: string | undefined,
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  t: number,
  accent: string,
): void {
  (EFFECTS[id ?? 'fx_none'] ?? EFFECTS.fx_none)(ctx, w, h, Math.min(1, Math.max(0, t)), accent);
}

/* ----------------------------------------------------------- celebrations */

export const CELEBRATIONS: Record<string, string> = {
  cel_none: '',
  cel_gg: 'GG',
  cel_easy: 'TOO EASY',
  cel_wow: 'WOW',
  cel_nutmeg: 'NUTMEG!',
  cel_worldclass: 'WORLD CLASS',
  cel_siuu: 'SIUUU',
  cel_goat: 'SIMPLY THE GOAT',
};

export function celebrationText(id: string | undefined): string {
  return CELEBRATIONS[id ?? 'cel_none'] ?? '';
}

/* ---------------------------------------------------------------- helpers */

export function withAlpha(hex: string, alpha: number): string {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
