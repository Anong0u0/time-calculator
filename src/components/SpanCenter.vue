<script setup lang="ts">
/* The answer: the gap between start and end, in the middle of the equation.
   Fixed ends: the measured gap (a countdown or a count-up while one end is now).
   Linked: end = start + this span, or start = end − this span when the end is held at now.
   Typing or dragging a number here links; a date typed here moves the end there. */
import { ref, computed, watch, nextTick, onMounted } from 'vue';
import Icon from './Icon.vue';
import Popover from './Popover.vue';
import DurationCalc from './DurationCalc.vue';
import ChipRow from './ChipRow.vue';
import {
  S, now, startMs, endMs, hasEnd, calGap, gapSec, linkErr, commit, setLink, checkSpan, swapEnds, historyMark, rollback, toast, undo,
  pulse, bump, wallOf, presetProgress, linkTarget, linkSentence, followText, negExpr, setWall, setInstant, tzOf, type Chip, chipRule,
} from '../state/store';
import { spanOfRule } from '../core/rule';
import { parseDateTimeText } from '../core/parse';
import { parseOptsFor, textToEnd } from '../state/command';
import { type Span, type SpanInput, interpretSpanText, parseSpan, fmtSpan, pad, partsInTz, WD, wdOf, fmtDT, fmtClock, clamp, wallKey, DAY, SEC } from '../core/time';
import { spanTokens, nfMax, durWords } from '../core/format';
import { ui, openDuration } from '../state/ui';
import { fitText } from '../composables/fit';
import { useSize, fontsTick } from '../composables/size';

const props = defineProps<{ compact?: boolean; tight?: boolean }>();
const mode = computed(() => (S.link ? 'link' : hasEnd.value ? 'fixed' : 'empty'));
const N = { start: '開始', end: '結束' } as const;
/** The one end that is now, when exactly one is. */
const liveEnd = computed(() => (S.live && !S.endLive ? 'start' : S.endLive && !S.live ? 'end' : null));
const title = computed(() => {
  if (mode.value === 'link') return '連動';
  if (mode.value === 'fixed' && liveEnd.value) {
    const g = gapSec.value ?? 0;
    // start = now: what is left until the end; end = now: what has passed since the start
    return (liveEnd.value === 'start' ? g >= 0 : g < 0) ? '倒數' : '已過';
  }
  return '間隔';
});
const titleTip = computed(() => {
  if (title.value === '連動') return `${linkSentence()}。${followText()}`;
  if (title.value === '倒數') return liveEnd.value === 'start' ? '開始是現在，所以這是到結束還剩多少時間' : '結束是現在，所以這是到開始還有多久';
  if (title.value === '已過') return liveEnd.value === 'start' ? '開始是現在，結束已經過去了這麼久' : '結束是現在，所以這是從開始到現在過了多久';
  if (!hasEnd.value) return '輸入一段間隔，結束就會算出來；也可以直接輸入結束的日期';
  return `開始到結束相隔多久。改這裡會讓${N[linkTarget()]}跟著移動`;
});

const heroSpan = computed<Span | null>(() => {
  if (S.link) return { ...S.link.span };
  const c = calGap.value;
  return c ? { sign: c.sign, y: c.y, mo: c.mo, w: 0, d: c.d, h: c.h, mi: c.mi, s: c.s, biz: false } : null;
});
const toks = computed(() => (S.link ? spanTokens(S.link.span, { plus: true }) : calGap.value ? spanTokens({ ...calGap.value, w: 0, biz: false }, { clock: true }) : []));
const shape = computed(() => toks.value.map((t) => (t.t === 'num' ? `${t.k}${t.v.length}` : t.t === 'unit' || t.t === 'sign' ? t.v : ':')).join('|'));

/* ---------- fit the hero to its width ---------- */
const box = ref<HTMLElement | null>(null);
const line = ref<HTMLElement | null>(null);
const { w: boxW } = useSize(box);
const refit = () => nextTick(() => { fitText(line.value, 0.42); requestAnimationFrame(() => fitText(line.value, 0.42)); });
watch([() => toks.value.map((t) => ('v' in t ? t.v : ':')).join(''), boxW, () => props.compact, fontsTick], refit);
onMounted(refit);

/* ---------- typing ---------- */
const editing = ref(false);
const text = ref('');
const input = ref<HTMLInputElement | null>(null);
let mark = 0, session = 0, changed = false, cancelled = false;
const exprNote = ref<{ src: string; expr: string; text: string } | null>(null);

function calText(): string {
  const c = calGap.value;
  if (!c) return '';
  const p: string[] = [];
  if (c.y) p.push(`${c.y}年`);
  if (c.mo) p.push(`${c.mo}個月`);
  if (c.d) p.push(`${c.d}天`);
  const time = `${pad(c.h)}:${pad(c.mi)}:${pad(c.s)}`;
  return (c.sign < 0 ? '−' : '') + p.join('') + (p.length ? ' ' : '') + time;
}
function startEdit(initial?: string) {
  if (editing.value) { if (initial != null) { text.value = initial; onInput(); } return; }
  mark = historyMark(); session++; changed = false; cancelled = false;
  text.value = initial ?? (S.link ? S.link.expr : calText());
  editing.value = true;
  nextTick(() => {
    const el = input.value;
    if (!el) return;
    el.focus();
    if (initial != null) el.setSelectionRange(el.value.length, el.value.length); else el.select();
  });
}
const parsed = computed<SpanInput | null>(() => (editing.value ? interpretSpanText(text.value) : null));
/** A moment typed where a length goes ("2026/12/25", "到 12/25"): the end that the span would move goes there. */
const typedDate = computed(() => {
  if (!editing.value) return null;
  const t = text.value.trim().replace(/^(到|至|~|→|until|to)\s*/i, '');
  if (!t || /^[+\-−＋]/.test(t) || parsed.value?.kind === 'span' || parsed.value?.kind === 'ratio') return null;
  const to = linkTarget();
  const p = parseDateTimeText(t, parseOptsFor(to));
  if (!p || p.kind === 'time') return null;
  const ms = p.kind === 'instant' ? p.ms : p.offset != null ? wallKey(p.wall) - p.offset : null;
  return { to, ms, wall: p.kind === 'wall' && p.offset == null ? p.wall : partsInTz(ms!, tzOf(to)) };
});
function onInput() {
  const r = interpretSpanText(text.value);
  if (r.kind !== 'span') return;
  const c = checkSpan(r.span);
  if (!c.ok) return;
  if (S.link && S.link.expr === fmtSpan(r.span) && S.link.span.biz === r.span.biz) return;
  commit(() => setLink(r.span), { key: `span-edit-${session}`, hold: true, label: `間隔 ${fmtSpan(r.span)}` });
  changed = true;
}
function finish() {
  if (!editing.value) return;
  const d = typedDate.value;
  editing.value = false;
  if (cancelled) return;
  if (d && !changed) {
    const ok = commit(() => (d.ms != null ? setInstant(d.to, d.ms) : setWall(d.to, d.wall)), { label: `設定${N[d.to]}`, say: `${N[d.to]}：${fmtDT(d.wall)}` });
    if (ok) bump(d.to);
    return;
  }
  const r = interpretSpanText(text.value);
  if (r.kind === 'span' && r.expr && S.link) exprNote.value = { src: text.value.trim(), expr: S.link.expr, text: tape(r) };
  else if (changed) exprNote.value = null;
  if (changed && S.link) { toast(`${linkSentence()}，${followText()}`, undo); bump(S.linkTo); }
}
function cancel() { cancelled = true; rollback(mark); editing.value = false; }
function nudge(dir: number) {
  const el = input.value!;
  let v = el.value;
  if (!/\d/.test(v)) v = (v.trim() || '+') + '0天';
  const pos = el.selectionStart ?? v.length;
  const nums = [...v.matchAll(/\d+/g)];
  const m = nums.find((x) => pos >= x.index! && pos <= x.index! + x[0].length) || nums.filter((x) => x.index! < pos).pop() || nums[0];
  const n = Math.max(0, +m[0] + dir);
  const nv = v.slice(0, m.index) + n + v.slice(m.index! + m[0].length);
  text.value = nv;
  const caret = m.index! + String(n).length;
  nextTick(() => el.setSelectionRange(caret, caret));
  onInput();
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Enter') { e.preventDefault(); input.value?.blur(); }
  else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); nudge((e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1)); }
}
watch(() => ui.spanEditReq, () => startEdit(ui.spanEditText || undefined));
/** ↑ ↓ on the span (not yet typing): open it and step the number under the caret, the last one. */
function arrowStep(dir: number, e: KeyboardEvent) {
  startEdit();
  nextTick(() => { const el = input.value; if (el) { el.setSelectionRange(el.value.length, el.value.length); nudge(dir * (e.shiftKey ? 10 : 1)); } });
}
function tape(r: SpanInput): string {
  if (r.kind === 'span' && r.expr && r.result && !r.result.empty) return `= ${fmtClock(r.result.value)}（${durWords(r.result.value)}）`;
  if (r.kind === 'ratio') return `= ${nfMax(r.value, 4)} 倍`;
  return '';
}

/* ---------- drag a number left or right ---------- */
interface Scrub { id: number; x: number; k: string | null; base: Span; steps: number; moved: boolean; mouse: boolean }
let scrub: Scrub | null = null;
const hotK = ref<string | null>(null);
const canHover = ref<string | null>(null);
function numAt(x: number): HTMLElement | null {
  let best: HTMLElement | null = null, bd = Infinity;
  line.value?.querySelectorAll<HTMLElement>('.hn[data-k]').forEach((el) => {
    const r = el.getBoundingClientRect();
    const d = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
    if (d < bd) { bd = d; best = el; }
  });
  return bd <= 14 ? best : null;
}
/** Drag a number: it counts toward zero and, when it is the only part left, on through to the other side. */
function bumpSpan(base: Span, k: string, n: number): Span {
  const sp = { ...base };
  const dir = n * sp.sign;
  if (k === 'y' || k === 'mo' || k === 'w' || k === 'd') {
    const v = sp[k] + dir;
    const alone = (['y', 'mo', 'w', 'd', 'h', 'mi', 's'] as const).every((x) => x === k || !sp[x]);
    if (v < 0 && alone) { sp[k] = -v; sp.sign = -sp.sign as 1 | -1; } else sp[k] = Math.max(0, v);
  } else {
    const per = ({ h: 3600, mi: 60, s: 1 } as Record<string, number>)[k];
    let t = sp.h * 3600 + sp.mi * 60 + sp.s + dir * per;
    if (t < 0 && !sp.y && !sp.mo && !sp.w && !sp.d) { t = -t; sp.sign = -sp.sign as 1 | -1; }
    t = Math.max(0, t);
    sp.h = Math.floor(t / 3600); sp.mi = Math.floor((t % 3600) / 60); sp.s = t % 60;
  }
  return sp;
}
function onDown(e: PointerEvent) {
  if (e.button > 0) return;
  const sp = heroSpan.value;
  const el = sp ? numAt(e.clientX) : null;
  scrub = { id: e.pointerId, x: e.clientX, k: el?.dataset.k ?? null, base: sp || { sign: 1, y: 0, mo: 0, w: 0, d: 0, h: 0, mi: 0, s: 0, biz: false }, steps: 0, moved: false, mouse: e.pointerType === 'mouse' };
  session++;
  try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* fine */ }
}
function onMove(e: PointerEvent) {
  if (!scrub) {
    if (e.pointerType === 'mouse') canHover.value = heroSpan.value && numAt(e.clientX) ? numAt(e.clientX)!.dataset.k || null : null;
    return;
  }
  if (e.pointerId !== scrub.id) return;
  const dx = e.clientX - scrub.x;
  if (!scrub.moved && Math.abs(dx) < 6) return;
  scrub.moved = true;
  if (!scrub.k) return;
  hotK.value = scrub.k;
  const steps = Math.round(dx / 10) * (e.shiftKey ? 10 : 1);
  if (steps === scrub.steps) return;
  scrub.steps = steps;
  const sp = bumpSpan(scrub.base, scrub.k, steps);
  if (checkSpan(sp).ok) commit(() => setLink(sp), { key: `scrub-${session}`, hold: true, label: `間隔 ${fmtSpan(sp)}` });
}
/** The wheel over a number steps it, like dragging it one notch. */
let wheelAcc = 0, wheelSession = 0, wheelAt = 0;
function onWheel(e: WheelEvent) {
  const sp = heroSpan.value;
  const el = sp ? numAt(e.clientX) : null;
  if (!sp || !el?.dataset.k) return;
  e.preventDefault();
  const t = Date.now();
  if (t - wheelAt > 1200) wheelSession++;
  wheelAt = t;
  wheelAcc += e.deltaY;
  if (Math.abs(wheelAcc) < 40) return;
  const n = (wheelAcc < 0 ? 1 : -1) * (e.shiftKey ? 10 : 1);
  wheelAcc = 0;
  const next = bumpSpan(sp, el.dataset.k, n);
  if (checkSpan(next).ok) commit(() => setLink(next), { key: `wheel-${wheelSession}`, hold: true, label: `間隔 ${fmtSpan(next)}` });
}
function onUp(e: PointerEvent) {
  if (!scrub || e.pointerId !== scrub.id) return;
  const s = scrub;
  scrub = null; hotK.value = null;
  if (!s.moved) { if (e.type === 'pointerup') startEdit(); return; }
  if (s.steps && S.link) { exprNote.value = null; toast(`${linkSentence()}，${followText()}`, undo); }
}

/* ---------- quick spans: a row of shortcuts like the ends have ---------- */
const preview = ref<string | null>(null);
/** While typing, a span shortcut fills the box instead of applying. */
function pickQuick(c: Chip): boolean {
  preview.value = null; exprNote.value = null;
  if (!editing.value) return false;
  const r = chipRule(c);
  const sp = r ? spanOfRule(r, 'end') : null;
  if (sp) { text.value = fmtSpan(sp); onInput(); }
  return true;
}
void parseSpan; void setLink;
const bizShown = computed(() => !!S.link && (S.link.span.d > 0 || S.link.span.biz) && !S.link.span.y && !S.link.span.mo && !S.link.span.w);
function toggleBiz() {
  if (!S.link) return;
  const sp = { ...S.link.span, biz: !S.link.span.biz };
  const c = checkSpan(sp);
  if (!c.ok) { toast(c.err); return; }
  if (editing.value) { text.value = fmtSpan(sp); onInput(); return; }
  commit(() => setLink(sp), { label: sp.biz ? '只算工作日' : '改回日曆天', say: () => (sp.biz ? `只算週一到週五：${fmtDT(wallOf(S.linkTo)!)}` : `改回日曆天：${fmtDT(wallOf(S.linkTo)!)}`) });
}
/* a length or a date dropped on the span: the span (or the end it computes) goes there */
const dropping = ref(false);
function dragOver(e: DragEvent) {
  if (!e.dataTransfer || ![...e.dataTransfer.types].includes('text/plain')) return;
  e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; dropping.value = true;
}
function dropText(e: DragEvent) {
  dropping.value = false;
  const t = e.dataTransfer?.getData('text/plain')?.trim();
  if (!t) return;
  e.preventDefault();
  const r = interpretSpanText(t);
  if (r.kind === 'span') {
    const to = linkTarget();
    if (commit(() => setLink(r.span, to), { label: `間隔 ${fmtSpan(r.span)}`, say: () => `${linkSentence()}，${followText()}` })) bump(to);
  } else if (textToEnd(linkTarget(), t)) bump(linkTarget());
}
function swap() { commit(swapEnds, { label: '交換開始與結束', say: '已交換開始與結束' }); bump('start'); bump('end'); }

/* ---------- status line and rail ---------- */
type Seg = { t: string; b?: boolean };
const whenFull = (w: { y: number; mo: number; d: number; h: number; mi: number; s: number }) => `${fmtDT(w)}（${WD[wdOf(w)]}）`;
function whenShort(ms: number, tz: string) {
  const w = partsInTz(ms, tz);
  const yr = Math.abs(ms - now.value) < 300 * DAY ? '' : `${w.y}/`;
  const tm = w.h || w.mi || w.s ? ` ${pad(w.h)}:${pad(w.mi)}` : '';
  return `${yr}${w.mo}/${w.d}（${WD[wdOf(w)]}）${tm}`;
}
function left(ms: number) {
  const t = Math.floor(Math.max(0, ms) / SEC);
  const d = Math.floor(t / 86400), r = t % 86400;
  return `${d ? `${d}天 ` : ''}${pad(Math.floor(r / 3600))}:${pad(Math.floor((r % 3600) / 60))}:${pad(r % 60)}`;
}
const status = computed<{ segs: Seg[]; tone: '' | 'err' | 'soft' | 'pre' }>(() => {
  const p = parsed.value;
  if (editing.value && p) {
    const d = typedDate.value;
    if (d) return { segs: [{ t: `${N[d.to]} → ` }, { t: whenFull(d.wall), b: true }, { t: ' · Enter 確定，Esc 取消' }], tone: 'pre' };
    if (p.kind === 'error') return { segs: [{ t: p.message }], tone: p.soft ? 'soft' : 'err' };
    if (p.kind === 'empty') return { segs: [{ t: '輸入 +30天、1年6個月、20工作日、47m × 16，或結束的日期' }], tone: 'soft' };
    if (p.kind === 'ratio') return { segs: [{ t: tape(p), b: true }, { t: ' · 結果是倍數，只顯示，不會改變結束' }], tone: 'pre' };
    const to = linkTarget();
    const c = checkSpan(p.span, to);
    if (!c.ok) return { segs: [{ t: c.err }], tone: 'err' };
    return { segs: [...(p.expr ? [{ t: tape(p) + ' ', b: false }] : []), { t: `${N[to]} → ` }, { t: whenFull(c.w), b: true }, { t: ' · Enter 確定，Esc 取消' }], tone: 'pre' };
  }
  if (preview.value) return { segs: [{ t: preview.value }], tone: 'pre' };
  if (linkErr.value) return { segs: [{ t: linkErr.value }], tone: 'err' };
  const sMs = startMs.value, eMs = endMs.value, n = now.value;
  if (eMs == null) {
    if (!S.live && sMs > n) return { segs: [{ t: '還有 ' }, { t: left(sMs - n), b: true }, { t: ' 開始' }], tone: '' };
    return { segs: [{ t: '點上面輸入 +30天、3個月，或直接填結束的日期' }], tone: 'soft' };
  }
  if (S.link) {
    const ex = S.link.expr, toEnd = S.linkTo === 'end';
    const anchorLive = toEnd ? S.live : S.endLive;
    if (anchorLive) {
      return toEnd
        ? { segs: [{ t: `結束 = 現在 ${ex}，跟著時間走 · ` }, { t: whenShort(eMs, S.endTz), b: true }], tone: '' }
        : { segs: [{ t: `開始 = 現在 ${negExpr(ex)}，跟著時間走 · ` }, { t: whenShort(sMs, S.startTz), b: true }], tone: '' };
    }
    const cal = S.link.span.y || S.link.span.mo || S.link.span.w || S.link.span.biz;
    if (cal) return { segs: [{ t: `${linkSentence()} · 實際 ` }, { t: left(Math.abs(eMs - sMs)), b: true }], tone: '' };
    return { segs: [{ t: `${linkSentence()}，${followText()}` }], tone: '' };
  }
  const endName = S.rules.end?.name || '結束';
  if (S.live && S.endLive) return { segs: [{ t: '開始和結束都是現在 · 把其中一端改成別的時刻' }], tone: 'soft' };
  if (S.endLive) {
    if (sMs > n) return { segs: [{ t: '結束是現在 · 開始還有 ' }, { t: left(sMs - n), b: true }], tone: '' };
    return { segs: [{ t: '從 ' }, { t: whenShort(sMs, S.startTz), b: true }, { t: ' 到現在' }], tone: '' };
  }
  if (S.live) {
    if (presetProgress.value != null) return { segs: [{ t: '已過 ' }, { t: `${nfMax(presetProgress.value * 100, 1)}%`, b: true }, { t: ` · ${endName} ` }, { t: whenShort(eMs, S.endTz), b: true }], tone: '' };
    return { segs: [{ t: `${eMs < n ? '已過' : '距'}${endName} · ` }, { t: whenShort(eMs, S.endTz), b: true }], tone: '' };
  }
  if (eMs < sMs) return { segs: [{ t: '結束早於開始 · 按 ⇄ 可以交換' }], tone: 'soft' };
  if (n < sMs) return { segs: [{ t: '尚未開始 · ' }, { t: left(sMs - n), b: true }, { t: ' 後開始' }], tone: '' };
  if (n > eMs) return { segs: [{ t: '已經結束 · ' }, { t: left(n - eMs), b: true }, { t: ' 前' }], tone: '' };
  const f = (n - sMs) / (eMs - sMs);
  return { segs: [{ t: '現在走到 ' }, { t: `${nfMax(f * 100, 1)}%`, b: true }, { t: ' · 還有 ' }, { t: left(eMs - n), b: true }], tone: '' };
});

const flashing = ref(false);
watch(() => pulse.span, () => { flashing.value = false; requestAnimationFrame(() => { flashing.value = true; }); });

/* ---------- the duration calculator: a popover here, or its own column on four-column screens ---------- */
const calcBtn = ref<HTMLElement | null>(null);
const calcBtnC = ref<HTMLElement | null>(null);
const calcOpen = ref(false);
const calcRef = ref<InstanceType<typeof DurationCalc> | null>(null);
const calcHere = computed(() => ui.layout !== 'xwide');
const calcTip = computed(() => (calcHere.value ? '時長計算機：加減乘除時間長度' : '打開時長計算機'));
function toggleCalc() {
  if (calcHere.value) calcOpen.value = !calcOpen.value;
  else openDuration();
}
watch(() => ui.durReq, () => {
  if (!calcHere.value) return;
  ui.durSeen = ui.durReq;
  calcOpen.value = true;
  nextTick(() => calcRef.value?.select());
});
watch(calcHere, (h) => { if (!h) calcOpen.value = false; });
</script>

<template>
  <section class="panel sc" :class="[`m-${mode}`, { compact, flash: flashing, neg: (heroSpan?.sign ?? 1) < 0, dropping }]" aria-label="間隔" @animationend="flashing = false"
    @dragover="dragOver" @dragleave="dropping = false" @drop="dropText">
    <header v-if="!compact" class="sc-head">
      <h2 v-tip="titleTip" tabindex="-1">{{ title }}</h2>
      <span v-if="S.link?.span.biz" class="sc-sub">只算工作日</span>
      <span class="sc-tools">
        <button ref="calcBtn" type="button" class="icon-btn sm" :class="{ on: calcOpen }" v-tip="calcTip" aria-label="時長計算機" :aria-expanded="calcHere ? calcOpen : undefined" @click="toggleCalc"><Icon name="calc" /></button>
        <button v-if="hasEnd" type="button" class="icon-btn sm" v-tip="'交換開始與結束'" aria-label="交換開始與結束" @click="swap"><Icon :name="compact ? 'swapv' : 'swap'" /></button>
      </span>
    </header>

    <div class="hero-row">
    <div ref="box" class="hero" :class="{ editing, scrubbing: !!hotK }">
      <input v-if="editing" ref="input" v-model="text" class="hero-in mono" type="text" autocomplete="off" spellcheck="false" enterkeyhint="done"
        aria-label="間隔：例如 +30天、1年6個月、47m × 16" @input="onInput" @keydown="onKey" @blur="finish" />
      <div v-else ref="line" class="hero-line" role="button" tabindex="0" :aria-label="mode === 'empty' ? '輸入間隔' : `間隔 ${toks.map((t) => ('v' in t ? t.v : ':')).join('')}，點一下修改`"
        :style="{ cursor: canHover ? 'ew-resize' : 'text' }" v-tip="mode === 'empty' ? '點一下輸入間隔，例如 +30天' : '點一下輸入；按住數字左右拖曳，或在數字上捲動滾輪調整'"
        @pointerdown="onDown" @pointermove="onMove" @pointerup="onUp" @pointercancel="onUp" @pointerleave="canHover = null" @wheel="onWheel"
        @keydown.enter.prevent="startEdit()" @keydown.space.prevent="startEdit()" @keydown.up.prevent="arrowStep(1, $event)" @keydown.down.prevent="arrowStep(-1, $event)">
        <template v-if="toks.length">
          <template v-for="(t, i) in toks" :key="i">
            <span v-if="t.t === 'num'" class="hn" :class="{ hot: hotK === t.k, can: canHover === t.k }" :data-k="t.k"><span v-if="t.k === 's'" :key="t.v" class="roll">{{ t.v }}</span><template v-else>{{ t.v }}</template></span>
            <span v-else-if="t.t === 'unit'" class="hu">{{ t.v }}</span>
            <span v-else-if="t.t === 'colon'" class="hc">:</span>
            <span v-else class="hs">{{ t.v }}</span>
          </template>
        </template>
        <span v-else class="hero-empty"><Icon name="plus" />加上間隔</span>
      </div>
    </div>
    <button v-if="compact && !editing" ref="calcBtnC" type="button" class="icon-btn sm" :class="{ on: calcOpen }" v-tip="calcTip" aria-label="時長計算機" :aria-expanded="calcHere ? calcOpen : undefined" @click="toggleCalc"><Icon name="calc" /></button>
    <button v-if="compact && hasEnd && !editing" type="button" class="icon-btn sm" v-tip="'交換開始與結束'" aria-label="交換開始與結束" @click="swap"><Icon name="swapv" /></button>
    </div>

    <p class="status" :class="status.tone">
      <b v-if="compact" class="st-k" v-tip="titleTip">{{ title }}</b>
      <template v-for="(s, i) in status.segs" :key="i"><b v-if="s.b">{{ s.t }}</b><template v-else>{{ s.t }}</template></template>
    </p>
    <p v-if="!editing && exprNote && S.link && exprNote.expr === S.link.expr" class="tape mono" v-tip="'剛才輸入的算式'">{{ exprNote.src }} <span>{{ exprNote.text }}</span></p>

    <div v-if="!tight" class="sc-quick" aria-label="快速間隔" @pointerdown="editing && $event.preventDefault()">
      <ChipRow row="span" :pick="pickQuick" @preview="(t) => (preview = t)" />
      <button v-if="bizShown" type="button" class="chip biz" :aria-pressed="!!S.link?.span.biz" v-tip="'只算週一到週五：僅扣週末，不含國定假日與補班'" @click="toggleBiz"><Icon name="brief" />工作日</button>
    </div>

    <Popover :open="calcOpen" :anchor="compact ? calcBtnC : calcBtn" label="時長計算機" width="25rem" align="end" @close="calcOpen = false">
      <div class="calc-pop">
        <p class="calc-pop-t"><Icon name="calc" /><b>時長計算機</b><span>不會動到開始和結束</span></p>
        <DurationCalc ref="calcRef" compact />
      </div>
    </Popover>

  </section>
</template>

<style scoped>
.sc.dropping { outline: 2px dashed var(--accent); outline-offset: -4px; }
.calc-pop { padding: .85rem 1rem 1rem; display: flex; flex-direction: column; gap: .6rem; }
.calc-pop-t { display: flex; align-items: center; gap: .45rem; font-size: .95rem; }
.calc-pop-t .ic { color: var(--ink-3); }
.calc-pop-t span { font-size: var(--fs-xs); color: var(--ink-3); margin-left: auto; }
.icon-btn.on { background: var(--accent-wash); color: var(--accent); }
.sc { padding: .9rem 1.15rem 1rem; gap: .5rem; background: linear-gradient(180deg, color-mix(in srgb, var(--accent) 5%, var(--surface)), var(--surface) 70%); box-shadow: var(--shadow-hero); border-color: color-mix(in srgb, var(--accent) 16%, var(--hair)); }
.sc-head { display: flex; align-items: center; gap: .55rem; min-height: 2.1rem; }
.sc-head h2 { font-size: 1.02rem; font-weight: 650; color: var(--accent); cursor: help; }
.m-fixed:not(.neg) .sc-head h2 { color: var(--accent); }
.sc-sub { font-size: max(var(--floor), .82rem); color: var(--ink-3); }
.sc-tools { margin-left: auto; display: flex; gap: .1rem; }
.icon-btn.sm { width: 2rem; height: 2rem; border-radius: .65rem; }

.hero-row { display: flex; align-items: center; gap: .4rem; min-width: 0; }
.hero { position: relative; flex: 1; min-width: 0; height: 4.1rem; display: flex; align-items: center; }
.hero-line {
  display: block; width: 100%; white-space: nowrap; overflow: hidden; touch-action: none; user-select: none; -webkit-user-select: none;
  font-family: var(--f-mono); font-stretch: 75%; font-variant-numeric: tabular-nums; font-size: 3.15rem; font-weight: 500; letter-spacing: -.035em; line-height: 1.1;
  padding: .1rem .15rem; margin: 0 -.15rem; border-radius: .7rem;
  background-image: linear-gradient(to right, var(--accent-line) 45%, transparent 45%); background-size: .36rem 1px; background-repeat: repeat-x; background-position: 0 100%;
  transition: background-color .15s;
}
.hero-line:hover { background-color: var(--accent-wash); }
.hn { position: relative; color: var(--ink); border-radius: .2em; transition: color .15s, background-color .15s; }
.hn.can, .hn.hot { color: var(--accent); background: var(--accent-wash); }
.hn.can::before, .hn.can::after, .hn.hot::before, .hn.hot::after { position: absolute; top: 50%; transform: translateY(-50%); font-size: .42em; color: var(--accent); font-family: var(--f-sans); }
.hn.can::before, .hn.hot::before { content: '‹'; left: -.5em; }
.hn.can::after, .hn.hot::after { content: '›'; right: -.5em; }
.hu { font-family: var(--f-sans); font-size: max(var(--floor), .4em); font-weight: 600; color: var(--ink-3); letter-spacing: 0; margin: 0 .55em 0 .14em; }
.hc { color: var(--ink-4); margin: 0 -.02em; }
.hs { color: var(--ink-3); margin-right: .06em; font-weight: 400; }
.neg .hn { color: var(--warn); }
.roll { display: inline-block; }
@media (prefers-reduced-motion: no-preference) { .roll { animation: roll .24s var(--ease); } }
@keyframes roll { from { transform: translateY(-16%); opacity: .45; } }
.hero-empty { display: inline-flex; align-items: center; gap: .3em; font-family: var(--f-sans); font-size: .58em; font-weight: 600; color: var(--ink-3); letter-spacing: 0; }
.hero-in { width: 100%; height: 3.6rem; padding: 0 .8rem; border-radius: .9rem; border: 1.5px solid var(--accent); background: var(--surface-2); box-shadow: 0 0 0 4px var(--accent-wash-2); font-size: 1.7rem; color: var(--ink); caret-color: var(--accent); }


.status { font-size: .9rem; color: var(--ink-2); min-height: 1.3rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.status b { color: var(--ink); font-weight: 650; font-family: var(--f-mono); font-stretch: 75%; font-size: 1em; }
.status.soft { color: var(--ink-3); }
.status.err { color: var(--now); }
.status.pre { color: var(--accent); }
.status.pre b { color: var(--accent); }
.tape { font-size: max(var(--floor), .82rem); color: var(--ink-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: -.2rem; }
.tape span { color: var(--ink-2); }

.sc-quick { display: flex; flex-wrap: wrap; gap: .35rem; }
.sc-quick > .chip, .sc-quick :deep(.chip) { height: 1.95rem; padding: 0 .65rem; font-size: max(var(--floor), .84rem); font-family: var(--f-sans); }
.sc-quick :deep(.chip.add) { padding: 0 .5rem; }
.chip.biz .ic { width: 1em; height: 1em; }

.sc.compact { padding: .6rem .8rem .7rem; gap: .35rem; border-radius: var(--r-md); }
.st-k { font-family: var(--f-sans) !important; font-stretch: 100% !important; font-size: 1em !important; color: var(--accent) !important; margin-right: .45rem; cursor: help; }
.compact .hero { height: 3rem; }
.compact .hero-line { font-size: 2.35rem; }
.compact .hero-in { height: 2.8rem; font-size: 1.35rem; }
.compact .status { font-size: .86rem; min-height: 1.2rem; }
.compact .sc-quick { flex-wrap: nowrap; overflow: hidden; }
.compact .sc-quick :deep(.cr) { flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; }
.compact .sc-quick :deep(.cr)::-webkit-scrollbar { display: none; }
.compact .sc-quick :deep(.chip) { height: 1.85rem; padding: 0 .55rem; font-size: var(--fs-s); flex: none; }
</style>
