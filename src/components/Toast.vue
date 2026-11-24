<script setup lang="ts">
import { toastState, toastClose } from '../state/store';
import Icon from './Icon.vue';
function doUndo() {
  const u = toastState.cur?.undo;
  toastClose();
  u?.();
}
</script>

<template>
  <div class="toast-wrap" role="status" aria-live="polite" aria-atomic="true">
    <Transition name="toast">
      <div v-if="toastState.cur" :key="toastState.cur.id" class="toast">
        <span class="toast-t">{{ toastState.cur.text }}</span>
        <button v-if="toastState.cur.undo" type="button" class="toast-undo" @click="doUndo">
          <Icon name="undo" />復原
        </button>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.toast-wrap {
  position: fixed;
  left: 50%;
  bottom: max(1rem, env(safe-area-inset-bottom));
  transform: translateX(-50%);
  z-index: 95;
  pointer-events: none;
  width: max-content;
  max-width: calc(100vw - 24px);
}
.toast {
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 0.9rem;
  min-height: 2.9rem;
  padding: 0.45rem 0.5rem 0.45rem 1.05rem;
  border-radius: 1rem;
  background: var(--ink);
  color: var(--surface);
  box-shadow: var(--shadow-pop);
  font-size: 0.92rem;
  font-weight: 500;
}
.toast-t {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.toast:not(:has(.toast-undo)) {
  padding-right: 1.05rem;
}
.toast-undo {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  height: 2rem;
  padding: 0 0.75rem;
  border-radius: 0.7rem;
  font-weight: 650;
  color: var(--ink);
  background: var(--surface);
  flex: none;
}
.toast-undo:hover {
  background: var(--accent-wash-2);
  color: var(--surface);
}
.toast-enter-active,
.toast-leave-active {
  transition:
    opacity 0.2s,
    transform 0.25s var(--ease);
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(0.6rem) scale(0.98);
}
</style>
