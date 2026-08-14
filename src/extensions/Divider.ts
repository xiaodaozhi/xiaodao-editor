/**
 * Divider / Horizontal Rule block extension.
 *
 * A simple, non-editable content block that renders a horizontal separator
 * line across the document width. Semantically equivalent to HTML `<hr>` and
 * Markdown `---` / `***` / `___` thematic breaks.
 *
 * Characteristics:
 *   - `content: 'none'` — no inline text region
 *   - `inlineMarks: false` — no marks, no colors (no attrs besides defaults)
 *   - Supports block selection, backspace/delete removal, undo/redo via the
 *     core commands (no special handling needed)
 *   - Serializes to `<hr>` in HTML and `---` in Markdown
 *   - Input rule: `---` / `***` / `___` typed at start of paragraph converts
 */

import { defineComponent, h, type PropType } from 'vue';
import type { Extension } from '../core/extension/Extension';
import type { Block } from '../core/types';
import { ICON_DIVIDER } from '../view/ui/icons';
import { classesFromAttrs, COMMON_ATTRS } from './_commonAttrs';

// ---------------------------------------------------------------------------
// Renderer component
// ---------------------------------------------------------------------------

const DividerBlock = defineComponent({
  name: 'DividerBlock',
  props: {
    block: { type: Object as PropType<Block>, required: true },
    placeholder: { type: String, default: undefined },
  },
  setup(props) {
    void props.placeholder; // reserved for future use
    return () =>
      h('div', {
        class: ['block-divider', 'block-focus-root', ...classesFromAttrs(props.block.attrs)],
        'data-block-divider': true,
      });
  },
});

// ---------------------------------------------------------------------------
// Extension spec
// ---------------------------------------------------------------------------

export const DividerExtension: Extension = {
  name: 'divider',
  schema: {
    type: 'divider',
    // Divider blocks have no text content; they are a structural separator only.
    content: 'none',
    nestable: false,
    // Backspace at the start of a divider does NOT merge it into the previous
    // block's text — instead it deletes the divider itself (same behavior as
    // Notion). This is achieved by NOT setting isolating=true; the core will
    // use the standard merge/delete path which correctly handles non-text
    // blocks as "remove the block, don't merge text".
    inlineMarks: false,
    // a divider can be a CHILD block, so it needs `indent` to reflect
    // its nesting depth and render the be-indent-N class. (nestable=false only
    // means it can't be a parent.)
    attrs: { indent: COMMON_ATTRS.indent },
    // A divider is never "empty" in the placeholder sense — it always shows
    // its line. Return false so Enter handling doesn't try to exit it.
    empty: (): boolean => false,
  },
  renderer: { component: DividerBlock, editable: false },
  slashCommands: [
    {
      id: 'divider',
      title: 'slash.divider.title',
      keywords: ['divider', 'separator', 'hr', 'horizontal', 'line', '分隔符', '分割线', '水平线', '横线'],
      description: 'slash.divider.description',
      icon: ICON_DIVIDER,
      command: 'convertBlock',
      category: 'basic',
      args: (): unknown => ({ id: '__currentBlock__', type: 'divider' }),
    },
  ],
  inputRules: [
    {
      // Three or more hyphens, asterisks, or underscores on their own line,
      // optionally with trailing whitespace. Classic Markdown thematic break.
      name: 'divider-md-thematic-break',
      pattern: /^(?:-{3,}|\*{3,}|_{3,})\s*$/,
      command: 'convertBlock',
      args: (): unknown => ({ id: '__currentBlock__', type: 'divider' }),
    },
  ],
  serialize: {
    toHTML: (): string => '<hr/>',
    toMarkdown: (): string => '---',
  },
  deserialize: {
    fromMarkdown: (line: string) => {
      const trimmed = line.trim();
      if (/^-{3,}$/.test(trimmed) || /^\*{3,}$/.test(trimmed) || /^_{3,}$/.test(trimmed)) {
        return { type: 'divider' as const };
      }
      return null;
    },
  },
};
