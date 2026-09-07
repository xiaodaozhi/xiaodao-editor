/**
 * Tokenizer for the built-in math renderer.
 *
 * The tokenizer is deliberately dumb: it recognises the *shape* of the input
 * (commands, braces, scripts, delimiters, ...) and never tries to understand
 * mathematical structure. Structure is the parser's job.
 *
 * Single pass, O(n), no backtracking.
 */

export type TokenKind
  = | 'command'
    | 'char'
    | 'number'
    | 'operator'
    | 'lbrace'
    | 'rbrace'
    | 'lbracket'
    | 'rbracket'
    | 'lparen'
    | 'rparen'
    | 'sup'
    | 'sub'
    | 'amp'
    | 'newline'
    | 'space';

export interface Token {
  readonly kind: TokenKind;
  /** For `command`, the name WITHOUT the leading backslash. */
  readonly value: string;
  readonly start: number;
  readonly end: number;
}

function isLetter(ch: string): boolean {
  return /[A-Za-z]/.test(ch);
}

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}

function isSpace(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f' || ch === '\v';
}

/**
 * Single-character structural punctuation. Each entry maps one LaTeX
 * delimiter / grouping / script marker to its dedicated `TokenKind`
 * branch so the parser can dispatch on `kind` directly instead of
 * comparing string values. Anything not in this table falls through to
 * the `operator` branch below.
 */
const STRUCTURAL_CHARS: Readonly<Record<string, TokenKind>> = {
  '{': 'lbrace',
  '}': 'rbrace',
  '[': 'lbracket',
  ']': 'rbracket',
  '(': 'lparen',
  ')': 'rparen',
  '^': 'sup',
  '_': 'sub',
  '&': 'amp',
};

/**
 * Split a LaTeX-ish math expression into tokens. Never throws: any character
 * that is not otherwise recognised becomes an `operator` token.
 */
export function tokenize(source: string): Token[] {
  const src = source ?? '';
  const out: Token[] = [];
  let i = 0;

  while (i < src.length) {
    const ch = src[i]!;

    // --- Backslash: command, row break, or escaped literal -------------------
    if (ch === '\\') {
      const next = src[i + 1];
      if (next === '\\') {
        out.push({ kind: 'newline', value: '\\\\', start: i, end: i + 2 });
        i += 2;
        continue;
      }
      if (next !== undefined && isLetter(next)) {
        let j = i + 1;
        while (j < src.length && isLetter(src[j]!)) j += 1;
        out.push({ kind: 'command', value: src.slice(i + 1, j), start: i, end: j });
        i = j;
        continue;
      }
      if (next !== undefined) {
        // `\$`, `\{`, `\,`, ... -> the literal character itself.
        out.push({ kind: 'char', value: next, start: i, end: i + 2 });
        i += 2;
        continue;
      }
      // A trailing lone backslash: keep it as a literal.
      out.push({ kind: 'char', value: '\\', start: i, end: i + 1 });
      i += 1;
      continue;
    }

    // --- Letters ------------------------------------------------------------
    if (isLetter(ch)) {
      out.push({ kind: 'char', value: ch, start: i, end: i + 1 });
      i += 1;
      continue;
    }

    // --- Numbers (digits with at most one embedded dot) ----------------------
    if (isDigit(ch)) {
      let j = i;
      let seenDot = false;
      while (j < src.length) {
        const c = src[j]!;
        if (isDigit(c)) {
          j += 1;
          continue;
        }
        if (c === '.' && !seenDot && j + 1 < src.length && isDigit(src[j + 1]!)) {
          seenDot = true;
          j += 1;
          continue;
        }
        break;
      }
      out.push({ kind: 'number', value: src.slice(i, j), start: i, end: j });
      i = j;
      continue;
    }

    // --- Whitespace (merged into a single token) -----------------------------
    if (isSpace(ch)) {
      let j = i;
      while (j < src.length && isSpace(src[j]!)) j += 1;
      out.push({ kind: 'space', value: src.slice(i, j), start: i, end: j });
      i = j;
      continue;
    }

    // --- Structural punctuation ---------------------------------------------
    const structural: TokenKind | null = STRUCTURAL_CHARS[ch] ?? null;

    if (structural) {
      out.push({ kind: structural, value: ch, start: i, end: i + 1 });
      i += 1;
      continue;
    }

    // --- Everything else is an operator --------------------------------------
    out.push({ kind: 'operator', value: ch, start: i, end: i + 1 });
    i += 1;
  }

  return out;
}
