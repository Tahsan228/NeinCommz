import { useEffect, useRef, useState } from 'react';
import {
  celebrationText,
  paintBall,
  paintGoalEffect,
  paintTrail,
  type TrailPoint,
} from './cosmetics';
import { BANNERS, BANNER_ANIMS, paintBanner } from './banners';
import { flagCodeOf, paintFlagDisc } from './flags';

const W = 190;
const H = 84;

/**
 * A live preview of what an item does, rather than a static swatch.
 *
 * Cosmetics are motion — a trail is only a trail once it is moving — so a
 * still image would tell you nothing about what you are about to spend coins
 * on. Each card animates a short loop.
 */
export function CosmeticPreview({
  id,
  kind,
  accent,
}: {
  id: string;
  kind: 'trail' | 'goalfx' | 'celebration' | 'ball' | 'banner' | 'banneranim' | 'flag';
  accent: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  /**
   * Whether this card is actually on screen.
   *
   * The Countries tab holds nearly two hundred cards. Every one of them used
   * to run its own animation loop from the moment it mounted, on screen or
   * not, which is two hundred canvases repainting sixty times a second for
   * the sake of the four you can see. That is what made the shop crawl.
   *
   * Starts true where there is no observer to ask, so a browser without one
   * gets the old behaviour rather than a grid of blank squares.
   */
  const [visible, setVisible] = useState(typeof IntersectionObserver === 'undefined');

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || typeof IntersectionObserver === 'undefined') return;

    // A generous margin, so a card is painted just before it is scrolled to
    // rather than popping in blank underneath the cursor.
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { rootMargin: '200px' },
    );
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  /**
   * A flag does not move, so there is nothing for a loop to show. Painting it
   * once is not an optimisation, it is the correct amount of work.
   */
  const still = kind === 'flag';

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !visible) return;

    let raf = 0;
    let tick = 0;
    const history: TrailPoint[] = [];

    if (still) {
      // Shown the way it is worn: a player disc, ringed in a team colour.
      ctx.fillStyle = '#16221a';
      ctx.fillRect(0, 0, W, H);
      const r = 27;
      paintFlagDisc(ctx, W / 2, H / 2, r, flagCodeOf(id));
      ctx.beginPath();
      ctx.arc(W / 2, H / 2, r, 0, Math.PI * 2);
      ctx.lineWidth = 5;
      ctx.strokeStyle = accent;
      ctx.stroke();
      return;
    }

    const draw = () => {
      raf = requestAnimationFrame(draw);
      tick++;

      ctx.fillStyle = '#16221a';
      ctx.fillRect(0, 0, W, H);

      if (kind === 'ball') {
        // Rolls across and back, so spinning designs show their motion.
        const t = tick / 40;
        const x = W / 2 + Math.sin(t) * (W / 2 - 30);
        paintBall(id, ctx, x, H / 2, 22, accent, tick);
      } else if (kind === 'trail') {
        // A ball tracing a lazy figure of eight, so the trail has curvature
        // to show off rather than a straight line.
        const t = tick / 34;
        const x = W / 2 + Math.sin(t) * (W / 2 - 22);
        const y = H / 2 + Math.sin(t * 2) * (H / 2 - 20);

        history.push({ x, y, age: 1 });
        if (history.length > 22) history.shift();
        history.forEach((p, i) => (p.age = (i + 1) / history.length));

        paintTrail(id, ctx, history, accent, tick);

        ctx.beginPath();
        ctx.arc(x, y, 7, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();
      } else if (kind === 'goalfx') {
        // Loop the burst with a short pause, the way it reads in a match.
        const cycle = (tick % 150) / 110;
        if (cycle <= 1) paintGoalEffect(id, ctx, W, H, cycle, accent);
        else {
          ctx.fillStyle = 'rgba(255,255,255,0.5)';
          ctx.font = '700 15px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('GOAL', W / 2, H / 2 + 5);
        }
      } else if (kind === 'banner' || kind === 'banneranim') {
        // The card as it actually arrives: the same pop-in, hold and fade the
        // pitch gives it, looped so the entrance can be watched more than once.
        const cycle = (tick % 260) / 260;
        // A motion swatch shows a stand-in card; a card swatch shows it still.
        const banner = kind === 'banner' ? id : 'ban_trophy';
        const anim = kind === 'banneranim' ? id : 'anim_still';
        if (!BANNERS[banner]?.glyph) {
          ctx.fillStyle = 'rgba(255,255,255,0.45)';
          ctx.font = '600 13px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('— no card —', W / 2, H / 2 + 5);
        } else {
          paintBanner(banner, anim, ctx, W + 34, H * 1.9, cycle, tick, accent, 'You');
          if (kind === 'banneranim') {
            ctx.fillStyle = 'rgba(255,255,255,0.7)';
            ctx.font = '700 11px system-ui, sans-serif';
            ctx.textAlign = 'left';
            ctx.fillText(BANNER_ANIMS[id]?.label ?? '', 8, H - 8);
          }
        }
      } else {
        const text = celebrationText(id);
        const pop = Math.min(1, ((tick % 130) / 22));
        ctx.save();
        ctx.translate(W / 2, H / 2);
        ctx.scale(0.85 + pop * 0.15, 0.85 + pop * 0.15);
        ctx.globalAlpha = pop;
        ctx.font = `700 ${text.length > 10 ? 15 : 21}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillStyle = accent;
        ctx.fillText(text || '— silence —', 0, 7);
        ctx.restore();
      }
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [id, kind, accent, still, visible]);

  return <canvas ref={ref} width={W} height={H} className="cosmetic-preview" />;
}
