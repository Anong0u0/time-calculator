<script setup lang="ts">
import { ref, watch, nextTick, onMounted } from 'vue';
import Icon from './Icon.vue';
import DurationCalc from './DurationCalc.vue';
import { ui } from '../state/ui';
import { useFlash } from '../composables/flash';

const calc = ref<InstanceType<typeof DurationCalc> | null>(null);
const { flashing, flash } = useFlash();
async function answer() {
  if (ui.durReq === ui.durSeen) return;
  ui.durSeen = ui.durReq;
  flash();
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
    </header>
    <div class="du-body"><DurationCalc ref="calc" /></div>
  </section>
</template>

<style scoped>
.ph-ic {
  color: var(--ink-3);
}
.du-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 0.55rem 1rem 0.9rem;
  overflow: hidden;
}
.du-body > .dc {
  flex: 1;
}
</style>
