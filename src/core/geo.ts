import { DAY, mod, clamp } from './time';

/** 240×94 land mask (1.5° grid from 84°N); bit k = row × cols + col. */
export const LAND = { step: 1.5, top: 84, cols: 240, rows: 94 };
const LAND_B64 =
  'AAAAAAAAAADUOwD8/wEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPT///////8AAAAAAAAAAJAAAAAAAAAAAAAAAAAAIP///////z8AgPkDgPMHAOADAAAAAAAAAAAAAABAvP8//////wcAgP8AAAAAAIA/AAAAAAAAAAAAAIC3kPsP/////w8AAM4AAAAwAAB4AwAAAAAAAAAAAMD///8H3P///w8AAAAAAMAfAPj/DwD4DQAAAAAAAOA3Yv8HAPz//wcAAAAAAPAAAP//DwBwCAAAAAAAAPD/+/c/APj//wMAAAAAADjA/f///z/ABwAAA+ADAOD+5/P/A/j//wMAAIANADzw/////////wOAAPj/z//938f/D/D//wEAAPj/AIH3///////////9B/7////////zH/D/fwAAAPz/Z///////////////P/z///////+Df/D/AyAAAP7/////////////////P//////////xP+B/AH8AgP//////////////////QPD//////9+TH+AfAD4A4P////////////////9/AP7//////wf1DsAPAAAA+M//////////////////AP7//////wPwA4APAAAA+M////////////////wHAPAL/P///wPwMwAAAAAA+J//////////////fzwAAMAH4P///w/wfwAAAAB48Nf///////////8/AB8AAHAAwP///3/w/wAAAABw4Mf///////////8PAB8AAAQAgP/////5/wMAAAD+wP3///////////8PgA8AAAEAgP7////7/wcAAADu+f//////////////AAcAAAAAAPz//////wcAAADu/f//////////////AAMAAAAAAPj//////wcAAADg////////////////AAAAAAAAAPD/////fx8AAADg////////////////AAAAAAAAAOD/////Hx4AAADA///////////////fAAAAAAAAAOD//////wAAAACA//////3///////9PAAAAAAAAAOD/////NwAAAACA//1H/vz////////HAQAAAAAAAOD/////AQAAAAD8g/sH+Pz////////jAQAAAAAAAOD/////AQAAAAD8Y+////n//////38gAAAAAAAAAOD///9/AAAAAAD8YOz+//n//////z5gAAAAAAAAAMD///8/AAAAAAD+AMf///H//////zlwAAAAAAAAAMD///8/AAAAAAB8f8L8/////////3M4AAAAAAAAAID///8/AAAAAADw/wBh/////////zA/AAAAAAAAAAD+//8PAAAAAAD8/wCA/////////8EHAAAAAAAAAAD8//8HAAAAAAD+/+OB/////////8EAAAAAAAAAAAD8//8DAAAAAAD+/////////////wEAAAAAAAAAAAD4/x8DAAAAAAD+//////7//////wEAAAAAAAAAAADY/wAGAAAAAID///////3//////wEAAAAAAAAAAACwfwAGAAAAAMD///9//9P//////wAAAAAAAAAAAABgfwAAAAAAAMD//////jfy/////wMAAAAAAAAAAABAfgAHAAAAAOD//////v/g////PwEAAAAAAEAAAAAAfrAfAAAAAPD//////f/A////HwAAAAAAAIABAAAA/jiwAQAAAOD//////X8A/8N/AgAAAAAAAAAAAAAA/D+QDwAAAOD/////+38A/8F/AwEAAAAAAAAAAAAA8D8AAAAAAOD/////8x8A/4D/AAMAAAAAAAAAAAAAwP8AgAAAAOD/////9wcAPoD+AQEAAAAAAAAAAAAAAPwBAAAAAPD//////wEAPgD+AQcAAAAAAAAAAAAAAOABAAAAAOD/////PwAAPAD+AQ0AAQAAAAAAAAAAAMDBRwAAAOD/////3wMAPAD2gQoAAAAAAAAAAAAAAIDp/wAAAMD//////wMAOABGAAwAAAAAAAAAAAAAAAD//wEAAID//////wMAaAAGAB4AAAAAAAAAAAAAAADw/wMAAAD//////wEAYAAMYB4AAAAAAAAAAAAAAADw/x8AAAD++f///wEAAIAZcAAAAAAAAAAAAAAAAADw/z8AAAAAwP///wAAAAAbeAAAAAAAAIAAAAAAAAD4/38AAAAAwP//fwAAAAA+fCAAAAAAAAAAAAAAAAD8/38AAAAAwP//PwAAAAA8fy8AAAAAAAAAAAAAAAj8//8BAAAAwP//HwAAAAA+/oMDAAAAAAAAAAAAAAD8//8PAAAAwP//DwAAAAB4vgM/AAAAAAAAAAAAAAD8//9/AAAAgP//BwAAAABwuHP/IQAAAAAAAAAAAAD8////AQAAAP//AwAAAABggAP4OwAAAAAAAAAAAAD8////AQAAAP//AwAAAADADwDwhwAAAAAAAAAAAAD4////AQAAAP//BwAAAAAAfxnwBwAAAAAAAAAAAAD4////AQAAAP7/BwAAAAAAgA1AHAgAAAAAAAAAAADw////AAAAAP7/BwAAAAAAAIDBAAAAAAAAAAAAAADw//9/AAAAAP//BwEAAAAAAIDHAAAAQAAAAAAAAADg//8/AAAAAP//hwMAAAAAAPDHAQAAAAAAAAAAAADA//8/AAAAAP//xwMAAAAAAPjPAYABAAAAAAAAAAAA//8/AAAAgP//4wEAAAAAAP7/AwDAAAAAAAAAAAAA/v8/AAAAAP//4QEAAAAAAP7/AwBAAAAAAAAAAAAA/v8/AAAAAP//4AEAAAAAwP//BwAAAAAAAAAAAAAA/v8fAAAAAP7/4AAAAAAA8P//D0AAAAAAAAAAAAAA/v8PAAAAAP7/4AAAAAAA+P//HwAAAAAAAAAAAAAA/v8BAAAAAP7/4AAAAAAA+P//PwAAAAAAAAAAAAAA/v8AAAAAAPw/AAAAAAAA+P//PwAAAAAAAAAAAAAA//8AAAAAAPw/AAAAAAAA8P//fwAAAAAAAAAAAAAA/38AAAAAAPgfAAAAAAAA8P//fwAAAAAAAAAAAAAA/38AAAAAAPgfAAAAAAAA8P//PwAAAAAAAAAAAAAA/z8AAAAAAPAPAAAAAAAA4D//PwAAAAAAAAAAAAAA/x8AAAAAAPADAAAAAAAA4Af8HwAAAAAAAAAAAACA/w8AAAAAAAAAAAAAAAAAYAD4HwAIAAAAAAAAAACA/wMAAAAAAAAAAAAAAAAAAADgDwAQAAAAAAAAAACA/wMAAAAAAAAAAAAAAAAAAADADwBwAAAAAAAAAACAfwAAAAAAAAAAAAAAAAAAAAAAAAAwAAAAAAAAAADAPwAAAAAAAAAAAAAAAAAAAAAABwA8AAAAAAAAAADAPwAAAAAAAAAAAAAAAAAAAAAABgAOAAAAAAAAAADAHwAAAAAAAAAAAAAAAAAAAAAAAAAHAAAAAAAAAADADwAAAAAAAAAAAAAAAAAAAAAAAIADAAAAAAAAAADADwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADgDwAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAADgBwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADAgwEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACABwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADwCAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
let bitsCache: Uint8Array | null = null;
function landBits(): Uint8Array {
  if (!bitsCache) {
    const b = atob(LAND_B64);
    bitsCache = new Uint8Array(b.length);
    for (let i = 0; i < b.length; i++) bitsCache[i] = b.charCodeAt(i);
  }
  return bitsCache;
}
export function isLand(row: number, col: number): boolean {
  if (row < 0 || row >= LAND.rows || col < 0 || col >= LAND.cols) return false;
  const k = row * LAND.cols + col;
  return ((landBits()[k >> 3] >> (k & 7)) & 1) === 1;
}

export const COORDS: Record<string, [number, number]> = {
  'Pacific/Pago_Pago': [-14.28, -170.7],
  'Pacific/Honolulu': [21.31, -157.86],
  'America/Anchorage': [61.22, -149.9],
  'America/Los_Angeles': [34.05, -118.24],
  'America/Vancouver': [49.28, -123.12],
  'America/Phoenix': [33.45, -112.07],
  'America/Denver': [39.74, -104.99],
  'America/Chicago': [41.88, -87.63],
  'America/Mexico_City': [19.43, -99.13],
  'America/Bogota': [4.71, -74.07],
  'America/Lima': [-12.05, -77.04],
  'America/New_York': [40.71, -74.01],
  'America/Toronto': [43.65, -79.38],
  'America/Halifax': [44.65, -63.58],
  'America/Santiago': [-33.45, -70.67],
  'America/Argentina/Buenos_Aires': [-34.6, -58.38],
  'America/Sao_Paulo': [-23.55, -46.63],
  'America/St_Johns': [47.56, -52.71],
  'Atlantic/Reykjavik': [64.15, -21.94],
  'Europe/London': [51.51, -0.13],
  'Europe/Dublin': [53.35, -6.26],
  'Europe/Lisbon': [38.72, -9.14],
  'Africa/Casablanca': [33.57, -7.59],
  'Africa/Lagos': [6.52, 3.38],
  'Europe/Paris': [48.86, 2.35],
  'Europe/Madrid': [40.42, -3.7],
  'Europe/Amsterdam': [52.37, 4.9],
  'Europe/Berlin': [52.52, 13.4],
  'Europe/Zurich': [47.38, 8.54],
  'Europe/Rome': [41.9, 12.5],
  'Europe/Vienna': [48.21, 16.37],
  'Europe/Prague': [50.08, 14.44],
  'Europe/Stockholm': [59.33, 18.07],
  'Europe/Warsaw': [52.23, 21.01],
  'Africa/Johannesburg': [-26.2, 28.05],
  'Africa/Cairo': [30.04, 31.24],
  'Europe/Athens': [37.98, 23.73],
  'Europe/Helsinki': [60.17, 24.94],
  'Europe/Kyiv': [50.45, 30.52],
  'Asia/Jerusalem': [31.77, 35.21],
  'Europe/Istanbul': [41.01, 28.98],
  'Europe/Moscow': [55.76, 37.62],
  'Africa/Nairobi': [-1.29, 36.82],
  'Asia/Riyadh': [24.71, 46.68],
  'Asia/Tehran': [35.69, 51.39],
  'Asia/Dubai': [25.2, 55.27],
  'Asia/Karachi': [24.86, 67.01],
  'Asia/Kolkata': [28.61, 77.21],
  'Asia/Kathmandu': [27.72, 85.32],
  'Asia/Dhaka': [23.81, 90.41],
  'Asia/Yangon': [16.84, 96.17],
  'Asia/Bangkok': [13.76, 100.5],
  'Asia/Ho_Chi_Minh': [10.82, 106.63],
  'Asia/Jakarta': [-6.21, 106.85],
  'Asia/Kuala_Lumpur': [3.14, 101.69],
  'Asia/Singapore': [1.35, 103.82],
  'Asia/Manila': [14.6, 120.98],
  'Asia/Hong_Kong': [22.32, 114.17],
  'Asia/Macau': [22.2, 113.54],
  'Asia/Shanghai': [31.23, 121.47],
  'Asia/Taipei': [25.03, 121.56],
  'Australia/Perth': [-31.95, 115.86],
  'Asia/Ulaanbaatar': [47.89, 106.91],
  'Asia/Seoul': [37.57, 126.98],
  'Asia/Tokyo': [35.68, 139.69],
  'Australia/Adelaide': [-34.93, 138.6],
  'Australia/Brisbane': [-27.47, 153.03],
  'Australia/Sydney': [-33.87, 151.21],
  'Australia/Melbourne': [-37.81, 144.96],
  'Pacific/Guam': [13.44, 144.79],
  'Asia/Vladivostok': [43.12, 131.89],
  'Pacific/Auckland': [-36.85, 174.76],
  'Pacific/Fiji': [-18.14, 178.44],
  'Pacific/Kiritimati': [1.87, -157.4],
};

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
export function subsolar(ms: number): { lat: number; lon: number } {
  const d = (ms - 946728000000) / DAY; // days since J2000.0
  const g = rad(357.529 + 0.98560028 * d);
  const q = 280.459 + 0.98564736 * d;
  const L = rad(q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g));
  const e = rad(23.439 - 0.00000036 * d);
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = mod(280.46061837 + 360.98564736629 * d, 360);
  return { lat: deg(dec), lon: mod(deg(ra) - gmst + 180, 360) - 180 };
}
export function sunAltitude(sun: { lat: number; lon: number }, lat: number, lon: number): number {
  return deg(
    Math.asin(
      clamp(
        Math.sin(rad(lat)) * Math.sin(rad(sun.lat)) +
          Math.cos(rad(lat)) * Math.cos(rad(sun.lat)) * Math.cos(rad(lon - sun.lon)),
        -1,
        1,
      ),
    ),
  );
}
export function terminatorLat(sun: { lat: number; lon: number }, lon: number): number {
  return deg(Math.atan(-Math.cos(rad(lon - sun.lon)) / Math.tan(rad(sun.lat))));
}
