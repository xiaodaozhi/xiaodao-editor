/**
 * View-layer shared context and types.
 *
 * - `editorKey` / `useEditor`: provides the framework-agnostic `Editor`
 *   instance to child components (BlockHost, BlockContent, …) via Vue's
 *   provide/inject. The editor is provided as a non-reactive value —
 *   components that need to react to state changes subscribe via
 *   `editor.subscribe()` instead of relying on Vue reactivity. This keeps
 *   the editor's internal state outside Vue's reactivity system, avoiding
 *   deep reactivity overhead on large documents.
 *
 * - `BlockRenderItem`: the DTO passed from `BlockEditor` to `BlockList`.
 *   Defined here (rather than in a `.vue` file) because TypeScript's `*.vue`
 *   module shim only declares a default export, making named type re-exports
 *   from `.vue` files impossible.
 */

import type { InjectionKey, Ref } from 'vue';
import { inject, ref } from 'vue';
import type { Editor } from '../core/Editor';
import type { Block, BlockId } from '../core/types';

/**
 * Injection key for the reactive `isMobile` flag. Provided by BlockEditor so
 * child components (TableBlock, FixedToolbar, …) can adapt their rendering
 * for touch devices. Uses `(pointer: coarse)` matchMedia — matches iOS /
 * iPadOS / Android browsers.
 */
export const mobileKey: InjectionKey<Ref<boolean>> = Symbol('block-editor-mobile');

/**
 * A bag of props + event handlers that fully describes what the
 * FixedToolbar should render inside its embedded HoverToolbar. Produced by
 * whichever context currently owns the selection (text-block selection in
 * BlockEditor, or table cell / cell-edit selection in TableBlock) and
 * consumed by FixedToolbar which spreads it onto `<HoverToolbar mobile>`.
 *
 * This is the reuse mechanism: instead of duplicating HoverToolbar's buttons
 * and logic, the source context builds the exact same prop/handler bag it
 * would normally pass to a floating HoverToolbar, and hands it to the
 * FixedToolbar via the bridge so a SINGLE HoverToolbar instance (in inline
 * mode) renders the buttons.
 */
export interface FixedToolbarDescriptor {
  visible: boolean;
  selectionRect: DOMRect | null;
  blockId: BlockId | null;
  blockType: string | null;
  blockAttrs: Readonly<Record<string, unknown>>;
  rootEl: HTMLElement | null;
  tableMode?: boolean;
  cellEditMode?: boolean;
  tableActiveMarks?: Set<string>;
  tableActiveColor?: string;
  tableActiveBgColor?: string;
  tableActiveVerticalAlign?: string;
  showDelete?: boolean;
  deleteLabel?: string;
  deleteIcon?: string;
  showMerge?: boolean;
  showSplit?: boolean;
  showHeaderRow?: boolean;
  headerRowActive?: boolean;
  // Event handlers (Vue maps emits to onXxx props).
  onClose?: () => void;
  onLinkClick?: (blockId: BlockId, from: number, to: number) => void;
  onDelete?: () => void;
  onMerge?: () => void;
  onSplit?: () => void;
  onTableHeaderRow?: () => void;
  onTableType?: (cellType: string) => void;
  onTableAlign?: (align: string) => void;
  onTableVerticalAlign?: (verticalAlign: string) => void;
  onTableMark?: (markType: string) => void;
  onTableTextColor?: (color: string | null) => void;
  onTableBgColor?: (color: string | null) => void;
  onTableCopy?: () => void;
}

/**
 * Injection key for the fixed-toolbar bridge — a reactive ref holding the
 * **table-sourced** descriptor (or null). BlockEditor provides it; TableBlock
 * injects it and publishes its toolbar state when running with a fixed
 * toolbar. The text-block descriptor is computed directly inside
 * FixedToolbar from BlockEditor's hoverToolbar state (no bridge needed for
 * that path).
 */
export const fixedToolbarBridgeKey: InjectionKey<Ref<FixedToolbarDescriptor | null>> = Symbol('block-editor-fixed-toolbar-bridge');

/**
 * Injection key for a reactive flag indicating whether the FixedToolbar is
 * currently placed at the bottom of the editor. Provided by FixedToolbar;
 * consumed by PlusMenu / BlockSettingsMenu / HoverToolbar to decide which
 * direction dropdowns should pop (upward when the bar is at the bottom).
 */
export const fixedToolbarBottomKey: InjectionKey<Ref<boolean>> = Symbol('block-editor-fixed-toolbar-bottom');

export const editorKey: InjectionKey<Editor> = Symbol('block-editor');

/**
 * Injection key for the reactive `editable` flag. Provided by BlockEditor
 * so child components (BlockContent, TableBlock, …) can reactively bind
 * `contenteditable` and gate editing actions. Unlike `editorKey` (which is
 * non-reactive), this is a Vue `Ref<boolean>` so changes propagate
 * immediately through the component tree.
 */
export const editableKey: InjectionKey<Ref<boolean>> = Symbol('block-editor-editable');

/**
 * Injection key for image upload helper function. Provided by BlockEditor
 * so child components (slash menu, image block, block-list drop handler)
 * can initiate an image upload against the correct upload target block,
 * with proper transient state management and document updating.
 *
 * The callback returns the BlockId of the NEW (or existing) image block so
 * the caller can set focus / selection if needed.
 */
export type BeginImageUploadFn = (
  fileOrSrc: File | string,
  opts?: {
    /** If provided, insert image block relative to this block id. */
    relativeToBlockId?: BlockId | null;
    /** 'after' (default) | 'before' | 'replace' the target block. */
    position?: 'after' | 'before' | 'replace';
    /** If provided and the target block is empty, convert it instead of inserting. */
    convertIfEmpty?: boolean;
  },
) => Promise<BlockId | null>;

export const imageUploadKey: InjectionKey<BeginImageUploadFn> = Symbol('block-editor-image-upload');

/**
 * A flat render item: the block id plus the block snapshot. The id is
 * redundant with `block.id` but is carried separately so `BlockList` can
 * use it as a `:key` without reaching into the block object.
 */
export interface BlockRenderItem {
  readonly id: BlockId;
  readonly block: Block;
}

/**
 * Access the editor instance. Must be called within a component tree that
 * contains a `<BlockEditor>`.
 */
export function useEditor(): Editor {
  const editor = inject(editorKey);
  if (!editor) {
    throw new Error('useEditor(): must be called within a <BlockEditor> component tree');
  }
  return editor;
}

/**
 * Access the image upload starter helper. Returns `null` if not provided.
 */
export function useBeginImageUpload(): BeginImageUploadFn | null {
  return inject(imageUploadKey, null);
}

/**
 * Access the reactive `editable` flag. Returns a ref that is `true` when
 * the editor is in editing mode, `false` when read-only. Must be called
 * within a component tree that contains a `<BlockEditor>`.
 */
export function useEditable(): Ref<boolean> {
  const editable = inject(editableKey);
  // Fallback: if somehow used outside a BlockEditor, default to editable.
  return editable ?? ref(true);
}
