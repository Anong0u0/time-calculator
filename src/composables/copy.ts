import { ref } from 'vue';
import { toast } from '../state/store';

/** Which copy button shows its check mark right now. */
export const copiedKey = ref<string | null>(null);
let timer: ReturnType<typeof setTimeout> | undefined;

function fallback(text: string): boolean {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
  document.body.appendChild(ta);
  ta.select();
  let ok: boolean;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  return ok;
}
export async function copyText(text: string, key: string, label = '') {
  if (!text) return;
  let ok: boolean;
  try { await navigator.clipboard.writeText(text); ok = true; } catch { ok = fallback(text); }
  if (!ok) { toast('無法寫入剪貼簿，請手動選取'); return; }
  copiedKey.value = key;
  clearTimeout(timer);
  timer = setTimeout(() => { copiedKey.value = null; }, 1600);
  toast(`已複製${label ? label + ' ' : ''}${text.length > 48 ? text.slice(0, 46) + '…' : text}`);
}
