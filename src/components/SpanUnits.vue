<script setup lang="ts">
/* The same gap in every unit. Each value copies on click; the pen (or a double click) types a new value right there,
   and the span becomes that many of the unit (90 天, 20 工作日, 1.5 小時). */
import { computed, ref, nextTick } from 'vue';
import CopyBtn from './CopyBtn.vue';
import Icon from './Icon.vue';
import {
  S,
  startMs,
  endMs,
  gapSec,
  commit,
  setLink,
  checkSpan,
  linkTarget,
  linkSentence,
  followText,
  bump,
  toast,
} from '../state/store';
import { partsInTz, dayNum, countWeekdays, interpretSpanText, fmtSpan } from '../core/time';
import { nf, nfMax, plainNum } from '../core/format';

defineProps<{ cols?: number; inline?: boolean; compact?: boolean; big?: boolean }>();
const KEYS = ['週', '天', '小時', '分鐘', '秒', '工作日'] as const;
const cells = computed(() => {
  if (gapSec.value == null || endMs.value == null)
    return KEYS.map((k) => ({ k, v: '—', copy: '', tip: '設定結束後才有數字' }));
  const total = Math.abs(gapSec.value),
    neg = gapSec.value < 0;
  const lo = Math.min(startMs.value, endMs.value),
    hi = Math.max(startMs.value, endMs.value);
  const a = partsInTz(lo, S.startTz),
    b = partsInTz(hi, S.startTz);
  const n0 = dayNum(a.y, a.mo, a.d),
    n1 = dayNum(b.y, b.mo, b.d);
  const wk = countWeekdays(n0, n1);
  const sg = neg ? '−' : '',
    cs = neg ? '-' : '';
  const wkd = Math.floor((total % 604800) / 86400),
    wks = Math.floor(total / 604800);
  return [
    {
      k: KEYS[0],
      v: `${sg}${wks ? `${nf(wks)} 週${wkd ? ` ${wkd} 天` : ''}` : `${wkd} 天`}`,
      copy: cs + plainNum(total / 604800, 4),
      tip: `${sg}${nfMax(total / 604800, 3)} 週`,
    },
    {
      k: KEYS[1],
      v: `${sg}${nfMax(total / 86400, 2)}`,
      copy: cs + plainNum(total / 86400, 6),
      tip: `含頭尾共 ${nf(n1 - n0 + 1)} 個日期`,
    },
    {
      k: KEYS[2],
      v: `${sg}${nfMax(total / 3600, 2)}`,
      copy: cs + plainNum(total / 3600, 6),
      tip: `${nf(Math.floor(total / 3600))} 小時 ${Math.floor((total % 3600) / 60)} 分`,
    },
    {
      k: KEYS[3],
      v: `${sg}${nfMax(total / 60, 1)}`,
      copy: cs + plainNum(total / 60, 4),
      tip: `${nf(Math.floor(total / 60))} 分 ${total % 60} 秒`,
    },
    { k: KEYS[4], v: `${sg}${nf(total)}`, copy: cs + String(total), tip: `${nf(total * 1000)} 毫秒` },
    {
      k: KEYS[5],
      v: (wk && neg ? '−' : '') + nf(wk),
      copy: (wk && neg ? '-' : '') + String(wk),
      tip: `週一到週五（僅扣週末，不含國定假日）。週末 ${nf(n1 - n0 - wk)} 天`,
    },
  ];
});
const UNIT_WORD: Record<string, string> = { 週: '週', 天: '天', 小時: '小時', 分鐘: '分', 秒: '秒', 工作日: '工作日' };
const editing = ref<string | null>(null);
const text = ref('');
const input = ref<HTMLInputElement | null>(null);
const setInput = (el: unknown) => {
  if (el) input.value = el as HTMLInputElement;
};
function edit(k: string, v: string) {
  if (endMs.value == null) return;
  editing.value = k;
  text.value = v.replace(/^-/, '−');
  nextTick(() => {
    input.value?.focus();
    input.value?.select();
  });
}
let cancelled = false;
function done() {
  const k = editing.value;
  editing.value = null;
  if (!k || cancelled) {
    cancelled = false;
    return;
  }
  let t = text.value.trim().replace(/^−/, '-');
  if (!t) return;
  // a bare number is that many of this unit
  if (/^[+-]?\d+(\.\d+)?$/.test(t)) t = `${/^-/.test(t) ? '-' : '+'}${t.replace(/^[+-]/, '')}${UNIT_WORD[k]}`;
  const r = interpretSpanText(t);
  if (r.kind !== 'span') {
    toast('看不懂這個長度，試試 90、1.5 或 3天12小時');
    return;
  }
  const to = linkTarget();
  const c = checkSpan(r.span, to);
  if (!c.ok) {
    toast(c.err);
    return;
  }
  const ok = commit(() => setLink(r.span, to), {
    label: `間隔 ${fmtSpan(r.span)}`,
    say: () => `${linkSentence()}，${followText()}`,
  });
  if (ok) bump(to);
}
function key(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault();
    input.value?.blur();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    cancelled = true;
    input.value?.blur();
  }
}
</script>

<template>
  <dl class="units" :class="{ inline, compact, big }" :style="{ '--cols': cols || 6 }" aria-label="換算成各種單位">
    <div v-for="c in cells" :key="c.k" class="u">
      <dt>{{ c.k }}</dt>
      <dd v-if="editing === c.k">
        <input
          :ref="setInput"
          v-model="text"
          class="u-in mono"
          :aria-label="`間隔改成多少${c.k}`"
          spellcheck="false"
          autocomplete="off"
          @keydown="key"
          @blur="done"
        />
      </dd>
      <dd v-else @dblclick="c.copy && edit(c.k, c.copy)">
        <CopyBtn
          class="u-v mono"
          :text="c.copy"
          :k="`u-${c.k}`"
          :label="c.k"
          :tip="c.copy ? `${c.tip}。點一下複製 ${c.copy}；雙擊或筆可以改寫` : c.tip"
          :disabled="!c.copy"
          >{{ c.v }}</CopyBtn
        >
        <button
          v-if="c.copy"
          type="button"
          class="u-ed"
          :aria-label="`改寫成多少${c.k}`"
          v-tip="`改寫：間隔變成這麼多${c.k}`"
          @click="edit(c.k, c.copy)"
        >
          <Icon name="edit" />
        </button>
      </dd>
    </div>
  </dl>
</template>

<style scoped>
.units {
  display: grid;
  grid-template-columns: repeat(var(--cols), minmax(0, 1fr));
  gap: 1px;
  border-radius: var(--r-md);
  overflow: hidden;
  background: var(--hair);
  border: 1px solid var(--hair);
}
.u {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 0.1rem;
  padding: 0.45rem 0.65rem 0.5rem;
  background: var(--surface);
  min-width: 0;
}
.units.inline .u {
  flex-direction: row;
  align-items: center;
  justify-content: flex-start;
  gap: 0.28rem;
}
.u dt {
  font-size: var(--fs-xs);
  color: var(--ink-3);
  font-weight: 600;
  letter-spacing: 0.02em;
  flex: none;
  white-space: nowrap;
}
.u dd {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 0.1rem;
}
.units.inline .u dd {
  flex: 1;
}
.u-v {
  font-size: max(var(--floor), 0.84rem);
  font-weight: 500;
  color: var(--ink);
  gap: 0.25rem;
  margin: -0.12rem -0.25rem;
  padding: 0.12rem 0.25rem;
  min-width: 0;
}
.units.compact .u-v {
  font-size: max(var(--floor), 0.8rem);
}
.units.big .u {
  padding: 0.5rem 0.7rem 0.55rem;
}
.units.big .u dt {
  font-size: clamp(var(--fs-xs), 0.9vw, 0.95rem);
}
.units.big .u-v {
  font-size: clamp(0.88rem, 1.2vw, 1.3rem);
}
.u-ed {
  flex: none;
  width: 1.25rem;
  height: 1.25rem;
  display: grid;
  place-items: center;
  border-radius: 0.4rem;
  color: var(--ink-4);
  opacity: 0;
  transition: opacity 0.15s;
}
@media (hover: hover) and (pointer: fine) {
  .u-ed {
    width: 0;
    overflow: hidden;
    margin-left: -0.1rem;
  }
  .u:hover .u-ed,
  .u-ed:focus-visible {
    width: 1.25rem;
    margin-left: 0;
  }
}
.u:hover .u-ed,
.u-ed:focus-visible {
  opacity: 1;
}
.u-ed:hover {
  color: var(--accent);
  background: var(--accent-wash);
}
.u-ed .ic {
  width: 0.85em;
  height: 0.85em;
}
.u-in {
  width: 100%;
  min-width: 0;
  height: 1.5rem;
  padding: 0 0.35rem;
  margin: -0.1rem -0.25rem;
  border-radius: 0.4rem;
  border: 1.5px solid var(--accent);
  background: var(--surface-2);
  color: var(--ink);
  font-size: max(var(--floor), 0.84rem);
}
@media (pointer: coarse) {
  .u-ed {
    opacity: 1;
    width: 1.65rem;
    height: 1.65rem;
  }
}
</style>
