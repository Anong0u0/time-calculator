<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import Icon from './Icon.vue';
import RuleBuilder from './RuleBuilder.vue';
import { type Rule, decodeRule, encodeRule, ruleName } from '../core/rule';
import {
  S,
  type ChipRow,
  DEFAULT_CHIPS,
  CHIP_MAX,
  chipTarget,
  chipName,
  chipRule,
  runRule,
  tzOf,
  commit,
  applyRule,
  bump,
  toast,
  ruleTick,
} from '../state/store';
import { useDragSort, moved } from '../composables/dragSort';
import { partsInTz, WD, wdOf, pad } from '../core/time';
import { builtinOf } from '../core/vocab';

const props = defineProps<{ row: ChipRow; index: number | null }>();
const emit = defineEmits<{ close: [] }>();
const which = computed(() => chipTarget(props.row));
const ROW_NAME: Record<ChipRow, string> = { start: '開始', end: '結束', span: '間隔' };
const list = computed(() => S.chips[props.row]);

const sel = ref<number | null>(null);
const draft = ref<Rule>({ o: { t: 'now' }, steps: [] });
const draftName = ref('');
const fresh = (): Rule =>
  props.row === 'span'
    ? { o: { t: 'other' }, steps: [{ t: 'move', n: 1, u: 'd' }] }
    : {
        o: { t: 'now' },
        steps: [
          { t: 'move', n: 1, u: 'd' },
          { t: 'align', p: 'd', pos: 'start' },
        ],
      };
function load(i: number | null) {
  sel.value = i;
  const c = i != null ? list.value[i] : null;
  draft.value = (c && decodeRule(c.code)) || fresh();
  draftName.value = c?.name || '';
}
watch(
  () => props.index,
  (i) => load(i),
  { immediate: true },
);

function when(r: Rule | null): string {
  void ruleTick.value;
  if (!r) return '壞掉了';
  const res = runRule(r, which.value);
  if (!res.ok) return res.err;
  const w = partsInTz(res.ms, tzOf(which.value));
  return `${w.mo}/${w.d}（${WD[wdOf(w)]}）${w.h || w.mi ? ` ${pad(w.h)}:${pad(w.mi)}` : ''}`;
}
const autoName = computed(() => ruleName(draft.value, S.prefs));
const nameOf = () => draftName.value.trim() || autoName.value;

/* ---------- the list ---------- */
const listEl = ref<HTMLElement | null>(null);
let sortSession = 0;
const sort = useDragSort({
  rows: () => [...(listEl.value?.querySelectorAll<HTMLElement>(':scope > .ce-row[data-i]') || [])],
  move: (from, to) => {
    commit(
      () => {
        S.chips[props.row] = moved(S.chips[props.row], from, to);
      },
      { key: `chip-order-${props.row}-${sortSession}`, hold: true, label: `${ROW_NAME[props.row]}的快捷排序` },
    );
    if (sel.value === from) sel.value = to;
  },
  done: () => {
    sortSession++;
  },
});
function remove(i: number) {
  const name = chipName(list.value[i]);
  commit(
    () => {
      S.chips[props.row].splice(i, 1);
    },
    { label: `移除快捷：${name}`, say: `已移除快捷「${name}」` },
  );
  if (sel.value === i) load(null);
  else if (sel.value != null && sel.value > i) sel.value--;
}
function reset() {
  commit(
    () => {
      S.chips[props.row] = JSON.parse(JSON.stringify(DEFAULT_CHIPS[props.row]));
    },
    { label: `${ROW_NAME[props.row]}的快捷恢復預設`, say: `${ROW_NAME[props.row]}的快捷恢復預設` },
  );
  load(null);
}

/* ---------- saving ---------- */
function save() {
  const c = {
    code: encodeRule(draft.value),
    ...(draftName.value.trim() ? { name: draftName.value.trim().slice(0, 40) } : {}),
  };
  if (sel.value == null) {
    if (list.value.length >= CHIP_MAX) {
      toast(`一排最多 ${CHIP_MAX} 個快捷，先移除幾個`);
      return;
    }
    commit(
      () => {
        S.chips[props.row].push(c);
      },
      { label: `新增快捷：${nameOf()}`, say: `已加到${ROW_NAME[props.row]}的快捷：${nameOf()}` },
    );
    sel.value = list.value.length - 1;
  } else {
    const i = sel.value;
    commit(
      () => {
        S.chips[props.row][i] = c;
      },
      { label: `修改快捷：${nameOf()}`, say: `已更新快捷「${nameOf()}」` },
    );
  }
}
function applyNow() {
  const n = nameOf();
  const ok = commit(() => applyRule(which.value, draft.value, { name: n }), {
    label: `${ROW_NAME[which.value === 'start' ? 'start' : 'end']}：${n}`,
    say: () => `${which.value === 'start' ? '開始' : '結束'}：${n}`,
  });
  if (ok) {
    bump(which.value);
    emit('close');
  }
}
const asWord = ref(false);
const wordName = ref('');
function saveWord() {
  const n = (wordName.value || draftName.value).trim().slice(0, 20);
  if (!n) {
    toast('先替這個詞取個名字');
    return;
  }
  if (/^\d/.test(n)) {
    toast('詞的名字不能用數字開頭');
    return;
  }
  const code = encodeRule(draft.value);
  const redefine = !!builtinOf(n) || S.words.some((w) => w.name === n);
  commit(
    () => {
      const i = S.words.findIndex((w) => w.name === n);
      if (i >= 0) S.words[i] = { name: n, code };
      else S.words.push({ name: n, code });
      S.wordsOff = S.wordsOff.filter((x) => x !== n);
    },
    { label: `詞彙：${n}`, say: `${redefine ? '已更新' : '已新增'}詞彙「${n}」` },
  );
  asWord.value = false;
  wordName.value = '';
}
const broken = (i: number) => !chipRule(list.value[i]);
</script>

<template>
  <div class="ce">
    <header class="ce-head">
      <h3>{{ ROW_NAME[row] }}的快捷</h3>
      <button type="button" class="chip sm" v-tip="'回到原本的快捷'" @click="reset">
        <Icon name="undo" />恢復預設
      </button>
      <button type="button" class="icon-btn sm" aria-label="關閉" @click="emit('close')"><Icon name="x" /></button>
    </header>
    <ol ref="listEl" class="ce-list" aria-label="快捷列表，拖曳把手可以排序">
      <li
        v-for="(c, i) in list"
        :key="c.code + i"
        class="ce-row"
        :data-i="i"
        :class="{ on: sel === i, sorting: sort.dragging.value === i }"
      >
        <span
          class="ce-grip"
          role="button"
          tabindex="0"
          :aria-label="`拖曳或按上下鍵移動「${chipName(c)}」`"
          @pointerdown="sort.down($event, i)"
          @pointermove="sort.move"
          @pointerup="sort.up"
          @pointercancel="sort.up"
          @keydown="sort.key($event, i)"
          ><Icon name="grip"
        /></span>
        <button type="button" class="ce-main" @click="load(i)">
          <b>{{ chipName(c) }}</b><small :class="{ bad: broken(i) }">{{ when(chipRule(c)) }}</small>
        </button>
        <button
          type="button"
          class="icon-btn xs"
          :aria-label="`移除「${chipName(c)}」`"
          v-tip="'移除'"
          @click="remove(i)"
        >
          <Icon name="x" />
        </button>
      </li>
      <li class="ce-new">
        <button type="button" class="chip sm" :aria-pressed="sel == null" @click="load(null)">
          <Icon name="plus" />新的快捷
        </button>
      </li>
    </ol>

    <div class="ce-build">
      <p class="ce-k">{{ sel == null ? '新增快捷' : `編輯「${chipName(list[sel])}」` }}</p>
      <RuleBuilder
        v-model="draft"
        :self="which"
        @name="
          (n) => {
            if (!draftName) draftName = n;
          }
        "
      />
      <label class="ce-name"
        ><span>名字</span
        ><input v-model="draftName" type="text" maxlength="40" :placeholder="autoName" aria-label="快捷的名字"
      /></label>
      <div class="ce-acts">
        <button type="button" class="btn" @click="save">
          <Icon :name="sel == null ? 'plus' : 'check'" />{{ sel == null ? '加到快捷' : '儲存' }}
        </button>
        <button type="button" class="chip" @click="applyNow">
          直接套用到{{ which === 'start' ? '開始' : '結束' }}
        </button>
        <button type="button" class="chip" :aria-expanded="asWord" @click="asWord = !asWord">存成詞…</button>
      </div>
      <div v-if="asWord" class="ce-word">
        <input
          v-model="wordName"
          type="text"
          maxlength="20"
          :placeholder="draftName || '例如：下班、發薪日、媽生日'"
          aria-label="詞的名字"
          @keydown.enter.prevent="saveWord"
        />
        <button type="button" class="btn sm" @click="saveWord">存成詞</button>
        <p class="ce-note">
          存成詞後，打字（<code>明天{{ wordName || draftName || '下班' }}</code
          >）與積木皆可用。
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ce {
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
  padding: 0.85rem 0.95rem 1rem;
}
.ce-head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.ce-head h3 {
  font-size: 0.98rem;
  font-weight: 650;
  margin-right: auto;
}
.ce-head .ic {
  width: 0.95em;
  height: 0.95em;
}
.icon-btn.sm {
  width: 2rem;
  height: 2rem;
  border-radius: 0.65rem;
}
.icon-btn.xs {
  width: 1.7rem;
  height: 1.7rem;
  border-radius: 0.5rem;
  flex: none;
}
.ce-list {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  max-height: 12.5rem;
  overflow-y: auto;
  padding: 0.15rem;
  margin: 0 -0.15rem;
}
.ce-row {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.15rem 0.25rem;
  border-radius: 0.6rem;
  background: var(--surface-2);
  transition: background 0.15s;
}
.ce-row.on {
  background: var(--accent-wash);
}
.ce-row.sorting {
  box-shadow: var(--shadow-pop);
  z-index: 2;
  position: relative;
}
.ce-grip {
  display: grid;
  place-items: center;
  width: 1.5rem;
  height: 1.9rem;
  color: var(--ink-4);
  cursor: grab;
  touch-action: none;
  border-radius: 0.4rem;
}
.ce-grip:hover {
  color: var(--ink-2);
}
.ce-grip .ic {
  width: 0.95em;
  height: 0.95em;
}
.ce-main {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 0.55rem;
  padding: 0.3rem 0.2rem;
  text-align: left;
}
.ce-main b {
  font-size: 0.9rem;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ce-main small {
  font-size: var(--fs-xs);
  color: var(--ink-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-variant-numeric: tabular-nums;
}
.ce-main small.bad {
  color: var(--now);
}
.ce-new {
  padding: 0.2rem 0 0;
}
.ce-new .ic,
.ce-acts .ic {
  width: 0.95em;
  height: 0.95em;
}
.ce-build {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  padding-top: 0.65rem;
  border-top: 1px solid var(--hair);
}
.ce-k {
  font-size: var(--fs-s);
  font-weight: 650;
  color: var(--ink-2);
}
.ce-name {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: var(--fs-s);
  color: var(--ink-3);
}
.ce-name input,
.ce-word input {
  flex: 1;
  min-width: 0;
  height: 2.1rem;
  padding: 0 0.6rem;
  border-radius: 0.6rem;
  border: 1px solid var(--hair-2);
  background: var(--surface-2);
  color: var(--ink);
  font: inherit;
  font-size: 0.9rem;
}
.ce-name input:focus,
.ce-word input:focus {
  border-color: var(--accent);
  outline: none;
}
.ce-acts {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}
.ce-word {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
}
.ce-note {
  flex-basis: 100%;
  font-size: var(--fs-xs);
  color: var(--ink-3);
  line-height: 1.5;
}
.ce-note code {
  font-family: var(--f-mono);
  color: var(--accent);
}
.chip.sm {
  height: 1.85rem;
  padding: 0 0.55rem;
  font-size: var(--fs-s);
}
@media (pointer: coarse) {
  .ce-grip {
    width: 2.2rem;
    height: 2.4rem;
  }
  .icon-btn.xs {
    width: 2.2rem;
    height: 2.2rem;
  }
}
</style>
