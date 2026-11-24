import { describe, expect, test } from 'bun:test';
import {
  isoWeek, isoWeeksInYear, isoWeekStart, usWeek, diffCalendar, toInstant, wallToInstant, partsInTz, addDuration,
  parseSpan, fmtSpan, evalDuration, interpretSpanText, parseDateTimeText, parseTimestamp, addBusinessDays,
  countWeekdays, dayNum, spanBetween, fmtClock, isoDuration, fmtOffset, offsetAt, nextLeap,
} from '../src/core/time';
import { searchZones, zoneInText, DIR } from '../src/core/zones';
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
    for (const t of ['+1年6個月', '−2週3天', '+20工作日', '+40天 10:34:29', '+3小時']) expect(fmtSpan(parseSpan(t))).toBe(t);
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
    expect(parseDateTimeText('2026-12-25 18:00')).toMatchObject({ kind: 'wall', wall: { y: 2026, mo: 12, d: 25, h: 18 } });
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
    const cell = (lat: number, lon: number) => isLand(Math.floor((LAND.top - lat) / LAND.step), Math.floor((lon + 180) / LAND.step));
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
    expect(p?.p).toBe('newyear');
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
    g.history = { state: null, replaceState: (_s: unknown, _t: string, u: string) => { writes.push(u); } };
    const dur = S.dur, durSample = S.durSample;
    const stop = startUrlSync();
    try {
      await Bun.sleep(300);
      expect(writes).toEqual([]);
      S.dur = '3h × 4'; S.durSample = false;
      await Bun.sleep(300);
      expect(writes.length).toBe(1);
      expect(writes[0]).toContain('calc=');
    } finally {
      stop();
      S.dur = dur; S.durSample = durSample;
      g.location = was.location; g.history = was.history;
    }
  });
});
