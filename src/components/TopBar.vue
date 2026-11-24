<script setup lang="ts">
import { ref, computed } from 'vue';
import Icon from './Icon.vue';
import CommandBar from './CommandBar.vue';
import Popover from './Popover.vue';
import VocabPanel from './VocabPanel.vue';
import PanelMenu from './PanelMenu.vue';
import { S, history, undo, redo, now, startWall, DENSITY, type Theme } from '../state/store';
import { shareUrl } from '../state/url';
import { copiedKey, copyText } from '../composables/copy';

defineProps<{ compact?: boolean }>();
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const mod = isMac ? '⌘' : 'Ctrl ';
const THEME_NAME: Record<Theme, string> = { system: '跟隨系統', light: '淺色', dark: '深色' };
const THEME_ICON: Record<Theme, string> = { system: 'auto', light: 'sun', dark: 'moon' };
const undoTip = computed(() =>
  history.undo.length
    ? `復原：${history.undo[history.undo.length - 1].label || '上一步'}（${mod}Z）。右鍵或長按：看全部步驟`
    : '沒有可以復原的步驟',
);
const redoTip = computed(() =>
  history.redo.length
    ? `重做：${history.redo[history.redo.length - 1].label || '下一步'}（${isMac ? '⇧⌘Z' : 'Ctrl Y'}）。右鍵或長按：看全部步驟`
    : '沒有可以重做的步驟',
);
/* ---------- every step, to go back (or forward) several at once ---------- */
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
/** Go back to just before step i of the undo list (0 = the oldest), or forward through redo step j (0 = the next one). */
function backTo(i: number) {
  const n = history.undo.length - i;
  for (let k = 0; k < n; k++) undo();
}
function forwardTo(j: number) {
  for (let k = 0; k <= j; k++) redo();
}
/* the address always carries the time; this copies it */
const linkCopied = computed(() => copiedKey.value === 'share');
function copyLink() {
  copyText(shareUrl(), 'share', '連結');
}
const helpBtn = ref<HTMLElement | null>(null);
const help = ref(false);

/* ---------- display settings ---------- */
const setBtn = ref<HTMLElement | null>(null);
const settings = ref(false);
const setTab = ref<'show' | 'panels' | 'rules'>('show');
/* ---------- the panels menu: what is on the face ---------- */
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
const floorPx = computed(() => Math.max(9, (11 * S.density) / 100));
const setTip = computed(() => `顯示設定：${THEME_NAME[S.theme]} · 字級 ${dNow.value.name}`);

/* ---------- the dial logo: a watch face whose hands follow the start's clock ---------- */
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
        v-tip="'複製連結：開始、結束、時區都在網址裡，可以加入書籤或分享'"
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
        v-tip="'怎麼用'"
        aria-label="怎麼用"
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
        v-tip="'面板：顯示或隱藏每一塊，或放到滿版（數字鍵、P、F）'"
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
          <p class="set-note">
            越緊湊，一個畫面放得越多。最小的字約 {{ floorPx.toFixed(1) }}px<template v-if="floorPx < 11"
              >（比預設的 11px 小）</template
            >。
          </p>
        </div>
        <div class="set">
          <span class="set-k">農曆與節氣</span>
          <div class="seg-ctl" role="group" aria-label="農曆與節氣">
            <button type="button" :aria-pressed="S.prefs.lunar" @click="S.prefs.lunar = true">顯示</button>
            <button type="button" :aria-pressed="!S.prefs.lunar" @click="S.prefs.lunar = false">隱藏</button>
          </div>
          <p class="set-note">
            月曆每天下面的農曆、節氣與節日，讀法的農曆與節氣，以及積木和詞彙裡的農曆、節氣選項。隱藏後打字仍然讀得懂「中秋」「冬至」。
          </p>
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
        <p class="hist-k">點一個步驟，回到做完它的那時候</p>
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
    <Popover :open="help" :anchor="helpBtn" label="怎麼用" width="25rem" align="end" @close="help = false">
      <div class="help">
        <p class="help-lead"><b>開始 + 間隔 = 結束。</b>改任何一個，另外兩個跟著算好。</p>
        <ul>
          <li>
            <span class="hk hk-dash">虛線底</span>的字可以直接改。數字欄可以打字、按 <span class="kbd">↑</span
            ><span class="kbd">↓</span> 或滾輪。
          </li>
          <li>
            <span class="hk"><Icon name="copy" /></span>旁邊有複製圖示的，點一下就複製；<span class="hk"
              ><Icon name="edit" /></span
            >可以改寫。
          </li>
          <li>
            月曆標題可以直接<b>打年份</b>跳過去；在月曆上捲動滾輪換月，在週條上換年；點週次選整週。標題旁的「月／年」切換成<b
              >整年 12 個月</b
            >，點月份名稱回到那個月。
          </li>
          <li>
            網址會跟著開始、結束、時區更新，可以直接<b>加入書籤或分享</b>（右上
            <span class="hk"><Icon name="link" /></span> 複製連結）。
          </li>
          <li>中間的間隔可以<b>左右拖曳</b>數字，或點一下輸入 <code>+30天</code>、<code>47m × 16</code>。</li>
          <li>
            時區條和月曆上的 <i class="node" />
            <i class="node end" /> 可以拖曳，只移動那一端；點一下會移動比較近的那一端。手機上月曆滑動換月。
          </li>
          <li>
            任何文字都可以打在最上面的框，或在空白處直接貼上：日期怎麼寫都行（<code>2000/1/1/20:34</code>、<code>明天下午3點</code>、<code>民國115年</code>），也可以是範圍（<code
              >2000/1/1 到 現在</code
            >）或 <code>3天前</code>。
          </li>
          <li>
            開始和結束都可以設成<b>現在</b>；結束是現在時輸入 <code>+30天</code>，開始會跟著變成「現在 − 30 天」。
          </li>
          <li>讀法、時區列可以<b>拖曳把手</b>排順序；讀法的每個值都可以點筆在原地改寫。</li>
          <li>
            所有快捷都能<b>自訂</b>：按 <span class="hk"><Icon name="plus" /></span>，用積木組合（從哪裡開始 → 往後幾天
            → 對齊月底 → 挑週五 → 晚上 8
            點），不用打字；右鍵或長按快捷可以修改，用滑鼠可以拖曳排序、拖到另一排、拖出去移除。
          </li>
          <li>
            詞可以自由組合：<code>明晚</code>、<code>本週三 3點</code
            >、<code>下個月底</code>、<code>明年中秋晚上8點</code>、<code>開始那個月的月底</code>、<code>冬至那一刻</code>；也能把規則<b>存成自己的詞</b>（<code>下班</code>、<code>發薪日</code>），在設定的「規則與詞彙」管理。
          </li>
          <li>
            每一塊都能<b>隱藏</b>（右上 <span class="hk"><Icon name="panels" /></span>，或數字鍵
            <span class="kbd">1</span>–<span class="kbd">9</span>、<span class="kbd">R</span>、<span class="kbd">M</span
            >）；只剩一塊時放到滿版。<span class="kbd">P</span> 換預設組合（滿版倒數、滿版月曆、滿版年曆…），<span
              class="kbd"
              >0</span
            >
            全部顯示，<span class="kbd">Y</span> 月曆／年曆，<span class="kbd">F</span> 全螢幕。
          </li>
          <li>
            <span class="kbd">{{ mod }}K</span> 或 <span class="kbd">/</span> 輸入，<span class="kbd">{{ mod }}Z</span>
            復原，<span class="kbd">{{ isMac ? '⇧⌘Z' : 'Ctrl Y' }}</span> 重做。
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
.set-note {
  font-size: var(--fs-xs);
  line-height: 1.5;
  color: var(--ink-3);
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
