import { describe, expect, it } from 'vitest';
import { drawPitch } from '../src/features/games/haxball/HaxballGame';
import {
  COUNTRIES,
  flagCodeOf,
  flagItemId,
  paintFlag,
  paintFlagDisc,
} from '../src/features/economy/flags';
import { BANNERS, BANNER_ANIMS, paintBanner } from '../src/features/economy/banners';
import { paintBall, paintGoalEffect, paintTrail } from '../src/features/economy/cosmetics';
import {
  DEFAULT_RULES,
  EVENTS,
  EVENT_KINDS,
  WEATHER_KINDS,
  createWorld,
} from '../src/features/games/haxball/physics';
import type { Profile, UUID } from '../src/lib/types';

/**
 * A frame of the game is the one place in it that can fail silently and take
 * everything with it: a canvas call that throws stops the animation loop dead
 * for whoever hit it, and nothing on screen says why. These do not check that
 * anything *looks* right — no test can — only that every combination of
 * weather, catastrophe and cosmetic can actually be painted.
 */

/** A canvas that records nothing and refuses nothing. */
function fakeCtx(): CanvasRenderingContext2D {
  const gradient = { addColorStop: () => {} };
  const store: Record<string | symbol, unknown> = { globalAlpha: 1 };

  return new Proxy(store, {
    get(target, prop) {
      if (prop === 'measureText') return () => ({ width: 40 });
      if (prop === 'createRadialGradient' || prop === 'createLinearGradient') {
        return () => gradient;
      }
      if (prop in target) return target[prop];
      return () => undefined;
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

/**
 * A canvas that writes down everything asked of it.
 *
 * Enough to compare two paints for equality, which is the only way to check
 * that something genuinely does not animate.
 */
function recordingCtx(): { ctx: CanvasRenderingContext2D; log: string[] } {
  const log: string[] = [];
  const gradient = { addColorStop: (...a: unknown[]) => log.push(`stop(${a.join()})`) };
  const store: Record<string | symbol, unknown> = { globalAlpha: 1 };

  const ctx = new Proxy(store, {
    get(target, prop) {
      if (prop === 'measureText') return () => ({ width: 40 });
      if (prop === 'createRadialGradient' || prop === 'createLinearGradient') {
        return (...a: unknown[]) => {
          log.push(`${String(prop)}(${a.join()})`);
          return gradient;
        };
      }
      if (prop in target) return target[prop];
      return (...a: unknown[]) => log.push(`${String(prop)}(${a.join()})`);
    },
    set(target, prop, value) {
      log.push(`${String(prop)}=${String(value)}`);
      target[prop] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;

  return { ctx, log };
}

const profiles = new Map<UUID, Profile>();

const cosmetics = {
  trail: [{ x: 10, y: 10, age: 0.5 }],
  equippedOf: () => ({ ball: 'ball_flag_br', trail: 'trail_comet', goalfx: 'fx_confetti' }),
};

describe('painting a frame', () => {
  it('draws a plain match', () => {
    const w = createWorld([{ id: 'a', team: 0 }, { id: 'b', team: 1 }]);
    w.countdown = 0;
    expect(() => drawPitch(fakeCtx(), w, 'a', profiles, cosmetics)).not.toThrow();
  });

  it('draws the countdown, which has its own overlay', () => {
    const w = createWorld([{ id: 'a', team: 0 }]);
    expect(w.countdown).toBeGreaterThan(0);
    expect(() => drawPitch(fakeCtx(), w, 'a', profiles, cosmetics)).not.toThrow();
  });

  it('draws every kind of weather', () => {
    for (const weather of WEATHER_KINDS) {
      const w = createWorld([{ id: 'a', team: 0 }], { ...DEFAULT_RULES, weather });
      w.countdown = 0;
      w.tick = 400;
      expect(() => drawPitch(fakeCtx(), w, 'a', profiles, cosmetics), weather).not.toThrow();
    }
  });

  it('draws every catastrophe, at the start, the middle and the end', () => {
    for (const kind of EVENT_KINDS) {
      for (const through of [0, 0.5, 0.99]) {
        const w = createWorld([{ id: 'a', team: 0 }], { ...DEFAULT_RULES, events: true });
        w.countdown = 0;
        w.tick = 500;
        const total = EVENTS[kind].ticks;
        w.event = {
          kind,
          total,
          ticks: Math.max(1, Math.round(total * (1 - through))),
          x: w.pitch.w / 2,
          y: w.pitch.h / 2,
        };
        // Meteors and pitch invaders live in their own list.
        w.intruders = [
          { x: 100, y: 100, vx: 1, vy: 1, kind: 0, ttl: 60 },
          { x: 200, y: 150, vx: 0, vy: 0, kind: 1, ttl: 70 },
          { x: 240, y: 190, vx: 0, vy: 0, kind: 1, ttl: 20 },
        ];
        expect(() => drawPitch(fakeCtx(), w, 'a', profiles, cosmetics), kind).not.toThrow();
      }
    }
  });

  it('draws the goal celebration, when the crowd is on its feet', () => {
    const w = createWorld([{ id: 'a', team: 0 }, { id: 'b', team: 1 }]);
    w.countdown = 0;
    w.celebrating = 300;
    expect(() => drawPitch(fakeCtx(), w, 'a', profiles, cosmetics)).not.toThrow();
  });

  it('keeps the crowd moving', () => {
    // A stand that does not move reads as a border rather than as people, so
    // "the picture changes between ticks" is the property worth holding on to.
    const w = createWorld([{ id: 'a', team: 0 }]);
    w.countdown = 0;

    const early = recordingCtx();
    w.tick = 100;
    drawPitch(early.ctx, w, 'a', profiles, cosmetics);

    const late = recordingCtx();
    w.tick = 137;
    drawPitch(late.ctx, w, 'a', profiles, cosmetics);

    expect(late.log).not.toEqual(early.log);
  });

  it('gets the crowd up when a goal goes in', () => {
    // They jump higher while a goal is being celebrated, so the same tick
    // has to paint differently depending on whether one just went in.
    const calm = createWorld([{ id: 'a', team: 0 }]);
    calm.countdown = 0;
    calm.tick = 200;

    const cheering = createWorld([{ id: 'a', team: 0 }]);
    cheering.countdown = 0;
    cheering.tick = 200;
    cheering.celebrating = 300;
    // Same player positions, so only the crowd can differ.
    cheering.players[0].x = calm.players[0].x;
    cheering.players[0].y = calm.players[0].y;

    const a = recordingCtx();
    drawPitch(a.ctx, calm, 'a', profiles, cosmetics);
    const b = recordingCtx();
    drawPitch(b.ctx, cheering, 'a', profiles, cosmetics);

    expect(b.log).not.toEqual(a.log);
  });

  it('draws orbs of every kind, curses included', () => {
    const w = createWorld([{ id: 'a', team: 0 }], {
      ...DEFAULT_RULES,
      powerUps: true,
      curses: true,
    });
    w.countdown = 0;
    expect(() => drawPitch(fakeCtx(), w, 'a', profiles, cosmetics)).not.toThrow();
  });

  it('draws a player carrying everything at once', () => {
    const w = createWorld([{ id: 'a', team: 0 }]);
    w.countdown = 0;
    w.players[0].charge = 1;
    w.players[0].teleports = 3;
    w.players[0].buffs = {
      speed: 60, power: 60, control: 60, aim: 60,
      slow: 60, reverse: 60, butter: 60, blind: 60,
    };
    expect(() => drawPitch(fakeCtx(), w, 'a', profiles, cosmetics)).not.toThrow();
  });
});

describe('cosmetics', () => {
  it('paints every country flag', () => {
    for (const country of COUNTRIES) {
      expect(() => paintFlag(fakeCtx(), country.flag, 13), country.name).not.toThrow();
    }
  });

  it('paints every country into a player disc, by its shop id', () => {
    for (const country of COUNTRIES) {
      const id = flagItemId(country.code);
      expect(flagCodeOf(id)).toBe(country.code);
      expect(paintFlagDisc(fakeCtx(), 50, 50, 15, flagCodeOf(id)), id).toBe(true);
    }
  });

  it('says so rather than drawing nothing for a country it does not know', () => {
    // The caller falls back to its ordinary fill on false, so this is the
    // difference between an unknown code and an invisible player.
    expect(paintFlagDisc(fakeCtx(), 0, 0, 15, 'zz')).toBe(false);
    expect(paintFlagDisc(fakeCtx(), 0, 0, 15, null)).toBe(false);
  });

  it('paints every goal card in every motion, across its whole life', () => {
    for (const banner of Object.keys(BANNERS)) {
      for (const anim of Object.keys(BANNER_ANIMS)) {
        for (const t of [0, 0.2, 0.8, 1]) {
          expect(
            () => paintBanner(banner, anim, fakeCtx(), 900, 500, t, 120, '#fff', 'Someone'),
            `${banner}/${anim}`,
          ).not.toThrow();
        }
      }
    }
  });

  it('paints a country flag the same whatever the clock says', () => {
    // The shop paints a flag once and stops, because a flag does not move —
    // two hundred animation loops for two hundred still pictures is what made
    // the Countries tab crawl. If a flag ever gains a moving part, this is
    // what says so rather than the card quietly freezing on frame one.
    for (const country of COUNTRIES) {
      const first = recordingCtx();
      paintFlag(first.ctx, country.flag, 30);

      const later = recordingCtx();
      paintFlag(later.ctx, country.flag, 30);

      expect(later.log, country.name).toEqual(first.log);
    }
  });

  it('no longer puts a country on the ball', () => {
    // A ball that changes nationality with possession tells you nothing about
    // anybody, which is why this moved to the player.
    const flagId = recordingCtx();
    paintBall(flagItemId('br'), flagId.ctx, 50, 50, 30, '#fff', 0);

    const nonsense = recordingCtx();
    paintBall('ball_not_a_thing', nonsense.ctx, 50, 50, 30, '#fff', 0);

    // Both fall through to the classic ball, so they paint identically.
    expect(flagId.log).toEqual(nonsense.log);
  });

  it('does animate the designed balls, which is why they still get a loop', () => {
    // The other half of the rule above: these are the ones a single paint
    // would break, so the distinction the shop draws has to be real.
    for (const id of ['ball_football', 'ball_disco', 'ball_plasma']) {
      const first = recordingCtx();
      paintBall(id, first.ctx, 50, 50, 30, '#fff', 0);

      const later = recordingCtx();
      paintBall(id, later.ctx, 50, 50, 30, '#fff', 999);

      expect(later.log, id).not.toEqual(first.log);
    }
  });

  it('survives an id nobody has ever heard of', () => {
    expect(() => paintBall('ball_nonsense', fakeCtx(), 0, 0, 13, '#fff', 1)).not.toThrow();
    expect(() => paintFlag(fakeCtx(), { bands: [] }, 13)).not.toThrow();
    expect(() => paintTrail('trail_nope', fakeCtx(), [{ x: 0, y: 0, age: 1 }], '#fff', 1)).not.toThrow();
    expect(() => paintGoalEffect('fx_nope', fakeCtx(), 100, 100, 0.5, '#fff')).not.toThrow();
    expect(() => paintBanner('ban_nope', 'anim_nope', fakeCtx(), 900, 500, 0.5, 1, '#fff', 'x')).not.toThrow();
  });
});

describe('the country list', () => {
  it('has no duplicates', () => {
    const codes = COUNTRIES.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('gives every country a name and at least one band', () => {
    for (const c of COUNTRIES) {
      expect(c.name.length, c.code).toBeGreaterThan(1);
      expect(c.flag.bands.length, c.code).toBeGreaterThan(0);
    }
  });

  it('matches its band weights to its bands where it has them', () => {
    for (const c of COUNTRIES) {
      if (c.flag.weights) expect(c.flag.weights.length, c.code).toBe(c.flag.bands.length);
    }
  });
});
