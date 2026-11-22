<script setup lang="ts">
/* Day scale: the same moment in every zone. Each row shows both ends; the strips share one 24-hour axis
   where ● and ○ can be dragged. A click moves whichever end is nearer. */
import { ref, computed, watch, nextTick } from 'vue';
import Icon from './Icon.vue';
import Popover from './Popover.vue';
import TzPicker from './TzPicker.vue';
import {
  S, type End, now, startMs, endMs, hasEnd, wallOf, tzOf, zoneRows, commit, setInstant, setStartTz, setEndTz, addZoneRow, removeZoneRow, toast, undo, pulse, bump, ZMAX,
} from '../state/store';
import { type Wall, partsInTz, offsetAt, toInstant, addDaysWall, pad, WD, wdOf, dayNum, clamp, fmtDT, fmtOffset, HOUR, MIN, DAY } from '../core/time';
import { zoneName, sameZone, tzLongName } from '../core/zones';
import { clockOf } from '../state/command';
import { useSize, remPx } from '../composables/size';
import { tipAt, hideTip } from '../composables/tip';

const SUBJ = { start: '開始', end: '結束' } as const;
const winPick = ref<End>('start');
const winEnd = computed<End>(() => (winPick.value === 'end' && hasEnd.value ? 'end' : 'start'));
const dayKey = (w: Wall) => `${w.y}-${w.mo}-${w.d}`;
const win = computed(() => {
  const which = winEnd.value, tz = tzOf(which), w = wallOf(which)!;
  const d0 = { ...w, h: 0, mi: 0, s: 0 };
  return { a: toInstant(d0, tz), b: toInstant(addDaysWall(d0, 1), tz), tz, key: `${tz}|${dayKey(d0)}`, d0 };
});
const sameDay = computed(() => {
  if (endMs.value == null) return true;
  const e = partsInTz(endMs.value, S.endTz), s = partsInTz(startMs.value, S.startTz);
  return dayKey(e) === dayKey(s);
});
watch(hasEnd, (h) => { if (!h) winPick.value = 'start'; });

/* ---------- geometry ---------- */
const body = ref<HTMLElement | null>(null);
const axis = ref<HTMLElement | null>(null);
const { w: bodyW, h: bodyH } = useSize(body);
const { w: axisW } = useSize(axis);
const stacked = computed(() => bodyW.value > 0 && bodyW.value < 31 * remPx.value);
const baseRowH = computed(() => (stacked.value ? 3.4 : 2.95) * remPx.value);
const gap = computed(() => 0.3 * remPx.value);
const axisH = computed(() => 1.7 * remPx.value);
/** Rows that fit under the axis; when not all fit, one slot becomes the "還有 N 個" line. */
const capacity = computed(() => {
  const avail = bodyH.value - axisH.value - gap.value, per = baseRowH.value + gap.value;
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
  const reserve = hidden.value.length ? 2 * remPx.value + gap.value : 0;
  const per = (bodyH.value - axisH.value - reserve) / n - gap.value;
  return Math.max(base, Math.min(base * 1.45, per));
});
const hidden = computed(() => allRows.value.slice(visible.value.length));
const hm = (w: Wall) => `${pad(w.h)}:${pad(w.mi)}`;
const dayTag = (n: number) => (n > 0 ? `+${n}天` : n < 0 ? `${n}天` : '');
const eDate = (w: Wall) => `${w.mo}/${w.d}`;

/* ---------- dragging ● ○ ---------- */
interface Drag { id: number; which: End; session: number; moved: boolean; last: number }
let drag: Drag | null = null, session = 0;
const dragging = ref<End | null>(null);
const ghost = ref<number | null>(null);
function frac(e: PointerEvent, el: HTMLElement) { const r = el.getBoundingClientRect(); return clamp((e.clientX - r.left) / r.width, 0, 1); }
function snapAt(f: number, fine: boolean) { const t = win.value.a + f * (win.value.b - win.value.a); const q = fine ? MIN : 15 * MIN; return Math.round(t / q) * q; }
function nearest(f: number): End {
  const cand: [End, number][] = [];
  if (inWin(xs.value)) cand.push(['start', Math.abs(f - xs.value)]);
  if (inWin(xe.value)) cand.push(['end', Math.abs(f - xe.value!)]);
  if (!cand.length) return winEnd.value;
  cand.sort((p, q) => p[1] - q[1]);
  return cand[0][0];
}
function moveTo(which: End, t: number) {
  const cur = which === 'start' ? startMs.value : endMs.value;
  if (cur === t) return;
  commit(() => setInstant(which, t), { key: `zdrag-${drag?.session ?? ++session}`, hold: true, label: `拖曳${SUBJ[which]}` });
}
function down(e: PointerEvent, el: HTMLElement, knob?: End) {
  if (e.button > 0) return;
  e.preventDefault();
  const f = frac(e, el);
  const which = knob || nearest(f);
  drag = { id: e.pointerId, which, session: ++session, moved: !knob, last: 0 };
  dragging.value = which;
  try { el.setPointerCapture(e.pointerId); } catch { /* ok */ }
  if (!knob) moveTo(which, snapAt(f, e.altKey || e.shiftKey));
  showTip(e, el, f);
}
function move(e: PointerEvent, el: HTMLElement, rowId?: string) {
  const f = frac(e, el);
  if (drag && e.pointerId === drag.id) {
    drag.moved = true;
    moveTo(drag.which, snapAt(f, e.altKey || e.shiftKey));
    showTip(e, el, f, rowId);
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
  hideTip();
  if (d.moved) {
    const w = wallOf(d.which);
    if (w) toast(`${SUBJ[d.which]}改為 ${fmtDT(w)}`, undo);
    bump(d.which);
  }
}
function leave() { ghost.value = null; if (!drag) hideTip(); }
function showTip(e: PointerEvent, el: HTMLElement, f: number, rowId?: string) {
  const t = snapAt(f, e.altKey || e.shiftKey);
  const id = rowId || S.startTz;
  const lw = partsInTz(t, id), sw = partsInTz(t, S.startTz);
  const here = `${zoneName(id)} ${hm(lw)}（週${WD[wdOf(lw)]}）`;
  const base = sameZone(id, S.startTz) ? '' : ` ＝ ${zoneName(S.startTz)} ${hm(sw)}`;
  const act = drag ? `${drag.which === 'start' ? '●' : '○'} ${SUBJ[drag.which]}` : `點一下移動 ${nearest(f) === 'start' ? '● 開始' : '○ 結束'}`;
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
function asStart(id: string) { commit(() => setStartTz(id), { label: `開始時區：${zoneName(id)}`, say: `開始改用${zoneName(id)}時區，同一個時刻` }); menuFor.value = null; bump('start'); }
function asEnd(id: string) { commit(() => setEndTz(id), { label: `結束時區：${zoneName(id)}`, say: `結束改用${zoneName(id)}時區，同一個時刻` }); menuFor.value = null; bump('end'); }
function remove(id: string) { commit(() => removeZoneRow(id), { label: `移除${zoneName(id)}`, say: `已移除${zoneName(id)}` }); menuFor.value = null; moreOpen.value = false; }
function toTop(id: string) { commit(() => { S.zones = [id, ...S.zones.filter((z) => !sameZone(z, id))]; }, { label: `${zoneName(id)}移到上面` }); moreOpen.value = false; }
const addBtn = ref<HTMLElement | null>(null);
const addOpen = ref(false);
function add(id: string) { commit(() => addZoneRow(id), { label: `加入${zoneName(id)}`, say: `已加入${zoneName(id)}` }); }
const moreBtn = ref<HTMLElement | null>(null);
const moreOpen = ref(false);
const menuRow = computed(() => allRows.value.find((r) => r.id === menuFor.value) || null);

const flashing = ref(false);
watch(() => pulse.zones, () => { flashing.value = false; requestAnimationFrame(() => { flashing.value = true; }); });
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
      <span class="panel-sub">{{ stacked ? winShort : `${winLabel} 的 24 小時` }}</span>
      <div v-if="hasEnd && !sameDay" class="seg-ctl" role="group" aria-label="時區條顯示哪一天">
        <button type="button" :aria-pressed="winEnd === 'start'" v-tip="'時區條顯示開始那一天'" @click="winPick = 'start'"><i class="node" />開始日</button>
        <button type="button" :aria-pressed="winEnd === 'end'" v-tip="'時區條顯示結束那一天'" @click="winPick = 'end'"><i class="node end" />結束日</button>
      </div>
      <button ref="addBtn" type="button" class="icon-btn sm" :disabled="zoneRows.length >= ZMAX" :aria-expanded="addOpen" v-tip="zoneRows.length >= ZMAX ? `最多 ${ZMAX} 個時區` : '加入時區'" aria-label="加入時區" @click="addOpen = !addOpen"><Icon name="plus" /></button>
    </header>

    <div ref="body" class="zbody" :style="{ '--rowh': rowH + 'px' }">
      <!-- the shared axis: ● and ○ live here -->
      <div class="zrow zaxis">
        <span v-if="!stacked" class="zc-name zc-axis-l">{{ zoneName(win.tz) }}</span>
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
          <span v-if="outRight" class="edge r" v-tip="`${outRight === 'end' ? '○ 結束' : '● 開始'}在 ${awayText(outRight)}，用上方的切換看那一天`" />
          <span v-if="outLeft" class="edge l" v-tip="`${outLeft === 'end' ? '○ 結束' : '● 開始'}在 ${awayText(outLeft)}，用上方的切換看那一天`" />
        </div>
      </div>

      <div v-for="r in visible" :key="r.id" class="zrow" :class="{ isS: r.isS, isE: r.isE }">
        <button type="button" class="zc-name" :aria-expanded="menuFor === r.id" v-tip="`${r.id}${tzLongName(r.id, startMs) ? ' · ' + tzLongName(r.id, startMs) : ''}`" @click="openMenu(r.id, $event)">
          <b>{{ r.name }}</b>
          <small class="mono">{{ r.offTxt }}<template v-if="r.diff"> · {{ r.diff }}</template><template v-else-if="r.isS"> · 開始</template></small>
        </button>
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

    <Popover :open="!!menuRow" :anchor="menuAnchor" :label="menuRow?.name || ''" width="17rem" @close="menuFor = null">
      <div v-if="menuRow" class="zmenu">
        <p class="zmenu-t"><b>{{ menuRow.name }}</b><small>{{ menuRow.id }}</small></p>
        <button type="button" class="zmenu-i" :disabled="menuRow.isS" @click="asStart(menuRow.id)"><i class="node" />{{ menuRow.isS ? '已是開始的時區' : '設為開始的時區' }}</button>
        <button v-if="hasEnd" type="button" class="zmenu-i" :disabled="menuRow.isE" @click="asEnd(menuRow.id)"><i class="node end" />{{ menuRow.isE ? '已是結束的時區' : '設為結束的時區' }}</button>
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
.zp { --zc-name: minmax(5.6rem, 1fr); --zc-times: 8.6rem; }
.ph-ic { color: var(--ink-3); }
.icon-btn.sm { width: 2rem; height: 2rem; border-radius: .65rem; }
.seg-ctl button { height: 1.7rem; font-size: var(--fs-s); padding: 0 .5rem; gap: .3rem; }
.seg-ctl .node { font-size: var(--fs-s); }
.zbody { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: .3rem; padding: .55rem 1rem .8rem; }
.zrow { display: grid; grid-template-columns: var(--zc-name) var(--zc-times) minmax(0, 3.2fr); align-items: center; column-gap: .7rem; height: var(--rowh); flex: none; min-width: 0; }
.zaxis { height: 1.7rem; }
.stacked .zrow:not(.zaxis) { grid-template-columns: minmax(0, 1fr) auto; grid-template-rows: 1.45rem minmax(0, 1fr); row-gap: .2rem; }
.stacked .zrow:not(.zaxis) .strip { grid-column: 1 / -1; }
.stacked .zaxis { grid-template-columns: minmax(0, 1fr); }
.zc-axis-l { font-size: var(--fs-xs); color: var(--ink-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.zc-name { display: flex; flex-direction: column; align-items: flex-start; min-width: 0; text-align: left; padding: .15rem .4rem; margin-left: -.4rem; border-radius: .55rem; line-height: 1.2; transition: background .15s; }
.zc-name:hover, .zc-name[aria-expanded="true"] { background: var(--well-2); }
.zc-name b { font-weight: 600; font-size: .93rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
.zc-name small { font-size: var(--fs-xs); color: var(--ink-3); white-space: nowrap; }
.isS .zc-name b { color: var(--accent); }
.stacked .zc-name { flex-direction: row; align-items: baseline; gap: .5rem; }

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
.edge { position: absolute; top: 50%; width: .7rem; height: .7rem; margin-top: -.35rem; border-top: 2.5px solid var(--accent); border-right: 2.5px solid var(--accent); opacity: .75; }
.edge.r { right: -.1rem; transform: rotate(45deg); }
.edge.l { left: -.1rem; transform: rotate(-135deg); }
.zmore { flex: none; display: flex; align-items: center; gap: .3rem; height: 2rem; padding: 0 .55rem; margin: 0 -.3rem; border-radius: .6rem; font-size: max(11px, .84rem); color: var(--ink-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.zmore:hover { background: var(--well-2); color: var(--ink); }
.zmenu { display: flex; flex-direction: column; padding: .5rem; }
.zmenu-t { display: flex; flex-direction: column; padding: .4rem .6rem .55rem; line-height: 1.3; }
.zmenu-t small { font-size: var(--fs-xs); color: var(--ink-3); }
.zmenu-i { display: flex; align-items: center; gap: .6rem; height: 2.5rem; padding: 0 .65rem; border-radius: .7rem; font-size: .92rem; text-align: left; }
.zmenu-i:hover:not(:disabled) { background: var(--accent-wash); color: var(--accent); }
.zmenu-i:disabled { color: var(--ink-3); }
.zmenu-i.danger:hover { background: var(--now-wash); color: var(--now); }
.zmenu-i .node { font-size: max(11px, .85rem); }
.zhidden { display: flex; flex-direction: column; padding: .45rem; }
.zhidden li { display: flex; align-items: center; gap: .5rem; height: 2.7rem; padding: 0 .3rem 0 .6rem; border-radius: .7rem; }
.zh-n { display: flex; flex-direction: column; flex: 1; min-width: 0; line-height: 1.2; }
.zh-n small { font-size: var(--fs-xs); color: var(--ink-3); }
.zh-t { font-size: .86rem; display: inline-flex; align-items: center; gap: .3rem; }
.zh-t .node { font-size: var(--fs-xs); }
</style>
