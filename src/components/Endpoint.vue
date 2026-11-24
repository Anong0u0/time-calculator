<script setup lang="ts">
/* One end of the equation: a label, the date and time, its zone, and shortcuts.
   Both ends work alike: either can follow the clock (即時), and the span can compute either one. */
import { ref, computed } from 'vue';
import Icon from './Icon.vue';
import SegmentedDateTime from './SegmentedDateTime.vue';
import TzPicker from './TzPicker.vue';
import Popover from './Popover.vue';
import CopyBtn from './CopyBtn.vue';
import ChipRow from './ChipRow.vue';
import {
  S,
  type End,
  now,
  wallOf,
  msOf,
  tzOf,
  hasEnd,
  startNote,
  endNote,
  commit,
  setLive,
  setTz,
  clearEnd,
  freezeLink,
  linkFromMeasured,
  pulse,
  bump,
  isLive,
  isDerived,
  isLinked,
  linkTarget,
  linkSentence,
  followText,
  other,
  setFollow,
  shown,
} from '../state/store';
import { offsetAt, fmtOffset, fmtDT, fmtDate, fmtTime, isoOffset } from '../core/time';
import { zoneName } from '../core/zones';
import { relative } from '../core/format';
import { useSize, remPx } from '../composables/size';
import { textToEnd } from '../state/command';
import { useFlash } from '../composables/flash';

/** big: the equation has the screen's height to itself, so the date and time grow to fill it. */
const props = defineProps<{ which: End; compact?: boolean; big?: boolean }>();
const isStart = computed(() => props.which === 'start');
const SUBJ = computed(() => (isStart.value ? '開始' : '結束'));
const OTHER = computed(() => (isStart.value ? '結束' : '開始'));
const live = computed(() => isLive(props.which));
const derived = computed(() => isDerived(props.which));
/** The rule this end was set by (下個月底, 中秋 …), if any. */
const rule = computed(() => S.rules[props.which]);
/** The link tag sits on the end the span computes, or would compute. */
const linkTag = computed(
  () => !rule.value && hasEnd.value && (isLinked(props.which) || (!S.link && linkTarget() === props.which)),
);
const w = computed(() => wallOf(props.which));
const ms = computed(() => msOf(props.which));
const tz = computed(() => tzOf(props.which));
const has = computed(() => isStart.value || hasEnd.value);
const label = computed(() => rule.value?.name || SUBJ.value);
const note = computed(() => (isStart.value ? startNote.value : endNote.value));
const offTxt = computed(() => fmtOffset(offsetAt(ms.value ?? now.value, tz.value), { compact: true }));
const rel = computed(() => (ms.value == null ? '' : live.value ? '就是現在' : relative(ms.value, now.value)));
const iso = computed(() =>
  w.value && ms.value != null
    ? `${fmtDate(w.value)}T${fmtTime(w.value)}${isoOffset(offsetAt(ms.value, tz.value))}`
    : '',
);

const tzBtn = ref<HTMLElement | null>(null);
const tzOpen = ref(false);
const preBtn = ref<HTMLElement | null>(null);
const preOpen = ref(false);
function pickTz(id: string) {
  const name = zoneName(id);
  commit(() => setTz(props.which, id), {
    label: `${SUBJ.value}時區：${name}`,
    say: `${SUBJ.value}改用${name}時區，同一個時刻`,
  });
  bump(props.which);
}
function toggleLive() {
  const n = SUBJ.value;
  if (live.value) commit(() => setLive(props.which, false), { label: `固定${n}`, say: `${n}固定在這一秒` });
  else
    commit(() => setLive(props.which, true), {
      label: `${n}設為現在`,
      say: `${n}跟著現在走${isLive(other(props.which)) ? `；${OTHER.value}也是現在，間隔是 0` : ''}`,
    });
  bump(props.which);
}
function toggleLink() {
  if (S.link) {
    const to = S.linkTo;
    commit(freezeLink, {
      label: `固定${to === 'end' ? '結束' : '開始'}`,
      say: () => `${to === 'end' ? '結束' : '開始'}固定在 ${fmtDT(wallOf(to)!)}`,
    });
  } else commit(linkFromMeasured, { label: '連動', say: () => `${linkSentence()}，${followText()}` });
}
function clear() {
  commit(() => clearEnd(), { label: '清除結束', say: '已清除結束' });
}
/** Keep following the rule, or stay at the moment it gave. */
function toggleFollow() {
  const r = rule.value;
  if (!r) return;
  const n = SUBJ.value;
  if (r.follow)
    commit(() => setFollow(props.which, false), {
      label: `${n}固定`,
      say: () => `${n}固定在 ${fmtDT(wallOf(props.which)!)}，不再跟著「${r.name}」`,
    });
  else
    commit(() => setFollow(props.which, true), {
      label: `${n}跟著${r.name}`,
      say: () => `${n}跟著「${r.name}」，時間過去或另一端改了會重新算`,
    });
  bump(props.which);
}
const ruleTip = computed(() => {
  const r = rule.value;
  if (!r) return '';
  return r.follow
    ? `${SUBJ.value}跟著「${r.name}」：時間過去、另一端改了都會重新算。點一下固定在目前的時刻`
    : `${SUBJ.value}用「${r.name}」設定，固定在那時算出的時刻。點一下改成一直跟著這個規則`;
});

const root = ref<HTMLElement | null>(null);
const { w: rootW, h: rootH } = useSize(root);
/** As large as the panel allows: two lines (date, time) on big screens, one line when compact.
    With the whole height to itself, as large as the width and the height both allow. */
const sdtSize = computed(() => {
  const w = rootW.value,
    r = remPx.value;
  if (!w) return undefined;
  let px = props.compact
    ? Math.min(1.6 * r, Math.max(1.1 * r, w / 13.9))
    : Math.min(2.25 * r, Math.max(1.2 * r, w / 8.1));
  if (props.big && !props.compact && rootH.value) px = Math.max(px, Math.min(w / 8.1, (rootH.value - 10 * r) / 2.4));
  return `${px.toFixed(1)}px`;
});
const { flashing } = useFlash(() => pulse[props.which]);
const noteText = computed(() =>
  note.value === 'gap'
    ? '夏令時間跳過這段時刻，已往後推'
    : note.value === 'overlap'
      ? '這個時刻出現兩次，取較早的一次'
      : '',
);
const linkTip = computed(() =>
  S.link
    ? `連動中：${linkSentence()}。${followText()}。點一下改成固定在目前的時刻`
    : `${SUBJ.value}固定在這個時刻。點一下改成連動：保持目前的間隔，${SUBJ.value}跟著${OTHER.value}移動`,
);
const linkLabel = computed(() => (S.link ? linkSentence().replace(/^(開始|結束) /, '') : '固定'));
const liveTip = computed(() =>
  live.value ? `${SUBJ.value}跟著現在走。點一下固定在這一秒` : `點一下讓${SUBJ.value}變成現在，並跟著時間走`,
);
/* ---------- drop a date (text from anywhere) onto this end ---------- */
const dropping = ref(false);
function dragOver(e: DragEvent) {
  if (!e.dataTransfer || ![...e.dataTransfer.types].includes('text/plain')) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
  dropping.value = true;
}
function drop(e: DragEvent) {
  dropping.value = false;
  const t = e.dataTransfer?.getData('text/plain');
  if (!t) return;
  e.preventDefault();
  if (textToEnd(props.which, t)) bump(props.which);
}
</script>

<template>
  <section
    ref="root"
    class="panel ep"
    :class="[which, { compact, big, flash: flashing, active: S.active === which, none: !has, dropping }]"
    :aria-label="label"
    :data-drop-end="which"
    @focusin="S.active = which"
    @pointerdown="S.active = which"
    @animationend="flashing = false"
    @dragover="dragOver"
    @dragleave="dropping = false"
    @drop="drop"
  >
    <header class="ep-head">
      <i class="node" :class="{ end: !isStart }" aria-hidden="true" />
      <h2>{{ label }}</h2>
      <button
        type="button"
        class="tag live"
        :class="{ quiet: !live }"
        :aria-pressed="live"
        :aria-label="live ? `${SUBJ}：即時` : `${SUBJ}設為現在`"
        v-tip="liveTip"
        @click="toggleLive"
      >
        <i class="dot" aria-hidden="true" /><span>{{ live ? '即時' : '現在' }}</span>
      </button>
      <span
        v-if="!isStart && S.endSample"
        class="tag sample"
        v-tip="'第一次開啟時放的範例：距離跨年。改掉它或按 × 清除就會消失'"
        >範例</span
      >
      <button
        v-if="rule"
        type="button"
        class="tag link"
        :aria-pressed="rule.follow"
        :aria-label="rule.follow ? `${SUBJ}跟著規則：${rule.name}` : `${SUBJ}固定，點一下改成跟著規則`"
        v-tip="ruleTip"
        @click="toggleFollow"
      >
        <Icon :name="rule.follow ? 'link' : 'pin'" /><span>{{ rule.follow ? '跟著' : '固定' }}</span>
      </button>
      <button
        v-if="linkTag"
        type="button"
        class="tag link"
        :aria-pressed="derived"
        :aria-label="derived ? `連動：${linkSentence()}` : `${SUBJ}固定，點一下改成連動`"
        v-tip="linkTip"
        @click="toggleLink"
      >
        <Icon :name="derived ? 'link' : 'pin'" /><span>{{ linkLabel }}</span>
      </button>
      <button
        v-if="compact"
        ref="tzBtn"
        type="button"
        class="tzb tzb-head"
        :aria-expanded="tzOpen"
        v-tip="`${zoneName(tz)}（${tz}）。點一下換時區，時刻不變`"
        @click="tzOpen = !tzOpen"
      >
        <Icon name="globe" /><span class="tzb-n">{{ zoneName(tz) }}</span
        ><span class="tzb-o mono">{{ offTxt }}</span>
      </button>
      <span v-if="compact && noteText" class="tag warn" v-tip="noteText">夏令</span>
      <span class="ep-tools">
        <button
          v-if="compact && shown('chips')"
          ref="preBtn"
          type="button"
          class="icon-btn sm"
          :aria-expanded="preOpen"
          v-tip="'快捷'"
          aria-label="快捷"
          @click="preOpen = !preOpen"
        >
          <Icon name="bolt" />
        </button>
        <CopyBtn v-if="has && iso" class="ep-copy" :text="iso" :k="`ep-${which}`" :label="label" :tip="`複製 ${iso}`"
          ><span class="sr-only">複製</span></CopyBtn
        >
        <button
          v-if="!isStart && hasEnd"
          type="button"
          class="icon-btn sm"
          v-tip="'清除結束'"
          aria-label="清除結束"
          @click="clear"
        >
          <Icon name="x" />
        </button>
      </span>
    </header>

    <SegmentedDateTime :which="which" :compact="compact" class="ep-time" :style="{ '--sdt-size': sdtSize }" />

    <div v-if="!compact" class="ep-meta">
      <button
        ref="tzBtn"
        type="button"
        class="tzb"
        :aria-expanded="tzOpen"
        v-tip="`${zoneName(tz)}（${tz}）。點一下換時區，時刻不變`"
        @click="tzOpen = !tzOpen"
      >
        <Icon name="globe" /><span class="tzb-n">{{ zoneName(tz) }}</span
        ><span class="tzb-o mono">{{ offTxt }}</span
        ><Icon name="chevD" class="tzb-c" />
      </button>
      <span v-if="has" class="rel">{{ rel }}</span>
      <span v-else class="rel hint">未設定：按「現在」、選快捷、打日期，或在間隔輸入 +30天</span>
      <span v-if="noteText" class="tag warn" v-tip="noteText">夏令時間</span>
    </div>

    <ChipRow
      v-if="!compact && shown('chips')"
      class="ep-pre"
      :row="which"
      :fill="!isStart"
      :aria-label="isStart ? '開始的快捷' : '結束的快捷'"
    />

    <TzPicker
      :open="tzOpen"
      :anchor="tzBtn"
      :title="isStart ? '開始的時區' : '結束的時區'"
      :current="tz"
      @close="tzOpen = false"
      @pick="pickTz"
    />
    <Popover
      v-if="compact"
      :open="preOpen"
      :anchor="preBtn"
      :label="isStart ? '開始的快捷' : '結束的快捷'"
      width="20rem"
      align="end"
      @close="preOpen = false"
    >
      <div class="pre-pop" @click="($event.target as HTMLElement).closest('[data-ci]') && (preOpen = false)">
        <ChipRow :row="which" size="lg" wrap :fill="!isStart" />
      </div>
    </Popover>
  </section>
</template>

<style scoped>
.ep {
  padding: 0.9rem 1.1rem 1rem;
  gap: 0.55rem;
  justify-content: flex-start;
  transition:
    border-color 0.2s,
    box-shadow 0.2s;
}
.ep.active {
  border-color: var(--accent-line);
}
.ep.dropping {
  outline: 2px dashed var(--accent);
  outline-offset: -4px;
  border-radius: var(--r-md);
  background: var(--accent-wash);
}
.ep-head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-height: 2.1rem;
  min-width: 0;
  container-type: inline-size;
}
.ep-head .node {
  font-size: 1.05rem;
}
.ep-head h2 {
  font-size: 1.02rem;
  font-weight: 650;
  white-space: nowrap;
}
.ep-tools {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 0.1rem;
  flex: none;
}
.icon-btn.sm {
  width: 2rem;
  height: 2rem;
  border-radius: 0.65rem;
}
.ep-copy {
  width: 2rem;
  height: 2rem;
  margin: 0;
  padding: 0;
  justify-content: center;
  border-radius: 0.65rem;
}
.ep-copy :deep(.ic) {
  width: 1.1em;
  height: 1.1em;
  opacity: 0.6;
}
.tag {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  height: 1.6rem;
  padding: 0 0.55rem;
  border-radius: 99rem;
  font-size: var(--fs-s);
  font-weight: 600;
  white-space: nowrap;
  color: var(--ink-2);
  background: var(--well);
  border: 1px solid var(--hair);
  min-width: 0;
}
button.tag {
  transition:
    background 0.18s,
    color 0.18s,
    border-color 0.18s;
}
button.tag:hover {
  color: var(--accent);
  border-color: var(--accent-line);
  background: var(--accent-wash);
}
.tag .ic {
  width: 1em;
  height: 1em;
}
.tag span {
  overflow: hidden;
  text-overflow: ellipsis;
}
.tag.live .dot {
  width: 0.45rem;
  height: 0.45rem;
  border-radius: 50%;
  background: var(--ink-4);
}
.tag.live[aria-pressed='true'] {
  color: var(--now);
  background: var(--now-wash);
  border-color: transparent;
}
.tag.live[aria-pressed='true'] .dot {
  background: var(--now);
  animation: beat 2s infinite;
}
@keyframes beat {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.35;
  }
}
.tag.sample {
  flex: none;
  color: var(--warn);
  background: var(--warn-wash);
  border-color: transparent;
  cursor: help;
}
.tag.link[aria-pressed='true'] {
  color: var(--accent);
  background: var(--accent-wash);
  border-color: var(--accent-line);
}
.tag.link {
  max-width: 12.5rem;
  overflow: hidden;
  flex: 0 1 auto;
}
.tag.link .ic {
  flex: none;
}
.tag.live {
  flex: none;
}
.tag.live.quiet {
  color: var(--ink-3);
}
.tag.live span {
  overflow: visible;
}
/* A narrow header keeps 即時／現在 as just its dot; the tooltip and label still say it. */
@container (max-width: 19rem) {
  .compact .tag.live {
    width: 1.6rem;
    padding: 0;
    justify-content: center;
  }
  .compact .tag.live span {
    display: none;
  }
}
/* A narrow header keeps the link tag as a clean round icon; the tooltip still says what it does. */
@container (max-width: 15.5rem) {
  .tag.link {
    flex: none;
    width: 1.6rem;
    padding: 0;
    justify-content: center;
  }
  .tag.link span {
    display: none;
  }
}
/* The compact header also carries the time zone, so it gets tight sooner. */
@container (max-width: 27rem) {
  .compact .tag.link {
    flex: none;
    width: 1.6rem;
    padding: 0;
    justify-content: center;
  }
  .compact .tag.link span {
    display: none;
  }
}
@container (max-width: 22rem) {
  .compact .tzb-head .tzb-o {
    display: none;
  }
}
.tag.warn {
  color: var(--warn);
  background: var(--warn-wash);
  border-color: transparent;
  cursor: help;
}
.ep-time {
  --sdt-size: 1.75rem;
  margin: 0.1rem 0;
}
.ep-meta {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  min-width: 0;
  font-size: 0.9rem;
  color: var(--ink-3);
}
.tzb {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  height: 1.95rem;
  padding: 0 0.45rem 0 0.55rem;
  margin-left: -0.4rem;
  border-radius: 0.65rem;
  color: var(--ink-2);
  font-weight: 550;
  min-width: 0;
  transition:
    background 0.15s,
    color 0.15s;
}
.tzb:hover,
.tzb[aria-expanded='true'] {
  background: var(--accent-wash);
  color: var(--accent);
}
.tzb .ic {
  width: 1.05em;
  height: 1.05em;
  color: var(--ink-3);
}
.tzb:hover .ic {
  color: var(--accent);
}
.tzb-n {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tzb-o {
  font-size: var(--fs-s);
  color: var(--ink-3);
}
.tzb-c {
  width: 0.85em !important;
  height: 0.85em !important;
}
.rel {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
.rel.hint {
  white-space: normal;
  line-height: 1.35;
  font-size: max(var(--floor), 0.84rem);
}
.ep-pre {
  margin-top: auto;
  padding-top: 0.15rem;
}
.pre-pop {
  padding: 0.8rem;
}
/* the whole height: the time and its zone sit together in the middle, the shortcuts stay at the bottom */
.ep.big .ep-time {
  margin-top: auto;
}
.ep.big .ep-meta {
  margin-bottom: auto;
}
.ep.big .ep-pre {
  margin-top: 0;
}
.ep.none .ep-time {
  opacity: 0.9;
}

/* compact: phones and short screens */
.ep.compact {
  padding: 0.6rem 0.8rem 0.65rem;
  gap: 0.25rem;
  border-radius: var(--r-md);
}
.compact .ep-head {
  min-height: 1.9rem;
  gap: 0.4rem;
}
.tzb.tzb-head {
  margin-left: auto;
  height: 1.85rem;
  font-size: max(var(--floor), 0.84rem);
  padding: 0 0.45rem;
  flex: 0 1 auto;
  overflow: hidden;
}
.tzb.tzb-head + .ep-tools,
.tag.warn + .ep-tools {
  margin-left: 0;
}
.compact .tag.link {
  max-width: 9.5rem;
}
</style>
