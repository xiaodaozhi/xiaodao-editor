<!--
  BlockHandle: the handle area to the LEFT of each block.

  Visibility is controlled by the `visible` prop (set by BlockHost based on
  hover/focus state), not by CSS :hover.

  Contains TWO distinct click targets:
    • [+]  INSERT button (openPlusMenu)
    • [⋮⋮] GRIP (openSettingsMenu) — six-dot drag handle

  The grip is also a drag source: pressing and dragging it emits a custom
  gripDragStart event that the parent uses to move the block.  The handle
  itself does NOT manage the document-level drag loop — that's handled in
  BlockEditor so the ghost / drop calculation can access the full document.
-->

<template>
  <div
    ref="handleEl"
    class="block-handle"
    :class="{ visible, dragging }"
    :style="handleStyle"
  >
    <div
      ref="insertBtn"
      class="handle-btn handle-insert"
      role="button"
      tabindex="0"
      :title="t('handle.plus.title')"
      :aria-label="t('handle.plus.ariaLabel')"
      @mousedown.prevent.stop="onPlusClick"
      @keydown.enter.prevent.stop="onPlusClick"
      @keydown.space.prevent.stop="onPlusClick"
    >
      <svg
        viewBox="0 0 16 16"
        width="16"
        height="16"
        aria-hidden="true"
      >
        <path
          d="M8 3.5V12.5M3.5 8H12.5"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
        />
      </svg>
    </div>
    <div
      ref="gripBtn"
      class="handle-btn handle-grip"
      role="button"
      tabindex="0"
      :title="t('handle.grip.title')"
      :aria-label="t('handle.grip.ariaLabel')"
      @mousedown.prevent.stop="onGripMouseDown"
      @click.stop="onGripClick"
      @keydown.enter.prevent.stop="onGripClick"
      @keydown.space.prevent.stop="onGripClick"
    >
      <svg
        viewBox="0 0 16 16"
        width="16"
        height="16"
        aria-hidden="true"
      >
        <circle
          cx="5"
          cy="4"
          r="1.3"
          fill="currentColor"
        />
        <circle
          cx="11"
          cy="4"
          r="1.3"
          fill="currentColor"
        />
        <circle
          cx="5"
          cy="8"
          r="1.3"
          fill="currentColor"
        />
        <circle
          cx="11"
          cy="8"
          r="1.3"
          fill="currentColor"
        />
        <circle
          cx="5"
          cy="12"
          r="1.3"
          fill="currentColor"
        />
        <circle
          cx="11"
          cy="12"
          r="1.3"
          fill="currentColor"
        />
      </svg>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import type { BlockId } from '../../core/types';
import { useI18n } from '../../i18n';
import { useEditable } from '../context';

const props = defineProps<{
  blockId: BlockId;
  visible: boolean;
}>();

const emit = defineEmits<{
  openPlusMenu: [anchor: HTMLElement];
  openSettingsMenu: [anchor: HTMLElement];
  // Emitted on grip mousedown: starts the UNIFIED parent drag lifecycle.
  // Payload: blockId + origin pointer coords + drag threshold hint.
  gripPointerDown: [blockId: BlockId, startX: number, startY: number, options: { thresholdPx: number }];
  // Fired by the parent once it confirms the drag is over (mouse released).
  gripPointerUp: [blockId: BlockId];
}>();

const { t } = useI18n();
const editable = useEditable();

const handleEl = ref<HTMLElement | null>(null);
const insertBtn = ref<HTMLElement | null>(null);
const gripBtn = ref<HTMLElement | null>(null);
const isOpen = ref(false);
const dragging = ref(false);

/**
 * Vertically center the handle on the block's CONTENT area, excluding the
 * block's top/bottom margins. `top: 50%` of `.block-host` (and
 * `.block-host-content`'s offsetHeight) both INCLUDE the heading's
 * margin-top/bottom, because a flex item establishes a block formatting
 * context and contains its child's margins — so the host's height grows by
 * the margin, pushing the geometric center off the visible content center.
 *
 * Fix: measure the renderer's root element (the first element child of
 * `.block-host-content`) with `getBoundingClientRect`, which returns the
 * BORDER box and thus EXCLUDES the element's own margins. Its vertical
 * midpoint, expressed relative to `.block-host`, is the true content center.
 */
const topPx = ref<number | null>(null);
let resizeObs: ResizeObserver | null = null;

const handleStyle = computed(() =>
  topPx.value === null ? undefined : { top: `${topPx.value}px` },
);

/** Resolve the element whose border box represents the visible content. */
function contentTarget(): HTMLElement | null {
  const host = handleEl.value?.parentElement;
  if (!host) return null;
  const wrap = host.querySelector<HTMLElement>('.block-host-content');
  if (!wrap) return null;
  // The renderer's root (e.g. `.block-content`, `.block-code-wrapper`).
  // Its border box excludes its own margins, which is what we want.
  const first = wrap.firstElementChild;
  return first instanceof HTMLElement ? first : wrap;
}

function measure(): void {
  const host = handleEl.value?.parentElement;
  const target = contentTarget();
  if (!host || !target) return;
  const hostRect = host.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  topPx.value = targetRect.top - hostRect.top + targetRect.height / 2;
}

function startObserve(): void {
  const target = contentTarget();
  if (!target) return;
  stopObserve();
  resizeObs = new ResizeObserver(() => measure());
  resizeObs.observe(target);
}

function stopObserve(): void {
  resizeObs?.disconnect();
  resizeObs = null;
}

watch(
  () => props.visible,
  (v) => {
    if (v) {
      void nextTick().then(() => {
        measure();
        startObserve();
      });
    } else {
      stopObserve();
    }
  },
);

onMounted(measure);
onBeforeUnmount(stopObserve);

function onPlusClick(): void {
  if (!editable.value) return;
  if (insertBtn.value) emit('openPlusMenu', insertBtn.value);
}

// --- Click vs drag detection ------------------------------------------------
// The grip is BOTH a click target (open settings menu) AND a drag handle.
// To distinguish:
//   1. On mousedown, record the start coordinates + timestamp + IMMEDIATELY
//      emit gripPointerDown to the parent. The PARENT is in charge of the
//      full drag lifecycle (threshold detection, ghost, drop calculation,
//      drop execution) using its own document-level capture listeners, so
//      there is exactly ONE drag-loop in the whole app — no races.
//   2. Locally we just mark `potentiallyDragging = true` so the click
//      handler can no-op if the parent later confirms a drag happened,
//      OR if too much time elapsed / pointer moved past threshold.

const DRAG_THRESHOLD = 4;
const CLICK_MAX_MS = 300;
let startX = 0;
let startY = 0;
let startTime = 0;
let potentiallyDragging = false;

function onGripMouseDown(e: MouseEvent): void {
  if (!editable.value) return;
  startTime = Date.now();
  startX = e.clientX;
  startY = e.clientY;
  potentiallyDragging = true;
  dragging.value = false;
  // Tell the parent (BlockEditor) to start its own unified drag lifecycle.
  emit('gripPointerDown', props.blockId, startX, startY, {
    thresholdPx: DRAG_THRESHOLD,
  });
}

/** Called by the parent (BlockEditor) when the drag actually starts (past
 *  the threshold). We mark `dragging = true` so the .handle-grip shows the
 *  "grabbing" cursor and the block handle keeps pointer-events auto even
 *  if visible gets toggled. */
function handleSetLocalDragging(active: boolean): void {
  dragging.value = active;
}

function onGripClick(): void {
  if (!editable.value) return;
  if (dragging.value) return;
  if (potentiallyDragging) {
    // If parent hasn't cleared this flag, drag never started but don't
    // open menu if user clearly held the mouse down.
    if (Date.now() - startTime > CLICK_MAX_MS) return;
  }
  potentiallyDragging = false;
  if (gripBtn.value) emit('openSettingsMenu', gripBtn.value);
}

defineExpose({ isOpen, insertBtn, gripBtn, setLocalDragging: handleSetLocalDragging });
</script>
