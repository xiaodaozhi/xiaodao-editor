import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  renderEquation,
  turnIntoEquation,
  turnEquationIntoParagraph,
  EquationExtension,
} from '@/extensions/Equation';
import type { Block, BlockId } from '@/core/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const bid = (s: string): BlockId => s as unknown as BlockId;

function makeBlock(over: Partial<Block> = {}): Block {
  return {
    id: bid('b1'),
    type: 'equation',
    attrs: { expression: '' },
    content: [],
    children: [],
    ...over,
  } as unknown as Block;
}

function mockEditorFor(block: Partial<Block> & { id: BlockId }) {
  const commands = {
    convertBlock: vi.fn(),
    setText: vi.fn(),
    setAttrs: vi.fn(),
    removeBlock: vi.fn(),
  };
  const editor: any = {
    commands,
    getState: () => ({ doc: { blocks: new Map([[block.id, block as Block]]) } }),
  };
  return { editor, commands };
}

// ---------------------------------------------------------------------------
// renderEquation — pure render layer (no Vue / no DOM requirement)
// ---------------------------------------------------------------------------

describe('renderEquation', () => {
  it('renders valid LaTeX to an HTML string', () => {
    const { html } = renderEquation('x^2 + 1');
    expect(typeof html).toBe('string');
    expect(html).toContain('katex');
  });

  it('marks valid LaTeX with error=false', () => {
    const r = renderEquation('a + b = c');
    expect(r.error).toBe(false);
  });

  it('does NOT throw on invalid LaTeX and reports error=true', () => {
    let r;
    expect(() => {
      r = renderEquation('\\frac{1}'); // unbalanced braces
    }).not.toThrow();
    expect(r!.error).toBe(true);
  });

  it('does NOT throw on an empty expression', () => {
    let r;
    expect(() => {
      r = renderEquation('');
    }).not.toThrow();
    expect(typeof r!.html).toBe('string');
  });

  it('is deterministic for the same input', () => {
    const a = renderEquation('\\int_0^1 x\\,dx');
    const b = renderEquation('\\int_0^1 x\\,dx');
    expect(a.html).toBe(b.html);
  });

  it('does not emit javascript: URLs when trust=false (security)', () => {
    // With trust:false, KaTeX must refuse to render a clickable javascript:
    // href. The raw source may still appear inside a MathML <annotation> (used
    // for round-tripping), so we assert there is NO executable href attribute
    // and the formula is never turned into an <a> link.
    const { html, error } = renderEquation('\\href{javascript:alert(1)}{x}');
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain('<a ');
    // trust:false treats \href as an unknown command (rendered literally), so it
    // is NOT a parse error — but the security boundary (no live link) holds.
    expect(error).toBe(false);
  });

  it('produces MathML output (displayMode) for accessibility', () => {
    const { html } = renderEquation('E = mc^2');
    // htmlAndMathml output contains both the visual HTML and a MathML block.
    expect(html).toContain('katex-mathml');
  });
});

// ---------------------------------------------------------------------------
// Schema — content model & persistence shape
// ---------------------------------------------------------------------------

describe('EquationExtension.schema', () => {
  const schema = EquationExtension.schema!;

  it('has type "equation"', () => {
    expect(schema.type).toBe('equation');
  });

  it('carries no inline text (content: "none")', () => {
    expect(schema.content).toBe('none');
  });

  it('is non-nestable and isolating', () => {
    expect(schema.nestable).toBe(false);
    expect(schema.isolating).toBe(true);
  });

  it('defaults expression to an empty string', () => {
    expect((schema.attrs as any).expression.default).toBe('');
  });

  it('validates expression as a string only', () => {
    const validate = (schema.attrs as any).expression.validate;
    expect(validate('x')).toBe(true);
    expect(validate('')).toBe(true);
    expect(validate(123)).toBe(false);
    expect(validate(null)).toBe(false);
    expect(validate(undefined)).toBe(false);
  });

  it('empty() is true for an empty expression', () => {
    expect(schema.empty!(makeBlock({ attrs: { expression: '' } }))).toBe(true);
    expect(schema.empty!(makeBlock({ attrs: { expression: '   ' } }))).toBe(true);
  });

  it('empty() is false for a non-empty expression', () => {
    expect(schema.empty!(makeBlock({ attrs: { expression: 'x^2' } }))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Turn-into helpers
// ---------------------------------------------------------------------------

describe('turn-into helpers', () => {
  beforeEach(() => vi.clearAllMocks());

  it('turnIntoEquation converts the block with the expression as attr', () => {
    const { editor, commands } = mockEditorFor(makeBlock({ id: bid('b1') }));
    turnIntoEquation(editor, bid('b1'), 'E=mc^2');
    expect(commands.convertBlock).toHaveBeenCalledWith({
      id: 'b1',
      type: 'equation',
      attrs: { expression: 'E=mc^2' },
    });
  });

  it('turnEquationIntoParagraph restores the expression as text', () => {
    const { editor, commands } = mockEditorFor(
      makeBlock({ id: bid('b1'), attrs: { expression: 'x^2' } }),
    );
    turnEquationIntoParagraph(editor, bid('b1'));
    expect(commands.convertBlock).toHaveBeenCalledWith({ id: 'b1', type: 'paragraph' });
    expect(commands.setText).toHaveBeenCalledTimes(1);
    expect(commands.setText.mock.calls[0][0].id).toBe('b1');
  });

  it('turnEquationIntoParagraph skips setText when expression is empty', () => {
    const { editor, commands } = mockEditorFor(
      makeBlock({ id: bid('b1'), attrs: { expression: '' } }),
    );
    turnEquationIntoParagraph(editor, bid('b1'));
    expect(commands.convertBlock).toHaveBeenCalledWith({ id: 'b1', type: 'paragraph' });
    expect(commands.setText).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Serialization — HTML / Markdown (only the raw expression is persisted)
// ---------------------------------------------------------------------------

describe('serialize', () => {
  const serialize = EquationExtension.serialize!;

  it('toHTML wraps valid output in equation-block-rendered', () => {
    const html = serialize.toHTML!(makeBlock({ attrs: { expression: 'x^2' } }));
    expect(html).toContain('equation-block-rendered');
    expect(html).toContain('katex');
  });

  it('toHTML emits a katex-error-block for invalid LaTeX', () => {
    const html = serialize.toHTML!(makeBlock({ attrs: { expression: '\\frac{1}' } }));
    expect(html).toContain('katex-error-block');
  });

  it('toHTML returns empty string for an empty expression', () => {
    expect(serialize.toHTML!(makeBlock({ attrs: { expression: '' } }))).toBe('');
  });

  it('toMarkdown fences a single-line expression with $$$', () => {
    const md = serialize.toMarkdown!(makeBlock({ attrs: { expression: 'a=1' } }));
    expect(md).toBe('$$$\na=1\n$$$');
  });

  it('toMarkdown preserves multiline expressions', () => {
    const md = serialize.toMarkdown!(makeBlock({ attrs: { expression: 'a=1\nb=2' } }));
    expect(md).toBe('$$$\na=1\nb=2\n$$$');
  });

  it('toMarkdown returns empty string for an empty expression', () => {
    expect(serialize.toMarkdown!(makeBlock({ attrs: { expression: '' } }))).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Slash command registration
// ---------------------------------------------------------------------------

describe('slash command', () => {
  const sc = EquationExtension.slashCommands![0]!;

  it('is registered with id "equation"', () => {
    expect(sc.id).toBe('equation');
  });

  it('uses the i18n title key', () => {
    expect(sc.title).toBe('slash.equation.title');
  });

  it('is wired to the convertBlock command', () => {
    expect(sc.command).toBe('convertBlock');
  });

  it('exposes math-related keywords (incl. Chinese)', () => {
    expect(sc.keywords).toContain('math');
    expect(sc.keywords).toContain('equation');
    expect(sc.keywords).toContain('latex');
    expect(sc.keywords).toContain('公式');
  });

  it('produces args that target the current block with an empty expression', () => {
    const buildArgs = sc.args as () => Record<string, unknown>;
    expect(buildArgs()).toEqual({
      id: '__currentBlock__',
      type: 'equation',
      attrs: { expression: '' },
    });
  });
});
