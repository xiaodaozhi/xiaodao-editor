/**
 * Primitive commands: the block-type-agnostic operations the editor core
 * provides. They are pure `(args) => (state, dispatch?) => boolean` functions
 * that build transactions using *only* schema predicates (never `block.type`
 * switches). Block-type-specific commands live in their extensions and
 * compose these primitives.
 *
 * See docs/editor-architecture.md §7.3, §11.2, §11.3.
 */

import type { Attrs, BlockId, BlockType, DocState, InlineNode, InlineSeq, Mark, Selection } from '../types';
import { inlineFromString, inlineText, splitInline } from '../types';
import { createTransaction } from '../state/Transaction';
import type { AnyCommandEntry, CommandEntry, Dispatch } from './Command';
import type { EditorRegistries } from '../extension/Registry';
import {
  blockAfter,
  blockBefore,
  flatten as flattenDoc,
  getBlock,
  indexOf,
  parentOf,
  requireBlock,
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

/**
 * Indent normalization — the SINGLE source of truth for indent rules.
 *
 * Rules:
 *   1. The first block in the document must have indent 0 (or no indent attr).
 *   2. If the previous block (in flat doc order) does NOT support indent
 *      (e.g. quote / codeBlock), the current block's indent must be 0.
 *   3. A block's indent may exceed the previous block's indent by at most 1
 *      (only when both support indent).
 *
 * This function inspects a DocState and returns the setAttrs steps needed
 * to make the document compliant. Callers add these steps to the SAME
 * transaction as the structural change so the fixup is atomic with undo.
 */
function collectIndentFixups(
  doc: DocState,
  schema: { get(type: string): { attrs: Readonly<Record<string, unknown>> } },
): Array<{ id: BlockId; attrs: Attrs }> {
  const flat = flattenDoc(doc);
  const fixups: Array<{ id: BlockId; attrs: Attrs }> = [];
  let prevSupportsIndent = false;
  let prevIndent = 0;

  for (let i = 0; i < flat.length; i++) {
    const id = flat[i]!;
    const block = doc.blocks.get(id);
    if (!block) continue;

    const schemaAttrs = schema.get(block.type).attrs;
    const supportsIndent = 'indent' in schemaAttrs;
    const currentIndent = typeof block.attrs.indent === 'number' ? block.attrs.indent : 0;

    // Compute the maximum allowed indent for this block.
    let maxAllowed = 0;
    if (i > 0 && prevSupportsIndent) {
      maxAllowed = prevIndent + 1;
    }

    if (supportsIndent && currentIndent > maxAllowed) {
      // Clamp to maxAllowed (which is 0 if prev doesn't support indent).
      const newIndent = maxAllowed;
      if (newIndent === 0) {
        const { indent: _omit, ...restAttrs } = block.attrs;
        fixups.push({ id, attrs: restAttrs });
      } else {
        fixups.push({ id, attrs: { ...block.attrs, indent: newIndent } });
      }
    }

    prevSupportsIndent = supportsIndent;
    prevIndent = supportsIndent ? Math.min(currentIndent, maxAllowed) : 0;
  }

  return fixups;
}

/** Apply indent fixups to a transaction builder based on the POST-operation
 *  document state. We achieve this by running applySteps on a draft to get
 *  the intermediate state, then collecting fixups from that state. */
function addIndentFixupsToBuilder(
  state: EditorState,
  builder: ReturnType<typeof createTransaction>,
  ctx: Ctx,
): void {
  // Build a temporary state by applying the builder's current steps.
  const steps = builder.peek();
  if (steps.length === 0) return;
  const result = applySteps(state.doc, steps);
  const fixups = collectIndentFixups(result.doc, ctx.registries.schema);
  for (const f of fixups) {
    builder.setAttrs(f.id, f.attrs);
  }
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
      builder.removeBlock(args.id);
      // Normalize indent after structural change (covers first-block rule
      // AND prev-block-doesn't-support-indent rule in one pass).
      addIndentFixupsToBuilder(state, builder, ctx);
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
      addIndentFixupsToBuilder(state, builder, ctx);
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
      builder.setSelection(caretSelection(newId, 0));
      dispatch?.(builder.build());
      return true;
    },
  };
}

function mergeBlockCommand(): CommandEntry<{ id: BlockId }> {
  return {
    name: 'mergeBlock',
    run: (args) => (state, dispatch) => {
      const block = getBlock(state.doc, args.id);
      if (!block) return false;
      const prev = blockBefore(state.doc, args.id);
      if (!prev) return false;

      const prevText = inlineText(prev.content);
      // 直接拼接两个 InlineSeq，各自的 TextRun marks 得以保留。
      const merged: InlineSeq = [...prev.content, ...block.content];
      const builder = createTransaction();
      builder.setText(prev.id, merged);
      builder.removeBlock(args.id);
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

      // 计算新块 asAttrs：如果源块有 indent 且目标类型 schema 含 indent，则保留。
      const computeAsAttrs = (targetType: BlockType): Attrs | undefined => {
        const targetSchema = ctx.registries.schema.get(targetType);
        if (!('indent' in targetSchema.attrs)) return undefined;
        const srcIndent = block.attrs.indent;
        if (typeof srcIndent !== 'number' || srcIndent <= 0) return undefined;
        // 从默认 attrs 作为基底，然后用 srcIndent 覆盖。
        return { ...ctx.registries.schema.defaultAttrsFor(targetType), indent: srcIndent };
      };

      if (schema.listLike) {
        const asAttrs = computeAsAttrs(block.type);
        return splitBlockCommand(ctx).run({ id: block.id, offset: focus.offset, asType: block.type, ...(asAttrs ? { asAttrs } : {}) })(state, dispatch);
      }

      const asAttrs = computeAsAttrs(ctx.registries.defaultBlockType);
      return splitBlockCommand(ctx).run({ id: block.id, offset: focus.offset, ...(asAttrs ? { asAttrs } : {}) })(state, dispatch);
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
        addIndentFixupsToBuilder(state, builder, ctx);
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
        addIndentFixupsToBuilder(state, builder, ctx);
        dispatch?.(builder.build());
        return true;
      }

      // Caret mid-text: let the native contenteditable delete one char.
      if (focus.offset > 0) return false;

      // 块首且支持缩进：indent > 0 时优先减少一层缩进（比列表退出、块合并更高优先级）。
      const blockSchema = ctx.registries.schema.get(block.type);
      const hasIndentAttr = 'indent' in blockSchema.attrs;
      if (hasIndentAttr) {
        const cur = typeof block.attrs.indent === 'number' ? block.attrs.indent : 0;
        if (cur > 0) {
          return outdentBlockCommand(ctx).run({ id: block.id })(state, dispatch);
        }
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

      return mergeBlockCommand().run({ id: block.id })(state, dispatch);
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
      if (!getBlock(state.doc, args.id)) return false;
      const builder = createTransaction();
      builder.moveBlock(args.id, args.toParent, args.toIndex);
      // Normalize indent: moving a block may place it after a non-indent
      // block, or make it the first block.
      addIndentFixupsToBuilder(state, builder, ctx);
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
      addIndentFixupsToBuilder(state, builder, ctx);
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
      addIndentFixupsToBuilder(state, builder, ctx);
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
      addIndentFixupsToBuilder(state, builder, ctx);
      builder.setSelection(caretSelection(args.id, 0));
      dispatch?.(builder.build());
      return true;
    },
  };
}

/** Duplicate a block (insert its clone right after it). */
function duplicateBlockCommand(ctx: Ctx): CommandEntry<{ id: BlockId }> {
  return {
    name: 'duplicateBlock',
    run: (args) => (state, dispatch) => {
      const block = getBlock(state.doc, args.id);
      if (!block) return false;
      const attrs = ctx.registries.schema.coerceAttrsFor(block.type, block.attrs);
      const parent = parentOf(state.doc, args.id);
      const idx = indexOf(state.doc, args.id) + 1;
      const builder = createTransaction();
      builder.insertBlock({
        parent,
        index: idx,
        type: block.type,
        attrs,
        content: block.content,
      });
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
 * 增加块缩进。仅对 INDENT_TYPES 中的块类型有效。
 * 限制：前一个块必须是 INDENT_TYPES 类型或文档第一个块。
 * 缩进上限 MAX_INDENT=10。
 * args.id 可选；未指定时从 state.selection 的 focus blockId 推断（便于 keymap 直接调用）。
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
      const schema = ctx.registries.schema.get(block.type);
      if (!('indent' in schema.attrs)) return false;
      const currentIndent = typeof block.attrs.indent === 'number' ? block.attrs.indent : 0;
      if (currentIndent >= 10) return false;
      // First block cannot be indented
      const prev = blockBefore(state.doc, id);
      if (!prev) return false;
      if (!('indent' in ctx.registries.schema.get(prev.type).attrs)) return false;
      const builder = createTransaction();
      builder.setAttrs(id, { ...block.attrs, indent: currentIndent + 1 });
      dispatch?.(builder.build());
      return true;
    },
  };
}

/**
 * 减少块缩进。indent 为 0 时禁用。
 * args.id 可选；未指定时从 state.selection 的 focus blockId 推断。
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
      const schema = ctx.registries.schema.get(block.type);
      if (!('indent' in schema.attrs)) return false;
      const currentIndent = typeof block.attrs.indent === 'number' ? block.attrs.indent : 0;
      if (currentIndent <= 0) return false;
      const builder = createTransaction();
      builder.setAttrs(id, { ...block.attrs, indent: currentIndent - 1 });
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
    mergeBlockCommand(),
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
