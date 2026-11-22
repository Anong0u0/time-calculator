/* In-place tooltips: the explanation appears next to the thing it explains.
   Mouse: after a short hover. Keyboard: on focus. Touch: on a long press. */
import type { Directive } from 'vue';

type TipEl = HTMLElement & { _tip?: string; _tipOff?: () => void };
let box: HTMLDivElement | null = null;
let cur: TipEl | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let hideTimer: ReturnType<typeof setTimeout> | undefined;

function ensure() {
  if (!box) {
    box = document.createElement('div');
    box.className = 'tip';
    box.setAttribute('role', 'tooltip');
    box.id = 'tip-box';
    document.body.appendChild(box);
  }
  return box;
}
function placeAt(text: string, r: { left: number; right: number; top: number; bottom: number }) {
  const t = ensure();
  t.textContent = text;
  const tr = t.getBoundingClientRect();
  let top = r.top - tr.height - 8;
  if (top < 6) top = r.bottom + 8;
  const cx = (r.left + r.right) / 2;
  const left = Math.max(8, Math.min(window.innerWidth - tr.width - 8, cx - tr.width / 2));
  t.style.top = `${Math.round(top)}px`;
  t.style.left = `${Math.round(left)}px`;
  t.classList.add('show');
}
export function hideTip() {
  clearTimeout(timer);
  clearTimeout(hideTimer);
  cur = null;
  box?.classList.remove('show');
}
/** A tooltip for something that is not an element of its own, such as a spot on a strip. */
export function tipAt(text: string | null, r?: { left: number; right: number; top: number; bottom: number }) {
  if (!text || !r) { if (!cur) box?.classList.remove('show'); return; }
  cur = null;
  placeAt(text, r);
}
function show(el: TipEl) {
  if (!el._tip || !el.isConnected) return;
  cur = el;
  placeAt(el._tip, el.getBoundingClientRect());
}

export const tip: Directive<TipEl, string | null | undefined> = {
  mounted(el, binding) {
    el._tip = binding.value || '';
    if (el._tip) el.setAttribute('aria-description', el._tip);
    let touchTimer: ReturnType<typeof setTimeout> | undefined;
    const enter = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      clearTimeout(timer);
      timer = setTimeout(() => show(el), cur ? 60 : 380);
    };
    const leave = () => { clearTimeout(timer); if (cur === el) hideTip(); };
    const focus = () => { try { if (el.matches(':focus-visible')) show(el); } catch { /* old browsers */ } };
    const down = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') { leave(); return; }
      clearTimeout(touchTimer);
      touchTimer = setTimeout(() => { show(el); clearTimeout(hideTimer); hideTimer = setTimeout(hideTip, 2600); }, 520);
    };
    const up = () => clearTimeout(touchTimer);
    el.addEventListener('pointerenter', enter);
    el.addEventListener('pointerleave', leave);
    el.addEventListener('focusin', focus);
    el.addEventListener('focusout', leave);
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el._tipOff = () => {
      el.removeEventListener('pointerenter', enter);
      el.removeEventListener('pointerleave', leave);
      el.removeEventListener('focusin', focus);
      el.removeEventListener('focusout', leave);
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
  },
  updated(el, binding) {
    const v = binding.value || '';
    if (v === el._tip) return;
    el._tip = v;
    if (v) el.setAttribute('aria-description', v); else el.removeAttribute('aria-description');
    if (cur === el) { if (v) show(el); else hideTip(); }
  },
  beforeUnmount(el) {
    el._tipOff?.();
    if (cur === el) hideTip();
  },
};
