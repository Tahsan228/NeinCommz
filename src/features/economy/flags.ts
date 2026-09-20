/**
 * Country ball skins.
 *
 * A flag on a thirteen-pixel disc is never going to be a vexillologist's
 * delight, so rather than shipping two hundred images these are described:
 * bands plus a handful of marks, drawn into a clipped circle. That keeps the
 * whole set to one file, costs no network requests, and means a flag scales
 * cleanly from the ball to the shop card.
 *
 * The descriptions are honest approximations. Where a flag's charge is an
 * intricate coat of arms it is reduced to a glyph, which reads far better at
 * ball size than a faithful drawing would.
 */

export type Mark =
  /** A filled circle, as a fraction of the flag's height. */
  | { t: 'disc'; c: string; r: number; x?: number; y?: number }
  /** An outlined one. */
  | { t: 'ring'; c: string; r: number; w: number; x?: number; y?: number }
  | { t: 'star'; c: string; r: number; x?: number; y?: number; points?: number }
  /** Several stars around a circle, the EU arrangement. */
  | { t: 'stars'; c: string; n: number; r: number; spread: number; x?: number; y?: number }
  | { t: 'crescent'; c: string; r: number; x?: number; y?: number }
  /** An off-centre cross, the Nordic arrangement. */
  | { t: 'nordic'; c: string; w: number; edge?: string; edgeW?: number }
  /** A centred one. */
  | { t: 'plus'; c: string; w: number }
  /** A rectangle in the top-left corner. */
  | { t: 'canton'; c: string; w: number; h: number }
  /** A triangle growing from the hoist. */
  | { t: 'tri'; c: string; w: number; from?: 'l' | 'r' }
  /** A corner-to-corner stripe. */
  | { t: 'diag'; c: string; w: number; both?: boolean }
  /** A stripe across the middle, over whatever is beneath it. */
  | { t: 'band'; c: string; w: number; dir?: 'v' | 'h'; at?: number }
  /** An arbitrary block, in fractions of the flag. */
  | { t: 'rect'; c: string; x: number; y: number; w: number; h: number }
  /** Anything too intricate to draw: a glyph in the middle. */
  | { t: 'glyph'; c: string; s: string; size?: number; x?: number; y?: number };

export interface Flag {
  /** Band direction. Horizontal unless it says otherwise. */
  dir?: 'h' | 'v';
  bands: string[];
  /** Relative band sizes, when they are not equal. */
  weights?: number[];
  marks?: Mark[];
}

/* Shared colours, so the table below stays readable. */
const W = '#ffffff';
const K = '#000000';
const R = '#d62612';
const DR = '#a51931';
const B = '#0052b4';
const DB = '#002b7f';
const LB = '#3aa5dc';
const G = '#149a4b';
const DG = '#006233';
const Y = '#fcd116';
const O = '#ff8200';
const GY = '#8d8d99';
const MR = '#8b1a1a';

const h = (...bands: string[]): Flag => ({ dir: 'h', bands });
const v = (...bands: string[]): Flag => ({ dir: 'v', bands });
const one = (c: string): Flag => ({ dir: 'h', bands: [c] });

/** Bands plus marks, which is most of the table. */
const m = (f: Flag, ...marks: Mark[]): Flag => ({ ...f, marks });

/** Weighted bands, for the flags whose middle stripe is the wide one. */
const wt = (f: Flag, ...weights: number[]): Flag => ({ ...f, weights });

const star = (c: string, r = 0.3, x = 0.5, y = 0.5, points = 5): Mark =>
  ({ t: 'star', c, r, x, y, points });
const disc = (c: string, r = 0.3, x = 0.5, y = 0.5): Mark => ({ t: 'disc', c, r, x, y });
const glyph = (c: string, s: string, size = 0.6, x = 0.5, y = 0.5): Mark =>
  ({ t: 'glyph', c, s, size, x, y });
const crescent = (c: string, r = 0.32, x = 0.42, y = 0.5): Mark => ({ t: 'crescent', c, r, x, y });
const nordic = (c: string, w = 0.2, edge?: string, edgeW = 0.34): Mark =>
  ({ t: 'nordic', c, w, edge, edgeW });
const canton = (c: string, w = 0.42, hh = 0.5): Mark => ({ t: 'canton', c, w, h: hh });
const tri = (c: string, w = 0.45, from: 'l' | 'r' = 'l'): Mark => ({ t: 'tri', c, w, from });

/**
 * Every country, with the flag each one gets.
 *
 * Ordered by name so the shop reads alphabetically without sorting at render
 * time, and keyed by the ISO two-letter code, which is what the shop item id
 * is built from.
 */
export const COUNTRIES: { code: string; name: string; flag: Flag }[] = [
  { code: 'af', name: 'Afghanistan', flag: m(v(K, R, G), glyph(W, '☾')) },
  { code: 'al', name: 'Albania', flag: m(one(R), glyph(K, '🦅', 0.8)) },
  { code: 'dz', name: 'Algeria', flag: m(v(G, W), crescent(R, 0.3, 0.5)) },
  { code: 'ad', name: 'Andorra', flag: m(v(B, Y, R), glyph(MR, '⛨', 0.5)) },
  { code: 'ao', name: 'Angola', flag: m(h(R, K), glyph(Y, '★', 0.4)) },
  { code: 'ag', name: 'Antigua and Barbuda', flag: m(h(K, LB, W), glyph(Y, '☀', 0.5, 0.5, 0.38)) },
  { code: 'ar', name: 'Argentina', flag: m(h(LB, W, LB), glyph(Y, '☀', 0.42)) },
  { code: 'am', name: 'Armenia', flag: h('#d90012', B, O) },
  { code: 'au', name: 'Australia', flag: m(one(DB), canton(R, 0.44, 0.5), star(W, 0.14, 0.75, 0.3), star(W, 0.12, 0.72, 0.68)) },
  { code: 'at', name: 'Austria', flag: h(R, W, R) },
  { code: 'az', name: 'Azerbaijan', flag: m(h(LB, R, G), crescent(W, 0.26, 0.5)) },
  { code: 'bs', name: 'Bahamas', flag: m(h(LB, Y, LB), tri(K, 0.42)) },
  { code: 'bh', name: 'Bahrain', flag: m(v(W, R), { t: 'glyph', c: W, s: '▲', size: 0.3, x: 0.3, y: 0.5 }) },
  { code: 'bd', name: 'Bangladesh', flag: m(one(DG), disc('#f42a41', 0.3, 0.45)) },
  { code: 'bb', name: 'Barbados', flag: m(v(DB, Y, DB), glyph(K, '🔱', 0.55)) },
  { code: 'by', name: 'Belarus', flag: m(wt(h(R, G), 2, 1), { t: 'canton', c: W, w: 0.14, h: 1 }, glyph(R, '❖', 0.18, 0.07)) },
  { code: 'be', name: 'Belgium', flag: v(K, Y, R) },
  { code: 'bz', name: 'Belize', flag: m(h(B, R, B), disc(W, 0.36)) },
  { code: 'bj', name: 'Benin', flag: m(h(Y, R), tri(G, 0.38)) },
  { code: 'bt', name: 'Bhutan', flag: m(h(Y, O), glyph(W, '🐉', 0.7)) },
  { code: 'bo', name: 'Bolivia', flag: h(R, Y, G) },
  { code: 'ba', name: 'Bosnia and Herzegovina', flag: m(one(DB), { t: 'diag', c: Y, w: 0.3 }, star(W, 0.1, 0.35, 0.3)) },
  { code: 'bw', name: 'Botswana', flag: m(h(LB, W, K, W, LB), { t: 'band', c: K, w: 0.2 }) },
  { code: 'br', name: 'Brazil', flag: m(one(G), { t: 'glyph', c: Y, s: '◆', size: 0.92 }, disc(DB, 0.26), { t: 'band', c: W, w: 0.05, at: 0.47 }) },
  { code: 'bn', name: 'Brunei', flag: m(h(Y, W, K, Y), glyph(R, '☾', 0.45)) },
  { code: 'bg', name: 'Bulgaria', flag: h(W, G, R) },
  { code: 'bf', name: 'Burkina Faso', flag: m(h(R, G), star(Y, 0.26)) },
  { code: 'bi', name: 'Burundi', flag: m(h(R, G), disc(W, 0.42), { t: 'diag', c: W, w: 0.12, both: true }, glyph(R, '✦', 0.3)) },
  { code: 'kh', name: 'Cambodia', flag: m(wt(h(DB, R, DB), 1, 2, 1), glyph(W, '🏛', 0.5)) },
  { code: 'cm', name: 'Cameroon', flag: m(v(G, R, Y), star(Y, 0.24)) },
  { code: 'ca', name: 'Canada', flag: m(wt(v(R, W, R), 1, 2, 1), glyph(R, '🍁', 0.62)) },
  { code: 'cv', name: 'Cabo Verde', flag: m(wt(h(DB, W, R, W, DB), 6, 1, 1, 1, 3), { t: 'stars', c: Y, n: 10, r: 0.05, spread: 0.32, x: 0.42 }) },
  { code: 'cf', name: 'Central African Republic', flag: m(h(B, W, G, Y), { t: 'band', c: R, w: 0.16, dir: 'v' }, star(Y, 0.12, 0.14, 0.2)) },
  { code: 'td', name: 'Chad', flag: v(DB, Y, R) },
  { code: 'cl', name: 'Chile', flag: m(h(W, R), canton(DB, 0.34, 0.5), star(W, 0.16, 0.17, 0.25)) },
  { code: 'cn', name: 'China', flag: m(one('#de2910'), star(Y, 0.22, 0.2, 0.28), { t: 'stars', c: Y, n: 4, r: 0.06, spread: 0.16, x: 0.42, y: 0.28 }) },
  { code: 'co', name: 'Colombia', flag: wt(h(Y, B, R), 2, 1, 1) },
  { code: 'km', name: 'Comoros', flag: m(h(Y, W, R, B), tri(G, 0.42), crescent(W, 0.2, 0.16)) },
  { code: 'cg', name: 'Congo', flag: m(one(G), { t: 'diag', c: Y, w: 0.34 }, { t: 'glyph', c: R, s: '◣', size: 0.9, x: 0.75, y: 0.75 }) },
  { code: 'cd', name: 'DR Congo', flag: m(one('#007fff'), { t: 'diag', c: R, w: 0.24 }, star(Y, 0.16, 0.18, 0.2)) },
  { code: 'cr', name: 'Costa Rica', flag: wt(h(B, W, R, W, B), 1, 1, 2, 1, 1) },
  { code: 'ci', name: "Côte d'Ivoire", flag: v(O, W, G) },
  { code: 'hr', name: 'Croatia', flag: m(h(R, W, DB), glyph(R, '▦', 0.4)) },
  { code: 'cu', name: 'Cuba', flag: m(h(DB, W, DB, W, DB), tri(R, 0.42), star(W, 0.16, 0.14, 0.5)) },
  { code: 'cy', name: 'Cyprus', flag: m(one(W), glyph('#d57800', '⬗', 0.5), { t: 'glyph', c: G, s: '❧', size: 0.3, x: 0.5, y: 0.72 }) },
  { code: 'cz', name: 'Czechia', flag: m(h(W, R), tri(DB, 0.44)) },
  { code: 'dk', name: 'Denmark', flag: m(one(R), nordic(W)) },
  { code: 'dj', name: 'Djibouti', flag: m(h(LB, G), tri(W, 0.4), star(R, 0.16, 0.14, 0.5)) },
  { code: 'dm', name: 'Dominica', flag: m(one(G), { t: 'plus', c: Y, w: 0.16 }, disc(R, 0.24)) },
  { code: 'do', name: 'Dominican Republic', flag: m(v(DB, R), { t: 'plus', c: W, w: 0.18 }) },
  { code: 'ec', name: 'Ecuador', flag: m(wt(h(Y, DB, R), 2, 1, 1), glyph('#a3853d', '🦅', 0.42)) },
  { code: 'eg', name: 'Egypt', flag: m(h(R, W, K), glyph('#c09300', '🦅', 0.4)) },
  { code: 'sv', name: 'El Salvador', flag: m(h(DB, W, DB), glyph('#1d3a8f', '❁', 0.34)) },
  { code: 'gq', name: 'Equatorial Guinea', flag: m(h(G, W, R), tri(LB, 0.34)) },
  { code: 'er', name: 'Eritrea', flag: m(h(G, B), { t: 'tri', c: R, w: 1, from: 'l' }, glyph(Y, '❦', 0.3, 0.2)) },
  { code: 'ee', name: 'Estonia', flag: h('#0072ce', K, W) },
  { code: 'sz', name: 'Eswatini', flag: m(wt(h(LB, Y, MR, Y, LB), 3, 1, 6, 1, 3), glyph(W, '⛉', 0.4)) },
  { code: 'et', name: 'Ethiopia', flag: m(h(G, Y, R), disc(DB, 0.34), star(Y, 0.24)) },
  { code: 'fj', name: 'Fiji', flag: m(one(LB), canton(DB, 0.44, 0.5), glyph(W, '⛨', 0.34, 0.76)) },
  { code: 'fi', name: 'Finland', flag: m(one(W), nordic('#003580')) },
  { code: 'fr', name: 'France', flag: v(DB, W, R) },
  { code: 'ga', name: 'Gabon', flag: h(G, Y, B) },
  { code: 'gm', name: 'Gambia', flag: m(wt(h(R, W, DB, W, G), 6, 1, 4, 1, 6)) },
  { code: 'ge', name: 'Georgia', flag: m(one(W), { t: 'plus', c: R, w: 0.18 }, glyph(R, '✛', 0.2, 0.25, 0.27)) },
  { code: 'de', name: 'Germany', flag: h(K, R, Y) },
  { code: 'gh', name: 'Ghana', flag: m(h(R, Y, G), star(K, 0.22)) },
  { code: 'gr', name: 'Greece', flag: m(h(B, W, B, W, B, W, B, W, B), canton(B, 0.44, 0.56), { t: 'plus', c: W, w: 0.1 }) },
  { code: 'gd', name: 'Grenada', flag: m(one(R), { t: 'glyph', c: G, s: '◈', size: 0.95 }, star(Y, 0.16)) },
  { code: 'gt', name: 'Guatemala', flag: m(v(LB, W, LB), glyph(G, '❦', 0.4)) },
  { code: 'gn', name: 'Guinea', flag: v(R, Y, G) },
  { code: 'gw', name: 'Guinea-Bissau', flag: m(h(Y, G), tri(R, 0.4), star(K, 0.18, 0.16, 0.5)) },
  { code: 'gy', name: 'Guyana', flag: m(one(G), tri(W, 0.9), tri(Y, 0.72), tri(K, 0.4), tri(R, 0.3)) },
  { code: 'ht', name: 'Haiti', flag: m(h(DB, R), glyph(W, '◧', 0.34)) },
  { code: 'hn', name: 'Honduras', flag: m(h(LB, W, LB), { t: 'stars', c: LB, n: 5, r: 0.07, spread: 0.16 }) },
  { code: 'hu', name: 'Hungary', flag: h(R, W, G) },
  { code: 'is', name: 'Iceland', flag: m(one('#02529c'), nordic(R, 0.18, W, 0.34)) },
  { code: 'in', name: 'India', flag: m(h('#ff9933', W, '#138808'), { t: 'ring', c: DB, r: 0.16, w: 0.04 }) },
  { code: 'id', name: 'Indonesia', flag: h(R, W) },
  { code: 'ir', name: 'Iran', flag: m(h(G, W, R), glyph(R, '❁', 0.3)) },
  { code: 'iq', name: 'Iraq', flag: m(h(R, W, K), glyph(G, 'الله', 0.28)) },
  { code: 'ie', name: 'Ireland', flag: v(G, W, O) },
  { code: 'it', name: 'Italy', flag: v(G, W, R) },
  { code: 'jm', name: 'Jamaica', flag: m(one(G), { t: 'diag', c: Y, w: 0.18, both: true }, { t: 'glyph', c: K, s: '◀', size: 0.5, x: 0.2 }, { t: 'glyph', c: K, s: '▶', size: 0.5, x: 0.8 }) },
  { code: 'jp', name: 'Japan', flag: m(one(W), disc('#bc002d', 0.3)) },
  { code: 'jo', name: 'Jordan', flag: m(h(K, W, G), tri(R, 0.4), star(W, 0.1, 0.14, 0.5, 7)) },
  { code: 'kz', name: 'Kazakhstan', flag: m(one('#00afca'), glyph(Y, '☀', 0.42)) },
  { code: 'ke', name: 'Kenya', flag: m(wt(h(K, W, R, W, G), 6, 1, 6, 1, 6), glyph(W, '⛨', 0.46)) },
  { code: 'ki', name: 'Kiribati', flag: m(h(R, B), glyph(Y, '🐦', 0.4, 0.5, 0.3)) },
  { code: 'kp', name: 'North Korea', flag: m(wt(h(DB, W, R, W, DB), 2, 1, 6, 1, 2), disc(W, 0.24, 0.34), star(R, 0.16, 0.34)) },
  { code: 'kr', name: 'South Korea', flag: m(one(W), disc('#cd2e3a', 0.24), { t: 'glyph', c: '#0047a0', s: '☯', size: 0.56 }) },
  { code: 'xk', name: 'Kosovo', flag: m(one('#244aa5'), glyph(Y, '◖', 0.4), { t: 'stars', c: W, n: 6, r: 0.06, spread: 0.3, y: 0.24 }) },
  { code: 'kw', name: 'Kuwait', flag: m(h(G, W, R), tri(K, 0.36)) },
  { code: 'kg', name: 'Kyrgyzstan', flag: m(one(R), glyph(Y, '☀', 0.46)) },
  { code: 'la', name: 'Laos', flag: m(wt(h(R, DB, R), 1, 2, 1), disc(W, 0.24)) },
  { code: 'lv', name: 'Latvia', flag: wt(h('#9e3039', W, '#9e3039'), 2, 1, 2) },
  { code: 'lb', name: 'Lebanon', flag: m(wt(h(R, W, R), 1, 2, 1), glyph(G, '🌲', 0.44)) },
  { code: 'ls', name: 'Lesotho', flag: m(wt(h(DB, W, G), 3, 4, 3), glyph(K, '☗', 0.34)) },
  { code: 'lr', name: 'Liberia', flag: m(h(R, W, R, W, R, W, R, W, R, W, R), canton(DB, 0.4, 0.46), star(W, 0.14, 0.2, 0.24)) },
  { code: 'ly', name: 'Libya', flag: m(wt(h(R, K, G), 1, 2, 1), crescent(W, 0.2, 0.48)) },
  { code: 'li', name: 'Liechtenstein', flag: m(h(DB, R), glyph(Y, '♔', 0.32, 0.26, 0.28)) },
  { code: 'lt', name: 'Lithuania', flag: h(Y, G, R) },
  { code: 'lu', name: 'Luxembourg', flag: h(R, W, LB) },
  { code: 'mg', name: 'Madagascar', flag: m(h(R, G), { t: 'canton', c: W, w: 0.34, h: 1 }) },
  { code: 'mw', name: 'Malawi', flag: m(h(K, R, G), { t: 'glyph', c: R, s: '☀', size: 0.36, x: 0.5, y: 0.26 }) },
  { code: 'my', name: 'Malaysia', flag: m(h(R, W, R, W, R, W, R, W, R, W, R, W, R, W), canton(DB, 0.44, 0.56), crescent(Y, 0.16, 0.2, 0.28)) },
  { code: 'mv', name: 'Maldives', flag: m(one(R), { t: 'canton', c: G, w: 0.56, h: 0.56 }, crescent(W, 0.16)) },
  { code: 'ml', name: 'Mali', flag: v(G, Y, R) },
  { code: 'mt', name: 'Malta', flag: m(v(W, R), glyph(GY, '✚', 0.24, 0.16, 0.24)) },
  { code: 'mh', name: 'Marshall Islands', flag: m(one(DB), { t: 'diag', c: W, w: 0.2 }, star(W, 0.18, 0.24, 0.26, 24)) },
  { code: 'mr', name: 'Mauritania', flag: m(wt(h(R, G, R), 1, 4, 1), crescent(Y, 0.24, 0.5), star(Y, 0.1, 0.5, 0.28)) },
  { code: 'mu', name: 'Mauritius', flag: h(R, DB, Y, G) },
  { code: 'mx', name: 'Mexico', flag: m(v(G, W, R), glyph(MR, '🦅', 0.42)) },
  { code: 'fm', name: 'Micronesia', flag: m(one('#75b2dd'), { t: 'stars', c: W, n: 4, r: 0.1, spread: 0.24 }) },
  { code: 'md', name: 'Moldova', flag: m(v(DB, Y, R), glyph(MR, '⛨', 0.36)) },
  { code: 'mc', name: 'Monaco', flag: h(R, W) },
  { code: 'mn', name: 'Mongolia', flag: m(v(R, DB, R), glyph(Y, '☰', 0.36, 0.16)) },
  { code: 'me', name: 'Montenegro', flag: m(one('#c40308'), glyph(Y, '🦅', 0.6)) },
  { code: 'ma', name: 'Morocco', flag: m(one('#c1272d'), star(G, 0.3)) },
  { code: 'mz', name: 'Mozambique', flag: m(h(G, W, K, W, Y), tri(R, 0.4), star(Y, 0.16, 0.14, 0.5)) },
  { code: 'mm', name: 'Myanmar', flag: m(h(Y, G, R), star(W, 0.3)) },
  { code: 'na', name: 'Namibia', flag: m(h(DB, G), { t: 'diag', c: R, w: 0.26 }, { t: 'glyph', c: Y, s: '☀', size: 0.3, x: 0.25, y: 0.26 }) },
  { code: 'nr', name: 'Nauru', flag: m(one(DB), { t: 'band', c: Y, w: 0.08 }, star(W, 0.14, 0.3, 0.72, 12)) },
  { code: 'np', name: 'Nepal', flag: m(one(DR), { t: 'glyph', c: W, s: '⛰', size: 0.7 }, { t: 'glyph', c: W, s: '☾', size: 0.24, x: 0.42, y: 0.3 }) },
  { code: 'nl', name: 'Netherlands', flag: h('#ae1c28', W, '#21468b') },
  { code: 'nz', name: 'New Zealand', flag: m(one(DB), canton(R, 0.44, 0.5), star(R, 0.1, 0.74, 0.32), star(R, 0.1, 0.72, 0.7)) },
  { code: 'ni', name: 'Nicaragua', flag: m(h(B, W, B), glyph('#0067c6', '▲', 0.3)) },
  { code: 'ne', name: 'Niger', flag: m(h(O, W, G), disc(O, 0.2)) },
  { code: 'ng', name: 'Nigeria', flag: v(G, W, G) },
  { code: 'mk', name: 'North Macedonia', flag: m(one('#d20000'), glyph(Y, '☀', 0.8)) },
  { code: 'no', name: 'Norway', flag: m(one('#ba0c2f'), nordic('#00205b', 0.18, W, 0.34)) },
  { code: 'om', name: 'Oman', flag: m(h(W, R, G), { t: 'canton', c: R, w: 0.3, h: 1 }, glyph(W, '⚔', 0.24, 0.16, 0.24)) },
  { code: 'pk', name: 'Pakistan', flag: m(wt(v(W, DG), 1, 3), crescent(W, 0.24, 0.6)) },
  { code: 'pw', name: 'Palau', flag: m(one('#4aadd6'), disc(Y, 0.3, 0.42)) },
  { code: 'ps', name: 'Palestine', flag: m(h(K, W, G), tri(R, 0.4)) },
  { code: 'pa', name: 'Panama', flag: m(one(W), { t: 'rect', c: R, x: 0.5, y: 0, w: 0.5, h: 0.5 }, { t: 'rect', c: DB, x: 0, y: 0.5, w: 0.5, h: 0.5 }, star(DB, 0.14, 0.25, 0.25), star(R, 0.14, 0.75, 0.75)) },
  { code: 'pg', name: 'Papua New Guinea', flag: m(one(K), { t: 'glyph', c: R, s: '◥', size: 1 }, star(W, 0.1, 0.28, 0.66), glyph(Y, '🐦', 0.32, 0.7, 0.36)) },
  { code: 'py', name: 'Paraguay', flag: m(h(R, W, DB), star(G, 0.18)) },
  { code: 'pe', name: 'Peru', flag: m(v(R, W, R), glyph('#a3853d', '⛨', 0.34)) },
  { code: 'ph', name: 'Philippines', flag: m(h(DB, R), tri(W, 0.46), glyph(Y, '☀', 0.24, 0.16, 0.5)) },
  { code: 'pl', name: 'Poland', flag: h(W, '#dc143c') },
  { code: 'pt', name: 'Portugal', flag: m(wt(v(G, R), 2, 3), glyph(Y, '⛨', 0.38, 0.4)) },
  { code: 'qa', name: 'Qatar', flag: wt(v(W, '#8a1538'), 1, 2) },
  { code: 'ro', name: 'Romania', flag: v(DB, Y, R) },
  { code: 'ru', name: 'Russia', flag: h(W, '#0039a6', '#d52b1e') },
  { code: 'rw', name: 'Rwanda', flag: m(wt(h('#20603d', Y, LB), 1, 1, 2), { t: 'glyph', c: Y, s: '☀', size: 0.26, x: 0.74, y: 0.26 }) },
  { code: 'kn', name: 'Saint Kitts and Nevis', flag: m(h(G, R), { t: 'diag', c: K, w: 0.3 }, star(W, 0.1, 0.36, 0.34), star(W, 0.1, 0.62, 0.66)) },
  { code: 'lc', name: 'Saint Lucia', flag: m(one('#66ccff'), { t: 'glyph', c: W, s: '▲', size: 0.66 }, { t: 'glyph', c: K, s: '▲', size: 0.5 }) },
  { code: 'vc', name: 'Saint Vincent and the Grenadines', flag: m(wt(v(B, Y, G), 1, 2, 1), glyph(G, '◆', 0.3)) },
  { code: 'ws', name: 'Samoa', flag: m(one(R), canton(DB, 0.5, 0.5), star(W, 0.1, 0.24, 0.26)) },
  { code: 'sm', name: 'San Marino', flag: m(h(W, LB), glyph(Y, '⛨', 0.36)) },
  { code: 'st', name: 'São Tomé and Príncipe', flag: m(wt(h(G, Y, G), 1, 2, 1), tri(R, 0.34), star(K, 0.1, 0.55), star(K, 0.1, 0.78)) },
  { code: 'sa', name: 'Saudi Arabia', flag: m(one('#006c35'), glyph(W, 'لا اله الا الله', 0.2)) },
  { code: 'sn', name: 'Senegal', flag: m(v(G, Y, R), star(G, 0.2)) },
  { code: 'rs', name: 'Serbia', flag: m(h('#c6363c', DB, W), glyph(Y, '⛨', 0.34, 0.35)) },
  { code: 'sc', name: 'Seychelles', flag: m(one(DB), { t: 'glyph', c: Y, s: '◤', size: 1 }, { t: 'glyph', c: G, s: '◣', size: 0.9, x: 0.6, y: 0.7 }) },
  { code: 'sl', name: 'Sierra Leone', flag: h(G, W, LB) },
  { code: 'sg', name: 'Singapore', flag: m(h(R, W), crescent(W, 0.18, 0.2, 0.26), { t: 'stars', c: W, n: 5, r: 0.04, spread: 0.1, x: 0.34, y: 0.26 }) },
  { code: 'sk', name: 'Slovakia', flag: m(h(W, DB, R), glyph(R, '⛨', 0.4, 0.34)) },
  { code: 'si', name: 'Slovenia', flag: m(h(W, DB, R), glyph(DB, '⛰', 0.3, 0.3, 0.34)) },
  { code: 'sb', name: 'Solomon Islands', flag: m(h(DB, G), { t: 'diag', c: Y, w: 0.14 }, { t: 'stars', c: W, n: 5, r: 0.06, spread: 0.16, x: 0.24, y: 0.3 }) },
  { code: 'so', name: 'Somalia', flag: m(one('#4189dd'), star(W, 0.32)) },
  { code: 'za', name: 'South Africa', flag: m(h(R, W, G, W, DB), tri(G, 0.5), tri(Y, 0.36), tri(K, 0.26)) },
  { code: 'ss', name: 'South Sudan', flag: m(h(K, W, R, W, G), tri(DB, 0.4), star(Y, 0.14, 0.14, 0.5)) },
  { code: 'es', name: 'Spain', flag: m(wt(h('#aa151b', '#f1bf00', '#aa151b'), 1, 2, 1), glyph('#aa151b', '⛨', 0.36, 0.35)) },
  { code: 'lk', name: 'Sri Lanka', flag: m(wt(v(G, O, MR), 1, 1, 4), glyph(Y, '🦁', 0.4, 0.72)) },
  { code: 'sd', name: 'Sudan', flag: m(h(R, W, K), tri(G, 0.36)) },
  { code: 'sr', name: 'Suriname', flag: m(wt(h(G, W, R, W, G), 2, 1, 4, 1, 2), star(Y, 0.24)) },
  { code: 'se', name: 'Sweden', flag: m(one('#005293'), nordic('#fecb00')) },
  { code: 'ch', name: 'Switzerland', flag: m(one('#d52b1e'), { t: 'plus', c: W, w: 0.2 }) },
  { code: 'sy', name: 'Syria', flag: m(h(R, W, K), star(G, 0.14, 0.38), star(G, 0.14, 0.62)) },
  { code: 'tw', name: 'Taiwan', flag: m(one(R), canton(DB, 0.5, 0.5), star(W, 0.16, 0.25, 0.26, 12)) },
  { code: 'tj', name: 'Tajikistan', flag: m(wt(h(R, W, G), 2, 3, 2), glyph(Y, '♔', 0.3)) },
  { code: 'tz', name: 'Tanzania', flag: m(h(G, K, LB), { t: 'diag', c: K, w: 0.3 }, { t: 'diag', c: Y, w: 0.4 }) },
  { code: 'th', name: 'Thailand', flag: wt(h(R, W, DB, W, R), 1, 1, 2, 1, 1) },
  { code: 'tl', name: 'Timor-Leste', flag: m(one(R), tri(Y, 0.6), tri(K, 0.42), star(W, 0.12, 0.18, 0.5)) },
  { code: 'tg', name: 'Togo', flag: m(h(G, Y, G, Y, G), canton(R, 0.42, 0.6), star(W, 0.14, 0.2, 0.3)) },
  { code: 'to', name: 'Tonga', flag: m(one(R), canton(W, 0.44, 0.5), glyph(R, '✚', 0.22, 0.22, 0.26)) },
  { code: 'tt', name: 'Trinidad and Tobago', flag: m(one(R), { t: 'diag', c: W, w: 0.34 }, { t: 'diag', c: K, w: 0.22 }) },
  { code: 'tn', name: 'Tunisia', flag: m(one(R), disc(W, 0.32), crescent(R, 0.2, 0.52)) },
  { code: 'tr', name: 'Türkiye', flag: m(one('#e30a17'), crescent(W, 0.26, 0.42), star(W, 0.12, 0.66)) },
  { code: 'tm', name: 'Turkmenistan', flag: m(one('#00843d'), { t: 'canton', c: MR, w: 0.24, h: 1 }, crescent(W, 0.2, 0.56), { t: 'stars', c: W, n: 5, r: 0.04, spread: 0.12, x: 0.72 }) },
  { code: 'tv', name: 'Tuvalu', flag: m(one('#5b97d1'), canton(DB, 0.44, 0.5), { t: 'stars', c: Y, n: 8, r: 0.05, spread: 0.2, x: 0.72 }) },
  { code: 'ug', name: 'Uganda', flag: m(h(K, Y, R, K, Y, R), disc(W, 0.26), glyph(K, '🐦', 0.22)) },
  { code: 'ua', name: 'Ukraine', flag: h('#005bbb', '#ffd500') },
  { code: 'ae', name: 'United Arab Emirates', flag: m(h(G, W, K), { t: 'canton', c: R, w: 0.26, h: 1 }) },
  { code: 'gb', name: 'United Kingdom', flag: m(one('#012169'), { t: 'diag', c: W, w: 0.3, both: true }, { t: 'diag', c: '#c8102e', w: 0.14, both: true }, { t: 'plus', c: W, w: 0.32 }, { t: 'plus', c: '#c8102e', w: 0.18 }) },
  { code: 'us', name: 'United States', flag: m(h(R, W, R, W, R, W, R, W, R, W, R, W, R), canton('#3c3b6e', 0.44, 0.54), { t: 'stars', c: W, n: 9, r: 0.045, spread: 0.16, x: 0.22, y: 0.27 }) },
  { code: 'uy', name: 'Uruguay', flag: m(h(W, B, W, B, W, B, W, B, W), canton(W, 0.44, 0.5), glyph(Y, '☀', 0.3, 0.22, 0.26)) },
  { code: 'uz', name: 'Uzbekistan', flag: m(h('#0099b5', W, '#1eb53a'), crescent(W, 0.14, 0.16, 0.22), { t: 'stars', c: W, n: 5, r: 0.03, spread: 0.1, x: 0.34, y: 0.22 }) },
  { code: 'vu', name: 'Vanuatu', flag: m(h(R, G), { t: 'band', c: Y, w: 0.14 }, tri(K, 0.4), glyph(Y, '❦', 0.2, 0.14, 0.5)) },
  { code: 'va', name: 'Vatican City', flag: m(v(Y, W), glyph('#c8a02a', '🔑', 0.5, 0.74)) },
  { code: 've', name: 'Venezuela', flag: m(h(Y, DB, R), { t: 'stars', c: W, n: 8, r: 0.05, spread: 0.18, y: 0.5 }) },
  { code: 'vn', name: 'Vietnam', flag: m(one('#da251d'), star(Y, 0.34)) },
  { code: 'ye', name: 'Yemen', flag: h(R, W, K) },
  { code: 'zm', name: 'Zambia', flag: m(one('#198a00'), { t: 'rect', c: R, x: 0.62, y: 0.55, w: 0.12, h: 0.45 }, { t: 'rect', c: K, x: 0.74, y: 0.55, w: 0.12, h: 0.45 }, { t: 'rect', c: O, x: 0.86, y: 0.55, w: 0.12, h: 0.45 }, glyph(O, '🦅', 0.3, 0.78, 0.26)) },
  { code: 'zw', name: 'Zimbabwe', flag: m(h(G, Y, R, K, R, Y, G), tri(W, 0.36), star(R, 0.14, 0.12, 0.5)) },
];

export const COUNTRY_BY_CODE = new Map(COUNTRIES.map((c) => [c.code, c]));

/** The shop item id a country's ball is sold under. */
export function flagItemId(code: string): string {
  return `ball_flag_${code}`;
}

/** And back again — null for anything that is not a flag ball. */
export function flagCodeOf(itemId: string): string | null {
  return itemId.startsWith('ball_flag_') ? itemId.slice('ball_flag_'.length) : null;
}

/* ------------------------------------------------------------- rendering - */

/**
 * Paint a flag into the box (-r, -r)–(r, r).
 *
 * The caller has already clipped to the ball's circle, so bands simply run the
 * full width and let the clip do the shaping. Everything is expressed as a
 * fraction of the box so the same description draws a ball and a shop swatch.
 */
export function paintFlag(ctx: CanvasRenderingContext2D, flag: Flag, r: number): void {
  const size = r * 2;
  const px = (fx: number) => -r + fx * size;

  const bands = flag.bands;
  const weights = flag.weights ?? bands.map(() => 1);
  const total = weights.reduce((a, b) => a + b, 0) || 1;

  let at = 0;
  for (let i = 0; i < bands.length; i++) {
    const span = (weights[i] / total) * size;
    ctx.fillStyle = bands[i];
    if (flag.dir === 'v') ctx.fillRect(-r + at, -r, span + 0.6, size);
    else ctx.fillRect(-r, -r + at, size, span + 0.6);
    at += span;
  }

  for (const mark of flag.marks ?? []) {
    ctx.save();
    switch (mark.t) {
      case 'disc':
        ctx.beginPath();
        ctx.arc(px(mark.x ?? 0.5), px(mark.y ?? 0.5), mark.r * r, 0, Math.PI * 2);
        ctx.fillStyle = mark.c;
        ctx.fill();
        break;

      case 'ring':
        ctx.beginPath();
        ctx.arc(px(mark.x ?? 0.5), px(mark.y ?? 0.5), mark.r * size, 0, Math.PI * 2);
        ctx.strokeStyle = mark.c;
        ctx.lineWidth = Math.max(1, mark.w * size);
        ctx.stroke();
        break;

      case 'star':
        drawStar(ctx, px(mark.x ?? 0.5), px(mark.y ?? 0.5), mark.r * r, mark.points ?? 5, mark.c);
        break;

      case 'stars': {
        // Around a circle, which is close enough for a ring of stars and for
        // the canton of a flag that has rather more of them than will fit.
        for (let i = 0; i < mark.n; i++) {
          const a = (i / mark.n) * Math.PI * 2 - Math.PI / 2;
          drawStar(
            ctx,
            px(mark.x ?? 0.5) + Math.cos(a) * mark.spread * size,
            px(mark.y ?? 0.5) + Math.sin(a) * mark.spread * size,
            mark.r * size,
            5,
            mark.c,
          );
        }
        break;
      }

      case 'crescent': {
        // Cut a smaller circle out of a larger one, offset to leave a horn.
        const cx = px(mark.x ?? 0.5);
        const cy = px(mark.y ?? 0.5);
        const rad = mark.r * size;
        ctx.beginPath();
        ctx.arc(cx, cy, rad, 0, Math.PI * 2);
        ctx.fillStyle = mark.c;
        ctx.fill();
        ctx.globalCompositeOperation = 'destination-out';
        ctx.beginPath();
        ctx.arc(cx + rad * 0.34, cy, rad * 0.86, 0, Math.PI * 2);
        ctx.fillStyle = '#000';
        ctx.fill();
        break;
      }

      case 'nordic': {
        // The upright sits a third of the way across; the arm is centred.
        const armW = mark.w * size;
        const uprightX = px(0.36);
        const paint = (colour: string, width: number) => {
          ctx.fillStyle = colour;
          ctx.fillRect(uprightX - width / 2, -r, width, size);
          ctx.fillRect(-r, -width / 2, size, width);
        };
        if (mark.edge) paint(mark.edge, (mark.edgeW ?? mark.w * 1.7) * size);
        paint(mark.c, armW);
        break;
      }

      case 'plus':
        ctx.fillStyle = mark.c;
        ctx.fillRect(-(mark.w * size) / 2, -r, mark.w * size, size);
        ctx.fillRect(-r, -(mark.w * size) / 2, size, mark.w * size);
        break;

      case 'canton':
        ctx.fillStyle = mark.c;
        ctx.fillRect(-r, -r, mark.w * size, mark.h * size);
        break;

      case 'rect':
        ctx.fillStyle = mark.c;
        ctx.fillRect(px(mark.x), px(mark.y), mark.w * size, mark.h * size);
        break;

      case 'tri':
        ctx.beginPath();
        if (mark.from === 'r') {
          ctx.moveTo(r, -r);
          ctx.lineTo(r, r);
          ctx.lineTo(r - mark.w * size, 0);
        } else {
          ctx.moveTo(-r, -r);
          ctx.lineTo(-r, r);
          ctx.lineTo(-r + mark.w * size, 0);
        }
        ctx.closePath();
        ctx.fillStyle = mark.c;
        ctx.fill();
        break;

      case 'diag':
        ctx.strokeStyle = mark.c;
        ctx.lineWidth = mark.w * size;
        ctx.beginPath();
        ctx.moveTo(-r, -r);
        ctx.lineTo(r, r);
        ctx.stroke();
        if (mark.both) {
          ctx.beginPath();
          ctx.moveTo(-r, r);
          ctx.lineTo(r, -r);
          ctx.stroke();
        }
        break;

      case 'band': {
        const width = mark.w * size;
        const centre = px(mark.at ?? 0.5);
        ctx.fillStyle = mark.c;
        if (mark.dir === 'v') ctx.fillRect(centre - width / 2, -r, width, size);
        else ctx.fillRect(-r, centre - width / 2, size, width);
        break;
      }

      case 'glyph':
        ctx.font = `${Math.max(6, (mark.size ?? 0.6) * size)}px system-ui, "Segoe UI Emoji", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = mark.c;
        ctx.fillText(mark.s, px(mark.x ?? 0.5), px(mark.y ?? 0.5));
        ctx.textBaseline = 'alphabetic';
        break;
    }
    ctx.restore();
  }
}

function drawStar(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  points: number,
  colour: string,
): void {
  ctx.beginPath();
  for (let i = 0; i < points; i++) {
    const outer = (i * 2 * Math.PI) / points - Math.PI / 2;
    const inner = outer + Math.PI / points;
    ctx.lineTo(cx + Math.cos(outer) * radius, cy + Math.sin(outer) * radius);
    ctx.lineTo(cx + Math.cos(inner) * radius * 0.42, cy + Math.sin(inner) * radius * 0.42);
  }
  ctx.closePath();
  ctx.fillStyle = colour;
  ctx.fill();
}
