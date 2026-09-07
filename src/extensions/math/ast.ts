/**
 * Math AST for xiaodao-editor's built-in (zero-dependency) equation renderer.
 *
 * The AST is a pure data structure: it knows nothing about the DOM, Vue, or the
 * editor. Two independent backends consume it:
 *   - `renderVNode.ts` -> Vue VNode tree (live editing, no innerHTML)
 *   - `renderHtml.ts`  -> escaped HTML string (export / SSR / non-Vue callers)
 *
 * Every node carries the source span it was parsed from, so future work can
 * highlight the exact offending range without re-parsing.
 */

/** Source span, in UTF-16 code units, half-open: [start, end). */
export interface MathSpan {
  readonly start: number;
  readonly end: number;
}

/** Environments understood by the built-in renderer. */
export type MathEnv = 'matrix' | 'aligned';

/** Delimiters produced by `(`/`)`/`[`/`]`/`\{`/`|` and `\left`/`\right`. */
export type MathDelimiter = '(' | ')' | '[' | ']' | '{' | '}' | '|' | '.';

/** An ordered run of nodes (an argument, a numerator, a script, a cell, ...). */
export type MathContent = readonly MathNode[];

/** One cell of a matrix/aligned row. */
export type MathCell = MathContent;

/** One row of a matrix/aligned environment. */
export type MathRow = readonly MathCell[];

/** A run of ordinary characters that is not a single identifier (e.g. `abc`). */
export interface MathTextNode extends MathSpan {
  readonly type: 'text';
  readonly value: string;
}

/** A numeric literal such as `2` or `3.14`. */
export interface MathNumberNode extends MathSpan {
  readonly type: 'number';
  readonly value: string;
}

/** A single-letter variable such as `x`. Rendered italic. */
export interface MathIdentifierNode extends MathSpan {
  readonly type: 'identifier';
  readonly value: string;
}

/** `+`, `-`, `=`, `<`, `>`, or a mapped command such as `\times`. */
export interface MathOperatorNode extends MathSpan {
  readonly type: 'operator';
  readonly value: string;
  /** The originating command name (without backslash) when it came from one. */
  readonly command: string | null;
  /**
   * True for a unary (sign) usage such as `-b` or `x = -1`, where the minus
   * hugs the operand that follows it. Absent/false for the binary minus.
   */
  readonly unary?: boolean;
}

/** A delimited group: `{...}`, `(...)`, `[...]`, or `\left(...\right)`. */
export interface MathGroupNode extends MathSpan {
  readonly type: 'group';
  readonly body: MathContent;
  /**
   * `null` for a plain `{...}` grouping (braces stay invisible, as in TeX).
   * A non-null value renders that glyph on the left/right of the body.
   */
  readonly open: MathDelimiter | null;
  readonly close: MathDelimiter | null;
}

/** `\frac{num}{den}`. */
export interface MathFractionNode extends MathSpan {
  readonly type: 'fraction';
  readonly numerator: MathContent;
  readonly denominator: MathContent;
}

/** `\sqrt{x}` or `\sqrt[3]{x}`. */
export interface MathRootNode extends MathSpan {
  readonly type: 'root';
  readonly radicand: MathContent;
  /** Degree for `\sqrt[n]{}`; null for a plain square root. */
  readonly index: MathContent | null;
}

/**
 * `x^2`, `x_1`, and `x_1^2` all collapse into a SINGLE node so the renderer
 * never has to deal with a nested/incorrect shape for combined scripts.
 */
export interface MathScriptsNode extends MathSpan {
  readonly type: 'scripts';
  readonly base: MathNode;
  readonly sup: MathContent | null;
  readonly sub: MathContent | null;
}

/** `\sin`, `\log`, `\lim`, ... rendered upright (`sin`, not `s i n`). */
export interface MathFunctionNode extends MathSpan {
  readonly type: 'function';
  readonly name: string;
  readonly command: string;
}

/** A mapped symbol such as `\alpha` -> alpha. */
export interface MathSymbolNode extends MathSpan {
  readonly type: 'symbol';
  readonly char: string;
  readonly command: string;
}

/** `\sum`, `\prod`, `\int` — carries its own limits for above/below layout. */
export interface MathLargeOperatorNode extends MathSpan {
  readonly type: 'largeOperator';
  readonly symbol: string;
  readonly command: string;
  readonly sup: MathContent | null;
  readonly sub: MathContent | null;
}

/** `\begin{matrix}...\end{matrix}` / `\begin{aligned}...\end{aligned}`. */
export interface MathMatrixNode extends MathSpan {
  readonly type: 'matrix';
  readonly env: MathEnv;
  readonly rows: readonly MathRow[];
}

/** A command the built-in renderer does not implement (graceful degradation). */
export interface MathUnknownNode extends MathSpan {
  readonly type: 'unknown';
  readonly command: string;
}

/** A placeholder for a construct that could not be parsed. */
export interface MathErrorNode extends MathSpan {
  readonly type: 'error';
  readonly message: string;
}

export type MathNode =
  | MathTextNode
  | MathNumberNode
  | MathIdentifierNode
  | MathOperatorNode
  | MathGroupNode
  | MathFractionNode
  | MathRootNode
  | MathScriptsNode
  | MathFunctionNode
  | MathSymbolNode
  | MathLargeOperatorNode
  | MathMatrixNode
  | MathUnknownNode
  | MathErrorNode;

export type MathNodeType = MathNode['type'];

/**
 * A parse outcome. `severity: 'error'` means the renderer should surface a
 * visible error; `'warning'` means the input was recoverable (e.g. an unknown
 * command that is rendered literally) and is NOT an error state.
 */
export interface MathDiagnostic {
  readonly severity: 'error' | 'warning';
  readonly message: string;
  readonly start: number;
  readonly end: number;
}

export interface ParseResult {
  readonly nodes: MathContent;
  readonly diagnostics: readonly MathDiagnostic[];
}
