/**
 * Render tree -> escaped HTML string.
 *
 * Used for HTML export, SSR and any non-Vue consumer. Every text value is
 * escaped, and every tag/class/style comes from our own render tree (never from
 * user input), so the output cannot carry executable markup.
 */

import type { MathContent } from './ast';
import { buildRenderTree, type MathElement, type RenderContext } from './renderTree';

export function renderMathToHtml(nodes: MathContent, ctx: RenderContext): string {
  return toHtml(buildRenderTree(nodes, ctx));
}

/** Escape for element text content. */
export function escapeHtmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Escape for attribute values (also quotes quotes). */
function escapeHtmlAttr(value: string): string {
  return escapeHtmlText(value).replace(/"/g, '&quot;');
}

/**
 * Vue accepts camelCase style keys, but a raw HTML string needs kebab-case.
 */
function toCssProperty(key: string): string {
  return key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

function styleToString(style: Readonly<Record<string, string>>): string {
  return Object.keys(style)
    .map((key) => `${toCssProperty(key)}: ${escapeHtmlAttr(style[key] ?? '')}`)
    .join('; ');
}

function toHtml(element: MathElement): string {
  // Tag names are produced exclusively by `renderTree`, never by user input.
  const cls = element.class ? ` class="${escapeHtmlAttr(element.class)}"` : '';
  const style = element.style ? ` style="${escapeHtmlAttr(styleToString(element.style))}"` : '';
  const open = `<${element.tag}${cls}${style}>`;
  if (element.text !== null) {
    return `${open}${escapeHtmlText(element.text)}</${element.tag}>`;
  }
  const inner = element.children ? element.children.map(toHtml).join('') : '';
  return `${open}${inner}</${element.tag}>`;
}
