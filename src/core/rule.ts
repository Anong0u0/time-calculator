/* ============================================================
   A moment as a rule: where to start, then steps, each one taking the moment so far to a new one.

     start   現在, 開始, 結束, the other end, or a date
     steps   move   ± N 秒 分 時 天 工作日 週 月 季 年 農曆月 農曆年 節氣
             align  to a period's beginning, middle, last day or end: 日 週 月 季 年 農曆月 農曆年 節氣 季節
             pick   a day by its marks (month, day, weekday, the n-th weekday, a lunar date, a 節氣):
                    the next or previous one, or the one inside a period (this week's Wednesday, this year's 中秋)
             time   a time of day
             word   a named rule from the vocabulary (中秋, 下班, 發薪日 …), used as one step

   開始那個月的月底 = 開始 → align month · end; 明晚 = 現在 → +1 天 → 晚上; 母親節 = next (May, 2nd Sunday).
   The same rule reads the same everywhere: in a shortcut, in the command box, at either end, in a link.
   ============================================================ */
import { type Wall, SEC, partsInTz, toInstant, addDuration, dayNum, fromDayNum, daysInMonth, addDaysWall, addMonthsWall, mod, validWall, pad, YEAR_MIN, YEAR_MAX, WD, type Span } from './time';
import { lunarOfDay, lunarYear, lunarMonthName, lunarDayName } from './lunar';
import { termMoment, termAround, termOnDay, termsOfYear, TERM_NAMES, TERMS_IN_YEAR, CHINA_TZ } from './terms';

export type EndRef = 'start' | 'end';
export type Unit = 's' | 'mi' | 'h' | 'd' | 'bd' | 'w' | 'mo' | 'q' | 'y' | 'lmo' | 'ly' | 'term';
export type Period = 'd' | 'w' | 'mo' | 'q' | 'y' | 'lmo' | 'ly' | 'term' | 'season';
export type Pos = 'start' | 'mid' | 'last' | 'end';
/** The marks a day can be picked by. d and ld can be −1: the last day of the month. nth (with wd) is the n-th such weekday of its month, −1 the last. */
export interface Cond { mo?: number; d?: number; wd?: number; nth?: number; lmo?: number; leap?: boolean; ld?: number; term?: number }
export type Scope = 'next' | 'prev' | Period;
export type Step =
  | { t: 'move'; n: number; u: Unit }
  | { t: 'align'; p: Period; pos: Pos }
  /** k: the k-th match (−1 the last, inside a period); incl: today counts; exact: a 節氣's very moment, not its day. */
  | { t: 'pick'; c: Cond; in: Scope; k?: number; incl?: boolean; exact?: boolean }
  | { t: 'time'; h: number; mi: number; s: number }
  /** in: the word's first next/previous pick is taken inside this period instead (明年 + 中秋 = that year's 中秋). */
  | { t: 'word'; w: string; in?: Scope; k?: number };
export type Origin = { t: 'now' } | { t: 'start' } | { t: 'end' } | { t: 'other' } | { t: 'date'; w: Wall } | { t: 'at'; ms: number };
export interface Rule { o: Origin; steps: Step[] }

/** The general settings every rule is read with. */
export interface RulePrefs {
  /** 1: weeks begin on Monday (ISO); 0: on Sunday. */
  weekStart: 0 | 1;
  /** Which day a 節氣 falls on: as the almanac prints it (China's clock), or on the clock of the end. */
  termTz: 'china' | 'local';
  /** A day the period does not have (31號 in February, 三十 in a short lunar month, a leap month that is not there): the nearest one, or an error. */
  missing: 'clamp' | 'error';
  /** Picking or aligning to a day starts that day at 00:00 (otherwise the time of day is kept). */
  dayResets: boolean;
}
export const DEFAULT_PREFS: RulePrefs = { weekStart: 1, termTz: 'china', missing: 'clamp', dayResets: true };

export interface RuleCtx {
  now: number;
  /** The clock the rule is read on (the zone of the end it sets). */
  tz: string;
  /** The end the rule is for: "the other end" is the opposite one. */
  self?: EndRef;
  ends?: { start?: number | null; end?: number | null };
  prefs?: RulePrefs;
  word?: (name: string) => Rule | null;
}
export interface Trace { ms: number; note?: string }
export type RuleResult =
  | { ok: true; ms: number; trace: Trace[]; from: number | null }
  | { ok: false; err: string; at: number; trace: Trace[] };

/* ---------- names of things ---------- */
export const UNITS: Unit[] = ['s', 'mi', 'h', 'd', 'bd', 'w', 'mo', 'q', 'y', 'lmo', 'ly', 'term'];
export const UNIT_NAME: Record<Unit, string> = { s: '秒', mi: '分鐘', h: '小時', d: '天', bd: '個工作日', w: '週', mo: '個月', q: '季', y: '年', lmo: '個農曆月', ly: '個農曆年', term: '個節氣' };
export const PERIODS: Period[] = ['d', 'w', 'mo', 'q', 'y', 'lmo', 'ly', 'term', 'season'];
export const PERIOD_NAME: Record<Period, string> = { d: '日', w: '週', mo: '月', q: '季', y: '年', lmo: '農曆月', ly: '農曆年', term: '節氣', season: '季節' };
export const POS: Pos[] = ['start', 'mid', 'last', 'end'];
export const POS_NAME: Record<Pos, string> = { start: '開頭', mid: '正中間', last: '最後一天', end: '結束那一刻' };
const SCOPE_NAME: Record<Period, string> = { d: '當天', w: '這週', mo: '這個月', q: '這一季', y: '這一年', lmo: '這個農曆月', ly: '這個農曆年', term: '這個節氣', season: '這個季節' };
export const scopeName = (s: Scope) => (s === 'next' ? '下一個' : s === 'prev' ? '上一個' : SCOPE_NAME[s]);
export const SEASONS = [0, 6, 12, 18];

export class RuleError extends Error {}
const RANGE = '超出可計算範圍（西元 1–9999 年）';
const fail = (m: string): never => { throw new RuleError(m); };

/* ---------- the periods a moment is in ---------- */
interface Frame { tz: string; prefs: RulePrefs }
const wallAt = (ms: number, f: Frame) => partsInTz(ms, f.tz);
function atWall(w: Wall, f: Frame): number {
  if (!validWall(w)) fail(RANGE);
  return toInstant(w, f.tz);
}
const day0 = (n: number): Wall => ({ ...fromDayNum(n), h: 0, mi: 0, s: 0 });
const dayOf = (ms: number, f: Frame) => { const w = wallAt(ms, f); return dayNum(w.y, w.mo, w.d); };
function termList(y: number) { return [y - 1, y, y + 1].flatMap((yy) => termsOfYear(yy).map((t) => ({ ...t, y: yy }))); }
/** [from, to) of the period holding this moment, as instants on the frame's clock. */
export function periodBounds(p: Period, ms: number, f: Frame): [number, number] {
  const w = wallAt(ms, f), n = dayNum(w.y, w.mo, w.d);
  const at = (k: number) => atWall(day0(k), f);
  if (p === 'd') return [at(n), at(n + 1)];
  if (p === 'w') { const a = n - mod(mod(n + 4, 7) - f.prefs.weekStart, 7); return [at(a), at(a + 7)]; }
  if (p === 'mo' || p === 'q' || p === 'y') {
    const mo = p === 'mo' ? w.mo : p === 'q' ? Math.floor((w.mo - 1) / 3) * 3 + 1 : 1;
    const a: Wall = { y: w.y, mo, d: 1, h: 0, mi: 0, s: 0 };
    return [atWall(a, f), atWall(addMonthsWall(a, p === 'mo' ? 1 : p === 'q' ? 3 : 12), f)];
  }
  if (p === 'lmo' || p === 'ly') {
    const L = lunarOfDay(n);
    if (!L) fail(RANGE);
    if (p === 'lmo') { const s = n - L!.d + 1; return [at(s), at(s + L!.len)]; }
    const ly = lunarYear(L!.y)!;
    return [at(ly.start), at(ly.end)];
  }
  const y = w.y;
  const list = termList(y).filter((t) => p === 'term' || SEASONS.includes(t.k));
  let i = list.findIndex((t) => t.ms > ms);
  if (i <= 0) i = 1;
  return [list[i - 1].ms, list[i].ms];
}
function placeIn(p: Period, pos: Pos, ms: number, f: Frame): { ms: number; from: number } {
  const [a, b] = periodBounds(p, ms, f);
  if (pos === 'start') return { ms: a, from: a };
  if (pos === 'end') return { ms: b, from: a };
  if (pos === 'mid') return { ms: a + Math.round((b - a) / 2 / SEC) * SEC, from: a };
  return { ms: atWall(day0(dayOf(b - 1, f)), f), from: a };
}

/* ---------- picking a day by its marks ---------- */
function matcher(c: Cond, f: Frame): (n: number) => boolean {
  const termTz = f.prefs.termTz === 'china' ? CHINA_TZ : f.tz;
  const lunar = c.lmo != null || c.ld != null || c.leap != null;
  return (n) => {
    if (c.mo != null || c.d != null || c.nth != null) {
      const g = fromDayNum(n);
      if (c.mo != null && g.mo !== c.mo) return false;
      const dim = daysInMonth(g.y, g.mo);
      if (c.d != null && (c.d === -1 ? g.d !== dim : g.d !== c.d)) return false;
      if (c.nth != null && (c.nth === -1 ? g.d + 7 <= dim : Math.ceil(g.d / 7) !== c.nth)) return false;
    }
    if (c.wd != null && mod(n + 4, 7) !== c.wd) return false;
    if (lunar) {
      const L = lunarOfDay(n);
      if (!L) return false;
      if (c.lmo != null && L.m !== c.lmo) return false;
      if ((c.leap ?? false) !== L.leap && (c.lmo != null || c.leap != null)) return false;
      if (c.ld != null && (c.ld === -1 ? L.d !== L.len : L.d !== c.ld)) return false;
    }
    if (c.term != null) {
      const t = termOnDay(n, termTz);
      if (t == null || (c.term >= 0 && t !== c.term)) return false;
    }
    return true;
  };
}
/** Does day n have these marks? (A calendar marks its festivals with it.) */
export const dayMatches = (c: Cond, tz: string, prefs: RulePrefs = DEFAULT_PREFS) => matcher(c, { tz, prefs });
const LIMIT = 366 * 220;
function seekDay(c: Cond, from: number, dir: 1 | -1, k: number, f: Frame): number | null {
  const ok = matcher(c, f);
  let left = Math.max(1, k);
  for (let i = 0, n = from; i < LIMIT; i++, n += dir) {
    if (ok(n) && --left === 0) return n;
  }
  return null;
}
/** When a day is missing from its period, the nearest mark that exists: the month's last day, a short month's last day, the month that is not a leap. */
function relax(c: Cond): Cond | null {
  const r = { ...c };
  let changed = false;
  if (r.d != null && r.d > 28) { r.d = -1; changed = true; }
  if (r.ld === 30) { r.ld = -1; changed = true; }
  if (r.leap) { r.leap = false; changed = true; }
  if (r.nth != null && r.nth > 4) { r.nth = -1; changed = true; }
  return changed ? r : null;
}
function termOfDay(n: number, k: number | undefined, f: Frame): number | null {
  const tz = f.prefs.termTz === 'china' ? CHINA_TZ : f.tz;
  const t = termOnDay(n, tz);
  if (t == null || (k != null && k >= 0 && t !== k)) return null;
  const y = fromDayNum(n).y;
  for (const yy of [y - 1, y, y + 1]) { const ms = termMoment(yy, t); const g = partsInTz(ms, tz); if (dayNum(g.y, g.mo, g.d) === n) return ms; }
  return null;
}

/* ---------- reading a rule ---------- */
interface State { ms: number; from: number | null }
export function evalRule(rule: Rule, ctx: RuleCtx): RuleResult {
  const f: Frame = { tz: ctx.tz, prefs: ctx.prefs || DEFAULT_PREFS };
  const trace: Trace[] = [];
  const st: State = { ms: 0, from: null };
  try { st.ms = originMs(rule.o, ctx, f); } catch (e) { return { ok: false, err: errText(e), at: -1, trace }; }
  trace.push({ ms: st.ms });
  for (let i = 0; i < rule.steps.length; i++) {
    try { step(rule.steps[i], st, ctx, f, 0); } catch (e) { return { ok: false, err: errText(e), at: i, trace }; }
    if (!Number.isFinite(st.ms) || !inRange(st.ms)) return { ok: false, err: RANGE, at: i, trace };
    trace.push({ ms: st.ms });
  }
  return { ok: true, ms: st.ms, trace, from: st.from };
}
const errText = (e: unknown) => (e instanceof RuleError ? e.message : e instanceof Error ? e.message : String(e));
const inRange = (ms: number) => { const y = new Date(ms).getUTCFullYear(); return y >= YEAR_MIN && y <= YEAR_MAX; };
function originMs(o: Origin, ctx: RuleCtx, f: Frame): number {
  if (o.t === 'now') return Math.floor(ctx.now / SEC) * SEC;
  if (o.t === 'date') return atWall(o.w, f);
  if (o.t === 'at') return o.ms;
  const which: EndRef | null = o.t === 'other' ? (ctx.self ? (ctx.self === 'start' ? 'end' : 'start') : null) : o.t;
  if (!which) return fail('「另一端」要放在開始或結束才有意義');
  const v = ctx.ends?.[which];
  if (v == null) return fail(which === 'end' ? '還沒有結束' : '還沒有開始');
  return v;
}
function step(s: Step, st: State, ctx: RuleCtx, f: Frame, depth: number): void {
  if (s.t === 'move') return move(s.n, s.u, st, f);
  if (s.t === 'align') { const r = placeIn(s.p, s.pos, st.ms, f); st.ms = r.ms; st.from = r.from; return; }
  if (s.t === 'time') {
    const w = wallAt(st.ms, f);
    const t = s.h >= 24 ? { ...addDaysWall(w, 1), h: 0, mi: 0, s: 0 } : { ...w, h: s.h, mi: s.mi, s: s.s };
    st.ms = atWall(t, f);
    return;
  }
  if (s.t === 'pick') return pick(s, st, f);
  // a word
  if (depth > 8) fail(`「${s.w}」裡面又用到自己`);
  const def = ctx.word?.(s.w);
  if (!def) return fail(`詞彙裡沒有「${s.w}」`);
  if (!def.steps.length || def.o.t !== 'now') st.ms = originMs(def.o, ctx, f);
  let scoped = !s.in && s.k == null;
  for (const x of def.steps) {
    if (!scoped && x.t === 'pick' && (x.in === 'next' || x.in === 'prev')) {
      scoped = true;
      const inPeriod = s.in !== 'next' && s.in !== 'prev';
      step({ ...x, in: s.in!, incl: inPeriod ? undefined : false, ...(s.k != null ? { k: s.k } : {}) }, st, ctx, f, depth + 1);
      continue;
    }
    if (!scoped && x.t === 'word') { scoped = true; step({ ...x, in: s.in, k: s.k }, st, ctx, f, depth + 1); continue; }
    step(x, st, ctx, f, depth + 1);
  }
}
function move(n: number, u: Unit, st: State, f: Frame) {
  if (!n) return;
  if (u === 's' || u === 'mi' || u === 'h') { st.ms += n * (u === 's' ? 1 : u === 'mi' ? 60 : 3600) * SEC; return; }
  if (u === 'lmo' || u === 'ly') {
    const w = wallAt(st.ms, f), dn = dayNum(w.y, w.mo, w.d);
    const L = lunarOfDay(dn);
    if (!L) fail(RANGE);
    let target: number;
    if (u === 'ly') {
      const ly = lunarYear(L!.y + n);
      if (!ly) return fail(RANGE);
      const mo = ly.months.find((x) => x.m === L!.m && x.leap === L!.leap) || ly.months.find((x) => x.m === L!.m && !x.leap)!;
      target = mo.start + Math.min(L!.d, mo.len) - 1;
    } else {
      let ly = lunarYear(L!.y)!;
      let i = ly.months.findIndex((x) => x.m === L!.m && x.leap === L!.leap) + n;
      while (i < 0) { ly = lunarYear(ly.y - 1) || fail(RANGE); i += ly.months.length; }
      while (i >= ly.months.length) { i -= ly.months.length; ly = lunarYear(ly.y + 1) || fail(RANGE); }
      const mo = ly.months[i];
      target = mo.start + Math.min(L!.d, mo.len) - 1;
    }
    st.ms = atWall({ ...fromDayNum(target), h: w.h, mi: w.mi, s: w.s }, f);
    return;
  }
  if (u === 'term') {
    const { prev } = termAround(st.ms);
    const list = termList(new Date(prev.ms).getUTCFullYear());
    const i = list.findIndex((t) => t.ms === prev.ms);
    let y = list[i].y, p = TERMS_IN_YEAR.indexOf(prev.k) + n;
    y += Math.floor(p / 24); p = mod(p, 24);
    st.ms = termMoment(y, TERMS_IN_YEAR[p]) + (st.ms - prev.ms);
    return;
  }
  const a = Math.abs(n), sign = n < 0 ? -1 : 1;
  const dur: Partial<Span> = u === 'bd' || u === 'd' ? { d: a } : u === 'w' ? { w: a } : u === 'mo' ? { mo: a } : u === 'q' ? { mo: 3 * a } : { y: a };
  const r = addDuration(st.ms, f.tz, dur, sign, u === 'bd');
  if (!Number.isFinite(r.ms)) fail(RANGE);
  st.ms = r.ms;
}
function pick(s: Extract<Step, { t: 'pick' }>, st: State, f: Frame) {
  const w = wallAt(st.ms, f), n0 = dayNum(w.y, w.mo, w.d);
  const land = (n: number) => {
    if (s.exact && s.c.term != null) { const t = termOfDay(n, s.c.term, f); if (t != null) return t; }
    return atWall(f.prefs.dayResets ? day0(n) : { ...fromDayNum(n), h: w.h, mi: w.mi, s: w.s }, f);
  };
  if (s.in === 'next' || s.in === 'prev') {
    const dir = s.in === 'next' ? 1 : -1;
    const k = Math.max(1, s.k ?? 1);
    let n = seekDay(s.c, s.incl ? n0 : n0 + dir, dir, k, f);
    // a moment (a 節氣's) that is already past today does not count as the next one
    if (n === n0 && s.exact && s.c.term != null) {
      const t = termOfDay(n0, s.c.term, f);
      if (t != null && (dir > 0 ? t < st.ms : t > st.ms)) n = seekDay(s.c, n0 + dir, dir, k, f);
    }
    if (n == null) return fail('兩百年內找不到這樣的日子');
    const ms = land(n);
    if (dir > 0) { const p = seekDay(s.c, n - 1, -1, 1, f); st.from = p != null ? land(p) : null; }
    st.ms = ms;
    return;
  }
  const [a, b] = periodBounds(s.in, st.ms, f);
  const da = dayOf(a, f), db = dayOf(b - 1, f);
  let c: Cond | null = s.c;
  let hits: number[] = [];
  while (c) {
    const ok = matcher(c, f);
    hits = [];
    for (let n = da; n <= db; n++) if (ok(n)) hits.push(n);
    if (hits.length || f.prefs.missing === 'error') break;
    c = relax(c);
  }
  if (!hits.length) return fail(`${SCOPE_NAME[s.in]}沒有${condName(s.c)}`);
  const k = s.k ?? 1;
  let i = k < 0 ? hits.length + k : k - 1;
  if (i < 0 || i >= hits.length) {
    if (f.prefs.missing === 'error') return fail(`${SCOPE_NAME[s.in]}只有 ${hits.length} 個${condName(s.c)}`);
    i = Math.max(0, Math.min(hits.length - 1, i));
  }
  st.from = a;
  st.ms = land(hits[i]);
}

/* ---------- describing a rule in words ---------- */
export function condName(c: Cond): string {
  const out: string[] = [];
  if (c.mo != null) out.push(`${c.mo}月`);
  if (c.d != null) out.push(c.d === -1 ? '最後一天' : `${c.d}號`);
  if (c.wd != null) out.push(c.nth != null ? `${c.nth === -1 ? '最後一個' : `第${c.nth}個`}週${WD[c.wd]}` : `週${WD[c.wd]}`);
  if (c.lmo != null || c.ld != null || c.leap) {
    let t = '農曆';
    if (c.lmo != null) t += lunarMonthName(c.lmo, !!c.leap);
    else if (c.leap) t += '閏月';
    if (c.ld != null) t += c.ld === -1 ? '最後一天' : lunarDayName(c.ld);
    out.push(t);
  }
  if (c.term != null) out.push(c.term >= 0 ? TERM_NAMES[c.term] : '節氣');
  return out.join('') || '任何一天';
}
export function stepName(s: Step, prefs: RulePrefs = DEFAULT_PREFS): string {
  if (s.t === 'move') return `${s.n < 0 ? '−' : '+'}${Math.abs(s.n)}${UNIT_NAME[s.u]}`;
  if (s.t === 'align') {
    const P = PERIOD_NAME[s.p];
    if (s.p === 'd') return { start: '當天 0:00', mid: '當天中午', last: '當天 0:00', end: '當天結束' }[s.pos];
    if (s.p === 'w' && s.pos === 'start') return prefs.weekStart ? '週一' : '週日';
    if (s.p === 'w' && s.pos === 'last') return prefs.weekStart ? '週日' : '週六';
    if (s.p === 'mo' && s.pos === 'last') return '月底';
    if (s.p === 'y' && s.pos === 'last') return '12/31';
    if (s.p === 'ly' && s.pos === 'start') return '春節';
    if (s.p === 'ly' && s.pos === 'last') return '除夕';
    if (s.p === 'lmo' && s.pos === 'start') return '農曆初一';
    if (s.pos === 'start') return `${P}初`;
    if (s.pos === 'mid') return `${P}中`;
    if (s.pos === 'last') return `${P}的最後一天`;
    return `${P}結束`;
  }
  if (s.t === 'time') return `${pad(s.h)}:${pad(s.mi)}${s.s ? ':' + pad(s.s) : ''}`;
  if (s.t === 'word') {
    const k = s.k ?? 1;
    if (s.in === 'next') return (k === 2 ? '下下個' : k > 2 ? `往後第${k}個` : '下一個') + s.w;
    if (s.in === 'prev') return (k === 2 ? '上上個' : k > 2 ? `往前第${k}個` : '上一個') + s.w;
    return (s.in ? SCOPE_NAME[s.in] + '的' : '') + s.w;
  }
  const what = condName(s.c) + (s.exact && s.c.term != null ? '那一刻' : '');
  if (s.in === 'next' || s.in === 'prev') {
    const k = s.k ?? 1;
    const pre = s.in === 'next' ? (k === 1 ? (s.incl ? '' : '下一個') : k === 2 ? '下下個' : `往後第${k}個`) : (k === 1 ? '上一個' : k === 2 ? '上上個' : `往前第${k}個`);
    return pre + what;
  }
  const k = s.k ?? 1;
  const nth = k === 1 ? '' : k === -1 ? '最後一個' : `第${k}個`;
  // a weekday in its week, a day in its month: the scope goes without saying
  if ((s.in === 'w' && Object.keys(s.c).every((x) => x === 'wd')) || (s.in === 'mo' && Object.keys(s.c).every((x) => x === 'd'))) return nth + what;
  return `${SCOPE_NAME[s.in]}的${nth}${what}`;
}
export function originName(o: Origin): string {
  if (o.t === 'now') return '現在';
  if (o.t === 'start') return '開始';
  if (o.t === 'end') return '結束';
  if (o.t === 'other') return '另一端';
  if (o.t === 'at') return new Date(o.ms).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  const w = o.w;
  return `${w.y}/${w.mo}/${w.d}${w.h || w.mi || w.s ? ` ${pad(w.h)}:${pad(w.mi)}` : ''}`;
}
/** A short name for a rule, the way a person would say it where possible: 明天 晚上, 今天結束, 下個月 月底, 開始 → 月結束. */
export function ruleName(r: Rule, prefs: RulePrefs = DEFAULT_PREFS): string {
  const st = r.steps;
  if (!st.length) return originName(r.o);
  const fromNow = r.o.t === 'now';
  if (fromNow && st.length === 1 && st[0].t === 'align') {
    const a = st[0];
    const names: Partial<Record<Period, Partial<Record<Pos, string>>>> = {
      d: { start: '今天', mid: '今天中午', end: '今天結束' }, w: { start: prefs.weekStart ? '本週一' : '本週日', end: '本週結束' },
      mo: { start: '月初', mid: '月中', last: '月底', end: '本月結束' }, y: { start: '年初', mid: '年中', last: '年底', end: '跨年' },
      ly: { start: '今年春節', last: '除夕' },
    };
    const hit = names[a.p]?.[a.pos];
    if (hit) return hit;
  }
  // +30天, −1年3個月: the other end plus a length, as the span field writes it
  if (r.o.t === 'other' && st.every((s) => s.t === 'move')) {
    const neg = (st[0] as { n: number }).n < 0;
    return (neg ? '−' : '+') + st.map((s) => { const m = s as { n: number; u: Unit }; return `${Math.abs(m.n)}${UNIT_NAME[m.u]}`; }).join('');
  }
  // 3天後, 1年3個月前: only lengths from now
  if (fromNow && st.every((s) => s.t === 'move')) {
    const neg = (st[0] as { n: number }).n < 0;
    return st.map((s) => { const m = s as { n: number; u: Unit }; return `${Math.abs(m.n)}${UNIT_NAME[m.u]}`; }).join('') + (neg ? '前' : '後');
  }
  const out: string[] = fromNow ? [] : [originName(r.o) + ' →'];
  let prevUnit: Unit | Period | null = fromNow ? 'now' as never : null;
  for (let i = 0; i < st.length; i++) {
    const s = st[i], nx = st[i + 1];
    if (fromNow && i === 0 && s.t === 'move') {
      const word = s.u === 'd' && nx?.t === 'align' && nx.p === 'd' && nx.pos === 'start'
        ? ({ 1: '明天', 2: '後天', 3: '大後天', [-1]: '昨天', [-2]: '前天' } as Record<number, string>)[s.n]
        : s.u === 'w' ? ({ 1: '下週', 2: '下下週', [-1]: '上週', [-2]: '上上週' } as Record<number, string>)[s.n]
          : s.u === 'mo' ? ({ 1: '下個月', 2: '下下個月', [-1]: '上個月' } as Record<number, string>)[s.n]
            : s.u === 'y' ? ({ 1: '明年', 2: '後年', [-1]: '去年', [-2]: '前年' } as Record<number, string>)[s.n] : undefined;
      if (word) { out.push(word); prevUnit = s.u; if (s.u === 'd') i++; continue; }
    }
    if (fromNow && i === 0 && s.t === 'align' && s.p === 'd' && s.pos === 'start') { out.push('今天'); prevUnit = 'd'; continue; }
    // the scope goes without saying right after a move of that unit (明年 中秋, 下個月 5號)
    if ((s.t === 'word' || s.t === 'pick') && s.in && s.in !== 'next' && s.in !== 'prev' && (prevUnit === s.in || (i === 0 && fromNow))) {
      const bare = s.t === 'word' ? s.w : stepName({ ...s, in: s.in }, prefs).replace(/^這(一年|個月|週|個農曆月|個農曆年)的/, '');
      const here = i === 0 && fromNow ? ({ y: '今年', mo: '這個月', w: '這週', ly: '今年', lmo: '這個農曆月' } as Partial<Record<Period, string>>)[s.in] ?? '' : '';
      out.push(here + bare);
      continue;
    }
    out.push(stepName(s, prefs));
    prevUnit = s.t === 'move' ? s.u : s.t === 'align' ? s.p : null;
  }
  return out.join(' ');
}

/* ---------- a rule as a short text, for storage and links ---------- */
const wallCode = (w: Wall) => `${pad(w.y, 4)}${pad(w.mo)}${pad(w.d)}${w.h || w.mi || w.s ? `T${pad(w.h)}${pad(w.mi)}${w.s ? pad(w.s) : ''}` : ''}`;
const COND_KEYS: [keyof Cond, string][] = [['mo', 'mo'], ['d', 'd'], ['wd', 'wd'], ['nth', 'nth'], ['lmo', 'lmo'], ['ld', 'ld'], ['term', 't']];
export function encodeRule(r: Rule): string {
  const o = r.o.t === 'now' ? 'n' : r.o.t === 'start' ? 's' : r.o.t === 'end' ? 'e' : r.o.t === 'other' ? 'o' : r.o.t === 'at' ? 'i' + r.o.ms : 'd' + wallCode(r.o.w);
  return [o, ...r.steps.map((s) => {
    if (s.t === 'move') return `${s.n < 0 ? '-' : '+'}${Math.abs(s.n)}${s.u}`;
    if (s.t === 'align') return `a${s.p}.${s.pos}`;
    if (s.t === 'time') return `t${pad(s.h)}${pad(s.mi)}${s.s ? pad(s.s) : ''}`;
    if (s.t === 'word') return 'w' + encodeURIComponent(s.w) + (s.in ? '|' + s.in : '') + (s.k != null && s.k !== 1 ? '*' + s.k : '');
    const c = COND_KEYS.filter(([k]) => s.c[k] != null).map(([k, code]) => code + s.c[k]);
    if (s.c.leap) c.push('lp');
    return `p${s.in}${s.k != null && s.k !== 1 ? '*' + s.k : ''}${s.incl ? '!' : ''}${s.exact ? '@' : ''}:${c.join(',')}`;
  })].join('/');
}
const isUnit = (u: string): u is Unit => (UNITS as string[]).includes(u);
const isPeriod = (p: string): p is Period => (PERIODS as string[]).includes(p);
const isScope = (p: string): p is Scope => p === 'next' || p === 'prev' || isPeriod(p);
export function decodeRule(code: string): Rule | null {
  if (typeof code !== 'string' || !code || code.length > 600) return null;
  const parts = code.split('/');
  const oc = parts[0];
  let o: Origin;
  if (oc === 'n') o = { t: 'now' };
  else if (oc === 's') o = { t: 'start' };
  else if (oc === 'e') o = { t: 'end' };
  else if (oc === 'o') o = { t: 'other' };
  else if (/^i-?\d{1,15}$/.test(oc)) o = { t: 'at', ms: +oc.slice(1) };
  else {
    const m = /^d(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?)?$/.exec(oc);
    if (!m) return null;
    const w = { y: +m[1], mo: +m[2], d: +m[3], h: +(m[4] || 0), mi: +(m[5] || 0), s: +(m[6] || 0) };
    if (!validWall(w)) return null;
    o = { t: 'date', w };
  }
  const steps: Step[] = [];
  for (const p of parts.slice(1)) {
    let m: RegExpExecArray | null;
    if ((m = /^([+-])(\d{1,6})([a-z]+)$/.exec(p)) && isUnit(m[3])) { steps.push({ t: 'move', n: (m[1] === '-' ? -1 : 1) * +m[2], u: m[3] }); continue; }
    if ((m = /^a([a-z]+)\.(start|mid|last|end)$/.exec(p)) && isPeriod(m[1])) { steps.push({ t: 'align', p: m[1], pos: m[2] as Pos }); continue; }
    if ((m = /^t(\d{2})(\d{2})(\d{2})?$/.exec(p)) && +m[1] <= 24 && +m[2] < 60 && +(m[3] || 0) < 60) { steps.push({ t: 'time', h: +m[1], mi: +m[2], s: +(m[3] || 0) }); continue; }
    if ((m = /^w([^|*]+)(?:\|([a-z]+))?(?:\*(-?\d+))?$/.exec(p))) {
      let w = '';
      try { w = decodeURIComponent(m[1]); } catch { return null; }
      if (m[2] && !isScope(m[2])) return null;
      steps.push({ t: 'word', w, ...(m[2] ? { in: m[2] as Scope } : {}), ...(m[3] ? { k: +m[3] } : {}) });
      continue;
    }
    if ((m = /^p([a-z]+)(?:\*(-?\d+))?(!)?(@)?:([a-z0-9,-]*)$/.exec(p)) && isScope(m[1])) {
      const c: Cond = {};
      for (const kv of m[5] ? m[5].split(',') : []) {
        if (kv === 'lp') { c.leap = true; continue; }
        const x = /^([a-z]+)(-?\d+)$/.exec(kv);
        const key = x && COND_KEYS.find(([, code]) => code === x[1]);
        if (!x || !key) return null;
        c[key[0]] = +x[2] as never;
      }
      steps.push({ t: 'pick', c, in: m[1], ...(m[2] ? { k: +m[2] } : {}), ...(m[3] ? { incl: true } : {}), ...(m[4] ? { exact: true } : {}) });
      continue;
    }
    return null;
  }
  return { o, steps };
}

/* ---------- what a rule is, in the app's older terms ---------- */
/** The rule is the clock itself: 現在. */
export const isNowRule = (r: Rule) => r.o.t === 'now' && !r.steps.length;
/** The other end plus a length (+30天, −1年3個月): what the app keeps as a link. */
export function spanOfRule(r: Rule, self?: EndRef): Span | null {
  const otherEnd = self && ((r.o.t === 'other') || (self === 'start' ? r.o.t === 'end' : r.o.t === 'start'));
  if (!otherEnd || !r.steps.length) return null;
  const sp: Span = { sign: 1, y: 0, mo: 0, w: 0, d: 0, h: 0, mi: 0, s: 0, biz: false };
  let sign = 0;
  for (const s of r.steps) {
    if (s.t !== 'move' || s.u === 'lmo' || s.u === 'ly' || s.u === 'term') return null;
    const sg = s.n < 0 ? -1 : 1;
    if (sign && sg !== sign) return null;
    sign = sg;
    const a = Math.abs(s.n);
    if (s.u === 'bd') { if (sp.d && !sp.biz) return null; sp.d += a; sp.biz = true; }
    else if (s.u === 'd') { if (sp.biz) return null; sp.d += a; }
    else if (s.u === 'q') sp.mo += 3 * a;
    else sp[s.u] += a;
  }
  sp.sign = (sign || 1) as 1 | -1;
  return sp;
}
export function ruleOfSpan(sp: Span): Rule {
  const steps: Step[] = [];
  const add = (n: number, u: Unit) => { if (n) steps.push({ t: 'move', n: sp.sign * n, u }); };
  add(sp.y, 'y'); add(sp.mo, 'mo'); add(sp.w, 'w'); add(sp.d, sp.biz ? 'bd' : 'd'); add(sp.h, 'h'); add(sp.mi, 'mi'); add(sp.s, 's');
  if (!steps.length) steps.push({ t: 'move', n: 0, u: 'd' });
  return { o: { t: 'other' }, steps };
}
/** Which ends a rule reads (through its words too). */
export function ruleReads(r: Rule, self: EndRef | undefined, word?: (n: string) => Rule | null, depth = 0): Set<EndRef> {
  const out = new Set<EndRef>();
  const add = (o: Origin) => {
    if (o.t === 'start' || o.t === 'end') out.add(o.t);
    else if (o.t === 'other' && self) out.add(self === 'start' ? 'end' : 'start');
  };
  add(r.o);
  if (depth < 8) for (const s of r.steps) if (s.t === 'word') { const d = word?.(s.w); if (d) ruleReads(d, self, word, depth + 1).forEach((x) => out.add(x)); }
  return out;
}
/** The rule counts from the clock: read again later, it can give a different moment. */
export const ruleUsesNow = (r: Rule) => r.o.t === 'now';
