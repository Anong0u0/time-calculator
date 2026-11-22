/* Requests between distant parts of the screen: "open the span editor with '+'", "focus the command bar". */
import { reactive } from 'vue';

export const ui = reactive({
  spanEditReq: 0,
  spanEditText: '',
  commandReq: 0,
  commandText: '',
});
export function editSpan(text = '') { ui.spanEditText = text; ui.spanEditReq++; }
export function focusCommand(text = '') { ui.commandText = text; ui.commandReq++; }
