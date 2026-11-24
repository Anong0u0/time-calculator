import { ref, nextTick } from 'vue';

export interface DragSortOpts {
  rows: () => HTMLElement[];
  move: (from: number, to: number) => void;
  done?: (from: number, to: number) => void;
}
export function useDragSort(opts: DragSortOpts) {
  const dragging = ref<number | null>(null);
  let st: {
    id: number;
    el: HTMLElement;
    start: number;
    idx: number;
    grabX: number;
    grabY: number;
    x: number;
    y: number;
    grid: boolean;
  } | null = null;
  function place() {
    if (!st) return;
    const s = st;
    s.el.style.transform = '';
    const r = s.el.getBoundingClientRect();
    const dx = s.grid ? s.x - s.grabX - r.left : 0;
    const dy = s.y - s.grabY - r.top;
    s.el.style.transform = s.grid ? `translate(${dx}px, ${dy}px)` : `translateY(${dy}px)`;
  }
  function down(e: PointerEvent, idx: number) {
    if (e.button > 0) return;
    const rows = opts.rows();
    const row = rows[idx];
    if (!row) return;
    e.preventDefault();
    e.stopPropagation();
    const r0 = row.getBoundingClientRect();
    let grid = false;
    if (rows.length >= 2) {
      const a = rows[0].getBoundingClientRect(),
        b = rows[1].getBoundingClientRect();
      grid = Math.abs(a.top - b.top) < Math.min(a.height, b.height) * 0.5;
    }
    st = {
      id: e.pointerId,
      el: row,
      start: idx,
      idx,
      grabX: e.clientX - r0.left,
      grabY: e.clientY - r0.top,
      x: e.clientX,
      y: e.clientY,
      grid,
    };
    dragging.value = idx;
    row.classList.add('sorting');
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* fine */
    }
  }
  function moveP(e: PointerEvent) {
    if (!st || e.pointerId !== st.id) return;
    st.x = e.clientX;
    st.y = e.clientY;
    const rows = opts.rows();
    let target = 0;
    rows.forEach((r, i) => {
      if (i === st!.idx) return;
      const rc = r.getBoundingClientRect();
      if (st!.grid) {
        if (e.clientY > rc.bottom || (e.clientY >= rc.top && e.clientX > rc.left + rc.width / 2)) target++;
      } else if (e.clientY > rc.top + rc.height / 2) target++;
    });
    target = Math.min(target, rows.length - 1);
    if (target !== st.idx) {
      opts.move(st.idx, target);
      st.idx = target;
      dragging.value = target;
      nextTick(place);
    } else place();
  }
  function up(e: PointerEvent) {
    if (!st || e.pointerId !== st.id) return;
    const s = st;
    st = null;
    dragging.value = null;
    s.el.style.transform = '';
    s.el.classList.remove('sorting');
    if (s.idx !== s.start) opts.done?.(s.start, s.idx);
  }
  function key(e: KeyboardEvent, idx: number) {
    const n = opts.rows().length;
    const to =
      e.key === 'ArrowUp'
        ? idx - 1
        : e.key === 'ArrowDown'
          ? idx + 1
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? n - 1
              : null;
    if (to == null) return;
    e.preventDefault();
    if (to < 0 || to >= n || to === idx) return;
    opts.move(idx, to);
    opts.done?.(idx, to);
  }
  return { dragging, down, move: moveP, up, key };
}
export function moved<T>(list: T[], from: number, to: number): T[] {
  const out = list.slice();
  const [x] = out.splice(from, 1);
  out.splice(to, 0, x);
  return out;
}
