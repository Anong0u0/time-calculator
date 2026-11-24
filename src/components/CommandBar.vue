<script setup lang="ts">
/* One box for any text. Each reading becomes a suggestion with a preview; Enter applies the first. */
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue';
import Icon from './Icon.vue';
import { interpret, type Suggestion } from '../state/command';
import { S, bump } from '../state/store';
import { ui } from '../state/ui';

const props = defineProps<{ compact?: boolean }>();
const text = ref('');
const open = ref(false);
const sel = ref(0);
const input = ref<HTMLInputElement | null>(null);
const root = ref<HTMLElement | null>(null);
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

const EXAMPLES: [string, string][] = [
  ['2026-12-25 18:00', '日期與時刻'],
  ['1795380034', 'Unix 時間戳（秒、毫秒都可以）'],
  ['2000/1/1/20:34', '日期的寫法隨意：明天下午3點、下週五、民國115年…'],
  ['+30天', '結束 = 開始 + 30 天'],
  ['3天前', '從現在往前或往後算'],
  ['2000/1/1 到 現在', '一次設定開始和結束'],
  ['東京 15:00', '某個城市的時間'],
  ['47m × 16', '時長加減乘除'],
  ['明年中秋晚上8點', '詞可以自由組合：明晚、下個月底、冬至那一刻…'],
  ['開始那個月的月底', '從另一端算：結束前最後一個週五'],
];
const items = computed<Suggestion[]>(() => (text.value.trim() ? interpret(text.value) : []));
const actionable = computed(() => items.value.filter((s) => s.apply));
watch(text, () => {
  sel.value = Math.max(
    0,
    items.value.findIndex((s) => s.apply),
  );
});

function apply(s: Suggestion | undefined) {
  if (!s?.apply) return;
  s.apply();
  if (s.kind === 'start' || s.kind === 'end') {
    S.active = s.kind;
    bump(s.kind);
  } else if (s.kind === 'span') bump('end');
  else if (s.kind === 'range') {
    bump('start');
    bump('end');
  } else if (s.kind === 'zone') bump('zones');
  text.value = '';
  open.value = false;
  input.value?.blur();
}
function key(e: KeyboardEvent) {
  const n = items.value.length;
  if (e.key === 'ArrowDown' && n) {
    e.preventDefault();
    open.value = true;
    sel.value = (sel.value + 1) % n;
  } else if (e.key === 'ArrowUp' && n) {
    e.preventDefault();
    sel.value = (sel.value - 1 + n) % n;
  } else if (e.key === 'Enter') {
    e.preventDefault();
    apply(items.value[sel.value]);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    if (text.value) text.value = '';
    else {
      open.value = false;
      input.value?.blur();
    }
  }
}
function useExample(t: string) {
  text.value = t;
  nextTick(() => input.value?.focus());
}
function onFocus() {
  open.value = true;
}
function onDocDown(e: PointerEvent) {
  if (!root.value?.contains(e.target as Node)) open.value = false;
}
onMounted(() => document.addEventListener('pointerdown', onDocDown, true));
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDocDown, true));
watch(
  () => ui.commandReq,
  () => {
    if (ui.commandText) text.value = ui.commandText;
    open.value = true;
    nextTick(() => {
      input.value?.focus();
      if (!ui.commandText || ui.commandSelect) input.value?.select();
    });
  },
);

const KIND_ICON: Record<Suggestion['kind'], string> = {
  start: '',
  end: '',
  span: 'span',
  zone: 'globe',
  info: 'info',
  calc: 'calc',
  range: 'span',
  chip: 'bolt',
};
const placeholder = computed(() =>
  props.compact ? '輸入日期、+30天、東京 15:00…' : '輸入任何東西：日期、時間戳、+30天、東京 15:00、W12、47m × 16',
);
</script>

<template>
  <div ref="root" class="cmd" :class="{ open: open && (items.length || !text), compact }">
    <label class="cmd-box">
      <Icon name="search" />
      <input
        ref="input"
        v-model="text"
        type="text"
        :placeholder="placeholder"
        autocomplete="off"
        spellcheck="false"
        enterkeyhint="go"
        role="combobox"
        aria-label="輸入任何時間文字"
        aria-autocomplete="list"
        :aria-expanded="open"
        aria-controls="cmd-list"
        :aria-activedescendant="open && items[sel] ? `cmd-${sel}` : undefined"
        @focus="onFocus"
        @keydown="key"
      />
      <button
        v-if="text"
        type="button"
        class="cmd-clear icon-btn"
        aria-label="清除"
        @click="
          text = '';
          input?.focus();
        "
      >
        <Icon name="x" />
      </button>
      <span v-else-if="!compact" class="kbd cmd-kbd" aria-hidden="true">{{ isMac ? '⌘K' : 'Ctrl K' }}</span>
    </label>
    <div v-if="open" class="cmd-pop">
      <ul v-if="text.trim()" id="cmd-list" role="listbox" aria-label="建議">
        <li
          v-for="(s, i) in items"
          :id="`cmd-${i}`"
          :key="s.id + i"
          role="option"
          :aria-selected="i === sel"
          :aria-disabled="!s.apply"
          :class="['cmd-item', `k-${s.kind}`, { on: i === sel, info: !s.apply }]"
          @pointerenter="s.apply && (sel = i)"
          @click="apply(s)"
        >
          <span class="cmd-ic">
            <i v-if="s.kind === 'start'" class="node" />
            <i v-else-if="s.kind === 'end'" class="node end" />
            <Icon v-else :name="KIND_ICON[s.kind]" />
          </span>
          <span class="cmd-txt"
            ><b>{{ s.title }}</b
            ><small v-if="s.detail">{{ s.detail }}</small></span
          >
          <span v-if="i === sel && s.apply" class="kbd cmd-enter" aria-hidden="true">Enter</span>
        </li>
        <li v-if="!items.length" class="cmd-item info">
          <span class="cmd-ic"><Icon name="info" /></span><span class="cmd-txt"><b>繼續輸入…</b></span>
        </li>
      </ul>
      <div v-else class="cmd-examples">
        <p class="cmd-hint">
          一個框吃所有格式。先看預覽，再按 Enter 套用；<b>{{ S.active === 'start' ? '● 開始' : '○ 結束' }}</b
          >（剛碰過的那一端）排第一。
        </p>
        <ul aria-label="範例">
          <li v-for="[ex, what] in EXAMPLES" :key="ex">
            <button type="button" class="cmd-ex" @click="useExample(ex)">
              <code class="mono">{{ ex }}</code><span>{{ what }}</span>
            </button>
          </li>
        </ul>
      </div>
      <p v-if="actionable.length > 1 && text.trim()" class="cmd-foot">
        <span class="kbd">↑</span><span class="kbd">↓</span> 選擇 · <span class="kbd">Enter</span> 套用 ·
        <span class="kbd">Esc</span> 清除
      </p>
    </div>
  </div>
</template>

<style scoped>
.cmd {
  position: relative;
  flex: 1;
  min-width: 0;
  max-width: 46rem;
}
.cmd-box {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  height: 2.75rem;
  padding: 0 0.55rem 0 0.95rem;
  border-radius: 1rem;
  background: var(--surface-2);
  border: 1px solid var(--hair-2);
  color: var(--ink-3);
  box-shadow: var(--shadow);
  transition:
    border-color 0.18s,
    box-shadow 0.18s;
  cursor: text;
}
.cmd-box:hover {
  border-color: var(--accent-line);
}
.cmd-box:focus-within {
  border-color: var(--accent);
  box-shadow:
    0 0 0 3px var(--accent-wash-2),
    var(--shadow);
}
.cmd-box input {
  flex: 1;
  min-width: 0;
  height: 100%;
  border: 0;
  background: none;
  font-size: 0.98rem;
  color: var(--ink);
}
.cmd-box input::placeholder {
  color: var(--ink-3);
}
.cmd-clear {
  width: 2rem;
  height: 2rem;
}
.cmd-kbd {
  margin-right: 0.2rem;
}
.cmd-pop {
  position: absolute;
  z-index: 60;
  top: calc(100% + 0.45rem);
  left: 0;
  right: 0;
  min-width: min(30rem, calc(100vw - 16px));
  padding: 0.5rem;
  border-radius: 1.2rem;
  background: var(--surface-2);
  border: 1px solid var(--hair-2);
  box-shadow: var(--shadow-pop);
}
.compact .cmd-pop {
  position: fixed;
  top: 3.9rem;
  left: 8px;
  right: 8px;
  min-width: 0;
}
.cmd-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  min-height: 3.1rem;
  padding: 0.4rem 0.7rem;
  border-radius: 0.85rem;
  cursor: pointer;
}
.cmd-item.on {
  background: var(--accent-wash);
}
.cmd-item.info {
  cursor: default;
  color: var(--ink-3);
}
.cmd-ic {
  width: 1.9rem;
  height: 1.9rem;
  flex: none;
  display: grid;
  place-items: center;
  border-radius: 0.6rem;
  background: var(--well);
  color: var(--accent);
  font-size: 1.05rem;
}
.cmd-item.info .cmd-ic {
  color: var(--ink-3);
}
.cmd-txt {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
  line-height: 1.3;
}
.cmd-txt b {
  font-weight: 600;
  font-size: 0.95rem;
}
.cmd-txt small {
  font-size: max(var(--floor), 0.84rem);
  color: var(--ink-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cmd-item.on .cmd-txt small {
  color: var(--ink-2);
}
.cmd-enter {
  flex: none;
}
.cmd-hint {
  font-size: 0.86rem;
  color: var(--ink-3);
  padding: 0.45rem 0.7rem 0.55rem;
  line-height: 1.5;
}
.cmd-hint b {
  color: var(--ink-2);
  font-weight: 600;
}
.cmd-examples ul {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.15rem;
}
.cmd-ex {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.1rem;
  padding: 0.45rem 0.7rem;
  border-radius: 0.75rem;
  text-align: left;
}
.cmd-ex:hover,
.cmd-ex:focus-visible {
  background: var(--accent-wash);
}
.cmd-ex code {
  font-size: 0.86rem;
  color: var(--accent);
}
.cmd-ex span {
  font-size: var(--fs-s);
  color: var(--ink-3);
}
.cmd-foot {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.45rem 0.7rem 0.2rem;
  font-size: var(--fs-s);
  color: var(--ink-3);
  border-top: 1px solid var(--hair);
  margin-top: 0.35rem;
}
</style>
