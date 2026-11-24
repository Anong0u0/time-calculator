<script setup lang="ts">
/* The same two moments written every common way. Each row gives ● start and ○ end.
   Every value shows what it does: the copy mark copies it (click anywhere on the value), the pen types over it.
   A row's label turns into 已複製 for a moment, so the copy is seen where it happened.
   Formats behind 另外 N 種 can be pinned to the top; 複製表格 copies every row as tab-separated text. */
import { ref, computed } from 'vue';
import Icon from './Icon.vue';
import CopyBtn from './CopyBtn.vue';
import Popover from './Popover.vue';
import SpanUnits from './SpanUnits.vue';
import { S, type End, now, startMs, endMs, hasEnd, calGap, toast } from '../state/store';
import { copiedKey, copyText } from '../composables/copy';
import { type Wall, partsInTz, offsetAt, isoOffset, fmtDate, fmtTime, pad, WD, wdOf, isoWeek, usWeek, dayOfYear, isLeap, nextLeap, wallKey, utcMs, isoDuration, DAY } from '../core/time';
import { rocYear, plainNum, relative } from '../core/format';
import { useSize, remPx } from '../composables/size';
import { focusCommand } from '../state/ui';

const EN_WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const EN_MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
type Fmt = (ms: number, tz: string, w: Wall) => string;
/** edit: the value can be typed over (it opens the command bar with this value, for this end). */
interface Def { k: string; label: string; f: Fmt; tip: string; sans?: boolean; edit?: boolean }
const DEFS: Def[] = [
  { k: 'iso', label: 'ISO 8601', tip: '含時差的標準格式', edit: true, f: (ms, tz, w) => `${fmtDate(w)}T${fmtTime(w)}${isoOffset(offsetAt(ms, tz))}` },
  { k: 'unix', label: 'Unix 秒', tip: '1970-01-01 UTC 起算的秒數', edit: true, f: (ms) => String(Math.floor(ms / 1000)) },
  { k: 'unixms', label: 'Unix 毫秒', tip: 'JavaScript Date.now() 的格式', edit: true, f: (ms) => String(ms) },
  { k: 'utc', label: 'UTC', tip: '換成世界協調時間', edit: true, f: (ms) => { const u = partsInTz(ms, 'UTC'); return `${fmtDate(u)}T${fmtTime(u)}Z`; } },
  { k: 'rel', label: '相對時間', sans: true, tip: '離現在多久', f: (ms) => relative(ms, now.value) },
  { k: 'zh', label: '中文', sans: true, tip: '中文日期', f: (_ms, _tz, w) => `${w.y}年${w.mo}月${w.d}日 星期${WD[wdOf(w)]} ${fmtTime(w)}` },
  { k: 'roc', label: '民國', sans: true, tip: '民國紀年', f: (_ms, _tz, w) => `${rocYear(w.y)} ${w.mo} 月 ${w.d} 日` },
  { k: 'week', label: 'ISO 週', tip: '年-W週-星期幾（1 = 週一）', f: (_ms, _tz, w) => { const i = isoWeek(w.y, w.mo, w.d); return `${i.weekYear}-W${pad(i.week)}-${i.weekday}`; } },
  { k: 'usweek', label: '美式週次', tip: '週日開始、含 1 月 1 日的那週是第 1 週（美國、Excel WEEKNUM 的算法）', f: (_ms, _tz, w) => `${w.y} 年 W${pad(usWeek(w.y, w.mo, w.d))}` },
  { k: 'doy', label: '第幾天', sans: true, tip: '一年中的第幾天、季度與閏年', f: (_ms, _tz, w) => `第 ${dayOfYear(w.y, w.mo, w.d)} 天 · Q${Math.ceil(w.mo / 3)} · ${isLeap(w.y) ? '閏年' : `平年（下次閏年 ${nextLeap(w.y)}）`}` },
  { k: 'rfc', label: 'RFC 2822', tip: '電子郵件標頭的格式', f: (ms, tz, w) => `${EN_WD[wdOf(w)]}, ${w.d} ${EN_MO[w.mo - 1]} ${w.y} ${fmtTime(w)} ${isoOffset(offsetAt(ms, tz)).replace(':', '')}` },
  { k: 'sql', label: 'SQL', tip: 'DATETIME 字面值（不含時區）', f: (_ms, _tz, w) => `${fmtDate(w)} ${fmtTime(w)}` },
  { k: 'excel', label: 'Excel', tip: 'Excel／Google 試算表的日期序號（當地時間）', f: (_ms, _tz, w) => plainNum((wallKey(w) - utcMs(1899, 12, 30)) / DAY, 6) },
  { k: 'http', label: 'HTTP', tip: 'HTTP 標頭的 GMT 格式', f: (ms) => { const u = partsInTz(ms, 'UTC'); return `${EN_WD[wdOf(u)]}, ${pad(u.d)} ${EN_MO[u.mo - 1]} ${u.y} ${fmtTime(u)} GMT`; } },
];
/** Pinned formats first, in the order they were pinned; the rest keep their place. */
const ordered = computed(() => {
  const pins = S.readPins.map((k) => DEFS.find((d) => d.k === k)).filter((d): d is Def => !!d);
  return [...pins, ...DEFS.filter((d) => !pins.includes(d))];
});
const vals = computed(() => {
  const sMs = startMs.value, eMs = endMs.value;
  const sW = partsInTz(sMs, S.startTz), eW = eMs != null ? partsInTz(eMs, S.endTz) : null;
  return ordered.value.map((d) => ({ ...d, s: d.f(sMs, S.startTz, sW), e: eW && eMs != null ? d.f(eMs, S.endTz, eW) : '' }));
});
function pin(k: string, label: string) {
  S.readPins = [k, ...S.readPins.filter((x) => x !== k)];
  more.value = false;
  toast(`「${label}」移到最上面`);
}
function resetPins() { S.readPins = []; toast('讀法恢復預設順序'); }
/** The row whose value was just copied: its label says so. */
const hot = (k: string) => !!copiedKey.value && copiedKey.value.startsWith(`rd-${k}-`);
function copyTable() {
  const head = hasEnd.value ? '格式\t開始\t結束' : '格式\t開始';
  const rows = vals.value.map((r) => [r.label, r.s, ...(hasEnd.value ? [r.e] : [])].join('\t'));
  if (hasEnd.value) rows.unshift(['長度', isoDur.value, ''].join('\t'));
  copyText([head, ...rows].join('\n'), 'rd-table', '表格');
}
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
  // the foot (另外 N 種 · 複製表格) is always there
  const room = bodyH.value - unitsH.value - lenH.value - 2.3 * remPx.value;
  if (DEFS.length * rowH.value <= room) return DEFS.length;
  return Math.max(0, Math.floor(room / rowH.value));
});
const shown = computed(() => (bodyH.value ? vals.value.slice(0, fit.value) : vals.value.slice(0, 6)));
const rest = computed(() => vals.value.slice(shown.value.length));
const moreBtn = ref<HTMLElement | null>(null);
const more = ref(false);
const nowSec = computed(() => String(Math.floor(now.value / 1000)));
function editVal(which: End, v: string) { more.value = false; S.active = which; focusCommand(v, true); }
</script>

<template>
  <section class="panel rd" :class="{ cols, one: !hasEnd }" aria-label="讀法">
    <header class="panel-head">
      <Icon name="list" class="ph-ic" />
      <h2>讀法</h2>
      <span class="rd-how" aria-hidden="true"><span><Icon name="copy" />點值複製</span><span><Icon name="edit" />改寫</span></span>
      <span v-if="cols && hasEnd" class="rd-legend" aria-hidden="true"><i class="node" />開始 <i class="node end" />結束</span>
      <CopyBtn class="rd-now mono" :text="nowSec" k="rd-now" label="現在的 Unix 秒" :tip="`現在的 Unix 時間戳（秒），每秒更新。點一下複製`"><i class="dot" aria-hidden="true" /><em>現在</em>{{ nowSec }}</CopyBtn>
    </header>
    <div ref="body" class="rd-body">
      <div v-if="hasEnd" ref="unitsBox" class="rd-units"><SpanUnits :cols="cols ? 6 : bodyW >= 24 * remPx ? 3 : 2" /></div>
      <div v-if="hasEnd" class="rd-row len" :class="{ hot: copiedKey === 'rd-dur' }">
        <span class="rd-k" v-tip="'ISO 8601 的長度寫法'">{{ copiedKey === 'rd-dur' ? '已複製' : '長度' }}</span>
        <span class="rd-v"><CopyBtn class="mono" :text="isoDur" k="rd-dur" label="ISO 長度" /></span>
      </div>
      <div v-for="r in shown" :key="r.k" class="rd-row" :class="{ hot: hot(r.k) }">
        <span class="rd-k" v-tip="r.tip">{{ hot(r.k) ? '已複製' : r.label }}</span>
        <span class="rd-v"><i v-if="hasEnd && !cols" class="node" aria-hidden="true" /><CopyBtn :class="r.sans ? 'tnum' : 'mono'" :text="r.s" :k="`rd-${r.k}-s`" :label="`開始 ${r.label}`" /><button v-if="r.edit" type="button" class="rd-edit" v-tip="`改寫開始的 ${r.label}`" :aria-label="`改寫開始的 ${r.label}`" @click="editVal('start', r.s)"><Icon name="edit" /></button></span>
        <span v-if="hasEnd" class="rd-v"><i v-if="!cols" class="node end" aria-hidden="true" /><CopyBtn :class="r.sans ? 'tnum' : 'mono'" :text="r.e" :k="`rd-${r.k}-e`" :label="`結束 ${r.label}`" /><button v-if="r.edit" type="button" class="rd-edit" v-tip="`改寫結束的 ${r.label}`" :aria-label="`改寫結束的 ${r.label}`" @click="editVal('end', r.e)"><Icon name="edit" /></button></span>
      </div>
      <div class="rd-foot">
        <button v-if="rest.length" ref="moreBtn" type="button" class="rd-more" :aria-expanded="more" v-tip="'看其他寫法，也可以把常用的釘到上面'" @click="more = !more">
          <span class="ell">另外 {{ rest.length }} 種：{{ rest.map((r) => r.label).join('、') }}</span><Icon name="chevD" />
        </button>
        <span v-else class="rd-fill" />
        <button type="button" class="rd-table" :class="{ ok: copiedKey === 'rd-table' }" v-tip="'把所有寫法複製成表格（Tab 分隔，可以直接貼進試算表）'" @click="copyTable"><Icon :name="copiedKey === 'rd-table' ? 'check' : 'copy'" />{{ copiedKey === 'rd-table' ? '已複製' : '複製表格' }}</button>
      </div>
    </div>
    <Popover :open="more" :anchor="moreBtn" label="其他寫法" width="28rem" @close="more = false">
      <div class="rd-pop" :class="{ one: !hasEnd }">
        <p class="rd-pop-how"><Icon name="copy" />點值複製　<Icon name="edit" />改寫　<Icon name="pin" />釘到上面，常用的就不必打開這裡</p>
        <div v-for="r in rest" :key="r.k" class="rd-row" :class="{ hot: hot(r.k) }">
          <span class="rd-k">{{ hot(r.k) ? '已複製' : r.label }}</span>
          <span class="rd-v"><i v-if="hasEnd" class="node" aria-hidden="true" /><CopyBtn :class="r.sans ? 'tnum' : 'mono'" :text="r.s" :k="`rd-${r.k}-s`" :label="`開始 ${r.label}`" /><button v-if="r.edit" type="button" class="rd-edit" :aria-label="`改寫開始的 ${r.label}`" @click="editVal('start', r.s)"><Icon name="edit" /></button></span>
          <span v-if="hasEnd" class="rd-v"><i class="node end" aria-hidden="true" /><CopyBtn :class="r.sans ? 'tnum' : 'mono'" :text="r.e" :k="`rd-${r.k}-e`" :label="`結束 ${r.label}`" /><button v-if="r.edit" type="button" class="rd-edit" :aria-label="`改寫結束的 ${r.label}`" @click="editVal('end', r.e)"><Icon name="edit" /></button></span>
          <button type="button" class="rd-pin" :aria-label="`把 ${r.label} 釘到上面`" v-tip="'釘到上面'" @click="pin(r.k, r.label)"><Icon name="pin" /></button>
        </div>
        <button v-if="S.readPins.length" type="button" class="rd-reset" @click="resetPins">恢復預設順序</button>
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
.rd-v :deep(.copy) { font-size: max(var(--floor), .82rem); color: var(--ink); }
.len .rd-v :deep(.copy) { color: var(--accent); }
.rd-foot { flex: none; display: flex; align-items: center; gap: .4rem; height: 2.2rem; margin-top: auto; padding-top: .15rem; }
.rd-fill { flex: 1; }
.rd-more { flex: 1; min-width: 0; display: flex; align-items: center; gap: .3rem; height: 2rem; margin-left: -.55rem; padding: 0 .55rem; border-radius: .6rem; font-size: max(var(--floor), .84rem); color: var(--ink-2); white-space: nowrap; overflow: hidden; text-align: left; }
.rd-more .ell { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.rd-more:hover { background: var(--accent-wash); color: var(--accent); }
.rd-table { flex: none; display: inline-flex; align-items: center; gap: .3rem; height: 1.9rem; padding: 0 .6rem; border-radius: .6rem; border: 1px solid var(--hair-2); font-size: var(--fs-xs); font-weight: 600; color: var(--ink-2); white-space: nowrap; }
.rd-table .ic { width: 1em; height: 1em; }
.rd-table:hover { background: var(--accent-wash); border-color: var(--accent-line); color: var(--accent); }
.rd-table.ok { color: var(--good); border-color: var(--good); background: var(--good-wash); }
/* how the rows work, said once where they are */
.rd-how { display: inline-flex; align-items: center; gap: .65rem; min-width: 0; overflow: hidden; font-size: var(--fs-xs); color: var(--ink-3); white-space: nowrap; }
.rd-how > span { display: inline-flex; align-items: center; gap: .22rem; }
.rd-how .ic { width: 1.05em; height: 1.05em; color: var(--accent); opacity: .8; }
.rd-now em { font-style: normal; font-family: var(--f-sans); margin-right: .35em; color: var(--ink-3); }
/* a row that was just copied */
.rd-row.hot .rd-k { color: var(--good) !important; }
.rd-row :deep(.copy.copied) { color: var(--good) !important; background: var(--good-wash); }
.rd-pop-how { display: flex; align-items: center; flex-wrap: wrap; gap: .25rem; margin-bottom: .35rem; font-size: var(--fs-xs); color: var(--ink-3); }
.rd-pop-how .ic { width: 1.05em; height: 1.05em; color: var(--accent); }
.rd-pop .rd-row { grid-template-columns: 4.9rem minmax(0, 1fr) auto; }
.rd-pop .rd-row .rd-v + .rd-v { grid-column: 2; }
.rd-pop .rd-pin { grid-column: 3; grid-row: 1 / span 2; }
.rd-pop.one .rd-pin { grid-row: 1; }
.rd-pin { display: grid; place-items: center; width: 1.9rem; height: 1.9rem; border-radius: .55rem; color: var(--ink-3); }
.rd-pin .ic { width: 1.05em; height: 1.05em; }
.rd-pin:hover { background: var(--accent-wash); color: var(--accent); }
.rd-reset { margin-top: .5rem; font-size: var(--fs-xs); color: var(--ink-3); text-decoration: underline; text-underline-offset: 2px; }
.rd-reset:hover { color: var(--accent); }
.rd-pop { padding: .5rem 1rem .6rem; }
.rd-now { flex: none; font-size: var(--fs-xs); color: var(--ink-2); padding: .2rem .45rem !important; margin: 0 !important; border-radius: .55rem; background: var(--now-wash); }
.rd-now .dot { display: inline-block; width: .45em; height: .45em; margin-right: .4em; border-radius: 50%; background: var(--now); vertical-align: .12em; }
.rd-edit { flex: none; display: grid; place-items: center; width: 1.5rem; height: 1.4rem; margin: -.3rem 0; border-radius: .45rem; color: var(--ink-3); opacity: .75; transition: background .15s, color .15s, opacity .15s; }
.rd-edit .ic { width: .95em; height: .95em; }
.rd-edit:hover { opacity: 1; color: var(--accent); background: var(--accent-wash); }
/* the row under the pointer lights up as a whole, so it is clear which pair of values belongs to which label */
@media (hover: hover) {
  .rd-body > .rd-row:hover, .rd-pop .rd-row:hover { background: color-mix(in srgb, var(--accent) 4.5%, transparent); }
  .rd-row:hover .rd-k { color: var(--ink-2) !important; }
}
.rd-body > .rd-row { margin: 0 -.5rem; padding-left: .5rem; padding-right: .5rem; border-radius: .55rem; }
</style>
