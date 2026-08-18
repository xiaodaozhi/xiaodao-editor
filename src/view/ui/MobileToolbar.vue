<!--
  MobileToolbar: a fixed bottom action bar for iOS / iPadOS / Android browsers.

  It replaces the floating HoverToolbar on touch devices and provides:
    1. Plus / handle buttons (left, fixed) — reuse the existing PlusMenu and
       BlockSettingsMenu by emitting events that BlockEditor wires to the
       same onOpenPlusMenu / onOpenSettingsMenu handlers used by the desktop
       block handle.
    2. The full HoverToolbar button set (type / align / verticalAlign / marks /
       color / copy / table operations) — rendered by embedding a single
       <HoverToolbar mobile> instance. The props + handlers come from a
       "descriptor" that is sourced from EITHER:
         • the text-block selection state (passed as props from BlockEditor),
         • the table cell / cell-edit selection state (published by TableBlock
           via the mobileToolbarBridge injection key).
       This means MobileToolbar does NOT duplicate any button or command logic —
       it is purely a different presentation of the same HoverToolbar.

  Safe area: padding-bottom: env(safe-area-inset-bottom) handles the iPhone
  home indicator. Virtual keyboard: the visualViewport API is used to keep the
  toolbar above the keyboard.
-->

<template>
  <div
    v-if="editable"
    ref="toolbarRoot"
    class="mobile-toolbar"
    :style="toolbarStyle"
    role="toolbar"
    :aria-label="t('hoverToolbar.label')"
  >
    <!-- Left: plus + handle (fixed, always visible when a focus block exists) -->
    <div class="mt-left">
      <button
        ref="plusBtnEl"
        class="mt-btn mt-plus"
        :class="{ disabled: !activeBlockId }"
        :disabled="!activeBlockId"
        :title="t('handle.plus.title')"
        :aria-label="t('handle.plus.ariaLabel')"
        @mousedown.prevent.stop="onPlusClick"
        @touchstart.stop
      >
        <svg
          viewBox="0 0 16 16"
          width="18"
          height="18"
          aria-hidden="true"
        >
          <path
            d="M8 3.5V12.5M3.5 8H12.5"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
          />
        </svg>
      </button>
      <button
        ref="handleBtnEl"
        class="mt-btn mt-handle"
        :class="{ disabled: !activeBlockId }"
        :disabled="!activeBlockId"
        :title="t('handle.grip.title')"
        :aria-label="t('handle.grip.ariaLabel')"
        @mousedown.prevent.stop="onHandleClick"
        @touchstart.stop
      >
        <svg
          viewBox="0 0 16 16"
          width="18"
          height="18"
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
      </button>
    </div>
    <!-- Divider between fixed buttons and contextual buttons -->
    <div
      v-if="descriptor.visible"
      class="mt-sep"
    />
    <!-- HoverToolbar (mobile mode) — renders ALL contextual buttons.
         v-bind spreads the descriptor (props + onXxx handlers). -->
    <HoverToolbar
      mobile
      v-bind="descriptor"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount, inject } from 'vue';
import HoverToolbar from './HoverToolbar.vue';
import { useI18n } from '../../i18n';
import { useEditable, useEditor, mobileToolbarBridgeKey } from '../context';
import type { MobileToolbarDescriptor } from '../context';
import type { BlockId } from '../../core/types';

const props = defineProps<{
  rootEl: HTMLElement | null;
  focusBlockId: BlockId | null;
  // Text-block selection state (mirrors BlockEditor's hoverToolbar reactive).
  hoverVisible: boolean;
  hoverSelectionRect: DOMRect | null;
  hoverBlockId: BlockId | null;
  hoverBlockType: string | null;
  hoverBlockAttrs: Readonly<Record<string, unknown>>;
}>();

const emit = defineEmits<{
  openPlusMenu: [blockId: BlockId, anchor: HTMLElement];
  openSettingsMenu: [blockId: BlockId, anchor: HTMLElement];
  linkClick: [blockId: BlockId, from: number, to: number];
  hoverClose: [];
}>();

const { t } = useI18n();
const editable = useEditable();
const editor = useEditor();

// --- Table bridge (table-sourced descriptor) ------------------------------
// TableBlock publishes its toolbar state here when running on mobile. null
// when no table selection / cell-edit is active.
const tableBridge = inject(mobileToolbarBridgeKey, ref<MobileToolbarDescriptor | null>(null));

// --- Active descriptor: table takes priority, then text selection --------
// The bottom toolbar ALWAYS shows the block's text-action buttons (type /
// align / marks / color / copy). When there is an active text selection or a
// table selection those buttons follow the existing HoverToolbar logic; when
// there is no selection at all (just a focused block), we still render the
// buttons but HoverToolbar disables them (see noTextSelection in HoverToolbar).
const descriptor = computed<MobileToolbarDescriptor>(() => {
  const td = tableBridge.value;
  if (td && td.visible) {
    // Table descriptor already includes rootEl + all handlers.
    return td;
  }
  // Text-block selection descriptor.
  if (props.hoverVisible) {
    return {
      visible: true,
      selectionRect: props.hoverSelectionRect,
      blockId: props.hoverBlockId,
      blockType: props.hoverBlockType,
      blockAttrs: props.hoverBlockAttrs,
      rootEl: props.rootEl,
      onClose: () => emit('hoverClose'),
      onLinkClick: (blockId: BlockId, from: number, to: number) => emit('linkClick', blockId, from, to),
    };
  }
  // No selection — if there is a focused block, still render the text-action
  // buttons (disabled) so the toolbar is always present. selectionRect is
  // null here, which HoverToolbar reads as "no selection" and disables the
  // buttons that require a selection.
  const fid = props.focusBlockId;
  if (fid) {
    const fb = editor.getState().doc.blocks.get(fid);
    return {
      visible: true,
      selectionRect: null,
      blockId: fid,
      blockType: fb?.type ?? null,
      blockAttrs: fb?.attrs ?? {},
      rootEl: props.rootEl,
      onClose: () => emit('hoverClose'),
      onLinkClick: (blockId: BlockId, from: number, to: number) => emit('linkClick', blockId, from, to),
    };
  }
  // No focus block — render the toolbar shell (plus/handle only).
  return {
    visible: false,
    selectionRect: null,
    blockId: null,
    blockType: null,
    blockAttrs: {},
    rootEl: props.rootEl,
  };
});

// --- Active block id for plus/handle buttons ------------------------------
// When a table selection is active, use the table block id. When text is
// selected, use the text block id. Otherwise fall back to the focus block.
const activeBlockId = computed<BlockId | null>(() => {
  const td = tableBridge.value;
  if (td && td.visible) return td.blockId;
  if (props.hoverVisible && props.hoverBlockId) return props.hoverBlockId;
  return props.focusBlockId;
});

// --- Plus / handle button click handlers ----------------------------------
// Reuse BlockEditor's existing onOpenPlusMenu / onOpenSettingsMenu by
// emitting events with the mobile button element as the anchor. PlusMenu and
// BlockSettingsMenu use placeBelow() which auto-pops-up when the anchor is
// near the viewport bottom — perfect for a bottom bar.
const plusBtnEl = ref<HTMLElement | null>(null);
const handleBtnEl = ref<HTMLElement | null>(null);

function onPlusClick(): void {
  const id = activeBlockId.value;
  const anchor = plusBtnEl.value;
  if (!id || !anchor) return;
  emit('openPlusMenu', id, anchor);
}

function onHandleClick(): void {
  const id = activeBlockId.value;
  const anchor = handleBtnEl.value;
  if (!id || !anchor) return;
  emit('openSettingsMenu', id, anchor);
}

// --- Virtual keyboard + safe area -----------------------------------------
// The visualViewport API lets us track the keyboard height. When the soft
// keyboard opens, the visual viewport shrinks; we lift the toolbar to sit
// just above the keyboard so it stays visible and usable.
const keyboardOffset = ref(0);

function onVisualViewportChange(): void {
  const vv = window.visualViewport;
  if (!vv) {
    keyboardOffset.value = 0;
    return;
  }
  // The gap between the layout viewport bottom and the visual viewport
  // bottom is approximately the keyboard height.
  const offset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
  keyboardOffset.value = offset;
}

const toolbarStyle = computed(() => ({
  // Lift the toolbar above the keyboard. env(safe-area-inset-bottom) is
  // handled via CSS padding-bottom so it composes correctly: when the
  // keyboard is open keyboardOffset > 0 and the safe-area padding collapses
  // to ~0 on iOS; when closed keyboardOffset = 0 and the padding provides
  // the home-indicator clearance.
  bottom: `${keyboardOffset.value}px`,
}));

// --- Lifecycle ------------------------------------------------------------

onMounted(() => {
  const vv = window.visualViewport;
  if (vv) {
    vv.addEventListener('resize', onVisualViewportChange);
    vv.addEventListener('scroll', onVisualViewportChange);
    onVisualViewportChange();
  }
});

onBeforeUnmount(() => {
  const vv = window.visualViewport;
  if (vv) {
    vv.removeEventListener('resize', onVisualViewportChange);
    vv.removeEventListener('scroll', onVisualViewportChange);
  }
});
</script>
