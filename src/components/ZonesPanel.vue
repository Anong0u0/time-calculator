<script setup lang="ts">
/* Day scale: the same moment in every zone. Each row shows both ends; the strips share one 24-hour axis
   where ● and ○ can be dragged. A click moves whichever end is nearer (with no end yet, it makes one, as the calendar does).
   ‹ › walk the axis a day at a time; the axis holds still while something is dragged on it.
   On touch, sliding the finger away from the strip while dragging gives minutes instead of quarter hours.
   Rows are put in order by dragging their grip. */
import { ref, computed, watch, nextTick } from 'vue';
import Icon from './Icon.vue';
import Popover from './Popover.vue';
import TzPicker from './TzPicker.vue';
import WorldMap from './WorldMap.vue';
import {
  S, type End, now, startMs, endMs, hasEnd, wallOf, tzOf, zoneRows, commit, setInstant, setStartTz, setEndTz, addZoneRow, removeZoneRow, toast, undo, pulse, bump, ZMAX, orderZones,
} from '../state/store';
import { useDragSort, moved } from '../composables/dragSort';
import { type Wall, partsInTz, offsetAt, toInstant, addDaysWall, pad, WD, wdOf, dayNum, clamp, fmtDT, fmtOffset, HOUR, MIN, DAY } from '../core/time';
import { zoneName, sameZone, tzLongName } from '../core/zones';
import { clockOf } from '../state/command';
import { useSize, remPx } from '../composables/size';
import { tipAt, hideTip } from '../composables/tip';
import { useFlash } from '../composables/flash';

const SUBJ = { start: '開始', end: '結束' } as const;
const winPick = ref<End>('start');
const winEnd = computed<End>(() => (winPick.value === 'end' && hasEnd.value ? 'end' : 'start'));
const dayKey = (w: Wall) => `${w.y}-${w.mo}-${w.d}`;
/** Days the axis was walked away from the end it shows (‹ ›). */
const dayOff = ref(0);
interface Win { a: number; b: number; tz: string; key: string; d0: Wall }
/** While something is dragged, the axis stays where it was: the dragged end can't pull the day out from under the pointer. */
const frozen = ref<Win | null>(null);
const liveWin = computed<Win>(() => {
  const which = winEnd.value, tz = tzOf(which), w = wallOf(which)!;
  const d0 = addDaysWall({ ...w, h: 0, mi: 0, s: 0 }, dayOff.value);
  return { a: toInstant(d0, tz), b: toInstant(addDaysWall(d0, 1), tz), tz, key: `${tz}|${dayKey(d0)}`, d0 };
});
const win = computed<Win>(() => frozen.value || liveWin.value);
// the end's own day changed elsewhere: show its day again
watch(() => { const w = wallOf(winEnd.value); return w ? `${winEnd.value}|${dayKey(w)}` : ''; }, () => { if (!frozen.value) dayOff.value = 0; });
function walk(k: number) { dayOff.value += k; }
/** The wheel (or a sideways swipe) over a strip turns the days, like ‹ ›. */
let zWheel = 0, zAt = 0;
function stripWheel(e: WheelEvent) {
  if (!(e.target as HTMLElement).closest('.strip')) return;
  const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
  if (!d) return;
  e.preventDefault();
  const t = Date.now();
  if (t - zAt > 400) zWheel = 0;
  zAt = t;
  zWheel += e.deltaMode === 1 ? d * 33 : d;
  if (Math.abs(zWheel) >= 60) { walk(Math.sign(zWheel)); zWheel = 0; }
}
const sameDay = computed(() => {
  if (endMs.value == null) return true;
  const e = partsInTz(endMs.value, S.endTz), s = partsInTz(startMs.value, S.startTz);
  return dayKey(e) === dayKey(s);
});
watch(hasEnd, (h) => { if (!h) winPick.value = 'start'; });
function showEnd(which: End) { winPick.value = which; dayOff.value = 0; }

/* ---------- geometry ---------- */
const body = ref<HTMLElement | null>(null);
const axis = ref<HTMLElement | null>(null);
const { w: bodyW, h: bodyH } = useSize(body);
const { w: axisW } = useSize(axis);
/* ---------- the map: beside the rows in a wide, short panel; above them otherwise ---------- */
const MAP_RATIO = 240 / 94;
const side = computed(() => {
  if (!S.map || !bodyH.value || !bodyW.value || bodyW.value < bodyH.value * 2.2) return null;
  const rem = remPx.value;
  const w = Math.min(bodyW.value * 0.42, bodyH.value * MAP_RATIO);
  if (w < 15 * rem || bodyW.value - w - 1.2 * rem < 34 * rem) return null;
  return { w: Math.floor(w), h: Math.floor(Math.min(bodyH.value, w / MAP_RATIO)) };
});
/** The width the rows get. */
const listW = computed(() => (side.value ? bodyW.value - side.value.w - 1.2 * remPx.value : bodyW.value));
const stacked = computed(() => listW.value > 0 && listW.value < 31 * remPx.value);
const baseRowH = computed(() => (stacked.value ? 3.4 : 2.95) * remPx.value);
const gap = computed(() => 0.3 * remPx.value);
const axisH = computed(() => 1.7 * remPx.value);
/** Seconds in the times once the row is wide enough. */
const withSec = computed(() => !stacked.value && listW.value >= 44 * remPx.value);
/** The work/night badge needs a little room next to the name. */
const withState = computed(() => listW.value >= 22 * remPx.value);

/** A map above the rows takes the room they leave: prefer every row plus a map at least 7rem tall,
    otherwise keep four rows and give the map what is left. */
const mapH = computed(() => {
  if (!S.map || side.value || !bodyH.value || !bodyW.value) return 0;
  const per = baseRowH.value + gap.value, rem = remPx.value;
  const natural = Math.min(bodyW.value / MAP_RATIO, bodyH.value * 0.5);
  const fixed = axisH.value + gap.value * 2;
  const allRows = zoneRows.value.length * per;
  const withAll = bodyH.value - fixed - allRows;
  if (withAll >= 7 * rem) return Math.floor(Math.min(natural, withAll));
  const minRows = Math.min(zoneRows.value.length, stacked.value ? 3 : 4);
  const withMin = bodyH.value - fixed - minRows * per - 2 * rem - gap.value;
  return withMin >= 5.5 * rem ? Math.floor(Math.min(natural, withMin)) : 0;
});
const mapNoRoom = computed(() => S.map && !!bodyH.value && mapH.value === 0 && !side.value);
/** Rows that fit under the axis; when not all fit, one slot becomes the "還有 N 個" line. */
const capacity = computed(() => {
  const avail = bodyH.value - axisH.value - gap.value - (mapH.value ? mapH.value + gap.value : 0), per = baseRowH.value + gap.value;
  if (!bodyH.value) return ZMAX;
  if (zoneRows.value.length * per - gap.value <= avail) return zoneRows.value.length;
  return Math.max(1, Math.floor((avail - 2 * remPx.value - gap.value) / per));
});

const xOf = (ms: number) => (ms - win.value.a) / (win.value.b - win.value.a);
const xs = computed(() => xOf(startMs.value));
const xe = computed(() => (endMs.value == null ? null : xOf(endMs.value)));
const xn = computed(() => xOf(now.value));
const inWin = (x: number | null) => x != null && x >= 0 && x <= 1;
const range = computed(() => {
  if (xe.value == null) return null;
  const lo = clamp(Math.min(xs.value, xe.value), 0, 1), hi = clamp(Math.max(xs.value, xe.value), 0, 1);
  return hi - lo > 0.001 ? { lo, hi } : null;
});

/* ---------- rows ---------- */
const hourCls = (h: number) => (h < 6 || h >= 22 ? 'h0' : h < 8 || h >= 20 ? 'h1' : h < 9 || h >= 18 ? 'h2' : 'h3');
interface Cell { x0: number; x1: number; h: number; cls: string; mid: boolean; label: string }
const cellCache = new Map<string, Cell[]>();
function cellsFor(id: string): Cell[] {
  const { a, b, key } = win.value;
  const ck = `${id}|${key}`;
  const hit = cellCache.get(ck);
  if (hit) return hit;
  const out: Cell[] = [];
  const p = partsInTz(a, id);
  let t = a - (p.mi * 60 + p.s) * 1000;
  for (let i = 0; t < b && i < 30; i++) {
    const lw = partsInTz(t, id);
    out.push({ x0: Math.max(0, (t - a) / (b - a)), x1: Math.min(1, (t + HOUR - a) / (b - a)), h: lw.h, cls: hourCls(lw.h), mid: lw.h === 0 && t >= a, label: lw.h === 0 ? `${lw.mo}/${lw.d}` : String(lw.h) });
    t += HOUR;
  }
  if (cellCache.size > 300) cellCache.clear();
  cellCache.set(ck, out);
  return out;
}
const labelStep = computed(() => (axisW.value / 24 * 3 >= 2.6 * remPx.value ? 3 : 6));
function showLabel(c: Cell, cells: Cell[]) {
  const room = ((c.mid ? 2.5 : 1.25) * remPx.value) / Math.max(1, axisW.value);
  if (c.x0 > 1 - room || (c.x0 === 0 && c.x1 - c.x0 < 0.03)) return false;
  if (c.mid) return true;
  if (c.h % labelStep.value) return false;
  const minGap = (2.4 * remPx.value) / Math.max(1, axisW.value);
  return !cells.some((o) => o.mid && Math.abs(o.x0 - c.x0) < minGap && o !== c);
}
function diffTxt(m: number) {
  if (!m) return '';
  const a = Math.abs(m), h = Math.floor(a / 60), mi = a % 60;
  return `${m < 0 ? '−' : '+'}${h}${mi ? ':' + pad(mi) : ''} 時`;
}
interface Row { id: string; name: string; offTxt: string; diff: string; sW: Wall; eW: Wall | null; sDay: number; eDay: number; isS: boolean; isE: boolean; removable: boolean; cells: Cell[] }
const allRows = computed<Row[]>(() => {
  const sMs = startMs.value, eMs = endMs.value;
  const sBase = partsInTz(sMs, S.startTz), baseOff = offsetAt(sMs, S.startTz);
  const eBase = eMs != null ? partsInTz(eMs, S.endTz) : null;
  return zoneRows.value.map((id) => {
    const sW = partsInTz(sMs, id), eW = eMs != null ? partsInTz(eMs, id) : null;
    const off = offsetAt(sMs, id);
    return {
      id, name: zoneName(id), offTxt: fmtOffset(off, { compact: true }), diff: diffTxt(Math.round((off - baseOff) / MIN)),
      sW, eW, sDay: dayNum(sW.y, sW.mo, sW.d) - dayNum(sBase.y, sBase.mo, sBase.d),
      eDay: eW && eBase ? dayNum(eW.y, eW.mo, eW.d) - dayNum(eBase.y, eBase.mo, eBase.d) : 0,
      isS: sameZone(id, S.startTz), isE: hasEnd.value && sameZone(id, S.endTz),
      removable: !sameZone(id, S.startTz) && !sameZone(id, S.endTz),
      cells: cellsFor(id),
    };
  });
});
const visible = computed(() => allRows.value.slice(0, capacity.value));
/** Rows grow (up to half again) into whatever height is left, so the panel has no dead space. */
const rowH = computed(() => {
  const n = visible.value.length, base = baseRowH.value;
  if (!bodyH.value || !n) return base;
  const reserve = (hidden.value.length ? 2 * remPx.value + gap.value : 0) + (mapH.value ? mapH.value + gap.value : 0);
  const per = (bodyH.value - axisH.value - reserve) / n - gap.value;
  return Math.max(base, Math.min(base * 1.45, per));
});
const hidden = computed(() => allRows.value.slice(visible.value.length));
const hm = (w: Wall) => `${pad(w.h)}:${pad(w.mi)}${withSec.value ? ':' + pad(w.s) : ''}`;

/* ---------- work or night at the instant the strips show ---------- */
type ZState = { k: 'work' | 'off' | 'wkend' | 'night'; t: string; tip: string };
const STATE_TXT = { work: ['上班', '上班時間（週一到五 9–18 時）'], off: ['下班', '下班時間'], wkend: ['週末', '週末'], night: ['深夜', '深夜（22 時到 6 時）'] } as const;
function zoneState(id: string): ZState {
  const ms = winEnd.value === 'end' && endMs.value != null ? endMs.value : startMs.value;
  const w = partsInTz(ms, id), wd = wdOf(w);
  const k: ZState['k'] = w.h < 6 || w.h >= 22 ? 'night' : wd === 0 || wd === 6 ? 'wkend' : w.h >= 9 && w.h < 18 ? 'work' : 'off';
  const at = hasEnd.value ? `${winEnd.value === 'end' ? '○ 結束' : '● 開始'}的時刻` : '這個時刻';
  return { k, t: STATE_TXT[k][0], tip: `${zoneName(id)} ${pad(w.h)}:${pad(w.mi)}（週${WD[wd]}）在${at}是${STATE_TXT[k][1]}` };
}
const dayTag = (n: number) => (n > 0 ? `+${n}天` : n < 0 ? `${n}天` : '');
const eDate = (w: Wall) => `${w.mo}/${w.d}`;

/* ---------- dragging ● ○ ---------- */
interface Drag { id: number; which: End; session: number; moved: boolean; last: number }
let drag: Drag | null = null, session = 0;
const dragging = ref<End | null>(null);
const ghost = ref<number | null>(null);
function frac(e: PointerEvent, el: HTMLElement) { const r = el.getBoundingClientRect(); return clamp((e.clientX - r.left) / r.width, 0, 1); }
/** Minutes with Alt or Shift, or (on touch) with the finger slid away from the strip; quarter hours otherwise. */
function fineAt(e: PointerEvent, el: HTMLElement) {
  if (e.altKey || e.shiftKey) return true;
  const r = el.getBoundingClientRect();
  return e.pointerType !== 'mouse' && (e.clientY < r.top - 36 || e.clientY > r.bottom + 36);
}
function snapAt(f: number, fine: boolean) { const t = win.value.a + f * (win.value.b - win.value.a); const q = fine ? MIN : 15 * MIN; return Math.round(t / q) * q; }
function nearest(f: number): End {
  // no end yet: a click makes one, the same as on the calendar
  if (!hasEnd.value) return 'end';
  const cand: [End, number][] = [];
  if (inWin(xs.value)) cand.push(['start', Math.abs(f - xs.value)]);
  if (inWin(xe.value)) cand.push(['end', Math.abs(f - xe.value!)]);
  if (!cand.length) return winEnd.value;
  cand.sort((p, q) => p[1] - q[1]);
  return cand[0][0];
}
function moveTo(which: End, t: number) {
  const cur = which === 'start' ? startMs.value : endMs.value;
  S.active = which;
  if (cur === t) return;
  commit(() => setInstant(which, t), { key: `zdrag-${drag?.session ?? ++session}`, hold: true, label: `拖曳${SUBJ[which]}` });
}
function down(e: PointerEvent, el: HTMLElement, knob?: End) {
  if (e.button > 0) return;
  e.preventDefault();
  const f = frac(e, el);
  const which = knob || nearest(f);
  frozen.value = { ...win.value };
  drag = { id: e.pointerId, which, session: ++session, moved: !knob, last: 0 };
  dragging.value = which;
  try { el.setPointerCapture(e.pointerId); } catch { /* ok */ }
  if (!knob) moveTo(which, snapAt(f, fineAt(e, el)));
  showTip(e, el, f);
}
function move(e: PointerEvent, el: HTMLElement, rowId?: string) {
  const f = frac(e, el);
  if (drag && e.pointerId === drag.id) {
    drag.moved = true;
    moveTo(drag.which, snapAt(f, fineAt(e, el)));
    showTip(e, el, f, rowId, fineAt(e, el));
    return;
  }
  if (e.pointerType !== 'mouse') return;
  ghost.value = f;
  showTip(e, el, f, rowId);
}
function up(e: PointerEvent) {
  if (!drag || e.pointerId !== drag.id) return;
  const d = drag;
  drag = null; dragging.value = null;
  // the axis may now follow the end again; stay on the day that was shown
  if (frozen.value) {
    const shown = frozen.value.d0, w = wallOf(winEnd.value);
    if (w) dayOff.value = dayNum(shown.y, shown.mo, shown.d) - dayNum(w.y, w.mo, w.d);
    frozen.value = null;
  }
  hideTip();
  if (d.moved) {
    const w = wallOf(d.which);
    if (w) toast(`${SUBJ[d.which]}改為 ${fmtDT(w)}`, undo);
    bump(d.which);
  }
}
function leave() { ghost.value = null; if (!drag) hideTip(); }
function showTip(e: PointerEvent, el: HTMLElement, f: number, rowId?: string, fine = e.altKey || e.shiftKey) {
  const t = snapAt(f, fine);
  const id = rowId || S.startTz;
  const lw = partsInTz(t, id), sw = partsInTz(t, S.startTz);
  const here = `${zoneName(id)} ${hm(lw)}（週${WD[wdOf(lw)]}）`;
  const base = sameZone(id, S.startTz) ? '' : ` ＝ ${zoneName(S.startTz)} ${hm(sw)}`;
  const act = drag ? `${drag.which === 'start' ? '●' : '○'} ${SUBJ[drag.which]}${!fine && e.pointerType !== 'mouse' ? '（手指往外拉可以調到分鐘）' : ''}`
    : hasEnd.value ? `點一下移動 ${nearest(f) === 'start' ? '● 開始' : '○ 結束'}` : '點一下設為 ○ 結束';
  const r = el.getBoundingClientRect();
  const x = r.left + f * r.width;
  tipAt(`${here}${base} · ${act}`, { left: x, right: x, top: r.top, bottom: r.bottom });
}
function knobKey(e: KeyboardEvent, which: End) {
  const step = e.shiftKey ? HOUR : 15 * MIN;
  const cur = which === 'start' ? startMs.value : endMs.value;
  if (cur == null) return;
  let t: number | null = null;
  if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') t = cur - step;
  else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') t = cur + step;
  if (t == null) return;
  e.preventDefault();
  S.active = which;
  commit(() => setInstant(which, Math.round(t! / MIN) * MIN), { key: `zkey-${which}`, label: `調整${SUBJ[which]}` });
}
const knobText = (which: End) => { const w = wallOf(which); return w ? `${SUBJ[which]} ${fmtDT(w)}（${zoneName(tzOf(which))}）` : ''; };
const knobNow = (which: End) => { const ms = which === 'start' ? startMs.value : endMs.value; return ms == null ? 0 : Math.round((ms - win.value.a) / MIN); };

/* ---------- typing a time into a row ---------- */
const edit = ref<{ id: string; which: End } | null>(null);
const editText = ref('');
const editEl = ref<HTMLInputElement | null>(null);
const setEditEl = (el: unknown) => { if (el) editEl.value = el as HTMLInputElement; };
function startEditCell(id: string, which: End, w: Wall) {
  edit.value = { id, which };
  editText.value = hm(w);
  nextTick(() => { editEl.value?.focus(); editEl.value?.select(); });
}
function applyEdit() {
  const ed = edit.value;
  if (!ed) return;
  edit.value = null;
  const ms = ed.which === 'start' ? startMs.value : endMs.value;
  if (ms == null) return;
  const base = partsInTz(ms, ed.id);
  const w = clockOf(editText.value, base);
  if (!w) { toast('看不懂這個時間，試試 15:00 或 下午3點'); return; }
  const t = toInstant(w, ed.id);
  if (t === ms) return;
  S.active = ed.which;
  commit(() => setInstant(ed.which, t), { label: `設定${SUBJ[ed.which]}`, say: () => `${zoneName(ed.id)} ${hm(w)} ＝ ${SUBJ[ed.which]} ${fmtDT(wallOf(ed.which)!)}` });
  bump(ed.which);
}
function editKey(e: KeyboardEvent) {
  if (e.key === 'Enter') { e.preventDefault(); applyEdit(); }
  else if (e.key === 'Escape') { e.preventDefault(); edit.value = null; }
}

/* ---------- menus ---------- */
const menuFor = ref<string | null>(null);
const menuAnchor = ref<HTMLElement | null>(null);
function openMenu(id: string, e: MouseEvent) { menuAnchor.value = e.currentTarget as HTMLElement; menuFor.value = menuFor.value === id ? null : id; }
/** A pin on the map opens the same menu as the zone's name. */
function pinMenu(id: string, el: HTMLElement) { menuAnchor.value = el; menuFor.value = menuFor.value === id ? null : id; }
function asStart(id: string) { commit(() => setStartTz(id), { label: `開始時區：${zoneName(id)}`, say: `開始改用${zoneName(id)}時區，同一個時刻` }); menuFor.value = null; bump('start'); }
function asEnd(id: string) { commit(() => setEndTz(id), { label: `結束時區：${zoneName(id)}`, say: `結束改用${zoneName(id)}時區，同一個時刻` }); menuFor.value = null; bump('end'); }
function remove(id: string) { commit(() => removeZoneRow(id), { label: `移除${zoneName(id)}`, say: `已移除${zoneName(id)}` }); menuFor.value = null; moreOpen.value = false; }
function toTop(id: string) { commit(() => orderZones([id, ...zoneRows.value.filter((z) => !sameZone(z, id))]), { label: `${zoneName(id)}移到上面` }); moreOpen.value = false; }
const addBtn = ref<HTMLElement | null>(null);
const addOpen = ref(false);
function add(id: string) { commit(() => addZoneRow(id), { label: `加入${zoneName(id)}`, say: `已加入${zoneName(id)}` }); }
const moreBtn = ref<HTMLElement | null>(null);
const moreOpen = ref(false);
const menuRow = computed(() => allRows.value.find((r) => r.id === menuFor.value) || null);

/* ---------- putting rows in order ---------- */
const listEl = ref<HTMLElement | null>(null);
let orderSession = 0;
const rowSort = useDragSort({
  rows: () => [...(listEl.value?.querySelectorAll<HTMLElement>(':scope > .zrow[data-id]') || [])],
  move: (from, to) => commit(() => orderZones(moved(zoneRows.value, from, to)), { key: `zorder-${orderSession}`, hold: true, label: '調整時區順序' }),
  done: (_from, to) => { toast(`${zoneName(zoneRows.value[to])}移到第 ${to + 1} 列`, undo); orderSession++; },
});

const { flashing } = useFlash(() => pulse.zones);
const winLabel = computed(() => { const d = win.value.d0; return `${d.mo}/${d.d}（${WD[wdOf(d)]}）${zoneName(win.value.tz)}`; });
const winShort = computed(() => { const d = win.value.d0; return `${d.mo}/${d.d}（${WD[wdOf(d)]}）`; });
const outRight = computed(() => (xe.value != null && xe.value > 1 ? 'end' : xs.value > 1 ? 'start' : null));
const outLeft = computed(() => (xe.value != null && xe.value < 0 ? 'end' : xs.value < 0 ? 'start' : null));
const awayText = (which: End) => {
  const ms = which === 'start' ? startMs.value : endMs.value!;
  const days = Math.round(Math.abs(ms - (ms > win.value.b ? win.value.b : win.value.a)) / DAY);
  const w = wallOf(which)!;
  return `${w.mo}/${w.d}${days >= 1 ? `（${days} 天${ms > win.value.b ? '後' : '前'}）` : ''}`;
};
</script>

<template>
  <section class="panel zp" :class="{ flash: flashing, stacked }" aria-label="時區" @animationend="flashing = false">
    <header class="panel-head">
      <Icon name="globe" class="ph-ic" />
      <h2>時區</h2>
      <span class="zday">
        <button type="button" class="icon-btn xs" aria-label="前一天" v-tip="'時區條看前一天'" @click="walk(-1)"><Icon name="chevL" /></button>
        <span class="panel-sub">{{ stacked ? winShort : `${winLabel} 的 24 小時` }}</span>
        <button type="button" class="icon-btn xs" aria-label="後一天" v-tip="'時區條看後一天'" @click="walk(1)"><Icon name="chevR" /></button>
        <button v-if="dayOff" type="button" class="chip xs" v-tip="'回到端點那一天'" @click="dayOff = 0">回到 {{ winEnd === 'end' ? '○' : '●' }}</button>
      </span>
      <div v-if="hasEnd && !sameDay" class="seg-ctl" role="group" aria-label="時區條顯示哪一天">
        <button type="button" :aria-pressed="winEnd === 'start'" aria-label="開始日" v-tip="'時區條顯示開始那一天'" @click="showEnd('start')"><i class="node" /><span class="sl">開始日</span></button>
        <button type="button" :aria-pressed="winEnd === 'end'" aria-label="結束日" v-tip="'時區條顯示結束那一天'" @click="showEnd('end')"><i class="node end" /><span class="sl">結束日</span></button>
      </div>
      <button type="button" class="icon-btn sm" :class="{ on: S.map && !mapNoRoom }" :aria-pressed="S.map" aria-label="世界地圖"
        v-tip="!S.map ? '顯示世界地圖' : mapNoRoom ? '地圖：這裡的空間不夠，放大視窗或在顯示設定調緊湊' : '隱藏世界地圖'" @click="S.map = !S.map"><Icon name="map" /></button>
      <button ref="addBtn" type="button" class="icon-btn sm" :disabled="zoneRows.length >= ZMAX" :aria-expanded="addOpen" v-tip="zoneRows.length >= ZMAX ? `最多 ${ZMAX} 個時區` : '加入時區'" aria-label="加入時區" @click="addOpen = !addOpen"><Icon name="plus" /></button>
    </header>

    <div ref="body" class="zbody" :class="{ sec: withSec, side: !!side }" :style="{ '--rowh': rowH + 'px' }">
      <WorldMap v-if="side" class="zmap-side" :which="winEnd" :zones="zoneRows" :height="side.h" :width="side.w" @pin="pinMenu" @add="add" />
      <div ref="listEl" class="zlist" @wheel="stripWheel">
      <WorldMap v-if="mapH" :which="winEnd" :zones="zoneRows" :height="mapH" :width="bodyW" @pin="pinMenu" @add="add" />
      <!-- the shared axis: ● and ○ live here -->
      <div class="zrow zaxis">
        <span v-if="!stacked" class="zc-name zc-axis-l"><em class="scale-cap">一天</em>{{ zoneName(win.tz) }}</span>
        <span v-if="!stacked" class="zc-times" />
        <div ref="axis" class="strip axis" @pointerdown="down($event, $event.currentTarget as HTMLElement)" @pointermove="move($event, $event.currentTarget as HTMLElement)" @pointerup="up" @pointercancel="up" @pointerleave="leave">
          <span v-if="range" class="rng" :style="{ left: range.lo * 100 + '%', width: (range.hi - range.lo) * 100 + '%' }" />
          <span v-if="inWin(xn)" class="nowtick" :style="{ left: xn * 100 + '%' }" v-tip="'現在'" />
          <span v-if="ghost != null && !dragging" class="ghost" :style="{ left: ghost * 100 + '%' }" />
          <span v-if="inWin(xs)" class="knob s" :class="{ on: dragging === 'start' }" :style="{ left: xs * 100 + '%' }" role="slider" tabindex="0"
            aria-label="開始" aria-valuemin="0" aria-valuemax="1440" :aria-valuenow="knobNow('start')" :aria-valuetext="knobText('start')"
            @pointerdown.stop="down($event, axis!, 'start')" @keydown="knobKey($event, 'start')"><i class="node" /></span>
          <span v-if="inWin(xe)" class="knob e" :class="{ on: dragging === 'end' }" :style="{ left: xe! * 100 + '%' }" role="slider" tabindex="0"
            aria-label="結束" aria-valuemin="0" aria-valuemax="1440" :aria-valuenow="knobNow('end')" :aria-valuetext="knobText('end')"
            @pointerdown.stop="down($event, axis!, 'end')" @keydown="knobKey($event, 'end')"><i class="node end" /></span>
          <button v-if="outRight" type="button" class="edge r" :aria-label="`看${outRight === 'end' ? '結束' : '開始'}那一天`" v-tip="`${outRight === 'end' ? '○ 結束' : '● 開始'}在 ${awayText(outRight)}，點一下看那一天`" @pointerdown.stop @click="showEnd(outRight)" />
          <button v-if="outLeft" type="button" class="edge l" :aria-label="`看${outLeft === 'end' ? '結束' : '開始'}那一天`" v-tip="`${outLeft === 'end' ? '○ 結束' : '● 開始'}在 ${awayText(outLeft)}，點一下看那一天`" @pointerdown.stop @click="showEnd(outLeft)" />
        </div>
      </div>

      <div v-for="(r, ri) in visible" :key="r.id" class="zrow" :data-id="r.id" :class="{ isS: r.isS, isE: r.isE, lifted: rowSort.dragging.value === ri }">
        <span class="zc-head">
        <button type="button" class="zgrip" :aria-label="`拖曳或按 ↑↓ 調整${r.name}的位置`" v-tip="'拖曳調整順序；也可以按 ↑↓'"
          @pointerdown="rowSort.down($event, ri)" @pointermove="rowSort.move" @pointerup="rowSort.up" @pointercancel="rowSort.up" @keydown="rowSort.key($event, ri)"><Icon name="grip" /></button>
        <button type="button" class="zc-name" :aria-expanded="menuFor === r.id" v-tip="`${r.id}${tzLongName(r.id, startMs) ? ' · ' + tzLongName(r.id, startMs) : ''}`" @click="openMenu(r.id, $event)">
          <span class="zn-top"><b>{{ r.name }}</b><em v-if="withState" class="zs" :class="`zs-${zoneState(r.id).k}`" v-tip="zoneState(r.id).tip">{{ zoneState(r.id).t }}</em></span>
          <small class="mono">{{ r.offTxt }}<template v-if="r.diff"> · {{ r.diff }}</template><template v-else-if="r.isS"> · 開始</template></small>
        </button>
        </span>
        <div class="zc-times">
          <span class="zt">
            <i class="node" aria-hidden="true" />
            <input v-if="edit && edit.id === r.id && edit.which === 'start'" :ref="setEditEl" v-model="editText" class="zt-in mono" aria-label="開始時間" @keydown="editKey" @blur="applyEdit" />
            <button v-else type="button" class="zt-v mono editable" v-tip="`${r.name}的開始時間。點一下輸入，例如 15:00`" @click="startEditCell(r.id, 'start', r.sW)">{{ hm(r.sW) }}</button>
            <small v-if="!stacked">週{{ WD[wdOf(r.sW)] }}<template v-if="r.sDay"> {{ dayTag(r.sDay) }}</template></small><small v-else-if="r.sDay" class="dt">{{ dayTag(r.sDay) }}</small>
          </span>
          <span v-if="r.eW" class="zt">
            <i class="node end" aria-hidden="true" />
            <input v-if="edit && edit.id === r.id && edit.which === 'end'" :ref="setEditEl" v-model="editText" class="zt-in mono" aria-label="結束時間" @keydown="editKey" @blur="applyEdit" />
            <button v-else type="button" class="zt-v mono editable" v-tip="`${r.name}的結束時間（${eDate(r.eW)}）。點一下輸入時刻`" @click="startEditCell(r.id, 'end', r.eW)">{{ sameDay ? hm(r.eW) : `${eDate(r.eW)} ${hm(r.eW)}` }}</button>
            <small v-if="sameDay && !stacked">週{{ WD[wdOf(r.eW)] }}</small>
          </span>
        </div>
        <div class="strip" @pointerdown="down($event, $event.currentTarget as HTMLElement)" @pointermove="move($event, $event.currentTarget as HTMLElement, r.id)" @pointerup="up" @pointercancel="up" @pointerleave="leave">
          <span v-for="(c, i) in r.cells" :key="i" class="cell" :class="[c.cls, { mid: c.mid }]" :style="{ left: c.x0 * 100 + '%', width: (c.x1 - c.x0) * 100 + '%' }" />
          <template v-for="(c, i) in r.cells" :key="'l' + i"><em v-if="showLabel(c, r.cells)" class="lbl" :class="[c.cls, { d: c.mid }]" :style="{ left: c.x0 * 100 + '%' }">{{ c.label }}</em></template>
          <span v-if="range" class="rng" :style="{ left: range.lo * 100 + '%', width: (range.hi - range.lo) * 100 + '%' }" />
          <span v-if="inWin(xn)" class="ln now" :style="{ left: xn * 100 + '%' }" />
          <span v-if="ghost != null && !dragging" class="ln ghost" :style="{ left: ghost * 100 + '%' }" />
          <span v-if="inWin(xs)" class="ln s" :style="{ left: xs * 100 + '%' }" />
          <span v-if="inWin(xe)" class="ln e" :style="{ left: xe! * 100 + '%' }" />
        </div>
      </div>

      <button v-if="hidden.length" ref="moreBtn" type="button" class="zmore" :aria-expanded="moreOpen" @click="moreOpen = !moreOpen">
        <span class="ell">還有 {{ hidden.length }} 個：{{ hidden.map((h) => h.name).join('、') }}</span><Icon name="chevD" />
      </button>
      </div>
    </div>

    <Popover :open="!!menuRow" :anchor="menuAnchor" :label="menuRow?.name || ''" width="17rem" @close="menuFor = null">
      <div v-if="menuRow" class="zmenu">
        <p class="zmenu-t"><b>{{ menuRow.name }}</b><small>{{ menuRow.id }}</small></p>
        <button type="button" class="zmenu-i" :disabled="menuRow.isS" @click="asStart(menuRow.id)"><i class="node" />{{ menuRow.isS ? '已是開始的時區' : '設為開始的時區' }}</button>
        <button type="button" class="zmenu-i" :disabled="sameZone(menuRow.id, S.endTz)" @click="asEnd(menuRow.id)"><i class="node end" />{{ sameZone(menuRow.id, S.endTz) ? '已是結束的時區' : '設為結束的時區' }}</button>
        <button v-if="menuRow.removable" type="button" class="zmenu-i danger" @click="remove(menuRow.id)"><Icon name="x" />從列表移除</button>
      </div>
    </Popover>
    <Popover :open="moreOpen" :anchor="moreBtn" label="其他時區" width="22rem" @close="moreOpen = false">
      <ul class="zhidden">
        <li v-for="r in hidden" :key="r.id">
          <span class="zh-n"><b>{{ r.name }}</b><small class="mono">{{ r.offTxt }}</small></span>
          <span class="zh-t mono"><i class="node" />{{ hm(r.sW) }}<template v-if="r.eW"> <i class="node end" />{{ hm(r.eW) }}</template></span>
          <button type="button" class="icon-btn sm" v-tip="'移到最上面'" aria-label="移到最上面" @click="toTop(r.id)"><Icon name="chevL" style="transform: rotate(90deg)" /></button>
          <button v-if="r.removable" type="button" class="icon-btn sm" v-tip="'移除'" aria-label="移除" @click="remove(r.id)"><Icon name="x" /></button>
        </li>
      </ul>
    </Popover>
    <TzPicker :open="addOpen" :anchor="addBtn" title="加入時區" :exclude="zoneRows" @close="addOpen = false" @pick="add" />
  </section>
</template>

<style scoped>
.zp { --zc-name: minmax(7.5rem, 1fr); --zc-times: 8.6rem; }
.ph-ic { color: var(--ink-3); }
.icon-btn.sm { width: 2rem; height: 2rem; border-radius: .65rem; }
.seg-ctl button { height: 1.7rem; font-size: var(--fs-s); padding: 0 .5rem; gap: .3rem; }
.seg-ctl .node { font-size: var(--fs-s); }
/* narrow: the switch keeps its ● ○ so the day it shows has room */
.stacked .seg-ctl .sl { display: none; }
.stacked .seg-ctl button { padding: 0 .45rem; }
.zbody { flex: 1; min-height: 0; display: flex; gap: 1.2rem; padding: .55rem 1rem .8rem; }
.zlist { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; gap: .3rem; }
.zmap-side { align-self: center; }
.zrow { display: grid; grid-template-columns: var(--zc-name) var(--zc-times) minmax(0, 3.2fr); align-items: center; column-gap: .7rem; height: var(--rowh); flex: none; min-width: 0; }
.zaxis { height: 1.7rem; }
.stacked .zrow:not(.zaxis) { grid-template-columns: minmax(0, 1fr) auto; grid-template-rows: 1.45rem minmax(0, 1fr); row-gap: .2rem; }
.stacked .zrow:not(.zaxis) .strip { grid-column: 1 / -1; }
.stacked .zaxis { grid-template-columns: minmax(0, 1fr); }
.zc-axis-l { font-size: var(--fs-xs); color: var(--ink-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.zc-name.zc-axis-l { flex-direction: row; align-items: baseline; padding: 0; margin: 0; }
.scale-cap { font-style: normal; font-weight: 600; letter-spacing: .08em; color: var(--ink-4); margin-right: .5em; }

.zc-head { display: flex; align-items: center; min-width: 0; }
.zgrip { flex: none; display: grid; place-items: center; width: 1.2rem; height: 1.9rem; margin-left: -.45rem; border-radius: .4rem; color: var(--ink-4); cursor: grab; touch-action: none; opacity: .7; }
.zgrip .ic { width: 1em; height: 1em; stroke-width: 3.2; }
.zgrip:hover, .zgrip:focus-visible { color: var(--accent); background: var(--accent-wash); opacity: 1; }
.zrow.lifted { position: relative; z-index: 4; background: var(--surface-2); box-shadow: 0 6px 18px -8px rgba(11, 18, 34, .35); border-radius: .6rem; }
.zrow.lifted .zgrip { cursor: grabbing; color: var(--accent); opacity: 1; }
.zday { display: inline-flex; align-items: center; gap: .1rem; min-width: 0; }
.zday .panel-sub { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.icon-btn.xs { width: 1.6rem; height: 1.6rem; border-radius: .5rem; flex: none; }
.icon-btn.xs .ic { width: .95em; height: .95em; }
.chip.xs { height: 1.5rem; padding: 0 .45rem; font-size: var(--fs-xs); margin-left: .2rem; flex: none; }
@media (pointer: coarse) { .zgrip { width: 1.7rem; height: 2.2rem; } .icon-btn.xs { width: 2.1rem; height: 2.1rem; } }
.zc-name { display: flex; flex-direction: column; align-items: flex-start; min-width: 0; text-align: left; padding: .15rem .4rem; margin-left: -.4rem; border-radius: .55rem; line-height: 1.2; transition: background .15s; }
.zc-name:hover, .zc-name[aria-expanded="true"] { background: var(--well-2); }
.zc-name b { font-weight: 600; font-size: .93rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
.zn-top { display: flex; align-items: center; gap: .35rem; min-width: 0; max-width: 100%; }
.zn-top b { min-width: 0; }
.zs { flex: none; font-style: normal; font-size: max(var(--floor), .7rem); font-weight: 650; line-height: 1; padding: .16rem .38rem; border-radius: 99rem; white-space: nowrap; }
.zs-work { color: var(--good); background: var(--good-wash); }
.zs-off, .zs-wkend { color: var(--ink-3); background: var(--well-2); }
.zs-night { color: var(--h0-ink); background: var(--h0); }
.icon-btn.on { color: var(--accent); }
.sec { --zc-times: 10.4rem; }
.zc-name small { font-size: var(--fs-xs); color: var(--ink-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
.isS .zc-name b { color: var(--accent); }
.stacked .zc-name { flex-direction: row; align-items: baseline; gap: .5rem; }
.stacked .zn-top { flex: none; max-width: 70%; }
.stacked .zc-name small { flex: 1 1 auto; min-width: 0; }

.zc-times { display: flex; flex-direction: column; gap: .05rem; min-width: 0; }
.stacked .zc-times { flex-direction: row; gap: .8rem; }
.zt { display: flex; align-items: center; gap: .3rem; min-width: 0; white-space: nowrap; line-height: 1.25; }
.zt .node { font-size: .7rem; }
.zt-v { font-size: .9rem; font-weight: 500; color: var(--ink); padding: 0 .1rem; border-radius: .3rem; }
.zt small { font-size: var(--fs-xs); color: var(--ink-3); }
.zt-in { width: 4.2rem; height: 1.45rem; font-size: .88rem; padding: 0 .3rem; border-radius: .4rem; border: 1.5px solid var(--accent); background: var(--surface-2); }

.strip { position: relative; height: clamp(1.75rem, calc(var(--rowh) * .64), 2.5rem); border-radius: .55rem; overflow: hidden; cursor: pointer; touch-action: none; user-select: none; -webkit-user-select: none; background: var(--well-2); }
.stacked .strip { height: 100%; max-height: 2.3rem; }
.zt small.dt { color: var(--warn); }
.strip.axis { height: 1.7rem; overflow: visible; background: none; border-radius: 0; }
.strip.axis::before { content: ''; position: absolute; left: 0; right: 0; top: 50%; height: 2px; margin-top: -1px; border-radius: 2px; background: var(--hair-2); }
.cell { position: absolute; top: 0; bottom: 0; }
.cell.h0 { background: var(--h0); color: var(--h0-ink); }
.cell.h1 { background: var(--h1); color: var(--h1-ink); }
.cell.h2 { background: var(--h2); color: var(--h2-ink); }
.cell.h3 { background: var(--h3); color: var(--h3-ink); }
.cell.mid { box-shadow: inset 2px 0 0 var(--accent); }
.lbl { position: absolute; top: 50%; transform: translate(.24rem, -50%); font: 600 var(--fs-xs)/1 var(--f-sans); font-style: normal; white-space: nowrap; pointer-events: none; z-index: 1; }
.lbl.h0 { color: var(--h0-ink); } .lbl.h1 { color: var(--h1-ink); } .lbl.h2 { color: var(--h2-ink); } .lbl.h3 { color: var(--h3-ink); }
.lbl.d { font-weight: 750; }
.rng { position: absolute; top: 0; bottom: 0; background: var(--accent-wash-2); pointer-events: none; }
.axis .rng { top: 50%; bottom: auto; height: 4px; margin-top: -2px; border-radius: 4px; background: var(--accent); opacity: .5; }
.ln { position: absolute; top: 0; bottom: 0; width: 2px; margin-left: -1px; pointer-events: none; }
.ln.s { background: var(--accent); box-shadow: 0 0 0 1px color-mix(in srgb, var(--surface) 70%, transparent); }
.ln.e { background: repeating-linear-gradient(to bottom, var(--accent) 0 3px, transparent 3px 5px); }
.ln.now { width: 1.5px; background: var(--now); }
.ln.ghost { width: 1px; background: var(--ink-2); opacity: .55; }
.nowtick { position: absolute; top: 50%; width: .5rem; height: .5rem; margin: -.25rem 0 0 -.25rem; border-radius: 50%; background: var(--now); box-shadow: 0 0 0 2px var(--surface); }
.ghost { position: absolute; top: 15%; bottom: 15%; width: 1px; background: var(--ink-3); pointer-events: none; }
.knob { position: absolute; top: 50%; width: 1.55rem; height: 1.55rem; margin: -.775rem 0 0 -.775rem; display: grid; place-items: center; border-radius: 50%; background: var(--surface-2); box-shadow: 0 0 0 1px var(--hair-2), 0 2px 6px rgba(11, 18, 34, .18); cursor: grab; touch-action: none; transition: transform .15s; z-index: 2; }
.knob .node { font-size: .95rem; }
.knob:hover, .knob.on { transform: scale(1.12); }
.knob.on { cursor: grabbing; box-shadow: 0 0 0 3px var(--accent-wash-2), 0 2px 8px rgba(11, 18, 34, .25); }
.edge { position: absolute; top: 50%; width: .7rem; height: .7rem; margin-top: -.35rem; padding: 0; border: 0; border-top: 2.5px solid var(--accent); border-right: 2.5px solid var(--accent); border-radius: 0; background: none; opacity: .75; cursor: pointer; z-index: 3; }
.edge::after { content: ''; position: absolute; inset: -.6rem; }
.edge:hover { opacity: 1; }
.edge.r { right: -.1rem; transform: rotate(45deg); }
.edge.l { left: -.1rem; transform: rotate(-135deg); }
.zmore { flex: none; display: flex; align-items: center; gap: .3rem; height: 2rem; padding: 0 .55rem; margin: 0 -.3rem; border-radius: .6rem; font-size: max(var(--floor), .84rem); color: var(--ink-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.zmore:hover { background: var(--well-2); color: var(--ink); }
.zmenu { display: flex; flex-direction: column; padding: .5rem; }
.zmenu-t { display: flex; flex-direction: column; padding: .4rem .6rem .55rem; line-height: 1.3; }
.zmenu-t small { font-size: var(--fs-xs); color: var(--ink-3); }
.zmenu-i { display: flex; align-items: center; gap: .6rem; height: 2.5rem; padding: 0 .65rem; border-radius: .7rem; font-size: .92rem; text-align: left; }
.zmenu-i:hover:not(:disabled) { background: var(--accent-wash); color: var(--accent); }
.zmenu-i:disabled { color: var(--ink-3); }
.zmenu-i.danger:hover { background: var(--now-wash); color: var(--now); }
.zmenu-i .node { font-size: max(var(--floor), .85rem); }
.zhidden { display: flex; flex-direction: column; padding: .45rem; }
.zhidden li { display: flex; align-items: center; gap: .5rem; height: 2.7rem; padding: 0 .3rem 0 .6rem; border-radius: .7rem; }
.zh-n { display: flex; flex-direction: column; flex: 1; min-width: 0; line-height: 1.2; }
.zh-n small { font-size: var(--fs-xs); color: var(--ink-3); }
.zh-t { font-size: .86rem; display: inline-flex; align-items: center; gap: .3rem; }
.zh-t .node { font-size: var(--fs-xs); }
</style>
