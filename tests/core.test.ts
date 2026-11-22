import { describe, expect, test } from 'bun:test';
import {
  isoWeek, isoWeeksInYear, isoWeekStart, usWeek, diffCalendar, toInstant, wallToInstant, partsInTz, addDuration,
  parseSpan, fmtSpan, evalDuration, interpretSpanText, parseDateTimeText, parseTimestamp, addBusinessDays,
  countWeekdays, dayNum, spanBetween, fmtClock, isoDuration, fmtOffset, offsetAt,
} from '../src/core/time';
import { searchZones, zoneInText } from '../src/core/zones';

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
