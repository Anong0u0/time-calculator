/* One box that takes any text: a date, a timestamp, "+30天", "東京 15:00", "W12", "47m × 16".
   Each reading of the text becomes a suggestion with a live preview; Enter applies the first. */
import {
  type Wall, normalizeWide, parseDateTimeText, interpretSpanText, fmtSpan, fmtDT, fmtTime, fmtClock, pad, wdOf, WD,
  toInstant, partsInTz, validWall, wallKey, isoWeek, isoWeekStart, isoWeeksInYear, addDaysWall,
} from '../core/time';
import { nfMax, durWords } from '../core/format';
import { zoneInText, searchZones, zoneName, sameZone } from '../core/zones';
import {
  S, type End, other, wallOf, tzOf, startWall, commit, setWall, setInstant, setLink, checkSpan, setLive,
  setStartTz, setEndTz, addZoneRow, zoneRows, applyEndPreset, periodBounds, PERIOD_NAMES, type PeriodKey,
} from './store';

export interface Suggestion {
  id: string;
  kind: End | 'span' | 'zone' | 'info';
  title: string;
  detail?: string;
  apply?: () => void;
}

const SUBJ = { start: '開始', end: '結束' } as const;
const whenText = (w: Wall) => `${fmtDT(w)}（${WD[wdOf(w)]}）`;

function clockOf(raw: string, base: Wall): Wall | null {
  const t = normalizeWide(raw).trim().replace(/\s+/g, ' ');
  if (!t) return null;
  const m = /^(上午|下午|早上|晚上|凌晨|中午|傍晚)?\s*(\d{1,2})(?:[:：.點点時]?(\d{2}))?(?::(\d{2}))?\s*分?\s*(am|pm|a\.m\.|p\.m\.)?$/i.exec(t);
  if (m) {
    let h = +m[2];
    const mi = +(m[3] || 0), s = +(m[4] || 0), mer = (m[1] || m[5] || '').toLowerCase();
    if (!m[3] && !mer && !/[點点時]/.test(t)) return null;
    if (/^(下午|晚上|傍晚|中午|pm|p\.m\.)$/.test(mer) && h < 12) h += 12;
    if (/^(上午|早上|凌晨|am|a\.m\.)$/.test(mer) && h === 12) h = 0;
    return h <= 23 && mi <= 59 && s <= 59 ? { ...base, h, mi, s } : null;
  }
  const r = parseDateTimeText(t, base.y);
  if (r && r.kind === 'time') return { ...base, h: r.h, mi: r.mi, s: r.s };
  if (r && r.kind === 'wall') return r.wall;
  return null;
}
export { clockOf };

function endsOrder(): End[] { return [S.active, other(S.active)]; }

function instantSuggestions(ms: number, how: string, out: Suggestion[]) {
  for (const which of endsOrder()) {
    const w = partsInTz(ms, tzOf(which));
    if (!validWall(w)) continue;
    out.push({
      id: `set-${which}`, kind: which, title: `設為${SUBJ[which]}`, detail: `${whenText(w)} · ${how}`,
      apply: () => commit(() => setInstant(which, ms), { label: `設定${SUBJ[which]}`, say: `${SUBJ[which]}：${fmtDT(w)}` }),
    });
  }
}
function wallSuggestions(w: Wall, how: string, out: Suggestion[]) {
  for (const which of endsOrder()) {
    out.push({
      id: `set-${which}`, kind: which, title: `設為${SUBJ[which]}`, detail: `${whenText(w)} · ${how}`,
      apply: () => commit(() => setWall(which, w), { label: `設定${SUBJ[which]}`, say: `${SUBJ[which]}：${fmtDT(w)}` }),
    });
  }
}

export function interpret(input: string): Suggestion[] {
  const text = normalizeWide(input).trim();
  const out: Suggestion[] = [];
  if (!text) return out;

  // words
  if (/^(現在|now|即時|live)$/i.test(text)) {
    out.push({ id: 'live', kind: 'start', title: '開始回到現在', detail: '開始跟著時間走', apply: () => commit(() => setLive(true), { label: '開始回到現在', say: '開始跟著現在走' }) });
    return out;
  }
  const preset = ({ 跨年: 'newyear', 新年: 'newyear', 元旦: 'newyear', 春節: 'lny', 過年: 'lny', 農曆新年: 'lny', 月底: 'month', 本月底: 'month', 週末: 'week', 本週末: 'week', 今晚: 'day', 今天結束: 'day' } as Record<string, PeriodKey>)[text];
  if (preset) {
    const b = periodBounds(preset);
    if (b) {
      const w = partsInTz(b[1], S.endTz);
      out.push({ id: 'preset', kind: 'end', title: `結束設為${PERIOD_NAMES[preset]}`, detail: whenText(w), apply: () => commit(() => applyEndPreset(preset), { label: `結束：${PERIOD_NAMES[preset]}`, say: `結束：${fmtDT(w)}` }) });
      return out;
    }
  }

  // week: W12, 2027-W02, 第12週
  const wk = /^(?:(\d{4})\s*[-/年\s]?\s*)?(?:W|第)\s*(\d{1,2})\s*週?$/i.exec(text);
  if (wk) {
    for (const which of endsOrder()) {
      const base = wallOf(which);
      if (!base) continue;
      const iw = isoWeek(base.y, base.mo, base.d);
      const y = wk[1] ? +wk[1] : iw.weekYear, k = +wk[2];
      if (k < 1 || k > isoWeeksInYear(y)) { out.push({ id: 'wk-err', kind: 'info', title: `${y} 年只有第 1–${isoWeeksInYear(y)} 週` }); break; }
      const d = addDaysWall({ ...isoWeekStart(y, k), h: 0, mi: 0, s: 0 }, iw.weekday - 1);
      const w = { ...base, y: d.y, mo: d.mo, d: d.d };
      out.push({ id: `wk-${which}`, kind: which, title: `${SUBJ[which]}移到 ${y} 年第 ${k} 週`, detail: `同樣是星期${WD[wdOf(w)]}：${whenText(w)}`, apply: () => commit(() => setWall(which, w), { label: `${SUBJ[which]}移到第 ${k} 週`, say: `${SUBJ[which]}：${fmtDT(w)}` }) });
    }
    if (out.length) return out;
  }

  // a city and a time: "東京 15:00", "3pm New York"
  const zt = zoneInText(text);
  if (zt) {
    const zid = zt.zone.id;
    if (zt.rest) {
      const base = partsInTz(Date.now(), zid);
      const ref = wallOf(S.active) ? partsInTz(toInstant(wallOf(S.active)!, tzOf(S.active)), zid) : base;
      const w = clockOf(zt.rest, ref);
      if (w && validWall(w)) {
        const ms = toInstant(w, zid);
        for (const which of endsOrder()) {
          const mine = partsInTz(ms, tzOf(which));
          out.push({
            id: `zt-${which}`, kind: which, title: `設為${SUBJ[which]}`,
            detail: `${zt.zone.zh} ${pad(w.h)}:${pad(w.mi)} = ${zoneName(tzOf(which))} ${whenText(mine)}`,
            apply: () => commit(() => setInstant(which, ms), { label: `設定${SUBJ[which]}`, say: `${zt.zone.zh} ${pad(w.h)}:${pad(w.mi)} = ${SUBJ[which]} ${fmtTime(mine)}` }),
          });
        }
        return out;
      }
    } else {
      zoneSuggestions(zid, out);
      return out;
    }
  }

  // a length or arithmetic ("+30天", "3天前", "47m × 16", "2h ÷ 15m") or a date, a time of day, a timestamp
  const signed = /^[+\-−＋]/.test(text) || /(前|後|后|ago|later)$/i.test(text);
  const p = signed || /^\d{1,6}$/.test(text) ? null : parseDateTimeText(text, startWall.value.y);
  if (p) {
    if (p.kind === 'instant') {
      const how = { s: '秒級時間戳', ms: '毫秒級時間戳', us: '微秒級時間戳', ns: '奈秒級時間戳', text: '含時區的時間' }[p.unit];
      instantSuggestions(p.ms, how, out);
    } else if (p.kind === 'wall') {
      if (p.offset != null) instantSuggestions(wallKey(p.wall) - p.offset, '含時區的時間', out);
      else wallSuggestions(p.wall, p.hasTime ? '日期與時刻' : '日期', out);
    } else {
      for (const which of endsOrder()) {
        const base = wallOf(which) || startWall.value;
        const w = { ...base, h: p.h, mi: p.mi, s: p.s };
        out.push({ id: `time-${which}`, kind: which, title: `${SUBJ[which]}改成 ${fmtTime(w)}`, detail: `日期不變：${whenText(w)}`, apply: () => commit(() => setWall(which, w), { label: `設定${SUBJ[which]}`, say: `${SUBJ[which]}：${fmtDT(w)}` }) });
      }
    }
    return out;
  }
  const r = interpretSpanText(text);
  if (r.kind === 'span') {
    const c = checkSpan(r.span);
    const exprTxt = r.expr && r.result && !r.result.empty ? `= ${fmtClock(r.result.value)}（${durWords(r.result.value)}）` : '';
    if (c.ok) {
      out.push({
        id: 'span', kind: 'span', title: `結束 = 開始 ${fmtSpan(r.span)}`, detail: `${exprTxt ? exprTxt + ' · ' : ''}${whenText(c.w)}`,
        apply: () => commit(() => setLink(r.span), { label: `間隔 ${fmtSpan(r.span)}`, say: `結束 = 開始 ${fmtSpan(r.span)}` }),
      });
    } else out.push({ id: 'span-err', kind: 'info', title: c.err });
    return out;
  }
  if (r.kind === 'ratio') {
    out.push({ id: 'ratio', kind: 'info', title: `= ${nfMax(r.value, 4)} 倍`, detail: '結果是倍數，不會改變開始或結束' });
    return out;
  }

  // a place
  if (/[a-z一-鿿]/i.test(text) || /^(utc|gmt)?\s*[+\-−]\d/i.test(text)) {
    const hits = searchZones(text, Date.now(), 2);
    for (const h of hits) zoneSuggestions(h.z.id, out);
    if (out.length) return out;
  }
  if (r.kind === 'error') out.push({ id: 'err', kind: 'info', title: '看不懂這段文字', detail: '試試 2026-12-25 18:00、1795380034、+30天、東京 15:00、W12 或 47m × 16' });
  return out;
}

function zoneSuggestions(zid: string, out: Suggestion[]) {
  const name = zoneName(zid);
  if (!zoneRows.value.some((z) => sameZone(z, zid))) out.push({ id: `add-${zid}`, kind: 'zone', title: `加入時區：${name}`, detail: '出現在時區列表', apply: () => commit(() => addZoneRow(zid), { label: `加入${name}`, say: `已加入${name}` }) });
  if (!sameZone(S.startTz, zid)) out.push({ id: `stz-${zid}`, kind: 'start', title: `開始改用${name}時區`, detail: '時刻不變', apply: () => commit(() => setStartTz(zid), { label: `開始時區：${name}`, say: `開始時區：${name}，時刻不變` }) });
  if (!sameZone(S.endTz, zid) && wallOf('end')) out.push({ id: `etz-${zid}`, kind: 'end', title: `結束改用${name}時區`, detail: '時刻不變', apply: () => commit(() => setEndTz(zid), { label: `結束時區：${name}`, say: `結束時區：${name}，時刻不變` }) });
}
