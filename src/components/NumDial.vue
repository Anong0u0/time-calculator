<script setup lang="ts">
/* A number you can set without typing: − and +, drag left or right, the wheel, ↑ ↓. Typing still works. */
import { ref, watch } from 'vue';

const props = withDefaults(defineProps<{ modelValue: number; min?: number; max?: number; label: string; step?: number; pad?: number; wrap?: boolean }>(), { min: 0, max: 9999, step: 1, pad: 0, wrap: false });
const emit = defineEmits<{ 'update:modelValue': [number] }>();
const text = ref('');
const show = (v: number) => String(v).padStart(props.pad, '0');
watch(() => props.modelValue, (v) => { text.value = show(v); }, { immediate: true });
function put(v: number) {
  const span = props.max - props.min + 1;
  if (props.wrap) v = ((((v - props.min) % span) + span) % span) + props.min;
  v = Math.max(props.min, Math.min(props.max, Math.round(v)));
  text.value = show(v);
  if (v !== props.modelValue) emit('update:modelValue', v);
}
const bump = (k: number) => put(props.modelValue + k * props.step);
function typed() { const v = parseInt(text.value, 10); if (Number.isFinite(v)) put(v); else text.value = show(props.modelValue); }
let drag: { x: number; v: number; id: number; moved: boolean } | null = null;
function down(e: PointerEvent) {
  if (e.button > 0 || e.pointerType !== 'mouse') return;
  drag = { x: e.clientX, v: props.modelValue, id: e.pointerId, moved: false };
}
function move(e: PointerEvent) {
  if (!drag || e.pointerId !== drag.id) return;
  const dx = e.clientX - drag.x;
  if (!drag.moved && Math.abs(dx) < 5) return;
  if (!drag.moved) { drag.moved = true; try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* fine */ } }
  put(drag.v + Math.round(dx / 8) * props.step * (e.shiftKey ? 10 : 1));
}
function up(e: PointerEvent) { if (drag && drag.moved) e.preventDefault(); drag = null; }
let acc = 0;
function wheel(e: WheelEvent) { e.preventDefault(); acc += e.deltaY; if (Math.abs(acc) >= 40) { bump(acc < 0 ? 1 : -1); acc = 0; } }
</script>

<template>
  <span class="nd" role="group" :aria-label="label">
    <button type="button" class="nd-b" :aria-label="`${label}減少`" @click="bump(-1)">−</button>
    <input v-model="text" class="nd-in mono" inputmode="numeric" :aria-label="label" @change="typed" @keydown.enter.prevent="typed" @keydown.up.prevent="bump($event.shiftKey ? 10 : 1)"
      @keydown.down.prevent="bump($event.shiftKey ? -10 : -1)" @wheel="wheel" @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="up" @focus="($event.target as HTMLInputElement).select()" />
    <button type="button" class="nd-b" :aria-label="`${label}增加`" @click="bump(1)">+</button>
  </span>
</template>

<style scoped>
.nd { display: inline-flex; align-items: center; height: 2rem; border-radius: .6rem; border: 1px solid var(--hair-2); background: var(--surface-2); overflow: hidden; }
.nd:focus-within { border-color: var(--accent); }
.nd-b { width: 1.9rem; height: 100%; color: var(--ink-2); font-size: 1rem; }
.nd-b:hover { background: var(--accent-wash); color: var(--accent); }
.nd-in { width: 3.4ch; min-width: 2.6rem; border: 0; background: none; text-align: center; font-size: .95rem; font-weight: 600; color: var(--ink); cursor: ew-resize; padding: 0; }
.nd-in:focus { cursor: text; outline: none; }
@media (pointer: coarse) { .nd { height: 2.4rem; } .nd-b { width: 2.4rem; } }
</style>
