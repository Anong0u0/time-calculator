<script setup lang="ts">
/* The answer band: start + span = end. Every other panel is another reading of these three. */
import Endpoint from './Endpoint.vue';
import SpanCenter from './SpanCenter.vue';
import { ref, watch, onMounted, onBeforeUnmount } from 'vue';
import { remPx } from '../composables/size';
/** autoTight: the band sits in a cell of fixed height (short screens). It shows the quick chips only when they fit. */
const props = defineProps<{ compact?: boolean; stack?: boolean; autoTight?: boolean }>();

const root = ref<HTMLElement | null>(null);
const tight = ref(!!props.autoTight);
function measure() {
  const el = root.value;
  if (!props.autoTight || !el) { tight.value = false; return; }
  const top = el.getBoundingClientRect().top;
  const used = Math.max(...[...el.children].map((c) => c.getBoundingClientRect().bottom)) - top;
  const room = el.clientHeight;
  // Hysteresis: showing the chips adds about 2.2rem, so ask for a little more than that before showing them.
  if (tight.value) { if (room - used >= 2.5 * remPx.value) tight.value = false; }
  else if (used > room + 1) tight.value = true;
}
let ro: ResizeObserver | null = null;
onMounted(() => {
  ro = new ResizeObserver(() => requestAnimationFrame(measure));
  if (root.value) { ro.observe(root.value); [...root.value.children].forEach((c) => ro!.observe(c)); }
  measure();
});
onBeforeUnmount(() => ro?.disconnect());
watch(() => props.autoTight, (v) => { tight.value = !!v; requestAnimationFrame(measure); });
</script>

<template>
  <div ref="root" class="eq" :class="stack ? 'stack' : 'row'">
    <Endpoint which="start" class="eq-s" :compact="compact" />
    <span class="op op1" aria-hidden="true">+</span>
    <SpanCenter class="eq-m" :compact="compact" :tight="tight" />
    <span class="op op2" aria-hidden="true">=</span>
    <Endpoint which="end" class="eq-e" :compact="compact" />
  </div>
</template>

<style scoped>
.eq { display: grid; min-width: 0; min-height: 0; position: relative; }
.eq.row { grid-template-columns: minmax(0, 1fr) 1.5rem minmax(0, 1.38fr) 1.5rem minmax(0, 1fr); align-items: stretch; }
.eq.stack { grid-template-rows: auto .55rem auto .55rem auto; grid-template-columns: minmax(0, 1fr); align-content: start; }
.op {
  z-index: 2; align-self: center; justify-self: center; display: grid; place-items: center;
  width: 1.75rem; height: 1.75rem; border-radius: 50%; background: var(--surface-2); color: var(--accent);
  border: 1px solid var(--hair-2); box-shadow: var(--shadow); font: 600 1.05rem/1 var(--f-mono); font-stretch: 75%;
}
.stack .op { justify-self: start; margin-left: 1.5rem; width: 1.5rem; height: 1.5rem; font-size: .95rem; }
</style>
