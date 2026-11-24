<script lang="ts">
/* one drag at a time, across every row (module scope: shared by every ChipRow) */
import { reactive } from 'vue';
import type { ChipRow as RowKey } from '../state/store';

const shared = reactive({ on: false, row: null as RowKey | null, i: null as number | null, to: null as { row: RowKey; i: number } | null, off: false, dx: 0, dy: 0, onEnd: null as 'start' | 'end' | null, who: null as symbol | null });
</script>

<script setup lang="ts">
/* A row of shortcuts, every one of them a rule the user can change. Click to apply.
   Right-click (or a long press) opens the editor on that shortcut; + adds one. With a mouse, drag a shortcut
   to reorder the row, onto another row to move it there, or off the rows to remove it.
   On the face a row keeps to one line, however many shortcuts it has: the ones that do not fit wait behind +N,
   which opens the whole row (wrap: the whole row, as in that popover). */
import { ref, computed, watch, nextTick, onMounted } from 'vue';
import Icon from './Icon.vue';
import Popover from './Popover.vue';
import ChipEditor from './ChipEditor.vue';
import { S, type Chip, CHIP_MAX, chipName, chipOn, chipProgress, chipTarget, chipRule, applyChip, applyRule, runRule, tzOf, commit, bump, ruleTick, toast } from '../state/store';
import { partsInTz, WD, wdOf, pad } from '../core/time';
import { useSize, fontsTick, remPx } from '../composables/size';

const props = defineProps<{ row: RowKey; size?: 'sm' | 'lg'; pick?: (c: Chip) => boolean; fill?: boolean; wrap?: boolean }>();
const emit = defineEmits<{ preview: [string | null] }>();
const list = computed(() => S.chips[props.row]);
/** This row's own drag, apart from another copy of the same row (the +N popover shows it too). */
const me = Symbol('row');

/* ---------- one line: as many as fit, then +N ---------- */
const root = ref<HTMLElement | null>(null);
const ruler = ref<HTMLElement | null>(null);
const { w: boxW } = useSize(root);
const cap = ref(Infinity);
const count = computed(() => (props.wrap ? list.value.length : Math.min(cap.value, list.value.length)));
const visible = computed(() => list.value.slice(0, count.value));
const hiddenN = computed(() => list.value.length - count.value);
function measure() {
  const box = root.value, r = ruler.value;
  if (props.wrap || !box || !r) return;
  const avail = box.clientWidth;
  if (!avail) return;
  const gap = parseFloat(getComputedStyle(box).columnGap) || 0;
  const items = [...r.children] as HTMLElement[];
  const width = (el: HTMLElement) => el.getBoundingClientRect().width;
  const moreW = width(items.pop()!), addW = width(items.pop()!);
  const ws = items.map(width);
  if (ws.reduce((a, b) => a + b + gap, 0) + addW <= avail + 0.5) { cap.value = ws.length; return; }
  let used = moreW + gap + addW, k = 0;
  while (k < ws.length && used + ws[k] + gap <= avail + 0.5) { used += ws[k] + gap; k++; }
  cap.value = k;
}
watch([() => list.value.map(chipName).join('\u0001'), boxW, fontsTick, remPx, () => S.density, () => props.size], () => nextTick(measure));
onMounted(() => nextTick(measure));
const moreBtn = ref<HTMLElement | null>(null);
const moreOpen = ref(false);
const moreTip = computed(() => `還有 ${hiddenN.value} 個：${list.value.slice(count.value).map(chipName).join('、')}。點一下看全部`);
watch(hiddenN, (n) => { if (!n) moreOpen.value = false; });
/** A shortcut picked in the popover closes it. */
function popClick(e: MouseEvent) { if ((e.target as HTMLElement).closest('[data-ci]')) moreOpen.value = false; }
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
function targetAt(x: number, y: number): { row: RowKey; i: number } | null {
  const hit = document.elementFromPoint(x, y) as HTMLElement | null;
  const rowEl = hit?.closest<HTMLElement>('[data-chip-row]');
  if (!rowEl) return null;
  const row = rowEl.dataset.chipRow as RowKey;
  // a row on the face may show only some of its shortcuts: past the last one shown is just after it
  const chips = [...rowEl.querySelectorAll<HTMLElement>(':scope > [data-ci]')];
  let i = chips.length ? +chips[chips.length - 1].dataset.ci! + 1 : 0;
  for (const c of chips) { const r = c.getBoundingClientRect(); if (y < r.bottom && (y < r.top || x < r.left + r.width / 2)) { i = +c.dataset.ci!; break; } }
  return { row, i };
}
function move(e: PointerEvent) {
  if (!press || e.pointerId !== press.id) return;
  const dx = e.clientX - press.x, dy = e.clientY - press.y;
  if (!press.mouse) { if (Math.hypot(dx, dy) > 8) { clearTimeout(press.timer); press = null; } return; }
  if (!drag.on) {
    if (Math.hypot(dx, dy) < 6) return;
    drag.on = true; drag.row = props.row; drag.i = press.i; drag.who = me;
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
  press = null;
  if (!drag.on) return;
  skipClick = true;
  setTimeout(() => { skipClick = false; }, 0);
  const from = { row: drag.row!, i: drag.i! }, to = drag.to, off = drag.off;
  Object.assign(drag, { on: false, row: null, i: null, to: null, off: false, dx: 0, dy: 0, onEnd: null, who: null });
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
  if (S.chips[to.row].length >= CHIP_MAX) { toast(`${ROW[to.row]}的快捷已經有 ${CHIP_MAX} 個，先移除幾個`); return; }
  commit(() => { const [x] = S.chips[from.row].splice(from.i, 1); S.chips[to.row].splice(to.i, 0, x); }, { label: `快捷移到${ROW[to.row]}`, say: `「${n}」移到${ROW[to.row]}的快捷` });
}
const isDragged = (i: number) => drag.on && drag.who === me && drag.i === i;
const dropBefore = (i: number) => drag.on && drag.to?.row === props.row && drag.to.i === i && !isDragged(i);
const dropEnd = computed(() => drag.on && drag.to?.row === props.row && drag.to.i >= count.value);
function hover(c: Chip | null, e?: PointerEvent) {
  if (!c) { emit('preview', null); return; }
  if (e && e.pointerType !== 'mouse') return;
  emit('preview', `${chipName(c)} → ${landing(c)}`);
}
</script>

<template>
  <div ref="root" class="cr" :class="[size, { dropping: drag.on, one: !wrap }]" :data-chip-row="row" role="group">
    <button v-for="(c, i) in visible" :key="c.code + i" type="button" class="chip" :class="{ fillchip: fill, dragged: isDragged(i), off: isDragged(i) && drag.off, before: dropBefore(i) }" :data-ci="i"
      :style="{ ...(fill ? { '--p': chipProgress(row, c) ?? 0 } : {}), ...(isDragged(i) ? { transform: `translate(${drag.dx}px, ${drag.dy}px)` } : {}) }"
      :aria-pressed="chipOn(row, c)" v-tip="tipOf(c)" @click="apply(i)" @contextmenu.prevent="openEditor(i, $event.currentTarget as HTMLElement)"
      @pointerdown="down(i, $event)" @pointermove="move" @pointerup="up" @pointercancel="up" @pointerenter="hover(c, $event)" @pointerleave="hover(null)">{{ chipName(c) }}</button>
    <button v-if="hiddenN > 0" ref="moreBtn" type="button" class="chip more" :class="{ before: dropEnd }" :aria-expanded="moreOpen" :aria-label="`還有 ${hiddenN} 個快捷，點一下看全部`" v-tip="moreTip" @click="moreOpen = !moreOpen">+{{ hiddenN }}</button>
    <button type="button" class="chip add" :class="{ before: dropEnd && !hiddenN }" :aria-label="`${row === 'span' ? '間隔' : SUBJ[row as 'start']}的快捷：新增或修改`" v-tip="'自訂快捷：新增、修改、排序，或把規則存成詞'"
      @click="openEditor(null, $event.currentTarget as HTMLElement)"><Icon name="plus" /></button>
    <!-- the widths of every shortcut, to know how many fit on the line -->
    <div v-if="!wrap" ref="ruler" class="cr-ruler" aria-hidden="true"><span v-for="(c, i) in list" :key="c.code + i" class="chip">{{ chipName(c) }}</span><span class="chip add"><Icon name="plus" /></span><span class="chip more">+88</span></div>
    <Popover :open="edOpen" :anchor="edAnchor" :label="`${row === 'span' ? '間隔' : SUBJ[row as 'start']}的快捷`" width="32rem" tall @close="edOpen = false">
      <ChipEditor :row="row" :index="edIndex" @close="edOpen = false" />
    </Popover>
    <Popover v-if="!wrap" :open="moreOpen" :anchor="moreBtn" :label="`${row === 'span' ? '間隔' : SUBJ[row as 'start']}的全部快捷`" width="24rem" align="end" @close="moreOpen = false">
      <div class="cr-pop" @click="popClick">
        <p class="cr-pop-k">{{ row === 'span' ? '間隔' : SUBJ[row as 'start'] }}的全部快捷 · {{ list.length }} 個</p>
        <ChipRow :row="row" size="lg" wrap :fill="fill" :pick="pick" @preview="(t: string | null) => emit('preview', t)" />
      </div>
    </Popover>
  </div>
</template>

<style scoped>
.cr { position: relative; display: flex; flex-wrap: wrap; gap: .35rem; min-width: 0; }
.cr.one { flex-wrap: nowrap; }
.cr-ruler { position: absolute; left: 0; top: 0; height: 0; width: max-content; display: flex; gap: inherit; visibility: hidden; pointer-events: none; }
.cr .chip.more { padding: 0 .55rem; color: var(--accent); font-variant-numeric: tabular-nums; }
.cr-pop { padding: .8rem; display: flex; flex-direction: column; gap: .55rem; }
.cr-pop-k { font-size: var(--fs-xs); font-weight: 600; color: var(--ink-3); }
.cr .chip { height: 1.95rem; padding: 0 .65rem; font-size: max(var(--floor), .84rem); touch-action: manipulation; user-select: none; -webkit-user-select: none; }
.cr.lg .chip { height: 2.4rem; padding: 0 .9rem; font-size: .9rem; }
.cr .chip.add { padding: 0 .5rem; color: var(--ink-3); border-style: dashed; }
.cr .chip.add .ic { width: 1em; height: 1em; }
.cr .chip.dragged { position: relative; z-index: 5; box-shadow: var(--shadow-pop); pointer-events: none; transition: none; }
.cr .chip.off { opacity: .45; border-style: dashed; border-color: var(--now); }
.cr .chip.before { box-shadow: -3px 0 0 -1px var(--accent); }
.fillchip { background-image: linear-gradient(to right, var(--accent-wash-2) calc(var(--p) * 100%), transparent calc(var(--p) * 100%)); }
</style>
