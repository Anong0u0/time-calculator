/* ============================================================
   Adaptive grid layout: picks the best arrangement for whatever
   panels remain visible and whatever shape the window has.
   Pure logic so every viewport × panel combination can be tested.
   ============================================================ */
import type { Lens } from './store';

export type Layout = 'xwide' | 'wide' | 'square' | 'phone' | 'short';
export type EqMode = 'row' | 'stack' | 'stage';

export const LENS_ORDER: Lens[] = ['zones', 'cal', 'read', 'dur'];

/** Column weights for side-by-side lenses. */
const FR: Record<'wide' | 'xwide', Record<Lens, number>> = {
  wide: { zones: 1.32, cal: 1, read: 0.98, dur: 0.92 },
  xwide: { zones: 1.3, cal: 1, read: 1, dur: 0.92 },
};
const TWO_FR: Record<Lens, number> = { zones: 1.25, cal: 1.05, read: 1, dur: 0.9 };
/** Side-by-side split when one equation piece pairs with one lens on landscape screens. */
const HERO_SPLIT: Record<Lens, [number, number]> = {
  zones: [0.85, 1.35],
  cal: [0.9, 1.25],
  read: [0.9, 1.15],
  dur: [1.05, 0.95],
};
/** Side-by-side split when a multi-part equation (with span) pairs with one non-zones lens on wide screens. */
const STAGE_SPLIT: Record<Exclude<Lens, 'zones'>, [number, number]> = {
  cal: [1.08, 1],
  read: [1.05, 1],
  dur: [1.18, 0.88],
};

/** Side-by-side split when start + end (no span) pairs with one non-zones lens on wide screens. */
const TWIN_SPLIT: Record<Exclude<Lens, 'zones'>, [number, number]> = {
  cal: [0.92, 1.15],
  read: [0.92, 1.1],
  dur: [1.05, 0.95],
};

export interface LayoutInput {
  vw: number;
  vh: number;
  rem: number;
  showTop: boolean;
  eqStart: boolean;
  eqSpan: boolean;
  eqEnd: boolean;
  shownLenses: Lens[];
  /** Whether the world map is enabled inside ZonesPanel (defaults to true). */
  showMap?: boolean;
}

export interface LayoutPlan {
  layout: Layout;
  lenses: Lens[];
  tabbed: boolean;
  showTabs: boolean;
  eqBig: boolean;
  eqSolo: boolean;
  eqMode: EqMode;
  eqStack: boolean;
  eqCompact: boolean;
  eqTight: boolean;
  soloLens: boolean;
  cols: string[];
  rows: string[];
  areas: string[][];
  /** The grid area occupying the top-right corner (used to clear the floating panels button when top is hidden). */
  topRightArea: string;
}

const fill = (n: number, a: string) => Array<string>(n).fill(a);
const rowWeight = (k: Lens) =>
  k === 'zones' ? 'minmax(0, 1fr)' : k === 'dur' ? 'minmax(0, 0.88fr)' : 'minmax(0, 1.12fr)';

export function classifyViewport(vw: number, vh: number, rem: number): Layout {
  if (vw < 600) return 'phone';
  if (vh < 600) return 'short';
  if (vw >= 1000 && vw / vh >= 1.15) return vw / Math.max(1, rem) >= 104 ? 'xwide' : 'wide';
  return 'square';
}

export function computeLayout(input: LayoutInput): LayoutPlan {
  const { vw, vh, rem, showTop, eqStart, eqSpan, eqEnd, shownLenses, showMap = true } = input;
  const layout = classifyViewport(vw, vh, rem);
  const aspect = vw / Math.max(1, vh);
  const eqCount = (eqStart ? 1 : 0) + (eqSpan ? 1 : 0) + (eqEnd ? 1 : 0);
  const showEq = eqCount > 0;
  const eqSolo = eqCount === 1;
  const on = LENS_ORDER.filter((k) => shownLenses.includes(k));

  // Choose which lenses get a place on the face.
  let lenses: Lens[];
  if (layout === 'phone') {
    lenses = on.filter((k) => k !== 'dur' || !eqSpan || on.length === 1);
  } else if (layout === 'short') {
    lenses = showEq ? on.filter((k) => k !== 'dur' || !eqSpan || on.length === 1) : on;
  } else if (layout === 'xwide') {
    lenses = on.slice(0, 4);
  } else if (!showEq && vh >= 700 && vw >= 760) {
    // With the equation put away, a 2×2 grid fits all four lenses comfortably even on wide / large square screens.
    lenses = on.slice(0, 4);
  } else {
    lenses = on.slice(0, 3);
  }

  // Decide whether lenses share one tabbed slot.
  let tabbed = false;
  if (layout === 'phone') {
    tabbed = true;
  } else if (layout === 'short') {
    if (showEq) {
      // Wide short screens (e.g. 1440×540 half-height window) can display 2–3 lenses beside the equation without tabs.
      const maxBeside = vw >= 98 * rem ? 3 : vw >= 72 * rem ? 2 : 1;
      tabbed = lenses.length > maxBeside;
    } else {
      const maxCols = vw >= 96 * rem ? 4 : vw >= 72 * rem ? 3 : vw >= 46 * rem ? 2 : 1;
      tabbed = lenses.length > maxCols;
    }
  }
  const showTabs = tabbed && lenses.length > 1;
  const soloLens = !showEq && lenses.length === 1;

  const rows: string[] = [];
  const areas: string[][] = [];
  let cols: string[];
  let eqBig = false;
  let eqMode: EqMode = 'row';
  let eqCompact = false;
  let eqTight = false;

  const pushTop = (n: number) => {
    if (!showTop) return;
    rows.push('auto');
    areas.push(fill(n, 'top'));
  };

  if (!lenses.length) {
    // Case 1: Equation only — takes the full height and grows to fill it.
    eqBig = showEq;
    eqCompact = layout === 'phone' || (layout === 'short' && vh < 480);
    if (eqCount <= 1) {
      eqMode = 'row';
    } else if (layout === 'phone') {
      eqMode = 'stack';
    } else if (eqSpan && vh >= 560 && aspect < 2.25) {
      // Full-screen equation with span: giant full-width span hero on top, horizon rail in the middle, endpoints below.
      eqMode = 'stage';
    } else if (layout === 'short') {
      eqMode = eqCount === 3 && vw < 48 * rem ? 'stack' : 'row';
    } else if (layout === 'square') {
      eqMode = eqCount === 3 && vw < 52 * rem ? 'stack' : 'row';
    } else {
      eqMode = 'row';
    }

    cols = ['minmax(0, 1fr)'];
    pushTop(1);
    if (showEq) {
      rows.push('minmax(0, 1fr)');
      areas.push(['eq']);
    }
  } else if (tabbed) {
    // Case 2: Phone, or short screen with tabbed lenses.
    eqCompact = true;
    if (layout === 'short' && showEq) {
      cols = ['minmax(0, 1fr)', 'minmax(0, 1.15fr)'];
      pushTop(2);
      if (showTabs) {
        rows.push('auto');
        areas.push(['eq', 'tabs']);
      }
      rows.push('minmax(0, 1fr)');
      areas.push(['eq', 'lens']);
      eqBig = eqSolo;
      eqMode = eqCount > 1 ? 'stack' : 'row';
      eqTight = eqCount > 1;
    } else {
      cols = ['minmax(0, 1fr)'];
      pushTop(1);
      if (showEq) {
        rows.push('auto');
        areas.push(['eq']);
        eqMode = eqCount > 1 ? 'stack' : 'row';
      }
      if (showTabs) {
        rows.push('auto');
        areas.push(['tabs']);
      }
      rows.push('minmax(0, 1fr)');
      areas.push(['lens']);
    }
  } else if (layout === 'short') {
    // Case 3: Wide short screen without tabs — lenses side by side, optionally preceded by the equation.
    if (showEq) {
      const n = 1 + lenses.length;
      const eqCol = lenses.length === 1 ? 'minmax(0, 1fr)' : 'minmax(0, 0.92fr)';
      cols = [eqCol, ...lenses.map((k) => `minmax(0, ${lenses.length === 1 ? 1.15 : FR.wide[k]}fr)`)];
      pushTop(n);
      rows.push('minmax(0, 1fr)');
      areas.push(['eq', ...lenses]);
      eqBig = eqSolo;
      eqMode = eqCount > 1 ? 'stack' : 'row';
      eqCompact = true;
      eqTight = eqCount > 1;
    } else {
      const n = lenses.length;
      cols = lenses.map((k) => `minmax(0, ${FR.wide[k]}fr)`);
      pushTop(n);
      rows.push('minmax(0, 1fr)');
      areas.push([...lenses]);
    }
  } else if (showEq && eqSolo && lenses.length === 1 && (layout === 'wide' || layout === 'xwide') && aspect >= 1.25) {
    // Case 4a: One equation piece paired with one lens on landscape — side-by-side split with full-height reading.
    const k = lenses[0];
    const [ef, lf] = HERO_SPLIT[k];
    cols = [`minmax(0, ${ef}fr)`, `minmax(0, ${lf}fr)`];
    pushTop(2);
    rows.push('minmax(0, 1fr)');
    areas.push(['eq', k]);
    eqBig = true;
    eqMode = 'row';
    eqCompact = false;
  } else if (
    showEq &&
    eqCount >= 2 &&
    eqSpan &&
    lenses.length === 1 &&
    lenses[0] !== 'zones' &&
    (layout === 'wide' || layout === 'xwide') &&
    vw >= 1260 &&
    vh >= 700 &&
    aspect >= 1.4
  ) {
    // Case 4b: Multi-part equation (with span) + one non-zones lens on wide screens — 2-tier stage beside full-height lens.
    const k = lenses[0] as Exclude<Lens, 'zones'>;
    const [ef, lf] = STAGE_SPLIT[k];
    cols = [`minmax(0, ${ef}fr)`, `minmax(0, ${lf}fr)`];
    pushTop(2);
    rows.push('minmax(0, 1fr)');
    areas.push(['eq', k]);
    eqBig = true;
    eqMode = 'stage';
    eqCompact = false;
  } else if (
    showEq &&
    eqCount === 2 &&
    !eqSpan &&
    lenses.length === 1 &&
    lenses[0] !== 'zones' &&
    (layout === 'wide' || layout === 'xwide') &&
    vw >= 1150 &&
    vh >= 680 &&
    aspect >= 1.35
  ) {
    // Case 4c: Start + End (no span) paired with one non-zones lens — stacked twin endpoints beside full-height lens.
    const k = lenses[0] as Exclude<Lens, 'zones'>;
    const [ef, lf] = TWIN_SPLIT[k];
    cols = [`minmax(0, ${ef}fr)`, `minmax(0, ${lf}fr)`];
    pushTop(2);
    rows.push('minmax(0, 1fr)');
    areas.push(['eq', k]);
    eqBig = true;
    eqMode = 'stack';
    eqCompact = false;
  } else if (
    showEq &&
    eqCount >= 2 &&
    eqSpan &&
    lenses.length === 1 &&
    lenses[0] === 'zones' &&
    !showMap &&
    (layout === 'wide' || layout === 'xwide') &&
    vh >= 780 &&
    aspect < 2.1
  ) {
    // Case 4d: Equation + mapless zones — balanced 2-tier stage over crisp full-width timezone strips (fits all 6 rows).
    cols = ['minmax(0, 1fr)'];
    pushTop(1);
    rows.push('minmax(0, 0.98fr)', 'minmax(0, 1.02fr)');
    areas.push(['eq'], ['zones']);
    eqBig = true;
    eqMode = 'stage';
    eqCompact = false;
  } else if (
    showEq &&
    eqSolo &&
    lenses.length === 2 &&
    (layout === 'wide' || layout === 'xwide') &&
    vh >= 680 &&
    aspect < 2.15
  ) {
    // Case 4e: One equation piece + 2 lenses — Bento layout so the solo equation grows big instead of leaving a wide blank strip.
    eqBig = true;
    eqMode = 'row';
    eqCompact = false;
    if (lenses.includes('zones')) {
      const other = lenses.find((k) => k !== 'zones')!;
      cols = ['minmax(0, 0.95fr)', other === 'dur' ? 'minmax(0, 0.95fr)' : 'minmax(0, 1.05fr)'];
      pushTop(2);
      rows.push('minmax(0, 1.05fr)', 'minmax(0, 0.95fr)');
      areas.push(['eq', other], ['zones', 'zones']);
    } else {
      const anchor = lenses.includes('cal') ? 'cal' : 'read';
      const other = lenses.find((k) => k !== anchor)!;
      cols = ['minmax(0, 1fr)', anchor === 'cal' ? 'minmax(0, 1.12fr)' : 'minmax(0, 1.05fr)'];
      pushTop(2);
      rows.push('minmax(0, 1.05fr)', 'minmax(0, 0.95fr)');
      areas.push(['eq', anchor], [other, anchor]);
    }
  } else if (
    showEq &&
    eqSolo &&
    lenses.length === 3 &&
    (layout === 'wide' || layout === 'xwide') &&
    vh >= 700 &&
    aspect < 2.15
  ) {
    // Case 4f: One equation piece + 3 lenses (4 panels total) — balanced 2×2 Bento grid.
    eqBig = true;
    eqMode = 'row';
    eqCompact = false;
    cols = ['minmax(0, 1.1fr)', 'minmax(0, 1fr)'];
    pushTop(2);
    rows.push('minmax(0, 1fr)', 'minmax(0, 1.05fr)');
    if (lenses.includes('cal')) {
      const rest = lenses.filter((k) => k !== 'cal');
      areas.push(['eq', 'cal'], [rest[0], rest[1]]);
    } else {
      // zones, read, dur
      areas.push(['eq', 'dur'], ['zones', 'read']);
    }
  } else if (!showEq) {
    // Case 5: Lenses only (equation completely hidden) on desktop / square.
    if (lenses.length === 1) {
      cols = ['minmax(0, 1fr)'];
      pushTop(1);
      rows.push('minmax(0, 1fr)');
      areas.push([lenses[0]]);
    } else if (lenses.length === 2) {
      if (layout === 'square' && (lenses.includes('zones') || aspect < 0.92)) {
        cols = ['minmax(0, 1fr)'];
        pushTop(1);
        for (const k of lenses) {
          rows.push(rowWeight(k));
          areas.push([k]);
        }
      } else {
        cols = lenses.map((k) => `minmax(0, ${TWO_FR[k]}fr)`);
        pushTop(2);
        rows.push('minmax(0, 1fr)');
        areas.push([...lenses]);
      }
    } else if (lenses.length === 3) {
      if ((layout === 'wide' || layout === 'xwide') && (aspect >= 1.85 || vh < 680)) {
        const fr = FR[layout];
        cols = lenses.map((k) => `minmax(0, ${fr[k]}fr)`);
        pushTop(3);
        rows.push('minmax(0, 1fr)');
        areas.push([...lenses]);
      } else if (lenses.includes('zones')) {
        const rest = lenses.filter((k) => k !== 'zones');
        cols = rest.map((k) => `minmax(0, ${TWO_FR[k]}fr)`);
        pushTop(2);
        rows.push('minmax(0, 0.95fr)');
        areas.push(['zones', 'zones']);
        rows.push('minmax(0, 1.05fr)');
        areas.push(rest);
      } else if (layout === 'square' && aspect < 0.92) {
        // Portrait tablet: calendar full-width on top, readings + duration side by side below.
        cols = ['minmax(0, 1fr)', 'minmax(0, 1fr)'];
        pushTop(2);
        rows.push('minmax(0, 1.15fr)');
        areas.push(['cal', 'cal']);
        rows.push('minmax(0, 1fr)');
        areas.push(['read', 'dur']);
      } else {
        // Landscape / square without zones: full-height calendar on the left, readings over duration on the right.
        cols = ['minmax(0, 1.15fr)', 'minmax(0, 1fr)'];
        pushTop(2);
        rows.push('minmax(0, 1.15fr)');
        areas.push(['cal', 'read']);
        rows.push('minmax(0, 0.85fr)');
        areas.push(['cal', 'dur']);
      }
    } else {
      // 4 lenses: 4 columns on ultra-wide monitors, balanced 2×2 Bento grid otherwise.
      if (aspect >= 2.25) {
        cols = lenses.map((k) => `minmax(0, ${FR.xwide[k]}fr)`);
        pushTop(4);
        rows.push('minmax(0, 1fr)');
        areas.push([...lenses]);
      } else {
        cols = ['minmax(0, 1.15fr)', 'minmax(0, 1fr)'];
        pushTop(2);
        rows.push('minmax(0, 1.05fr)');
        areas.push(['zones', 'cal']);
        rows.push('minmax(0, 0.95fr)');
        areas.push(['read', 'dur']);
      }
    }
  } else if (layout === 'square') {
    // Case 6a: Square with equation + lenses.
    if (eqCount === 3 && vw < 58 * rem) {
      // Narrow square / portrait tablet (e.g. 680×900, 768×1024): compact 2-tier mini-stage avoids cramped 215px columns.
      eqMode = eqSpan && vw >= 620 ? 'stage' : 'stack';
      eqCompact = true;
    } else {
      eqMode = 'row';
      eqCompact = false;
    }
    const lr: Lens[][] = [];
    if (lenses.includes('zones')) lr.push(['zones']);
    const rest = lenses.filter((k) => k !== 'zones');
    for (let i = 0; i < rest.length; i += 2) lr.push(rest.slice(i, i + 2));
    const n = lr.some((r) => r.length > 1) ? 2 : 1;
    cols = fill(n, 'minmax(0, 1fr)');
    pushTop(n);
    rows.push('auto');
    areas.push(fill(n, 'eq'));
    for (const r of lr) {
      rows.push(r[0] === 'zones' ? 'minmax(0, 1fr)' : 'minmax(0, 1.12fr)');
      areas.push(r.length === n ? r : fill(n, r[0]));
    }
  } else {
    // Case 6b: Wide / xwide with equation + lenses (classic watch-face horizon).
    const n = lenses.length;
    const fr = FR[layout === 'xwide' ? 'xwide' : 'wide'];
    cols = lenses.map((k) => `minmax(0, ${fr[k]}fr)`);
    pushTop(n);
    rows.push('auto');
    areas.push(fill(n, 'eq'));
    rows.push('minmax(0, 1fr)');
    areas.push([...lenses]);
  }

  const topRightArea = areas.length ? areas[0][areas[0].length - 1] : '';

  return {
    layout,
    lenses,
    tabbed,
    showTabs,
    eqBig,
    eqSolo,
    eqMode,
    eqStack: eqMode === 'stack',
    eqCompact,
    eqTight,
    soloLens,
    cols,
    rows,
    areas,
    topRightArea,
  };
}
