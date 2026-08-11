<!--
  NumberPicker: a compact floating popup with a number input + OK button.
  Used from the OrderedListMenu's "Modify number value" action.
-->

<template>
  <Teleport to="body">
    <div
      v-if="visible && anchor && rootEl"
      class="number-picker"
      :style="pickerStyle"
      role="dialog"
      :aria-label="t('numberPicker.title')"
      @mousedown.stop
      @touchstart.stop
    >
      <form
        class="np-form"
        @submit.prevent="onConfirm"
      >
        <input
          ref="inputEl"
          v-model.number="draftValue"
          type="number"
          class="np-input"
          min="1"
          step="1"
          :aria-label="t('numberPicker.inputLabel')"
          @keydown.escape="emit('close')"
        >
        <button
          class="np-ok"
          type="submit"
        >
          {{ t('numberPicker.confirm') }}
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
  initialValue: number;
  /** Anchor element (e.g. the OrderedListMenu item). */
  anchor: HTMLElement | null;
  rootEl: HTMLElement | null;
}>();

const emit = defineEmits<{
  confirm: [value: number];
  close: [];
}>();

const { t } = useI18n();

const inputEl = ref<HTMLInputElement | null>(null);
const draftValue = ref<number>(props.initialValue);
const pickerPos = ref({ top: 0, left: 0 });
const MARGIN = 6;

watch(
  [() => props.visible, () => props.anchor, () => props.initialValue],
  async () => {
    if (!props.visible || !props.anchor) return;
    draftValue.value = props.initialValue;
    await nextTick();
    const aRect = props.anchor.getBoundingClientRect();
    // 使用 position: fixed 直接以视口为参考系定位
    const vh = window.innerHeight;
    const estimated = 52;
    let above = false;
    if (vh - aRect.bottom - MARGIN < estimated && aRect.top - MARGIN > estimated) {
      above = true;
    }
    pickerPos.value = {
      top: above ? aRect.top - (estimated + MARGIN) : aRect.bottom + MARGIN,
      left: aRect.left,
    };
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
  let v = draftValue.value;
  if (!Number.isFinite(v)) v = props.initialValue;
  v = Math.max(1, Math.floor(v));
  emit('confirm', v);
}
</script>
