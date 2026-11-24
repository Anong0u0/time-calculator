<script setup lang="ts">
import { ref, computed } from 'vue';
import Icon from './Icon.vue';
import RuleBuilder from './RuleBuilder.vue';
import { type Rule, encodeRule, ruleName } from '../core/rule';
import { vocab, wordRule, builtinOf, KIND_NAME, type WordKind } from '../core/vocab';
import { S, commit, ruleTick, toast, runRule, tzOf } from '../state/store';
import { partsInTz, WD, wdOf, pad } from '../core/time';

const groups = computed(() => {
  void ruleTick.value;
  const g = new Map<WordKind, ReturnType<typeof vocab>>();
  for (const w of vocab()) {
    if (!g.has(w.kind)) g.set(w.kind, []);
    g.get(w.kind)!.push(w);
  }
  // 農曆節日 and 節氣 follow the display setting (typing them still works)
  return [...g.entries()].filter(([k]) => S.prefs.lunar || (k !== 'lunar' && k !== 'term'));
});
const removed = computed(() => S.wordsOff.filter((n) => builtinOf(n)));

const edit = ref<{ name: string; isNew: boolean; builtin: boolean } | null>(null);
const draft = ref<Rule>({ o: { t: 'now' }, steps: [] });
const draftName = ref('');
function open(name: string) {
  const r = wordRule(name);
  edit.value = { name, isNew: false, builtin: !!builtinOf(name) };
  draft.value = r ? JSON.parse(JSON.stringify(r)) : { o: { t: 'now' }, steps: [] };
  draftName.value = name;
}
function openNew() {
  edit.value = { name: '', isNew: true, builtin: false };
  draft.value = { o: { t: 'now' }, steps: [{ t: 'time', h: 18, mi: 0, s: 0 }] };
  draftName.value = '';
}
function save() {
  const e = edit.value;
  if (!e) return;
  const n = (e.builtin ? e.name : draftName.value).trim().slice(0, 20);
  if (!n) {
    toast('先替這個詞取個名字');
    return;
  }
  if (/^\d/.test(n)) {
    toast('詞的名字不能用數字開頭');
    return;
  }
  if (n !== e.name && (S.words.some((w) => w.name === n) || builtinOf(n))) {
    toast(`已經有「${n}」這個詞了`);
    return;
  }
  const code = encodeRule(draft.value);
  commit(
    () => {
      S.words = S.words.filter((w) => w.name !== e.name && w.name !== n);
      // a built-in word given back its own meaning needs no entry
      if (!(e.builtin && builtinOf(n)?.code === code)) S.words.push({ name: n, code });
      S.wordsOff = S.wordsOff.filter((x) => x !== n);
    },
    { label: `詞彙：${n}`, say: `已儲存詞彙「${n}」` },
  );
  edit.value = null;
}
function remove(name: string) {
  commit(
    () => {
      S.words = S.words.filter((w) => w.name !== name);
      if (builtinOf(name) && !S.wordsOff.includes(name)) S.wordsOff.push(name);
    },
    { label: `移除詞彙：${name}`, say: `已移除詞彙「${name}」` },
  );
  if (edit.value?.name === name) edit.value = null;
}
function restore(name: string) {
  commit(
    () => {
      S.wordsOff = S.wordsOff.filter((x) => x !== name);
      S.words = S.words.filter((w) => w.name !== name);
    },
    { label: `恢復詞彙：${name}`, say: `已恢復「${name}」` },
  );
}
function resetWord(name: string) {
  commit(
    () => {
      S.words = S.words.filter((w) => w.name !== name);
    },
    { label: `詞彙恢復原本的意思：${name}`, say: `「${name}」恢復原本的意思` },
  );
  open(name);
}
function when(name: string): string {
  void ruleTick.value;
  const r = wordRule(name);
  if (!r) return '';
  const res = runRule(r, 'end');
  if (!res.ok) return res.err;
  const w = partsInTz(res.ms, tzOf('end'));
  return `${w.mo}/${w.d}（${WD[wdOf(w)]}）${w.h || w.mi ? ` ${pad(w.h)}:${pad(w.mi)}` : ''}`;
}
const autoName = computed(() => ruleName(draft.value, S.prefs));
</script>

<template>
  <div class="vp">
    <section class="vp-sec">
      <h3>通用規則</h3>
      <div class="vp-set">
        <span>一週從</span>
        <div class="seg-ctl">
          <button type="button" :aria-pressed="S.prefs.weekStart === 1" @click="S.prefs.weekStart = 1">週一開始</button
          ><button type="button" :aria-pressed="S.prefs.weekStart === 0" @click="S.prefs.weekStart = 0">
            週日開始
          </button>
        </div>
      </div>
      <div class="vp-set">
        <span>節氣落在哪天</span>
        <div class="seg-ctl">
          <button type="button" :aria-pressed="S.prefs.termTz === 'china'" @click="S.prefs.termTz = 'china'">
            照農民曆（北京時間）</button
          ><button type="button" :aria-pressed="S.prefs.termTz === 'local'" @click="S.prefs.termTz = 'local'">
            照那一端的時區
          </button>
        </div>
      </div>
      <div class="vp-set">
        <span>期間裡沒有那一天<small>例如 2 月 31 號、小月的三十</small></span>
        <div class="seg-ctl">
          <button type="button" :aria-pressed="S.prefs.missing === 'clamp'" @click="S.prefs.missing = 'clamp'">
            取最接近的一天</button
          ><button type="button" :aria-pressed="S.prefs.missing === 'error'" @click="S.prefs.missing = 'error'">
            算是錯誤
          </button>
        </div>
      </div>
      <div class="vp-set">
        <span>挑到一天時</span>
        <div class="seg-ctl">
          <button type="button" :aria-pressed="S.prefs.dayResets" @click="S.prefs.dayResets = true">從 0:00 開始</button
          ><button type="button" :aria-pressed="!S.prefs.dayResets" @click="S.prefs.dayResets = false">
            保留原本的時刻
          </button>
        </div>
      </div>
      <div class="vp-set">
        <span>從現在算的規則<small>套用之後</small></span>
        <div class="seg-ctl">
          <button type="button" :aria-pressed="!S.prefs.followNow" @click="S.prefs.followNow = false">
            固定在算出的時刻</button
          ><button type="button" :aria-pressed="S.prefs.followNow" @click="S.prefs.followNow = true">
            一直跟著重新算
          </button>
        </div>
      </div>
    </section>

    <section class="vp-sec">
      <h3>
        詞彙<button type="button" class="chip sm" @click="openNew"><Icon name="plus" />新的詞</button>
      </h3>
      <p class="vp-note">點選詞彙可修改定義，打字與積木皆可組合使用。</p>
      <div v-for="[k, list] in groups" :key="k" class="vp-g">
        <span class="vp-k">{{ KIND_NAME[k] }}</span>
        <div class="vp-words">
          <button
            v-for="w in list"
            :key="w.name"
            type="button"
            class="chip sm"
            :class="{ mod: w.custom && w.builtin }"
            :aria-pressed="edit?.name === w.name"
            v-tip="
              `${w.note ? w.note + '。' : ''}現在是 ${when(w.name)}${w.alias?.length ? `。也可以寫成：${w.alias.join('、')}` : ''}`
            "
            @click="open(w.name)"
          >
            {{ w.name }}
          </button>
        </div>
      </div>
      <p v-if="!S.prefs.lunar" class="vp-note">農曆與節氣已隱藏（打字仍可辨識）。</p>
      <div v-if="removed.length" class="vp-g">
        <span class="vp-k">已移除</span>
        <div class="vp-words">
          <button
            v-for="n in removed"
            :key="n"
            type="button"
            class="chip sm off"
            v-tip="'點一下恢復'"
            @click="restore(n)"
          >
            <Icon name="undo" />{{ n }}
          </button>
        </div>
      </div>
    </section>

    <section v-if="edit" class="vp-sec vp-edit">
      <h3>{{ edit.isNew ? '新的詞' : `「${edit.name}」的意思` }}</h3>
      <label v-if="!edit.builtin" class="vp-name"
        ><span>名字</span
        ><input
          v-model="draftName"
          type="text"
          maxlength="20"
          placeholder="例如：下班、發薪日、媽生日"
          aria-label="詞的名字"
      /></label>
      <RuleBuilder v-model="draft" self="end" :text="true" />
      <p class="vp-note">
        展開為：<b>{{ autoName }}</b>
      </p>
      <div class="vp-acts">
        <button type="button" class="btn" @click="save"><Icon name="check" />儲存</button>
        <button
          v-if="edit.builtin && S.words.some((w) => w.name === edit!.name)"
          type="button"
          class="chip"
          @click="resetWord(edit.name)"
        >
          恢復原本的意思
        </button>
        <button v-if="!edit.isNew" type="button" class="chip danger" @click="remove(edit.name)">
          <Icon name="x" />移除這個詞
        </button>
        <button type="button" class="chip" @click="edit = null">取消</button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.vp {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.vp-sec {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}
.vp-sec h3 {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: var(--fs-s);
  font-weight: 650;
  color: var(--ink-2);
}
.vp-sec h3 .chip {
  margin-left: auto;
}
.vp-set {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  font-size: 0.86rem;
  color: var(--ink-2);
}
.vp-set > span small {
  margin-left: 0.4rem;
  font-size: var(--fs-xs);
  color: var(--ink-3);
}
.vp-set .seg-ctl {
  align-self: flex-start;
  flex-wrap: wrap;
}
.vp-g {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.vp-k {
  font-size: var(--fs-xs);
  font-weight: 650;
  color: var(--ink-3);
}
.vp-words {
  display: flex;
  flex-wrap: wrap;
  gap: 0.22rem;
}
.chip.sm {
  height: 1.8rem;
  padding: 0 0.55rem;
  font-size: var(--fs-s);
}
.chip.sm .ic,
.vp-acts .ic {
  width: 0.9em;
  height: 0.9em;
}
.chip.mod {
  border-color: var(--accent-line);
  color: var(--accent);
}
.chip.off {
  color: var(--ink-3);
  text-decoration: line-through;
}
.chip.danger {
  color: var(--now);
}
.vp-note {
  font-size: var(--fs-xs);
  line-height: 1.5;
  color: var(--ink-3);
}
.vp-note code {
  font-family: var(--f-mono);
  color: var(--accent);
}
.vp-note b {
  color: var(--ink-2);
}
.vp-edit {
  padding: 0.75rem;
  border-radius: 0.9rem;
  border: 1px solid var(--accent-line);
  background: color-mix(in srgb, var(--accent) 4%, var(--surface));
}
.vp-name {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: var(--fs-s);
  color: var(--ink-3);
}
.vp-name input {
  flex: 1;
  min-width: 0;
  height: 2.1rem;
  padding: 0 0.6rem;
  border-radius: 0.6rem;
  border: 1px solid var(--hair-2);
  background: var(--surface-2);
  color: var(--ink);
  font: inherit;
  font-size: 0.9rem;
}
.vp-acts {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}
@media (pointer: coarse) {
  .chip.sm {
    height: 2.3rem;
  }
}
</style>
