<script setup lang="ts">
/* The main reading: start + span = end, printed largest on the face.
   One rail threads the equation: ● start ── (+) ── span ── (=) ── ○ end. The span stretch of the rail carries
   the ticks, the progress and the red "now" hand. The + opens the span; the = links or fixes the end.
   In a row the rail runs under the three; stacked, it runs down the left edge. */
import Endpoint from './Endpoint.vue';
import SpanCenter from './SpanCenter.vue';
import { ref, reactive, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue';
import { S, now, hasEnd, railProgress, commit, freezeLink, linkFromMeasured, wallOf, linkSentence, followText, linkTarget } from '../state/store';
import { fmtDT } from '../core/time';
import { editSpan } from '../state/ui';
import { remPx, fontsTick } from '../composables/size';
/** autoTight: the band sits in a cell of fixed height (short screens). It shows the quick chips only when they fit. */
const props = defineProps<{ compact?: boolean; stack?: boolean; autoTight?: boolean }>();

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
  return `兩端各自固定。點一下改成連動：保持目前的間隔，${N[to]}跟著${N[to === 'end' ? 'start' : 'end']}移動`;
});
function plus() { editSpan(); }
function equals() {
  if (!hasEnd.value) return;
  if (S.link) { const to = S.linkTo; commit(freezeLink, { label: `固定${N[to]}`, say: () => `${N[to]}固定在 ${fmtDT(wallOf(to)!)}` }); }
  else commit(linkFromMeasured, { label: '連動', say: () => `${linkSentence()}，${followText()}` });
}

/* ---------- the rail ---------- */
const sec = computed(() => Math.floor(now.value / 1000) % 60);
const rail = railProgress;
/** Stacked: the rail is measured from the ● and ○ in the headers and the + and = on it. */
const v = reactive({ x: 0, top: 0, h: 0, a: 0, b: 0, ok: false });
function placeRail() {
  const el = root.value;
  if (!el || !props.stack) { v.ok = false; return; }
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
onMounted(() => {
  ro = new ResizeObserver(relayout);
  if (root.value) { ro.observe(root.value); [...root.value.children].forEach((c) => ro!.observe(c)); }
  measure();
  placeRail();
});
onBeforeUnmount(() => ro?.disconnect());
watch(() => props.autoTight, (val) => { tight.value = !!val; requestAnimationFrame(measure); });
watch([() => props.stack, fontsTick, hasEnd], () => nextTick(relayout));
</script>

<template>
  <div ref="root" class="eq" :class="stack ? 'stack' : 'row'" :style="v.ok ? { '--rail-x': v.x + 'px' } : undefined">
    <Endpoint which="start" class="eq-s" :compact="compact" />
    <SpanCenter class="eq-m" :compact="compact" :tight="tight" />
    <Endpoint which="end" class="eq-e" :compact="compact" />

    <template v-if="!stack">
      <span class="div div1" aria-hidden="true" />
      <span class="div div2" aria-hidden="true" />
      <div class="track" aria-hidden="true"><i class="node" /><span class="cap s">開始</span><span class="cap e">結束</span><i class="node end" :class="{ off: !hasEnd }" /></div>
      <div class="ruler" aria-hidden="true">
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

    <button type="button" class="op op1" v-tip="plusTip" aria-label="開始加上間隔：輸入間隔" @click="plus">+</button>
    <button type="button" class="op op2" :class="{ linked: !!S.link }" :disabled="!hasEnd" :aria-pressed="!!S.link" v-tip="eqTip"
      :aria-label="S.link ? `連動：${linkSentence()}，點一下改成固定` : '兩端固定，點一下改成連動'" @click="equals">=</button>
  </div>
</template>

<style scoped>
/* no plate: the band is printed on the face like everything else; the rail is its horizon */
.eq { display: grid; min-width: 0; min-height: 0; position: relative; }
.eq.row { grid-template-columns: minmax(0, 1fr) 2.3rem minmax(0, 1.38fr) 2.3rem minmax(0, 1fr); grid-template-rows: minmax(0, 1fr) 2rem; padding-bottom: .3rem; }
.row .eq-s { grid-area: 1 / 1; }
.row .eq-m { grid-area: 1 / 3; }
.row .eq-e { grid-area: 1 / 5; }
.div { grid-row: 1; align-self: stretch; background: linear-gradient(to bottom, transparent 14%, var(--hair) 32%, var(--hair) 72%, transparent 92%) center / 1px 100% no-repeat; }
.div1 { grid-column: 2; }
.div2 { grid-column: 4; }

/* the rail along the bottom of the band */
.track { grid-area: 2 / 1 / 3 / -1; position: relative; margin: 0 1.1rem; }
.track::before { content: ''; position: absolute; left: 3.6rem; right: 3.6rem; top: 50%; height: 1px; background: var(--hair-2); }
/* engraved captions where the rail begins and ends, like the scale names printed on a dial */
.cap { position: absolute; top: 50%; transform: translateY(-50%); font-size: var(--fs-xs); font-weight: 600; letter-spacing: .22em; color: var(--ink-4); line-height: 1; }
.cap.s { left: 1.15rem; }
.cap.e { right: 1.05rem; }
.track .node { position: absolute; top: 50%; font-size: .82rem; transform: translateY(-50%); }
.track .node:first-child { left: 0; }
.track .node.end { right: 0; background: var(--face); }
.track .node.off { opacity: .4; }
.ruler { grid-area: 2 / 3; position: relative; margin: 0 .35rem; }
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
.row .op1 { grid-area: 2 / 2; }
.row .op2 { grid-area: 2 / 4; }

/* stacked: rows, with the rail down the left lane and the joints on it */
.eq.stack { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto .5rem auto .5rem auto; align-content: start; }
.stack .eq-s { grid-row: 1; }
.stack .op1 { grid-row: 2; }
.stack .eq-m { grid-row: 3; }
.stack .op2 { grid-row: 4; }
.stack .eq-e { grid-row: 5; }
.stack .op { justify-self: start; width: 1.7rem; height: 1.7rem; font-size: .98rem; margin-left: calc(var(--rail-x, 1.1rem) - .85rem); }
.vrail { position: absolute; z-index: 1; width: 0; pointer-events: none; }
.vrail::before { content: ''; position: absolute; left: -.5px; top: 0; bottom: 0; width: 1px; background: var(--hair-2); }
.vticks { position: absolute; left: -.42rem; width: .3rem; background: repeating-linear-gradient(to bottom, var(--hair-2) 0 1px, transparent 1px .42rem); }
.vfill { position: absolute; left: -1px; width: 2px; border-radius: 2px; background: var(--accent); opacity: .7; transition: height .6s var(--ease); }
.vhand { position: absolute; left: -.55rem; width: 1.1rem; height: 2px; margin-top: -1px; border-radius: 1px; background: var(--now); transition: top .6s var(--ease); }
</style>
