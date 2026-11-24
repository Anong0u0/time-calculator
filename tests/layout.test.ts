/* Adaptive grid layout: verify every viewport shape and panel-hiding combination picks the intended topology. */
import { describe, expect, test } from 'bun:test';
import { computeLayout, type LayoutInput } from '../src/state/layout';
import type { Lens } from '../src/state/store';

const ALL_LENSES: Lens[] = ['zones', 'cal', 'read', 'dur'];
const base = (over: Partial<LayoutInput> = {}): LayoutInput => ({
  vw: 1440,
  vh: 900,
  rem: 16,
  showTop: true,
  eqStart: true,
  eqSpan: true,
  eqEnd: true,
  shownLenses: ALL_LENSES,
  ...over,
});

describe('computeLayout across viewports and hidden panels', () => {
  test('default full view preserves classic 3-col wide and 4-col xwide horizon', () => {
    const wide = computeLayout(base({ vw: 1440, vh: 900 }));
    expect(wide.layout).toBe('wide');
    expect(wide.lenses).toEqual(['zones', 'cal', 'read']);
    expect(wide.areas).toEqual([
      ['top', 'top', 'top'],
      ['eq', 'eq', 'eq'],
      ['zones', 'cal', 'read'],
    ]);
    expect(wide.eqBig).toBe(false);
    expect(wide.eqStack).toBe(false);

    const xwide = computeLayout(base({ vw: 1920, vh: 1080 }));
    expect(xwide.layout).toBe('xwide');
    expect(xwide.lenses).toEqual(['zones', 'cal', 'read', 'dur']);
    expect(xwide.areas[2]).toEqual(['zones', 'cal', 'read', 'dur']);
  });

  test('solo equation piece (countdown or clock) fills the screen and keeps horizontal rail even on phones', () => {
    const desktopCountdown = computeLayout(
      base({ showTop: false, eqStart: false, eqSpan: true, eqEnd: false, shownLenses: [] }),
    );
    expect(desktopCountdown.eqBig).toBe(true);
    expect(desktopCountdown.eqSolo).toBe(true);
    expect(desktopCountdown.eqStack).toBe(false);
    expect(desktopCountdown.areas).toEqual([['eq']]);
    expect(desktopCountdown.topRightArea).toBe('eq');

    const phoneClock = computeLayout(
      base({ vw: 390, vh: 844, showTop: false, eqStart: true, eqSpan: false, eqEnd: false, shownLenses: [] }),
    );
    expect(phoneClock.layout).toBe('phone');
    expect(phoneClock.eqBig).toBe(true);
    expect(phoneClock.eqSolo).toBe(true);
    expect(phoneClock.eqStack).toBe(false);
    expect(phoneClock.areas).toEqual([['eq']]);
  });

  test('one equation piece paired with one lens splits side-by-side on wide landscape screens', () => {
    const spanCal = computeLayout(
      base({ vw: 1440, vh: 900, showTop: false, eqStart: false, eqSpan: true, eqEnd: false, shownLenses: ['cal'] }),
    );
    expect(spanCal.eqBig).toBe(true);
    expect(spanCal.eqSolo).toBe(true);
    expect(spanCal.areas).toEqual([['eq', 'cal']]);
    expect(spanCal.topRightArea).toBe('cal');

    // On square/portrait screens it stacks top-bottom instead of crushing side-by-side.
    const squareSplit = computeLayout(
      base({ vw: 800, vh: 900, showTop: false, eqStart: false, eqSpan: true, eqEnd: false, shownLenses: ['cal'] }),
    );
    expect(squareSplit.eqBig).toBe(false);
    expect(squareSplit.areas).toEqual([['eq'], ['cal']]);
  });

  test('hiding the equation unlocks a 2×2 Bento grid for all 4 lenses on wide and large square screens', () => {
    const wide4 = computeLayout(
      base({ vw: 1440, vh: 900, showTop: false, eqStart: false, eqSpan: false, eqEnd: false }),
    );
    expect(wide4.lenses).toEqual(['zones', 'cal', 'read', 'dur']);
    expect(wide4.areas).toEqual([
      ['zones', 'cal'],
      ['read', 'dur'],
    ]);
    expect(wide4.topRightArea).toBe('cal');

    // Ultra-wide monitors keep 4 columns side by side.
    const ultrawide4 = computeLayout(
      base({ vw: 2560, vh: 1000, showTop: false, eqStart: false, eqSpan: false, eqEnd: false }),
    );
    expect(ultrawide4.areas).toEqual([['zones', 'cal', 'read', 'dur']]);
  });

  test('hiding the equation with 3 lenses picks the best Bento arrangement', () => {
    const withZones = computeLayout(
      base({ vw: 1440, vh: 900, eqStart: false, eqSpan: false, eqEnd: false, shownLenses: ['zones', 'cal', 'read'] }),
    );
    expect(withZones.areas).toEqual([
      ['top', 'top'],
      ['zones', 'zones'],
      ['cal', 'read'],
    ]);

    const withoutZones = computeLayout(
      base({ vw: 1440, vh: 900, eqStart: false, eqSpan: false, eqEnd: false, shownLenses: ['cal', 'read', 'dur'] }),
    );
    expect(withoutZones.areas).toEqual([
      ['top', 'top'],
      ['cal', 'read'],
      ['cal', 'dur'],
    ]);
  });

  test('full-screen equation (start + span + end) switches to 2-tier hero stage instead of skinny left-middle-right columns', () => {
    const eqOnly = computeLayout(base({ vw: 1440, vh: 900, shownLenses: [] }));
    expect(eqOnly.eqBig).toBe(true);
    expect(eqOnly.eqMode).toBe('stage');
    expect(eqOnly.areas).toEqual([['top'], ['eq']]);

    // Equation (with span) paired with one non-zones lens on wide screens puts 2-tier stage beside the lens.
    const eqCal = computeLayout(base({ vw: 1440, vh: 900, shownLenses: ['cal'] }));
    expect(eqCal.eqBig).toBe(true);
    expect(eqCal.eqMode).toBe('stage');
    expect(eqCal.areas).toEqual([
      ['top', 'top'],
      ['eq', 'cal'],
    ]);

    // Short landscape windows stay horizontal row so vertical height isn't cramped.
    const shortEqOnly = computeLayout(base({ vw: 1280, vh: 520, shownLenses: [] }));
    expect(shortEqOnly.layout).toBe('short');
    expect(shortEqOnly.eqBig).toBe(true);
    expect(shortEqOnly.eqMode).toBe('row');
    expect(shortEqOnly.eqCompact).toBe(false);
  });

  test('narrow square screens use compact 2-tier mini-stage (or compact stack) so lenses are never crushed', () => {
    const narrowSquare = computeLayout(base({ vw: 680, vh: 900, shownLenses: ['cal'] }));
    expect(narrowSquare.layout).toBe('square');
    expect(narrowSquare.eqMode).toBe('stage');
    expect(narrowSquare.eqCompact).toBe(true);
    expect(narrowSquare.eqBig).toBe(false);

    const tighterSquare = computeLayout(base({ vw: 605, vh: 900, shownLenses: ['cal'] }));
    expect(tighterSquare.eqMode).toBe('stack');
    expect(tighterSquare.eqCompact).toBe(true);
  });

  test('one equation piece + 2 or 3 lenses forms Bento grids instead of a blank-right top strip', () => {
    const withZones = computeLayout(
      base({
        vw: 1440,
        vh: 900,
        showTop: false,
        eqStart: false,
        eqSpan: true,
        eqEnd: false,
        shownLenses: ['zones', 'cal'],
      }),
    );
    expect(withZones.eqBig).toBe(true);
    expect(withZones.areas).toEqual([
      ['eq', 'cal'],
      ['zones', 'zones'],
    ]);

    const withoutZones = computeLayout(
      base({
        vw: 1440,
        vh: 900,
        showTop: false,
        eqStart: false,
        eqSpan: true,
        eqEnd: false,
        shownLenses: ['cal', 'read'],
      }),
    );
    expect(withoutZones.eqBig).toBe(true);
    expect(withoutZones.areas).toEqual([
      ['eq', 'cal'],
      ['read', 'cal'],
    ]);

    const fourPanels = computeLayout(
      base({
        vw: 1440,
        vh: 900,
        showTop: false,
        eqStart: false,
        eqSpan: true,
        eqEnd: false,
        shownLenses: ['zones', 'cal', 'read'],
      }),
    );
    expect(fourPanels.eqBig).toBe(true);
    expect(fourPanels.areas).toEqual([
      ['eq', 'cal'],
      ['zones', 'read'],
    ]);
  });

  test('start + end (no span) + one non-zones lens splits side-by-side, and equation + mapless zones balances vertically', () => {
    const twinCal = computeLayout(
      base({ vw: 1440, vh: 900, eqStart: true, eqSpan: false, eqEnd: true, shownLenses: ['cal'] }),
    );
    expect(twinCal.eqBig).toBe(true);
    expect(twinCal.eqMode).toBe('stack');
    expect(twinCal.areas).toEqual([
      ['top', 'top'],
      ['eq', 'cal'],
    ]);

    const maplessZones = computeLayout(base({ vw: 1440, vh: 900, shownLenses: ['zones'], showMap: false }));
    expect(maplessZones.eqBig).toBe(true);
    expect(maplessZones.eqMode).toBe('stage');
    expect(maplessZones.areas).toEqual([['top'], ['eq'], ['zones']]);
  });

  test('wide short screens with equation show 2–3 lenses beside the equation without tabs', () => {
    const shortWide = computeLayout(base({ vw: 1440, vh: 540, shownLenses: ['zones', 'cal'] }));
    expect(shortWide.layout).toBe('short');
    expect(shortWide.tabbed).toBe(false);
    expect(shortWide.areas).toEqual([
      ['top', 'top', 'top'],
      ['eq', 'zones', 'cal'],
    ]);
  });

  test('wide short screens with equation hidden show lenses side-by-side without tabs', () => {
    const short2 = computeLayout(
      base({
        vw: 1100,
        vh: 520,
        showTop: false,
        eqStart: false,
        eqSpan: false,
        eqEnd: false,
        shownLenses: ['zones', 'cal'],
      }),
    );
    expect(short2.layout).toBe('short');
    expect(short2.tabbed).toBe(false);
    expect(short2.areas).toEqual([['zones', 'cal']]);
    expect(short2.topRightArea).toBe('cal');
  });

  test('solo lens fills the entire face with topRightArea pointing to it when top is hidden', () => {
    const soloCal = computeLayout(
      base({ showTop: false, eqStart: false, eqSpan: false, eqEnd: false, shownLenses: ['cal'] }),
    );
    expect(soloCal.soloLens).toBe(true);
    expect(soloCal.areas).toEqual([['cal']]);
    expect(soloCal.topRightArea).toBe('cal');
  });
});
