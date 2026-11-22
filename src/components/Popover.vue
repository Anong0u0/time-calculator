<script setup lang="ts">
/* A floating panel anchored to the control that opened it. Closes on Esc or a press outside. */
import { ref, reactive, watch, nextTick, onBeforeUnmount } from 'vue';
import { hideTip } from '../composables/tip';

const props = withDefaults(defineProps<{ open: boolean; anchor: HTMLElement | null; label: string; width?: string; align?: 'start' | 'end' }>(), { width: '22rem', align: 'start' });
const emit = defineEmits<{ close: [] }>();
const el = ref<HTMLElement | null>(null);
const pos = reactive({ top: 0, left: 0, maxH: 400, ready: false });

function place() {
  const a = props.anchor, p = el.value;
  if (!a || !p) return;
  const r = a.getBoundingClientRect();
  const pw = p.offsetWidth, ph = p.offsetHeight;
  const vh = window.innerHeight, vw = window.innerWidth;
  const below = vh - r.bottom - 10, above = r.top - 10;
  const up = ph > below && above > below;
  pos.maxH = Math.max(120, (up ? above : below) - 4);
  const h = Math.min(ph, pos.maxH);
  pos.top = up ? Math.max(8, r.top - 6 - h) : Math.min(vh - h - 8, r.bottom + 6);
  const want = props.align === 'end' ? r.right - pw : r.left;
  pos.left = Math.max(8, Math.min(vw - pw - 8, want));
  pos.ready = true;
}
function onDown(e: PointerEvent) {
  const t = e.target as Node;
  if (el.value?.contains(t) || props.anchor?.contains(t)) return;
  emit('close');
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); emit('close'); props.anchor?.focus(); }
}
function bind(on: boolean) {
  const f = on ? document.addEventListener.bind(document) : document.removeEventListener.bind(document);
  f('pointerdown', onDown as EventListener, true);
  f('keydown', onKey as EventListener, true);
  (on ? window.addEventListener : window.removeEventListener)('resize', place);
}
watch(() => props.open, async (o) => {
  bind(false);
  pos.ready = false;
  if (!o) return;
  hideTip();
  await nextTick();
  place();
  bind(true);
}, { immediate: true });
onBeforeUnmount(() => bind(false));
defineExpose({ place, pos });
</script>

<template>
  <Teleport to="body">
    <div v-if="open" ref="el" class="pop" role="dialog" :aria-label="label"
      :style="{ top: pos.top + 'px', left: pos.left + 'px', width: `min(${width}, calc(100vw - 16px))`, maxHeight: pos.maxH + 'px', opacity: pos.ready ? 1 : 0, pointerEvents: pos.ready ? 'auto' : 'none' }">
      <slot :max-h="pos.maxH" />
    </div>
  </Teleport>
</template>
