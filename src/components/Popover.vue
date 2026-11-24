<script setup lang="ts">
/* A floating panel anchored to the control that opened it. Closes on Esc or a press outside. */
import { ref, reactive, watch, nextTick, onBeforeUnmount } from 'vue';
import { hideTip } from '../composables/tip';

/** tall: on a phone it takes the whole screen's height instead of the room beside its anchor (editors with much in them). */
const props = withDefaults(defineProps<{ open: boolean; anchor: HTMLElement | null; label: string; width?: string; align?: 'start' | 'end'; tall?: boolean }>(), { width: '22rem', align: 'start' });
const emit = defineEmits<{ close: [] }>();
const el = ref<HTMLElement | null>(null);
const me = Symbol('pop');
const pos = reactive({ top: 0, left: 0, maxH: 400, ready: false });

function place() {
  const a = props.anchor, p = el.value;
  if (!a || !p) return;
  const r = a.getBoundingClientRect();
  const pw = p.offsetWidth, ph = Math.max(p.offsetHeight, p.scrollHeight);
  const vh = window.innerHeight, vw = window.innerWidth;
  if (props.tall && vw < 700) {
    pos.maxH = vh - 16;
    pos.top = Math.max(8, Math.min(vh - 8 - Math.min(ph, pos.maxH), 8));
    pos.left = Math.max(8, (vw - pw) / 2);
    pos.ready = true;
    return;
  }
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
  // a press inside a popover opened from this one (a shortcut's editor inside the shortcuts) keeps this one open
  const i = stack.indexOf(me);
  if (stack.slice(i + 1).length && (t as Element).closest?.('.pop')) return;
  emit('close');
}
function onKey(e: KeyboardEvent) {
  // Esc closes the popover on top only
  if (e.key === 'Escape' && stack[stack.length - 1] === me) { e.preventDefault(); e.stopPropagation(); emit('close'); props.anchor?.focus(); }
}
function bind(on: boolean) {
  const i = stack.indexOf(me);
  if (i >= 0) stack.splice(i, 1);
  if (on) stack.push(me);
  const f = on ? document.addEventListener.bind(document) : document.removeEventListener.bind(document);
  f('pointerdown', onDown as EventListener, true);
  f('keydown', onKey as EventListener, true);
  (on ? window.addEventListener : window.removeEventListener)('resize', place);
}
/* the content can grow or change width while open (a tab, an editor opening): keep it on screen */
let ro: ResizeObserver | null = null;
let natural = 0;
function watchSize(on: boolean) {
  ro?.disconnect(); ro = null;
  if (!on || !el.value || typeof ResizeObserver === 'undefined') return;
  ro = new ResizeObserver(() => {
    const p = el.value;
    if (!p) return;
    const w = p.offsetWidth, h = p.scrollHeight;
    if (Math.abs(w * 10000 + h - natural) < 1) return;
    natural = w * 10000 + h;
    place();
  });
  ro.observe(el.value);
  const inner = el.value.firstElementChild;
  if (inner) ro.observe(inner);
}
watch(() => props.open, async (o) => {
  bind(false);
  watchSize(false);
  pos.ready = false;
  if (!o) return;
  hideTip();
  await nextTick();
  place();
  bind(true);
  watchSize(true);
}, { immediate: true });
watch(() => props.width, () => nextTick(place));
onBeforeUnmount(() => { bind(false); watchSize(false); });
defineExpose({ place, pos });
</script>

<script lang="ts">
/** The open popovers, oldest first. */
const stack: symbol[] = [];
</script>

<template>
  <Teleport to="body">
    <div v-if="open" ref="el" class="pop" role="dialog" :aria-label="label"
      :style="{ top: pos.top + 'px', left: pos.left + 'px', width: `min(${width}, calc(100vw - 16px))`, maxHeight: pos.maxH + 'px', opacity: pos.ready ? 1 : 0, pointerEvents: pos.ready ? 'auto' : 'none' }">
      <slot :max-h="pos.maxH" />
    </div>
  </Teleport>
</template>
