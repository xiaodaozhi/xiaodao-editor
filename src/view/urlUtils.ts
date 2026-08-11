/**
 * URL validation and sanitization utilities for the link mark.
 *
 * Blocks dangerous schemes (javascript:, vbscript:, data:) that could be
 * used for XSS when rendered as <a href="...">.
 */

import type { Attrs, InlineNode, InlineSeq, Mark } from '../core/types';

/** Schemes that are safe to use in href attributes. */
const SAFE_SCHEMES = ['http:', 'https:', 'mailto:', 'tel:'];

/** Schemes that are explicitly dangerous and must never be allowed. */
const DANGEROUS_SCHEMES = ['javascript:', 'vbscript:', 'data:', 'file:'];

/**
 * Check whether a URL string is safe to use as an href.
 *
 * A URL is considered safe if:
 * 1. It is non-empty.
 * 2. It does not start with a dangerous scheme (case-insensitive).
 * 3. If it has an explicit scheme, that scheme is in the allow-list.
 * 4. If it has no scheme (relative URL or bare domain), it is safe — the
 *    browser will resolve it relative to the current page, and it cannot
 *    execute script.
 *
 * Returns the cleaned URL (trimmed) or null if the URL is unsafe/empty.
 */
export function sanitizeUrl(raw: string): string | null {
  const url = raw.trim();
  if (!url) return null;

  const lower = url.toLowerCase();

  // Block dangerous schemes.
  for (const scheme of DANGEROUS_SCHEMES) {
    if (lower.startsWith(scheme)) return null;
  }

  // If there's an explicit scheme, verify it's in the allow-list.
  // A scheme is defined as everything before the first ':' that is
  // purely alphabetic (per RFC 3986).
  const schemeMatch = url.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
  if (schemeMatch) {
    const scheme = schemeMatch[1]!.toLowerCase() + ':';
    if (!SAFE_SCHEMES.includes(scheme)) return null;
  }

  return url;
}

/**
 * Check if a string looks like a URL that should be auto-linked.
 *
 * This is intentionally conservative — it only matches strings that start
 * with a known scheme or look like a domain (e.g. "example.com/path").
 */
export function looksLikeUrl(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length < 4) return false;

  // Explicit scheme.
  if (/^https?:\/\//i.test(trimmed)) return true;
  if (/^mailto:/i.test(trimmed)) return true;

  // Bare domain: "example.com", "sub.example.co.uk/path", "localhost:3000"
  // Must have a dot (or be localhost), and no spaces.
  if (/\s/.test(trimmed)) return false;
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/[^\s]*)?$/.test(trimmed)) return true;

  return false;
}

/**
 * Normalize a URL by adding a default scheme if missing.
 *
 * - If the URL already has a scheme, return as-is.
 * - If it looks like a domain, prepend "https://".
 * - If it starts with "@", treat as email → prepend "mailto:".
 * - Otherwise, return as-is (may be a relative URL).
 */
export function normalizeUrl(raw: string): string {
  const url = raw.trim();
  if (!url) return '';

  // Already has a scheme.
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url)) return url;

  // Email-like.
  if (url.startsWith('@') || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(url)) {
    return url.startsWith('mailto:') ? url : `mailto:${url.replace(/^@/, '')}`;
  }

  // Bare domain → prepend https://
  if (looksLikeUrl(url) && !url.startsWith('/')) {
    return `https://${url}`;
  }

  return url;
}

/**
 * URL pattern for auto-linking within text.
 *
 * Matches URLs that are:
 * - Preceded by start-of-string or a whitespace character
 * - The URL itself has no whitespace
 * - Must look like a real URL (http://, https://, or domain.tld/path)
 *
 * The leading whitespace is captured in group 1 so it can be preserved.
 * The URL itself is captured in group 2.
 */
const URL_IN_TEXT_PATTERN = /(^|\s)((?:https?:\/\/|www\.)[^\s<]+|[\w-]+(?:\.[\w-]+)+\.[a-zA-Z]{2,}(?::\d+)?(?:\/[^\s<]*)?)/g;

/**
 * Scan an InlineSeq for URL-like substrings and add link marks to them.
 *
 * - Only scans text runs that do NOT already have a `link` mark or `code` mark.
 * - Preserves all existing marks on non-URL portions.
 * - Returns the same sequence if no URLs were found (no allocation).
 */
export function autoLinkInlineSeq(seq: InlineSeq): InlineSeq {
  let changed = false;
  const result: InlineNode[] = [];

  for (const run of seq) {
    if (run.type !== 'text') {
      result.push(run);
      continue;
    }

    // Skip runs that already have a link or code mark.
    const hasLink = run.marks?.some((m) => m.type === 'link');
    const hasCode = run.marks?.some((m) => m.type === 'code');
    if (hasLink || hasCode) {
      result.push(run);
      continue;
    }

    const text = run.text;
    const runMarks = run.marks ?? [];
    URL_IN_TEXT_PATTERN.lastIndex = 0;
    const match = URL_IN_TEXT_PATTERN.exec(text);

    if (!match) {
      result.push(run);
      continue;
    }

    // This run has at least one URL — split it into segments.
    changed = true;
    let lastEnd = 0;
    URL_IN_TEXT_PATTERN.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = URL_IN_TEXT_PATTERN.exec(text)) !== null) {
      const fullMatch = m[0]!;
      const urlPart = m[2]!;
      const urlStart = m.index + fullMatch.length - urlPart.length;
      const urlEnd = urlStart + urlPart.length;

      // Text before the URL (includes any leading whitespace).
      if (urlStart > lastEnd) {
        const beforeText = text.slice(lastEnd, urlStart);
        if (beforeText.length > 0) {
          result.push({
            type: 'text' as const,
            text: beforeText,
            marks: runMarks.length > 0 ? [...runMarks] : undefined,
          });
        }
      }

      // The URL itself — add a link mark.
      const normalized = normalizeUrl(urlPart);
      const safe = sanitizeUrl(normalized);
      if (safe) {
        const linkMark: Mark = { type: 'link', attrs: { href: safe } as Attrs };
        result.push({
          type: 'text' as const,
          text: urlPart,
          marks: [...runMarks, linkMark],
        });
      } else {
        // URL didn't pass sanitization — keep as plain text.
        result.push({
          type: 'text' as const,
          text: urlPart,
          marks: runMarks.length > 0 ? [...runMarks] : undefined,
        });
      }

      lastEnd = urlEnd;
    }

    // Trailing text after the last URL.
    if (lastEnd < text.length) {
      const trailing = text.slice(lastEnd);
      if (trailing.length > 0) {
        result.push({
          type: 'text' as const,
          text: trailing,
          marks: runMarks.length > 0 ? [...runMarks] : undefined,
        });
      }
    }

    // Reset regex state.
    URL_IN_TEXT_PATTERN.lastIndex = 0;
  }

  return changed ? result : seq;
}
