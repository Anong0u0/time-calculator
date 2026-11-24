<script setup lang="ts">
import { computed } from 'vue';
import Icon from './Icon.vue';
import { copiedKey, copyText } from '../composables/copy';

const props = defineProps<{ text: string; k: string; label?: string; tip?: string; disabled?: boolean }>();
const copied = computed(() => copiedKey.value === props.k);
const tipText = computed(() => props.tip ?? (props.text ? `複製 ${props.text}` : ''));
</script>

<template>
  <button
    type="button"
    class="copy"
    :class="{ copied }"
    :disabled="disabled || !text"
    v-tip="tipText"
    :aria-label="`${label || ''}${label ? '：' : ''}${text}，點一下複製`"
    @click="copyText(text, k, label)"
  >
    <span
      ><slot>{{ text }}</slot></span
    >
    <Icon :name="copied ? 'check' : 'copy'" />
  </button>
</template>
