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
 */

import { defineComponent, h, ref, type PropType } from 'vue';
import type { Extension } from '../core/extension/Extension';
import type { Block } from '../core/types';
import BlockContent from '../view/BlockContent.vue';
import { ICON_CODE } from '../view/ui/icons';
import { classesFromAttrs, CODE_BLOCK_ATTRS } from './_commonAttrs';

const CodeBlock = defineComponent({
  name: 'CodeBlock',
  props: {
    block: { type: Object as PropType<Block>, required: true },
    placeholder: { type: String, default: undefined },
  },
  setup(props) {
    const langEl = ref<HTMLElement | null>(null);
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
            const ev = new CustomEvent('code-lang-click', {
              bubbles: true,
              detail: { blockId: props.block.id, anchor: langEl.value },
            })
            ;(e.currentTarget as HTMLElement).dispatchEvent(ev);
          },
        },
        lang.toUpperCase(),
      );
      return h('div', { class: 'block-code-wrapper', 'data-lang': lang }, [
        langLabel,
        h(BlockContent, {
          block: props.block,
          placeholder: props.placeholder,
          class: ['block-code', ...classesFromAttrs(props.block.attrs)],
        }),
      ]);
    };
  },
});

export const CodeBlockExtension: Extension = {
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
  renderer: { component: CodeBlock },
  slashCommands: [
    {
      id: 'code-block',
      title: '代码块',
      keywords: ['code', 'fence', 'pre', '代码', '代码块', '```', 'codeblock'],
      description: '插入一段代码块。',
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
        // Extract language if user typed ```js — the pattern's $ ensures it's
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
