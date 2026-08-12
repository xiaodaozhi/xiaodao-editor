<!--
  BlockHost: resolves the renderer component for a block type and renders it.

  Responsibilities:
    1. Render the BlockHandle to the LEFT of the block content.
       Handle visibility is controlled by props:
         - Show if THIS block is hovered, OR
         - Show if NO block is hovered AND this block has focus.
    2. Delegate to the extension-registered renderer (or BlockContent fallback).
    3. Forward events from the renderer (slashTrigger, inputChanged) and the
       handle (openMenu, gripPointerDown/Up) up to BlockEditor via emits.
-->

<template>
  <div
    ref="hostEl"
    class="block-host"
    :data-block-type="block.type"
    :class="{
      'block-dragging': isDragging,
      'block-menu-active': menuActive,
      'block-drop-target': isDropTarget,
      'block-drop-before': isDropTarget && dropPos === 'before',
      'block-drop-after': isDropTarget && dropPos === 'after',
    }"
    @mouseenter="onHover"
  >
    <BlockHandle
      ref="handleRef"
      :block-id="block.id"
      :visible="showHandle"
      @open-plus-menu="onOpenPlusMenu"
      @open-settings-menu="onOpenSettingsMenu"
      @grip-pointer-down="onGripPointerDown"
      @grip-pointer-up="onGripPointerUp"
    />
    <div class="block-host-content">
      <component
        :is="resolvedComponent"
        :block="block"
        :placeholder="placeholder"
        @slash-trigger="onSlashTrigger"
        @input-changed="onInputChanged"
        @link-click="onLinkClick"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, type Component } from 'vue';
import type { Block, BlockId } from '../core/types';
import { useEditor, useEditable } from './context';
import BlockContent from './BlockContent.vue';
import BlockHandle from './ui/BlockHandle.vue';

type DropPosition = 'before' | 'after' | 'first' | 'last';

const props = defineProps<{
  block: Block;
  placeholder?: string;
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
  hoverChange: [blockId: BlockId];
  gripPointerDown: [blockId: BlockId, startX: number, startY: number, options: { thresholdPx: number }];
  gripPointerUp: [blockId: BlockId];
  linkClick: [blockId: BlockId, offset: number];
}>();

const editor = useEditor();
const editable = useEditable();
const hostEl = ref<HTMLElement | null>(null);
const handleRef = ref<InstanceType<typeof BlockHandle> | null>(null);

const showHandle = computed(() => {
  // Read-only mode: never show the plus/insert or grip handle buttons.
  if (!editable.value) return false;
  if (props.hasTextSelection) return false;
  if (props.hoveredBlockId === props.block.id) return true;
  if (props.hoveredBlockId === null && props.focusedBlockId === props.block.id) return true;
  return false;
});

const isDragging = computed(() => props.draggingBlockId === props.block.id);
const menuActive = computed(() => props.menuOpenBlockId === props.block.id);
const isDropTarget = computed(() => props.dropTargetBlockId === props.block.id);
const dropPos = computed(() => props.dropPosition ?? 'after');

function onGripPointerDown(blockId: BlockId, startX: number, startY: number, options: { thresholdPx: number }): void {
  emit('gripPointerDown', blockId, startX, startY, options);
}

function onGripPointerUp(blockId: BlockId): void {
  emit('gripPointerUp', blockId);
}

function setHandleDragging(active: boolean): void {
  handleRef.value?.setLocalDragging?.(active);
}

function onHover(): void {
  emit('hoverChange', props.block.id);
}

function onOpenPlusMenu(anchor: HTMLElement): void {
  emit('openPlusMenu', props.block.id, anchor);
}
function onOpenSettingsMenu(anchor: HTMLElement): void {
  emit('openSettingsMenu', props.block.id, anchor);
}
function onSlashTrigger(el: HTMLElement, _blockId: BlockId, query: string): void {
  emit('slashTrigger', el, props.block.id, query);
}
function onInputChanged(id: BlockId, text: string): void {
  emit('inputChanged', id, text);
}
function onLinkClick(blockId: BlockId, offset: number): void {
  emit('linkClick', blockId, offset);
}

const resolvedComponent = computed<Component>(() => {
  const spec = editor.registries.renderers.get(props.block.type);
  if (spec?.component) {
    return spec.component as Component;
  }
  return BlockContent;
});

defineExpose({ setHandleDragging });
</script>
