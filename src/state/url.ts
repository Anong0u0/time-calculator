/* ============================================================
   The time state in the address bar, so a moment can be bookmarked or shared.

     ?s=2026-11-24T16:13&tz=Asia/Taipei&e=2027-01-01&etz=Europe/London&z=Asia/Tokyo,Europe/London

   s     start (date, date and time, or Unix seconds). Absent: the start is now and follows the clock.
   tz    the start's time zone. Written whenever any time is written, so a link means the same moment everywhere.
   e     a fixed end.  etz: the end's zone, only when it differs from the start's.
   d     the end follows the start by a span (1mo7d, -3h, 28bd for working days).
   p     the end is the end of a period (day, week, month, newyear, lny). With a live start and no e,
         it is worked out when the link is opened: a bookmark of "until New Year" always counts to the next one.
   z     the zone list, only when it differs from the default.
   calc  the duration calculator's expression, only when it is not the sample.

   When the link carries any of s, e, d, p, tz, the time comes from the link alone: no end in it means no end.
   z and calc replace yours only when they are there.
   ============================================================ */
import { watch } from 'vue';
import { type Wall, type Span, validWall, partsInTz, pad, interpretSpanText, fmtSpan, isValidTz } from '../core/time';
import { LOCAL_TZ, sameZone } from '../core/zones';
import { S, ZMAX, PERIOD_NAMES, type PeriodKey, type Link, commit, applyEndPreset, defaultZones } from './store';

const TIME_KEYS = ['s', 'e', 'd', 'p', 'tz', 'etz'] as const;

/* ---------- values ---------- */
/** 2026-11-24, 2026-11-24T16:13 or 2026-11-24T16:13:05: the shortest form that keeps the time. */
export function wallParam(w: Wall): string {
  const date = `${pad(w.y, 4)}-${pad(w.mo)}-${pad(w.d)}`;
  if (!w.h && !w.mi && !w.s) return date;
  return `${date}T${pad(w.h)}:${pad(w.mi)}${w.s ? ':' + pad(w.s) : ''}`;
}
/** A wall time, or an instant when the value is a Unix timestamp (seconds, or milliseconds from 12 digits). */
export function parseWallParam(v: string, tz: string): Wall | null {
  const t = v.trim();
  if (/^-?\d{5,}$/.test(t)) {
    const n = +t;
    const ms = t.replace('-', '').length >= 12 ? n : n * 1000;
    const w = Number.isFinite(ms) ? partsInTz(ms, tz) : null;
    return validWall(w) ? w : null;
  }
  const m = /^(\d{1,4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/.exec(t);
  if (!m) return null;
  const w = { y: +m[1], mo: +m[2], d: +m[3], h: +(m[4] || 0), mi: +(m[5] || 0), s: +(m[6] || 0) };
  return validWall(w) ? w : null;
}
/** 1y2mo3w4d5h6m7s, with - in front for a span backwards and bd for working days. */
export function spanParam(sp: Span): string {
  let out = sp.sign < 0 ? '-' : '';
  if (sp.y) out += sp.y + 'y';
  if (sp.mo) out += sp.mo + 'mo';
  if (sp.w) out += sp.w + 'w';
  if (sp.d || sp.biz) out += sp.d + (sp.biz ? 'bd' : 'd');
  if (sp.h) out += sp.h + 'h';
  if (sp.mi) out += sp.mi + 'm';
  if (sp.s) out += sp.s + 's';
  return out === '' || out === '-' ? out + '0d' : out;
}
function linkParam(v: string): Link | null {
  const r = interpretSpanText(v);
  return r.kind === 'span' ? { expr: fmtSpan(r.span), span: r.span } : null;
}

/* ---------- reading a link ---------- */
export interface UrlState {
  time: boolean;
  tz?: string; etz?: string;
  s?: Wall; e?: Wall; d?: Link; p?: PeriodKey;
  z?: string[]; calc?: string;
}
export function parseQuery(search: string): UrlState | null {
  const q = new URLSearchParams(search);
  const get = (k: string) => { const v = q.get(k); return v == null ? undefined : v.trim(); };
  const time = TIME_KEYS.some((k) => q.has(k));
  const out: UrlState = { time };
  if (time) {
    const tz = get('tz'), etz = get('etz');
    out.tz = tz && isValidTz(tz) ? tz : undefined;
    out.etz = etz && isValidTz(etz) ? etz : undefined;
    const sTz = out.tz || LOCAL_TZ, eTz = out.etz || sTz;
    const s = get('s'), e = get('e'), d = get('d'), p = get('p');
    if (s && s !== 'now') out.s = parseWallParam(s, sTz) || undefined;
    if (d) out.d = linkParam(d) || undefined;
    if (e) out.e = parseWallParam(e, eTz) || undefined;
    if (p && p in PERIOD_NAMES) out.p = p as PeriodKey;
  }
  const z = get('z');
  if (z != null) out.z = z.split(',').map((x) => x.trim()).filter((x) => x && isValidTz(x)).slice(0, ZMAX);
  const calc = get('calc');
  if (calc != null && calc.length <= 400) out.calc = calc;
  return out.time || out.z || out.calc != null ? out : null;
}

/** Bring a link's state in as one undoable step. When it replaces what was saved here, the toast offers the way back. */
export function applyUrl(search = location.search, hadSaved = true): UrlState | null {
  const u = parseQuery(search);
  if (!u) return null;
  commit(() => {
    if (u.time) {
      S.startTz = u.tz || LOCAL_TZ;
      S.endTz = u.etz || S.startTz;
      if (u.s) { S.start = u.s; S.live = false; } else S.live = true;
      S.end = null; S.link = null; S.endSample = false; S.endPreset = null;
      if (u.d) S.link = u.d;
      else if (u.e) { S.end = u.e; S.endPreset = u.p || null; }
      else if (u.p) applyEndPreset(u.p);
    }
    if (u.z) S.zones = u.z;
    if (u.calc != null) { S.dur = u.calc; S.durSample = false; }
  }, { label: '套用連結', say: hadSaved ? '已套用連結裡的時間' : undefined });
  return u;
}

/* ---------- writing the address ---------- */
/** The query for the state now; empty for a first visit's untouched sample. */
export function buildQuery(): string {
  const out: [string, string][] = [];
  const untouched = S.live && S.endSample && !S.link && S.startTz === LOCAL_TZ && sameZone(S.endTz, S.startTz);
  if (!untouched) {
    if (!S.live) out.push(['s', wallParam(S.start)]);
    out.push(['tz', S.startTz]);
    if (!sameZone(S.endTz, S.startTz)) out.push(['etz', S.endTz]);
    if (S.link) out.push(['d', spanParam(S.link.span)]);
    else if (S.end) {
      // a live start counting to a period end: keep the period, so the link stays right after it passes
      if (!(S.live && S.endPreset)) out.push(['e', wallParam(S.end)]);
      if (S.endPreset) out.push(['p', S.endPreset]);
    }
  }
  const dz = defaultZones();
  if (S.zones.length !== dz.length || S.zones.some((z, i) => z !== dz[i])) out.push(['z', S.zones.join(',')]);
  if (!S.durSample) out.push(['calc', S.dur]);
  return out.map(([k, v]) => `${k}=${enc(v)}`).join('&');
}
/** Readable: : / , stay as they are. */
const enc = (v: string) => encodeURIComponent(v).replace(/%3A/gi, ':').replace(/%2F/gi, '/').replace(/%2C/gi, ',');

export function shareUrl(): string {
  const q = buildQuery();
  return location.origin + location.pathname + (q ? '?' + q : '');
}

let timer: ReturnType<typeof setTimeout> | undefined;
/** Keep the address bar in step with the state (replacing the entry: undo is the way back, not the back button). */
export function startUrlSync() {
  watch(() => [S.startTz, S.endTz, S.live, S.live ? null : S.start, S.end, S.endSample, S.endPreset, S.link?.expr, S.zones, S.dur, S.durSample], () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const q = buildQuery();
      const next = location.pathname + (q ? '?' + q : '') + location.hash;
      if (next !== location.pathname + location.search + location.hash) {
        try { history.replaceState(history.state, '', next); } catch { /* some sandboxes refuse; the app still works */ }
      }
    }, 250);
  }, { deep: true, immediate: true });
}
