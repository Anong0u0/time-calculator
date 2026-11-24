import { describe, expect, test } from 'bun:test';
import {
  isoWeek,
  isoWeeksInYear,
  isoWeekStart,
  usWeek,
  diffCalendar,
  toInstant,
  wallToInstant,
  partsInTz,
  addDuration,
  parseSpan,
  fmtSpan,
  evalDuration,
  interpretSpanText,
  parseTimestamp,
  addBusinessDays,
  countWeekdays,
  dayNum,
  spanBetween,
  fmtClock,
  isoDuration,
  fmtOffset,
  offsetAt,
  nextLeap,
} from '../src/core/time';
import { searchZones, zoneInText, DIR } from '../src/core/zones';
import { parseDateTimeText } from '../src/core/parse';
import { LAND, COORDS, isLand, subsolar } from '../src/core/geo';

describe('ISO weeks', () => {
  test('known dates', () => {
    expect(isoWeek(2026, 11, 23)).toEqual({ weekYear: 2026, week: 48, weekday: 1 });
    expect(isoWeek(2027, 1, 1)).toEqual({ weekYear: 2026, week: 53, weekday: 5 });
    expect(isoWeek(2021, 1, 3).week).toBe(53);
    expect(isoWeeksInYear(2026)).toBe(53);
    expect(isoWeeksInYear(2027)).toBe(52);
    expect(isoWeekStart(2026, 1)).toEqual({ y: 2025, mo: 12, d: 29 });
    expect(usWeek(2026, 1, 1)).toBe(1);
  });
});

describe('zones and DST', () => {
  test('spring-forward gap pushes forward, fall-back overlap takes the earlier', () => {
    const gap = wallToInstant({ y: 2026, mo: 3, d: 8, h: 2, mi: 30, s: 0 }, 'America/New_York');
    expect(gap.note).toBe('gap');
    expect(partsInTz(gap.ms, 'America/New_York')).toMatchObject({ h: 3, mi: 30 });
    const ov = wallToInstant({ y: 2026, mo: 11, d: 1, h: 1, mi: 30, s: 0 }, 'America/New_York');
    expect(ov.note).toBe('overlap');
    expect(fmtOffset(offsetAt(ov.ms, 'America/New_York'))).toBe('UTC−04:00');
  });
  test('a calendar day across DST is 23 hours on the wall clock', () => {
    const a = toInstant({ y: 2026, mo: 3, d: 7, h: 12, mi: 0, s: 0 }, 'America/New_York');
    const b = addDuration(a, 'America/New_York', { d: 1 }).ms;
    expect((b - a) / 3600000).toBe(23);
    expect(diffCalendar(a, b, 'America/New_York')).toEqual({ y: 0, mo: 0, d: 1, h: 0, mi: 0, s: 0 });
    expect(spanBetween(a, b, 'America/New_York')).toMatchObject({ d: 1, h: 0 });
  });
});

describe('calendar arithmetic', () => {
  test('month end clamps', () => {
    const a = toInstant({ y: 2026, mo: 1, d: 31, h: 0, mi: 0, s: 0 }, 'UTC');
    expect(partsInTz(addDuration(a, 'UTC', { mo: 1 }).ms, 'UTC')).toMatchObject({ mo: 2, d: 28 });
  });
  test('difference', () => {
    const a = toInstant({ y: 2026, mo: 11, d: 23, h: 4, mi: 40, s: 34 }, 'Asia/Taipei');
    const b = toInstant({ y: 2027, mo: 1, d: 1, h: 0, mi: 0, s: 0 }, 'Asia/Taipei');
    expect(diffCalendar(a, b, 'Asia/Taipei')).toEqual({ y: 0, mo: 1, d: 8, h: 19, mi: 19, s: 26 });
  });
  test('business days skip weekends only', () => {
    expect(addBusinessDays({ y: 2026, mo: 11, d: 20 }, 1)).toMatchObject({ mo: 11, d: 23 });
    expect(addBusinessDays({ y: 2026, mo: 11, d: 23 }, 20)).toMatchObject({ mo: 12, d: 21 });
    expect(countWeekdays(dayNum(2026, 11, 23), dayNum(2027, 1, 1))).toBe(29);
  });
});

describe('spans and expressions', () => {
  test('parseSpan round trips', () => {
    for (const t of ['+1年6個月', '−2週3天', '+20工作日', '+40天 10:34:29', '+3小時'])
      expect(fmtSpan(parseSpan(t))).toBe(t);
    expect(parseSpan('3天前')).toMatchObject({ sign: -1, d: 3 });
    expect(() => parseSpan('30')).toThrow();
  });
  test('duration arithmetic', () => {
    const r = evalDuration('2h 45m + 1:30:20 − 15m');
    expect(!r.empty && r.value).toBe(14420);
    const pace = evalDuration('3:59:59 ÷ 42.195');
    expect(!pace.empty && Math.round(pace.value)).toBe(341);
    expect(() => evalDuration('1h × 2h')).toThrow();
  });
  test('interval field: span, arithmetic, ratio, error', () => {
    expect(interpretSpanText('+30天')).toMatchObject({ kind: 'span', expr: false });
    const a = interpretSpanText('47m × 16');
    expect(a.kind === 'span' && a.span).toMatchObject({ h: 12, mi: 32, s: 0 });
    expect(interpretSpanText('2h ÷ 15m')).toMatchObject({ kind: 'ratio', value: 8 });
    expect(interpretSpanText('1年 × 2')).toMatchObject({ kind: 'error' });
    expect(interpretSpanText('30')).toMatchObject({ kind: 'error', soft: true });
  });
  test('clock and ISO formats', () => {
    expect(fmtClock(14420)).toBe('4:00:20');
    expect(isoDuration({ mo: 1, d: 8, h: 19, mi: 19, s: 26 })).toBe('P1M8DT19H19M26S');
  });
});

describe('free text', () => {
  test('dates, times and timestamps', () => {
    expect(parseDateTimeText('2026-12-25 18:00')).toMatchObject({
      kind: 'wall',
      wall: { y: 2026, mo: 12, d: 25, h: 18 },
    });
    expect(parseDateTimeText('2026年12月25日 下午3點', 2026)).toMatchObject({ kind: 'wall', wall: { h: 15 } });
    expect(parseDateTimeText('12/25', 2026)).toMatchObject({ kind: 'wall', wall: { y: 2026, mo: 12, d: 25 } });
    expect(parseDateTimeText('15:30')).toMatchObject({ kind: 'time', h: 15, mi: 30 });
    expect(parseDateTimeText('1795380034')).toMatchObject({ kind: 'instant', unit: 's', ms: 1795380034000 });
    expect(parseTimestamp('1795380034000')).toEqual({ ms: 1795380034000, unit: 'ms' });
  });
  test('zones by name and in text', () => {
    expect(searchZones('東京')[0].z.id).toBe('Asia/Tokyo');
    expect(searchZones('utc+8').some((h) => h.z.id === 'Asia/Taipei')).toBe(true);
    expect(zoneInText('東京 15:00')).toMatchObject({ zone: { id: 'Asia/Tokyo' }, rest: '15:00' });
    expect(zoneInText('3pm in New York')).toMatchObject({ zone: { id: 'America/New_York' }, rest: '3pm' });
  });
});

describe('restored instruments', () => {
  test('next leap year and US week numbers', () => {
    expect(nextLeap(2026)).toBe(2028);
    expect(nextLeap(2028)).toBe(2032);
    expect(nextLeap(2096)).toBe(2104);
    expect(usWeek(2026, 11, 24)).toBe(48);
    expect(usWeek(2026, 1, 3)).toBe(1);
    expect(usWeek(2026, 1, 4)).toBe(2);
  });
  test('the sun: declination at the solstice and equinox, overhead near Greenwich at noon UTC', () => {
    const june = subsolar(Date.UTC(2026, 5, 21, 12));
    expect(june.lat).toBeGreaterThan(23.3);
    expect(june.lat).toBeLessThan(23.5);
    expect(Math.abs(june.lon)).toBeLessThan(2);
    const march = subsolar(Date.UTC(2026, 2, 20, 12));
    expect(Math.abs(march.lat)).toBeLessThan(0.5);
    const dec = subsolar(Date.UTC(2026, 11, 21, 0));
    expect(dec.lat).toBeLessThan(-23.3);
    expect(Math.abs(Math.abs(dec.lon) - 180)).toBeLessThan(3);
  });
  test('the land mask and city coordinates', () => {
    const cell = (lat: number, lon: number) =>
      isLand(Math.floor((LAND.top - lat) / LAND.step), Math.floor((lon + 180) / LAND.step));
    expect(cell(23, 13)).toBe(true); // Sahara
    expect(cell(0, -140)).toBe(false); // central Pacific
    expect(cell(25.03, 121.56)).toBe(true); // Taipei
    for (const z of DIR.filter((d) => d.curated && d.id !== 'UTC')) expect(COORDS[z.id]).toBeDefined();
  });
});

describe('command bar and the duration calculator', () => {
  test('an expression offers the calculator; a ratio opens it instead of being read-only', async () => {
    const { interpret } = await import('../src/state/command');
    const { S } = await import('../src/state/store');
    const { ui } = await import('../src/state/ui');
    const expr = interpret('47m × 16');
    expect(expr.map((s) => s.kind)).toEqual(['span', 'calc']);
    const ratio = interpret('2h ÷ 15m');
    expect(ratio[0].kind).toBe('calc');
    expect(ratio[0].title).toBe('= 8 倍');
    const before = ui.durReq;
    ratio[0].apply!();
    expect(S.dur).toBe('2h ÷ 15m');
    expect(S.durSample).toBe(false);
    expect(ui.durReq).toBe(before + 1);
  });
});

import { parseQuery, wallParam, parseWallParam, spanParam, startUrlSync } from '../src/state/url';
import { LOCAL_TZ } from '../src/core/zones';
import { S } from '../src/state/store';

describe('address bar', () => {
  test('wall times in the shortest form, and back', () => {
    expect(wallParam({ y: 2026, mo: 11, d: 24, h: 0, mi: 0, s: 0 })).toBe('2026-11-24');
    expect(wallParam({ y: 2026, mo: 11, d: 24, h: 16, mi: 5, s: 0 })).toBe('2026-11-24T16:05');
    expect(wallParam({ y: 33, mo: 1, d: 2, h: 3, mi: 4, s: 5 })).toBe('0033-01-02T03:04:05');
    expect(parseWallParam('2026-11-24T16:05', 'UTC')).toEqual({ y: 2026, mo: 11, d: 24, h: 16, mi: 5, s: 0 });
    expect(parseWallParam('2026-2-30', 'UTC')).toBeNull();
    // Unix seconds and milliseconds, read on the given clock
    expect(parseWallParam('1700000000', 'UTC')).toEqual({ y: 2023, mo: 11, d: 14, h: 22, mi: 13, s: 20 });
    expect(parseWallParam('1700000000000', 'Asia/Tokyo')).toEqual({ y: 2023, mo: 11, d: 15, h: 7, mi: 13, s: 20 });
  });
  test('spans round-trip through the compact form', () => {
    for (const t of ['+1年2個月3週4天 5:06:07', '−3小時', '+28工作日', '+30天', '+0天']) {
      const r = interpretSpanText(t);
      if (r.kind !== 'span') throw new Error(t);
      const back = interpretSpanText(spanParam(r.span));
      if (back.kind !== 'span') throw new Error(spanParam(r.span));
      expect(fmtSpan(back.span)).toBe(fmtSpan(r.span));
    }
    const r = interpretSpanText('+28工作日');
    if (r.kind === 'span') expect(spanParam(r.span)).toBe('28bd');
  });
  test('reading a link', () => {
    const u = parseQuery('?s=2000-01-01T08:00&tz=Asia/Tokyo&d=30d&z=Europe/London,Not/AZone,America/New_York');
    expect(u?.time).toBe(true);
    expect(u?.s).toEqual({ y: 2000, mo: 1, d: 1, h: 8, mi: 0, s: 0 });
    expect(u?.tz).toBe('Asia/Tokyo');
    expect(u?.d?.expr).toBe('+30天');
    expect(u?.z).toEqual(['Europe/London', 'America/New_York']);
    // a period end without a fixed date, unknown keys ignored
    const p = parseQuery('?p=newyear&foo=1');
    expect(p?.time).toBe(true);
    expect(p?.er).toMatchObject({ code: 'n/ay.end', name: '跨年', follow: false });
    expect(parseQuery('?er=!n/amo.end')?.er).toMatchObject({ code: 'n/amo.end', follow: true });
    expect(p?.tz).toBeUndefined();
    expect(parseQuery('?foo=1')).toBeNull();
    // only the zone list: the time is left alone
    expect(parseQuery('?z=Asia/Tokyo')?.time).toBe(false);
    // + typed by hand arrives as a space and still reads
    expect(parseQuery('?d=+3h')?.d?.expr).toBe('+3小時');
    expect(LOCAL_TZ.length).toBeGreaterThan(0);
  });
  test('the address is written only after a value changes', async () => {
    const g = globalThis as unknown as Record<string, unknown>;
    const was = { location: g.location, history: g.history };
    const writes: string[] = [];
    g.location = { pathname: '/', search: '', hash: '' };
    g.history = {
      state: null,
      replaceState: (_s: unknown, _t: string, u: string) => {
        writes.push(u);
      },
    };
    const dur = S.dur,
      durSample = S.durSample;
    const stop = startUrlSync();
    try {
      await Bun.sleep(300);
      expect(writes).toEqual([]);
      S.dur = '3h × 4';
      S.durSample = false;
      await Bun.sleep(300);
      expect(writes.length).toBe(1);
      expect(writes[0]).toContain('calc=');
    } finally {
      stop();
      S.dur = dur;
      S.durSample = durSample;
      g.location = was.location;
      g.history = was.history;
    }
  });
});

import { parseReading, splitRange, splitDatePlusSpan } from '../src/core/parse';

describe('reading any way of writing a date', () => {
  const today = { y: 2026, mo: 11, d: 24 }; // a Tuesday
  const read = (t: string) => {
    const r = parseDateTimeText(t, { year: 2026, today });
    if (!r || r.kind !== 'wall') return r?.kind === 'time' ? `time ${r.h}:${r.mi}` : null;
    const w = r.wall;
    return `${w.y}-${w.mo}-${w.d} ${w.h}:${w.mi}`;
  };
  test('separators, order and words do not matter', () => {
    for (const t of [
      '2000/1/1/20:34',
      '2000.1.1 20.34',
      '2000-01-01T20:34',
      '20000101 2034',
      '2000 1 1 20 34',
      '1/1/2000 8:34pm',
      'Jan 1 2000 8:34 PM',
      '2000年1月1日晚上8點34分',
      '二〇〇〇年一月一日晚上八點三十四分',
      '2000/1/1(六)20:34',
      'Sat, 1 Jan 2000 20:34:00',
    ])
      expect(read(t)).toBe('2000-1-1 20:34');
  });
  test('words that count from today', () => {
    expect(read('明天下午3點')).toBe('2026-11-25 15:0');
    expect(read('後天')).toBe('2026-11-26 0:0');
    expect(read('昨天 18:00')).toBe('2026-11-23 18:0');
    expect(read('下週五')).toBe('2026-12-4 0:0');
    expect(read('週五')).toBe('2026-11-27 0:0');
    expect(read('next friday 3pm')).toBe('2026-11-27 15:0');
    expect(read('今晚8點')).toBe('2026-11-24 20:0');
    expect(read('下個月5號')).toBe('2026-12-5 0:0');
    expect(read('晚上12點')).toBe('2026-11-25 0:0');
  });
  test('民國, ISO weeks, ordinal days, half hours', () => {
    expect(read('民國115年11月24日')).toBe('2026-11-24 0:0');
    expect(read('115/11/24')).toBe('2026-11-24 0:0');
    expect(read('2026-W48-2')).toBe('2026-11-24 0:0');
    expect(read('2026年第328天')).toBe('2026-11-24 0:0');
    expect(read('3點半')).toBe('time 3:30');
    expect(read('下午3點一刻')).toBe('time 15:15');
  });
  test('when day and month could swap, both readings come back', () => {
    const r = parseDateTimeText('1/2/2026', { today });
    expect(r).toMatchObject({ kind: 'wall', wall: { mo: 1, d: 2 }, alt: { wall: { mo: 2, d: 1 } } });
    expect(parseDateTimeText('25/12/2026', { today })).toMatchObject({ wall: { mo: 12, d: 25 } });
  });
  test('offsets are kept', () => {
    expect(parseDateTimeText('Tue, 24 Nov 2026 16:13:05 +0800')).toMatchObject({ kind: 'wall', offset: 8 * 3600000 });
    expect(parseDateTimeText('2026-11-24T08:13:05.123Z')).toMatchObject({ kind: 'wall', offset: 0, wall: { s: 5 } });
  });
  test('lengths and other text are left alone', () => {
    for (const t of ['30天', '3月', '15日', '5年', '2h 45m', '47m × 16', '東京', 'W12'])
      expect(parseDateTimeText(t, { year: 2026, today })).toBeNull();
    expect(read('2000年')).toBe('2000-1-1 0:0');
  });
  test('ranges and a moment plus a length are split', () => {
    expect(splitRange('2000/1/1 到 現在')).toEqual(['2000/1/1', '現在']);
    expect(splitRange('2026-01-01 - 2026-02-01')).toEqual(['2026-01-01', '2026-02-01']);
    expect(splitRange('2026-01-01')).toBeNull();
    expect(splitDatePlusSpan('2026/1/1 + 30天')).toEqual({ date: '2026/1/1', sign: 1, span: '30天' });
  });
  test('every reading can be typed back', () => {
    const cur = { y: 2026, mo: 11, d: 24, h: 16, mi: 13, s: 5 };
    const ctx = { now: Date.UTC(2026, 10, 24, 8, 13, 5), tz: 'Asia/Taipei', cur, parseSpanText: () => null };
    expect(parseReading('roc', '民國 114 年 11 月 24 日', ctx)).toEqual({ wall: { ...cur, y: 2025 } });
    expect(parseReading('week', '2026-W01-1', ctx)).toEqual({ wall: { ...cur, y: 2025, mo: 12, d: 29 } });
    expect(parseReading('week', '2026-W02', ctx)).toEqual({ wall: { ...cur, y: 2026, mo: 1, d: 6 } }); // keeps Tuesday
    expect(parseReading('usweek', '2026 年 W01', ctx)).toEqual({ wall: { ...cur, y: 2025, mo: 12, d: 30 } });
    expect(parseReading('doy', '第 1 天 · Q1 · 平年（下次閏年 2028）', ctx)).toEqual({ wall: { ...cur, mo: 1, d: 1 } });
    expect(parseReading('unix', '0', ctx)).toEqual({ ms: 0 });
    expect(parseReading('unixms', '1500', ctx)).toEqual({ ms: 1500 });
    expect(parseReading('excel', '46350.5', ctx)).toEqual({ wall: { y: 2026, mo: 11, d: 24, h: 12, mi: 0, s: 0 } });
    expect(parseReading('rel', '就是現在', ctx)).toEqual({ live: true });
    expect(parseReading('iso', '2026-11-24T16:13:05+08:00', ctx)).toEqual({ ms: Date.UTC(2026, 10, 24, 8, 13, 5) });
  });
  test('lengths: fractions, words, ISO and sums', () => {
    const f = (t: string) => {
      const r = interpretSpanText(t);
      return r.kind === 'span' ? fmtSpan(r.span) : r.kind;
    };
    expect(f('1.5天')).toBe('+1天 12小時');
    expect(f('2h30')).toBe('+2:30');
    expect(f('三天前')).toBe('−3天');
    expect(f('1年 + 3天')).toBe('+1年3天');
    expect(f('in 3 days')).toBe('+3天');
    expect(f('P1M7DT12H')).toBe('+1個月7天 12小時');
    expect(f('半小時')).toBe('+30分');
  });
});

describe('the two ends are alike', () => {
  test('the end can follow the clock, and the span can count the start back from it', async () => {
    const st = await import('../src/state/store');
    const { S, setWall, setLive, setLink, startMs, endMs, swapEnds, now, isDerived, linkTarget } = st;
    S.startTz = 'UTC';
    S.endTz = 'UTC';
    setWall('start', { y: 2000, mo: 1, d: 1, h: 0, mi: 0, s: 0 });
    setLive('end', true);
    expect(endMs.value).toBe(Math.floor(now.value / 1000) * 1000);
    expect(linkTarget()).toBe('start');
    setLink({ sign: 1, y: 0, mo: 0, w: 0, d: 30, h: 0, mi: 0, s: 0, biz: false });
    expect(isDerived('start')).toBe(true);
    expect(endMs.value! - startMs.value).toBe(30 * 86400000);
    // setting the anchor moves the computed end; setting the computed end cuts the link
    setWall('end', { y: 2020, mo: 3, d: 31, h: 0, mi: 0, s: 0 });
    expect(startMs.value).toBe(Date.UTC(2020, 2, 1));
    expect(S.link).not.toBeNull();
    // swap carries "follows the clock" and "computed" across
    setLive('end', true);
    swapEnds();
    expect(S.live).toBe(true);
    expect(S.endLive).toBe(false);
    expect(isDerived('end')).toBe(true);
    expect(startMs.value - endMs.value!).toBe(30 * 86400000);
    setWall('start', { y: 2001, mo: 1, d: 1, h: 0, mi: 0, s: 0 });
    expect(endMs.value).toBe(Date.UTC(2000, 11, 2));
  });
  test('a live end and a backward span survive the address bar', async () => {
    const { S, setWall, setLive, setLink, isDerived } = await import('../src/state/store');
    const { buildQuery, applyUrl } = await import('../src/state/url');
    S.startTz = 'UTC';
    S.endTz = 'UTC';
    setWall('start', { y: 2000, mo: 1, d: 1, h: 0, mi: 0, s: 0 });
    S.link = null;
    setLive('end', true);
    setLink({ sign: 1, y: 0, mo: 0, w: 0, d: 30, h: 0, mi: 0, s: 0, biz: false });
    const q = buildQuery();
    expect(q).toContain('e=now');
    expect(q).toContain('ds=30d');
    expect(q).not.toContain('s=2000');
    setWall('end', { y: 2020, mo: 1, d: 1, h: 0, mi: 0, s: 0 });
    S.link = null;
    applyUrl('?' + q, false);
    expect(S.endLive).toBe(true);
    expect(isDerived('start')).toBe(true);
  });
});

import { lunarOfDay, lunarYear, lunarNewYear, fmtLunar, fromLunar } from '../src/core/lunar';
import { termMoment, TERM_NAMES } from '../src/core/terms';
import { evalRule, encodeRule, decodeRule, ruleName, spanOfRule, type Rule } from '../src/core/rule';
import { parseRuleText } from '../src/core/ruletext';
import { wordRule, setVocab, rulePrefs } from '../src/core/vocab';

describe('the lunar calendar and the solar terms', () => {
  test('terms land within a minute of the published times', () => {
    const near = (y: number, k: number, iso: string) =>
      expect(Math.abs(termMoment(y, k) - Date.parse(iso))).toBeLessThan(90_000);
    near(2024, 0, '2024-03-20T03:06Z');
    near(2024, 6, '2024-06-20T20:51Z');
    near(2025, 18, '2025-12-21T15:03Z');
    near(2000, 0, '2000-03-20T07:35Z');
    expect(TERM_NAMES[18]).toBe('冬至');
  });
  test('lunar dates, leap months and new years', () => {
    const n = (y: number, mo: number, d: number) => dayNum(y, mo, d);
    expect(fmtLunar(lunarOfDay(n(2026, 11, 24))!)).toBe('丙午年 十月十六');
    expect(lunarOfDay(n(2025, 7, 25))).toMatchObject({ y: 2025, m: 6, leap: true, d: 1 });
    expect(lunarNewYear(2027)).toEqual({ y: 2027, mo: 2, d: 6 });
    expect(lunarNewYear(2030)).toEqual({ y: 2030, mo: 2, d: 3 });
    // the almanac's leap months where the browser's calendar disagrees
    for (const [y, m] of [
      [1917, 2],
      [1922, 5],
      [1987, 6],
      [2033, 11],
    ])
      expect(lunarYear(y)!.months.find((x) => x.leap)!.m).toBe(m);
    expect(fromLunar(2026, 8, 15)).toBe(n(2026, 9, 25));
  });
});

describe('rules', () => {
  setVocab([], []);
  const now = Date.UTC(2026, 10, 24, 6, 13, 5); // Tue 2026-11-24 14:13:05 in Taipei
  const ends = { start: Date.UTC(2026, 2, 14, 1, 30), end: Date.UTC(2026, 11, 31, 16) };
  const at = (text: string, self: 'start' | 'end' = 'end', alt = -1) => {
    const r = parseRuleText(text, { year: 2026, today: { y: 2026, mo: 11, d: 24 } });
    if (!r) return null;
    const rd = alt < 0 ? r.main : r.alts[alt];
    const e = evalRule(rd.rule, { now, tz: 'Asia/Taipei', self, ends, prefs: rulePrefs(), word: wordRule });
    return e.ok ? new Date(e.ms + 8 * 3600e3).toISOString().slice(0, 16).replace('T', ' ') : e.err;
  };
  test('words combine', () => {
    expect(at('明晚')).toBe('2026-11-25 20:00');
    expect(at('本周三 3點')).toBe('2026-11-25 03:00');
    expect(at('本周三 3點', 'end', 0)).toBe('2026-11-25 15:00');
    expect(at('下個月底')).toBe('2026-12-31 00:00');
    expect(at('月底 18:00')).toBe('2026-11-30 18:00');
    expect(at('下週末')).toBe('2026-12-05 00:00');
    expect(at('明年中秋晚上8點')).toBe('2027-09-15 20:00');
    expect(at('今年中秋')).toBe('2026-09-25 00:00');
    expect(at('中秋')).toBe('2027-09-15 00:00');
    expect(at('除夕')).toBe('2027-02-05 00:00');
    expect(at('母親節')).toBe('2027-05-09 00:00');
    expect(at('冬至那一刻')).toBe('2026-12-22 04:50');
    expect(at('8pm tomorrow')).toBe('2026-11-25 20:00');
    expect(at('2027年中秋')).toBe('2027-09-15 00:00');
    expect(at('下下個中秋')).toBe('2028-10-03 00:00');
  });
  test('from either end', () => {
    expect(at('開始那個月的月底')).toBe('2026-03-31 00:00');
    expect(at('結束前最後一個週五', 'start')).toBe('2026-12-25 00:00');
    expect(at('+30天')).toBe('2026-04-13 09:30');
  });
  test('stored as a short text and read back', () => {
    for (const t of [
      '明晚',
      '下個月底',
      '冬至那一刻',
      '結束前最後一個週五',
      '下下個中秋',
      '第三個週三',
      '2000/1/1 20:34',
    ]) {
      const r = parseRuleText(t)!.main.rule;
      expect(encodeRule(decodeRule(encodeRule(r))!)).toBe(encodeRule(r));
    }
    expect(decodeRule('n/+1x')).toBeNull();
    expect(ruleName(parseRuleText('明年春節')!.main.rule)).toBe('明年 春節');
  });
  test('a link is a rule', () => {
    const r: Rule = {
      o: { t: 'other' },
      steps: [
        { t: 'move', n: 1, u: 'mo' },
        { t: 'move', n: 7, u: 'd' },
      ],
    };
    expect(spanOfRule(r, 'end')).toMatchObject({ sign: 1, mo: 1, d: 7 });
    expect(spanOfRule({ o: { t: 'now' }, steps: [] }, 'end')).toBeNull();
  });
  test('your own words', () => {
    setVocab(
      [
        { name: '發薪日', code: 'n/pnext!:d5' },
        { name: '下班', code: 'n/t1800' },
      ],
      [],
    );
    expect(at('下個月發薪日')).toBe('2026-12-05 00:00');
    expect(at('明天下班')).toBe('2026-11-25 18:00');
    expect(at('發薪日')).toBe('2026-12-05 00:00');
    setVocab([], ['中秋']);
    expect(parseRuleText('中秋')).toBeNull();
    setVocab([], []);
  });
});

describe('lunar and term readings typed back', () => {
  const cur = { y: 2026, mo: 11, d: 24, h: 16, mi: 13, s: 5 };
  const ctx = { now: Date.UTC(2026, 10, 24, 8), tz: 'Asia/Taipei', cur, parseSpanText: () => null };
  test('a lunar date keeps the time of day', () => {
    expect(parseReading('lunar', '丙午年（馬）十月十七', ctx)).toEqual({ wall: { ...cur, d: 25 } });
    expect(parseReading('lunar', '正月初一', ctx)).toEqual({ wall: { ...cur, mo: 2, d: 17 } });
    expect(parseReading('lunar', '丁未年正月初一', ctx)).toEqual({ wall: { ...cur, y: 2027, mo: 2, d: 6 } });
  });
  test('a term, and days into it', () => {
    expect(parseReading('term', '冬至', ctx)).toEqual({ wall: { ...cur, mo: 12, d: 22 } });
    expect(parseReading('term', '小雪 第 3 天 · 下一個 大雪 12/7', ctx)).toEqual({ wall: { ...cur, mo: 11, d: 24 } });
  });
});
