<script setup lang="ts">
import { ref, computed } from 'vue';
import Icon from './Icon.vue';
import CommandBar from './CommandBar.vue';
import Popover from './Popover.vue';
import { S, history, undo, redo, now, startWall, DENSITY, type Theme } from '../state/store';

defineProps<{ compact?: boolean }>();
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const mod = isMac ? '⌘' : 'Ctrl ';
const THEME_NAME: Record<Theme, string> = { system: '跟隨系統', light: '淺色', dark: '深色' };
const THEME_ICON: Record<Theme, string> = { system: 'auto', light: 'sun', dark: 'moon' };
const undoTip = computed(() => (history.undo.length ? `復原：${history.undo[history.undo.length - 1].label || '上一步'}（${mod}Z）` : '沒有可以復原的步驟'));
const redoTip = computed(() => (history.redo.length ? `重做：${history.redo[history.redo.length - 1].label || '下一步'}（${isMac ? '⇧⌘Z' : 'Ctrl Y'}）` : '沒有可以重做的步驟'));
const helpBtn = ref<HTMLElement | null>(null);
const help = ref(false);

/* ---------- display settings ---------- */
const setBtn = ref<HTMLElement | null>(null);
const settings = ref(false);
const THEMES: Theme[] = ['system', 'light', 'dark'];
const dIdx = computed({
  get: () => Math.max(0, DENSITY.findIndex((d) => d.v === S.density)),
  set: (i: number) => { S.density = DENSITY[Math.max(0, Math.min(DENSITY.length - 1, i))].v; },
});
const dNow = computed(() => DENSITY[dIdx.value]);
const floorPx = computed(() => Math.max(9, 11 * S.density / 100));
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
        <g class="dm-ticks"><line v-for="i in 12" :key="i" x1="20" y1="3.6" x2="20" :y2="i % 3 === 0 ? 7.4 : 5.8" :class="{ q: i % 3 === 0 }" :transform="`rotate(${i * 30} 20 20)`" /></g>
        <line x1="20" y1="20" x2="20" y2="11.5" class="dm-h" :transform="`rotate(${hands.h} 20 20)`" />
        <line x1="20" y1="20" x2="20" y2="7.5" class="dm-m" :transform="`rotate(${hands.m} 20 20)`" />
        <line x1="20" y1="23" x2="20" y2="6" class="dm-s" :transform="`rotate(${hands.s} 20 20)`" />
        <circle cx="20" cy="20" r="1.6" class="dm-pin" />
      </svg>
      <h1 v-if="!compact">時間計算機</h1>
    </div>
    <CommandBar :compact="compact" />
    <div class="top-tools">
      <button type="button" class="icon-btn" :disabled="!history.undo.length" v-tip="undoTip" aria-label="復原" @click="undo"><Icon name="undo" /></button>
      <button type="button" class="icon-btn" :disabled="!history.redo.length" v-tip="redoTip" aria-label="重做" @click="redo"><Icon name="redo" /></button>
      <button ref="helpBtn" type="button" class="icon-btn" v-tip="'怎麼用'" aria-label="怎麼用" :aria-expanded="help" @click="help = !help"><span class="q">?</span></button>
      <button ref="setBtn" type="button" class="icon-btn" v-tip="setTip" aria-label="顯示設定" :aria-expanded="settings" @click="settings = !settings"><Icon name="sliders" /></button>
    </div>
    <Popover :open="settings" :anchor="setBtn" label="顯示設定" width="21rem" align="end" @close="settings = false">
      <div class="sets">
        <div class="set">
          <span class="set-k">外觀</span>
          <div class="seg-ctl" role="group" aria-label="外觀">
            <button v-for="t in THEMES" :key="t" type="button" :aria-pressed="S.theme === t" @click="S.theme = t"><Icon :name="THEME_ICON[t]" />{{ THEME_NAME[t] }}</button>
          </div>
        </div>
        <div class="set">
          <span class="set-k">字級</span>
          <div class="set-range">
            <input v-model.number="dIdx" type="range" min="0" :max="DENSITY.length - 1" step="1" aria-label="字級與密度" :aria-valuetext="`${dNow.name} ${dNow.v}%`" />
            <span class="set-v"><b>{{ dNow.name }}</b> {{ dNow.v }}%</span>
          </div>
          <p class="set-note">越緊湊，一個畫面放得越多。最小的字約 {{ floorPx.toFixed(1) }}px<template v-if="floorPx < 11">（比預設的 11px 小）</template>。</p>
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
    <Popover :open="help" :anchor="helpBtn" label="怎麼用" width="25rem" align="end" @close="help = false">
      <div class="help">
        <p class="help-lead"><b>開始 + 間隔 = 結束。</b>改任何一個，另外兩個跟著算好。</p>
        <ul>
          <li><span class="hk hk-dash">虛線底</span>的字可以直接改。數字欄可以打字、按 <span class="kbd">↑</span><span class="kbd">↓</span> 或滾輪。</li>
          <li><span class="hk"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 9h9.5A1.5 1.5 0 0 1 20 10.5V19.5A1.5 1.5 0 0 1 18.5 21H10.5A1.5 1.5 0 0 1 9 19.5Z M15 9V5.5A1.5 1.5 0 0 0 13.5 4H5.5A1.5 1.5 0 0 0 4 5.5V13.5A1.5 1.5 0 0 0 5.5 15H9" /></svg></span>旁邊有複製圖示的，點一下就複製。</li>
          <li>中間的間隔可以<b>左右拖曳</b>數字，或點一下輸入 <code>+30天</code>、<code>47m × 16</code>。</li>
          <li>時區條和月曆上的 <i class="node" /> <i class="node end" /> 可以拖曳；點一下會移動比較近的那一端。</li>
          <li>任何文字（日期、時間戳、東京 15:00）都可以打在最上面的框，或在空白處直接貼上。</li>
          <li><span class="kbd">{{ mod }}K</span> 或 <span class="kbd">/</span> 輸入，<span class="kbd">{{ mod }}Z</span> 復原，<span class="kbd">{{ isMac ? '⇧⌘Z' : 'Ctrl Y' }}</span> 重做。</li>
        </ul>
      </div>
    </Popover>
  </header>
</template>

<style scoped>
.top { display: flex; align-items: center; gap: 1rem; min-width: 0; }
.top.compact { gap: .5rem; }
.brand { display: flex; align-items: center; gap: .6rem; flex: none; }
.brand h1 { font-size: 1.08rem; font-weight: 700; letter-spacing: .02em; white-space: nowrap; }
.mark { width: 2.1rem; height: 2.1rem; display: block; }
.top-tools { display: flex; align-items: center; gap: .15rem; flex: none; margin-left: auto; }
.compact .top-tools { gap: 0; }
.compact .top-tools .icon-btn { width: 2.1rem; }
.q { font-weight: 700; font-size: 1.02rem; line-height: 1; }
.help { padding: 1rem 1.1rem 1.1rem; font-size: .9rem; line-height: 1.55; color: var(--ink-2); }
.help-lead { color: var(--ink); margin-bottom: .6rem; }
.help ul { display: flex; flex-direction: column; gap: .5rem; }
.help li { padding-left: .1rem; }
.help code { font-family: var(--f-mono); font-stretch: 75%; font-size: max(var(--floor), .82rem); color: var(--accent); }
.hk { display: inline-flex; align-items: center; gap: .2rem; color: var(--ink); font-weight: 600; }
.hk-dash { background-image: linear-gradient(to right, var(--ink-3) 45%, transparent 45%); background-size: .32rem 1px; background-repeat: repeat-x; background-position: 0 100%; }
.help .kbd { margin: 0 .1rem; }
.sets { display: flex; flex-direction: column; gap: .9rem; padding: 1rem 1.1rem 1.1rem; }
.set { display: flex; flex-direction: column; gap: .4rem; }
.set-k { font-size: var(--fs-s); font-weight: 650; color: var(--ink-2); }
.set .seg-ctl { align-self: flex-start; flex-wrap: wrap; }
.set .seg-ctl .ic { width: 1em; height: 1em; }
.set-range { display: flex; align-items: center; gap: .8rem; }
.set-range input { flex: 1; min-width: 0; accent-color: var(--accent); }
.set-v { font-size: .86rem; color: var(--ink-3); white-space: nowrap; font-variant-numeric: tabular-nums; }
.set-v b { color: var(--ink); font-weight: 650; }
.set-note { font-size: var(--fs-xs); line-height: 1.5; color: var(--ink-3); }
.dial-mark { width: 2.3rem; height: 2.3rem; }
.dm-case { fill: var(--surface-2); stroke: var(--hair-2); stroke-width: 1; }
.dm-ticks line { stroke: var(--ink-4); stroke-width: 1; stroke-linecap: round; }
.dm-ticks line.q { stroke: var(--ink-2); stroke-width: 1.5; }
.dm-h, .dm-m { stroke: var(--accent); stroke-linecap: round; }
.dm-h { stroke-width: 2.6; }
.dm-m { stroke-width: 1.7; }
.dm-s { stroke: var(--now); stroke-width: 1; stroke-linecap: round; }
.dm-pin { fill: var(--now); }
</style>
