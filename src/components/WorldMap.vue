<script setup lang="ts">
/* Day and night on a dotted world map: shading follows the sun's height at one instant (● start or ○ end),
   the dashed line is the terminator, and each listed zone gets a pin with its local time.
   Click a pin for its menu. Anywhere else, the nearest city not yet listed shows with its time; click to add it. */
import { ref, reactive, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue';
import { S, type End, startMs, endMs, hasEnd, tzOf } from '../state/store';
import { partsInTz, pad, MIN, clamp } from '../core/time';
import { zoneName, sameZone } from '../core/zones';
import { ZMAX } from '../state/store';
import { LAND, COORDS, isLand, subsolar, sunAltitude, terminatorLat } from '../core/geo';

const props = defineProps<{ which: End; zones: string[]; height: number; width: number }>();
const emit = defineEmits<{ pin: [id: string, el: HTMLElement]; add: [id: string] }>();

const RATIO = LAND.cols / LAND.rows;
const size = computed(() => {
  let w = props.width, h = w / RATIO;
  if (h > props.height) { h = props.height; w = h * RATIO; }
  return { w: Math.floor(w), h: Math.floor(h) };
});
/** Redraw at most once a minute: the terminator moves a quarter of a degree a minute. */
const ms = computed(() => {
  const t = props.which === 'end' && endMs.value != null ? endMs.value : startMs.value;
  return Math.floor(t / MIN) * MIN;
});
const otherMs = computed(() => (props.which === 'end' ? startMs.value : hasEnd.value ? endMs.value : null));
const sun = computed(() => subsolar(ms.value));
const sun2 = computed(() => (otherMs.value == null || Math.abs(otherMs.value - ms.value) < 20 * MIN ? null : subsolar(otherMs.value)));

/* ---------- colors come from the theme tokens ---------- */
type RGBA = [number, number, number, number];
function parseColor(s: string): RGBA {
  s = s.trim();
  let m = /^#([0-9a-f]{6})$/i.exec(s);
  if (m) { const n = parseInt(m[1], 16); return [n >> 16, (n >> 8) & 255, n & 255, 1]; }
  m = /^rgba?\(([^)]+)\)$/i.exec(s);
  if (m) { const p = m[1].split(',').map((x) => parseFloat(x)); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; }
  return [128, 128, 128, 1];
}
const mix = (a: RGBA, b: RGBA, t: number) => `rgba(${Math.round(a[0] + (b[0] - a[0]) * t)},${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(a[2] + (b[2] - a[2]) * t)},${(a[3] + (b[3] - a[3]) * t).toFixed(3)})`;
const colorsTick = ref(0);
let colors: { day: RGBA; night: RGBA; seaDay: RGBA; seaNight: RGBA; term: string } | null = null;
function readColors() {
  const cs = getComputedStyle(document.documentElement);
  const g = (n: string) => parseColor(cs.getPropertyValue(n));
  colors = { day: g('--map-day'), night: g('--map-night'), seaDay: g('--map-sea-day'), seaNight: g('--map-sea-night'), term: cs.getPropertyValue('--map-term').trim() || 'rgba(43,68,214,.5)' };
  colorsTick.value++;
}
const mq = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null;
const onScheme = () => requestAnimationFrame(readColors);
watch(() => S.theme, () => requestAnimationFrame(readColors));

/* ---------- drawing ---------- */
const canvas = ref<HTMLCanvasElement | null>(null);
function draw() {
  const cv = canvas.value, c = colors;
  const { w, h } = size.value;
  if (!cv || !c || w < 20 || h < 10) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const ctx = cv.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const sn = sun.value;
  const step = w / LAND.cols < 2.7 ? 2 : 1;
  const cw = w / LAND.cols, ch = h / LAND.rows;
  const r = Math.max(0.55, Math.min(cw, ch) * step * 0.34);
  const rs = r * 0.62;
  const LV = 12;
  const land = Array.from({ length: LV + 1 }, () => new Path2D());
  const sea = Array.from({ length: LV + 1 }, () => new Path2D());
  for (let row = 0; row < LAND.rows; row += step) {
    const lat = LAND.top - (row + step / 2) * LAND.step;
    const y = (row + step / 2) * ch;
    for (let col = 0; col < LAND.cols; col += step) {
      const lon = -180 + (col + step / 2) * LAND.step;
      const alt = sunAltitude(sn, lat, lon);
      const t = alt <= -12 ? 0 : alt >= 4 ? 1 : (alt + 12) / 16; // night below −12° (nautical), day above 4°
      const lv = Math.round(t * t * (3 - 2 * t) * LV);
      const x = (col + step / 2) * cw;
      let isL = isLand(row, col);
      if (step === 2 && !isL) isL = isLand(row, col + 1) || isLand(row + 1, col) || isLand(row + 1, col + 1);
      if (isL) { land[lv].moveTo(x + r, y); land[lv].arc(x, y, r, 0, Math.PI * 2); }
      else sea[lv].rect(x - rs / 2, y - rs / 2, rs, rs);
    }
  }
  for (let i = 0; i <= LV; i++) {
    const t = i / LV;
    ctx.fillStyle = mix(c.seaNight, c.seaDay, t); ctx.fill(sea[i]);
    ctx.fillStyle = mix(c.night, c.day, t); ctx.fill(land[i]);
  }
  if (Math.abs(sn.lat) > 0.05) {
    ctx.beginPath();
    for (let i = 0; i <= 360; i += 2) {
      const lat = terminatorLat(sn, -180 + i);
      const x = (i / 360) * w, y = ((LAND.top - lat) / LAND.step) * ch;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = c.term; ctx.lineWidth = 1; ctx.setLineDash([3, 4]); ctx.stroke(); ctx.setLineDash([]);
  }
}
let raf = 0;
function schedule() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); }); }
watch([ms, size, colorsTick], schedule);
onMounted(() => { readColors(); mq?.addEventListener?.('change', onScheme); schedule(); });
onBeforeUnmount(() => { mq?.removeEventListener?.('change', onScheme); cancelAnimationFrame(raf); });

/* ---------- pins and suns ---------- */
const H = LAND.rows * LAND.step;
const pos = (lat: number, lon: number) => ({ left: ((lon + 180) / 360) * 100, top: ((LAND.top - lat) / H) * 100 });
const baseTz = computed(() => tzOf(props.which === 'end' && hasEnd.value ? 'end' : 'start'));
const pins = computed(() => props.zones.filter((id) => COORDS[id]).map((id) => {
  const [lat, lon] = COORDS[id];
  const p = partsInTz(ms.value, id);
  return { id, name: zoneName(id), t: `${pad(p.h)}:${pad(p.mi)}`, base: sameZone(id, baseTz.value), ...pos(lat, lon) };
}));
const sunPos = computed(() => pos(clamp(sun.value.lat, LAND.top - H, LAND.top), sun.value.lon));
const sun2Pos = computed(() => (sun2.value ? pos(clamp(sun2.value.lat, LAND.top - H, LAND.top), sun2.value.lon) : null));
const sunTip = computed(() => {
  const s = sun.value;
  return `太陽直射 ${Math.abs(s.lat).toFixed(1)}°${s.lat < 0 ? 'S' : 'N'} ${Math.abs(s.lon).toFixed(1)}°${s.lon < 0 ? 'W' : 'E'}（${props.which === 'end' ? '○ 結束' : '● 開始'}的時刻）`;
});

/* ---------- pointing at the map: the nearest city that is not listed yet ---------- */
const RAD = Math.PI / 180;
function nearest(lat: number, lon: number): string | null {
  let best: string | null = null, bd = Infinity;
  for (const id in COORDS) {
    if (props.zones.some((z) => sameZone(z, id))) continue;
    const [la, lo] = COORDS[id];
    // central angle between the two points (haversine)
    const a = Math.sin(((la - lat) * RAD) / 2) ** 2 + Math.cos(lat * RAD) * Math.cos(la * RAD) * Math.sin(((lo - lon) * RAD) / 2) ** 2;
    if (a < bd) { bd = a; best = id; }
  }
  // farther than about 2,500 km (open sea, poles): nothing to offer
  return bd < Math.sin((22.5 * RAD) / 2) ** 2 ? best : null;
}
const ghostId = ref<string | null>(null);
function cityAt(e: PointerEvent | MouseEvent): string | null {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height;
  return nearest(LAND.top - fy * H, -180 + fx * 360);
}
const onPinTarget = (e: Event) => !!(e.target as HTMLElement).closest('.pin, .sun, .sun2');
function onMove(e: PointerEvent) { ghostId.value = e.pointerType === 'mouse' && !onPinTarget(e) ? cityAt(e) : null; }
function onMapClick(e: MouseEvent) {
  const pin = (e.target as HTMLElement).closest<HTMLElement>('.pin');
  if (pin) { emit('pin', pin.dataset.id!, pin); return; }
  if (onPinTarget(e)) return;
  const id = cityAt(e);
  if (id) { emit('add', id); ghostId.value = null; }
}
const full = computed(() => props.zones.length >= ZMAX);
const ghost = computed(() => {
  const id = ghostId.value;
  if (!id || !COORDS[id]) return null;
  const [lat, lon] = COORDS[id];
  const p = partsInTz(ms.value, id);
  return { id, name: zoneName(id), t: `${pad(p.h)}:${pad(p.mi)}`, ...pos(lat, lon), right: pos(lat, lon).left > 70 };
});

/* labels avoid each other: right, left, below-right, below-left, or just the dot */
const place = reactive<Record<string, string>>({});
const layer = ref<HTMLElement | null>(null);
async function layoutPins() {
  for (const k of Object.keys(place)) place[k] = '';
  await nextTick();
  const el = layer.value;
  if (!el) return;
  const W = el.clientWidth, Hh = el.clientHeight;
  const placed: { x: number; y: number; w: number; h: number }[] = [];
  const nodes = [...el.querySelectorAll<HTMLElement>('.pin')].sort((a, b) => Number(b.classList.contains('base')) - Number(a.classList.contains('base')));
  for (const pin of nodes) {
    const id = pin.dataset.id!, lab = pin.querySelector<HTMLElement>('span');
    if (!lab) continue;
    const px = pin.offsetLeft, py = pin.offsetTop, lw = lab.offsetWidth, lh = lab.offsetHeight;
    const opts: [string, number, number][] = [['', px + 7, py - lh / 2 - 6], ['left', px - 7 - lw, py - lh / 2 - 6], ['below', px + 7, py + 5], ['left below', px - 7 - lw, py + 5]];
    let chosen: [string, { x: number; y: number; w: number; h: number }] | null = null;
    for (const [cls, x, y] of opts) {
      const rc = { x, y, w: lw, h: lh };
      if (x < 2 || x + lw > W - 2 || y < 2 || y + lh > Hh - 2) continue;
      if (placed.some((q) => !(rc.x + rc.w < q.x || q.x + q.w < rc.x || rc.y + rc.h < q.y || q.y + q.h < rc.y))) continue;
      chosen = [cls, rc]; break;
    }
    place[id] = chosen ? chosen[0] : 'mini';
    if (chosen) placed.push(chosen[1]);
  }
}
watch([() => pins.value.map((p) => p.id + p.t + p.base).join(), size], () => requestAnimationFrame(layoutPins));
onMounted(() => requestAnimationFrame(layoutPins));
</script>

<template>
  <div class="wmap" :style="{ height: height + 'px' }">
    <div class="wm" :class="{ pointing: !!ghost }" :style="{ width: size.w + 'px', height: size.h + 'px' }" @pointermove="onMove" @pointerleave="ghostId = null" @click="onMapClick">
      <canvas ref="canvas" class="wm-cv" :style="{ width: size.w + 'px', height: size.h + 'px' }" role="img"
        :aria-label="`世界地圖：${which === 'end' ? '結束' : '開始'}時刻的白天與黑夜`" />
      <div ref="layer" class="wm-pins">
        <i v-if="sun2Pos" class="sun2" :style="{ left: sun2Pos.left + '%', top: sun2Pos.top + '%' }" v-tip="`○ 另一端時刻的太陽位置`" />
        <i class="sun" :style="{ left: sunPos.left + '%', top: sunPos.top + '%' }" v-tip="sunTip" />
        <div v-for="p in pins" :key="p.id" class="pin" :class="[place[p.id] || '', { base: p.base }]" :data-id="p.id" :style="{ left: p.left + '%', top: p.top + '%' }"
          role="button" tabindex="0" :aria-label="`${p.name} ${p.t}，打開選單`" v-tip="`${p.name}：設為開始或結束的時區，或移除`" @keydown.enter.prevent="emit('pin', p.id, $event.currentTarget as HTMLElement)">
          <i /><span>{{ p.name }}<b>{{ p.t }}</b></span>
        </div>
        <div v-if="ghost" class="ghost" :class="{ left: ghost.right }" :style="{ left: ghost.left + '%', top: ghost.top + '%' }" aria-hidden="true">
          <i /><span><em>{{ full ? '已滿' : '+' }}</em>{{ ghost.name }}<b>{{ ghost.t }}</b></span>
        </div>
      </div>
      <span class="wm-hint" aria-hidden="true">點地圖加入城市</span>
    </div>
  </div>
</template>

<style scoped>
.wmap { position: relative; flex: none; display: flex; justify-content: center; align-items: center; min-width: 0; }
.wm { position: relative; border-radius: .9rem; overflow: hidden; background: var(--well); border: 1px solid var(--hair); }
.wm-cv { display: block; }
.wm-pins { position: absolute; inset: 0; }
.wm.pointing { cursor: copy; }
.pin { position: absolute; width: 0; height: 0; cursor: pointer; outline: none; }
.pin span { cursor: pointer; transition: border-color .15s, color .15s; }
.pin:hover span, .pin:focus-visible span { border-color: var(--accent); color: var(--accent); }
.pin:hover i, .pin:focus-visible i { transform: scale(1.25); }
.pin i { transition: transform .15s; }
.ghost { position: absolute; width: 0; height: 0; pointer-events: none; }
.ghost i { position: absolute; left: -.34rem; top: -.34rem; width: .68rem; height: .68rem; border-radius: 50%; border: 1.5px dashed var(--accent); background: var(--surface); }
.ghost span { position: absolute; left: .5rem; top: 0; transform: translateY(-50%); padding: .12rem .4rem; border-radius: .45rem; background: var(--accent); color: var(--accent-ink); font-size: var(--fs-xs); font-weight: 600; white-space: nowrap; line-height: 1.25; }
.ghost.left span { left: auto; right: .5rem; }
.ghost em { font-style: normal; margin-right: .25rem; }
.ghost b { font-family: var(--f-mono); font-stretch: 75%; font-weight: 500; margin-left: .35rem; opacity: .85; }
/* bottom left is the South Pacific: no curated city and never the sun */
.wm-hint { position: absolute; left: .3rem; bottom: .2rem; padding: 0 .3rem; border-radius: .3rem; background: color-mix(in srgb, var(--face) 80%, transparent); font-size: var(--fs-xs); letter-spacing: .06em; color: var(--ink-3); pointer-events: none; transition: opacity .15s; }
.wm:hover .wm-hint { opacity: 0; }
.pin i { position: absolute; left: -.3rem; top: -.3rem; width: .6rem; height: .6rem; border-radius: 50%; background: var(--accent); box-shadow: 0 0 0 .16rem var(--surface); }
.pin.base i { left: -.38rem; top: -.38rem; width: .76rem; height: .76rem; background: var(--now); box-shadow: 0 0 0 .18rem var(--surface), 0 0 0 .5rem var(--now-wash); }
.pin span { position: absolute; left: .45rem; top: 0; transform: translateY(calc(-50% - .38rem)); padding: .12rem .4rem; border-radius: .45rem; background: var(--surface-2); border: 1px solid var(--hair); box-shadow: 0 .3rem .9rem -.5rem rgba(11, 18, 34, .35); font-size: var(--fs-xs); font-weight: 600; white-space: nowrap; line-height: 1.25; color: var(--ink); }
.pin span b { font-family: var(--f-mono); font-stretch: 75%; font-weight: 500; color: var(--ink-2); margin-left: .35rem; }
.pin.left span { left: auto; right: .45rem; }
.pin.below span { transform: translateY(.3rem); }
.pin.mini span { display: none; }
.sun, .sun2 { position: absolute; width: 0; height: 0; }
.sun::before { content: ''; position: absolute; left: -.6rem; top: -.6rem; width: 1.2rem; height: 1.2rem; border-radius: 50%; background: radial-gradient(circle, #E8961A 0 36%, transparent 40%), radial-gradient(circle, rgba(232, 150, 26, .35) 0 68%, transparent 70%); }
.sun2::before { content: ''; position: absolute; left: -.42rem; top: -.42rem; width: .84rem; height: .84rem; border-radius: 50%; box-shadow: inset 0 0 0 1.5px #E8961A; opacity: .8; }
</style>
