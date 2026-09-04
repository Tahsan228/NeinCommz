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

  trail_bubbles: (ctx, pts, accent, tick) => {
    pts.forEach((p, i) => {
      const size = 4 + p.age * 7 + Math.sin((tick + i * 11) / 9) * 1.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
      ctx.strokeStyle = withAlpha(accent, 0.5 * p.age);
      ctx.lineWidth = 1.6;
      ctx.stroke();
      // A highlight, which is most of what makes a circle read as a bubble.
      ctx.beginPath();
      ctx.arc(p.x - size * 0.3, p.y - size * 0.3, size * 0.22, 0, Math.PI * 2);
      ctx.fillStyle = withAlpha('#ffffff', 0.55 * p.age);
      ctx.fill();
    });
  },

  trail_lightning: (ctx, pts, _accent, tick) => {
    // Forked arcs between consecutive positions, rebuilt every frame so it
    // crackles instead of sitting still.
    ctx.lineCap = 'round';
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      for (let k = 1; k < 3; k++) {
        const t = k / 3;
        const jitter = Math.sin(tick * 0.7 + i * 3 + k) * 5;
        ctx.lineTo(a.x + (b.x - a.x) * t + jitter, a.y + (b.y - a.y) * t - jitter);
      }
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = withAlpha(i % 2 === 0 ? '#ffffff' : '#9fd8ff', 0.75 * b.age);
      ctx.lineWidth = 2.4 * b.age;
      ctx.stroke();
    }
  },

  trail_petals: (ctx, pts, accent, tick) => {
    pts.forEach((p, i) => {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(tick / 14 + i);
      ctx.beginPath();
      ctx.ellipse(0, 0, 7 * p.age, 3.4 * p.age, 0, 0, Math.PI * 2);
      ctx.fillStyle = withAlpha(i % 2 ? '#ffb7d5' : accent, 0.6 * p.age);
      ctx.fill();
      ctx.restore();
    });
  },

  trail_void: (ctx, pts) => {
    // Punches a hole in whatever was drawn underneath, then edges it in light.
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    for (const p of pts) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 11 * p.age, 0, Math.PI * 2);
      ctx.fillStyle = withAlpha('#000000', 0.9 * p.age);
      ctx.fill();
    }
    ctx.restore();

    for (const p of pts) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 11 * p.age, 0, Math.PI * 2);
      ctx.strokeStyle = withAlpha('#be96ff', 0.5 * p.age);
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }
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

  fx_earthquake: (ctx, w, h, t) => {
    // Cracks spreading from the centre and widening as they go.
    const spread = Math.sin(t * Math.PI);
    ctx.strokeStyle = withAlpha('#14100c', 0.75 * spread);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + rand(i);
      ctx.beginPath();
      ctx.moveTo(w / 2, h / 2);
      let x = w / 2;
      let y = h / 2;
      for (let k = 1; k <= 5; k++) {
        x += Math.cos(a + (rand(i * 5 + k) - 0.5)) * (t * 60);
        y += Math.sin(a + (rand(i * 5 + k) - 0.5)) * (t * 60);
        ctx.lineTo(x, y);
      }
      ctx.lineWidth = 5 * (1 - t) + 1;
      ctx.stroke();
    }
  },

  fx_meteor: (ctx, w, h, t) => {
    const fall = Math.min(1, t / 0.45);
    const x = w * 0.5;
    const y = h * 0.5;

    if (fall < 1) {
      const fx = x - 260 * (1 - fall);
      const fy = y - 300 * (1 - fall);
      ctx.beginPath();
      ctx.moveTo(fx - 40, fy - 46);
      ctx.lineTo(fx, fy);
      ctx.strokeStyle = withAlpha('#ffb450', 0.85);
      ctx.lineWidth = 8;
      ctx.lineCap = 'round';
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(fx, fy, 12, 0, Math.PI * 2);
      ctx.fillStyle = '#ffd08a';
      ctx.fill();
    } else {
      const boom = (t - 0.45) / 0.55;
      ctx.beginPath();
      ctx.arc(x, y, boom * w * 0.55, 0, Math.PI * 2);
      ctx.strokeStyle = withAlpha('#ff963c', 1 - boom);
      ctx.lineWidth = 14 * (1 - boom);
      ctx.stroke();
    }
  },

  fx_snowstorm: (ctx, w, h, t) => {
    const veil = Math.sin(t * Math.PI);
    ctx.fillStyle = withAlpha('#ffffff', 0.35 * veil);
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 150; i++) {
      const x = (rand(i) * w + t * 220) % w;
      const y = (rand(i + 40) * h + t * 420) % h;
      ctx.beginPath();
      ctx.arc(x, y, 1.5 + rand(i + 9) * 2.5, 0, Math.PI * 2);
      ctx.fillStyle = withAlpha('#ffffff', 0.9 * veil);
      ctx.fill();
    }
  },

  fx_supernova: (ctx, w, h, t) => {
    // Builds to a whiteout, then falls away again.
    const flash = t < 0.35 ? t / 0.35 : Math.max(0, 1 - (t - 0.35) / 0.65);
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w * 0.75);
    g.addColorStop(0, withAlpha('#ffffff', flash));
    g.addColorStop(0.35, withAlpha('#ffdc96', flash * 0.8));
    g.addColorStop(1, withAlpha('#ffb450', 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      const r = t * w * 0.7;
      ctx.beginPath();
      ctx.moveTo(w / 2 + Math.cos(a) * r * 0.7, h / 2 + Math.sin(a) * r * 0.7);
      ctx.lineTo(w / 2 + Math.cos(a) * r, h / 2 + Math.sin(a) * r);
      ctx.strokeStyle = withAlpha('#fff0c8', (1 - t) * 0.8);
      ctx.lineWidth = 2;
      ctx.stroke();
    }
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
  cel_ratio: 'RATIO',
  cel_calculated: 'CALCULATED',
  cel_nomistakes: 'NO MISTAKES',
  cel_getgood: 'GET GOOD',
  cel_thanks: 'THANKS, KEEPER',
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

/* ---------------------------------------------------------- ball designs */

type BallPainter = (
  ctx: CanvasRenderingContext2D,
  r: number,
  accent: string,
  tick: number,
) => void;

/** Painters draw at the origin; the caller has already translated and clipped. */
const BALLS: Record<string, BallPainter> = {
  ball_classic: (ctx, r) => {
    const g = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(1, '#c9c9d2');
    ctx.fillStyle = g;
    ctx.fillRect(-r, -r, r * 2, r * 2);
  },

  ball_football: (ctx, r, _a, tick) => {
    ctx.fillStyle = '#f4f4f6';
    ctx.fillRect(-r, -r, r * 2, r * 2);
    // A centre pentagon plus five around it, rotating as the ball travels.
    const spin = tick / 26;
    ctx.fillStyle = '#17171c';
    poly(ctx, 0, 0, r * 0.42, 5, spin);
    for (let i = 0; i < 5; i++) {
      const a = spin + (i * 2 * Math.PI) / 5 + Math.PI / 5;
      poly(ctx, Math.cos(a) * r * 0.82, Math.sin(a) * r * 0.82, r * 0.3, 5, a);
    }
  },

  ball_beach: (ctx, r, _a, tick) => {
    const spin = tick / 30;
    const colors = ['#e0574f', '#ffffff', '#4a9de0', '#ffffff', '#e6b422', '#ffffff'];
    for (let i = 0; i < 6; i++) {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, r, spin + (i * Math.PI) / 3, spin + ((i + 1) * Math.PI) / 3);
      ctx.closePath();
      ctx.fillStyle = colors[i];
      ctx.fill();
    }
  },

  ball_tennis: (ctx, r, _a, tick) => {
    ctx.fillStyle = '#d6e94a';
    ctx.fillRect(-r, -r, r * 2, r * 2);
    ctx.save();
    ctx.rotate(tick / 28);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = r * 0.16;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(side * r * 1.15, 0, r * 0.95, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  },

  ball_eight: (ctx, r) => {
    ctx.fillStyle = '#101014';
    ctx.fillRect(-r, -r, r * 2, r * 2);
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.52, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.fillStyle = '#101014';
    ctx.font = `700 ${Math.round(r * 0.8)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('8', 0, r * 0.04);
    ctx.textBaseline = 'alphabetic';
  },

  ball_disco: (ctx, r, _a, tick) => {
    ctx.fillStyle = '#20202a';
    ctx.fillRect(-r, -r, r * 2, r * 2);
    for (let ring = 0; ring < 3; ring++) {
      const ry = -r + ((ring + 0.5) * 2 * r) / 3;
      for (let i = 0; i < 7; i++) {
        const a = tick / 18 + i + ring;
        ctx.fillStyle = `hsl(${(a * 40) % 360} 70% ${55 + Math.sin(a * 3) * 20}%)`;
        ctx.fillRect(-r + (i * 2 * r) / 7, ry - r * 0.3, (2 * r) / 7 - 1, r * 0.6);
      }
    }
  },

  ball_plasma: (ctx, r, accent, tick) => {
    const pulse = 0.6 + 0.4 * Math.sin(tick / 7);
    const g = ctx.createRadialGradient(0, 0, r * 0.05, 0, 0, r);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.45, withAlpha(accent, 0.95));
    g.addColorStop(1, withAlpha(accent, 0.25 + pulse * 0.4));
    ctx.fillStyle = g;
    ctx.fillRect(-r, -r, r * 2, r * 2);
  },

  ball_cube: (ctx, r, _a, tick) => {
    ctx.fillStyle = '#e8e8ee';
    ctx.fillRect(-r, -r, r * 2, r * 2);
    ctx.save();
    ctx.rotate(tick / 22);
    ctx.fillStyle = '#3a3a46';
    ctx.fillRect(-r * 0.55, -r * 0.55, r * 1.1, r * 1.1);
    ctx.strokeStyle = '#8d8d99';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(-r * 0.55, -r * 0.55, r * 1.1, r * 1.1);
    ctx.restore();
  },

  ball_smiley: (ctx, r) => {
    ctx.fillStyle = '#f5d442';
    ctx.fillRect(-r, -r, r * 2, r * 2);
    ctx.fillStyle = '#3a2c05';
    ctx.beginPath();
    ctx.arc(-r * 0.32, -r * 0.2, r * 0.13, 0, Math.PI * 2);
    ctx.arc(r * 0.32, -r * 0.2, r * 0.13, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, r * 0.05, r * 0.5, 0.25 * Math.PI, 0.75 * Math.PI);
    ctx.strokeStyle = '#3a2c05';
    ctx.lineWidth = r * 0.15;
    ctx.lineCap = 'round';
    ctx.stroke();
  },

  ball_planet: (ctx, r, _a, tick) => {
    const g = ctx.createLinearGradient(0, -r, 0, r);
    g.addColorStop(0, '#c98a4b');
    g.addColorStop(0.5, '#e0b784');
    g.addColorStop(1, '#a86b38');
    ctx.fillStyle = g;
    ctx.fillRect(-r, -r, r * 2, r * 2);

    ctx.strokeStyle = withAlpha('#78461e', 0.5);
    ctx.lineWidth = r * 0.13;
    for (const y of [-0.45, -0.1, 0.28, 0.6]) {
      ctx.beginPath();
      ctx.moveTo(-r, y * r);
      ctx.lineTo(r, y * r);
      ctx.stroke();
    }

    // The ring sits outside the clip, so only its near half shows.
    ctx.save();
    ctx.rotate(-0.35 + Math.sin(tick / 60) * 0.05);
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 1.35, r * 0.3, 0, 0, Math.PI * 2);
    ctx.strokeStyle = withAlpha('#fff0d2', 0.85);
    ctx.lineWidth = r * 0.14;
    ctx.stroke();
    ctx.restore();
  },

  ball_moon: (ctx, r) => {
    ctx.fillStyle = '#b9b9c2';
    ctx.fillRect(-r, -r, r * 2, r * 2);
    for (let i = 0; i < 7; i++) {
      const a = rand(i) * Math.PI * 2;
      const d = rand(i + 3) * r * 0.7;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * d, Math.sin(a) * d, r * (0.1 + rand(i + 6) * 0.16), 0, Math.PI * 2);
      ctx.fillStyle = '#9a9aa6';
      ctx.fill();
    }
  },

  ball_pixel: (ctx, r) => {
    const cells = 6;
    const size = (r * 2) / cells;
    for (let x = 0; x < cells; x++) {
      for (let y = 0; y < cells; y++) {
        const dx = x - (cells - 1) / 2;
        const dy = y - (cells - 1) / 2;
        const far = Math.hypot(dx, dy) / (cells / 2);
        ctx.fillStyle = far > 0.75 ? '#8d8d99' : far > 0.4 ? '#d5d5de' : '#ffffff';
        ctx.fillRect(-r + x * size, -r + y * size, size + 0.5, size + 0.5);
      }
    }
  },
};

function poly(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  sides: number,
  rotation: number,
): void {
  ctx.beginPath();
  for (let i = 0; i < sides; i++) {
    const a = rotation + (i * 2 * Math.PI) / sides;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

/** Draw the ball at (x, y), clipped to its circle so designs cannot spill. */
export function paintBall(
  id: string | undefined,
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  accent: string,
  tick: number,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.clip();
  (BALLS[id ?? 'ball_classic'] ?? BALLS.ball_classic)(ctx, r, accent, tick);
  ctx.restore();

  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.stroke();
}
