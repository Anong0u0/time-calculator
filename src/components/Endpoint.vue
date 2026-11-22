<script setup lang="ts">
/* One end of the equation: a label, the date and time, its zone, and shortcuts. */
import { ref, computed, watch } from 'vue';
import Icon from './Icon.vue';
import SegmentedDateTime from './SegmentedDateTime.vue';
import TzPicker from './TzPicker.vue';
import Popover from './Popover.vue';
import CopyBtn from './CopyBtn.vue';
import {
  S, type End, now, wallOf, msOf, tzOf, hasEnd, startNote, endNote, commit, setLive, setTz, clearEnd, freezeEnd, linkFromMeasured,
  START_PRESETS, startPresetWall, startPresetActive, setWall, PERIOD_NAMES, periodBounds, periodLabel, applyEndPreset, pulse, bump, type PeriodKey,
} from '../state/store';
import { offsetAt, fmtOffset, fmtDT, fmtDate, fmtTime, isoOffset, clamp } from '../core/time';
import { zoneName } from '../core/zones';
import { relative } from '../core/format';
import { nfMax } from '../core/format';
import { useSize, remPx } from '../composables/size';

const props = defineProps<{ which: End; compact?: boolean }>();
const isStart = computed(() => props.which === 'start');
const w = computed(() => wallOf(props.which));
const ms = computed(() => msOf(props.which));
const tz = computed(() => tzOf(props.which));
const has = computed(() => isStart.value || hasEnd.value);
const label = computed(() => (isStart.value ? '開始' : S.endPreset ? PERIOD_NAMES[S.endPreset] : '結束'));
const note = computed(() => (isStart.value ? startNote.value : endNote.value));
const offTxt = computed(() => fmtOffset(offsetAt(ms.value ?? now.value, tz.value), { compact: true }));
const rel = computed(() => (ms.value == null ? '' : S.live && isStart.value ? '就是現在' : relative(ms.value, now.value)));
const iso = computed(() => (w.value && ms.value != null ? `${fmtDate(w.value)}T${fmtTime(w.value)}${isoOffset(offsetAt(ms.value, tz.value))}` : ''));

const tzBtn = ref<HTMLElement | null>(null);
const tzOpen = ref(false);
const preBtn = ref<HTMLElement | null>(null);
const preOpen = ref(false);
function pickTz(id: string) {
  const name = zoneName(id);
  commit(() => setTz(props.which, id), { label: `${isStart.value ? '開始' : '結束'}時區：${name}`, say: `${isStart.value ? '開始' : '結束'}改用${name}時區，同一個時刻` });
  bump(props.which);
}
function toggleLive() {
  if (S.live) commit(() => setLive(false), { label: '固定開始', say: '開始固定在這一秒' });
  else commit(() => setLive(true), { label: '開始回到現在', say: '開始跟著現在走' });
}
function toggleLink() {
  if (S.link) commit(freezeEnd, { label: '固定結束', say: () => `結束固定在 ${fmtDT(wallOf('end')!)}` });
  else commit(linkFromMeasured, { label: '結束連動', say: () => `結束 = 開始 ${S.link?.expr}，開始改了會跟著動` });
}
function clear() { commit(() => clearEnd(), { label: '清除結束', say: '已清除結束' }); }
function startPreset(k: (typeof START_PRESETS)[number][0], name: string) {
  commit(() => setWall('start', startPresetWall(k)), { label: `開始：${name}`, say: `開始：${name}` });
  bump('start'); preOpen.value = false;
}
function nowPreset() { if (!S.live) commit(() => setLive(true), { label: '開始回到現在', say: '開始跟著現在走' }); bump('start'); preOpen.value = false; }
const END_KEYS: PeriodKey[] = ['day', 'week', 'month', 'newyear', 'lny'];
function endPreset(k: PeriodKey) {
  commit(() => applyEndPreset(k), { label: `結束：${PERIOD_NAMES[k]}`, say: () => `結束：${periodLabel(k)} ${fmtDT(wallOf('end')!)}` });
  bump('end'); preOpen.value = false;
}
/** How far the start is through each period: the chip fills like a progress bar. */
function progress(k: PeriodKey): number | null {
  const b = periodBounds(k);
  if (!b || b[0] == null) return null;
  const f = (now.value - b[0]) / (b[1] - b[0]);
  return f >= 0 && f <= 1 ? f : null;
}
function endChipLabel(k: PeriodKey) { return k === 'day' || k === 'week' || k === 'month' ? `${periodLabel(k)}結束` : PERIOD_NAMES[k]; }
function endChipTip(k: PeriodKey) {
  const b = periodBounds(k); const p = progress(k);
  if (!b) return '這個範圍目前無法計算';
  return `結束設為${endChipLabel(k)}${p != null ? `。${k === 'lny' ? '距上次春節' : '這段期間'}已過 ${nfMax(p * 100, 1)}%` : ''}`;
}

const root = ref<HTMLElement | null>(null);
const { w: rootW } = useSize(root);
/** As large as the panel allows: two lines (date, time) on big screens, one line when compact. */
const sdtSize = computed(() => {
  const w = rootW.value, r = remPx.value;
  if (!w) return undefined;
  const px = props.compact ? Math.min(1.6 * r, Math.max(1.1 * r, w / 13.9)) : Math.min(2.25 * r, Math.max(1.2 * r, w / 8.1));
  return `${px.toFixed(1)}px`;
});
const flashing = ref(false);
watch(() => pulse[props.which], () => { flashing.value = false; requestAnimationFrame(() => { flashing.value = true; }); });
const noteText = computed(() => (note.value === 'gap' ? '夏令時間跳過這段時刻，已往後推' : note.value === 'overlap' ? '這個時刻出現兩次，取較早的一次' : ''));
const linkTip = computed(() => (S.link ? `連動中：結束 = 開始 ${S.link.expr}。開始改了，結束跟著動。點一下改成固定在目前的時刻` : '結束固定在這個時刻。點一下改成連動：保持目前的間隔，結束跟著開始移動'));
void clamp;
</script>

<template>
  <section ref="root" class="panel ep" :class="[which, { compact, flash: flashing, active: S.active === which, none: !has }]" :aria-label="label"
    @focusin="S.active = which" @pointerdown="S.active = which" @animationend="flashing = false">
    <header class="ep-head">
      <i class="node" :class="{ end: !isStart }" aria-hidden="true" />
      <h2>{{ label }}</h2>
      <template v-if="isStart">
        <button type="button" class="tag live" :aria-pressed="S.live" v-tip="S.live ? '開始跟著現在走。點一下固定在這一秒' : '點一下讓開始回到現在，並跟著時間走'" @click="toggleLive">
          <i class="dot" aria-hidden="true" />{{ S.live ? '即時' : '回到現在' }}
        </button>
      </template>
      <template v-else>
        <span v-if="S.endSample" class="tag sample" v-tip="'第一次開啟時放的範例：距離跨年。改掉它或按 × 清除就會消失'">範例</span>
        <button v-if="hasEnd" type="button" class="tag link" :aria-pressed="!!S.link" :aria-label="S.link ? `連動：結束 = 開始 ${S.link.expr}` : '結束固定，點一下改成連動'" v-tip="linkTip" @click="toggleLink">
          <Icon :name="S.link ? 'link' : 'pin'" /><span>{{ S.link ? `= 開始 ${S.link.expr}` : '固定' }}</span>
        </button>
      </template>
      <button v-if="compact" ref="tzBtn" type="button" class="tzb tzb-head" :aria-expanded="tzOpen" v-tip="`${zoneName(tz)}（${tz}）。點一下換時區，時刻不變`" @click="tzOpen = !tzOpen">
        <Icon name="globe" /><span class="tzb-n">{{ zoneName(tz) }}</span><span class="tzb-o mono">{{ offTxt }}</span>
      </button>
      <span v-if="compact && noteText" class="tag warn" v-tip="noteText">夏令</span>
      <span class="ep-tools">
        <button v-if="compact" ref="preBtn" type="button" class="icon-btn sm" :aria-expanded="preOpen" v-tip="'快捷'" aria-label="快捷" @click="preOpen = !preOpen"><Icon name="bolt" /></button>
        <CopyBtn v-if="has && iso" class="ep-copy" :text="iso" :k="`ep-${which}`" :label="label" :tip="`複製 ${iso}`"><span class="sr-only">複製</span></CopyBtn>
        <button v-if="!isStart && hasEnd" type="button" class="icon-btn sm" v-tip="'清除結束'" aria-label="清除結束" @click="clear"><Icon name="x" /></button>
      </span>
    </header>

    <SegmentedDateTime :which="which" :compact="compact" class="ep-time" :style="{ '--sdt-size': sdtSize }" />

    <div v-if="!compact" class="ep-meta">
      <button ref="tzBtn" type="button" class="tzb" :aria-expanded="tzOpen" v-tip="`${zoneName(tz)}（${tz}）。點一下換時區，時刻不變`" @click="tzOpen = !tzOpen">
        <Icon name="globe" /><span class="tzb-n">{{ zoneName(tz) }}</span><span class="tzb-o mono">{{ offTxt }}</span><Icon name="chevD" class="tzb-c" />
      </button>
      <span v-if="has" class="rel">{{ rel }}</span>
      <span v-else class="rel hint">未設定：選快捷、打日期，或在間隔輸入 +30天</span>
      <span v-if="noteText" class="tag warn" v-tip="noteText">夏令時間</span>
    </div>

    <div v-if="!compact" class="ep-pre" role="group" :aria-label="isStart ? '開始的快捷' : '結束的快捷'">
      <template v-if="isStart">
        <button type="button" class="chip" :aria-pressed="S.live" @click="nowPreset">現在</button>
        <button v-for="[k, name, tip] in START_PRESETS" :key="k" type="button" class="chip" :aria-pressed="startPresetActive(k)" v-tip="`開始設為${tip}`" @click="startPreset(k, name)">{{ name }}</button>
      </template>
      <template v-else>
        <button v-for="k in END_KEYS" :key="k" type="button" class="chip fillchip" :aria-pressed="S.endPreset === k" :style="{ '--p': progress(k) ?? 0 }" v-tip="endChipTip(k)" @click="endPreset(k)">{{ endChipLabel(k) }}</button>
      </template>
    </div>

    <TzPicker :open="tzOpen" :anchor="tzBtn" :title="isStart ? '開始的時區' : '結束的時區'" :current="tz" @close="tzOpen = false" @pick="pickTz" />
    <Popover v-if="compact" :open="preOpen" :anchor="preBtn" :label="isStart ? '開始的快捷' : '結束的快捷'" width="20rem" align="end" @close="preOpen = false">
      <div class="pre-pop">
        <template v-if="isStart">
          <button type="button" class="chip" :aria-pressed="S.live" @click="nowPreset">現在</button>
          <button v-for="[k, name] in START_PRESETS" :key="k" type="button" class="chip" :aria-pressed="startPresetActive(k)" @click="startPreset(k, name)">{{ name }}</button>
        </template>
        <template v-else>
          <button v-for="k in END_KEYS" :key="k" type="button" class="chip fillchip" :aria-pressed="S.endPreset === k" :style="{ '--p': progress(k) ?? 0 }" @click="endPreset(k)">{{ endChipLabel(k) }}</button>
        </template>
      </div>
    </Popover>
  </section>
</template>

<style scoped>
.ep { padding: .9rem 1.1rem 1rem; gap: .55rem; justify-content: flex-start; transition: border-color .2s, box-shadow .2s; }
.ep.active { border-color: var(--accent-line); }
.ep-head { display: flex; align-items: center; gap: .5rem; min-height: 2.1rem; min-width: 0; container-type: inline-size; }
.ep-head .node { font-size: 1.05rem; }
.ep-head h2 { font-size: 1.02rem; font-weight: 650; white-space: nowrap; }
.ep-tools { margin-left: auto; display: flex; align-items: center; gap: .1rem; flex: none; }
.icon-btn.sm { width: 2rem; height: 2rem; border-radius: .65rem; }
.ep-copy { width: 2rem; height: 2rem; margin: 0; padding: 0; justify-content: center; border-radius: .65rem; }
.ep-copy :deep(.ic) { width: 1.1em; height: 1.1em; opacity: .6; }
.tag { display: inline-flex; align-items: center; gap: .35rem; height: 1.6rem; padding: 0 .55rem; border-radius: 99rem; font-size: var(--fs-s); font-weight: 600; white-space: nowrap; color: var(--ink-2); background: var(--well); border: 1px solid var(--hair); min-width: 0; }
button.tag { transition: background .18s, color .18s, border-color .18s; }
button.tag:hover { color: var(--accent); border-color: var(--accent-line); background: var(--accent-wash); }
.tag .ic { width: 1em; height: 1em; }
.tag span { overflow: hidden; text-overflow: ellipsis; }
.tag.live .dot { width: .45rem; height: .45rem; border-radius: 50%; background: var(--ink-4); }
.tag.live[aria-pressed="true"] { color: var(--now); background: var(--now-wash); border-color: transparent; }
.tag.live[aria-pressed="true"] .dot { background: var(--now); animation: beat 2s infinite; }
@keyframes beat { 0%, 100% { opacity: 1; } 50% { opacity: .35; } }
.tag.sample { flex: none; color: var(--warn); background: var(--warn-wash); border-color: transparent; cursor: help; }
.tag.link[aria-pressed="true"] { color: var(--accent); background: var(--accent-wash); border-color: var(--accent-line); }
.tag.link { max-width: 12.5rem; overflow: hidden; flex: 0 1 auto; }
.tag.link .ic { flex: none; }
.tag.live { flex: none; }
/* A narrow header keeps the link tag as a clean round icon; the tooltip still says what it does. */
@container (max-width: 15.5rem) {
  .tag.link { flex: none; width: 1.6rem; padding: 0; justify-content: center; }
  .tag.link span { display: none; }
}
.tag.warn { color: var(--warn); background: var(--warn-wash); border-color: transparent; cursor: help; }
.ep-time { --sdt-size: 1.75rem; margin: .1rem 0; }
.ep-meta { display: flex; align-items: center; gap: .6rem; min-width: 0; font-size: .9rem; color: var(--ink-3); }
.tzb { flex: none; display: inline-flex; align-items: center; gap: .35rem; height: 1.95rem; padding: 0 .45rem 0 .55rem; margin-left: -.4rem; border-radius: .65rem; color: var(--ink-2); font-weight: 550; min-width: 0; transition: background .15s, color .15s; }
.tzb:hover, .tzb[aria-expanded="true"] { background: var(--accent-wash); color: var(--accent); }
.tzb .ic { width: 1.05em; height: 1.05em; color: var(--ink-3); }
.tzb:hover .ic { color: var(--accent); }
.tzb-n { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tzb-o { font-size: var(--fs-s); color: var(--ink-3); }
.tzb-c { width: .85em !important; height: .85em !important; }
.rel { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.rel.hint { white-space: normal; line-height: 1.35; font-size: max(11px, .84rem); }
.ep-pre { display: flex; flex-wrap: wrap; gap: .35rem; margin-top: auto; padding-top: .15rem; }
.ep-pre .chip, .pre-pop .chip { height: 1.95rem; padding: 0 .65rem; font-size: max(11px, .84rem); }
.fillchip { background-image: linear-gradient(to right, var(--accent-wash-2) calc(var(--p) * 100%), transparent calc(var(--p) * 100%)); }
.pre-pop { display: flex; flex-wrap: wrap; gap: .4rem; padding: .8rem; }
.pre-pop .chip { height: 2.4rem; padding: 0 .9rem; font-size: .9rem; }
.ep.none .ep-time { opacity: .9; }

/* compact: phones and short screens */
.ep.compact { padding: .6rem .8rem .65rem; gap: .25rem; border-radius: var(--r-md); }
.compact .ep-head { min-height: 1.9rem; gap: .4rem; }
.tzb.tzb-head { margin-left: auto; height: 1.85rem; font-size: max(11px, .84rem); padding: 0 .45rem; flex: 0 1 auto; overflow: hidden; }
.tzb.tzb-head + .ep-tools, .tag.warn + .ep-tools { margin-left: 0; }
.compact .tag.link { max-width: 9.5rem; }
</style>
