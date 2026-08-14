/**
 * Paragraph extension: the default text block.
 *
 * Registers the "paragraph" block type with a text-content schema and a simple
 * renderer that wraps `BlockContent` with a CSS class. Paragraph is the
 * fallback block type used when the user presses Enter on an empty block or
 * exits a non-text block.
 */

import { defineComponent, h, type PropType } from 'vue';
import type { Extension } from '../core/extension/Extension';
import type { Block, BlockId } from '../core/types';
import BlockContent from '../view/BlockContent.vue';
import { ICON_PARAGRAPH } from '../view/ui/icons';
import { classesFromAttrs, COMMON_ATTRS } from './_commonAttrs';

const ParagraphBlock = defineComponent({
  name: 'ParagraphBlock',
  props: {
    block: { type: Object as PropType<Block>, required: true },
    placeholder: { type: String, default: undefined },
  },
  setup(props) {
    return () =>
      h(BlockContent, {
        block: props.block,
        placeholder: props.placeholder,
        class: ['block-paragraph', ...classesFromAttrs(props.block.attrs)],
      });
  },
});

/** Slash-menu icon — SVG string from shared icons module. */

export const ParagraphExtension: Extension = {
  name: 'paragraph',
  schema: {
    type: 'paragraph',
    content: 'text',
    nestable: true,
    attrs: { ...COMMON_ATTRS },
  },
  renderer: {
    component: ParagraphBlock,
  },
  slashCommands: [
    {
      id: 'paragraph',
      title: 'slash.paragraph.title',
      keywords: ['text', 'paragraph', 'normal', '正文', '段落'],
      description: 'slash.paragraph.description',
      icon: ICON_PARAGRAPH,
      command: 'convertBlock',
      category: 'basic',
      args: (match: RegExpExecArray | null): unknown => {
        void match;
        return { id: '__currentBlock__', type: 'paragraph' };
      },
    },
  ],
  inputRules: [
    {
      // ` ` after `< / >` etc. — paragraph exits a styled block when the user
      // clears and types a space. For paragraph specifically we keep the
      // pattern free for other uses but still expose an empty-string trigger
      // as a no-op so the rule list is never empty in tests.
      name: 'paragraph-noop',
      pattern: /^$/,
      command: 'setText',
      args: (match): unknown => {
        void match;
        return { id: '__currentBlock__', content: [] };
      },
    },
  ],
};

// The __currentBlock__ placeholder is resolved by the slash-menu UI before
// dispatch (see `SlashMenu.vue`). Exporting it as a typed constant helps
// avoid duplication across extensions.
export const CURRENT_BLOCK_PLACEHOLDER: BlockId = '__currentBlock__' as BlockId;
