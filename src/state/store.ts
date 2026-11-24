/* ============================================================
   App state: two instants (start, end) and the span between.
   The two ends are alike: either can be a fixed moment or follow the clock (now), and the span can tie
   either one to the other (end = start + span, or start = end − span). Every lens reads both ends;
   nothing switches silently.
   ============================================================ */
import { reactive, computed, ref, watch } from 'vue';
import {
  type Wall, type Span, type WallNote, DAY, partsInTz, wallToInstant, toInstant, addDuration, validWall, fmtSpan,
  spanBetween, addDaysWall, addMonthsWall, mod, wdOf, LNY, dayNum, diffCalendar, fmtDT, wEq, interpretSpanText,
  isValidTz as isValidTzSafe,
} from '../core/time';
import { LOCAL_TZ, sameZone, zoneName } from '../core/zones';

export type End = 'start' | 'end';
export type Lens = 'zones' | 'cal' | 'read';
export type Theme = 'system' | 'light' | 'dark';
/** Display density in percent of the normal size; the smallest text follows it (never below 9px). */
export const DENSITY: { v: number; name: string }[] = [
  { v: 80, name: '極緊湊' }, { v: 87, name: '緊湊' }, { v: 93, name: '稍緊' }, { v: 100, name: '標準' }, { v: 108, name: '稍大' }, { v: 116, name: '大' },
];
export const DUR_SAMPLE = '2h 45m + 1:30:20 − 15m';
export interface Link { expr: string; span: Span }

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
  endPreset: null as null | PeriodKey,
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
  dur: DUR_SAMPLE,
  durSample: true,
});

/* ---------- derived ---------- */
export const other = (which: End): End => (which === 'start' ? 'end' : 'start');
/** This end follows the clock. */
export const isLive = (which: End) => (which === 'start' ? S.live : S.endLive);
/** This end is computed from the other one and the span. */
export const isDerived = (which: End) => !!S.link && S.linkTo === which;
/** The end a span would compute: the one not held at now (the start when only the end follows the clock). */
export const linkTarget = (): End => (S.link ? S.linkTo : S.endLive && !S.live ? 'start' : 'end');

interface Point { wall: Wall; ms: number; note: WallNote }
const NONE = { wall: null, ms: null, note: null as WallNote };
const own = (which: End): Point | null => {
  const tz = which === 'start' ? S.startTz : S.endTz;
  // whole seconds, like every other moment here, so a span from now never gains or loses a fraction of a second
  if (isLive(which)) { const ms = Math.floor(now.value / 1000) * 1000; return { wall: partsInTz(ms, tz), ms, note: null }; }
  const w = which === 'start' ? S.start : S.end;
  if (!w) return null;
  const r = wallToInstant(w, tz);
  return { wall: w, ms: r.ms, note: r.note };
};
const RANGE_ERR = '超出可計算範圍（西元 1–9999 年）';
const ends = computed<{ s: Point; e: Point | typeof NONE; err: string | null }>(() => {
  const ownS = own('start')!;
  if (S.link) {
    const sp = S.link.span;
    if (S.linkTo === 'end') {
      const r = addDuration(ownS.ms, S.startTz, sp, sp.sign, sp.biz);
      const w = Number.isFinite(r.ms) ? partsInTz(r.ms, S.endTz) : null;
      return w && validWall(w) ? { s: ownS, e: { wall: w, ms: r.ms, note: null }, err: null } : { s: ownS, e: NONE, err: RANGE_ERR };
    }
    const ownE = own('end');
    if (ownE) {
      const r = addDuration(ownE.ms, S.endTz, sp, -sp.sign as 1 | -1, sp.biz);
      const w = Number.isFinite(r.ms) ? partsInTz(r.ms, S.startTz) : null;
      return w && validWall(w) ? { s: { wall: w, ms: r.ms, note: null }, e: ownE, err: null } : { s: ownS, e: ownE, err: RANGE_ERR };
    }
  }
  return { s: ownS, e: own('end') || NONE, err: null };
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
  const lo = Math.min(startMs.value, endMs.value), hi = Math.max(startMs.value, endMs.value);
  return { ...diffCalendar(lo, hi, S.startTz), sign: (endMs.value < startMs.value ? -1 : 1) as 1 | -1 };
});

/* ---------- toasts (also the screen reader's announcements) ---------- */
export interface ToastMsg { id: number; text: string; undo?: () => void }
export const toastState = reactive({ cur: null as ToastMsg | null });
let toastId = 0, toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(text: string, undo?: () => void) {
  toastState.cur = { id: ++toastId, text, undo };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastState.cur = null; }, undo ? 5200 : 2200);
}
export function toastClose() { clearTimeout(toastTimer); toastState.cur = null; }

/* ---------- history: many levels of undo and redo ---------- */
interface Snap {
  start: Wall; live: boolean; startTz: string; end: Wall | null; endLive: boolean; endTz: string; link: string | null; linkTo: End;
  endPreset: PeriodKey | null; endSample: boolean; zones: string[]; readOrder: string[];
}
const snap = (): Snap => ({
  start: { ...startWall.value }, live: S.live, startTz: S.startTz, end: S.end ? { ...S.end } : null, endLive: S.endLive, endTz: S.endTz,
  link: S.link ? S.link.expr : null, linkTo: S.linkTo, endPreset: S.endPreset, endSample: S.endSample, zones: [...S.zones], readOrder: [...S.readOrder],
});
/** What a snapshot means: a moment that follows the clock or is computed is not part of it. */
const meaning = (a: Snap) => JSON.stringify({
  ...a, start: a.live || (a.link && a.linkTo === 'start') ? null : a.start, end: a.endLive || (a.link && a.linkTo === 'end') ? null : a.end, linkTo: a.link ? a.linkTo : null,
});
const sameSnap = (a: Snap, b: Snap) => meaning(a) === meaning(b);
function restoreSnap(o: Snap) {
  S.startTz = o.startTz; S.live = o.live; S.start = o.start;
  S.endTz = o.endTz; S.end = o.end; S.endLive = o.endLive; S.link = o.link ? mkLink(o.link) : null; S.linkTo = o.linkTo;
  S.endPreset = o.endPreset; S.endSample = o.endSample; S.zones = [...o.zones]; S.readOrder = [...o.readOrder];
}
export const history = reactive({ undo: [] as { s: Snap; label: string }[], redo: [] as { s: Snap; label: string }[] });
let coalesceKey = '', coalesceAt = 0;

/**
 * Run a change as one undoable step. `key` merges rapid repeats (typing, dragging) into one step.
 * `say` shows a toast with an undo button.
 */
export function commit(fn: () => boolean | void, opts: { label?: string; key?: string; hold?: boolean; say?: string | (() => string) } = {}): boolean {
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
    coalesceKey = opts.key || ''; coalesceAt = t;
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
export function breakCoalesce() { coalesceKey = ''; }
export function redo() {
  const e = history.redo.pop();
  if (!e) return;
  history.undo.push({ s: snap(), label: e.label });
  restoreSnap(e.s);
  coalesceKey = '';
  toast(e.label ? `已重做：${e.label}` : '已重做');
}

/* ---------- attention: a panel glows briefly where a change landed ---------- */
export const pulse = reactive({ start: 0, end: 0, span: 0, zones: 0 });
export function bump(k: keyof typeof pulse) { pulse[k]++; }

/* ---------- mutations ---------- */
/** Puts this end at a moment. If the span was computing this end, it stops; if it computes the other end, that one follows. */
export function setWall(which: End, w: Wall, opts: { preset?: PeriodKey | null } = {}): boolean {
  if (!validWall(w)) { toast(RANGE_ERR); return false; }
  if (isDerived(which)) S.link = null;
  if (which === 'start') { S.start = { ...w }; S.live = false; }
  else { S.end = { ...w }; S.endLive = false; S.endSample = false; S.endPreset = opts.preset || null; }
  return true;
}
export function setInstant(which: End, ms: number, opts?: { preset?: PeriodKey | null }): boolean {
  if (!Number.isFinite(ms)) { toast(RANGE_ERR); return false; }
  return setWall(which, partsInTz(ms, tzOf(which)), opts);
}
/** This end follows the clock (on), or stays at the second it shows now (off). */
export function setLive(which: End, on: boolean) {
  if (on) {
    if (isDerived(which)) S.link = null;
    if (which === 'start') S.live = true;
    else { S.endLive = true; S.endSample = false; S.endPreset = null; }
    return;
  }
  if (!isLive(which)) return;
  if (which === 'start') { S.start = { ...startWall.value }; S.live = false; }
  else { S.end = { ...endWall.value! }; S.endLive = false; }
}
/** Keeps the instant; the end follows when it shared the start's zone. */
export function setStartTz(id: string, keepInstant = true) {
  const prev = S.startTz;
  const follow = sameZone(S.endTz, prev) || !hasEnd.value;
  const sMs = startMs.value, eMs = endMs.value;
  if (keepInstant && !S.live && !isDerived('start')) S.start = partsInTz(sMs, id);
  S.startTz = id;
  if (follow) {
    if (keepInstant && S.end && !S.endLive && !isDerived('end') && eMs != null) S.end = partsInTz(eMs, id);
    if (!sameZone(S.endTz, id)) { S.endPreset = null; S.endSample = false; }
    S.endTz = id;
  }
  if (!S.zones.some((z) => sameZone(z, prev))) S.zones.unshift(prev);
  trimZones();
}
export function setEndTz(id: string) {
  const prev = S.endTz;
  if (S.end && !S.endLive && !isDerived('end') && endMs.value != null) S.end = partsInTz(endMs.value, id);
  if (!sameZone(prev, id)) { S.endPreset = null; S.endSample = false; }
  S.endTz = id;
  if (!S.zones.some((z) => sameZone(z, prev))) S.zones.unshift(prev);
  trimZones();
}
export function setTz(which: End, id: string) { if (which === 'start') setStartTz(id); else setEndTz(id); }

export function mkLink(text: string): Link | null {
  const r = interpretSpanText(text);
  return r.kind === 'span' ? { expr: fmtSpan(r.span), span: r.span } : null;
}
const SUBJ_NAME = { start: '開始', end: '結束' } as const;
/** The span as the computed end sees it: +30天 from the start is −30天 from the end. */
export const negExpr = (expr: string) => (expr.startsWith('−') ? '+' + expr.slice(1) : expr.startsWith('+') ? '−' + expr.slice(1) : '−' + expr);
/** "結束 = 開始 +30天" or "開始 = 結束 −30天". */
export function linkSentence(to: End = S.linkTo, expr = S.link?.expr || ''): string {
  return to === 'end' ? `結束 = 開始 ${expr}` : `開始 = 結束 ${negExpr(expr)}`;
}
/** What happens when the other end moves. */
export const followText = (to: End = S.linkTo) => `${SUBJ_NAME[other(to)]}改了，${SUBJ_NAME[to]}跟著動`;
/** Where `to` would land with this span (end = start + span, or start = end − span). */
export function checkSpan(sp: Span, to: End = linkTarget()): { ok: true; ms: number; w: Wall } | { ok: false; err: string } {
  const from = to === 'end' ? startMs.value : endMs.value;
  if (from == null) return { ok: false, err: '先設定結束，開始才能從結束往回算' };
  const r = addDuration(from, to === 'end' ? S.startTz : S.endTz, sp, (to === 'end' ? sp.sign : -sp.sign) as 1 | -1, sp.biz);
  const w = Number.isFinite(r.ms) ? partsInTz(r.ms, tzOf(to)) : null;
  if (!w || !validWall(w)) return { ok: false, err: RANGE_ERR };
  return { ok: true, ms: r.ms, w };
}
export function setLink(sp: Span, to: End = linkTarget()): boolean {
  const c = checkSpan(sp, to);
  if (!c.ok) { toast(c.err); return false; }
  S.link = { expr: fmtSpan(sp), span: { ...sp } };
  S.linkTo = to;
  if (to === 'end') { S.endLive = false; S.endSample = false; S.endPreset = null; }
  else S.live = false;
  return true;
}
/** The end the span was computing stays where it is right now; the span no longer ties them. */
export function freezeLink(): boolean {
  if (!S.link) return false;
  const which = S.linkTo, w = wallOf(which);
  if (!w) return false;
  if (which === 'end') { S.end = { ...w }; S.endLive = false; S.endPreset = null; }
  else { S.start = { ...w }; S.live = false; }
  S.link = null;
  return true;
}
/** Keep the current gap: the end not held at now follows the other. */
export function linkFromMeasured(): boolean {
  if (endMs.value == null) return false;
  const to = linkTarget();
  return setLink(spanBetween(startMs.value, endMs.value, to === 'end' ? S.startTz : S.endTz), to);
}
export function clearEnd() {
  if (isDerived('start')) freezeLink();
  S.end = null; S.endLive = false; S.link = null; S.endSample = false; S.endPreset = null; S.active = 'start';
}
/** Start and end trade places: moments, zones, which one follows the clock, and which one the span computes. */
export function swapEnds(): boolean {
  if (!endWall.value) return false;
  const s = { ...startWall.value }, sTz = S.startTz, sLive = S.live, e = { ...endWall.value }, eTz = S.endTz, eLive = S.endLive;
  S.start = e; S.startTz = eTz; S.live = eLive;
  S.end = s; S.endTz = sTz; S.endLive = sLive;
  if (S.link) {
    const sp = { ...S.link.span, sign: -S.link.span.sign as 1 | -1 };
    S.link = { expr: fmtSpan(sp), span: sp };
    S.linkTo = other(S.linkTo);
  }
  S.endSample = false; S.endPreset = null;
  return true;
}

/* ---------- presets ---------- */
export type StartPreset = 'today' | 'monday' | 'month' | 'year';
export type PeriodKey = 'day' | 'week' | 'month' | 'newyear' | 'lny';
export const START_PRESETS: [StartPreset, string, string][] = [
  ['today', '今天', '今天 00:00:00'], ['monday', '本週一', '本週一 00:00:00'], ['month', '月初', '本月 1 日 00:00:00'], ['year', '年初', '今年 1 月 1 日 00:00:00'],
];
export function startPresetWall(key: StartPreset): Wall {
  const n = partsInTz(Date.now(), S.startTz);
  const day0 = { ...n, h: 0, mi: 0, s: 0 };
  if (key === 'today') return day0;
  if (key === 'monday') return addDaysWall(day0, -mod(wdOf(n) + 6, 7));
  if (key === 'month') return { ...day0, d: 1 };
  return { ...day0, mo: 1, d: 1 };
}
export const PERIOD_NAMES: Record<PeriodKey, string> = { day: '今天結束', week: '本週結束', month: '本月結束', newyear: '跨年', lny: '春節' };
function lnyAround(w: Wall) {
  const n = dayNum(w.y, w.mo, w.d);
  let prev: typeof LNY[number] | null = null, next: typeof LNY[number] | null = null;
  for (const x of LNY) { if (dayNum(x.y, x.mo, x.d) <= n) prev = x; else { next = x; break; } }
  return { prev, next };
}
/** The period that contains the start, read on the end's clock, as [from, to] instants. */
export function periodBounds(key: PeriodKey, sMs = startMs.value): [number | null, number] | null {
  const tz = S.endTz;
  const n = partsInTz(sMs, tz);
  const d0 = { ...n, h: 0, mi: 0, s: 0 };
  const at = (w: Wall) => toInstant(w, tz);
  if (key === 'day') return n.y >= 9999 && n.mo === 12 && n.d === 31 ? null : [at(d0), at(addDaysWall(d0, 1))];
  if (key === 'week') { const mon = addDaysWall(d0, -mod(wdOf(n) + 6, 7)); const nx = addDaysWall(mon, 7); return nx.y > 9999 ? null : [at(mon), at(nx)]; }
  if (key === 'month') { const m0 = { ...d0, d: 1 }; const nx = addMonthsWall(m0, 1); return nx.y > 9999 ? null : [at(m0), at(nx)]; }
  if (key === 'newyear') { if (n.y >= 9999) return null; const y0 = { ...d0, mo: 1, d: 1 }; return [at(y0), at({ ...y0, y: n.y + 1 })]; }
  const { prev, next } = lnyAround(n);
  if (!next) return null;
  return [prev ? at({ ...prev, h: 0, mi: 0, s: 0 }) : null, at({ ...next, h: 0, mi: 0, s: 0 })];
}
export function periodLabel(key: PeriodKey): string {
  if (key === 'newyear') return '跨年';
  if (key === 'lny') return '春節';
  const b = periodBounds(key);
  const cur = !!b && b[0] != null && now.value >= b[0] && now.value < b[1];
  return { day: cur ? '今天' : '當天', week: cur ? '本週' : '當週', month: cur ? '本月' : '當月' }[key];
}
export function applyEndPreset(key: PeriodKey): boolean {
  const b = periodBounds(key);
  if (!b) { toast('這個快捷鍵目前無法使用'); return false; }
  return setInstant('end', b[1], { preset: key });
}

/* ---------- progress from start to end (the rail under the span) ---------- */
/** With a live start and a period end (本月結束, 跨年…): how far through that period now is. */
export const presetProgress = computed(() => {
  if (!S.live || !S.endPreset || S.link) return null;
  const b = periodBounds(S.endPreset);
  if (!b || b[0] == null) return null;
  const f = (now.value - b[0]) / (b[1] - b[0]);
  return f >= 0 && f <= 1 ? f : null;
});
/** The fill of the rail (0–1) and where now sits on it (null when now is outside start–end). */
export const railProgress = computed<{ f: number; now: number | null }>(() => {
  if (presetProgress.value != null) return { f: presetProgress.value, now: presetProgress.value };
  const sMs = startMs.value, eMs = endMs.value;
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
  if (!list.some((x) => sameZone(x, S.endTz))) list.splice(list.findIndex((x) => sameZone(x, S.startTz)) + 1, 0, S.endTz);
  // too many: drop from the bottom, but never the start's or the end's zone
  while (list.length > ZMAX) {
    let i = list.length - 1;
    while (i >= 0 && (sameZone(list[i], S.startTz) || sameZone(list[i], S.endTz))) i--;
    list.splice(i, 1);
  }
  return list;
});
/** Put the rows in this order. */
export function orderZones(ids: string[]) { S.zones = [...ids]; }
function trimZones() { if (S.zones.length > ZMAX) S.zones.length = ZMAX; }
export function addZoneRow(id: string): boolean {
  if (zoneRows.value.some((z) => sameZone(z, id))) { toast(`${zoneName(id)}已經在列表中`); return false; }
  if (zoneRows.value.length >= ZMAX) { toast(`最多 ${ZMAX} 個時區，請先移除一個`); return false; }
  S.zones.push(id);
  return true;
}
export function removeZoneRow(id: string) { S.zones = S.zones.filter((z) => !sameZone(z, id)); }

/* ---------- persistence ---------- */
export function defaultZones(): string[] {
  const list = ['Asia/Taipei', 'Asia/Tokyo', 'Europe/London', 'America/New_York', 'America/Los_Angeles', 'Australia/Sydney'];
  return list.filter((id) => isValidTzSafe(id) && !sameZone(id, LOCAL_TZ));
}
export function loadState(): boolean {
  S.zones = defaultZones();
  let o: Record<string, unknown> | null = null;
  try { o = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch { o = null; }
  if (!o || o.v !== 2) return false;
  const W = (w: unknown): Wall | null => {
    if (!w || typeof w !== 'object') return null;
    const x = w as Record<string, unknown>;
    const r = { y: +(x.y as number), mo: +(x.mo as number), d: +(x.d as number), h: +(x.h as number), mi: +(x.mi as number), s: +(x.s as number) };
    return validWall(r) ? r : null;
  };
  if (isValidTzSafe(o.startTz)) S.startTz = o.startTz as string;
  if (isValidTzSafe(o.endTz)) S.endTz = o.endTz as string;
  const st = W(o.start);
  if (o.live === false && st) { S.live = false; S.start = st; }
  const en = W(o.end);
  if (en) {
    S.end = en; S.endSample = !!o.endSample;
    S.endPreset = typeof o.endPreset === 'string' && o.endPreset in PERIOD_NAMES ? (o.endPreset as PeriodKey) : null;
  }
  if (o.endLive === true) { S.endLive = true; S.endSample = false; S.endPreset = null; }
  if (typeof o.link === 'string') S.link = mkLink(o.link);
  S.linkTo = o.linkTo === 'start' && S.link && (S.endLive || S.end) ? 'start' : 'end';
  if (S.link && S.linkTo === 'end') S.endLive = false;
  if (Array.isArray(o.zones)) S.zones = (o.zones as unknown[]).filter((z): z is string => isValidTzSafe(z)).slice(0, ZMAX);
  if (o.theme === 'light' || o.theme === 'dark' || o.theme === 'system') S.theme = o.theme;
  if (o.lens === 'zones' || o.lens === 'cal' || o.lens === 'read') S.lens = o.lens;
  if (o.readEnd === 'end') S.readEnd = 'end';
  const order = Array.isArray(o.readOrder) ? o.readOrder : o.readPins; // readPins: the pinned formats of the first version
  if (Array.isArray(order)) S.readOrder = (order as unknown[]).filter((k): k is string => typeof k === 'string').slice(0, 40);
  if (typeof o.density === 'number' && DENSITY.some((d) => d.v === o.density)) S.density = o.density;
  if (typeof o.map === 'boolean') S.map = o.map;
  if (typeof o.dur === 'string' && o.dur.length <= 400) { S.dur = o.dur; S.durSample = !!o.durSample; }
  return true;
}
let saveTimer: ReturnType<typeof setTimeout> | undefined;
export function startPersisting() {
  watch(() => [S.startTz, S.endTz, S.live, S.live ? null : S.start, S.end, S.endLive, S.endSample, S.endPreset, S.link?.expr, S.linkTo, S.zones, S.theme, S.lens, S.readEnd, S.readOrder,
    S.density, S.map, S.dur, S.durSample], () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify({
          v: 2, startTz: S.startTz, endTz: S.endTz, live: S.live, start: S.live ? null : S.start, end: S.end, endLive: S.endLive,
          endSample: S.endSample, endPreset: S.endPreset, link: S.link ? S.link.expr : null, linkTo: S.linkTo, zones: S.zones,
          theme: S.theme, lens: S.lens, readEnd: S.readEnd, readOrder: S.readOrder,
          density: S.density, map: S.map, dur: S.dur, durSample: S.durSample,
        }));
      } catch { /* storage unavailable: everything still works for this visit */ }
    }, 300);
  }, { deep: true });
}
/** First visit: a sample end (New Year) so every lens has something to show. Marked as a sample. */
export function seedSample() {
  if (S.link || S.end || S.endLive) return;
  const b = periodBounds('newyear');
  if (b) { S.end = partsInTz(b[1], S.endTz); S.endPreset = 'newyear'; S.endSample = true; }
}

/* ---------- clock ---------- */
let tickTimer: ReturnType<typeof setTimeout> | undefined;
export function startClock() {
  const tick = () => {
    now.value = Date.now();
    tickTimer = setTimeout(tick, 1000 - (Date.now() % 1000) + 8);
  };
  tick();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { clearTimeout(tickTimer); tick(); } });
}

export const describe = (which: End) => {
  const w = wallOf(which);
  return w ? `${fmtDT(w)}（${zoneName(tzOf(which))}）` : '—';
};
export const startPresetActive = (key: StartPreset) => !S.live && !isDerived('start') && wEq(S.start, startPresetWall(key));
export { DAY };
