/**
 * Built-in, zero-dependency math engine for xiaodao-editor.
 *
 * Pipeline: expression -> tokenize -> parse (AST) -> render tree -> VNode / HTML
 *
 * Nothing in this folder depends on KaTeX, MathJax, the DOM, or the editor:
 * it is a pure, dependency-free LaTeX-subset renderer.
 */

export type {
  MathCell,
  MathContent,
  MathDelimiter,
  MathDiagnostic,
  MathEnv,
  MathNode,
  MathNodeType,
  MathRow,
  MathSpan,
  ParseResult,
} from './ast';
export type {
  MathErrorNode,
  MathFractionNode,
  MathFunctionNode,
  MathGroupNode,
  MathIdentifierNode,
  MathLargeOperatorNode,
  MathMatrixNode,
  MathNumberNode,
  MathOperatorNode,
  MathRootNode,
  MathScriptsNode,
  MathSymbolNode,
  MathTextNode,
  MathUnknownNode,
} from './ast';

export { tokenize } from './tokens';
export type { Token, TokenKind } from './tokens';

export {
  FUNCTION_COMMANDS,
  GREEK_LETTERS,
  LARGE_OPERATORS,
  OPERATOR_COMMANDS,
  STRUCTURAL_COMMANDS,
  SUPPORTED_COMMANDS,
  isSupportedCommand,
} from './symbols';

export { parseMath } from './parser';

export { buildRenderTree } from './renderTree';
export type { MathElement, RenderContext } from './renderTree';

export { renderMathToVNode } from './renderVNode';
export { escapeHtmlText, renderMathToHtml } from './renderHtml';
