/**
 * BulletList / Unordered list item block extension.
 *
 * Renders a bullet (`•`) prefix. Each item is a separate top-level block
 * (Phase 2 does not have nesting). Pressing Enter on an empty bullet item
 * exits (converts to paragraph) because the schema's `empty` rule works with
 * the built-in Backspace/empty-Enter behavior.
 */

import { defineComponent, h, type PropType } from 'vue';
import type { Extension } from '../core/extension/Extension';
import type { Block } from '../core/types';
import BlockContent from '../view/BlockContent.vue';
import { ICON_BULLET_LIST } from '../view/ui/icons';
import { classesFromAttrs, COMMON_ATTRS } from './_commonAttrs';

const BulletListBlock = defineComponent({
  name: 'BulletListBlock',
  props: {
    block: { type: Object as PropType<Block>, required: true },
    placeholder: { type: String, default: undefined },
  },
  setup(props) {
    return () =>
      h(BlockContent, {
        block: props.block,
        placeholder: props.placeholder,
        class: ['block-bullet-list', ...classesFromAttrs(props.block.attrs)],
      });
  },
});

export const BulletListExtension: Extension = {
  name: 'bulletList',
  schema: {
    type: 'bulletList',
    content: 'text',
    nestable: false,
    listLike: true,
    attrs: { ...COMMON_ATTRS },
  },
  renderer: { component: BulletListBlock },
  slashCommands: [
    {
      id: 'bullet-list',
      title: 'slash.bulletList.title',
      keywords: ['list', 'bullet', 'unordered', '项目符号', '无序列表', 'ul', '-', '*'],
      description: 'slash.bulletList.description',
      icon: ICON_BULLET_LIST,
      command: 'convertBlock',
      category: 'list',
      args: (): unknown => ({ id: '__currentBlock__', type: 'bulletList' }),
    },
  ],
  inputRules: [
    {
      name: 'bullet-dash',
      pattern: /^- $/,
      command: 'convertBlock',
      args: (): unknown => ({ id: '__currentBlock__', type: 'bulletList', __stripPrefix: 2 }),
    },
    {
      name: 'bullet-star',
      pattern: /^\* $/,
      command: 'convertBlock',
      args: (): unknown => ({ id: '__currentBlock__', type: 'bulletList', __stripPrefix: 2 }),
    },
  ],
};
