/**
 * DOM selection ↔ editor state selection sync.
 *
 * The native browser selection (window.getSelection) operates on DOM nodes and
 * ranges. The editor's selection model operates on block ids + character
 * offsets. This module bridges the two.
 *
 * Strategy for Phase 1 (flat blocks, text-only content):
 *  - Each contenteditable element carries `data-block-id`.
 *  - Character offsets are computed by walking text nodes within the element.
 *  - Selection sync is **just-in-time**: we read the DOM selection before
 *    dispatching a command, and write it back after a state update changes
 *    the selection. We do NOT listen to `selectionchange` — that event fires
 *    too often and creates feedback loops.
 *
 * See docs/editor-architecture.md §8.2 (selection sync).
 */

import type { BlockId, Selection, DocState  } from '../core/types';
import { caretSelection, isCaret, isText } from '../core/selection/Selection';
import { inlineText } from '../core/types';
import { flatten as flattenDoc } from '../core/state/store';

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

/** Selector for a block's contenteditable element by block id. */
const BLOCK_SELECTOR = (id: BlockId) => `[data-block-id="${CSS.escape(id)}"]`;

/**
 * Find the contenteditable element for a block id within the editor root.
 *
 * The `data-block-id` attr appears BOTH on the outer `.block-host` wrapper AND
 * on the inner contenteditable (BlockContent), so a plain querySelector returns
 * the wrapper first. We must prefer the contenteditable editing element:
 * focusing/placing the caret in the wrapper (a non-editable div) silences the
 * blinking caret for EMPTY blocks (no text node to walk to). Non-text blocks
 * (image/table/divider/TOC) have no inner contenteditable, so we fall back to
 * the host wrapper for hit-testing / scroll-into-view.
 */
export function findBlockEl(root: HTMLElement, id: BlockId): HTMLElement | null {
  const base = BLOCK_SELECTOR(id);
  const editable = root.querySelector<HTMLElement>(`${base}[contenteditable], ${base} [contenteditable]`);
  if (editable) return editable;
  return root.querySelector<HTMLElement>(base);
}

// ---------------------------------------------------------------------------
// Read: DOM → state
// ---------------------------------------------------------------------------

/**
 * Read the character offset of the caret within a contenteditable element.
 * Walks text nodes to accumulate character counts, so it works even when the
 * DOM has multiple text nodes (common after IME composition).
 */
function caretOffsetWithin(el: HTMLElement): number {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return 0;

  const range = sel.getRangeAt(0);
  // Clone the range and collapse it to the focus point.
  const pre = range.cloneRange();
  pre.selectNodeContents(el);
  pre.setEnd(range.endContainer, range.endOffset);
  return pre.toString().length;
}

/**
 * Read the native selection and convert it to an editor `Selection`.
 * Returns `null` if the selection is not within a block element inside `root`.
 */
export function readDomSelection(root: HTMLElement, doc: DocState): Selection | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;

  // Phase 1: only caret/collapsed selections within a single block.
  // Text selections across blocks will be handled in Phase 5.
  const endEl = sel.getRangeAt(0).endContainer as HTMLElement | Text;
  const blockEl = findBlockAncestor(endEl, root);
  if (!blockEl) return null;

  const blockId = blockEl.dataset.blockId;
  if (!blockId) return null;

  const offset = caretOffsetWithin(blockEl);
  const block = doc.blocks.get(blockId as BlockId);
  if (!block) return null;

  // Clamp to text length (DOM may have trailing <br> that inflates the offset).
  const maxOffset = inlineText(block.content).length;
  const clampedOffset = Math.min(offset, maxOffset);

  // For a non-collapsed selection within the same block, produce a text selection.
  if (!sel.isCollapsed && sel.anchorNode === sel.focusNode) {
    const anchorEl = findBlockAncestor(sel.anchorNode as HTMLElement | Text, root);
    if (anchorEl === blockEl) {
      const anchorOffset = Math.min(sel.anchorOffset, maxOffset);
      return {
        kind: 'text',
        anchor: { blockId: blockId as BlockId, offset: anchorOffset },
        focus: { blockId: blockId as BlockId, offset: clampedOffset },
      };
    }
  }

  return caretSelection(blockId as BlockId, clampedOffset);
}

/** Walk up from a node to find the nearest element with `data-block-id`. */
export function findBlockAncestor(node: Node, root: HTMLElement): HTMLElement | null {
  let el: Node | null = node;
  while (el && el !== root) {
    if (el.nodeType === Node.ELEMENT_NODE) {
      const elem = el as HTMLElement;
      if (elem.dataset && elem.dataset.blockId) return elem;
    }
    el = el.parentNode;
  }
  return null;
}

/**
 * Resolve a DOM node + offset within `el` to a character offset by walking
 * text nodes. Inverse of `setCaretInElement`.
 */
function offsetOfNode(el: HTMLElement, node: Node, offset: number): number {
  const pre = document.createRange();
  pre.selectNodeContents(el);
  try {
    pre.setEnd(node, offset);
  } catch {
    return 0;
  }
  return pre.toString().length;
}

/**
 * Create a DOM Range covering [startOffset, endOffset) within a block's
 * contenteditable element. Used for hit-testing and overlay rendering.
 */
export function rangeFromOffsets(
  el: HTMLElement,
  startOffset: number,
  endOffset: number,
): Range | null {
  const start = nodeAtOffset(el, startOffset);
  const end = nodeAtOffset(el, endOffset);
  if (!start || !end) return null;
  try {
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    return range;
  } catch {
    return null;
  }
}

/** Find the DOM node + sub-offset for a character offset within `el`. */
function nodeAtOffset(el: HTMLElement, offset: number): { node: Node; offset: number } | null {
  let charCount = 0;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let lastText: Text | null = null;
  while (walker.nextNode()) {
    const t = walker.currentNode as Text;
    lastText = t;
    const len = (t.nodeValue ?? '').length;
    if (charCount + len >= offset) {
      return { node: t, offset: Math.max(0, offset - charCount) };
    }
    charCount += len;
  }
  if (lastText) return { node: lastText, offset: (lastText.nodeValue ?? '').length };
  return { node: el, offset: 0 };
}

export interface HitTestResult {
  blockEl: HTMLElement;
  blockId: BlockId;
  offset: number;
}

/**
 * Hit-test a viewport coordinate against the editor's block content elements.
 * Returns the block id + character offset under the point, or null if the
 * point is not over a block's contenteditable inside `root`.
 */
export function positionFromPoint(
  x: number,
  y: number,
  root: HTMLElement,
  doc: DocState,
): HitTestResult | null {
  // caretRangeFromPoint is Chromium/Webkit; caretPositionFromPoint is Firefox.
  let range: Range | null = null;
  const anyDoc = document as unknown as {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  if (typeof anyDoc.caretRangeFromPoint === 'function') {
    range = anyDoc.caretRangeFromPoint(x, y);
  } else if (typeof anyDoc.caretPositionFromPoint === 'function') {
    const pos = anyDoc.caretPositionFromPoint(x, y);
    if (pos) {
      range = document.createRange();
      range.setStart(pos.offsetNode, pos.offset);
      range.collapse(true);
    }
  }
  if (!range) return null;
  const blockEl = findBlockAncestor(range.startContainer, root);
  if (!blockEl) return null;
  const blockId = blockEl.dataset.blockId;
  if (!blockId) return null;
  const block = doc.blocks.get(blockId as BlockId);
  if (!block) return null;
  const maxOffset = inlineText(block.content).length;
  const offset = Math.min(offsetOfNode(blockEl, range.startContainer, range.startOffset), maxOffset);
  return { blockEl, blockId: blockId as BlockId, offset };
}

// ---------------------------------------------------------------------------
// Write: state → DOM
// ---------------------------------------------------------------------------

/**
 * Place the caret at `offset` within a block's contenteditable element.
 * If the offset exceeds the text length, the caret is placed at the end.
 */
function setCaretInElement(el: HTMLElement, offset: number): void {
  const range = document.createRange();
  const sel = window.getSelection();
  if (!sel) return;

  let charCount = 0;
  let placed = false;

  const walk = (node: Node): void => {
    if (placed) return;
    if (node.nodeType === Node.TEXT_NODE) {
      const len = node.textContent?.length ?? 0;
      if (charCount + len >= offset) {
        range.setStart(node, Math.max(0, offset - charCount));
        range.collapse(true);
        placed = true;
      }
      charCount += len;
    } else {
      for (const child of node.childNodes) walk(child);
    }
  };

  walk(el);

  if (!placed) {
    // Offset is at or past the end: place caret at the end.
    range.selectNodeContents(el);
    range.collapse(false);
  }

  sel.removeAllRanges();
  sel.addRange(range);
}

/**
 * Apply an editor selection to the DOM. Focuses the target block's
 * contenteditable and places the caret. For Phase 1, only caret and
 * single-block text selections are handled.
 *
 * Cross-block text selections are NOT applied to the native Selection (the
 * browser cannot represent a selection spanning multiple contenteditable
 * elements). The view layer renders them via an overlay instead.
 */
export function applySelectionToDom(root: HTMLElement, selection: Selection): void {
  if (isCaret(selection)) {
    const el = findBlockEl(root, selection.blockId);
    if (!el) return;
    el.focus();
    setCaretInElement(el, selection.offset);
    return;
  }

  if (isText(selection) && selection.anchor.blockId === selection.focus.blockId) {
    const el = findBlockEl(root, selection.focus.blockId);
    if (!el) return;
    el.focus();
    if (selection.anchor.offset === selection.focus.offset) {
      setCaretInElement(el, selection.focus.offset);
    } else {
      const lo = Math.min(selection.anchor.offset, selection.focus.offset);
      const hi = Math.max(selection.anchor.offset, selection.focus.offset);
      const range = rangeFromOffsets(el, lo, hi);
      const ns = window.getSelection();
      if (range && ns) {
        ns.removeAllRanges();
        ns.addRange(range);
      } else {
        setCaretInElement(el, selection.focus.offset);
      }
    }
    return;
  }

  // Cross-block text selection or block selection: clear the native selection.
  // Visual highlighting is rendered by the overlay layer in BlockEditor.vue.
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0) sel.removeAllRanges();
}

/**
 * Whether a text selection spans more than one block (and thus requires the
 * overlay renderer instead of the native Selection API).
 */
export function isCrossBlockText(sel: Selection): boolean {
  return (
    sel.kind === 'text'
    && !(
      sel.anchor.blockId === sel.focus.blockId
      && sel.anchor.offset === sel.focus.offset
    )
    && sel.anchor.blockId !== sel.focus.blockId
  );
}

/**
 * Compute the viewport-space rectangles covering the visible characters in a
 * cross-block text selection. Used by the overlay renderer.
 *
 * The selection is split into three regions:
 *   - start block: [start.offset, endOfBlock)
 *   - fully-covered middle blocks: [0, endOfBlock)
 *   - end block: [0, end.offset)
 * When start === end block (single-block text selection handled by the native
 * Selection API), this returns an empty array.
 */
export function crossBlockSelectionRects(
  root: HTMLElement,
  doc: DocState,
  sel: Extract<Selection, { kind: 'text' }>,
): DOMRect[] {
  if (sel.anchor.blockId === sel.focus.blockId) return [];
  const flat = flattenDoc(doc);
  const ia = flat.indexOf(sel.anchor.blockId);
  const ib = flat.indexOf(sel.focus.blockId);
  if (ia === -1 || ib === -1) return [];
  const [startId, endId, forward] = ia <= ib
    ? [sel.anchor.blockId, sel.focus.blockId, ia < ib]
    : [sel.focus.blockId, sel.anchor.blockId, ia > ib];
  void forward;
  const startIdx = flat.indexOf(startId);
  const endIdx = flat.indexOf(endId);
  if (startIdx === -1 || endIdx === -1) return [];

  const rects: DOMRect[] = [];
  for (let i = startIdx; i <= endIdx; i++) {
    const id = flat[i]!;
    const block = doc.blocks.get(id);
    if (!block) continue;
    const el = findBlockEl(root, id);
    if (!el) continue;
    const textLen = inlineText(block.content).length;
    let lo = 0;
    let hi = textLen;
    if (i === startIdx) {
      const anchorOffset = startId === sel.anchor.blockId ? sel.anchor.offset : sel.focus.offset;
      lo = Math.min(anchorOffset, textLen);
    }
    if (i === endIdx) {
      const endOffset = endId === sel.anchor.blockId ? sel.anchor.offset : sel.focus.offset;
      hi = Math.min(endOffset, textLen);
    }
    if (lo >= hi && !(i === startIdx && i === endIdx)) {
      // Empty range within a fully-covered block shouldn't happen, but guard.
      // For the start/end blocks, lo > hi means the anchor is past the focus
      // within the same block — handled by the single-block path.
    }
    const range = rangeFromOffsets(el, lo, Math.max(lo, hi));
    if (!range) continue;
    for (const r of range.getClientRects()) {
      if (r.width > 0 && r.height > 0) rects.push(r);
    }
  }
  return rects;
}
