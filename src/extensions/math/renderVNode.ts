/**
 * Render tree -> Vue VNode tree.
 *
 * Text is always passed as a child string to `h()`, which Vue turns into a real
 * text node. Nothing here ever builds an HTML string, so user input can never
 * become markup.
 */

import { h, type VNode } from 'vue';
import type { MathContent } from './ast';
import { buildRenderTree, type MathElement, type RenderContext } from './renderTree';

export function renderMathToVNode(nodes: MathContent, ctx: RenderContext): VNode {
  return toVNode(buildRenderTree(nodes, ctx));
}

function toVNode(element: MathElement): VNode {
  const props: Record<string, unknown> = {};
  if (element.class) props.class = element.class;
  if (element.style) props.style = element.style;
  if (element.text !== null) return h(element.tag, props, element.text);
  const children = element.children ? element.children.map(toVNode) : undefined;
  return h(element.tag, props, children);
}
