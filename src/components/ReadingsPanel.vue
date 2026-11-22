<script setup lang="ts">
/* The same two moments written every common way. Each row gives ● start and ○ end; click a value to copy it. */
import { ref, computed } from 'vue';
import Icon from './Icon.vue';
import CopyBtn from './CopyBtn.vue';
import Popover from './Popover.vue';
import SpanUnits from './SpanUnits.vue';
import { S, startMs, endMs, hasEnd, calGap } from '../state/store';
import { type Wall, partsInTz, offsetAt, isoOffset, fmtDate, fmtTime, pad, WD, wdOf, isoWeek, dayOfYear, isLeap, wallKey, utcMs, isoDuration, DAY } from '../core/time';
import { rocYear, plainNum } from '../core/format';
import { useSize, remPx } from '../composables/size';

defineProps<{ withUnits?: boolean }>();
const EN_WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const EN_MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
type Fmt = (ms: number, tz: string, w: Wall) => string;
interface Def { k: string; label: string; f: Fmt; tip: string; sans?: boolean }
const DEFS: Def[] = [
  { k: 'iso', label: 'ISO 8601', tip: '含時差的標準格式', f: (ms, tz, w) => `${fmtDate(w)}T${fmtTime(w)}${isoOffset(offsetAt(ms, tz))}` },
  { k: 'unix', label: 'Unix 秒', tip: '1970-01-01 UTC 起算的秒數', f: (ms) => String(Math.floor(ms / 1000)) },
  { k: 'unixms', label: 'Unix 毫秒', tip: 'JavaScript Date.now() 的格式', f: (ms) => String(ms) },
  { k: 'utc', label: 'UTC', tip: '換成世界協調時間', f: (ms) => { const u = partsInTz(ms, 'UTC'); return `${fmtDate(u)}T${fmtTime(u)}Z`; } },
  { k: 'zh', label: '中文', sans: true, tip: '中文日期', f: (_ms, _tz, w) => `${w.y}年${w.mo}月${w.d}日 星期${WD[wdOf(w)]} ${fmtTime(w)}` },
  { k: 'roc', label: '民國', sans: true, tip: '民國紀年', f: (_ms, _tz, w) => `${rocYear(w.y)} ${w.mo} 月 ${w.d} 日` },
  { k: 'week', label: 'ISO 週', tip: '年-W週-星期幾（1 = 週一）', f: (_ms, _tz, w) => { const i = isoWeek(w.y, w.mo, w.d); return `${i.weekYear}-W${pad(i.week)}-${i.weekday}`; } },
  { k: 'doy', label: '第幾天', sans: true, tip: '一年中的第幾天、季度與閏年', f: (_ms, _tz, w) => `第 ${dayOfYear(w.y, w.mo, w.d)} 天 · Q${Math.ceil(w.mo / 3)} · ${isLeap(w.y) ? '閏年' : '平年'}` },
  { k: 'rfc', label: 'RFC 2822', tip: '電子郵件標頭的格式', f: (ms, tz, w) => `${EN_WD[wdOf(w)]}, ${w.d} ${EN_MO[w.mo - 1]} ${w.y} ${fmtTime(w)} ${isoOffset(offsetAt(ms, tz)).replace(':', '')}` },
  { k: 'sql', label: 'SQL', tip: 'DATETIME 字面值（不含時區）', f: (_ms, _tz, w) => `${fmtDate(w)} ${fmtTime(w)}` },
  { k: 'excel', label: 'Excel', tip: 'Excel／Google 試算表的日期序號（當地時間）', f: (_ms, _tz, w) => plainNum((wallKey(w) - utcMs(1899, 12, 30)) / DAY, 6) },
  { k: 'http', label: 'HTTP', tip: 'HTTP 標頭的 GMT 格式', f: (ms) => { const u = partsInTz(ms, 'UTC'); return `${EN_WD[wdOf(u)]}, ${pad(u.d)} ${EN_MO[u.mo - 1]} ${u.y} ${fmtTime(u)} GMT`; } },
];
const vals = computed(() => {
  const sMs = startMs.value, eMs = endMs.value;
  const sW = partsInTz(sMs, S.startTz), eW = eMs != null ? partsInTz(eMs, S.endTz) : null;
  return DEFS.map((d) => ({ ...d, s: d.f(sMs, S.startTz, sW), e: eW && eMs != null ? d.f(eMs, S.endTz, eW) : '' }));
});
const isoDur = computed(() => { const c = calGap.value; return c ? isoDuration(c, c.sign) : ''; });

const body = ref<HTMLElement | null>(null);
const { w: bodyW, h: bodyH } = useSize(body);
const cols = computed(() => bodyW.value > 0 && bodyW.value >= 38 * remPx.value);
const rowH = computed(() => (cols.value || !hasEnd.value ? 2.15 : 2.95) * remPx.value);
const unitsBox = ref<HTMLElement | null>(null);
const { h: unitsInner } = useSize(unitsBox);
const unitsH = computed(() => (hasEnd.value ? unitsInner.value + 0.7 * remPx.value : 0));
const lenH = computed(() => (hasEnd.value ? 2.15 * remPx.value : 0));
const fit = computed(() => {
  const room = bodyH.value - unitsH.value - lenH.value;
  if (DEFS.length * rowH.value <= room) return DEFS.length;
  return Math.max(1, Math.floor((room - 2.2 * remPx.value) / rowH.value));
});
const shown = computed(() => (bodyH.value ? vals.value.slice(0, fit.value) : vals.value.slice(0, 6)));
const rest = computed(() => vals.value.slice(shown.value.length));
const moreBtn = ref<HTMLElement | null>(null);
const more = ref(false);
</script>

<template>
  <section class="panel rd" :class="{ cols, one: !hasEnd }" aria-label="讀法">
    <header class="panel-head">
      <Icon name="list" class="ph-ic" />
      <h2>讀法</h2>
      <span class="panel-sub">同兩個時刻的各種寫法，點一下複製</span>
      <span v-if="cols && hasEnd" class="rd-legend" aria-hidden="true"><i class="node" />開始 <i class="node end" />結束</span>
    </header>
    <div ref="body" class="rd-body">
      <div v-if="hasEnd" ref="unitsBox" class="rd-units"><SpanUnits :cols="cols ? 6 : bodyW >= 21 * remPx ? 3 : 2" /></div>
      <div v-if="hasEnd" class="rd-row len">
        <span class="rd-k" v-tip="'ISO 8601 的長度寫法'">長度</span>
        <span class="rd-v"><CopyBtn class="mono" :text="isoDur" k="rd-dur" label="ISO 長度" /></span>
      </div>
      <div v-for="r in shown" :key="r.k" class="rd-row">
        <span class="rd-k" v-tip="r.tip">{{ r.label }}</span>
        <span class="rd-v"><i v-if="hasEnd && !cols" class="node" aria-hidden="true" /><CopyBtn :class="r.sans ? 'tnum' : 'mono'" :text="r.s" :k="`rd-${r.k}-s`" :label="`開始 ${r.label}`" /></span>
        <span v-if="hasEnd" class="rd-v"><i v-if="!cols" class="node end" aria-hidden="true" /><CopyBtn :class="r.sans ? 'tnum' : 'mono'" :text="r.e" :k="`rd-${r.k}-e`" :label="`結束 ${r.label}`" /></span>
      </div>
      <button v-if="rest.length" ref="moreBtn" type="button" class="rd-more" :aria-expanded="more" @click="more = !more">
        <span class="ell">另外 {{ rest.length }} 種：{{ rest.map((r) => r.label).join('、') }}</span><Icon name="chevD" />
      </button>
    </div>
    <Popover :open="more" :anchor="moreBtn" label="其他寫法" width="27rem" @close="more = false">
      <div class="rd-pop" :class="{ one: !hasEnd }">
        <div v-for="r in rest" :key="r.k" class="rd-row">
          <span class="rd-k">{{ r.label }}</span>
          <span class="rd-v"><i v-if="hasEnd" class="node" aria-hidden="true" /><CopyBtn :class="r.sans ? 'tnum' : 'mono'" :text="r.s" :k="`rd-${r.k}-s`" :label="`開始 ${r.label}`" /></span>
          <span v-if="hasEnd" class="rd-v"><i class="node end" aria-hidden="true" /><CopyBtn :class="r.sans ? 'tnum' : 'mono'" :text="r.e" :k="`rd-${r.k}-e`" :label="`結束 ${r.label}`" /></span>
        </div>
      </div>
    </Popover>
  </section>
</template>

<style scoped>
.ph-ic { color: var(--ink-3); }
.rd-legend { display: inline-flex; align-items: center; gap: .3rem; font-size: var(--fs-xs); color: var(--ink-3); flex: none; }
.rd-legend .node { font-size: .7rem; margin-left: .35rem; }
.rd-body { flex: 1; min-height: 0; display: flex; flex-direction: column; padding: .35rem 1rem .7rem; overflow: hidden; }
.rd-units { margin: .2rem 0 .5rem; flex: none; }
.rd-row { display: grid; grid-template-columns: 4.9rem minmax(0, 1fr); grid-auto-rows: auto; column-gap: .7rem; align-items: center; padding: .3rem 0; border-top: 1px solid var(--hair); min-height: 2.15rem; flex: none; }
.rd-row:first-child, .rd-units + .rd-row { border-top: 0; }
.rd-row.len { grid-template-columns: 4.9rem minmax(0, 1fr) !important; }
.rd-row .rd-v + .rd-v { grid-column: 2; }
.cols .rd-row { grid-template-columns: 5.2rem minmax(0, 1fr) minmax(0, 1fr); }
.cols .rd-row .rd-v + .rd-v { grid-column: 3; }
.rd-row.len .rd-v + .rd-v { grid-column: auto; }
.rd-row.len { grid-template-columns: 4.9rem minmax(0, 1fr) auto; }
.cols .rd-row.len { grid-template-columns: 5.2rem minmax(0, 1fr) minmax(0, 1fr); }
.rd-k { grid-row: span 2; font-size: var(--fs-s); font-weight: 600; color: var(--ink-3); white-space: nowrap; cursor: help; align-self: center; }
.one .rd-k, .cols .rd-k, .len .rd-k { grid-row: auto; }
.rd-v { display: flex; align-items: center; gap: .35rem; min-width: 0; line-height: 1.35; }
.rd-v .node { font-size: var(--fs-xs); flex: none; }
.rd-v :deep(.copy) { font-size: max(11px, .82rem); color: var(--ink); }
.len .rd-v :deep(.copy) { color: var(--accent); }
.rd-more { flex: none; display: flex; align-items: center; gap: .3rem; height: 2rem; margin: .15rem -.3rem 0; padding: 0 .55rem; border-radius: .6rem; font-size: max(11px, .84rem); color: var(--ink-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: left; }
.rd-more:hover { background: var(--well-2); color: var(--ink); }
.rd-pop { padding: .5rem 1rem .6rem; }
</style>
