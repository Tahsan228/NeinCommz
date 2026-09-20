/**
 * A small deterministic 2D world: discs on a pitch, elastic collisions, and a
 * ball you charge up and release. Kept free of React and of the network so it
 * can be stepped identically on the host and reasoned about in tests.
 *
 * This is a simplified take on Haxball rather than a clone: same shape of game,
 * considerably simpler collision resolution.
 */

export interface Pitch {
  /** Canvas size. The playing area is this inset by `pad` on every side. */
  w: number;
  h: number;
  /**
   * Playing area inset from the canvas edge.
   *
   * Wide enough to hold a goal *and* the stadium behind it: the surround is
   * not decoration that happens to fit, it is sized here so the netting never
   * has to be drawn off the edge of the canvas.
   */
  pad: number;
  goalHeight: number;
  goalDepth: number;
}

/**
 * Room behind each goal for the terracing, the advertising boards and the
 * apron. Sized so all three genuinely fit: the goal already eats `goalDepth`
 * out of the margin, so anything less than this leaves the boards drawn on
 * top of the netting.
 */
export const SURROUND = 56;

function pitchOf(play: number, tall: number, goalHeight: number, goalDepth: number): Pitch {
  const pad = goalDepth + SURROUND;
  return { w: play + pad * 2, h: tall + pad * 2, pad, goalHeight, goalDepth };
}

// Goals are deliberately generous. A narrow mouth turns every match into a
// scramble in front of the net, and players can now stand in the goal, so the
// mouth has to be wide enough for a keeper and a striker at once.
export const PITCH_PRESETS: Record<'small' | 'normal' | 'big', Pitch> = {
  small: pitchOf(640, 320, 170, 40),
  normal: pitchOf(772, 372, 200, 46),
  big: pitchOf(924, 444, 235, 52),
};

export type PitchSize = keyof typeof PITCH_PRESETS;

/* ------------------------------------------------------------- power-ups - */

/** The helpful ones. */
export type Buff = 'speed' | 'power' | 'control' | 'aim';

/**
 * And the ones nobody wants.
 *
 * Curses are picked up exactly the same way as buffs, because a pitch where
 * you have to read the orb before you run over it is far more interesting
 * than one where every orb is a present.
 */
export type Curse = 'slow' | 'reverse' | 'butter' | 'blind';

export type OrbKind = Buff | Curse | 'teleport';

/** Ordered, because a snapshot sends the index rather than the word. */
export const ORB_KINDS: OrbKind[] = [
  'speed',
  'power',
  'control',
  'aim',
  'teleport',
  'slow',
  'reverse',
  'butter',
  'blind',
];

export const ORB_RARE: OrbKind[] = ['aim', 'teleport'];

export const CURSE_KINDS: Curse[] = ['slow', 'reverse', 'butter', 'blind'];

/** Every timed effect a player can be carrying, good or bad. */
export const EFFECT_KINDS: (Buff | Curse)[] = [
  'speed',
  'power',
  'control',
  'aim',
  'slow',
  'reverse',
  'butter',
  'blind',
];

export function isCurse(kind: OrbKind): kind is Curse {
  return (CURSE_KINDS as string[]).includes(kind);
}

export interface Orb {
  id: number;
  x: number;
  y: number;
  kind: OrbKind;
  /** False while taken; counts down to a respawn. */
  active: boolean;
  respawnIn: number;
}

export const ORB_RADIUS = 13;
/** How long a pick-up lasts, in ticks. */
export const BUFF_TICKS = 60 * 10;
/** Curses are shorter. Being punished for six seconds is plenty. */
export const CURSE_TICKS = 60 * 6;
const ORB_RESPAWN_TICKS = 60 * 12;
const ORB_COUNT = 4;

/** What each buff does to the rules while it is running. */
export const SPEED_MULTIPLIER = 1.75;
export const POWER_MULTIPLIER = 1.6;
export const CONTROL_CHARGE_MULTIPLIER = 3;

/** And what each curse takes away. */
export const SLOW_MULTIPLIER = 0.55;
export const BUTTER_CHARGE_MULTIPLIER = 0.3;

export const PITCH: Pitch = PITCH_PRESETS.normal;

export const PLAYER_R = 15;
export const BALL_R = 13;

/** Goalposts are discs, so a ball off the woodwork behaves like a ball. */
export const POST_R = 8;

/** Three seconds at 60Hz, so everyone can find their player before the whistle. */
export const COUNTDOWN_TICKS = 180;

/**
 * How long the goal sequence runs: a beat on the scorer, the replay, then the
 * fade. Long, because it is meant to be watched rather than sat through.
 */
export const CELEBRATION_TICKS = 60 * 11;

/** A goal in practice is not a broadcast moment; get back to kicking. */
export const PRACTICE_CELEBRATION_TICKS = 150;

const PLAYER_MASS = 1;
const BALL_MASS = 0.55;
const RESTITUTION = 0.62;

/* --------------------------------------------------------------- weather - */

export type Weather = 'clear' | 'rain' | 'snow' | 'wind' | 'fog' | 'storm';

export interface WeatherProfile {
  label: string;
  blurb: string;
  /** Multiplies the ball damping's distance from 1: >1 is slicker. */
  ballSlip: number;
  /** Multiplies player acceleration. */
  grip: number;
  /** Peak wind strength, in acceleration per tick applied to the ball. */
  gust: number;
  /** 0..1 of the pitch obscured. Drawing only; the simulation is unaffected. */
  murk: number;
}

export const WEATHER: Record<Weather, WeatherProfile> = {
  clear: { label: 'Clear', blurb: 'Nothing in the way.', ballSlip: 1, grip: 1, gust: 0, murk: 0 },
  rain: {
    label: 'Rain',
    blurb: 'Slick surface — the ball runs on and nobody stops sharply.',
    ballSlip: 1.6,
    grip: 0.9,
    gust: 0.01,
    murk: 0.1,
  },
  snow: {
    label: 'Snow',
    blurb: 'Heavy going. The ball dies, and so do your legs.',
    ballSlip: 0.45,
    grip: 0.78,
    gust: 0.008,
    murk: 0.26,
  },
  wind: {
    label: 'Wind',
    blurb: 'A crosswind that swings round. Aim off it.',
    ballSlip: 1.1,
    grip: 1,
    gust: 0.05,
    murk: 0,
  },
  fog: {
    label: 'Fog',
    blurb: 'You can see your own half. Mostly.',
    ballSlip: 1,
    grip: 1,
    gust: 0,
    murk: 0.6,
  },
  storm: {
    label: 'Storm',
    blurb: 'Wind, rain and the occasional lightning strike.',
    ballSlip: 1.5,
    grip: 0.85,
    gust: 0.075,
    murk: 0.34,
  },
};

export const WEATHER_KINDS = Object.keys(WEATHER) as Weather[];

/* -------------------------------------------------------------- disasters - */

export type EventKind =
  | 'quake'
  | 'gale'
  | 'blackout'
  | 'swap'
  | 'giant'
  | 'shrink'
  | 'magnet'
  | 'lowgrav'
  | 'meteor'
  | 'stampede'
  | 'icerink'
  | 'sirens';

export interface EventProfile {
  label: string;
  blurb: string;
  /** How long it runs, in ticks. */
  ticks: number;
}

/**
 * Catastrophes, distractions and outright nonsense.
 *
 * Each one is a rule change with an end date rather than a special case in the
 * loop: the step function asks the running event what it wants and applies it,
 * so adding another is a row here plus a branch in `conditions`.
 */
export const EVENTS: Record<EventKind, EventProfile> = {
  quake: { label: 'Earthquake', blurb: 'The ground throws everything about.', ticks: 60 * 5 },
  gale: { label: 'Gale', blurb: 'Wind strong enough to move the ball on its own.', ticks: 60 * 8 },
  blackout: { label: 'Floodlight failure', blurb: 'Nobody can see a thing.', ticks: 60 * 6 },
  swap: { label: 'Ends swapped', blurb: 'Everyone has been moved. Good luck.', ticks: 60 * 2 },
  giant: { label: 'Giant ball', blurb: 'The ball is enormous and will not be ignored.', ticks: 60 * 10 },
  shrink: { label: 'Marble', blurb: 'The ball is tiny and quick.', ticks: 60 * 10 },
  magnet: { label: 'Magnetic ball', blurb: 'It is drawn to whoever is nearest.', ticks: 60 * 8 },
  lowgrav: { label: 'Low gravity', blurb: 'Nothing slows down any more.', ticks: 60 * 9 },
  meteor: { label: 'Meteor shower', blurb: 'Something lands. Be elsewhere.', ticks: 60 * 8 },
  stampede: { label: 'Pitch invasion', blurb: 'Bodies everywhere, shoving as they pass.', ticks: 60 * 8 },
  icerink: { label: 'Ice rink', blurb: 'No grip at all. Plan two seconds ahead.', ticks: 60 * 9 },
  sirens: { label: 'Sirens', blurb: 'Noise, lights and nobody concentrating.', ticks: 60 * 7 },
};

export const EVENT_KINDS = Object.keys(EVENTS) as EventKind[];

export interface WorldEvent {
  kind: EventKind;
  /** Ticks left to run. */
  ticks: number;
  /** How long it was given, so a renderer can work out how far through it is. */
  total: number;
  /** Wherever the event happens to be centred — a meteor, a quake epicentre. */
  x: number;
  y: number;
}

/** Ticks between catastrophes. A match should breathe between them. */
const EVENT_GAP_MIN = 60 * 14;
const EVENT_GAP_SPAN = 60 * 16;

/** Something on the pitch that is not a player and not the ball. */
export interface Intruder {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** 0 = a person on the pitch, 1 = a meteor about to land. */
  kind: 0 | 1;
  ttl: number;
}

/**
 * Everything a host can tune before kickoff. Bundled into the world so the
 * simulation reads its own settings rather than module constants, which is
 * what makes per-room configuration possible at all.
 */
export interface Rules {
  /** Acceleration per tick. Top speed works out near accel * damp / (1 - damp). */
  playerAccel: number;
  playerDamping: number;
  ballDamping: number;
  /** Impulse from a tap with no charge. */
  kickMin: number;
  /** Impulse from a fully charged shot. */
  kickMax: number;
  /** Charge gained per tick while the ball is at your feet. */
  chargeRate: number;
  maxBallSpeed: number;
  /** Goals needed to win. 0 means play forever. */
  scoreLimit: number;
  /** Match length in seconds. 0 means no clock. */
  timeLimitSec: number;
  pitchSize: PitchSize;
  /** Scatter power-up orbs around the pitch. */
  powerUps: boolean;
  /** Mix curses in with the orbs, so a pick-up is a gamble. */
  curses: boolean;
  /** Weather, which is a standing change to the physics. */
  weather: Weather;
  /** Random catastrophes during play. */
  events: boolean;
  /**
   * How long the goal sequence runs. Practice cuts it right down: nobody
   * wants an eleven-second film every time they hit the net on their own.
   */
  celebrationTicks: number;
}

// Deliberately sluggish: the old values crossed the pitch in about two
// seconds, which left no time to position or aim. This is roughly half that.
export const DEFAULT_RULES: Rules = {
  playerAccel: 0.14,
  playerDamping: 0.935,
  ballDamping: 0.99,
  // A bare touch is a real kick but not a shot; the gap to a full wind-up is
  // where the whole power system lives.
  kickMin: 5.5,
  kickMax: 13,
  // Three seconds with the ball to reach full power. Fast enough to be worth
  // going for, slow enough that you have to actually protect the ball.
  chargeRate: 0.00556,
  maxBallSpeed: 18,
  scoreLimit: 5,
  timeLimitSec: 300,
  pitchSize: 'normal',
  powerUps: false,
  curses: false,
  weather: 'clear',
  events: false,
  celebrationTicks: CELEBRATION_TICKS,
};

/**
 * What was previously labelled "Snail" is the pace the game actually wants, so
 * the labels shifted rather than the physics: Normal is the old Snail, with
 * room on both sides of it.
 */
export const SPEED_PRESETS: Record<string, number> = {
  Slower: 0.09,
  Slow: 0.115,
  Normal: 0.14,
  Faster: 0.19,
  Fastest: 0.26,
};

/** The ceiling a fully-wound shot reaches. The floor is set by kickMin. */
export const POWER_PRESETS: Record<string, number> = {
  Softer: 9,
  Normal: 13,
  Harder: 16,
  Cannon: 18,
};

/**
 * How fast the meter fills.
 *
 * These are the source of the numbers in the lobby's dropdown as well as of
 * the default, which is the whole point of the table: the two used to be
 * written out separately, and `String(1 / 180)` is not `"0.00556"`, so a room
 * on the default charge rate matched none of the options and the dropdown sat
 * on the first one — every host was told their match was on Slow.
 */
export const CHARGE_PRESETS: Record<string, number> = {
  Slow: 0.0037,
  Normal: 0.00556,
  Fast: 0.0111,
};

export const KICK_RANGE = 8;
const KICK_COOLDOWN = 12;
/** Ticks of full-charge hold before it stops building. */
export const MAX_CHARGE = 1;

export interface Disc {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  m: number;
}

export type Effects = Record<Buff | Curse, number>;

export function noEffects(): Effects {
  return { speed: 0, power: 0, control: 0, aim: 0, slow: 0, reverse: 0, butter: 0, blind: 0 };
}

export interface HaxPlayer extends Disc {
  id: string;
  team: 0 | 1;
  /** Frames of kick cooldown remaining, so a held key cannot machine-gun. */
  cooldown: number;
  /** 0..1 shot power, built by keeping the ball at your feet. */
  charge: number;
  /** True while the kick key is down, which is what lightens the disc. */
  kickHeld: boolean;
  /** Unit vector the next shot would travel along, for the aim guide. */
  aimX: number;
  aimY: number;
  /** Ticks left on each pick-up and each curse. */
  buffs: Effects;
  teleports: number;
}

export interface Input {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  kick: boolean;
}

export const NO_INPUT: Input = { up: false, down: false, left: false, right: false, kick: false };

export interface World {
  players: HaxPlayer[];
  ball: Disc;
  score: { red: number; blue: number };
  /** Frames left of the post-goal freeze, during which nothing moves. */
  celebrating: number;
  lastScorer: 0 | 1 | null;
  tick: number;
  rules: Rules;
  pitch: Pitch;
  /** Set once a score or time limit is reached; the host stops stepping. */
  finished: boolean;
  /** Winner of the match, or null for a draw. Only meaningful once finished. */
  winner: 0 | 1 | null;
  /** Frames of pre-kickoff countdown left. Nothing moves while this runs. */
  countdown: number;
  /**
   * Who touched the ball last. Cosmetics belong to a person, so the trail and
   * the goal effect follow the ball's owner rather than whoever is watching.
   */
  lastTouch: string | null;
  /**
   * Recent touches, newest last. Enough history to work out an assist, and
   * capped so it cannot grow across a long match.
   */
  touches: Touch[];
  /** Filled in the moment a goal goes in, and read by the replay overlay. */
  goal: GoalInfo | null;
  /** Power-up orbs, empty unless the mode is switched on. */
  orbs: Orb[];
  /**
   * When the ball last came off a wall. The replay slows on whichever came
   * last, a touch or a bounce, so a shot off the boards is slowed at the
   * board rather than back at the player who hit it.
   */
  lastBounceTick: number;
  /** The catastrophe currently running, if any. */
  event: WorldEvent | null;
  /** Ticks until the next one is rolled. */
  eventIn: number;
  /** Where the wind is pushing, this tick. */
  wind: { x: number; y: number };
  /** Anything on the pitch that is neither a player nor the ball. */
  intruders: Intruder[];
  /**
   * The tick the last full-power shot was struck on, so every screen can
   * shake at the same moment rather than each guessing locally.
   */
  slamTick: number;
}

export interface Touch {
  id: string;
  team: 0 | 1;
  tick: number;
}

export interface GoalInfo {
  /** Which end it went in: 0 = the left goal, 1 = the right one. */
  side: 0 | 1;
  /** Who put it in — which may be someone who put it in their own net. */
  scorer: string | null;
  /** The team credited with the goal. */
  team: 0 | 1;
  assist: string | null;
  ownGoal: boolean;
  /** The tick the scoring touch happened, so the replay can slow down there. */
  shotTick: number;
  /** Where the ball crossed, for the camera. */
  x: number;
  y: number;
}

/** A touch is only an assist if it was recent enough to have set the goal up. */
const ASSIST_WINDOW_TICKS = 60 * 8;

/**
 * Close to a post, a wall bounce is really a post — and a post is not the
 * moment anyone wants to see slowed down.
 */
const POST_ZONE = 26;

/** At or above this, a shot is a slam: worth a shake and worth some sparks. */
export const FULL_POWER = 0.985;

/**
 * Is the ball close enough for this player to strike it?
 *
 * The aim guide keys off exactly this, so charging up while the ball is on the
 * other side of the pitch no longer draws a line to nowhere.
 */
export function canKick(p: { x: number; y: number; r: number }, ball: Disc): boolean {
  return Math.hypot(ball.x - p.x, ball.y - p.y) < p.r + ball.r + KICK_RANGE;
}

export function bounds(pitch: Pitch = PITCH) {
  const left = pitch.pad;
  const right = pitch.w - pitch.pad;
  const top = pitch.pad;
  const bottom = pitch.h - pitch.pad;
  const goalTop = (pitch.h - pitch.goalHeight) / 2;
  const goalBottom = goalTop + pitch.goalHeight;
  return { left, right, top, bottom, goalTop, goalBottom };
}

/**
 * The four goalposts, as discs.
 *
 * Posts used to be a corner in a polyline that the wall check knew nothing
 * about, so a ball clipping one was nudged sideways by the mouth test and
 * carried on — the "it only slightly shifts the ball" complaint. A post is a
 * round object, and the only honest way to make it behave like one is to make
 * it one and bounce the ball off it.
 */
export function posts(pitch: Pitch = PITCH): { x: number; y: number }[] {
  const { left, right, goalTop, goalBottom } = bounds(pitch);
  return [
    { x: left, y: goalTop },
    { x: left, y: goalBottom },
    { x: right, y: goalTop },
    { x: right, y: goalBottom },
  ];
}

export function secondsElapsed(w: World): number {
  return w.tick / 60;
}

export function secondsRemaining(w: World): number {
  if (!w.rules.timeLimitSec) return Infinity;
  return Math.max(0, w.rules.timeLimitSec - secondsElapsed(w));
}

/**
 * Put everyone somewhere in their own half — the *same* somewhere.
 *
 * Deliberately not a fixed formation: identical kickoffs every time make the
 * restart feel like a reset rather than a fresh start. But an independent
 * scatter per side is not fair either, and it was not: one team regularly drew
 * a spot twice as near the centre spot as the other, which decides who gets
 * the first touch before anybody has moved.
 *
 * So one formation is drawn and then rotated 180° about the centre spot for
 * the other side. Every player has an opposite number at exactly the same
 * distance from the ball, and the kickoff is still different every time.
 */
export function kickoffPositions(
  players: HaxPlayer[],
  pitch: Pitch = PITCH,
  random: () => number = Math.random,
): void {
  const { left, top, bottom } = bounds(pitch);
  const cx = pitch.w / 2;
  const cy = pitch.h / 2;

  // Stable order, so both sides pair up the same way on every client.
  const byTeam: [HaxPlayer[], HaxPlayer[]] = [[], []];
  for (const p of [...players].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    byTeam[p.team].push(p);
  }

  const slots = Math.max(byTeam[0].length, byTeam[1].length);
  // How far out a spot may sit: clear of the centre circle, clear of the wall.
  const near = 90;
  const far = Math.max(near + 1, cx - left - 70);
  const spread = Math.max(1, (bottom - top) / 2 - 40);

  for (let i = 0; i < slots; i++) {
    const dx = near + random() * (far - near);
    const dy = (random() * 2 - 1) * spread;

    place(byTeam[0][i], cx - dx, cy + dy);
    // The mirror image through the centre spot: same distance, opposite side.
    place(byTeam[1][i], cx + dx, cy - dy);
  }
}

function place(p: HaxPlayer | undefined, x: number, y: number): void {
  if (!p) return;
  p.x = x;
  p.y = y;
  p.vx = 0;
  p.vy = 0;
  p.charge = 0;
  p.kickHeld = false;
}

export function createWorld(
  players: { id: string; team: 0 | 1 }[],
  rules: Rules = DEFAULT_RULES,
): World {
  // Merged, because a room saved before a rule existed still has to produce a
  // complete world rather than a world with `undefined` in the physics.
  const merged: Rules = { ...DEFAULT_RULES, ...rules };
  const pitch = PITCH_PRESETS[merged.pitchSize] ?? PITCH;
  const list: HaxPlayer[] = players.map((p) => ({
    id: p.id,
    team: p.team,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    r: PLAYER_R,
    m: PLAYER_MASS,
    cooldown: 0,
    charge: 0,
    kickHeld: false,
    aimX: 1,
    aimY: 0,
    buffs: noEffects(),
    teleports: 0,
  }));
  kickoffPositions(list, pitch);
  return {
    players: list,
    ball: { x: pitch.w / 2, y: pitch.h / 2, vx: 0, vy: 0, r: BALL_R, m: BALL_MASS },
    score: { red: 0, blue: 0 },
    celebrating: 0,
    lastScorer: null,
    tick: 0,
    rules: merged,
    pitch,
    finished: false,
    winner: null,
    countdown: COUNTDOWN_TICKS,
    lastTouch: null,
    touches: [],
    goal: null,
    orbs: merged.powerUps ? spawnOrbs(pitch, Math.random, merged.curses) : [],
    lastBounceTick: -1,
    event: null,
    eventIn: EVENT_GAP_MIN,
    wind: { x: 0, y: 0 },
    intruders: [],
    slamTick: -1,
  };
}

/** A fresh scatter of orbs, weighted so the strong ones are uncommon. */
export function spawnOrbs(pitch: Pitch, random: () => number = Math.random, curses = false): Orb[] {
  const { left, right, top, bottom } = bounds(pitch);
  return Array.from({ length: ORB_COUNT }, (_, id) => ({
    id,
    x: left + 60 + random() * (right - left - 120),
    y: top + 40 + random() * (bottom - top - 80),
    kind: pickOrbKind(random, curses),
    active: true,
    respawnIn: 0,
  }));
}

export function pickOrbKind(random: () => number = Math.random, curses = false): OrbKind {
  // Roughly a quarter are curses when they are switched on, so an orb is worth
  // a moment's thought rather than an automatic detour.
  if (curses && random() < 0.26) {
    return CURSE_KINDS[Math.floor(random() * CURSE_KINDS.length)];
  }
  // Roughly one in six is a rare one, so seeing an aim orb means something.
  return random() < 0.17
    ? ORB_RARE[Math.floor(random() * ORB_RARE.length)]
    : (['speed', 'power', 'control'] as OrbKind[])[Math.floor(random() * 3)];
}

/** Move a taken orb somewhere new and give it a fresh kind. */
function respawnOrb(orb: Orb, w: World, random: () => number = Math.random): void {
  const { left, right, top, bottom } = bounds(w.pitch);
  orb.x = left + 60 + random() * (right - left - 120);
  orb.y = top + 40 + random() * (bottom - top - 80);
  orb.kind = pickOrbKind(random, w.rules.curses);
  orb.active = true;
  orb.respawnIn = 0;
}

/** Collect orbs and run down the clocks on everything already held. */
function stepOrbs(w: World, random: () => number = Math.random): void {
  for (const p of w.players) {
    for (const key of EFFECT_KINDS) {
      if (p.buffs[key] > 0) p.buffs[key]--;
    }
  }

  for (const orb of w.orbs) {
    if (!orb.active) {
      if (--orb.respawnIn <= 0) respawnOrb(orb, w, random);
      continue;
    }

    for (const p of w.players) {
      if (Math.hypot(p.x - orb.x, p.y - orb.y) > p.r + ORB_RADIUS) continue;

      if (orb.kind === 'teleport') p.teleports = Math.min(3, p.teleports + 1);
      else if (isCurse(orb.kind)) p.buffs[orb.kind] = CURSE_TICKS;
      else p.buffs[orb.kind] = BUFF_TICKS;

      orb.active = false;
      orb.respawnIn = ORB_RESPAWN_TICKS;
      break;
    }
  }
}

export function resetKickoff(w: World): void {
  kickoffPositions(w.players, w.pitch);
  w.ball.x = w.pitch.w / 2;
  w.ball.y = w.pitch.h / 2;
  w.ball.vx = 0;
  w.ball.vy = 0;
  w.ball.r = BALL_R;
  w.intruders = [];
  w.event = null;
  for (const p of w.players) p.buffs = noEffects();
}

function checkEnd(w: World): void {
  const { scoreLimit, timeLimitSec } = w.rules;
  if (scoreLimit > 0 && (w.score.red >= scoreLimit || w.score.blue >= scoreLimit)) {
    w.finished = true;
  } else if (timeLimitSec > 0 && secondsElapsed(w) >= timeLimitSec) {
    w.finished = true;
  }
  if (w.finished) {
    w.winner = w.score.red === w.score.blue ? null : w.score.red > w.score.blue ? 0 : 1;
  }
}

/* ------------------------------------------------------- weather + events - */

/**
 * Roll the weather and whatever catastrophe is running into one set of numbers
 * the step function can simply apply.
 *
 * Doing it in one place keeps the hot loop readable and means a new event is a
 * branch here rather than another condition sprinkled through the physics.
 */
interface Conditions {
  /** Multiplies player acceleration. */
  grip: number;
  /** Multiplies player damping's distance from 1 — below 1 is slidier. */
  slide: number;
  /** Replaces the ball damping outright. */
  ballDamping: number;
  /** Acceleration added to the ball every tick. */
  windX: number;
  windY: number;
  /** Target ball radius, eased towards. */
  ballR: number;
  /** How strongly the ball is dragged to the nearest player. */
  magnet: number;
}

function conditions(w: World, random: () => number): Conditions {
  const wx = WEATHER[w.rules.weather] ?? WEATHER.clear;
  const r = w.rules;

  // Wind swings round slowly rather than blowing flat, so it is something to
  // read rather than a constant to subtract.
  const phase = w.tick / 260;

  const out: Conditions = {
    grip: wx.grip,
    slide: 1,
    // Damping is a number just under 1, so "slicker" means a smaller gap to 1.
    ballDamping: 1 - (1 - r.ballDamping) / wx.ballSlip,
    windX: Math.cos(phase) * wx.gust,
    windY: Math.sin(phase * 1.7) * wx.gust * 0.6,
    ballR: BALL_R,
    magnet: 0,
  };

  const ev = w.event;
  if (!ev) return out;

  switch (ev.kind) {
    case 'quake':
      // Everything gets shoved, a few times a second.
      if (w.tick % 7 === 0) {
        for (const p of w.players) {
          p.vx += (random() - 0.5) * 2.4;
          p.vy += (random() - 0.5) * 2.4;
        }
        w.ball.vx += (random() - 0.5) * 3.2;
        w.ball.vy += (random() - 0.5) * 3.2;
      }
      break;
    case 'gale':
      out.windX = Math.cos(w.tick / 90) * 0.13;
      out.windY = Math.sin(w.tick / 140) * 0.065;
      out.grip *= 0.92;
      break;
    case 'icerink':
      out.grip *= 0.55;
      out.slide = 0.3;
      out.ballDamping = 1 - (1 - out.ballDamping) * 0.35;
      break;
    case 'lowgrav':
      out.ballDamping = 1 - (1 - out.ballDamping) * 0.2;
      out.slide = 0.45;
      break;
    case 'giant':
      out.ballR = BALL_R * 2.1;
      break;
    case 'shrink':
      out.ballR = BALL_R * 0.55;
      break;
    case 'magnet':
      out.magnet = 0.22;
      break;
    case 'sirens':
      // Distraction, not damage: nobody quite has their feet.
      out.grip *= 0.88;
      break;
    default:
      break;
  }
  return out;
}

/** Start a catastrophe, and do whatever it does the instant it begins. */
function beginEvent(w: World, random: () => number): void {
  const kind = EVENT_KINDS[Math.floor(random() * EVENT_KINDS.length)];
  const { left, right, top, bottom } = bounds(w.pitch);
  const profile = EVENTS[kind];

  w.event = {
    kind,
    ticks: profile.ticks,
    total: profile.ticks,
    x: left + random() * (right - left),
    y: top + random() * (bottom - top),
  };

  if (kind === 'swap') {
    // Rotate everybody through the centre spot. Disorienting, and fair: both
    // sides are moved by exactly the same transform.
    for (const p of w.players) {
      p.x = w.pitch.w - p.x;
      p.y = w.pitch.h - p.y;
      p.vx = 0;
      p.vy = 0;
    }
  }

  if (kind === 'stampede') {
    w.intruders = Array.from({ length: 7 }, () => ({
      x: left + random() * (right - left),
      y: random() < 0.5 ? top : bottom,
      vx: (random() - 0.5) * 3,
      vy: (random() - 0.5) * 3,
      kind: 0 as const,
      ttl: EVENTS.stampede.ticks,
    }));
  }
}

/** Meteors, pitch invaders and anything else with a life of its own. */
function stepIntruders(w: World, random: () => number): void {
  const { left, right, top, bottom } = bounds(w.pitch);

  if (w.event?.kind === 'meteor' && w.tick % 70 === 0) {
    w.intruders.push({
      x: left + random() * (right - left),
      y: top + random() * (bottom - top),
      vx: 0,
      vy: 0,
      kind: 1,
      ttl: 90,
    });
  }

  for (const it of w.intruders) {
    it.ttl--;
    if (it.kind === 0) {
      it.x += it.vx;
      it.y += it.vy;
      if (it.x < left || it.x > right) it.vx *= -1;
      if (it.y < top || it.y > bottom) it.vy *= -1;
      // They barge through, knocking anyone they pass off their stride.
      for (const p of w.players) {
        const d = Math.hypot(p.x - it.x, p.y - it.y);
        if (d < p.r + 14 && d > 0) {
          p.vx += ((p.x - it.x) / d) * 0.9;
          p.vy += ((p.y - it.y) / d) * 0.9;
        }
      }
    } else if (it.ttl === 30) {
      // Impact: a hard shove on everything nearby, the ball included.
      for (const d of [...w.players, w.ball]) {
        const dist = Math.hypot(d.x - it.x, d.y - it.y);
        if (dist < 120 && dist > 0) {
          const push = (1 - dist / 120) * 9;
          d.vx += ((d.x - it.x) / dist) * push;
          d.vy += ((d.y - it.y) / dist) * push;
        }
      }
    }
  }
  w.intruders = w.intruders.filter((it) => it.ttl > 0);
}

/** Advance the world one fixed step. Mutates `w` — it is the hot loop. */
export function step(
  w: World,
  inputs: Map<string, Input>,
  random: () => number = Math.random,
): void {
  // A decided match still owes everyone the goal that decided it. Stopping the
  // world the instant the last goal went in froze the celebration on its first
  // frame and left it there — the clock the goal sequence reads is
  // `celebrating`, so nothing that follows a winning goal can play unless it
  // keeps draining. Only once it has run out does the world actually stop.
  if (w.finished && w.celebrating === 0) return;

  // The countdown freezes play but still advances, so the clock only starts
  // when the match actually does.
  if (w.countdown > 0) {
    w.countdown--;
    return;
  }

  w.tick++;

  if (w.celebrating > 0) {
    w.celebrating--;
    if (w.celebrating === 0) {
      w.goal = null;
      // Restart behind a countdown, the same as the opening whistle, so
      // nobody is caught still watching the replay when play resumes. A match
      // that is already decided is not restarting, so it keeps the picture it
      // ended on rather than snapping everyone back to the centre circle.
      if (!w.finished) {
        resetKickoff(w);
        w.countdown = COUNTDOWN_TICKS;
      }
    }
    checkEnd(w);
    return;
  }

  const r = w.rules;

  if (w.orbs.length) stepOrbs(w, random);

  /* --------------------------------------------------- weather + disasters */
  if (r.events) {
    if (w.event) {
      if (--w.event.ticks <= 0) {
        w.event = null;
        w.intruders = [];
        w.eventIn = EVENT_GAP_MIN + Math.floor(random() * EVENT_GAP_SPAN);
      }
    } else if (--w.eventIn <= 0) {
      beginEvent(w, random);
    }
  }

  const cond = conditions(w, random);
  w.wind = { x: cond.windX, y: cond.windY };

  // The ball changes size smoothly, or a giant ball appears half inside
  // whoever happened to be standing on it.
  w.ball.r += (cond.ballR - w.ball.r) * 0.08;

  if (w.intruders.length || w.event?.kind === 'meteor') stepIntruders(w, random);

  for (const p of w.players) {
    const raw = inputs.get(p.id) ?? NO_INPUT;
    // A reverse curse is applied here rather than at the keyboard, so it is
    // the same for a bot, for a watcher and for whoever is being punished.
    const inp =
      p.buffs.reverse > 0
        ? { up: raw.down, down: raw.up, left: raw.right, right: raw.left, kick: raw.kick }
        : raw;

    let ax = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    let ay = (inp.down ? 1 : 0) - (inp.up ? 1 : 0);
    if (ax !== 0 && ay !== 0) {
      // Diagonals must not be faster than the axes.
      ax *= Math.SQRT1_2;
      ay *= Math.SQRT1_2;
    }
    const accel =
      r.playerAccel *
      (p.buffs.speed > 0 ? SPEED_MULTIPLIER : 1) *
      (p.buffs.slow > 0 ? SLOW_MULTIPLIER : 1) *
      cond.grip;
    const damping = 1 - (1 - r.playerDamping) * cond.slide;
    p.vx = (p.vx + ax * accel) * damping;
    p.vy = (p.vy + ay * accel) * damping;

    if (p.cooldown > 0) p.cooldown--;

    // A shot travels along player -> ball, so that is also what the aim guide
    // has to draw. Keep the last direction when the ball is exactly on top.
    const dx = w.ball.x - p.x;
    const dy = w.ball.y - p.y;
    const d = Math.hypot(dx, dy);
    if (d > 0.001) {
      p.aimX = dx / d;
      p.aimY = dy / d;
    }

    const inReach = d > 0 && d < p.r + w.ball.r + KICK_RANGE;

    // Power builds for as long as the ball is yours. Requiring movement as
    // well meant the meter stalled the moment you stopped to look up with the
    // ball still at your feet, which reads as the bar being broken rather
    // than as a rule. Losing the ball is what drops it, and only that.
    const rate =
      r.chargeRate *
      (p.buffs.control > 0 ? CONTROL_CHARGE_MULTIPLIER : 1) *
      (p.buffs.butter > 0 ? BUTTER_CHARGE_MULTIPLIER : 1);
    if (!inReach) p.charge = 0;
    else p.charge = Math.min(MAX_CHARGE, p.charge + rate);

    // The key is intent, and it fires the moment there is something to hit —
    // so you can run at a loose ball with it held and strike on contact.
    p.kickHeld = inp.kick;

    if (inp.kick && inReach && p.cooldown === 0) {
      let dirX = p.aimX;
      let dirY = p.aimY;

      // An aim orb straightens the shot towards the goal mouth rather than
      // wherever you happened to be standing.
      if (p.buffs.aim > 0) {
        const { left, right } = bounds(w.pitch);
        const tx = p.team === 0 ? right : left;
        const ty = w.pitch.h / 2;
        const len = Math.hypot(tx - w.ball.x, ty - w.ball.y) || 1;
        dirX = (tx - w.ball.x) / len;
        dirY = (ty - w.ball.y) / len;
      }

      const power =
        (r.kickMin + p.charge * (r.kickMax - r.kickMin)) *
        (p.buffs.power > 0 ? POWER_MULTIPLIER : 1);

      // A shot let go at the top of the meter is a moment, and every screen
      // has to agree on which tick it happened so they all shake together.
      if (p.charge >= FULL_POWER) w.slamTick = w.tick;

      w.ball.vx += dirX * power;
      w.ball.vy += dirY * power;
      p.charge = 0;
      p.cooldown = KICK_COOLDOWN;
      noteTouch(w, p);
    } else if (inp.kick && !inReach && p.teleports > 0 && p.cooldown === 0) {
      // A banked teleport is spent by reaching for a ball you cannot reach.
      const len = Math.hypot(w.ball.x - p.x, w.ball.y - p.y) || 1;
      p.x = w.ball.x - ((w.ball.x - p.x) / len) * (p.r + w.ball.r + 4);
      p.y = w.ball.y - ((w.ball.y - p.y) / len) * (p.r + w.ball.r + 4);
      p.vx = 0;
      p.vy = 0;
      p.teleports--;
      p.cooldown = KICK_COOLDOWN * 3;
    }
  }

  w.ball.vx = w.ball.vx * cond.ballDamping + cond.windX;
  w.ball.vy = w.ball.vy * cond.ballDamping + cond.windY;

  if (cond.magnet > 0 && w.players.length) {
    const near = w.players.reduce((best, p) =>
      Math.hypot(w.ball.x - p.x, w.ball.y - p.y) < Math.hypot(w.ball.x - best.x, w.ball.y - best.y)
        ? p
        : best,
    );
    const len = Math.hypot(near.x - w.ball.x, near.y - w.ball.y) || 1;
    w.ball.vx += ((near.x - w.ball.x) / len) * cond.magnet;
    w.ball.vy += ((near.y - w.ball.y) / len) * cond.magnet;
  }

  const speed = Math.hypot(w.ball.vx, w.ball.vy);
  if (speed > r.maxBallSpeed) {
    w.ball.vx = (w.ball.vx / speed) * r.maxBallSpeed;
    w.ball.vy = (w.ball.vy / speed) * r.maxBallSpeed;
  }

  for (const p of w.players) {
    p.x += p.vx;
    p.y += p.vy;
  }
  w.ball.x += w.ball.vx;
  w.ball.y += w.ball.vy;

  for (let i = 0; i < w.players.length; i++) {
    for (let j = i + 1; j < w.players.length; j++) {
      collide(w.players[i], w.players[j]);
    }
    // A bump counts as a touch too, not only a deliberate kick.
    if (collide(w.players[i], w.ball)) noteTouch(w, w.players[i]);
  }

  for (const p of w.players) confinePlayer(p, w.pitch);

  // A reflection is a bounce: compare the sign of the velocity either side of
  // the walls check rather than teaching confineBall to report on itself.
  const beforeVx = w.ball.vx;
  const beforeVy = w.ball.vy;

  // Woodwork first: a ball the posts have already dealt with is unambiguously
  // in the mouth or outside it by the time the goal line is tested.
  const hitPost = ricochet(w.ball, w.pitch);
  const scored = confineBall(w.ball, w.pitch);

  const { goalTop, goalBottom } = bounds(w.pitch);
  const nearPost =
    Math.abs(w.ball.y - goalTop) < POST_ZONE || Math.abs(w.ball.y - goalBottom) < POST_ZONE;

  const flippedX = beforeVx !== 0 && Math.sign(w.ball.vx) !== Math.sign(beforeVx);
  const flippedY = beforeVy !== 0 && Math.sign(w.ball.vy) !== Math.sign(beforeVy);

  // A side-wall bounce right beside the mouth is the post, and clipping the
  // post is not the moment the replay should linger on.
  if (!hitPost && (flippedY || (flippedX && !nearPost))) w.lastBounceTick = w.tick;

  if (scored !== null) {
    if (scored === 0) w.score.red++;
    else w.score.blue++;
    w.lastScorer = scored;
    w.celebrating = w.rules.celebrationTicks ?? CELEBRATION_TICKS;
    w.goal = describeGoal(w, scored);
  }

  checkEnd(w);
}

/** Remember a touch, collapsing a run of touches by the same player. */
function noteTouch(w: World, p: HaxPlayer): void {
  w.lastTouch = p.id;
  const last = w.touches[w.touches.length - 1];
  if (last && last.id === p.id) {
    last.tick = w.tick;
    return;
  }
  w.touches.push({ id: p.id, team: p.team, tick: w.tick });
  if (w.touches.length > 12) w.touches.shift();
}

/**
 * Work out who gets the credit.
 *
 * The scorer is whoever touched it last. The assist is the touch before that
 * by a different player on the same side — and only if it was recent, because
 * a pass two minutes ago did not set this up. Putting it into your own net
 * credits the other team and nobody gets an assist for it.
 */
export function describeGoal(w: World, team: 0 | 1): GoalInfo {
  const touches = w.touches;
  const last = touches[touches.length - 1] ?? null;
  const ownGoal = last ? last.team !== team : false;

  let assist: string | null = null;
  if (last && !ownGoal) {
    for (let i = touches.length - 2; i >= 0; i--) {
      const t = touches[i];
      if (t.id === last.id) continue;
      if (t.team === last.team && w.tick - t.tick <= ASSIST_WINDOW_TICKS) assist = t.id;
      break;
    }
  }

  return {
    // Red attacks right, so a goal for red went in at the right-hand end.
    side: team === 0 ? 1 : 0,
    scorer: last?.id ?? null,
    team,
    assist,
    ownGoal,
    // Whichever happened last: the strike, or the wall it came off. A bounce
    // shot should be slowed at the board, not back where it was struck.
    shotTick: Math.max(last?.tick ?? w.tick, w.lastBounceTick),
    x: w.ball.x,
    y: w.ball.y,
  };
}

/** Push two overlapping discs apart and exchange momentum along the normal. */
export function collide(a: Disc, b: Disc): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy);
  const min = a.r + b.r;
  if (dist === 0 || dist >= min) return false;

  const nx = dx / dist;
  const ny = dy / dist;
  const overlap = min - dist;

  // Separate proportionally to the inverse of mass: the light ball moves most.
  const totalInv = 1 / a.m + 1 / b.m;
  a.x -= nx * overlap * (1 / a.m / totalInv);
  a.y -= ny * overlap * (1 / a.m / totalInv);
  b.x += nx * overlap * (1 / b.m / totalInv);
  b.y += ny * overlap * (1 / b.m / totalInv);

  const rvx = b.vx - a.vx;
  const rvy = b.vy - a.vy;
  const along = rvx * nx + rvy * ny;
  if (along > 0) return true; // already separating

  const impulse = (-(1 + RESTITUTION) * along) / totalInv;
  a.vx -= (impulse * nx) / a.m;
  a.vy -= (impulse * ny) / a.m;
  b.vx += (impulse * nx) / b.m;
  b.vy += (impulse * ny) / b.m;
  return true;
}

/**
 * Bounce a disc off a fixed round obstacle.
 *
 * Immovable, so there is no momentum to exchange: reflect the component of
 * velocity along the normal and keep the rest. Returns true if it touched.
 */
export function bounceOff(d: Disc, px: number, py: number, pr: number, restitution = 0.82): boolean {
  const dx = d.x - px;
  const dy = d.y - py;
  const dist = Math.hypot(dx, dy);
  const min = d.r + pr;
  if (dist >= min) return false;

  // Dead centre: shove it out sideways rather than dividing by zero.
  const nx = dist === 0 ? 1 : dx / dist;
  const ny = dist === 0 ? 0 : dy / dist;

  d.x = px + nx * min;
  d.y = py + ny * min;

  const along = d.vx * nx + d.vy * ny;
  if (along < 0) {
    d.vx -= (1 + restitution) * along * nx;
    d.vy -= (1 + restitution) * along * ny;
  }
  return true;
}

/** The ball against all four posts. Returns true if it struck woodwork. */
export function ricochet(b: Disc, pitch: Pitch = PITCH): boolean {
  let hit = false;
  for (const post of posts(pitch)) {
    if (bounceOff(b, post.x, post.y, POST_R)) hit = true;
  }
  return hit;
}

/**
 * Keep a player inside the stadium — and nothing more than that.
 *
 * Players are free to leave the pitch: into the goal, behind it, round the
 * back of the advertising boards and along the touchline. Chasing a ball into
 * the net is half the fun and standing behind your own goal to sulk is the
 * other half, and neither is worth a rule. The ball is the thing that has to
 * stay in play, and it is `confineBall` that sees to that.
 */
export function confinePlayer(p: Disc, pitch: Pitch = PITCH): void {
  if (p.x - p.r < 0) {
    p.x = p.r;
    p.vx = Math.abs(p.vx) * 0.3;
  }
  if (p.x + p.r > pitch.w) {
    p.x = pitch.w - p.r;
    p.vx = -Math.abs(p.vx) * 0.3;
  }
  if (p.y - p.r < 0) {
    p.y = p.r;
    p.vy = Math.abs(p.vy) * 0.3;
  }
  if (p.y + p.r > pitch.h) {
    p.y = pitch.h - p.r;
    p.vy = -Math.abs(p.vy) * 0.3;
  }
}

/**
 * Bounce the ball off the walls, except through a goal mouth.
 * Returns the scoring team (0 = red, 1 = blue) or null.
 */
export function confineBall(b: Disc, pitch: Pitch = PITCH): 0 | 1 | null {
  const { left, right, top, bottom, goalTop, goalBottom } = bounds(pitch);
  // The mouth is what the posts leave between them.
  const inMouth = b.y > goalTop + POST_R && b.y < goalBottom - POST_R;

  if (b.x - b.r < left) {
    if (inMouth) {
      // Fully across the left line: blue (attacking left) has scored.
      if (b.x + b.r < left) return 1;
    } else {
      b.x = left + b.r;
      b.vx = Math.abs(b.vx) * 0.85;
    }
  }
  if (b.x + b.r > right) {
    if (inMouth) {
      if (b.x - b.r > right) return 0;
    } else {
      b.x = right - b.r;
      b.vx = -Math.abs(b.vx) * 0.85;
    }
  }

  // Past the line the netting takes over, so the touchlines only apply while
  // the ball is still on the grass.
  const behindLine = b.x < left || b.x > right;
  const yTop = behindLine ? goalTop : top;
  const yBottom = behindLine ? goalBottom : bottom;

  if (b.y - b.r < yTop) {
    b.y = yTop + b.r;
    b.vy = Math.abs(b.vy) * 0.85;
  }
  if (b.y + b.r > yBottom) {
    b.y = yBottom - b.r;
    b.vy = -Math.abs(b.vy) * 0.85;
  }

  // Once past the line, keep the ball from wandering out of the net entirely.
  if (b.x < left - pitch.goalDepth) {
    b.x = left - pitch.goalDepth;
    b.vx = 0;
  }
  if (b.x > right + pitch.goalDepth) {
    b.x = right + pitch.goalDepth;
    b.vx = 0;
  }
  return null;
}

/* ------------------------------------------------------------ networking -- */

/** What the host broadcasts each network tick. Kept small and flat. */
export interface Snapshot {
  t: number;
  /** x, y, vx, vy, radius */
  b: [number, number, number, number, number];
  /**
   * id, x, y, vx, vy, team, charge, aimX, aimY, kickHeld,
   * speed, power, control, aim, teleports, slow, reverse, butter, blind
   */
  p: [
    string,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ][];
  /** orbs: id, x, y, kind index, active */
  o: [number, number, number, number, number][];
  s: [number, number];
  c: number;
  /** countdown ticks remaining */
  k: number;
  /** last player to touch the ball, so cosmetics follow its owner */
  lt: string | null;
  /** the goal being celebrated, if any */
  g: GoalInfo | null;
  /** finished flag + winner, so clients can show the result without guessing */
  f: 0 | 1;
  w: number;
  /** the running catastrophe: kind index, ticks left, total, x, y */
  ev: [number, number, number, number, number] | null;
  /** intruders: x, y, kind, ttl */
  it: [number, number, number, number][];
  /** the tick of the last full-power strike, so everyone shakes together */
  sl: number;
}

export function snapshot(w: World): Snapshot {
  return {
    t: w.tick,
    b: [round(w.ball.x), round(w.ball.y), round(w.ball.vx), round(w.ball.vy), round(w.ball.r)],
    p: w.players.map((p) => [
      p.id,
      round(p.x),
      round(p.y),
      round(p.vx),
      round(p.vy),
      p.team,
      round(p.charge),
      round(p.aimX),
      round(p.aimY),
      p.kickHeld ? 1 : 0,
      p.buffs.speed,
      p.buffs.power,
      p.buffs.control,
      p.buffs.aim,
      p.teleports,
      p.buffs.slow,
      p.buffs.reverse,
      p.buffs.butter,
      p.buffs.blind,
    ]) as Snapshot['p'],
    o: w.orbs.map((o) => [
      o.id,
      round(o.x),
      round(o.y),
      ORB_KINDS.indexOf(o.kind),
      o.active ? 1 : 0,
    ]) as Snapshot['o'],
    s: [w.score.red, w.score.blue],
    c: w.celebrating,
    k: w.countdown,
    lt: w.lastTouch,
    g: w.goal,
    f: w.finished ? 1 : 0,
    w: w.winner === null ? -1 : w.winner,
    ev: w.event
      ? [
          EVENT_KINDS.indexOf(w.event.kind),
          w.event.ticks,
          w.event.total,
          round(w.event.x),
          round(w.event.y),
        ]
      : null,
    it: w.intruders.map((i) => [round(i.x), round(i.y), i.kind, i.ttl]) as Snapshot['it'],
    sl: w.slamTick,
  };
}

export function applySnapshot(w: World, s: Snapshot): void {
  w.tick = s.t;
  w.ball.x = s.b[0];
  w.ball.y = s.b[1];
  w.ball.vx = s.b[2];
  w.ball.vy = s.b[3];
  w.ball.r = s.b[4] ?? BALL_R;
  w.score.red = s.s[0];
  w.score.blue = s.s[1];
  w.celebrating = s.c;
  w.countdown = s.k ?? 0;
  w.lastTouch = s.lt ?? null;
  w.goal = s.g ?? null;
  w.finished = s.f === 1;
  w.winner = s.w === -1 ? null : (s.w as 0 | 1);
  w.slamTick = s.sl ?? -1;

  w.event = s.ev
    ? {
        kind: EVENT_KINDS[s.ev[0]] ?? 'quake',
        ticks: s.ev[1],
        total: s.ev[2],
        x: s.ev[3],
        y: s.ev[4],
      }
    : null;
  w.intruders = (s.it ?? []).map(([x, y, kind, ttl]) => ({
    x,
    y,
    vx: 0,
    vy: 0,
    kind: (kind === 1 ? 1 : 0) as 0 | 1,
    ttl,
  }));

  const seen = new Set<string>();
  // Orbs are small and few, so they are simply replaced wholesale.
  w.orbs = (s.o ?? []).map(([id, x, y, kind, active]) => ({
    id,
    x,
    y,
    kind: ORB_KINDS[kind] ?? 'speed',
    active: active === 1,
    respawnIn: 0,
  }));

  for (const [
    id,
    x,
    y,
    vx,
    vy,
    team,
    charge,
    aimX,
    aimY,
    held,
    speed,
    power,
    control,
    aim,
    teleports,
    slow,
    reverse,
    butter,
    blind,
  ] of s.p) {
    seen.add(id);
    let p = w.players.find((q) => q.id === id);
    if (!p) {
      p = {
        id,
        team: team as 0 | 1,
        x,
        y,
        vx,
        vy,
        r: PLAYER_R,
        m: PLAYER_MASS,
        cooldown: 0,
        charge: 0,
        kickHeld: false,
        aimX: 1,
        aimY: 0,
        buffs: noEffects(),
        teleports: 0,
      };
      w.players.push(p);
    }
    p.x = x;
    p.y = y;
    p.vx = vx;
    p.vy = vy;
    p.team = team as 0 | 1;
    p.charge = charge;
    p.aimX = aimX;
    p.aimY = aimY;
    p.kickHeld = held === 1;
    p.buffs = {
      speed,
      power,
      control,
      aim,
      slow: slow ?? 0,
      reverse: reverse ?? 0,
      butter: butter ?? 0,
      blind: blind ?? 0,
    };
    p.teleports = teleports;
  }
  w.players = w.players.filter((p) => seen.has(p.id));
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
