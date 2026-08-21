<!--
  FixedToolbar: a persistent action bar pinned to either the top or bottom
  of the editor viewport.

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
           via the fixedToolbarBridge injection key).
       This means FixedToolbar does NOT duplicate any button or command logic —
       it is purely a different presentation of the same HoverToolbar.

  Position:
    - `position="top"` (default on desktop): bar sits at the top of the
      editor; dropdowns pop downward.
    - `position="bottom"` (default on mobile): bar sits at the bottom of the
      editor; dropdowns pop upward.
    - The prop lets a caller override the auto-detected default.
-->

<template>
  <div
    v-if="editable"
    ref="toolbarRoot"
    class="fixed-toolbar"
    :class="{ 'fixed-toolbar--bottom': isBottom }"
    role="toolbar"
    :aria-label="t('hoverToolbar.label')"
    @mousedown.prevent.capture="onRootMouseDownCapture"
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
         v-bind spreads the descriptor (props + onXxx handlers).
         @interacting arms BlockEditor's 500ms selection grace period even
         for Teleported dropdown content (whose clicks don't bubble through
         FixedToolbar's @mousedown.capture root listener). -->
    <HoverToolbar
      mobile
      v-bind="descriptor"
      @interacting="emit('toolbarInteracting')"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, inject, watch, provide } from 'vue';
import HoverToolbar from './HoverToolbar.vue';
import { useI18n } from '../../i18n';
import { useEditable, useEditor, fixedToolbarBridgeKey, mobileKey, fixedToolbarBottomKey } from '../context';
import type { FixedToolbarDescriptor } from '../context';
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
  /** Toolbar placement: 'top' or 'bottom'. When omitted, auto-detected:
   *  'bottom' on mobile, 'top' on desktop. */
  position?: 'top' | 'bottom';
}>();

const emit = defineEmits<{
  openPlusMenu: [blockId: BlockId, anchor: HTMLElement];
  openSettingsMenu: [blockId: BlockId, anchor: HTMLElement];
  linkClick: [blockId: BlockId, from: number, to: number];
  hoverClose: [];
  toolbarInteracting: [];
}>();

function onRootMouseDownCapture(_: MouseEvent) {
  emit('toolbarInteracting');
}

const { t } = useI18n();
const editable = useEditable();
const editor = useEditor();

// --- Toolbar position (top / bottom) -------------------------------------
// Auto-detect default from isMobile when prop is omitted.
const isMobile = inject(mobileKey, ref(false));
const isBottom = computed(() => {
  if (props.position === 'top') return false;
  if (props.position === 'bottom') return true;
  // Default: mobile → bottom, desktop → top.
  return isMobile.value;
});
// Provide the bottom flag so PlusMenu / BlockSettingsMenu / HoverToolbar
// know which direction to pop their dropdowns.
provide(fixedToolbarBottomKey, isBottom);

// --- Table bridge (table-sourced descriptor) ------------------------------
// TableBlock publishes its toolbar state here. null when no table selection
// / cell-edit is active.
const tableBridge = inject(fixedToolbarBridgeKey, ref<FixedToolbarDescriptor | null>(null));

// --- Active descriptor: table takes priority, then text selection --------
// Cache the last valid text-selection descriptor so that when the browser
// collapses the selection during toolbar interaction (mousedown on a
// button), we can keep the buttons enabled instead of flashing disabled.
// The cache is updated via a watch (not inside the computed) to avoid side
// effects in the computed getter.
const lastTextDescriptor = ref<FixedToolbarDescriptor | null>(null);

// Update the text-descriptor cache synchronously when a text selection is
// active (and no table descriptor takes priority). flush:'sync' ensures the
// cache is up to date before the `descriptor` computed re-evaluates.
//
// Climb from a DOM node to the nearest .block-content contained by the
// editor root. Extracted out of the lazy-clear callback so it's only
// created once per component instead of fresh on every watch fire.
const findBlockContentEl = (node: Node | null | undefined): HTMLElement | null => {
  if (!node) return null;
  const el: HTMLElement | null = (node.nodeType === 1
    ? node as HTMLElement
    : node.parentElement) as HTMLElement | null;
  if (!el) return null;
  const ce = el.closest<HTMLElement>('.block-content');
  if (ce && (props.rootEl?.contains(ce) ?? false)) return ce;
  return null;
};

// Lazy-clear callback for lastTextDescriptor. Re-schedules itself every
// 1500ms as long as a valid non-collapsed DOM text selection still exists
// inside the editor root — this way a user holding a toolbar button down
// (no selectionchange events, no POSITIVE-FILL refresh) won't have the
// cache wiped from under them mid-hold.
let lazyClearTimer: ReturnType<typeof setTimeout> | null = null;
const maybeClearCache = () => {
  if (!lastTextDescriptor.value) {
    lazyClearTimer = null;
    return;
  }
  try {
    const s = window.getSelection();
    if (s && s.rangeCount > 0) {
      const r = s.getRangeAt(0);
      if (!r.collapsed) {
        // Check all four "selection endpoints" — some browsers shift
        // anchor/focus around button interactions even though the logical
        // range is still inside content, and forward vs reverse selections
        // can put different nodes in anchor vs focus. startContainer +
        // endContainer cover the range boundaries themselves (independent
        // of direction).
        const alive = [s.anchorNode, s.focusNode, r.startContainer, r.endContainer]
          .some((n) => findBlockContentEl(n) !== null);
        if (alive) {
          lazyClearTimer = setTimeout(maybeClearCache, 1500);
          return;
        }
      }
    }
  } catch {
    // Selection API occasionally throws in edge cases (cross-origin iframes,
    // detached DOM, etc.). Treat as "no valid selection" and proceed to
    // clear the cache — worst case the toolbar briefly disables until the
    // next POSITIVE-FILL from a real selectionchange.
  }
  lastTextDescriptor.value = null;
  lazyClearTimer = null;
};

// Defensive guards:
//  1. Never overwrite a VALID cached descriptor with a broken one where
//     hoverVisible=true but selectionRect is null. That transient state
//     sometimes appears during command apply → DOM rewrite cycles and
//     would cause Priority-3 fallback to also run with a null rect =
//     marksDisabled=true (the "整体禁用" bug).
//  2. When hoverVisible drops to false, don't clear the cache immediately
//     because the 500ms toolbarInteracting grace period usually protects
//     the selection state. Instead, start a short lazy-clear timer so the
//     cache survives typical command-apply windows (~20–200ms) but is still
//     cleaned up within a couple seconds of the user actually moving away.
watch(
  [
    tableBridge,
    () => props.hoverVisible,
    () => props.hoverSelectionRect,
    // CRITICAL FIX: hoverBlockId / hoverBlockType / hoverBlockAttrs are set
    // SEPARATELY from hoverVisible inside BlockEditor's POSITIVE-FILL path.
    // Without listing them here, Vue fires the watch when visible=true but
    // the other three are still stale (null / heading from a previous block),
    // so the cache ends up with blockId=null + blockType=heading even though
    // POSITIVE-FILL is about to set them to the real values. This caused the
    // type dropdown to flash "一级标题" and, when combined with LAZY-CLEAR,
    // locked the toolbar into the Priority-4 disabled fallback.
    () => props.hoverBlockId,
    () => props.hoverBlockType,
    () => props.hoverBlockAttrs,
  ],
  () => {
    const td = tableBridge.value;
    if (td && td.visible) return; // table takes priority, don't cache text
    if (props.hoverVisible) {
      // Cancel any pending lazy clear — selection came back.
      if (lazyClearTimer) {
        clearTimeout(lazyClearTimer);
        lazyClearTimer = null;
      }
      // Guard #1: if selectionRect is null, keep previous valid cache.
      if (props.hoverSelectionRect === null) return;
      // Guard #1.5: all four "identity" props must be non-null / non-empty
      // before we overwrite the cache. POSITIVE-FILL assigns them one by one
      // (visible → rect → blockId → blockType → attrs) and each assignment
      // triggers this watch independently (because of flush:'sync'). By
      // refusing to write until blockId and blockType have arrived from the
      // POSITIVE-FILL, we guarantee the cache never contains a mixture of
      // new visible + stale identity props.
      if (props.hoverBlockId === null || props.hoverBlockType === null) {
        return;
      }
      lastTextDescriptor.value = {
        visible: true,
        selectionRect: props.hoverSelectionRect,
        blockId: props.hoverBlockId,
        blockType: props.hoverBlockType,
        blockAttrs: props.hoverBlockAttrs,
        rootEl: props.rootEl,
        onClose: () => emit('hoverClose'),
        onLinkClick: (blockId: BlockId, from: number, to: number) => emit('linkClick', blockId, from, to),
      };
    } else {
      // Guard #2: lazy-clear after 1.5s so command-apply teardown never
      // empties the cache synchronously.
      if (lastTextDescriptor.value && !lazyClearTimer) {
        lazyClearTimer = setTimeout(maybeClearCache, 1500);
      }
    }
  },
  { immediate: true, flush: 'sync' },
);

const descriptor = computed<FixedToolbarDescriptor>(() => {
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
// emitting events with the fixed toolbar button element as the anchor.
// PlusMenu and BlockSettingsMenu use placeBelow()/placeAbove() which
// auto-pops-down/up based on the anchor's viewport position.
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
// NOTE: When newId is null (focus temporarily lost, e.g. clicking toolbar),
// we KEEP the cache so selection-based toolbar buttons don't flash disabled.
watch(() => props.focusBlockId, (newId, oldId) => {
  if (newId !== oldId && lastTextDescriptor.value) {
    const cached = lastTextDescriptor.value;
    if (newId !== null && cached.blockId !== newId) {
      lastTextDescriptor.value = null;
    }
  }
});
</script>
