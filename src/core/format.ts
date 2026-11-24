import { SEC, MIN, HOUR, DAY, pad, splitSeconds, type Span, type CalDiff } from './time';

const NF: Record<string, Intl.NumberFormat> = {};
export const nf = (n: number, d = 0) =>
  (NF['f' + d] ||= new Intl.NumberFormat('zh-TW', { minimumFractionDigits: d, maximumFractionDigits: d })).format(n);
export const nfMax = (n: number, d: number) =>
  (NF['m' + d] ||= new Intl.NumberFormat('zh-TW', { maximumFractionDigits: d })).format(n);
export const plainNum = (n: number, d: number) => String(+n.toFixed(d));

const RTF = new Intl.RelativeTimeFormat('zh-TW', { numeric: 'auto' });
export function relative(ms: number, now: number): string {
  const diff = ms - now,
    a = Math.abs(diff);
  if (a < 1500) return '就是現在';
  if (a < 60 * SEC) return RTF.format(Math.round(diff / SEC), 'second');
  if (a < 60 * MIN) return RTF.format(Math.round(diff / MIN), 'minute');
  if (a < 24 * HOUR) return RTF.format(Math.round(diff / HOUR), 'hour');
  if (a < 120 * DAY) return RTF.format(Math.round(diff / DAY), 'day');
  if (a < 730 * DAY) return RTF.format(Math.round(diff / (30.436875 * DAY)), 'month');
  return RTF.format(Math.round(diff / (365.2425 * DAY)), 'year');
}

export function fmtRemain(ms: number): string {
  const sp = splitSeconds(Math.max(0, Math.floor(ms / SEC)));
  if (sp.d === 0) return `${sp.h}:${pad(sp.mi)}:${pad(sp.s)}`;
  if (sp.d < 7) return `${sp.d} 天 ${sp.h} 時`;
  return `${nf(sp.d)} 天`;
}

export function durWords(sec: number): string {
  const sp = splitSeconds(sec);
  const s = Number.isInteger(sp.s) ? sp.s : +sp.s.toFixed(2);
  const parts: string[] = [];
  if (sp.d) parts.push(`${nf(sp.d)} 天`);
  if (sp.d || sp.h) parts.push(`${sp.h} 小時`);
  parts.push(`${sp.mi} 分`, `${s} 秒`);
  return (sp.sign < 0 ? '負 ' : '') + parts.join(' ');
}

export type HeroTok =
  | { t: 'num'; k: 'y' | 'mo' | 'w' | 'd' | 'h' | 'mi' | 's'; v: string }
  | { t: 'unit'; v: string }
  | { t: 'colon' }
  | { t: 'sign'; v: string };

export function spanTokens(
  sp: Span | (CalDiff & { sign: number; w?: number; biz?: boolean }),
  { plus = false, clock = false } = {},
): HeroTok[] {
  const t: HeroTok[] = [];
  if (sp.sign < 0) t.push({ t: 'sign', v: '−' });
  else if (plus) t.push({ t: 'sign', v: '+' });
  const date: ['y' | 'mo' | 'w' | 'd', number, string][] = [];
  if (sp.y) date.push(['y', sp.y, '年']);
  if (sp.mo) date.push(['mo', sp.mo, '個月']);
  if (sp.w) date.push(['w', sp.w, '週']);
  if (sp.d || sp.biz) date.push(['d', sp.d, sp.biz ? '工作日' : '天']);
  for (const [k, n, u] of date) t.push({ t: 'num', k, v: nf(n) }, { t: 'unit', v: u });
  const parts = (sp.h ? 1 : 0) + (sp.mi ? 1 : 0) + (sp.s ? 1 : 0);
  if (clock || parts > 1) {
    t.push(
      { t: 'num', k: 'h', v: clock || date.length ? pad(sp.h) : String(sp.h) },
      { t: 'colon' },
      { t: 'num', k: 'mi', v: pad(sp.mi) },
    );
    if (clock || sp.s) t.push({ t: 'colon' }, { t: 'num', k: 's', v: pad(sp.s) });
  } else if (parts === 1) {
    const [k, u]: ['h' | 'mi' | 's', string] = sp.h ? ['h', '小時'] : sp.mi ? ['mi', '分'] : ['s', '秒'];
    t.push({ t: 'num', k, v: nf(sp[k]) }, { t: 'unit', v: u });
  } else if (!date.length) t.push({ t: 'num', k: 'd', v: '0' }, { t: 'unit', v: '天' });
  return t;
}

export function rocYear(y: number): string {
  return y > 1911 ? `民國 ${y - 1911} 年` : y === 1911 ? '民國前 1 年' : `民國前 ${1912 - y} 年`;
}
