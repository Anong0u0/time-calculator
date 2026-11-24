<script setup lang="ts">
import { ref, reactive, computed, watch, nextTick } from 'vue';
import Icon from './Icon.vue';
import Popover from './Popover.vue';
import {
  S,
  type End,
  type CalMode,
  now,
  startWall,
  endWall,
  commit,
  setWall,
  toast,
  bump,
  ruleTick,
} from '../state/store';
import {
  type Wall,
  dayNum,
  fromDayNum,
  isoWeek,
  isoWeeksInYear,
  isoWeekStart,
  mod,
  WD,
  partsInTz,
  dayOfYear,
  fmtDT,
  daysInYear,
  usWeek,
} from '../core/time';
import { lunarOfDay, lunarMonthName, lunarDayName, fmtLunar } from '../core/lunar';
import { termOnDay, TERM_NAMES, CHINA_TZ } from '../core/terms';
import { decodeRule, dayMatches, type Cond } from '../core/rule';
import { vocab } from '../core/vocab';
import { useSize, remPx } from '../composables/size';
import { nf } from '../core/format';

const view = reactive({ y: startWall.value.y, mo: startWall.value.mo });
function setView(w: { y: number; mo: number } | null) {
  if (w) {
    view.y = w.y;
    view.mo = w.mo;
  }
}
/** A change made on this calendar: the month shown stays where the user is looking. */
let selfEdit = false;
function here<T>(fn: () => T): T {
  selfEdit = true;
  try {
    return fn();
  } finally {
    nextTick(() => {
      selfEdit = false;
    });
  }
}
/** Year and month as one number (202611): what the grids compare, so they redraw when the month changes, not with every second. */
const ymOf = (w: { y: number; mo: number }) => w.y * 100 + w.mo;
const sYM = computed(() => ymOf(startWall.value));
const eYM = computed(() => (endWall.value ? ymOf(endWall.value) : null));
watch(sYM, () => {
  if (!selfEdit) setView(startWall.value);
});
watch(eYM, (v) => {
  if (v != null && !selfEdit) setView(endWall.value);
});
function shift(m: number) {
  const t = view.y * 12 + view.mo - 1 + m;
  const y = Math.floor(t / 12);
  if (y < 1 || y > 9999) return;
  view.y = y;
  view.mo = mod(t, 12) + 1;
}
/** One step of the arrows, the wheel or a swipe: a month, or a year when the whole year is shown. */
const yearMode = computed(() => S.calMode === 'year');
function step(k: number) {
  if (yearMode.value) yearStep(k);
  else shift(k);
}
function setMode(m: CalMode) {
  S.calMode = m;
}
/** A small month's name opens that month. */
function openMonth(mo: number) {
  view.mo = mo;
  S.calMode = 'month';
}
const dim = (y: number, mo: number) => dayNum(mo === 12 ? y + 1 : y, mo === 12 ? 1 : mo + 1, 1) - dayNum(y, mo, 1);

/* ---------- jumping: the title opens a picker; the wheel turns months (years over the week strip) ---------- */
const titleBtn = ref<HTMLElement | null>(null);
const yearInput = ref<HTMLInputElement | null>(null);
const jump = ref(false);
const yearText = ref('');
watch(jump, async (o) => {
  if (!o) return;
  yearText.value = String(view.y);
  await nextTick();
  requestAnimationFrame(() => yearInput.value?.select());
});
function gotoYear(y: number, quiet = false): boolean {
  if (!Number.isFinite(y)) return false;
  y = Math.trunc(y);
  if (y < 1 || y > 9999) {
    if (!quiet) toast('年份要在 1 到 9999 之間');
    return false;
  }
  view.y = y;
  yearText.value = String(y);
  return true;
}
const yearStep = (k: number) => gotoYear(Math.min(9999, Math.max(1, view.y + k)));
/** Typing a year moves the calendar as soon as it has four digits; Enter takes any length. */
function yearLive() {
  const t = yearText.value.trim();
  if (/^\d{4}$/.test(t)) gotoYear(+t, true);
}
function yearEnter() {
  const t = yearText.value.trim();
  if (/^\d{1,4}$/.test(t)) gotoYear(+t);
  else toast('請輸入 1 到 9999 的年份');
}
function pickMonth(m: number) {
  view.mo = m;
  S.calMode = 'month';
  jump.value = false;
}
function gotoWall(w: { y: number; mo: number } | null) {
  setView(w);
  yearText.value = String(view.y);
  jump.value = false;
}
const todayWall = computed(() => partsInTz(now.value, S.startTz));
const tYM = computed(() => ymOf(todayWall.value));
const monthMarks = computed(() =>
  Array.from({ length: 12 }, (_, i) => {
    const m = i + 1,
      ym = view.y * 100 + m;
    return { mo: m, cur: m === view.mo, s: sYM.value === ym, e: eYM.value === ym, today: tYM.value === ym };
  }),
);
let wheelAcc = 0,
  wheelAt = 0;
function onWheel(e: WheelEvent, unit: 'mo' | 'y') {
  const d = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
  if (!d) return;
  e.preventDefault();
  const t = performance.now();
  if (t - wheelAt > 400) wheelAcc = 0;
  wheelAt = t;
  wheelAcc += e.deltaMode === 1 ? d * 33 : d;
  // one notch of a mouse wheel (about 100px) is one step, never more per event; a trackpad needs a deliberate swipe
  if (Math.abs(wheelAcc) >= 60) {
    const k = Math.sign(wheelAcc);
    wheelAcc = 0;
    if (unit === 'y' || e.shiftKey || yearMode.value) yearStep(k);
    else shift(k);
  }
}
const todayN = computed(() => {
  const w = partsInTz(now.value, S.startTz);
  return dayNum(w.y, w.mo, w.d);
});
const sN = computed(() => dayNum(startWall.value.y, startWall.value.mo, startWall.value.d));
const eN = computed(() => (endWall.value ? dayNum(endWall.value.y, endWall.value.mo, endWall.value.d) : null));
const drag = ref<{ a: number; b: number } | null>(null);
/** What the grid shows while something is dragged: the range being picked, or an end on its way. */
const pS = computed(() => (moving.value?.which === 'start' ? moving.value.n : sN.value));
const pE = computed(() => (moving.value?.which === 'end' ? moving.value.n : eN.value));
const lo = computed(() =>
  drag.value ? Math.min(drag.value.a, drag.value.b) : pE.value == null ? null : Math.min(pS.value, pE.value),
);
const hi = computed(() =>
  drag.value ? Math.max(drag.value.a, drag.value.b) : pE.value == null ? null : Math.max(pS.value, pE.value),
);
const dS = computed(() => (drag.value ? drag.value.a : pS.value));
const dE = computed(() => (drag.value ? drag.value.b : pE.value));

/* ---------- under each day: its lunar date, a 節氣 or a festival (from the vocabulary, so one's own changes show) ---------- */
type Lun = { t: string; k: 'fest' | 'term' | 'mo' | 'd'; full: string };
const fests = computed(() => {
  void ruleTick.value;
  const out: { name: string; ok: (n: number) => boolean }[] = [];
  for (const w of vocab()) {
    if (w.kind !== 'lunar' && w.kind !== 'holiday') continue;
    const r = decodeRule(w.code);
    const st = r?.steps;
    if (!r || st?.length !== 1 || st[0].t !== 'pick' || (st[0].in !== 'next' && st[0].in !== 'prev')) continue;
    out.push({ name: w.name, ok: dayMatches(st[0].c as Cond, S.startTz, S.prefs) });
  }
  return out;
});
function lunarLabel(n: number, room = lunRoom.value): Lun | null {
  if (!S.prefs.lunar || !room) return null;
  const L = lunarOfDay(n);
  if (!L) return null;
  const full = `農曆 ${fmtLunar(L)}`;
  const f = fests.value.find((x) => x.ok(n));
  if (f) return { t: f.name, k: 'fest', full: `${full} · ${f.name}` };
  const tk = termOnDay(n, S.prefs.termTz === 'china' ? CHINA_TZ : S.startTz);
  if (tk != null) return { t: TERM_NAMES[tk], k: 'term', full: `${full} · ${TERM_NAMES[tk]}` };
  if (L.d === 1) return { t: lunarMonthName(L.m, L.leap), k: 'mo', full };
  return { t: lunarDayName(L.d), k: 'd', full };
}

/** The first column is the week's first day (Monday, or Sunday when the settings say so). */
const ws = computed(() => S.prefs.weekStart);
const heads = computed(() =>
  Array.from({ length: 7 }, (_, i) => ({
    t: WD[(i + ws.value) % 7],
    we: (i + ws.value) % 7 === 0 || (i + ws.value) % 7 === 6,
  })),
);
const weekStartOf = (n: number) => n - mod(n + 4 - ws.value, 7);
interface Day {
  n: number;
  d: number;
  out: boolean;
  today: boolean;
  s: boolean;
  e: boolean;
  inR: boolean;
  rL: boolean;
  rR: boolean;
  wkend: boolean;
  label: string;
  lun: Lun | null;
}
const weeks = computed(() => {
  const n1 = dayNum(view.y, view.mo, 1);
  const first = weekStartOf(n1);
  return Array.from({ length: 6 }, (_, r) => {
    const n0 = first + r * 7;
    const th = fromDayNum(n0 + (ws.value ? 3 : 6));
    const wk = ws.value ? isoWeek(th.y, th.mo, th.d).week : usWeek(th.y, th.mo, th.d);
    const days: Day[] = Array.from({ length: 7 }, (_, c) => {
      const n = n0 + c,
        ymd = fromDayNum(n),
        wd = mod(n + 4, 7);
      const inR = lo.value != null && hi.value != null && n >= lo.value && n <= hi.value && lo.value !== hi.value;
      const s = n === dS.value,
        e = n === dE.value;
      const lun = lunarLabel(n);
      return {
        n,
        d: ymd.d,
        out: ymd.mo !== view.mo,
        today: n === todayN.value,
        s,
        e,
        inR,
        lun,
        rL: inR && (n === lo.value || c === 0),
        rR: inR && (n === hi.value || c === 6),
        wkend: wd === 0 || wd === 6,
        label: `${ymd.y} 年 ${ymd.mo} 月 ${ymd.d} 日 週${WD[wd]}${lun ? `，${lun.full}` : ''}${s ? '，開始' : ''}${e ? '，結束' : ''}${n === todayN.value ? '，今天' : ''}`,
      };
    });
    return { n0, wk, days };
  });
});

/* ---------- picking ---------- */
const SUBJ = { start: '開始', end: '結束' } as const;
function withDate(w: Wall, n: number): Wall {
  const d = fromDayNum(n);
  return { ...w, y: d.y, mo: d.mo, d: d.d };
}
function nearer(n: number): End {
  if (eN.value == null) return 'end';
  return Math.abs(n - sN.value) < Math.abs(n - eN.value) ? 'start' : 'end';
}
/** Put one end on day n, keeping its time of day. */
function putDay(which: End, n: number) {
  const base = which === 'start' ? startWall.value : endWall.value || startWall.value;
  if ((which === 'start' ? sN.value : eN.value) === n) return;
  const w = withDate(base, n);
  S.active = which;
  here(() =>
    commit(() => setWall(which, w), { label: `${SUBJ[which]}改到 ${w.mo}/${w.d}`, say: `${SUBJ[which]}：${fmtDT(w)}` }),
  );
  bump(which);
}
function pickDay(n: number) {
  if (eN.value == null && n === sN.value) {
    toast('點其他日期或拖曳可設定結束');
    return;
  }
  putDay(nearer(n), n);
}
function pickRange(a: number, b: number) {
  const l = Math.min(a, b),
    h = Math.max(a, b);
  const s = withDate(startWall.value, l),
    e = withDate(endWall.value || startWall.value, h);
  here(() =>
    commit(() => setWall('start', s) && setWall('end', e), {
      label: '選取日期範圍',
      say: `${s.mo}/${s.d} → ${e.mo}/${e.d}，共 ${h - l + 1} 天`,
    }),
  );
  bump('start');
  bump('end');
}
function pickWeek(n0: number) {
  const a = fromDayNum(n0),
    b = fromDayNum(n0 + 6),
    th = fromDayNum(n0 + (ws.value ? 3 : 6));
  const k = ws.value ? isoWeek(th.y, th.mo, th.d).week : usWeek(th.y, th.mo, th.d);
  const s = withDate(startWall.value, n0),
    e = withDate(endWall.value || startWall.value, n0 + 6);
  here(() =>
    commit(() => setWall('start', s) && setWall('end', e), {
      label: `選取 W${k}`,
      say: `W${k}：${a.mo}/${a.d}（${WD[mod(n0 + 4, 7)]}）→ ${b.mo}/${b.d}（${WD[mod(n0 + 10, 7)]}）`,
    }),
  );
  bump('start');
  bump('end');
}
/** A double click: that whole day, from 00:00 to the next 00:00. */
function pickWholeDay(n: number) {
  const a = fromDayNum(n),
    b = fromDayNum(n + 1);
  const s = { ...a, h: 0, mi: 0, s: 0 },
    e = { ...b, h: 0, mi: 0, s: 0 };
  here(() =>
    commit(() => setWall('start', s) && setWall('end', e), {
      label: `選取 ${a.mo}/${a.d} 整天`,
      say: `${a.mo}/${a.d} 整天：00:00 → 隔天 00:00`,
    }),
  );
  bump('start');
  bump('end');
}
/* A press on ● or ○ drags that end. Elsewhere: a mouse drag picks a range; a finger swipes months, or picks a range after a long press. */
type GDrag = {
  pid: number;
  n: number;
  x: number;
  y: number;
  touch: boolean;
  mode: 'pending' | 'range' | 'move' | 'swipe';
  which: End | null;
  timer?: ReturnType<typeof setTimeout>;
};
let g: GDrag | null = null;
const moving = ref<{ which: End; n: number } | null>(null);
function nAt(e: PointerEvent): number | null {
  const el = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-n]');
  return el ? +el.dataset.n! : null;
}
function gDown(e: PointerEvent) {
  if (e.button > 0) return;
  const n = nAt(e);
  if (n == null) return;
  e.preventDefault();
  const onS = n === sN.value,
    onE = eN.value != null && n === eN.value;
  const touch = e.pointerType !== 'mouse';
  g = {
    pid: e.pointerId,
    n,
    x: e.clientX,
    y: e.clientY,
    touch,
    mode: 'pending',
    which: onS && !onE ? 'start' : onE && !onS ? 'end' : null,
  };
  if (onS && onE) g.which = null; // both on one day: the drag's direction decides
  if (touch && !onS && !onE) {
    const cur = g;
    cur.timer = setTimeout(() => {
      if (g === cur && cur.mode === 'pending') {
        cur.mode = 'range';
        drag.value = { a: cur.n, b: cur.n };
        navigator.vibrate?.(12);
      }
    }, 420);
  }
  try {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  } catch {
    /* ok */
  }
}
function gMove(e: PointerEvent) {
  if (!g || e.pointerId !== g.pid) return;
  const dx = e.clientX - g.x,
    dy = e.clientY - g.y;
  if (g.mode === 'pending') {
    if (Math.hypot(dx, dy) < 8) return;
    clearTimeout(g.timer);
    const onEnd = g.n === sN.value || (eN.value != null && g.n === eN.value);
    if (onEnd) g.mode = 'move';
    else g.mode = g.touch ? 'swipe' : 'range';
  }
  if (g.mode === 'swipe') return;
  const n = nAt(e);
  if (n == null) return;
  if (g.mode === 'move') {
    if (!g.which) {
      if (n === g.n) return;
      g.which = n > g.n ? 'end' : 'start';
    }
    moving.value = { which: g.which, n };
    return;
  }
  drag.value = { a: g.n, b: n };
}
function gUp(e: PointerEvent) {
  if (!g || e.pointerId !== g.pid) return;
  const d = g;
  g = null;
  clearTimeout(d.timer);
  const r = drag.value,
    mv = moving.value;
  drag.value = null;
  moving.value = null;
  if (e.type === 'pointercancel') return;
  if (d.mode === 'swipe') {
    const dx = e.clientX - d.x,
      dy = e.clientY - d.y;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) step(dx < 0 ? 1 : -1);
    else if (Math.abs(dy) > 40) step(dy < 0 ? 1 : -1);
    return;
  }
  if (d.mode === 'move') {
    if (mv && mv.n !== d.n) putDay(mv.which, mv.n);
    return;
  }
  if (d.mode === 'range') {
    if (r && r.a !== r.b) pickRange(r.a, r.b);
    return;
  }
  const t = Date.now();
  if (lastTap && lastTap.n === d.n && t - lastTap.t < 380) {
    lastTap = null;
    pickWholeDay(d.n);
    return;
  }
  lastTap = { n: d.n, t };
  pickDay(d.n);
}
let lastTap: { n: number; t: number } | null = null;
const focusN = ref<number | null>(null);
function dayKey(e: KeyboardEvent, n: number) {
  const mv: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
  let t: number | null = null;
  if (e.key in mv) t = n + mv[e.key];
  else if (e.key === 'Home') t = weekStartOf(n);
  else if (e.key === 'End') t = weekStartOf(n) + 6;
  else if (e.key === 'PageUp' || e.key === 'PageDown') {
    // a month (a year with Shift) back or forward, on the same day where the month has it
    const cur = fromDayNum(n),
      k = (e.key === 'PageUp' ? -1 : 1) * (e.shiftKey ? 12 : 1);
    const tt = cur.y * 12 + cur.mo - 1 + k,
      y = Math.floor(tt / 12),
      mo = mod(tt, 12) + 1;
    if (y >= 1 && y <= 9999) t = dayNum(y, mo, Math.min(cur.d, dim(y, mo)));
    else {
      e.preventDefault();
      return;
    }
  }
  if (t != null) {
    e.preventDefault();
    const d = fromDayNum(t);
    if (d.y !== view.y || (!yearMode.value && d.mo !== view.mo)) {
      view.y = d.y;
      view.mo = d.mo;
    }
    focusN.value = t;
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`.cal [data-n="${t}"]`)?.focus());
  } else if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    pickDay(n);
  } else if (e.key === 's' || e.key === 'S') {
    e.preventDefault();
    putDay('start', n);
  } else if (e.key === 'e' || e.key === 'E') {
    e.preventDefault();
    putDay('end', n);
  }
}
const tabN = computed(() => {
  const cand = [focusN.value, sN.value, eN.value, dayNum(view.y, view.mo, 1)];
  if (yearMode.value) return cand.find((n) => n != null && fromDayNum(n).y === view.y) ?? dayNum(view.y, 1, 1);
  return (
    cand.find((n) => n != null && weeks.value.some((w) => w.days.some((d) => d.n === n && !d.out))) ??
    dayNum(view.y, view.mo, 1)
  );
});

/* ---------- the year as weeks ---------- */
const body = ref<HTMLElement | null>(null);
const { h: bodyH, w: bodyW } = useSize(body);
const showYear = computed(() => !yearMode.value && (bodyH.value === 0 || bodyH.value > 15.5 * remPx.value));
/** Room under the numbers for the lunar line: rows of at least about 2.3rem. */
/** Days grow with the room they have (a calendar filling the screen): 1 is the usual size. */
const mScale = computed(() => {
  const r = remPx.value,
    W = bodyW.value,
    H = bodyH.value;
  if (!W || !H) return 1;
  const cw = (W - 1.9 * r) / 7,
    ch = (H - (showYear.value ? 3.4 : 0) * r - 3.5 * r) / 6;
  return Math.max(1, Math.min(2.2, Math.min(cw, ch * 1.25) / (3.4 * r)));
});
const lunRoom = computed(
  () =>
    bodyH.value === 0 ||
    (bodyH.value - (showYear.value ? 3.4 : 0) * remPx.value - 3.5 * remPx.value) / 6 >= 2.25 * remPx.value,
);
const yearWeeks = computed(() => {
  const count = isoWeeksInYear(view.y);
  return Array.from({ length: count }, (_, i) => {
    const k = i + 1,
      st = isoWeekStart(view.y, k),
      n0 = dayNum(st.y, st.mo, st.d),
      th = fromDayNum(n0 + 3),
      en = fromDayNum(n0 + 6);
    return {
      k,
      n0,
      mo: th.mo,
      inR: lo.value != null && hi.value != null && n0 <= hi.value && n0 + 6 >= lo.value,
      s: sN.value >= n0 && sN.value <= n0 + 6,
      e: eN.value != null && eN.value >= n0 && eN.value <= n0 + 6,
      today: todayN.value >= n0 && todayN.value <= n0 + 6,
      cur: th.mo === view.mo && th.y === view.y,
      tip: `W${k}（${st.mo}/${st.d}–${en.mo}/${en.d}）`,
    };
  });
});
const monthTicks = computed(() => {
  const all = bodyW.value > 24 * remPx.value;
  const yw = yearWeeks.value;
  const out: { mo: number; x: number }[] = [];
  for (let m = 1; m <= 12; m++) {
    if (!all && (m - 1) % 3) continue;
    const i = yw.findIndex((w) => w.mo === m);
    if (i >= 0) out.push({ mo: m, x: i / yw.length });
  }
  return out;
});
/** A week on the year strip is the same thing as a week number in the grid: clicking picks it (and shows its month). */
function goWeek(w: { n0: number }) {
  const th = fromDayNum(w.n0 + 3);
  view.y = th.y;
  view.mo = th.mo;
  pickWeek(w.n0);
}

/* ---------- the whole year: twelve small months, laid out to the panel's shape ---------- */
/** Columns of months, cell sizes and type size: the arrangement (2, 3, 4 or 6 across) whose days come out squarest. */
const yl = computed(() => {
  const r = remPx.value,
    W = bodyW.value || 24 * r,
    H = (bodyH.value || 24 * r) - 1.85 * r;
  const gx = 1.1 * r,
    gy = 0.75 * r,
    titleH = 1.45 * r,
    headH = 1.05 * r;
  let cols = 3,
    best = Infinity;
  for (const c of [2, 3, 4, 6]) {
    const rows = 12 / c,
      mw = (W - gx * (c - 1)) / c,
      mh = (H - gy * (rows - 1)) / rows;
    const score = Math.abs(Math.log(mw / 7 / Math.max(1, (mh - titleH - headH) / 6)));
    if (score < best) {
      best = score;
      cols = c;
    }
  }
  const rows = 12 / cols,
    mw = (W - gx * (cols - 1)) / cols,
    mh = (H - gy * (rows - 1)) / rows;
  const cw = mw / 7,
    ch = Math.max(4, (mh - titleH - headH) / 6);
  const lun = S.prefs.lunar && ch >= 2.1 * r && cw >= 1.9 * r;
  const fs = Math.max(8, Math.min(cw * 0.46, lun ? ch * 0.4 : ch * 0.58, 1.15 * r));
  const dot = Math.max(8, Math.min(cw * 0.9, lun ? ch * 0.6 : ch * 0.94, 2.6 * r));
  return { cols, rows, fs, dot, lun, head: Math.max(8, Math.min(fs * 0.85, 0.85 * r)) };
});
interface YDay {
  n: number;
  d: number;
  today: boolean;
  s: boolean;
  e: boolean;
  inR: boolean;
  rL: boolean;
  rR: boolean;
  wkend: boolean;
  label: string;
  lun: Lun | null;
}
const yearMonths = computed(() => {
  if (!yearMode.value) return [];
  const room = yl.value.lun;
  return Array.from({ length: 12 }, (_, i) => {
    const mo = i + 1,
      n1 = dayNum(view.y, mo, 1),
      len = dim(view.y, mo),
      first = weekStartOf(n1);
    const cells: (YDay | null)[] = Array.from({ length: 42 }, (_, k) => {
      const n = first + k;
      if (n < n1 || n >= n1 + len) return null;
      const c = k % 7,
        d = n - n1 + 1,
        wd = mod(n + 4, 7);
      const inR = lo.value != null && hi.value != null && n >= lo.value && n <= hi.value && lo.value !== hi.value;
      const s = n === dS.value,
        e = n === dE.value,
        lun = lunarLabel(n, room);
      return {
        n,
        d,
        today: n === todayN.value,
        s,
        e,
        inR,
        lun,
        wkend: wd === 0 || wd === 6,
        rL: inR && (n === lo.value || c === 0 || d === 1),
        rR: inR && (n === hi.value || c === 6 || d === len),
        label: `${view.y} 年 ${mo} 月 ${d} 日 週${WD[wd]}${lun ? `，${lun.full}` : ''}${s ? '，開始' : ''}${e ? '，結束' : ''}${n === todayN.value ? '，今天' : ''}`,
      };
    });
    const ym = view.y * 100 + mo;
    return { mo, cells, s: sYM.value === ym, e: eYM.value === ym, today: tYM.value === ym };
  });
});
const atStartY = computed(() => view.y === startWall.value.y);
const atEndY = computed(() => !endWall.value || view.y === endWall.value.y);

const mondayOf = (n: number) => n - mod(n + 3, 7);
type FootSeg = { t: string; b?: boolean; act?: End };
const foot = computed<FootSeg[]>(() => {
  const sw = startWall.value,
    iw = isoWeek(sw.y, sw.mo, sw.d);
  if (eN.value == null || !endWall.value) {
    const left = isoWeeksInYear(iw.weekYear) - iw.week;
    return [
      { t: `W${iw.week}`, b: true, act: 'start' },
      { t: ` · ${sw.y} 年第 ${dayOfYear(sw.y, sw.mo, sw.d)} 天，共 ${daysInYear(sw.y)} 天 · ` },
      {
        t: left ? `今年還剩 ${left} 週（最後一週 W${isoWeeksInYear(iw.weekYear)}）` : `這是 ${iw.weekYear} 年最後一週`,
      },
    ];
  }
  const ew = endWall.value,
    ie = isoWeek(ew.y, ew.mo, ew.d);
  const weeksApart = Math.abs(mondayOf(eN.value) - mondayOf(sN.value)) / 7;
  const days = Math.abs(eN.value - sN.value) + 1;
  return [
    { t: `W${iw.week}${iw.weekYear !== ie.weekYear ? `（${iw.weekYear}）` : ''}`, b: true, act: 'start' },
    { t: ' → ', b: true },
    { t: `W${ie.week}`, b: true, act: 'end' },
    { t: ` · 相隔 ${weeksApart} 週 · 含頭尾 ` },
    { t: `${nf(days)} 天`, b: true },
  ];
});
/* A week label is typed over where it is: W12, 12, 2027-W02. The end keeps its weekday and time. */
const weekEdit = ref<End | null>(null);
const weekText = ref('');
const weekEl = ref<HTMLInputElement | null>(null);
const setWeekEl = (el: unknown) => {
  if (el) weekEl.value = el as HTMLInputElement;
};
function typeWeek(which: End) {
  const w = which === 'start' ? startWall.value : endWall.value;
  if (!w) return;
  const iw = isoWeek(w.y, w.mo, w.d);
  S.active = which;
  weekEdit.value = which;
  weekText.value = `W${iw.week}`;
  nextTick(() => {
    weekEl.value?.focus();
    weekEl.value?.select();
  });
}
function applyWeek() {
  const which = weekEdit.value;
  weekEdit.value = null;
  if (!which) return;
  const w = which === 'start' ? startWall.value : endWall.value;
  if (!w) return;
  const m = /^(?:(\d{4})\s*[-/年]?\s*)?(?:W|第)?\s*(\d{1,2})\s*週?$/i.exec(weekText.value.trim());
  if (!m) {
    toast('看不懂這個週次，試試 W12 或 2027-W02');
    return;
  }
  const iw = isoWeek(w.y, w.mo, w.d);
  const y = m[1] ? +m[1] : iw.weekYear,
    k = +m[2];
  if (k < 1 || k > isoWeeksInYear(y)) {
    toast(`${y} 年只有第 1–${isoWeeksInYear(y)} 週`);
    return;
  }
  const st = isoWeekStart(y, k);
  putDay(which, dayNum(st.y, st.mo, st.d) + iw.weekday - 1);
}
function weekKey(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault();
    applyWeek();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    weekEdit.value = null;
  }
}
const atStart = computed(() => view.y === startWall.value.y && view.mo === startWall.value.mo);
const atEnd = computed(() => !endWall.value || (view.y === endWall.value.y && view.mo === endWall.value.mo));
</script>

<template>
  <section class="panel cal" aria-label="月曆" @wheel="onWheel($event, 'mo')">
    <header class="panel-head">
      <Icon name="cal" class="ph-ic" />
      <h2 class="cal-title mono" aria-live="off">
        <button
          ref="titleBtn"
          type="button"
          class="cal-tbtn"
          :aria-expanded="jump"
          aria-haspopup="dialog"
          :aria-label="`${view.y} 年 ${view.mo} 月，跳到年月`"
          v-tip="'跳到年月（滾輪換月／年）'"
          @click="jump = !jump"
        >
          {{ yearMode ? `${view.y} 年` : `${view.y} 年 ${view.mo} 月` }}<Icon name="chevD" />
        </button>
      </h2>
      <span class="cal-nav">
        <button
          type="button"
          class="icon-btn sm"
          :aria-label="yearMode ? '前一年' : '上個月'"
          v-tip="yearMode ? '前一年' : '上個月'"
          @click="step(-1)"
        >
          <Icon name="chevL" />
        </button>
        <button
          type="button"
          class="icon-btn sm"
          :aria-label="yearMode ? '下一年' : '下個月'"
          v-tip="yearMode ? '下一年' : '下個月'"
          @click="step(1)"
        >
          <Icon name="chevR" />
        </button>
      </span>
      <span class="seg-ctl cal-mode" role="group" aria-label="月曆或年曆">
        <button type="button" :aria-pressed="!yearMode" v-tip="'一個月（Y 切換）'" @click="setMode('month')">月</button>
        <button type="button" :aria-pressed="yearMode" v-tip="'整年 12 個月（Y 切換）'" @click="setMode('year')">
          年
        </button>
      </span>
      <span v-if="yearMode" class="cal-jump">
        <button v-if="!atStartY" type="button" class="chip sm" v-tip="'看開始的那一年'" @click="setView(startWall)">
          <i class="node" />{{ startWall.y }}
        </button>
        <button
          v-if="!atEndY && endWall"
          type="button"
          class="chip sm"
          v-tip="'看結束的那一年'"
          @click="setView(endWall)"
        >
          <i class="node end" />{{ endWall.y }}
        </button>
      </span>
      <span v-else class="cal-jump">
        <button v-if="!atStart" type="button" class="chip sm" v-tip="'看開始的月份'" @click="setView(startWall)">
          <i class="node" />{{ startWall.y !== view.y ? `${startWall.y}/${startWall.mo}` : `${startWall.mo} 月` }}
        </button>
        <button v-if="!atEnd && endWall" type="button" class="chip sm" v-tip="'看結束的月份'" @click="setView(endWall)">
          <i class="node end" />{{ endWall.y !== view.y ? `${endWall.y}/${endWall.mo}` : `${endWall.mo} 月` }}
        </button>
      </span>
    </header>
    <div ref="body" class="cal-body" :style="{ '--ms': yearMode ? 1 : mScale }">
      <div
        v-if="yearMode"
        class="yg"
        :class="{ lun: yl.lun }"
        role="group"
        :aria-label="`${view.y} 年`"
        :style="{
          gridTemplateColumns: `repeat(${yl.cols}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${yl.rows}, minmax(0, 1fr))`,
          '--yd': yl.fs + 'px',
          '--ydot': yl.dot + 'px',
          '--yh': yl.head + 'px',
        }"
        @pointerdown="gDown"
        @pointermove="gMove"
        @pointerup="gUp"
        @pointercancel="gUp"
      >
        <div v-for="m in yearMonths" :key="m.mo" class="ym" role="group" :aria-label="`${m.mo} 月`">
          <button
            type="button"
            class="ym-t"
            :class="{ today: m.today }"
            :aria-label="`打開 ${view.y} 年 ${m.mo} 月`"
            @click="openMonth(m.mo)"
          >
            {{ m.mo }}月<i v-if="m.s" class="node" /><i v-if="m.e" class="node end" />
          </button>
          <div class="ym-h" aria-hidden="true">
            <span v-for="h in heads" :key="h.t" :class="{ we: h.we }">{{ h.t }}</span>
          </div>
          <div class="ym-g">
            <template v-for="(d, k) in m.cells" :key="k">
              <span v-if="!d" />
              <button
                v-else
                type="button"
                class="day"
                :data-n="d.n"
                :tabindex="d.n === tabN ? 0 : -1"
                :aria-label="d.label"
                :aria-pressed="d.s || d.e"
                :class="{ today: d.today, s: d.s, e: d.e, inR: d.inR, rL: d.rL, rR: d.rR, we: d.wkend }"
                @keydown="dayKey($event, d.n)"
                @focus="focusN = d.n"
              >
                <span class="dn mono">{{ d.d }}</span>
                <span v-if="d.lun" class="ln" :class="`ln-${d.lun.k}`" aria-hidden="true">{{ d.lun.t }}</span>
              </button>
            </template>
          </div>
        </div>
      </div>
      <div
        v-else
        class="grid"
        :class="{ lun: S.prefs.lunar && lunRoom }"
        role="grid"
        :aria-label="`${view.y} 年 ${view.mo} 月`"
        @pointerdown="gDown"
        @pointermove="gMove"
        @pointerup="gUp"
        @pointercancel="gUp"
      >
        <div class="gh" role="row">
          <span class="wkc" role="columnheader" v-tip="ws ? 'ISO 週（週一起算）' : '美式週次（週日起算）'">週</span>
          <span v-for="h in heads" :key="h.t" role="columnheader" :class="{ we: h.we }">{{ h.t }}</span>
        </div>
        <div v-for="wk in weeks" :key="wk.n0" class="gr" role="row">
          <button
            type="button"
            class="wkc mono"
            role="rowheader"
            :class="{ hit: wk.days.some((d) => d.s || d.e) }"
            :aria-label="`選取第 ${wk.wk} 週`"
            v-tip="`選取 W${wk.wk} 整週`"
            @click="pickWeek(wk.n0)"
          >
            {{ wk.wk }}
          </button>
          <button
            v-for="d in wk.days"
            :key="d.n"
            type="button"
            role="gridcell"
            class="day"
            :data-n="d.n"
            :tabindex="d.n === tabN ? 0 : -1"
            :aria-label="d.label"
            :aria-selected="d.s || d.e"
            :class="{ out: d.out, today: d.today, s: d.s, e: d.e, inR: d.inR, rL: d.rL, rR: d.rR, we: d.wkend }"
            @keydown="dayKey($event, d.n)"
            @focus="focusN = d.n"
          >
            <span class="dn mono">{{ d.d }}</span>
            <span v-if="d.lun" class="ln" :class="`ln-${d.lun.k}`" aria-hidden="true">{{ d.lun.t }}</span>
          </button>
        </div>
      </div>
      <div v-if="showYear" class="year" @wheel.stop="onWheel($event, 'y')">
        <div class="yw" role="group" :aria-label="`${view.y} 年的 ${yearWeeks.length} 週`">
          <button
            v-for="w in yearWeeks"
            :key="w.k"
            type="button"
            class="w"
            :class="{ inR: w.inR, s: w.s, e: w.e, today: w.today, cur: w.cur }"
            :aria-label="w.tip"
            v-tip="w.tip"
            @click="goWeek(w)"
          />
        </div>
        <div class="yt">
          <button
            v-for="t in monthTicks"
            :key="t.mo"
            type="button"
            :class="{ cur: t.mo === view.mo }"
            :style="{ left: t.x * 100 + '%' }"
            :aria-label="`看 ${view.y} 年 ${t.mo} 月`"
            @click="view.mo = t.mo"
          >
            {{ t.mo }}月
          </button>
        </div>
      </div>
      <p class="cal-foot">
        <template v-for="(f, i) in foot" :key="i"
          ><input
            v-if="f.act && weekEdit === f.act"
            :ref="setWeekEl"
            v-model="weekText"
            class="wk-in mono"
            :aria-label="`${f.act === 'start' ? '開始' : '結束'}的週次`"
            spellcheck="false"
            autocomplete="off"
            @keydown="weekKey"
            @blur="applyWeek"
          /><button
            v-else-if="f.act"
            type="button"
            class="wk-ed editable"
            v-tip="'點選改寫週次'"
            @click="typeWeek(f.act)"
          >
            {{ f.t }}</button
          ><b v-else-if="f.b">{{ f.t }}</b
          ><template v-else>{{ f.t }}</template></template
        >
      </p>
    </div>
    <Popover :open="jump" :anchor="titleBtn" label="跳到年月" width="18.5rem" @close="jump = false">
      <div class="jp">
        <div class="jp-year">
          <button
            type="button"
            class="icon-btn sm jp-10"
            aria-label="往前 10 年"
            v-tip="'往前 10 年'"
            @click="yearStep(-10)"
          >
            −10
          </button>
          <button type="button" class="icon-btn sm" aria-label="前一年" v-tip="'前一年'" @click="yearStep(-1)">
            <Icon name="chevL" />
          </button>
          <label class="jp-field"
            ><input
              ref="yearInput"
              v-model="yearText"
              class="jp-in mono"
              inputmode="numeric"
              maxlength="4"
              aria-label="年份（1–9999）"
              @input="yearLive"
              @keydown.enter.prevent="yearEnter"
              @keydown.up.prevent="yearStep(1)"
              @keydown.down.prevent="yearStep(-1)"
              @wheel.prevent.stop="onWheel($event, 'y')"
            /><span>年</span></label
          >
          <button type="button" class="icon-btn sm" aria-label="下一年" v-tip="'下一年'" @click="yearStep(1)">
            <Icon name="chevR" />
          </button>
          <button
            type="button"
            class="icon-btn sm jp-10"
            aria-label="往後 10 年"
            v-tip="'往後 10 年'"
            @click="yearStep(10)"
          >
            +10
          </button>
        </div>
        <div class="jp-months" role="group" :aria-label="`${view.y} 年的月份`">
          <button
            v-for="m in monthMarks"
            :key="m.mo"
            type="button"
            class="jp-m"
            :class="{ cur: m.cur, today: m.today }"
            :aria-pressed="m.cur"
            :aria-label="`${view.y} 年 ${m.mo} 月${m.s ? '，有開始' : ''}${m.e ? '，有結束' : ''}${m.today ? '，今天' : ''}`"
            @click="pickMonth(m.mo)"
          >
            {{ m.mo }}月<span v-if="m.s || m.e" class="jp-marks" aria-hidden="true"
              ><i v-if="m.s" class="node" /><i v-if="m.e" class="node end"
            /></span>
          </button>
        </div>
        <div class="jp-quick">
          <button type="button" class="chip sm" @click="gotoWall(todayWall)">
            <i class="dot-now" aria-hidden="true" />今天
          </button>
          <button type="button" class="chip sm" @click="gotoWall(startWall)">
            <i class="node" aria-hidden="true" />開始 {{ startWall.y }}/{{ startWall.mo }}
          </button>
          <button v-if="endWall" type="button" class="chip sm" @click="gotoWall(endWall)">
            <i class="node end" aria-hidden="true" />結束 {{ endWall.y }}/{{ endWall.mo }}
          </button>
        </div>
      </div>
    </Popover>
  </section>
</template>

<style scoped>
.ph-ic {
  color: var(--ink-3);
}
.cal-title {
  font-size: 0.98rem !important;
  font-weight: 600 !important;
  letter-spacing: -0.01em;
}
.cal-tbtn {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  height: 1.9rem;
  margin: 0 -0.1rem 0 -0.4rem;
  padding: 0 0.35rem 0 0.4rem;
  border-radius: 0.55rem;
  font: inherit;
  color: inherit;
  letter-spacing: inherit;
}
.cal-tbtn .ic {
  width: 0.9em;
  height: 0.9em;
  color: var(--ink-3);
  transition: transform 0.15s;
}
.cal-tbtn:hover {
  background: var(--accent-wash);
  color: var(--accent);
}
.cal-tbtn:hover .ic,
.cal-tbtn[aria-expanded='true'] .ic {
  color: var(--accent);
}
.cal-tbtn[aria-expanded='true'] .ic {
  transform: rotate(180deg);
}
.jp {
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
  padding: 0.85rem 0.9rem 0.9rem;
}
.jp-year {
  display: flex;
  align-items: center;
  gap: 0.15rem;
}
.jp-10 {
  width: auto !important;
  padding: 0 0.4rem;
  font: 600 var(--fs-xs)/1 var(--f-mono);
  font-stretch: 75%;
  color: var(--ink-3);
}
.jp-field {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 0.25rem;
  height: 2.2rem;
  padding: 0 0.5rem;
  border-radius: 0.6rem;
  border: 1px solid var(--hair-2);
  background: var(--surface-2);
  cursor: text;
}
.jp-field:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-wash);
}
.jp-in {
  width: 4.2ch;
  border: 0;
  background: none;
  padding: 0;
  font-size: 1.2rem;
  font-weight: 650;
  text-align: right;
  color: var(--ink);
  line-height: 2.1rem;
  outline: none;
}
.jp-field span {
  font-size: var(--fs-s);
  color: var(--ink-3);
}
.jp-months {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.25rem;
}
.jp-m {
  position: relative;
  height: 2.2rem;
  border-radius: 0.55rem;
  font-size: 0.88rem;
  color: var(--ink);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.2rem;
}
.jp-m:hover {
  background: var(--accent-wash);
  color: var(--accent);
}
.jp-m.cur {
  background: var(--accent);
  color: var(--accent-ink);
  font-weight: 650;
}
.jp-m.today:not(.cur) {
  box-shadow: inset 0 0 0 1.5px var(--now);
}
.jp-marks {
  display: inline-flex;
  gap: 0.1rem;
}
.jp-marks .node {
  font-size: 0.55rem;
}
.jp-m.cur .node {
  color: var(--accent-ink);
}
.jp-quick {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
}
.jp-quick .node {
  font-size: var(--fs-xs);
}
.dot-now {
  display: inline-block;
  width: 0.45rem;
  height: 0.45rem;
  border-radius: 50%;
  background: var(--now);
}
.cal-nav {
  display: flex;
  gap: 0;
  margin-left: -0.2rem;
}
.cal-jump {
  display: flex;
  gap: 0.3rem;
  margin-left: auto;
  min-width: 0;
}
.cal-mode {
  padding: 0.12rem;
  border-radius: 0.65rem;
}
.cal-mode button {
  height: 1.5rem;
  padding: 0 0.5rem;
  font-size: var(--fs-xs);
  border-radius: 0.5rem;
}
/* the whole year */
.yg {
  flex: 1;
  min-height: 0;
  display: grid;
  gap: 0.75rem 1.1rem;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
}
.ym {
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-rows: max(1.45rem, calc(var(--yd) * 1.65)) max(1.05rem, calc(var(--yh) * 1.35)) minmax(0, 1fr);
}
.ym-t {
  justify-self: start;
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0 0.35rem;
  margin-left: -0.35rem;
  border-radius: 0.45rem;
  font-size: max(0.84rem, calc(var(--yd) * 1.04));
  font-weight: 650;
  color: var(--ink-2);
  white-space: nowrap;
}
.ym-t:hover {
  background: var(--accent-wash);
  color: var(--accent);
}
.ym-t.today {
  color: var(--now);
}
.ym-t .node {
  font-size: 0.62rem;
}
.ym-h,
.ym-g {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  min-height: 0;
}
.ym-h span {
  display: grid;
  place-items: center;
  font-size: var(--yh);
  color: var(--ink-4);
  line-height: 1;
  overflow: hidden;
}
.ym-g {
  grid-template-rows: repeat(6, minmax(0, 1fr));
}
.yg .dn {
  width: var(--ydot);
  height: var(--ydot);
  max-height: none;
  aspect-ratio: auto;
  font-size: var(--yd);
}
.yg.lun .day {
  grid-template-rows: minmax(0, 1fr) auto;
  align-content: center;
  gap: 0;
}
.yg.lun .dn {
  align-self: end;
}
.yg .ln {
  font-size: max(8px, min(0.6rem, calc(var(--yd) * 0.72)));
}
.icon-btn.sm {
  width: 2rem;
  height: 2rem;
  border-radius: 0.65rem;
}
.chip.sm {
  height: 1.7rem;
  padding: 0 0.5rem;
  font-size: var(--fs-xs);
  gap: 0.3rem;
}
.chip.sm .node {
  font-size: var(--fs-xs);
}
.cal-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  padding: 0.4rem 0.9rem 0.75rem;
}
.grid {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-rows: calc(1.5rem * (0.65 + 0.35 * var(--ms, 1))) repeat(6, minmax(0, 1fr));
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
}
.gh,
.gr {
  display: grid;
  grid-template-columns: calc(1.9rem * (0.7 + 0.3 * var(--ms, 1))) repeat(7, minmax(0, 1fr));
  align-items: stretch;
  min-height: 0;
}
.gh span {
  display: grid;
  place-items: center;
  font-size: calc(var(--fs-xs) * (0.62 + 0.38 * var(--ms, 1)));
  font-weight: 600;
  color: var(--ink-3);
}
.gh span.we {
  color: var(--ink-3);
}
.wkc {
  display: grid;
  place-items: center;
  font-size: calc(var(--fs-xs) * (0.62 + 0.38 * var(--ms, 1)));
  color: var(--ink-3);
}
button.wkc {
  padding: 0;
  border-radius: 0.45rem;
  margin: 12% 0.15rem;
  cursor: pointer;
}
button.wkc:hover {
  background: var(--accent-wash);
  color: var(--accent);
}
.wkc.hit {
  color: var(--accent);
  font-weight: 600;
}
.day {
  position: relative;
  display: grid;
  place-items: center;
  min-height: 0;
  padding: 0;
  color: var(--ink);
  cursor: pointer;
}
.day::before {
  content: '';
  position: absolute;
  inset: max(12%, calc(50% - 1.45rem * var(--ms, 1))) 0;
  background: transparent;
}
.day.inR::before {
  background: var(--accent-wash-2);
}
.day.rL::before {
  border-top-left-radius: 99rem;
  border-bottom-left-radius: 99rem;
  left: 6%;
}
.day.rR::before {
  border-top-right-radius: 99rem;
  border-bottom-right-radius: 99rem;
  right: 6%;
}
.grid.lun .day {
  grid-template-rows: minmax(0, 1fr) auto;
  align-content: center;
  gap: 0;
}
.grid.lun .dn {
  width: min(calc(1.85rem * var(--ms, 1)), 86%);
  max-height: 78%;
  align-self: end;
}
.ln {
  position: relative;
  z-index: 1;
  font-size: max(9px, calc(0.6rem * var(--ms, 1)));
  line-height: 1.1;
  color: var(--ink-3);
  white-space: nowrap;
  overflow: hidden;
  max-width: 100%;
  text-overflow: clip;
  letter-spacing: -0.02em;
  align-self: start;
  padding-top: 0.05rem;
}
.ln-mo {
  color: var(--ink-2);
  font-weight: 650;
}
.ln-term {
  color: var(--accent);
  font-weight: 600;
}
.ln-fest {
  color: var(--now);
  font-weight: 650;
}
.day.out .ln {
  opacity: 0.6;
}
.day.s .ln,
.day.e .ln {
  font-weight: 650;
}
.dn {
  position: relative;
  z-index: 1;
  display: grid;
  place-items: center;
  width: min(calc(2.15rem * var(--ms, 1)), 92%);
  aspect-ratio: 1;
  max-height: 92%;
  border-radius: 50%;
  font-size: calc(0.86rem * var(--ms, 1));
  font-weight: 500;
  transition:
    background 0.12s,
    color 0.12s;
}
.day:hover .dn {
  background: var(--well-2);
}
.day.out {
  color: var(--ink-3);
}
.day.out .dn {
  font-weight: 400;
}
.day.we:not(.s):not(.e) {
  color: var(--ink-2);
}
.day.out.we:not(.s):not(.e) {
  color: var(--ink-3);
}
.day.today .dn {
  box-shadow: inset 0 0 0 1.5px var(--now);
}
.day.s .dn {
  background: var(--accent);
  color: var(--accent-ink);
  font-weight: 650;
}
.day.e .dn {
  background: var(--surface-2);
  color: var(--accent);
  font-weight: 650;
  box-shadow: inset 0 0 0 2px var(--accent);
}
.day.s.e .dn {
  background: var(--accent);
  color: var(--accent-ink);
  box-shadow:
    0 0 0 2px var(--surface),
    0 0 0 3.5px var(--accent);
}
.day:focus-visible {
  outline: none;
}
.day:focus-visible .dn {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.year {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  padding-left: calc(1.9rem * (0.7 + 0.3 * var(--ms, 1)));
}
.yw {
  display: flex;
  gap: 1px;
  height: 1.35rem;
}
.w {
  flex: 1;
  min-width: 0;
  border-radius: 2px;
  background: var(--well-2);
  padding: 0;
  position: relative;
  transition: background 0.12s;
}
.w:hover {
  background: var(--ink-4);
}
.w.cur {
  background: var(--h2);
}
.w.inR {
  background: var(--accent);
  opacity: 0.5;
}
.w.inR.cur {
  opacity: 0.75;
}
.w.s,
.w.e {
  background: var(--accent);
  opacity: 1;
}
.w.e {
  box-shadow: inset 0 0 0 1.5px var(--accent);
  background: var(--surface-2);
}
.w.today::after {
  content: '';
  position: absolute;
  left: 50%;
  bottom: -0.32rem;
  width: 0.26rem;
  height: 0.26rem;
  margin-left: -0.13rem;
  border-radius: 50%;
  background: var(--now);
}
.yt {
  position: relative;
  height: 0.95rem;
}
.yt button {
  position: absolute;
  top: 0;
  padding: 0 0.15rem;
  margin-left: -0.15rem;
  border-radius: 0.3rem;
  font-size: var(--fs-xs);
  line-height: 0.95rem;
  color: var(--ink-3);
  white-space: nowrap;
}
.yt button:hover {
  color: var(--accent);
  background: var(--accent-wash);
}
.yt button.cur {
  color: var(--ink);
  font-weight: 650;
}
.cal-foot {
  flex: none;
  font-size: calc(0.86rem * (0.72 + 0.28 * var(--ms, 1)));
  color: var(--ink-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cal-foot b,
.cal-foot .wk-ed {
  font-family: var(--f-mono);
  font-stretch: 75%;
  font-weight: 600;
  font-size: 1em;
  color: var(--ink);
}
.cal-foot .wk-ed {
  padding: 0 0.1rem;
  border-radius: 0.3rem;
}
.cal-foot .wk-in {
  width: 5.5rem;
  height: 1.45rem;
  padding: 0 0.3rem;
  border-radius: 0.4rem;
  border: 1.5px solid var(--accent);
  background: var(--surface-2);
  font-size: 0.88rem;
  color: var(--ink);
}
/* a finger needs more than the drawn size: the year strip's weeks are taller to touch */
@media (pointer: coarse) {
  .yw .w {
    min-height: 1.6rem;
  }
  .cal-nav .icon-btn {
    width: 2.3rem;
    height: 2.3rem;
  }
}
</style>
