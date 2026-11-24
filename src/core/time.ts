/* ============================================================
   Time Calculator · core
   Pure date/time math. No DOM. Shared by the app and the tests.
   Proleptic Gregorian calendar, IANA zones through Intl.
   ============================================================ */

export const SEC = 1000;
export const MIN = 60000;
export const HOUR = 3600000;
export const DAY = 86400000;
export const YEAR_MIN = 1;
export const YEAR_MAX = 9999;

/** A wall-clock reading: what a clock on the wall of some zone shows. */
export interface Wall { y: number; mo: number; d: number; h: number; mi: number; s: number }
export interface YMD { y: number; mo: number; d: number }
/** A calendar-aware length: calendar units on the wall clock, then exact units. */
export interface Span { sign: 1 | -1; y: number; mo: number; w: number; d: number; h: number; mi: number; s: number; biz: boolean }
export interface CalDiff { y: number; mo: number; d: number; h: number; mi: number; s: number }

export const pad = (n: number, w = 2): string => {
  const s = String(Math.abs(Math.trunc(n))).padStart(w, '0');
  return n < 0 ? '-' + s : s;
};
export const floorDiv = (a: number, b: number) => Math.floor(a / b);
export const mod = (a: number, b: number) => ((a % b) + b) % b;
export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/* ---------- civil calendar ---------- */
export function utcMs(y: number, mo: number, d: number, h = 0, mi = 0, s = 0): number {
  const dt = new Date(0);
  dt.setUTCFullYear(y, mo - 1, d);
  dt.setUTCHours(h, mi, s, 0);
  return dt.getTime();
}
export const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
/** The first leap year after y. */
export function nextLeap(y: number): number { let n = y + 1; while (!isLeap(n)) n++; return n; }
const MDAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
export const daysInMonth = (y: number, mo: number) => (mo === 2 && isLeap(y) ? 29 : MDAYS[mo - 1]);
/** Days since 1970-01-01. */
export const dayNum = (y: number, mo: number, d: number) => floorDiv(utcMs(y, mo, d), DAY);
export function fromDayNum(n: number): YMD {
  const dt = new Date(n * DAY);
  return { y: dt.getUTCFullYear(), mo: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}
/** 0 = Sunday. */
export const weekdayOf = (y: number, mo: number, d: number) => mod(dayNum(y, mo, d) + 4, 7);
export const dayOfYear = (y: number, mo: number, d: number) => dayNum(y, mo, d) - dayNum(y, 1, 1) + 1;
export const daysInYear = (y: number) => (isLeap(y) ? 366 : 365);

export function addMonthsWall<T extends YMD>(w: T, months: number): T {
  const total = w.y * 12 + (w.mo - 1) + months;
  const y = floorDiv(total, 12), mo = mod(total, 12) + 1;
  return { ...w, y, mo, d: Math.min(w.d, daysInMonth(y, mo)) };
}
export function addDaysWall<T extends YMD>(w: T, days: number): T {
  const p = fromDayNum(dayNum(w.y, w.mo, w.d) + days);
  return { ...w, y: p.y, mo: p.mo, d: p.d };
}
/** The wall clock read as if it were UTC. */
export const wallKey = (w: Partial<Wall> & YMD) => utcMs(w.y, w.mo, w.d, w.h || 0, w.mi || 0, w.s || 0);
export const wallOfKey = (k: number): Wall => {
  const dt = new Date(k);
  return { y: dt.getUTCFullYear(), mo: dt.getUTCMonth() + 1, d: dt.getUTCDate(), h: dt.getUTCHours(), mi: dt.getUTCMinutes(), s: dt.getUTCSeconds() };
};

/* ---------- ISO 8601 week date ---------- */
export function isoWeek(y: number, mo: number, d: number) {
  const n = dayNum(y, mo, d);
  const wd = mod(n + 3, 7); // Monday = 0
  const thursday = fromDayNum(n - wd + 3);
  const week = 1 + floorDiv(n - wd + 3 - dayNum(thursday.y, 1, 1), 7);
  return { weekYear: thursday.y, week, weekday: wd + 1 }; // weekday 1 = Monday
}
export const isoWeeksInYear = (y: number) => isoWeek(y, 12, 28).week;
export function isoWeekStart(weekYear: number, week: number): YMD {
  const jan4 = dayNum(weekYear, 1, 4);
  const monday1 = jan4 - mod(jan4 + 3, 7);
  return fromDayNum(monday1 + (week - 1) * 7);
}
/** Week 1 contains Jan 1; weeks start on Sunday. */
export function usWeek(y: number, mo: number, d: number) {
  const jan1wd = weekdayOf(y, 1, 1);
  return floorDiv(dayOfYear(y, mo, d) - 1 + jan1wd, 7) + 1;
}

/* ---------- time zones ---------- */
const fmtCache = new Map<string, Intl.DateTimeFormat>();
export function tzFormatter(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', era: 'short',
      year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric',
    });
    fmtCache.set(tz, f);
  }
  return f;
}
export function isValidTz(tz: unknown): tz is string {
  if (!tz || typeof tz !== 'string') return false;
  try { tzFormatter(tz); return true; } catch { return false; }
}
export function partsInTz(ms: number, tz: string): Wall {
  const o: Record<string, string> = {};
  for (const p of tzFormatter(tz).formatToParts(new Date(ms))) o[p.type] = p.value;
  let y = +o.year;
  if (o.era && /^B/i.test(o.era)) y = 1 - y;
  let h = +o.hour;
  if (h === 24) h = 0;
  return { y, mo: +o.month, d: +o.day, h, mi: +o.minute, s: +o.second };
}
/** local − UTC in ms (second precision). */
export function offsetAt(ms: number, tz: string): number {
  return wallKey(partsInTz(ms, tz)) - floorDiv(ms, SEC) * SEC;
}
export type WallNote = null | 'gap' | 'overlap' | 'range';
/** Wall clock in a zone → instant. Gaps push forward, overlaps take the earlier instant (Temporal "compatible"). */
export function wallToInstant(w: Wall, tz: string): { ms: number; note: WallNote } {
  const local = wallKey(w);
  const offA = offsetAt(local - DAY, tz), offB = offsetAt(local + DAY, tz);
  const cands: number[] = [];
  for (const off of offA === offB ? [offA] : [offA, offB]) {
    const t = local - off;
    if (offsetAt(t, tz) === off) cands.push(t);
  }
  if (cands.length === 1) return { ms: cands[0], note: null };
  if (cands.length > 1) return { ms: Math.min(...cands), note: 'overlap' };
  const off = offsetAt(local, tz), t = local - off;
  if (offsetAt(t, tz) === off) return { ms: t, note: null };
  return { ms: local - offA, note: 'gap' };
}
export const toInstant = (w: Wall, tz: string) => wallToInstant(w, tz).ms;

export function fmtOffset(offMs: number, { utc = true, compact = false } = {}): string {
  const sign = offMs < 0 ? '−' : '+';
  const a = Math.abs(Math.round(offMs / SEC));
  const h = floorDiv(a, 3600), m = floorDiv(a % 3600, 60), s = a % 60;
  const body = compact ? h + (m ? ':' + pad(m) : '') + (s ? ':' + pad(s) : '') : pad(h) + ':' + pad(m) + (s ? ':' + pad(s) : '');
  if (a === 0) return utc ? (compact ? 'UTC' : 'UTC±00:00') : (compact ? '0' : '+00:00');
  return (utc ? 'UTC' : '') + sign + body;
}
export function isoOffset(off: number): string {
  const a = Math.abs(Math.round(off / MIN));
  return (off < 0 ? '-' : '+') + pad(Math.floor(a / 60)) + ':' + pad(a % 60);
}

/* ---------- arithmetic on instants ---------- */
export function addBusinessDays<T extends YMD>(w: T, n: number): T {
  let num = dayNum(w.y, w.mo, w.d);
  const step = n < 0 ? -1 : 1;
  let left = Math.abs(n);
  const weeks = floorDiv(left, 5);
  if (weeks > 1) {
    const wd = mod(num + 4, 7);
    if (wd !== 0 && wd !== 6) { num += step * (weeks - 1) * 7; left -= (weeks - 1) * 5; }
  }
  while (left > 0) {
    num += step;
    const wd = mod(num + 4, 7);
    if (wd !== 0 && wd !== 6) left--;
  }
  const p = fromDayNum(num);
  return { ...w, y: p.y, mo: p.mo, d: p.d };
}
/** Same order as Luxon / Temporal: calendar units on the wall clock, then exact units. */
export function addDuration(ms: number, tz: string, dur: Partial<Span>, sign = 1, businessDays = false): { ms: number; note: WallNote } {
  const w = partsInTz(ms, tz);
  let cur = addMonthsWall(w, sign * ((dur.y || 0) * 12 + (dur.mo || 0)));
  const days = sign * ((dur.w || 0) * 7 + (dur.d || 0));
  if (businessDays && dur.d) {
    cur = addDaysWall(cur, sign * (dur.w || 0) * 7);
    cur = addBusinessDays(cur, sign * dur.d);
  } else if (days) {
    cur = addDaysWall(cur, days);
  }
  if (cur.y < YEAR_MIN || cur.y > YEAR_MAX) return { ms: NaN, note: 'range' };
  const r = wallToInstant(cur, tz);
  const exact = sign * (((dur.h || 0) * 3600 + (dur.mi || 0) * 60 + (dur.s || 0)) * SEC);
  return { ms: r.ms + exact, note: exact ? null : r.note };
}

/** Calendar difference a → b (a ≤ b) measured on the wall clock of `tz`. */
export function diffCalendar(a: number, b: number, tz: string): CalDiff {
  const A = partsInTz(a, tz), B = partsInTz(b, tz);
  let months = (B.y - A.y) * 12 + (B.mo - A.mo);
  let cursor = toInstant(addMonthsWall(A, months), tz);
  while (months > 0 && cursor > b) { months--; cursor = toInstant(addMonthsWall(A, months), tz); }
  for (;;) {
    const next = toInstant(addMonthsWall(A, months + 1), tz);
    if (next <= b) months++; else break;
  }
  const base = addMonthsWall(A, months);
  let days = dayNum(B.y, B.mo, B.d) - dayNum(base.y, base.mo, base.d);
  let t = toInstant(addDaysWall(base, days), tz);
  while (days > 0 && t > b) { days--; t = toInstant(addDaysWall(base, days), tz); }
  let rest = Math.round((b - t) / SEC);
  const h = floorDiv(rest, 3600); rest -= h * 3600;
  const mi = floorDiv(rest, 60);
  const s = rest - mi * 60;
  return { y: floorDiv(months, 12), mo: mod(months, 12), d: days, h, mi, s };
}

/** Weekdays (Mon–Fri) in day numbers [n0, n1). */
export function countWeekdays(n0: number, n1: number): number {
  if (n1 <= n0) return 0;
  const total = n1 - n0;
  const full = floorDiv(total, 7);
  let count = full * 5;
  for (let n = n0 + full * 7; n < n1; n++) {
    const wd = mod(n + 4, 7);
    if (wd !== 0 && wd !== 6) count++;
  }
  return count;
}

export function splitSeconds(totalSec: number) {
  const sign = totalSec < 0 ? -1 : 1;
  let r = Math.abs(totalSec);
  const d = floorDiv(r, 86400); r -= d * 86400;
  const h = floorDiv(r, 3600); r -= h * 3600;
  const mi = floorDiv(r, 60); r -= mi * 60;
  return { sign, d, h, mi, s: r };
}

export function isoDuration(parts: Partial<CalDiff>, sign = 1): string {
  const { y = 0, mo = 0, d = 0, h = 0, mi = 0 } = parts;
  const s = parts.s || 0;
  const sec = Number.isInteger(s) ? String(s) : String(+s.toFixed(3));
  let date = '', time = '';
  if (y) date += y + 'Y';
  if (mo) date += mo + 'M';
  if (d) date += d + 'D';
  if (h) time += h + 'H';
  if (mi) time += mi + 'M';
  if (s) time += sec + 'S';
  if (!date && !time) return 'PT0S';
  return (sign < 0 ? '-' : '') + 'P' + date + (time ? 'T' + time : '');
}

/* ---------- Unix timestamps ---------- */
export type TsUnit = 's' | 'ms' | 'us' | 'ns';
export function parseTimestamp(text: string): { ms: number; unit: TsUnit } | null {
  const t = String(text).trim().replace(/[,_\s]/g, '');
  const m = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(t);
  if (!m) return null;
  const digits = m[2].replace(/^0+(?=\d)/, '').length;
  let unit: TsUnit, factor: number;
  if (digits <= 11) { unit = 's'; factor = 1000; }
  else if (digits <= 14) { unit = 'ms'; factor = 1; }
  else if (digits <= 17) { unit = 'us'; factor = 1e-3; }
  else if (digits <= 20) { unit = 'ns'; factor = 1e-6; }
  else return null;
  const value = Number((m[1] === '-' ? '-' : '') + m[2] + (m[3] ? '.' + m[3] : ''));
  const ms = Math.round(value * factor);
  if (!Number.isFinite(ms)) return null;
  return { ms, unit };
}

/* ---------- free-text date/time parsing ---------- */
const FW: Record<string, string> = { '０': '0', '１': '1', '２': '2', '３': '3', '４': '4', '５': '5', '６': '6', '７': '7', '８': '8', '９': '9', '：': ':', '／': '/', '－': '-', '．': '.', '　': ' ', '＋': '+' };
export const normalizeWide = (s: string) => String(s).replace(/[０-９：／－．\u3000＋]/g, (c) => FW[c] || c);

export function parseOffset(str: string | undefined | null): number | null {
  if (!str) return null;
  const s = str.trim().toUpperCase();
  if (s === 'Z' || s === 'UTC' || s === 'GMT') return 0;
  const m = /^(?:UTC|GMT)?\s*([+\-−])(\d{1,2})(?::?(\d{2}))?$/.exec(s);
  if (!m) return null;
  const sign = m[1] === '+' ? 1 : -1;
  return sign * ((+m[2]) * 3600 + (+(m[3] || 0)) * 60) * SEC;
}
export function validWall(w: Wall | null | undefined): w is Wall {
  return !!w && w.y >= YEAR_MIN && w.y <= YEAR_MAX && w.mo >= 1 && w.mo <= 12 &&
    w.d >= 1 && w.d <= daysInMonth(w.y, w.mo) &&
    w.h >= 0 && w.h <= 23 && w.mi >= 0 && w.mi <= 59 && w.s >= 0 && w.s <= 59;
}
/* ---------- duration expressions ---------- */
const UNIT_TABLE: [string, number][] = [
  ['milliseconds', 0.001], ['millisecond', 0.001], ['msecs', 0.001], ['msec', 0.001], ['ms', 0.001], ['毫秒', 0.001],
  ['weeks', 604800], ['week', 604800], ['wks', 604800], ['wk', 604800], ['w', 604800],
  ['星期', 604800], ['禮拜', 604800], ['週', 604800], ['周', 604800],
  ['days', 86400], ['day', 86400], ['d', 86400], ['天', 86400], ['日', 86400],
  ['hours', 3600], ['hour', 3600], ['hrs', 3600], ['hr', 3600], ['h', 3600],
  ['小時', 3600], ['鐘頭', 3600], ['钟头', 3600], ['小时', 3600], ['時', 3600], ['时', 3600],
  ['minutes', 60], ['minute', 60], ['mins', 60], ['min', 60], ['m', 60], ['分鐘', 60], ['分钟', 60], ['分', 60],
  ['seconds', 1], ['second', 1], ['secs', 1], ['sec', 1], ['s', 1], ['秒鐘', 1], ['秒钟', 1], ['秒', 1],
];
const BAD_UNITS = ['years', 'year', 'yrs', 'yr', 'y', '年', 'months', 'month', 'mos', 'mo', '個月', '个月', '月'];

export class DurError extends Error {
  pos: number; len: number; soft = false; cal = false;
  constructor(msg: string, pos: number, len = 1) { super(msg); this.pos = pos; this.len = len; }
}

interface Tok { t: 'dur' | 'num' | 'op' | '(' | ')'; v?: number | string; pos: number; len: number; src?: string }

function tokenizeDuration(src: string): Tok[] {
  const s = normalizeWide(src).replace(/[（]/g, '(').replace(/[）]/g, ')');
  const toks: Tok[] = [];
  let i = 0;
  const isUnitChar = (c: string) => /[a-zA-Z\u4e00-\u9fff]/.test(c);
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c) || c === '個' || c === '个') { i++; continue; }
    const m = /^(\d+):(\d{1,2})(?::(\d{1,2}(?:\.\d+)?))?/.exec(s.slice(i));
    if (m) {
      const h = +m[1], mi = +m[2], sec = m[3] !== undefined ? +m[3] : 0;
      if (mi > 59 || sec >= 60) throw new DurError(`「${m[0]}」的分或秒超過 59`, i, m[0].length);
      toks.push({ t: 'dur', v: h * 3600 + mi * 60 + sec, pos: i, len: m[0].length, src: m[0] });
      i += m[0].length; continue;
    }
    if (/[\d.]/.test(c) && /^(\d+(?:\.\d+)?|\.\d+)/.test(s.slice(i).replace(/^(\d{1,3}(?:,\d{3})+)/, (g) => g.replace(/,/g, '')))) {
      const raw = /^(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?|\.\d+)/.exec(s.slice(i))![0];
      const num = +raw.replace(/,/g, '');
      let j = i + raw.length;
      while (j < s.length && /\s/.test(s[j])) j++;
      if (s[j] === '個' || s[j] === '个') { j++; while (j < s.length && /\s/.test(s[j])) j++; }
      const rest = s.slice(j);
      let unit: { name: string; sec: number } | null = null;
      for (const [name, sec] of UNIT_TABLE) {
        if (rest.toLowerCase().startsWith(name)) {
          const after = rest[name.length];
          if (/^[a-z]+$/i.test(name) && after && /[a-zA-Z]/.test(after)) continue;
          unit = { name, sec }; break;
        }
      }
      if (!unit) {
        for (const name of BAD_UNITS) {
          if (rest.toLowerCase().startsWith(name)) {
            const after = rest[name.length];
            if (/^[a-z]+$/i.test(name) && after && /[a-zA-Z]/.test(after)) continue;
            const ce = new DurError('年和月的天數不固定，不能和時分秒一起乘除', j, name.length); ce.cal = true; throw ce;
          }
        }
      }
      if (unit) {
        toks.push({ t: 'dur', v: num * unit.sec, pos: i, len: j + unit.name.length - i, src: s.slice(i, j + unit.name.length) });
        i = j + unit.name.length;
      } else {
        toks.push({ t: 'num', v: num, pos: i, len: raw.length, src: raw });
        i += raw.length;
      }
      continue;
    }
    if ('+＋加'.includes(c)) { toks.push({ t: 'op', v: '+', pos: i, len: 1 }); i++; continue; }
    if ('-−–—減减'.includes(c)) { toks.push({ t: 'op', v: '-', pos: i, len: 1 }); i++; continue; }
    if ('*×xX·⋅乘'.includes(c)) {
      if ((c === 'x' || c === 'X') && i + 1 < s.length && /[a-zA-Z]/.test(s[i + 1])) throw new DurError(`無法辨識「${s.slice(i).match(/^[a-zA-Z]+/)![0]}」`, i);
      toks.push({ t: 'op', v: '*', pos: i, len: 1 }); i++; continue;
    }
    if (s.startsWith('除以', i)) { toks.push({ t: 'op', v: '/', pos: i, len: 2 }); i += 2; continue; }
    if ('/÷除'.includes(c)) { toks.push({ t: 'op', v: '/', pos: i, len: 1 }); i++; continue; }
    if (c === '(' || c === ')') { toks.push({ t: c, pos: i, len: 1 }); i++; continue; }
    if (isUnitChar(c)) {
      const word = s.slice(i).match(/^[a-zA-Z]+|^[\u4e00-\u9fff]/)![0];
      throw new DurError(`「${word}」前面需要數字，例如 2${word}`, i, word.length);
    }
    throw new DurError(`無法辨識「${c}」`, i);
  }
  return toks;
}

export interface DurTerm { sign: number; v: number; dim: 'dur' | 'num'; pos: number; len: number }
export type DurResult = { empty: true } | { empty?: false; value: number; dim: 'dur' | 'num'; terms: DurTerm[] };

interface Val { v: number; dim: 'dur' | 'num'; pos: number; len: number }

export function evalDuration(src: string): DurResult {
  const toks = tokenizeDuration(src);
  if (!toks.length) return { empty: true };
  let p = 0;
  const peek = () => toks[p];
  const terms: DurTerm[] = [];
  function primary(): Val {
    const tk = peek();
    if (!tk) throw new DurError('算式不完整', src.length);
    if (tk.t === 'op' && (tk.v === '-' || tk.v === '+')) {
      p++;
      const v = primary();
      return { ...v, v: tk.v === '-' ? -v.v : v.v };
    }
    if (tk.t === '(') {
      p++;
      const v = expr();
      if (!peek() || peek().t !== ')') throw new DurError('缺少右括號 )', peek() ? peek().pos : src.length);
      p++;
      return v;
    }
    if (tk.t === 'dur') {
      p++;
      let v = tk.v as number;
      const start = tk.pos;
      let end = tk.pos + tk.len;
      while (peek() && peek().t === 'dur') { v += peek().v as number; end = peek().pos + peek().len; p++; }
      return { v, dim: 'dur', pos: start, len: end - start };
    }
    if (tk.t === 'num') { p++; return { v: tk.v as number, dim: 'num', pos: tk.pos, len: tk.len }; }
    if (tk.t === ')') throw new DurError('多了一個右括號 )', tk.pos);
    throw new DurError('運算符號的位置不對', tk.pos);
  }
  function term(): Val {
    let left = primary();
    while (peek() && peek().t === 'op' && (peek().v === '*' || peek().v === '/')) {
      const op = toks[p++];
      const right = primary();
      if (op.v === '*') {
        if (left.dim === 'dur' && right.dim === 'dur') throw new DurError('兩個時間長度不能相乘', op.pos);
        left = { v: left.v * right.v, dim: left.dim === 'dur' || right.dim === 'dur' ? 'dur' : 'num', pos: left.pos, len: right.pos + right.len - left.pos };
      } else {
        if (right.v === 0) throw new DurError('不能除以 0', right.pos, right.len);
        if (left.dim === 'num' && right.dim === 'dur') throw new DurError('數字不能除以時間長度', op.pos);
        left = { v: left.v / right.v, dim: left.dim === 'dur' && right.dim === 'num' ? 'dur' : 'num', pos: left.pos, len: right.pos + right.len - left.pos };
      }
    }
    return left;
  }
  function expr(top = false): Val {
    let sign = 1;
    let left = term();
    if (top) terms.push({ sign, ...left });
    while (peek() && peek().t === 'op' && (peek().v === '+' || peek().v === '-')) {
      const op = toks[p++];
      const right = term();
      if (left.dim !== right.dim) {
        const bad = left.dim === 'num' ? left : right;
        const txt = src.slice(bad.pos, bad.pos + bad.len).trim();
        throw new DurError(`「${txt}」缺少單位，例如 ${txt}m`, bad.pos, bad.len);
      }
      sign = op.v === '+' ? 1 : -1;
      if (top) terms.push({ sign, ...right });
      left = { v: left.v + sign * right.v, dim: left.dim, pos: left.pos, len: right.pos + right.len - left.pos };
    }
    return left;
  }
  const result = expr(true);
  if (p < toks.length) {
    const tk = toks[p];
    throw new DurError(tk.t === ')' ? '多了一個右括號 )' : '這裡缺少運算符號（+ − × ÷）', tk.pos, tk.len);
  }
  return { value: result.v, dim: result.dim, terms };
}

/* ---------- calendar spans: what the interval field accepts ---------- */
const SPAN_UNITS: [string, string][] = [
  ['工作日', 'bd'], ['工作天', 'bd'], ['workdays', 'bd'], ['workday', 'bd'], ['bd', 'bd'], ['wd', 'bd'],
  ['years', 'y'], ['year', 'y'], ['yrs', 'y'], ['yr', 'y'], ['y', 'y'], ['年', 'y'],
  ['months', 'mo'], ['month', 'mo'], ['mos', 'mo'], ['mo', 'mo'], ['月', 'mo'],
  ['weeks', 'w'], ['week', 'w'], ['wks', 'w'], ['wk', 'w'], ['w', 'w'], ['星期', 'w'], ['禮拜', 'w'], ['週', 'w'], ['周', 'w'],
  ['days', 'd'], ['day', 'd'], ['d', 'd'], ['天', 'd'], ['日', 'd'],
  ['hours', 'h'], ['hour', 'h'], ['hrs', 'h'], ['hr', 'h'], ['h', 'h'], ['小時', 'h'], ['小时', 'h'], ['鐘頭', 'h'], ['钟头', 'h'], ['時', 'h'], ['时', 'h'],
  ['minutes', 'mi'], ['minute', 'mi'], ['mins', 'mi'], ['min', 'mi'], ['m', 'mi'], ['分鐘', 'mi'], ['分钟', 'mi'], ['分', 'mi'],
  ['seconds', 's'], ['second', 's'], ['secs', 's'], ['sec', 's'], ['s', 's'], ['秒鐘', 's'], ['秒钟', 's'], ['秒', 's'],
];
type SpanKey = 'y' | 'mo' | 'w' | 'd' | 'h' | 'mi' | 's';
const SPAN_KEYS: SpanKey[] = ['y', 'mo', 'w', 'd', 'h', 'mi', 's'];
const softErr = (msg: string, pos: number, len?: number) => { const e = new DurError(msg, pos, len); e.soft = true; return e; };
export const emptySpan = (): Span => ({ sign: 1, y: 0, mo: 0, w: 0, d: 0, h: 0, mi: 0, s: 0, biz: false });
export const isEmptySpan = (sp: Span) => SPAN_KEYS.every((k) => !sp[k]) && !sp.biz;

const CN_D: Record<string, number> = { 〇: 0, 零: 0, 一: 1, 二: 2, 兩: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
/** 三 → 3, 十五 → 15, 二十 → 20, 一百 → 100 (for lengths written in words). */
export function cnDigits(s: string): string {
  return s.replace(/[〇零一二兩两三四五六七八九十百千]+/g, (x) => {
    if (!/[十百千]/.test(x)) return [...x].map((c) => CN_D[c]).join('');
    let total = 0, cur = 0;
    for (const c of x) { if (c in CN_D) cur = CN_D[c]; else { total += (cur || 1) * (c === '十' ? 10 : c === '百' ? 100 : 1000); cur = 0; } }
    return String(total + cur);
  }).replace(/(\d)\s*半\s*(小時|小时|鐘頭|天|日)/g, '$1.5$2').replace(/(^|[^\d.])半\s*(小時|小时|鐘頭|天)/g, (_m, a: string, u: string) => `${a}0.5${u}`);
}
/** ISO 8601 durations: P1Y2M3W4DT5H6M7S, the way the 長度 reading writes them. */
function isoSpan(s: string): Span | null {
  const m = /^([+-])?P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)(?:[.,]\d+)?S)?)?$/i.exec(s);
  if (!m || s.length < 3 || /T$/i.test(s)) return null;
  const n = (i: number) => +(m[i] || 0);
  return { sign: m[1] === '-' ? -1 : 1, y: n(2), mo: n(3), w: n(4), d: n(5), h: n(6), mi: n(7), s: n(8), biz: false };
}
/** Parses "+30天", "1年6個月", "1.5天", "20工作日", "3天前", "三週", "1年 + 3天", "2h30", "in 3 days", "P1M7D".
    Returns null for empty input; throws DurError. */
export function parseSpan(src: string): Span | null {
  let s = cnDigits(normalizeWide(src)).replace(/\s+/g, ' ').trim();
  if (!s) return null;
  const iso = isoSpan(s);
  if (iso) return iso;
  // in 3 days, 3 days later
  let later = false;
  const inM = /^in\s+(.+)$/i.exec(s);
  if (inM) { s = inM[1]; later = true; }
  const out = emptySpan();
  let i = 0, signed = false, any = false, days = false, biz = false, lastUnit = '', frac = 0;
  const skip = () => { while (i < s.length && /[\s,，、]/.test(s[i])) i++; };
  if ('+＋'.includes(s[0])) { i = 1; signed = true; }
  else if ('-−–—'.includes(s[0])) { out.sign = -1; i = 1; signed = true; }
  for (;;) {
    skip();
    if (i >= s.length) break;
    const rest = s.slice(i);
    const tail = /^(之後|以後|後|后|later|after|之前|以前|前|ago|before|earlier)$/i.exec(rest);
    if (tail) {
      if (!any) throw new DurError('前面需要長度，例如 3天前', i, rest.length);
      const neg = /前|ago|before|earlier/i.test(tail[1]);
      if (signed && (out.sign < 0) !== neg) throw new DurError('正負號和「前／後」的方向相反', i, rest.length);
      out.sign = neg ? -1 : 1;
      break;
    }
    let m = /^(\d+):(\d{1,2})(?::(\d{1,2}))?/.exec(rest);
    if (m) {
      const mi = +m[2], sec = m[3] !== undefined ? +m[3] : 0;
      if (mi > 59 || sec > 59) throw new DurError(`「${m[0]}」的分或秒超過 59`, i, m[0].length);
      out.h += +m[1]; out.mi += mi; out.s += sec;
      any = true; i += m[0].length; continue;
    }
    m = /^\d+(?:\.\d+)?/.exec(rest);
    if (m) {
      let j = i + m[0].length;
      while (j < s.length && (s[j] === ' ' || s[j] === '個' || s[j] === '个')) j++;
      const after = s.slice(j), low = after.toLowerCase();
      let unit: { name: string; key: string } | null = null;
      for (const [name, key] of SPAN_UNITS) {
        if (!low.startsWith(name)) continue;
        if (/^[a-z]+$/.test(name) && /[a-z]/i.test(after[name.length] || '')) continue;
        unit = { name, key }; break;
      }
      if (!unit) {
        // 2h30 is 2 hours 30 minutes; 5m30 is 5 minutes 30 seconds
        if (j >= s.length && !m[0].includes('.') && (lastUnit === 'h' || lastUnit === 'mi')) {
          const k = lastUnit === 'h' ? 'mi' : 's';
          if (+m[0] > 59) throw new DurError(`「${m[0]}」超過 59`, i, m[0].length);
          out[k] += +m[0]; any = true; i = j; continue;
        }
        if (j >= s.length) throw softErr('加上單位，例如 30天、2週、3個月、1年', i, m[0].length);
        if (/^(ms|毫秒)/i.test(low)) throw new DurError('間隔最小只到秒', j, 2);
        throw new DurError(`無法辨識「${(after.match(/^[a-zA-Z]+/) || [after[0]])[0]}」`, j);
      }
      const n = +m[0];
      if (!Number.isInteger(n)) {
        // 1.5天 = 1天12小時: a fraction is carried down into the exact units
        if (unit.key === 'y' || unit.key === 'mo' || unit.key === 'bd') throw new DurError('年、月和工作日要用整數，例如 1年6個月', i, m[0].length);
        const per: Record<string, number> = { w: 604800, d: 86400, h: 3600, mi: 60, s: 1 };
        const whole = Math.floor(n);
        out[unit.key as SpanKey] += whole;
        frac += (n - whole) * per[unit.key];
        if (unit.key === 'd' || unit.key === 'w') days = true;
      } else if (unit.key === 'bd') { biz = true; out.d += n; }
      else { if (unit.key === 'd') days = true; out[unit.key as SpanKey] += n; }
      lastUnit = unit.key;
      any = true; i = j + unit.name.length; continue;
    }
    // 1年 + 3天: adding parts of one length
    if ('+＋'.includes(s[i]) && any) { i++; continue; }
    if ('+＋-−–—'.includes(s[i])) throw new DurError('正負號只能放在最前面', i);
    throw new DurError(`無法辨識「${s[i]}」`, i);
  }
  if (!any) throw softErr('輸入長度，例如 +30天、1年6個月、20工作日', 0, s.length);
  if (biz && days) throw new DurError('「天」和「工作日」不能混用', 0, s.length);
  if (frac) {
    let t = Math.round(frac);
    const dd = Math.floor(t / 86400); t -= dd * 86400;
    const hh = Math.floor(t / 3600); t -= hh * 3600;
    const mm = Math.floor(t / 60); t -= mm * 60;
    out.d += dd; out.h += hh; out.mi += mm; out.s += t;
    // carry seconds → minutes → hours, so 1.5h + 45m stays readable
    if (out.s >= 60) { out.mi += Math.floor(out.s / 60); out.s %= 60; }
    if (out.mi >= 60) { out.h += Math.floor(out.mi / 60); out.mi %= 60; }
  }
  if (later && out.sign < 0) throw new DurError('in 只能往後', 0, 2);
  if (SPAN_KEYS.some((k) => out[k] > 999999)) throw new DurError('數字太大了', 0, s.length);
  out.biz = biz;
  return out;
}

/** Canonical text: "+1年6個月", "−2週3天", "+20工作日", "+40天 10:34:29". parseSpan(fmtSpan(x)) gives x back. */
export function fmtSpan(sp: Span | null): string {
  if (!sp) return '';
  const date: string[] = [];
  if (sp.y) date.push(`${sp.y}年`);
  if (sp.mo) date.push(`${sp.mo}個月`);
  if (sp.w) date.push(`${sp.w}週`);
  if (sp.d || sp.biz) date.push(`${sp.d}${sp.biz ? '工作日' : '天'}`);
  const tn = (sp.h ? 1 : 0) + (sp.mi ? 1 : 0) + (sp.s ? 1 : 0);
  let time = '';
  if (tn === 1) time = sp.h ? `${sp.h}小時` : sp.mi ? `${sp.mi}分` : `${sp.s}秒`;
  else if (tn > 1) time = `${sp.h}:${pad(sp.mi)}${sp.s ? ':' + pad(sp.s) : ''}`;
  const body = date.join('') + (date.length && time ? ' ' : '') + time;
  return (sp.sign < 0 ? '−' : '+') + (body || '0天');
}

/** The span (whole wall-clock days + exact rest) that takes a to b in tz. */
export function spanBetween(a: number, b: number, tz: string): Span {
  const sign = b < a ? -1 : 1;
  const A = partsInTz(a, tz), B = partsInTz(b, tz);
  const at = (n: number) => toInstant(addDaysWall(A, sign * n), tz);
  let d = Math.abs(dayNum(B.y, B.mo, B.d) - dayNum(A.y, A.mo, A.d));
  while (d > 0 && sign * (b - at(d)) < 0) d--;
  while (sign * (b - at(d + 1)) >= 0) d++;
  let rest = Math.round(sign * (b - at(d)) / SEC);
  const h = floorDiv(rest, 3600); rest -= h * 3600;
  const mi = floorDiv(rest, 60);
  return { sign, y: 0, mo: 0, w: 0, d, h, mi, s: rest - mi * 60, biz: false };
}

export function fmtClock(totalSec: number, { decimals = 0 } = {}): string {
  const neg = totalSec < 0;
  const f = 10 ** decimals;
  const a = Math.round(Math.abs(totalSec) * f) / f;
  const h = Math.floor(a / 3600);
  const mi = Math.floor((a - h * 3600) / 60);
  const s = a - h * 3600 - mi * 60;
  let sStr: string;
  if (decimals && Math.abs(s - Math.round(s)) > 1e-9) {
    const [ip, fp] = s.toFixed(decimals).split('.');
    sStr = pad(+ip) + '.' + fp.replace(/0+$/, '');
  } else sStr = pad(Math.round(s));
  return (neg ? '−' : '') + h + ':' + pad(mi) + ':' + sStr;
}

export type SpanInput =
  | { kind: 'empty' }
  | { kind: 'span'; span: Span; expr: boolean; result?: DurResult }
  | { kind: 'ratio'; value: number; result: DurResult }
  | { kind: 'error'; message: string; soft: boolean; pos?: number; len?: number };

const OPS_RE = /[*×xX·⋅乘/÷除()（）]|.[+＋\-−–—加減减]/;

/**
 * What the interval field accepts: a calendar span ("+1年6個月", "20工作日")
 * or duration arithmetic ("1h + 45m", "47m × 16", "3:59:59 ÷ 42.195").
 * Arithmetic that ends in a plain number ("2h ÷ 15m") is a ratio: shown, never applied.
 */
export function interpretSpanText(src: string): SpanInput {
  const raw = cnDigits(normalizeWide(src)).trim();
  if (!raw) return { kind: 'empty' };
  let first: DurError;
  try {
    const sp = parseSpan(raw);
    if (!sp) return { kind: 'empty' };
    return { kind: 'span', span: sp, expr: false };
  } catch (e) {
    first = e as DurError;
    if (first.soft) return { kind: 'error', message: first.message, soft: true, pos: first.pos, len: first.len };
  }
  if (!OPS_RE.test(raw)) return { kind: 'error', message: first.message, soft: false, pos: first.pos, len: first.len };
  try {
    const r = evalDuration(raw);
    if (r.empty) return { kind: 'error', message: '輸入長度，例如 +30天、1年6個月、20工作日', soft: true };
    if (r.dim === 'num') return { kind: 'ratio', value: r.value, result: r };
    const total = Math.round(r.value);
    if (Math.abs(total) > 999999 * 86400) return { kind: 'error', message: '數字太大了', soft: false };
    const p = splitSeconds(total);
    return { kind: 'span', expr: true, result: r, span: { sign: total < 0 ? -1 : 1, y: 0, mo: 0, w: 0, d: p.d, h: p.h, mi: p.mi, s: p.s, biz: false } };
  } catch (e2) {
    const err = e2 as DurError;
    if (err.cal) return { kind: 'error', message: '有年或月的時候不能乘除，例如改成 +1年6個月', soft: false, pos: err.pos, len: err.len };
    return { kind: 'error', message: err.message, soft: false, pos: err.pos, len: err.len };
  }
}

/* ---------- formatting ---------- */
export const WD = ['日', '一', '二', '三', '四', '五', '六'];
export const fmtDate = (w: YMD) => `${pad(w.y, 4)}-${pad(w.mo)}-${pad(w.d)}`;
export const fmtTime = (w: Pick<Wall, 'h' | 'mi' | 's'>) => `${pad(w.h)}:${pad(w.mi)}:${pad(w.s)}`;
export const fmtDT = (w: Wall) => `${fmtDate(w)} ${fmtTime(w)}`;
export const wdOf = (w: YMD) => weekdayOf(w.y, w.mo, w.d);
export const wEq = (a: Wall | null, b: Wall | null) => !!a && !!b && a.y === b.y && a.mo === b.mo && a.d === b.d && a.h === b.h && a.mi === b.mi && a.s === b.s;

/** Lunar New Year (春節), checked against the official calendar. */
export const LNY: YMD[] = ['2000-02-05', '2001-01-24', '2002-02-12', '2003-02-01', '2004-01-22', '2005-02-09', '2006-01-29', '2007-02-18', '2008-02-07', '2009-01-26',
  '2010-02-14', '2011-02-03', '2012-01-23', '2013-02-10', '2014-01-31', '2015-02-19', '2016-02-08', '2017-01-28', '2018-02-16', '2019-02-05', '2020-01-25', '2021-02-12', '2022-02-01', '2023-01-22', '2024-02-10', '2025-01-29', '2026-02-17', '2027-02-06', '2028-01-26', '2029-02-13', '2030-02-03', '2031-01-23', '2032-02-11', '2033-01-31', '2034-02-19', '2035-02-08', '2036-01-28', '2037-02-15', '2038-02-04', '2039-01-24', '2040-02-12']
  .map((s) => { const [y, mo, d] = s.split('-').map(Number); return { y, mo, d }; });
