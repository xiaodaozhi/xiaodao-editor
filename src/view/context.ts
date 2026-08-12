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
