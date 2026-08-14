/**
 * Table of Contents (TOC) block extension.
 *
 * A TOC is a special, non-editable block that renders a live, hierarchical
 * list of every heading in the document. It deliberately stores NO heading
 * data itself (`content: 'none'`, empty attrs): the list is a **dynamic view**
 * computed from the current editor state on every render, so it always stays
 * in sync with the document (heading add/remove, text/level/order changes).
 *
 * Design notes:
 *   - `content: 'none'` + `inlineMarks: false` + renderer `editable: false`
 *     make the block non-editable by construction — no caret, no inline text.
 *   - Headings are collected by walking only the TOP-LEVEL blocks (`doc.root`),
 *     filtering `type === 'heading'` — nested / indented headings are ignored.
 *     Table cells store their content in `Block.attrs` (not as blocks), so cell
 *     headings are automatically excluded — no special-casing needed.
 *   - Each entry maps to the heading's stable, unique `BlockId`. Clicking an
 *     entry dispatches the editor's existing `setSelection` command (which the
 *     view layer applies via `applySelectionToDom`) and then scrolls the
 *     heading into view — reusing the existing Selection / DOM positioning
 *     machinery instead of mutating the document structure.
 *   - The renderer subscribes to editor state updates and recomputes the
 *     collection, so the TOC re-renders whenever the document changes.
 *   - Serialization emits nothing (empty string) for both HTML and Markdown:
 *     the generated heading list is a view, not editor content, and the real
 *     headings are already exported elsewhere — so a TOC must never be
 *     duplicated into the export.
 */

import { computed, defineComponent, h, nextTick, onBeforeUnmount, onMounted, ref, type PropType, type VNode } from 'vue';
import type { Extension } from '../core/extension/Extension';
import type { Block, BlockId, DocState } from '../core/types';
import { inlineText } from '../core/types';
import { caretSelection } from '../core/selection/Selection';
import { findBlockEl } from '../view/domSelection';
import { useEditor } from '../view/context';
import { useI18n } from '../i18n';
import { ICON_TOC } from '../view/ui/icons';
import { classesFromAttrs, COMMON_ATTRS } from './_commonAttrs';

// ---------------------------------------------------------------------------
// Heading collection (pure)
// ---------------------------------------------------------------------------

/** A single TOC entry: the heading's stable id, level, and display text. */
export interface TocItem {
  readonly id: BlockId;
  readonly level: number;
  readonly text: string;
}

/**
 * Collect headings from a `DocState`, considering only TOP-LEVEL blocks
 * (`doc.root`). Nested / indented heading blocks are ignored.
 *
 * Only headings that carry text are included (an empty heading is invisible
 * and skipped). Table cells do not live in the block tree (their content is in
 * `Block.attrs`), so any headings inside table cells are naturally excluded.
 */
export function collectHeadings(doc: DocState): readonly TocItem[] {
  const items: TocItem[] = [];
  for (const id of doc.root) {
    const block = doc.blocks.get(id);
    if (!block || block.type !== 'heading') continue;
    const text = inlineText(block.content).trim();
    if (text.length === 0) continue;
    const level = typeof block.attrs.level === 'number' ? block.attrs.level : 1;
    items.push({ id, level: Math.max(1, Math.min(6, Math.floor(level))), text });
  }
  return items;
}

// ---------------------------------------------------------------------------
// Renderer component
// ---------------------------------------------------------------------------

const TocBlock = defineComponent({
  name: 'TableOfContentsBlock',
  props: {
    block: { type: Object as PropType<Block>, required: true },
    placeholder: { type: String, default: undefined },
  },
  setup(props) {
    void props.block; // the block carries no persisted heading data
    void props.placeholder; // placeholder is irrelevant for a non-editable block
    const editor = useEditor();
    const i18n = useI18n();
    const rootEl = ref<HTMLElement | null>(null);
    // Re-render trigger: bumped on every editor state update so the TOC stays
    // a live view of the document's headings.
    const tick = ref(0);

    const headings = computed<readonly TocItem[]>(() => {
      void tick.value;
      return collectHeadings(editor.getState().doc);
    });

    let unsub: (() => void) | null = null;
    onMounted(() => {
      unsub = editor.subscribe(() => {
        tick.value++;
      });
    });
    onBeforeUnmount(() => {
      unsub?.();
    });

    /**
     * Jump to a heading: use the editor's existing `setSelection` command so
     * the view layer focuses the heading via `applySelectionToDom`, then
     * scroll the heading element into view. We never touch the document
     * structure here — only the caret/scrollport.
     */
    function onItemClick(id: BlockId): void {
      editor.commands.setSelection?.({
        selection: caretSelection(id, 0),
      });
      nextTick(() => {
        const root = rootEl.value?.closest?.('.block-editor') as HTMLElement | null;
        const target = root ? findBlockEl(root, id) : null;
        target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      });
    }

    return () => {
      const items = headings.value;
      const children: VNode[] = [h('div', { class: 'toc-title' }, i18n.t('toc.title'))];

      if (items.length === 0) {
        children.push(h('div', { class: 'toc-empty' }, i18n.t('toc.empty')));
      } else {
        for (const item of items) {
          children.push(
            h(
              'button',
              {
                type: 'button',
                class: ['toc-item', `toc-level-${item.level}`],
                style: { paddingLeft: `${(item.level - 1) * 16}px` },
                'data-toc-target': item.id,
                onClick: () => onItemClick(item.id),
              },
              item.text,
            ),
          );
        }
      }

      return h(
        'div',
        {
          ref: rootEl,
          class: ['block-table-of-contents', 'block-focus-root', ...classesFromAttrs(props.block.attrs)],
        },
        children,
      );
    };
  },
});

// ---------------------------------------------------------------------------
// Extension spec
// ---------------------------------------------------------------------------

export const TableOfContentsExtension: Extension = {
  name: 'tableOfContents',
  schema: {
    type: 'tableOfContents',
    // No editable text region — the list is a computed view, not stored content.
    content: 'none',
    nestable: false,
    inlineMarks: false,
    // a TOC can be a CHILD block, so it needs `indent` to reflect its
    // nesting depth and render the be-indent-N class. (nestable=false only
    // means it can't be a parent.)
    attrs: { indent: COMMON_ATTRS.indent },
    // Never "empty" in the placeholder sense — the TOC always renders its
    // panel (title + list or empty state). Return false so Enter handling
    // doesn't try to exit it.
    empty: (): boolean => false,
  },
  renderer: { component: TocBlock, editable: false },
  slashCommands: [
    {
      id: 'tableOfContents',
      title: 'slash.tableOfContents.title',
      keywords: ['toc', 'contents', 'table of contents', 'outline', '目录', '标题', '大纲'],
      description: 'slash.tableOfContents.description',
      icon: ICON_TOC,
      command: 'convertBlock',
      category: 'basic',
      args: (): unknown => ({ id: '__currentBlock__', type: 'tableOfContents' }),
    },
  ],
  serialize: {
    // The generated heading list is a dynamic view, not editor content — the
    // real headings are exported by their own blocks. Emit nothing so a TOC is
    // never duplicated into HTML / Markdown exports.
    toHTML: (): string => '',
    toMarkdown: (): string => '',
  },
};
