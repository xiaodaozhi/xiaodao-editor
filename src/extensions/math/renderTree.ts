/**
 * AST -> abstract render tree.
 *
 * This is the SINGLE place where math layout is decided. Two thin backends
 * consume the resulting tree:
 *   - `renderVNode.ts` -> Vue VNode tree (live editing; text becomes real text
 *     nodes, so nothing is ever assigned to innerHTML)
 *   - `renderHtml.ts`  -> escaped HTML string (export / SSR / non-Vue callers)
 *
 * Keeping one structural implementation guarantees the two backends can never
 * drift apart.
 */

import type { MathContent, MathDelimiter, MathNode } from './ast';

export interface RenderContext {
  readonly displayMode: boolean;
}

export interface MathElement {
  readonly tag: string;
  /** Class name(s), or null. */
  readonly class: string | null;
  /** Inline style, or null. */
  readonly style: Readonly<Record<string, string>> | null;
  /** Text content for a leaf element; null when the element has children. */
  readonly text: string | null;
  readonly children: readonly MathElement[] | null;
}

function el(
  tag: string,
  cls: string | null,
  children: readonly MathElement[],
  style: Readonly<Record<string, string>> | null = null,
): MathElement {
  return { tag, class: cls, style, text: null, children };
}

function leaf(tag: string, cls: string | null, text: string): MathElement {
  return { tag, class: cls, style: null, text, children: null };
}

function delimiterGlyph(d: MathDelimiter): string {
  switch (d) {
    case '(':
      return '(';
    case ')':
      return ')';
    case '[':
      return '[';
    case ']':
      return ']';
    case '{':
      return '{';
    case '}':
      return '}';
    case '|':
      return '|';
    default:
      return '';
  }
}

/** Build the full render tree for a parsed expression. */
export function buildRenderTree(nodes: MathContent, ctx: RenderContext): MathElement {
  return el(
    'span',
    ctx.displayMode ? 'math-equation math-display' : 'math-equation',
    renderNodes(nodes, ctx),
  );
}

/**
 * Display glyphs for ASCII operators. TeX typographic convention: a hyphen
 * used as a minus/negative sign renders as a true minus (U+2212), which is
 * wider and vertically centered on the digit line. The AST keeps the raw
 * ASCII `-` so the stored expression never changes.
 */
const OPERATOR_GLYPHS: Readonly<Record<string, string>> = {
  '-': '\u2212', // minus sign
};

function operatorGlyph(value: string): string {
  return OPERATOR_GLYPHS[value] ?? value;
}

function renderNodes(nodes: MathContent, ctx: RenderContext): MathElement[] {
  const out: MathElement[] = [];
  for (const node of nodes) {
    out.push(...renderNode(node, ctx));
  }
  return out;
}

function renderNode(node: MathNode, ctx: RenderContext): MathElement[] {
  switch (node.type) {
    case 'text':
      return [leaf('span', 'math-text', node.value)];
    case 'number':
      return [leaf('span', 'math-number', node.value)];
    case 'identifier':
      return [leaf('span', 'math-identifier', node.value)];
    case 'operator':
      return [leaf('span', 'math-operator', operatorGlyph(node.value))];
    case 'symbol':
      return [leaf('span', 'math-symbol', node.char)];
    case 'function':
      return [leaf('span', 'math-function', node.name)];
    case 'unknown':
      return [leaf('span', 'math-unknown', '\\' + node.command)];
    case 'error':
      return [leaf('span', 'math-error', '\u26A0')];
    case 'group': {
      const parts: MathElement[] = [];
      if (node.open) parts.push(leaf('span', 'math-delimiter', delimiterGlyph(node.open)));
      parts.push(el('span', 'math-group', renderNodes(node.body, ctx)));
      if (node.close) parts.push(leaf('span', 'math-delimiter', delimiterGlyph(node.close)));
      return parts;
    }
    case 'fraction':
      return [
        el('span', 'math-fraction', [
          el('span', 'math-fraction-numerator', renderNodes(node.numerator, ctx)),
          el('span', 'math-fraction-bar', []),
          el('span', 'math-fraction-denominator', renderNodes(node.denominator, ctx)),
        ]),
      ];
    case 'root': {
      const parts: MathElement[] = [];
      if (node.index) parts.push(el('span', 'math-root-index', renderNodes(node.index, ctx)));
      parts.push(leaf('span', 'math-root-sign', '\u221A'));
      parts.push(el('span', 'math-root-radicand', renderNodes(node.radicand, ctx)));
      return [el('span', 'math-root', parts)];
    }
    case 'scripts': {
      // `\lim_{x \to 0}` style: put the subscript under the function name.
      if (ctx.displayMode && node.base.type === 'function' && node.sub && !node.sup) {
        return [
          el('span', 'math-limit', [
            el('span', 'math-limit-base', renderNode(node.base, ctx)),
            el('span', 'math-limit-under', renderNodes(node.sub, ctx)),
          ]),
        ];
      }
      const parts: MathElement[] = [el('span', 'math-base', renderNode(node.base, ctx))];
      if (node.sup && node.sub) {
        // Both scripts present: stack them in a vertical column next to the
        // base (x_1^2 style). Flex items ignore vertical-align, so this stack
        // is positioned as a whole via CSS (.math-scripts).
        parts.push(
          el('span', 'math-scripts', [
            el('sup', 'math-sup', renderNodes(node.sup, ctx)),
            el('sub', 'math-sub', renderNodes(node.sub, ctx)),
          ]),
        );
      } else if (node.sup) {
        // Lone superscript: use the native <sup> semantics so the browser
        // raises it above the baseline (vertical-align: super).
        parts.push(el('sup', 'math-sup', renderNodes(node.sup, ctx)));
      } else if (node.sub) {
        parts.push(el('sub', 'math-sub', renderNodes(node.sub, ctx)));
      }
      return [el('span', 'math-script', parts)];
    }
    case 'largeOperator': {
      if (ctx.displayMode && (node.sup || node.sub)) {
        return [
          el('span', 'math-large-operator', [
            el('span', 'math-op-limits', [
              el('span', 'math-op-upper', node.sup ? renderNodes(node.sup, ctx) : []),
              leaf('span', 'math-op-symbol', node.symbol),
              el('span', 'math-op-lower', node.sub ? renderNodes(node.sub, ctx) : []),
            ]),
          ]),
        ];
      }
      // Inline mode: keep the operator on the text baseline and let native
      // <sup>/<sub> do the shifting (a flex container would kill it).
      const parts: MathElement[] = [leaf('span', 'math-op-symbol', node.symbol)];
      if (node.sup) parts.push(el('sup', 'math-sup', renderNodes(node.sup, ctx)));
      if (node.sub) parts.push(el('sub', 'math-sub', renderNodes(node.sub, ctx)));
      return [el('span', 'math-large-operator math-op-inline', parts)];
    }
    case 'matrix':
      return node.env === 'aligned'
        ? [renderAligned(node.rows, ctx)]
        : [renderMatrix(node.rows, ctx)];
    default:
      return [];
  }
}

function renderMatrix(rows: readonly (readonly MathContent[])[], ctx: RenderContext): MathElement {
  let columns = 1;
  for (const row of rows) columns = Math.max(columns, row.length);
  return el(
    'span',
    'math-matrix',
    rows.map((row) =>
      el(
        'span',
        'math-matrix-row',
        row.map((cell) => el('span', 'math-matrix-cell', renderNodes(cell, ctx))),
      ),
    ),
    { gridTemplateColumns: `repeat(${columns}, auto)` },
  );
}

function renderAligned(rows: readonly (readonly MathContent[])[], ctx: RenderContext): MathElement {
  return el(
    'span',
    'math-aligned',
    rows.map((row) =>
      el('span', 'math-aligned-row', [
        el('span', 'math-aligned-left', renderNodes(row[0] ?? [], ctx)),
        el('span', 'math-aligned-right', renderNodes(restCells(row), ctx)),
      ]),
    ),
  );
}

function restCells(row: readonly MathContent[]): MathContent {
  if (row.length <= 1) return [];
  return row.slice(1).flat();
}
