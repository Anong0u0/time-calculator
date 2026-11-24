import { isValidTz, offsetAt, MIN, fmtOffset } from './time';

export interface ZoneInfo {
  id: string;
  zh: string;
  en: string;
  kw: string;
  curated: boolean;
}

const CITIES: [string, string, string, string][] = [
  ['Pacific/Pago_Pago', '帕果帕果', 'Pago Pago', 'samoa sst 美屬薩摩亞'],
  ['Pacific/Honolulu', '檀香山', 'Honolulu', 'hawaii hst 夏威夷'],
  ['America/Anchorage', '安克拉治', 'Anchorage', 'alaska akst akdt 阿拉斯加'],
  [
    'America/Los_Angeles',
    '洛杉磯',
    'Los Angeles',
    'pst pdt pacific 太平洋 舊金山 san francisco 西雅圖 seattle 矽谷 la',
  ],
  ['America/Vancouver', '溫哥華', 'Vancouver', 'canada 加拿大'],
  ['America/Phoenix', '鳳凰城', 'Phoenix', 'arizona mst 亞利桑那'],
  ['America/Denver', '丹佛', 'Denver', 'mst mdt mountain 山區'],
  ['America/Chicago', '芝加哥', 'Chicago', 'cst cdt central 中部 達拉斯 dallas 休士頓 houston'],
  ['America/Mexico_City', '墨西哥城', 'Mexico City', 'mexico 墨西哥'],
  ['America/Bogota', '波哥大', 'Bogotá', 'colombia 哥倫比亞'],
  ['America/Lima', '利馬', 'Lima', 'peru 秘魯'],
  [
    'America/New_York',
    '紐約',
    'New York',
    'est edt eastern 美東 東部 華盛頓 washington 波士頓 boston 邁阿密 miami nyc',
  ],
  ['America/Toronto', '多倫多', 'Toronto', 'canada 加拿大 蒙特婁 montreal'],
  ['America/Halifax', '哈利法克斯', 'Halifax', 'ast adt atlantic 大西洋'],
  ['America/Santiago', '聖地牙哥', 'Santiago', 'chile 智利'],
  ['America/Argentina/Buenos_Aires', '布宜諾斯艾利斯', 'Buenos Aires', 'argentina 阿根廷'],
  ['America/Sao_Paulo', '聖保羅', 'São Paulo', 'brazil 巴西 brt 里約 rio'],
  ['America/St_Johns', '聖約翰斯', "St. John's", 'newfoundland nst 紐芬蘭'],
  ['Atlantic/Reykjavik', '雷克雅維克', 'Reykjavík', 'iceland 冰島'],
  ['UTC', '協調世界時', 'UTC', 'utc gmt z zulu 世界標準時間 格林威治'],
  ['Europe/London', '倫敦', 'London', 'uk gmt bst 英國 united kingdom'],
  ['Europe/Dublin', '都柏林', 'Dublin', 'ireland 愛爾蘭'],
  ['Europe/Lisbon', '里斯本', 'Lisbon', 'portugal 葡萄牙'],
  ['Africa/Casablanca', '卡薩布蘭卡', 'Casablanca', 'morocco 摩洛哥'],
  ['Africa/Lagos', '拉哥斯', 'Lagos', 'nigeria 奈及利亞 wat'],
  ['Europe/Paris', '巴黎', 'Paris', 'france 法國 cet cest'],
  ['Europe/Madrid', '馬德里', 'Madrid', 'spain 西班牙 巴塞隆納 barcelona'],
  ['Europe/Amsterdam', '阿姆斯特丹', 'Amsterdam', 'netherlands 荷蘭'],
  ['Europe/Berlin', '柏林', 'Berlin', 'germany 德國 cet cest 慕尼黑 munich 法蘭克福 frankfurt'],
  ['Europe/Zurich', '蘇黎世', 'Zürich', 'switzerland 瑞士 日內瓦 geneva'],
  ['Europe/Rome', '羅馬', 'Rome', 'italy 義大利 米蘭 milan'],
  ['Europe/Vienna', '維也納', 'Vienna', 'austria 奧地利'],
  ['Europe/Prague', '布拉格', 'Prague', 'czech 捷克'],
  ['Europe/Stockholm', '斯德哥爾摩', 'Stockholm', 'sweden 瑞典'],
  ['Europe/Warsaw', '華沙', 'Warsaw', 'poland 波蘭'],
  ['Africa/Johannesburg', '約翰尼斯堡', 'Johannesburg', 'south africa 南非 sast 開普敦 cape town'],
  ['Africa/Cairo', '開羅', 'Cairo', 'egypt 埃及 eet'],
  ['Europe/Athens', '雅典', 'Athens', 'greece 希臘 eet eest'],
  ['Europe/Helsinki', '赫爾辛基', 'Helsinki', 'finland 芬蘭'],
  ['Europe/Kyiv', '基輔', 'Kyiv', 'ukraine 烏克蘭 kiev'],
  ['Asia/Jerusalem', '耶路撒冷', 'Jerusalem', 'israel 以色列 特拉維夫 tel aviv'],
  ['Europe/Istanbul', '伊斯坦堡', 'Istanbul', 'turkey 土耳其'],
  ['Europe/Moscow', '莫斯科', 'Moscow', 'russia 俄羅斯 msk'],
  ['Africa/Nairobi', '奈洛比', 'Nairobi', 'kenya 肯亞 eat'],
  ['Asia/Riyadh', '利雅德', 'Riyadh', 'saudi 沙烏地阿拉伯'],
  ['Asia/Tehran', '德黑蘭', 'Tehran', 'iran 伊朗'],
  ['Asia/Dubai', '杜拜', 'Dubai', 'uae 阿聯 阿布達比 abu dhabi gst'],
  ['Asia/Karachi', '喀拉蚩', 'Karachi', 'pakistan 巴基斯坦'],
  ['Asia/Kolkata', '新德里', 'New Delhi', 'india 印度 ist 孟買 mumbai 班加羅爾 bangalore calcutta'],
  ['Asia/Kathmandu', '加德滿都', 'Kathmandu', 'nepal 尼泊爾'],
  ['Asia/Dhaka', '達卡', 'Dhaka', 'bangladesh 孟加拉'],
  ['Asia/Yangon', '仰光', 'Yangon', 'myanmar 緬甸 rangoon'],
  ['Asia/Bangkok', '曼谷', 'Bangkok', 'thailand 泰國 ict'],
  ['Asia/Ho_Chi_Minh', '胡志明市', 'Ho Chi Minh City', 'vietnam 越南 河內 hanoi saigon'],
  ['Asia/Jakarta', '雅加達', 'Jakarta', 'indonesia 印尼 wib'],
  ['Asia/Kuala_Lumpur', '吉隆坡', 'Kuala Lumpur', 'malaysia 馬來西亞'],
  ['Asia/Singapore', '新加坡', 'Singapore', 'sgt'],
  ['Asia/Manila', '馬尼拉', 'Manila', 'philippines 菲律賓 pht'],
  ['Asia/Hong_Kong', '香港', 'Hong Kong', 'hkt hk'],
  ['Asia/Macau', '澳門', 'Macau', 'macao'],
  ['Asia/Shanghai', '上海', 'Shanghai', 'china 中國 北京 beijing 深圳 shenzhen 廣州 guangzhou'],
  ['Asia/Taipei', '台北', 'Taipei', 'taiwan 台灣 臺北 臺灣 高雄 台中 台南 tpe'],
  ['Australia/Perth', '伯斯', 'Perth', 'australia 澳洲 awst'],
  ['Asia/Ulaanbaatar', '烏蘭巴托', 'Ulaanbaatar', 'mongolia 蒙古'],
  ['Asia/Seoul', '首爾', 'Seoul', 'korea 韓國 kst 釜山 busan'],
  ['Asia/Tokyo', '東京', 'Tokyo', 'japan 日本 jst 大阪 osaka 京都 kyoto'],
  ['Australia/Adelaide', '阿得雷德', 'Adelaide', 'australia 澳洲 acst acdt'],
  ['Australia/Brisbane', '布里斯本', 'Brisbane', 'australia 澳洲 aest'],
  ['Australia/Sydney', '雪梨', 'Sydney', 'australia 澳洲 aest aedt 坎培拉 canberra'],
  ['Australia/Melbourne', '墨爾本', 'Melbourne', 'australia 澳洲'],
  ['Pacific/Guam', '關島', 'Guam', 'chst'],
  ['Asia/Vladivostok', '海參崴', 'Vladivostok', 'russia 俄羅斯'],
  ['Pacific/Auckland', '奧克蘭', 'Auckland', 'new zealand 紐西蘭 nzst nzdt 威靈頓 wellington'],
  ['Pacific/Fiji', '蘇瓦', 'Suva', 'fiji 斐濟'],
  ['Pacific/Kiritimati', '聖誕島', 'Kiritimati', 'kiribati 吉里巴斯 line islands'],
];

const LINKS: Record<string, string> = {
  'Asia/Calcutta': 'Asia/Kolkata',
  'Asia/Saigon': 'Asia/Ho_Chi_Minh',
  'Europe/Kiev': 'Europe/Kyiv',
  'Asia/Katmandu': 'Asia/Kathmandu',
  'Asia/Rangoon': 'Asia/Yangon',
  'America/Buenos_Aires': 'America/Argentina/Buenos_Aires',
  'Etc/UTC': 'UTC',
  'Etc/GMT': 'UTC',
  GMT: 'UTC',
  'Etc/Universal': 'UTC',
  'Etc/Zulu': 'UTC',
  Universal: 'UTC',
  Zulu: 'UTC',
  'Etc/UCT': 'UTC',
  UCT: 'UTC',
  'Asia/Macao': 'Asia/Macau',
  'Asia/Ulan_Bator': 'Asia/Ulaanbaatar',
  'US/Eastern': 'America/New_York',
  'US/Pacific': 'America/Los_Angeles',
  'US/Central': 'America/Chicago',
  'US/Mountain': 'America/Denver',
  'US/Hawaii': 'Pacific/Honolulu',
  ROC: 'Asia/Taipei',
  Japan: 'Asia/Tokyo',
  PRC: 'Asia/Shanghai',
  Hongkong: 'Asia/Hong_Kong',
  Singapore: 'Asia/Singapore',
  GB: 'Europe/London',
  'Asia/Chongqing': 'Asia/Shanghai',
  'Asia/Harbin': 'Asia/Shanghai',
  'Australia/ACT': 'Australia/Sydney',
  'Australia/NSW': 'Australia/Sydney',
  'Pacific/Samoa': 'Pacific/Pago_Pago',
  'America/Montreal': 'America/Toronto',
  'Asia/Istanbul': 'Europe/Istanbul',
  'Asia/Tel_Aviv': 'Asia/Jerusalem',
  Iceland: 'Atlantic/Reykjavik',
};

export const zkey = (id: string) => LINKS[id] || id;
export const sameZone = (a: string | null | undefined, b: string | null | undefined) =>
  !!a && !!b && zkey(a) === zkey(b);

const ZONES = new Map<string, ZoneInfo>();
export const DIR: ZoneInfo[] = [];
function addZone(info: ZoneInfo) {
  ZONES.set(zkey(info.id), info);
  DIR.push(info);
  return info;
}

for (const [id, zh, en, kw] of CITIES) {
  let use = id;
  if (!isValidTz(use)) {
    const legacy = Object.keys(LINKS).find((k) => LINKS[k] === id && isValidTz(k));
    if (!legacy) continue;
    use = legacy;
  }
  addZone({ id: use, zh, en, kw: `${zh} ${en} ${id} ${kw}`.toLowerCase(), curated: true });
}
try {
  const all =
    (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? [];
  for (const id of all) {
    if (ZONES.has(zkey(id))) continue;
    const city = id.split('/').pop()!.replace(/_/g, ' ');
    addZone({ id, zh: city, en: city, kw: `${id} ${city}`.toLowerCase(), curated: false });
  }
} catch {
  /* curated list only */
}

export function zoneInfo(id: string): ZoneInfo {
  let z = ZONES.get(zkey(id));
  if (!z) {
    const city = String(id).split('/').pop()!.replace(/_/g, ' ');
    z = addZone({ id, zh: city, en: city, kw: String(id).toLowerCase(), curated: false });
  }
  return z;
}
export const zoneName = (id: string) => (sameZone(id, 'UTC') ? 'UTC' : zoneInfo(id).zh);

export function detectLocalTz(): string {
  let tz = 'UTC';
  try {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    /* default */
  }
  if (LINKS[tz] && isValidTz(LINKS[tz])) tz = LINKS[tz];
  return isValidTz(tz) ? tz : 'UTC';
}
export const LOCAL_TZ = detectLocalTz();

const longFmt = new Map<string, Intl.DateTimeFormat | null>();
export function tzLongName(tz: string, ms: number): string {
  let f = longFmt.get(tz);
  if (f === undefined) {
    try {
      f = new Intl.DateTimeFormat('zh-TW', { timeZone: tz, timeZoneName: 'long' });
    } catch {
      f = null;
    }
    longFmt.set(tz, f);
  }
  if (!f) return '';
  const p = f.formatToParts(new Date(ms)).find((x) => x.type === 'timeZoneName');
  return p ? p.value : '';
}

export interface ZoneHit {
  z: ZoneInfo;
  off: number;
  score: number;
}
export function searchZones(raw: string, now = Date.now(), limit = Infinity): ZoneHit[] {
  const q = raw.trim().toLowerCase();
  const om = /^(?:utc|gmt)?\s*([+\-−])\s*(\d{1,2})(?::?(\d{2}))?$/.exec(q);
  const offQ = om ? (om[1] === '+' ? 1 : -1) * (+om[2] * 60 + +(om[3] || 0)) : null;
  const flat = q.replace(/[\s_/]/g, '');
  const res: ZoneHit[] = [];
  for (const z of DIR) {
    let score = 0;
    if (!q) {
      if (!z.curated && !sameZone(z.id, LOCAL_TZ)) continue;
      score = 1;
    }
    const off = Math.round(offsetAt(now, z.id) / MIN);
    if (q && offQ != null) {
      if (off !== offQ) continue;
      score = z.curated ? 3 : 1;
    } else if (q) {
      const name = z.zh.toLowerCase(),
        en = z.en.toLowerCase();
      if (name === q || en === q) score = 10;
      else if (name.startsWith(q) || en.startsWith(q)) score = 6;
      else if (z.kw.includes(q)) score = 4;
      else if (flat && z.kw.replace(/[\s_/]/g, '').includes(flat)) score = 2;
      else continue;
      if (z.curated) score += 1;
    }
    res.push({ z, off, score });
  }
  res.sort((a, b) => b.score - a.score || a.off - b.off || a.z.zh.localeCompare(b.z.zh, 'zh-Hant'));
  return res.slice(0, limit);
}
export function zoneInText(text: string): { zone: ZoneInfo; rest: string } | null {
  const t = text.trim();
  let best: { zone: ZoneInfo; rest: string; len: number } | null = null;
  for (const z of DIR) {
    if (!z.curated) continue;
    const names = [
      z.zh,
      z.en,
      ...z.kw.split(' ').filter((k) => !k.includes('/') && (/[\u4e00-\u9fff]/.test(k) ? k.length >= 2 : k.length >= 3)),
    ];
    for (const n of names) {
      if (!n) continue;
      const low = t.toLowerCase(),
        nl = n.toLowerCase();
      if (low.startsWith(nl) && (!best || nl.length > best.len)) {
        const rest = t.slice(n.length).replace(/^\s*(的|時間|time)?\s*/i, '');
        best = { zone: z, rest, len: nl.length };
      } else if (low.endsWith(nl) && (!best || nl.length > best.len)) {
        const rest = t.slice(0, t.length - n.length).replace(/\s*(in|at|@|在)\s*$/i, '');
        best = { zone: z, rest: rest.trim(), len: nl.length };
      }
    }
  }
  return best && best.rest !== t ? { zone: best.zone, rest: best.rest } : null;
}
export const offShort = (m: number) => (m === 0 ? '±0' : fmtOffset(m * MIN, { compact: true }).replace('UTC', ''));
