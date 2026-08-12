<!--
  BlockContent: the per-block contenteditable component.

  This is the most delicate view-layer component. It owns a single
  `contenteditable` element and is responsible for:

    1. Rendering the block's inline content as DOM text (on mount and when the
       state changes externally — e.g. undo/redo).
    2. Syncing user input back to editor state via the `setText` command.
       Before syncing, the input-rules engine is run — if a rule matches, the
       command it fires replaces the default text sync.
    3. Correctly handling IME (Chinese/Japanese/Korean) composition: during
       composition, no state sync occurs; the DOM is the source of truth.
    4. Tracking focus (which block owns the active contenteditable).
    5. Showing a placeholder when empty.
    6. Emitting `slashTrigger` when the user types "/" so the root editor can
       open the slash menu (menu lives in BlockEditor so it can float above
       sibling blocks without being clipped by a block's overflow).
    7. Emitting `inputChanged` so the root can update the slash menu's query
       (the `/xxx` suffix) on each keystroke.

  Key invariant: we NEVER write text to the DOM while the user is typing.
  The `skipDomWrite` transaction meta + the `textContent !== newText` guard
  ensure the cursor is never reset during input.
-->

<template>
  <div
    ref="el"
    class="block-content"
    :data-block-id="block.id"
    :data-empty="isEmpty"
    :data-placeholder="placeholder"
    :contenteditable="editable"
    spellcheck="false"
    @input="onInput"
    @compositionstart="onCompositionStart"
    @compositionend="onCompositionEnd"
    @focus="onFocus"
    @blur="onBlur"
    @keydown="onKeyDownCapture"
    @click="onClick"
    @paste.prevent="onPaste"
    @copy="onCopy"
    @cut="onCut"
  />
</template>

<script setup lang="ts">
import { ref, watch, onMounted, shallowRef } from 'vue';
import type { Block, BlockId, InlineSeq } from '../core/types';
import { inlineText, splitInline } from '../core/types';
import { caretSelection } from '../core/selection/Selection';
import { useEditor, useBeginImageUpload, useEditable } from './context';
import { runInputRules, isSlashTrigger } from './ui/inputRulesEngine';
import {
  inlineToHtml,
  inlineFromDom,
  hasMarks,
  contentSignature,
  MARK_SELECTOR,
} from './inlineDom';
import { parseClipboard } from './clipboard';
import { srcToFile } from './imageUpload';
import { autoLinkInlineSeq, looksLikeUrl, normalizeUrl, sanitizeUrl } from './urlUtils';

const props = defineProps<{
  block: Block;
  /** Placeholder text shown when the block is empty. */
  placeholder?: string;
}>();

const emit = defineEmits<{
  /** Emitted when the block's text now matches a slash trigger pattern. */
  slashTrigger: [
    el: HTMLElement,
    blockId: typeof props.block.id,
    query: string,
  ];
  /** Emitted whenever the user changes the text in this block; used by the
   *  root editor to update the slash menu query if open. */
  inputChanged: [blockId: typeof props.block.id, text: string];
  /** Emitted when the user clicks a link inside this block. */
  linkClick: [blockId: typeof props.block.id, offset: number];
}>();

const editor = useEditor();
const editable = useEditable();
const el = ref<HTMLElement | null>(null);

// IME composition state. Must not sync to state during composition — the
// DOM contains intermediate text that the editor should not persist.
const isComposing = shallowRef(false);

/** Whether the block's text is empty (drives placeholder visibility). */
function computeEmpty(): boolean {
  return inlineText(props.block.content).length === 0;
}

const isEmpty = ref(computeEmpty());

// --- Lifecycle ----------------------------------------------------------

onMounted(() => {
  const node = el.value;
  if (!node) return;
  const text = inlineText(props.block.content);
  // Render content on mount — plain text if no marks, HTML if marks present.
  if (hasMarks(props.block.content)) {
    node.innerHTML = inlineToHtml(props.block.content);
  } else {
    node.textContent = text;
  }
  isEmpty.value = text.length === 0;
});

// --- State → DOM sync ---------------------------------------------------

/**
 * Capture the current selection as [startOffset, endOffset] character
 * offsets inside `node` (the focused contenteditable). Returns null if
 * there is no usable selection inside `node` (e.g. collapsed or outside).
 * Character offsets are computed as plain-text length, matching the scheme
 * used by `inlineText(...)` and the `splitInline` helpers so the result
 * survives a full `innerHTML` replacement.
 */
function captureCharSelection(node: HTMLElement): { from: number; to: number } | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!node.contains(range.commonAncestorContainer)) return null;
  const pre = document.createRange();
  pre.selectNodeContents(node);
  pre.setEnd(range.startContainer, range.startOffset);
  const from = pre.toString().length;
  pre.setEnd(range.endContainer, range.endOffset);
  const to = pre.toString().length;
  return { from: Math.min(from, to), to: Math.max(from, to) };
}

/**
 * Restore a character selection inside `node` by walking forward `offset`
 * characters through `node`'s text nodes and then placing the range.
 * If `offset` exceeds the text length the caret lands at the end.
 */
function placeCaretAtOffset(node: HTMLElement, offset: number): { node: Node; offset: number } {
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  let remaining = Math.max(0, offset);
  let lastText: Text | null = null;
  while (walker.nextNode()) {
    const t = walker.currentNode as Text;
    lastText = t;
    const len = (t.nodeValue ?? '').length;
    if (remaining <= len) return { node: t, offset: remaining };
    remaining -= len;
  }
  if (lastText) return { node: lastText, offset: (lastText.nodeValue ?? '').length };
  return { node, offset: 0 };
}

/**
 * Restore a non-collapsed character range inside `node`.
 */
function restoreCharSelection(node: HTMLElement, from: number, to: number): void {
  const sel = window.getSelection();
  if (!sel) return;
  const start = placeCaretAtOffset(node, from);
  const end = placeCaretAtOffset(node, Math.max(from, to));
  try {
    const range = document.createRange();
    if (from <= to) {
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);
    } else {
      range.setStart(end.node, end.offset);
      range.setEnd(start.node, start.offset);
    }
    sel.removeAllRanges();
    sel.addRange(range);
  } catch {
    // If the restored range is invalid for any reason, silently fall back:
    // at minimum we collapse the caret at `to` so the user still has focus.
    try {
      const fb = document.createRange();
      fb.setStart(end.node, end.offset);
      fb.collapse(true);
      sel.removeAllRanges();
      sel.addRange(fb);
    } catch {
      /* ignore */
    }
  }
}

// When the block prop changes (external mutation: undo/redo, programmatic,
// toggleMark / setInlineMark), write the new content to the DOM — but ONLY
// if it actually differs and we're not composing. This prevents the "echo"
// problem during typing.
//
// CRITICAL FIX (inline color not "sticking"): external mark commands update
// state and then this watcher replaces `node.innerHTML` with HTML that
// includes mark tags (e.g. `<span class="be-color-red">…</span>`). Replacing
// innerHTML DESTROYS the original native DOM Selection, so Chromium fires a
// synchronous `selectionchange` with a collapsed/empty range. The root
// editor then hides the HoverToolbar, and because the selection appears
// collapsed, `updateActiveColors` exits early leaving the swatches in the
// "not active" state. The user perceives this as "color was never set" even
// though the HTML now has the correct class. To fix:
//
//   1. Capture the character offsets of the selection BEFORE touching the DOM
//   2. Write `innerHTML` / `textContent`
//   3. Re-map the offsets to the *new* text nodes and re-add the range.
//
// With marks, a plain `textContent` comparison is insufficient: toggling
// bold does not change the text but DOES change the HTML. We use a
// `contentSignature` (text + marks hash) to detect mark-only changes.
watch(
  () => props.block,
  (next) => {
    if (isComposing.value) return;
    const node = el.value;
    if (!node) return;

    // Only capture/restore if this contenteditable currently owns a
    // selection. For blocks that are not focused this is pure overhead and
    // can even accidentally steal focus from other elements.
    const savedSel = captureCharSelection(node);
    const wasNonCollapsed = savedSel && savedSel.from !== savedSel.to;
    const wasFocused = document.activeElement === node;

    const text = inlineText(next.content);
    const newEmpty = text.length === 0;
    let domRewritten = false;
    if (newEmpty) {
      if (node.childNodes.length > 0) {
        node.textContent = '';
        domRewritten = true;
      }
    } else {
      const stateHasMarks = hasMarks(next.content);
      const domHasMarks = !!node.querySelector(MARK_SELECTOR);
      if (!stateHasMarks && !domHasMarks) {
        if (node.textContent !== text) {
          node.textContent = text;
          domRewritten = true;
        }
      } else {
        const domSig = contentSignature(inlineFromDom(node));
        const stateSig = contentSignature(next.content);
        if (domSig !== stateSig) {
          node.innerHTML = inlineToHtml(next.content);
          domRewritten = true;
        }
      }
    }
    isEmpty.value = newEmpty;

    // Restore the selection after DOM writes so the HoverToolbar remains
    // visible (selectionchange will see a non-collapsed range) and so the
    // user can keep applying marks without re-selecting text.
    //
    // IMPORTANT: only restore when the DOM was actually rewritten. If the
    // DOM was NOT rewritten (textContent already matched state), restoring
    // the OLD captured offsets would move the caret backwards — e.g. after
    // insertCodeBlockNewline sets textContent + caret at offset+1, this
    // watch fires (props.block updated), captures the caret at the NEW
    // position... but if a re-render already reset it, restoring the stale
    // offset clobbers the caret. When DOM is unchanged, applySelectionToDom
    // (called from BlockEditor's subscribe in nextTick) handles caret
    // placement based on the authoritative editor state selection.
    if (domRewritten && savedSel && (wasFocused || wasNonCollapsed)) {
      restoreCharSelection(node, savedSel.from, savedSel.to);
    }
  },
);

// --- DOM → state sync (input) ------------------------------------------

function onKeyDownCapture(_event: KeyboardEvent): void {
  // Enter key for isolating blocks (code blocks) is handled centrally in
  // BlockEditor.onKeyDown, NOT here. This avoids event-propagation issues
  // and competing transactions (syncSelectionFromDom + dispatchKeymap).
  //
  // Code blocks use `isolating: true` so enterCommand returns false. After
  // that, BlockEditor.onKeyDown detects the isolating block and dispatches
  // a setText transaction to insert "\n" at the caret offset. The view
  // layer's normal update flow (watch + applySelectionToDom) then updates
  // the DOM and places the caret.
}

function onInput(event: InputEvent): void {
  // Read-only: ignore any stray input events (e.g. during prop transition).
  if (!editable.value) return;
  const node = el.value;
  if (!node) return;
  // Extract InlineSeq (text + marks) from the live DOM. This preserves
  // bold/italic/etc. marks that the user applied via the hover toolbar.
  const seq = inlineFromDom(node);
  const text = inlineText(seq);
  isEmpty.value = text.length === 0;

  // Notify root editor of the change (slash menu uses this for the query).
  emit('inputChanged', props.block.id, text);

  if (isComposing.value) return;

  // 1. Input rules first (markdown shortcuts etc.) — a rule that fires
  //    already produces a transaction, so we skip the default setText.
  const handled = runInputRules({
    editor,
    registry: editor.registries.inputRules,
    blockId: props.block.id,
    text,
    composing: false,
  });
  if (handled) return;

  // 2. Slash trigger? If so, let the root open the menu, but still write
  //    the text to state so the `/xxx` prefix is preserved and searchable.
  if (isSlashTrigger(text)) {
    // Compute query: the part of the text after the LAST leading `/`.
    const m = text.match(/\/([^/]*)$/);
    const lastSlash = text.lastIndexOf('/');
    const query = m && m[1] !== undefined
      ? m[1]
      : lastSlash >= 0
        ? text.slice(lastSlash + 1)
        : '';
    emit('slashTrigger', node, props.block.id, query);
  }

  // 3. Auto-link URLs when a whitespace was just typed (the URL is
  //    "complete"). This avoids mid-typing false positives.
  let finalSeq = seq;
  const schema = editor.registries.schema.get(props.block.type);
  if (schema.inlineMarks && event.data && /\s/.test(event.data)) {
    finalSeq = autoLinkInlineSeq(seq);
  }

  // 4. Default: sync the inline content (with marks) to state.
  editor.commands.setText?.({
    id: props.block.id,
    content: finalSeq,
  });
}

// --- IME ---------------------------------------------------------------

function onCompositionStart(_event: CompositionEvent): void {
  isComposing.value = true;
}

function onCompositionEnd(_event: CompositionEvent): void {
  isComposing.value = false;
  // After composition ends, sync the final content (with marks) to state.
  const node = el.value;
  if (!node) return;
  const seq = inlineFromDom(node);
  const text = inlineText(seq);
  isEmpty.value = text.length === 0;
  emit('inputChanged', props.block.id, text);
  // Auto-link URLs after IME composition (e.g. Chinese input ended with space).
  const schema = editor.registries.schema.get(props.block.type);
  const finalSeq = schema.inlineMarks ? autoLinkInlineSeq(seq) : seq;
  editor.commands.setText?.({
    id: props.block.id,
    content: finalSeq,
  });
}

// --- Copy / Cut --------------------------------------------------------

/**
 * Read the current DOM selection offsets within this block's contenteditable.
 * Returns [from, to] character offsets, clamped to [0, fullText.length].
 * If the selection is outside this block, returns null.
 */
function readSelectionOffsets(): [number, number] | null {
  const node = el.value;
  if (!node) return null;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!node.contains(range.commonAncestorContainer)) return null;

  const fullText = inlineText(props.block.content);
  const preRange = document.createRange();
  preRange.selectNodeContents(node);
  preRange.setEnd(range.startContainer, range.startOffset);
  const from = Math.min(preRange.toString().length, fullText.length);
  preRange.setEnd(range.endContainer, range.endOffset);
  const to = Math.min(preRange.toString().length, fullText.length);
  return [Math.min(from, to), Math.max(from, to)];
}

/**
 * Intercept copy to write clean clipboard data from the editor's inline model,
 * NOT the browser's default contenteditable DOM serialization (which adds
 * extra <br>, <div> wrappers, and trailing newlines).
 */
function onCopy(event: ClipboardEvent): void {
  const offsets = readSelectionOffsets();
  if (!offsets) return;
  const [lo, hi] = offsets;
  if (lo === hi) return; // collapsed selection — let browser handle

  // Extract the selected inline content: [0, lo) | [lo, hi) | [hi, end)
  const [, rest1] = splitInline(props.block.content, lo);
  const [selected] = splitInline(rest1, hi - lo);
  const text = inlineText(selected);
  const html = inlineToHtml(selected);

  event.preventDefault();
  event.clipboardData?.setData('text/plain', text);
  event.clipboardData?.setData('text/html', html);
}

/**
 * Cut = copy clean data, then delete the selected range from the block.
 */
function onCut(event: ClipboardEvent): void {
  // Read-only: cutting would delete content — block it entirely.
  if (!editable.value) {
    event.preventDefault();
    return;
  }
  const offsets = readSelectionOffsets();
  if (!offsets) return;
  const [lo, hi] = offsets;
  if (lo === hi) return; // collapsed — let browser handle

  // Extract the selected inline content and the remainder after it.
  const [before, rest1] = splitInline(props.block.content, lo);
  const [selected, after] = splitInline(rest1, hi - lo);
  const text = inlineText(selected);
  const html = inlineToHtml(selected);

  event.preventDefault();
  event.clipboardData?.setData('text/plain', text);
  event.clipboardData?.setData('text/html', html);

  // Delete the selected range: keep only [0, lo) + [hi, end).
  editor.commands.setText?.({
    id: props.block.id,
    content: [...before, ...after],
    selectionAfter: caretSelection(props.block.id, lo),
  });
}

// --- Paste -------------------------------------------------------------

const beginImageUpload = useBeginImageUpload();

function collectImageFilesFromClipboard(data: DataTransfer): File[] {
  const files: File[] = [];
  const seen = new Set<string>();

  // Channel 1: `items` (supports DataTransferItem with kind='file')
  if (data.items && data.items.length > 0) {
    for (let i = 0; i < data.items.length; i++) {
      const item = data.items[i]!;
      if (item.kind !== 'file') continue;
      const f = item.getAsFile();
      if (!f || !f.type.startsWith('image/')) continue;
      const key = `${f.name || ''}:${f.size}:${f.type}`;
      if (seen.has(key)) continue;
      seen.add(key);
      files.push(f);
    }
  }

  // Channel 2: `files` (fallback — sometimes only one or the other is
  // populated, depending on the browser / paste source).
  if (data.files && data.files.length > 0) {
    for (let i = 0; i < data.files.length; i++) {
      const f = data.files[i]!;
      if (!f.type.startsWith('image/')) continue;
      const key = `${f.name || ''}:${f.size}:${f.type}`;
      if (seen.has(key)) continue;
      seen.add(key);
      files.push(f);
    }
  }

  return files;
}

async function onPaste(event: ClipboardEvent): Promise<void> {
  // Read-only: no pasting — preventDefault also stops any default browser
  // paste behavior on the (non-editable) element.
  if (!editable.value) {
    event.preventDefault();
    return;
  }
  const data = event.clipboardData;
  if (!data) return;

  // Priority 1: image files in clipboard — take these FIRST, because a
  // screenshot paste has BOTH an image/file and an html/text representation
  // (e.g. `<img src="blob:...">`). We prefer the File because it lets the
  // upload pipeline handle it end-to-end (including the optional external
  // `uploadImage` prop).
  if (beginImageUpload) {
    const imageFiles = collectImageFilesFromClipboard(data);
    if (imageFiles.length > 0) {
      event.preventDefault();
      // Insert images sequentially: each subsequent image is placed AFTER
      // the previous image block so the insertion order matches the paste
      // order.
      let lastBlockId: BlockId | null = props.block.id;
      for (let i = 0; i < imageFiles.length; i++) {
        const file = imageFiles[i]!;
        const bid = await beginImageUpload(file, {
          relativeToBlockId: lastBlockId,
          // For the first file, try to convert an empty paragraph in-place;
          // afterwards always insert after the last produced block.
          convertIfEmpty: i === 0,
          position: 'after',
        });
        if (bid) lastBlockId = bid;
      }
      return;
    }
  }

  const html = data.getData('text/html');
  const plainText = data.getData('text/plain');
  const blocks = parseClipboard(html || null, plainText || null);
  if (blocks.length === 0) return;

  // Check whether the parsed content contains any image blocks (from
  // <img> tags in pasted rich HTML). If so, we need a different insertion
  // strategy: text blocks are inserted normally, but image blocks are
  // converted to File objects (via fetch for URLs, direct parse for
  // data:/blob: URIs) and uploaded through the normal upload pipeline.
  const hasImageBlocks = blocks.some((b) => b.type === 'image');

  // Get current selection offsets within this block (fallback to end).
  const offsets = readSelectionOffsets();
  const fullLen = inlineText(props.block.content).length;
  const lo = offsets ? offsets[0] : fullLen;
  const hi = offsets ? offsets[1] : fullLen;
  const [before] = splitInline(props.block.content, lo);
  const [, after] = splitInline(props.block.content, hi);

  // If current block disallows inline marks, strip marks from pasted content.
  const schema = editor.registries.schema.get(props.block.type);
  const sanitize = (seq: InlineSeq): InlineSeq =>
    schema.inlineMarks ? seq : seq.map((n) => ({ type: 'text' as const, text: n.text }));

  // --- Text-only paste (no images) → existing fast path ---
  if (!hasImageBlocks) {
    if (blocks.length === 1) {
      const pastedContent = sanitize(blocks[0]!.content);

      // Auto-link: if there's a selection (lo < hi) and the pasted content
      // is a single plain-text run that looks like a URL, apply a link mark
      // to the SELECTED TEXT (not replace it) using the pasted URL as href.
      if (
        schema.inlineMarks
        && lo < hi
        && pastedContent.length === 1
        && pastedContent[0]!.type === 'text'
        && !pastedContent[0]!.marks
      ) {
        const pastedText = pastedContent[0]!.text;
        if (looksLikeUrl(pastedText)) {
          const normalized = normalizeUrl(pastedText);
          const safe = sanitizeUrl(normalized);
          if (safe) {
            editor.commands.setLink?.({
              id: props.block.id,
              href: safe,
              from: lo,
              to: hi,
            });
            return;
          }
        }
      }

      const newContent = [...before, ...pastedContent, ...after];
      // Auto-link URLs in the pasted content.
      const linkedContent = schema.inlineMarks ? autoLinkInlineSeq(newContent) : newContent;
      const beforeChars = inlineText(before).length;
      const pastedChars = inlineText(pastedContent).length;
      const caretOffset = beforeChars + pastedChars;
      editor.commands.setText?.({
        id: props.block.id,
        content: linkedContent,
        selectionAfter: caretSelection(props.block.id, caretOffset),
      });
      return;
    }

    // Multi-line: first line → current block, remaining → new blocks.
    const firstContent = [...before, ...sanitize(blocks[0]!.content)];
    editor.commands.setText?.({ id: props.block.id, content: firstContent });

    let prevId = props.block.id;
    for (let i = 1; i < blocks.length; i++) {
      const b = blocks[i]!;
      const isLast = i === blocks.length - 1;
      const sanitized = sanitize(b.content);
      const content = isLast
        ? [...sanitized, ...after]
        : sanitized;

      const coercedAttrs = editor.registries.schema.coerceAttrsFor(
        b.type,
        b.attrs,
      );

      editor.commands.insertBlock?.({
        after: prevId,
        type: b.type,
        attrs: coercedAttrs,
        content,
      });

      const state = editor.getState();
      if (state.selection.kind === 'caret') {
        prevId = state.selection.blockId;
      }

      if (isLast) {
        const pastedChars = inlineText(sanitized).length;
        const targetOffset = after.length > 0
          ? pastedChars
          : inlineText(content).length;
        editor.commands.setSelection?.({
          selection: caretSelection(prevId, targetOffset),
        });
      }
    }
    return;
  }

  // --- Mixed content (text + images) ---
  //
  // Strategy: process blocks in document order. The first TEXT block is
  // merged into the current block (with [before]). Each subsequent block —
  // text or image — is inserted after the previous one. The [after] text
  // from the current block's selection is appended to the last TEXT block,
  // or becomes a trailing paragraph if the last block is an image.
  //
  // Image blocks: the <img src="..."> value is converted to a File via
  // srcToFile (fetch for http/blob URIs, base64-decode for data: URIs).
  // The File is then handed to beginImageUpload, which runs it through
  // the normal upload pipeline (uploadImage prop or mock upload).

  if (!beginImageUpload) {
    // No upload handler available — strip image blocks and treat as
    // text-only paste (images are silently dropped).
    const textOnly = blocks.filter((b) => b.type !== 'image');
    if (textOnly.length === 0) return;
    // Re-run with text-only blocks by recursively calling without images.
    // Simplest: just insert text blocks using the multi-block path above.
    // We do this by setting blocks to textOnly and falling through.
    // (This is a rare edge case — typically beginImageUpload is always
    // provided when image extension is active.)
    blocks.splice(0, blocks.length, ...textOnly);
    // Fall through to the text-only path by re-checking.
    // But we already returned above for text-only... so just return here
    // after inserting the first text block inline.
    if (blocks.length === 1) {
      const pastedContent = sanitize(blocks[0]!.content);
      const newContent = [...before, ...pastedContent, ...after];
      editor.commands.setText?.({
        id: props.block.id,
        content: newContent,
        selectionAfter: caretSelection(props.block.id, inlineText(before).length + inlineText(pastedContent).length),
      });
    }
    return;
  }

  // Separate the trailing [after] text: it will be appended to the last
  // text block, or become its own paragraph if the last block is an image.
  // Find the index of the last text block.
  let lastTextIdx = -1;
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (blocks[i]!.type !== 'image') {
      lastTextIdx = i;
      break;
    }
  }

  // Process first block — it merges into the current block if it's text.
  let prevId: BlockId | null = props.block.id;
  const firstBlock = blocks[0]!;

  if (firstBlock.type !== 'image') {
    // First text block → merge into current block with [before].
    const isFirstAlsoLast = lastTextIdx === 0;
    const content = isFirstAlsoLast
      ? [...before, ...sanitize(firstBlock.content), ...after]
      : [...before, ...sanitize(firstBlock.content)];
    editor.commands.setText?.({ id: props.block.id, content });
    prevId = props.block.id;
  } else {
    // First block is an image.
    const currentIsEmpty = before.length === 0 && after.length === 0;
    const imgSrc = (firstBlock.attrs as { src: string }).src;
    const imgAlt = (firstBlock.attrs as { alt?: string }).alt ?? '';
    if (currentIsEmpty) {
      // Current block is empty → replace it with the image block.
      const file = await srcToFile(imgSrc, imgAlt || undefined);
      if (file) {
        const bid = await beginImageUpload(file, {
          relativeToBlockId: prevId,
          position: 'after',
          convertIfEmpty: true,
        });
        if (bid) prevId = bid;
      } else {
        const coercedAttrs = editor.registries.schema.coerceAttrsFor(
          firstBlock.type,
          firstBlock.attrs,
        );
        editor.commands.replaceBlock?.({
          id: props.block.id,
          type: firstBlock.type,
          attrs: coercedAttrs,
        });
        prevId = props.block.id;
      }
    } else {
      // Current block has content → keep it, insert image after.
      editor.commands.setText?.({ id: props.block.id, content: before });
      const file = await srcToFile(imgSrc, imgAlt || undefined);
      if (file) {
        const bid = await beginImageUpload(file, {
          relativeToBlockId: prevId,
          position: 'after',
          convertIfEmpty: false,
        });
        if (bid) prevId = bid;
      } else {
        const coercedAttrs = editor.registries.schema.coerceAttrsFor(
          firstBlock.type,
          firstBlock.attrs,
        );
        editor.commands.insertBlock?.({
          after: prevId,
          type: firstBlock.type,
          attrs: coercedAttrs,
          content: [],
        });
        const state = editor.getState();
        if (state.selection.kind === 'caret') prevId = state.selection.blockId;
      }
    }
  }

  // Process remaining blocks (index 1..N).
  for (let i = 1; i < blocks.length; i++) {
    const b = blocks[i]!;
    const isLastText = i === lastTextIdx;

    if (b.type === 'image') {
      const imgSrc = (b.attrs as { src: string }).src;
      const imgAlt = (b.attrs as { alt?: string }).alt ?? '';
      const file = await srcToFile(imgSrc, imgAlt || undefined);
      if (file) {
        const bid = await beginImageUpload(file, {
          relativeToBlockId: prevId,
          position: 'after',
          convertIfEmpty: false,
        });
        if (bid) prevId = bid;
      } else {
        const coercedAttrs = editor.registries.schema.coerceAttrsFor(
          b.type,
          b.attrs,
        );
        editor.commands.insertBlock?.({
          after: prevId,
          type: b.type,
          attrs: coercedAttrs,
          content: [],
        });
        const state = editor.getState();
        if (state.selection.kind === 'caret') prevId = state.selection.blockId;
      }
    } else {
      // Text block → insertBlock.
      const sanitized = sanitize(b.content);
      const content = isLastText
        ? [...sanitized, ...after]
        : sanitized;

      const coercedAttrs = editor.registries.schema.coerceAttrsFor(
        b.type,
        b.attrs,
      );

      editor.commands.insertBlock?.({
        after: prevId!,
        type: b.type,
        attrs: coercedAttrs,
        content,
      });

      const state = editor.getState();
      if (state.selection.kind === 'caret') {
        prevId = state.selection.blockId;
      }

      if (isLastText) {
        const pastedChars = inlineText(sanitized).length;
        const targetOffset = after.length > 0
          ? pastedChars
          : inlineText(content).length;
        editor.commands.setSelection?.({
          selection: caretSelection(prevId!, targetOffset),
        });
      }
    }
  }

  // If the last block was an image (no trailing text block), insert [after]
  // as a new paragraph so the user can continue typing.
  if (lastTextIdx === -1 && after.length > 0) {
    editor.commands.insertBlock?.({
      after: prevId!,
      type: 'paragraph' as const,
      attrs: {},
      content: after,
    });
    const state = editor.getState();
    if (state.selection.kind === 'caret') {
      prevId = state.selection.blockId;
      editor.commands.setSelection?.({
        selection: caretSelection(prevId, inlineText(after).length),
      });
    }
  } else if (lastTextIdx === -1 && (before.length > 0 || after.length > 0)) {
    // No after text and last block was image, but current block had
    // content → insert empty paragraph so user can continue typing.
    editor.commands.insertBlock?.({
      after: prevId!,
      type: 'paragraph' as const,
      attrs: {},
      content: [],
    });
  }
}

// --- Focus tracking ----------------------------------------------------

function onFocus(): void {
  editor.focusBlockId = props.block.id;
}

function onBlur(): void {
  if (editor.focusBlockId === props.block.id) {
    editor.focusBlockId = null;
  }
}

// --- Link click handling -------------------------------------------------

/** First text node inside `root`, or null if the subtree has none. */
function firstTextNodeIn(root: Node): Node | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  return walker.nextNode();
}

function onClick(event: MouseEvent): void {
  const target = event.target as HTMLElement | null;
  if (!target) return;
  // Check if the click is on an <a> element inside the block.
  const anchor = target.closest('a');
  if (!anchor) return;
  // Only handle clicks on links that are inside this block (not nested
  // components like image captions).
  if (!el.value?.contains(anchor)) return;

  // Prevent the browser from navigating (we show a popover instead).
  event.preventDefault();

  // Calculate the character offset of the click within the block.
  //
  // Only trust the DOM selection when it lies INSIDE the clicked <a> —
  // only then was it produced by this very click. A stale selection from a
  // previous edit session (common in read-only mode: clicking a link inside
  // contenteditable=false creates no new selection) may sit anywhere in the
  // block, so using it would produce an offset unrelated to the clicked
  // link and findLinkAtOffset() would miss. In that case fall back to
  // locating the link element itself: offset = text length before the
  // link's first text node (equal to the link run's start offset, which is
  // guaranteed to be covered by the link mark).
  const sel = window.getSelection();
  let offset = 0;
  const selInAnchor = sel && sel.rangeCount > 0
    && !!anchor.contains(sel.getRangeAt(0).commonAncestorContainer);
  if (selInAnchor) {
    const range = sel!.getRangeAt(0);
    const preRange = document.createRange();
    preRange.selectNodeContents(el.value);
    preRange.setEnd(range.startContainer, range.startOffset);
    offset = preRange.toString().length;
  } else {
    const firstText = firstTextNodeIn(anchor);
    if (firstText) {
      const preRange = document.createRange();
      preRange.selectNodeContents(el.value);
      preRange.setEnd(firstText, 0);
      offset = preRange.toString().length;
    }
  }

  emit('linkClick', props.block.id, offset);
}
</script>
