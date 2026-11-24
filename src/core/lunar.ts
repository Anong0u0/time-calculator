/* ============================================================
   The Chinese lunisolar calendar (農曆), reckoned here the way the almanac is:
   a month begins on the day of a new moon (on China's clock); the month holding 冬至 is the eleventh;
   when twelve months from one such month to the next are not enough (thirteen new moons fall between),
   the first month holding no major term (中氣) is the leap month and repeats the number before it.
   New moons and terms come from terms.ts, so no table is shipped and every year works the same way.
   Outside about 1900–2100 the dates are computed, not checked against a printed almanac.
   ============================================================ */
import { type YMD, dayNum, fromDayNum } from './time';
import { newMoonMs, newMoonOnOrBefore, chinaDay, termDay, CHINA_TZ } from './terms';

export interface LunarMonth {
  m: number;
  leap: boolean;
  start: number;
  len: number;
}
export interface LunarYear {
  y: number;
  start: number;
  end: number;
  months: LunarMonth[];
}
export interface LunarDate {
  y: number;
  m: number;
  leap: boolean;
  d: number;
  len: number;
}

export const LUNAR_MIN = 2,
  LUNAR_MAX = 9998;

/* ---------- a 歲: from the month of one 冬至 to the month of the next ---------- */
const suiCache = new Map<number, LunarMonth[]>();
/** The months from the one holding 冬至 of year y−1 to the one before the month holding 冬至 of year y. */
function sui(y: number): LunarMonth[] {
  const hit = suiCache.get(y);
  if (hit) return hit;
  const k0 = newMoonOnOrBefore(termDay(y - 1, 18, CHINA_TZ)),
    k1 = newMoonOnOrBefore(termDay(y, 18, CHINA_TZ));
  const starts: number[] = [];
  for (let k = k0; k <= k1; k++) starts.push(chinaDay(newMoonMs(k)));
  // the major terms (even k: 春分, 穀雨 … 冬至, 大寒, 雨水) of the stretch
  const zq: number[] = [];
  for (const yy of [y - 1, y]) for (let t = 0; t < 24; t += 2) zq.push(termDay(yy, t, CHINA_TZ));
  const leapYear = starts.length - 1 === 13;
  const out: LunarMonth[] = [];
  let m = 11,
    leapDone = false;
  for (let i = 0; i < starts.length - 1; i++) {
    const s = starts[i],
      e = starts[i + 1];
    let leap = false;
    if (i > 0) {
      if (leapYear && !leapDone && !zq.some((n) => n >= s && n < e)) {
        leap = true;
        leapDone = true;
      } else m = (m % 12) + 1;
    }
    out.push({ m, leap, start: s, len: e - s });
  }
  suiCache.set(y, out);
  return out;
}
const yearCache = new Map<number, LunarYear>();
/** The months of lunar year y: from its 正月初一 to the day before the next one. */
export function lunarYear(y: number): LunarYear | null {
  if (!Number.isFinite(y) || y < LUNAR_MIN || y > LUNAR_MAX) return null;
  const hit = yearCache.get(y);
  if (hit) return hit;
  const a = sui(y),
    b = sui(y + 1);
  const ia = a.findIndex((x) => x.m === 1 && !x.leap),
    ib = b.findIndex((x) => x.m === 1 && !x.leap);
  const months = [...a.slice(ia), ...b.slice(0, ib)];
  const out = { y, start: months[0].start, end: b[ib].start, months };
  yearCache.set(y, out);
  return out;
}
/** The lunar date of a civil day. */
export function lunarOfDay(n: number): LunarDate | null {
  const gy = fromDayNum(n).y;
  let ly = lunarYear(gy);
  if (!ly) return null;
  if (n < ly.start) {
    ly = lunarYear(gy - 1);
    if (!ly) return null;
  }
  for (const mo of ly.months)
    if (n >= mo.start && n < mo.start + mo.len)
      return { y: ly.y, m: mo.m, leap: mo.leap, d: n - mo.start + 1, len: mo.len };
  return null;
}
export const lunarOf = (w: YMD) => lunarOfDay(dayNum(w.y, w.mo, w.d));
export function lunarMonthOf(y: number, m: number, leap = false): LunarMonth | null {
  return lunarYear(y)?.months.find((x) => x.m === m && x.leap === leap) ?? null;
}
/** The civil day of a lunar date, or null when that month (a leap month) or that day (30 in a short month) does not exist. */
export function fromLunar(y: number, m: number, d: number, leap = false): number | null {
  const mo = lunarMonthOf(y, m, leap);
  if (!mo || d < 1 || d > mo.len) return null;
  return mo.start + d - 1;
}
/** 春節 (正月初一) of the lunar year that begins in civil year y. */
export function lunarNewYear(y: number): YMD | null {
  const ly = lunarYear(y);
  return ly ? fromDayNum(ly.start) : null;
}

/* ---------- names ---------- */
export const LUNAR_MONTHS = [
  '正月',
  '二月',
  '三月',
  '四月',
  '五月',
  '六月',
  '七月',
  '八月',
  '九月',
  '十月',
  '冬月',
  '臘月',
];
export const LUNAR_DAYS = Array.from({ length: 30 }, (_, i) => lunarDayName(i + 1));
export function lunarDayName(d: number): string {
  const ones = '一二三四五六七八九十';
  if (d === 10) return '初十';
  if (d === 20) return '二十';
  if (d === 30) return '三十';
  return '初十廿'[Math.floor(d / 10)] + ones[(d % 10) - 1];
}
export const lunarMonthName = (m: number, leap = false) => (leap ? '閏' : '') + LUNAR_MONTHS[m - 1];
const STEMS = '甲乙丙丁戊己庚辛壬癸',
  BRANCHES = '子丑寅卯辰巳午未申酉戌亥',
  ANIMALS = '鼠牛虎兔龍蛇馬羊猴雞狗豬';
const m60 = (n: number, k: number) => ((n % k) + k) % k;
/** 丙午 for 2026. */
export const ganzhi = (y: number) => STEMS[m60(y - 4, 10)] + BRANCHES[m60(y - 4, 12)];
export const zodiac = (y: number) => ANIMALS[m60(y - 4, 12)];
/** 丙午年 十月十六 */
export const fmtLunar = (l: LunarDate) => `${ganzhi(l.y)}年 ${lunarMonthName(l.m, l.leap)}${lunarDayName(l.d)}`;
