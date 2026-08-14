<!--
  BlockList: renders a list of blocks, recursively including each block's
  children as a nested `<BlockList class="block-children">` container.

  The authoritative nesting structure comes from
  `Block.children` (and `DocState.parent`) — `attrs.indent` is a derived
  shadow kept for backward compatibility with the CSS indent class pipeline.

  Passes hoveredBlockId and focusedBlockId to each BlockHost so handles
  can be shown/hidden correctly. On mouseleave of the entire list, emits
  hoverChange(null) to clear the hover state.

  All props and events are forwarded verbatim to the recursively-rendered
  nested lists so every BlockHost in the entire tree participates in the
  same hover / drag / drop / selection / menu system.
-->

<template>
  <div
    class="block-list"
    :class="{
      'block-children': isNested,
      'drop-indicator-first': showFirstIndicator,
      'drop-indicator-last': showLastIndicator,
    }"
    @mouseleave="onListMouseLeave"
  >
    <template
      v-for="(item, index) in items"
      :key="item.id"
    >
      <BlockHost
        :ref="(el) => setHostRef(item.id, el as InstanceType<typeof BlockHost> | null)"
        :block="item.block"
        :placeholder="!isNested && index === 0 ? firstBlockPlaceholder : undefined"
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
        @focus-in="onFocusIn"
      />
      <!-- Nested children: recursive self-render. -->
      <BlockList
        v-if="item.block.children.length > 0"
        :key="'__nested_' + item.id"
        is-nested
        :items="childRenderItems(item.block)"
        :hovered-block-id="hoveredBlockId"
        :focused-block-id="focusedBlockId"
        :has-text-selection="hasTextSelection"
        :dragging-block-id="draggingBlockId"
        :drop-target-block-id="dropTargetBlockId"
        :drop-position="dropPosition"
        :menu-open-block-id="menuOpenBlockId"
        :blocks-map="blocksMap"
        @open-settings-menu="(id, anchor) => emit('openSettingsMenu', id, anchor)"
        @open-plus-menu="(id, anchor) => emit('openPlusMenu', id, anchor)"
        @slash-trigger="(el, id, query) => emit('slashTrigger', el, id, query)"
        @input-changed="(id, text) => emit('inputChanged', id, text)"
        @hover-change="(id) => emit('hoverChange', id)"
        @grip-pointer-down="(id, x, y, opts) => emit('gripPointerDown', id, x, y, opts)"
        @grip-pointer-up="(id) => emit('gripPointerUp', id)"
        @link-click="(id, offset) => emit('linkClick', id, offset)"
        @focus-in="(id) => emit('focusIn', id)"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import BlockHost from './BlockHost.vue';
import type { Block, BlockId } from '../core/types';
import type { BlockRenderItem } from './context';

type DropPosition = 'before' | 'after' | 'first' | 'last' | 'into';

const props = defineProps<{
  items: readonly BlockRenderItem[];
  /** Readonly Map<BlockId, Block> view of DocState.blocks — used by nested
   *  lists to resolve children block snapshots for the recursive items. */
  blocksMap: ReadonlyMap<BlockId, Block>;
  firstBlockPlaceholder?: string;
  /** `true` for the recursively-rendered nested lists (disables the root-only
   *  drop indicators and the first-block placeholder). */
  isNested?: boolean;
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
  /** 文本块获得光标 / 非文本块获得焦点时冒泡，统一由 BlockEditor 处理。 */
  focusIn: [blockId: BlockId];
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

/** Build the BlockRenderItem[] for a block's nested children. If a child id
 *  has gone missing from blocksMap (should never happen in well-formed state,
 *  but guard anyway) it is simply skipped. */
function childRenderItems(parent: Block): BlockRenderItem[] {
  const out: BlockRenderItem[] = [];
  for (const cid of parent.children) {
    const b = props.blocksMap.get(cid);
    if (b) out.push({ id: cid, block: b });
  }
  return out;
}

const showFirstIndicator = computed(
  () => !props.isNested && !props.dropTargetBlockId && props.dropPosition === 'first' && !!props.draggingBlockId,
);
const showLastIndicator = computed(
  () => !props.isNested && !props.dropTargetBlockId && props.dropPosition === 'last' && !!props.draggingBlockId,
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
  // Only clear hover on mouseleave of the OUTER (non-nested) list — the
  // inner lists' @mouseleave events bubble up but the pointer is still
  // inside the tree; not clearing here avoids a flicker when moving from
  // a parent host into its nested children gutter.
  if (!props.isNested) emit('hoverChange', null);
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

function onFocusIn(blockId: BlockId): void {
  emit('focusIn', blockId);
}

defineExpose({ setBlockHandleDragging });
</script>
