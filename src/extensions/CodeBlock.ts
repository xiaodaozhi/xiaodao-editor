/**
 * CodeBlock / fenced code extension.
 *
 * Marked as an *isolating* block:
 *   - Enter inserts a newline inside the block (not a new paragraph).
 *   - Backspace at offset 0 on an empty code block removes it; it will NOT
 *     merge into the previous block.
 *   - Schema `content: 'text'` but the renderer switches to `white-space: pre;
 *     font-family: monospace`.
 *
 * Markdown shortcuts: ```  (three backticks + Enter or space) or ```lang.
 *
 * Syntax highlighting:
 *   The block renders as a two-layer stack so code can be highlighted
 *   without ever writing rich HTML into the contenteditable:
 *     - A decorative `<pre class="block-code-highlight">` layer
 *       (position: absolute, pointer-events: none, aria-hidden) that shows
 *       the highlighted tokens, aligned pixel-for-pixel with the text layer.
 *     - The normal `BlockContent` editable layer on top. Its text color is
 *       transparent by default (only the caret stays visible) so the
 *       highlight layer shows through. While the block is focused, the text
 *       layer becomes visible again (plain text, like Notion) and the
 *       highlight layer fades out: no visual overlap, and the editor model
 *       keeps plain text at all times.
 */

import { defineComponent, h, ref, computed, type PropType } from 'vue';
import { useI18n } from '../i18n';
import type { Extension } from '../core/extension/Extension';
import type { Block } from '../core/types';
import { inlineText } from '../core/types';
import BlockContent from '../view/BlockContent.vue';
import { useEditable } from '../view/context';
import { ICON_CODE } from '../view/ui/icons';
import { classesFromAttrs, CODE_BLOCK_ATTRS } from './_commonAttrs';

import { builtinCodeHighlighter, type CodeHighlighter } from './code/highlight';

export { builtinCodeHighlighter } from './code/highlight';
export type { CodeHighlighter } from './code/highlight';

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function highlightCode(highlighter: CodeHighlighter, text: string, language: string): string {
  try {
    const html = highlighter.highlightCode(text, language);
    return typeof html === 'string' ? html : escapeHtml(text);
  } catch {
    return escapeHtml(text);
  }
}

function createCodeBlock(highlighter: CodeHighlighter) {
  return defineComponent({
    name: 'CodeBlock',
    props: {
      block: { type: Object as PropType<Block>, required: true },
      placeholder: { type: String, default: undefined },
    },
    setup(props) {
      const langEl = ref<HTMLElement | null>(null);
      const i18n = useI18n();
      const editable = useEditable();

      // Decorative highlight HTML. Computed so re-highlighting only happens
      // when the block's content or language actually changes.
      const highlightHtml = computed(() =>
        highlightCode(
          highlighter,
          inlineText(props.block.content),
          (props.block.attrs.language as string) ?? 'plain',
        ),
      );

      return () => {
        const lang = (props.block.attrs.language as string) ?? 'plain';
        const langLabel = h(
          'div',
          {
            ref: langEl,
            class: 'block-code-lang',
            onMousedown: (e: MouseEvent) => {
              e.preventDefault();
              e.stopPropagation();
            },
            onClick: (e: MouseEvent) => {
              e.stopPropagation();
              // Read-only: clicking the language label must not open the picker.
              if (!editable.value) return;
              const ev = new CustomEvent('code-lang-click', {
                bubbles: true,
                detail: { blockId: props.block.id, anchor: langEl.value },
              })
              ;(e.currentTarget as HTMLElement).dispatchEvent(ev);
            },
          },
          lang.toUpperCase(),
        );
        // Static "code block" label pinned to the top-left corner, sharing the
        // typography of the language label (top-right). Purely decorative:
        // clicks pass through to the editable area (pointer-events: none).
        const titleLabel = h('div', { class: 'block-code-title' }, i18n.t('codeBlock.title'));
        // Highlight layer: absolutely positioned under the editable text layer.
        const highlightLayer = h(
          'pre',
          { class: 'block-code-highlight', 'aria-hidden': 'true' },
          [h('code', { class: 'hljs', innerHTML: highlightHtml.value })],
        );
        return h('div', { class: ['block-code-wrapper', 'block-focus-root', ...classesFromAttrs(props.block.attrs)], 'data-lang': lang }, [
          titleLabel,
          langLabel,
          highlightLayer,
          h(BlockContent, {
            block: props.block,
            placeholder: props.placeholder,
            class: 'block-code',
          }),
        ]);
      };
    },
  });
}

export interface CodeBlockExtensionOptions {
  readonly highlighter?: CodeHighlighter;
}

export function createCodeBlockExtension(options: CodeBlockExtensionOptions = {}): Extension {
  const highlighter = options.highlighter ?? builtinCodeHighlighter;
  return {
    name: 'codeBlock',
    schema: {
      type: 'codeBlock',
      content: 'text',
      nestable: false,
      isolating: true,
      inlineMarks: false,
      attrs: {
        ...CODE_BLOCK_ATTRS,
        language: {
          default: 'plain',
          validate: (v: unknown): boolean => typeof v === 'string' && v.length > 0,
        },
      },
    },
    renderer: { component: createCodeBlock(highlighter) },
    serialize: {
      toHTML: (block: Block): string => {
        const language = typeof block.attrs.language === 'string' ? block.attrs.language : 'plain';
        const html = highlightCode(highlighter, inlineText(block.content), language);
        return `<pre class="block-code-highlight"><code class="hljs">${html}</code></pre>`;
      },
    },
    slashCommands: [
      {
        id: 'code-block',
        title: 'slash.codeBlock.title',
        keywords: ['code', 'fence', 'pre', '代码', '代码块', '```', 'codeblock'],
        description: 'slash.codeBlock.description',
        icon: ICON_CODE,
        command: 'convertBlock',
        category: 'other',
        args: (): unknown => ({ id: '__currentBlock__', type: 'codeBlock', attrs: { language: 'plain' } }),
      },
    ],
    inputRules: [
      {
        name: 'code-fence',
        pattern: /^``` ?$/,
        command: 'convertBlock',
        args: (m: RegExpExecArray | null): unknown => {
          const text = m?.input ?? '';
          // Extract language if user typed ```js: the pattern's $ ensures it's
          // just ``` plus optional trailing space, so language defaults to plain.
          void text;
          return {
            id: '__currentBlock__',
            type: 'codeBlock',
            attrs: { language: 'plain' },
            __stripPrefix: 3,
          };
        },
      },
    ],
  };
}

export const CodeBlockExtension: Extension = createCodeBlockExtension();
