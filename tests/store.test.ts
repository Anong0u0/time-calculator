/* The app state: how the two ends are worked out (held, following the clock, tied by the span, following a rule),
   and the undo history. The store is one module-wide state, so every test starts from reset(). */
import { beforeEach, describe, expect, test } from 'bun:test';
import {
  S,
  now,
  history,
  DEFAULT_APP_PREFS,
  startMs,
  endMs,
  linkErr,
  gapSec,
  isLinked,
  isFollowing,
  isDerived,
  commit,
  undo,
  redo,
  breakCoalesce,
  setWall,
  setInstant,
  setLive,
  setLink,
  freezeLink,
  clearEnd,
  swapEnds,
  applyRule,
  runRule,
  setFollow,
  setStartTz,
} from '../src/state/store';
import { type Wall, type Span, parseSpan, fmtSpan } from '../src/core/time';
import type { Rule } from '../src/core/rule';
import { sessionSearch, applyUrl } from '../src/state/url';

const NOW = Date.UTC(2026, 10, 24, 12, 0, 0);
const wall = (y: number, mo: number, d: number, h = 0, mi = 0, s = 0): Wall => ({ y, mo, d, h, mi, s });
const days = (d: number, sign: 1 | -1 = 1): Span => ({ sign, y: 0, mo: 0, w: 0, d, h: 0, mi: 0, s: 0, biz: false });
const iso = (ms: number | null) => (ms == null ? null : new Date(ms).toISOString().slice(0, 19));
/** 開始那個月的結束 / 結束那個月的開頭: rules that read the other end. */
const endOfStartMonth: Rule = { o: { t: 'start' }, steps: [{ t: 'align', p: 'mo', pos: 'end' }] };
const startOfEndMonth: Rule = { o: { t: 'end' }, steps: [{ t: 'align', p: 'mo', pos: 'start' }] };

function reset() {
  now.value = NOW;
  Object.assign(S, {
    startTz: 'UTC',
    endTz: 'UTC',
    start: wall(2026, 1, 1),
    live: false,
    end: null,
    endLive: false,
    endSample: false,
    link: null,
    linkTo: 'end',
    rules: { start: null, end: null },
    prefs: { ...DEFAULT_APP_PREFS },
  });
  history.undo.length = 0;
  history.redo.length = 0;
  breakCoalesce();
}
beforeEach(reset);

describe('how the ends are worked out', () => {
  test('two held ends', () => {
    setWall('end', wall(2026, 1, 2, 6));
    expect(gapSec.value).toBe(30 * 3600);
    expect(isDerived('start') || isDerived('end')).toBe(false);
  });

  test('an end that follows the clock is now, to the second', () => {
    now.value = NOW + 1234;
    setLive('start', true);
    expect(startMs.value).toBe(NOW + 1000);
    setLive('start', false);
    now.value = NOW + 60_000;
    expect(startMs.value).toBe(NOW + 1000);
  });

  test('the span computes the end from the start; setting the end cuts it', () => {
    expect(setLink(days(30))).toBe(true);
    expect(isLinked('end')).toBe(true);
    expect(iso(endMs.value)).toBe('2026-01-31T00:00:00');
    setWall('start', wall(2026, 3, 1));
    expect(iso(endMs.value)).toBe('2026-03-31T00:00:00');
    setWall('end', wall(2026, 5, 1));
    expect(S.link).toBeNull();
    expect(iso(endMs.value)).toBe('2026-05-01T00:00:00');
  });

  test('the span counts the start back from a held end', () => {
    setWall('end', wall(2026, 3, 1));
    expect(setLink(days(30), 'start')).toBe(true);
    expect(isLinked('start')).toBe(true);
    expect(iso(startMs.value)).toBe('2026-01-30T00:00:00');
    // freezing keeps the computed start where it is
    expect(freezeLink()).toBe(true);
    expect(S.link).toBeNull();
    expect(iso(startMs.value)).toBe('2026-01-30T00:00:00');
  });

  test('a span that would leave years 1–9999 is refused, and one pushed out of range says so', () => {
    setWall('start', wall(9999, 12, 1));
    expect(setLink(days(60))).toBe(false);
    expect(S.link).toBeNull();
    setWall('start', wall(9999, 11, 1));
    expect(setLink(days(30))).toBe(true);
    setWall('start', wall(9999, 12, 31));
    expect(endMs.value).toBeNull();
    expect(linkErr.value).toContain('超出可計算範圍');
  });

  test('an end can follow a rule that reads the other end', () => {
    setWall('start', wall(2026, 2, 10, 9, 30));
    expect(applyRule('end', endOfStartMonth)).toBe(true);
    expect(isFollowing('end')).toBe(true);
    expect(iso(endMs.value)).toBe('2026-03-01T00:00:00');
    setWall('start', wall(2026, 4, 3));
    expect(iso(endMs.value)).toBe('2026-05-01T00:00:00');
    // following stops on request, and the end stays where the rule put it
    expect(setFollow('end', false)).toBe(true);
    setWall('start', wall(2026, 8, 1));
    expect(iso(endMs.value)).toBe('2026-05-01T00:00:00');
  });

  test('applying two month moves keeps the preview and follows the same steps as the start changes', () => {
    setWall('start', wall(2026, 1, 31));
    const month = { t: 'move', n: 1, u: 'mo' } as const;
    const rule: Rule = { o: { t: 'other' }, steps: [month, month] };
    const preview = runRule(rule, 'end');
    if (!preview.ok) throw new Error(preview.err);
    expect(iso(preview.ms)).toBe('2026-03-28T00:00:00');
    expect(applyRule('end', rule)).toBe(true);
    expect(endMs.value).toBe(preview.ms);
    setWall('start', wall(2026, 8, 31));
    expect(iso(endMs.value)).toBe('2026-10-30T00:00:00');
  });

  test('the start can follow a rule on the end; the end that read the start is pinned first', () => {
    setWall('start', wall(2026, 4, 3));
    applyRule('end', endOfStartMonth);
    expect(applyRule('start', startOfEndMonth)).toBe(true);
    expect(isFollowing('end')).toBe(false);
    expect(isFollowing('start')).toBe(true);
    expect(iso(endMs.value)).toBe('2026-05-01T00:00:00');
    expect(iso(startMs.value)).toBe('2026-05-01T00:00:00');
    setWall('end', wall(2026, 7, 20));
    expect(iso(startMs.value)).toBe('2026-07-01T00:00:00');
  });

  test('a rule cannot count an end from itself', () => {
    expect(applyRule('start', { o: { t: 'start' }, steps: [{ t: 'align', p: 'mo', pos: 'end' }] })).toBe(false);
    expect(S.rules.start).toBeNull();
  });

  test('clearing the end pins a start that was reading it', () => {
    setWall('end', wall(2026, 7, 20));
    applyRule('start', startOfEndMonth);
    clearEnd();
    expect(endMs.value).toBeNull();
    expect(isFollowing('start')).toBe(false);
    expect(iso(startMs.value)).toBe('2026-07-01T00:00:00');
  });

  test('swapping the ends carries the rules across', () => {
    setWall('end', wall(2026, 7, 20));
    applyRule('start', startOfEndMonth);
    expect(swapEnds()).toBe(true);
    expect(isFollowing('end')).toBe(true);
    expect(iso(startMs.value)).toBe('2026-07-20T00:00:00');
    expect(iso(endMs.value)).toBe('2026-07-01T00:00:00');
    setWall('start', wall(2026, 9, 9));
    expect(iso(endMs.value)).toBe('2026-09-01T00:00:00');
  });

  test('changing the start zone keeps the instant, and a shared end zone follows', () => {
    setWall('start', wall(2026, 1, 1, 12));
    setWall('end', wall(2026, 1, 2, 12));
    const s0 = startMs.value,
      e0 = endMs.value;
    setStartTz('Asia/Tokyo');
    expect(S.endTz).toBe('Asia/Tokyo');
    expect(S.start.h).toBe(21);
    expect(startMs.value).toBe(s0);
    expect(endMs.value).toBe(e0);
  });

  test('a zone change and a shared link preserve the later occurrence of a repeated time', () => {
    const search = sessionSearch('');
    const first = Date.UTC(2026, 10, 1, 5, 30);
    const second = first + 3600000;
    setInstant('start', first);
    setInstant('end', second);
    setStartTz('America/New_York');
    expect([startMs.value, endMs.value]).toEqual([first, second]);
    const query = search.value;
    setStartTz('UTC');
    applyUrl(query, false);
    expect([startMs.value, endMs.value]).toEqual([first, second]);
  });

  test('editing the end of an older bookmark replaces its preset and undo restores the bookmark', () => {
    const original = '?p=newyear&tz=Asia/Taipei';
    applyUrl(original, false);
    const search = sessionSearch(original);
    commit(() => setWall('end', wall(2026, 12, 15)));
    expect(Object.fromEntries(new URLSearchParams(search.value))).toEqual({ tz: 'Asia/Taipei', e: '2026-12-15' });
    undo();
    expect(search.value).toBe(original);
  });
});

describe('undo history', () => {
  test('undo restores a span with more than 59 minutes and keeps it editable', () => {
    const span = parseSpan('1h 90m')!;
    setLink(span);
    commit(() => setWall('end', wall(2026, 5, 1)));
    undo();
    expect(gapSec.value).toBe(150 * 60);
    expect(S.link?.span).toEqual(span);
    expect(parseSpan(fmtSpan(span))).toEqual(span);
  });
  test('a change is one step; undo and redo walk it', () => {
    commit(() => setWall('end', wall(2026, 2, 1)), { label: '結束' });
    expect(history.undo.length).toBe(1);
    undo();
    expect(endMs.value).toBeNull();
    expect(history.redo.length).toBe(1);
    redo();
    expect(iso(endMs.value)).toBe('2026-02-01T00:00:00');
  });

  test('refused and empty changes leave no step', () => {
    expect(commit(() => false)).toBe(false);
    commit(() => {
      S.start = wall(2026, 1, 1);
    });
    expect(history.undo.length).toBe(0);
  });

  test('the clock moving a live end is not a change', () => {
    setLive('start', true);
    now.value = NOW + 5000;
    commit(() => {});
    expect(history.undo.length).toBe(0);
  });

  test('quick repeats with the same key merge into one step', () => {
    commit(() => setWall('start', wall(2026, 1, 2)), { key: 'drag' });
    commit(() => setWall('start', wall(2026, 1, 3)), { key: 'drag' });
    expect(history.undo.length).toBe(1);
    undo();
    expect(iso(startMs.value)).toBe('2026-01-01T00:00:00');
  });
});
