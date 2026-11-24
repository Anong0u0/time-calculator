/* ============================================================
   The time state in the address bar, so a moment can be bookmarked or shared.

     ?s=2026-11-24T16:13&tz=Asia/Taipei&e=2027-01-01&etz=Europe/London&z=Asia/Tokyo,Europe/London

   s     start (date, date and time, or Unix seconds). Absent (or now): the start is now and follows the clock.
   tz    the start's time zone. Dates without a zone use the opening device's local time.
   e     a fixed end, or now: the end follows the clock.  etz: the end's zone, defaults to the start's.
   d     the end follows the start by a span (1mo7d, -3h, 28bd for working days).
   ds    the start follows the end back by a span: ?e=now&ds=30d is always the last 30 days.
   er    the rule the end was set by (下個月底, 中秋 …, as a short code; ! in front: the end keeps following it).
         With a live start and no e, it is worked out when the link is opened: a bookmark of "until 中秋" always counts
         to the next one.  sr: the same for the start.  en, sn: their names, when not the rule's own.
   p     (older links) the end of a period: day, week, month, newyear, lny.
   z     the zone list.
   calc  the duration calculator's expression, only when it is not the sample.
   v     the panels shown (span.rail is a full-screen countdown).  cm=year: the calendar shows the year.

   When the link carries any of s, e, d, ds, p, tz, the time comes from the link alone: no end in it means no end.
   z, calc, v and cm replace yours only when they are there.
   The address keeps the incoming parameters and adds only the fields changed since the page opened.
   ============================================================ */
import { computed, watch, type ComputedRef } from 'vue';
import {
  type Wall,
  type HeldWall,
  type Span,
  validWall,
  heldWallAt,
  wallToInstant,
  pad,
  interpretSpanText,
  fmtSpan,
  isValidTz,
} from '../core/time';
import { LOCAL_TZ, sameZone } from '../core/zones';
import { decodeRule, ruleName } from '../core/rule';
import {
  S,
  ZMAX,
  type Link,
  type End,
  type Panel,
  type CalMode,
  commit,
  applyRule,
  isLinked,
  OLD_PRESETS,
  PANELS,
  showOnly,
  shownList,
  viewSnap,
  restoreView,
  toast,
  undo,
} from './store';

const TIME_KEYS = ['s', 'e', 'd', 'ds', 'p', 'tz', 'etz', 'er', 'sr'] as const;
interface UrlRule {
  code: string;
  name: string;
  follow: boolean;
}

/* ---------- values ---------- */
/** 2026-11-24, 2026-11-24T16:13 or 2026-11-24T16:13:05: the shortest form that keeps the time. */
export function wallParam(w: Wall): string {
  const date = `${pad(w.y, 4)}-${pad(w.mo)}-${pad(w.d)}`;
  if (!w.h && !w.mi && !w.s) return date;
  return `${date}T${pad(w.h)}:${pad(w.mi)}${w.s ? ':' + pad(w.s) : ''}`;
}
/** A wall time, or an instant when the value is a Unix timestamp (seconds, or milliseconds from 12 digits). */
export function parseWallParam(v: string, tz: string): HeldWall | null {
  const t = v.trim();
  if (/^-?\d{5,}$/.test(t)) {
    const n = +t;
    const ms = t.replace('-', '').length >= 12 ? n : n * 1000;
    const w = Number.isFinite(new Date(ms).getTime()) ? heldWallAt(ms, tz) : null;
    return validWall(w) ? w : null;
  }
  const m = /^(\d{1,4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/.exec(t);
  if (!m) return null;
  const w = { y: +m[1], mo: +m[2], d: +m[3], h: +(m[4] || 0), mi: +(m[5] || 0), s: +(m[6] || 0) };
  return validWall(w) ? w : null;
}
/** Unix milliseconds disambiguate the later occurrence. Ordinary links keep their readable date. */
const heldParam = (w: HeldWall, tz: string) => (w.later ? pad(wallToInstant(w, tz, true).ms, 12) : wallParam(w));
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
  tz?: string;
  etz?: string;
  s?: HeldWall;
  e?: HeldWall;
  eLive?: boolean;
  d?: Link;
  ds?: Link;
  er?: UrlRule;
  sr?: UrlRule;
  z?: string[];
  calc?: string;
  v?: Panel[];
  cm?: CalMode;
}
export function parseQuery(search: string): UrlState | null {
  const q = new URLSearchParams(search);
  const get = (k: string) => {
    const v = q.get(k);
    return v == null ? undefined : v.trim();
  };
  const time = TIME_KEYS.some((k) => q.has(k));
  const out: UrlState = { time };
  if (time) {
    const tz = get('tz'),
      etz = get('etz');
    out.tz = tz && isValidTz(tz) ? tz : undefined;
    out.etz = etz && isValidTz(etz) ? etz : undefined;
    const sTz = out.tz || LOCAL_TZ,
      eTz = out.etz || sTz;
    const s = get('s'),
      e = get('e'),
      d = get('d'),
      ds = get('ds'),
      p = get('p');
    if (s && s !== 'now') out.s = parseWallParam(s, sTz) || undefined;
    if (d) out.d = linkParam(d) || undefined;
    else if (ds) out.ds = linkParam(ds) || undefined;
    if (e === 'now') out.eLive = true;
    else if (e) out.e = parseWallParam(e, eTz) || undefined;
    const rule = (code: string | undefined, name: string | undefined): UrlRule | undefined => {
      if (!code) return undefined;
      const follow = code.startsWith('!');
      const c = follow ? code.slice(1) : code;
      const r = decodeRule(c);
      return r ? { code: c, name: (name || ruleName(r, S.prefs)).slice(0, 60), follow } : undefined;
    };
    out.er = rule(get('er'), get('en'));
    out.sr = rule(get('sr'), get('sn'));
    if (!out.er && p && OLD_PRESETS[p]) out.er = { ...OLD_PRESETS[p], follow: false };
  }
  const z = get('z');
  if (z != null)
    out.z = z
      .split(',')
      .map((x) => x.trim())
      .filter((x) => x && isValidTz(x))
      .slice(0, ZMAX);
  const calc = get('calc');
  if (calc != null && calc.length <= 400) out.calc = calc;
  const v = get('v');
  if (v) {
    const keys = PANELS.map((p) => p.k);
    const list = v.split(/[.,\s]+/).filter((k): k is Panel => keys.includes(k as Panel));
    if (list.length) out.v = list;
  }
  const cm = get('cm');
  if (cm === 'year' || cm === 'month') out.cm = cm;
  return out.time || out.z || out.calc != null || out.v || out.cm ? out : null;
}

/** Bring a link's state in as one undoable step. When it replaces what was saved here, the toast offers the way back. */
export function applyUrl(search = location.search, hadSaved = true): UrlState | null {
  const u = parseQuery(search);
  if (!u) return null;
  // the panels are a display setting, outside the undo history: the toast takes them back with the rest
  const view = viewSnap();
  if (u.v) showOnly(u.v);
  if (u.cm) S.calMode = u.cm;
  const viewChanged = JSON.stringify(view) !== JSON.stringify(viewSnap());
  commit(
    () => {
      if (u.time) {
        S.startTz = u.tz || LOCAL_TZ;
        S.endTz = u.etz || S.startTz;
        if (u.s) {
          S.start = u.s;
          S.live = false;
        } else S.live = true;
        S.end = null;
        S.endLive = false;
        S.link = null;
        S.linkTo = 'end';
        S.endSample = false;
        S.rules = { start: null, end: null };
        const put = (which: End, r: UrlRule | undefined, held: boolean) => {
          if (!r) return;
          // held: the moment came with the link, the rule is its name; otherwise the rule is read now
          if (held && !r.follow) S.rules[which] = { code: r.code, name: r.name, follow: false, from: null };
          else applyRule(which, decodeRule(r.code)!, { name: r.name, follow: r.follow });
        };
        if (u.d) S.link = u.d;
        else {
          if (u.eLive) S.endLive = true;
          else if (u.e) S.end = u.e;
          if (u.ds && (S.endLive || S.end)) {
            S.link = u.ds;
            S.linkTo = 'start';
            S.live = false;
          }
        }
        if (!u.d) put('end', u.er, !!u.e);
        put('start', u.sr, !!u.s);
      }
      if (u.z) S.zones = u.z;
      if (u.calc != null) {
        S.dur = u.calc;
        S.durSample = false;
      }
    },
    { label: '套用連結', say: hadSaved && !viewChanged ? '已套用連結裡的時間' : undefined },
  );
  if (hadSaved && viewChanged)
    toast(u.time ? '已套用連結裡的時間與版面' : '已套用連結裡的版面', () => {
      if (u.time) undo();
      restoreView(view);
    });
  return u;
}

/* ---------- writing the address ---------- */
function queryFields(): URLSearchParams {
  const out = new URLSearchParams();
  const rule = (which: End, key: string, nameKey: string) => {
    const r = S.rules[which];
    if (!r) return;
    out.set(key, (r.follow ? '!' : '') + r.code);
    const d = decodeRule(r.code);
    if (d && r.name && r.name !== ruleName(d, S.prefs)) out.set(nameKey, r.name);
  };

  if (!S.live && !isLinked('start') && !S.rules.start?.follow) out.set('s', heldParam(S.start, S.startTz));
  rule('start', 'sr', 'sn');
  out.set('tz', S.startTz);
  out.set('etz', S.endTz);
  if (S.link) out.set(isLinked('end') ? 'd' : 'ds', spanParam(S.link.span));
  if (!isLinked('end') && !S.endSample) {
    if (S.endLive) out.set('e', 'now');
    else if (S.end && !S.rules.end?.follow) out.set('e', heldParam(S.end, S.endTz));
    rule('end', 'er', 'en');
  }
  out.set('z', S.zones.join(','));
  if (!S.durSample) out.set('calc', S.dur);
  out.set('v', shownList().join('.'));
  out.set('cm', S.calMode);
  return out;
}

/** Take the baseline after local storage, the incoming link and the sample have been applied. */
export function sessionSearch(search: string) {
  const initial = queryFields();
  return computed(() => {
    const current = queryFields();
    const keys = new Set([...initial.keys(), ...current.keys()]);
    const edits = new Set([...keys].filter((k) => current.get(k) !== initial.get(k)));
    if (!edits.size) return search;
    const params = new URLSearchParams(search);
    // A name belongs to its rule, including an end rule supplied by an older p= link.
    for (const [code, name] of [
      ['er', 'en'],
      ['sr', 'sn'],
    ]) {
      if (edits.has(code) || edits.has(name)) {
        edits.add(code);
        edits.add(name);
        if (code === 'er') params.delete('p');
      }
    }
    for (const key of edits) {
      let value = current.get(key);
      if (key === 'etz' && params.has('tz') && sameZone(S.endTz, S.startTz)) value = null;
      // A live countdown bookmark re-evaluates its rule when opened.
      if (key === 'e' && S.live && S.rules.end && !S.endLive) value = null;
      if (value === null) params.delete(key);
      else params.set(key, value);
    }
    const query = Array.from(params, ([k, v]) => `${enc(k)}=${enc(v)}`).join('&');
    return query ? '?' + query : '';
  });
}
/** Readable: : / , stay as they are. */
const enc = (v: string) => encodeURIComponent(v).replace(/%3A/gi, ':').replace(/%2F/gi, '/').replace(/%2C/gi, ',');

export function startUrlSync(search: ComputedRef<string>) {
  return watch(search, (next, _previous, onCleanup) => {
    const timer = setTimeout(() => {
      if (next !== location.search) {
        try {
          history.replaceState(history.state, '', location.pathname + next + location.hash);
        } catch {
          /* some sandboxes refuse; the app still works */
        }
      }
    }, 250);
    onCleanup(() => clearTimeout(timer));
  });
}
