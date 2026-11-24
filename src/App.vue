<script setup lang="ts">
/* One screen, never scrolls. The layout follows the window's shape:
   xwide (four lenses side by side), wide (three), square (zones on top), phone and short (one lens at a time).
   Every panel can be put away (keys 1–9, R, M; P for presets; 0 brings everything back): the grid is built from
   what is left, so a lone panel fills the screen (a full-screen countdown, calendar or year). */
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue';
import TopBar from './components/TopBar.vue';
import Equation from './components/Equation.vue';
import ZonesPanel from './components/ZonesPanel.vue';
import CalendarPanel from './components/CalendarPanel.vue';
import ReadingsPanel from './components/ReadingsPanel.vue';
import DurationPanel from './components/DurationPanel.vue';
import Toast from './components/Toast.vue';
import Icon from './components/Icon.vue';
import Popover from './components/Popover.vue';
import PanelMenu from './components/PanelMenu.vue';
import {
  S, type Lens, loadState, seedSample, startPersisting, startClock, undo, redo, bump, shown, togglePanel, applyPreset, cyclePreset,
  PANELS, VIEW_PRESETS, toast,
} from './state/store';
import { interpret } from './state/command';
import { applyUrl, startUrlSync } from './state/url';
import { focusCommand, ui, toggleFullscreen, canFullscreen } from './state/ui';
import { readRem, remPx } from './composables/size';
import { hideTip } from './composables/tip';

const hadSaved = loadState();
// a link's own time wins over what was saved here; a link with a time but no end means no end
if (!applyUrl(location.search, hadSaved)?.time) seedSample();
startPersisting();
startUrlSync();

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

/* ---------- what is shown, and the grid built from it ---------- */
const LENS_ORDER: Lens[] = ['zones', 'cal', 'read', 'dur'];
/** Column widths: three across (wide) as they always were, four across (xwide) with the calculator. */
const FR: Record<'wide' | 'xwide', Record<Lens, number>> = { wide: { zones: 1.32, cal: 1, read: 0.98, dur: 0.92 }, xwide: { zones: 1.3, cal: 1, read: 1, dur: 0.92 } };
const showTop = computed(() => shown('top'));
const showEq = computed(() => shown('start') || shown('span') || shown('end'));
/** The lenses that get a place: as many columns as the layout has (the calculator yields first: it also pops up from the span).
    One at a time on small screens, where the calculator gets a tab only when the span (its button) is put away. */
const lenses = computed<Lens[]>(() => {
  const on = LENS_ORDER.filter((k) => shown(k));
  const l = layout.value;
  if (l === 'phone' || l === 'short') return on.filter((k) => k !== 'dur' || !shown('span') || on.length === 1);
  return on.slice(0, l === 'xwide' ? 4 : 3);
});
watch(lenses, (ls) => { ui.durLens = ls.includes('dur'); }, { immediate: true });
const lens = computed<Lens>(() => (lenses.value.includes(S.lens) ? S.lens : lenses.value[0] ?? 'zones'));
const showTabs = computed(() => tabbed.value && lenses.value.length > 1);
/** Nothing below the equation: it takes the whole height and grows to it. */
const eqBig = computed(() => showEq.value && !lenses.value.length);
const lensVisible = (k: Lens) => lenses.value.includes(k) && (!tabbed.value || lens.value === k);
const areaOf = (k: Lens) => (tabbed.value ? 'lens' : k);
const grid = computed(() => {
  const l = layout.value, L = lenses.value;
  const rows: string[] = [], areas: string[][] = [];
  let cols: string[];
  const fill = (n: number, a: string) => Array(n).fill(a);
  if (l === 'phone' || (l === 'short' && !(showEq.value && L.length))) {
    cols = ['minmax(0, 1fr)'];
    if (showTop.value) { rows.push('auto'); areas.push(['top']); }
    if (showEq.value) { rows.push(L.length ? 'auto' : 'minmax(0, 1fr)'); areas.push(['eq']); }
    if (showTabs.value) { rows.push('auto'); areas.push(['tabs']); }
    if (L.length) { rows.push('minmax(0, 1fr)'); areas.push(['lens']); }
  } else if (l === 'short') {
    cols = ['minmax(0, 1fr)', 'minmax(0, 1.15fr)'];
    if (showTop.value) { rows.push('auto'); areas.push(['top', 'top']); }
    if (showTabs.value) { rows.push('auto'); areas.push(['eq', 'tabs']); }
    rows.push('minmax(0, 1fr)'); areas.push(['eq', 'lens']);
  } else if (l === 'square') {
    // the zones want the width: they get a row of their own; the others share rows of two
    const lr: Lens[][] = [];
    if (L.includes('zones')) lr.push(['zones']);
    const rest = L.filter((k) => k !== 'zones');
    for (let i = 0; i < rest.length; i += 2) lr.push(rest.slice(i, i + 2));
    const n = lr.some((r) => r.length > 1) ? 2 : 1;
    cols = fill(n, 'minmax(0, 1fr)');
    if (showTop.value) { rows.push('auto'); areas.push(fill(n, 'top')); }
    if (showEq.value) { rows.push(L.length ? 'auto' : 'minmax(0, 1fr)'); areas.push(fill(n, 'eq')); }
    for (const r of lr) { rows.push(r[0] === 'zones' ? 'minmax(0, 1fr)' : 'minmax(0, 1.12fr)'); areas.push(r.length === n ? r : fill(n, r[0])); }
  } else {
    const n = Math.max(1, L.length);
    const fr = FR[l === 'xwide' ? 'xwide' : 'wide'];
    cols = L.length ? L.map((k) => `minmax(0, ${fr[k]}fr)`) : ['minmax(0, 1fr)'];
    if (showTop.value) { rows.push('auto'); areas.push(fill(n, 'top')); }
    if (showEq.value) { rows.push(L.length ? 'auto' : 'minmax(0, 1fr)'); areas.push(fill(n, 'eq')); }
    if (L.length) { rows.push('minmax(0, 1fr)'); areas.push(L); }
  }
  return {
    gridTemplateColumns: cols.join(' '),
    gridTemplateRows: rows.join(' '),
    gridTemplateAreas: areas.map((r) => `"${r.join(' ')}"`).join(' '),
  };
});
/** The equation sits beside the lenses on short screens (a cell of fixed height): it shows its chips only when they fit. */
const eqTight = computed(() => layout.value === 'short' && lenses.value.length > 0);
/** The calculator was asked for, but it has no place on the face and its button (in the span) is put away. */
watch(() => ui.durReq, () => {
  if (ui.durLens) { if (tabbed.value) S.lens = 'dur'; return; }
  if (!shown('span')) toast('時長計算機在「間隔」或「時長」面板裡：按 2 或 7 顯示');
});

/* ---------- the corner: the panels menu, for when the top bar is put away ---------- */
const cornerBtn = ref<HTMLElement | null>(null);
const cornerOpen = ref(false);

/* ---------- keys ---------- */
const typing = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
};
/** Panel keys, like a system monitor's: a digit (or R, M) for each panel, 0 all, P presets, Y month or year, F full screen. */
function panelKey(e: KeyboardEvent): boolean {
  if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return false;
  const k = e.key.toLowerCase();
  const d = PANELS.find((p) => p.key === k);
  if (d) { togglePanel(d.k); return true; }
  if (k === '0') { applyPreset(VIEW_PRESETS[0]); return true; }
  if (k === 'p') { cyclePreset(e.shiftKey ? -1 : 1); return true; }
  if (k === 'y') {
    S.calMode = S.calMode === 'year' ? 'month' : 'year';
    toast(S.calMode === 'year' ? `年曆${shown('cal') ? '' : '（月曆目前隱藏，按 5 顯示）'}` : '月曆');
    return true;
  }
  if (k === 'f' && canFullscreen) { toggleFullscreen(); return true; }
  return false;
}
function onKey(e: KeyboardEvent) {
  const mod = e.metaKey || e.ctrlKey;
  if (mod && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); focusCommand(); return; }
  if (typing(e.target) || e.defaultPrevented) return;
  if (!mod && e.key === '/') { e.preventDefault(); focusCommand(); return; }
  if (mod && !e.altKey && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
  if (mod && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); redo(); return; }
  if (panelKey(e)) e.preventDefault();
}
/* Paste anywhere: a plain date or timestamp goes straight to the end you touched last; anything else opens the box. */
function onPaste(e: ClipboardEvent) {
  if (typing(e.target)) return;
  const t = (e.clipboardData?.getData('text') || '').trim();
  if (!t || t.length > 200) return;
  e.preventDefault();
  const list = interpret(t);
  const first = list.find((s) => s.apply);
  // a range says where both ends go, so it needs no choosing
  if (first && first.kind === 'range') { first.apply!(); bump('start'); bump('end'); return; }
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
const LENSES: [Lens, string, string][] = [['zones', '時區', 'globe'], ['cal', '月曆', 'cal'], ['read', '讀法', 'list'], ['dur', '時長', 'calc']];
const tabs = computed(() => LENSES.filter(([k]) => lenses.value.includes(k)));
</script>

<template>
  <div class="app dial" :data-layout="layout" :class="{ 'no-top': !showTop, 'eq-big': eqBig }" :style="grid">
    <TopBar v-if="showTop" class="a-top" :compact="layout === 'phone'" />
    <Equation v-if="showEq" class="a-eq" :compact="compact" :stack="compact" :auto-tight="eqTight" :big="eqBig" />
    <div v-if="showTabs" class="a-tabs seg-ctl" role="tablist" aria-label="檢視">
      <button v-for="[k, name, ic] in tabs" :id="`tab-${k}`" :key="k" type="button" role="tab" :aria-selected="lens === k" :aria-controls="`lens-${k}`" @click="S.lens = k">
        <Icon :name="ic" />{{ name }}
      </button>
    </div>
    <ZonesPanel v-if="lensVisible('zones')" id="lens-zones" :style="{ gridArea: areaOf('zones') }" :role="tabbed ? 'tabpanel' : undefined" />
    <CalendarPanel v-if="lensVisible('cal')" id="lens-cal" :style="{ gridArea: areaOf('cal') }" :role="tabbed ? 'tabpanel' : undefined" />
    <ReadingsPanel v-if="lensVisible('read')" id="lens-read" :style="{ gridArea: areaOf('read') }" :role="tabbed ? 'tabpanel' : undefined" />
    <DurationPanel v-if="lensVisible('dur')" id="lens-dur" :style="{ gridArea: areaOf('dur') }" :role="tabbed ? 'tabpanel' : undefined" />
    <!-- with the top bar put away, the panels menu stays in reach in the corner -->
    <button v-if="!showTop" ref="cornerBtn" type="button" class="corner icon-btn" :class="{ on: cornerOpen }" aria-label="面板：顯示或隱藏" v-tip="'面板：顯示或隱藏（按 0 全部顯示，8 叫回頂列）'" :aria-expanded="cornerOpen" @click="cornerOpen = !cornerOpen"><Icon name="panels" /></button>
    <Popover :open="cornerOpen && !showTop" :anchor="cornerBtn" label="面板" width="24rem" align="end" @close="cornerOpen = false"><PanelMenu /></Popover>
    <Toast />
  </div>
</template>

<style scoped>
.app {
  height: 100%; display: grid; gap: var(--gap); min-height: 0; min-width: 0; position: relative;
  padding: max(.85rem, env(safe-area-inset-top)) max(1rem, env(safe-area-inset-right)) max(.95rem, env(safe-area-inset-bottom)) max(1rem, env(safe-area-inset-left));
}
.a-top { grid-area: top; }
.a-eq { grid-area: eq; }
.a-tabs { grid-area: tabs; }
.app[data-layout="phone"] {
  --gap: .5rem;
  padding: max(.6rem, env(safe-area-inset-top)) max(.6rem, env(safe-area-inset-right)) max(.6rem, env(safe-area-inset-bottom)) max(.6rem, env(safe-area-inset-left));
}
.app[data-layout="short"] {
  --gap: .55rem;
  padding: .6rem max(.8rem, env(safe-area-inset-right)) .6rem max(.8rem, env(safe-area-inset-left));
}
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
/* the top bar put away: room at the top for the corner button */
.app.no-top, .app.dial.no-top { padding-top: max(1.95rem, env(safe-area-inset-top)); }
.corner { position: absolute; z-index: 20; top: .2rem; right: .35rem; width: 1.75rem; height: 1.75rem; opacity: .4; transition: opacity .2s, background .2s; }
.corner:hover, .corner:focus-visible, .corner.on { opacity: 1; }
.corner .ic { width: 1.05em; height: 1.05em; }
@media (hover: none) { .corner { opacity: .7; } }
</style>
