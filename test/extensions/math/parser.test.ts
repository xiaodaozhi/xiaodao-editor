import { describe, it, expect } from 'vitest';
import { parseMath } from '@/extensions/math';
import type { MathNode } from '@/extensions/math';

/** First node, cast away the union so tests can read fields directly. */
function first(src: string): any {
  return parseMath(src).nodes[0];
}

function nodes(src: string): MathNode[] {
  return [...parseMath(src).nodes];
}

describe('parseMath - ordinary characters and operators', () => {
  it('parses a bare identifier', () => {
    const n = first('x');
    expect(n.type).toBe('identifier');
    expect(n.value).toBe('x');
  });

  it('parses letters individually so `sin` is not one token', () => {
    expect(nodes('sin').map((n: any) => n.type)).toEqual(['identifier', 'identifier', 'identifier']);
  });

  it('parses a number as a single node', () => {
    const n = first('123');
    expect(n.type).toBe('number');
    expect(n.value).toBe('123');
  });

  it('parses a decimal number as a single node', () => {
    const n = first('3.14');
    expect(n.type).toBe('number');
    expect(n.value).toBe('3.14');
  });

  it('parses binary operators', () => {
    const list = nodes('a + b - c = d');
    expect(list.filter((n) => n.type === 'operator').map((n: any) => n.value))
      .toEqual(['+', '-', '=']);
  });

  it('maps \\pm \\times \\div \\cdot to real glyphs', () => {
    const list = nodes('a \\pm b \\times c \\div d \\cdot e');
    expect(list.filter((n) => n.type === 'operator').map((n: any) => n.value))
      .toEqual(['\u00B1', '\u00D7', '\u00F7', '\u22C5']);
  });

  it('maps comparison commands', () => {
    const list = nodes('a \\le b \\ge c \\neq d');
    expect(list.filter((n) => n.type === 'operator').map((n: any) => n.value))
      .toEqual(['\u2264', '\u2265', '\u2260']);
  });
});

describe('parseMath - scripts', () => {
  it('parses x^2 as a superscript', () => {
    const n = first('x^2');
    expect(n.type).toBe('scripts');
    expect(n.base.type).toBe('identifier');
    expect(n.sup[0].value).toBe('2');
    expect(n.sub).toBeNull();
  });

  it('parses x_1 as a subscript', () => {
    const n = first('x_1');
    expect(n.type).toBe('scripts');
    expect(n.sub[0].value).toBe('1');
    expect(n.sup).toBeNull();
  });

  it('collapses x_1^2 into ONE scripts node (no wrong nesting)', () => {
    const n = first('x_1^2');
    expect(n.type).toBe('scripts');
    expect(n.sub[0].value).toBe('1');
    expect(n.sup[0].value).toBe('2');
    // The base is the identifier, NOT another scripts node.
    expect(n.base.type).toBe('identifier');
  });

  it('collapses x^2_1 into ONE scripts node as well', () => {
    const n = first('x^2_1');
    expect(n.type).toBe('scripts');
    expect(n.sup[0].value).toBe('2');
    expect(n.sub[0].value).toBe('1');
  });

  it('parses a braced multi-token script', () => {
    const n = first('x^{10}');
    expect(n.sup[0].type).toBe('group');
    expect(n.sup[0].body[0].value).toBe('10');
  });

  it('parses x_{ij}', () => {
    const n = first('x_{ij}');
    expect(n.sub[0].type).toBe('group');
    expect(n.sub[0].body.map((b: any) => b.value)).toEqual(['i', 'j']);
  });
});

describe('parseMath - groups', () => {
  it('parses {x} as an invisible group', () => {
    const n = first('{x}');
    expect(n.type).toBe('group');
    expect(n.open).toBeNull();
    expect(n.close).toBeNull();
    expect(n.body[0].value).toBe('x');
  });

  it('parses (x) with visible parentheses', () => {
    const n = first('(x)');
    expect(n.open).toBe('(');
    expect(n.close).toBe(')');
  });

  it('parses [x] with visible brackets', () => {
    const n = first('[x]');
    expect(n.open).toBe('[');
    expect(n.close).toBe(']');
  });

  it('parses \\left( x \\right) as a delimited group', () => {
    const n = first('\\left( x \\right)');
    expect(n.type).toBe('group');
    expect(n.open).toBe('(');
    expect(n.close).toBe(')');
  });

  it('parses \\left\\{ x \\right\\}', () => {
    const n = first('\\left\\{ x \\right\\}');
    expect(n.open).toBe('{');
    expect(n.close).toBe('}');
  });
});

describe('parseMath - fraction and root', () => {
  it('parses \\frac{a}{b}', () => {
    const n = first('\\frac{a}{b}');
    expect(n.type).toBe('fraction');
    expect(n.numerator[0].value).toBe('a');
    expect(n.denominator[0].value).toBe('b');
  });

  it('parses \\frac{x+1}{x-1}', () => {
    const n = first('\\frac{x+1}{x-1}');
    expect(n.numerator.map((x: any) => x.value)).toEqual(['x', '+', '1']);
    expect(n.denominator.map((x: any) => x.value)).toEqual(['x', '-', '1']);
  });

  it('parses \\sqrt{x} with no index', () => {
    const n = first('\\sqrt{x}');
    expect(n.type).toBe('root');
    expect(n.index).toBeNull();
    expect(n.radicand[0].value).toBe('x');
  });

  it('parses \\sqrt[3]{x} (n-th root)', () => {
    const n = first('\\sqrt[3]{x}');
    expect(n.type).toBe('root');
    expect(n.index[0].value).toBe('3');
    expect(n.radicand[0].value).toBe('x');
  });

  it('parses \\sqrt{x^2 + y^2}', () => {
    const n = first('\\sqrt{x^2 + y^2}');
    expect(n.type).toBe('root');
    expect(n.radicand.some((r: any) => r.type === 'scripts')).toBe(true);
  });
});

describe('parseMath - greek letters and functions', () => {
  it('maps lowercase greek letters to Unicode', () => {
    const list = nodes('\\alpha \\beta \\gamma \\delta \\epsilon \\theta \\lambda \\mu \\pi \\sigma \\phi \\omega');
    expect(list.map((n: any) => n.char)).toEqual([
      '\u03B1', '\u03B2', '\u03B3', '\u03B4', '\u03B5', '\u03B8',
      '\u03BB', '\u03BC', '\u03C0', '\u03C3', '\u03C6', '\u03C9',
    ]);
  });

  it('maps uppercase greek letters to Unicode', () => {
    const list = nodes('\\Gamma \\Delta \\Theta \\Lambda \\Sigma \\Phi \\Omega');
    expect(list.map((n: any) => n.char)).toEqual([
      '\u0393', '\u0394', '\u0398', '\u039B', '\u03A3', '\u03A6', '\u03A9',
    ]);
  });

  it('parses \\alpha + \\beta', () => {
    const list = nodes('\\alpha + \\beta');
    expect(list.map((n: any) => n.type)).toEqual(['symbol', 'operator', 'symbol']);
  });

  it('parses \\sin as a function, not as s i n', () => {
    const n = first('\\sin x');
    expect(n.type).toBe('function');
    expect(n.name).toBe('sin');
  });

  it('parses the full function set', () => {
    const list = nodes('\\sin \\cos \\tan \\log \\ln \\exp \\lim \\min \\max');
    expect(list.map((n: any) => n.name)).toEqual([
      'sin', 'cos', 'tan', 'log', 'ln', 'exp', 'lim', 'min', 'max',
    ]);
  });
});

describe('parseMath - large operators', () => {
  it('parses \\sum_{i=1}^{n} i with limits attached to the operator', () => {
    const n = first('\\sum_{i=1}^{n} i');
    expect(n.type).toBe('largeOperator');
    expect(n.symbol).toBe('\u2211');
    expect(n.sub).not.toBeNull();
    expect(n.sup).not.toBeNull();
  });

  it('parses \\prod and \\int', () => {
    expect(first('\\prod').symbol).toBe('\u220F');
    expect(first('\\int').symbol).toBe('\u222B');
  });

  it('parses \\int_0^1 x dx', () => {
    const list = nodes('\\int_0^1 x dx');
    const op = list[0] as any;
    expect(op.type).toBe('largeOperator');
    expect(op.sub[0].value).toBe('0');
    expect(op.sup[0].value).toBe('1');
  });
});

describe('parseMath - environments', () => {
  it('parses a matrix into rows and cells', () => {
    const n = first('\\begin{matrix}a & b \\\\ c & d\\end{matrix}');
    expect(n.type).toBe('matrix');
    expect(n.env).toBe('matrix');
    expect(n.rows.length).toBe(2);
    expect(n.rows[0].length).toBe(2);
    expect(n.rows[0][0][0].value).toBe('a');
    expect(n.rows[0][1][0].value).toBe('b');
    expect(n.rows[1][0][0].value).toBe('c');
    expect(n.rows[1][1][0].value).toBe('d');
  });

  it('parses an aligned environment with an alignment point', () => {
    const n = first('\\begin{aligned}a &= b \\\\ &= d\\end{aligned}');
    expect(n.type).toBe('matrix');
    expect(n.env).toBe('aligned');
    expect(n.rows.length).toBe(2);
    // row 2 has an EMPTY left cell (the "  " before &=)
    expect(n.rows[1][0].length).toBe(0);
  });
});

describe('parseMath - error handling', () => {
  it('does NOT throw on \\frac{ and reports an error diagnostic', () => {
    let result: any;
    expect(() => {
      result = parseMath('\\frac{');
    }).not.toThrow();
    expect(result.diagnostics.some((d: any) => d.severity === 'error')).toBe(true);
  });

  it('does NOT throw on x^ and reports an error diagnostic', () => {
    let result: any;
    expect(() => {
      result = parseMath('x^');
    }).not.toThrow();
    expect(result.diagnostics.some((d: any) => d.severity === 'error')).toBe(true);
  });

  it('records a source position for the error', () => {
    const result = parseMath('x^');
    expect(result.diagnostics[0].start).toBeGreaterThanOrEqual(0);
    expect(result.diagnostics[0].end).toBeGreaterThanOrEqual(result.diagnostics[0].start);
  });

  it('degrades \\unknown to an unknown node with a WARNING (not an error)', () => {
    const result = parseMath('\\unknown');
    const node = result.nodes[0] as any;
    expect(node.type).toBe('unknown');
    expect(node.command).toBe('unknown');
    expect(result.diagnostics.some((d) => d.severity === 'warning')).toBe(true);
    expect(result.diagnostics.some((d) => d.severity === 'error')).toBe(false);
  });

  it('parses TeX spacing commands as space symbols, NOT as punctuation (regression: \\, showed a stray comma before dx)', () => {
    // \, used to fall through as an escaped literal comma -> identifier ','.
    const result = parseMath('e^{-x^2}\\,dx');
    const kinds = result.nodes.map((n: any) => n.type);
    expect(kinds).not.toContain('unknown');
    const sym: any = result.nodes.find((n: any) => n.type === 'symbol');
    expect(sym.char).toBe('\u2009'); // thin space
    expect(result.diagnostics).toEqual([]);

    // The whole spacing family maps to space characters (no punctuation).
    const expected: Record<string, string> = {
      ',': '\u2009',
      ':': '\u205F',
      ';': '\u2005',
      ' ': '\u00A0',
    };
    for (const [src, ch] of Object.entries(expected)) {
      const r = parseMath(`a\\${src}b`);
      const s = r.nodes.find((n: any) => n.type === 'symbol') as any;
      expect(s?.char, `\\${src}`).toBe(ch);
    }
  });

  it('parses \\quad and \\qquad as em-space symbols', () => {
    const r = parseMath('a\\quad b');
    const s = r.nodes.find((n: any) => n.type === 'symbol') as any;
    expect(s?.char).toBe('\u2003');
    expect(r.diagnostics).toEqual([]);
  });

  it('does NOT throw on an empty expression', () => {
    expect(() => parseMath('')).not.toThrow();
    expect(parseMath('').nodes).toEqual([]);
  });

  it('does NOT throw on a deeply nested / pathological expression', () => {
    expect(() => parseMath('\\frac{\\frac{\\frac{a}{b}}{c}}{d}')).not.toThrow();
    expect(() => parseMath('{{{{{{{x}}}}}}}')).not.toThrow();
    expect(() => parseMath('\\sqrt{\\sqrt{\\sqrt{x}}}')).not.toThrow();
  });

  it('reports an error for a missing \\end', () => {
    const result = parseMath('\\begin{matrix}a & b');
    expect(result.diagnostics.some((d) => d.severity === 'error')).toBe(true);
  });

  it('reports an error for an unsupported environment', () => {
    const result = parseMath('\\begin{pmatrix}a\\end{pmatrix}');
    expect(result.diagnostics.some((d) => d.severity === 'error')).toBe(true);
  });
});
