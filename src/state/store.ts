/* ============================================================
   App state: two instants (start, end) and the span between.
   Every lens reads both ends; nothing switches silently.
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
export interface Link { expr: string; span: Span }

export const ZMAX = 8;
const STORE_KEY = 'time-calculator:v2';

export const now = ref(Date.now());

export const S = reactive({
  startTz: LOCAL_TZ,
  start: partsInTz(Date.now(), LOCAL_TZ) as Wall,
  live: true,
  end: null as Wall | null,
  endTz: LOCAL_TZ,
  endSample: false,
  endPreset: null as null | PeriodKey,
  link: null as Link | null,
  zones: [] as string[],
  active: 'start' as End,
  theme: 'system' as Theme,
  lens: 'zones' as Lens,
  readEnd: 'start' as End,
});

/* ---------- derived ---------- */
export const startWall = computed<Wall>(() => (S.live ? partsInTz(now.value, S.startTz) : S.start));
const startI = computed(() => wallToInstant(startWall.value, S.startTz));
export const startMs = computed(() => startI.value.ms);
export const startNote = computed<WallNote>(() => (S.live ? null : startI.value.note));

const endCalc = computed<{ wall: Wall | null; ms: number | null; note: WallNote; err: string | null }>(() => {
  if (S.link) {
    const sp = S.link.span;
    const r = addDuration(startMs.value, S.startTz, sp, sp.sign, sp.biz);
    const w = Number.isFinite(r.ms) ? partsInTz(r.ms, S.endTz) : null;
    if (w && validWall(w)) return { wall: w, ms: r.ms, note: null, err: null };
    return { wall: null, ms: null, note: null, err: '超出可計算範圍（西元 1–9999 年）' };
  }
  if (S.end) { const e = wallToInstant(S.end, S.endTz); return { wall: S.end, ms: e.ms, note: e.note, err: null }; }
  return { wall: null, ms: null, note: null, err: null };
});
export const endWall = computed(() => endCalc.value.wall);
export const endMs = computed(() => endCalc.value.ms);
export const endNote = computed(() => endCalc.value.note);
export const linkErr = computed(() => endCalc.value.err);
export const hasEnd = computed(() => endMs.value != null);

export const wallOf = (which: End) => (which === 'start' ? startWall.value : endWall.value);
export const msOf = (which: End) => (which === 'start' ? startMs.value : endMs.value);
export const tzOf = (which: End) => (which === 'start' ? S.startTz : S.endTz);
export const other = (which: End): End => (which === 'start' ? 'end' : 'start');

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
interface Snap { start: Wall; live: boolean; startTz: string; end: Wall | null; endTz: string; link: string | null; endPreset: PeriodKey | null; endSample: boolean; zones: string[] }
const snap = (): Snap => ({
  start: { ...startWall.value }, live: S.live, startTz: S.startTz, end: S.end ? { ...S.end } : null, endTz: S.endTz,
  link: S.link ? S.link.expr : null, endPreset: S.endPreset, endSample: S.endSample, zones: [...S.zones],
});
const sameSnap = (a: Snap, b: Snap) => JSON.stringify({ ...a, start: a.live ? null : a.start }) === JSON.stringify({ ...b, start: b.live ? null : b.start });
function restoreSnap(o: Snap) {
  S.startTz = o.startTz; S.live = o.live; S.start = o.start;
  S.endTz = o.endTz; S.end = o.end; S.link = o.link ? mkLink(o.link) : null;
  S.endPreset = o.endPreset; S.endSample = o.endSample; S.zones = [...o.zones];
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
const RANGE_ERR = '超出可計算範圍（西元 1–9999 年）';
export function setWall(which: End, w: Wall, opts: { preset?: PeriodKey | null } = {}): boolean {
  if (!validWall(w)) { toast(RANGE_ERR); return false; }
  if (which === 'start') { S.start = { ...w }; S.live = false; }
  else { S.end = { ...w }; S.link = null; S.endSample = false; S.endPreset = opts.preset || null; }
  return true;
}
export function setInstant(which: End, ms: number, opts?: { preset?: PeriodKey | null }): boolean {
  if (!Number.isFinite(ms)) { toast(RANGE_ERR); return false; }
  return setWall(which, partsInTz(ms, tzOf(which)), opts);
}
export function setLive(on: boolean) {
  if (on) { S.live = true; }
  else { S.start = { ...startWall.value }; S.live = false; }
}
/** Keeps the instant; the end follows when it shared the start's zone. */
export function setStartTz(id: string, keepInstant = true) {
  const prev = S.startTz;
  const follow = sameZone(S.endTz, prev) || !hasEnd.value;
  const sMs = startMs.value, eMs = endMs.value;
  if (!S.live && keepInstant) S.start = partsInTz(sMs, id);
  S.startTz = id;
  if (follow) {
    if (keepInstant && S.end && !S.link && eMs != null) S.end = partsInTz(eMs, id);
    S.endTz = id;
  }
  if (!S.zones.some((z) => sameZone(z, prev))) S.zones.unshift(prev);
  trimZones();
}
export function setEndTz(id: string) {
  const prev = S.endTz;
  if (!S.link && S.end && endMs.value != null) S.end = partsInTz(endMs.value, id);
  S.endTz = id;
  if (!S.zones.some((z) => sameZone(z, prev))) S.zones.unshift(prev);
  trimZones();
}
export function setTz(which: End, id: string) { if (which === 'start') setStartTz(id); else setEndTz(id); }

export function mkLink(text: string): Link | null {
  const r = interpretSpanText(text);
  return r.kind === 'span' ? { expr: fmtSpan(r.span), span: r.span } : null;
}
export function checkSpan(sp: Span): { ok: true; ms: number; w: Wall } | { ok: false; err: string } {
  const r = addDuration(startMs.value, S.startTz, sp, sp.sign, sp.biz);
  const w = Number.isFinite(r.ms) ? partsInTz(r.ms, S.endTz) : null;
  if (!w || !validWall(w)) return { ok: false, err: RANGE_ERR };
  return { ok: true, ms: r.ms, w };
}
export function setLink(sp: Span): boolean {
  const c = checkSpan(sp);
  if (!c.ok) { toast(c.err); return false; }
  S.link = { expr: fmtSpan(sp), span: { ...sp } };
  S.endSample = false; S.endPreset = null;
  return true;
}
/** Keep the end where it is right now. */
export function freezeEnd(): boolean {
  if (!S.link || !endWall.value) return false;
  S.end = { ...endWall.value };
  S.link = null; S.endPreset = null;
  return true;
}
/** Keep the current gap and let the end follow the start. */
export function linkFromMeasured(): boolean {
  if (endMs.value == null) return false;
  return setLink(spanBetween(startMs.value, endMs.value, S.startTz));
}
export function clearEnd() { S.end = null; S.link = null; S.endSample = false; S.endPreset = null; S.active = 'start'; }
export function swapEnds(): boolean {
  if (!endWall.value) return false;
  const s = { ...startWall.value }, sTz = S.startTz, e = { ...endWall.value }, eTz = S.endTz;
  S.start = e; S.startTz = eTz; S.end = s; S.endTz = sTz;
  S.live = false; S.link = null; S.endSample = false; S.endPreset = null;
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

/* ---------- zones ---------- */
export const zoneRows = computed(() => {
  const list = [S.startTz];
  if (!sameZone(S.endTz, S.startTz)) list.push(S.endTz);
  for (const z of S.zones) if (!list.some((x) => sameZone(x, z))) list.push(z);
  return list.slice(0, ZMAX);
});
function trimZones() { if (S.zones.length > ZMAX) S.zones.length = ZMAX; }
export function addZoneRow(id: string): boolean {
  if (zoneRows.value.some((z) => sameZone(z, id))) { toast(`${zoneName(id)}已經在列表中`); return false; }
  if (zoneRows.value.length >= ZMAX) { toast(`最多 ${ZMAX} 個時區，請先移除一個`); return false; }
  S.zones.push(id);
  return true;
}
export function removeZoneRow(id: string) { S.zones = S.zones.filter((z) => !sameZone(z, id)); }

/* ---------- persistence ---------- */
function defaultZones(): string[] {
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
  if (typeof o.link === 'string') S.link = mkLink(o.link);
  if (Array.isArray(o.zones)) S.zones = (o.zones as unknown[]).filter((z): z is string => isValidTzSafe(z)).slice(0, ZMAX);
  if (o.theme === 'light' || o.theme === 'dark' || o.theme === 'system') S.theme = o.theme;
  if (o.lens === 'zones' || o.lens === 'cal' || o.lens === 'read') S.lens = o.lens;
  if (o.readEnd === 'end') S.readEnd = 'end';
  return true;
}
let saveTimer: ReturnType<typeof setTimeout> | undefined;
export function startPersisting() {
  watch(() => [S.startTz, S.endTz, S.live, S.live ? null : S.start, S.end, S.endSample, S.endPreset, S.link?.expr, S.zones, S.theme, S.lens, S.readEnd], () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify({
          v: 2, startTz: S.startTz, endTz: S.endTz, live: S.live, start: S.live ? null : S.start, end: S.end,
          endSample: S.endSample, endPreset: S.endPreset, link: S.link ? S.link.expr : null, zones: S.zones,
          theme: S.theme, lens: S.lens, readEnd: S.readEnd,
        }));
      } catch { /* storage unavailable: everything still works for this visit */ }
    }, 300);
  }, { deep: true });
}
/** First visit: a sample end (New Year) so every lens has something to show. Marked as a sample. */
export function seedSample() {
  if (S.link || S.end) return;
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
export const startPresetActive = (key: StartPreset) => !S.live && wEq(S.start, startPresetWall(key));
export { DAY };
