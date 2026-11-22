<script setup lang="ts">
import { ref, computed } from 'vue';
import Icon from './Icon.vue';
import CommandBar from './CommandBar.vue';
import Popover from './Popover.vue';
import { S, history, undo, redo, type Theme } from '../state/store';

defineProps<{ compact?: boolean }>();
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const mod = isMac ? '⌘' : 'Ctrl ';
const NEXT: Record<Theme, Theme> = { system: 'light', light: 'dark', dark: 'system' };
const THEME_NAME: Record<Theme, string> = { system: '跟隨系統', light: '淺色', dark: '深色' };
const THEME_ICON: Record<Theme, string> = { system: 'auto', light: 'sun', dark: 'moon' };
const themeTip = computed(() => `外觀：${THEME_NAME[S.theme]}。點一下換成${THEME_NAME[NEXT[S.theme]]}`);
const undoTip = computed(() => (history.undo.length ? `復原：${history.undo[history.undo.length - 1].label || '上一步'}（${mod}Z）` : '沒有可以復原的步驟'));
const redoTip = computed(() => (history.redo.length ? `重做：${history.redo[history.redo.length - 1].label || '下一步'}（${isMac ? '⇧⌘Z' : 'Ctrl Y'}）` : '沒有可以重做的步驟'));
const helpBtn = ref<HTMLElement | null>(null);
const help = ref(false);
</script>

<template>
  <header class="top" :class="{ compact }">
    <div class="brand" aria-label="時間計算機">
      <svg class="mark" viewBox="0 0 32 32" aria-hidden="true">
        <rect x="1" y="1" width="30" height="30" rx="9" class="mark-bg" />
        <circle cx="9.5" cy="16" r="3.6" class="mark-s" />
        <path d="M13.6 16h4.8" class="mark-l" />
        <circle cx="22.5" cy="16" r="3" class="mark-e" />
      </svg>
      <h1 v-if="!compact">時間計算機</h1>
    </div>
    <CommandBar :compact="compact" />
    <div class="top-tools">
      <button type="button" class="icon-btn" :disabled="!history.undo.length" v-tip="undoTip" aria-label="復原" @click="undo"><Icon name="undo" /></button>
      <button type="button" class="icon-btn" :disabled="!history.redo.length" v-tip="redoTip" aria-label="重做" @click="redo"><Icon name="redo" /></button>
      <button ref="helpBtn" type="button" class="icon-btn" v-tip="'怎麼用'" aria-label="怎麼用" :aria-expanded="help" @click="help = !help"><span class="q">?</span></button>
      <button type="button" class="icon-btn" v-tip="themeTip" :aria-label="themeTip" @click="S.theme = NEXT[S.theme]"><Icon :name="THEME_ICON[S.theme]" /></button>
    </div>
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
.mark-bg { fill: var(--accent); }
.mark-s { fill: var(--accent-ink); }
.mark-e { fill: none; stroke: var(--accent-ink); stroke-width: 2.2; }
.mark-l { stroke: var(--accent-ink); stroke-width: 2.2; stroke-linecap: round; opacity: .7; }
.top-tools { display: flex; align-items: center; gap: .15rem; flex: none; margin-left: auto; }
.compact .top-tools { gap: 0; }
.compact .top-tools .icon-btn { width: 2.1rem; }
.q { font-weight: 700; font-size: 1.02rem; line-height: 1; }
.help { padding: 1rem 1.1rem 1.1rem; font-size: .9rem; line-height: 1.55; color: var(--ink-2); }
.help-lead { color: var(--ink); margin-bottom: .6rem; }
.help ul { display: flex; flex-direction: column; gap: .5rem; }
.help li { padding-left: .1rem; }
.help code { font-family: var(--f-mono); font-stretch: 75%; font-size: max(11px, .82rem); color: var(--accent); }
.hk { display: inline-flex; align-items: center; gap: .2rem; color: var(--ink); font-weight: 600; }
.hk-dash { background-image: linear-gradient(to right, var(--ink-3) 45%, transparent 45%); background-size: .32rem 1px; background-repeat: repeat-x; background-position: 0 100%; }
.help .kbd { margin: 0 .1rem; }
</style>
