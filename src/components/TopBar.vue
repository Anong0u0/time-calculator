<script setup lang="ts">
import { ref, computed } from 'vue';
import Icon from './Icon.vue';
import CommandBar from './CommandBar.vue';
import Popover from './Popover.vue';
import VocabPanel from './VocabPanel.vue';
import PanelMenu from './PanelMenu.vue';
import { S, history, undo, redo, now, startWall, DENSITY, type Theme } from '../state/store';
import { copiedKey, copyText } from '../composables/copy';

const props = defineProps<{ compact?: boolean; search: string }>();
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const mod = isMac ? '⌘' : 'Ctrl ';
const THEME_NAME: Record<Theme, string> = { system: '跟隨系統', light: '淺色', dark: '深色' };
const THEME_ICON: Record<Theme, string> = { system: 'auto', light: 'sun', dark: 'moon' };
const undoTip = computed(() =>
  history.undo.length
    ? `復原：${history.undo[history.undo.length - 1].label || '上一步'}（${mod}Z · 右鍵看步驟）`
    : '無可復原步驟',
);
const redoTip = computed(() =>
  history.redo.length
    ? `重做：${history.redo[history.redo.length - 1].label || '下一步'}（${isMac ? '⇧⌘Z' : 'Ctrl Y'} · 右鍵看步驟）`
    : '無可重做步驟',
);
const histBtn = ref<HTMLElement | null>(null);
const hist = ref(false);
let holdTimer: ReturnType<typeof setTimeout> | undefined,
  held = false;
function holdDown(e: PointerEvent) {
  held = false;
  if (e.pointerType === 'mouse') return;
  const el = e.currentTarget as HTMLElement;
  holdTimer = setTimeout(() => {
    held = true;
    histBtn.value = el;
    hist.value = true;
  }, 480);
}
function holdUp() {
  clearTimeout(holdTimer);
}
function openHist(e: MouseEvent) {
  histBtn.value = e.currentTarget as HTMLElement;
  hist.value = true;
}
function clickUndo() {
  if (held) {
    held = false;
    return;
  }
  undo();
}
function clickRedo() {
  if (held) {
    held = false;
    return;
  }
  redo();
}
function backTo(i: number) {
  const n = history.undo.length - i;
  for (let k = 0; k < n; k++) undo();
}
function forwardTo(j: number) {
  for (let k = 0; k <= j; k++) redo();
}
const linkCopied = computed(() => copiedKey.value === 'share');
function copyLink() {
  copyText(location.origin + location.pathname + props.search + location.hash, 'share', '連結');
}
const helpBtn = ref<HTMLElement | null>(null);
const help = ref(false);

const setBtn = ref<HTMLElement | null>(null);
const settings = ref(false);
const setTab = ref<'show' | 'panels' | 'rules'>('show');
const panBtn = ref<HTMLElement | null>(null);
const panels = ref(false);
const THEMES: Theme[] = ['system', 'light', 'dark'];
const dIdx = computed({
  get: () =>
    Math.max(
      0,
      DENSITY.findIndex((d) => d.v === S.density),
    ),
  set: (i: number) => {
    S.density = DENSITY[Math.max(0, Math.min(DENSITY.length - 1, i))].v;
  },
});
const dNow = computed(() => DENSITY[dIdx.value]);
const setTip = computed(() => `顯示設定（${THEME_NAME[S.theme]} · ${dNow.value.name}）`);

const hands = computed(() => {
  const w = startWall.value;
  const sec = S.live ? Math.floor(now.value / 1000) % 60 : w.s;
  return { h: ((w.h % 12) + w.mi / 60) * 30, m: (w.mi + sec / 60) * 6, s: sec * 6 };
});
</script>

<template>
  <header class="top" :class="{ compact }">
    <div class="brand" aria-label="時間計算機">
      <svg class="mark dial-mark" viewBox="0 0 40 40" aria-hidden="true">
        <circle cx="20" cy="20" r="19" class="dm-case" />
        <g class="dm-ticks">
          <line
            v-for="i in 12"
            :key="i"
            x1="20"
            y1="3.6"
            x2="20"
            :y2="i % 3 === 0 ? 7.4 : 5.8"
            :class="{ q: i % 3 === 0 }"
            :transform="`rotate(${i * 30} 20 20)`"
          />
        </g>
        <line x1="20" y1="20" x2="20" y2="11.5" class="dm-h" :transform="`rotate(${hands.h} 20 20)`" />
        <line x1="20" y1="20" x2="20" y2="7.5" class="dm-m" :transform="`rotate(${hands.m} 20 20)`" />
        <line x1="20" y1="23" x2="20" y2="6" class="dm-s" :transform="`rotate(${hands.s} 20 20)`" />
        <circle cx="20" cy="20" r="1.6" class="dm-pin" />
      </svg>
      <h1 v-if="!compact">時間計算機</h1>
    </div>
    <CommandBar :compact="compact" />
    <div class="top-tools">
      <button
        type="button"
        class="icon-btn"
        :class="{ ok: linkCopied }"
        v-tip="'複製連結'"
        aria-label="複製這個畫面的連結"
        @click="copyLink"
      >
        <Icon :name="linkCopied ? 'check' : 'link'" />
      </button>
      <button
        type="button"
        class="icon-btn"
        :disabled="!history.undo.length && !history.redo.length"
        v-tip="undoTip"
        aria-label="復原（右鍵看全部步驟）"
        :class="{ off: !history.undo.length }"
        @click="clickUndo"
        @contextmenu.prevent="openHist"
        @pointerdown="holdDown"
        @pointerup="holdUp"
        @pointercancel="holdUp"
        @pointerleave="holdUp"
      >
        <Icon name="undo" />
      </button>
      <button
        type="button"
        class="icon-btn"
        :disabled="!history.redo.length && !history.undo.length"
        v-tip="redoTip"
        aria-label="重做（右鍵看全部步驟）"
        :class="{ off: !history.redo.length }"
        @click="clickRedo"
        @contextmenu.prevent="openHist"
        @pointerdown="holdDown"
        @pointerup="holdUp"
        @pointercancel="holdUp"
        @pointerleave="holdUp"
      >
        <Icon name="redo" />
      </button>
      <button
        ref="helpBtn"
        type="button"
        class="icon-btn"
        v-tip="'快捷鍵與操作'"
        aria-label="快捷鍵與操作"
        :aria-expanded="help"
        @click="help = !help"
      >
        <span class="q">?</span>
      </button>
      <button
        v-if="!compact"
        ref="panBtn"
        type="button"
        class="icon-btn"
        v-tip="'面板（1–9、P、F）'"
        aria-label="面板"
        :aria-expanded="panels"
        @click="panels = !panels"
      >
        <Icon name="panels" />
      </button>
      <button
        ref="setBtn"
        type="button"
        class="icon-btn"
        v-tip="setTip"
        aria-label="顯示設定"
        :aria-expanded="settings"
        @click="settings = !settings"
      >
        <Icon name="sliders" />
      </button>
    </div>
    <Popover :open="panels" :anchor="panBtn" label="面板" width="24rem" align="end" @close="panels = false"
      ><PanelMenu
    /></Popover>
    <Popover
      :open="settings"
      :anchor="setBtn"
      label="設定"
      :width="setTab === 'rules' ? '34rem' : setTab === 'panels' ? '24rem' : '21rem'"
      align="end"
      :tall="setTab === 'rules'"
      @close="settings = false"
    >
      <div class="set-tabs seg-ctl" role="tablist">
        <button
          type="button"
          role="tab"
          :aria-selected="setTab === 'show'"
          :aria-pressed="setTab === 'show'"
          @click="setTab = 'show'"
        >
          顯示
        </button>
        <button
          type="button"
          role="tab"
          :aria-selected="setTab === 'panels'"
          :aria-pressed="setTab === 'panels'"
          @click="setTab = 'panels'"
        >
          面板
        </button>
        <button
          type="button"
          role="tab"
          :aria-selected="setTab === 'rules'"
          :aria-pressed="setTab === 'rules'"
          @click="setTab = 'rules'"
        >
          規則與詞彙
        </button>
      </div>
      <div v-if="setTab === 'rules'" class="sets"><VocabPanel /></div>
      <PanelMenu v-else-if="setTab === 'panels'" />
      <div v-else class="sets">
        <div class="set">
          <span class="set-k">外觀</span>
          <div class="seg-ctl" role="group" aria-label="外觀">
            <button v-for="t in THEMES" :key="t" type="button" :aria-pressed="S.theme === t" @click="S.theme = t">
              <Icon :name="THEME_ICON[t]" />{{ THEME_NAME[t] }}
            </button>
          </div>
        </div>
        <div class="set">
          <span class="set-k">字級</span>
          <div class="set-range">
            <input
              v-model.number="dIdx"
              type="range"
              min="0"
              :max="DENSITY.length - 1"
              step="1"
              aria-label="字級與密度"
              :aria-valuetext="`${dNow.name} ${dNow.v}%`"
            />
            <span class="set-v"
              ><b>{{ dNow.name }}</b> {{ dNow.v }}%</span
            >
          </div>
        </div>
        <div class="set">
          <span class="set-k">農曆與節氣</span>
          <div class="seg-ctl" role="group" aria-label="農曆與節氣">
            <button type="button" :aria-pressed="S.prefs.lunar" @click="S.prefs.lunar = true">顯示</button>
            <button type="button" :aria-pressed="!S.prefs.lunar" @click="S.prefs.lunar = false">隱藏</button>
          </div>
        </div>
        <div class="set">
          <span class="set-k">世界地圖</span>
          <div class="seg-ctl" role="group" aria-label="世界地圖">
            <button type="button" :aria-pressed="S.map" @click="S.map = true">有空間就顯示</button>
            <button type="button" :aria-pressed="!S.map" @click="S.map = false">隱藏</button>
          </div>
        </div>
      </div>
    </Popover>
    <Popover :open="hist" :anchor="histBtn" label="全部步驟" width="20rem" align="end" @close="hist = false">
      <div class="hist">
        <p class="hist-k">點選回到該步驟</p>
        <ol>
          <li v-for="(r, j) in [...history.redo].reverse()" :key="'r' + j">
            <button
              type="button"
              class="hist-i redo"
              @click="
                forwardTo(history.redo.length - 1 - j);
                hist = false;
              "
            >
              <Icon name="redo" />{{ r.label || '一步' }}
            </button>
          </li>
          <li>
            <span class="hist-i now"><i class="dot-now" />現在</span>
          </li>
          <li v-for="(u, i) in [...history.undo].reverse()" :key="'u' + i">
            <button
              type="button"
              class="hist-i"
              @click="
                backTo(history.undo.length - 1 - i);
                hist = false;
              "
            >
              <Icon name="undo" />{{ u.label || '一步' }}
            </button>
          </li>
        </ol>
        <p v-if="!history.undo.length && !history.redo.length" class="hist-k">還沒有任何步驟</p>
      </div>
    </Popover>
    <Popover :open="help" :anchor="helpBtn" label="快捷鍵與操作" width="24rem" align="end" @close="help = false">
      <div class="help">
        <p class="help-lead"><b>開始 + 間隔 = 結束</b>，改任一處自動連動。</p>
        <ul>
          <li>
            <span class="kbd">{{ mod }}K</span> <span class="kbd">/</span> 輸入（空白處可直接貼上）
          </li>
          <li>
            <span class="kbd">{{ mod }}Z</span> 復原 · <span class="kbd">{{ isMac ? '⇧⌘Z' : 'Ctrl Y' }}</span>
            重做（右鍵看全部步驟）
          </li>
          <li>
            <span class="kbd">1</span>–<span class="kbd">9</span> <span class="kbd">R</span>
            <span class="kbd">M</span> 開關面板 · <span class="kbd">P</span> 預設 · <span class="kbd">0</span> 全部
          </li>
          <li>
            <span class="kbd">Y</span> 月／年曆 · <span class="kbd">F</span> 全螢幕 · 日期上按
            <span class="kbd">S</span> / <span class="kbd">E</span> 設起訖
          </li>
          <li>
            <span class="hk hk-dash">虛線底</span>可直接改寫；數字欄支援 <span class="kbd">↑</span
            ><span class="kbd">↓</span> 與滾輪
          </li>
          <li>拖曳 <i class="node" /> <i class="node end" /> 與間隔數字調整；拖曳 <code>=</code> 切換連動方向</li>
          <li>
            快捷右鍵／長按編輯、拖曳排序或套用；<span class="hk"><Icon name="copy" /></span> 複製、<span class="hk"
              ><Icon name="edit"
            /></span>
            原地改寫
          </li>
        </ul>
      </div>
    </Popover>
  </header>
</template>

<style scoped>
.top {
  display: flex;
  align-items: center;
  gap: 1rem;
  min-width: 0;
}
.top.compact {
  gap: 0.5rem;
}
.brand {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex: none;
}
.brand h1 {
  font-size: 1.08rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  white-space: nowrap;
}
.mark {
  width: 2.1rem;
  height: 2.1rem;
  display: block;
}
.top-tools {
  display: flex;
  align-items: center;
  gap: 0.15rem;
  flex: none;
  margin-left: auto;
}
.compact .top-tools {
  gap: 0;
}
.compact .top-tools .icon-btn {
  width: 2.1rem;
}
.icon-btn.ok,
.icon-btn.ok:hover {
  color: var(--good) !important;
}
.icon-btn.off {
  opacity: 0.4;
}
.hist {
  padding: 0.7rem 0.6rem 0.8rem;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.hist-k {
  font-size: var(--fs-xs);
  color: var(--ink-3);
  padding: 0 0.4rem;
}
.hist ol {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  max-height: 22rem;
  overflow-y: auto;
}
.hist-i {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.4rem 0.5rem;
  border-radius: 0.55rem;
  font-size: 0.88rem;
  color: var(--ink-2);
  text-align: left;
}
button.hist-i:hover {
  background: var(--accent-wash);
  color: var(--accent);
}
.hist-i .ic {
  width: 0.9em;
  height: 0.9em;
  color: var(--ink-4);
  flex: none;
}
.hist-i.redo {
  color: var(--ink-3);
}
.hist-i.now {
  color: var(--ink);
  font-weight: 650;
}
.dot-now {
  display: inline-block;
  width: 0.45rem;
  height: 0.45rem;
  border-radius: 50%;
  background: var(--now);
  margin: 0 0.2rem;
}
.q {
  font-weight: 700;
  font-size: 1.02rem;
  line-height: 1;
}
.help {
  padding: 1rem 1.1rem 1.1rem;
  font-size: 0.9rem;
  line-height: 1.55;
  color: var(--ink-2);
}
.help-lead {
  color: var(--ink);
  margin-bottom: 0.6rem;
}
.help ul {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.help li {
  padding-left: 0.1rem;
}
.help code {
  font-family: var(--f-mono);
  font-stretch: 75%;
  font-size: max(var(--floor), 0.82rem);
  color: var(--accent);
}
.hk {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  color: var(--ink);
  font-weight: 600;
}
.hk-dash {
  background-image: linear-gradient(to right, var(--ink-3) 45%, transparent 45%);
  background-size: 0.32rem 1px;
  background-repeat: repeat-x;
  background-position: 0 100%;
}
.help .kbd {
  margin: 0 0.1rem;
}
.sets {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
  padding: 0.7rem 1.1rem 1.1rem;
}
.set-tabs {
  margin: 0.9rem 1.1rem 0;
  align-self: flex-start;
  display: inline-flex;
}
.set {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.set-k {
  font-size: var(--fs-s);
  font-weight: 650;
  color: var(--ink-2);
}
.set .seg-ctl {
  align-self: flex-start;
  flex-wrap: wrap;
}
.set .seg-ctl .ic {
  width: 1em;
  height: 1em;
}
.set-range {
  display: flex;
  align-items: center;
  gap: 0.8rem;
}
.set-range input {
  flex: 1;
  min-width: 0;
  accent-color: var(--accent);
}
.set-v {
  font-size: 0.86rem;
  color: var(--ink-3);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.set-v b {
  color: var(--ink);
  font-weight: 650;
}
.dial-mark {
  width: 2.3rem;
  height: 2.3rem;
}
.dm-case {
  fill: var(--surface-2);
  stroke: var(--hair-2);
  stroke-width: 1;
}
.dm-ticks line {
  stroke: var(--ink-4);
  stroke-width: 1;
  stroke-linecap: round;
}
.dm-ticks line.q {
  stroke: var(--ink-2);
  stroke-width: 1.5;
}
.dm-h,
.dm-m {
  stroke: var(--accent);
  stroke-linecap: round;
}
.dm-h {
  stroke-width: 2.6;
}
.dm-m {
  stroke-width: 1.7;
}
.dm-s {
  stroke: var(--now);
  stroke-width: 1;
  stroke-linecap: round;
}
.dm-pin {
  fill: var(--now);
}
</style>
