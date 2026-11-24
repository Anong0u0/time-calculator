<script setup lang="ts">
/* The main reading: start + span = end, printed largest on the face.
   One rail threads the equation: ● start ── (+) ── span ── (=) ── ○ end. The span stretch of the rail carries
   the ticks, the progress and the red "now" hand. The + opens the span; the = links or fixes the end.
   In a row the rail runs under the three; stacked, it runs down the left edge.
   The rail is also a range slider: drag ● or ○ to move that end, drag the stretch between to move both (the span
   kept), the wheel does the same a step at a time, and hovering reads the moment under the pointer. The step is a
   unit that suits the span (minutes for an hour, days for a month, months for years).
   Drag = toward an end to make the span compute that end (開始 = 結束 − 間隔, or 結束 = 開始 + 間隔). */
import Endpoint from './Endpoint.vue';
import SpanCenter from './SpanCenter.vue';
import { ref, reactive, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue';
import { S, now, hasEnd, railProgress, commit, freezeLink, linkFromMeasured, wallOf, linkSentence, followText, linkTarget, startMs, endMs, setInstant, type End, other, bump, tzOf, isLinked, shown } from '../state/store';
import { fmtDT, addDuration, partsInTz, WD, wdOf, pad, type Span } from '../core/time';
import { editSpan } from '../state/ui';
import { remPx, fontsTick } from '../composables/size';
/** autoTight: the band sits in a cell of fixed height (short screens). It shows the quick chips only when they fit.
    big: nothing else below it, so it takes the whole height and its readings grow to fill it. */
const props = defineProps<{ compact?: boolean; stack?: boolean; autoTight?: boolean; big?: boolean }>();

/* ---------- the pieces shown: start, span and end can each be put away, and so can the rail ----------
   The grid is built from what is left; a joint (+ or =) stands only between the span and an end. */
type Slot = 's' | 'j1' | 'm' | 'j2' | 'e';
const parts = computed(() => {
  const s = shown('start'), m = shown('span'), e = shown('end'), rail = shown('rail');
  const sizes: string[] = [];
  const at: Partial<Record<Slot, number>> = {};
  const put = (k: Slot, size: string) => { sizes.push(size); at[k] = sizes.length; };
  if (props.stack) {
    if (s) put('s', 'auto');
    if (s && m) put('j1', '.5rem');
    if (m) put('m', props.big ? 'minmax(0, 1fr)' : 'auto');
    if (m && e) put('j2', '.5rem');
    if (e) put('e', 'auto');
    return { s, m, e, rail, at, style: { gridTemplateRows: sizes.join(' ') } };
  }
  if (s) put('s', 'minmax(0, 1fr)');
  if (s && (m || e)) put('j1', '2.3rem');
  if (m) put('m', 'minmax(0, 1.38fr)');
  if (m && e) put('j2', '2.3rem');
  if (e) put('e', 'minmax(0, 1fr)');
  return { s, m, e, rail, at, style: { gridTemplateColumns: sizes.join(' '), gridTemplateRows: rail ? 'minmax(0, 1fr) 2rem' : 'minmax(0, 1fr)' } };
});
/** Where a piece goes: its column in a row (the joints on the rail's line), its row when stacked. */
function place(k: Slot, onRail = false) {
  const i = parts.value.at[k];
  if (props.stack) return { gridRow: String(i) };
  return { gridRow: onRail && parts.value.rail ? '2' : '1', gridColumn: String(i) };
}
const showOp1 = computed(() => parts.value.s && parts.value.m);
const showOp2 = computed(() => parts.value.m && parts.value.e);
/** The ruler runs under the span; with the span put away, along the whole rail. Next to an edge it leaves room for the rail's caption. */
const rulerStyle = computed(() => ({ gridRow: '2', gridColumn: parts.value.m ? String(parts.value.at.m) : '1 / -1' }));
const rulerEdge = computed(() => ({ 'edge-l': !parts.value.m || !parts.value.s, 'edge-r': !parts.value.m || !parts.value.e }));

const root = ref<HTMLElement | null>(null);
const tight = ref(!!props.autoTight);
function measure() {
  const el = root.value;
  if (!props.autoTight || !el) { tight.value = false; return; }
  const top = el.getBoundingClientRect().top;
  const used = Math.max(...[...el.children].filter((c) => !c.classList.contains('vrail')).map((c) => c.getBoundingClientRect().bottom)) - top;
  const room = el.clientHeight;
  // Hysteresis: showing the chips adds about 2.2rem, so ask for a little more than that before showing them.
  if (tight.value) { if (room - used >= 2.5 * remPx.value) tight.value = false; }
  else if (used > room + 1) tight.value = true;
}

/* ---------- the joints ---------- */
const plusTip = '開始 + 間隔：點一下輸入間隔，例如 +30天、3個月';
const N = { start: '開始', end: '結束' } as const;
const eqTip = computed(() => {
  if (!hasEnd.value) return '設定結束後，= 決定兩端是各自固定，還是用間隔連在一起';
  if (S.link) return `連動中：${linkSentence()}。${followText()}。點一下改成固定`;
  const to = linkTarget();
  return `兩端各自固定。點一下改成連動：保持目前的間隔，${N[to]}跟著${N[to === 'end' ? 'start' : 'end']}移動。往左拖＝算開始，往右拖＝算結束`;
});
function plus() { editSpan(); }
let eqDrag: { x: number; id: number; to: End | null } | null = null;
const eqLean = ref<End | null>(null);
function eqDown(e: PointerEvent) {
  if (e.button > 0 || !hasEnd.value) return;
  eqDrag = { x: e.clientX, id: e.pointerId, to: null };
  try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* fine */ }
}
function eqMove(e: PointerEvent) {
  if (!eqDrag || e.pointerId !== eqDrag.id) return;
  const dx = props.stack ? 0 : e.clientX - eqDrag.x;
  eqDrag.to = dx < -18 ? 'start' : dx > 18 ? 'end' : null;
  eqLean.value = eqDrag.to;
}
let eqSkip = false;
function eqUp(e: PointerEvent) {
  if (!eqDrag || e.pointerId !== eqDrag.id) return;
  const to = eqDrag.to;
  eqDrag = null; eqLean.value = null;
  if (!to) return;
  eqSkip = true;
  setTimeout(() => { eqSkip = false; }, 0);
  if (S.link && S.linkTo === to) return;
  commit(() => linkFromMeasured(to), { label: `連動：算${N[to]}`, say: () => `${linkSentence()}，${followText()}` });
  bump(to);
}
function equals() {
  if (eqSkip) return;
  if (!hasEnd.value) return;
  if (S.link) { const to = S.linkTo; commit(freezeLink, { label: `固定${N[to]}`, say: () => `${N[to]}固定在 ${fmtDT(wallOf(to)!)}` }); }
  else commit(linkFromMeasured, { label: '連動', say: () => `${linkSentence()}，${followText()}` });
}

/* ---------- the rail ---------- */
const sec = computed(() => Math.floor(now.value / 1000) % 60);
const rail = railProgress;

/* ---------- the rail as a range slider ---------- */
const ruler = ref<HTMLElement | null>(null);
const STEPS: { k: keyof Span; ms: number; name: string }[] = [
  { k: 's', ms: 1e3, name: '秒' }, { k: 'mi', ms: 6e4, name: '分' }, { k: 'h', ms: 3.6e6, name: '小時' }, { k: 'd', ms: 8.64e7, name: '天' },
  { k: 'w', ms: 6.048e8, name: '週' }, { k: 'mo', ms: 2.6298e9, name: '個月' }, { k: 'y', ms: 3.15576e10, name: '年' },
];
/** How much time a pixel is, and the step that suits it: the span spread over the ruler. */
function scale() {
  const w = ruler.value?.getBoundingClientRect().width || 400;
  const span = endMs.value != null ? Math.abs(endMs.value - startMs.value) : 0;
  const perPx = Math.max(span, 3.6e6 * 6) / w;
  const step = STEPS.find((u) => u.ms >= perPx * 9) || STEPS[STEPS.length - 1];
  return { perPx, step };
}
const moved = (ms: number, k: keyof Span, n: number, tz: string) => (n ? addDuration(ms, tz, { [k]: Math.abs(n) }, n < 0 ? -1 : 1).ms : ms);
type Grip = 'start' | 'end' | 'both';
const GRIP_NAME: Record<Grip, string> = { start: '開始', end: '結束', both: '兩端一起' };
const slide = ref<{ grip: Grip; id: number; x: number; s0: number; e0: number | null; n: number; perPx: number; step: (typeof STEPS)[number]; moved: boolean } | null>(null);
const readout = ref<{ x: number; text: string } | null>(null);
let session = 0;
/** Move by n steps from where the drag began. */
function moveBy(grip: Grip, s0: number, e0: number | null, k: keyof Span, n: number, key: string) {
  const sTz = tzOf('start'), eTz = tzOf('end');
  const label = `${GRIP_NAME[grip]}移動 ${n > 0 ? '+' : '−'}${Math.abs(n)}`;
  if (grip === 'start') return commit(() => setInstant('start', moved(s0, k, n, sTz)), { key, hold: true, label });
  if (grip === 'end') return commit(() => setInstant('end', moved(e0 ?? s0, k, n, eTz)), { key, hold: true, label });
  // both: with a link, move the end it counts from (the other follows); otherwise move each by the same steps
  if (S.link) { const a = other(S.linkTo); return commit(() => setInstant(a, moved(a === 'start' ? s0 : e0!, k, n, tzOf(a))), { key, hold: true, label }); }
  return commit(() => setInstant('start', moved(s0, k, n, sTz)) && (e0 == null || setInstant('end', moved(e0, k, n, eTz))), { key, hold: true, label });
}
/** Keep the readout's middle far enough from the edges for it to show whole. */
const clampX = (x: number, w: number) => Math.min(w - 7 * remPx.value, Math.max(7 * remPx.value, x));
function when(ms: number, tz: string) { const w = partsInTz(ms, tz); return `${w.y !== partsInTz(now.value, tz).y ? w.y + '/' : ''}${w.mo}/${w.d}（${WD[wdOf(w)]}）${pad(w.h)}:${pad(w.mi)}`; }
function gripDown(grip: Grip, e: PointerEvent) {
  if (e.button > 0) return;
  if (grip !== 'start' && endMs.value == null && grip === 'both') return;
  const { perPx, step } = scale();
  slide.value = { grip, id: e.pointerId, x: e.clientX, s0: startMs.value, e0: endMs.value, n: 0, perPx, step, moved: false };
  session++;
  try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* fine */ }
  e.preventDefault();
}
function gripMove(e: PointerEvent) {
  const sl = slide.value;
  if (!sl || e.pointerId !== sl.id) { hoverRuler(e); return; }
  const dx = e.clientX - sl.x;
  if (!sl.moved && Math.abs(dx) < 4) return;
  sl.moved = true;
  const n = Math.round((dx * sl.perPx) / sl.step.ms) * (e.shiftKey ? 10 : 1);
  if (n !== sl.n) { sl.n = n; moveBy(sl.grip, sl.s0, sl.e0, sl.step.k, n, `rail-${session}`); }
  const which: End = sl.grip === 'end' ? 'end' : 'start';
  const box = (e.currentTarget as HTMLElement).closest('.eq')!.getBoundingClientRect();
  const ms = which === 'end' ? endMs.value : startMs.value;
  readout.value = { x: clampX(e.clientX - box.left, box.width), text: `${GRIP_NAME[sl.grip]} ${n >= 0 ? '+' : '−'}${Math.abs(n)}${sl.step.name}${ms != null ? ' · ' + when(ms, tzOf(which)) : ''}` };
}
function gripUp(e: PointerEvent) {
  const sl = slide.value;
  if (!sl || e.pointerId !== sl.id) return;
  slide.value = null; readout.value = null;
  if (sl.n) { bump(sl.grip === 'end' ? 'end' : 'start'); if (sl.grip !== 'start') bump('end'); }
}
function hoverRuler(e: PointerEvent) {
  if (e.pointerType !== 'mouse' || slide.value || !ruler.value || endMs.value == null) return;
  if (!(e.currentTarget as HTMLElement).classList.contains('ruler')) return;
  const r = ruler.value.getBoundingClientRect();
  const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  const ms = startMs.value + f * (endMs.value - startMs.value);
  const box = ruler.value.closest('.eq')!.getBoundingClientRect();
  readout.value = { x: clampX(e.clientX - box.left, box.width), text: `${when(ms, tzOf('start'))} · ${Math.round(f * 100)}% · 拖曳移動兩端` };
}
let wheelAcc = 0;
function gripWheel(grip: Grip, e: WheelEvent) {
  if (grip !== 'start' && endMs.value == null) return;
  e.preventDefault();
  wheelAcc += e.deltaY;
  if (Math.abs(wheelAcc) < 40) return;
  const n = wheelAcc < 0 ? 1 : -1;
  wheelAcc = 0;
  const { step } = scale();
  moveBy(grip, startMs.value, endMs.value, step.k, n, `rail-w-${grip}`);
}
function gripKey(grip: Grip, e: KeyboardEvent) {
  const d = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0;
  if (!d) return;
  e.preventDefault();
  const { step } = scale();
  moveBy(grip, startMs.value, endMs.value, step.k, d * (e.shiftKey ? 10 : 1), `rail-k-${grip}`);
}
const gripTip = (g: Grip) => {
  const st = scale().step.name;
  return g === 'both' ? `拖曳：兩端一起移動，間隔不變（每格 1 ${st}）；停在上面看那一點的時刻` : `拖曳或滾輪：移動${GRIP_NAME[g]}（每格 1 ${st}，按住 Shift 一次 10 格）`;
};
void isLinked;
/** Stacked: the rail is measured from the ● and ○ in the headers and the + and = on it. */
const v = reactive({ x: 0, top: 0, h: 0, a: 0, b: 0, ok: false });
function placeRail() {
  const el = root.value;
  if (!el || !props.stack || !parts.value.rail) { v.ok = false; return; }
  const q = (s: string) => el.querySelector(s)?.getBoundingClientRect();
  const r0 = el.getBoundingClientRect(), ra = q('.eq-s .ep-head .node'), rb = q('.eq-e .ep-head .node'), p1 = q('.op1'), p2 = q('.op2');
  if (!ra || !rb || !p1 || !p2) { v.ok = false; return; }
  v.x = ra.left + ra.width / 2 - r0.left;
  v.top = ra.bottom - r0.top + 3;
  v.h = Math.max(0, rb.top - ra.bottom - 6);
  v.a = p1.top + p1.height / 2 - ra.bottom - 3;
  v.b = p2.top + p2.height / 2 - ra.bottom - 3;
  v.ok = v.h > 10;
}
const relayout = () => requestAnimationFrame(() => { measure(); placeRail(); });

let ro: ResizeObserver | null = null;
function observe() {
  if (!ro || !root.value) return;
  ro.disconnect();
  ro.observe(root.value);
  [...root.value.children].forEach((c) => ro!.observe(c));
}
onMounted(() => {
  ro = new ResizeObserver(relayout);
  observe();
  measure();
  placeRail();
});
watch(() => [parts.value.s, parts.value.m, parts.value.e, parts.value.rail, props.big], () => nextTick(() => { observe(); relayout(); }));
onBeforeUnmount(() => ro?.disconnect());
watch(() => props.autoTight, (val) => { tight.value = !!val; requestAnimationFrame(measure); });
watch([() => props.stack, fontsTick, hasEnd], () => nextTick(relayout));
</script>

<template>
  <div ref="root" class="eq" :class="[stack ? 'stack' : 'row', { big }]" :style="{ ...parts.style, ...(v.ok ? { '--rail-x': v.x + 'px' } : {}) }">
    <Endpoint v-if="parts.s" which="start" class="eq-s" :style="place('s')" :compact="compact" :big="big" />
    <SpanCenter v-if="parts.m" class="eq-m" :style="place('m')" :compact="compact" :tight="tight" :big="big" />
    <Endpoint v-if="parts.e" which="end" class="eq-e" :style="place('e')" :compact="compact" :big="big" />

    <template v-if="!stack">
      <span v-if="parts.at.j1" class="div div1" :style="place('j1')" aria-hidden="true" />
      <span v-if="parts.at.j2" class="div div2" :style="place('j2')" aria-hidden="true" />
      <div v-if="parts.rail" class="track">
        <button type="button" class="hnd s" :class="{ on: slide?.grip === 'start' }" aria-label="移動開始：拖曳、滾輪或左右鍵" v-tip="gripTip('start')"
          @pointerdown="gripDown('start', $event)" @pointermove="gripMove" @pointerup="gripUp" @pointercancel="gripUp" @wheel="gripWheel('start', $event)" @keydown="gripKey('start', $event)"><i class="node" /></button>
        <span class="cap s" aria-hidden="true">開始</span><span class="cap e" aria-hidden="true">結束</span>
        <button type="button" class="hnd e" :class="{ on: slide?.grip === 'end' }" aria-label="移動結束：拖曳、滾輪或左右鍵" v-tip="hasEnd ? gripTip('end') : '從這裡拖出去就有結束'"
          @pointerdown="gripDown('end', $event)" @pointermove="gripMove" @pointerup="gripUp" @pointercancel="gripUp" @wheel="gripWheel('end', $event)" @keydown="gripKey('end', $event)"><i class="node end" :class="{ off: !hasEnd }" /></button>
      </div>
      <div v-if="parts.rail" ref="ruler" class="ruler" :class="{ live: hasEnd, on: slide?.grip === 'both', ...rulerEdge }" :style="rulerStyle" aria-hidden="true"
        @pointerdown="hasEnd && gripDown('both', $event)" @pointermove="gripMove" @pointerup="gripUp" @pointercancel="gripUp" @pointerleave="!slide && (readout = null)" @wheel="gripWheel('both', $event)">
        <svg class="ticks" viewBox="0 0 600 10" preserveAspectRatio="none">
          <line v-for="i in 61" :key="i" :x1="(i - 1) * 10" :x2="(i - 1) * 10" :y1="(i - 1) % 5 ? 4.5 : 0" y2="10" :class="{ five: (i - 1) % 5 === 0, past: i - 1 <= sec }" />
        </svg>
        <span class="fill" :style="{ width: rail.f * 100 + '%' }" />
        <span v-if="rail.now != null" class="hand" :style="{ left: rail.now * 100 + '%' }" />
      </div>
    </template>
    <div v-else-if="v.ok" class="vrail" aria-hidden="true" :style="{ left: v.x + 'px', top: v.top + 'px', height: v.h + 'px' }">
      <span class="vticks" :style="{ top: v.a + 'px', height: Math.max(0, v.b - v.a) + 'px' }" />
      <span class="vfill" :style="{ top: v.a + 'px', height: Math.max(0, v.b - v.a) * rail.f + 'px' }" />
      <span v-if="rail.now != null" class="vhand" :style="{ top: v.a + (v.b - v.a) * rail.now + 'px' }" />
    </div>

    <button v-if="showOp1" type="button" class="op op1" :style="place('j1', true)" v-tip="plusTip" aria-label="開始加上間隔：輸入間隔" @click="plus">+</button>
    <button v-if="showOp2" type="button" class="op op2" :style="place('j2', true)" :class="{ linked: !!S.link, lean: !!eqLean, [`lean-${eqLean}`]: !!eqLean }" :disabled="!hasEnd" :aria-pressed="!!S.link" v-tip="eqTip"
      :aria-label="S.link ? `連動：${linkSentence()}，點一下改成固定` : '兩端固定，點一下改成連動'" @click="equals"
      @pointerdown="eqDown" @pointermove="eqMove" @pointerup="eqUp" @pointercancel="eqUp">=</button>
    <span v-if="eqLean" class="eq-lean" :class="eqLean" aria-hidden="true">{{ eqLean === 'start' ? '← 算開始：開始 = 結束 − 間隔' : '算結束：結束 = 開始 + 間隔 →' }}</span>
    <span v-if="readout" class="readout" :style="{ left: readout.x + 'px' }" aria-hidden="true">{{ readout.text }}</span>
  </div>
</template>

<style scoped>
/* no plate: the band is printed on the face like everything else; the rail is its horizon */
.eq { display: grid; min-width: 0; min-height: 0; position: relative; }
.eq.row { padding-bottom: .3rem; }
.div { align-self: stretch; background: linear-gradient(to bottom, transparent 14%, var(--hair) 32%, var(--hair) 72%, transparent 92%) center / 1px 100% no-repeat; }

/* the rail along the bottom of the band */
.track { grid-area: 2 / 1 / 3 / -1; position: relative; margin: 0 1.1rem; }
.track::before { content: ''; position: absolute; left: 3.6rem; right: 3.6rem; top: 50%; height: 1px; background: var(--hair-2); }
/* engraved captions where the rail begins and ends, like the scale names printed on a dial */
.cap { position: absolute; top: 50%; transform: translateY(-50%); font-size: var(--fs-xs); font-weight: 600; letter-spacing: .22em; color: var(--ink-4); line-height: 1; }
.cap.s { left: 1.15rem; }
.cap.e { right: 1.05rem; }
.hnd { position: absolute; top: 50%; z-index: 2; width: 1.6rem; height: 1.6rem; margin-top: -.8rem; display: grid; place-items: center; border-radius: 50%; cursor: ew-resize; touch-action: none; }
.hnd.s { left: -.4rem; }
.hnd.e { right: -.4rem; }
.hnd .node { font-size: .82rem; transition: transform .15s; }
.hnd .node.end { background: var(--face); }
.hnd .node.off { opacity: .4; }
.hnd:hover .node, .hnd.on .node, .hnd:focus-visible .node { transform: scale(1.35); }
.hnd:hover, .hnd.on { background: var(--accent-wash); }
.ruler.live { cursor: grab; touch-action: none; }
.ruler.live:hover .ticks line, .ruler.on .ticks line { stroke: var(--accent-line); }
.ruler.on { cursor: grabbing; }
.readout, .eq-lean { position: absolute; z-index: 6; bottom: 2.15rem; transform: translateX(-50%); padding: .25rem .55rem; border-radius: .5rem; background: var(--ink); color: var(--surface); font-size: var(--fs-xs); font-weight: 600; white-space: nowrap; pointer-events: none; font-variant-numeric: tabular-nums; }
.eq-lean { left: 50%; }
.op.lean-start { transform: translateX(-.35rem) scale(1.08); }
.op.lean-end { transform: translateX(.35rem) scale(1.08); }
.ruler { position: relative; margin: 0 .35rem; }
.ruler.edge-l { margin-left: 5rem; }
.ruler.edge-r { margin-right: 5rem; }
.ticks { position: absolute; left: 0; right: 0; bottom: 50%; width: 100%; height: .6rem; overflow: visible; }
.ticks line { stroke: var(--hair-2); stroke-width: 1; vector-effect: non-scaling-stroke; }
.ticks line.five { stroke: var(--ink-4); opacity: .6; }
.ticks line.past { stroke: var(--ink-3); opacity: .8; }
.fill { position: absolute; left: 0; top: 50%; height: 2px; margin-top: -1px; border-radius: 2px; background: var(--accent); opacity: .7; transition: width .6s var(--ease); }
.hand { position: absolute; top: 50%; width: 2px; height: 1.1rem; margin: -.7rem 0 0 -1px; border-radius: 1px; background: var(--now); transition: left .6s var(--ease); }
.hand::after { content: ''; position: absolute; left: 50%; bottom: -.18rem; width: .36rem; height: .36rem; margin-left: -.18rem; border-radius: 50%; background: var(--now); }

/* the joints: + and = are the equation's operators, and they act */
.op {
  z-index: 2; place-self: center; display: grid; place-items: center; padding: 0;
  width: 2rem; height: 2rem; border-radius: 50%;
  background: var(--face); color: var(--accent); border: 1.5px solid var(--accent-line);
  font: 650 1.12rem/1 var(--f-mono); font-stretch: 75%;
  box-shadow: 0 1px 3px rgba(11, 18, 34, .12);
  transition: background .18s, color .18s, border-color .18s, transform .18s;
}
.op:hover:not(:disabled) { background: var(--accent-wash); border-color: var(--accent); transform: scale(1.06); }
.op.linked { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); }
.op.linked:hover { background: var(--accent-2); }
.op:disabled { cursor: default; color: var(--ink-4); border-color: var(--hair-2); }

/* stacked: rows, with the rail down the left lane and the joints on it */
.eq.stack { grid-template-columns: minmax(0, 1fr); align-content: start; }
.eq.stack.big { align-content: stretch; }
.stack .op { justify-self: start; width: 1.7rem; height: 1.7rem; font-size: .98rem; margin-left: calc(var(--rail-x, 1.1rem) - .85rem); }
.vrail { position: absolute; z-index: 1; width: 0; pointer-events: none; }
.vrail::before { content: ''; position: absolute; left: -.5px; top: 0; bottom: 0; width: 1px; background: var(--hair-2); }
.vticks { position: absolute; left: -.42rem; width: .3rem; background: repeating-linear-gradient(to bottom, var(--hair-2) 0 1px, transparent 1px .42rem); }
.vfill { position: absolute; left: -1px; width: 2px; border-radius: 2px; background: var(--accent); opacity: .7; transition: height .6s var(--ease); }
.vhand { position: absolute; left: -.55rem; width: 1.1rem; height: 2px; margin-top: -1px; border-radius: 1px; background: var(--now); transition: top .6s var(--ease); }
</style>
