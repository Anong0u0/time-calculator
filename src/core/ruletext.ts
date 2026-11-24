/* ============================================================
   Text into a rule. The words that count (明天, 下週五, 下個月底, 3天後, 開始那個月的, 下一個中秋, 農曆八月十五,
   冬至那一刻, 第二個週日, 每月5號 …) become steps; the dates and times written out are read by parseAbsoluteText.
   Steps are put in order from the largest unit to the smallest, so "8pm tomorrow" and "明天晚上8點" are one rule.
   Any word in the vocabulary (built in or the user's own) can be used inside a sentence: 下個月發薪日, 明天下班.
   ============================================================ */
import { type Wall, type YMD, normalizeWide, parseSpan, utcMs, validWall, partsInTz, fromDayNum } from './time';
import { parseAbsoluteText, cnNumber, type ParseOpts, type ParsedText } from './parse';
import { type Rule, type Step, type Origin, type Scope, type Cond, type Unit, evalRule, ruleName } from './rule';
import { wordNames, wordRule, wordKind, rulePrefs } from './vocab';
import { TERM_NAMES } from './terms';
import { lunarYear } from './lunar';

export interface RuleReading { rule: Rule; hasTime: boolean; how: string; offset: number | null; abs?: ParsedText }
export interface RuleParse { main: RuleReading; alts: RuleReading[]; relative: boolean }

const CN = '〇零一二兩两三四五六七八九十百';
const NUM = `(\\d+|[${CN}]+)`;
const num = (t: string) => (/^\d+$/.test(t) ? +t : cnNumber(t));
const WDS: Record<string, number> = { 日: 0, 天: 0, 七: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, '0': 0, '7': 0, '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6 };
const WK = '(?:星期|禮拜|礼拜|週|周)';
const SHIFT: Record<string, number> = { 下下: 2, 上上: -2, 大後: 3, 大后: 3, 大前: -3, 下: 1, 上: -1, 本: 0, 這: 0, 这: 0, 今: 0, 明: 1, 去: -1, 昨: -1, 前: -2, 後: 2, 后: 2, 次: 1 };
const EN_WD: [RegExp, number][] = [[/^sun/, 0], [/^mon/, 1], [/^tue/, 2], [/^wed/, 3], [/^thu/, 4], [/^fri/, 5], [/^sat/, 6]];
const EN_WD_RE = 'sun(?:day)?|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?';
const LUNAR_MO: Record<string, number> = { 正: 1, 冬: 11, 臘: 12, 腊: 12 };
const PART_RE = /^(凌晨|清晨|早上|早晨|上午|中午|正午|下午|傍晚|晚上|晚間|深夜|半夜|午夜)$/;

/** Step levels: a year comes before a month, a month before a week, a week before a day, a day before a time. */
type Lvl = number;
interface Item { lvl: Lvl; step: Step; seq: number }
function wordLevel(name: string): Lvl {
  const r = wordRule(name);
  const s = r?.steps[0];
  if (!s) return 4;
  if (s.t === 'time') return 5;
  if (s.t === 'move') return { y: 1, ly: 1, q: 1.5, mo: 2, lmo: 2, w: 3, term: 3, d: 4, bd: 4, h: 4.5, mi: 4.5, s: 4.5 }[s.u];
  if (s.t === 'align') return { y: 1.5, ly: 1.5, q: 1.7, season: 1.7, mo: 2.5, lmo: 2.5, term: 3.5, w: 3.5, d: 4.2 }[s.p];
  if (s.t === 'pick') return s.in === 'y' || s.in === 'ly' ? 1.6 : s.in === 'mo' || s.in === 'lmo' || s.in === 'q' ? 2.6 : s.in === 'w' ? 3.6 : 4;
  return 4;
}
const daysOf = (v: number, u: Unit): Step => ({ t: 'move', n: v, u });

export function parseRuleText(input: string, opts: ParseOpts = {}): RuleParse | null {
  let s = normalizeWide(input).replace(/[–—−]/g, '-').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  const items: Item[] = [];
  const push = (lvl: Lvl, step: Step) => items.push({ lvl, step, seq: items.length });
  let origin: Origin | null = null;
  let scopeHint: Scope | null = null;
  let relative = false;
  const take = (re: RegExp): RegExpExecArray | null => {
    const m = re.exec(s);
    if (m) s = s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length);
    return m;
  };
  const before = (m: RegExpExecArray) => s.slice(0, m.index);
  let m: RegExpExecArray | null;

  /* where it starts: 開始, 結束 (and 那個月的 …: what the words after it are inside of) */
  if ((m = take(/^(?:從|从)?\s*(開始|开始|起點|起点|結束|结束|終點|终点)\s*(那一?天|當天|那一?週|那個星期|當週|那個月|當月|那一?年|當年)?\s*的?/))) {
    origin = { t: /開始|开始|起點|起点/.test(m[1]) ? 'start' : 'end' };
    const f = m[2] || '';
    scopeHint = /週|星期/.test(f) ? 'w' : /月/.test(f) ? 'mo' : /年/.test(f) ? 'y' : null;
    relative = true;
  }

  /* lengths: 3天後, 1年3個月前, in 2 hours, 2 days ago, (開始)後3天, +30天 */
  const UNIT = '(?:秒鐘?|分鐘|分|個小時|小時|個鐘頭|鐘頭|天|日|個工作天|個工作日|工作天|工作日|週|周|個星期|個禮拜|星期|禮拜|個月|個季度|季|年|個農曆月|農曆月|個節氣|節氣|(?:seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|weeks?|wks?|months?|years?|yrs?|mo|s|m|h|d|w|y)(?![a-z]))';
  const TERM = `(?:\\d+(?:\\.\\d+)?|[${CN}半]+)\\s*${UNIT}`;
  const spanSteps = (txt: string, sign: 1 | -1): Step[] | null => {
    const t = txt.replace(/個?農曆月/g, '@L').replace(/個?節氣/g, '@T');
    const out: Step[] = [];
    // lunar months and 節氣 are not in parseSpan's units: take them out first
    const rest = t.replace(/(\d+|[一二兩两三四五六七八九十]+)\s*@([LT])/g, (_x, n, u) => { out.push({ t: 'move', n: sign * num(n), u: u === 'L' ? 'lmo' : 'term' }); return ' '; }).trim();
    if (rest) {
      let sp = null;
      try { sp = parseSpan(rest); } catch { sp = null; }
      if (!sp) return null;
      const g = (sign * sp.sign) as 1 | -1;
      const add = (n: number, u: Unit) => { if (n) out.push({ t: 'move', n: g * n, u }); };
      add(sp.y, 'y'); add(sp.mo, 'mo'); add(sp.w, 'w'); add(sp.d, sp.biz ? 'bd' : 'd'); add(sp.h, 'h'); add(sp.mi, 'mi'); add(sp.s, 's');
    }
    return out.length ? out : null;
  };
  const lvlOf = (st: Step): Lvl => (st.t === 'move' ? ({ y: 1, ly: 1, q: 1.5, mo: 2, lmo: 2, w: 3, term: 3, d: 4.1, bd: 4.1, h: 4.6, mi: 4.6, s: 4.6 }[st.u]) : 4);
  for (let guard = 0; guard < 6; guard++) {
    let sign: 1 | -1 = 1, body = '';
    if ((m = take(new RegExp(`((?:${TERM}\\s*)+)(之後|以後|後|后|之前|以前|前|later|ago|from now|after|before)`, 'i')))) { body = m[1]; sign = /前|ago|before/i.test(m[2]) ? -1 : 1; }
    else if ((m = take(new RegExp(`(?:^|\\s)(?:in)\\s+((?:${TERM}\\s*)+)`, 'i')))) body = m[1];
    else if (origin && (m = take(new RegExp(`(之後|以後|後|后|之前|以前|前|過)\\s*((?:${TERM}\\s*)+)`)))) { body = m[2]; sign = /前/.test(m[1]) ? -1 : 1; }
    else if ((m = take(new RegExp(`^\\s*([+＋]|-)\\s*((?:${TERM}\\s*)+)`)))) { body = m[2]; sign = m[1] === '-' ? -1 : 1; if (!origin) origin = { t: 'other' }; }
    if (!m) break;
    const st = spanSteps(body, sign);
    if (!st) return null;
    for (const x of st) push(lvlOf(x), x);
    relative = true;
  }

  /* lunar dates: 農曆八月十五, 正月初一, 閏六月初一, 臘月初八, 農曆2026年8月15日, 農曆8/15, 農曆十五 */
  let lunarAlt: Cond | null = null;
  const MO_T = '(正|冬|臘|腊|\\d{1,2}|十[一二]|[一二三四五六七八九十])';
  const LD_T = '(初[一二三四五六七八九十]|十[一二三四五六七八九]|二十|廿[一二三四五六七八九]|三十|\\d{1,2}|[一二三四五六七八九十])';
  const LUN = '(?:農曆|农历|陰曆|阴历|舊曆|旧历)';
  const ldNum = (t: string) => (/^初/.test(t) ? cnNumber(t.slice(1)) : /^廿/.test(t) ? 20 + cnNumber(t.slice(1)) : num(t));
  const lmoNum = (t: string) => LUNAR_MO[t] ?? num(t);
  let lun: { y: number | null; mo: number | null; leap: boolean; d: number | null } | null = null;
  if ((m = take(new RegExp(`${LUN}\\s*(?:(\\d{3,4})\\s*(?:年|[-/.])\\s*)?(閏|闰)?\\s*${MO_T}\\s*月\\s*(?:${LD_T}\\s*(?:日|號|号)?)?`))))
    lun = { y: m[1] ? +m[1] : null, leap: !!m[2], mo: lmoNum(m[3]), d: m[4] ? ldNum(m[4]) : null };
  else if ((m = take(new RegExp(`${LUN}\\s*(?:(\\d{3,4})\\s*[-/.]\\s*)?(閏|闰)?\\s*(\\d{1,2})\\s*[-/.]\\s*(\\d{1,2})`))))
    lun = { y: m[1] ? +m[1] : null, leap: !!m[2], mo: +m[3], d: +m[4] };
  else if ((m = take(new RegExp(`${LUN}\\s*${LD_T}\\s*(?:日|號|号)?`))))
    lun = { y: null, leap: false, mo: null, d: ldNum(m[1]) };
  else {
    // no 農曆 in front, but words only the lunar calendar uses: 正月, 冬月, 臘月, 閏…月, 初一, 廿五
    const re = new RegExp(`(閏|闰)?\\s*${MO_T}\\s*月\\s*${LD_T}?\\s*(?:日|號|号)?`, 'g');
    for (const x of s.matchAll(re)) {
      if (x[1] || /[正冬臘腊]/.test(x[2]) || (x[3] && /^[初廿]/.test(x[3]))) {
        s = s.slice(0, x.index!) + ' ' + s.slice(x.index! + x[0].length);
        lun = { y: null, leap: !!x[1], mo: lmoNum(x[2]), d: x[3] ? ldNum(x[3]) : null };
        break;
      }
    }
  }
  if (lun) {
    if ((lun.mo != null && (lun.mo < 1 || lun.mo > 12)) || (lun.d != null && (lun.d < 1 || lun.d > 30))) return null;
    if (lun.mo == null) push(2.6, { t: 'pick', c: { ld: lun.d! }, in: 'lmo' });
    else {
      const c: Cond = { lmo: lun.mo, ...(lun.leap ? { leap: true } : {}), ...(lun.d != null ? { ld: lun.d } : {}) };
      if (lun.y != null) {
        const ly = lunarYear(lun.y);
        if (!ly) return null;
        origin = { t: 'date', w: { ...fromDayNum(ly.start), h: 0, mi: 0, s: 0 } };
        push(1.6, { t: 'pick', c, in: 'ly' });
      } else push(1.6, { t: 'pick', c, in: 'y' });
    }
    relative = true;
  }

  /* a 節氣's very moment: 冬至那一刻, 春分的時刻 */
  const termRe = new RegExp(`(下一個|下一个|下個|下个|上一個|上一个|上個|上个)?\\s*(${TERM_NAMES.join('|')})\\s*(?:節)?\\s*(?:那一刻|的時刻|時刻|的那一刻|交節|那刻)`);
  if ((m = take(termRe))) {
    const k = TERM_NAMES.indexOf(m[2]);
    const prev = /上/.test(m[1] || '');
    push(4, { t: 'pick', c: { term: k }, in: prev ? 'prev' : 'next', incl: !m[1], exact: true });
    relative = true;
  }

  /* the parts of a period: 下個月底, 3月底, 明年年底, 下週末, 今天結束, 月初 */
  const ANCHOR_WORD: Record<string, Record<string, string>> = {
    月: { 初: '月初', 中: '月中', 底: '月底', 尾: '月底', 末: '月底' }, 年: { 初: '年初', 中: '年中', 底: '年底', 尾: '年底', 末: '年底' },
    週: { 初: '週初', 中: '週中', 末: '週末', 底: '週末' },
  };
  const unitKey = (u: string) => (/月/.test(u) ? '月' : /年/.test(u) ? '年' : /天|日/.test(u) ? '天' : '週');
  const anchor = (u: string, a: string) => {
    const k = unitKey(u);
    if (/結束|结束/.test(a)) { push(k === '年' ? 1.5 : k === '月' ? 2.5 : k === '週' ? 3.5 : 4.2, { t: 'align', p: k === '年' ? 'y' : k === '月' ? 'mo' : k === '週' ? 'w' : 'd', pos: 'end' }); return; }
    const w = ANCHOR_WORD[k]?.[a];
    if (w && wordRule(w)) push(wordLevel(w), { t: 'word', w });
  };
  for (let guard = 0; guard < 3; guard++) {
    if ((m = take(/(\d{1,2}|[一二三四五六七八九十]+)\s*月\s*(初|中(?!午)|底|尾|末|結束|结束)/))) {
      const mo = num(m[1]);
      if (mo < 1 || mo > 12) return null;
      push(1.6, { t: 'pick', c: { mo }, in: 'y' });
      anchor('月', m[2]);
    } else if ((m = take(/(下下|上上|大後|大后|大前|下|上|本|這|这|今|明|去|昨|前|後|后)?\s*(?:個|个)?\s*(月|年|週|周|星期|禮拜|礼拜|天|日)\s*(初|中(?!午|秋|元)|底|尾|末|結束|结束)/))) {
      const n = m[1] ? SHIFT[m[1]] : 0;
      const k = unitKey(m[2]);
      if (n) push(k === '年' ? 1 : k === '月' ? 2 : k === '週' ? 3 : 4.1, daysOf(n, k === '年' ? 'y' : k === '月' ? 'mo' : k === '週' ? 'w' : 'd'));
      if (k === '天' && /結束|结束/.test(m[3])) anchor('天', m[3]);
      else if (k !== '天') anchor(m[2], m[3]);
      else return null;
    } else break;
    relative = true;
  }

  /* days: 大後天 … 大前天, tomorrow; 明晚, 今早 also say the part of the day */
  const DAY_WORDS: [RegExp, number, string?][] = [
    [/大後天|大后天/, 3], [/大前天/, -3], [/後天|后天/, 2], [/前天/, -2], [/明早|明晨/, 1, '早上'], [/明晚/, 1, '晚上'], [/昨晚/, -1, '晚上'], [/昨早/, -1, '早上'],
    [/明天|明日|\btomorrow\b/i, 1], [/昨天|昨日|\byesterday\b/i, -1], [/今早|今晨/, 0, '早上'], [/今晚|\btonight\b/i, 0, '晚上'], [/今天|今日|\btoday\b/i, 0],
  ];
  for (const [re, n, part] of DAY_WORDS) {
    if ((m = take(re))) {
      if (n) push(4.1, daysOf(n, 'd'));
      push(4.2, { t: 'align', p: 'd', pos: 'start' });
      if (part) s = s.slice(0, m.index) + part + s.slice(m.index);
      relative = true;
      break;
    }
  }
  /* years and months */
  const YEAR_WORDS: [RegExp, number][] = [[/大後年|大后年/, 3], [/今年|\bthis year\b/i, 0], [/明年|\bnext year\b/i, 1], [/後年|后年/, 2], [/去年|\blast year\b/i, -1], [/前年/, -2]];
  for (const [re, n] of YEAR_WORDS) if ((m = take(re))) { if (n) push(1, daysOf(n, 'y')); relative = true; scopeHint = scopeHint || 'y'; break; }
  if ((m = take(/(下下|上上|下|上|本|這|这)\s*(?:個|个)?\s*月(?![初中底尾末])|\b(next|last|this) month\b/i))) {
    const n = m[1] ? SHIFT[m[1]] : m[2] === 'next' ? 1 : m[2] === 'last' ? -1 : 0;
    if (n) push(2, daysOf(n, 'mo'));
    relative = true;
    scopeHint = 'mo';
  }

  /* the weekday before or after the moment so far: (結束)前最後一個週五, (開始)後第一個週一 */
  if ((m = take(new RegExp(`(之前|以前|前|之後|以後|後|后)\\s*的?\\s*(?:最後|最后|第)?\\s*一\\s*個\\s*${WK}\\s*([一二三四五六日天七1-7])`)))) {
    push(4, { t: 'pick', c: { wd: WDS[m[2]] }, in: /前/.test(m[1]) ? 'prev' : 'next' });
    relative = true;
  }
  /* the n-th weekday: 5月第二個週日, 第三個週三, 最後一個週五 */
  if ((m = take(new RegExp(`(?:(\\d{1,2}|[一二三四五六七八九十]+)\\s*月\\s*(?:的)?\\s*)?(?:第\\s*(\\d|[一二三四五])\\s*個|最後一個|最后一个)\\s*${WK}\\s*([一二三四五六日天七1-7])`)))) {
    const nth = /最後|最后/.test(m[0]) ? -1 : num(m[2]);
    const wd = WDS[m[3]];
    if (m[1]) push(4, { t: 'pick', c: { mo: num(m[1]), wd, nth }, in: scopeHint === 'y' ? 'y' : 'next', incl: true });
    else push(3.6, { t: 'pick', c: { wd }, in: 'mo', k: nth });
    relative = true;
  }
  /* every month's 5th, every Friday: the next one (每月5號, 每週五, 每年3月14) */
  if ((m = take(/每(?:個|个)?月\s*(\d{1,2}|[一二三四五六七八九十]+)\s*(?:日|號|号)/))) { push(4, { t: 'pick', c: { d: num(m[1]) }, in: 'next', incl: true }); relative = true; }
  if ((m = take(new RegExp(`每(?:個|个)?${WK}\\s*([一二三四五六日天七1-7])`)))) { push(4, { t: 'pick', c: { wd: WDS[m[1]] }, in: 'next', incl: true }); relative = true; }
  if ((m = take(/每年\s*(\d{1,2}|[一二三四五六七八九十]+)\s*月\s*(\d{1,2}|[一二三四五六七八九十]+)\s*(?:日|號|号)?/))) { push(4, { t: 'pick', c: { mo: num(m[1]), d: num(m[2]) }, in: 'next', incl: true }); relative = true; }

  /* weeks and weekdays: 下週五, 下下週一, 本週三, 週五, 下一個週五, 上週, next friday */
  let weekdayDecor: Item | null = null;
  if ((m = take(new RegExp(`(下一個|下一个|上一個|上一个|下下|上上|下|上|本|這|这|今)?\\s*(?:個|个)?\\s*${WK}\\s*([一二三四五六日天七1-7])`)))) {
    const p = m[1] || '';
    const wd = WDS[m[2]];
    if (/一個|一个/.test(p)) push(4, { t: 'pick', c: { wd }, in: /下/.test(p) ? 'next' : 'prev' });
    else if (p) { const n = SHIFT[p]; if (n) push(3, daysOf(n, 'w')); push(3.6, { t: 'pick', c: { wd }, in: 'w' }); }
    else { push(4, { t: 'pick', c: { wd }, in: 'next', incl: true }); weekdayDecor = items[items.length - 1]; }
    relative = true;
  } else if ((m = take(/[(（]\s*([一二三四五六日天])\s*[)）]/))) {
    push(4, { t: 'pick', c: { wd: WDS[m[1]] }, in: 'next', incl: true }); weekdayDecor = items[items.length - 1]; relative = true;
  } else if ((m = take(new RegExp(`(下下|上上|下|上|本|這|这)\\s*(?:個|个)?\\s*${WK}|\\b(next|last|this) week\\b`, 'i')))) {
    const k = m[1] || m[2];
    const n = k === 'next' ? 1 : k === 'last' ? -1 : k === 'this' ? 0 : SHIFT[k];
    if (n) push(3, daysOf(n, 'w'));
    push(3.5, { t: 'align', p: 'w', pos: 'start' });
    relative = true;
    scopeHint = 'w';
  } else if ((m = take(new RegExp(`\\b(?:(next|last|this)\\s+)?(${EN_WD_RE})\\b\\.?`, 'i')))) {
    const wd = EN_WD.find(([re]) => re.test(m![2].toLowerCase()))![1];
    const rel = (m[1] || '').toLowerCase();
    if (rel === 'this') push(3.6, { t: 'pick', c: { wd }, in: 'w' });
    else if (rel) push(4, { t: 'pick', c: { wd }, in: rel === 'next' ? 'next' : 'prev' });
    else { push(4, { t: 'pick', c: { wd }, in: 'next', incl: true }); weekdayDecor = items[items.length - 1]; }
    relative = true;
  }
  if ((m = take(/\b(start|beginning|middle|end) of (?:the )?(day|week|month|year)\b/i))) {
    const pos = m[1].toLowerCase() === 'end' ? 'end' : m[1].toLowerCase() === 'middle' ? 'mid' : 'start';
    const p = ({ day: 'd', week: 'w', month: 'mo', year: 'y' } as Record<string, 'd' | 'w' | 'mo' | 'y'>)[m[2].toLowerCase()];
    push(p === 'y' ? 1.5 : p === 'mo' ? 2.5 : p === 'w' ? 3.5 : 4.2, { t: 'align', p, pos });
    relative = true;
  }

  /* words from the vocabulary: 中秋, 母親節, 冬至, 下班, 發薪日 …, with 下一個 / 上一個 / 下下個 in front */
  for (let guard = 0; guard < 6; guard++) {
    let hit: { name: string; at: number } | null = null;
    for (const name of wordNames()) {
      const at = s.indexOf(name);
      if (at < 0) continue;
      // a part of the day followed by a time is read with the time (晚上8點)
      if (PART_RE.test(name) && /^\s*(\d|[一二兩两三四五六七八九十]+\s*[點点時时])/.test(s.slice(at + name.length))) continue;
      // 年中, 月中 right after a number belong to that number: 2027年中秋 is 2027年 + 中秋
      if (/^[年月週周]/.test(name) && /[\d〇零一二三四五六七八九十年月]$/.test(s.slice(0, at))) continue;
      hit = { name, at };
      break;
    }
    if (!hit) break;
    s = s.slice(0, hit.at) + ' ' + s.slice(hit.at + hit.name.length);
    const pre = /(下一個|下一个|下個|下个|下下個|下下个|上一個|上一个|上個|上个|上上個|上上个|最近的?)\s*$/.exec(s.slice(0, hit.at));
    const step: Step = { t: 'word', w: hit.name };
    if (pre) {
      s = s.slice(0, pre.index) + ' ' + s.slice(pre.index + pre[0].length);
      const p = pre[1];
      if (/下下|上上/.test(p)) { step.in = /下/.test(p) ? 'next' : 'prev'; step.k = 2; }
      else if (/下/.test(p)) step.in = 'next';
      else if (/上/.test(p)) step.in = 'prev';
    }
    push(wordLevel(hit.name), step);
    relative = true;
  }

  /* what is left is a date and a time written out */
  s = s.replace(/(?:^|\s)(?:的|之|那天|當天|起|從|从)(?=\s|$)/g, ' ').replace(/\s+/g, ' ').trim();
  let abs: ParsedText | null = null;
  const absText = s;
  if (s) {
    abs = parseAbsoluteText(s, { year: opts.year, today: opts.today, lone: relative });
    if (!abs) return null;
  }

  const readings: { origin: Origin | null; extra: Item[]; how: string; hasTime: boolean; offset: number | null }[] = [];
  const base = { origin, extra: [] as Item[], how: '', hasTime: false, offset: null as number | null };
  const timeItems = (h: number, mi: number, sec: number, roll: number): Item[] => {
    const out: Item[] = [];
    if (roll && h === 0) out.push({ lvl: 5, step: { t: 'time', h: 24, mi, s: sec }, seq: 900 });
    else { out.push({ lvl: 5, step: { t: 'time', h, mi, s: sec }, seq: 900 }); if (roll) out.push({ lvl: 5.1, step: daysOf(roll, 'd'), seq: 901 }); }
    return out;
  };
  // 3點 without 上午 / 下午: it could be either
  const ampmFree = (t: string) => /\d\s*[點点時时]|[一二兩两三四五六七八九十]\s*[點点時时]/.test(t) && !/上午|下午|早上|晚上|中午|凌晨|傍晚|深夜|半夜|清晨|早晨|晚間|am|pm|a\.m|p\.m/i.test(input);
  if (!abs) readings.push(base);
  else if (abs.kind === 'instant') {
    if (origin || items.length) return null;
    readings.push({ ...base, origin: { t: 'at', ms: abs.ms }, hasTime: true, how: '' });
  } else if (abs.kind === 'time') {
    readings.push({ ...base, extra: timeItems(abs.h, abs.mi, abs.s, abs.roll || 0), hasTime: true });
    if (ampmFree(absText) && abs.h >= 1 && abs.h <= 11 && !abs.roll) readings.push({ ...base, extra: timeItems(abs.h + 12, abs.mi, abs.s, 0), hasTime: true, how: '下午' });
  } else {
    const g = abs.given || { y: true, mo: true, d: true };
    const mk = (w: Wall, how: string): typeof base => {
      const extra: Item[] = [];
      let o = origin;
      if (g.y) {
        if (o) return null as never;
        o = { t: 'date', w: { ...w, ...(abs!.kind === 'wall' && abs!.hasTime ? {} : { h: 0, mi: 0, s: 0 }) } };
        if (abs!.kind === 'wall' && abs!.offset != null) o = { t: 'at', ms: utcMs(w.y, w.mo, w.d, w.h, w.mi, w.s) - abs!.offset };
      } else {
        const c: Cond = {};
        if (g.mo) c.mo = w.mo;
        if (g.d) c.d = w.d;
        extra.push({ lvl: g.mo ? 1.6 : 2.6, step: { t: 'pick', c, in: g.mo ? 'y' : 'mo' }, seq: 800 });
        if (abs!.kind === 'wall' && abs!.hasTime) extra.push(...timeItems(w.h, w.mi, w.s, 0));
        // no year and nothing counted from today: the year a date without one falls in
        if (!o && !relative && opts.year != null && opts.today && opts.year !== opts.today.y) o = { t: 'date', w: { y: opts.year, mo: 1, d: 1, h: 0, mi: 0, s: 0 } };
      }
      return { origin: o, extra, how, hasTime: abs!.kind === 'wall' && abs!.hasTime, offset: abs!.kind === 'wall' ? abs!.offset : null };
    };
    if (g.y && origin) return null;
    readings.push(mk(abs.wall, abs.how));
    if (abs.alt) readings.push(mk(abs.alt.wall, abs.alt.how));
    // a full date written with its weekday: the weekday is only a reminder
    if (g.y && g.mo && g.d && weekdayDecor) items.splice(items.indexOf(weekdayDecor), 1);
    // 十月十六 could be a lunar date too
    if (!g.y && g.mo && g.d && !abs.hasTime && /[一二三四五六七八九十]\s*月\s*[一二三四五六七八九十]/.test(absText)) lunarAlt = { lmo: abs.wall.mo, ld: abs.wall.d };
    if (abs.hasTime && ampmFree(absText) && abs.wall.h >= 1 && abs.wall.h <= 11) {
      const r0 = readings[0];
      readings.push({ ...r0, extra: r0.extra.map((it) => (it.step.t === 'time' ? { ...it, step: { ...it.step, h: it.step.h + 12 } } : it)), how: '下午',
        origin: r0.origin?.t === 'date' ? { t: 'date', w: { ...r0.origin.w, h: r0.origin.w.h + 12 } } : r0.origin });
    }
  }
  if (lunarAlt) readings.push({ ...base, extra: [{ lvl: 1.6, step: { t: 'pick', c: lunarAlt, in: 'y' }, seq: 800 }], how: '農曆', hasTime: false });

  // scoped words: 明年中秋 is that year's 中秋, 下個月發薪日 that month's
  const all = (extra: Item[]) => [...items, ...extra].sort((a, b) => a.lvl - b.lvl || a.seq - b.seq);
  const out: RuleReading[] = [];
  for (const r of readings) {
    if (!r) continue;
    const list = all(r.extra);
    const steps = list.map((it, i) => {
      const st = it.step;
      if (st.t !== 'word' || st.in) return st;
      if (it.lvl < 4) return st;
      const coarser = list.slice(0, i).filter((x) => x.lvl < 4);
      const finest = coarser.length ? coarser[coarser.length - 1].lvl : null;
      const sc: Scope | null = finest == null ? (r.origin?.t === 'date' && !r.hasTime ? 'y' : scopeHint) : finest < 2 ? 'y' : finest < 3 ? 'mo' : 'w';
      return sc ? { ...st, in: sc } : st;
    });
    const o: Origin = r.origin || { t: 'now' };
    const hasTime = r.hasTime || steps.some((x) => x.t === 'time' || (x.t === 'word' && wordKind(x.w) === 'part')) || (o.t === 'now' && steps.length > 0 && steps.every((x) => x.t === 'move'));
    out.push({ rule: { o, steps }, hasTime, how: r.how, offset: r.offset, ...(abs && !items.length && !origin && r === readings[0] ? { abs } : {}) });
  }
  if (!out.length) return null;
  // nothing at all: a text of fillers
  if (!items.length && !abs && !origin) return null;
  return { main: out[0], alts: out.slice(1), relative };
}

/** A rule's moment for the old callers: today at 00:00 UTC unless now and the clock are given. */
export function evalReading(r: RuleReading, opts: ParseOpts): Wall | null {
  const now = opts.now ?? (opts.today ? utcMs(opts.today.y, opts.today.mo, opts.today.d) : Date.now());
  const tz = opts.tz ?? 'UTC';
  const res = evalRule(r.rule, { now, tz, prefs: rulePrefs(), word: wordRule });
  if (!res.ok) return null;
  const w = partsInTz(res.ms, tz);
  return validWall(w) ? w : null;
}
export const readingName = (r: RuleReading) => ruleName(r.rule, rulePrefs());
export type { YMD };
