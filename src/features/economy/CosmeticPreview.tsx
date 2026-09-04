import { useEffect, useRef } from 'react';
import {
  celebrationText,
  paintBall,
  paintGoalEffect,
  paintTrail,
  type TrailPoint,
} from './cosmetics';

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
  kind: 'trail' | 'goalfx' | 'celebration' | 'ball';
  accent: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    let raf = 0;
    let tick = 0;
    const history: TrailPoint[] = [];

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
  }, [id, kind, accent]);

  return <canvas ref={ref} width={W} height={H} className="cosmetic-preview" />;
}
