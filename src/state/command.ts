/* One box that takes any text: a date in any common writing, a timestamp, "+30天", "東京 15:00", "W12",
   "47m × 16", a range ("1/1 到 3/1", "2000/1/1 ~ 現在"), or a moment and a length ("2026/1/1 + 30天").
   Each reading of the text becomes a suggestion with a live preview; Enter applies the first. */
import {
  type Wall, normalizeWide, interpretSpanText, parseSpan, fmtSpan, fmtDT, fmtTime, fmtClock, pad, wdOf, WD,
  toInstant, partsInTz, validWall, wallKey, isoWeek, isoWeekStart, isoWeeksInYear, addDaysWall, addDuration,
} from '../core/time';
import { parseDateTimeText, splitRange, splitDatePlusSpan, excelSerial, type ParseOpts, type ParsedText } from '../core/parse';
import { nfMax, durWords } from '../core/format';
import { zoneInText, searchZones, zoneName, sameZone } from '../core/zones';
import {
  S, type End, other, wallOf, tzOf, startWall, commit, setWall, setInstant, setLink, checkSpan, setLive, isLive, linkTarget, linkSentence,
  setStartTz, setEndTz, addZoneRow, zoneRows, applyRule, runRule, toast, type ChipRow,
} from './store';
import { type Rule, encodeRule, ruleReads, ruleUsesNow } from '../core/rule';
import { wordRule } from '../core/vocab';
import { openDuration } from './ui';

export interface Suggestion {
  id: string;
  kind: End | 'span' | 'zone' | 'info' | 'calc' | 'range' | 'chip';
  title: string;
  detail?: string;
  apply?: () => void;
}

const SUBJ = { start: '開始', end: '結束' } as const;
const whenText = (w: Wall) => `${fmtDT(w)}（${WD[wdOf(w)]}）`;

/** Today on this end's clock, and the year a date without one falls in: what 明天, 下週五 and 12/25 are read against. */
export function parseOptsFor(which: End): ParseOpts {
  const n = Date.now();
  const t = partsInTz(n, tzOf(which));
  return { year: startWall.value.y, today: { y: t.y, mo: t.mo, d: t.d }, now: n, tz: tzOf(which) };
}
/** A time typed into a row: 15:00, 下午3點, 3pm, or a whole date and time. `base` is that row's current moment. */
function clockOf(raw: string, base: Wall): Wall | null {
  const t = normalizeWide(raw).trim().replace(/\s+/g, ' ');
  if (!t) return null;
  // 15 alone in a time field is the hour
  if (/^\d{1,2}$/.test(t) && +t <= 23) return { ...base, h: +t, mi: 0, s: 0 };
  const r = parseDateTimeText(t, { year: base.y, today: base });
  if (r && r.kind === 'time') return { ...base, h: r.h, mi: r.mi, s: r.s };
  if (r && r.kind === 'wall') return r.wall;
  return null;
}
export { clockOf };

function endsOrder(): End[] { return [S.active, other(S.active)]; }
const LINK_TXT = (to: End, expr: string) => linkSentence(to, expr);

/* ---------- a side of a range ---------- */
type Side = { live: true } | { live: false; ms: number } | { live: false; wall: Wall } | { live: false; time: { h: number; mi: number; s: number } };
const NOW_RE = /^(現在|now|此刻|即時|live)$/i;
function sideOf(t: string, opts: ParseOpts): Side | null {
  if (NOW_RE.test(t.trim())) return { live: true };
  const p = parseDateTimeText(t, opts);
  if (!p) return null;
  if (p.kind === 'instant') return { live: false, ms: p.ms };
  if (p.kind === 'time') return { live: false, time: p };
  if (p.offset != null) return { live: false, ms: wallKey(p.wall) - p.offset };
  return { live: false, wall: p.wall };
}
/** Where a side lands on this end: a time alone takes the other side's date, or this end's own. */
function sideWall(sd: Side, which: End, otherSide: Side | null): { wall?: Wall; ms?: number; live?: boolean } | null {
  if (sd.live) return { live: true };
  if ('ms' in sd) return { ms: sd.ms };
  if ('wall' in sd) return { wall: sd.wall };
  const dateFrom = otherSide && !otherSide.live && 'wall' in otherSide ? otherSide.wall
    : otherSide && !otherSide.live && 'ms' in otherSide ? partsInTz(otherSide.ms, tzOf(which)) : wallOf(which) || startWall.value;
  return { wall: { ...dateFrom, ...sd.time } };
}
function putSide(which: End, v: { wall?: Wall; ms?: number; live?: boolean }): boolean {
  if (v.live) { setLive(which, true); return true; }
  if (v.ms != null) return setInstant(which, v.ms);
  return setWall(which, v.wall!);
}
const sideText = (which: End, v: { wall?: Wall; ms?: number; live?: boolean }) =>
  v.live ? '現在（跟著時間走）' : whenText(v.wall || partsInTz(v.ms!, tzOf(which)));

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
function wallSuggestions(w: Wall, how: string, out: Suggestion[], idPre = 'set') {
  for (const which of endsOrder()) {
    out.push({
      id: `${idPre}-${which}`, kind: which, title: `設為${SUBJ[which]}`, detail: `${whenText(w)} · ${how}`,
      apply: () => commit(() => setWall(which, w), { label: `設定${SUBJ[which]}`, say: `${SUBJ[which]}：${fmtDT(w)}` }),
    });
  }
}
/** A rule read from words (下個月底, 明晚, 中秋 …): set either end by it, let an end keep following it, or keep it as a shortcut. */
function ruleSuggestions(rule: Rule, name: string, out: Suggestion[]) {
  // an end cannot be counted from itself: 開始那個月的月底 is for the end
  const ends = endsOrder().filter((w) => !ruleReads(rule, w, wordRule).has(w));
  if (!ends.length) return;
  for (const which of ends) {
    const r = runRule(rule, which);
    if (!r.ok) continue;
    const w = partsInTz(r.ms, tzOf(which));
    out.push({
      id: `rule-${which}`, kind: which, title: `設為${SUBJ[which]}`, detail: `${whenText(w)} · ${name}`,
      apply: () => commit(() => applyRule(which, rule, { name, follow: false }), { label: `${SUBJ[which]}：${name}`, say: `${SUBJ[which]}：${fmtDT(w)}（${name}）` }),
    });
  }
  const which = ends[0];
  const keeps = ruleUsesNow(rule) || ruleReads(rule, which, wordRule).size > 0;
  if (keeps && runRule(rule, which).ok) {
    out.push({
      id: 'rule-follow', kind: which, title: `${SUBJ[which]}跟著「${name}」`, detail: `隨時重新計算${ruleUsesNow(rule) ? '：時間過去了，' + SUBJ[which] + '也跟著往後' : ''}`,
      apply: () => commit(() => applyRule(which, rule, { name, follow: true }), { label: `${SUBJ[which]}跟著${name}`, say: `${SUBJ[which]}跟著「${name}」` }),
    });
  }
  const row: ChipRow = which;
  const code = encodeRule(rule);
  if (!S.chips[row].some((c) => c.code === code)) {
    out.push({
      id: 'rule-chip', kind: 'chip', title: `把「${name}」加到${SUBJ[which]}的快捷`, detail: '之後點一下就能套用',
      apply: () => commit(() => { S.chips[row].push({ code, ...(name ? { name } : {}) }); }, { label: `新增快捷：${name}`, say: `已加到${SUBJ[which]}的快捷：${name}` }),
    });
  }
}
/** Suggestions for one reading of a date text (and its other reading, when day and month could swap). */
function parsedSuggestions(p: ParsedText, out: Suggestion[], text = '') {
  if (p.kind === 'wall' && p.rule && p.relative) {
    ruleSuggestions(p.rule, text.trim() || p.how, out);
    if (p.alt) wallSuggestions(p.alt.wall, `另一種讀法：${p.alt.how}`, out, 'alt');
    return;
  }
  if (p.kind === 'instant') {
    const how = { s: '秒級時間戳', ms: '毫秒級時間戳', us: '微秒級時間戳', ns: '奈秒級時間戳', text: '含時區的時間' }[p.unit];
    instantSuggestions(p.ms, how, out);
  } else if (p.kind === 'wall') {
    if (p.offset != null) instantSuggestions(wallKey(p.wall) - p.offset, '含時區的時間', out);
    else wallSuggestions(p.wall, p.how, out);
    if (p.alt) {
      const a = p.alt.wall;
      for (const which of endsOrder()) {
        out.push({
          id: `alt-${which}`, kind: which, title: `設為${SUBJ[which]}（讀成${p.alt.how}）`, detail: `${whenText(a)} · 另一種讀法`,
          apply: () => commit(() => setWall(which, a), { label: `設定${SUBJ[which]}`, say: `${SUBJ[which]}：${fmtDT(a)}` }),
        });
      }
    }
  } else {
    for (const which of endsOrder()) {
      const base = wallOf(which) || startWall.value;
      const w = { ...base, h: p.h, mi: p.mi, s: p.s };
      out.push({ id: `time-${which}`, kind: which, title: `${SUBJ[which]}改成 ${fmtTime(w)}`, detail: `日期不變：${whenText(w)}`, apply: () => commit(() => setWall(which, w), { label: `設定${SUBJ[which]}`, say: `${SUBJ[which]}：${fmtDT(w)}` }) });
    }
  }
}

export function interpret(input: string): Suggestion[] {
  const text = normalizeWide(input).trim();
  const out: Suggestion[] = [];
  if (!text) return out;

  // words
  if (NOW_RE.test(text)) {
    // "until now" is the usual wish: the start is now by default already
    for (const which of ['end', 'start'] as End[]) {
      if (isLive(which)) { out.push({ id: `live-${which}`, kind: 'info', title: `${SUBJ[which]}已經是現在` }); continue; }
      out.push({ id: `live-${which}`, kind: which, title: `${SUBJ[which]}設為現在`, detail: `${SUBJ[which]}跟著時間走${isLive(other(which)) ? `（${SUBJ[other(which)]}也是現在，間隔會是 0）` : ''}`,
        apply: () => commit(() => setLive(which, true), { label: `${SUBJ[which]}設為現在`, say: `${SUBJ[which]}跟著現在走` }) });
    }
    return out;
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
  const opts = parseOptsFor(S.active);
  const smallNum = /^\d{1,6}(\.\d+)?$/.test(text);
  const p = signed || smallNum ? null : parseDateTimeText(text, opts);
  if (p) { parsedSuggestions(p, out, text); return out; }

  // two moments: "2000/1/1 到 2026/1/1", "9:00 ~ 17:30", "2000/1/1 到 現在"
  const rg = signed ? null : splitRange(text);
  if (rg) {
    const a = sideOf(rg[0], parseOptsFor('start')), b = sideOf(rg[1], parseOptsFor('end'));
    if (a && b) {
      const va = sideWall(a, 'start', b), vb = sideWall(b, 'end', a);
      if (va && vb) {
        out.push({
          id: 'range', kind: 'range', title: '設定開始與結束', detail: `${sideText('start', va)} → ${sideText('end', vb)}`,
          apply: () => commit(() => putSide('start', va) && putSide('end', vb), { label: '設定開始與結束', say: '已設定開始與結束' }),
        });
        return out;
      }
    }
  }

  // a moment and a length: "2026/1/1 + 30天", "2026-03-01 18:00 − 3小時"
  const dp = signed ? null : splitDatePlusSpan(text);
  if (dp) {
    const at = sideOf(dp.date, opts);
    let sp = null;
    try { sp = parseSpan(dp.span); } catch { sp = null; }
    if (at && sp && !('time' in at)) {
      const span = { ...sp, sign: (sp.sign * dp.sign) as 1 | -1 };
      const anchor = at.live ? Date.now() : 'ms' in at ? at.ms : null;
      for (const which of endsOrder()) {
        const ms0 = anchor ?? toInstant((at as { wall: Wall }).wall, tzOf(which));
        const r = addDuration(ms0, tzOf(which), span, span.sign, span.biz);
        const w = Number.isFinite(r.ms) ? partsInTz(r.ms, tzOf(which)) : null;
        if (!w || !validWall(w)) continue;
        out.push({ id: `dp-${which}`, kind: which, title: `設為${SUBJ[which]}`, detail: `${whenText(w)} · ${dp.date} ${fmtSpan(span)}`,
          apply: () => commit(() => setInstant(which, r.ms), { label: `設定${SUBJ[which]}`, say: `${SUBJ[which]}：${fmtDT(w)}` }) });
      }
      // or keep both: the written moment at one end, the other end tied to it by the length
      const fixedEnd: End = span.sign < 0 ? 'end' : 'start';
      const to = other(fixedEnd);
      const v = sideWall(at, fixedEnd, null)!;
      const linkSpan = { ...span, sign: 1 as const };
      out.push({
        id: 'dp-link', kind: 'span', title: `${SUBJ[fixedEnd]}設為 ${dp.date}，${LINK_TXT(to, fmtSpan(linkSpan))}`,
        detail: `${SUBJ[fixedEnd]}改了，${SUBJ[to]}跟著動`,
        apply: () => commit(() => putSide(fixedEnd, v) && setLink(linkSpan, to), { label: LINK_TXT(to, fmtSpan(linkSpan)), say: LINK_TXT(to, fmtSpan(linkSpan)) }),
      });
      if (out.length) return out;
    }
  }

  const r = interpretSpanText(text);
  // 3天前, 2 hours ago, in 3 days: first of all a moment counted from now
  const fromNow = r.kind === 'span' && !r.expr && (/(前|後|后|ago|later|before|after)$/i.test(text) || /^in\s/i.test(text));
  if (fromNow && r.kind === 'span') {
    for (const which of endsOrder()) {
      const a = addDuration(Date.now(), tzOf(which), r.span, r.span.sign, r.span.biz);
      const w = Number.isFinite(a.ms) ? partsInTz(a.ms, tzOf(which)) : null;
      if (!w || !validWall(w)) continue;
      out.push({ id: `now-${which}`, kind: which, title: `設為${SUBJ[which]}`, detail: `${whenText(w)} · 從現在算 ${fmtSpan(r.span)}`,
        apply: () => commit(() => setInstant(which, a.ms), { label: `設定${SUBJ[which]}`, say: `${SUBJ[which]}：${fmtDT(w)}` }) });
    }
  }
  if (r.kind === 'span') {
    const to = linkTarget();
    const c = checkSpan(r.span, to);
    const exprTxt = r.expr && r.result && !r.result.empty ? `= ${fmtClock(r.result.value)}（${durWords(r.result.value)}）` : '';
    if (c.ok) {
      const t = LINK_TXT(to, fmtSpan(r.span));
      out.push({
        id: 'span', kind: 'span', title: t, detail: `${exprTxt ? exprTxt + ' · ' : ''}${SUBJ[to]} ${whenText(c.w)}`,
        apply: () => commit(() => setLink(r.span, to), { label: `間隔 ${fmtSpan(r.span)}`, say: t }),
      });
    } else out.push({ id: 'span-err', kind: 'info', title: c.err });
    if (r.expr) out.push({ id: 'calc', kind: 'calc', title: '在時長計算機開啟', detail: `${exprTxt || text} · 只計算，不改變開始或結束`, apply: () => openDuration(text) });
    return out;
  }
  if (r.kind === 'ratio') {
    out.push({ id: 'ratio', kind: 'calc', title: `= ${nfMax(r.value, 4)} 倍`, detail: '在時長計算機開啟 · 倍數不會改變開始或結束', apply: () => openDuration(text) });
    return out;
  }

  // a place
  if (/[a-z一-鿿]/i.test(text) || /^(utc|gmt)?\s*[+\-−]\d/i.test(text)) {
    const hits = searchZones(text, Date.now(), 2);
    for (const h of hits) zoneSuggestions(h.z.id, out);
    if (out.length) return out;
  }
  // 46350 or 46350.75: an Excel / Google Sheets date serial
  if (/^\d{5}(\.\d+)?$/.test(text)) {
    const w = excelSerial(+text);
    if (w) wallSuggestions(w, 'Excel 日期序號', out, 'xl');
    if (out.length) return out;
  }
  if (r.kind === 'error') out.push({ id: 'err', kind: 'info', title: '看不懂這段文字', detail: '試試 2000/1/1 20:34、明天下午3點、1795380034、+30天、1/1 到 3/1、東京 15:00 或 47m × 16' });
  return out;
}

/** Text dropped (or handed) onto one end: read it for that end and put the end there. */
export function textToEnd(which: End, raw: string): boolean {
  const text = normalizeWide(raw).replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!text) return false;
  const n = SUBJ[which];
  if (NOW_RE.test(text)) return commit(() => setLive(which, true), { label: `${n}設為現在`, say: `${n}跟著現在走` });
  const p = parseDateTimeText(text, parseOptsFor(which));
  if (!p) { toast(`看不懂「${text.slice(0, 24)}」`); return false; }
  const say = () => `${n}：${fmtDT(wallOf(which)!)}`;
  if (p.kind === 'instant') return commit(() => setInstant(which, p.ms), { label: `設定${n}`, say });
  if (p.kind === 'time') { const base = wallOf(which) || startWall.value; return commit(() => setWall(which, { ...base, h: p.h, mi: p.mi, s: p.s }), { label: `設定${n}`, say }); }
  if (p.rule && p.relative) return commit(() => applyRule(which, p.rule!, { name: text, follow: false }), { label: `${n}：${text}`, say });
  if (p.offset != null) return commit(() => setInstant(which, wallKey(p.wall) - p.offset!), { label: `設定${n}`, say });
  return commit(() => setWall(which, p.wall), { label: `設定${n}`, say });
}

function zoneSuggestions(zid: string, out: Suggestion[]) {
  const name = zoneName(zid);
  if (!zoneRows.value.some((z) => sameZone(z, zid))) out.push({ id: `add-${zid}`, kind: 'zone', title: `加入時區：${name}`, detail: '出現在時區列表', apply: () => commit(() => addZoneRow(zid), { label: `加入${name}`, say: `已加入${name}` }) });
  if (!sameZone(S.startTz, zid)) out.push({ id: `stz-${zid}`, kind: 'start', title: `開始改用${name}時區`, detail: '同一刻，改用當地時間表示', apply: () => commit(() => setStartTz(zid), { label: `開始時區：${name}`, say: `開始改用${name}時區，同一個時刻` }) });
  if (!sameZone(S.endTz, zid) && wallOf('end')) out.push({ id: `etz-${zid}`, kind: 'end', title: `結束改用${name}時區`, detail: '同一刻，改用當地時間表示', apply: () => commit(() => setEndTz(zid), { label: `結束時區：${name}`, say: `結束改用${name}時區，同一個時刻` }) });
}
