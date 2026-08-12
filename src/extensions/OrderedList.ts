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

import { defineComponent, h, ref, onBeforeUnmount, type PropType } from 'vue';
import type { Extension } from '../core/extension/Extension';
import type { Block, BlockId } from '../core/types';
import BlockContent from '../view/BlockContent.vue';
import { useEditor, useEditable } from '../view/context';
import { ICON_ORDERED_LIST } from '../view/ui/icons';
import { classesFromAttrs, COMMON_ATTRS } from './_commonAttrs';
import { flatten } from '../core/state/store';

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
 * Respects `attrs.startNumber` as an explicit override; otherwise chains
 * backwards through consecutive `orderedList` siblings and increments by 1
 * from the first non-override (or 1 if there is no ordered-list predecessor).
 */
export function orderedListNumber(doc: Parameters<typeof flatten>[0], id: BlockId): number {
  const flat = flatten(doc);
  const i = flat.indexOf(id);
  if (i < 0) return 1;

  const self = doc.blocks.get(id);
  if (!self) return 1;

  // 1) 当前块的显式 startNumber 优先级最高（「开始新列表」或「修改编号值」写入）。
  const selfSn = (self.attrs as { startNumber?: unknown }).startNumber;
  if (typeof selfSn === 'number') return selfSn;

  // 缩进层级感知：不同缩进层级的有序列表编号互相独立。
  //   - 更深层级（indent > L）的块：视为本层"子块"，跳过，不打断编号链
  //   - 更浅层级（indent < L）的块：视为上下文边界，本层列表在此结束，编号从 1 起
  //   - 同层级（indent == L）：
  //       * 非 orderedList → 打断本层列表链
  //       * 有 startNumber → 以此为锚点，后续列表项继续递增
  //       * 普通 orderedList → 纳入连续计数
  const L = typeof (self.attrs as { indent?: unknown }).indent === 'number'
    ? (self.attrs as { indent: number }).indent
    : 0;

  // 单次遍历，同时找"锚点编号" + 统计锚点到当前之间同层无显式编号的列表项数量。
  let anchorNumber: number | null = null;
  let afterAnchorCount = 0;

  for (let j = i - 1; j >= 0; j--) {
    const prev = doc.blocks.get(flat[j]!);
    if (!prev) break;
    const pIndent = typeof (prev.attrs as { indent?: unknown }).indent === 'number'
      ? (prev.attrs as { indent: number }).indent
      : 0;

    if (pIndent > L) {
      // 更深缩进：是我们层级之下的"子内容"，不影响本层编号，跳过。
      continue;
    }
    if (pIndent < L) {
      // 更浅缩进：本层级的上下文边界，列表链到此终止（= 我们从 1 开始）。
      break;
    }
    // pIndent === L：同层处理
    if (prev.type !== 'orderedList') {
      // 同层非有序块：打断列表链。
      break;
    }
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
    nestable: false,
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
