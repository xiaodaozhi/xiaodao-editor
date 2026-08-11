/**
 * Clipboard parsing: converts pasted HTML or plain text into an array of
 * block specs ({ type, attrs, content }) that the editor can insert.
 *
 * Only supported block types and inline marks are preserved; everything else
 * is stripped. Multi-line text automatically produces multiple blocks.
 */

import type { Attrs, BlockType, InlineSeq } from '../core/types';
import { inlineFromString } from '../core/types';
import { inlineFromDom } from './inlineDom';

export interface ParsedBlock {
  readonly type: BlockType;
  readonly attrs: Attrs;
  readonly content: InlineSeq;
}

const TRUE_BLOCK_TAGS = new Set([
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'li', 'pre', 'blockquote', 'hr', 'tr', 'table-row',
]);

const HEADING_LEVELS: Record<string, number> = {
  h1: 1, h2: 2, h3: 3, h4: 4, h5: 5, h6: 6,
};

const SKIP_TAGS = new Set(['meta', 'style', 'script', 'head', 'title', 'link', 'object', 'embed']);

/**
 * Extract image information from an <img> element.
 * Returns { src, alt, title } or null if the element has no usable src.
 */
function extractImageAttrs(img: HTMLImageElement): { src: string; alt: string; title: string } | null {
  const rawSrc = (img.getAttribute('src') ?? '').trim();
  if (!rawSrc) return null;
  // Skip extremely long data URIs that are clearly not images (e.g. SVG
  // embedded as data: — those are rare in clipboard but would be huge).
  // Normal image data URIs are fine.
  return {
    src: rawSrc,
    alt: (img.getAttribute('alt') ?? '').trim(),
    title: (img.getAttribute('title') ?? '').trim(),
  };
}

function isTrueBlock(tag: string): boolean {
  return TRUE_BLOCK_TAGS.has(tag) || tag in HEADING_LEVELS;
}

/**
 * Parse clipboard content into an array of block specs.
 * Prefers HTML; falls back to plain text.
 */
export function parseClipboard(html: string | null, plainText: string | null): ParsedBlock[] {
  if (html) {
    const blocks = parseHtml(html);
    if (blocks.length > 0) return blocks;
  }
  if (plainText) {
    return parsePlainText(plainText);
  }
  return [];
}

function inlineTextLen(seq: InlineSeq): number {
  let n = 0;
  for (const r of seq) if (r.type === 'text') n += r.text.length;
  return n;
}

/**
 * Trim leading/trailing whitespace from the edges of an InlineSeq.
 * Only the first and last text runs are affected; interior whitespace
 * is preserved. This removes stray \r\n that browsers inject when
 * reformatting clipboard HTML (e.g. wrapping content in <!--StartFragment-->
 * markers with newlines around the actual text).
 */
function trimInlineSeqEdges(seq: InlineSeq): InlineSeq {
  if (seq.length === 0) return seq;
  const result = [...seq];
  // Trim leading whitespace from the first text run(s).
  while (result.length > 0) {
    const first = result[0]!;
    if (first.type !== 'text') break;
    const trimmed = first.text.replace(/^[\s\r\n]+/, '');
    if (trimmed === first.text) break;
    if (trimmed.length === 0) result.shift();
    else {
      result[0] = { ...first, text: trimmed };
      break;
    }
  }
  // Trim trailing whitespace from the last text run(s).
  while (result.length > 0) {
    const last = result[result.length - 1]!;
    if (last.type !== 'text') break;
    const trimmed = last.text.replace(/[\s\r\n]+$/, '');
    if (trimmed === last.text) break;
    if (trimmed.length === 0) result.pop();
    else {
      result[result.length - 1] = { ...last, text: trimmed };
      break;
    }
  }
  return result;
}

/**
 * Trim leading/trailing whitespace from each block's inline content.
 * Code blocks are skipped — whitespace is significant there.
 */
function trimBlockEdges(blocks: ParsedBlock[]): void {
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]!;
    if (b.type === 'codeBlock' || b.type === 'image') continue;
    blocks[i] = { ...b, content: trimInlineSeqEdges(b.content) };
  }
}

function parsePlainText(text: string): ParsedBlock[] {
  const lines = text.split(/\r?\n/);
  const blocks: ParsedBlock[] = [];
  for (const line of lines) {
    blocks.push({
      type: 'paragraph' as BlockType,
      attrs: {},
      content: inlineFromString(line),
    });
  }
  trimBlockEdges(blocks);
  compactEmptyBlocks(blocks);
  return blocks;
}

/**
 * Remove empty blocks that come from browser clipboard noise. Rules:
 * 1. Strip all leading empty blocks.
 * 2. Strip all trailing empty blocks.
 * 3. Collapse consecutive empty blocks in the middle into exactly ONE empty
 *    block (represents a user-intentional blank line between paragraphs).
 */
function compactEmptyBlocks(blocks: ParsedBlock[]): void {
  // Step 1: collapse multiple consecutive empties into one.
  // Image blocks are NEVER considered "empty" — they carry a src.
  const collapsed: ParsedBlock[] = [];
  let prevEmpty = false;
  for (const b of blocks) {
    const empty = b.type !== 'image' && inlineTextLen(b.content) === 0;
    if (empty) {
      if (!prevEmpty) collapsed.push(b);
      prevEmpty = true;
    } else {
      collapsed.push(b);
      prevEmpty = false;
    }
  }
  // Step 2: trim leading & trailing empties, but keep at least one non-empty.
  while (collapsed.length > 1 && collapsed[0]!.type !== 'image' && inlineTextLen(collapsed[0]!.content) === 0) {
    collapsed.shift();
  }
  while (collapsed.length > 1 && collapsed[collapsed.length - 1]!.type !== 'image' && inlineTextLen(collapsed[collapsed.length - 1]!.content) === 0) {
    collapsed.pop();
  }
  // Step 3: write back in-place.
  blocks.length = 0;
  for (const b of collapsed) blocks.push(b);
}

function parseHtml(html: string): ParsedBlock[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const blocks: ParsedBlock[] = [];

  // Peel away structural wrapper layers. Browsers often insert:
  //   <html><body><div>...actual content...</div></body></html>
  // or even multiple wrapping divs. We walk down until we find either:
  //  - a true block-level child (p/h*/pre/li), or
  //  - mixed content (text nodes + inline elems), or
  //  - multiple <br> separated inline runs.
  let root: ParentNode = doc.body;
  while (root.nodeType === Node.ELEMENT_NODE) {
    const rootEl = root as HTMLElement;
    const children = Array.from(rootEl.childNodes);
    const elementChildren = children.filter(
      (n): n is HTMLElement =>
        n.nodeType === Node.ELEMENT_NODE
        && !SKIP_TAGS.has((n as HTMLElement).tagName.toLowerCase()),
    );
    // Stop unwrapping if any child is a "true" block tag or there are mixed
    // (non-wrapper) contents.
    const hasTrueBlockChild = elementChildren.some(
      (c) => isTrueBlock(c.tagName.toLowerCase()) || c.tagName.toLowerCase() === 'br',
    );
    const hasTextChild = children.some(
      (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').length > 0,
    );
    const hasInlineChild = elementChildren.some(
      (c) => !isTrueBlock(c.tagName.toLowerCase()) && c.tagName.toLowerCase() !== 'div',
    );
    if (hasTrueBlockChild || hasTextChild || hasInlineChild) break;
    // Otherwise peel off exactly one wrapper div/span.
    const onlyChild = elementChildren[0];
    if (onlyChild && (onlyChild.tagName.toLowerCase() === 'div' || onlyChild.tagName.toLowerCase() === 'span')) {
      root = onlyChild;
    } else {
      break;
    }
  }

  processChildren(root.childNodes, doc, blocks);
  trimBlockEdges(blocks);
  compactEmptyBlocks(blocks);

  if (blocks.length === 0) {
    const text = doc.body.textContent ?? '';
    if (text.length > 0) {
      blocks.push({
        type: 'paragraph' as BlockType,
        attrs: {},
        content: inlineFromString(text),
      });
    }
  }

  return blocks;
}

/**
 * Process a list of sibling DOM nodes, grouping consecutive inline nodes
 * (text nodes + inline elements like <b>, <span>, etc.) into a single
 * paragraph block. True block-level elements always flush and start a new
 * block; consecutive <br> tags are treated as paragraph breaks.
 */
function processChildren(children: NodeListOf<ChildNode> | ChildNode[], doc: Document, blocks: ParsedBlock[]): void {
  let inlineBuffer: Node[] = [];
  // Track the number of consecutive <br> tags that appeared since the last
  // non-empty inline content. This lets us distinguish:
  //   "Hello<br>World"    → two blocks ["Hello", "World"] (single <br> is a line-break)
  //   "Hello<br><br>End"  → three blocks ["Hello", "", "End"] (two <br> = blank line)
  //   "Hello World<br>"   → one block ["Hello World"] (trailing <br> is noise)
  let consecutiveBr = 0;

  function flushInline(asEmptyBlock: boolean = false): void {
    if (inlineBuffer.length === 0 && !asEmptyBlock) {
      consecutiveBr = 0;
      return;
    }
    const wrapper = doc.createElement('div');
    for (const n of inlineBuffer) wrapper.appendChild(n.cloneNode(true));
    const seq = inlineFromDom(wrapper);
    blocks.push({ type: 'paragraph' as BlockType, attrs: {}, content: seq });
    inlineBuffer = [];
    consecutiveBr = 0;
  }

  for (const child of children) {
    if (child.nodeType === Node.COMMENT_NODE) continue;
    if (child.nodeType === Node.TEXT_NODE) {
      const text = child.textContent ?? '';
      // Skip whitespace-only text nodes that are just structural formatting
      // from browser clipboard wrappers (e.g. "\r\n" between <!--StartFragment-->
      // and actual content). These are NOT meaningful line breaks — they're
      // HTML serialization noise that would otherwise inject stray newlines
      // into the pasted content.
      if (text.length > 0 && text.trim().length === 0) continue;
      inlineBuffer.push(child);
      consecutiveBr = 0;
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;

    const elem = child as HTMLElement;
    const tag = elem.tagName.toLowerCase();

    if (SKIP_TAGS.has(tag)) continue;

    if (tag === 'br') {
      consecutiveBr += 1;
      // Flush any buffered inline content. If there's nothing buffered, this
      // <br> represents an empty paragraph ONLY if we already had at least
      // one <br> before it (i.e. this is the second or more consecutive <br>,
      // OR if we already produced at least one block so we know it's mid-content).
      const hadContent = inlineBuffer.length > 0;
      flushInline(false);
      if (!hadContent) {
        // This <br> was not preceded by inline text → it's either:
        //   - a leading <br> (skip)
        //   - second+ consecutive <br> (produce an empty block for each one after the first)
        //     But compactEmptyBlocks will collapse them anyway. Just produce one.
        if (consecutiveBr >= 2 || blocks.length > 0) {
          blocks.push({ type: 'paragraph' as BlockType, attrs: {}, content: [] });
        }
      }
      continue;
    }

    if (tag === 'pre') {
      flushInline();
      const text = elem.textContent ?? '';
      const lines = text.split('\n');
      for (const line of lines) {
        blocks.push({
          type: 'codeBlock' as BlockType,
          attrs: { language: 'plain' },
          content: inlineFromString(line),
        });
      }
      consecutiveBr = 0;
      continue;
    }

    if (tag in HEADING_LEVELS) {
      flushInline();
      blocks.push({
        type: 'heading' as BlockType,
        attrs: { level: HEADING_LEVELS[tag]! },
        content: inlineFromDom(elem),
      });
      consecutiveBr = 0;
      continue;
    }

    if (tag === 'blockquote') {
      flushInline();
      processChildren(elem.childNodes, doc, blocks);
      consecutiveBr = 0;
      continue;
    }

    if (tag === 'li') {
      flushInline();
      const parent = elem.parentElement;
      const parentTag = parent?.tagName.toLowerCase() ?? '';
      const content = inlineFromDom(elem);
      if (parentTag === 'ol') {
        blocks.push({ type: 'orderedList' as BlockType, attrs: {}, content });
      } else if (parentTag === 'ul') {
        blocks.push({ type: 'bulletList' as BlockType, attrs: {}, content });
      } else {
        blocks.push({ type: 'paragraph' as BlockType, attrs: {}, content });
      }
      consecutiveBr = 0;
      continue;
    }

    if (TRUE_BLOCK_TAGS.has(tag)) {
      flushInline();
      const hasTrueBlockChildren = Array.from(elem.children).some(
        (c) => isTrueBlock((c as HTMLElement).tagName.toLowerCase()),
      );
      if (hasTrueBlockChildren) {
        processChildren(elem.childNodes, doc, blocks);
      } else if (elem.querySelector('br')) {
        splitInlineByBr(elem, doc, blocks);
      } else {
        blocks.push({ type: 'paragraph' as BlockType, attrs: {}, content: inlineFromDom(elem) });
      }
      consecutiveBr = 0;
      continue;
    }

    // <div> / <span> and other generic containers.
    if (tag === 'div' || tag === 'span') {
      const hasTrueBlockChildren = Array.from(elem.children).some(
        (c) => isTrueBlock((c as HTMLElement).tagName.toLowerCase()),
      );
      if (hasTrueBlockChildren) {
        flushInline();
        processChildren(elem.childNodes, doc, blocks);
        consecutiveBr = 0;
      } else {
        // Treat as inline content — append individual children to buffer.
        for (const n of Array.from(elem.childNodes)) inlineBuffer.push(n);
        consecutiveBr = 0;
      }
      continue;
    }

    // <img> — extract as an image block (flushed from inline buffer first).
    if (tag === 'img') {
      const imgAttrs = extractImageAttrs(elem as HTMLImageElement);
      if (imgAttrs) {
        flushInline();
        blocks.push({
          type: 'image' as BlockType,
          attrs: { src: imgAttrs.src, alt: imgAttrs.alt, title: imgAttrs.title },
          content: [],
        });
        consecutiveBr = 0;
      }
      continue;
    }

    // All other inline elements (b, i, u, s, code, span.*, a, etc.)
    inlineBuffer.push(child);
    consecutiveBr = 0;
  }

  flushInline();
}

/**
 * Split an element's inline content at <br> boundaries into multiple
 * paragraph blocks. Trailing empty segments (from the browser's final
 * appended <br>) are skipped — compactEmptyBlocks handles edge cases.
 */
function splitInlineByBr(elem: HTMLElement, doc: Document, blocks: ParsedBlock[]): void {
  const segments: Node[][] = [[]];

  for (const child of elem.childNodes) {
    if (child.nodeType === Node.ELEMENT_NODE && (child as HTMLElement).tagName.toLowerCase() === 'br') {
      segments.push([]);
    } else {
      segments[segments.length - 1]!.push(child);
    }
  }

  for (const seg of segments) {
    const wrapper = doc.createElement('div');
    for (const n of seg) wrapper.appendChild(n.cloneNode(true));
    const seq = inlineFromDom(wrapper);
    blocks.push({ type: 'paragraph' as BlockType, attrs: {}, content: seq });
  }
}
