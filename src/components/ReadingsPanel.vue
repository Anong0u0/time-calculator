<script setup lang="ts">
/* The same two moments written every common way. Each row gives ● start and ○ end.
   Every value shows what it does: click it to copy, the pen types over it right where it is (any reading can be
   written back: ISO, Unix, 民國, 週次, Excel …). A row's label turns into 已複製 for a moment.
   Drag a row by its grip (or ↑↓ on the grip) to put the formats you use on top; 全部寫法 lists them all, with a line
   where the panel's room ends, so a format is brought into view by dragging it above that line. */
import { ref, computed, nextTick } from 'vue';
import Icon from './Icon.vue';
import CopyBtn from './CopyBtn.vue';
import Popover from './Popover.vue';
import {
  S,
  type End,
  now,
  startMs,
  endMs,
  hasEnd,
  calGap,
  toast,
  undo,
  commit,
  setInstant,
  setWall,
  setLive,
  wallOf,
  tzOf,
  bump,
} from '../state/store';
import { copiedKey, copyText } from '../composables/copy';
import {
  type Wall,
  partsInTz,
  offsetAt,
  isoOffset,
  fmtDate,
  fmtTime,
  fmtDT,
  pad,
  WD,
  wdOf,
  isoWeek,
  usWeek,
  dayOfYear,
  isLeap,
  nextLeap,
  wallKey,
  utcMs,
  isoDuration,
  interpretSpanText,
  addDuration,
  DAY,
  dayNum,
} from '../core/time';
import { parseReading } from '../core/parse';
import { lunarOf, ganzhi, zodiac, lunarMonthName, lunarDayName } from '../core/lunar';
import { termAround, TERM_NAMES, CHINA_TZ } from '../core/terms';
import { rocYear, plainNum, relative } from '../core/format';
import { useSize, remPx } from '../composables/size';
import { useDragSort, moved } from '../composables/dragSort';

const EN_WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** 小雪 第 3 天 · 下一個 大雪 12/7 */
function termText(ms: number, tz: string): string {
  const { prev, next } = termAround(ms);
  const day = (t: number) => {
    const w = partsInTz(t, S.prefs.termTz === 'china' ? CHINA_TZ : tz);
    return dayNum(w.y, w.mo, w.d);
  };
  const here = partsInTz(ms, tz),
    n = dayNum(here.y, here.mo, here.d);
  const nw = partsInTz(next.ms, S.prefs.termTz === 'china' ? CHINA_TZ : tz);
  return `${TERM_NAMES[prev.k]} 第 ${n - day(prev.ms) + 1} 天 · 下一個 ${TERM_NAMES[next.k]} ${nw.mo}/${nw.d}`;
}
const EN_MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
type Fmt = (ms: number, tz: string, w: Wall) => string;
interface Def {
  k: string;
  label: string;
  f: Fmt;
  tip: string;
  sans?: boolean;
}
const DEFS: Def[] = [
  {
    k: 'iso',
    label: 'ISO 8601',
    tip: '含時差的標準格式',
    f: (ms, tz, w) => `${fmtDate(w)}T${fmtTime(w)}${isoOffset(offsetAt(ms, tz))}`,
  },
  { k: 'unix', label: 'Unix 秒', tip: '1970-01-01 UTC 起算的秒數', f: (ms) => String(Math.floor(ms / 1000)) },
  { k: 'unixms', label: 'Unix 毫秒', tip: 'JavaScript Date.now() 的格式', f: (ms) => String(ms) },
  {
    k: 'utc',
    label: 'UTC',
    tip: '換成世界協調時間',
    f: (ms) => {
      const u = partsInTz(ms, 'UTC');
      return `${fmtDate(u)}T${fmtTime(u)}Z`;
    },
  },
  {
    k: 'rel',
    label: '相對時間',
    sans: true,
    tip: '離現在多久（可以改寫成「3 天後」「2 小時前」「現在」）',
    f: (ms) => relative(ms, now.value),
  },
  {
    k: 'zh',
    label: '中文',
    sans: true,
    tip: '中文日期',
    f: (_ms, _tz, w) => `${w.y}年${w.mo}月${w.d}日 星期${WD[wdOf(w)]} ${fmtTime(w)}`,
  },
  { k: 'roc', label: '民國', sans: true, tip: '民國紀年', f: (_ms, _tz, w) => `${rocYear(w.y)} ${w.mo} 月 ${w.d} 日` },
  {
    k: 'lunar',
    label: '農曆',
    sans: true,
    tip: '農曆日期（干支年與生肖）。可以改寫成「十月十七」「丙午年正月初一」',
    f: (_ms, _tz, w) => {
      const l = lunarOf(w);
      return l ? `${ganzhi(l.y)}年（${zodiac(l.y)}）${lunarMonthName(l.m, l.leap)}${lunarDayName(l.d)}` : '—';
    },
  },
  {
    k: 'term',
    label: '節氣',
    sans: true,
    tip: '這一刻在哪個節氣的第幾天，以及下一個節氣。可以改寫成「冬至」「清明 第 3 天」',
    f: (ms, tz) => termText(ms, tz),
  },
  {
    k: 'week',
    label: 'ISO 週',
    tip: '年-W週-星期幾（1 = 週一）',
    f: (_ms, _tz, w) => {
      const i = isoWeek(w.y, w.mo, w.d);
      return `${i.weekYear}-W${pad(i.week)}-${i.weekday}`;
    },
  },
  {
    k: 'usweek',
    label: '美式週次',
    tip: '週日開始、含 1 月 1 日的那週是第 1 週（美國、Excel WEEKNUM 的算法）',
    f: (_ms, _tz, w) => `${w.y} 年 W${pad(usWeek(w.y, w.mo, w.d))}`,
  },
  {
    k: 'doy',
    label: '第幾天',
    sans: true,
    tip: '一年中的第幾天、季度與閏年',
    f: (_ms, _tz, w) =>
      `第 ${dayOfYear(w.y, w.mo, w.d)} 天 · Q${Math.ceil(w.mo / 3)} · ${isLeap(w.y) ? '閏年' : `平年（下次閏年 ${nextLeap(w.y)}）`}`,
  },
  {
    k: 'rfc',
    label: 'RFC 2822',
    tip: '電子郵件標頭的格式',
    f: (ms, tz, w) =>
      `${EN_WD[wdOf(w)]}, ${w.d} ${EN_MO[w.mo - 1]} ${w.y} ${fmtTime(w)} ${isoOffset(offsetAt(ms, tz)).replace(':', '')}`,
  },
  { k: 'sql', label: 'SQL', tip: 'DATETIME 字面值（不含時區）', f: (_ms, _tz, w) => `${fmtDate(w)} ${fmtTime(w)}` },
  {
    k: 'excel',
    label: 'Excel',
    tip: 'Excel／Google 試算表的日期序號（當地時間）',
    f: (_ms, _tz, w) => plainNum((wallKey(w) - utcMs(1899, 12, 30)) / DAY, 6),
  },
  {
    k: 'http',
    label: 'HTTP',
    tip: 'HTTP 標頭的 GMT 格式',
    f: (ms) => {
      const u = partsInTz(ms, 'UTC');
      return `${EN_WD[wdOf(u)]}, ${pad(u.d)} ${EN_MO[u.mo - 1]} ${u.y} ${fmtTime(u)} GMT`;
    },
  },
];
/** Every format, in the order set here; formats not in the saved order keep their usual place after it. */
/** 農曆 and 節氣 go with the display setting for them. */
const LUNAR_KEYS = ['lunar', 'term'];
const defs = computed(() => (S.prefs.lunar ? DEFS : DEFS.filter((d) => !LUNAR_KEYS.includes(d.k))));
const ordered = computed(() => {
  const all = defs.value;
  const first = S.readOrder.map((k) => all.find((d) => d.k === k)).filter((d): d is Def => !!d);
  return [...first, ...all.filter((d) => !first.includes(d))];
});
const vals = computed(() => {
  const sMs = startMs.value,
    eMs = endMs.value;
  const sW = partsInTz(sMs, S.startTz),
    eW = eMs != null ? partsInTz(eMs, S.endTz) : null;
  return ordered.value.map((d) => ({
    ...d,
    s: d.f(sMs, S.startTz, sW),
    e: eW && eMs != null ? d.f(eMs, S.endTz, eW) : '',
  }));
});
const isDefault = computed(() => ordered.value.every((d, i) => d === defs.value[i]));

/* ---------- order: drag by the grip ---------- */
let sortSession = 0;
function reorder(from: number, to: number) {
  const keys = moved(
    ordered.value.map((d) => d.k),
    from,
    to,
  );
  commit(
    () => {
      S.readOrder = keys;
    },
    { key: `rd-order-${sortSession}`, hold: true, label: '調整讀法順序' },
  );
}
function sorted(from: number, to: number) {
  const d = ordered.value[to];
  const where = to < shown.value.length ? `第 ${to + 1} 個` : '面板放不下的地方，在「全部寫法」裡';
  toast(`「${d.label}」移到${where}`, undo);
  sortSession++;
}
const body = ref<HTMLElement | null>(null);
const listEl = ref<HTMLElement | null>(null);
const popList = ref<HTMLElement | null>(null);
const panelSort = useDragSort({
  rows: () => [...(listEl.value?.querySelectorAll<HTMLElement>(':scope > .rd-row[data-k]') || [])],
  move: reorder,
  done: sorted,
});
const popSort = useDragSort({
  rows: () => [...(popList.value?.querySelectorAll<HTMLElement>(':scope > .rd-row[data-k]') || [])],
  move: reorder,
  done: sorted,
});
function resetOrder() {
  commit(
    () => {
      S.readOrder = [];
    },
    { label: '讀法恢復預設順序', say: '讀法恢復預設順序' },
  );
}

/** The row whose value was just copied: its label says so. */
const hot = (k: string) => !!copiedKey.value && copiedKey.value.startsWith(`rd-${k}-`);
function copyTable() {
  const head = hasEnd.value ? '格式\t開始\t結束' : '格式\t開始';
  const rows = vals.value.map((r) => [r.label, r.s, ...(hasEnd.value ? [r.e] : [])].join('\t'));
  if (hasEnd.value) rows.unshift(['長度', isoDur.value, ''].join('\t'));
  copyText([head, ...rows].join('\n'), 'rd-table', '表格');
}
const isoDur = computed(() => {
  const c = calGap.value;
  return c ? isoDuration(c, c.sign) : '';
});

const { w: bodyW, h: bodyH } = useSize(body);
const lenH = computed(() => (hasEnd.value ? 2.15 * remPx.value : 0));
const singleCols = computed(() => bodyW.value > 0 && bodyW.value >= 38 * remPx.value);
const singleRowH = computed(() => (singleCols.value || !hasEnd.value ? 2.15 : 2.95) * remPx.value);
const fit1 = computed(() => {
  const room = bodyH.value - lenH.value - 2.3 * remPx.value;
  if (defs.value.length * singleRowH.value <= room) return defs.value.length;
  return Math.max(0, Math.floor(room / singleRowH.value));
});
/** Use a two-column format grid on wide panels when one column would clip rows (or when only one end is shown). */
const grid2 = computed(
  () => bodyW.value >= (hasEnd.value ? 64 : 52) * remPx.value && (fit1.value < defs.value.length || !hasEnd.value),
);
const cellW = computed(() => (grid2.value ? (bodyW.value - 2.2 * remPx.value) / 2 : bodyW.value));
const cols = computed(() => cellW.value > 0 && cellW.value >= 38 * remPx.value);
const rowH = computed(() => (cols.value || !hasEnd.value ? 2.15 : 2.95) * remPx.value);
const fit = computed(() => {
  // the foot (全部寫法 · 複製表格) is always there
  const room = bodyH.value - lenH.value - 2.3 * remPx.value;
  const rowsAvail = Math.max(0, Math.floor(room / rowH.value));
  const cap = grid2.value ? rowsAvail * 2 : rowsAvail;
  return Math.min(defs.value.length, cap);
});
const shown = computed(() => (bodyH.value ? vals.value.slice(0, fit.value) : vals.value.slice(0, 6)));
const rest = computed(() => vals.value.slice(shown.value.length));
/** When every format fits with extra vertical room (full-screen 讀法), let rows breathe and scale type gently. */
const rdRowH = computed(() => {
  if (!bodyH.value || rest.value.length || !shown.value.length) return rowH.value;
  const lines = (hasEnd.value ? 1 : 0) + (grid2.value ? Math.ceil(shown.value.length / 2) : shown.value.length);
  const avail = (bodyH.value - 2.3 * remPx.value) / Math.max(1, lines);
  return Math.max(rowH.value, Math.min(rowH.value * 1.48, avail));
});
const rdScale = computed(() => Math.min(1.22, Math.max(1, 1 + (rdRowH.value / Math.max(1, rowH.value) - 1) * 0.45)));
const moreBtn = ref<HTMLElement | null>(null);
const more = ref(false);
const nowSec = computed(() => String(Math.floor(now.value / 1000)));

/* ---------- typing a reading back, right where it is ---------- */
const SUBJ = { start: '開始', end: '結束' } as const;
const edit = ref<{ k: string; which: End; where: 'panel' | 'pop' } | null>(null);
const editText = ref('');
const editEl = ref<HTMLInputElement | null>(null);
const setEditEl = (el: unknown) => {
  if (el) editEl.value = el as HTMLInputElement;
};
const isEditing = (k: string, which: End, where: 'panel' | 'pop') =>
  !!edit.value && edit.value.k === k && edit.value.which === which && edit.value.where === where;
function startEdit(k: string, which: End, where: 'panel' | 'pop', v: string) {
  S.active = which;
  edit.value = { k, which, where };
  editText.value = v;
  nextTick(() => {
    editEl.value?.focus();
    editEl.value?.select();
  });
}
let skipBlur = false;
function applyEdit() {
  const ed = edit.value;
  if (!ed) return;
  edit.value = null;
  if (skipBlur) {
    skipBlur = false;
    return;
  }
  const cur = wallOf(ed.which);
  const def = DEFS.find((d) => d.k === ed.k)!;
  const r = vals.value.find((x) => x.k === ed.k);
  if (!cur || !r || editText.value.trim() === (ed.which === 'start' ? r.s : r.e)) return;
  const back = parseReading(ed.k, editText.value, {
    now: Date.now(),
    tz: tzOf(ed.which),
    cur,
    parseSpanText: (t) => {
      const x = interpretSpanText(t);
      if (x.kind !== 'span') return null;
      return { sign: x.span.sign, ms: (from) => addDuration(from, tzOf(ed.which), x.span, x.span.sign, x.span.biz).ms };
    },
  });
  if (!back) {
    toast(`看不懂這個${def.label}的寫法`);
    return;
  }
  const n = SUBJ[ed.which];
  const ok = commit(
    () =>
      'live' in back
        ? (setLive(ed.which, true), true)
        : 'ms' in back
          ? setInstant(ed.which, back.ms)
          : setWall(ed.which, back.wall),
    {
      label: `改寫${n}的 ${def.label}`,
      say: () => ('live' in back ? `${n}跟著現在走` : `${n}：${fmtDT(wallOf(ed.which)!)}`),
    },
  );
  if (ok) bump(ed.which);
}
function editKey(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault();
    applyEdit();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    skipBlur = true;
    editEl.value?.blur();
    edit.value = null;
    skipBlur = false;
  }
}
</script>

<template>
  <section class="panel rd" :class="{ cols, grid2, one: !hasEnd }" aria-label="讀法">
    <header class="panel-head">
      <Icon name="list" class="ph-ic" />
      <h2>讀法</h2>
      <span class="rd-how" aria-hidden="true"
        ><span><Icon name="copy" />點值複製</span><span><Icon name="edit" />改寫</span></span
      >
      <span v-if="cols && hasEnd" class="rd-legend" aria-hidden="true"
        ><i class="node" />開始 <i class="node end" />結束</span
      >
      <CopyBtn
        class="rd-now mono"
        :text="nowSec"
        k="rd-now"
        label="現在的 Unix 秒"
        :tip="`現在的 Unix 時間戳（秒），每秒更新。點一下複製`"
        ><i class="dot" aria-hidden="true" /><em>現在</em>{{ nowSec }}</CopyBtn
      >
    </header>
    <div ref="body" class="rd-body" :style="{ '--rd-rh': rdRowH + 'px', '--rd-s': rdScale }">
      <div v-if="hasEnd" class="rd-row len" :class="{ hot: copiedKey === 'rd-dur' }">
        <span class="rd-k" v-tip="'ISO 8601 的長度寫法'">{{ copiedKey === 'rd-dur' ? '已複製' : '長度' }}</span>
        <span class="rd-v"><CopyBtn class="mono" :text="isoDur" k="rd-dur" label="ISO 長度" /></span>
      </div>
      <div ref="listEl" class="rd-list">
        <div
          v-for="(r, i) in shown"
          :key="r.k"
          class="rd-row"
          :data-k="r.k"
          :class="{ hot: hot(r.k), lifted: panelSort.dragging.value === i }"
        >
          <span class="rd-k">
            <button
              type="button"
              class="rd-grip"
              :aria-label="`拖曳或按 ↑↓ 調整「${r.label}」的位置`"
              v-tip="'拖曳調整順序；也可以按 ↑↓'"
              @pointerdown="panelSort.down($event, i)"
              @pointermove="panelSort.move"
              @pointerup="panelSort.up"
              @pointercancel="panelSort.up"
              @keydown="panelSort.key($event, i)"
            >
              <Icon name="grip" />
            </button>
            <span class="rd-kl" v-tip="r.tip">{{ hot(r.k) ? '已複製' : r.label }}</span>
          </span>
          <span class="rd-v"
            ><i v-if="hasEnd && !cols" class="node" aria-hidden="true" />
            <input
              v-if="isEditing(r.k, 'start', 'panel')"
              :ref="setEditEl"
              v-model="editText"
              class="rd-in"
              :class="r.sans ? 'tnum' : 'mono'"
              :aria-label="`開始的 ${r.label}`"
              spellcheck="false"
              autocomplete="off"
              @keydown="editKey"
              @blur="applyEdit"
            />
            <template v-else
              ><CopyBtn
                :class="r.sans ? 'tnum' : 'mono'"
                :text="r.s"
                :k="`rd-${r.k}-s`"
                :label="`開始 ${r.label}`" /><button
                type="button"
                class="rd-edit"
                v-tip="`改寫開始的 ${r.label}`"
                :aria-label="`改寫開始的 ${r.label}`"
                @click="startEdit(r.k, 'start', 'panel', r.s)"
              >
                <Icon name="edit" /></button
            ></template>
          </span>
          <span v-if="hasEnd" class="rd-v"
            ><i v-if="!cols" class="node end" aria-hidden="true" />
            <input
              v-if="isEditing(r.k, 'end', 'panel')"
              :ref="setEditEl"
              v-model="editText"
              class="rd-in"
              :class="r.sans ? 'tnum' : 'mono'"
              :aria-label="`結束的 ${r.label}`"
              spellcheck="false"
              autocomplete="off"
              @keydown="editKey"
              @blur="applyEdit"
            />
            <template v-else
              ><CopyBtn
                :class="r.sans ? 'tnum' : 'mono'"
                :text="r.e"
                :k="`rd-${r.k}-e`"
                :label="`結束 ${r.label}`" /><button
                type="button"
                class="rd-edit"
                v-tip="`改寫結束的 ${r.label}`"
                :aria-label="`改寫結束的 ${r.label}`"
                @click="startEdit(r.k, 'end', 'panel', r.e)"
              >
                <Icon name="edit" /></button
            ></template>
          </span>
        </div>
      </div>
      <div class="rd-foot">
        <button
          ref="moreBtn"
          type="button"
          class="rd-more"
          :aria-expanded="more"
          v-tip="'全部的寫法：拖曳排序，拖到線上面就會顯示在這裡'"
          @click="more = !more"
        >
          <span v-if="rest.length" class="ell"
            >另外 {{ rest.length }} 種：{{ rest.map((r) => r.label).join('、') }}</span
          ><span v-else class="ell">全部寫法・排序</span><Icon name="chevD" />
        </button>
        <button
          type="button"
          class="rd-table"
          :class="{ ok: copiedKey === 'rd-table' }"
          v-tip="'把所有寫法複製成表格（Tab 分隔，可以直接貼進試算表）'"
          @click="copyTable"
        >
          <Icon :name="copiedKey === 'rd-table' ? 'check' : 'copy'" />{{
            copiedKey === 'rd-table' ? '已複製' : '複製表格'
          }}
        </button>
      </div>
    </div>
    <Popover :open="more" :anchor="moreBtn" label="全部寫法" width="30rem" @close="more = false">
      <div class="rd-pop" :class="{ one: !hasEnd }">
        <p class="rd-pop-how">
          <Icon name="grip" />拖曳排序，線上面的會顯示在面板　<Icon name="copy" />點值複製　<Icon name="edit" />改寫
        </p>
        <div ref="popList" class="rd-pop-list">
          <template v-for="(r, i) in vals" :key="r.k">
            <div v-if="i === shown.length && rest.length" class="rd-cut" aria-hidden="true">
              <span>以上顯示在面板</span>
            </div>
            <div
              class="rd-row"
              :data-k="r.k"
              :class="{ hot: hot(r.k), lifted: popSort.dragging.value === i, off: i >= shown.length }"
            >
              <span class="rd-k">
                <button
                  type="button"
                  class="rd-grip"
                  :aria-label="`拖曳或按 ↑↓ 調整「${r.label}」的位置`"
                  @pointerdown="popSort.down($event, i)"
                  @pointermove="popSort.move"
                  @pointerup="popSort.up"
                  @pointercancel="popSort.up"
                  @keydown="popSort.key($event, i)"
                >
                  <Icon name="grip" />
                </button>
                <span class="rd-kl">{{ hot(r.k) ? '已複製' : r.label }}</span>
              </span>
              <span class="rd-v"
                ><i v-if="hasEnd" class="node" aria-hidden="true" />
                <input
                  v-if="isEditing(r.k, 'start', 'pop')"
                  :ref="setEditEl"
                  v-model="editText"
                  class="rd-in"
                  :class="r.sans ? 'tnum' : 'mono'"
                  :aria-label="`開始的 ${r.label}`"
                  spellcheck="false"
                  autocomplete="off"
                  @keydown="editKey"
                  @blur="applyEdit"
                />
                <template v-else
                  ><CopyBtn
                    :class="r.sans ? 'tnum' : 'mono'"
                    :text="r.s"
                    :k="`rd-${r.k}-s`"
                    :label="`開始 ${r.label}`" /><button
                    type="button"
                    class="rd-edit"
                    :aria-label="`改寫開始的 ${r.label}`"
                    @click="startEdit(r.k, 'start', 'pop', r.s)"
                  >
                    <Icon name="edit" /></button
                ></template>
              </span>
              <span v-if="hasEnd" class="rd-v"
                ><i class="node end" aria-hidden="true" />
                <input
                  v-if="isEditing(r.k, 'end', 'pop')"
                  :ref="setEditEl"
                  v-model="editText"
                  class="rd-in"
                  :class="r.sans ? 'tnum' : 'mono'"
                  :aria-label="`結束的 ${r.label}`"
                  spellcheck="false"
                  autocomplete="off"
                  @keydown="editKey"
                  @blur="applyEdit"
                />
                <template v-else
                  ><CopyBtn
                    :class="r.sans ? 'tnum' : 'mono'"
                    :text="r.e"
                    :k="`rd-${r.k}-e`"
                    :label="`結束 ${r.label}`" /><button
                    type="button"
                    class="rd-edit"
                    :aria-label="`改寫結束的 ${r.label}`"
                    @click="startEdit(r.k, 'end', 'pop', r.e)"
                  >
                    <Icon name="edit" /></button
                ></template>
              </span>
            </div>
          </template>
        </div>
        <button v-if="!isDefault" type="button" class="rd-reset" @click="resetOrder">恢復預設順序</button>
      </div>
    </Popover>
  </section>
</template>

<style scoped>
.ph-ic {
  color: var(--ink-3);
}
.rd-legend {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-size: var(--fs-xs);
  color: var(--ink-3);
  flex: none;
}
.rd-legend .node {
  font-size: 0.7rem;
  margin-left: 0.35rem;
}
.rd-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 0.35rem 1rem 0.7rem;
  overflow: hidden;
}
.rd-list {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.grid2 .rd-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  column-gap: 2.2rem;
}
.rd-row {
  display: grid;
  grid-template-columns: calc(5.9rem * var(--rd-s, 1)) minmax(0, 1fr);
  grid-auto-rows: auto;
  column-gap: 0.6rem;
  align-items: center;
  padding: 0.3rem 0;
  border-top: 1px solid var(--hair);
  min-height: var(--rd-rh, 2.15rem);
  flex: none;
}
.rd-body > .rd-row:first-child,
.one .rd-list > .rd-row:first-child,
.one.grid2 .rd-list > .rd-row:nth-child(2) {
  border-top: 0;
}
.rd-row .rd-v + .rd-v {
  grid-column: 2;
}
.cols .rd-row {
  grid-template-columns: calc(6.2rem * var(--rd-s, 1)) minmax(0, 1fr) minmax(0, 1fr);
}
.cols .rd-row .rd-v + .rd-v {
  grid-column: 3;
}
.rd-row.len .rd-v + .rd-v {
  grid-column: auto;
}
.rd-row.len {
  grid-template-columns: calc(5.9rem * var(--rd-s, 1)) minmax(0, 1fr) auto;
  min-height: max(2.15rem, calc(var(--rd-rh, 2.15rem) * 0.85));
}
.cols .rd-row.len {
  grid-template-columns: calc(6.2rem * var(--rd-s, 1)) minmax(0, 1fr) minmax(0, 1fr);
}
.rd-k {
  grid-row: span 2;
  display: flex;
  align-items: center;
  gap: 0.1rem;
  min-width: 0;
  font-size: calc(var(--fs-s) * var(--rd-s, 1));
  font-weight: 600;
  color: var(--ink-3);
  white-space: nowrap;
  align-self: center;
}
.len .rd-k {
  padding-left: 1.45rem;
  cursor: help;
}
.rd-kl {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: help;
}
.one .rd-k,
.cols .rd-k,
.len .rd-k {
  grid-row: auto;
}
.rd-v {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  min-width: 0;
  line-height: 1.35;
}
.rd-v .node {
  font-size: var(--fs-xs);
  flex: none;
}
.rd-v :deep(.copy) {
  font-size: max(var(--floor), calc(0.82rem * var(--rd-s, 1)));
  color: var(--ink);
}
.len .rd-v :deep(.copy) {
  color: var(--accent);
}
/* the grip: always there, quiet until the row is under the pointer */
.rd-grip {
  flex: none;
  display: grid;
  place-items: center;
  width: 1.35rem;
  height: 1.7rem;
  margin-left: -0.3rem;
  border-radius: 0.4rem;
  color: var(--ink-4);
  cursor: grab;
  touch-action: none;
}
.rd-grip .ic {
  width: 1.05em;
  height: 1.05em;
  stroke-width: 3.2;
}
.rd-grip:hover,
.rd-grip:focus-visible {
  color: var(--accent);
  background: var(--accent-wash);
}
.rd-row.lifted {
  position: relative;
  z-index: 3;
  background: var(--surface-2);
  box-shadow: 0 6px 18px -8px rgba(11, 18, 34, 0.35);
  border-radius: 0.6rem;
}
.rd-row.lifted .rd-grip {
  cursor: grabbing;
  color: var(--accent);
}
.rd-row.sorting {
  transition: none;
}
.rd-in {
  flex: 1;
  min-width: 0;
  height: 1.75rem;
  padding: 0 0.4rem;
  margin: -0.2rem 0;
  border-radius: 0.45rem;
  border: 1.5px solid var(--accent);
  background: var(--surface-2);
  color: var(--ink);
  font-size: max(var(--floor), 0.82rem);
  box-shadow: 0 0 0 3px var(--accent-wash-2);
}
.rd-foot {
  flex: none;
  display: flex;
  align-items: center;
  gap: 0.4rem;
  height: 2.2rem;
  margin-top: auto;
  padding-top: 0.15rem;
}
.rd-more {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 0.3rem;
  height: 2rem;
  margin-left: -0.55rem;
  padding: 0 0.55rem;
  border-radius: 0.6rem;
  font-size: max(var(--floor), 0.84rem);
  color: var(--ink-2);
  white-space: nowrap;
  overflow: hidden;
  text-align: left;
}
.rd-more .ell {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.rd-more:hover {
  background: var(--accent-wash);
  color: var(--accent);
}
.rd-table {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  height: 1.9rem;
  padding: 0 0.6rem;
  border-radius: 0.6rem;
  border: 1px solid var(--hair-2);
  font-size: var(--fs-xs);
  font-weight: 600;
  color: var(--ink-2);
  white-space: nowrap;
}
.rd-table .ic {
  width: 1em;
  height: 1em;
}
.rd-table:hover {
  background: var(--accent-wash);
  border-color: var(--accent-line);
  color: var(--accent);
}
.rd-table.ok {
  color: var(--good);
  border-color: var(--good);
  background: var(--good-wash);
}
/* how the rows work, said once where they are */
.rd-how {
  display: inline-flex;
  align-items: center;
  gap: 0.65rem;
  min-width: 0;
  overflow: hidden;
  font-size: var(--fs-xs);
  color: var(--ink-3);
  white-space: nowrap;
}
.rd-how > span {
  display: inline-flex;
  align-items: center;
  gap: 0.22rem;
}
.rd-how .ic {
  width: 1.05em;
  height: 1.05em;
  color: var(--accent);
  opacity: 0.8;
}
.rd-now em {
  font-style: normal;
  font-family: var(--f-sans);
  margin-right: 0.35em;
  color: var(--ink-3);
}
/* a row that was just copied */
.rd-row.hot .rd-kl {
  color: var(--good) !important;
}
.rd-row :deep(.copy.copied) {
  color: var(--good) !important;
  background: var(--good-wash);
}
.rd-pop-how {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.25rem;
  margin-bottom: 0.35rem;
  font-size: var(--fs-xs);
  color: var(--ink-3);
}
.rd-pop-how .ic {
  width: 1.05em;
  height: 1.05em;
  color: var(--accent);
}
.rd-pop-list {
  display: flex;
  flex-direction: column;
}
.rd-pop .rd-row {
  grid-template-columns: 5.9rem minmax(0, 1fr);
}
.rd-pop .rd-row .rd-v + .rd-v {
  grid-column: 2;
}
.rd-pop .rd-row.off .rd-kl {
  color: var(--ink-4);
}
/* the line where the panel's room ends */
.rd-cut {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0.25rem 0;
  font-size: var(--fs-xs);
  font-weight: 600;
  color: var(--accent);
}
.rd-cut::before,
.rd-cut::after {
  content: '';
  flex: 1;
  height: 0;
  border-top: 1.5px dashed var(--accent-line);
}
.rd-cut + .rd-row {
  border-top: 0;
}
.rd-reset {
  margin-top: 0.5rem;
  font-size: var(--fs-xs);
  color: var(--ink-3);
  text-decoration: underline;
  text-underline-offset: 2px;
}
.rd-reset:hover {
  color: var(--accent);
}
.rd-pop {
  padding: 0.5rem 1rem 0.6rem;
}
.rd-now {
  flex: none;
  font-size: var(--fs-xs);
  color: var(--ink-2);
  padding: 0.2rem 0.45rem !important;
  margin: 0 !important;
  border-radius: 0.55rem;
  background: var(--now-wash);
}
.rd-now .dot {
  display: inline-block;
  width: 0.45em;
  height: 0.45em;
  margin-right: 0.4em;
  border-radius: 50%;
  background: var(--now);
  vertical-align: 0.12em;
}
.rd-edit {
  flex: none;
  display: grid;
  place-items: center;
  width: 1.5rem;
  height: 1.4rem;
  margin: -0.3rem 0;
  border-radius: 0.45rem;
  color: var(--ink-3);
  opacity: 0.75;
  transition:
    background 0.15s,
    color 0.15s,
    opacity 0.15s;
}
.rd-edit .ic {
  width: 0.95em;
  height: 0.95em;
}
.rd-edit:hover {
  opacity: 1;
  color: var(--accent);
  background: var(--accent-wash);
}
/* the row under the pointer lights up as a whole, so it is clear which pair of values belongs to which label */
@media (hover: hover) {
  .rd-body > .rd-row:hover,
  .rd-list > .rd-row:hover,
  .rd-pop .rd-row:hover {
    background: color-mix(in srgb, var(--accent) 4.5%, transparent);
  }
  .rd-row:hover .rd-kl {
    color: var(--ink-2) !important;
  }
  .rd-row:hover .rd-grip {
    color: var(--ink-3);
  }
}
.rd-body > .rd-row,
.rd-list > .rd-row,
.rd-pop .rd-row {
  margin: 0 -0.5rem;
  padding-left: 0.5rem;
  padding-right: 0.5rem;
  border-radius: 0.55rem;
}
/* fingers need more than the drawn size */
@media (pointer: coarse) {
  .rd-grip {
    width: 1.9rem;
    height: 2.1rem;
  }
  .rd-edit {
    width: 2rem;
    height: 2rem;
    margin: -0.4rem 0;
  }
}
</style>
