import { ref, watch, type WatchSource } from 'vue';

/** A panel glows briefly where a change landed: `flash()` (or a change of `source`) restarts the animation;
    the panel clears `flashing` on animationend. */
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
