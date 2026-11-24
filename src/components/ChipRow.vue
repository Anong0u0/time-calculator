<script setup lang="ts">
/* A row of shortcuts, every one of them a rule the user can change. Click to apply.
   Right-click (or a long press) opens the editor on that shortcut; + adds one. With a mouse, drag a shortcut
   to reorder the row, onto another row to move it there, or off the rows to remove it. */
import { ref, reactive, computed } from 'vue';
import Icon from './Icon.vue';
import Popover from './Popover.vue';
import ChipEditor from './ChipEditor.vue';
import { S, type ChipRow, type Chip, chipName, chipOn, chipProgress, chipTarget, chipRule, applyChip, applyRule, runRule, tzOf, commit, bump, ruleTick, toast, undo } from '../state/store';
import { partsInTz, WD, wdOf, fmtDT, pad } from '../core/time';

const props = defineProps<{ row: ChipRow; size?: 'sm' | 'lg'; pick?: (c: Chip) => boolean; fill?: boolean }>();
const emit = defineEmits<{ preview: [string | null] }>();
const list = computed(() => S.chips[props.row]);
const which = computed(() => chipTarget(props.row));
const SUBJ = { start: '開始', end: '結束' } as const;

function landing(c: Chip): string {
  void ruleTick.value;
  const r = chipRule(c);
  if (!r) return '這個快捷壞掉了';
  const res = runRule(r, which.value);
  if (!res.ok) return res.err;
  const w = partsInTz(res.ms, tzOf(which.value));
  return `${w.y}/${w.mo}/${w.d}（${WD[wdOf(w)]}）${pad(w.h)}:${pad(w.mi)}`;
}
const tipOf = (c: Chip) => `${SUBJ[which.value]} → ${landing(c)}。右鍵或長按可以修改`;

let skipClick = false;
function apply(i: number) {
  if (skipClick) { skipClick = false; return; }
  const c = list.value[i];
  if (!c || props.pick?.(c)) return;
  const n = chipName(c), w = which.value;
  const ok = commit(() => applyChip(props.row, c), { label: `${SUBJ[w]}：${n}`, say: () => `${SUBJ[w]}：${n}${S.rules[w]?.follow ? '（跟著規則）' : ''}` });
  if (ok) bump(w);
}

/* ---------- the editor ---------- */
const edOpen = ref(false);
const edIndex = ref<number | null>(null);
const edAnchor = ref<HTMLElement | null>(null);
function openEditor(i: number | null, el: HTMLElement | null) { edIndex.value = i; edAnchor.value = el; edOpen.value = true; }

/* ---------- press: long on touch edits; drag with a mouse moves ---------- */
const drag = shared;
let press: { i: number; id: number; x: number; y: number; el: HTMLElement; timer?: ReturnType<typeof setTimeout>; mouse: boolean } | null = null;
function down(i: number, e: PointerEvent) {
  if (e.button > 0) return;
  const el = e.currentTarget as HTMLElement;
  press = { i, id: e.pointerId, x: e.clientX, y: e.clientY, el, mouse: e.pointerType === 'mouse' };
  if (!press.mouse) press.timer = setTimeout(() => { if (press) { skipClick = true; openEditor(press.i, press.el); press = null; } }, 520);
}
function targetAt(x: number, y: number): { row: ChipRow; i: number } | null {
  const hit = document.elementFromPoint(x, y) as HTMLElement | null;
  const rowEl = hit?.closest<HTMLElement>('[data-chip-row]');
  if (!rowEl) return null;
  const row = rowEl.dataset.chipRow as ChipRow;
  const chips = [...rowEl.querySelectorAll<HTMLElement>('[data-ci]')];
  let i = chips.length;
  for (const [k, c] of chips.entries()) { const r = c.getBoundingClientRect(); if (y < r.bottom && (y < r.top || x < r.left + r.width / 2)) { i = k; break; } }
  return { row, i };
}
function move(e: PointerEvent) {
  if (!press || e.pointerId !== press.id) return;
  const dx = e.clientX - press.x, dy = e.clientY - press.y;
  if (!press.mouse) { if (Math.hypot(dx, dy) > 8) { clearTimeout(press.timer); press = null; } return; }
  if (!drag.on) {
    if (Math.hypot(dx, dy) < 6) return;
    drag.on = true; drag.row = props.row; drag.i = press.i;
    try { press.el.setPointerCapture(e.pointerId); } catch { /* fine */ }
  }
  drag.dx = dx; drag.dy = dy;
  const t = targetAt(e.clientX, e.clientY);
  drag.to = t;
  const box = press.el.closest('[data-chip-row]')!.getBoundingClientRect();
  const hit = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
  drag.onEnd = !t ? (hit?.closest<HTMLElement>('[data-drop-end]')?.dataset.dropEnd as 'start' | 'end' | undefined) ?? null : null;
  drag.off = !t && !drag.onEnd && (e.clientY < box.top - 30 || e.clientY > box.bottom + 30 || e.clientX < box.left - 30 || e.clientX > box.right + 30);
}
function up(e: PointerEvent) {
  if (!press || e.pointerId !== press.id) return;
  clearTimeout(press.timer);
  const p = press;
  press = null;
  if (!drag.on) return;
  skipClick = true;
  setTimeout(() => { skipClick = false; }, 0);
  const from = { row: drag.row!, i: drag.i! }, to = drag.to, off = drag.off;
  Object.assign(drag, { on: false, row: null, i: null, to: null, off: false, dx: 0, dy: 0, onEnd: null });
  const c = S.chips[from.row][from.i];
  if (!c) return;
  const n = chipName(c);
  const ROW = { start: '開始', end: '結束', span: '間隔' } as const;
  // dropped on an end's panel: apply it there
  const onEnd = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-drop-end]')?.dataset.dropEnd as 'start' | 'end' | undefined;
  if (!to && onEnd) {
    const r = chipRule(c);
    if (r) { const ok = commit(() => applyRule(onEnd, r, { name: n }), { label: `${SUBJ[onEnd]}：${n}`, say: `${SUBJ[onEnd]}：${n}` }); if (ok) bump(onEnd); }
    return;
  }
  if (off) { commit(() => { S.chips[from.row].splice(from.i, 1); }, { label: `移除快捷：${n}`, say: `已移除快捷「${n}」` }); return; }
  if (!to) return;
  if (to.row === from.row) {
    const j = to.i > from.i ? to.i - 1 : to.i;
    if (j === from.i) return;
    commit(() => { const [x] = S.chips[from.row].splice(from.i, 1); S.chips[from.row].splice(j, 0, x); }, { label: '快捷排序' });
    return;
  }
  commit(() => { const [x] = S.chips[from.row].splice(from.i, 1); S.chips[to.row].splice(to.i, 0, x); }, { label: `快捷移到${ROW[to.row]}`, say: `「${n}」移到${ROW[to.row]}的快捷` });
  void p; void toast; void undo;
}
const isDragged = (i: number) => drag.on && drag.row === props.row && drag.i === i;
const dropBefore = (i: number) => drag.on && drag.to?.row === props.row && drag.to.i === i && !isDragged(i);
const dropEnd = computed(() => drag.on && drag.to?.row === props.row && drag.to.i >= list.value.length);
function hover(c: Chip | null, e?: PointerEvent) {
  if (!c) { emit('preview', null); return; }
  if (e && e.pointerType !== 'mouse') return;
  emit('preview', `${chipName(c)} → ${landing(c)}`);
}
void fmtDT;
</script>

<script lang="ts">
/* one drag at a time, across every row */
const shared = reactive({ on: false, row: null as ChipRow | null, i: null as number | null, to: null as { row: ChipRow; i: number } | null, off: false, dx: 0, dy: 0, onEnd: null as 'start' | 'end' | null });
</script>

<template>
  <div class="cr" :class="[size, { dropping: drag.on }]" :data-chip-row="row" role="group">
    <button v-for="(c, i) in list" :key="c.code + i" type="button" class="chip" :class="{ fillchip: fill, dragged: isDragged(i), off: isDragged(i) && drag.off, before: dropBefore(i) }" :data-ci="i"
      :style="{ ...(fill ? { '--p': chipProgress(row, c) ?? 0 } : {}), ...(isDragged(i) ? { transform: `translate(${drag.dx}px, ${drag.dy}px)` } : {}) }"
      :aria-pressed="chipOn(row, c)" v-tip="tipOf(c)" @click="apply(i)" @contextmenu.prevent="openEditor(i, $event.currentTarget as HTMLElement)"
      @pointerdown="down(i, $event)" @pointermove="move" @pointerup="up" @pointercancel="up" @pointerenter="hover(c, $event)" @pointerleave="hover(null)">{{ chipName(c) }}</button>
    <button type="button" class="chip add" :class="{ before: dropEnd }" :aria-label="`${row === 'span' ? '間隔' : SUBJ[row as 'start']}的快捷：新增或修改`" v-tip="'自訂快捷：新增、修改、排序，或把規則存成詞'"
      @click="openEditor(null, $event.currentTarget as HTMLElement)"><Icon name="plus" /></button>
    <Popover :open="edOpen" :anchor="edAnchor" :label="`${row === 'span' ? '間隔' : SUBJ[row as 'start']}的快捷`" width="32rem" tall @close="edOpen = false">
      <ChipEditor :row="row" :index="edIndex" @close="edOpen = false" />
    </Popover>
  </div>
</template>

<style scoped>
.cr { display: flex; flex-wrap: wrap; gap: .35rem; min-width: 0; }
.cr .chip { height: 1.95rem; padding: 0 .65rem; font-size: max(var(--floor), .84rem); touch-action: manipulation; user-select: none; -webkit-user-select: none; }
.cr.lg .chip { height: 2.4rem; padding: 0 .9rem; font-size: .9rem; }
.cr .chip.add { padding: 0 .5rem; color: var(--ink-3); border-style: dashed; }
.cr .chip.add .ic { width: 1em; height: 1em; }
.cr .chip.dragged { position: relative; z-index: 5; box-shadow: var(--shadow-pop); pointer-events: none; transition: none; }
.cr .chip.off { opacity: .45; border-style: dashed; border-color: var(--now); }
.cr .chip.before { box-shadow: -3px 0 0 -1px var(--accent); }
.fillchip { background-image: linear-gradient(to right, var(--accent-wash-2) calc(var(--p) * 100%), transparent calc(var(--p) * 100%)); }
</style>
