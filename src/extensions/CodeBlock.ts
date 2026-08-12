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
import { useI18n } from '../i18n';
import type { Extension } from '../core/extension/Extension';
import type { Block } from '../core/types';
import BlockContent from '../view/BlockContent.vue';
import { useEditable } from '../view/context';
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
    const i18n = useI18n();
    const editable = useEditable();
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
      // typography of the language label (top-right). Purely decorative —
      // clicks pass through to the editable area (pointer-events: none).
      const titleLabel = h('div', { class: 'block-code-title' }, i18n.t('codeBlock.title'));
      return h('div', { class: 'block-code-wrapper', 'data-lang': lang }, [
        titleLabel,
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
