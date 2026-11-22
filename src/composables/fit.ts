/** Shrinks a one-line element's font until it fits its box (never grows past the CSS size).
    A few passes, because parts with a fixed minimum size do not scale with the rest. */
export function fitText(el: HTMLElement | null, min = 0.5) {
  if (!el) return;
  el.style.fontSize = '';
  const box = el.clientWidth;
  if (!box) return;
  const base = parseFloat(getComputedStyle(el).fontSize);
  let size = base;
  for (let i = 0; i < 5; i++) {
    const need = el.scrollWidth;
    if (need <= box) return;
    size = Math.max(base * min, Math.floor(size * (box / need) * 0.985 * 100) / 100);
    el.style.fontSize = `${size}px`;
    if (size <= base * min) return;
  }
}
