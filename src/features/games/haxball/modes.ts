import { CHARGE_PRESETS, POWER_PRESETS, SPEED_PRESETS, type Rules } from './physics';

/**
 * Ways to play, as named bundles of rules.
 *
 * A mode is nothing but a patch over the defaults — no branch anywhere in the
 * simulation knows a mode exists. That is deliberate: every setting a mode
 * turns on is a setting a host could have turned on by hand, so a mode is a
 * shortcut rather than a second set of rules to keep working.
 */
export interface Mode {
  id: string;
  name: string;
  /** One line, as it reads in the picker. */
  blurb: string;
  /** What it changes about a plain match. */
  rules: Partial<Rules>;
}

export const MODES: Mode[] = [
  {
    id: 'classic',
    name: 'Classic',
    blurb: 'Eleven-a-side football, minus ten a side. Nothing unusual.',
    rules: { powerUps: false, curses: false, events: false, weather: 'clear' },
  },
  {
    id: 'orbs',
    name: 'Power-ups',
    blurb: 'Speed, power, control, aim and teleport orbs around the pitch.',
    rules: { powerUps: true, curses: false, events: false, weather: 'clear' },
  },
  {
    id: 'gamble',
    name: "Hunter's gamble",
    blurb: 'Orbs, but a quarter of them are curses. Read before you run.',
    rules: { powerUps: true, curses: true, events: false, weather: 'clear' },
  },
  {
    id: 'downpour',
    name: 'Downpour',
    blurb: 'Rain. The ball runs on forever and nobody stops sharply.',
    rules: { weather: 'rain', powerUps: false, curses: false, events: false },
  },
  {
    id: 'winter',
    name: 'Deep winter',
    blurb: 'Snow, heavy legs and a ball that dies on you.',
    rules: { weather: 'snow', powerUps: true, curses: true, events: false },
  },
  {
    id: 'galeday',
    name: 'Gale day',
    blurb: 'A crosswind that swings round. Every shot has to be aimed off it.',
    rules: { weather: 'wind', powerUps: false, curses: false, events: false },
  },
  {
    id: 'fogofwar',
    name: 'Fog of war',
    blurb: 'You can see as far as you can see. Pass and hope.',
    rules: { weather: 'fog', powerUps: false, curses: false, events: false },
  },
  {
    id: 'tempest',
    name: 'Tempest',
    blurb: 'Storm overhead and the ground giving way underneath.',
    rules: { weather: 'storm', powerUps: true, curses: false, events: true },
  },
  {
    id: 'chaos',
    name: 'Total chaos',
    blurb: 'Orbs, curses, catastrophes and whatever the sky is doing.',
    rules: { powerUps: true, curses: true, events: true, weather: 'storm' },
  },
  {
    id: 'disaster',
    name: 'Disaster reel',
    blurb: 'Clear skies, and something going badly wrong every fifteen seconds.',
    rules: { powerUps: false, curses: false, events: true, weather: 'clear' },
  },
  {
    id: 'suddendeath',
    name: 'Sudden death',
    blurb: 'One goal wins it. No clock, no second chances, no mercy.',
    rules: { scoreLimit: 1, timeLimitSec: 0, events: true, powerUps: true, curses: true },
  },
  {
    id: 'cannons',
    name: 'Cannons',
    blurb: 'Full-power shots, a quick wind-up and an icy ball.',
    rules: {
      kickMax: POWER_PRESETS.Cannon,
      chargeRate: CHARGE_PRESETS.Fast,
      ballDamping: 0.997,
      powerUps: false,
      curses: false,
      events: false,
      weather: 'clear',
    },
  },
  {
    id: 'sprint',
    name: 'Sprinters',
    blurb: 'Everyone quick, the pitch small, and no time to think.',
    rules: {
      playerAccel: SPEED_PRESETS.Fastest,
      pitchSize: 'small',
      timeLimitSec: 120,
      powerUps: true,
      curses: false,
      events: false,
    },
  },
  {
    id: 'marathon',
    name: 'Marathon',
    blurb: 'The big pitch, ten minutes and ten goals. Bring water.',
    rules: {
      pitchSize: 'big',
      timeLimitSec: 600,
      scoreLimit: 10,
      powerUps: true,
      curses: true,
      events: true,
      weather: 'clear',
    },
  },
];

export function modeById(id: string): Mode {
  return MODES.find((m) => m.id === id) ?? MODES[0];
}

/**
 * Which mode a set of rules corresponds to, or `custom` once a host has
 * changed something by hand.
 *
 * Derived rather than stored, so the picker can never disagree with the rules
 * actually in force — the failure mode of storing it is a room that says
 * "Classic" while playing in a storm.
 */
export function modeOf(rules: Rules): string {
  const match = MODES.find((m) =>
    (Object.keys(m.rules) as (keyof Rules)[]).every((k) => rules[k] === m.rules[k]),
  );
  return match?.id ?? 'custom';
}
