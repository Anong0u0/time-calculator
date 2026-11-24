import { reactive, nextTick } from 'vue';
import { S, shown, setShown } from './store';

export const ui = reactive({
  spanEditReq: 0,
  spanEditText: '',
  commandReq: 0,
  commandText: '',
  commandSelect: false,
  durReq: 0,
  durSeen: 0,
  layout: 'wide' as string,
  durLens: false,
  fullscreen: false,
});
export function editSpan(text = '') {
  ui.spanEditText = text;
  ui.spanEditReq++;
}
export function focusCommand(text = '', select = false) {
  ui.commandText = text;
  ui.commandSelect = select;
  if (shown('top')) {
    ui.commandReq++;
    return;
  }
  setShown('top', true);
  nextTick(() => {
    ui.commandReq++;
  });
}
export function openDuration(text?: string) {
  if (text != null && text.trim()) {
    S.dur = text.trim();
    S.durSample = false;
  }
  ui.durReq++;
}

export const canFullscreen = typeof document !== 'undefined' && !!document.fullscreenEnabled;
export async function toggleFullscreen() {
  if (!canFullscreen) return false;
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
    return true;
  } catch {
    return false;
  }
}
if (typeof document !== 'undefined') {
  document.addEventListener('fullscreenchange', () => {
    ui.fullscreen = !!document.fullscreenElement;
  });
}
