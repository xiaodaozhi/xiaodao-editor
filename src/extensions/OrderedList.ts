/**
 * OrderedList / numbered list item block extension.
 *
 * Numbering rules (consistent across the renderer and document model):
 *
 *   1. If the block has `attrs.startNumber = N` (a positive integer), its
 *      ordinal is exactly N — this is an *explicit override* set via the
 *      number click menu ("Start new list" or "Modify number value").
 *
 *   2. Otherwise, walk backwards in flat document order:
 *        - If the previous sibling is also an ordered list, this block's
 *          ordinal is previousOrdinal + 1 ("continue previous numbering").
 *        - If the previous sibling is NOT an ordered list (or there is no
 *          previous sibling), the ordinal is 1 (implicit start of a list).
 *
 *   3. Explicit `startNumber` also resets continuation for any following
 *      ordered-list items that don't themselves have an explicit override.
 */

import { defineComponent, h, ref, useAttrs, onBeforeUnmount, type PropType } from 'vue';
import type { Extension } from '../core/extension/Extension';
import type { Block, BlockId } from '../core/types';
import BlockContent from '../view/BlockContent.vue';
import { useEditor, useEditable } from '../view/context';
import { ICON_ORDERED_LIST } from '../view/ui/icons';
import { classesFromAttrs, COMMON_ATTRS } from './_commonAttrs';
import { indexOf as blockIndexOf, siblingList } from '../core/state/store';

// --- Schema attribute: explicit start number (optional integer ≥ 1) --------

const START_NUMBER_ATTR = {
  default: null,
  validate: (v: unknown): boolean => {
    if (v === undefined || v === null) return true;
    return Number.isInteger(v) && (v as number) >= 1;
  },
} as const;

// --- Ordinal calculation ----------------------------------------------------

/**
 * Compute the displayed 1-based ordinal for an ordered-list block.
 *
 * Numbering is scoped per **sibling list** (i.e. per
 * same parent). Consecutive `orderedList` siblings in that single list are
 * numbered continuously; any non-orderedList sibling in between breaks the
 * chain; an explicit `attrs.startNumber` acts as a reset anchor.
 *
 * This is strictly narrower than the old flat-indent model: blocks under a
 * DIFFERENT parent (even at the same depthOf) never share a counter —
 * crossing any parent boundary resets numbering by design. This matches the
 * rendering (BlockList nests children) and user intuition.
 */
export function orderedListNumber(doc: Parameters<typeof siblingList>[0], id: BlockId): number {
  const siblings = siblingList(doc, id);
  const i = blockIndexOf(doc, id);
  if (i < 0) return 1;

  const self = doc.blocks.get(id);
  if (!self) return 1;

  // 1) 当前块的显式 startNumber 优先级最高。
  const selfSn = (self.attrs as { startNumber?: unknown }).startNumber;
  if (typeof selfSn === 'number') return selfSn;

  // 2) Walk backwards WITHIN THE SAME SIBLING LIST only.
  //    - orderedList sibling: count (or anchor if startNumber).
  //    - any other sibling: break (list chain ends here → next block is 1).
  let anchorNumber: number | null = null;
  let afterAnchorCount = 0;
  for (let j = i - 1; j >= 0; j--) {
    const prev = doc.blocks.get(siblings[j]!);
    if (!prev) break;
    if (prev.type !== 'orderedList') break;
    const pSn = (prev.attrs as { startNumber?: unknown }).startNumber;
    if (typeof pSn === 'number') {
      anchorNumber = pSn;
      break;
    }
    afterAnchorCount++;
  }

  return anchorNumber !== null
    ? anchorNumber + afterAnchorCount + 1
    : 1 + afterAnchorCount;
}

// --- Renderer: wrapper with clickable marker --------------------------------

const OrderedListBlock = defineComponent({
  name: 'OrderedListBlock',
  props: {
    block: { type: Object as PropType<Block>, required: true },
    placeholder: { type: String, default: undefined },
  },
  setup(props) {
    const editor = useEditor();
    const editable = useEditable();
    const markerEl = ref<HTMLElement | null>(null);
    // BlockHost passes @link-click/@slash-trigger/@input-changed listeners to
    // the renderer component. This wrapper's root is a plain <div>, so Vue's
    // automatic attrs inheritance would drop them onto the <div> as DOM event
    // listeners (never fired) instead of reaching the inner BlockContent.
    // Forward them explicitly to BlockContent.
    const attrs = useAttrs();
    const forwardEvents = {
      ...(typeof attrs.onLinkClick === 'function' ? { onLinkClick: attrs.onLinkClick as () => void } : {}),
      ...(typeof attrs.onSlashTrigger === 'function' ? { onSlashTrigger: attrs.onSlashTrigger as () => void } : {}),
      ...(typeof attrs.onInputChanged === 'function' ? { onInputChanged: attrs.onInputChanged as () => void } : {}),
    };
    // 文档变化时需要重新计算序号。由于结构共享，兄弟块编辑不会改变
    // 当前 block 的引用，Vue 会跳过重渲染。通过订阅 editor 状态变化
    // 递增 docVersion，在 render 函数中读取它以建立响应式依赖，
    // 确保后续有序列表项的序号始终同步更新。
    const docVersion = ref(0);
    const unsubscribe = editor.subscribe(() => {
      docVersion.value++;
    });
    onBeforeUnmount(unsubscribe);
    return () => {
      void docVersion.value;
      const doc = editor.getState().doc;
      const num = orderedListNumber(doc, props.block.id);
      const marker = h(
        'div',
        {
          ref: markerEl,
          class: 'ol-marker',
          'data-ol-number': String(num),
          onMousedown: (e: MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
          },
          onClick: (e: MouseEvent) => {
            e.stopPropagation();
            // Read-only: clicking the number must not open the settings menu.
            if (!editable.value) return;
            const ev = new CustomEvent('ordered-list-marker-click', {
              bubbles: true,
              detail: { blockId: props.block.id, anchor: markerEl.value },
            })
            ;(e.currentTarget as HTMLElement).dispatchEvent(ev);
          },
        },
        [`${num}.`],
      );
      const contentClasses = classesFromAttrs(props.block.attrs);
      const indentClasses = contentClasses.filter((c) => c.startsWith('be-indent-'));
      const nonIndentClasses = contentClasses.filter((c) => !c.startsWith('be-indent-'));
      const content = h(BlockContent, {
        block: props.block,
        placeholder: props.placeholder,
        class: ['block-ordered-list-content', ...nonIndentClasses],
        ...forwardEvents,
      });
      return h(
        'div',
        {
          class: ['block-ordered-list-wrapper', ...indentClasses],
          'data-block-type': 'orderedList',
        },
        [marker, content],
      );
    };
  },
});

export const OrderedListExtension: Extension = {
  name: 'orderedList',
  schema: {
    type: 'orderedList',
    content: 'text',
    nestable: true,
    listLike: true,
    attrs: { ...COMMON_ATTRS, startNumber: START_NUMBER_ATTR },
  },
  renderer: { component: OrderedListBlock },
  slashCommands: [
    {
      id: 'ordered-list',
      title: 'slash.orderedList.title',
      keywords: ['list', 'numbered', 'ordered', '有序列表', '编号列表', 'ol', '1'],
      description: 'slash.orderedList.description',
      icon: ICON_ORDERED_LIST,
      command: 'convertBlock',
      category: 'list',
      args: (): unknown => ({ id: '__currentBlock__', type: 'orderedList' }),
    },
  ],
  inputRules: [
    {
      name: 'ordered-1-dot',
      pattern: /^1\. $/,
      command: 'convertBlock',
      args: (): unknown => ({ id: '__currentBlock__', type: 'orderedList', __stripPrefix: 3 }),
    },
  ],
};
