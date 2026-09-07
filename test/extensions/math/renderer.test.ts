import { describe, it, expect } from 'vitest';
import { parseMath, renderMathToHtml, renderMathToVNode } from '@/extensions/math';

function html(src: string, displayMode = true): string {
  const { nodes } = parseMath(src);
  return renderMathToHtml(nodes, { displayMode });
}

/** Collect every class name appearing anywhere in the VNode tree. */
function classes(src: string, displayMode = true): string[] {
  const { nodes } = parseMath(src);
  const root: any = renderMathToVNode(nodes, { displayMode });
  const out: string[] = [];
  const walk = (node: any): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    const cls = node.props?.class;
    if (typeof cls === 'string') out.push(...cls.split(' '));
    if (Array.isArray(node.children)) node.children.forEach(walk);
  };
  walk(root);
  return out;
}

function rootVNode(src: string, displayMode = true): any {
  const { nodes } = parseMath(src);
  return renderMathToVNode(nodes, { displayMode });
}

describe('math renderer - HTML output', () => {
  it('renders a fraction as numerator / bar / denominator', () => {
    const out = html('\\frac{a}{b}');
    expect(out).toContain('math-fraction');
    expect(out).toContain('math-fraction-numerator');
    expect(out).toContain('math-fraction-bar');
    expect(out).toContain('math-fraction-denominator');
  });

  it('renders a superscript with base + sup', () => {
    const out = html('x^2');
    expect(out).toContain('math-base');
    expect(out).toContain('math-sup');
    expect(out).not.toContain('math-sub');
  });

  it('renders a subscript with base + sub', () => {
    const out = html('x_1');
    expect(out).toContain('math-base');
    expect(out).toContain('math-sub');
  });

  it('renders combined sub+sup as one stacked group', () => {
    const out = html('x_1^2');
    expect(out).toContain('math-scripts');
    expect(out).toContain('math-sup');
    expect(out).toContain('math-sub');
  });

  it('renders a square root with a radicand bar', () => {
    const out = html('\\sqrt{x}');
    expect(out).toContain('math-root');
    expect(out).toContain('math-root-sign');
    expect(out).toContain('math-root-radicand');
    expect(out).not.toContain('math-root-index');
  });

  it('renders an n-th root with an index', () => {
    const out = html('\\sqrt[3]{x}');
    expect(out).toContain('math-root-index');
  });

  it('places large-operator limits above/below in display mode', () => {
    const out = html('\\sum_{i=1}^{n} i', true);
    expect(out).toContain('math-op-limits');
    expect(out).toContain('math-op-upper');
    expect(out).toContain('math-op-lower');
  });

  it('falls back to inline scripts for large operators when displayMode is false', () => {
    const out = html('\\sum_{i=1}^{n} i', false);
    expect(out).toContain('math-op-symbol');
    expect(out).not.toContain('math-op-limits');
  });

  it('renders a matrix with grid columns and per-row cells', () => {
    const out = html('\\begin{matrix}a & b \\\\ c & d\\end{matrix}');
    expect(out).toContain('math-matrix');
    expect(out).toContain('math-matrix-row');
    expect(out).toContain('math-matrix-cell');
    expect(out).toContain('grid-template-columns: repeat(2, auto)');
  });

  it('renders aligned rows split into left / right cells', () => {
    const out = html('\\begin{aligned}a &= b \\\\ &= d\\end{aligned}');
    expect(out).toContain('math-aligned');
    expect(out).toContain('math-aligned-left');
    expect(out).toContain('math-aligned-right');
  });

  it('renders an unknown command literally (graceful degradation)', () => {
    const out = html('\\foo');
    expect(out).toContain('math-unknown');
    expect(out).toContain('\\foo');
  });

  it('renders a parse error as a visible marker', () => {
    const out = html('\\frac{');
    expect(out).toContain('math-error');
  });
});

describe('math renderer - VNode output', () => {
  it('root carries the math-equation namespace', () => {
    const vnode = rootVNode('x^2');
    expect(vnode.type).toBe('span');
    expect(String(vnode.props.class)).toContain('math-equation');
  });

  it('adds math-display only when displayMode is true', () => {
    expect(classes('x', true)).toContain('math-display');
    expect(classes('x', false)).not.toContain('math-display');
  });

  it('produces the same structure as the HTML backend for a fraction', () => {
    expect(classes('\\frac{a}{b}')).toEqual(
      expect.arrayContaining(['math-fraction', 'math-fraction-numerator', 'math-fraction-denominator']),
    );
  });

  it('passes text as real text nodes (never markup)', () => {
    const vnode = rootVNode('x');
    const texts: string[] = [];
    const walk = (node: any): void => {
      if (node == null) return;
      if (typeof node === 'string') {
        texts.push(node);
        return;
      }
      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }
      if (typeof node.children === 'string') texts.push(node.children);
      else if (Array.isArray(node.children)) node.children.forEach(walk);
    };
    walk(vnode);
    expect(texts).toContain('x');
  });
});

describe('math renderer - security', () => {
  it('escapes raw HTML in the expression', () => {
    const out = html('<script>alert(1)</script>');
    expect(out).not.toContain('<script');
    expect(out).toContain('&lt;');
    expect(out).toContain('&gt;');
  });

  it('escapes angle brackets', () => {
    expect(html('a < b')).toContain('&lt;');
  });

  it('never produces an anchor or a javascript: URL', () => {
    const out = html('\\href{javascript:alert(1)}{x}');
    expect(out).not.toContain('<a ');
    expect(out).not.toContain('href="javascript:');
  });

  it('cannot inject attributes through the expression', () => {
    // Quotes in the source land in TEXT (never in an attribute), so a payload
    // like this can never escape into a real HTML attribute.
    const out = html('a" onmouseover="alert(1)');
    expect(out).not.toContain('onmouseover=');
    expect(out).not.toContain('onerror=');
  });
});
