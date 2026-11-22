import { ref, onMounted, onBeforeUnmount, type Ref } from 'vue';

/** Content-box size of an element, kept current. */
export function useSize(target: Ref<HTMLElement | null>) {
  const w = ref(0), h = ref(0);
  let ro: ResizeObserver | null = null;
  onMounted(() => {
    ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      w.value = r.width; h.value = r.height;
    });
    if (target.value) ro.observe(target.value);
  });
  onBeforeUnmount(() => ro?.disconnect());
  return { w, h };
}

/** Bumps when web fonts finish loading, so measured text can be measured again. */
export const fontsTick = ref(0);
if (typeof document !== 'undefined' && document.fonts) {
  document.fonts.ready.then(() => { fontsTick.value++; });
  document.fonts.addEventListener?.('loadingdone', () => { fontsTick.value++; });
}

/** The root font size in px; everything is sized in rem. */
export const remPx = ref(16);
export function readRem() {
  remPx.value = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
}
