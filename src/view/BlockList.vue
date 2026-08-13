<!--
  BlockList: renders the flat list of top-level blocks.

  Passes hoveredBlockId and focusedBlockId to each BlockHost so handles
  can be shown/hidden correctly. On mouseleave of the entire list, emits
  hoverChange(null) to clear the hover state.
-->

<template>
  <div
    class="block-list"
    :class="{
      'drop-indicator-first': showFirstIndicator,
      'drop-indicator-last': showLastIndicator,
    }"
    @mouseleave="onListMouseLeave"
  >
    <BlockHost
      v-for="(item, index) in items"
      :ref="(el) => setHostRef(item.id, el as InstanceType<typeof BlockHost> | null)"
      :key="item.id"
      :block="item.block"
      :placeholder="index === 0 ? firstBlockPlaceholder : undefined"
      :hovered-block-id="hoveredBlockId"
      :focused-block-id="focusedBlockId"
      :has-text-selection="hasTextSelection"
      :dragging-block-id="draggingBlockId"
      :drop-target-block-id="dropTargetBlockId"
      :drop-position="dropPosition"
      :menu-open-block-id="menuOpenBlockId"
      @open-settings-menu="onOpenSettingsMenu"
      @open-plus-menu="onOpenPlusMenu"
      @slash-trigger="onSlashTrigger"
      @input-changed="onInputChanged"
      @hover-change="onHoverChange"
      @grip-pointer-down="onGripPointerDown"
      @grip-pointer-up="onGripPointerUp"
      @link-click="onLinkClick"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import BlockHost from './BlockHost.vue';
import type { BlockRenderItem } from './context';
import type { BlockId } from '../core/types';

type DropPosition = 'before' | 'after' | 'first' | 'last';

const props = defineProps<{
  items: readonly BlockRenderItem[];
  firstBlockPlaceholder?: string;
  hoveredBlockId: BlockId | null;
  focusedBlockId: BlockId | null;
  hasTextSelection?: boolean;
  draggingBlockId?: BlockId | null;
  dropTargetBlockId?: BlockId | null;
  dropPosition?: DropPosition;
  menuOpenBlockId?: BlockId | null;
}>();

const emit = defineEmits<{
  openSettingsMenu: [blockId: BlockId, anchor: HTMLElement];
  openPlusMenu: [blockId: BlockId, anchor: HTMLElement];
  slashTrigger: [el: HTMLElement, blockId: BlockId, query: string];
  inputChanged: [blockId: BlockId, text: string];
  hoverChange: [blockId: BlockId | null];
  gripPointerDown: [blockId: BlockId, startX: number, startY: number, options: { thresholdPx: number }];
  gripPointerUp: [blockId: BlockId];
  linkClick: [blockId: BlockId, offset: number];
}>();

const hostRefs = new Map<BlockId, InstanceType<typeof BlockHost>>();

function setHostRef(id: BlockId, el: InstanceType<typeof BlockHost> | null): void {
  if (el) {
    hostRefs.set(id, el);
  } else {
    hostRefs.delete(id);
  }
}

function setBlockHandleDragging(blockId: BlockId, active: boolean): void {
  hostRefs.get(blockId)?.setHandleDragging?.(active);
}

const showFirstIndicator = computed(
  () => !props.dropTargetBlockId && props.dropPosition === 'first' && !!props.draggingBlockId,
);
const showLastIndicator = computed(
  () => !props.dropTargetBlockId && props.dropPosition === 'last' && !!props.draggingBlockId,
);

function onOpenSettingsMenu(blockId: BlockId, anchor: HTMLElement): void {
  emit('openSettingsMenu', blockId, anchor);
}
function onOpenPlusMenu(blockId: BlockId, anchor: HTMLElement): void {
  emit('openPlusMenu', blockId, anchor);
}
function onSlashTrigger(el: HTMLElement, blockId: BlockId, query: string): void {
  emit('slashTrigger', el, blockId, query);
}
function onInputChanged(blockId: BlockId, text: string): void {
  emit('inputChanged', blockId, text);
}
function onHoverChange(blockId: BlockId | null): void {
  emit('hoverChange', blockId);
}
function onListMouseLeave(): void {
  emit('hoverChange', null);
}

function onGripPointerDown(blockId: BlockId, startX: number, startY: number, options: { thresholdPx: number }): void {
  emit('gripPointerDown', blockId, startX, startY, options);
}

function onGripPointerUp(blockId: BlockId): void {
  emit('gripPointerUp', blockId);
}

function onLinkClick(blockId: BlockId, offset: number): void {
  emit('linkClick', blockId, offset);
}

defineExpose({ setBlockHandleDragging });
</script>
