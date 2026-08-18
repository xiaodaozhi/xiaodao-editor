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
import { parseHtmlTable } from '../extensions/tableModel';

export interface ParsedBlock {
  readonly type: BlockType;
  readonly attrs: Attrs;
  readonly content: InlineSeq;
}

const TRUE_BLOCK_TAGS = new Set([
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'li', 'pre', 'blockquote', 'hr', 'tr', 'table-row',
  'table',
]);

/** Markdown thematic-break lines that map to divider blocks when seen in
 *  plain-text pastes. Matches the same set as Divider.ts's input rule. */
const DIVIDER_MD_PATTERN = /^(?:-{3,}|\*{3,}|_{3,})\s*$/;

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
  // Skip "cid:" Content-ID URIs used by Word/Outlook — these reference an
  // embedded MIME part that the browser cannot resolve and would produce a
  // permanent dead image block.
  if (/^cid:/i.test(rawSrc)) return null;
  // Skip obviously dangerous pseudo-protocols (browsers generally don't load
  // these in <img> anyway, but defensive filtering is cheap).
  if (/^(javascript|vbscript|data:text\/)/i.test(rawSrc)) return null;
  // Skip extremely long data URIs (> 10 MB) — these are rare in clipboard,
  // would balloon the document size, and are typically not real images.
  if (rawSrc.length > 10_000_000) return null;
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
    const blocks = parseCustomPayload(html);
    if (blocks.length > 0) return blocks;
  }
  if (html) {
    const blocks = parseHtml(html);
    if (blocks.length > 0) return blocks;
  }
  if (plainText) {
    return parsePlainText(plainText);
  }
  return [];
}

/**
 * Detect and parse the custom "blockeditor:" HTML comment payload that
 * BlockSettingsMenu.copyBlock writes. Format:
 *   <!-- blockeditor:{JSON} -->
 * where JSON = { id, type, attrs, text }.
 * Returns parsed blocks or empty array if no custom payload is found.
 */
function parseCustomPayload(html: string): ParsedBlock[] {
  const match = html.match(/<!--\s*blockeditor:(.+?)\s*-->/);
  if (!match) return [];
  try {
    const payload = JSON.parse(match[1]!);
    const type = payload.type as BlockType;
    const attrs = payload.attrs as Attrs | undefined;
    const text = payload.text as string | undefined;
    if (!type) return [];

    // For blocks that support text content, use the stored text.
    // For non-text blocks (like image), create a block with empty content.
    const textBlocks: ParsedBlock[] = [];
    if (text && text.length > 0) {
      textBlocks.push({
        type,
        attrs: attrs ?? {},
        content: inlineFromString(text),
      });
    } else {
      // Block has no text content (e.g. image). Return it as a block
      // with no content — the paste handler will treat it specially.
      textBlocks.push({
        type,
        attrs: attrs ?? {},
        content: [],
      });
    }
    return textBlocks;
  } catch {
    return [];
  }
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
    // Non-text blocks (code / image / table / divider) carry structural meaning
    // in their attrs rather than in their inline content — never trim them.
    if (b.type === 'codeBlock' || b.type === 'image' || b.type === 'table' || b.type === 'divider') continue;
    blocks[i] = { ...b, content: trimInlineSeqEdges(b.content) };
  }
}

function parsePlainText(text: string): ParsedBlock[] {
  const lines = text.split(/\r?\n/);
  const blocks: ParsedBlock[] = [];
  for (const line of lines) {
    if (DIVIDER_MD_PATTERN.test(line)) {
      blocks.push({
        type: 'divider' as BlockType,
        attrs: {},
        content: [],
      });
    } else {
      blocks.push({
        type: 'paragraph' as BlockType,
        attrs: {},
        content: inlineFromString(line),
      });
    }
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
  // Image / Table / Divider / Code blocks are NEVER considered "empty" — they
  // carry structural meaning in their attrs even without inline text.
  const STRUCTURAL_TYPES = new Set(['image', 'table', 'divider', 'codeBlock']);
  const collapsed: ParsedBlock[] = [];
  let prevEmpty = false;
  for (const b of blocks) {
    const empty = !STRUCTURAL_TYPES.has(b.type) && inlineTextLen(b.content) === 0;
    if (empty) {
      if (!prevEmpty) collapsed.push(b);
      prevEmpty = true;
    } else {
      collapsed.push(b);
      prevEmpty = false;
    }
  }
  // Step 2: trim leading & trailing empties, but keep at least one non-empty.
  while (collapsed.length > 1
    && !STRUCTURAL_TYPES.has(collapsed[0]!.type)
    && inlineTextLen(collapsed[0]!.content) === 0) {
    collapsed.shift();
  }
  while (collapsed.length > 1
    && !STRUCTURAL_TYPES.has(collapsed[collapsed.length - 1]!.type)
    && inlineTextLen(collapsed[collapsed.length - 1]!.content) === 0) {
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
    // Only peel if there's exactly one element child (a true wrapper).
    // Multiple element children means this is actual content, not a wrapper.
    if (elementChildren.length !== 1) break;
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
      // Keep all lines in a single code block — splitting by '\n' produces
      // one codeBlock per line, which breaks multi-line code pastes.
      // Trim leading/trailing newlines (often injected by the browser)
      // but preserve internal line breaks.
      const text = (elem.textContent ?? '').replace(/^\n+|\n+$/g, '');
      blocks.push({
        type: 'codeBlock' as BlockType,
        attrs: { language: 'plain' },
        content: inlineFromString(text),
      });
      consecutiveBr = 0;
      continue;
    }

    if (tag === 'hr') {
      // HTML <hr> → divider block. Flush any pending inline first so the
      // divider always sits on its own structural boundary.
      flushInline();
      blocks.push({
        type: 'divider' as BlockType,
        attrs: {},
        content: [],
      });
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
      const hasImageDescendant = !!elem.querySelector('img');
      if (hasTrueBlockChildren || hasImageDescendant) {
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
      const hasBlockChildren = Array.from(elem.children).some(
        (c) => {
          const t = (c as HTMLElement).tagName.toLowerCase();
          return isTrueBlock(t) || t === 'div';
        },
      );
      const hasImageDescendant = !!elem.querySelector('img');
      if (hasBlockChildren || hasImageDescendant) {
        flushInline();
        processChildren(elem.childNodes, doc, blocks);
        consecutiveBr = 0;
      } else {
        // Leaf div/span — treat as inline content. For <div> (which browsers
        // use to wrap individual lines when copying from VSCode, textareas,
        // etc.), insert a line break before its content so that multi-line
        // text is preserved within a single block rather than being merged
        // into one line or split into separate blocks.
        if (tag === 'div' && inlineBuffer.length > 0) {
          inlineBuffer.push(doc.createTextNode('\n'));
        }
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

    // <table> — parse entire table into a single table block.
    if (tag === 'table') {
      const tattrs = parseHtmlTable(elem as HTMLTableElement);
      if (tattrs) {
        flushInline();
        blocks.push({
          type: 'table' as BlockType,
          attrs: tattrs as unknown as Attrs,
          content: [],
        });
        consecutiveBr = 0;
      }
      continue;
    }

    // All other inline elements (b, i, u, s, code, a, etc.)
    // If any descendant is an <img>, recurse via processChildren so the img
    // branch above fires and produces a real image block — otherwise the img
    // would disappear inside inlineFromDom() during flushInline.
    if ((elem as HTMLElement).querySelector?.('img')) {
      flushInline();
      processChildren(elem.childNodes, doc, blocks);
      consecutiveBr = 0;
      continue;
    }
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
