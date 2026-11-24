<script setup lang="ts">
/* Month and year scale: the range from ● to ○ on a month grid with ISO weeks, and the whole year as a week strip.
   Click a day to move the nearer end there; drag across days to pick both; click a week number to pick that week.
   The title opens a year and month picker; the wheel turns months over the grid and years over the week strip. */
import { ref, reactive, computed, watch, nextTick } from 'vue';
import Icon from './Icon.vue';
import Popover from './Popover.vue';
import { S, type End, now, startWall, endWall, hasEnd, commit, setWall, toast, undo, bump } from '../state/store';
import { type Wall, dayNum, fromDayNum, isoWeek, isoWeeksInYear, isoWeekStart, mod, WD, partsInTz, dayOfYear, fmtDT, daysInYear } from '../core/time';
import { useSize, remPx } from '../composables/size';
import { nf } from '../core/format';
import { focusCommand } from '../state/ui';

const view = reactive({ y: startWall.value.y, mo: startWall.value.mo });
function setView(w: { y: number; mo: number } | null) { if (w) { view.y = w.y; view.mo = w.mo; } }
watch(() => startWall.value.y * 100 + startWall.value.mo, (v, o) => { if (v !== o) setView(startWall.value); });
watch(() => (endWall.value ? endWall.value.y * 100 + endWall.value.mo : null), (v, o) => { if (v != null && v !== o) setView(endWall.value); });
function shift(m: number) {
  const t = view.y * 12 + view.mo - 1 + m;
  const y = Math.floor(t / 12);
  if (y < 1 || y > 9999) return;
  view.y = y; view.mo = mod(t, 12) + 1;
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
  if (y < 1 || y > 9999) { if (!quiet) toast('年份要在 1 到 9999 之間'); return false; }
  view.y = y;
  yearText.value = String(y);
  return true;
}
const yearStep = (k: number) => gotoYear(Math.min(9999, Math.max(1, view.y + k)));
/** Typing a year moves the calendar as soon as it has four digits; Enter takes any length. */
function yearLive() { const t = yearText.value.trim(); if (/^\d{4}$/.test(t)) gotoYear(+t, true); }
function yearEnter() { const t = yearText.value.trim(); if (/^\d{1,4}$/.test(t)) gotoYear(+t); else toast('請輸入 1 到 9999 的年份'); }
function pickMonth(m: number) { view.mo = m; jump.value = false; }
function gotoWall(w: { y: number; mo: number } | null) { setView(w); yearText.value = String(view.y); jump.value = false; }
const todayWall = computed(() => partsInTz(now.value, S.startTz));
const monthMarks = computed(() => Array.from({ length: 12 }, (_, i) => {
  const m = i + 1, sw = startWall.value, ew = endWall.value, tw = todayWall.value;
  return { mo: m, cur: m === view.mo, s: sw.y === view.y && sw.mo === m, e: !!ew && ew.y === view.y && ew.mo === m, today: tw.y === view.y && tw.mo === m };
}));
let wheelAcc = 0, wheelAt = 0;
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
    if (unit === 'y' || e.shiftKey) yearStep(k); else shift(k);
  }
}
const todayN = computed(() => { const w = partsInTz(now.value, S.startTz); return dayNum(w.y, w.mo, w.d); });
const sN = computed(() => dayNum(startWall.value.y, startWall.value.mo, startWall.value.d));
const eN = computed(() => (endWall.value ? dayNum(endWall.value.y, endWall.value.mo, endWall.value.d) : null));
const drag = ref<{ a: number; b: number } | null>(null);
const lo = computed(() => (drag.value ? Math.min(drag.value.a, drag.value.b) : eN.value == null ? null : Math.min(sN.value, eN.value)));
const hi = computed(() => (drag.value ? Math.max(drag.value.a, drag.value.b) : eN.value == null ? null : Math.max(sN.value, eN.value)));
const dS = computed(() => (drag.value ? drag.value.a : sN.value));
const dE = computed(() => (drag.value ? drag.value.b : eN.value));

interface Day { n: number; d: number; out: boolean; today: boolean; s: boolean; e: boolean; inR: boolean; rL: boolean; rR: boolean; wkend: boolean; label: string }
const weeks = computed(() => {
  const n1 = dayNum(view.y, view.mo, 1);
  const first = n1 - mod(n1 + 3, 7);
  return Array.from({ length: 6 }, (_, r) => {
    const n0 = first + r * 7;
    const th = fromDayNum(n0 + 3);
    const iw = isoWeek(th.y, th.mo, th.d);
    const days: Day[] = Array.from({ length: 7 }, (_, c) => {
      const n = n0 + c, ymd = fromDayNum(n);
      const inR = lo.value != null && hi.value != null && n >= lo.value && n <= hi.value && lo.value !== hi.value;
      const s = n === dS.value, e = n === dE.value;
      return {
        n, d: ymd.d, out: ymd.mo !== view.mo, today: n === todayN.value, s, e, inR,
        rL: inR && (n === lo.value || c === 0), rR: inR && (n === hi.value || c === 6), wkend: c >= 5,
        label: `${ymd.y} 年 ${ymd.mo} 月 ${ymd.d} 日 週${WD[mod(n + 4, 7)]}${s ? '，開始' : ''}${e ? '，結束' : ''}${n === todayN.value ? '，今天' : ''}`,
      };
    });
    return { n0, wk: iw.week, wy: iw.weekYear, days };
  });
});

/* ---------- picking ---------- */
const SUBJ = { start: '開始', end: '結束' } as const;
function withDate(w: Wall, n: number): Wall { const d = fromDayNum(n); return { ...w, y: d.y, mo: d.mo, d: d.d }; }
function nearer(n: number): End {
  if (eN.value == null) return 'end';
  return Math.abs(n - sN.value) < Math.abs(n - eN.value) ? 'start' : 'end';
}
function pickDay(n: number) {
  if (eN.value == null && n === sN.value) { toast('這天已經是開始。點別的日期設定結束，或拖曳選一段'); return; }
  const which = nearer(n);
  const base = which === 'start' ? startWall.value : endWall.value || startWall.value;
  if ((which === 'start' ? sN.value : eN.value) === n) return;
  const w = withDate(base, n);
  commit(() => setWall(which, w), { label: `${SUBJ[which]}改到 ${w.mo}/${w.d}`, say: `${SUBJ[which]}：${fmtDT(w)}` });
  bump(which);
}
function pickRange(a: number, b: number) {
  const l = Math.min(a, b), h = Math.max(a, b);
  const s = withDate(startWall.value, l), e = withDate(endWall.value || startWall.value, h);
  commit(() => setWall('start', s) && setWall('end', e), { label: '選取日期範圍', say: `${s.mo}/${s.d} → ${e.mo}/${e.d}，共 ${h - l + 1} 天` });
  bump('start'); bump('end');
}
function pickWeek(n0: number) {
  const a = fromDayNum(n0), b = fromDayNum(n0 + 6), wk = isoWeek(a.y, a.mo, a.d);
  const s = withDate(startWall.value, n0), e = withDate(endWall.value || startWall.value, n0 + 6);
  commit(() => setWall('start', s) && setWall('end', e), { label: `選取 W${wk.week}`, say: `W${wk.week}：${a.mo}/${a.d}（一）→ ${b.mo}/${b.d}（日）` });
  bump('start'); bump('end');
}
let downN: number | null = null, pid = -1;
function nAt(e: PointerEvent): number | null {
  const el = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-n]');
  return el ? +el.dataset.n! : null;
}
function gDown(e: PointerEvent) {
  if (e.button > 0) return;
  const n = nAt(e);
  if (n == null) return;
  e.preventDefault();
  downN = n; pid = e.pointerId;
  try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* ok */ }
}
function gMove(e: PointerEvent) {
  if (downN == null || e.pointerId !== pid) return;
  const n = nAt(e);
  if (n == null) return;
  if (n !== downN || drag.value) drag.value = { a: downN, b: n };
}
function gUp(e: PointerEvent) {
  if (downN == null || e.pointerId !== pid) return;
  const a = downN, d = drag.value;
  downN = null; drag.value = null;
  if (e.type === 'pointercancel') return;
  if (d && d.a !== d.b) pickRange(d.a, d.b); else pickDay(a);
}
const focusN = ref<number | null>(null);
function dayKey(e: KeyboardEvent, n: number) {
  const mv: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
  let t: number | null = null;
  if (e.key in mv) t = n + mv[e.key];
  else if (e.key === 'Home') t = n - mod(n + 3, 7);
  else if (e.key === 'End') t = n - mod(n + 3, 7) + 6;
  else if (e.key === 'PageUp' || e.key === 'PageDown') {
    // a month (a year with Shift) back or forward, on the same day where the month has it
    const cur = fromDayNum(n), k = (e.key === 'PageUp' ? -1 : 1) * (e.shiftKey ? 12 : 1);
    const tt = cur.y * 12 + cur.mo - 1 + k, y = Math.floor(tt / 12), mo = mod(tt, 12) + 1;
    if (y >= 1 && y <= 9999) t = dayNum(y, mo, Math.min(cur.d, dim(y, mo)));
    else { e.preventDefault(); return; }
  }
  if (t != null) {
    e.preventDefault();
    const d = fromDayNum(t);
    if (d.mo !== view.mo || d.y !== view.y) { view.y = d.y; view.mo = d.mo; }
    focusN.value = t;
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`.cal [data-n="${t}"]`)?.focus());
  } else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickDay(n); }
}
const tabN = computed(() => {
  const cand = [focusN.value, sN.value, eN.value, dayNum(view.y, view.mo, 1)];
  return cand.find((n) => n != null && weeks.value.some((w) => w.days.some((d) => d.n === n && !d.out))) ?? dayNum(view.y, view.mo, 1);
});

/* ---------- the year as weeks ---------- */
const body = ref<HTMLElement | null>(null);
const { h: bodyH, w: bodyW } = useSize(body);
const showYear = computed(() => bodyH.value === 0 || bodyH.value > 15.5 * remPx.value);
const yearWeeks = computed(() => {
  const count = isoWeeksInYear(view.y);
  return Array.from({ length: count }, (_, i) => {
    const k = i + 1, st = isoWeekStart(view.y, k), n0 = dayNum(st.y, st.mo, st.d), th = fromDayNum(n0 + 3), en = fromDayNum(n0 + 6);
    return {
      k, n0, mo: th.mo,
      inR: lo.value != null && hi.value != null && n0 <= hi.value && n0 + 6 >= lo.value,
      s: sN.value >= n0 && sN.value <= n0 + 6, e: eN.value != null && eN.value >= n0 && eN.value <= n0 + 6,
      today: todayN.value >= n0 && todayN.value <= n0 + 6, cur: th.mo === view.mo && th.y === view.y,
      tip: `W${k}：${st.mo}/${st.d}–${en.mo}/${en.d}，點一下看 ${th.mo} 月`,
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
function goWeek(w: { n0: number }) { const th = fromDayNum(w.n0 + 3); view.y = th.y; view.mo = th.mo; }

/* ---------- the line under it ---------- */
const mondayOf = (n: number) => n - mod(n + 3, 7);
/** A week label can be clicked to type another week for that end (it opens the command bar with "W48" selected). */
type FootSeg = { t: string; b?: boolean; act?: End };
const foot = computed<FootSeg[]>(() => {
  const sw = startWall.value, iw = isoWeek(sw.y, sw.mo, sw.d);
  if (eN.value == null || !endWall.value) {
    const left = isoWeeksInYear(iw.weekYear) - iw.week;
    return [
      { t: `W${iw.week}`, b: true, act: 'start' },
      { t: ` · ${sw.y} 年第 ${dayOfYear(sw.y, sw.mo, sw.d)} 天，共 ${daysInYear(sw.y)} 天 · ` },
      { t: left ? `今年還剩 ${left} 週（最後一週 W${isoWeeksInYear(iw.weekYear)}）` : `這是 ${iw.weekYear} 年最後一週` },
    ];
  }
  const ew = endWall.value, ie = isoWeek(ew.y, ew.mo, ew.d);
  const weeksApart = Math.abs(mondayOf(eN.value) - mondayOf(sN.value)) / 7;
  const days = Math.abs(eN.value - sN.value) + 1;
  return [
    { t: `W${iw.week}${iw.weekYear !== ie.weekYear ? `（${iw.weekYear}）` : ''}`, b: true, act: 'start' }, { t: ' → ', b: true },
    { t: `W${ie.week}`, b: true, act: 'end' },
    { t: ` · 相隔 ${weeksApart} 週 · 含頭尾 ` }, { t: `${nf(days)} 天`, b: true },
  ];
});
function typeWeek(which: End) {
  const w = which === 'start' ? startWall.value : endWall.value;
  if (!w) return;
  const iw = isoWeek(w.y, w.mo, w.d);
  S.active = which;
  focusCommand(`W${iw.week}`, true);
}
const atStart = computed(() => view.y === startWall.value.y && view.mo === startWall.value.mo);
const atEnd = computed(() => !endWall.value || (view.y === endWall.value.y && view.mo === endWall.value.mo));
const tip = computed(() => (hasEnd.value ? '點一下：移動比較近的那一端到這天 · 拖曳：選一段日期' : '點一下：設為結束日期 · 拖曳：選一段日期'));
</script>

<template>
  <section class="panel cal" aria-label="月曆" @wheel="onWheel($event, 'mo')">
    <header class="panel-head">
      <Icon name="cal" class="ph-ic" />
      <h2 class="cal-title mono" aria-live="off">
        <button ref="titleBtn" type="button" class="cal-tbtn" :aria-expanded="jump" aria-haspopup="dialog" :aria-label="`${view.y} 年 ${view.mo} 月，點一下跳到別的年月`"
          v-tip="'跳到別的年月：可以直接打年份。也可以在月曆上捲動滾輪換月、在週條上捲動換年'" @click="jump = !jump">{{ view.y }} 年 {{ view.mo }} 月<Icon name="chevD" /></button>
      </h2>
      <span class="cal-nav">
        <button type="button" class="icon-btn sm" aria-label="上個月" v-tip="'上個月'" @click="shift(-1)"><Icon name="chevL" /></button>
        <button type="button" class="icon-btn sm" aria-label="下個月" v-tip="'下個月'" @click="shift(1)"><Icon name="chevR" /></button>
      </span>
      <span class="cal-jump">
        <button v-if="!atStart" type="button" class="chip sm" v-tip="'看開始的月份'" @click="setView(startWall)"><i class="node" />{{ startWall.y !== view.y ? `${startWall.y}/${startWall.mo}` : `${startWall.mo} 月` }}</button>
        <button v-if="!atEnd && endWall" type="button" class="chip sm" v-tip="'看結束的月份'" @click="setView(endWall)"><i class="node end" />{{ endWall.y !== view.y ? `${endWall.y}/${endWall.mo}` : `${endWall.mo} 月` }}</button>
      </span>
    </header>
    <div ref="body" class="cal-body">
      <div class="grid" role="grid" :aria-label="`${view.y} 年 ${view.mo} 月`" v-tip="tip" @pointerdown="gDown" @pointermove="gMove" @pointerup="gUp" @pointercancel="gUp">
        <div class="gh" role="row">
          <span class="wkc" role="columnheader" v-tip="'ISO 週次：週一開始，含 1 月 4 日的那週是第 1 週'">週</span>
          <span v-for="(d, i) in ['一', '二', '三', '四', '五', '六', '日']" :key="d" role="columnheader" :class="{ we: i >= 5 }">{{ d }}</span>
        </div>
        <div v-for="wk in weeks" :key="wk.n0" class="gr" role="row">
          <button type="button" class="wkc mono" role="rowheader" :class="{ hit: wk.days.some((d) => d.s || d.e) }" :aria-label="`選取第 ${wk.wk} 週`" v-tip="`選取 W${wk.wk} 整週（週一到週日）`" @click="pickWeek(wk.n0)">{{ wk.wk }}</button>
          <button v-for="d in wk.days" :key="d.n" type="button" role="gridcell" class="day" :data-n="d.n" :tabindex="d.n === tabN ? 0 : -1" :aria-label="d.label"
            :aria-selected="d.s || d.e" :class="{ out: d.out, today: d.today, s: d.s, e: d.e, inR: d.inR, rL: d.rL, rR: d.rR, we: d.wkend }"
            @keydown="dayKey($event, d.n)" @focus="focusN = d.n">
            <span class="dn mono">{{ d.d }}</span>
          </button>
        </div>
      </div>
      <div v-if="showYear" class="year" @wheel.stop="onWheel($event, 'y')">
        <div class="yw" role="group" :aria-label="`${view.y} 年的 ${yearWeeks.length} 週`">
          <button v-for="w in yearWeeks" :key="w.k" type="button" class="w" :class="{ inR: w.inR, s: w.s, e: w.e, today: w.today, cur: w.cur }" :aria-label="w.tip" v-tip="w.tip" @click="goWeek(w)" />
        </div>
        <div class="yt"><button v-for="t in monthTicks" :key="t.mo" type="button" :class="{ cur: t.mo === view.mo }" :style="{ left: t.x * 100 + '%' }" :aria-label="`看 ${view.y} 年 ${t.mo} 月`" @click="view.mo = t.mo">{{ t.mo }}月</button></div>
      </div>
      <p class="cal-foot"><template v-for="(f, i) in foot" :key="i"><button v-if="f.act" type="button" class="wk-ed editable" v-tip="`輸入別的週次，把${f.act === 'start' ? '開始' : '結束'}移到那一週的同一天`" @click="typeWeek(f.act)">{{ f.t }}</button><b v-else-if="f.b">{{ f.t }}</b><template v-else>{{ f.t }}</template></template></p>
    </div>
    <Popover :open="jump" :anchor="titleBtn" label="跳到年月" width="18.5rem" @close="jump = false">
      <div class="jp">
        <div class="jp-year">
          <button type="button" class="icon-btn sm jp-10" aria-label="往前 10 年" v-tip="'往前 10 年'" @click="yearStep(-10)">−10</button>
          <button type="button" class="icon-btn sm" aria-label="前一年" v-tip="'前一年'" @click="yearStep(-1)"><Icon name="chevL" /></button>
          <label class="jp-field"><input ref="yearInput" v-model="yearText" class="jp-in mono" inputmode="numeric" maxlength="4" aria-label="年份（1–9999），打完四位數就跳過去"
            @input="yearLive" @keydown.enter.prevent="yearEnter" @keydown.up.prevent="yearStep(1)" @keydown.down.prevent="yearStep(-1)" @wheel.prevent.stop="onWheel($event, 'y')" /><span>年</span></label>
          <button type="button" class="icon-btn sm" aria-label="下一年" v-tip="'下一年'" @click="yearStep(1)"><Icon name="chevR" /></button>
          <button type="button" class="icon-btn sm jp-10" aria-label="往後 10 年" v-tip="'往後 10 年'" @click="yearStep(10)">+10</button>
        </div>
        <div class="jp-months" role="group" :aria-label="`${view.y} 年的月份`">
          <button v-for="m in monthMarks" :key="m.mo" type="button" class="jp-m" :class="{ cur: m.cur, today: m.today }" :aria-pressed="m.cur"
            :aria-label="`${view.y} 年 ${m.mo} 月${m.s ? '，有開始' : ''}${m.e ? '，有結束' : ''}${m.today ? '，今天' : ''}`" @click="pickMonth(m.mo)">
            {{ m.mo }}月<span v-if="m.s || m.e" class="jp-marks" aria-hidden="true"><i v-if="m.s" class="node" /><i v-if="m.e" class="node end" /></span>
          </button>
        </div>
        <div class="jp-quick">
          <button type="button" class="chip sm" @click="gotoWall(todayWall)"><i class="dot-now" aria-hidden="true" />今天</button>
          <button type="button" class="chip sm" @click="gotoWall(startWall)"><i class="node" aria-hidden="true" />開始 {{ startWall.y }}/{{ startWall.mo }}</button>
          <button v-if="endWall" type="button" class="chip sm" @click="gotoWall(endWall)"><i class="node end" aria-hidden="true" />結束 {{ endWall.y }}/{{ endWall.mo }}</button>
        </div>
        <p class="jp-hint">跳過去之後點一天，就把比較近的那一端移到那天。</p>
      </div>
    </Popover>
  </section>
</template>

<style scoped>
.ph-ic { color: var(--ink-3); }
.cal-title { font-size: .98rem !important; font-weight: 600 !important; letter-spacing: -.01em; }
.cal-tbtn { display: inline-flex; align-items: center; gap: .25rem; height: 1.9rem; margin: 0 -.1rem 0 -.4rem; padding: 0 .35rem 0 .4rem; border-radius: .55rem; font: inherit; color: inherit; letter-spacing: inherit; }
.cal-tbtn .ic { width: .9em; height: .9em; color: var(--ink-3); transition: transform .15s; }
.cal-tbtn:hover { background: var(--accent-wash); color: var(--accent); }
.cal-tbtn:hover .ic, .cal-tbtn[aria-expanded="true"] .ic { color: var(--accent); }
.cal-tbtn[aria-expanded="true"] .ic { transform: rotate(180deg); }
.jp { display: flex; flex-direction: column; gap: .7rem; padding: .85rem .9rem .9rem; }
.jp-year { display: flex; align-items: center; gap: .15rem; }
.jp-10 { width: auto !important; padding: 0 .4rem; font: 600 var(--fs-xs)/1 var(--f-mono); font-stretch: 75%; color: var(--ink-3); }
.jp-field { flex: 1; min-width: 0; display: flex; align-items: baseline; justify-content: center; gap: .25rem; height: 2.2rem; padding: 0 .5rem; border-radius: .6rem; border: 1px solid var(--hair-2); background: var(--surface-2); cursor: text; }
.jp-field:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-wash); }
.jp-in { width: 4.2ch; border: 0; background: none; padding: 0; font-size: 1.2rem; font-weight: 650; text-align: right; color: var(--ink); line-height: 2.1rem; outline: none; }
.jp-field span { font-size: var(--fs-s); color: var(--ink-3); }
.jp-months { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: .25rem; }
.jp-m { position: relative; height: 2.2rem; border-radius: .55rem; font-size: .88rem; color: var(--ink); display: flex; align-items: center; justify-content: center; gap: .2rem; }
.jp-m:hover { background: var(--accent-wash); color: var(--accent); }
.jp-m.cur { background: var(--accent); color: var(--accent-ink); font-weight: 650; }
.jp-m.today:not(.cur) { box-shadow: inset 0 0 0 1.5px var(--now); }
.jp-marks { display: inline-flex; gap: .1rem; }
.jp-marks .node { font-size: .55rem; }
.jp-m.cur .node { color: var(--accent-ink); }
.jp-quick { display: flex; flex-wrap: wrap; gap: .3rem; }
.jp-quick .node { font-size: var(--fs-xs); }
.dot-now { display: inline-block; width: .45rem; height: .45rem; border-radius: 50%; background: var(--now); }
.jp-hint { font-size: var(--fs-xs); color: var(--ink-3); line-height: 1.5; }
.cal-nav { display: flex; gap: 0; margin-left: -.2rem; }
.cal-jump { display: flex; gap: .3rem; margin-left: auto; min-width: 0; }
.icon-btn.sm { width: 2rem; height: 2rem; border-radius: .65rem; }
.chip.sm { height: 1.7rem; padding: 0 .5rem; font-size: var(--fs-xs); gap: .3rem; }
.chip.sm .node { font-size: var(--fs-xs); }
.cal-body { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: .55rem; padding: .4rem .9rem .75rem; }
.grid { flex: 1; min-height: 0; display: grid; grid-template-rows: 1.5rem repeat(6, minmax(0, 1fr)); touch-action: none; user-select: none; -webkit-user-select: none; }
.gh, .gr { display: grid; grid-template-columns: 1.9rem repeat(7, minmax(0, 1fr)); align-items: stretch; min-height: 0; }
.gh span { display: grid; place-items: center; font-size: var(--fs-xs); font-weight: 600; color: var(--ink-3); }
.gh span.we { color: var(--ink-3); }
.wkc { display: grid; place-items: center; font-size: var(--fs-xs); color: var(--ink-3); }
button.wkc { padding: 0; border-radius: .45rem; margin: 12% .15rem; cursor: pointer; }
button.wkc:hover { background: var(--accent-wash); color: var(--accent); }
.wkc.hit { color: var(--accent); font-weight: 600; }
.day { position: relative; display: grid; place-items: center; min-height: 0; padding: 0; color: var(--ink); cursor: pointer; }
.day::before { content: ''; position: absolute; inset: 12% 0; background: transparent; }
.day.inR::before { background: var(--accent-wash-2); }
.day.rL::before { border-top-left-radius: 99rem; border-bottom-left-radius: 99rem; left: 6%; }
.day.rR::before { border-top-right-radius: 99rem; border-bottom-right-radius: 99rem; right: 6%; }
.dn { position: relative; z-index: 1; display: grid; place-items: center; width: min(2.15rem, 92%); aspect-ratio: 1; max-height: 92%; border-radius: 50%; font-size: .86rem; font-weight: 500; transition: background .12s, color .12s; }
.day:hover .dn { background: var(--well-2); }
.day.out { color: var(--ink-3); }
.day.out .dn { font-weight: 400; }
.day.we:not(.s):not(.e) { color: var(--ink-2); }
.day.out.we:not(.s):not(.e) { color: var(--ink-3); }
.day.today .dn { box-shadow: inset 0 0 0 1.5px var(--now); }
.day.s .dn { background: var(--accent); color: var(--accent-ink); font-weight: 650; }
.day.e .dn { background: var(--surface-2); color: var(--accent); font-weight: 650; box-shadow: inset 0 0 0 2px var(--accent); }
.day.s.e .dn { background: var(--accent); color: var(--accent-ink); box-shadow: 0 0 0 2px var(--surface), 0 0 0 3.5px var(--accent); }
.day:focus-visible { outline: none; }
.day:focus-visible .dn { outline: 2px solid var(--accent); outline-offset: 2px; }
.year { flex: none; display: flex; flex-direction: column; gap: .2rem; padding-left: 1.9rem; }
.yw { display: flex; gap: 1px; height: 1.35rem; }
.w { flex: 1; min-width: 0; border-radius: 2px; background: var(--well-2); padding: 0; position: relative; transition: background .12s; }
.w:hover { background: var(--ink-4); }
.w.cur { background: var(--h2); }
.w.inR { background: var(--accent); opacity: .5; }
.w.inR.cur { opacity: .75; }
.w.s, .w.e { background: var(--accent); opacity: 1; }
.w.e { box-shadow: inset 0 0 0 1.5px var(--accent); background: var(--surface-2); }
.w.today::after { content: ''; position: absolute; left: 50%; bottom: -.32rem; width: .26rem; height: .26rem; margin-left: -.13rem; border-radius: 50%; background: var(--now); }
.yt { position: relative; height: .95rem; }
.yt button { position: absolute; top: 0; padding: 0 .15rem; margin-left: -.15rem; border-radius: .3rem; font-size: var(--fs-xs); line-height: .95rem; color: var(--ink-3); white-space: nowrap; }
.yt button:hover { color: var(--accent); background: var(--accent-wash); }
.yt button.cur { color: var(--ink); font-weight: 650; }
.cal-foot { flex: none; font-size: .86rem; color: var(--ink-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cal-foot b, .cal-foot .wk-ed { font-family: var(--f-mono); font-stretch: 75%; font-weight: 600; font-size: 1em; color: var(--ink); }
.cal-foot .wk-ed { padding: 0 .1rem; border-radius: .3rem; }
</style>
