<script setup lang="ts">
/* One screen, never scrolls. The layout follows the window's shape:
   xwide (four lenses side by side), wide (three), square (zones on top), phone and short (one lens at a time). */
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue';
import TopBar from './components/TopBar.vue';
import Equation from './components/Equation.vue';
import ZonesPanel from './components/ZonesPanel.vue';
import CalendarPanel from './components/CalendarPanel.vue';
import ReadingsPanel from './components/ReadingsPanel.vue';
import DurationPanel from './components/DurationPanel.vue';
import Toast from './components/Toast.vue';
import Icon from './components/Icon.vue';
import { S, type Lens, loadState, seedSample, startPersisting, startClock, undo, redo, bump } from './state/store';
import { interpret } from './state/command';
import { focusCommand, ui } from './state/ui';
import { readRem, remPx } from './composables/size';
import { hideTip } from './composables/tip';

loadState();
seedSample();
startPersisting();

const vw = ref(window.innerWidth), vh = ref(window.innerHeight);
type Layout = 'xwide' | 'wide' | 'square' | 'phone' | 'short';
/** Four columns once the window is about 104 rem wide, so a denser setting brings the fourth column sooner. */
const layout = computed<Layout>(() => {
  if (vw.value < 600) return 'phone';
  if (vh.value < 600) return 'short';
  if (vw.value >= 1000 && vw.value / vh.value >= 1.15) return vw.value / remPx.value >= 104 ? 'xwide' : 'wide';
  return 'square';
});
watch(layout, (l) => { ui.layout = l; }, { immediate: true });
const compact = computed(() => layout.value === 'phone' || layout.value === 'short');
const tabbed = compact;
const lens = computed<Lens>(() => S.lens);
watch(() => S.density, async (d) => {
  document.documentElement.style.setProperty('--density', String(d / 100));
  await nextTick();
  readRem();
}, { immediate: true });
function onResize() { vw.value = window.innerWidth; vh.value = window.innerHeight; readRem(); hideTip(); }

watch(() => S.theme, (t) => {
  const el = document.documentElement;
  if (t === 'system') delete el.dataset.theme; else el.dataset.theme = t;
  const dark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', dark ? '#060910' : '#E9ECF2'));
}, { immediate: true });

const typing = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
};
function onKey(e: KeyboardEvent) {
  const mod = e.metaKey || e.ctrlKey;
  if (mod && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); focusCommand(); return; }
  if (typing(e.target)) return;
  if (!mod && e.key === '/') { e.preventDefault(); focusCommand(); return; }
  if (mod && !e.altKey && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
  if (mod && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); redo(); }
}
/* Paste anywhere: a plain date or timestamp goes straight to the end you touched last; anything else opens the box. */
function onPaste(e: ClipboardEvent) {
  if (typing(e.target)) return;
  const t = (e.clipboardData?.getData('text') || '').trim();
  if (!t || t.length > 200) return;
  e.preventDefault();
  const list = interpret(t);
  const first = list.find((s) => s.apply);
  if (first && (first.kind === S.active) && list.filter((s) => s.apply).length <= 2) {
    first.apply!();
    bump(S.active);
    return;
  }
  focusCommand(t);
}
onMounted(() => {
  readRem();
  window.addEventListener('resize', onResize);
  window.addEventListener('keydown', onKey);
  window.addEventListener('paste', onPaste);
  startClock();
});
onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize);
  window.removeEventListener('keydown', onKey);
  window.removeEventListener('paste', onPaste);
});
const LENSES: [Lens, string, string][] = [['zones', '時區', 'globe'], ['cal', '月曆', 'cal'], ['read', '讀法', 'list']];
</script>

<template>
  <div class="app dial" :data-layout="layout">
    <TopBar class="a-top" :compact="layout === 'phone'" />
    <Equation class="a-eq" :compact="compact" :stack="compact" :auto-tight="layout === 'short'" />
    <div v-if="tabbed" class="a-tabs seg-ctl" role="tablist" aria-label="檢視">
      <button v-for="[k, name, ic] in LENSES" :id="`tab-${k}`" :key="k" type="button" role="tab" :aria-selected="lens === k" :aria-controls="`lens-${k}`" @click="S.lens = k">
        <Icon :name="ic" />{{ name }}
      </button>
    </div>
    <ZonesPanel v-if="!tabbed || lens === 'zones'" id="lens-zones" class="a-zones" :role="tabbed ? 'tabpanel' : undefined" />
    <CalendarPanel v-if="!tabbed || lens === 'cal'" id="lens-cal" class="a-cal" :role="tabbed ? 'tabpanel' : undefined" />
    <ReadingsPanel v-if="!tabbed || lens === 'read'" id="lens-read" class="a-read" :role="tabbed ? 'tabpanel' : undefined" />
    <!-- The duration calculator gets a column of its own only when there is room for four; otherwise it pops up from the span. -->
    <DurationPanel v-if="layout === 'xwide'" id="lens-dur" class="a-dur" />
    <Toast />
  </div>
</template>

<style scoped>
.app {
  height: 100%; display: grid; gap: var(--gap); min-height: 0; min-width: 0;
  padding: max(.85rem, env(safe-area-inset-top)) max(1rem, env(safe-area-inset-right)) max(.95rem, env(safe-area-inset-bottom)) max(1rem, env(safe-area-inset-left));
}
.a-top { grid-area: top; }
.a-eq { grid-area: eq; }
.a-tabs { grid-area: tabs; }
.a-zones { grid-area: zones; }
.a-cal { grid-area: cal; }
.a-read { grid-area: read; }
.a-dur { grid-area: dur; }
.app[data-layout="xwide"] {
  grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, .92fr);
  grid-template-rows: auto auto minmax(0, 1fr);
  grid-template-areas: "top top top top" "eq eq eq eq" "zones cal read dur";
}

.app[data-layout="wide"] {
  grid-template-columns: minmax(0, 1.32fr) minmax(0, 1fr) minmax(0, .98fr);
  grid-template-rows: auto auto minmax(0, 1fr);
  grid-template-areas: "top top top" "eq eq eq" "zones cal read";
}
.app[data-layout="square"] {
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  grid-template-rows: auto auto minmax(0, 1fr) minmax(0, 1.12fr);
  grid-template-areas: "top top" "eq eq" "zones zones" "cal read";
}
.app[data-layout="phone"] {
  --gap: .5rem;
  padding: max(.6rem, env(safe-area-inset-top)) max(.6rem, env(safe-area-inset-right)) max(.6rem, env(safe-area-inset-bottom)) max(.6rem, env(safe-area-inset-left));
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: auto auto auto minmax(0, 1fr);
  grid-template-areas: "top" "eq" "tabs" "zones";
}
.app[data-layout="short"] {
  --gap: .55rem;
  padding: .6rem max(.8rem, env(safe-area-inset-right)) .6rem max(.8rem, env(safe-area-inset-left));
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.15fr);
  grid-template-rows: auto auto minmax(0, 1fr);
  grid-template-areas: "top top" "eq tabs" "eq zones";
}
.app[data-layout="phone"] .a-cal, .app[data-layout="phone"] .a-read,
.app[data-layout="short"] .a-cal, .app[data-layout="short"] .a-read { grid-area: zones; }
.a-tabs { display: flex; width: 100%; }

/* ---------- the face: one dial in a case (see styles.css for the face itself) ---------- */
.app.dial[data-layout="wide"], .app.dial[data-layout="xwide"], .app.dial[data-layout="square"] {
  margin: 8px; height: calc(100% - 16px); border-radius: 1.7rem; overflow: hidden;
  box-shadow: 0 0 0 1px var(--hair-2), 0 1px 0 1px color-mix(in srgb, var(--surface-2) 60%, transparent) inset, 0 30px 70px -48px rgba(11, 18, 34, .45);
  padding: .75rem max(.6rem, env(safe-area-inset-right)) .6rem max(.6rem, env(safe-area-inset-left));
  row-gap: .5rem; column-gap: 1.2rem;
}
.app.dial .a-top { padding: 0 .3rem; }
.a-tabs button { flex: 1; justify-content: center; height: 1.95rem; font-size: .88rem; padding: 0 .3rem; gap: .3rem; }
.a-tabs .ic { width: 1em; height: 1em; }
.app[data-layout="short"] .a-eq { min-height: 0; }
</style>
