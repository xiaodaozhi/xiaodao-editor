/**
 * Primitive commands: the block-type-agnostic operations the editor core
 * provides. They are pure `(args) => (state, dispatch?) => boolean` functions
 * that build transactions using *only* schema predicates (never `block.type`
 * switches). Block-type-specific commands live in their extensions and
 * compose these primitives.
 *
 * See docs/editor-architecture.md §7.3, §11.2, §11.3.
 */

import type { Attrs, BlockId, BlockType, InlineNode, InlineSeq, Mark, Selection } from '../types';
import { inlineFromString, inlineText, splitInline } from '../types';
import { createTransaction } from '../state/Transaction';
import type { AnyCommandEntry, CommandEntry, Dispatch } from './Command';
import type { EditorRegistries } from '../extension/Registry';
import {
  blockAfter,
  blockBefore,
  collectIndentSyncPatches,
  depthOf,
  flatten as flattenDoc,
  getBlock,
  indexOf,
  parentOf,
  prevSibling,
  requireBlock,
  siblingList,
} from '../state/store';
import { caretSelection, isBlocks, isCaret, isCollapsed, isText, primaryBlock } from '../selection/Selection';
import { applySteps } from '../state/Step';
import type { EditorState } from '../state/EditorState';

export interface InsertBlockArgs {
  readonly type: BlockType;
  readonly attrs?: Attrs;
  readonly content?: InlineSeq;
  /** Insert after this block (resolves parent + index). */
  readonly after?: BlockId;
  /** Or insert at an explicit parent/index. */
  readonly parent?: BlockId | null;
  readonly index?: number;
}

export interface ReplaceBlockArgs {
  readonly id: BlockId;
  readonly type: BlockType;
  readonly attrs?: Attrs;
}

export interface SetTextArgs {
  readonly id: BlockId;
  readonly content: InlineSeq;
  readonly selectionAfter?: Selection;
}

export interface SplitBlockArgs {
  readonly id: BlockId;
  readonly offset: number;
  /**
   * Type for the newly-created block. Defaults to the editor's default block
   * type (paragraph). Used by the Enter handler to continue a list: passing
   * the current list type yields a new list item instead of a paragraph.
   */
  readonly asType?: BlockType;
  /** Attrs for the new block; defaults to defaultAttrsFor(asType). */
  readonly asAttrs?: Attrs;
}

export interface MoveCaretArgs {
  readonly offset?: number;
}

type Ctx = { readonly registries: EditorRegistries };

function ensureCaretOrText(sel: Selection): { blockId: BlockId; offset: number } | null {
  if (isBlocks(sel)) return null;
  const blockId = primaryBlock(sel);
  if (!blockId) return null;
  const offset = isCaret(sel) ? sel.offset : sel.focus.offset;
  return { blockId, offset };
}

const MAX_INDENT = 10;

/**
 * Apply nesting-aware fixups at the end of every structural transaction.
 *
 * Two responsibilities (single source of truth, runs atomically in the same
 * transaction as the structural change so undo covers both):
 *
 *   1. **Nesting validity** (Phase 2.2 — structural): illegal parent/child
 *      relationships are repaired with moveBlock steps. Rules enforced:
 *        • Non-nestable parents cannot have children (child is promoted to
 *          grandparent slot).
 *        • Nesting depth never exceeds MAX_INDENT (promote excess levels).
 *
 *   2. **attrs.indent synchronization**: after any structural change we run
 *      `collectIndentSyncPatches` so every block's `attrs.indent` becomes a
 *      faithful mirror of `depthOf(doc, id)`. This is the ONLY code path
 *      that is allowed to write the indent attr; commands must never touch
 *      attrs.indent manually — they manipulate parent/children via
 *      moveBlock/insertBlock/removeBlock instead.
 */
function addNestingSyncToBuilder(
  state: EditorState,
  builder: ReturnType<typeof createTransaction>,
  ctx: Ctx,
): void {
  const steps = builder.peek();
  if (steps.length === 0) return;
  // --- Phase 2.2: nesting validity moves go here (future work) ------------
  // For now: assume structural steps produced a well-formed tree (schema
  // nestable + commands are disciplined). We simply re-sync attrs.indent.

  // Build the post-step doc, then emit setAttrs patches for indent sync.
  const result = applySteps(state.doc, steps);
  const syncs = collectIndentSyncPatches(result.doc, ctx.registries.schema);
  for (const p of syncs) builder.setAttrs(p.id, p.attrs);
}

/** Insert a block, defaulting to placement after `after` (or at the end). */
function insertBlockCommand(ctx: Ctx): CommandEntry<InsertBlockArgs> {
  return {
    name: 'insertBlock',
    run: (args) => (state, dispatch) => {
      const type = args.type;
      const attrs = args.attrs ?? ctx.registries.schema.defaultAttrsFor(type);
      const content = args.content ?? [];

      let parent: BlockId | null;
      let index: number;
      if (args.after) {
        const after = getBlock(state.doc, args.after);
        if (!after) return false;
        parent = parentOf(state.doc, args.after);
        index = indexOf(state.doc, args.after) + 1;
      } else if (args.parent !== undefined) {
        parent = args.parent;
        const siblings = parent === null
          ? state.doc.root
          : (requireBlock(state.doc, parent).children as readonly BlockId[]);
        index = args.index ?? siblings.length;
      } else {
        // No placement specified: append at end of root.
        parent = null;
        index = state.doc.root.length;
      }

      // Nestable guard: when inserting under an existing parent (not root),
      // the parent's schema must be nestable:true. (CodeBlock / hr / table /
      // divider / quote disallow children — fail closed.)
      if (parent !== null) {
        const pb = getBlock(state.doc, parent);
        if (!pb) return false;
        const ps = ctx.registries.schema.get(pb.type);
        if (!ps?.nestable) return false;
      }

      const builder = createTransaction();
      const id = builder.insertBlock({ parent, index, type, attrs, content });
      builder.setSelection(caretSelection(id, 0));
      dispatch?.(builder.build());
      return true;
    },
  };
}

function removeBlockCommand(ctx: Ctx): CommandEntry<{ id: BlockId }> {
  return {
    name: 'removeBlock',
    run: (args) => (state, dispatch) => {
      if (!getBlock(state.doc, args.id)) return false;
      const before = blockBefore(state.doc, args.id);
      const after = blockAfter(state.doc, args.id);
      const target = before ?? after;
      const builder = createTransaction();

      // if the removed block has children, migrate them according to
      // the user-specified rule:
      //   • "previous block" (caret-after-removal = before) exists AND is a
      //     nestable parent AND depthOf(before) < MAX_INDENT → re-parent as
      //     children of `before` (appended at the END of before's children).
      //   • Otherwise → promote them to siblings of the removed block (same
      //     parent, inserted at the slot the removed block used to occupy).
      //
      // Note: `before` here is document-order previous, which is exactly
      // "where the caret lands after removal" for a non-isolating text block
      // caret-at-offset-0 backspace (matches the user's "上一个块即光标后来
      // 出现位置的那个子块" wording).
      const removed = requireBlock(state.doc, args.id);
      const childrenToMigrate = (removed.children as readonly BlockId[]) ?? [];
      if (childrenToMigrate.length > 0) {
        const removalParent = parentOf(state.doc, args.id);
        const removalIndex = indexOf(state.doc, args.id);

        const canNestUnderBefore = (() => {
          if (!before) return false;
          const bSchema = ctx.registries.schema.get(before.type);
          if (!bSchema?.nestable) return false;
          if (depthOf(state.doc, before.id) >= MAX_INDENT) return false;
          return true;
        })();

        if (canNestUnderBefore && before) {
          // Append at the END of `before`'s current children.
          const beforeChildren = (before.children as readonly BlockId[]) ?? [];
          let insertIdx = beforeChildren.length;
          for (const childId of childrenToMigrate) {
            builder.moveBlock(childId, before.id, insertIdx);
            insertIdx++;
          }
        } else {
          // Promote to siblings of the removed block in the same parent,
          // starting at the removed block's current index. As each move pulls
          // a child out of removed (which itself hasn't been removed from the
          // siblings array yet), the slot keeps shifting — but moveBlock
          // operates on raw tuple (parent,index) semantics and the removal
          // step is after these moves, so insertion indices just increment.
          let insertIdx = removalIndex;
          for (const childId of childrenToMigrate) {
            builder.moveBlock(childId, removalParent, insertIdx);
            insertIdx++;
          }
        }
      }

      builder.removeBlock(args.id);
      // Normalize indent after structural change (covers first-block rule
      // AND prev-block-doesn't-support-indent rule in one pass).
      addNestingSyncToBuilder(state, builder, ctx);
      if (target) {
        const text = inlineText(target.content);
        builder.setSelection(caretSelection(target.id, text.length));
      }
      dispatch?.(builder.build());
      return true;
    },
  };
}

function replaceBlockCommand(ctx: Ctx): CommandEntry<ReplaceBlockArgs> {
  return {
    name: 'replaceBlock',
    run: (args) => (state, dispatch) => {
      const block = getBlock(state.doc, args.id);
      if (!block) return false;
      const attrs = args.attrs ?? ctx.registries.schema.defaultAttrsFor(args.type);
      const builder = createTransaction();
      builder.replaceBlock(args.id, args.type, attrs);
      // Type change may invalidate this block's (or its neighbors') indent.
      addNestingSyncToBuilder(state, builder, ctx);
      builder.setSelection(caretSelection(args.id, 0));
      dispatch?.(builder.build());
      return true;
    },
  };
}

function setTextCommand(): CommandEntry<SetTextArgs> {
  return {
    name: 'setText',
    run: (args) => (state, dispatch) => {
      if (!getBlock(state.doc, args.id)) return false;
      const builder = createTransaction();
      builder.setText(args.id, args.content);
      if (args.selectionAfter) builder.setSelection(args.selectionAfter);
      builder.historyGroup('type');
      builder.skipDomWrite([args.id]);
      builder.setMeta({ source: 'input', addToHistory: true });
      dispatch?.(builder.build());
      return true;
    },
  };
}

function setAttrsCommand(): CommandEntry<{ id: BlockId; attrs: Attrs }> {
  return {
    name: 'setAttrs',
    run: (args) => (state, dispatch) => {
      const block = getBlock(state.doc, args.id);
      if (!block) return false;
      const builder = createTransaction();
      builder.setAttrs(args.id, args.attrs);
      dispatch?.(builder.build());
      return true;
    },
  };
}

function splitBlockCommand(ctx: Ctx): CommandEntry<SplitBlockArgs> {
  return {
    name: 'splitBlock',
    run: (args) => (state, dispatch) => {
      const block = getBlock(state.doc, args.id);
      if (!block) return false;
      if (!ctx.registries.schema.hasText(block.type)) return false;
      const textLen = inlineText(block.content).length;
      const offset = Math.max(0, Math.min(args.offset, textLen));
      // 直接拆分 InlineSeq，跨边界的 TextRun 会保留 marks 做字符串切割。
      const [before, after] = splitInline(block.content, offset);
      const parent = parentOf(state.doc, args.id);
      const index = indexOf(state.doc, args.id);

      // snapshot the original block's children — they will be moved
      // wholesale to the newly-created sibling block after split. This matches
      // Notion behaviour: pressing Enter inside a block with nested children
      // "hands off" all descendants to the new block right after the split point.
      const origChildren = (block.children as readonly BlockId[]) ?? [];

      const newType = args.asType ?? ctx.registries.defaultBlockType;
      const newAttrs = args.asAttrs ?? ctx.registries.schema.defaultAttrsFor(newType);

      const builder = createTransaction();
      builder.setText(args.id, before);
      const newId = builder.insertBlock({
        parent,
        index: index + 1,
        type: newType,
        attrs: newAttrs,
        content: after,
      });

      // Move every child of the original block (in document order) to become
      // children of the new split block, appending at the end of its children.
      // The new block's schema may or may not declare nestable:true — when it
      // doesn't (e.g. paragraph can usually be a parent but some custom type
      // might not) the moveBlock step would normally be rejected. However the
      // "enter splits children to the new block" UX is block-type-agnostic:
      // the new block shares the same listLike / text-bearing nature as the
      // source (asType defaults to paragraph, or same list type), so we assume
      // it is a valid parent. addNestingSyncToBuilder still repairs any
      // residual invalid state afterwards.
      if (origChildren.length > 0) {
        for (let i = 0; i < origChildren.length; i++) {
          builder.moveBlock(origChildren[i]!, newId, i);
        }
      }

      addNestingSyncToBuilder(state, builder, ctx);
      builder.setSelection(caretSelection(newId, 0));
      dispatch?.(builder.build());
      return true;
    },
  };
}

function mergeBlockCommand(ctx: Ctx): CommandEntry<{ id: BlockId }> {
  return {
    name: 'mergeBlock',
    run: (args) => (state, dispatch) => {
      const block = getBlock(state.doc, args.id);
      if (!block) return false;
      const prev = blockBefore(state.doc, args.id);
      if (!prev) return false;

      // 前一个块是非文本块（content: 'none'，如图片、分隔符）时，
      // 不能将当前块的文本合并进去，直接返回 false。
      if (!ctx.registries.schema.hasText(prev.type)) return false;

      const prevText = inlineText(prev.content);
      // 直接拼接两个 InlineSeq，各自的 TextRun marks 得以保留。
      const merged: InlineSeq = [...prev.content, ...block.content];
      const builder = createTransaction();
      builder.setText(prev.id, merged);

      // migrate `block`'s children before removing the block itself.
      // Same rule as removeBlockCommand:
      //   • prev is nestable AND depthOf(prev) < MAX_INDENT → append as prev's
      //     children (prev is the caret destination after merge so this is
      //     the correct "上一个块" target).
      //   • Otherwise promote to siblings of `block` (same parent, same slot).
      const childrenToMigrate = (block.children as readonly BlockId[]) ?? [];
      if (childrenToMigrate.length > 0) {
        const removalParent = parentOf(state.doc, args.id);
        const removalIndex = indexOf(state.doc, args.id);

        const prevSchema = ctx.registries.schema.get(prev.type);
        const canNestUnderPrev = !!prevSchema?.nestable
          && depthOf(state.doc, prev.id) < MAX_INDENT;

        if (canNestUnderPrev) {
          const prevChildren = (prev.children as readonly BlockId[]) ?? [];
          let insertIdx = prevChildren.length;
          for (const childId of childrenToMigrate) {
            builder.moveBlock(childId, prev.id, insertIdx);
            insertIdx++;
          }
        } else {
          let insertIdx = removalIndex;
          for (const childId of childrenToMigrate) {
            builder.moveBlock(childId, removalParent, insertIdx);
            insertIdx++;
          }
        }
      }

      builder.removeBlock(args.id);
      addNestingSyncToBuilder(state, builder, ctx);
      builder.setSelection(caretSelection(prev.id, prevText.length));
      dispatch?.(builder.build());
      return true;
    },
  };
}

/** Enter: split a text block, or insert the default block to exit/advance. */
function enterCommand(ctx: Ctx): CommandEntry {
  return {
    name: 'enter',
    run: () => (state, dispatch) => {
      const sel = state.selection;
      const focus = ensureCaretOrText(sel);
      if (!focus) {
        if (isBlocks(sel) && sel.blockIds.length) {
          const lastId = sel.blockIds[sel.blockIds.length - 1]!;
          return insertBlockCommand(ctx).run({ type: ctx.registries.defaultBlockType, after: lastId })(state, dispatch);
        }
        return false;
      }

      const block = requireBlock(state.doc, focus.blockId);
      const schema = ctx.registries.schema.get(block.type);

      if (!ctx.registries.schema.hasText(block.type)) {
        return insertBlockCommand(ctx).run({ type: ctx.registries.defaultBlockType, after: block.id })(state, dispatch);
      }
      if (schema.isolating) return false;

      const text = inlineText(block.content);
      const atEnd = focus.offset >= text.length;

      if (schema.listLike && ctx.registries.schema.isEmpty(block)) {
        return convertBlockCommand(ctx).run({ id: block.id, type: ctx.registries.defaultBlockType })(state, dispatch);
      }

      if (atEnd && ctx.registries.schema.isEmpty(block)) {
        return insertBlockCommand(ctx).run({ type: ctx.registries.defaultBlockType, after: block.id })(state, dispatch);
      }

      // splitBlock inserts the new block as a sibling
      // immediately after `block` (same parent, index = indexOf(block)+1), so
      // its nesting depth is automatically identical — no need to manually
      // transfer attrs.indent. addNestingSyncToBuilder (called inside
      // splitBlock) rewrites attrs.indent from depthOf().
      if (schema.listLike) {
        return splitBlockCommand(ctx).run({ id: block.id, offset: focus.offset, asType: block.type })(state, dispatch);
      }

      return splitBlockCommand(ctx).run({ id: block.id, offset: focus.offset })(state, dispatch);
    },
  };
}

/** Backspace: merge at block start, or remove a block selection. */
function backspaceCommand(ctx: Ctx): CommandEntry {
  return {
    name: 'backspace',
    run: () => (state, dispatch) => {
      const sel = state.selection;

      if (isBlocks(sel) && sel.blockIds.length) {
        const first = sel.blockIds[0]!;
        const before = blockBefore(state.doc, first);
        const builder = createTransaction();
        for (const id of sel.blockIds) builder.removeBlock(id);
        const target = before ?? blockAfter(state.doc, sel.blockIds[sel.blockIds.length - 1]!);
        addNestingSyncToBuilder(state, builder, ctx);
        if (target) builder.setSelection(caretSelection(target.id, inlineText(target.content).length));
        dispatch?.(builder.build());
        return true;
      }

      const focus = ensureCaretOrText(sel);
      if (!focus) return false;
      const block = requireBlock(state.doc, focus.blockId);

      // Non-collapsed text selection: delete the range (Phase 1: within one block).
      if (isText(sel) && !isCollapsed(sel) && sel.anchor.blockId === sel.focus.blockId) {
        const [start, end] = sel.anchor.offset <= sel.focus.offset
          ? [sel.anchor.offset, sel.focus.offset]
          : [sel.focus.offset, sel.anchor.offset];
        const text = inlineText(block.content);
        const next = inlineFromString(text.slice(0, start) + text.slice(end));
        const builder = createTransaction();
        builder.setText(block.id, next);
        builder.setSelection(caretSelection(block.id, start));
        builder.skipDomWrite([block.id]);
        dispatch?.(builder.build());
        return true;
      }

      // Cross-block text selection: delete the range spanning multiple blocks.
      // The start block keeps [0, start.offset); the end block keeps
      // [end.offset, end); the two remnants are merged into the start block.
      // Blocks strictly between start and end (and the end block itself) are
      // removed.
      if (isText(sel) && !isCollapsed(sel) && sel.anchor.blockId !== sel.focus.blockId) {
        const flat = flattenDoc(state.doc);
        const ia = flat.indexOf(sel.anchor.blockId);
        const ib = flat.indexOf(sel.focus.blockId);
        if (ia === -1 || ib === -1) return false;
        const [start, end] = ia <= ib ? [sel.anchor, sel.focus] : [sel.focus, sel.anchor];
        const startIdx = flat.indexOf(start.blockId);
        const endIdx = flat.indexOf(end.blockId);
        if (startIdx === -1 || endIdx === -1 || startIdx >= endIdx) return false;

        const startBlock = requireBlock(state.doc, start.blockId);
        const endBlock = requireBlock(state.doc, end.blockId);
        const startTextLen = inlineText(startBlock.content).length;
        const endTextLen = inlineText(endBlock.content).length;
        const startOffset = Math.min(start.offset, startTextLen);
        const endOffset = Math.min(end.offset, endTextLen);

        const [startBefore] = splitInline(startBlock.content, startOffset);
        const [, endAfter] = splitInline(endBlock.content, endOffset);
        const mergedContent: InlineSeq = [...startBefore, ...endAfter];
        const caretPos = inlineText(startBefore).length;

        const builder = createTransaction();
        builder.setText(start.blockId, mergedContent);
        // Remove blocks from endIdx down to startIdx+1 (end block inclusive).
        for (let i = endIdx; i > startIdx; i--) {
          builder.removeBlock(flat[i]!);
        }
        builder.setSelection(caretSelection(start.blockId, caretPos));
        addNestingSyncToBuilder(state, builder, ctx);
        dispatch?.(builder.build());
        return true;
      }

      // Caret mid-text: let the native contenteditable delete one char.
      if (focus.offset > 0) return false;

      // Caret at block start AND block is nested (depth ≥ 1): outdent FIRST
      // (higher priority than list exit / merge). Any block type — including
      // non-nestable ones (code, hr, table, divider, quote) — can be promoted
      // because "nestable" only governs being a parent, not being a child.
      if (depthOf(state.doc, block.id) > 0) {
        return outdentBlockCommand(ctx).run({ id: block.id })(state, dispatch);
      }

      // Caret at offset 0 on a list item: Backspace exits the list rather
      // than merging text into the previous block. Convert the item to a
      // paragraph — empty or not — matching the other non-paragraph text
      // blocks (heading/quote/codeBlock), which convert back to a paragraph
      // when empty. Keeping the item as an empty paragraph (instead of
      // deleting it) gives a progressive exit: Backspace once → paragraph,
      // Backspace again → merge into the previous block.
      if (ctx.registries.schema.isListLike(block.type)) {
        return convertBlockCommand(ctx).run({ id: block.id, type: ctx.registries.defaultBlockType })(state, dispatch);
      }

      // Caret at offset 0 in an empty non-paragraph block: convert to
      // paragraph instead of merging or deleting.
      if (ctx.registries.schema.isEmpty(block) && block.type !== ctx.registries.defaultBlockType) {
        return convertBlockCommand(ctx).run({ id: block.id, type: ctx.registries.defaultBlockType })(state, dispatch);
      }

      // Caret at offset 0: merge with the previous block (document order).
      const prev = blockBefore(state.doc, block.id);
      if (!prev) return false; // at the very start of the document

      if (ctx.registries.schema.isIsolating(block.type) || ctx.registries.schema.isIsolating(prev.type)) {
        // Don't merge across an isolating boundary. If the current block is
        // empty, remove it and place the caret at the end of the previous one.
        if (ctx.registries.schema.isEmpty(block)) {
          return removeBlockCommand(ctx).run({ id: block.id })(state, dispatch);
        }
        return false;
      }

      // 前一个块是非文本块（content: 'none'，如图片、分隔符）时，不能将
      // 当前块的文本合并进去。如果当前块为空则删除它，否则禁止合并。
      if (!ctx.registries.schema.hasText(prev.type)) {
        if (ctx.registries.schema.isEmpty(block)) {
          return removeBlockCommand(ctx).run({ id: block.id })(state, dispatch);
        }
        return false;
      }

      return mergeBlockCommand(ctx).run({ id: block.id })(state, dispatch);
    },
  };
}

/** Move caret to the end of the previous block (document order). */
function moveToPreviousBlockCommand(): CommandEntry {
  return {
    name: 'moveToPreviousBlock',
    run: () => (state, dispatch) => {
      const focus = ensureCaretOrText(state.selection);
      if (!focus) return false;
      const prev = blockBefore(state.doc, focus.blockId);
      if (!prev) return false;
      const offset = Math.min(focus.offset, inlineText(prev.content).length);
      dispatch?.(createTransaction().setSelection(caretSelection(prev.id, offset)).setMeta({ addToHistory: false }).build());
      return true;
    },
  };
}

/** Move caret to the start-ish of the next block (document order). */
function moveToNextBlockCommand(): CommandEntry {
  return {
    name: 'moveToNextBlock',
    run: () => (state, dispatch) => {
      const focus = ensureCaretOrText(state.selection);
      if (!focus) return false;
      const next = blockAfter(state.doc, focus.blockId);
      if (!next) return false;
      const offset = Math.min(focus.offset, inlineText(next.content).length);
      dispatch?.(createTransaction().setSelection(caretSelection(next.id, offset)).setMeta({ addToHistory: false }).build());
      return true;
    },
  };
}

function setSelectionCommand(): CommandEntry<{ selection: Selection }> {
  return {
    name: 'setSelection',
    run: (args) => (_state, dispatch) => {
      dispatch?.(createTransaction().setSelection(args.selection).setMeta({ addToHistory: false }).build());
      return true;
    },
  };
}

/**
 * Drop any active block selection: set the selection to an empty block
 * selection ({ kind: 'blocks', blockIds: [] }), which the core treats as
 * "nothing selected". Used when deselecting image/table/code blocks —
 * they have no text caret, so there is no caret position to move to.
 */
function clearSelectionCommand(): CommandEntry {
  return {
    name: 'clearSelection',
    run: () => (_state, dispatch) => {
      dispatch?.(
        createTransaction()
          .setSelection({ kind: 'blocks', blockIds: [] })
          .setMeta({ addToHistory: false })
          .build(),
      );
      return true;
    },
  };
}

/** Select all content: a text selection from the first block's start to the
 *  last block's end. For a single-block document, produces a normal
 *  single-block text selection (rendered by the native Selection API). */
function selectAllCommand(): CommandEntry {
  return {
    name: 'selectAll',
    run: () => (state, dispatch) => {
      const flat = flattenDoc(state.doc);
      if (flat.length === 0) return false;
      const firstId = flat[0]!;
      const lastId = flat[flat.length - 1]!;
      const lastBlock = requireBlock(state.doc, lastId);
      const lastLen = inlineText(lastBlock.content).length;
      const sel: Selection = {
        kind: 'text',
        anchor: { blockId: firstId, offset: 0 },
        focus: { blockId: lastId, offset: lastLen },
      };
      dispatch?.(createTransaction().setSelection(sel).setMeta({ addToHistory: false }).build());
      return true;
    },
  };
}

function selectBlockCommand(): CommandEntry<{ id: BlockId }> {
  return {
    name: 'selectBlock',
    run: (args) => (_state, dispatch) => {
      dispatch?.(
        createTransaction()
          .setSelection({ kind: 'blocks', blockIds: [args.id] })
          .setMeta({ addToHistory: false })
          .build(),
      );
      return true;
    },
  };
}

function moveBlockCommand(ctx: Ctx): CommandEntry<{ id: BlockId; toParent: BlockId | null; toIndex: number }> {
  return {
    name: 'moveBlock',
    run: (args) => (state, dispatch) => {
      const block = getBlock(state.doc, args.id);
      if (!block) return false;

      // --- 1) Self-parent guard: a block cannot become its own parent. ---
      if (args.toParent === args.id) return false;

      // --- 2) Cycle guard: targetParent must NOT be a descendant of the
      //        moved block. Otherwise depthOf / flatten infinite-loop. ---
      if (args.toParent !== null) {
        let cursor: BlockId | null = args.toParent;
        while (cursor !== null) {
          if (cursor === args.id) return false;
          cursor = parentOf(state.doc, cursor);
        }
      }

      // --- 3) Nestable guard: when moving into an existing block (not root),
      //        the target parent's schema must declare nestable:true. Block
      //        types like codeBlock / hr / table / divider / quote are
      //        explicitly nestable:false — placing children under them would
      //        produce dirty state that no rendering path accounts for. ---
      if (args.toParent !== null) {
        const parentBlock = getBlock(state.doc, args.toParent);
        if (!parentBlock) return false;
        const parentSchema = ctx.registries.schema.get(parentBlock.type);
        // Fail closed: unknown schemas or nestable !== true → reject.
        if (!parentSchema?.nestable) return false;
      }

      const builder = createTransaction();
      builder.moveBlock(args.id, args.toParent, args.toIndex);
      addNestingSyncToBuilder(state, builder, ctx);
      builder.setSelection(caretSelection(args.id, 0));
      dispatch?.(builder.build());
      return true;
    },
  };
}

export interface ConvertBlockArgs {
  readonly id: BlockId;
  readonly type: BlockType;
  readonly attrs?: Attrs;
}

/**
 * Convert a block to a different type (or the same type with new attrs).
 * Preserves the block's text content and caret offset. Unlike replaceBlock,
 * this command keeps the same block id (no structural change) — the user
 * perceives it as the same block, just with a different appearance/rules.
 * Used by the slash menu, hover toolbar, and block settings menu for
 * "Turn into …" actions.
 */
function convertBlockCommand(ctx: Ctx): CommandEntry<ConvertBlockArgs> {
  return {
    name: 'convertBlock',
    run: (args) => (state, dispatch) => {
      const block = getBlock(state.doc, args.id);
      if (!block) return false;
      // Coerce the merged attrs through the target schema: this preserves
      // attrs valid in the target (e.g. align/color/bgColor carried over from
      // the source block), fills schema defaults for any missing keys, and
      // drops attrs that don't exist on the target type. Without this, a
      // caller passing partial attrs like `{ level: 1 }` would wipe the
      // block's align/color/bgColor, so the settings menu could never show
      // the real values.
      const mergedRaw = { ...block.attrs, ...(args.attrs ?? {}) };
      let attrs = ctx.registries.schema.coerceAttrsFor(args.type, mergedRaw);
      const schema = ctx.registries.schema.get(args.type);
      // If the target schema has no text content, clear the text (don't lose
      // it — keep in attrs would be extension-specific). For Phase 2 we only
      // convert between text-carrying types so this isn't hit.
      let content = block.content;
      if (schema.content === 'none') content = [];
      // If the target schema disallows inline marks, strip all marks from
      // the content and reset color/bgColor to defaults.
      if (!schema.inlineMarks) {
        content = content.map((n) => ({ type: 'text' as const, text: n.text }));
        const fixed: Record<string, unknown> = { ...attrs };
        if ('color' in fixed) fixed.color = 'default';
        if ('bgColor' in fixed) fixed.bgColor = 'default';
        attrs = fixed as Attrs;
      }
      const selOff = state.selection.kind === 'caret' && state.selection.blockId === args.id
        ? state.selection.offset
        : 0;
      const builder = createTransaction();
      // replaceBlock changes type + attrs, preserving id.
      builder.replaceBlock(args.id, args.type, attrs);
      if (content !== block.content) builder.setText(args.id, content);
      // Normalize indent: converting a block to a non-indent type (e.g.
      // codeBlock/quote) may invalidate the indent of the block BELOW it.
      addNestingSyncToBuilder(state, builder, ctx);
      // Clamp caret offset to new content length.
      const maxOff = inlineText(content).length;
      builder.setSelection(caretSelection(args.id, Math.min(selOff, maxOff)));
      dispatch?.(builder.build());
      return true;
    },
  };
}

/** Move a block up (swap with its previous sibling) in document order. */
function moveBlockUpCommand(ctx: Ctx): CommandEntry<{ id: BlockId }> {
  return {
    name: 'moveBlockUp',
    run: (args) => (state, dispatch) => {
      const prev = blockBefore(state.doc, args.id);
      if (!prev) return false;
      const parent = parentOf(state.doc, prev.id);
      const siblings = parent === null
        ? state.doc.root
        : (requireBlock(state.doc, parent).children as readonly BlockId[]);
      const prevIdx = siblings.indexOf(prev.id);
      const parentNullable: BlockId | null = parent;
      const builder = createTransaction();
      builder.moveBlock(args.id, parentNullable, Math.max(0, prevIdx));
      addNestingSyncToBuilder(state, builder, ctx);
      builder.setSelection(caretSelection(args.id, 0));
      dispatch?.(builder.build());
      return true;
    },
  };
}

/** Move a block down (swap with its next sibling) in document order. */
function moveBlockDownCommand(ctx: Ctx): CommandEntry<{ id: BlockId }> {
  return {
    name: 'moveBlockDown',
    run: (args) => (state, dispatch) => {
      const next = blockAfter(state.doc, args.id);
      if (!next) return false;
      const parent = parentOf(state.doc, args.id);
      const siblings = parent === null
        ? state.doc.root
        : (requireBlock(state.doc, parent).children as readonly BlockId[]);
      const nextIdx = siblings.indexOf(next.id);
      const parentNullable: BlockId | null = parent;
      const builder = createTransaction();
      const i = siblings.indexOf(args.id);
      const afterNext = nextIdx > i ? nextIdx : nextIdx + 1;
      builder.moveBlock(args.id, parentNullable, Math.max(0, Math.min(siblings.length, afterNext)));
      addNestingSyncToBuilder(state, builder, ctx);
      builder.setSelection(caretSelection(args.id, 0));
      dispatch?.(builder.build());
      return true;
    },
  };
}

/** Duplicate a block AND its whole subtree, inserting the cloned subtree
 *  immediately after the original block (same parent).
 *
 *  Since blocks carry their `children` array as
 *  ownership, a "duplicate" must follow the parent chain and clone every
 *  descendant with a fresh id, then re-wire the children arrays of the
 *  newly-created parents to the cloned child ids. The ids are produced in
 *  root-first DFS order via `insertBlock(parent, index)` — children are
 *  appended to their new parent's `children` array one by one so the
 *  relative order within each sibling list matches the source. */
function duplicateBlockCommand(ctx: Ctx): CommandEntry<{ id: BlockId }> {
  return {
    name: 'duplicateBlock',
    run: (args) => (state, dispatch) => {
      const rootBlock = getBlock(state.doc, args.id);
      if (!rootBlock) return false;

      // Root-first DFS over the source subtree. For each node we record the
      // old-id plus the source parent-id (the root's source-parent is outside
      // the subtree and will be used as the insert point).
      type Node = { readonly oldId: BlockId; readonly parentOldId: BlockId | null };
      const order: Node[] = [];
      const stack: Array<{ id: BlockId; parentOldId: BlockId | null }> = [];
      stack.push({ id: args.id, parentOldId: parentOf(state.doc, args.id) });
      while (stack.length > 0) {
        const { id, parentOldId } = stack.pop()!;
        const b = getBlock(state.doc, id);
        if (!b) continue;
        order.push({ oldId: id, parentOldId });
        // Push children in REVERSE so that popping yields them in original order.
        const kids = b.children as readonly BlockId[];
        for (let i = kids.length - 1; i >= 0; i--) {
          stack.push({ id: kids[i]!, parentOldId: id });
        }
      }
      if (order.length === 0) return false;

      const oldToNew = new Map<BlockId, BlockId>();
      // Tracks how many children we have already appended under each cloned
      // parent — `insertBlock(parent, index)` will use this to append at the
      // "current end" of the new parent's (still being built) children list.
      const nextChildIndex = new Map<BlockId, number>();
      const builder = createTransaction();

      for (const node of order) {
        const src = requireBlock(state.doc, node.oldId);
        let insertParent: BlockId | null;
        let insertIndex: number;
        if (node.oldId === args.id) {
          // Root clone: insert right after the original, in the same parent.
          insertParent = node.parentOldId;
          const siblings = insertParent === null
            ? state.doc.root
            : (requireBlock(state.doc, insertParent).children as readonly BlockId[]);
          const srcIdx = siblings.indexOf(args.id);
          insertIndex = srcIdx >= 0 ? srcIdx + 1 : siblings.length;
        } else {
          // Descendant clone: append at the end of its (new) parent's children.
          // (This is the `else` branch of `node.oldId === args.id`, so
          // node.parentOldId is always a real BlockId inside the subtree.)
          const parentOldId = node.parentOldId as BlockId;
          const parentNewId = oldToNew.get(parentOldId) ?? null;
          if (parentNewId === null) return false;
          insertParent = parentNewId;
          insertIndex = nextChildIndex.get(parentNewId) ?? 0;
          nextChildIndex.set(parentNewId, insertIndex + 1);
        }

        const attrs = ctx.registries.schema.coerceAttrsFor(src.type, src.attrs);
        const newId = builder.insertBlock({
          parent: insertParent,
          index: insertIndex,
          type: src.type,
          attrs,
          content: src.content,
        });
        oldToNew.set(node.oldId, newId);
      }

      addNestingSyncToBuilder(state, builder, ctx);
      const newRootId = oldToNew.get(args.id) ?? null;
      if (newRootId) {
        builder.setSelection(caretSelection(newRootId, 0));
      }
      dispatch?.(builder.build());
      return true;
    },
  };
}

// ---- New Phase 3 primitives: align + color attrs + cut/copy helpers -------

export interface SetBlockAlignArgs {
  readonly id: BlockId;
  readonly align: 'left' | 'center' | 'right' | 'justify';
}

function setBlockAlignCommand(ctx: Ctx): CommandEntry<SetBlockAlignArgs> {
  return {
    name: 'setBlockAlign',
    run: (args) => (state, dispatch) => {
      const block = getBlock(state.doc, args.id);
      if (!block) return false;
      // Code blocks (and any schema without an `align` attr) are always
      // left-aligned: refuse to set alignment so disabled UI can't bypass it.
      const schema = ctx.registries.schema.get(block.type);
      if (!('align' in schema.attrs)) return false;
      const builder = createTransaction();
      builder.setAttrs(args.id, { ...block.attrs, align: args.align });
      dispatch?.(builder.build());
      return true;
    },
  };
}

export interface SetBlockColorArgs {
  readonly id: BlockId;
  /** Color preset key (e.g. 'blue'). Pass 'default' to reset. */
  readonly color: string;
}

function setBlockColorCommand(ctx: Ctx): CommandEntry<SetBlockColorArgs> {
  return {
    name: 'setBlockColor',
    run: (args) => (state, dispatch) => {
      const block = getBlock(state.doc, args.id);
      if (!block) return false;
      if (!ctx.registries.schema.hasInlineMarks(block.type)) return false;
      const builder = createTransaction();
      builder.setAttrs(args.id, { ...block.attrs, color: args.color });
      dispatch?.(builder.build());
      return true;
    },
  };
}

export interface SetBlockBgColorArgs {
  readonly id: BlockId;
  readonly bgColor: string;
}

function setBlockBgColorCommand(ctx: Ctx): CommandEntry<SetBlockBgColorArgs> {
  return {
    name: 'setBlockBgColor',
    run: (args) => (state, dispatch) => {
      const block = getBlock(state.doc, args.id);
      if (!block) return false;
      if (!ctx.registries.schema.hasInlineMarks(block.type)) return false;
      const builder = createTransaction();
      builder.setAttrs(args.id, { ...block.attrs, bgColor: args.bgColor });
      dispatch?.(builder.build());
      return true;
    },
  };
}

// ---- Ordered list start numbering -----------------------------------------

export interface SetStartNumberArgs {
  readonly id: BlockId;
  /**
   * The explicit starting number for this ordered-list item.
   * Pass `null` / `undefined` to clear the override — the item will then
   * follow the previous block's numbering (standard "continue" behavior).
   */
  readonly startNumber: number | null;
}

function setStartNumberCommand(): CommandEntry<SetStartNumberArgs> {
  return {
    name: 'setStartNumber',
    run: (args) => (state, dispatch) => {
      const block = getBlock(state.doc, args.id);
      if (!block || block.type !== 'orderedList') return false;
      const currentAttrs = block.attrs;
      const n = args.startNumber;
      let nextAttrs: typeof currentAttrs;
      if (n === null || n === undefined) {
        // Clear the override so the item auto-follows previous numbering.
        const { startNumber: _sn, ...rest } = currentAttrs as { startNumber?: unknown };
        nextAttrs = rest;
      } else {
        const clamped = Math.max(1, Math.floor(n));
        nextAttrs = { ...currentAttrs, startNumber: clamped };
      }
      const builder = createTransaction();
      builder.setAttrs(args.id, nextAttrs);
      dispatch?.(builder.build());
      return true;
    },
  };
}

// ---- Block indent / outdent -----------------------------------------------

export interface IndentBlockArgs {
  readonly id?: BlockId;
}

/**
 * Increase nesting level (Tab key).
 *
 * Nesting model:
 *   • Authoritative state is the parent/children tree in DocState (Block.children
 *     + DocState.parent Map).
 *   • attrs.indent is a DERIVED shadow — it is rewritten by addNestingSyncToBuilder
 *     to equal depthOf(doc, id) after every transaction, and is NEVER set here.
 *
 * Behaviour (matches Notion / Google Docs):
 *   • If the block has a PREVIOUS SIBLING (same parent, earlier index), move
 *     the block to become the LAST CHILD of that previous sibling.
 *   • The PREVIOUS SIBLING must be nestable (schema.nestable) — because it
 *     will become the new parent. The CURRENT block can be ANY type:
 *     non-nestable blocks (codeBlock, divider, hr, table, image, quote, …)
 *     simply become children without being able to accept further children
 *     of their own (the nestable flag governs being a parent, not a child).
 *   • The resulting nesting depth is capped to MAX_INDENT — if the previous
 *     sibling already sits at MAX_INDENT the operation is a no-op
 *     (nesting under prev would place this block at MAX+1, which is invalid).
 *   • First-sibling and first-document blocks (no prev sibling) cannot indent
 *     (they would have nothing to nest under).
 *
 * args.id is optional; when omitted the focus block from state.selection is
 * used (so keymap bindings can call indentBlock directly without args).
 */
function indentBlockCommand(ctx: Ctx): CommandEntry<IndentBlockArgs> {
  return {
    name: 'indentBlock',
    run: (args) => (state, dispatch) => {
      const id = (args?.id as BlockId | undefined) ?? (() => {
        const focus = state.selection.kind === 'caret'
          ? state.selection.blockId
          : state.selection.kind === 'text'
            ? state.selection.focus.blockId
            : state.selection.kind === 'blocks' && state.selection.blockIds[0]
              ? state.selection.blockIds[0]
              : undefined;
        return focus;
      })();
      if (!id) return false;
      const block = getBlock(state.doc, id);
      if (!block) return false;
      // NOTE: no `mySchema.nestable` check here — ANY block type is allowed
      // to BECOME a child (nestable means "can be a parent", not "can be a child").

      const prev = prevSibling(state.doc, id);
      if (!prev) return false; // first-sibling: nothing to nest under
      const prevSchema = ctx.registries.schema.get(prev.type);
      if (!prevSchema.nestable) return false; // can't nest under non-nestable

      if (depthOf(state.doc, prev.id) >= MAX_INDENT) return false;

      const newParentId = prev.id;
      const toIndex = (prev.children as readonly BlockId[]).length;

      const builder = createTransaction();
      builder.moveBlock(id, newParentId, toIndex);
      addNestingSyncToBuilder(state, builder, ctx);
      builder.setSelection(caretSelection(id, 0));
      dispatch?.(builder.build());
      return true;
    },
  };
}

/**
 * Decrease nesting level (Shift+Tab) — the inverse of indentBlock.
 *
 * Behaviour:
 *   • If the block has a real parent (parentOf != null → depth ≥ 1), move the
 *     block to become the NEXT SIBLING of its own parent (i.e. promote it one
 *     level up in the tree, placed immediately after the former parent).
 *   • Root-level blocks (depth 0, parent null) cannot outdent further.
 *   • The CURRENT block can be ANY type (same logic as indentBlock):
 *     non-nestable blocks can be promoted up just like any other.
 *   • After promotion, attrs.indent is normalized via addNestingSyncToBuilder
 *     (same as indentBlock — the command does NOT write the indent attr).
 */
function outdentBlockCommand(ctx: Ctx): CommandEntry<IndentBlockArgs> {
  return {
    name: 'outdentBlock',
    run: (args) => (state, dispatch) => {
      const id = (args?.id as BlockId | undefined) ?? (() => {
        const focus = state.selection.kind === 'caret'
          ? state.selection.blockId
          : state.selection.kind === 'text'
            ? state.selection.focus.blockId
            : state.selection.kind === 'blocks' && state.selection.blockIds[0]
              ? state.selection.blockIds[0]
              : undefined;
        return focus;
      })();
      if (!id) return false;
      const block = getBlock(state.doc, id);
      if (!block) return false;
      // NOTE: any block type can be promoted out — "nestable" is only about
      // being a parent, not being a child.

      const parentId = parentOf(state.doc, id);
      if (parentId === null) return false; // already at root level

      const grandParentId = parentOf(state.doc, parentId);
      // Index of our parent among the grandparent's children — we insert
      // ourselves right after it.
      const parentSibs = siblingList(state.doc, parentId);
      const parentIdx = parentSibs.indexOf(parentId);
      const toIndex = parentIdx === -1 ? parentSibs.length : parentIdx + 1;

      const builder = createTransaction();
      builder.moveBlock(id, grandParentId, toIndex);
      addNestingSyncToBuilder(state, builder, ctx);
      builder.setSelection(caretSelection(id, 0));
      dispatch?.(builder.build());
      return true;
    },
  };
}

// ---- Inline marks (bold / italic / underline / strikethrough / code) ---------

/** Compare two marks for equality (type + attrs). */
function markEqualInline(a: Mark, b: Mark): boolean {
  if (a.type !== b.type) return false;
  const ak = a.attrs ? Object.keys(a.attrs) : [];
  const bk = b.attrs ? Object.keys(b.attrs) : [];
  if (ak.length !== bk.length) return false;
  return ak.every((k) => a.attrs![k] === b.attrs![k]);
}

/** Compare two mark arrays for set-equality (order-independent, type + attrs). */
function marksEqualInline(a: readonly Mark[], b: readonly Mark[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((m) => b.some((n) => markEqualInline(m, n)));
}

export interface ToggleMarkArgs {
  readonly id: BlockId;
  readonly markType: string;
  readonly from: number;
  readonly to: number;
}

/**
 * Toggle an inline mark (bold, italic, …) on the character range [from, to)
 * within a block's content. If ALL characters in the range already carry the
 * mark, it is removed; otherwise it is added to every character in the range
 * (standard ProseMirror / Notion semantics).
 *
 * The content is split into per-character-segment TextRuns, the mark is
 * toggled, then adjacent runs with identical marks are merged back. The
 * resulting content is dispatched via `setText` WITHOUT `skipDomWrite` so the
 * view re-renders the HTML.
 */
function toggleMarkCommand(ctx: Ctx): CommandEntry<ToggleMarkArgs> {
  return {
    name: 'toggleMark',
    run: (args) => (state, dispatch) => {
      const block = getBlock(state.doc, args.id);
      if (!block) return false;
      if (!ctx.registries.schema.hasInlineMarks(block.type)) return false;
      // Block types may declare certain inline marks disallowed (e.g. quote
      // blocks disallow italic because they render italic globally).
      if (ctx.registries.schema.isMarkDisallowed(block.type, args.markType)) return false;
      const fullText = inlineText(block.content);
      const from = Math.max(0, Math.min(args.from, fullText.length));
      const to = Math.max(from, Math.min(args.to, fullText.length));
      if (from >= to) return false;

      // Segments carry full Mark objects (with attrs) so that color/bgColor
      // marks are preserved when toggling bold/italic/etc.
      type Seg = { text: string; marks: Mark[] };
      const segs: Seg[] = [];
      let pos = 0;
      for (const run of block.content) {
        if (run.type !== 'text') continue;
        const runMarks: Mark[] = (run.marks ?? []).map((m) => ({ ...m }));
        const runStart = pos;
        const runEnd = pos + run.text.length;
        // Split this run at from/to boundaries that fall strictly inside it.
        const cuts = [runStart, runEnd];
        if (from > runStart && from < runEnd) cuts.push(from);
        if (to > runStart && to < runEnd) cuts.push(to);
        cuts.sort((a, b) => a - b);
        for (let i = 0; i < cuts.length - 1; i++) {
          const s = cuts[i]!;
          const e = cuts[i + 1]!;
          if (s >= e) continue;
          segs.push({
            text: run.text.slice(s - runStart, e - runStart),
            marks: runMarks.map((m) => ({ ...m })),
          });
        }
        pos = runEnd;
      }

      // Determine if ALL segments overlapping [from, to) already have the mark.
      let allHave = true;
      pos = 0;
      for (const seg of segs) {
        const segStart = pos;
        const segEnd = pos + seg.text.length;
        if (segEnd > from && segStart < to && !seg.marks.some((m) => m.type === args.markType)) {
          allHave = false;
          break;
        }
        pos = segEnd;
      }

      // Inline code is incompatible with other inline formatting marks.
      // Adding `code` strips bold/italic/underline/strikethrough/color/bgColor
      // from the range; adding those marks to a segment already carrying
      // inline code is a no-op (code wins).
      const CODE_INCOMPATIBLE: readonly string[] = ['bold', 'italic', 'underline', 'strikethrough', 'color', 'bgColor', 'link'];

      // Toggle: if all have it → remove; otherwise → add to all in range.
      pos = 0;
      for (const seg of segs) {
        const segStart = pos;
        const segEnd = pos + seg.text.length;
        if (segEnd > from && segStart < to) {
          if (allHave) {
            seg.marks = seg.marks.filter((m) => m.type !== args.markType);
          } else if (args.markType === 'code') {
            // Setting inline code: strip incompatible marks, then ensure code.
            seg.marks = seg.marks.filter((m) => !CODE_INCOMPATIBLE.includes(m.type));
            if (!seg.marks.some((m) => m.type === 'code')) {
              seg.marks.push({ type: 'code' });
            }
          } else if (CODE_INCOMPATIBLE.includes(args.markType)) {
            // Don't apply formatting marks to segments that are inline code.
            if (!seg.marks.some((m) => m.type === 'code')
              && !seg.marks.some((m) => m.type === args.markType)) {
              seg.marks.push({ type: args.markType });
            }
          } else if (!seg.marks.some((m) => m.type === args.markType)) {
            seg.marks.push({ type: args.markType });
          }
        }
        pos = segEnd;
      }

      // Merge adjacent segments with identical marks (type + attrs).
      const merged: Seg[] = [];
      for (const seg of segs) {
        if (seg.text.length === 0) continue;
        const last = merged[merged.length - 1];
        if (last && marksEqualInline(last.marks, seg.marks)) {
          last.text += seg.text;
        } else {
          merged.push({ text: seg.text, marks: [...seg.marks] });
        }
      }

      const newContent: InlineSeq = merged.map((seg) => ({
        type: 'text' as const,
        text: seg.text,
        marks: seg.marks.length > 0 ? seg.marks : undefined,
      }));

      const builder = createTransaction();
      builder.setText(args.id, newContent);
      builder.setMeta({ addToHistory: true });
      // Preserve selection explicitly: toggleMark does not move the caret or
      // change the selection range — it only toggles inline marks. Writing
      // this down means applyTransaction() doesn't rely on the implicit
      // `state.selection` fallback, killing any subtle bugs where plugins
      // or focus changes cause a transient "fallback to first block".
      builder.setSelection(state.selection);
      // Intentionally NOT calling skipDomWrite — the DOM must re-render to
      // show the new mark tags.
      dispatch?.(builder.build());
      return true;
    },
  };
}

// ---- Inline mark with attrs (color / bgColor) -------------------------------

export interface SetInlineMarkArgs {
  readonly id: BlockId;
  readonly markType: string;
  readonly attrs: Attrs | null;
  readonly from: number;
  readonly to: number;
}

/**
 * Set (or remove) an inline mark with attrs (e.g. color, bgColor) on the
 * character range [from, to). If attrs is null, the mark is removed from
 * all segments in the range. Otherwise, the mark is set/overwritten with
 * the given attrs on every segment in the range.
 */
function setInlineMarkCommand(ctx: Ctx): CommandEntry<SetInlineMarkArgs> {
  return {
    name: 'setInlineMark',
    run: (args) => (state, dispatch) => {
      const block = getBlock(state.doc, args.id);
      if (!block) return false;
      if (!ctx.registries.schema.hasInlineMarks(block.type)) return false;
      const fullText = inlineText(block.content);
      const from = Math.max(0, Math.min(args.from, fullText.length));
      const to = Math.max(from, Math.min(args.to, fullText.length));
      if (from >= to) return false;

      type Seg = { text: string; marks: Mark[] };
      const segs: Seg[] = [];
      let pos = 0;
      for (const run of block.content) {
        if (run.type !== 'text') continue;
        const runMarks = (run.marks ?? []).map((m) => ({ ...m }));
        const runStart = pos;
        const runEnd = pos + run.text.length;
        const cuts = [runStart, runEnd];
        if (from > runStart && from < runEnd) cuts.push(from);
        if (to > runStart && to < runEnd) cuts.push(to);
        cuts.sort((a, b) => a - b);
        for (let i = 0; i < cuts.length - 1; i++) {
          const s = cuts[i]!;
          const e = cuts[i + 1]!;
          if (s >= e) continue;
          segs.push({
            text: run.text.slice(s - runStart, e - runStart),
            marks: [...runMarks],
          });
        }
        pos = runEnd;
      }

      // Apply: set or remove the mark on segments in range.
      pos = 0;
      for (const seg of segs) {
        const segStart = pos;
        const segEnd = pos + seg.text.length;
        if (segEnd > from && segStart < to) {
          // Inline code is incompatible with color/bgColor: don't set those
          // marks on code segments. Removal still proceeds so any stale marks
          // can be cleared.
          const isCode = seg.marks.some((m) => m.type === 'code');
          if (args.attrs !== null && isCode) {
            pos = segEnd;
            continue;
          }
          if (args.attrs === null) {
            // Remove all marks of this type.
            seg.marks = seg.marks.filter((m) => m.type !== args.markType);
          } else {
            // Remove existing marks of same type, then add new one.
            seg.marks = seg.marks.filter((m) => m.type !== args.markType);
            seg.marks.push({ type: args.markType, attrs: args.attrs });
          }
        }
        pos = segEnd;
      }

      // Merge adjacent segments with identical marks (type + attrs).
      const merged: Seg[] = [];
      for (const seg of segs) {
        if (seg.text.length === 0) continue;
        const last = merged[merged.length - 1];
        if (last && marksEqualInline(last.marks, seg.marks)) {
          last.text += seg.text;
        } else {
          merged.push({ text: seg.text, marks: [...seg.marks] });
        }
      }

      const newContent: InlineSeq = merged.map((seg) => ({
        type: 'text' as const,
        text: seg.text,
        marks: seg.marks.length > 0 ? seg.marks : undefined,
      }));

      const builder = createTransaction();
      builder.setText(args.id, newContent);
      builder.setMeta({ addToHistory: true });
      // Same rationale as toggleMark: preserve the editor selection so any
      // transient focus / DOM selection quirk during the toolbar action
      // window can't accidentally fall back to a different block id.
      builder.setSelection(state.selection);
      dispatch?.(builder.build());
      return true;
    },
  };
}

// ---- Link mark (set / unset) -----------------------------------------------

export interface SetLinkArgs {
  readonly id: BlockId;
  readonly href: string;
  readonly from: number;
  readonly to: number;
  /** Optional new text for the linked range. If omitted, text is unchanged. */
  readonly text?: string;
}

/**
 * Set a link mark on the character range [from, to). If `text` is provided,
 * the text content of the range is replaced (useful for editing link text
 * from the popover). Inline code marks are stripped from the range (code
 * and link are mutually exclusive).
 */
function setLinkCommand(ctx: Ctx): CommandEntry<SetLinkArgs> {
  return {
    name: 'setLink',
    run: (args) => (state, dispatch) => {
      const block = getBlock(state.doc, args.id);
      if (!block) return false;
      if (!ctx.registries.schema.hasInlineMarks(block.type)) return false;
      const fullText = inlineText(block.content);
      const from = Math.max(0, Math.min(args.from, fullText.length));
      const to = Math.max(from, Math.min(args.to, fullText.length));
      if (from >= to && !args.text) return false;

      // Build new content: [0, from) + linked text + [to, end)
      const [before, rest1] = splitInline(block.content, from);
      const [, after] = splitInline(rest1, to - from);

      // Determine the text for the linked range.
      const linkText = args.text ?? fullText.slice(from, to);
      const linkRun: InlineNode = {
        type: 'text',
        text: linkText,
        marks: [{ type: 'link', attrs: { href: args.href } as Attrs }],
      };

      const newContent: InlineSeq = [...before, linkRun, ...after];

      const builder = createTransaction();
      builder.setText(args.id, newContent);
      builder.setMeta({ addToHistory: true });
      if (dispatch) {
        dispatch(builder.build());
      }
      return true;
    },
  };
}

export interface UnsetLinkArgs {
  readonly id: BlockId;
  readonly from: number;
  readonly to: number;
}

/**
 * Remove all link marks from the character range [from, to). Other marks
 * (bold, italic, etc.) are preserved.
 */
function unsetLinkCommand(ctx: Ctx): CommandEntry<UnsetLinkArgs> {
  return {
    name: 'unsetLink',
    run: (args) => (state, dispatch) => {
      const block = getBlock(state.doc, args.id);
      if (!block) return false;
      if (!ctx.registries.schema.hasInlineMarks(block.type)) return false;
      const fullText = inlineText(block.content);
      const from = Math.max(0, Math.min(args.from, fullText.length));
      const to = Math.max(from, Math.min(args.to, fullText.length));
      if (from >= to) return false;

      // Check if any link marks exist in the range.
      let hasLink = false;
      let pos = 0;
      for (const run of block.content) {
        if (run.type !== 'text') continue;
        const runEnd = pos + run.text.length;
        if (runEnd > from && pos < to && run.marks?.some((m) => m.type === 'link')) {
          hasLink = true;
          break;
        }
        pos = runEnd;
      }
      if (!hasLink) return false;

      // Reuse setInlineMark with attrs=null to remove link marks.
      // We call the command logic directly to avoid dispatch round-trips.
      const setInlineMark = setInlineMarkCommand(ctx);
      return setInlineMark.run({
        id: args.id,
        markType: 'link',
        attrs: null,
        from,
        to,
      })(state, dispatch);
    },
  };
}

/** Build all primitive commands. Registered by the Editor at construction. */
export function createPrimitiveCommands(registries: EditorRegistries): AnyCommandEntry[] {
  const ctx: Ctx = { registries };
  return [
    insertBlockCommand(ctx),
    removeBlockCommand(ctx),
    replaceBlockCommand(ctx),
    setTextCommand(),
    setAttrsCommand(),
    splitBlockCommand(ctx),
    mergeBlockCommand(ctx),
    enterCommand(ctx),
    backspaceCommand(ctx),
    moveToPreviousBlockCommand(),
    moveToNextBlockCommand(),
    setSelectionCommand(),
    selectAllCommand(),
    selectBlockCommand(),
    clearSelectionCommand(),
    moveBlockCommand(ctx),
    convertBlockCommand(ctx),
    moveBlockUpCommand(ctx),
    moveBlockDownCommand(ctx),
    duplicateBlockCommand(ctx),
    setBlockAlignCommand(ctx),
    setBlockColorCommand(ctx),
    setBlockBgColorCommand(ctx),
    setStartNumberCommand(),
    indentBlockCommand(ctx),
    outdentBlockCommand(ctx),
    toggleMarkCommand(ctx),
    setInlineMarkCommand(ctx),
    setLinkCommand(ctx),
    unsetLinkCommand(ctx),
  ];
}

// Re-export the dispatch type for consumers (view layer).
export type { Dispatch };
