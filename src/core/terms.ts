/* ============================================================
   The 24 solar terms (節氣): the moments the Sun's apparent longitude reaches a multiple of 15°.
   The Sun is placed with the VSOP87 theory of the Earth, truncated as in Meeus, "Astronomical Algorithms",
   with nutation, aberration and ΔT (Espenak & Meeus). A term's moment is good to about a minute for 1900–2100;
   which day it falls on is read on China's clock (as almanacs print it) or on any other zone.
   ============================================================ */
import { DAY, partsInTz, dayNum } from './time';

/** Term k is at longitude 15k°: 0 春分 … 18 冬至 … 23 驚蟄. */
export const TERM_NAMES = ['春分', '清明', '穀雨', '立夏', '小滿', '芒種', '夏至', '小暑', '大暑', '立秋', '處暑', '白露', '秋分', '寒露', '霜降', '立冬', '小雪', '大雪', '冬至', '小寒', '大寒', '立春', '雨水', '驚蟄'];
/** The terms in the order a civil year meets them: 小寒 in January … 冬至 in December. */
export const TERMS_IN_YEAR = [19, 20, 21, 22, 23, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];
/** The clock the almanac reads a term's day on: China, UTC+8 (from 1929; Beijing local mean time before). */
export const CHINA_TZ = 'Asia/Shanghai';

type Term3 = readonly [number, number, number];
const L0: Term3[] = [[175347046, 0, 0], [3341656, 4.6692568, 6283.07585], [34894, 4.6261, 12566.1517], [3497, 2.7441, 5753.3849], [3418, 2.8289, 3.5231],
  [3136, 3.6277, 77713.7715], [2676, 4.4181, 7860.4194], [2343, 6.1352, 3930.2097], [1324, 0.7425, 11506.7698], [1273, 2.0371, 529.691], [1199, 1.1096, 1577.3435],
  [990, 5.233, 5884.927], [902, 2.045, 26.298], [857, 3.508, 398.149], [780, 1.179, 5223.694], [753, 2.533, 5507.553], [505, 4.583, 18849.228], [492, 4.205, 775.523],
  [357, 2.92, 0.067], [317, 5.849, 11790.629], [284, 1.899, 796.298], [271, 0.315, 10977.079], [243, 0.345, 5486.778], [206, 4.806, 2544.314], [205, 1.869, 5573.143],
  [202, 2.458, 6069.777], [156, 0.833, 213.299], [132, 3.411, 2942.463], [126, 1.083, 20.775], [115, 0.645, 0.98], [103, 0.636, 4694.003], [102, 0.976, 15720.839],
  [102, 4.267, 7.114], [99, 6.21, 2146.17], [98, 0.68, 155.42], [86, 5.98, 161000.69], [85, 1.3, 6275.96], [85, 3.67, 71430.7], [80, 1.81, 17260.15], [79, 3.04, 12036.46],
  [75, 1.76, 5088.63], [74, 3.5, 3154.69], [74, 4.68, 801.82], [70, 0.83, 9437.76], [62, 3.98, 8827.39], [61, 1.82, 7084.9], [57, 2.78, 6286.6], [56, 4.39, 14143.5],
  [56, 3.47, 6279.55], [52, 0.19, 12139.55], [52, 1.33, 1748.02], [51, 0.28, 5856.48], [49, 0.49, 1194.45], [41, 5.37, 8429.24], [41, 2.4, 19651.05], [39, 6.17, 10447.39],
  [37, 6.04, 10213.29], [37, 2.57, 1059.38], [36, 1.71, 2352.87], [36, 1.78, 6812.77], [33, 0.59, 17789.85], [30, 0.44, 83996.85], [30, 2.74, 1349.87], [25, 3.16, 4690.48]];
const L1: Term3[] = [[628331966747, 0, 0], [206059, 2.678235, 6283.07585], [4303, 2.6351, 12566.1517], [425, 1.59, 3.523], [119, 5.796, 26.298], [109, 2.966, 1577.344],
  [93, 2.59, 18849.23], [72, 1.14, 529.69], [68, 1.87, 398.15], [67, 4.41, 5507.55], [59, 2.89, 5223.69], [56, 2.17, 155.42], [45, 0.4, 796.3], [36, 0.47, 775.52],
  [29, 2.65, 7.11], [21, 5.34, 0.98], [19, 1.85, 5486.78], [19, 4.97, 213.3], [17, 2.99, 6275.96], [16, 0.03, 2544.31], [16, 1.43, 2146.17], [15, 1.21, 10977.08],
  [12, 2.83, 1748.02], [12, 3.26, 5088.63], [12, 5.27, 1194.45], [12, 2.08, 4694], [11, 0.77, 553.57], [10, 1.3, 6286.6], [10, 4.24, 1349.87], [9, 2.7, 242.73],
  [9, 5.64, 951.72], [8, 5.3, 2352.87], [6, 2.65, 9437.76], [6, 4.67, 4690.48]];
const L2: Term3[] = [[52919, 0, 0], [8720, 1.0721, 6283.0758], [309, 0.867, 12566.152], [27, 0.05, 3.52], [16, 5.19, 26.3], [16, 3.68, 155.42], [10, 0.76, 18849.23],
  [9, 2.06, 77713.77], [7, 0.83, 775.52], [5, 4.66, 1577.34], [4, 1.03, 7.11], [4, 3.44, 5573.14], [3, 5.14, 796.3], [3, 6.05, 5507.55], [3, 1.19, 242.73],
  [3, 6.12, 529.69], [3, 0.31, 398.15], [3, 2.28, 553.57], [2, 4.38, 5223.69], [2, 3.75, 0.98]];
const L3: Term3[] = [[289, 5.844, 6283.076], [35, 0, 0], [17, 5.49, 12566.15], [3, 5.2, 155.42], [1, 4.72, 3.52], [1, 5.3, 18849.23], [1, 5.97, 242.73]];
const L4: Term3[] = [[114, 3.142, 0], [8, 4.13, 6283.08], [1, 3.84, 12566.15]];
const L5: Term3[] = [[1, 3.14, 0]];
const R0: Term3[] = [[100013989, 0, 0], [1670700, 3.0984635, 6283.07585], [13956, 3.05525, 12566.1517], [3084, 5.1985, 77713.7715], [1628, 1.1739, 5753.3849], [1576, 2.8469, 7860.4194]];
const R1: Term3[] = [[103019, 1.10749, 6283.07585], [1721, 1.0644, 12566.1517]];

const sum = (s: Term3[], t: number) => s.reduce((a, [A, B, C]) => a + A * Math.cos(B + C * t), 0);
const RAD = Math.PI / 180;
const norm = (x: number) => ((x % 360) + 360) % 360;

/** The Sun's apparent geocentric longitude in degrees at Julian Ephemeris Day `jde`. */
export function sunLongitude(jde: number): number {
  const tau = (jde - 2451545) / 365250, T = tau * 10;
  const L = (sum(L0, tau) + tau * (sum(L1, tau) + tau * (sum(L2, tau) + tau * (sum(L3, tau) + tau * (sum(L4, tau) + tau * sum(L5, tau)))))) / 1e8;
  const R = (sum(R0, tau) + tau * sum(R1, tau)) / 1e8;
  const geo = norm(L / RAD + 180) - 0.09033 / 3600;
  const om = (125.04452 - 1934.136261 * T) * RAD, ls = (280.4665 + 36000.7698 * T) * RAD, lm = (218.3165 + 481267.8813 * T) * RAD;
  const dpsi = -17.2 * Math.sin(om) - 1.32 * Math.sin(2 * ls) - 0.23 * Math.sin(2 * lm) + 0.21 * Math.sin(2 * om);
  return norm(geo + (dpsi - 20.4898 / R) / 3600);
}
/** TT − UT in seconds (Espenak & Meeus, 2006). */
export function deltaT(y: number): number {
  let t: number;
  if (y < 1600) { const u = (y - 1820) / 100; return -20 + 32 * u * u; }
  if (y < 1700) { t = y - 1600; return 120 - 0.9808 * t - 0.01532 * t * t + t ** 3 / 7129; }
  if (y < 1800) { t = y - 1700; return 8.83 + 0.1603 * t - 0.0059285 * t * t + 0.00013336 * t ** 3 - t ** 4 / 1174000; }
  if (y < 1860) { t = y - 1800; return 13.72 - 0.332447 * t + 0.0068612 * t * t + 0.0041116 * t ** 3 - 0.00037436 * t ** 4 + 0.0000121272 * t ** 5 - 0.0000001699 * t ** 6 + 0.000000000875 * t ** 7; }
  if (y < 1900) { t = y - 1860; return 7.62 + 0.5737 * t - 0.251754 * t * t + 0.01680668 * t ** 3 - 0.0004473624 * t ** 4 + t ** 5 / 233174; }
  if (y < 1920) { t = y - 1900; return -2.79 + 1.494119 * t - 0.0598939 * t * t + 0.0061966 * t ** 3 - 0.000197 * t ** 4; }
  if (y < 1941) { t = y - 1920; return 21.2 + 0.84493 * t - 0.0761 * t * t + 0.0020936 * t ** 3; }
  if (y < 1961) { t = y - 1950; return 29.07 + 0.407 * t - t * t / 233 + t ** 3 / 2547; }
  if (y < 1986) { t = y - 1975; return 45.45 + 1.067 * t - t * t / 260 - t ** 3 / 718; }
  if (y < 2005) { t = y - 2000; return 63.86 + 0.3345 * t - 0.060374 * t * t + 0.0017275 * t ** 3 + 0.000651814 * t ** 4 + 0.00002373599 * t ** 5; }
  if (y < 2050) { t = y - 2000; return 62.92 + 0.32217 * t + 0.005589 * t * t; }
  if (y < 2150) { const u = (y - 1820) / 100; return -20 + 32 * u * u - 0.5628 * (2150 - y); }
  const u = (y - 1820) / 100;
  return -20 + 32 * u * u;
}
const JD_UNIX = 2440587.5;
const cache = new Map<number, number>();
/** The instant (ms) of term k in civil year y: 小寒–驚蟄 in its first months, 春分–冬至 after. */
export function termMoment(y: number, k: number): number {
  const key = y * 24 + k;
  const hit = cache.get(key);
  if (hit != null) return hit;
  const lon = 15 * k;
  // the March equinox of y, near enough to start from
  const eq = 2451623.81 + 365.2422 * (y - 2000);
  let jde = eq + (k >= 19 ? -(360 - lon) : lon) / 360 * 365.2422;
  for (let i = 0; i < 12; i++) {
    const d = ((lon - sunLongitude(jde) + 540) % 360) - 180;
    jde += d / 360 * 365.2422;
    if (Math.abs(d) < 1e-7) break;
  }
  const jd = jde - deltaT(y + (jde - eq) / 365.2422) / 86400;
  const ms = Math.round((jd - JD_UNIX) * DAY);
  cache.set(key, ms);
  return ms;
}
export interface TermAt { k: number; ms: number }
/** The 24 terms of civil year y, in order. */
export const termsOfYear = (y: number): TermAt[] => TERMS_IN_YEAR.map((k) => ({ k, ms: termMoment(y, k) }));
/** The last term at or before `ms` and the next one after. */
export function termAround(ms: number): { prev: TermAt; next: TermAt } {
  const y = new Date(ms).getUTCFullYear();
  const all = [...termsOfYear(y - 1), ...termsOfYear(y), ...termsOfYear(y + 1)];
  let i = all.findIndex((t) => t.ms > ms);
  if (i <= 0) i = 1;
  return { prev: all[i - 1], next: all[i] };
}
/** The day number a term's moment falls on, on this clock. */
export function termDay(y: number, k: number, tz: string): number {
  const ms = termMoment(y, k);
  if (tz === CHINA_TZ) return chinaDay(ms);
  const w = partsInTz(ms, tz);
  return dayNum(w.y, w.mo, w.d);
}
const dayCache = new Map<string, Map<number, number>>();
/** The term that falls on civil day n on this clock, if any. */
export function termOnDay(n: number, tz: string): number | null {
  const y = new Date(n * DAY).getUTCFullYear();
  const key = `${tz}|${y}`;
  let m = dayCache.get(key);
  if (!m) {
    m = new Map();
    for (const yy of [y - 1, y, y + 1]) for (const k of TERMS_IN_YEAR) m.set(termDay(yy, k, tz), k);
    dayCache.set(key, m);
  }
  return m.get(n) ?? null;
}
/** The position of term k in its civil year (0 = 小寒). */
export const termIndexInYear = (k: number) => TERMS_IN_YEAR.indexOf(k);

/* ---------- China's clock for the calendar ---------- */
/** The civil day on China's clock: UTC+8 from 1929, Beijing local mean time (UTC+7:45:40) before, as the calendar was reckoned. */
export function chinaDay(ms: number): number {
  const y = new Date(ms).getUTCFullYear();
  const off = y < 1929 ? 27940000 : 28800000;
  return Math.floor((ms + off) / DAY);
}

/* ---------- new moons (Meeus, chapter 49) ---------- */
const SYNODIC = 29.530588861;
/** The instant (ms) of new moon number k (k = 0 is the one of 2000-01-06). */
export function newMoonMs(k: number): number {
  const T = k / 1236.85, T2 = T * T, T3 = T2 * T, T4 = T3 * T;
  let jde = 2451550.09766 + SYNODIC * k + 0.00015437 * T2 - 0.00000015 * T3 + 0.00000000073 * T4;
  const E = 1 - 0.002516 * T - 0.0000074 * T2;
  const M = (2.5534 + 29.1053567 * k - 0.0000014 * T2 - 0.00000011 * T3) * RAD;
  const Mp = (201.5643 + 385.81693528 * k + 0.0107582 * T2 + 0.00001238 * T3 - 0.000000058 * T4) * RAD;
  const F = (160.7108 + 390.67050284 * k - 0.0016118 * T2 - 0.00000227 * T3 + 0.000000011 * T4) * RAD;
  const Om = (124.7746 - 1.56375588 * k + 0.0020672 * T2 + 0.00000215 * T3) * RAD;
  const s = Math.sin;
  jde += -0.4072 * s(Mp) + 0.17241 * E * s(M) + 0.01608 * s(2 * Mp) + 0.01039 * s(2 * F) + 0.00739 * E * s(Mp - M) - 0.00514 * E * s(Mp + M)
    + 0.00208 * E * E * s(2 * M) - 0.00111 * s(Mp - 2 * F) - 0.00057 * s(Mp + 2 * F) + 0.00056 * E * s(2 * Mp + M) - 0.00042 * s(3 * Mp)
    + 0.00042 * E * s(M + 2 * F) + 0.00038 * E * s(M - 2 * F) - 0.00024 * E * s(2 * Mp - M) - 0.00017 * s(Om) - 0.00007 * s(Mp + 2 * M)
    + 0.00004 * s(2 * Mp - 2 * F) + 0.00004 * s(3 * M) + 0.00003 * s(Mp + M - 2 * F) + 0.00003 * s(2 * Mp + 2 * F) - 0.00003 * s(Mp + M + 2 * F)
    + 0.00003 * s(Mp - M + 2 * F) - 0.00002 * s(Mp - M - 2 * F) - 0.00002 * s(3 * Mp + M) + 0.00002 * s(4 * Mp);
  const A = [[299.77 + 0.107408 * k - 0.009173 * T2, 0.000325], [251.88 + 0.016321 * k, 0.000165], [251.83 + 26.651886 * k, 0.000164], [349.42 + 36.412478 * k, 0.000126],
    [84.66 + 18.206239 * k, 0.00011], [141.74 + 53.303771 * k, 0.000062], [207.14 + 2.453732 * k, 0.00006], [154.84 + 7.30686 * k, 0.000056], [34.52 + 27.261239 * k, 0.000047],
    [207.19 + 0.121824 * k, 0.000042], [291.34 + 1.844379 * k, 0.00004], [161.72 + 24.198154 * k, 0.000037], [239.56 + 25.513099 * k, 0.000035], [331.55 + 3.592518 * k, 0.000023]];
  for (const [a, c] of A) jde += c * s(a * RAD);
  const y = 2000 + k / 12.3685;
  return Math.round((jde - deltaT(y) / 86400 - JD_UNIX) * DAY);
}
/** The number of the last new moon whose day (on China's clock) is on or before day n. */
export function newMoonOnOrBefore(n: number): number {
  let k = Math.floor((n + JD_UNIX - 2451550.09766) / SYNODIC) + 1;
  while (chinaDay(newMoonMs(k)) > n) k--;
  while (chinaDay(newMoonMs(k + 1)) <= n) k++;
  return k;
}
