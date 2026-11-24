import { ref, watch, type WatchSource } from 'vue';

export function useFlash(source?: WatchSource) {
  const flashing = ref(false);
  const flash = () => {
    flashing.value = false;
    requestAnimationFrame(() => {
      flashing.value = true;
    });
  };
  if (source) watch(source, flash);
  return { flashing, flash };
}
