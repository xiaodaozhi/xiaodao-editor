/**
 * Bidirectional conversion between the editor's `InlineSeq` data model and
 * live DOM inside a `contenteditable` element.
 *
 * The DOM uses semantic HTML tags (`<b>`, `<i>`, `<u>`, `<s>`, `<code>`) to
 * represent inline marks. Color and background-color marks use
 * `<span class="be-color-*">` / `<span class="be-bg-*">`.
 * These utilities are used by `BlockContent.vue` to:
 *   - Render state → DOM (`inlineToHtml`)
 *   - Sync DOM → state on input (`inlineFromDom`)
 *   - Decide whether a DOM write is needed (`contentSignature`)
 */

import type { Attrs, InlineSeq, Mark, TextRun } from '../core/types';
import { sanitizeUrl } from './urlUtils';

/** Map of markType → accepted HTML tag names. */
const MARK_TAGS: Record<string, string[]> = {
  bold: ['b', 'strong'],
  italic: ['i', 'em'],
  underline: ['u'],
  strikethrough: ['s', 'strike', 'del'],
  code: ['code'],
  link: ['a'],
};

/** Reverse lookup: HTML tag → markType. */
const TAG_TO_MARK: Record<string, string> = {};
for (const [markType, tags] of Object.entries(MARK_TAGS)) {
  for (const tag of tags) TAG_TO_MARK[tag] = markType;
}

/** CSS selector that matches any mark-carrying element. */
export const MARK_SELECTOR = 'b,strong,i,em,u,s,strike,del,code,a[href],span.be-color-gray,span.be-color-brown,span.be-color-orange,span.be-color-yellow,span.be-color-green,span.be-color-blue,span.be-color-purple,span.be-color-pink,span.be-color-red,span.be-bg-gray,span.be-bg-brown,span.be-bg-orange,span.be-bg-yellow,span.be-bg-green,span.be-bg-blue,span.be-bg-purple,span.be-bg-pink,span.be-bg-red';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Escape a string for use inside an HTML attribute value (href, etc.). */
function escapeHtmlAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** True if the sequence contains at least one text run with marks. */
export function hasMarks(seq: InlineSeq): boolean {
  return seq.some((n) => n.type === 'text' && n.marks && n.marks.length > 0);
}

/**
 * Convert an InlineSeq to an HTML string suitable for `innerHTML`.
 * Marks are wrapped in nested tags; the order is deterministic so that
 * repeated renders produce identical HTML (important for diffing).
 */
export function inlineToHtml(seq: InlineSeq): string {
  if (seq.length === 0) return '';
  return seq
    .map((run) => {
      if (run.type !== 'text') return '';
      let html = escapeHtml(run.text);
      const marks = run.marks ?? [];
      // Wrap outer-to-inner in a fixed order.
      // Color/bgColor spans go outermost (they are visual-only wrappers).
      // NOTE: `marks.find(colorKey)` returns the MARK OBJECT, not the key
      // string — we must extract the attrs value separately. Using the mark
      // object directly in the template literal would produce
      // `class="be-color-[object Object]"` and the color would silently
      // not apply (no matching CSS rule).
      const colorMark = marks.find((m) => m.type === 'color');
      const cKey = colorMark?.attrs?.color;
      if (typeof cKey === 'string') html = `<span class="be-color-${cKey}">${html}</span>`;
      const bgMark = marks.find((m) => m.type === 'bgColor');
      const bKey = bgMark?.attrs?.bgColor;
      if (typeof bKey === 'string') html = `<span class="be-bg-${bKey}">${html}</span>`;
      if (marks.some((m) => m.type === 'strikethrough')) html = `<s>${html}</s>`;
      if (marks.some((m) => m.type === 'underline')) html = `<u>${html}</u>`;
      if (marks.some((m) => m.type === 'italic')) html = `<i>${html}</i>`;
      if (marks.some((m) => m.type === 'bold')) html = `<b>${html}</b>`;
      if (marks.some((m) => m.type === 'code')) html = `<code>${html}</code>`;
      // Link mark: wrap in <a href>. The href is sanitized to block
      // dangerous schemes (javascript:, vbscript:, data:). If the URL
      // fails sanitization, the link is rendered as plain text (no <a>).
      const linkMark = marks.find((m) => m.type === 'link');
      const href = linkMark?.attrs?.href;
      if (typeof href === 'string') {
        const safe = sanitizeUrl(href);
        if (safe) html = `<a href="${escapeHtmlAttr(safe)}" target="_blank" rel="noopener noreferrer">${html}</a>`;
      }
      return html;
    })
    .join('');
}

/** Parse mark info from a span's class attribute. */
function spanMarks(elem: HTMLElement): Mark[] {
  const marks: Mark[] = [];
  const cls = elem.className;
  if (typeof cls === 'string') {
    const colorMatch = cls.match(/be-color-(\w+)/);
    if (colorMatch) marks.push({ type: 'color', attrs: { color: colorMatch[1]! } as Attrs });
    const bgMatch = cls.match(/be-bg-(\w+)/);
    if (bgMatch) marks.push({ type: 'bgColor', attrs: { bgColor: bgMatch[1]! } as Attrs });
  }
  return marks;
}

/**
 * Extract an InlineSeq from the live DOM of a contenteditable element.
 * Walks the tree, accumulating text and collecting marks from ancestor tags.
 * Adjacent runs with identical marks are merged.
 */
export function inlineFromDom(el: HTMLElement): InlineSeq {
  const runs: TextRun[] = [];

  function walk(node: Node, inheritedMarks: Mark[]): void {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? '';
      if (text.length > 0) {
        runs.push({
          type: 'text',
          text,
          marks: inheritedMarks.length > 0 ? [...inheritedMarks] : undefined,
        });
      }
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const elem = node as HTMLElement;
    const tag = elem.tagName.toLowerCase();
    // <br> is layout-only — skip it (it contributes no text).
    if (tag === 'br') return;
    const markType = TAG_TO_MARK[tag];
    let marks = inheritedMarks;
    if (markType === 'link') {
      // <a> tags carry an href attribute — store it as mark attrs.
      // Sanitize the href to block dangerous schemes.
      const rawHref = elem.getAttribute('href') ?? '';
      const safeHref = sanitizeUrl(rawHref);
      if (safeHref) {
        marks = [...inheritedMarks, { type: 'link', attrs: { href: safeHref } as Attrs }];
      } else {
        // If href is empty or dangerous, don't add a link mark — treat
        // the <a> as a plain wrapper.
        marks = inheritedMarks;
      }
    } else if (markType) {
      marks = [...inheritedMarks, { type: markType }];
    } else if (tag === 'span') {
      const sm = spanMarks(elem);
      if (sm.length > 0) marks = [...inheritedMarks, ...sm];
    }
    for (const child of elem.childNodes) walk(child, marks);
  }

  walk(el, []);
  return mergeRuns(runs);
}

/** Compare two marks for equality (type + attrs). */
function markEqual(a: Mark, b: Mark): boolean {
  if (a.type !== b.type) return false;
  const ak = a.attrs ? Object.keys(a.attrs) : [];
  const bk = b.attrs ? Object.keys(b.attrs) : [];
  if (ak.length !== bk.length) return false;
  return ak.every((k) => a.attrs![k] === b.attrs![k]);
}

function marksEqual(a: readonly Mark[] | undefined, b: readonly Mark[] | undefined): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  // Compare as sets (order-independent).
  return a.every((m) => b.some((n) => markEqual(m, n)));
}

function mergeRuns(runs: TextRun[]): InlineSeq {
  const merged: TextRun[] = [];
  for (const run of runs) {
    const last = merged[merged.length - 1];
    if (last && marksEqual(last.marks, run.marks)) {
      merged[merged.length - 1] = { type: 'text', text: last.text + run.text, marks: last.marks };
    } else {
      merged.push({ ...run });
    }
  }
  return merged;
}

/** Serialize a single mark's attrs into a comparable string. */
function markAttrKey(m: Mark): string {
  if (!m.attrs) return '';
  return Object.entries(m.attrs)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(';');
}

/**
 * Compute a deterministic signature string for an InlineSeq that captures
 * both text and marks (including mark attrs). Used to decide whether a DOM
 * re-render is needed (plain `textContent` comparison misses mark-only changes).
 */
export function contentSignature(seq: InlineSeq): string {
  return seq
    .map((r) =>
      r.type === 'text'
        ? `${r.text}\u0000${(r.marks ?? []).map((m) => `${m.type}:${markAttrKey(m)}`).sort().join(',')}`
        : '',
    )
    .join('\u0001');
}
