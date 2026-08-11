/**
 * Selection helpers. Selection is part of editor state but *separate* from the
 * document (docs §8). This module provides constructors, guards, and pure
 * utilities used by commands and the view layer. It never touches the DOM —
 * native-selection sync lives in `view/dom/selectionSync.ts`.
 */

import type { Anchor, BlockId, Selection } from '../types';

export function caretSelection(blockId: BlockId, offset: number): Selection {
  return { kind: 'caret', blockId, offset };
}

export function textSelection(anchor: Anchor, focus: Anchor): Selection {
  return { kind: 'text', anchor, focus };
}

export function blocksSelection(blockIds: readonly BlockId[]): Selection {
  return { kind: 'blocks', blockIds: [...blockIds] };
}

export function isCaret(sel: Selection): sel is Extract<Selection, { kind: 'caret' }> {
  return sel.kind === 'caret';
}

export function isText(sel: Selection): sel is Extract<Selection, { kind: 'text' }> {
  return sel.kind === 'text';
}

export function isBlocks(sel: Selection): sel is Extract<Selection, { kind: 'blocks' }> {
  return sel.kind === 'blocks';
}

/** A collapsed text/caret selection targets a single offset in a single block. */
export function isCollapsed(sel: Selection): boolean {
  if (isCaret(sel)) return true;
  if (isText(sel)) {
    return sel.anchor.blockId === sel.focus.blockId && sel.anchor.offset === sel.focus.offset;
  }
  return sel.blockIds.length === 0;
}

/** The "primary" block of a selection (where commands like Enter operate). */
export function primaryBlock(sel: Selection): BlockId | null {
  if (isCaret(sel)) return sel.blockId;
  if (isText(sel)) return sel.focus.blockId;
  return sel.blockIds[0] ?? null;
}

/** The focus offset for a caret/text selection, or 0 for blocks selection. */
export function focusOffset(sel: Selection): number {
  if (isCaret(sel)) return sel.offset;
  if (isText(sel)) return sel.focus.offset;
  return 0;
}

/**
 * Normalize a selection so the anchor precedes (or equals) the focus in
 * document order. Used when computing deletion ranges for Backspace/typing
 * over a selection. Returns the [start, end] anchors in order.
 */
export function orderedAnchors(
  sel: Selection,
  compare: (a: Anchor, b: Anchor) => number,
): readonly [Anchor, Anchor] | null {
  if (!isText(sel)) return null;
  return compare(sel.anchor, sel.focus) <= 0 ? [sel.anchor, sel.focus] : [sel.focus, sel.anchor];
}
