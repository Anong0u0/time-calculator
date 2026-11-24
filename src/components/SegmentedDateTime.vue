<script setup lang="ts">
/* Year-month-day hour:minute:second as six small fields that type like one.
   Type digits and it moves on; ↑↓ or the wheel step; paste any format; "+" in the end jumps to the span.
   Focusing changes nothing: a live end keeps ticking until a value is actually changed, and Esc puts back what was there. */
import { reactive, computed, ref } from 'vue';
import {
  type Wall,
  pad,
  clamp,
  daysInMonth,
  addMonthsWall,
  wallKey,
  wallOfKey,
  validWall,
  WD,
  wdOf,
  DAY,
  HOUR,
  MIN,
  SEC,
} from '../core/time';
import {
  S,
  type End,
  wallOf,
  startWall,
  commit,
  setWall,
  toast,
  bump,
  historyMark,
  rollback,
  isDerived,
} from '../state/store';
import { interpret } from '../state/command';
import { editSpan } from '../state/ui';

const props = defineProps<{ which: End; compact?: boolean; stacked?: boolean }>();
type K = 'y' | 'mo' | 'd' | 'h' | 'mi' | 's';
interface Seg {
  k: K;
  len: number;
  min: number;
  max: number;
  name: string;
}
const SEGS: Seg[] = [
  { k: 'y', len: 4, min: 1, max: 9999, name: '年' },
  { k: 'mo', len: 2, min: 1, max: 12, name: '月' },
  { k: 'd', len: 2, min: 1, max: 31, name: '日' },
  { k: 'h', len: 2, min: 0, max: 23, name: '時' },
  { k: 'mi', len: 2, min: 0, max: 59, name: '分' },
  { k: 's', len: 2, min: 0, max: 59, name: '秒' },
];
const SUBJ = computed(() => (props.which === 'start' ? '開始' : '結束'));
const real = computed(() => wallOf(props.which));
const empty = computed(() => !real.value);
/** An empty end shows the start as a faint template; typing into it creates the end. */
const base = computed<Wall>(() => real.value || startWall.value);
const draft = reactive<Partial<Record<K, string>>>({});
const els = ref<HTMLInputElement[]>([]);
let justFocused = false,
  typed = false,
  wheelAcc = 0,
  mark = -1;

const show = (sg: Seg) => draft[sg.k] ?? pad(base.value[sg.k], sg.len);
const segMax = (sg: Seg) => (sg.k === 'd' ? daysInMonth(base.value.y, base.value.mo) : sg.max);
const key = computed(() => `seg-${props.which}`);

function put(w: Wall) {
  const cut = isDerived(props.which);
  const rule = S.rules[props.which];
  const say = rule?.follow
    ? `${SUBJ.value}改成固定，不再跟著「${rule.name}」`
    : cut
      ? `${SUBJ.value}改成固定，不再跟著${props.which === 'end' ? '開始' : '結束'}移動`
      : undefined;
  return commit(() => setWall(props.which, w), { label: `修改${SUBJ.value}`, key: key.value, say });
}
function applySeg(sg: Seg, n: number) {
  const w = { ...base.value, [sg.k]: n } as Wall;
  w.d = Math.min(w.d, daysInMonth(w.y, w.mo));
  put(w);
}
function focusSeg(i: number) {
  const el = els.value[i];
  if (el) el.focus();
}
function selectAll(el: HTMLInputElement) {
  try {
    el.setSelectionRange(0, el.value.length);
  } catch {
    /* not focused */
  }
}
function flash(el: HTMLInputElement) {
  el.classList.add('bad');
  setTimeout(() => el.classList.remove('bad'), 650);
}

function onFocus(sg: Seg, e: FocusEvent) {
  const el = e.target as HTMLInputElement;
  S.active = props.which;
  if (mark < 0) mark = historyMark();
  draft[sg.k] = pad(base.value[sg.k], sg.len);
  justFocused = true;
  typed = false;
  requestAnimationFrame(() => {
    if (document.activeElement === el && !typed) selectAll(el);
  });
}
function onMouseUp(e: MouseEvent) {
  if (justFocused) {
    e.preventDefault();
    justFocused = false;
  }
}
function onInput(sg: Seg, i: number, e: Event) {
  const el = e.target as HTMLInputElement;
  justFocused = false;
  typed = true;
  let v = el.value.replace(/\D/g, '');
  if (v.length > sg.len) v = v.slice(-sg.len);
  if (el.value !== v) el.value = v;
  draft[sg.k] = v;
  if (!v) return;
  const n = +v,
    max = segMax(sg);
  const complete = v.length >= sg.len || (sg.len === 2 && v.length === 1 && n > Math.floor(max / 10));
  // a first digit that could still grow (1 of 15) waits for the next one, so the day never flashes to 1
  if (sg.k === 'y') {
    if (v.length === 4 && n >= 1) applySeg(sg, n);
  } else if (complete && n >= sg.min && n <= max) applySeg(sg, n);
  else if (complete) {
    applySeg(sg, clamp(n, sg.min, max));
    flash(el);
  }
  if (complete) {
    draft[sg.k] = pad(base.value[sg.k], sg.len);
    if (i < SEGS.length - 1) focusSeg(i + 1);
    else requestAnimationFrame(() => selectAll(el));
  }
}
function onBlur(sg: Seg, e: FocusEvent) {
  justFocused = false;
  const v = (draft[sg.k] ?? '').replace(/\D/g, '');
  delete draft[sg.k];
  // leaving the six fields for good ends the edit
  const to = e.relatedTarget as HTMLElement | null;
  if (!to || !els.value.includes(to as HTMLInputElement)) mark = -1;
  if (!v) return;
  let n = +v;
  // 99 is 1999 and 26 is 2026: within 30 years ahead of now, otherwise the century before
  if (sg.k === 'y' && v.length <= 2) n = (n <= (new Date().getFullYear() % 100) + 30 ? 2000 : 1900) + n;
  if (sg.k === 'y' && n < 1) return;
  n = clamp(n, sg.min, segMax(sg));
  if (!real.value || real.value[sg.k] !== n) applySeg(sg, n);
}
function step(sg: Seg, dir: number, el: HTMLInputElement) {
  let w: Wall = { ...base.value };
  if (sg.k === 'y') w = addMonthsWall(w, 12 * dir);
  else if (sg.k === 'mo') w = addMonthsWall(w, dir);
  else w = wallOfKey(wallKey(w) + dir * { d: DAY, h: HOUR, mi: MIN, s: SEC }[sg.k]);
  if (!validWall(w)) return;
  put(w);
  draft[sg.k] = pad(w[sg.k], sg.len);
  requestAnimationFrame(() => {
    if (document.activeElement === el) selectAll(el);
  });
}
function onKey(sg: Seg, i: number, e: KeyboardEvent) {
  const el = e.target as HTMLInputElement,
    k = e.key;
  if (k === 'ArrowUp' || k === 'ArrowDown') {
    e.preventDefault();
    step(sg, (k === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1), el);
    return;
  }
  const whole = el.selectionStart !== el.selectionEnd;
  if (k === 'ArrowLeft' && (whole || el.selectionStart === 0)) {
    if (i > 0) {
      e.preventDefault();
      focusSeg(i - 1);
    }
    return;
  }
  if (k === 'ArrowRight' && (whole || el.selectionEnd === el.value.length)) {
    if (i < SEGS.length - 1) {
      e.preventDefault();
      focusSeg(i + 1);
    }
    return;
  }
  if (k === 'Backspace' && el.value === '' && i > 0) {
    e.preventDefault();
    focusSeg(i - 1);
    return;
  }
  if (k === 'Escape') {
    e.preventDefault();
    for (const x of SEGS) delete draft[x.k];
    if (mark >= 0) rollback(mark);
    mark = -1;
    el.blur();
    return;
  }
  if (k === 'Enter') {
    e.preventDefault();
    el.blur();
    return;
  }
  if (props.which === 'end' && (k === '+' || k === '＋')) {
    e.preventDefault();
    delete draft[sg.k];
    el.blur();
    editSpan('+');
    return;
  }
  if (k.length === 1 && /[-/.:\sTt年月日時分]/.test(k)) {
    e.preventDefault();
    if (i < SEGS.length - 1) focusSeg(i + 1);
  }
}
function onWheel(sg: Seg, e: WheelEvent) {
  const el = e.target as HTMLInputElement;
  if (document.activeElement !== el) return;
  e.preventDefault();
  wheelAcc += e.deltaY;
  if (Math.abs(wheelAcc) >= 40) {
    step(sg, wheelAcc < 0 ? 1 : -1, el);
    wheelAcc = 0;
  }
}
function onPaste(sg: Seg, e: ClipboardEvent) {
  const t = (e.clipboardData?.getData('text') || '').trim();
  if (!t) return;
  if (/^\d+$/.test(t) && t.length <= sg.len) return; // one field's worth: let the field take it
  e.preventDefault();
  const el = e.target as HTMLInputElement;
  const which = props.which;
  const hit = interpret(t).find((s) => s.apply && (s.kind === which || (which === 'end' && s.kind === 'span')));
  if (!hit) {
    toast('看不懂這段文字，試試 2026-12-25 18:00 或 Unix 時間戳');
    return;
  }
  delete draft[sg.k];
  hit.apply!();
  bump(which);
  el.blur();
}
const wd = computed(() => WD[wdOf(base.value)]);
const aria = (sg: Seg) => `${SUBJ.value}的${sg.name}`;
</script>

<template>
  <div class="sdt mono" :class="{ empty, compact, stacked }" role="group" :aria-label="`${SUBJ}時間`">
    <span class="grp">
      <template v-for="(sg, i) in SEGS.slice(0, 3)" :key="sg.k">
        <input
          :ref="
            (el) => {
              if (el) els[i] = el as HTMLInputElement;
            }
          "
          :value="show(sg)"
          :class="['seg', 'l' + sg.len]"
          type="text"
          inputmode="numeric"
          autocomplete="off"
          spellcheck="false"
          :maxlength="sg.len + 1"
          :aria-label="aria(sg)"
          @focus="onFocus(sg, $event)"
          @mouseup="onMouseUp"
          @input="onInput(sg, i, $event)"
          @blur="onBlur(sg, $event)"
          @keydown="onKey(sg, i, $event)"
          @wheel="onWheel(sg, $event)"
          @paste="onPaste(sg, $event)"
        /><span v-if="i < 2" class="sep" aria-hidden="true">-</span>
      </template>
      <span class="wd" aria-hidden="true">週{{ wd }}</span>
    </span>
    <span class="grp">
      <template v-for="(sg, j) in SEGS.slice(3)" :key="sg.k">
        <input
          :ref="
            (el) => {
              if (el) els[j + 3] = el as HTMLInputElement;
            }
          "
          :value="show(sg)"
          :class="['seg', 'l' + sg.len]"
          type="text"
          inputmode="numeric"
          autocomplete="off"
          spellcheck="false"
          :maxlength="sg.len + 1"
          :aria-label="aria(sg)"
          @focus="onFocus(sg, $event)"
          @mouseup="onMouseUp"
          @input="onInput(sg, j + 3, $event)"
          @blur="onBlur(sg, $event)"
          @keydown="onKey(sg, j + 3, $event)"
          @wheel="onWheel(sg, $event)"
          @paste="onPaste(sg, $event)"
        /><span v-if="j < 2" class="sep" aria-hidden="true">:</span>
      </template>
    </span>
  </div>
</template>

<style scoped>
.sdt {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  column-gap: 0.55em;
  row-gap: 0.05em;
  font-size: var(--sdt-size, 1.75rem);
  font-weight: 500;
  line-height: 1.15;
  letter-spacing: -0.01em;
  min-width: 0;
}
.sdt.stacked {
  flex-direction: column;
  align-items: center;
  row-gap: 0.14em;
}
.sdt.stacked .grp:first-child {
  font-size: 0.54em;
  color: var(--ink-2);
}
.sdt.stacked .grp:first-child .seg {
  color: var(--ink-2);
}
.sdt.stacked .grp:first-child .seg:focus {
  color: var(--ink);
}
.grp {
  display: inline-flex;
  align-items: baseline;
  white-space: nowrap;
}
.seg {
  border: 0;
  padding: 0.02em 0.03em;
  margin: 0;
  border-radius: 0.22em;
  background: transparent;
  color: var(--ink);
  font: inherit;
  letter-spacing: inherit;
  text-align: center;
  caret-color: var(--accent);
  background-image: linear-gradient(to right, var(--ink-4) 45%, transparent 45%);
  background-size: 0.3rem 1px;
  background-repeat: repeat-x;
  background-position: 0 calc(100% - 0.02em);
  transition:
    background-color 0.15s,
    color 0.15s;
}
.seg.l4 {
  width: 4.15ch;
}
.seg.l2 {
  width: 2.2ch;
}
.seg:hover {
  background-color: var(--accent-wash);
  color: var(--accent);
}
.seg:focus {
  outline: none;
  background-color: var(--accent-wash-2);
  color: var(--ink);
  background-image: none;
  box-shadow: inset 0 -2px 0 var(--accent);
}
.seg::selection {
  background: var(--accent);
  color: var(--accent-ink);
}
.seg.bad {
  animation: bad 0.6s;
}
@keyframes bad {
  30% {
    background-color: var(--now-wash);
    color: var(--now);
  }
}
.sep {
  color: var(--ink-4);
  padding: 0 0.01em;
}
.wd {
  font-family: var(--f-sans);
  font-size: max(var(--floor), 0.5em);
  font-weight: 600;
  color: var(--ink-3);
  margin-left: 0.45em;
  letter-spacing: 0.02em;
  align-self: center;
}
.empty .seg {
  color: var(--ink-3);
}
.empty .seg:focus {
  color: var(--ink);
}
.empty .wd {
  opacity: 0.6;
}
</style>
