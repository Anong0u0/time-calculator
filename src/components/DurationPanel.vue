<script setup lang="ts">
/* The duration calculator as a lens: its own column when the window has room for four. */
import { ref, watch, nextTick, onMounted } from 'vue';
import Icon from './Icon.vue';
import DurationCalc from './DurationCalc.vue';
import { ui } from '../state/ui';

const calc = ref<InstanceType<typeof DurationCalc> | null>(null);
const flashing = ref(false);
/* A request can arrive just before this lens mounts (its tab opens because of it), so answer on mount too. */
async function answer() {
  if (ui.durReq === ui.durSeen) return;
  ui.durSeen = ui.durReq;
  flashing.value = false;
  requestAnimationFrame(() => { flashing.value = true; });
  await nextTick();
  calc.value?.select();
}
watch(() => ui.durReq, answer);
onMounted(answer);
</script>

<template>
  <section class="panel du" :class="{ flash: flashing }" aria-label="時長" @animationend="flashing = false">
    <header class="panel-head">
      <Icon name="calc" class="ph-ic" />
      <h2>時長</h2>
      <span class="panel-sub">加減乘除時間長度，不會動到開始和結束</span>
    </header>
    <div class="du-body"><DurationCalc ref="calc" /></div>
  </section>
</template>

<style scoped>
.ph-ic { color: var(--ink-3); }
.du-body { flex: 1; min-height: 0; display: flex; flex-direction: column; padding: .55rem 1rem .9rem; overflow: hidden; }
.du-body > .dc { flex: 1; }
</style>
