<script setup lang="ts">
import { computed } from 'vue';
import Icon from './Icon.vue';
import { S, PANELS, VIEW_PRESETS, shown, togglePanel, applyPreset, presetNow } from '../state/store';
import { ui, toggleFullscreen, canFullscreen } from '../state/ui';

const cur = computed(() => presetNow());
const main = PANELS.filter((p) => !p.part);
const parts = PANELS.filter((p) => p.part);
const all = VIEW_PRESETS[0];
const allShown = computed(() => cur.value?.k === 'all');
</script>

<template>
  <div class="pm">
    <section class="pm-sec">
      <h3>預設組合<span class="kbd">P</span></h3>
      <div class="pm-presets">
        <button
          v-for="p in VIEW_PRESETS"
          :key="p.k"
          type="button"
          class="chip sm"
          :aria-pressed="cur?.k === p.k"
          v-tip="p.tip"
          @click="applyPreset(p)"
        >
          {{ p.name }}
        </button>
      </div>
    </section>
    <section class="pm-sec">
      <h3>面板<small>單一面板自動滿版</small></h3>
      <div class="pm-list">
        <button
          v-for="d in main"
          :key="d.k"
          type="button"
          class="pm-i"
          role="switch"
          :aria-checked="shown(d.k)"
          v-tip="d.tip"
          @click="togglePanel(d.k)"
        >
          <span class="pm-box" aria-hidden="true"><Icon v-if="shown(d.k)" name="check" /></span
          ><span class="pm-n">{{ d.name }}</span
          ><span class="kbd">{{ d.key.toUpperCase() }}</span>
        </button>
      </div>
      <h3>細節</h3>
      <div class="pm-list">
        <button
          v-for="d in parts"
          :key="d.k"
          type="button"
          class="pm-i"
          role="switch"
          :aria-checked="shown(d.k)"
          v-tip="d.tip"
          @click="togglePanel(d.k)"
        >
          <span class="pm-box" aria-hidden="true"><Icon v-if="shown(d.k)" name="check" /></span
          ><span class="pm-n">{{ d.name }}</span
          ><span class="kbd">{{ d.key.toUpperCase() }}</span>
        </button>
      </div>
    </section>
    <section class="pm-sec pm-row">
      <span class="pm-l">月曆</span>
      <div class="seg-ctl" role="group" aria-label="月曆或年曆">
        <button type="button" :aria-pressed="S.calMode === 'month'" @click="S.calMode = 'month'">一個月</button>
        <button type="button" :aria-pressed="S.calMode === 'year'" @click="S.calMode = 'year'">整年</button>
      </div>
      <span class="kbd">Y</span>
    </section>
    <section class="pm-sec pm-acts">
      <button v-if="canFullscreen" type="button" class="btn sm" @click="toggleFullscreen()">
        <Icon :name="ui.fullscreen ? 'shrink' : 'full'" />{{ ui.fullscreen ? '離開全螢幕' : '全螢幕'
        }}<span class="kbd">F</span>
      </button>
      <button type="button" class="btn sm" :disabled="allShown" @click="applyPreset(all)">
        <Icon name="panels" />全部顯示<span class="kbd">0</span>
      </button>
    </section>
    <p class="pm-note">未打字時按鍵生效 · 隱藏頂列後按 <span class="kbd">/</span> 叫回輸入框</p>
  </div>
</template>

<style scoped>
.pm {
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
  padding: 0.85rem 1rem 1rem;
}
.pm-sec {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}
.pm h3 {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  font-size: var(--fs-s);
  font-weight: 650;
  color: var(--ink-2);
}
.pm h3 small {
  font-size: var(--fs-xs);
  font-weight: 500;
  color: var(--ink-3);
}
.pm-presets {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
}
.chip.sm {
  height: 1.85rem;
  padding: 0 0.6rem;
  font-size: var(--fs-s);
}
.pm-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(8.2rem, 1fr));
  gap: 0.25rem;
}
.pm-i {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  height: 2.1rem;
  padding: 0 0.5rem;
  border-radius: 0.6rem;
  text-align: left;
  color: var(--ink-3);
  transition:
    background 0.15s,
    color 0.15s;
}
.pm-i:hover {
  background: var(--accent-wash);
  color: var(--accent);
}
.pm-i[aria-checked='true'] {
  color: var(--ink);
}
.pm-box {
  flex: none;
  display: grid;
  place-items: center;
  width: 1.1rem;
  height: 1.1rem;
  border-radius: 0.32rem;
  border: 1.5px solid var(--ink-4);
  color: var(--accent-ink);
}
.pm-i[aria-checked='true'] .pm-box {
  background: var(--accent);
  border-color: var(--accent);
}
.pm-box .ic {
  width: 0.85rem;
  height: 0.85rem;
  stroke-width: 2.6;
}
.pm-n {
  flex: 1;
  min-width: 0;
  font-size: 0.88rem;
  font-weight: 550;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pm-row {
  flex-direction: row;
  align-items: center;
  gap: 0.6rem;
}
.pm-l {
  font-size: var(--fs-s);
  font-weight: 650;
  color: var(--ink-2);
}
.pm-acts {
  flex-direction: row;
  flex-wrap: wrap;
  gap: 0.4rem;
}
.btn.sm {
  height: 2rem;
  padding: 0 0.65rem;
  font-size: var(--fs-s);
}
.btn .kbd {
  margin-left: 0.2rem;
}
.btn .ic {
  width: 1em;
  height: 1em;
}
.pm-note {
  font-size: var(--fs-xs);
  line-height: 1.55;
  color: var(--ink-3);
}
</style>
