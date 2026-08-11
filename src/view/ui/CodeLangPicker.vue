<!--
  CodeLangPicker: a compact floating popup with a text input + OK button.
  Used when the user clicks the language label of a code block.
  Accepts letters only (a-z, A-Z), max 20 characters.
-->

<template>
  <Teleport to="body">
    <div
      v-if="visible && anchor && rootEl"
      ref="menuEl"
      class="code-lang-picker"
      :style="pickerStyle"
      role="dialog"
      :aria-label="t('codeLang.title')"
      @mousedown.stop
      @touchstart.stop
    >
      <form
        class="clp-form"
        @submit.prevent="onConfirm"
      >
        <input
          ref="inputEl"
          v-model="draftValue"
          type="text"
          class="clp-input"
          maxlength="20"
          :placeholder="t('codeLang.placeholder')"
          :aria-label="t('codeLang.inputLabel')"
          autocomplete="off"
          spellcheck="false"
          @input="onInput"
          @keydown.escape="emit('close')"
        >
        <button
          class="clp-ok"
          type="submit"
        >
          {{ t('codeLang.confirm') }}
        </button>
      </form>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useI18n } from '../../i18n';

const props = defineProps<{
  visible: boolean;
  initialValue: string;
  /** Anchor element (e.g. the code-block language label). */
  anchor: HTMLElement | null;
  rootEl: HTMLElement | null;
}>();

const emit = defineEmits<{
  confirm: [value: string];
  close: [];
}>();

const { t } = useI18n();

const inputEl = ref<HTMLInputElement | null>(null);
const menuEl = ref<HTMLElement | null>(null);
const draftValue = ref<string>(props.initialValue);
const pickerPos = ref({ top: 0, left: 0 });
const MARGIN = 6;

/** Only letters (a-z, A-Z) — strip everything else. */
function onInput(): void {
  const cleaned = draftValue.value.replace(/[^a-zA-Z]/g, '').slice(0, 20);
  if (cleaned !== draftValue.value) {
    draftValue.value = cleaned;
  }
}

watch(
  [() => props.visible, () => props.anchor, () => props.initialValue],
  async () => {
    if (!props.visible || !props.anchor) return;
    // plain → 显示为空，让用户知道当前没有显式语言
    const raw = props.initialValue ?? '';
    draftValue.value = raw === 'plain' ? '' : raw.replace(/[^a-zA-Z]/g, '').slice(0, 20);
    await nextTick();
    const el = menuEl.value;
    const aRect = props.anchor.getBoundingClientRect();
    const mRect = el?.getBoundingClientRect() ?? { height: 44, width: 220 };

    // 使用 position: fixed 直接以视口为参考系定位
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    const h = Math.max(mRect.height, 36);
    const w = Math.max(mRect.width, 180);

    // 垂直：与锚点垂直居中对齐，空间不足时调整
    const anchorCenterY = aRect.top + aRect.height / 2;
    let top = anchorCenterY - h / 2;
    if (top + h > vh - MARGIN) top = vh - h - MARGIN;
    if (top < MARGIN) top = MARGIN;

    // 水平：在锚点左侧，空间不足时调整
    let left = aRect.left - w - MARGIN;
    if (left < MARGIN) left = MARGIN;
    if (left + w > vw - MARGIN) left = vw - w - MARGIN;

    pickerPos.value = { top, left };
    nextTick(() => {
      inputEl.value?.focus();
      inputEl.value?.select();
    });
  },
  { flush: 'post', immediate: true },
);

const pickerStyle = computed(() => ({
  top: `${pickerPos.value.top}px`,
  left: `${pickerPos.value.left}px`,
}));

function onConfirm(): void {
  const v = (draftValue.value ?? '').replace(/[^a-zA-Z]/g, '').slice(0, 20);
  // 空值 → plain
  emit('confirm', v.length === 0 ? 'plain' : v);
}
</script>
