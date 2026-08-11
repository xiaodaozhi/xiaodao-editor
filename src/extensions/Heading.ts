/**
 * Heading extension: block-type for h1–h6 headings.
 *
 * The `level` attr (1–6) determines the visual size. The renderer wraps
 * `BlockContent` with a CSS class derived from the level. Markdown shortcuts
 * ("# ", "## ", …) and slash-menu entries registered in Phase 2.
 */

import { defineComponent, h, type PropType } from 'vue';
import type { Extension } from '../core/extension/Extension';
import type { Block } from '../core/types';
import BlockContent from '../view/BlockContent.vue';
import { ICON_H1, ICON_H2, ICON_H3, ICON_H4, ICON_H5, ICON_H6 } from '../view/ui/icons';
import { classesFromAttrs, COMMON_ATTRS } from './_commonAttrs';

const HeadingBlock = defineComponent({
  name: 'HeadingBlock',
  props: {
    block: { type: Object as PropType<Block>, required: true },
    placeholder: { type: String, default: undefined },
  },
  setup(props) {
    return () => {
      const level = (props.block.attrs.level as number) ?? 1;
      return h(BlockContent, {
        block: props.block,
        placeholder: props.placeholder,
        class: [`block-heading`, `block-heading-h${level}`, ...classesFromAttrs(props.block.attrs)],
      });
    };
  },
});

/**
 * Markdown-shortcut input rule for headings.
 *
 * The rule pattern `/^#{1,6} $/` is shared — the engine will determine the
 * level from the matched text. The engine (see `src/view/inputRulesEngine.ts`)
 * detects the private `__heading` hint and invokes `convertBlock` after
 * stripping the matching prefix from the block's text.
 */
function headingRule(level: number) {
  const hashes = '#'.repeat(level);
  return {
    name: `heading-h${level}`,
    pattern: new RegExp(`^${hashes} $`),
    command: 'convertBlock',
    args: (): unknown => ({
      id: '__currentBlock__',
      type: 'heading',
      attrs: { level },
      __stripPrefix: level + 1,
    }),
  };
}

const headingSlash = (
  id: string,
  level: number,
  title: string,
  icon: string,
  keywords: readonly string[],
) => ({
  id,
  title,
  keywords,
  description: `${title}。`,
  icon,
  command: 'convertBlock',
  category: 'basic',
  args: (): unknown => ({ id: '__currentBlock__', type: 'heading', attrs: { level } }),
});

export const HeadingExtension: Extension = {
  name: 'heading',
  schema: {
    type: 'heading',
    content: 'text',
    nestable: false,
    attrs: {
      level: {
        default: 1,
        validate: (v: unknown): boolean => typeof v === 'number' && v >= 1 && v <= 6,
      },
      ...COMMON_ATTRS,
    },
  },
  renderer: {
    component: HeadingBlock,
  },
  slashCommands: [
    headingSlash('heading-1', 1, '一级标题', ICON_H1, ['h1', '标题1', '大标题', 'title']),
    headingSlash('heading-2', 2, '二级标题', ICON_H2, ['h2', '标题2', '小标题']),
    headingSlash('heading-3', 3, '三级标题', ICON_H3, ['h3', '标题3', 'section']),
    headingSlash('heading-4', 4, '四级标题', ICON_H4, ['h4', '标题4']),
    headingSlash('heading-5', 5, '五级标题', ICON_H5, ['h5', '标题5']),
    headingSlash('heading-6', 6, '六级标题', ICON_H6, ['h6', '标题6']),
  ],
  inputRules: [headingRule(1), headingRule(2), headingRule(3), headingRule(4), headingRule(5), headingRule(6)],
};
