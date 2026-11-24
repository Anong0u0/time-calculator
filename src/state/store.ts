/* ============================================================
   App state: two instants (start, end) and the span between.
   The two ends are alike: either can be a fixed moment or follow the clock (now), and the span can tie
   either one to the other (end = start + span, or start = end − span). Every lens reads both ends;
   nothing switches silently.
   ============================================================ */
import { reactive, computed, ref, watch } from 'vue';
import {
  type Wall,
  type Span,
  type WallNote,
  DAY,
  partsInTz,
  wallToInstant,
  addDuration,
  validWall,
  fmtSpan,
  spanBetween,
  diffCalendar,
  fmtDT,
  interpretSpanText,
  isValidTz,
} from '../core/time';
import { LOCAL_TZ, sameZone, zoneName } from '../core/zones';
import {
  type Rule,
  type RulePrefs,
  type RuleResult,
  DEFAULT_PREFS,
  evalRule,
  decodeRule,
  encodeRule,
  ruleName,
  ruleReads,
  isNowRule,
  spanOfRule,
} from '../core/rule';
import { setVocab, setRulePrefs, wordRule, type MyWord } from '../core/vocab';

export type End = 'start' | 'end';
export type Lens = 'zones' | 'cal' | 'read' | 'dur';
export type Theme = 'system' | 'light' | 'dark';
/** Display density in percent of the normal size; the smallest text follows it (never below 9px). */
export const DENSITY: { v: number; name: string }[] = [
  { v: 80, name: '極緊湊' },
  { v: 87, name: '緊湊' },
  { v: 93, name: '稍緊' },
  { v: 100, name: '標準' },
  { v: 108, name: '稍大' },
  { v: 116, name: '大' },
];
export const DUR_SAMPLE = '2h 45m + 1:30:20 − 15m';
export interface Link {
  expr: string;
  span: Span;
}
/** The rule an end was set by: its name, whether the end keeps following it (read again as time passes or the other end moves),
    and where its period began (for how far through it now is). */
export interface EndRule {
  code: string;
  name: string;
  follow: boolean;
  from: number | null;
}
/** A shortcut: a rule, with a name of the user's choosing. */
export interface Chip {
  code: string;
  name?: string;
}
export type ChipRow = 'start' | 'end' | 'span';
export interface AppPrefs extends RulePrefs {
  /** A rule counted from now, once applied: the end keeps following it, or stays at the moment it gave. */
  followNow: boolean;
  /** The calendar shows lunar dates and 節氣 under the days. */
  lunar: boolean;
}
export const DEFAULT_APP_PREFS: AppPrefs = { ...DEFAULT_PREFS, followNow: false, lunar: true };
export const DEFAULT_CHIPS: Record<ChipRow, Chip[]> = {
  start: [
    { code: 'n' },
    { code: 'n/ad.start' },
    { code: 'n/aw.start' },
    { code: 'n/amo.start' },
    { code: 'n/ay.start' },
  ],
  end: [
    { code: 'n' },
    { code: 'n/ad.end' },
    { code: 'n/aw.end' },
    { code: 'n/amo.end' },
    { code: 'n/ay.end' },
    { code: 'n/w%E6%98%A5%E7%AF%80', name: '春節' },
  ],
  span: ['+1d', '+7d', '+30d', '+3mo', '+6mo', '+1y'].map((c) => ({ code: 'o/' + c })),
};
/** The most shortcuts one row keeps. */
export const CHIP_MAX = 40;

/* ---------- what is on the face: every part can be put away, like the boxes of a system monitor ---------- */
export type Panel = 'top' | 'start' | 'span' | 'end' | 'rail' | 'chips' | 'zones' | 'map' | 'cal' | 'read' | 'dur';
export interface PanelDef {
  k: Panel;
  name: string;
  key: string;
  tip: string;
  part?: boolean;
}
/** In menu order; key is its keyboard toggle. part: a part of another panel (it is not a panel of its own). */
export const PANELS: PanelDef[] = [
  { k: 'start', name: '開始', key: '1', tip: '開始的時刻、時區與快捷' },
  { k: 'span', name: '間隔', key: '2', tip: '中間的間隔或倒數' },
  { k: 'end', name: '結束', key: '3', tip: '結束的時刻、時區與快捷' },
  { k: 'zones', name: '時區', key: '4', tip: '各地時刻與 24 小時條' },
  { k: 'cal', name: '月曆', key: '5', tip: '月曆或年曆' },
  { k: 'read', name: '讀法', key: '6', tip: 'ISO、Unix、民國等各種寫法' },
  { k: 'dur', name: '時長', key: '7', tip: '時長計算機（隱藏時從間隔的計算機按鈕打開）' },
  { k: 'top', name: '頂列', key: '8', tip: '輸入框與右上的按鈕（隱藏時角落有一個小按鈕）', part: true },
  { k: 'chips', name: '快捷', key: '9', tip: '開始、間隔、結束下面的快捷列', part: true },
  { k: 'rail', name: '刻度軌', key: 'r', tip: '方程式下方的進度軌與拖曳把手', part: true },
  { k: 'map', name: '世界地圖', key: 'm', tip: '時區裡的晝夜地圖（有空間才顯示）', part: true },
];
/** The panels that hold something by themselves; at least one of them stays. */
export const MAIN_PANELS: Panel[] = ['start', 'span', 'end', 'zones', 'cal', 'read', 'dur'];
export type CalMode = 'month' | 'year';
export interface ViewPreset {
  k: string;
  name: string;
  show: Panel[];
  cal?: CalMode;
  tip: string;
}
export const VIEW_PRESETS: ViewPreset[] = [
  { k: 'all', name: '全部', show: PANELS.map((p) => p.k), tip: '每個面板都顯示' },
  { k: 'countdown', name: '滿版倒數', show: ['span', 'rail'], tip: '只留間隔：整個畫面就是倒數或已過的時間' },
  {
    k: 'eq',
    name: '方程式',
    show: ['top', 'start', 'span', 'end', 'rail', 'chips'],
    tip: '只留開始 + 間隔 = 結束，放到最大',
  },
  { k: 'month', name: '滿版月曆', show: ['cal'], cal: 'month', tip: '只留月曆' },
  { k: 'year', name: '滿版年曆', show: ['cal'], cal: 'year', tip: '只留年曆：整年 12 個月' },
  { k: 'zones', name: '時區看板', show: ['zones', 'map'], tip: '只留時區與世界地圖' },
];

export const ZMAX = 8;
const STORE_KEY = 'time-calculator:v2';

export const now = ref(Date.now());

export const S = reactive({
  startTz: LOCAL_TZ,
  start: partsInTz(Date.now(), LOCAL_TZ) as Wall,
  /** The start follows the clock. */
  live: true,
  end: null as Wall | null,
  endTz: LOCAL_TZ,
  /** The end follows the clock. */
  endLive: false,
  endSample: false,
  /** The rules the ends were set by, if any. */
  rules: { start: null as EndRule | null, end: null as EndRule | null },
  /** The span that ties the ends together, if any. */
  link: null as Link | null,
  /** Which end the span computes: 'end' = start + span, 'start' = end − span. */
  linkTo: 'end' as End,
  zones: [] as string[],
  active: 'start' as End,
  theme: 'system' as Theme,
  lens: 'zones' as Lens,
  readEnd: 'start' as End,
  /** The order of the readings (keys of the formats); formats not listed follow in their usual order. */
  readOrder: [] as string[],
  density: 100,
  map: true,
  /** The panels put away (the world map is S.map). */
  hidden: [] as Panel[],
  /** The calendar shows a month, or the whole year. */
  calMode: 'month' as CalMode,
  dur: DUR_SAMPLE,
  durSample: true,
  /** The shortcut rows, each a list of rules. */
  chips: JSON.parse(JSON.stringify(DEFAULT_CHIPS)) as Record<ChipRow, Chip[]>,
  /** The user's own words, and the built-in words they removed. */
  words: [] as MyWord[],
  wordsOff: [] as string[],
  prefs: { ...DEFAULT_APP_PREFS } as AppPrefs,
});

/* ---------- the vocabulary and the general settings, for every rule ---------- */
/** Changes when a word or a setting changes, so every rule is read again. */
export const ruleTick = ref(0);
watch(
  () => [S.words, S.wordsOff],
  () => {
    setVocab(S.words, S.wordsOff);
    ruleTick.value++;
  },
  { deep: true, immediate: true },
);
watch(
  () => S.prefs,
  () => {
    setRulePrefs(S.prefs);
    ruleTick.value++;
  },
  { deep: true, immediate: true },
);

/* ---------- derived ---------- */
export const other = (which: End): End => (which === 'start' ? 'end' : 'start');
/** This end follows the clock. */
export const isLive = (which: End) => (which === 'start' ? S.live : S.endLive);
/** This end is computed from the other one and the span. */
export const isLinked = (which: End) => !!S.link && S.linkTo === which;
/** This end keeps following a rule. */
export const isFollowing = (which: End) => !!S.rules[which]?.follow;
/** This end is computed (by the span, or by the rule it follows), not held by itself. */
export const isDerived = (which: End) => isLinked(which) || isFollowing(which);
/** The end a span would compute: the one not held at now (the start when only the end follows the clock). */
export const linkTarget = (): End => (S.link ? S.linkTo : S.endLive && !S.live ? 'start' : 'end');

interface Point {
  wall: Wall;
  ms: number;
  note: WallNote;
}
const NONE = { wall: null, ms: null, note: null as WallNote };
const followRule = (which: End): Rule | null => (S.rules[which]?.follow ? decodeRule(S.rules[which]!.code) : null);
/** The end follows a rule that reads the other end. */
const readsOther = (which: End) => {
  const r = followRule(which);
  return !!r && ruleReads(r, which, wordRule).has(other(which));
};
/** Read a rule for this end, now. */
export function runRule(rule: Rule, which: End, otherMs?: number | null): RuleResult {
  void ruleTick.value;
  const o = other(which);
  const om = otherMs !== undefined ? otherMs : msOf(o);
  return evalRule(rule, {
    now: now.value,
    tz: tzOf(which),
    self: which,
    ends: { [which]: msOf(which), [o]: om },
    prefs: S.prefs,
    word: wordRule,
  });
}
const fromRule = (which: End, otherMs: number | null): Point | null => {
  const r = followRule(which);
  if (!r) return null;
  void ruleTick.value;
  const o = other(which);
  const res = evalRule(r, {
    now: Math.floor(now.value / 1000) * 1000,
    tz: tzOf(which),
    self: which,
    ends: { [o]: otherMs },
    prefs: S.prefs,
    word: wordRule,
  });
  return res.ok ? { wall: partsInTz(res.ms, tzOf(which)), ms: res.ms, note: null } : null;
};
const own = (which: End): Point | null => {
  const tz = which === 'start' ? S.startTz : S.endTz;
  // whole seconds, like every other moment here, so a span from now never gains or loses a fraction of a second
  if (isLive(which)) {
    const ms = Math.floor(now.value / 1000) * 1000;
    return { wall: partsInTz(ms, tz), ms, note: null };
  }
  if (isFollowing(which) && !readsOther(which)) {
    const p = fromRule(which, null);
    if (p) return p;
  }
  const w = which === 'start' ? S.start : S.end;
  if (!w) return null;
  const r = wallToInstant(w, tz);
  return { wall: w, ms: r.ms, note: r.note };
};
const RANGE_ERR = '超出可計算範圍（西元 1–9999 年）';
/** `fromMs` moved by the span (dir −1: back), read on the wall clock of `toTz`; null when it leaves years 1–9999. */
function project(fromMs: number, fromTz: string, sp: Span, dir: 1 | -1, toTz: string): Point | null {
  const r = addDuration(fromMs, fromTz, sp, (dir * sp.sign) as 1 | -1, sp.biz);
  if (!Number.isFinite(r.ms)) return null;
  const w = partsInTz(r.ms, toTz);
  return validWall(w) ? { wall: w, ms: r.ms, note: null } : null;
}
const ends = computed<{ s: Point; e: Point | typeof NONE; err: string | null }>(() => {
  const sp = S.link?.span;
  // an end that follows a rule reading the other end comes after it
  if (isFollowing('start') && readsOther('start') && !isLinked('start')) {
    const e = own('end');
    const s = fromRule('start', e ? e.ms : null) || own('start')!;
    if (sp && S.linkTo === 'end') {
      const pe = project(s.ms, S.startTz, sp, 1, S.endTz);
      return { s, e: pe || NONE, err: pe ? null : RANGE_ERR };
    }
    return { s, e: e || NONE, err: null };
  }
  const s = own('start')!;
  // (a link to the start needs a held end, so an end following a rule has no link to think of)
  if (isFollowing('end') && readsOther('end') && !isLinked('end'))
    return { s, e: fromRule('end', s.ms) || own('end') || NONE, err: null };
  if (sp && S.linkTo === 'end') {
    const pe = project(s.ms, S.startTz, sp, 1, S.endTz);
    return { s, e: pe || NONE, err: pe ? null : RANGE_ERR };
  }
  const e = own('end');
  if (sp && e) {
    const ps = project(e.ms, S.endTz, sp, -1, S.startTz);
    return { s: ps || s, e, err: ps ? null : RANGE_ERR };
  }
  return { s, e: e || NONE, err: null };
});
export const startWall = computed<Wall>(() => ends.value.s.wall);
export const startMs = computed(() => ends.value.s.ms);
export const startNote = computed<WallNote>(() => ends.value.s.note);
export const endWall = computed(() => ends.value.e.wall);
export const endMs = computed(() => ends.value.e.ms);
export const endNote = computed(() => ends.value.e.note);
export const linkErr = computed(() => ends.value.err);
export const hasEnd = computed(() => endMs.value != null);

export const wallOf = (which: End) => (which === 'start' ? startWall.value : endWall.value);
export const msOf = (which: End) => (which === 'start' ? startMs.value : endMs.value);
export const tzOf = (which: End) => (which === 'start' ? S.startTz : S.endTz);

/** Whole-second gap end − start. */
export const gapSec = computed(() => (endMs.value == null ? null : Math.round((endMs.value - startMs.value) / 1000)));
export const calGap = computed(() => {
  if (endMs.value == null) return null;
  const lo = Math.min(startMs.value, endMs.value),
    hi = Math.max(startMs.value, endMs.value);
  return { ...diffCalendar(lo, hi, S.startTz), sign: (endMs.value < startMs.value ? -1 : 1) as 1 | -1 };
});

/* ---------- toasts (also the screen reader's announcements) ---------- */
export interface ToastMsg {
  id: number;
  text: string;
  undo?: () => void;
}
export const toastState = reactive({ cur: null as ToastMsg | null });
let toastId = 0,
  toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(text: string, undo?: () => void) {
  toastState.cur = { id: ++toastId, text, undo };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(
    () => {
      toastState.cur = null;
    },
    undo ? 5200 : 2200,
  );
}
export function toastClose() {
  clearTimeout(toastTimer);
  toastState.cur = null;
}

/* ---------- history: many levels of undo and redo ---------- */
interface Snap {
  start: Wall;
  live: boolean;
  startTz: string;
  end: Wall | null;
  endLive: boolean;
  endTz: string;
  link: string | null;
  linkTo: End;
  rules: { start: EndRule | null; end: EndRule | null };
  endSample: boolean;
  zones: string[];
  readOrder: string[];
  chips: Record<ChipRow, Chip[]>;
  words: MyWord[];
  wordsOff: string[];
}
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const snap = (): Snap => ({
  start: { ...startWall.value },
  live: S.live,
  startTz: S.startTz,
  end: S.end ? { ...S.end } : null,
  endLive: S.endLive,
  endTz: S.endTz,
  link: S.link ? S.link.expr : null,
  linkTo: S.linkTo,
  rules: clone(S.rules),
  endSample: S.endSample,
  zones: [...S.zones],
  readOrder: [...S.readOrder],
  chips: clone(S.chips),
  words: clone(S.words),
  wordsOff: [...S.wordsOff],
});
/** What a snapshot means: a moment that follows the clock or is computed is not part of it. */
const meaning = (a: Snap) =>
  JSON.stringify({
    ...a,
    start: a.live || (a.link && a.linkTo === 'start') || a.rules.start?.follow ? null : a.start,
    end: a.endLive || (a.link && a.linkTo === 'end') || a.rules.end?.follow ? null : a.end,
    linkTo: a.link ? a.linkTo : null,
    rules: {
      start: a.rules.start && { ...a.rules.start, from: null },
      end: a.rules.end && { ...a.rules.end, from: null },
    },
  });
const sameSnap = (a: Snap, b: Snap) => meaning(a) === meaning(b);
function restoreSnap(o: Snap) {
  S.startTz = o.startTz;
  S.live = o.live;
  S.start = o.start;
  S.endTz = o.endTz;
  S.end = o.end;
  S.endLive = o.endLive;
  S.link = o.link ? mkLink(o.link) : null;
  S.linkTo = o.linkTo;
  S.rules = clone(o.rules);
  S.endSample = o.endSample;
  S.zones = [...o.zones];
  S.readOrder = [...o.readOrder];
  S.chips = clone(o.chips);
  S.words = clone(o.words);
  S.wordsOff = [...o.wordsOff];
}
export const history = reactive({ undo: [] as { s: Snap; label: string }[], redo: [] as { s: Snap; label: string }[] });
let coalesceKey = '',
  coalesceAt = 0;

/**
 * Run a change as one undoable step. `key` merges rapid repeats (typing, dragging) into one step.
 * `say` shows a toast with an undo button.
 */
export function commit(
  fn: () => boolean | void,
  opts: { label?: string; key?: string; hold?: boolean; say?: string | (() => string) } = {},
): boolean {
  const before = snap();
  if (fn() === false) return false;
  const after = snap();
  if (sameSnap(before, after)) return true;
  const t = Date.now();
  if (opts.key && opts.key === coalesceKey && (opts.hold || t - coalesceAt < 1200) && history.undo.length) {
    coalesceAt = t;
    if (opts.label) history.undo[history.undo.length - 1].label = opts.label;
  } else {
    history.undo.push({ s: before, label: opts.label || '' });
    if (history.undo.length > 100) history.undo.shift();
    coalesceKey = opts.key || '';
    coalesceAt = t;
  }
  history.redo.length = 0;
  if (opts.say) toast(typeof opts.say === 'function' ? opts.say() : opts.say, undo);
  return true;
}
export function undo() {
  const e = history.undo.pop();
  if (!e) return;
  history.redo.push({ s: snap(), label: e.label });
  restoreSnap(e.s);
  coalesceKey = '';
  toast(e.label ? `已復原：${e.label}` : '已復原');
}
/** A point in history to go back to without leaving a redo step (Esc while editing). */
export const historyMark = () => history.undo.length;
export function rollback(mark: number) {
  if (history.undo.length <= mark) return;
  const e = history.undo[mark];
  history.undo.length = mark;
  restoreSnap(e.s);
  coalesceKey = '';
}
export function breakCoalesce() {
  coalesceKey = '';
}
export function redo() {
  const e = history.redo.pop();
  if (!e) return;
  history.undo.push({ s: snap(), label: e.label });
  restoreSnap(e.s);
  coalesceKey = '';
  toast(e.label ? `已重做：${e.label}` : '已重做');
}

/* ---------- panels: shown or put away (a display setting, so outside the undo history; the toast takes it back) ---------- */
export const shown = (k: Panel) => (k === 'map' ? S.map : !S.hidden.includes(k));
export interface ViewSnap {
  hidden: Panel[];
  map: boolean;
  cal: CalMode;
}
export const viewSnap = (): ViewSnap => ({ hidden: [...S.hidden], map: S.map, cal: S.calMode });
export function restoreView(v: ViewSnap) {
  S.hidden = [...v.hidden];
  S.map = v.map;
  S.calMode = v.cal;
}
const panelDef = (k: Panel) => PANELS.find((p) => p.k === k)!;
/** Show or put away one panel. The last panel that holds something stays. */
export function setShown(k: Panel, on: boolean): boolean {
  if (shown(k) === on) return true;
  if (!on && MAIN_PANELS.includes(k) && !MAIN_PANELS.some((p) => p !== k && shown(p))) {
    toast('至少要留一個面板');
    return false;
  }
  if (k === 'map') S.map = on;
  else S.hidden = on ? S.hidden.filter((x) => x !== k) : [...S.hidden, k];
  return true;
}
export function togglePanel(k: Panel) {
  const before = viewSnap();
  const on = !shown(k);
  if (!setShown(k, on)) return;
  const d = panelDef(k);
  toast(on ? `顯示「${d.name}」` : `已隱藏「${d.name}」，按 ${d.key.toUpperCase()} 再顯示`, () => restoreView(before));
}
/** The panels a preset puts away. The world map is only touched when the preset shows the zones. */
function presetHidden(p: ViewPreset): Panel[] {
  return PANELS.map((x) => x.k).filter((k) => k !== 'map' && !p.show.includes(k));
}
export function presetNow(): ViewPreset | null {
  const h = [...S.hidden].sort().join();
  return (
    VIEW_PRESETS.find(
      (p) =>
        presetHidden(p).sort().join() === h &&
        (!p.cal || p.cal === S.calMode) &&
        (!p.show.includes('zones') || S.map === p.show.includes('map')),
    ) || null
  );
}
export function applyPreset(p: ViewPreset, quiet = false) {
  const before = viewSnap();
  S.hidden = presetHidden(p);
  if (p.show.includes('zones')) S.map = p.show.includes('map');
  if (p.cal) S.calMode = p.cal;
  if (!quiet) toast(p.k === 'all' ? '全部顯示' : `${p.name}：按 0 全部顯示，P 換下一種`, () => restoreView(before));
}
/** Show exactly these panels (a link's v=). The world map is only touched when the zones are among them.
    Nothing changes when none of them holds anything. */
export function showOnly(list: Panel[]): boolean {
  if (!MAIN_PANELS.some((k) => list.includes(k))) return false;
  S.hidden = PANELS.map((p) => p.k).filter((k) => k !== 'map' && !list.includes(k));
  if (list.includes('zones')) S.map = list.includes('map');
  return true;
}
/** The panels shown, as a link writes them: the world map counts only with the zones. */
export const shownList = (): Panel[] =>
  PANELS.map((p) => p.k).filter((k) => (k === 'map' ? S.map && shown('zones') : shown(k)));
/** P: the next preset (Shift+P the one before). */
export function cyclePreset(dir = 1) {
  const cur = presetNow();
  const i = cur ? VIEW_PRESETS.indexOf(cur) : dir > 0 ? -1 : 0;
  applyPreset(VIEW_PRESETS[(i + dir + VIEW_PRESETS.length) % VIEW_PRESETS.length]);
}

/* ---------- attention: a panel glows briefly where a change landed ---------- */
export const pulse = reactive({ start: 0, end: 0, span: 0, zones: 0 });
export function bump(k: keyof typeof pulse) {
  pulse[k]++;
}

/* ---------- mutations ---------- */
/** An end that follows a rule reading `which` stops following it (it stays where it is): `which` is about to depend on it. */
function unhookFrom(which: End) {
  const o = other(which);
  if (isFollowing(o) && readsOther(o)) {
    pinRule(o);
  }
}
/** The end keeps the moment its rule gives now; the rule stays as its name. */
function pinRule(which: End) {
  const r = S.rules[which];
  if (!r?.follow) return;
  const w = wallOf(which);
  if (w) {
    if (which === 'start') S.start = { ...w };
    else S.end = { ...w };
  }
  S.rules[which] = { ...r, follow: false };
}
/** Puts this end at a moment. If the span was computing this end, it stops; if it computes the other end, that one follows. */
export function setWall(which: End, w: Wall): boolean {
  if (!validWall(w)) {
    toast(RANGE_ERR);
    return false;
  }
  if (isLinked(which)) S.link = null;
  S.rules[which] = null;
  if (which === 'start') {
    S.start = { ...w };
    S.live = false;
  } else {
    S.end = { ...w };
    S.endLive = false;
    S.endSample = false;
  }
  return true;
}
export function setInstant(which: End, ms: number): boolean {
  if (!Number.isFinite(ms)) {
    toast(RANGE_ERR);
    return false;
  }
  return setWall(which, partsInTz(ms, tzOf(which)));
}
/** This end follows the clock (on), or stays at the second it shows now (off). */
export function setLive(which: End, on: boolean) {
  if (on) {
    if (isLinked(which)) S.link = null;
    S.rules[which] = null;
    if (which === 'start') S.live = true;
    else {
      S.endLive = true;
      S.endSample = false;
    }
    return;
  }
  if (!isLive(which)) return;
  if (which === 'start') {
    S.start = { ...startWall.value };
    S.live = false;
  } else {
    S.end = { ...endWall.value! };
    S.endLive = false;
  }
}
/** Keeps the instant; the end follows when it shared the start's zone. */
export function setStartTz(id: string, keepInstant = true) {
  const prev = S.startTz;
  const follow = sameZone(S.endTz, prev) || !hasEnd.value;
  const sMs = startMs.value,
    eMs = endMs.value;
  if (keepInstant && !S.live && !isDerived('start')) S.start = partsInTz(sMs, id);
  S.startTz = id;
  if (follow) {
    if (keepInstant && S.end && !S.endLive && !isDerived('end') && eMs != null) S.end = partsInTz(eMs, id);
    if (!sameZone(S.endTz, id)) S.endSample = false;
    S.endTz = id;
  }
  if (!S.zones.some((z) => sameZone(z, prev))) S.zones.unshift(prev);
  trimZones();
}
export function setEndTz(id: string) {
  const prev = S.endTz;
  if (S.end && !S.endLive && !isDerived('end') && endMs.value != null) S.end = partsInTz(endMs.value, id);
  if (!sameZone(prev, id)) S.endSample = false;
  S.endTz = id;
  if (!S.zones.some((z) => sameZone(z, prev))) S.zones.unshift(prev);
  trimZones();
}
export function setTz(which: End, id: string) {
  if (which === 'start') setStartTz(id);
  else setEndTz(id);
}

export function mkLink(text: string): Link | null {
  const r = interpretSpanText(text);
  return r.kind === 'span' ? { expr: fmtSpan(r.span), span: r.span } : null;
}
const SUBJ_NAME = { start: '開始', end: '結束' } as const;
/** The span as the computed end sees it: +30天 from the start is −30天 from the end. */
export const negExpr = (expr: string) =>
  expr.startsWith('−') ? '+' + expr.slice(1) : expr.startsWith('+') ? '−' + expr.slice(1) : '−' + expr;
/** "結束 = 開始 +30天" or "開始 = 結束 −30天". */
export function linkSentence(to: End = S.linkTo, expr = S.link?.expr || ''): string {
  return to === 'end' ? `結束 = 開始 ${expr}` : `開始 = 結束 ${negExpr(expr)}`;
}
/** What happens when the other end moves. */
export const followText = (to: End = S.linkTo) => `${SUBJ_NAME[other(to)]}改了，${SUBJ_NAME[to]}跟著動`;
/** Where `to` would land with this span (end = start + span, or start = end − span). */
export function checkSpan(
  sp: Span,
  to: End = linkTarget(),
): { ok: true; ms: number; w: Wall } | { ok: false; err: string } {
  const from = other(to),
    fromMs = msOf(from);
  if (fromMs == null) return { ok: false, err: '先設定結束，開始才能從結束往回算' };
  const p = project(fromMs, tzOf(from), sp, to === 'end' ? 1 : -1, tzOf(to));
  return p ? { ok: true, ms: p.ms, w: p.wall } : { ok: false, err: RANGE_ERR };
}
export function setLink(sp: Span, to: End = linkTarget()): boolean {
  const c = checkSpan(sp, to);
  if (!c.ok) {
    toast(c.err);
    return false;
  }
  unhookFrom(to);
  S.link = { expr: fmtSpan(sp), span: { ...sp } };
  S.linkTo = to;
  S.rules[to] = null;
  if (to === 'end') {
    S.endLive = false;
    S.endSample = false;
  } else S.live = false;
  return true;
}
/** The end the span was computing stays where it is right now; the span no longer ties them. */
export function freezeLink(): boolean {
  if (!S.link) return false;
  const which = S.linkTo,
    w = wallOf(which);
  if (!w) return false;
  if (which === 'end') {
    S.end = { ...w };
    S.endLive = false;
  } else {
    S.start = { ...w };
    S.live = false;
  }
  S.link = null;
  return true;
}
/** Keep the current gap: the end not held at now follows the other. */
export function linkFromMeasured(to: End = linkTarget()): boolean {
  if (endMs.value == null) return false;
  return setLink(spanBetween(startMs.value, endMs.value, to === 'end' ? S.startTz : S.endTz), to);
}
export function clearEnd() {
  if (isLinked('start')) freezeLink();
  unhookFrom('end');
  S.end = null;
  S.endLive = false;
  S.link = null;
  S.endSample = false;
  S.rules.end = null;
  S.active = 'start';
}
/** A rule's starting point at the other end, after the ends trade places. */
function swapRule(r: EndRule | null): EndRule | null {
  if (!r) return null;
  const x = decodeRule(r.code);
  if (!x) return null;
  if (x.o.t === 'start') x.o = { t: 'end' };
  else if (x.o.t === 'end') x.o = { t: 'start' };
  return { ...r, code: encodeRule(x) };
}
/** Start and end trade places: moments, zones, which one follows the clock, and which one the span computes. */
export function swapEnds(): boolean {
  if (!endWall.value) return false;
  const s = { ...startWall.value },
    sTz = S.startTz,
    sLive = S.live,
    e = { ...endWall.value },
    eTz = S.endTz,
    eLive = S.endLive;
  S.start = e;
  S.startTz = eTz;
  S.live = eLive;
  S.end = s;
  S.endTz = sTz;
  S.endLive = sLive;
  const rs = S.rules.start,
    re = S.rules.end;
  S.rules = { start: swapRule(re), end: swapRule(rs) };
  if (S.link) {
    const sp = { ...S.link.span, sign: -S.link.span.sign as 1 | -1 };
    S.link = { expr: fmtSpan(sp), span: sp };
    S.linkTo = other(S.linkTo);
  }
  S.endSample = false;
  return true;
}

/* ---------- rules: what shortcuts, words and typed text set an end by ---------- */
/**
 * Set an end by a rule. 現在 makes the end follow the clock; the other end plus a length (+30天) becomes the link;
 * any other rule puts the end where it lands now, and the end keeps following it when `follow` (by default: when the
 * rule reads the other end, or when the settings say rules from now keep following).
 */
export function applyRule(which: End, rule: Rule, opts: { name?: string; follow?: boolean } = {}): boolean {
  if (isNowRule(rule)) {
    setLive(which, true);
    return true;
  }
  const reads = ruleReads(rule, which, wordRule);
  if (reads.has(which)) {
    toast(`${SUBJ_NAME[which]}不能從自己算起，這個規則要放在${SUBJ_NAME[other(which)]}`);
    return false;
  }
  const sp = spanOfRule(rule, which);
  if (sp && opts.follow !== false) {
    // the link counts from the start to the end: start = end − span is kept as the span the other way
    return setLink(which === 'end' ? sp : { ...sp, sign: -sp.sign as 1 | -1 }, which);
  }
  if (reads.has(other(which)) && msOf(other(which)) == null) {
    toast(which === 'start' ? '先設定結束，才能從結束算' : '先設定開始');
    return false;
  }
  const res = runRule(rule, which);
  if (!res.ok) {
    toast(res.err);
    return false;
  }
  const follow = opts.follow ?? (reads.size > 0 || S.prefs.followNow);
  if (follow && reads.has(other(which))) {
    if (isLinked(other(which))) freezeLink();
    unhookFrom(which);
  }
  if (!setInstant(which, res.ms)) return false;
  S.rules[which] = { code: encodeRule(rule), name: opts.name || ruleName(rule, S.prefs), follow, from: res.from };
  return true;
}
/** Keep following the rule this end was set by, or stay where it is now. */
export function setFollow(which: End, on: boolean): boolean {
  const r = S.rules[which];
  if (!r || r.follow === on) return false;
  if (!on) {
    pinRule(which);
    return true;
  }
  const rule = decodeRule(r.code);
  return !!rule && applyRule(which, rule, { name: r.name, follow: true });
}
export const chipRule = (c: Chip) => decodeRule(c.code);
export const chipName = (c: Chip) => {
  const r = chipRule(c);
  return c.name || (r ? ruleName(r, S.prefs) : '?');
};
/** The end a span shortcut sets: the one the span computes. */
export const chipTarget = (row: ChipRow): End => (row === 'span' ? linkTarget() : row);
/** The chip is what the end is now. */
export function chipOn(row: ChipRow, c: Chip): boolean {
  const r = chipRule(c);
  if (!r) return false;
  const which = chipTarget(row);
  if (isNowRule(r)) return isLive(which);
  const sp = spanOfRule(r, which);
  if (sp)
    return (
      isLinked(which) &&
      !!S.link &&
      S.link.expr === fmtSpan(which === 'end' ? sp : { ...sp, sign: -sp.sign as 1 | -1 }) &&
      S.link.span.biz === sp.biz
    );
  return S.rules[which]?.code === c.code;
}
/** How far now is through the period the chip ends (月底: through this month), for the chip to fill like a bar. */
export function chipProgress(row: ChipRow, c: Chip): number | null {
  const r = chipRule(c);
  if (!r || row === 'span' || isNowRule(r)) return null;
  const res = runRule(r, chipTarget(row));
  if (!res.ok || res.from == null || res.ms <= res.from) return null;
  const f = (now.value - res.from) / (res.ms - res.from);
  return f >= 0 && f <= 1 ? f : null;
}
export function applyChip(row: ChipRow, c: Chip): boolean {
  const r = chipRule(c);
  if (!r) {
    toast('這個快捷壞掉了，請重新設定');
    return false;
  }
  return applyRule(chipTarget(row), r, { name: chipName(c) });
}

/* ---------- progress from start to end (the rail under the span) ---------- */
/** With a live start and an end set by a rule with a period (本月結束, 跨年, 中秋 …): how far through that period now is. */
export const presetProgress = computed(() => {
  const r = S.rules.end;
  if (!S.live || !r || r.from == null || S.link || endMs.value == null) return null;
  const f = (now.value - r.from) / (endMs.value - r.from);
  return f >= 0 && f <= 1 ? f : null;
});
/** The fill of the rail (0–1) and where now sits on it (null when now is outside start–end). */
export const railProgress = computed<{ f: number; now: number | null }>(() => {
  if (presetProgress.value != null) return { f: presetProgress.value, now: presetProgress.value };
  const sMs = startMs.value,
    eMs = endMs.value;
  if (eMs == null || S.live || S.endLive || eMs <= sMs) return { f: 0, now: null };
  const f = Math.min(1, Math.max(0, (now.value - sMs) / (eMs - sMs)));
  return { f, now: now.value >= sMs && now.value <= eMs ? f : null };
});

/* ---------- zones ---------- */
/** The rows in the order they were put in (dragged into); the start's and the end's zones are always among them. */
export const zoneRows = computed(() => {
  const list: string[] = [];
  for (const z of S.zones) if (!list.some((x) => sameZone(x, z))) list.push(z);
  if (!list.some((x) => sameZone(x, S.startTz))) list.unshift(S.startTz);
  if (!list.some((x) => sameZone(x, S.endTz)))
    list.splice(list.findIndex((x) => sameZone(x, S.startTz)) + 1, 0, S.endTz);
  // too many: drop from the bottom, but never the start's or the end's zone
  while (list.length > ZMAX) {
    let i = list.length - 1;
    while (i >= 0 && (sameZone(list[i], S.startTz) || sameZone(list[i], S.endTz))) i--;
    list.splice(i, 1);
  }
  return list;
});
/** Put the rows in this order. */
export function orderZones(ids: string[]) {
  S.zones = [...ids];
}
function trimZones() {
  if (S.zones.length > ZMAX) S.zones.length = ZMAX;
}
export function addZoneRow(id: string): boolean {
  if (zoneRows.value.some((z) => sameZone(z, id))) {
    toast(`${zoneName(id)}已經在列表中`);
    return false;
  }
  if (zoneRows.value.length >= ZMAX) {
    toast(`最多 ${ZMAX} 個時區，請先移除一個`);
    return false;
  }
  S.zones.push(id);
  return true;
}
export function removeZoneRow(id: string) {
  S.zones = S.zones.filter((z) => !sameZone(z, id));
}

/* ---------- persistence ---------- */
export function defaultZones(): string[] {
  const list = [
    'Asia/Taipei',
    'Asia/Tokyo',
    'Europe/London',
    'America/New_York',
    'America/Los_Angeles',
    'Australia/Sydney',
  ];
  return list.filter((id) => isValidTz(id) && !sameZone(id, LOCAL_TZ));
}
export function loadState(): boolean {
  S.zones = defaultZones();
  let o: Record<string, unknown> | null = null;
  try {
    o = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
  } catch {
    o = null;
  }
  if (!o || o.v !== 2) return false;
  const W = (w: unknown): Wall | null => {
    if (!w || typeof w !== 'object') return null;
    const x = w as Record<string, unknown>;
    const r = {
      y: +(x.y as number),
      mo: +(x.mo as number),
      d: +(x.d as number),
      h: +(x.h as number),
      mi: +(x.mi as number),
      s: +(x.s as number),
    };
    return validWall(r) ? r : null;
  };
  if (isValidTz(o.startTz)) S.startTz = o.startTz as string;
  if (isValidTz(o.endTz)) S.endTz = o.endTz as string;
  const st = W(o.start);
  if (o.live === false && st) {
    S.live = false;
    S.start = st;
  }
  const en = W(o.end);
  if (en) {
    S.end = en;
    S.endSample = !!o.endSample;
  }
  const rules = (o.rules || {}) as Record<string, unknown>;
  for (const k of ['start', 'end'] as End[]) S.rules[k] = readEndRule(rules[k]);
  // the first version kept a period key for the end
  if (!S.rules.end && typeof o.endPreset === 'string' && OLD_PRESETS[o.endPreset])
    S.rules.end = { ...OLD_PRESETS[o.endPreset], follow: false, from: null };
  if (o.endLive === true) {
    S.endLive = true;
    S.endSample = false;
    S.rules.end = null;
  }
  if (o.chips && typeof o.chips === 'object') {
    for (const row of ['start', 'end', 'span'] as ChipRow[]) {
      const list = (o.chips as Record<string, unknown>)[row];
      if (Array.isArray(list))
        S.chips[row] = list
          .filter((c): c is Chip => !!c && typeof c.code === 'string' && !!decodeRule(c.code))
          .slice(0, CHIP_MAX)
          .map((c) => ({
            code: c.code,
            ...(typeof c.name === 'string' && c.name ? { name: c.name.slice(0, 40) } : {}),
          }));
    }
  }
  if (Array.isArray(o.words))
    S.words = (o.words as unknown[])
      .filter(
        (w): w is MyWord =>
          !!w &&
          typeof (w as MyWord).name === 'string' &&
          typeof (w as MyWord).code === 'string' &&
          !!decodeRule((w as MyWord).code),
      )
      .slice(0, 200);
  if (Array.isArray(o.wordsOff))
    S.wordsOff = (o.wordsOff as unknown[]).filter((w): w is string => typeof w === 'string').slice(0, 200);
  if (o.prefs && typeof o.prefs === 'object') {
    const pr = o.prefs as Record<string, unknown>;
    S.prefs = {
      weekStart: pr.weekStart === 0 ? 0 : 1,
      termTz: pr.termTz === 'local' ? 'local' : 'china',
      missing: pr.missing === 'error' ? 'error' : 'clamp',
      dayResets: pr.dayResets !== false,
      followNow: pr.followNow === true,
      lunar: pr.lunar !== false,
    };
  }
  if (typeof o.link === 'string') S.link = mkLink(o.link);
  S.linkTo = o.linkTo === 'start' && S.link && (S.endLive || S.end) ? 'start' : 'end';
  if (S.link && S.linkTo === 'end') S.endLive = false;
  if (Array.isArray(o.zones)) S.zones = (o.zones as unknown[]).filter((z): z is string => isValidTz(z)).slice(0, ZMAX);
  if (o.theme === 'light' || o.theme === 'dark' || o.theme === 'system') S.theme = o.theme;
  if (o.lens === 'zones' || o.lens === 'cal' || o.lens === 'read' || o.lens === 'dur') S.lens = o.lens;
  if (o.readEnd === 'end') S.readEnd = 'end';
  const order = Array.isArray(o.readOrder) ? o.readOrder : o.readPins; // readPins: the pinned formats of the first version
  if (Array.isArray(order))
    S.readOrder = (order as unknown[]).filter((k): k is string => typeof k === 'string').slice(0, 40);
  if (typeof o.density === 'number' && DENSITY.some((d) => d.v === o.density)) S.density = o.density;
  if (typeof o.map === 'boolean') S.map = o.map;
  if (Array.isArray(o.hidden)) {
    const keys = PANELS.map((p) => p.k);
    S.hidden = [
      ...new Set((o.hidden as unknown[]).filter((k): k is Panel => keys.includes(k as Panel) && k !== 'map')),
    ];
    if (!MAIN_PANELS.some((k) => !S.hidden.includes(k))) S.hidden = [];
  }
  if (o.calMode === 'year') S.calMode = 'year';
  if (typeof o.dur === 'string' && o.dur.length <= 400) {
    S.dur = o.dur;
    S.durSample = !!o.durSample;
  }
  return true;
}
/** What this device keeps (read back by loadState). Watched as is, so a field listed here is also saved when it changes. */
const persisted = () => ({
  v: 2,
  startTz: S.startTz,
  endTz: S.endTz,
  live: S.live,
  start: S.live ? null : S.start,
  end: S.end,
  endLive: S.endLive,
  endSample: S.endSample,
  rules: S.rules,
  link: S.link ? S.link.expr : null,
  linkTo: S.linkTo,
  zones: S.zones,
  theme: S.theme,
  lens: S.lens,
  readEnd: S.readEnd,
  readOrder: S.readOrder,
  density: S.density,
  map: S.map,
  hidden: S.hidden,
  calMode: S.calMode,
  dur: S.dur,
  durSample: S.durSample,
  chips: S.chips,
  words: S.words,
  wordsOff: S.wordsOff,
  prefs: S.prefs,
});
let saveTimer: ReturnType<typeof setTimeout> | undefined;
export function startPersisting() {
  watch(
    persisted,
    () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        try {
          localStorage.setItem(STORE_KEY, JSON.stringify(persisted()));
        } catch {
          /* storage unavailable: everything still works for this visit */
        }
      }, 300);
    },
    { deep: true },
  );
}
/** First visit: a sample end (New Year) so every lens has something to show. Marked as a sample. */
export function seedSample() {
  if (S.link || S.end || S.endLive) return;
  if (applyRule('end', { o: { t: 'now' }, steps: [{ t: 'align', p: 'y', pos: 'end' }] }, { follow: false }))
    S.endSample = true;
}
/** Old saved states and links named the end by one of five periods. */
export const OLD_PRESETS: Record<string, { code: string; name: string }> = {
  day: { code: 'n/ad.end', name: '今天結束' },
  week: { code: 'n/aw.end', name: '本週結束' },
  month: { code: 'n/amo.end', name: '本月結束' },
  newyear: { code: 'n/ay.end', name: '跨年' },
  lny: { code: 'n/w%E6%98%A5%E7%AF%80', name: '春節' },
};
function readEndRule(x: unknown): EndRule | null {
  if (!x || typeof x !== 'object') return null;
  const r = x as Record<string, unknown>;
  if (typeof r.code !== 'string' || !decodeRule(r.code)) return null;
  return {
    code: r.code,
    name: typeof r.name === 'string' ? r.name.slice(0, 60) : '',
    follow: r.follow === true,
    from: typeof r.from === 'number' ? r.from : null,
  };
}

/* ---------- clock ---------- */
let tickTimer: ReturnType<typeof setTimeout> | undefined;
export function startClock() {
  const tick = () => {
    now.value = Date.now();
    tickTimer = setTimeout(tick, 1000 - (Date.now() % 1000) + 8);
  };
  tick();
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      clearTimeout(tickTimer);
      tick();
    }
  });
}

export const describe = (which: End) => {
  const w = wallOf(which);
  return w ? `${fmtDT(w)}（${zoneName(tzOf(which))}）` : '—';
};
export { DAY };
