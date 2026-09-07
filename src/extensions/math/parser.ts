/**
 * Recursive-descent parser for the built-in math renderer:
 *   tokens -> Math AST (+ diagnostics)
 *
 * Guarantees:
 *  - Single forward pass, O(n), no backtracking.
 *  - NEVER throws. Malformed input yields `error` nodes plus `error`
 *    diagnostics; unknown commands yield `unknown` nodes plus `warning`
 *    diagnostics (graceful degradation, not an error state).
 *  - `x_1^2` and `x^2_1` both collapse into ONE `scripts` node.
 */

import type {
  MathCell,
  MathContent,
  MathDelimiter,
  MathDiagnostic,
  MathEnv,
  MathNode,
  MathRow,
  ParseResult,
} from './ast';
import { tokenize, type Token } from './tokens';
import {
  FUNCTION_COMMANDS,
  GREEK_LETTERS,
  LARGE_OPERATORS,
  OPERATOR_COMMANDS,
} from './symbols';

interface ParserState {
  readonly tokens: readonly Token[];
  index: number;
  readonly diagnostics: MathDiagnostic[];
}

// ---------------------------------------------------------------------------
// Cursor helpers
// ---------------------------------------------------------------------------

function atEnd(st: ParserState): boolean {
  return st.index >= st.tokens.length;
}

function peek(st: ParserState): Token | undefined {
  return st.tokens[st.index];
}

function take(st: ParserState): Token | undefined {
  const t = st.tokens[st.index];
  if (t) st.index += 1;
  return t;
}

/** End offset of the most recently consumed token (for node spans). */
function endOfPrev(st: ParserState, fallback: number): number {
  const prev = st.tokens[st.index - 1];
  return prev ? prev.end : fallback;
}

function isClosingToken(t: Token | undefined): boolean {
  if (!t) return true;
  if (t.kind === 'rbrace' || t.kind === 'rparen' || t.kind === 'rbracket') return true;
  if (t.kind === 'amp' || t.kind === 'newline' || t.kind === 'sup' || t.kind === 'sub') return true;
  return t.kind === 'command' && (t.value === 'right' || t.value === 'end');
}

function addError(st: ParserState, message: string, start: number, end: number): MathNode {
  st.diagnostics.push({ severity: 'error', message, start, end });
  return { type: 'error', message, start, end };
}

function addWarning(st: ParserState, message: string, start: number, end: number): void {
  st.diagnostics.push({ severity: 'warning', message, start, end });
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Parse a LaTeX-ish math expression. Always returns a result — never throws.
 */
export function parseMath(source: string): ParseResult {
  const src = source ?? '';
  try {
    const tokens = tokenize(src).filter((t) => t.kind !== 'space');
    const st: ParserState = { tokens, index: 0, diagnostics: [] };
    const nodes = parseSequence(st, () => false);
    return { nodes, diagnostics: st.diagnostics };
  } catch (err) {
    // Defensive net: the editor must never crash on a bad formula.
    const message = err instanceof Error ? err.message : String(err);
    const end = src.length;
    return {
      nodes: [{ type: 'error', message, start: 0, end }],
      diagnostics: [{ severity: 'error', message, start: 0, end }],
    };
  }
}

// ---------------------------------------------------------------------------
// Sequences
// ---------------------------------------------------------------------------

function parseSequence(st: ParserState, isStop: (t: Token) => boolean): MathNode[] {
  const nodes: MathNode[] = [];
  while (!atEnd(st)) {
    const t = peek(st)!;
    if (isStop(t)) break;
    const node = parseNode(st);
    if (node) {
      nodes.push(node);
    } else {
      // Unparseable in this position (a stray closer, ...). Skip it so the
      // loop always makes progress.
      take(st);
    }
  }
  return nodes;
}

/** One atom plus any `^` / `_` scripts attached to it. */
function parseNode(st: ParserState): MathNode | null {
  const startTok = peek(st);
  if (!startTok) return null;
  const base = parseAtom(st);
  if (!base) return null;

  let sup: MathContent | null = null;
  let sub: MathContent | null = null;
  for (;;) {
    const t = peek(st);
    if (!t) break;
    if (t.kind === 'sup') {
      take(st);
      if (sup === null) sup = parseScriptOperand(st, '^');
    } else if (t.kind === 'sub') {
      take(st);
      if (sub === null) sub = parseScriptOperand(st, '_');
    } else {
      break;
    }
  }

  if (base.type === 'largeOperator') {
    if (sup === null && sub === null) return base;
    return {
      ...base,
      sup: base.sup ?? sup,
      sub: base.sub ?? sub,
      end: endOfPrev(st, base.end),
    };
  }

  if (sup === null && sub === null) return base;
  return { type: 'scripts', base, sup, sub, start: startTok.start, end: endOfPrev(st, startTok.end) };
}

function parseScriptOperand(st: ParserState, mark: string): MathContent {
  const t = peek(st);
  if (isClosingToken(t)) {
    return [addError(st, `missing script after "${mark}"`, t ? t.start : endOfPrev(st, 0), t ? t.end : endOfPrev(st, 0))];
  }
  const atom = parseAtom(st);
  if (!atom) {
    return [addError(st, `missing script after "${mark}"`, t!.start, t!.end)];
  }
  return [atom];
}

// ---------------------------------------------------------------------------
// Atoms
// ---------------------------------------------------------------------------

function parseAtom(st: ParserState): MathNode | null {
  const t = peek(st);
  if (!t) return null;

  switch (t.kind) {
    case 'lbrace': {
      take(st);
      const body = parseSequence(st, (tk) => tk.kind === 'rbrace');
      const close = peek(st);
      if (close && close.kind === 'rbrace') {
        take(st);
        return { type: 'group', body, open: null, close: null, start: t.start, end: close.end };
      }
      body.push(addError(st, 'unterminated group: missing "}"', t.start, endOfPrev(st, t.end)));
      return { type: 'group', body, open: null, close: null, start: t.start, end: endOfPrev(st, t.end) };
    }
    case 'lparen':
    case 'lbracket': {
      take(st);
      const wanted = t.kind === 'lparen' ? 'rparen' : 'rbracket';
      const open: MathDelimiter = t.kind === 'lparen' ? '(' : '[';
      const closeGlyph: MathDelimiter = t.kind === 'lparen' ? ')' : ']';
      const body = parseSequence(st, (tk) => tk.kind === wanted);
      const close = peek(st);
      if (close && close.kind === wanted) {
        take(st);
        return { type: 'group', body, open, close: closeGlyph, start: t.start, end: close.end };
      }
      body.push(addError(st, `unterminated group: missing "${closeGlyph}"`, t.start, endOfPrev(st, t.end)));
      return { type: 'group', body, open, close: closeGlyph, start: t.start, end: endOfPrev(st, t.end) };
    }
    case 'number': {
      take(st);
      return { type: 'number', value: t.value, start: t.start, end: t.end };
    }
    case 'char': {
      take(st);
      return { type: 'identifier', value: t.value, start: t.start, end: t.end };
    }
    case 'operator': {
      take(st);
      return { type: 'operator', value: t.value, command: null, start: t.start, end: t.end };
    }
    case 'command':
      return parseCommand(st);
    default:
      // Structural tokens that cannot start an atom (closers, & , \\ , ^, _).
      return null;
  }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function parseCommand(st: ParserState): MathNode | null {
  const t = take(st)!;
  const name = t.value;

  switch (name) {
    case 'frac': {
      const numerator = parseArgument(st, 'frac');
      const denominator = parseArgument(st, 'frac');
      return {
        type: 'fraction',
        numerator,
        denominator,
        start: t.start,
        end: endOfPrev(st, t.end),
      };
    }
    case 'sqrt': {
      let index: MathContent | null = null;
      const opt = peek(st);
      if (opt && opt.kind === 'lbracket') {
        take(st);
        index = parseSequence(st, (tk) => tk.kind === 'rbracket');
        if (peek(st)?.kind === 'rbracket') {
          take(st);
        } else {
          addError(st, 'unterminated optional argument: missing "]"', opt.start, endOfPrev(st, opt.end));
        }
      }
      const radicand = parseArgument(st, 'sqrt');
      return { type: 'root', radicand, index, start: t.start, end: endOfPrev(st, t.end) };
    }
    case 'left': {
      const open = readDelimiter(st);
      const body = parseSequence(st, (tk) => tk.kind === 'command' && tk.value === 'right');
      const rightTok = peek(st);
      let close: MathDelimiter | null = matchingDelimiter(open);
      if (rightTok && rightTok.kind === 'command' && rightTok.value === 'right') {
        take(st);
        close = readDelimiter(st);
      } else {
        addError(st, 'missing \\right', t.start, endOfPrev(st, t.end));
      }
      return { type: 'group', body, open, close, start: t.start, end: endOfPrev(st, t.end) };
    }
    case 'right': {
      readDelimiter(st);
      return addError(st, 'unexpected \\right', t.start, t.end);
    }
    case 'begin':
      return parseEnvironment(st, t);
    case 'end': {
      readEnvironmentName(st);
      return addError(st, 'unexpected \\end', t.start, t.end);
    }
    default:
      return parseSimpleCommand(st, t);
  }
}

function parseSimpleCommand(st: ParserState, t: Token): MathNode {
  const name = t.value;
  const greek = GREEK_LETTERS[name];
  if (greek !== undefined) {
    return { type: 'symbol', char: greek, command: name, start: t.start, end: t.end };
  }
  const op = OPERATOR_COMMANDS[name];
  if (op !== undefined) {
    return { type: 'operator', value: op, command: name, start: t.start, end: t.end };
  }
  const fn = FUNCTION_COMMANDS[name];
  if (fn !== undefined) {
    return { type: 'function', name: fn, command: name, start: t.start, end: t.end };
  }
  const big = LARGE_OPERATORS[name];
  if (big !== undefined) {
    return {
      type: 'largeOperator',
      symbol: big,
      command: name,
      sup: null,
      sub: null,
      start: t.start,
      end: t.end,
    };
  }
  addWarning(st, `unknown command "\\${name}"`, t.start, t.end);
  return { type: 'unknown', command: name, start: t.start, end: t.end };
}

/** Read one command argument: a `{...}` group, or a single atom. */
function parseArgument(st: ParserState, command: string): MathContent {
  const t = peek(st);
  if (!t || isClosingToken(t)) {
    return [addError(st, `missing argument for "\\${command}"`, endOfPrev(st, 0), endOfPrev(st, 0))];
  }
  if (t.kind === 'lbrace') {
    take(st);
    const body = parseSequence(st, (tk) => tk.kind === 'rbrace');
    if (peek(st)?.kind === 'rbrace') {
      take(st);
    } else {
      body.push(addError(st, 'unterminated group: missing "}"', t.start, endOfPrev(st, t.end)));
    }
    return body;
  }
  const atom = parseAtom(st);
  if (!atom) {
    return [addError(st, `missing argument for "\\${command}"`, t.start, t.end)];
  }
  return [atom];
}

function readDelimiter(st: ParserState): MathDelimiter | null {
  const t = take(st);
  if (!t) return null;
  switch (t.kind) {
    case 'lparen':
      return '(';
    case 'rparen':
      return ')';
    case 'lbracket':
      return '[';
    case 'rbracket':
      return ']';
    case 'lbrace':
      return '{';
    case 'rbrace':
      return '}';
    case 'operator':
      return t.value === '|' ? '|' : t.value === '.' ? null : null;
    case 'char':
      return t.value === '{' || t.value === '}' ? (t.value as MathDelimiter) : null;
    default:
      // Not a delimiter at all — put it back and treat as "none".
      st.index -= 1;
      return null;
  }
}

function matchingDelimiter(open: MathDelimiter | null): MathDelimiter | null {
  switch (open) {
    case '(':
      return ')';
    case '[':
      return ']';
    case '{':
      return '}';
    case '|':
      return '|';
    default:
      return null;
  }
}

/** Read `{matrix}` / `{aligned}` / ... and return the bare name. */
function readEnvironmentName(st: ParserState): string | null {
  const lb = peek(st);
  if (!lb || lb.kind !== 'lbrace') return null;
  take(st);
  let name = '';
  while (!atEnd(st)) {
    const t = take(st)!;
    if (t.kind === 'rbrace') break;
    name += t.value;
  }
  return name;
}

function parseEnvironment(st: ParserState, beginTok: Token): MathNode {
  const name = readEnvironmentName(st);
  if (name === null) {
    return addError(st, 'missing environment name after \\begin', beginTok.start, beginTok.end);
  }
  const env: MathEnv | null = name === 'matrix' ? 'matrix' : name === 'aligned' ? 'aligned' : null;
  const rows = parseRows(st, name);
  if (env === null) {
    return addError(st, `unsupported environment "${name}"`, beginTok.start, endOfPrev(st, beginTok.end));
  }
  return { type: 'matrix', env, rows, start: beginTok.start, end: endOfPrev(st, beginTok.end) };
}

/** Parse the body of an environment: `&` splits cells, `\\` splits rows. */
function parseRows(st: ParserState, envName: string): MathRow[] {
  const rows: MathCell[][] = [];
  let cells: MathCell[] = [];
  let current: MathNode[] = [];
  let sawEnd = false;

  const flushCell = (): void => {
    cells.push(current);
    current = [];
  };
  const flushRow = (): void => {
    flushCell();
    rows.push(cells);
    cells = [];
  };

  while (!atEnd(st)) {
    const t = peek(st)!;
    if (t.kind === 'newline') {
      take(st);
      flushRow();
      continue;
    }
    if (t.kind === 'amp') {
      take(st);
      flushCell();
      continue;
    }
    if (t.kind === 'command' && t.value === 'end') {
      take(st);
      const closing = readEnvironmentName(st);
      sawEnd = true;
      if (closing !== null && closing !== envName) {
        addWarning(
          st,
          `environment "${envName}" closed by \\end{${closing}}`,
          t.start,
          endOfPrev(st, t.end),
        );
      }
      break;
    }
    const node = parseNode(st);
    if (node) {
      current.push(node);
    } else {
      take(st);
    }
  }

  if (current.length > 0 || cells.length > 0) flushRow();
  if (!sawEnd) {
    addError(st, `missing \\end{${envName}}`, endOfPrev(st, 0), endOfPrev(st, 0));
  }
  return rows;
}
