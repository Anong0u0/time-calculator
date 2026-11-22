/** Shrinks a one-line element's font until it fits its box (never grows past the CSS size). */
export function fitText(el: HTMLElement | null, min = 0.5) {
  if (!el) return;
  el.style.fontSize = '';
  const box = el.clientWidth;
  const need = el.scrollWidth;
  if (!box || need <= box + 0.5) return;
  const base = parseFloat(getComputedStyle(el).fontSize);
  el.style.fontSize = `${Math.max(base * min, Math.floor(base * (box / need) * 100) / 100)}px`;
}
