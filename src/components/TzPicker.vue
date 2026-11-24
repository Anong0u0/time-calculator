<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import Popover from './Popover.vue';
import Icon from './Icon.vue';
import { searchZones, sameZone, offShort, zoneName } from '../core/zones';
import { partsInTz, pad, WD, wdOf } from '../core/time';
import { now } from '../state/store';
import { remPx } from '../composables/size';

const props = defineProps<{
  open: boolean;
  anchor: HTMLElement | null;
  title: string;
  current?: string | null;
  exclude?: string[];
}>();
const emit = defineEmits<{ close: []; pick: [id: string] }>();
const q = ref('');
const sel = ref(0);
const input = ref<HTMLInputElement | null>(null);
const pop = ref<InstanceType<typeof Popover> | null>(null);

const room = computed(() => {
  const maxH = pop.value?.pos.maxH ?? 420;
  const rowH = 2.75 * remPx.value;
  return Math.max(3, Math.min(9, Math.floor((maxH - 6.6 * remPx.value) / rowH)));
});
const hits = computed(() =>
  searchZones(q.value, now.value, 40)
    .filter((h) => !(props.exclude || []).some((x) => sameZone(x, h.z.id)))
    .slice(0, room.value),
);
const total = computed(() => searchZones(q.value, now.value).length);

watch(
  () => props.open,
  async (o) => {
    if (!o) return;
    q.value = '';
    sel.value = 0;
    await nextTick();
    input.value?.focus();
  },
);
watch(q, () => {
  sel.value = 0;
  nextTick(() => pop.value?.place());
});

function timeIn(id: string) {
  const w = partsInTz(now.value, id);
  return `${pad(w.h)}:${pad(w.mi)}`;
}
function dayIn(id: string) {
  const w = partsInTz(now.value, id);
  return `週${WD[wdOf(w)]}`;
}
function key(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    sel.value = Math.min(hits.value.length - 1, sel.value + 1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    sel.value = Math.max(0, sel.value - 1);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const h = hits.value[sel.value];
    if (h) pick(h.z.id);
  }
}
function pick(id: string) {
  emit('pick', id);
  emit('close');
}
</script>

<template>
  <Popover ref="pop" :open="open" :anchor="anchor" :label="title" width="24rem" @close="emit('close')">
    <div class="tzp">
      <div class="tzp-head">
        <span class="tzp-title">{{ title }}</span>
        <span v-if="current" class="tzp-cur">目前：{{ zoneName(current) }}</span>
      </div>
      <label class="tzp-search">
        <Icon name="search" />
        <input
          ref="input"
          v-model="q"
          type="text"
          placeholder="城市、國家、Asia/Tokyo 或 UTC+9"
          autocomplete="off"
          spellcheck="false"
          role="combobox"
          aria-expanded="true"
          aria-controls="tzp-list"
          :aria-activedescendant="hits[sel] ? `tzp-${sel}` : undefined"
          @keydown="key"
        />
      </label>
      <ul id="tzp-list" role="listbox" class="tzp-list">
        <li
          v-for="(h, i) in hits"
          :id="`tzp-${i}`"
          :key="h.z.id"
          role="option"
          :aria-selected="i === sel"
          :class="{ on: i === sel, cur: current && sameZone(current, h.z.id) }"
          @pointerenter="sel = i"
          @click="pick(h.z.id)"
        >
          <span class="tzp-name"
            ><b>{{ h.z.zh }}</b
            ><small>{{ h.z.en !== h.z.zh ? h.z.en : h.z.id }}</small></span
          >
          <span class="tzp-off mono">{{ offShort(h.off) }}</span>
          <span class="tzp-time mono"
            >{{ timeIn(h.z.id) }}<small>{{ dayIn(h.z.id) }}</small></span
          >
        </li>
        <li v-if="!hits.length" class="tzp-empty">找不到「{{ q }}」</li>
      </ul>
      <p v-if="total > hits.length" class="tzp-more">另有 {{ total - hits.length }} 筆，輸入關鍵字篩選</p>
    </div>
  </Popover>
</template>

<style scoped>
.tzp {
  display: flex;
  flex-direction: column;
  padding: 0.75rem;
  gap: 0.55rem;
}
.tzp-head {
  display: flex;
  align-items: baseline;
  gap: 0.6rem;
  padding: 0 0.25rem;
}
.tzp-title {
  font-weight: 650;
}
.tzp-cur {
  font-size: max(var(--floor), 0.85rem);
  color: var(--ink-3);
  margin-left: auto;
}
.tzp-search {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  height: 2.6rem;
  padding: 0 0.8rem;
  border-radius: 0.8rem;
  background: var(--well);
  border: 1px solid var(--hair-2);
  color: var(--ink-3);
}
.tzp-search:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-wash-2);
}
.tzp-search input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: none;
  height: 100%;
  font-size: 0.95rem;
  color: var(--ink);
}
.tzp-search input::placeholder {
  color: var(--ink-3);
}
.tzp-list li[role='option'] {
  display: grid;
  grid-template-columns: 1fr auto 4.6rem;
  align-items: center;
  gap: 0.6rem;
  height: 2.75rem;
  padding: 0 0.6rem;
  border-radius: 0.7rem;
  cursor: pointer;
}
.tzp-list li.on {
  background: var(--accent-wash);
}
.tzp-list li.cur .tzp-name b {
  color: var(--accent);
}
.tzp-name {
  display: flex;
  flex-direction: column;
  min-width: 0;
  line-height: 1.2;
}
.tzp-name b {
  font-weight: 600;
  font-size: 0.95rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tzp-name small,
.tzp-time small {
  font-size: var(--fs-xs);
  color: var(--ink-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tzp-off {
  font-size: var(--fs-s);
  color: var(--ink-2);
}
.tzp-time {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  font-size: 0.88rem;
  line-height: 1.2;
}
.tzp-empty {
  padding: 0.8rem 0.6rem;
  font-size: 0.9rem;
  color: var(--ink-3);
}
.tzp-more {
  font-size: var(--fs-s);
  color: var(--ink-3);
  padding: 0 0.3rem;
}
</style>
