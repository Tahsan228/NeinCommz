/**
 * The picture that slides in on the right when you score.
 *
 * A banner is a drawn card rather than an uploaded file on purpose: an image
 * anybody can supply is an image anybody can supply, and this is a shared
 * screen. The set below is fixed; the *motion* is the part you choose, and
 * neither costs a network request in the middle of a match.
 */

export interface BannerLook {
  /** The picture itself. Big, and centred. */
  glyph: string;
  /** Card background. */
  bg: string;
  /** Its edge, which is what makes it read as a card rather than a sticker. */
  ring: string;
  /** A word underneath. Empty for the ones that speak for themselves. */
  caption: string;
}

export const BANNERS: Record<string, BannerLook> = {
  ban_none: { glyph: '', bg: '', ring: '', caption: '' },
  ban_goat: { glyph: '🐐', bg: '#1d1a12', ring: '#e6b422', caption: 'THE GOAT' },
  ban_fire: { glyph: '🔥', bg: '#22110a', ring: '#ff7a3c', caption: 'ON FIRE' },
  ban_rocket: { glyph: '🚀', bg: '#0e1526', ring: '#6ea8ff', caption: 'LIFT OFF' },
  ban_crown: { glyph: '👑', bg: '#1e1806', ring: '#f5d442', caption: 'KING OF THE BOX' },
  ban_trophy: { glyph: '🏆', bg: '#1a1607', ring: '#ffd75e', caption: 'SILVERWARE' },
  ban_skull: { glyph: '💀', bg: '#141418', ring: '#cfd3dc', caption: 'FINISHED' },
  ban_alien: { glyph: '👽', bg: '#0d1a12', ring: '#5ce68a', caption: 'NOT OF THIS EARTH' },
  ban_brain: { glyph: '🧠', bg: '#1c0f1a', ring: '#ff8fd0', caption: 'BIG BRAIN' },
  ban_storm: { glyph: '⚡', bg: '#12161f', ring: '#9fd8ff', caption: 'UNSTOPPABLE' },
  ban_heart: { glyph: '💚', bg: '#0f1a12', ring: '#7ee0a0', caption: 'NO HARD FEELINGS' },
  ban_clown: { glyph: '🤡', bg: '#1a0f18', ring: '#ff7ad1', caption: 'KEEPER?' },
  ban_diamond: { glyph: '💎', bg: '#0c1720', ring: '#7fe3ff', caption: 'FLAWLESS' },
  ban_cat: { glyph: '🐈', bg: '#1a1410', ring: '#ffb870', caption: 'PURRFECT' },
  ban_pizza: { glyph: '🍕', bg: '#1f1408', ring: '#ffb03a', caption: 'DELIVERED' },
};

/** The motion the card is given, which is the part a person chooses. */
export type BannerAnim = (t: number, tick: number) => {
  rotate: number;
  scale: number;
  dy: number;
};

export const BANNER_ANIMS: Record<string, { label: string; run: BannerAnim }> = {
  anim_still: { label: 'Still', run: () => ({ rotate: 0, scale: 1, dy: 0 }) },
  anim_spin: {
    label: 'Constant rotation',
    run: (_t, tick) => ({ rotate: tick / 34, scale: 1, dy: 0 }),
  },
  anim_pulse: {
    label: 'Pulse',
    run: (_t, tick) => ({ rotate: 0, scale: 1 + Math.sin(tick / 7) * 0.07, dy: 0 }),
  },
  anim_bob: {
    label: 'Bob',
    run: (_t, tick) => ({ rotate: 0, scale: 1, dy: Math.sin(tick / 12) * 7 }),
  },
  anim_swing: {
    label: 'Swing',
    run: (_t, tick) => ({ rotate: Math.sin(tick / 14) * 0.16, scale: 1, dy: 0 }),
  },
  anim_wobble: {
    label: 'Wobble',
    run: (_t, tick) => ({
      rotate: Math.sin(tick / 6) * 0.06,
      scale: 1 + Math.sin(tick / 9) * 0.05,
      dy: Math.sin(tick / 15) * 5,
    }),
  },
  anim_drift: {
    label: 'Slow drift',
    run: (t, tick) => ({ rotate: Math.sin(tick / 40) * 0.05, scale: 1 + t * 0.12, dy: -t * 14 }),
  },
};

export const BANNER_ANIM_IDS = Object.keys(BANNER_ANIMS);

export function bannerAnim(id: string | undefined): BannerAnim {
  return (BANNER_ANIMS[id ?? 'anim_still'] ?? BANNER_ANIMS.anim_still).run;
}

/** When the card arrives, and when it starts to leave. */
export const BANNER_IN = 0.12;
export const BANNER_OUT = 0.78;

/**
 * Draw the banner down the right-hand side.
 *
 * `t` is 0..1 across the whole celebration: it pops in over the first eighth,
 * holds, then fades, so the card is never arriving at the moment the replay
 * starts and never still there when play resumes.
 */
export function paintBanner(
  id: string | undefined,
  animId: string | undefined,
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  t: number,
  tick: number,
  accent: string,
  who: string,
): void {
  const look = BANNERS[id ?? 'ban_none'] ?? BANNERS.ban_none;
  if (!look.glyph) return;

  const enter = Math.min(1, Math.max(0, t) / BANNER_IN);
  const leave = t > BANNER_OUT ? Math.min(1, (t - BANNER_OUT) / (1 - BANNER_OUT)) : 0;
  const alpha = Math.min(enter, 1 - leave);
  if (alpha <= 0.01) return;

  // A little overshoot on the way in, because a card that simply appears at
  // its final size reads as a glitch rather than as an entrance.
  const pop = 1 - Math.pow(1 - enter, 3);
  const overshoot = 1 + Math.sin(pop * Math.PI) * 0.12;

  const cardW = Math.max(96, Math.min(172, width * 0.2));
  const cardH = cardW * 1.12;
  const restX = width - cardW / 2 - 22;
  const x = restX + (1 - pop) * (cardW + 40);
  const y = height * 0.4;

  const motion = bannerAnim(animId)(t, tick);
  const scale = overshoot * motion.scale;

  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.translate(x, y + motion.dy);
  ctx.scale(scale, scale);
  ctx.rotate(motion.rotate);

  ctx.beginPath();
  ctx.roundRect(-cardW / 2, -cardH / 2, cardW, cardH, 16);
  ctx.fillStyle = look.bg;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = look.ring;
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${Math.round(cardW * 0.44)}px system-ui, "Segoe UI Emoji", sans-serif`;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(look.glyph, 0, -cardH * 0.12);
  ctx.textBaseline = 'alphabetic';

  if (look.caption) {
    ctx.font = `800 ${Math.round(cardW * 0.1)}px system-ui, sans-serif`;
    ctx.fillStyle = look.ring;
    ctx.fillText(look.caption, 0, cardH * 0.26);
  }

  ctx.font = `600 ${Math.round(cardW * 0.088)}px system-ui, sans-serif`;
  ctx.fillStyle = accent;
  ctx.fillText(who.slice(0, 18), 0, cardH * 0.4);

  ctx.restore();
}
