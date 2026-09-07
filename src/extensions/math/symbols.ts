/**
 * Symbol tables for the built-in math renderer.
 *
 * This file is the single source of truth for "what does the built-in renderer
 * understand". Everything listed here is rendered as a real math glyph; every
 * other command degrades gracefully to an `unknown` node.
 *
 * Glyphs are plain Unicode characters — no font download, no SVG, no MathML.
 */

/** Greek letters, lowercase + the uppercase variants the spec requires. */
export const GREEK_LETTERS: Readonly<Record<string, string>> = {
  alpha: '\u03B1',
  beta: '\u03B2',
  gamma: '\u03B3',
  delta: '\u03B4',
  epsilon: '\u03B5',
  zeta: '\u03B6',
  eta: '\u03B7',
  theta: '\u03B8',
  iota: '\u03B9',
  kappa: '\u03BA',
  lambda: '\u03BB',
  mu: '\u03BC',
  nu: '\u03BD',
  xi: '\u03BE',
  pi: '\u03C0',
  rho: '\u03C1',
  sigma: '\u03C3',
  tau: '\u03C4',
  upsilon: '\u03C5',
  phi: '\u03C6',
  chi: '\u03C7',
  psi: '\u03C8',
  omega: '\u03C9',
  Gamma: '\u0393',
  Delta: '\u0394',
  Theta: '\u0398',
  Lambda: '\u039B',
  Xi: '\u039E',
  Pi: '\u03A0',
  Sigma: '\u03A3',
  Upsilon: '\u03A5',
  Phi: '\u03A6',
  Psi: '\u03A8',
  Omega: '\u03A9',
};

/** Binary relations / operators expressed as LaTeX commands. */
export const OPERATOR_COMMANDS: Readonly<Record<string, string>> = {
  pm: '\u00B1',
  mp: '\u2213',
  times: '\u00D7',
  div: '\u00F7',
  cdot: '\u22C5',
  ast: '\u2217',
  star: '\u22C6',
  circ: '\u2218',
  neq: '\u2260',
  ne: '\u2260',
  leq: '\u2264',
  le: '\u2264',
  geq: '\u2265',
  ge: '\u2265',
  ll: '\u226A',
  gg: '\u226B',
  approx: '\u2248',
  equiv: '\u2261',
  sim: '\u223C',
  propto: '\u221D',
  infty: '\u221E',
  partial: '\u2202',
  nabla: '\u2207',
  to: '\u2192',
  rightarrow: '\u2192',
  longrightarrow: '\u27F6',
  leftarrow: '\u2190',
  leftrightarrow: '\u2194',
  mapsto: '\u21A6',
  dots: '\u2026',
  ldots: '\u2026',
  cdots: '\u22EF',
  vdots: '\u22EE',
  prime: '\u2032',
  angle: '\u2220',
  in: '\u2208',
  notin: '\u2209',
  subset: '\u2282',
  cup: '\u222A',
  cap: '\u2229',
  forall: '\u2200',
  exists: '\u2203',
  emptyset: '\u2205',
  langle: '\u27E8',
  rangle: '\u27E9',
};

/** Named functions, rendered upright (so `\sin x` never looks like `s i n x`). */
export const FUNCTION_COMMANDS: Readonly<Record<string, string>> = {
  sin: 'sin',
  cos: 'cos',
  tan: 'tan',
  cot: 'cot',
  sec: 'sec',
  csc: 'csc',
  arcsin: 'arcsin',
  arccos: 'arccos',
  arctan: 'arctan',
  sinh: 'sinh',
  cosh: 'cosh',
  tanh: 'tanh',
  log: 'log',
  ln: 'ln',
  lg: 'lg',
  exp: 'exp',
  lim: 'lim',
  liminf: 'lim inf',
  limsup: 'lim sup',
  min: 'min',
  max: 'max',
  sup: 'sup',
  inf: 'inf',
  det: 'det',
  gcd: 'gcd',
  dim: 'dim',
  arg: 'arg',
  deg: 'deg',
};

/** Operators whose limits are placed above/below in display mode. */
export const LARGE_OPERATORS: Readonly<Record<string, string>> = {
  sum: '\u2211',
  prod: '\u220F',
  coprod: '\u2210',
  int: '\u222B',
  iint: '\u222C',
  oint: '\u222E',
  bigcup: '\u22C3',
  bigcap: '\u22C2',
};

/** Structural commands handled directly by the parser. */
export const STRUCTURAL_COMMANDS: readonly string[] = [
  'frac',
  'sqrt',
  'left',
  'right',
  'begin',
  'end',
];

/**
 * Every command name the built-in renderer understands. Exported so docs and
 * tests can assert the supported surface without duplicating the tables.
 */
export const SUPPORTED_COMMANDS: readonly string[] = [
  ...STRUCTURAL_COMMANDS,
  ...Object.keys(GREEK_LETTERS),
  ...Object.keys(OPERATOR_COMMANDS),
  ...Object.keys(FUNCTION_COMMANDS),
  ...Object.keys(LARGE_OPERATORS),
];

export function isSupportedCommand(name: string): boolean {
  return (
    STRUCTURAL_COMMANDS.includes(name)
    || Object.prototype.hasOwnProperty.call(GREEK_LETTERS, name)
    || Object.prototype.hasOwnProperty.call(OPERATOR_COMMANDS, name)
    || Object.prototype.hasOwnProperty.call(FUNCTION_COMMANDS, name)
    || Object.prototype.hasOwnProperty.call(LARGE_OPERATORS, name)
  );
}
