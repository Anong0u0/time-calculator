/* ============================================================
   The vocabulary: named rules that text and blocks can use as one step.
   Built in: parts of the day (晚上 = 20:00), the parts of a period (月底, 週末), festivals (中秋, 母親節),
   the 24 節氣. Every one of them can be changed or removed, and any rule can be given a name and added.
   Along with the general settings rules are read with (the week's first day, which day a 節氣 falls on …).
   ============================================================ */
import { type Rule, type RulePrefs, DEFAULT_PREFS, decodeRule } from './rule';
import { TERM_NAMES } from './terms';

export type WordKind = 'part' | 'period' | 'holiday' | 'lunar' | 'term' | 'mine';
export interface WordDef { name: string; code: string; kind: WordKind; alias?: string[]; note?: string }
export const KIND_NAME: Record<WordKind, string> = { part: '一天中的時段', period: '期間的位置', holiday: '節日', lunar: '農曆節日', term: '節氣', mine: '我的詞' };

const next = (c: string) => `n/pnext!:${c}`;
export const BUILTIN: WordDef[] = [
  { name: '凌晨', code: 'n/t0300', kind: 'part' },
  { name: '清晨', code: 'n/t0600', kind: 'part' },
  { name: '早上', code: 'n/t0800', kind: 'part', alias: ['早晨'] },
  { name: '上午', code: 'n/t1000', kind: 'part' },
  { name: '中午', code: 'n/t1200', kind: 'part', alias: ['正午'] },
  { name: '下午', code: 'n/t1400', kind: 'part' },
  { name: '傍晚', code: 'n/t1800', kind: 'part' },
  { name: '晚上', code: 'n/t2000', kind: 'part', alias: ['晚間'] },
  { name: '深夜', code: 'n/t2300', kind: 'part' },
  { name: '半夜', code: 'n/t2400', kind: 'part', alias: ['午夜'], note: '當天結束（隔天 0:00）' },

  { name: '週初', code: 'n/aw.start', kind: 'period' },
  { name: '週中', code: 'n/pw:wd3', kind: 'period' },
  { name: '週末', code: 'n/pw:wd6', kind: 'period', note: '這週的週六' },
  { name: '月初', code: 'n/amo.start', kind: 'period' },
  { name: '月中', code: 'n/pmo:d15', kind: 'period' },
  { name: '月底', code: 'n/amo.last', kind: 'period', alias: ['月尾', '月末'], note: '這個月的最後一天' },
  { name: '年初', code: 'n/ay.start', kind: 'period' },
  { name: '年中', code: 'n/py:mo7,d1', kind: 'period' },
  { name: '年底', code: 'n/ay.last', kind: 'period', alias: ['年尾', '年末'], note: '12 月 31 日' },
  { name: '跨年', code: 'n/ay.end', kind: 'period', alias: ['新年'], note: '這一年結束的那一刻' },

  { name: '元旦', code: next('mo1,d1'), kind: 'holiday' },
  { name: '情人節', code: next('mo2,d14'), kind: 'holiday' },
  { name: '婦女節', code: next('mo3,d8'), kind: 'holiday' },
  { name: '愚人節', code: next('mo4,d1'), kind: 'holiday' },
  { name: '兒童節', code: next('mo4,d4'), kind: 'holiday' },
  { name: '勞動節', code: next('mo5,d1'), kind: 'holiday' },
  { name: '母親節', code: next('mo5,wd0,nth2'), kind: 'holiday', note: '5 月第二個週日' },
  { name: '父親節', code: next('mo8,d8'), kind: 'holiday' },
  { name: '教師節', code: next('mo9,d28'), kind: 'holiday' },
  { name: '國慶日', code: next('mo10,d10'), kind: 'holiday' },
  { name: '萬聖節', code: next('mo10,d31'), kind: 'holiday' },
  { name: '感恩節', code: next('mo11,wd4,nth4'), kind: 'holiday', note: '11 月第四個週四' },
  { name: '平安夜', code: next('mo12,d24'), kind: 'holiday' },
  { name: '聖誕節', code: next('mo12,d25'), kind: 'holiday', alias: ['聖誕', '耶誕節', '耶誕'] },

  { name: '春節', code: next('lmo1,ld1'), kind: 'lunar', alias: ['過年', '農曆新年', '大年初一'] },
  { name: '元宵', code: next('lmo1,ld15'), kind: 'lunar', alias: ['元宵節'] },
  { name: '端午', code: next('lmo5,ld5'), kind: 'lunar', alias: ['端午節'] },
  { name: '七夕', code: next('lmo7,ld7'), kind: 'lunar' },
  { name: '中元', code: next('lmo7,ld15'), kind: 'lunar', alias: ['中元節'] },
  { name: '中秋', code: next('lmo8,ld15'), kind: 'lunar', alias: ['中秋節'] },
  { name: '重陽', code: next('lmo9,ld9'), kind: 'lunar', alias: ['重陽節'] },
  { name: '臘八', code: next('lmo12,ld8'), kind: 'lunar' },
  { name: '尾牙', code: next('lmo12,ld16'), kind: 'lunar' },
  { name: '除夕', code: next('lmo12,ld-1'), kind: 'lunar', alias: ['除夕夜'], note: '農曆年的最後一天' },

  ...[19, 20, 21, 22, 23, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18].map((k): WordDef => ({ name: TERM_NAMES[k], code: next(`t${k}`), kind: 'term', ...(k === 1 ? { alias: ['清明節'] } : {}) })),
];

/* ---------- the vocabulary in use: built-ins (less the removed and the redefined) and the user's own ---------- */
export interface MyWord { name: string; code: string }
let mine: MyWord[] = [];
let removed = new Set<string>();
let prefs: RulePrefs = { ...DEFAULT_PREFS };
let version = 0;
const ruleCache = new Map<string, Rule | null>();
export function setVocab(words: MyWord[], off: string[]) {
  mine = words.filter((w) => w.name && decodeRule(w.code));
  removed = new Set(off);
  version++;
  ruleCache.clear();
  namesCache = null;
}
export function setRulePrefs(p: RulePrefs) { prefs = { ...p }; version++; }
export const rulePrefs = () => prefs;
export const vocabVersion = () => version;
export const builtinOf = (name: string) => BUILTIN.find((b) => b.name === name || b.alias?.includes(name));
/** Every word in use, built-ins first (with the user's definition where they redefined one), then the user's own. */
export function vocab(): (WordDef & { custom: boolean; builtin: boolean })[] {
  const out: (WordDef & { custom: boolean; builtin: boolean })[] = [];
  for (const b of BUILTIN) {
    if (removed.has(b.name)) continue;
    const m = mine.find((x) => x.name === b.name);
    out.push({ ...b, code: m ? m.code : b.code, custom: !!m, builtin: true });
  }
  for (const m of mine) if (!BUILTIN.some((b) => b.name === m.name)) out.push({ name: m.name, code: m.code, kind: 'mine', custom: true, builtin: false });
  return out;
}
/** The rule a word (or one of its other names) stands for. */
export function wordRule(name: string): Rule | null {
  if (ruleCache.has(name)) return ruleCache.get(name)!;
  const m = mine.find((x) => x.name === name);
  let code = m?.code;
  if (!code) {
    const b = builtinOf(name);
    if (b && !removed.has(b.name)) code = mine.find((x) => x.name === b.name)?.code ?? b.code;
  }
  const r = code ? decodeRule(code) : null;
  ruleCache.set(name, r);
  return r;
}
export const wordKind = (name: string): WordKind | null => (mine.some((x) => x.name === name) && !builtinOf(name) ? 'mine' : builtinOf(name) && !removed.has(builtinOf(name)!.name) ? builtinOf(name)!.kind : null);
let namesCache: string[] | null = null;
/** All names text can use, longest first so 中秋節 is read before 中秋. */
export function wordNames(): string[] {
  if (namesCache) return namesCache;
  const set = new Set<string>();
  for (const w of vocab()) { set.add(w.name); for (const a of w.alias || []) set.add(a); }
  namesCache = [...set].sort((a, b) => b.length - a.length);
  return namesCache;
}
