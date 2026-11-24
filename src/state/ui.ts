/* Requests between distant parts of the screen: "open the span editor with '+'", "focus the command bar". */
import { reactive, nextTick } from 'vue';
import { S, shown, setShown } from './store';

export const ui = reactive({
  spanEditReq: 0,
  spanEditText: '',
  commandReq: 0,
  commandText: '',
  commandSelect: false,
  /** Bumped to bring the duration calculator into view (its tab, its column, or its popover). */
  durReq: 0,
  /** The last request that was answered (the lens or the popover brought the calculator into view). */
  durSeen: 0,
  /** The page layout App picked (wide, xwide, square, phone, short). */
  layout: 'wide' as string,
  /** The duration calculator has a place of its own on the face (a column or a tab), so the span's button goes there. */
  durLens: false,
  /** The browser shows the page full screen. */
  fullscreen: false,
});
export function editSpan(text = '') { ui.spanEditText = text; ui.spanEditReq++; }
/** Focus the command bar. With `select`, the prefilled text is selected so typing replaces it.
    When the top bar is put away, it comes back first: typing is never out of reach. */
export function focusCommand(text = '', select = false) {
  ui.commandText = text; ui.commandSelect = select;
  if (shown('top')) { ui.commandReq++; return; }
  setShown('top', true);
  nextTick(() => { ui.commandReq++; });
}
/** Put an expression in the duration calculator and show it. */
export function openDuration(text?: string) {
  if (text != null && text.trim()) { S.dur = text.trim(); S.durSample = false; }
  ui.durReq++;
}

/* ---------- the browser's full screen ---------- */
export const canFullscreen = typeof document !== 'undefined' && !!document.fullscreenEnabled;
export async function toggleFullscreen() {
  if (!canFullscreen) return false;
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
    return true;
  } catch { return false; }
}
if (typeof document !== 'undefined') {
  document.addEventListener('fullscreenchange', () => { ui.fullscreen = !!document.fullscreenElement; });
}
