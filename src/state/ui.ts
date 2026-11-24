/* Requests between distant parts of the screen: "open the span editor with '+'", "focus the command bar". */
import { reactive } from 'vue';
import { S } from './store';

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
});
export function editSpan(text = '') { ui.spanEditText = text; ui.spanEditReq++; }
/** Focus the command bar. With `select`, the prefilled text is selected so typing replaces it. */
export function focusCommand(text = '', select = false) { ui.commandText = text; ui.commandSelect = select; ui.commandReq++; }
/** Put an expression in the duration calculator and show it. */
export function openDuration(text?: string) {
  if (text != null && text.trim()) { S.dur = text.trim(); S.durSample = false; }
  ui.durReq++;
}
