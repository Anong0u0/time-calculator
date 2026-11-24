<script setup lang="ts">
/* A scratch calculator for lengths of time: "2h 45m + 1:30:20 − 15m", "3:59:59 ÷ 42.195".
   It never touches start or end until you press 設為間隔. */
import { ref, computed, watch, nextTick, onMounted } from 'vue';
import Icon from './Icon.vue';
import CopyBtn from './CopyBtn.vue';
import { S, gapSec, checkSpan, setLink, commit, toast, bump } from '../state/store';
import {
  type Span,
  type DurTerm,
  DurError,
  evalDuration,
  parseSpan,
  isEmptySpan,
  fmtSpan,
  fmtClock,
  splitSeconds,
  isoDuration,
} from '../core/time';
import { nfMax, plainNum, durWords } from '../core/format';
import { fitText } from '../composables/fit';
import { useSize, fontsTick } from '../composables/size';

defineProps<{ compact?: boolean }>();
const PRESETS: [string, string, string][] = [
  ['工時', '8h30m + 7h45m + 9:15 + 6h', '一週工時加總'],
  ['配速', '3:59:59 ÷ 42.195', '全馬 4 小時內的每公里配速'],
  ['影集', '47m 30s × 16', '影集 16 集總長'],
  ['會議', '(1h 25m + 40m) × 3', '會議 3 場'],
];

type State =
  | { k: 'empty' }
  | { k: 'err'; msg: string; pos: number | null }
  | { k: 'dur' | 'ratio'; value: number; terms: DurTerm[] }
  | { k: 'cal'; span: Span };
const st = computed<State>(() => {
  const src = S.dur;
  try {
    const r = evalDuration(src);
    if (r.empty) return { k: 'empty' };
    return { k: r.dim === 'dur' ? 'dur' : 'ratio', value: r.value, terms: r.terms };
  } catch (e) {
    // 1年6個月 or 20工作日: a calendar length with no fixed number of seconds, but still a valid span
    try {
      const sp = parseSpan(src);
      if (sp && !isEmptySpan(sp)) return { k: 'cal', span: sp };
    } catch {
      /* keep the first error */
    }
    const de = e as DurError;
    return { k: 'err', msg: de.message, pos: typeof de.pos === 'number' ? de.pos : null };
  }
});
const clock = (v: number) => fmtClock(v, { decimals: Math.abs(v - Math.round(v)) > 1e-9 ? 2 : 0 });
const showV = (v: number, dim: 'dur' | 'num') => (dim === 'dur' ? clock(v) : nfMax(v, 4));
const big = computed(() => {
  const s = st.value;
  if (s.k === 'dur') return { t: clock(s.value), copy: clock(s.value) };
  if (s.k === 'ratio') return { t: `${nfMax(s.value, 4)} 倍`, copy: plainNum(s.value, 6) };
  if (s.k === 'cal') return { t: fmtSpan(s.span), copy: fmtSpan(s.span) };
  return { t: '0:00:00', copy: '' };
});
/** The step-by-step line: 2:45:00 + 1:30:20 − 0:15:00 = 4:00:20 */
const tape = computed<{ op?: string; v: string }[]>(() => {
  const s = st.value;
  if (s.k !== 'dur' && s.k !== 'ratio') return [];
  const res = { op: '=', v: big.value.t };
  if (s.terms.length === 1) return [{ v: S.dur.trim() }, res];
  return [
    ...s.terms.map((t, i) => ({
      op: i === 0 ? (t.v < 0 ? '−' : undefined) : t.sign < 0 ? '−' : '+',
      v: showV(i === 0 ? Math.abs(t.v) : t.v, t.dim),
    })),
    res,
  ];
});
const totals = computed(() => {
  const s = st.value;
  if (s.k !== 'dur') return [];
  const a = Math.abs(s.value),
    neg = s.value < 0 ? '-' : '',
    ng = s.value < 0 ? '−' : '';
  const sp = splitSeconds(Math.round(a * 1000) / 1000);
  const iso = isoDuration({ d: sp.d, h: sp.h, mi: sp.mi, s: sp.s }, s.value < 0 ? -1 : 1);
  return [
    { k: 'h', t: `${ng}${nfMax(a / 3600, 4)} 時`, c: neg + plainNum(a / 3600, 6) },
    { k: 'm', t: `${ng}${nfMax(a / 60, 2)} 分`, c: neg + plainNum(a / 60, 4) },
    { k: 's', t: `${ng}${nfMax(a, 3)} 秒`, c: neg + plainNum(a, 3) },
    { k: 'iso', t: iso, c: iso },
  ];
});
const spanOut = computed<Span | null>(() => {
  const s = st.value;
  if (s.k === 'cal') return s.span;
  if (s.k !== 'dur' || Math.round(Math.abs(s.value)) === 0) return null;
  const sp = splitSeconds(Math.round(Math.abs(s.value)));
  return { sign: s.value < 0 ? -1 : 1, y: 0, mo: 0, w: 0, d: sp.d, h: sp.h, mi: sp.mi, s: sp.s, biz: false };
});

function onInput() {
  S.durSample = false;
}
function usePreset(expr: string) {
  S.dur = expr;
  S.durSample = false;
  focus();
}
function fromInterval() {
  const g = gapSec.value;
  if (g == null) {
    toast('先設定結束，才有間隔可以帶入');
    return;
  }
  const sp = splitSeconds(Math.abs(g));
  const parts = [sp.d && `${sp.d}d`, sp.h && `${sp.h}h`, sp.mi && `${sp.mi}m`, sp.s && `${sp.s}s`].filter(Boolean);
  const lit = parts.join(' ') || '0s';
  S.dur = S.durSample || !S.dur.trim() ? lit : `${S.dur.trim()} + ${lit}`;
  S.durSample = false;
  toast('已帶入開始到結束的間隔');
}
function toSpan() {
  const sp = spanOut.value;
  if (!sp) return;
  const c = checkSpan(sp);
  if (!c.ok) {
    toast(c.err);
    return;
  }
  commit(() => setLink(sp), { label: `間隔 ${fmtSpan(sp)}`, say: () => `間隔設為 ${fmtSpan(sp)}，結束跟著開始` });
  bump('end');
  bump('span');
}

const input = ref<HTMLInputElement | null>(null);
function focus() {
  nextTick(() => {
    input.value?.focus();
  });
}
defineExpose({
  focus,
  select: () =>
    nextTick(() => {
      input.value?.focus();
      input.value?.select();
    }),
});

/* the big result shrinks to fit its line */
const bigEl = ref<HTMLElement | null>(null);
const resBox = ref<HTMLElement | null>(null);
const { w: resW } = useSize(resBox);
const refit = () => nextTick(() => fitText(bigEl.value, 0.45));
watch([() => big.value.t, resW, fontsTick], refit);
onMounted(refit);
</script>

<template>
  <div class="dc" :class="{ compact }">
    <label class="dc-in" :class="{ bad: st.k === 'err' }">
      <input
        ref="input"
        v-model="S.dur"
        class="mono"
        type="text"
        autocomplete="off"
        spellcheck="false"
        enterkeyhint="done"
        placeholder="2h 45m + 1:30:20 − 15m"
        aria-label="時間長度算式"
        aria-describedby="dc-tape"
        @input="onInput"
      />
      <button
        v-if="S.dur"
        type="button"
        class="icon-btn dc-clear"
        aria-label="清除算式"
        @click="
          S.dur = '';
          S.durSample = false;
          focus();
        "
      >
        <Icon name="x" />
      </button>
    </label>
    <div class="dc-chips" role="group" aria-label="範例算式">
      <button
        v-for="[name, expr, what] in PRESETS"
        :key="name"
        type="button"
        class="chip"
        :aria-pressed="S.dur === expr"
        v-tip="`${what}：${expr}`"
        @click="usePreset(expr)"
      >
        {{ name }}
      </button>
      <button type="button" class="chip" v-tip="'把開始到結束的間隔帶入算式'" @click="fromInterval">帶入間隔</button>
    </div>
    <p id="dc-tape" class="dc-tape mono" :class="{ err: st.k === 'err', cal: st.k === 'cal' }" aria-live="polite">
      <template v-if="st.k === 'err'">{{ st.pos != null ? `第 ${st.pos + 1} 個字附近：` : '' }}{{ st.msg }}</template>
      <template v-else-if="st.k === 'cal'">日曆長度：年、月和工作日的長短不固定，不換算成時分秒</template>
      <template v-else
        ><template v-for="(t, i) in tape" :key="i"
          ><span v-if="t.op" class="op">{{ t.op }}</span
          >{{ t.v }}</template
        ></template
      >
    </p>
    <div ref="resBox" class="dc-res" :class="{ dim: st.k === 'err' }">
      <CopyBtn class="dc-big mono" :text="big.copy" k="dc-big" label="計算結果" :disabled="!big.copy"
        ><span ref="bigEl" class="dc-big-t">{{ big.t }}</span></CopyBtn
      >
      <button
        type="button"
        class="btn dc-set"
        :disabled="!spanOut"
        v-tip="spanOut ? `結束 = 開始 ${fmtSpan(spanOut)}，之後跟著開始移動` : '結果是時間長度時才能設為間隔'"
        @click="toSpan"
      >
        <Icon name="arrowR" />設為間隔
      </button>
    </div>
    <p class="dc-words">
      <template v-if="st.k === 'dur'">{{ durWords(st.value) }}</template>
      <template v-else-if="st.k === 'ratio'">結果是倍數，只顯示，不能設為間隔</template>
      <template v-else-if="st.k === 'cal'">可以直接設為開始到結束的間隔</template>
    </p>
    <div v-if="totals.length" class="dc-totals" aria-label="換算">
      <CopyBtn
        v-for="t in totals"
        :key="t.k"
        class="mono"
        :text="t.c"
        :k="`dc-${t.k}`"
        :label="t.k === 'iso' ? 'ISO 長度' : '總數'"
        >{{ t.t }}</CopyBtn
      >
    </div>
  </div>
</template>

<style scoped>
.dc {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  min-width: 0;
  min-height: 0;
  container-type: inline-size;
}
.dc-in {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  height: 2.7rem;
  padding: 0 0.35rem 0 0.85rem;
  border-radius: 0.9rem;
  background: var(--surface-2);
  border: 1px solid var(--hair-2);
  transition:
    border-color 0.18s,
    box-shadow 0.18s;
  flex: none;
}
.dc-in:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-wash-2);
}
.dc-in.bad {
  border-color: var(--now);
  box-shadow: 0 0 0 3px var(--now-wash);
}
.dc-in input {
  flex: 1;
  min-width: 0;
  height: 100%;
  border: 0;
  background: none;
  font-size: 1.05rem;
  color: var(--ink);
}
.dc-in input::placeholder {
  color: var(--ink-4);
}
.dc-clear {
  width: 2rem;
  height: 2rem;
}
.dc-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  flex: none;
}
.dc-chips .chip {
  height: 1.85rem;
  padding: 0 0.6rem;
  font-size: var(--fs-s);
}
.dc-tape {
  font-size: max(var(--floor), 0.82rem);
  color: var(--ink-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-height: 1.2rem;
  flex: none;
}
.dc-tape .op {
  color: var(--ink-4);
  margin: 0 0.3em;
}
.dc-tape.err {
  color: var(--now);
  font-family: var(--f-sans);
  font-stretch: 100%;
}
.dc-tape.cal {
  color: var(--ink-3);
  font-family: var(--f-sans);
  font-stretch: 100%;
}
.dc-res {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  min-width: 0;
  margin-top: 0.5rem;
  padding-top: 0.7rem;
  border-top: 1px solid var(--hair);
  flex: none;
  transition: opacity 0.2s;
}
.dc-res.dim {
  opacity: 0.4;
}
.dc-big {
  flex: 1;
  min-width: 0;
  margin: 0 !important;
  padding: 0 0.2rem !important;
  color: var(--ink);
}
.dc-big :deep(span) {
  flex: 1 1 auto;
  min-width: 0;
}
.dc-big-t {
  display: block;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  font-size: 2.9rem;
  font-weight: 500;
  letter-spacing: -0.035em;
  line-height: 1.15;
  color: inherit;
}
.dc-big :deep(.ic) {
  align-self: center;
}
.dc-set {
  flex: none;
}
.dc-set .ic {
  width: 1em;
  height: 1em;
}
.dc-words {
  font-size: 0.88rem;
  color: var(--ink-2);
  min-height: 1.25rem;
  flex: none;
}
.dc-totals {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1px;
  border-radius: var(--r-md);
  overflow: hidden;
  background: var(--hair);
  border: 1px solid var(--hair);
  font-size: max(var(--floor), 0.82rem);
  color: var(--ink);
  flex: none;
}
.dc-totals > :deep(.copy) {
  margin: 0;
  padding: 0.45rem 0.65rem;
  border-radius: 0;
  background: var(--surface);
}
@container (min-width: 36rem) {
  .dc-totals {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}
.compact .dc-big-t {
  font-size: 2.2rem;
}
.compact .dc-res {
  margin-top: 0.2rem;
}
</style>
