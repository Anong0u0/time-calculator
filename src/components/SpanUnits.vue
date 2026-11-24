<script setup lang="ts">
/* The same gap in every unit. Each value copies on click. */
import { computed } from 'vue';
import CopyBtn from './CopyBtn.vue';
import { S, startMs, endMs, gapSec } from '../state/store';
import { partsInTz, dayNum, countWeekdays } from '../core/time';
import { nf, nfMax, plainNum } from '../core/format';

defineProps<{ cols?: number }>();
const KEYS = ['週', '天', '小時', '分鐘', '秒', '工作日'] as const;
const cells = computed(() => {
  if (gapSec.value == null || endMs.value == null) return KEYS.map((k) => ({ k, v: '—', copy: '', tip: '設定結束後才有數字' }));
  const total = Math.abs(gapSec.value), neg = gapSec.value < 0;
  const lo = Math.min(startMs.value, endMs.value), hi = Math.max(startMs.value, endMs.value);
  const a = partsInTz(lo, S.startTz), b = partsInTz(hi, S.startTz);
  const n0 = dayNum(a.y, a.mo, a.d), n1 = dayNum(b.y, b.mo, b.d);
  const wk = countWeekdays(n0, n1);
  const sg = neg ? '−' : '', cs = neg ? '-' : '';
  const wkd = Math.floor((total % 604800) / 86400), wks = Math.floor(total / 604800);
  return [
    { k: KEYS[0], v: `${sg}${wks ? `${nf(wks)} 週${wkd ? ` ${wkd} 天` : ''}` : `${wkd} 天`}`, copy: cs + plainNum(total / 604800, 4), tip: `${sg}${nfMax(total / 604800, 3)} 週` },
    { k: KEYS[1], v: `${sg}${nfMax(total / 86400, 2)}`, copy: cs + plainNum(total / 86400, 6), tip: `含頭尾共 ${nf(n1 - n0 + 1)} 個日期` },
    { k: KEYS[2], v: `${sg}${nfMax(total / 3600, 2)}`, copy: cs + plainNum(total / 3600, 6), tip: `${nf(Math.floor(total / 3600))} 小時 ${Math.floor((total % 3600) / 60)} 分` },
    { k: KEYS[3], v: `${sg}${nfMax(total / 60, 1)}`, copy: cs + plainNum(total / 60, 4), tip: `${nf(Math.floor(total / 60))} 分 ${total % 60} 秒` },
    { k: KEYS[4], v: `${sg}${nf(total)}`, copy: cs + String(total), tip: `${nf(total * 1000)} 毫秒` },
    { k: KEYS[5], v: (wk && neg ? '−' : '') + nf(wk), copy: (wk && neg ? '-' : '') + String(wk), tip: `週一到週五（僅扣週末，不含國定假日）。週末 ${nf(n1 - n0 - wk)} 天` },
  ];
});
</script>

<template>
  <dl class="units" :style="{ '--cols': cols || 6 }" aria-label="換算成各種單位">
    <div v-for="c in cells" :key="c.k" class="u">
      <dt>{{ c.k }}</dt>
      <dd><CopyBtn class="u-v mono" :text="c.copy" :k="`u-${c.k}`" :label="c.k" :tip="c.copy ? `${c.tip}。點一下複製 ${c.copy}` : c.tip" :disabled="!c.copy">{{ c.v }}</CopyBtn></dd>
    </div>
  </dl>
</template>

<style scoped>
.units { display: grid; grid-template-columns: repeat(var(--cols), minmax(0, 1fr)); gap: 1px; border-radius: var(--r-md); overflow: hidden; background: var(--hair); border: 1px solid var(--hair); }
.u { display: flex; flex-direction: column; justify-content: center; gap: .1rem; padding: .45rem .65rem .5rem; background: var(--surface); min-width: 0; }
.u dt { font-size: var(--fs-xs); color: var(--ink-3); font-weight: 600; letter-spacing: .02em; }
.u dd { min-width: 0; display: flex; }
.u-v { font-size: max(var(--floor), .86rem); font-weight: 500; color: var(--ink); gap: .35rem; margin: -.12rem -.35rem; }
</style>
