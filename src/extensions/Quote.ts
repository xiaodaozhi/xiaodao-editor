/**
 * Quote / blockquote extension.
 *
 * Rendered with a left bar; supports the Markdown shortcut `> ` at the block
 * start to convert.
 */

import { defineComponent, h, type PropType } from 'vue';
import type { Extension } from '../core/extension/Extension';
import type { Block } from '../core/types';
import BlockContent from '../view/BlockContent.vue';
import { ICON_QUOTE } from '../view/ui/icons';
import { classesFromAttrs, COMMON_ATTRS, COMMON_ATTRS_NO_INDENT } from './_commonAttrs';

const QuoteBlock = defineComponent({
  name: 'QuoteBlock',
  props: {
    block: { type: Object as PropType<Block>, required: true },
    placeholder: { type: String, default: undefined },
  },
  setup(props) {
    return () =>
      h(BlockContent, {
        block: props.block,
        placeholder: props.placeholder,
        class: ['block-quote', ...classesFromAttrs(props.block.attrs)],
      });
  },
});

export const QuoteExtension: Extension = {
  name: 'quote',
  schema: {
    type: 'quote',
    content: 'text',
    nestable: false,
    // Quote blocks render italic globally via CSS, so an inline italic mark
    // would be redundant — disallow it.
    disallowedMarks: ['italic'],
    // quote can be a CHILD block (indented under a nestable sibling),
    // so it needs the `indent` attr to reflect its nesting depth and render
    // the be-indent-N class. (nestable=false only means it can't be a parent.)
    attrs: { ...COMMON_ATTRS_NO_INDENT, indent: COMMON_ATTRS.indent },
  },
  renderer: { component: QuoteBlock },
  slashCommands: [
    {
      id: 'quote',
      title: 'slash.quote.title',
      keywords: ['quote', 'blockquote', '引用', '>', '引言'],
      description: 'slash.quote.description',
      icon: ICON_QUOTE,
      command: 'convertBlock',
      category: 'other',
      args: (): unknown => ({ id: '__currentBlock__', type: 'quote' }),
    },
  ],
  inputRules: [
    {
      name: 'quote-gt',
      pattern: /^> $/,
      command: 'convertBlock',
      args: (): unknown => ({ id: '__currentBlock__', type: 'quote', __stripPrefix: 2 }),
    },
  ],
};
