<!--
  TopToolbar: a persistent top action bar.

  It is always visible (not limited to mobile mode) and provides:
    1. Plus / handle buttons (left, fixed) — reuse the existing PlusMenu and
       BlockSettingsMenu by emitting events that BlockEditor wires to the
       same onOpenPlusMenu / onOpenSettingsMenu handlers used by the desktop
       block handle.
    2. The full HoverToolbar button set (type / align / verticalAlign / marks /
       color / copy / table operations) — rendered by embedding a single
       <HoverToolbar mobile> instance. The props + handlers come from a
       "descriptor" that is sourced from EITHER:
         - the text-block selection state (passed as props from BlockEditor),
         - the table cell / cell-edit selection state (published by TableBlock
           via the topToolbarBridge injection key).
       This means TopToolbar does NOT duplicate any button or command logic —
       it is purely a different presentation of the same HoverToolbar.
-->

<template>
  <div
    v-if="editable"
    ref="toolbarRoot"
    class="top-toolbar"
    role="toolbar"
    :aria-label="t('hoverToolbar.label')"
    @mousedown.capture="$emit('toolbarInteracting')"
  >
    <!-- Left: plus + handle (fixed, always visible when a focus block exists) -->
    <div class="tt-left">
      <button
        ref="plusBtnEl"
        class="tt-btn tt-plus"
        :class="{ disabled: !activeBlockId, active: plusMenuVisible }"
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
        class="tt-btn tt-handle"
        :class="{ disabled: !activeBlockId, active: settingsMenuVisible }"
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
      class="tt-sep"
    />
    <!-- HoverToolbar (inline mode) — renders ALL contextual buttons.
         v-bind spreads the descriptor (props + onXxx handlers). -->
    <HoverToolbar
      mobile
      v-bind="descriptor"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, inject, watch } from 'vue';
import HoverToolbar from './HoverToolbar.vue';
import { useI18n } from '../../i18n';
import { useEditable, useEditor, topToolbarBridgeKey } from '../context';
import type { TopToolbarDescriptor } from '../context';
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
  // Menu open state — used to show active button style while dropdowns are open.
  plusMenuVisible: boolean;
  settingsMenuVisible: boolean;
}>();

const emit = defineEmits<{
  openPlusMenu: [blockId: BlockId, anchor: HTMLElement];
  openSettingsMenu: [blockId: BlockId, anchor: HTMLElement];
  linkClick: [blockId: BlockId, from: number, to: number];
  hoverClose: [];
  toolbarInteracting: [];
}>();

const { t } = useI18n();
const editable = useEditable();
const editor = useEditor();

// --- Table bridge (table-sourced descriptor) ------------------------------
// TableBlock publishes its toolbar state here. null when no table selection
// / cell-edit is active.
const tableBridge = inject(topToolbarBridgeKey, ref<TopToolbarDescriptor | null>(null));

// --- Active descriptor: table takes priority, then text selection --------
// Cache the last valid text-selection descriptor so that when the browser
// collapses the selection during toolbar interaction (mousedown on a
// button), we can keep the buttons enabled instead of flashing disabled.
const lastTextDescriptor = ref<TopToolbarDescriptor | null>(null);

const descriptor = computed<TopToolbarDescriptor>(() => {
  const td = tableBridge.value;
  if (td && td.visible) {
    // Table descriptor already includes rootEl + all handlers.
    return td;
  }
  // Text-block selection descriptor.
  if (props.hoverVisible) {
    const desc: TopToolbarDescriptor = {
      visible: true,
      selectionRect: props.hoverSelectionRect,
      blockId: props.hoverBlockId,
      blockType: props.hoverBlockType,
      blockAttrs: props.hoverBlockAttrs,
      rootEl: props.rootEl,
      onClose: () => emit('hoverClose'),
      onLinkClick: (blockId: BlockId, from: number, to: number) => emit('linkClick', blockId, from, to),
    };
    lastTextDescriptor.value = desc;
    return desc;
  }
  // Selection was cleared — if we have a cached text descriptor from a
  // recent interaction, reuse it so the buttons stay enabled. The cache
  // is invalidated when the user clicks elsewhere (not on the toolbar).
  if (lastTextDescriptor.value) {
    const cached = lastTextDescriptor.value;
    // Keep the same block context but mark as no-selection for correctness.
    // Still pass the cached selectionRect so HoverToolbar doesn't disable.
    return {
      ...cached,
      visible: true,
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
// emitting events with the top toolbar button element as the anchor.
// PlusMenu and BlockSettingsMenu use placeBelow() which auto-pops-down
// when the anchor is near the viewport top — perfect for a top bar.
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

// Invalidate the cached text descriptor when the focus block changes.
// This prevents stale cached data from showing buttons for a block the
// user has navigated away from.
watch(() => props.focusBlockId, (newId, oldId) => {
  if (newId !== oldId && lastTextDescriptor.value) {
    const cached = lastTextDescriptor.value;
    if (cached.blockId !== newId) {
      lastTextDescriptor.value = null;
    }
  }
});
</script>
