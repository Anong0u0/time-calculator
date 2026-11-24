<script setup lang="ts">
/* Building a rule from blocks: a starting point, then steps, each showing where it lands.
   Click a block to change it, drag it to reorder (drag it off the row to remove it), add steps from the palette.
   Nothing needs typing; the text box at the top reads words into blocks for those who like to type. */
import { ref, computed, watch, nextTick } from 'vue';
import Icon from './Icon.vue';
import NumDial from './NumDial.vue';
import {
  type Rule, type Step, type Origin, type Cond, type Scope, type Unit, type Period, type Pos,
  UNITS, PERIODS, POS, PERIOD_NAME, POS_NAME, stepName, originName, condName, ruleName,
} from '../core/rule';
import { parseRuleText } from '../core/ruletext';
import { vocab, KIND_NAME, type WordKind } from '../core/vocab';
import { LUNAR_MONTHS, LUNAR_DAYS } from '../core/lunar';
import { TERM_NAMES, TERMS_IN_YEAR } from '../core/terms';
import { S, type End, runRule, tzOf, ruleTick } from '../state/store';
import { parseOptsFor } from '../state/command';
import { partsInTz, WD, wdOf, pad, validWall } from '../core/time';

const props = withDefaults(defineProps<{ modelValue: Rule; self: End; allowOther?: boolean; text?: boolean }>(), { allowOther: true, text: true });
const emit = defineEmits<{ 'update:modelValue': [Rule]; name: [string] }>();
const rule = computed(() => props.modelValue);
const clone = (r: Rule): Rule => JSON.parse(JSON.stringify(r));
function set(fn: (r: Rule) => void) { const r = clone(rule.value); fn(r); emit('update:modelValue', r); }

/* ---------- where each block lands ---------- */
const run = computed(() => { void ruleTick.value; return runRule(rule.value, props.self); });
const errAt = computed(() => (run.value.ok ? null : run.value.at));
function landed(i: number): string {
  const t = run.value.trace[i + 1];
  if (!t) return i === errAt.value ? '無法計算' : '';
  const w = partsInTz(t.ms, tzOf(props.self));
  const time = w.h || w.mi || w.s ? ` ${pad(w.h)}:${pad(w.mi)}` : '';
  return `${w.y !== partsInTz(Date.now(), tzOf(props.self)).y ? w.y + '/' : ''}${w.mo}/${w.d}（${WD[wdOf(w)]}）${time}`;
}
const result = computed(() => (run.value.ok ? landed(rule.value.steps.length - 1) : run.value.err));

/* ---------- the block being changed ---------- */
const sel = ref<number | null>(null);
watch(() => rule.value.steps.length, (n, o) => { if (sel.value != null && sel.value >= n) sel.value = n ? n - 1 : null; if (n > (o ?? 0)) sel.value = n - 1; });
const cur = computed<Step | null>(() => (sel.value != null && sel.value >= 0 ? rule.value.steps[sel.value] ?? null : null));
function setStep(fn: (s: Step) => Step) { const i = sel.value; if (i == null || i < 0) return; set((r) => { r.steps[i] = fn(r.steps[i]); }); }
function removeAt(i: number) { set((r) => { r.steps.splice(i, 1); }); sel.value = null; }
function shiftAt(i: number, d: number) {
  const j = i + d;
  if (j < 0 || j >= rule.value.steps.length) return;
  set((r) => { const [x] = r.steps.splice(i, 1); r.steps.splice(j, 0, x); });
  sel.value = j;
}

/* ---------- the starting point ---------- */
const ORIGINS: [Origin['t'], string][] = [['now', '現在'], ['start', '開始'], ['end', '結束'], ['other', '另一端'], ['date', '某個時刻']];
const origins = computed(() => ORIGINS.filter(([t]) => (t === 'other' ? props.allowOther : t !== props.self)));
function setOrigin(t: Origin['t']) {
  set((r) => {
    if (t === 'date') { const w = partsInTz(Date.now(), tzOf(props.self)); r.o = { t: 'date', w: { ...w, h: 0, mi: 0, s: 0 } }; }
    else r.o = { t } as Origin;
  });
}
const dateVal = computed(() => {
  const o = rule.value.o;
  const w = o.t === 'date' ? o.w : o.t === 'at' ? partsInTz(o.ms, tzOf(props.self)) : null;
  return w ? `${pad(w.y, 4)}-${pad(w.mo)}-${pad(w.d)}T${pad(w.h)}:${pad(w.mi)}` : '';
});
function setDate(v: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v);
  if (!m) return;
  const w = { y: +m[1], mo: +m[2], d: +m[3], h: +m[4], mi: +m[5], s: 0 };
  if (validWall(w)) set((r) => { r.o = { t: 'date', w }; });
}

/* ---------- a step's settings ---------- */
const U_SHORT: Record<Unit, string> = { s: '秒', mi: '分', h: '時', d: '天', bd: '工作日', w: '週', mo: '月', q: '季', y: '年', lmo: '農曆月', ly: '農曆年', term: '節氣' };
const SCOPES: [Scope, string][] = [['next', '下一個'], ['prev', '上一個'], ['w', '這週'], ['mo', '這個月'], ['q', '這一季'], ['y', '這一年'], ['lmo', '這個農曆月'], ['ly', '這個農曆年']];
/* 農曆 and 節氣 are offered only while the display setting for them is on; a block already using one keeps showing it. */
const LUNAR_KINDS: WordKind[] = ['lunar', 'term'];
const LUNAR_UNITS: string[] = ['lmo', 'ly', 'term'];
const units = computed(() => UNITS.filter((u) => S.prefs.lunar || !LUNAR_UNITS.includes(u) || (cur.value?.t === 'move' && cur.value.u === u)));
const periods = computed(() => PERIODS.filter((p) => S.prefs.lunar || !LUNAR_UNITS.includes(p) || (cur.value?.t === 'align' && cur.value.p === p)));
const scopes = computed(() => SCOPES.filter(([sc]) => S.prefs.lunar || !LUNAR_UNITS.includes(sc) || ((cur.value?.t === 'pick' || cur.value?.t === 'word') && cur.value.in === sc)));
const ctabs = computed(() => CTABS.filter(([k]) => S.prefs.lunar || !['lmo', 'ld', 'term'].includes(k) || (cur.value?.t === 'pick' && cur.value.c[k] != null)));
const common = computed(() => (S.prefs.lunar ? COMMON : COMMON.filter(([, st]) => !st.some((x) => x.t === 'pick' && x.c.term != null))));
const toward = (n: number, sgn: number) => sgn * Math.max(1, Math.abs(n));
function setCond(k: keyof Cond, v: number | boolean | undefined) {
  setStep((s) => {
    if (s.t !== 'pick') return s;
    const c = { ...s.c } as Record<string, unknown>;
    if (v == null || v === false) delete c[k]; else c[k] = v;
    return { ...s, c: c as Cond };
  });
}
const condTab = ref<keyof Cond>('wd');
watch(sel, () => {
  const s = cur.value;
  if (s?.t === 'pick') condTab.value = (['term', 'lmo', 'ld', 'nth', 'wd', 'd', 'mo'] as (keyof Cond)[]).find((k) => s.c[k] != null) || 'wd';
});
const CTABS: [keyof Cond, string][] = [['mo', '月'], ['d', '日'], ['wd', '星期'], ['nth', '第幾個星期'], ['lmo', '農曆月'], ['ld', '農曆日'], ['term', '節氣']];
const condVal = (k: keyof Cond) => {
  const s = cur.value;
  if (s?.t !== 'pick') return '';
  const v = s.c[k];
  if (v == null) return '不限';
  if (k === 'mo') return `${v}月`;
  if (k === 'd') return v === -1 ? '最後一天' : `${v}號`;
  if (k === 'wd') return `週${WD[v as number]}`;
  if (k === 'nth') return v === -1 ? '最後一個' : `第${v}個`;
  if (k === 'lmo') return (s.c.leap ? '閏' : '') + LUNAR_MONTHS[(v as number) - 1];
  if (k === 'ld') return v === -1 ? '最後一天' : LUNAR_DAYS[(v as number) - 1];
  if (k === 'term') return (v as number) >= 0 ? TERM_NAMES[v as number] : '任何節氣';
  return String(v);
};
const timeOf = computed(() => (cur.value?.t === 'time' ? cur.value : { h: 0, mi: 0, s: 0 }));
function setTime(k: 'h' | 'mi' | 's', v: number) { setStep((s) => (s.t === 'time' ? { ...s, [k]: v } : s)); }

/* ---------- the palette: steps to add ---------- */
const addOpen = ref(false);
type Preset = [string, Step[]];
const COMMON: Preset[] = [
  ['明天', [{ t: 'move', n: 1, u: 'd' }, { t: 'align', p: 'd', pos: 'start' }]], ['下週', [{ t: 'move', n: 1, u: 'w' }]], ['下個月', [{ t: 'move', n: 1, u: 'mo' }]], ['明年', [{ t: 'move', n: 1, u: 'y' }]],
  ['往後 3 天', [{ t: 'move', n: 3, u: 'd' }]], ['往前 1 天', [{ t: 'move', n: -1, u: 'd' }]],
  ['當天 0:00', [{ t: 'align', p: 'd', pos: 'start' }]], ['當天結束', [{ t: 'align', p: 'd', pos: 'end' }]], ['月初', [{ t: 'align', p: 'mo', pos: 'start' }]], ['月底', [{ t: 'align', p: 'mo', pos: 'last' }]],
  ['月結束', [{ t: 'align', p: 'mo', pos: 'end' }]], ['年底', [{ t: 'align', p: 'y', pos: 'last' }]], ['年結束', [{ t: 'align', p: 'y', pos: 'end' }]],
  ['這週的週五', [{ t: 'pick', c: { wd: 5 }, in: 'w' }]], ['下一個週五', [{ t: 'pick', c: { wd: 5 }, in: 'next' }]], ['這個月的 15 號', [{ t: 'pick', c: { d: 15 }, in: 'mo' }]],
  ['下一個節氣', [{ t: 'pick', c: { term: -1 }, in: 'next', exact: true }]], ['18:00', [{ t: 'time', h: 18, mi: 0, s: 0 }]],
];
const BLANK: Preset[] = [
  ['移動', [{ t: 'move', n: 1, u: 'd' }]], ['對齊期間', [{ t: 'align', p: 'mo', pos: 'start' }]], ['挑一天', [{ t: 'pick', c: { wd: 1 }, in: 'next' }]],
  ['時刻', [{ t: 'time', h: 9, mi: 0, s: 0 }]],
];
const words = computed(() => {
  void ruleTick.value;
  const g = new Map<WordKind, string[]>();
  for (const w of vocab()) { if (!g.has(w.kind)) g.set(w.kind, []); g.get(w.kind)!.push(w.name); }
  const curW = cur.value?.t === 'word' ? cur.value.w : null;
  return [...g.entries()].filter(([k, list]) => S.prefs.lunar || !LUNAR_KINDS.includes(k) || (curW != null && list.includes(curW)));
});
function add(steps: Step[]) {
  set((r) => { const at = sel.value != null && sel.value >= 0 ? sel.value + 1 : r.steps.length; r.steps.splice(at, 0, ...JSON.parse(JSON.stringify(steps))); });
  nextTick(() => { sel.value = (sel.value != null && sel.value >= 0 ? sel.value + steps.length : rule.value.steps.length - 1); });
  addOpen.value = false;
}
const addWord = (w: string) => add([{ t: 'word', w }]);

/* ---------- typing, for those who like it ---------- */
const typed = ref('');
const typedAlts = ref<Rule[]>([]);
function readTyped() {
  const t = typed.value.trim();
  if (!t) return;
  const r = parseRuleText(t, parseOptsFor(props.self));
  if (!r) { typedErr.value = '看不懂，試試 明晚、下個月底、中秋晚上8點'; return; }
  typedErr.value = '';
  emit('update:modelValue', r.main.rule);
  emit('name', t);
  typedAlts.value = r.alts.map((a) => a.rule);
  sel.value = null;
}
const typedErr = ref('');

/* ---------- drag a block: along the row to reorder, off the row to remove ---------- */
const chain = ref<HTMLElement | null>(null);
const drag = ref<{ i: number; x0: number; y0: number; dx: number; dy: number; to: number; off: boolean; id: number } | null>(null);
function bDown(i: number, e: PointerEvent) {
  if (e.button > 0) return;
  drag.value = { i, x0: e.clientX, y0: e.clientY, dx: 0, dy: 0, to: i, off: false, id: e.pointerId };
}
function bMove(e: PointerEvent) {
  const d = drag.value;
  if (!d || e.pointerId !== d.id) return;
  d.dx = e.clientX - d.x0; d.dy = e.clientY - d.y0;
  if (Math.hypot(d.dx, d.dy) < 6) return;
  try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* fine */ }
  const box = chain.value?.getBoundingClientRect();
  d.off = !!box && (e.clientY < box.top - 36 || e.clientY > box.bottom + 36);
  const blocks = [...(chain.value?.querySelectorAll<HTMLElement>('.rb-blk[data-i]') || [])];
  let best = d.i, bd = Infinity;
  blocks.forEach((el) => { const r = el.getBoundingClientRect(); const dist = Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2)); if (dist < bd) { bd = dist; best = +el.dataset.i!; } });
  d.to = best;
}
function bUp(e: PointerEvent) {
  const d = drag.value;
  if (!d || e.pointerId !== d.id) return;
  drag.value = null;
  if (Math.hypot(d.dx, d.dy) < 6) { sel.value = d.i; return; }
  if (d.off) { removeAt(d.i); return; }
  if (d.to !== d.i) { set((r) => { const [x] = r.steps.splice(d.i, 1); r.steps.splice(d.to, 0, x); }); sel.value = d.to; }
}
const name = computed(() => ruleName(rule.value, S.prefs));
defineExpose({ name });
</script>

<template>
  <div class="rb">
    <label v-if="text" class="rb-type">
      <Icon name="search" />
      <input v-model="typed" type="text" spellcheck="false" autocomplete="off" placeholder="也可以用打的：明晚、下個月底、中秋晚上8點…" aria-label="用文字寫規則" @keydown.enter.prevent="readTyped" @blur="readTyped" />
    </label>
    <p v-if="typedErr" class="rb-err">{{ typedErr }}</p>
    <div v-if="typedAlts.length" class="rb-alts"><span>另一種讀法：</span><button v-for="(a, i) in typedAlts" :key="i" type="button" class="chip sm" @click="emit('update:modelValue', a); typedAlts = []">{{ ruleName(a, S.prefs) }}</button></div>

    <div ref="chain" class="rb-chain" role="list" aria-label="規則的積木">
      <button type="button" class="rb-blk origin" :class="{ on: sel === -1 }" role="listitem" :aria-label="`起點：${originName(rule.o)}，點一下修改`" @click="sel = sel === -1 ? null : -1">
        <span class="rb-k">從</span><b>{{ originName(rule.o) }}</b><small>{{ run.trace[0] ? landed(-1) : '' }}</small>
      </button>
      <template v-for="(st, i) in rule.steps" :key="i">
        <Icon name="chevR" class="rb-arrow" />
        <button type="button" class="rb-blk" role="listitem" :data-i="i" :class="{ on: sel === i, err: errAt === i, dragging: drag?.i === i && (Math.abs(drag.dx) > 5 || Math.abs(drag.dy) > 5), off: drag?.i === i && drag.off, target: drag && drag.to === i && drag.i !== i }"
          :style="drag?.i === i ? { transform: `translate(${drag.dx}px, ${drag.dy}px)` } : undefined" :aria-label="`${stepName(st, S.prefs)}，點一下修改，拖曳可以換位置`"
          @pointerdown="bDown(i, $event)" @pointermove="bMove" @pointerup="bUp" @pointercancel="drag = null" @keydown.delete.prevent="removeAt(i)">
          <b>{{ stepName(st, S.prefs) }}</b><small>{{ landed(i) }}</small>
        </button>
      </template>
      <button type="button" class="rb-add" :aria-expanded="addOpen" @click="addOpen = !addOpen"><Icon name="plus" />加一步</button>
    </div>
    <p v-if="drag && drag.off" class="rb-hint">放開就移除這一步</p>

    <div v-if="addOpen" class="rb-pal">
      <div class="rb-pal-g"><span class="rb-pal-k">常用</span><button v-for="[n, st] in common" :key="n" type="button" class="chip sm" @click="add(st)">{{ n }}</button></div>
      <div class="rb-pal-g"><span class="rb-pal-k">空白積木</span><button v-for="[n, st] in BLANK" :key="n" type="button" class="chip sm blank" @click="add(st)">{{ n }}</button></div>
      <div v-for="[k, list] in words" :key="k" class="rb-pal-g"><span class="rb-pal-k">{{ KIND_NAME[k] }}</span><button v-for="w in list" :key="w" type="button" class="chip sm" @click="addWord(w)">{{ w }}</button></div>
    </div>

    <!-- the starting point -->
    <div v-if="sel === -1" class="rb-insp">
      <div class="rb-row"><span class="rb-l">起點</span><div class="seg-ctl"><button v-for="[t, n] in origins" :key="t" type="button" :aria-pressed="rule.o.t === t || (t === 'date' && rule.o.t === 'at')" @click="setOrigin(t)">{{ n }}</button></div></div>
      <div v-if="rule.o.t === 'date' || rule.o.t === 'at'" class="rb-row"><span class="rb-l">時刻</span><input class="rb-date" type="datetime-local" :value="dateVal" aria-label="起點的日期與時刻" @change="setDate(($event.target as HTMLInputElement).value)" /></div>
      <p class="rb-note">「另一端」放在開始就是結束、放在結束就是開始，所以同一個快捷兩端都能用。</p>
    </div>

    <!-- a step -->
    <div v-else-if="cur" class="rb-insp">
      <template v-if="cur.t === 'move'">
        <div class="rb-row"><span class="rb-l">方向</span><div class="seg-ctl">
          <button type="button" :aria-pressed="cur.n >= 0" @click="setStep((s) => (s.t === 'move' ? { ...s, n: toward(s.n, 1) } : s))">往後</button>
          <button type="button" :aria-pressed="cur.n < 0" @click="setStep((s) => (s.t === 'move' ? { ...s, n: toward(s.n, -1) } : s))">往前</button>
        </div><NumDial :model-value="Math.abs(cur.n)" :min="0" :max="99999" label="多少" @update:model-value="(v) => setStep((s) => (s.t === 'move' ? { ...s, n: (s.n < 0 ? -1 : 1) * v } : s))" /></div>
        <div class="rb-row wrap"><span class="rb-l">單位</span><button v-for="u in units" :key="u" type="button" class="chip sm" :aria-pressed="cur.u === u" @click="setStep((s) => (s.t === 'move' ? { ...s, u } : s))">{{ U_SHORT[u] }}</button></div>
      </template>
      <template v-else-if="cur.t === 'align'">
        <div class="rb-row wrap"><span class="rb-l">期間</span><button v-for="p in periods" :key="p" type="button" class="chip sm" :aria-pressed="cur.p === p" @click="setStep((s) => (s.t === 'align' ? { ...s, p: p as Period } : s))">{{ PERIOD_NAME[p] }}</button></div>
        <div class="rb-row wrap"><span class="rb-l">位置</span><button v-for="p in POS" :key="p" type="button" class="chip sm" :aria-pressed="cur.pos === p" @click="setStep((s) => (s.t === 'align' ? { ...s, pos: p as Pos } : s))">{{ POS_NAME[p] }}</button></div>
      </template>
      <template v-else-if="cur.t === 'pick'">
        <div class="rb-row wrap"><span class="rb-l">在哪裡找</span><button v-for="[sc, n] in scopes" :key="sc" type="button" class="chip sm" :aria-pressed="cur.in === sc" @click="setStep((s) => (s.t === 'pick' ? { ...s, in: sc } : s))">{{ n }}</button></div>
        <div class="rb-row">
          <span class="rb-l">第幾個</span>
          <NumDial :model-value="Math.abs(cur.k ?? 1)" :min="1" :max="60" label="第幾個" @update:model-value="(v) => setStep((s) => (s.t === 'pick' ? { ...s, k: (s.k ?? 1) < 0 ? -v : v } : s))" />
          <button v-if="cur.in !== 'next' && cur.in !== 'prev'" type="button" class="chip sm" :aria-pressed="(cur.k ?? 1) < 0" @click="setStep((s) => (s.t === 'pick' ? { ...s, k: -(s.k ?? 1) } : s))">從後面數</button>
          <button v-else type="button" class="chip sm" :aria-pressed="!!cur.incl" @click="setStep((s) => (s.t === 'pick' ? { ...s, incl: !s.incl } : s))">今天也算</button>
          <button v-if="cur.c.term != null" type="button" class="chip sm" :aria-pressed="!!cur.exact" @click="setStep((s) => (s.t === 'pick' ? { ...s, exact: !s.exact } : s))">節氣那一刻</button>
        </div>
        <div class="rb-tabs" role="tablist"><button v-for="[k, n] in ctabs" :key="k" type="button" role="tab" :aria-selected="condTab === k" :class="{ set: cur.c[k] != null }" @click="condTab = k"><span>{{ n }}</span><b>{{ condVal(k) }}</b></button></div>
        <div class="rb-grid" :class="`g-${condTab}`">
          <button type="button" class="chip sm" :aria-pressed="cur.c[condTab] == null" @click="setCond(condTab, undefined)">不限</button>
          <template v-if="condTab === 'mo'"><button v-for="m in 12" :key="m" type="button" class="chip sm" :aria-pressed="cur.c.mo === m" @click="setCond('mo', m)">{{ m }}月</button></template>
          <template v-else-if="condTab === 'd'"><button v-for="d in 31" :key="d" type="button" class="chip sm" :aria-pressed="cur.c.d === d" @click="setCond('d', d)">{{ d }}</button><button type="button" class="chip sm" :aria-pressed="cur.c.d === -1" @click="setCond('d', -1)">最後一天</button></template>
          <template v-else-if="condTab === 'wd'"><button v-for="(n, d) in WD" :key="d" type="button" class="chip sm" :aria-pressed="cur.c.wd === d" @click="setCond('wd', d)">週{{ n }}</button></template>
          <template v-else-if="condTab === 'nth'"><button v-for="k in 5" :key="k" type="button" class="chip sm" :aria-pressed="cur.c.nth === k" @click="setCond('nth', k)">第{{ k }}個</button><button type="button" class="chip sm" :aria-pressed="cur.c.nth === -1" @click="setCond('nth', -1)">最後一個</button></template>
          <template v-else-if="condTab === 'lmo'"><button v-for="(n, i) in LUNAR_MONTHS" :key="n" type="button" class="chip sm" :aria-pressed="cur.c.lmo === i + 1" @click="setCond('lmo', i + 1)">{{ n }}</button><button type="button" class="chip sm" :aria-pressed="!!cur.c.leap" @click="setCond('leap', !cur.c.leap)">閏月</button></template>
          <template v-else-if="condTab === 'ld'"><button v-for="(n, i) in LUNAR_DAYS" :key="n" type="button" class="chip sm" :aria-pressed="cur.c.ld === i + 1" @click="setCond('ld', i + 1)">{{ n }}</button><button type="button" class="chip sm" :aria-pressed="cur.c.ld === -1" @click="setCond('ld', -1)">最後一天</button></template>
          <template v-else><button type="button" class="chip sm" :aria-pressed="cur.c.term === -1" @click="setCond('term', -1)">任何節氣</button><button v-for="k in TERMS_IN_YEAR" :key="k" type="button" class="chip sm" :aria-pressed="cur.c.term === k" @click="setCond('term', k)">{{ TERM_NAMES[k] }}</button></template>
        </div>
        <p class="rb-note">找的是：{{ condName(cur.c) }}</p>
      </template>
      <template v-else-if="cur.t === 'time'">
        <div class="rb-row"><span class="rb-l">時刻</span>
          <NumDial :model-value="timeOf.h" :min="0" :max="24" :pad="2" label="時" @update:model-value="(v) => setTime('h', v)" /><span class="rb-colon">:</span>
          <NumDial :model-value="timeOf.mi" :min="0" :max="59" :pad="2" wrap label="分" @update:model-value="(v) => setTime('mi', v)" /><span class="rb-colon">:</span>
          <NumDial :model-value="timeOf.s" :min="0" :max="59" :pad="2" wrap label="秒" @update:model-value="(v) => setTime('s', v)" />
        </div>
        <div class="rb-row wrap"><span class="rb-l">快速</span><button v-for="h in [0, 6, 8, 9, 12, 14, 18, 20, 23, 24]" :key="h" type="button" class="chip sm" :aria-pressed="timeOf.h === h && !timeOf.mi" @click="setStep((s) => (s.t === 'time' ? { ...s, h, mi: 0, s: 0 } : s))">{{ pad(h) }}:00</button></div>
        <p class="rb-note">24:00 是當天結束（隔天 0:00）。</p>
      </template>
      <template v-else-if="cur.t === 'word'">
        <div class="rb-row wrap"><span class="rb-l">在哪裡</span>
          <button type="button" class="chip sm" :aria-pressed="!cur.in" @click="setStep((s) => (s.t === 'word' ? { t: 'word', w: s.w } : s))">照詞本身</button>
          <button v-for="[sc, n] in scopes" :key="sc" type="button" class="chip sm" :aria-pressed="cur.in === sc" @click="setStep((s) => (s.t === 'word' ? { ...s, in: sc } : s))">{{ n }}</button>
        </div>
        <div v-if="cur.in === 'next' || cur.in === 'prev'" class="rb-row"><span class="rb-l">第幾個</span><NumDial :model-value="cur.k ?? 1" :min="1" :max="60" label="第幾個" @update:model-value="(v) => setStep((s) => (s.t === 'word' ? { ...s, k: v } : s))" /></div>
        <div v-for="[k, list] in words" :key="k" class="rb-row wrap"><span class="rb-l">{{ KIND_NAME[k] }}</span><button v-for="w in list" :key="w" type="button" class="chip sm" :aria-pressed="cur.w === w" @click="setStep((s) => (s.t === 'word' ? { ...s, w } : s))">{{ w }}</button></div>
      </template>
      <div class="rb-acts">
        <button type="button" class="chip sm" :disabled="sel === 0" @click="shiftAt(sel!, -1)"><Icon name="chevL" />往前移</button>
        <button type="button" class="chip sm" :disabled="sel === rule.steps.length - 1" @click="shiftAt(sel!, 1)">往後移<Icon name="chevR" /></button>
        <button type="button" class="chip sm danger" @click="removeAt(sel!)"><Icon name="x" />移除這一步</button>
      </div>
    </div>

    <p class="rb-out" :class="{ err: !run.ok }"><Icon :name="run.ok ? 'check' : 'info'" /><span>{{ run.ok ? `現在算出來是 ${result}` : result }}</span></p>
  </div>
</template>

<style scoped>
.rb { display: flex; flex-direction: column; gap: .6rem; min-width: 0; }
.rb-type { display: flex; align-items: center; gap: .45rem; height: 2.2rem; padding: 0 .6rem; border-radius: .7rem; border: 1px solid var(--hair-2); background: var(--surface-2); color: var(--ink-3); }
.rb-type:focus-within { border-color: var(--accent); }
.rb-type input { flex: 1; min-width: 0; border: 0; background: none; font-size: .9rem; color: var(--ink); outline: none; }
.rb-err { font-size: var(--fs-xs); color: var(--now); }
.rb-alts { display: flex; flex-wrap: wrap; align-items: center; gap: .3rem; font-size: var(--fs-xs); color: var(--ink-3); }
.rb-chain { display: flex; flex-wrap: wrap; align-items: center; gap: .3rem .2rem; padding: .5rem; border-radius: .9rem; background: var(--well); min-height: 3.4rem; }
.rb-blk { position: relative; display: flex; flex-direction: column; align-items: flex-start; gap: .05rem; padding: .35rem .6rem; border-radius: .65rem; background: var(--surface-2); border: 1px solid var(--hair-2); text-align: left; min-width: 0; touch-action: none; user-select: none; cursor: grab; transition: border-color .15s, box-shadow .15s, opacity .15s; }
.rb-blk.origin { cursor: pointer; background: color-mix(in srgb, var(--accent) 8%, var(--surface-2)); }
.rb-blk b { font-size: .88rem; font-weight: 650; color: var(--ink); white-space: nowrap; }
.rb-blk small { font-size: var(--fs-xs); color: var(--ink-3); white-space: nowrap; font-variant-numeric: tabular-nums; }
.rb-k { font-size: var(--fs-xs); color: var(--ink-3); }
.rb-blk:hover { border-color: var(--accent-line); }
.rb-blk.on { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-wash-2); }
.rb-blk.err { border-color: var(--now); }
.rb-blk.err small { color: var(--now); }
.rb-blk.dragging { z-index: 3; cursor: grabbing; box-shadow: var(--shadow-pop); }
.rb-blk.off { opacity: .45; border-style: dashed; border-color: var(--now); }
.rb-blk.target { border-color: var(--accent); border-style: dashed; }
.rb-arrow { width: .8em; height: .8em; color: var(--ink-4); flex: none; }
.rb-add { display: inline-flex; align-items: center; gap: .25rem; height: 2.2rem; padding: 0 .65rem; border-radius: .65rem; border: 1px dashed var(--accent-line); color: var(--accent); font-size: .85rem; font-weight: 600; }
.rb-add:hover, .rb-add[aria-expanded="true"] { background: var(--accent-wash); }
.rb-add .ic { width: .95em; height: .95em; }
.rb-hint { font-size: var(--fs-xs); color: var(--now); margin-top: -.3rem; }
.rb-pal, .rb-insp { display: flex; flex-direction: column; gap: .5rem; padding: .65rem; border-radius: .9rem; border: 1px solid var(--hair-2); background: var(--surface); max-height: 19rem; overflow-y: auto; }
.rb-pal-g { display: flex; flex-wrap: wrap; align-items: center; gap: .25rem; }
.rb-pal-k, .rb-l { font-size: var(--fs-xs); font-weight: 650; color: var(--ink-3); min-width: 4.2rem; }
.rb-row { display: flex; align-items: center; gap: .35rem; flex-wrap: nowrap; }
.rb-row.wrap { flex-wrap: wrap; }
.rb-row .seg-ctl { flex-wrap: wrap; }
.rb-colon { color: var(--ink-3); font-weight: 600; }
.rb-date { height: 2rem; padding: 0 .5rem; border-radius: .6rem; border: 1px solid var(--hair-2); background: var(--surface-2); color: var(--ink); font: inherit; font-size: .88rem; }
.rb-tabs { display: flex; flex-wrap: wrap; gap: .25rem; }
.rb-tabs button { display: flex; flex-direction: column; align-items: flex-start; padding: .25rem .5rem; border-radius: .55rem; border: 1px solid var(--hair); font-size: var(--fs-xs); color: var(--ink-3); }
.rb-tabs button b { font-size: .82rem; color: var(--ink-2); font-weight: 600; }
.rb-tabs button.set b { color: var(--accent); }
.rb-tabs button[aria-selected="true"] { border-color: var(--accent); background: var(--accent-wash); }
.rb-grid { display: flex; flex-wrap: wrap; gap: .2rem; }
.rb-grid.g-d .chip, .rb-grid.g-ld .chip { min-width: 2.4rem; justify-content: center; }
.rb-note { font-size: var(--fs-xs); color: var(--ink-3); line-height: 1.45; }
.rb-acts { display: flex; flex-wrap: wrap; gap: .3rem; padding-top: .2rem; border-top: 1px solid var(--hair); }
.rb-acts .ic { width: .9em; height: .9em; }
.chip.danger { color: var(--now); }
.chip.blank { border-style: dashed; }
.chip.sm { height: 1.85rem; padding: 0 .55rem; font-size: var(--fs-s); }
.rb-out { display: flex; align-items: center; gap: .4rem; font-size: .86rem; color: var(--accent); font-weight: 600; }
.rb-out.err { color: var(--now); }
.rb-out .ic { width: 1em; height: 1em; flex: none; }
@media (pointer: coarse) { .chip.sm { height: 2.3rem; } .rb-blk { padding: .5rem .7rem; } }
</style>
