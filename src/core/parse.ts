import { parseRuleText, evalReading, readingName } from './ruletext';
import { lunarOf, ganzhi } from './lunar';
import { termMoment, TERM_NAMES } from './terms';
import {
  type Wall,
  type YMD,
  validWall,
  normalizeWide,
  parseOffset,
  parseTimestamp,
  addDaysWall,
  addMonthsWall,
  wdOf,
  isoWeekStart,
  isoWeeksInYear,
  fromDayNum,
  dayNum,
  daysInYear,
  utcMs,
  wallOfKey,
  partsInTz,
  DAY,
  type TsUnit,
} from './time';

export interface ParseOpts {
  year?: number;
  today?: YMD;
  now?: number;
  tz?: string;
  /** Allow a single part (15號, 3月) when surrounding rule text implies a date. */
  lone?: boolean;
}
export interface Reading {
  wall: Wall;
  how: string;
}
export interface Given {
  y: boolean;
  mo: boolean;
  d: boolean;
}
export type ParsedText =
  | {
      kind: 'wall';
      wall: Wall;
      offset: number | null;
      hasTime: boolean;
      how: string;
      alt?: Reading;
      given?: Given;
      rule?: import('./rule').Rule;
      relative?: boolean;
    }
  | { kind: 'time'; h: number; mi: number; s: number; roll?: number }
  | { kind: 'instant'; ms: number; unit: TsUnit | 'text' };

const CN_DIGIT: Record<string, number> = {
  〇: 0,
  零: 0,
  一: 1,
  二: 2,
  兩: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};
export function cnNumber(s: string): number {
  if (!/[十百千]/.test(s)) return +[...s].map((c) => CN_DIGIT[c]).join('');
  let total = 0,
    cur = 0;
  for (const c of s) {
    if (c in CN_DIGIT) cur = CN_DIGIT[c];
    else {
      total += (cur || 1) * (c === '十' ? 10 : c === '百' ? 100 : 1000);
      cur = 0;
    }
  }
  return total + cur;
}
const WD_CN: Record<string, number> = {
  日: 0,
  天: 0,
  七: 0,
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  '7': 0,
  '1': 1,
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '0': 0,
};
const WD_EN: [RegExp, number][] = [
  [/^sun(day)?$/, 0],
  [/^mon(day)?$/, 1],
  [/^tue(s(day)?)?$/, 2],
  [/^wed(nesday)?$/, 3],
  [/^thu(r(s(day)?)?)?$/, 4],
  [/^fri(day)?$/, 5],
  [/^sat(urday)?$/, 6],
];
const WD_EN_RE =
  'sun(?:day)?|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?';
const MO_EN = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MO_EN_RE =
  /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b\.?/;
const DAY_WORDS: [RegExp, number, Mer?][] = [
  [/大後天|大后天/, 3],
  [/大前天/, -3],
  [/後天|后天/, 2],
  [/前天/, -2],
  [/明早|明晨/, 1, 'am'],
  [/明晚/, 1, 'pm'],
  [/昨晚/, -1, 'pm'],
  [/昨早/, -1, 'am'],
  [/明天|明日|\btomorrow\b/, 1],
  [/昨天|昨日|\byesterday\b/, -1],
  [/今早|今晨/, 0, 'am'],
  [/今晚|\btonight\b/, 0, 'pm'],
  [/今天|今日|\btoday\b/, 0],
];
const YEAR_WORDS: [RegExp, number][] = [
  [/今年|\bthis year\b/, 0],
  [/明年|\bnext year\b/, 1],
  [/去年|\blast year\b/, -1],
  [/前年/, -2],
  [/後年|后年/, 2],
];
const MONTH_WORDS: [RegExp, number][] = [
  [/這個月|这个月|本月|\bthis month\b/, 0],
  [/下個月|下个月|下月|\bnext month\b/, 1],
  [/上個月|上个月|上月|\blast month\b/, -1],
];
type Mer = 'am' | 'pm' | 'noon' | 'night';
const MER_CN: [RegExp, Mer][] = [
  [/凌晨|清晨|早晨|早上|上午|半夜/, 'am'],
  [/中午|正午|午後/, 'noon'],
  [/下午|傍晚/, 'pm'],
  [/晚上|晚間|晚间|夜晚|夜裡|夜里|深夜/, 'night'],
];
function applyMer(h: number, mer: Mer | null): { h: number; roll: number } | null {
  if (h > 23) return null;
  if (!mer) return { h, roll: 0 };
  if (h > 12) return mer === 'am' ? null : { h, roll: 0 };
  if (mer === 'am') return { h: h === 12 ? 0 : h, roll: 0 };
  if (mer === 'noon') return { h: h <= 5 ? h + 12 : h, roll: 0 };
  // evening: 晚上 12 點 is the midnight that ends the day
  if (mer === 'night' && h === 12) return { h: 0, roll: 1 };
  // 晚上 1 點 is the small hours after that evening
  if (mer === 'night' && h <= 4) return { h, roll: 1 };
  return { h: h === 12 ? 12 : h + 12, roll: 0 };
}

export function parseIsoWeek(text: string): YMD | null {
  const t = normalizeWide(text).trim();
  const m = /^(\d{4})\s*[-/年]?\s*(?:W|第)\s*(\d{1,2})\s*(?:週|周)?(?:\s*-?\s*([1-7]))?$/i.exec(t);
  if (!m) return null;
  const y = +m[1],
    k = +m[2];
  if (k < 1 || k > isoWeeksInYear(y)) return null;
  const st = isoWeekStart(y, k);
  return addDaysWall(st, (m[3] ? +m[3] : 1) - 1);
}
export function parseOrdinal(text: string, year?: number): YMD | null {
  const t = normalizeWide(text).trim();
  const m = /^(\d{4})-(\d{3})$/.exec(t) || /^(?:(\d{3,4})\s*年?\s*)?第\s*(\d{1,3})\s*天$/.exec(t);
  if (!m) return null;
  const y = m[1] ? +m[1] : year;
  if (!y || y < 1 || y > 9999) return null;
  const n = +m[2];
  if (n < 1 || n > daysInYear(y)) return null;
  return fromDayNum(dayNum(y, 1, 1) + n - 1);
}
export function excelSerial(v: number): Wall | null {
  if (!Number.isFinite(v) || v < 1 || v > 2958465.99999) return null;
  const w = wallOfKey(Math.round((utcMs(1899, 12, 30) + v * DAY) / 1000) * 1000);
  return validWall(w) ? w : null;
}

const ALL: Given = { y: true, mo: true, d: true };
interface Num {
  v: number;
  len: number;
  mark: '' | 'y' | 'mo' | 'd' | 'dd';
}
const KEEP = /[^\s,./\-_'’()（）、，:：;；t@]/i;

export function parseAbsoluteText(input: string, ref?: number | ParseOpts): ParsedText | null {
  const opts: ParseOpts = typeof ref === 'number' ? { year: ref } : ref || {};
  let s = normalizeWide(input).replace(/[–—−]/g, '-').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  // @1795380034: a Unix timestamp written the way some tools print it
  if (/^@\s*\d/.test(s)) s = s.replace(/^@\s*/, '');

  // compact: 20261225, 20261225T1800, 202612251800Z
  const m = /^(\d{4})(\d{2})(\d{2})(?:T?(\d{2})(\d{2})(\d{2})?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i.exec(s);
  if (m) {
    const w = { y: +m[1], mo: +m[2], d: +m[3], h: +(m[4] || 0), mi: +(m[5] || 0), s: +(m[6] || 0) };
    if (validWall(w))
      return {
        kind: 'wall',
        wall: w,
        offset: parseOffset(m[7]),
        hasTime: !!m[4],
        how: m[4] ? '日期與時刻' : '日期',
        given: ALL,
      };
  }
  if (/^[+-]?\d[\d,_]*(\.\d+)?$/.test(s)) {
    const ts = parseTimestamp(s);
    return ts ? { kind: 'instant', ms: ts.ms, unit: ts.unit } : null;
  }
  const wk = parseIsoWeek(s);
  if (wk)
    return {
      kind: 'wall',
      wall: { ...wk, h: 0, mi: 0, s: 0 },
      offset: null,
      hasTime: false,
      how: 'ISO 週',
      given: ALL,
    };
  const od = parseOrdinal(s, opts.year ?? opts.today?.y);
  if (od)
    return {
      kind: 'wall',
      wall: { ...od, h: 0, mi: 0, s: 0 },
      offset: null,
      hasTime: false,
      how: '一年的第幾天',
      given: ALL,
    };

  s = s.toLowerCase();
  const take = (re: RegExp): RegExpExecArray | null => {
    const r = re.exec(s);
    if (r) s = s.slice(0, r.index) + ' ' + s.slice(r.index + r[0].length);
    return r;
  };

  /* words first, before 星期一 could become a number */
  let dayShift: number | null = null,
    mer: Mer | null = null,
    yearShift: number | null = null,
    monthShift: number | null = null;
  let weekday: { wd: number; rel: 'next' | 'last' | 'this' | 'cn-next' | 'cn-last' | 'cn-this' | null } | null = null;
  let r = take(/(下|上|本|這|这|今)?\s*(?:個|个)?\s*(?:星期|禮拜|礼拜|週|周)\s*([一二三四五六日天七1-7])/);
  if (r)
    weekday = { wd: WD_CN[r[2]], rel: r[1] === '下' ? 'cn-next' : r[1] === '上' ? 'cn-last' : r[1] ? 'cn-this' : null };
  if (!weekday && (r = take(/[(（]\s*([一二三四五六日天])\s*[)）]/))) weekday = { wd: WD_CN[r[1]], rel: null };
  // 下週, next week (no day named): that week's Monday
  if (!weekday && (r = take(/(下|上|本|這|这)\s*(?:個|个)?\s*(?:星期|禮拜|礼拜|週|周)|\b(next|last|this) week\b/))) {
    const k = r[1] || r[2];
    weekday = {
      wd: 1,
      rel: k === '下' || k === 'next' ? 'cn-next' : k === '上' || k === 'last' ? 'cn-last' : 'cn-this',
    };
  }
  if (!weekday && (r = take(new RegExp(`\\b(?:(next|last|this)\\s+)?(${WD_EN_RE})\\b\\.?`)))) {
    const wd = WD_EN.find(([re]) => re.test(r![2]))![1];
    weekday = { wd, rel: (r[1] as 'next' | 'last' | 'this' | undefined) || null };
  }
  for (const [re, n, mm] of DAY_WORDS)
    if (dayShift == null && take(re)) {
      dayShift = n;
      if (mm) mer = mm;
    }
  for (const [re, n] of YEAR_WORDS) if (yearShift == null && take(re)) yearShift = n;
  for (const [re, n] of MONTH_WORDS) if (monthShift == null && take(re)) monthShift = n;
  let noonWord: number | null = null;
  if (take(/\bnoon\b|正午(?!\s*\d)/)) noonWord = 12;
  else if (take(/\bmidnight\b|午夜(?!\s*\d)/)) noonWord = 0;
  for (const [re, mm] of MER_CN)
    if (take(re)) {
      mer = mm;
      break;
    }
  let roc = false,
    ad = false;
  if (take(/民國|民国/)) roc = true;
  if (take(/西元|公元/)) ad = true;
  take(/^(?:從|从|from|on|at|the)\s+/);
  s = s.replace(/\b(at|on|the|of)\b|[@於于]/g, ' ');
  let monthName: number | null = null;
  if ((r = take(MO_EN_RE))) monthName = MO_EN.indexOf(r[1].slice(0, 3)) + 1;
  s = s.replace(/(\d+)(st|nd|rd|th)\b/g, '$1');
  s = s.replace(/[〇零一二兩两三四五六七八九十百千]+/g, (x) => String(cnNumber(x)));
  if (/第/.test(s)) {
    const o = parseOrdinal(s.replace(/\s+/g, ' ').trim(), opts.year ?? opts.today?.y);
    if (o)
      return {
        kind: 'wall',
        wall: { ...o, h: 0, mi: 0, s: 0 },
        offset: null,
        hasTime: false,
        how: '一年的第幾天',
        given: ALL,
      };
  }

  /* the time of day, wherever it is */
  let time: { h: number; mi: number; s: number } | null = null,
    offset: number | null = null;
  const T_COLON =
    /(^|[^\d])(\d{1,2})\s*[:：]\s*(\d{1,2})(?:\s*[:：]\s*(\d{1,2})(?:[.,]\d+)?)?(?!\d)\s*(a\.?m\.?|p\.?m\.?)?/;
  const T_CN =
    /(^|[^\d])(\d{1,2})\s*[時时點点]\s*(?:(半)|(\d)\s*刻|(\d{1,2})\s*(?:分|(?=\s*$)|(?=\s*\d{1,2}\s*秒)))?\s*(?:(\d{1,2})\s*秒)?/;
  const T_H = /(^|[^\d])(\d{1,2})h(\d{2})(?!\d)/;
  const T_AMPM = /(^|[^\d])(\d{1,2})\s*(a\.?m\.?|p\.?m\.?)(?![a-z])/;
  const T_DOT = /(^|[^\d.])(\d{1,2})\.(\d{2})\s*(a\.?m\.?|p\.?m\.?)(?![a-z])/;
  let tm: RegExpExecArray | null;
  let ampm: string | undefined;
  if ((tm = T_COLON.exec(s))) {
    time = { h: +tm[2], mi: +tm[3], s: +(tm[4] || 0) };
    ampm = tm[5];
  } else if ((tm = T_CN.exec(s)))
    time = { h: +tm[2], mi: tm[3] ? 30 : tm[4] ? +tm[4] * 15 : +(tm[5] || 0), s: +(tm[6] || 0) };
  else if ((tm = T_H.exec(s))) time = { h: +tm[2], mi: +tm[3], s: 0 };
  else if ((tm = T_DOT.exec(s))) {
    time = { h: +tm[2], mi: +tm[3], s: 0 };
    ampm = tm[4];
  } else if ((tm = T_AMPM.exec(s))) {
    time = { h: +tm[2], mi: 0, s: 0 };
    ampm = tm[3];
  }
  if (tm) {
    const start = tm.index + tm[1].length;
    let end = tm.index + tm[0].length;
    const off = /^\s*(z\b|(?:utc|gmt)?\s*[+-]\d{1,2}(?::?\d{2})?(?!\d)|utc\b|gmt\b)/.exec(s.slice(end));
    if (off) {
      offset = parseOffset(off[1].toUpperCase());
      end += off[0].length;
    }
    s = s.slice(0, start) + ' ' + s.slice(end);
  }
  if (offset == null && (r = take(/(?:^|\s)(utc|gmt)\s*([+-]\d{1,2}(?::?\d{2})?)?(?=\s|$)/)))
    offset = parseOffset((r[1] + (r[2] || '')).toUpperCase());
  if (ampm) mer = /^p/.test(ampm) ? 'pm' : 'am';
  if (!time && noonWord != null) time = { h: noonWord, mi: 0, s: 0 };

  /* the numbers left are the date */
  if (KEEP.test(s.replace(/\d+\s*(?:年|月|日|號|号)?/g, ' '))) return null;
  const nums: Num[] = [];
  for (const x of s.matchAll(/(\d+)\s*(年|月|日|號|号)?/g)) {
    const mark = x[2] === '年' ? 'y' : x[2] === '月' ? 'mo' : x[2] === '日' ? 'd' : x[2] ? 'dd' : '';
    // 20000101 standing for a whole date
    if (!mark && x[1].length === 8 && !nums.length) {
      nums.push(
        { v: +x[1].slice(0, 4), len: 4, mark: 'y' },
        { v: +x[1].slice(4, 6), len: 2, mark: 'mo' },
        { v: +x[1].slice(6), len: 2, mark: 'd' },
      );
      continue;
    }
    nums.push({ v: +x[1], len: x[1].length, mark });
  }

  const today = opts.today;
  const D: { y?: number; mo?: number; d?: number; yLen?: number } = {};
  if (monthName) D.mo = monthName;
  const rest: Num[] = [];
  for (const n of nums) {
    if (n.mark === 'y' && D.y == null) {
      D.y = n.v;
      D.yLen = n.len;
    } else if (n.mark === 'mo' && D.mo == null) D.mo = n.v;
    else if ((n.mark === 'd' || n.mark === 'dd') && D.d == null) D.d = n.v;
    else if (n.mark) return null;
    else rest.push(n);
  }
  let alt: { y?: number; mo?: number; d?: number; how: string } | null = null;
  let how = '';
  const big = (n: Num) => n.len >= 3 || n.v > 31;
  // unmarked numbers fill what is still missing
  const free = rest.slice();
  if (D.y == null && D.mo == null && D.d == null && monthName == null) {
    const [a, b, c] = free;
    if (free.length >= 3) {
      if (big(a)) {
        D.y = a.v;
        D.yLen = a.len;
        D.mo = b.v;
        D.d = c.v;
      } else if (big(c) || c.len === 2) {
        D.y = c.v;
        D.yLen = c.len;
        if (a.v > 12) {
          D.d = a.v;
          D.mo = b.v;
          how = '日/月/年';
        } else {
          D.mo = a.v;
          D.d = b.v;
          how = '月/日/年';
          if (b.v <= 12 && a.v !== b.v) alt = { mo: b.v, d: a.v, how: '日/月/年' };
        }
      } else return null;
      free.splice(0, 3);
    } else if (free.length === 2) {
      if (big(a)) {
        D.y = a.v;
        D.yLen = a.len;
        D.mo = b.v;
        D.d = 1;
      } else if (big(b)) {
        D.mo = a.v;
        D.y = b.v;
        D.yLen = b.len;
        D.d = 1;
      } else if (a.v > 12 && b.v <= 12) {
        D.d = a.v;
        D.mo = b.v;
        how = '日/月';
      } else {
        D.mo = a.v;
        D.d = b.v;
        how = '月/日';
        if (b.v <= 12 && a.v !== b.v) alt = { mo: b.v, d: a.v, how: '日/月' };
      }
      free.splice(0, 2);
    }
  } else if (D.y == null && D.d == null && monthName != null) {
    // Jan 1 2000, 1 Jan 2000, January 2000
    for (const n of free.splice(0, Math.min(2, free.length))) {
      if (big(n) && D.y == null) {
        D.y = n.v;
        D.yLen = n.len;
      } else if (D.d == null && n.v <= 31) D.d = n.v;
      else if (D.y == null) {
        D.y = n.v;
        D.yLen = n.len;
      } else return null;
    }
  } else {
    // some parts were marked (3月5, 2026年3, 5號): the rest go where they fit
    while (free.length && (D.y == null || D.mo == null || D.d == null)) {
      const n = free[0];
      if (D.y == null && big(n)) {
        D.y = n.v;
        D.yLen = n.len;
      } else if (D.mo == null && D.d == null) D.mo = n.v;
      else if (D.d == null) D.d = n.v;
      else if (D.mo == null) D.mo = n.v;
      else break;
      free.shift();
    }
  }
  // numbers after a whole date are a time written without marks: 2000/1/1/20/34, 20000101 2034
  if (!time && free.length && D.d != null) {
    const [a, b, c] = free;
    if (free.length === 1 && (a.len === 4 || a.len === 6)) {
      const t = String(a.v).padStart(a.len, '0');
      time = { h: +t.slice(0, 2), mi: +t.slice(2, 4), s: a.len === 6 ? +t.slice(4, 6) : 0 };
    } else if (free.length <= 3) time = { h: a.v, mi: b ? b.v : 0, s: c ? c.v : 0 };
    free.length = 0;
  }
  // 下午3 (a part of day and a bare hour)
  if (!time && free.length === 1 && mer && free[0].v <= 12) {
    time = { h: free[0].v, mi: 0, s: 0 };
    free.length = 0;
  }
  // 明天中午
  if (!time && mer === 'noon') time = { h: 12, mi: 0, s: 0 };
  if (free.length) return null;

  const hasDate = D.y != null || D.mo != null || D.d != null;
  const relative = dayShift != null || weekday != null || yearShift != null || monthShift != null;
  // one lone part is a date only with a word that says so: 15號, 3月 下週 … (3月 alone is a span of 3 months)
  const parts = +(D.y != null) + +(D.mo != null) + +(D.d != null);
  const loneYear = parts === 1 && D.y != null && (D.yLen ?? 0) >= 3;
  if (
    hasDate &&
    parts < 2 &&
    !relative &&
    !loneYear &&
    !opts.lone &&
    !(D.d != null && nums.some((n) => n.mark === 'dd'))
  )
    return null;

  /* the time, with its part of day */
  let hm: { h: number; mi: number; s: number } | null = null,
    roll = 0;
  if (time) {
    const a = applyMer(time.h, mer);
    if (!a || time.mi > 59 || time.s > 59) return null;
    hm = { h: a.h, mi: time.mi, s: time.s };
    roll = a.roll;
  } else if (mer && !hasDate && !relative) return null;

  if (!hasDate && !relative) {
    if (!hm) return null;
    // 晚上 12 點 is the midnight that ends the day: roll says so
    return { kind: 'time', ...hm, ...(roll ? { roll } : {}) };
  }

  /* the date: what was written, then what the words add */
  const yearOf = (y: number, len: number): { y: number; how: string; alt?: number } => {
    if (roc) return { y: y + 1911, how: '民國' };
    if (ad || len >= 4) return { y, how: '' };
    if (len === 3 && y >= 1 && y <= 200) return { y: y + 1911, how: '民國', alt: y };
    if (len <= 2) {
      const pivot = ((today?.y ?? opts.year ?? 2026) % 100) + 30;
      return { y: (y <= pivot ? 2000 : 1900) + y, how: '', alt: y + 1911 };
    }
    return { y, how: '' };
  };
  let base: YMD | null = today ? { y: today.y, mo: today.mo, d: today.d } : null;
  const refY = opts.year ?? today?.y;
  let y: number | undefined,
    yHow = '',
    yAlt: number | undefined;
  if (D.y != null) {
    const yy = yearOf(D.y, D.yLen ?? 4);
    y = yy.y;
    yHow = yy.how;
    yAlt = yy.alt;
  } else if (yearShift != null && today) y = today.y + yearShift;
  else y = refY;
  let mo = D.mo;
  const d = D.d;
  if (mo == null && monthShift != null && today) {
    const t = addMonthsWall({ y: today.y, mo: today.mo, d: 1 }, monthShift);
    mo = t.mo;
    if (D.y == null && yearShift == null) y = t.y;
  }
  let ymd: YMD | null = null;
  if (mo != null || d != null || D.y != null) {
    if (y == null) return null;
    // a year alone is its first day; a day alone (15號) is in this month
    if (mo == null && D.y != null && d == null) mo = 1;
    if (mo == null) {
      if (!today) return null;
      mo = today.mo;
      if (D.y == null && yearShift == null) y = today.y;
    }
    ymd = { y, mo, d: d ?? 1 };
  } else if (yearShift != null || monthShift != null) {
    if (!today) return null;
    ymd = addMonthsWall({ y: today.y + (yearShift ?? 0), mo: today.mo, d: 1 }, monthShift ?? 0);
  }
  if (!ymd) {
    if (!base) return null;
    ymd = base;
  }
  if (dayShift != null && !hasDate) ymd = addDaysWall(ymd, dayShift);
  if (weekday && !hasDate) {
    if (!today) return null;
    const t = { y: today.y, mo: today.mo, d: today.d },
      twd = wdOf(t);
    const monday = addDaysWall(t, -((twd + 6) % 7));
    const inWeek = addDaysWall(monday, (weekday.wd + 6) % 7);
    const ahead = (weekday.wd - twd + 7) % 7;
    const rel = weekday.rel;
    if (rel === 'cn-this' || rel === 'this') ymd = inWeek;
    else if (rel === 'cn-next') ymd = addDaysWall(inWeek, 7);
    else if (rel === 'cn-last') ymd = addDaysWall(inWeek, -7);
    else if (rel === 'next') ymd = addDaysWall(t, ahead || 7);
    else if (rel === 'last') ymd = addDaysWall(t, -((twd - weekday.wd + 7) % 7 || 7));
    else ymd = addDaysWall(t, ahead);
    how = rel ? '' : '接下來的那天';
  }
  base = ymd;
  const mk = (ymdX: YMD): Wall => {
    let w: Wall = { ...ymdX, h: hm?.h ?? 0, mi: hm?.mi ?? 0, s: hm?.s ?? 0 };
    if (roll) w = addDaysWall(w, roll);
    return w;
  };
  const wall = mk(base);
  if (!validWall(wall)) return null;
  const desc = [yHow, how].filter(Boolean).join(' · ') || (hm ? '日期與時刻' : '日期');
  const out: ParsedText = {
    kind: 'wall',
    wall,
    offset,
    hasTime: !!hm,
    how: desc,
    given: { y: D.y != null, mo: D.mo != null || monthName != null, d: D.d != null },
  };
  let altW: Wall | null = null,
    altHow = '';
  if (alt) {
    altW = mk({ y: base.y, mo: alt.mo!, d: alt.d! });
    altHow = [yHow, alt.how].filter(Boolean).join(' · ');
  } else if (yAlt != null) {
    altW = mk({ ...base, y: yAlt });
    altHow = yAlt > 1911 ? '民國' : '西元';
  }
  if (altW && validWall(altW) && JSON.stringify(altW) !== JSON.stringify(wall)) out.alt = { wall: altW, how: altHow };
  return out;
}

export function parseDateTimeText(input: string, ref?: number | ParseOpts): ParsedText | null {
  const opts: ParseOpts = typeof ref === 'number' ? { year: ref } : ref || {};
  const r = parseRuleText(input, opts);
  if (!r) return parseAbsoluteText(input, opts);
  const a = r.main.abs;
  if (a && !(a.kind === 'time' && a.roll)) return a;
  const w = evalReading(r.main, opts);
  if (!w) return null;
  const altR = r.alts[0];
  const alt = altR ? evalReading(altR, opts) : null;
  return {
    kind: 'wall',
    wall: w,
    offset: r.main.offset,
    hasTime: r.main.hasTime,
    how: r.main.how || readingName(r.main),
    rule: r.main.rule,
    relative: r.relative,
    ...(alt && JSON.stringify(alt) !== JSON.stringify(w)
      ? { alt: { wall: alt, how: altR.how || readingName(altR) } }
      : {}),
  };
}

export function splitRange(text: string): [string, string] | null {
  const t = normalizeWide(text)
    .trim()
    .replace(/^(?:從|从|from)\s*/i, '');
  const m =
    /^(.+?)\s*(?:到|至|~|～|→|->|⇒)\s*(.+)$/.exec(t) || /^(.+?)\s+(?:-|–|—|to|until|till|through)\s+(.+)$/i.exec(t);
  return m ? [m[1].trim(), m[2].trim()] : null;
}
export function splitDatePlusSpan(text: string): { date: string; sign: 1 | -1; span: string } | null {
  const t = normalizeWide(text).trim();
  const m = /^(.*\S)\s*([+＋]|\s[-−]\s?|[-−]\s)\s*(\d.*)$/.exec(t);
  if (!m) return null;
  return { date: m[1].trim(), sign: /[+＋]/.test(m[2]) ? 1 : -1, span: m[3].trim() };
}

export type ReadBack = { live: true } | { ms: number } | { wall: Wall } | null;
export interface ReadCtx {
  now: number;
  tz: string;
  cur: Wall;
  parseSpanText: (t: string) => { sign: 1 | -1; ms: (from: number) => number } | null;
}
export function parseReading(k: string, text: string, ctx: ReadCtx): ReadBack {
  const t = normalizeWide(text).trim();
  if (!t) return null;
  const keep = (d: YMD): Wall | null => {
    const w = { ...ctx.cur, y: d.y, mo: d.mo, d: d.d };
    return validWall(w) ? w : null;
  };
  const wallOrNull = (w: Wall | null) => (w ? { wall: w } : null);
  if (k === 'unix' || k === 'unixms') {
    const m = /^@?\s*(-?\d+(?:\.\d+)?)$/.exec(t.replace(/[,_\s]/g, ''));
    if (!m) return null;
    const ms = k === 'unix' ? Math.round(+m[1] * 1000) : Math.round(+m[1]);
    return Number.isFinite(ms) ? { ms } : null;
  }
  if (k === 'excel') {
    const v = +t.replace(/,/g, '');
    return wallOrNull(excelSerial(v));
  }
  if (k === 'rel') {
    if (/^(就是)?(現在|此刻)$|^now$/i.test(t)) return { live: true };
    const sp = ctx.parseSpanText(t);
    if (sp) return { ms: sp.ms(ctx.now) };
  }
  if (k === 'week') {
    const m = /^(\d{4})\s*-?\s*W\s*(\d{1,2})(?:\s*-?\s*([1-7]))?$/i.exec(t);
    if (m) {
      const wd = m[3] ? +m[3] : ((wdOf(ctx.cur) + 6) % 7) + 1;
      const d = parseIsoWeek(`${m[1]}-W${m[2]}-${wd}`);
      return d ? wallOrNull(keep(d)) : null;
    }
  }
  if (k === 'usweek') {
    const m = /^(\d{4})\s*年?\s*W\s*(\d{1,2})$/i.exec(t);
    if (m) {
      const y = +m[1],
        wk = +m[2];
      const jan1 = dayNum(y, 1, 1);
      const sun0 = jan1 - ((((jan1 + 4) % 7) + 7) % 7);
      const n = sun0 + (wk - 1) * 7 + wdOf(ctx.cur);
      const d = fromDayNum(n);
      // week 1 may begin in December, the last week may end in January
      if (wk < 1 || wk > 54 || Math.abs(d.y - y) > 1) return null;
      return wallOrNull(keep(d));
    }
  }
  if (k === 'doy') {
    const head = t.split(/\s*[·•|]\s*/)[0];
    const d = parseOrdinal(head, ctx.cur.y) || parseOrdinal(`第${head.replace(/\D/g, '')}天`, ctx.cur.y);
    if (d && /\d/.test(head)) return wallOrNull(keep(d));
  }
  if (k === 'lunar') {
    // 丙午年 十月十七, 丙午年（馬）十月十七, 十月十七, 農曆十月十七: in the lunar year written, or the one the moment is in
    let rest = t.replace(/^(農曆|农历|陰曆)\s*/, '');
    const cur = lunarOf(ctx.cur);
    let y = cur?.y ?? ctx.cur.y;
    const g = /^([甲乙丙丁戊己庚辛壬癸][子丑寅卯辰巳午未申酉戌亥])\s*年?\s*(?:[（(][^)）]*[)）])?\s*/.exec(rest);
    if (g) {
      rest = rest.slice(g[0].length);
      for (let d = 0; d < 60; d++) {
        const a = y + (d % 2 ? -Math.ceil(d / 2) : d / 2);
        if (ganzhi(a) === g[1]) {
          y = a;
          break;
        }
      }
    } else {
      const m = /^(\d{3,4})\s*年\s*/.exec(rest);
      if (m) {
        y = +m[1];
        rest = rest.slice(m[0].length);
      }
    }
    const r = parseDateTimeText(`農曆${y}年${rest}`, { year: ctx.cur.y, today: partsTodayOf(ctx) });
    return r && r.kind === 'wall' ? wallOrNull(keep(r.wall)) : null;
  }
  if (k === 'term') {
    // 冬至, 冬至 第 3 天: the nearest such term to the moment, and that many days into it
    const head = t.split(/\s*[·•|]\s*/)[0];
    const m = new RegExp(`^(${TERM_NAMES.join('|')})\\s*(?:第\\s*(\\d+)\\s*天)?$`).exec(head);
    if (m) {
      const kk = TERM_NAMES.indexOf(m[1]);
      const at = utcMs(ctx.cur.y, ctx.cur.mo, ctx.cur.d);
      let best: number | null = null;
      for (const yy of [ctx.cur.y - 1, ctx.cur.y, ctx.cur.y + 1]) {
        const ms = termMoment(yy, kk);
        if (best == null || Math.abs(ms - at) < Math.abs(best - at)) best = ms;
      }
      const w = partsInTz(best!, ctx.tz);
      return wallOrNull(keep(addDaysWall({ y: w.y, mo: w.mo, d: w.d }, (m[2] ? +m[2] : 1) - 1)));
    }
  }
  const p = parseDateTimeText(t, { year: ctx.cur.y, today: partsTodayOf(ctx), now: ctx.now, tz: ctx.tz });
  if (!p) return null;
  if (p.kind === 'instant') return { ms: p.ms };
  if (p.kind === 'time')
    return wallOrNull(
      validWall({ ...ctx.cur, h: p.h, mi: p.mi, s: p.s }) ? { ...ctx.cur, h: p.h, mi: p.mi, s: p.s } : null,
    );
  if (p.offset != null) return { ms: utcMs(p.wall.y, p.wall.mo, p.wall.d, p.wall.h, p.wall.mi, p.wall.s) - p.offset };
  return wallOrNull(p.hasTime ? p.wall : keep(p.wall));
}
function partsTodayOf(ctx: ReadCtx): YMD {
  const w = partsInTz(ctx.now, ctx.tz);
  return { y: w.y, mo: w.mo, d: w.d };
}
