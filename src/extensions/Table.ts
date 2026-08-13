/**
 * Table block extension.
 *
 * Implementation notes (see also tableModel.ts):
 *
 *  DATA MODEL
 *  ──────────
 *  Table uses the content:'none' + attrs-storage pattern (same as Image):
 *  all structural state lives in attrs, typed via the TableAttrs interface.
 *  The editor core never touches table internals. It only sees a single
 *  block. Every structural mutation goes through
 *    editor.commands.setAttrs({ id, attrs: nextAttrs })
 *  which wraps it in a standard transaction → undo/redo works for free.
 *
 *  CELL TEXT EDITING
 *  ─────────────────
 *  Each visible cell renders a contenteditable <div>. Input is synced to
 *  attrs on blur (to avoid one transaction per keystroke during IME). Tab
 *  / Shift+Tab navigation, Enter-in-cell newline, and the "last cell →
 *  Tab inserts new row" behavior all live in the renderer keydown handler.
 *
 *  STRUCTURAL COMMANDS
 *  ───────────────────
 *  Commands like `tableInsertRow` receive the target block id + position
 *  and apply the pure helper from tableModel.ts to build the next attrs,
 *  then dispatch via setAttrs. The commands are registered in the
 *  extension so the renderer UI (toolbar buttons, context actions, menu
 *  items) addresses them by name through the typed command proxy.
 *
 *  RENDERING
 *  ─────────
 *  The Vue renderer uses a functional render(). The outer wrapper uses the
 *  standard `.block-table-container` + classesFromAttrs() pattern so
 *  alignment / color / indent plumbing from COMMON_ATTRS just works. A
 *  per-row toolbar overlay exposes insert-row / remove-row buttons, and
 *  per-column headers expose insert-col / remove-col. The floating menu
 *  ("Table actions") is dispatched as a CustomEvent up to BlockEditor
 *  where the existing outside-click dismiss pattern can close it.
 *
 *  ISOLATING BLOCK
 *  ───────────────
 *  Tables are declared `isolating: true` so:
 *    - Backspace at the start of a table does NOT merge with the previous
 *      block (the table-as-a-whole must be removed via the toolbar).
 *    - Enter at end-of-block (not relevant, since content:'none') is a no-op.
 *  `inlineMarks: true` — but cell content uses its own contenteditable so
 *   the core never attempts to apply marks to attrs (the per-cell InlineSeq
 *   stores marks independently through inlineFromDom in the cell blur sync).
 *  Note: marks in cells are deliberately limited in Phase 1 — only plain
 *  text is stored for simplicity, and the cell edit surfaces strip marks
 *  on paste. This matches typical "spreadsheet cell" expectations. A
 *  future phase can reuse inlineDom.inlineFromDom for rich cells.
 */

import {
  defineComponent,
  h,
  ref,
  reactive,
  type PropType,
  onMounted,
  onBeforeUnmount,
  nextTick,
  computed,
  watchEffect,
  type VNode,
} from 'vue';
import type { Extension } from '../core/extension/Extension';
import type { EditorRegistries } from '../core/extension/Registry';
import type { Attrs, Block, BlockId, BlockType, JSONValue, InlineNode } from '../core/types';
import SafeHtml from '../view/ui/SafeHtml.vue';
import HoverToolbar from '../view/ui/HoverToolbar.vue';
import LinkPopover from '../view/ui/LinkPopover.vue';
import OrderedListMenu from '../view/ui/OrderedListMenu.vue';
import NumberPicker from '../view/ui/NumberPicker.vue';
import { inlineToHtml, inlineFromDom } from '../view/inlineDom';
import { autoLinkInlineSeq } from '../view/urlUtils';
import { useEditor, useEditable } from '../view/context';
import { useI18n } from '../i18n';
import type { AnyCommandEntry, CommandEntry, Dispatch } from '../core/command/Command';
import type { EditorState } from '../core/state/EditorState';
import { createTransaction } from '../core/state/Transaction';
import { applySteps } from '../core/state/Step';
import {
  blockAfter,
  blockBefore,
  indexOf,
  parentOf,
} from '../core/state/store';
import { caretSelection } from '../core/selection/Selection';
import {
  attrsToTable,
  buildEmptyCells,
  coerceTableAttrs,
  insertCol,
  insertRow,
  mergeRect,
  recomputeCovered,
  removeCol,
  removeRow,
  setCellContent,
  setCellAttrs,
  setCellsAttrs,
  setCellsMark,
  toggleCellsMark,
  splitCell,
  splitCellsInRect,
  expandSelectionToFullRect,
  rectContainsMergedCells,
  countNonCoveredInRect,
  setColWidth,
  toggleHeaderRow,
  tableToHtml,
  tableToMarkdown,
  validateTableAttrs,
  orderedListCellNumber,
  type TableAttrs,
} from './tableModel';

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------
// Inline SVGs matching the editor icon style (16×16, stroke-based).

const ICON_TABLE = `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="3" width="12" height="10" rx="1"/><path d="M2 7h12M2 10h12M6 3v10M10 3v10"/></svg>`;
const ICON_ROW_ABOVE = `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2L5 5h6z"/><rect x="2.5" y="7" width="11" height="7" rx="1"/></svg>`;
const ICON_ROW_BELOW = `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="2" width="11" height="7" rx="1"/><path d="M8 14l3-3H5z"/></svg>`;
const ICON_COL_LEFT = `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 8l3-3v6z"/><rect x="7" y="2.5" width="7" height="11" rx="1"/></svg>`;
const ICON_COL_RIGHT = `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="2.5" width="7" height="11" rx="1"/><path d="M14 8l-3-3v6z"/></svg>`;
const ICON_DEL_ROW = `<svg viewBox="0 0 1024 1024" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M160 85.333333a32 32 0 0 0-32 32v42.666667A138.666667 138.666667 0 0 0 266.666667 298.666667h490.666666A138.666667 138.666667 0 0 0 896 160v-42.666667a32 32 0 0 0-64 0v42.666667a74.666667 74.666667 0 0 1-74.666667 74.666667H661.333333V117.333333a32 32 0 0 0-64 0V234.666667h-170.666666V117.333333a32 32 0 0 0-64 0V234.666667H266.666667A74.666667 74.666667 0 0 1 192 160v-42.666667A32 32 0 0 0 160 85.333333zM160 938.666667a32 32 0 0 1-32-32v-42.666667A138.666667 138.666667 0 0 1 266.666667 725.333333h490.666666A138.666667 138.666667 0 0 1 896 864v42.666667a32 32 0 0 1-64 0v-42.666667a74.666667 74.666667 0 0 0-74.666667-74.666667H661.333333v117.333334a32 32 0 0 1-64 0V789.333333h-170.666666v117.333334a32 32 0 0 1-64 0V789.333333H266.666667a74.666667 74.666667 0 0 0-74.666667 74.666667v42.666667a32 32 0 0 1-32 32zM512 557.226667l62.72 62.72a32 32 0 1 0 45.226667-45.226667L557.226667 512l62.72-62.72a32 32 0 1 0-45.226667-45.226667L512 466.773333l-62.72-62.72a32 32 0 1 0-45.226667 45.226667L466.773333 512l-62.72 62.72a32 32 0 1 0 45.226667 45.226667L512 557.226667z"/><path d="M372.352 544c0.981333-1.109333 2.005333-2.176 3.072-3.242667L404.181333 512l-28.757333-28.757333a78.72 78.72 0 0 1-3.072-3.242667H117.333333a32 32 0 0 0 0 64h255.018667zM662.314667 544h244.352a32 32 0 0 0 0-64h-244.352a77.909333 77.909333 0 0 1-3.072 3.242667l-28.757334 28.757333 28.757334 28.757333 3.072 3.242667z"/></svg>`;
const ICON_DEL_COL = `<svg viewBox="0 0 1024 1024" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M938.666667 160a32 32 0 0 0-32-32h-42.666667A138.666667 138.666667 0 0 0 725.333333 266.666667v490.666666A138.666667 138.666667 0 0 0 864 896h42.666667a32 32 0 0 0 0-64h-42.666667a74.666667 74.666667 0 0 1-74.666667-74.666667V661.333333h117.333334a32 32 0 0 0 0-64H789.333333v-170.666666h117.333334a32 32 0 0 0 0-64H789.333333V266.666667c0-41.216 33.450667-74.666667 74.666667-74.666667h42.666667a32 32 0 0 0 32-32zM85.333333 160A32 32 0 0 1 117.333333 128h42.666667A138.666667 138.666667 0 0 1 298.666667 266.666667v490.666666A138.666667 138.666667 0 0 1 160 896h-42.666667a32 32 0 0 1 0-64h42.666667a74.666667 74.666667 0 0 0 74.666667-74.666667V661.333333H117.333333a32 32 0 0 1 0-64H234.666667v-170.666666H117.333333a32 32 0 0 1 0-64H234.666667V266.666667A74.666667 74.666667 0 0 0 160 192h-42.666667A32 32 0 0 1 85.333333 160zM466.773333 512l-62.72 62.72a32 32 0 1 0 45.226667 45.226667L512 557.226667l62.72 62.72a32 32 0 1 0 45.226667-45.226667L557.226667 512l62.72-62.72a32 32 0 1 0-45.226667-45.226667L512 466.773333l-62.72-62.72a32 32 0 1 0-45.226667 45.226667L466.773333 512z"/><path d="M480 372.352c1.109333 0.981333 2.176 2.005333 3.242667 3.072l28.757333 28.757333 28.757333-28.757333c1.066667-1.066667 2.133333-2.090667 3.242667-3.072V117.333333a32 32 0 0 0-64 0v255.018667zM480 662.314667v244.352a32 32 0 0 0 64 0v-244.352a77.909333 77.909333 0 0 1-3.242667-3.072L512 630.485333l-28.757333 28.757334-3.242667 3.072z"/></svg>`;
const ICON_MERGE = `<svg viewBox="0 0 1024 1024" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M266.666667 128A138.666667 138.666667 0 0 0 128 266.666667v490.666666A138.666667 138.666667 0 0 0 266.666667 896h490.666666A138.666667 138.666667 0 0 0 896 757.333333V266.666667A138.666667 138.666667 0 0 0 757.333333 128H266.666667zM192 266.666667c0-41.216 33.450667-74.666667 74.666667-74.666667H469.333333v128H192V266.666667z m341.333333 437.333333h298.666667v53.333333a74.666667 74.666667 0 0 1-74.666667 74.666667H533.333333v-128z m298.666667-384h-298.666667v-128h224c41.216 0 74.666667 33.450667 74.666667 74.666667V320z m-362.666667 384v128H266.666667a74.666667 74.666667 0 0 1-74.666667-74.666667V704H469.333333zM192 384h640v256h-640V384z"/></svg>`;
const ICON_SPLIT = `<svg viewBox="0 0 1024 1024" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M533.333333 426.666667H469.333333v170.666666h64v-170.666666z"/><path d="M128 266.666667A138.666667 138.666667 0 0 1 266.666667 128h490.666666A138.666667 138.666667 0 0 1 896 266.666667v490.666666A138.666667 138.666667 0 0 1 757.333333 896H266.666667A138.666667 138.666667 0 0 1 128 757.333333V266.666667zM266.666667 192A74.666667 74.666667 0 0 0 192 266.666667V320H469.333333v-128H266.666667z m565.333333 512h-298.666667v128h224a74.666667 74.666667 0 0 0 74.666667-74.666667V704z m0-437.333333a74.666667 74.666667 0 0 0-74.666667-74.666667H533.333333v128h298.666667V266.666667zM192 704v53.333333c0 41.216 33.450667 74.666667 74.666667 74.666667H469.333333v-128H192z m0-64h640V384h-640v256z"/></svg>`;
const ICON_HEADER = `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3v10M13 3v10M3 8h10"/><rect x="2" y="2" width="12" height="12" rx="1"/></svg>`;
const ICON_DELETE_TABLE = `<svg viewBox="0 0 1024 1024" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M128 266.666667A138.666667 138.666667 0 0 1 266.666667 128h490.666666A138.666667 138.666667 0 0 1 896 266.666667v246.272a276.096 276.096 0 0 0-64-30.250667V426.666667h-170.666667v56.021333a276.096 276.096 0 0 0-64 30.250667V426.666667h-170.666666v170.666666h86.272a276.096 276.096 0 0 0-30.250667 64H426.666667v170.666667h56.021333c7.381333 22.784 17.578667 44.245333 30.250667 64H266.666667A138.666667 138.666667 0 0 1 128 757.333333V266.666667zM266.666667 192A74.666667 74.666667 0 0 0 192 266.666667V362.666667h170.666667v-170.666667H266.666667zM192 426.666667v170.666666h170.666667v-170.666666h-170.666667z m469.333333-64h170.666667V266.666667a74.666667 74.666667 0 0 0-74.666667-74.666667H661.333333v170.666667z m-64-170.666667h-170.666666v170.666667h170.666666v-170.666667z m-405.333333 469.333333v96c0 41.216 33.450667 74.666667 74.666667 74.666667H362.666667v-170.666667h-170.666667z"/><path d="M981.333333 746.666667a234.666667 234.666667 0 1 1-469.333333 0 234.666667 234.666667 0 0 1 469.333333 0z m-234.666666-30.165334l-70.229334-70.272a21.333333 21.333333 0 0 0-30.208 30.208l70.272 70.229334-70.272 70.229333a21.333333 21.333333 0 0 0 30.208 30.208l70.229334-70.272 70.229333 70.272a21.333333 21.333333 0 0 0 30.208-30.208L776.832 746.666667l70.272-70.229334a21.333333 21.333333 0 0 0-30.208-30.208L746.666667 716.501333z"/></svg>`;

// ---------------------------------------------------------------------------
// Schema attrs
// ---------------------------------------------------------------------------
//
// Tables use content:'none' and keep all state in attrs. Like code blocks,
// the table-as-a-whole does not participate in align/color/bgColor/indent
// plumbing — the BlockSettingsMenu reads `schema.attrs` and disables UI
// sections when a key is absent. Cell-level styling lives in cell data
// (not used yet) or is handled directly by the renderer (header rows, etc.).

const TABLE_ATTRS = {
  rows: {
    default: 3,
    validate: (v: unknown): boolean =>
      typeof v === 'number' && Number.isInteger(v) && v >= 1,
  },
  cols: {
    default: 3,
    validate: (v: unknown): boolean =>
      typeof v === 'number' && Number.isInteger(v) && v >= 1,
  },
  cells: {
    default: [] as unknown as [],
    validate: validateTableAttrs,
  },
  colWidths: {
    default: [] as unknown as [],
    validate: (v: unknown): boolean => Array.isArray(v),
  },
  headerRow: {
    default: false,
    validate: (v: unknown): boolean => typeof v === 'boolean',
  },
} as const;

// ---------------------------------------------------------------------------
// Table block renderer
// ---------------------------------------------------------------------------

interface CellPos {
  readonly row: number;
  readonly col: number;
}

// Which logical cells are currently "selected" (rectangular multi-select).
// null means "no multi-cell selection; a single cell has edit focus".
type CellSel = {
  readonly anchor: CellPos;
  readonly focus: CellPos;
} | null;

const TableBlock = defineComponent({
  name: 'TableBlock',
  props: {
    block: { type: Object as PropType<Block>, required: true },
    placeholder: { type: String, default: undefined },
  },
  setup(props) {
    void props.placeholder; // not used for tables
    const editor = useEditor();
    const editable = useEditable();
    const i18n = useI18n();
    const blockId = props.block.id;

    // Live attrs — coerced once per render.
    const tattrs = computed<TableAttrs>(() => attrsToTable(props.block.attrs));

    // DOM refs: keyed by `row-col` for non-covered cells.
    const cellRefs = new Map<string, HTMLDivElement>();
    const tableEl = ref<HTMLTableElement | null>(null);

    // Selection state (multi-cell selection for merge/copy-range).
    const cellSel = ref<CellSel>(null);
    const focusedCell = ref<CellPos | null>(null);

    // Column-resize drag state.
    const resizingCol = ref<number | null>(null);
    let resizeStartX = 0;
    let resizeStartW = 0;

    // --- Table selection state (row / col / cell / all) --------------------
    type TableSelection
      = | { kind: 'none' }
        | { kind: 'row'; row: number }
        | { kind: 'col'; col: number }
        | { kind: 'cell'; rect: { r1: number; c1: number; r2: number; c2: number } }
        | { kind: 'all' };
    const tableSel = ref<TableSelection>({ kind: 'none' });

    // Drag-select across cells.
    const dragSel = ref<{ start: CellPos; current: CellPos } | null>(null);
    let isDragging = false;

    // Floating toolbar position + visibility.
    const selectionDOMRect = ref<DOMRect | null>(null);
    let toolbarHideTimer: ReturnType<typeof setTimeout> | null = null;
    // Delayed toolbar show for single-cell click — allows dblclick to cancel.
    let singleSelectToolbarTimer: ReturnType<typeof setTimeout> | null = null;

    // When true, the cached toolbar state is "frozen" — it won't update even
    // if cellSel changes. Used during selection switching (A→B) to prevent
    // the toolbar at the OLD position from rendering the NEW cell's state
    // before the rect has moved to the new position. Cleared by showToolbar()
    // when the new rect is applied, so the cache unfreezes in the same
    // render cycle and the toolbar shows the correct state at the new position.
    let isSwitchingSelection = false;
    // Records whether the toolbar was visible at mousedown time, so mouseup
    // knows whether to skip the 250ms dblclick-cancel delay (switching) or
    // apply it (first appearance).
    let hadToolbarOnMouseDown = false;

    // Snapshot of the last "valid" toolbar state. When the selection is
    // cleared but the toolbar is still animating away, we use this snapshot
    // instead of recomputing from an empty selection (which would fall back
    // to paragraph/defaults and cause a visual flash before fade-out).
    // Updated whenever a real (non-empty) selection exists.
    interface ToolbarState {
      blockType: string;
      blockAttrs: Record<string, unknown>;
      marks: Set<string>;
      textColor: string;
      bgColor: string;
      verticalAlign: string;
      showDelete: boolean;
      deleteLabel: string;
      deleteIcon: string;
      showMerge: boolean;
      showSplit: boolean;
      showHeaderRow: boolean;
      headerRowActive: boolean;
    }
    const cachedTbState = reactive<ToolbarState>({
      blockType: 'paragraph',
      blockAttrs: { align: 'left' },
      marks: new Set<string>(),
      textColor: '',
      bgColor: '',
      verticalAlign: 'middle',
      showDelete: false,
      deleteLabel: '',
      deleteIcon: ICON_DELETE_TABLE,
      showMerge: false,
      showSplit: false,
      showHeaderRow: false,
      headerRowActive: false,
    });

    // Container ref (outer .block-table-container) — focusable so focusout
    // fires when the user clicks outside the table.
    const containerRef = ref<HTMLDivElement | null>(null);

    // Cell text selection toolbar state (when editing a cell and text is selected).
    const cellTextToolbar = reactive({
      visible: false,
      selectionRect: null as DOMRect | null,
    });

    // Link popover state for cell edit mode.
    const cellLinkPopover = reactive({
      visible: false,
      anchorRect: null as DOMRect | null,
      href: '',
      text: '',
      initialMode: 'edit' as 'view' | 'edit',
      showTextInput: false,
    });
    // Saved selection range from the cell's contenteditable, captured when
    // the link popover opens. The selection is lost when the user focuses
    // the URL input, so we restore it before performing DOM manipulation.
    let savedCellLinkRange: Range | null = null;
    // When the popover is opened by clicking an existing link (view mode),
    // the link element is saved here so that save/remove can find it
    // directly without relying on a text selection range.
    let savedCellLinkEl: HTMLAnchorElement | null = null;
    // Tracks whether the popover was opened by clicking an existing link
    // (view mode) vs. from the HoverToolbar link button (edit mode). When
    // opened from a link click, closing the popover should NOT clear the
    // cell's focus state — the cell remains in whatever state it was in.
    let cellLinkFromViewClick = false;

    // Ordered-list cell marker click menu state (mirrors BlockEditor's olMenu).
    const tableOlMenu = reactive({
      visible: false,
      row: -1,
      col: -1,
      anchor: null as HTMLElement | null,
      canContinue: false,
      canStartNew: false,
      currentNumber: 1,
    });
    function closeTableOlMenu(): void {
      tableOlMenu.visible = false;
      tableOlMenu.anchor = null;
      tableOlMenu.row = -1;
      tableOlMenu.col = -1;
    }
    // Number value picker for "modify start number" in ordered-list cells.
    const tableNumberPicker = reactive({
      visible: false,
      row: -1,
      col: -1,
      anchor: null as HTMLElement | null,
      initialValue: 1,
    });
    function closeTableNumberPicker(): void {
      tableNumberPicker.visible = false;
      tableNumberPicker.anchor = null;
      tableNumberPicker.row = -1;
      tableNumberPicker.col = -1;
    }

    // --- Ordered-list marker click menu handlers ---------------------------
    // The three actions mirror BlockEditor's behavior, but operate on a
    // table cell's `startNumber` attribute rather than a block's. The
    // "previous ordered-list item" means the non-covered cell directly
    // ABOVE in the SAME COLUMN (since tables are laid out in a grid and
    // numbering is per-column).

    /** Open the ordered-list menu for a specific cell. Called when the
     *  user clicks the number marker (in select state OR edit state). */
    function openTableOlMenu(r: number, col: number, anchor: HTMLElement): void {
      // Read-only: clicking the cell number must not open the settings menu.
      if (!editable.value) return;
      const self = tattrs.value.cells[r]?.[col];
      if (!self || self.covered || self.cellType !== 'orderedList') return;
      const num = orderedListCellNumber(tattrs.value, r, col);
      const hasStartNumber = typeof self.startNumber === 'number';
      // "Continue previous" — clear startNumber; only actionable if the
      // cell currently has a startNumber override AND the cell above it
      // (same column, next non-covered going up) is an orderedList cell.
      let prevIsOrdered = false;
      for (let rr = r - 1; rr >= 0; rr--) {
        const p = tattrs.value.cells[rr]?.[col];
        if (!p || p.covered) continue;
        prevIsOrdered = p.cellType === 'orderedList';
        break;
      }
      const canContinue = hasStartNumber && prevIsOrdered;
      // "Start new list" — set startNumber = 1; no-op if ordinal is already 1.
      const canStartNew = num !== 1;
      closeCellLinkPopover();
      cellTextToolbar.visible = false;
      cellTextToolbar.selectionRect = null;
      closeTableNumberPicker();
      tableOlMenu.visible = true;
      tableOlMenu.row = r;
      tableOlMenu.col = col;
      tableOlMenu.anchor = anchor;
      tableOlMenu.canContinue = canContinue;
      tableOlMenu.canStartNew = canStartNew;
      tableOlMenu.currentNumber = num;
    }

    function onTableOlContinue(): void {
      if (tableOlMenu.row < 0 || tableOlMenu.col < 0) return;
      // Clear the explicit startNumber override so the cell auto-continues
      // from the ordered-list cell above it in the same column.
      const next = setCellAttrs(tattrs.value, tableOlMenu.row, tableOlMenu.col, { startNumber: null });
      editor.commands.setAttrs?.({ id: blockId, attrs: next as unknown as Attrs });
      closeTableOlMenu();
    }

    function onTableOlStartNew(): void {
      if (tableOlMenu.row < 0 || tableOlMenu.col < 0) return;
      // Pin startNumber = 1; this also acts as a boundary so cells below
      // in the same column will restart from this cell's numbering.
      const next = setCellAttrs(tattrs.value, tableOlMenu.row, tableOlMenu.col, { startNumber: 1 });
      editor.commands.setAttrs?.({ id: blockId, attrs: next as unknown as Attrs });
      closeTableOlMenu();
    }

    function onTableOlModify(): void {
      if (tableOlMenu.row < 0 || tableOlMenu.col < 0) return;
      const anchorEl = tableOlMenu.anchor;
      const r = tableOlMenu.row;
      const c = tableOlMenu.col;
      const val = tableOlMenu.currentNumber;
      closeTableOlMenu();
      if (!anchorEl) return;
      tableNumberPicker.visible = true;
      tableNumberPicker.initialValue = val;
      tableNumberPicker.anchor = anchorEl;
      tableNumberPicker.row = r;
      tableNumberPicker.col = c;
    }

    function onTableNumberPickerConfirm(value: number): void {
      if (tableNumberPicker.row < 0 || tableNumberPicker.col < 0) {
        closeTableNumberPicker();
        return;
      }
      const next = setCellAttrs(tattrs.value, tableNumberPicker.row, tableNumberPicker.col, { startNumber: value });
      editor.commands.setAttrs?.({ id: blockId, attrs: next as unknown as Attrs });
      closeTableNumberPicker();
    }

    function closeCellLinkPopover(): void {
      if (!cellLinkPopover.visible) return;
      cellLinkPopover.visible = false;
      savedCellLinkRange = null;
      savedCellLinkEl = null;
      cellTextToolbar.visible = false;
      cellTextToolbar.selectionRect = null;
      // When opened from a link click (view mode), don't change the cell's
      // focus state — it should remain in whatever state it was in before
      // the link was clicked.
      if (cellLinkFromViewClick) {
        cellLinkFromViewClick = false;
        return;
      }
      // When opened from the HoverToolbar (edit mode), sync content and
      // clear focus state (which was kept alive while the popover was open).
      const fc = focusedCell.value;
      if (fc) {
        const el = cellRefs.get(`${fc.row}-${fc.col}`);
        if (el) syncCellContent(fc.row, fc.col, el);
        focusedCell.value = null;
      }
    }

    /** Find the <a> ancestor of the current selection, if any. */
    function findLinkInSelection(): HTMLAnchorElement | null {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return null;
      const range = sel.getRangeAt(0);
      const node = range.commonAncestorContainer;
      const el = node.nodeType === 1
        ? (node as HTMLElement)
        : node.parentElement;
      if (!el) return null;
      return el.closest('a');
    }

    /** Open link popover for the cell's current text selection. */
    function openCellLinkPopover(): void {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;

      // Save the selection range so we can restore it later (the selection
      // is lost when the user focuses the URL input in the popover).
      savedCellLinkRange = range.cloneRange();

      const linkEl = findLinkInSelection();
      const existingHref = linkEl?.getAttribute('href') ?? '';
      const selectedText = sel.toString();

      cellLinkPopover.anchorRect = rect;
      cellLinkPopover.href = existingHref;
      cellLinkPopover.text = selectedText;
      cellLinkPopover.initialMode = existingHref ? 'view' : 'edit';
      cellLinkPopover.showTextInput = !selectedText && !existingHref;
      cellLinkPopover.visible = true;
      cellTextToolbar.visible = false;
    }

    /** Open link popover in view mode for an existing link element. */
    function openCellLinkView(linkEl: HTMLAnchorElement): void {
      const href = linkEl.getAttribute('href') || '';
      const text = linkEl.textContent || '';
      const rect = linkEl.getBoundingClientRect();
      cellLinkPopover.anchorRect = rect;
      cellLinkPopover.href = href;
      cellLinkPopover.text = text;
      cellLinkPopover.initialMode = 'view';
      cellLinkPopover.showTextInput = false;
      cellLinkPopover.visible = true;
      cellLinkFromViewClick = true;
      savedCellLinkEl = linkEl;
      cellTextToolbar.visible = false;
      cellTextToolbar.selectionRect = null;
    }

    /** Sync cell content from a DOM element inside a cell (link or inner div). */
    function syncCellFromElement(el: HTMLElement): void {
      const inner = el.closest('.table-cell-inner') as HTMLDivElement | null;
      if (!inner) return;
      const td = inner.closest('.table-cell') as HTMLElement | null;
      if (!td) return;
      const r = Number(td.getAttribute('data-row'));
      const c = Number(td.getAttribute('data-col'));
      if (!Number.isFinite(r) || !Number.isFinite(c)) return;
      syncCellContent(r, c, inner);
    }

    /** Save link via DOM manipulation on the cell's contenteditable. */
    function onCellLinkSave(url: string, text: string | undefined): void {
      // When opened from a link click (view mode), use the saved link element
      // directly — there may be no text selection to work with.
      if (savedCellLinkEl && savedCellLinkEl.isConnected) {
        savedCellLinkEl.setAttribute('href', url);
        savedCellLinkEl.setAttribute('target', '_blank');
        savedCellLinkEl.setAttribute('rel', 'noopener noreferrer');
        if (text !== undefined && text !== savedCellLinkEl.textContent) {
          savedCellLinkEl.textContent = text;
        }
        syncCellFromElement(savedCellLinkEl);
        return;
      }

      const sel = window.getSelection();
      if (!sel) return;

      // Restore the saved selection range (lost when user focused the URL
      // input in the popover). Fall back to current selection if no saved range.
      if (savedCellLinkRange) {
        const fc = focusedCell.value;
        const cellEl = fc ? cellRefs.get(`${fc.row}-${fc.col}`) : null;
        if (cellEl && cellEl.isConnected) {
          sel.removeAllRanges();
          sel.addRange(savedCellLinkRange);
        }
      }

      const linkEl = findLinkInSelection();
      if (linkEl) {
        // Update existing link href.
        linkEl.setAttribute('href', url);
        linkEl.setAttribute('target', '_blank');
        linkEl.setAttribute('rel', 'noopener noreferrer');
        if (text !== undefined && text !== linkEl.textContent) {
          linkEl.textContent = text;
        }
      } else {
        // Create new link wrapping the selected text.
        if (sel.rangeCount === 0) return;
        const range = sel.getRangeAt(0);
        const a = document.createElement('a');
        a.setAttribute('href', url);
        a.setAttribute('target', '_blank');
        a.setAttribute('rel', 'noopener noreferrer');
        try {
          a.appendChild(range.extractContents());
          range.insertNode(a);
          sel.removeAllRanges();
          const newRange = document.createRange();
          newRange.selectNodeContents(a);
          sel.addRange(newRange);
          savedCellLinkRange = newRange.cloneRange();
        } catch { /* ignore */ }
      }
      // Sync DOM content back to cell data.
      syncFocusedCellContent();
    }

    /** Remove link from the cell's contenteditable (unwrap <a> to text). */
    function onCellLinkRemove(): void {
      // When opened from a link click (view mode), use the saved link element
      // directly — there may be no text selection to work with.
      if (savedCellLinkEl && savedCellLinkEl.isConnected) {
        const linkEl = savedCellLinkEl;
        const parent = linkEl.parentElement;
        if (parent) {
          while (linkEl.firstChild) {
            parent.insertBefore(linkEl.firstChild, linkEl);
          }
          parent.removeChild(linkEl);
        }
        syncCellFromElement(linkEl);
        return;
      }

      const sel = window.getSelection();
      if (!sel) return;

      // Restore the saved selection range.
      if (savedCellLinkRange) {
        const fc = focusedCell.value;
        const cellEl = fc ? cellRefs.get(`${fc.row}-${fc.col}`) : null;
        if (cellEl && cellEl.isConnected) {
          sel.removeAllRanges();
          sel.addRange(savedCellLinkRange);
        }
      }

      const linkEl = findLinkInSelection();
      if (!linkEl) return;
      const parent = linkEl.parentElement;
      if (!parent) return;
      // Unwrap: replace <a> with its text content.
      while (linkEl.firstChild) {
        parent.insertBefore(linkEl.firstChild, linkEl);
      }
      parent.removeChild(linkEl);
      // Try to restore selection.
      try {
        sel.removeAllRanges();
        if (savedCellLinkRange && savedCellLinkRange.startContainer !== linkEl) {
          sel.addRange(savedCellLinkRange);
        }
      } catch { /* ignore */ }
      syncFocusedCellContent();
    }

    /** Sync the currently focused cell's DOM content back to table attrs. */
    function syncFocusedCellContent(): void {
      const fc = focusedCell.value;
      if (!fc) return;
      const el = cellRefs.get(`${fc.row}-${fc.col}`);
      if (el) syncCellContent(fc.row, fc.col, el);
    }

    // Track whether the mouse button is currently held down inside a cell
    // that is in edit mode. While dragging to select text, the toolbar must
    // NOT appear — matching the text-block HoverToolbar behavior which waits
    // until mouseup before showing.
    let isCellMouseDown = false;

    function onCellSelectionChange(): void {
      // Read-only: cells are never editable, so a cell text toolbar must
      // never appear even if a native selection somehow exists.
      if (!editable.value) {
        cellTextToolbar.visible = false;
        cellTextToolbar.selectionRect = null;
        return;
      }
      const fc = focusedCell.value;
      if (!fc) {
        cellTextToolbar.visible = false;
        cellTextToolbar.selectionRect = null;
        return;
      }
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
        cellTextToolbar.visible = false;
        cellTextToolbar.selectionRect = null;
        return;
      }
      const range = sel.getRangeAt(0);
      // Check if selection is within a table-cell-inner element.
      const cellInner = (range.commonAncestorContainer.nodeType === 1
        ? (range.commonAncestorContainer as HTMLElement)
        : range.commonAncestorContainer.parentElement
      )?.closest('.table-cell-inner');
      if (!cellInner) {
        cellTextToolbar.visible = false;
        cellTextToolbar.selectionRect = null;
        return;
      }
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        cellTextToolbar.visible = false;
        cellTextToolbar.selectionRect = null;
        return;
      }
      // Don't show toolbar while mouse button is held down (dragging to
      // select text). The toolbar will appear after mouseup via
      // onCellMouseUp, which re-checks the selection — matching the
      // text-block HoverToolbar behavior.
      if (isCellMouseDown) return;
      cellTextToolbar.visible = true;
      cellTextToolbar.selectionRect = rect;
      // Hide the cell selection toolbar (tableMode) to avoid both showing.
      if (toolbarHideTimer) {
        clearTimeout(toolbarHideTimer);
        toolbarHideTimer = null;
      }
      selectionDOMRect.value = null;
    }

    function onCellMouseUp(): void {
      if (!isCellMouseDown) return;
      isCellMouseDown = false;
      // Re-check selection now that the mouse is released, matching the
      // text-block pattern (onMouseUp → onDocumentSelectionChange).
      onCellSelectionChange();
    }

    // Convert a content-relative rect (from measureState, which stores
    // colLefts / rowTops relative to the wrapper's content origin) to a
    // viewport-relative rect for position:fixed placement. Must subtract
    // scrollLeft because content-origin coordinates don't account for how
    // far the wrapper has been scrolled horizontally.
    function toViewportRect(rect: DOMRect): DOMRect {
      const wrap = wrapperRef.value;
      if (!wrap) return rect;
      const wr = wrap.getBoundingClientRect();
      return new DOMRect(
        wr.left + rect.left - wrap.scrollLeft,
        wr.top + rect.top,
        rect.width,
        rect.height,
      );
    }

    function showToolbar(rect: DOMRect): void {
      // Read-only: never show the floating cell-selection toolbar.
      if (!editable.value) return;
      if (toolbarHideTimer) {
        clearTimeout(toolbarHideTimer);
        toolbarHideTimer = null;
      }
      if (singleSelectToolbarTimer) {
        clearTimeout(singleSelectToolbarTimer);
        singleSelectToolbarTimer = null;
      }
      // Hide the cell text toolbar (cellEditMode) to avoid both showing.
      cellTextToolbar.visible = false;
      cellTextToolbar.selectionRect = null;
      // Unfreeze the cached state — the new rect is being applied, so the
      // cache should update to match the new selection in the same render.
      isSwitchingSelection = false;
      // rect is wrapper-relative (from measureState); convert to
      // viewport-relative for HoverToolbar's position:fixed placement.
      selectionDOMRect.value = toViewportRect(rect);
    }
    function hideToolbar(delay = 150): void {
      if (singleSelectToolbarTimer) {
        clearTimeout(singleSelectToolbarTimer);
        singleSelectToolbarTimer = null;
      }
      // Unfreeze — hideToolbar is called when selection is cancelled, so
      // there's no switch in progress anymore.
      isSwitchingSelection = false;
      toolbarHideTimer = setTimeout(() => {
        selectionDOMRect.value = null;
        toolbarHideTimer = null;
      }, delay);
    }

    // Focus the container so that focusout fires when the user clicks outside.
    function focusContainer(): void {
      const c = containerRef.value;
      if (c) c.focus();
    }

    function onSelectBlock(e: MouseEvent): void {
      const target = e.target as HTMLElement;
      // Prevent default link navigation when clicking a link inside a
      // table cell. The link view popover is opened in onContainerMouseDown;
      // here we just suppress the browser's default <a> navigation.
      if (target.closest('a') && target.closest('.table-cell-inner')) {
        e.preventDefault();
        return;
      }
      // Click inside the table (cell, row, table itself) should not
      // trigger block-level selection / clear cell selection.
      if (target.closest('.table-cell, .table-wrapper, table, .table-row-strip, .table-col-strip, .table-insert-dot, .table-corner-handle')) return;
      e.stopPropagation();
      tableSel.value = { kind: 'none' };
      cellSel.value = null;
      hideToolbar(0);
      editor.commands.selectBlock?.({ blockId });
    }

    // --- Cell content syncing --------------------------------------------

    // Deep-equal two InlineSeq values, comparing each TextRun's type, text,
    // and its marks (type + attrs). Returns true only when both sequences
    // contain identical nodes.
    function inlineSeqEqual(a: readonly { type: string; text?: string; marks?: readonly unknown[] }[], b: readonly { type: string; text?: string; marks?: readonly unknown[] }[]): boolean {
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) {
        const ai = a[i]!;
        const bi = b[i]!;
        if (ai.type !== bi.type) return false;
        if ('text' in ai && ai.text !== (bi as typeof ai).text) return false;
        const aMarks = ai.marks ?? [];
        const bMarks = bi.marks ?? [];
        if (aMarks.length !== bMarks.length) return false;
        for (let j = 0; j < aMarks.length; j++) {
          const am = aMarks[j] as { type: string; attrs?: Record<string, unknown> };
          const bm = bMarks[j] as { type: string; attrs?: Record<string, unknown> };
          if (am.type !== bm.type) return false;
          const aAttrs = am.attrs ?? {};
          const bAttrs = bm.attrs ?? {};
          const aKeys = Object.keys(aAttrs);
          const bKeys = Object.keys(bAttrs);
          if (aKeys.length !== bKeys.length) return false;
          for (const k of aKeys) if (aAttrs[k] !== bAttrs[k]) return false;
        }
      }
      return true;
    }

    // Sync cell content from the contenteditable DOM to the data model.
    // Extracted so it can be called from both onCellBlur and onCellKeyDown
    // (in case onBlur doesn't fire due to Vue's innerHTML/children patching).
    function syncCellContent(r: number, c: number, el: HTMLDivElement): void {
      const rawContent = inlineFromDom(el);
      // Auto-link any URL-like substrings, matching the behavior of
      // pasting URLs into text blocks.
      const newContent = autoLinkInlineSeq(rawContent);
      const current = tattrs.value;
      const existing = current.cells[r]?.[c];
      if (existing && inlineSeqEqual(existing.content, newContent)) return;
      const next = setCellContent(current, r, c, newContent);
      editor.commands.setAttrs?.({ id: blockId, attrs: next as unknown as Attrs });
      // If auto-linking changed the content, update the DOM so the link
      // marks are visually reflected while the cell is still being edited.
      if (newContent !== rawContent) {
        const linkedHtml = inlineToHtml(newContent);
        if (el.innerHTML !== linkedHtml) {
          el.innerHTML = linkedHtml;
        }
      }
    }

    function onCellBlur(r: number, c: number, el: HTMLDivElement, e?: FocusEvent): void {
      // If focus is moving to the link popover (teleported to body),
      // keep cell state alive so link save/remove can still sync content.
      const relatedTarget = e?.relatedTarget as HTMLElement | null;
      if (relatedTarget?.closest('.link-popover')) {
        return;
      }
      // Clear focus state so the blue outline follows the actual focused cell.
      if (focusedCell.value?.row === r && focusedCell.value?.col === c) {
        focusedCell.value = null;
      }
      // Hide cell text toolbar on blur.
      cellTextToolbar.visible = false;
      cellTextToolbar.selectionRect = null;
      closeCellLinkPopover();
      syncCellContent(r, c, el);
    }

    // When focus leaves the entire table container, clear all selections.
    function onContainerFocusOut(e: FocusEvent): void {
      const container = e.currentTarget as HTMLElement;
      // relatedTarget is the element receiving focus. If it's still inside
      // the container, focus hasn't left the table.
      const next = e.relatedTarget as HTMLElement | null;
      if (next && container.contains(next)) return;
      // Don't clear state if focus moved to the link popover.
      if (next?.closest('.link-popover')) return;
      // Focus has left the table — clear all selection / focus state.
      if (cellSel.value) cellSel.value = null;
      if (tableSel.value.kind !== 'none') {
        tableSel.value = { kind: 'none' };
        hideToolbar(0);
      }
      if (focusedCell.value) focusedCell.value = null;
      closeCellLinkPopover();
      closeTableOlMenu();
      closeTableNumberPicker();
    }

    // --- Tab / Shift+Tab navigation + "last cell → new row" --------------

    function onCellKeyDown(r: number, c: number, el: HTMLDivElement, ev: KeyboardEvent): void {
      // Enter in cell → exit editing, then enter select mode for this cell.
      // Exception: code block cells allow Enter to insert a newline (\n),
      // matching the text-block codeBlock behavior. This takes priority
      // over the default "exit edit mode" behavior.
      if (ev.key === 'Enter' && !ev.shiftKey && !ev.ctrlKey && !ev.metaKey) {
        const cellData = tattrs.value.cells[r]?.[c];
        if (cellData?.cellType === 'codeBlock') {
          // Insert a literal "\n" at the caret position. Strategy mirrors
          // the text-block code-block Enter handler (insertCodeBlockNewline
          // in BlockEditor.vue):
          //   1. Determine the caret's character offset within the cell.
          //   2. Manipulate the live DOM selection's range to insert a
          //      TextNode("\n") and move the caret after it.
          //   3. Sync to data model via inlineFromDom + setCellContent.
          //   4. After Vue re-renders (innerHTML is updated from
          //      inlineToHtml(cell.content), which appends a trailing <br>
          //      for code-block cells ending with "\n"), re-place the
          //      caret at offset+1 in nextTick.
          //
          // Why nextTick: syncCellContent dispatches setAttrs → Vue
          // re-renders the cell, resetting innerHTML and clearing the
          // selection. Any synchronous caret placement would be clobbered
          // by the async DOM patch. nextTick runs after the patch, so the
          // caret is placed on the final DOM.
          //
          // Why we don't manually append <br> here: the cell render logic
          // already appends <br> to cellHtml when a code-block cell's
          // content ends with "\n" (see the render section). So after Vue
          // re-renders, the DOM is correct.
          //
          // code-block cells have NO inline marks (sanitizeCellContent
          // strips them), so inlineFromDom always returns a single plain
          // text run — character offsets are unambiguous.
          ev.preventDefault();
          ev.stopPropagation();

          // --- Step 1: get caret offset within the cell ---
          const sel = window.getSelection();
          let caretOffset = el.textContent?.length ?? 0;
          if (sel && sel.rangeCount > 0) {
            const range = sel.getRangeAt(0);
            if (el.contains(range.startContainer)) {
              const pre = document.createRange();
              pre.selectNodeContents(el);
              try {
                pre.setEnd(range.startContainer, range.startOffset);
                caretOffset = pre.toString().length;
              } catch {
                caretOffset = el.textContent?.length ?? 0;
              }
            }
          }

          // --- Step 2: manipulate the DOM selection directly ---
          // Insert "\n" at the caret and move the caret after it.
          if (sel && sel.rangeCount > 0) {
            const range = sel.getRangeAt(0);
            if (el.contains(range.commonAncestorContainer)) {
              if (!range.collapsed) range.deleteContents();
              const newlineNode = document.createTextNode('\n');
              range.insertNode(newlineNode);
              range.setStartAfter(newlineNode);
              range.collapse(true);
              sel.removeAllRanges();
              sel.addRange(range);
            }
          }

          // --- Step 3: sync back to table attrs ---
          // syncCellContent reads the DOM via inlineFromDom (which skips
          // <br>), so the stored InlineSeq contains only the "\n" text.
          // Vue then re-renders with cellHtml = inlineToHtml(content),
          // and the render logic appends a trailing <br> for code-block
          // cells ending with "\n". This ensures the trailing newline is
          // visually rendered under white-space: pre-wrap.
          syncCellContent(r, c, el);

          // --- Step 4: re-place caret at (old offset + 1) after Vue patch ---
          // Vue's async DOM patch (triggered by syncCellContent's setAttrs)
          // resets innerHTML and clears the selection. We must re-place the
          // caret AFTER the patch completes. nextTick runs after Vue's
          // microtask queue is flushed, so the DOM is final at this point.
          const targetOffset = caretOffset + 1;
          nextTick(() => {
            const cellEl = cellRefs.get(`${r}-${c}`);
            if (!cellEl) return;
            cellEl.focus();
            const newSel = window.getSelection();
            if (!newSel) return;
            const newRange = document.createRange();
            let charCount = 0;
            let placed = false;
            const walk = (node: Node): void => {
              if (placed) return;
              if (node.nodeType === Node.TEXT_NODE) {
                const len = node.textContent?.length ?? 0;
                if (charCount + len >= targetOffset) {
                  newRange.setStart(node, Math.max(0, targetOffset - charCount));
                  newRange.collapse(true);
                  placed = true;
                }
                charCount += len;
              } else {
                for (const child of node.childNodes) walk(child);
              }
            };
            walk(cellEl);
            if (!placed) {
              newRange.selectNodeContents(cellEl);
              newRange.collapse(false);
            }
            newSel.removeAllRanges();
            newSel.addRange(newRange);
          });
          return;
        }
        ev.preventDefault();
        ev.stopPropagation();
        // Sync content and clear edit state directly, in case the onBlur
        // prop doesn't fire (Vue's event handler can be unreliable when
        // the element transitions between innerHTML and children patching).
        syncCellContent(r, c, el);
        focusedCell.value = null;
        cellTextToolbar.visible = false;
        cellTextToolbar.selectionRect = null;
        closeCellLinkPopover();
        el.blur();
        // Enter select mode (blue background) for this single cell and
        // show the floating toolbar, matching the single-click behavior.
        tableSel.value = { kind: 'cell', rect: { r1: r, c1: c, r2: r, c2: c } };
        cellSel.value = { anchor: { row: r, col: c }, focus: { row: r, col: c } };
        focusContainer();
        nextTick(() => {
          const rect = computeSelectionRectDOM(r, c, r, c);
          if (rect) showToolbar(rect);
        });
        return;
      }
      if (ev.key === 'Tab') {
        ev.preventDefault();
        ev.stopPropagation();
        closeCellLinkPopover();
        const next = nextCellPos(tattrs.value, r, c, ev.shiftKey);
        if (!next) {
          // At the very last cell, Tab should add a new row and move there.
          const isLast = isLastCell(tattrs.value, r, c);
          if (isLast && !ev.shiftKey) {
            // Sync current cell first using inlineFromDom to preserve rich marks.
            const newContent = inlineFromDom(el);
            const current = tattrs.value;
            const afterSync = setCellContent(current, r, c, newContent);
            const afterInsert = insertRow(afterSync, afterSync.rows);
            editor.commands.setAttrs?.({ id: blockId, attrs: afterInsert as unknown as Attrs });
            nextTick(() => {
              const cellKey = `${afterInsert.rows - 1}-0`;
              const dom = cellRefs.get(cellKey);
              dom?.focus();
              placeCaretAtEnd(dom);
            });
            return;
          }
          return;
        }
        const { r: nr, c: nc } = next;
        // Sync cell content using inlineFromDom to preserve rich marks.
        // Compare as InlineSeq (reference equality: shallow diff per node)
        // so we skip the transaction when neither text nor marks changed.
        const newContent = inlineFromDom(el);
        const current = tattrs.value;
        const existing = current.cells[r]?.[c];
        let afterSync = current;
        if (existing) {
          // Quick shallow equal to avoid no-op transactions.
          const sameInline = inlineSeqEqual(existing.content, newContent);
          if (!sameInline) {
            afterSync = setCellContent(current, r, c, newContent);
          }
        }
        if (afterSync !== current) {
          editor.commands.setAttrs?.({ id: blockId, attrs: afterSync as unknown as Attrs });
        }
        nextTick(() => {
          const cellKey = `${nr}-${nc}`;
          const dom = cellRefs.get(cellKey);
          dom?.focus();
          if (!ev.shiftKey) placeCaretAtEnd(dom);
          else placeCaretAtStart(dom);
        });
        return;
      }
      // Backspace at the very start of a non-paragraph cell: convert the
      // cell back to a paragraph, mirroring the text-block behavior
      // (backspaceCommand) where list items and empty headings convert
      // back to a paragraph.
      //   • Empty non-paragraph cell (list / heading / quote / code) →
      //     paragraph.
      //   • Non-empty list cell at offset 0 → paragraph (un-list, keeping
      //     the text), matching backspaceCommand's listLike branch.
      if (ev.key === 'Backspace') {
        const cellData = tattrs.value.cells[r]?.[c];
        const ct = cellData?.cellType;
        if (ct && ct !== 'paragraph') {
          // Resolve the caret's character offset within the cell.
          const sel = window.getSelection();
          let caretOffset = el.textContent?.length ?? 0;
          if (sel && sel.rangeCount > 0) {
            const range = sel.getRangeAt(0);
            if (el.contains(range.startContainer)) {
              const pre = document.createRange();
              pre.selectNodeContents(el);
              try {
                pre.setEnd(range.startContainer, range.startOffset);
                caretOffset = pre.toString().length;
              } catch {
                caretOffset = el.textContent?.length ?? 0;
              }
            }
          }
          if (caretOffset === 0) {
            const domEmpty = !el.textContent || el.textContent.trim() === '';
            const isList = ct === 'bulletList' || ct === 'orderedList' || ct === 'todoList';
            if (domEmpty || isList) {
              ev.preventDefault();
              ev.stopPropagation();
              closeCellLinkPopover();
              closeTableOlMenu();
              closeTableNumberPicker();
              // Read the live DOM content (the model may lag behind while
              // editing) so the conversion keeps what the user sees.
              const domContent = inlineFromDom(el);
              const current = tattrs.value;
              const withContent = setCellContent(current, r, c, domContent);
              const next = setCellAttrs(withContent, r, c, { cellType: 'paragraph' });
              editor.commands.setAttrs?.({ id: blockId, attrs: next as unknown as Attrs });
              // Stay in edit mode; re-place the caret at the start after
              // Vue re-renders the cell as a paragraph.
              nextTick(() => {
                const cellEl = cellRefs.get(`${r}-${c}`);
                if (cellEl) {
                  cellEl.focus();
                  placeCaretAtStart(cellEl);
                }
              });
              return;
            }
          }
        }
      }
      // ESC: exit editing (blur) — the cell returns to default state.
      if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        syncCellContent(r, c, el);
        focusedCell.value = null;
        cellTextToolbar.visible = false;
        cellTextToolbar.selectionRect = null;
        closeCellLinkPopover();
        el.blur();
      }
    }

    // --- Cell focus tracking ---------------------------------------------
    // Focus = blue outline, caret blinking, editable.
    // Select = blue background, not editable, for whole-cell operations.
    // These two states are mutually exclusive.

    function onCellFocus(r: number, c: number, _el: HTMLDivElement): void {
      focusedCell.value = { row: r, col: c };
      // Focus means editing mode — clear any selection state.
      if (cellSel.value) cellSel.value = null;
      if (tableSel.value.kind !== 'none') {
        tableSel.value = { kind: 'none' };
        hideToolbar(0);
      }
    }

    // --- Cell selection / focus (event delegation on container) ---------
    // Vue 3 h() sometimes fails to bind onMouseDown on <td>/<th>.
    // We use event delegation: all cell mouse events are handled on the
    // container div, and we find the target cell via e.target.closest('.table-cell').

    function findCellFromEvent(e: MouseEvent): { r: number; c: number; el: HTMLElement } | null {
      const target = e.target as HTMLElement;
      if (!target) return null;
      const cell = target.closest('.table-cell') as HTMLElement | null;
      if (!cell) return null;
      const r = Number(cell.getAttribute('data-row') ?? cell.dataset.row);
      const c = Number(cell.getAttribute('data-col') ?? cell.dataset.col);
      if (!Number.isFinite(r) || !Number.isFinite(c)) return null;
      return { r, c, el: cell };
    }

    // Event-delegated keydown handler on the container. This replaces
    // per-cell onKeyDown props which could fail to fire when Vue patches
    // the element between innerHTML (non-editing) and children (editing)
    // modes. The container's onKeyDown prop is stable and always fires.
    function onContainerKeyDown(ev: KeyboardEvent): void {
      // Read-only: cells are non-editable and no table keyboard interaction
      // (cell navigation, Backspace-to-paragraph, etc.) may run.
      if (!editable.value) return;
      const target = ev.target as HTMLElement | null;
      if (!target) return;
      const inner = target.closest('.table-cell-inner') as HTMLDivElement | null;
      if (!inner) return;
      const td = inner.closest('.table-cell') as HTMLElement | null;
      if (!td) return;
      const r = Number(td.getAttribute('data-row'));
      const c = Number(td.getAttribute('data-col'));
      if (!Number.isFinite(r) || !Number.isFinite(c)) return;
      onCellKeyDown(r, c, inner, ev);
    }

    function onContainerMouseDown(e: MouseEvent): void {
      // Check if click is on a cell strip / dot / corner handle first.
      const target = e.target as HTMLElement;
      if (target.closest('.table-row-strip, .table-col-strip, .table-insert-dot, .table-corner-handle, .table-col-resizer')) {
        return;
      }
      // Check if click is on a todo-list checkbox inside a table cell — let
      // the checkbox handle the click natively so it can toggle in non-edit
      // mode. The checkbox's onClick handler stops propagation.
      if (target.tagName === 'INPUT' && target.classList.contains('table-cell-todo-checkbox')) {
        return;
      }
      // Check if click is on an ordered-list cell number marker — let the
      // marker's own click handler manage the menu popup (works in both
      // select state and edit state). The marker's click handler stops
      // propagation so this mousedown guard just lets it through.
      if (target.classList.contains('table-cell-ol-marker')) {
        return;
      }
      // Check if click is on a link inside a table cell — open the link
      // view popover instead of selecting/editing the cell. This applies
      // to both edit mode and non-edit mode, matching the text-block
      // behavior where clicking a link always shows the view popover.
      const linkEl = target.closest('a');
      if (linkEl && linkEl.closest('.table-cell-inner')) {
        e.preventDefault();
        e.stopPropagation();
        openCellLinkView(linkEl);
        return;
      }
      // Non-link click inside the table — close any open link popover.
      if (cellLinkPopover.visible) {
        closeCellLinkPopover();
      }
      const hit = findCellFromEvent(e);
      if (!hit) return;
      if (e.button !== 0) return;

      // If the clicked cell is currently in edit mode, let the contenteditable
      // handle the mousedown normally (text selection, cursor placement).
      const fc = focusedCell.value;
      if (fc && fc.row === hit.r && fc.col === hit.c) {
        // Track mouse-down so the cell text toolbar waits until mouseup,
        // matching the text-block HoverToolbar behavior.
        isCellMouseDown = true;
        document.addEventListener('mouseup', onCellMouseUp, { once: true, capture: true });
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      const { r, c } = hit;
      // Blur any currently focused cell.
      const focused = document.activeElement as HTMLElement | null;
      if (focused && focused.closest('.table-cell-inner')) focused.blur();
      focusedCell.value = null;
      // Selecting a cell means the table is now the active block — clear
      // any caret / text selection in other blocks so they lose focus.
      editor.commands.selectBlock?.({ blockId });
      // Focus the container so focusout fires when clicking outside the table.
      focusContainer();

      // Start a new selection at this cell.
      // If the toolbar was already visible (switching selection A→B),
      // freeze the cached state so the toolbar at the OLD position keeps
      // showing the OLD state until the rect moves to B. The rect stays
      // non-null (visible=true, no fade animation) and jumps directly to
      // the new position when showToolbar() is called on mouseup.
      // If the toolbar was NOT visible (first selection), the rect stays
      // null and the normal fade-in animation applies on mouseup.
      hadToolbarOnMouseDown = selectionDOMRect.value !== null;
      if (hadToolbarOnMouseDown) {
        isSwitchingSelection = true;
        // Clear any pending hide/show timers so they don't interfere.
        if (toolbarHideTimer) {
          clearTimeout(toolbarHideTimer);
          toolbarHideTimer = null;
        }
        if (singleSelectToolbarTimer) {
          clearTimeout(singleSelectToolbarTimer);
          singleSelectToolbarTimer = null;
        }
      }
      tableSel.value = { kind: 'none' };
      isDragging = true;
      const start = { row: r, col: c };
      dragSel.value = { start, current: start };
      cellSel.value = { anchor: start, focus: start };

      document.addEventListener('mouseup', onDocMouseUp, true);
    }

    function onContainerMouseOver(e: MouseEvent): void {
      if (!isDragging || !dragSel.value) return;
      const hit = findCellFromEvent(e);
      if (!hit) return;
      const { r, c } = hit;
      const prev = dragSel.value.current;
      if (r === prev.row && c === prev.col) return;
      dragSel.value = { ...dragSel.value, current: { row: r, col: c } };
      const anchor = dragSel.value.start;
      cellSel.value = { anchor, focus: { row: r, col: c } };
    }

    function onContainerDblClick(e: MouseEvent): void {
      // Read-only: double-click must not enter cell edit mode.
      if (!editable.value) return;
      // Don't enter edit mode when double-clicking the todo-list checkbox.
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' && target.classList.contains('table-cell-todo-checkbox')) {
        return;
      }
      // Don't enter edit mode when double-clicking the ordered-list number
      // marker — single-click already opens the menu.
      if (target.classList.contains('table-cell-ol-marker')) {
        return;
      }
      const hit = findCellFromEvent(e);
      if (!hit) return;
      const { r, c } = hit;

      // If the cell is already in edit mode, let the browser handle the
      // double-click (e.g., double-click to select a word).
      const fc = focusedCell.value;
      if (fc && fc.row === r && fc.col === c) {
        return;
      }

      e.preventDefault();
      e.stopPropagation();
      // Cancel pending single-click toolbar to prevent flash on double-click.
      if (singleSelectToolbarTimer) {
        clearTimeout(singleSelectToolbarTimer);
        singleSelectToolbarTimer = null;
      }
      // Unfreeze any pending selection-switch state — dblclick cancels
      // the switch and enters edit mode instead.
      isSwitchingSelection = false;
      isDragging = false;
      dragSel.value = null;
      cellSel.value = null;
      tableSel.value = { kind: 'none' };
      hideToolbar(0);
      document.removeEventListener('mouseup', onDocMouseUp, true);
      // Set focusedCell first → Vue re-renders with contenteditable=true.
      focusedCell.value = { row: r, col: c };
      // After DOM updates, focus the now-editable inner div.
      nextTick(() => {
        const key = `${r}-${c}`;
        const inner = cellRefs.get(key);
        if (inner) {
          inner.focus();
          placeCaretAtEnd(inner);
        }
      });
    }

    function onDocMouseUp(_ev: MouseEvent): void {
      if (isDragging && dragSel.value) {
        // Finalize selection.
        const a = dragSel.value.start;
        const f = dragSel.value.current;
        const rawR1 = Math.min(a.row, f.row);
        const rawC1 = Math.min(a.col, f.col);
        const rawR2 = Math.max(a.row, f.row);
        const rawC2 = Math.max(a.col, f.col);
        // Expand the selection to a closed rectangle over merged-cell
        // footprints IMMEDIATELY upon finalizing. This ensures every
        // downstream consumer (highlighting, toolbar buttons, commands,
        // delete/copy/mark operations) works with a consistent rect that
        // never "half-includes" a merged cell.
        const closed = expandSelectionToFullRect(tattrs.value, rawR1, rawC1, rawR2, rawC2);
        const { r1, c1, r2, c2 } = closed;
        tableSel.value = { kind: 'cell', rect: { r1, c1, r2, c2 } };
        // Also rewrite cellSel so visual highlight + selectionRect() callers
        // all see the expanded (closed) rectangle — no half-merged states.
        cellSel.value = {
          anchor: { row: r1, col: c1 },
          focus: { row: r2, col: c2 },
        };
        const isMulti = r1 !== r2 || c1 !== c2;
        if (isMulti) {
          // Multi-cell drag selection: show toolbar immediately.
          nextTick(() => {
            const rect = computeSelectionRectDOM(r1, c1, r2, c2);
            if (rect) showToolbar(rect);
          });
        } else if (hadToolbarOnMouseDown) {
          // Single-cell click while toolbar was already visible (switching
          // selection A→B): skip the 250ms dblclick-cancel delay — the
          // toolbar is already visible, just move it to the new position.
          // showToolbar() also unfreezes isSwitchingSelection so the cache
          // updates to the new cell's state in the same render.
          const rect = computeSelectionRectDOM(r1, c1, r2, c2);
          if (rect) showToolbar(rect);
        } else {
          // Single-cell click with no prior toolbar (first appearance):
          // delay toolbar so a dblclick can cancel it, preventing the
          // toolbar from flashing before edit mode begins.
          if (singleSelectToolbarTimer) clearTimeout(singleSelectToolbarTimer);
          singleSelectToolbarTimer = setTimeout(() => {
            singleSelectToolbarTimer = null;
            const rect = computeSelectionRectDOM(r1, c1, r2, c2);
            if (rect) showToolbar(rect);
          }, 250);
        }
      }
      isDragging = false;
      dragSel.value = null;
      document.removeEventListener('mouseup', onDocMouseUp, true);
    }

    // --- Row / Column selection + insertion handlers ------------------------

    function selectRow(row: number): void {
      // Toggle: if this row is already selected, deselect.
      if (tableSel.value.kind === 'row' && tableSel.value.row === row) {
        tableSel.value = { kind: 'none' };
        cellSel.value = null;
        hideToolbar(0);
        return;
      }
      // Freeze cached state during the switch so the toolbar at the OLD
      // position keeps showing the OLD state until showToolbar() moves
      // the rect to the new position and unfreezes.
      if (selectionDOMRect.value !== null) isSwitchingSelection = true;
      const attr = tattrs.value;
      const cols = attr.cols;
      // Start with entire row, then expand so any merged cell that spills
      // outside the row pulls the selection rectangle to cover it fully.
      const rawR1 = row, rawC1 = 0, rawR2 = row, rawC2 = Math.max(0, cols - 1);
      const closed = cols > 0
        ? expandSelectionToFullRect(attr, rawR1, rawC1, rawR2, rawC2)
        : { r1: rawR1, c1: rawC1, r2: rawR2, c2: rawC2 };
      tableSel.value = { kind: 'row', row };
      cellSel.value = cols > 0
        ? { anchor: { row: closed.r1, col: closed.c1 }, focus: { row: closed.r2, col: closed.c2 } }
        : null;
      focusedCell.value = null;
      const focused = document.activeElement as HTMLElement | null;
      if (focused && focused.closest('.table-cell-inner')) focused.blur();
      focusContainer();
      nextTick(() => {
        const ms = measureState.value;
        // Use the expanded row range's visual bounds.
        const top = ms.rowTops[closed.r1] ?? 0;
        const bottomRow = ms.rowTops[closed.r2] ?? 0;
        const bottomH = ms.rowHeights[closed.r2] ?? 32;
        const h = (bottomRow + bottomH) - top;
        const totalW = ms.colWidths.length > 0
          ? ms.colWidths.reduce((a, b) => a + b, 0)
          : attr.colWidths.reduce((a, b) => a + b, 0);
        const left = ms.colLefts[0] ?? 0;
        const rect = new DOMRect(left, top, totalW, h);
        showToolbar(rect);
      });
    }

    function selectCol(col: number): void {
      if (tableSel.value.kind === 'col' && tableSel.value.col === col) {
        tableSel.value = { kind: 'none' };
        cellSel.value = null;
        hideToolbar(0);
        return;
      }
      if (selectionDOMRect.value !== null) isSwitchingSelection = true;
      const attr = tattrs.value;
      const rows = attr.rows;
      // Start with entire column, then expand so merged cells spilling out
      // of the col pull the selection rectangle to cover them fully.
      const rawR1 = 0, rawC1 = col, rawR2 = Math.max(0, rows - 1), rawC2 = col;
      const closed = rows > 0
        ? expandSelectionToFullRect(attr, rawR1, rawC1, rawR2, rawC2)
        : { r1: rawR1, c1: rawC1, r2: rawR2, c2: rawC2 };
      tableSel.value = { kind: 'col', col };
      cellSel.value = rows > 0
        ? { anchor: { row: closed.r1, col: closed.c1 }, focus: { row: closed.r2, col: closed.c2 } }
        : null;
      focusedCell.value = null;
      const focused = document.activeElement as HTMLElement | null;
      if (focused && focused.closest('.table-cell-inner')) focused.blur();
      focusContainer();
      nextTick(() => {
        const ms = measureState.value;
        const left = ms.colLefts[closed.c1] ?? 0;
        const rightCol = ms.colLefts[closed.c2] ?? 0;
        const rightW = ms.colWidths[closed.c2] ?? 80;
        const w = (rightCol + rightW) - left;
        const top = ms.rowTops[0] ?? 0;
        const h = rows > 0
          ? ((ms.rowTops[rows - 1] ?? 0) + (ms.rowHeights[rows - 1] ?? 32)) - top
          : 32;
        const rect = new DOMRect(left, top, w, h);
        showToolbar(rect);
      });
    }

    function selectAll(): void {
      if (tableSel.value.kind === 'all') {
        tableSel.value = { kind: 'none' };
        cellSel.value = null;
        hideToolbar(0);
        return;
      }
      if (selectionDOMRect.value !== null) isSwitchingSelection = true;
      const attr = tattrs.value;
      if (attr.rows === 0 || attr.cols === 0) return;
      tableSel.value = { kind: 'all' };
      // Full table — already covers the maximum possible rectangle, but run
      // expansion anyway for defense-in-depth (guards against any future
      // grid-size mismatch bugs that would leave merges dangling past the
      // nominal rows-1/cols-1 edge).
      const closed = expandSelectionToFullRect(attr, 0, 0, attr.rows - 1, attr.cols - 1);
      cellSel.value = {
        anchor: { row: closed.r1, col: closed.c1 },
        focus: { row: closed.r2, col: closed.c2 },
      };
      focusedCell.value = null;
      const focused = document.activeElement as HTMLElement | null;
      if (focused && focused.closest('.table-cell-inner')) focused.blur();
      focusContainer();
      nextTick(() => {
        const ms = measureState.value;
        const top = ms.rowTops[0] ?? 0;
        const left = ms.colLefts[0] ?? 0;
        const totalW = ms.colWidths.length > 0
          ? ms.colWidths.reduce((a, b) => a + b, 0)
          : attr.colWidths.reduce((a, b) => a + b, 0);
        const lastTop = ms.rowTops[attr.rows - 1] ?? 0;
        const lastH = ms.rowHeights[attr.rows - 1] ?? 32;
        const rect = new DOMRect(left, top, totalW, (lastTop + lastH) - top);
        showToolbar(rect);
      });
    }

    function computeSelectionRectDOM(r1: number, c1: number, r2: number, c2: number): DOMRect | null {
      const ms = measureState.value;
      const top = ms.rowTops[r1] ?? 0;
      const bottomRow = ms.rowTops[r2] ?? 0;
      const bottomH = ms.rowHeights[r2] ?? 32;
      const bottom = bottomRow + bottomH;
      const left = ms.colLefts[c1] ?? 0;
      const rightCol = ms.colLefts[c2] ?? 0;
      const rightW = ms.colWidths[c2] ?? 80;
      const right = rightCol + rightW;
      return new DOMRect(left, top, right - left, bottom - top);
    }
    onBeforeUnmount(() => {
      document.removeEventListener('mouseup', onDocMouseUp, true);
      document.removeEventListener('mouseup', onCellMouseUp, true);
      document.removeEventListener('mousemove', onColResizeMove, true);
      document.removeEventListener('mouseup', onColResizeEnd, true);
      document.removeEventListener('keydown', onDocKeyDown, true);
      document.removeEventListener('selectionchange', onCellSelectionChange);
      document.removeEventListener('mousedown', onDocMouseDownForCellLink, true);
      window.removeEventListener('scroll', onTableMenuScrollOrTouch, true);
      document.removeEventListener('touchmove', onTableMenuScrollOrTouch, true);
      if (singleSelectToolbarTimer) {
        clearTimeout(singleSelectToolbarTimer);
        singleSelectToolbarTimer = null;
      }
    });

    // Global keydown for when a row/col/cell/all is selected (not focused).
    function onDocKeyDown(ev: KeyboardEvent): void {
      const sel = tableSel.value;
      if (sel.kind === 'none') return;
      // Only handle if focus is not in a text input or contenteditable inside the table.
      const active = document.activeElement as HTMLElement | null;
      if (active?.closest('.table-cell-inner')) return;
      // Escape clears any selection.
      if (ev.key === 'Escape') {
        ev.preventDefault();
        tableSel.value = { kind: 'none' };
        cellSel.value = null;
        hideToolbar(0);
        return;
      }
      const isDel = ev.key === 'Delete' || ev.key === 'Backspace';
      if (!isDel) return;
      ev.preventDefault();
      if (sel.kind === 'row') action('tableRemoveRow', { row: sel.row });
      else if (sel.kind === 'col') action('tableRemoveCol', { col: sel.col });
      else if (sel.kind === 'all') action('tableDelete');
      // For cell selection, Delete/Backspace clears content of selected cells.
      else if (sel.kind === 'cell') {
        const { r1, c1, r2, c2 } = sel.rect;
        // Empty InlineSeq ([]) represents "no text" in the data model.
        const emptyContent: readonly InlineNode[] = [];
        let result = tattrs.value;
        for (let rr = r1; rr <= r2; rr++) {
          for (let cc = c1; cc <= c2; cc++) {
            result = setCellContent(result, rr, cc, emptyContent);
          }
        }
        editor.commands.setAttrs?.({ id: blockId, attrs: result as unknown as Attrs });
      }
    }

    // Close floating popovers (cell link popover, ordered-list menu,
    // number picker) when clicking outside the table and outside the
    // popovers themselves. These are teleported to <body>, so
    // container-level handlers can't detect outside clicks.
    function onDocMouseDownForCellLink(e: MouseEvent): void {
      // Quick exit if nothing to close.
      if (!cellLinkPopover.visible && !tableOlMenu.visible && !tableNumberPicker.visible) return;
      const target = e.target as HTMLElement;
      // Don't close if clicking on any link popover (teleported to body).
      if (target.closest('.link-popover')) return;
      // Don't close if clicking on the ordered-list menu or number picker.
      if (target.closest('.ordered-list-menu')) return;
      if (target.closest('.number-picker')) return;
      // Don't close if clicking inside the table container — handled by
      // onContainerMouseDown which will close it as needed.
      if (containerRef.value && containerRef.value.contains(target)) return;
      // Clicked outside — close the popovers.
      if (cellLinkPopover.visible) closeCellLinkPopover();
      if (tableOlMenu.visible) closeTableOlMenu();
      if (tableNumberPicker.visible) closeTableNumberPicker();
    }

    // Close table link popover (view/edit), ordered-list menu and number
    // picker on page scroll or touch-move (swipe). These popovers are
    // positioned relative to the viewport, so they go stale the moment the
    // page scrolls.
    function onTableMenuScrollOrTouch(): void {
      if (cellLinkPopover.visible) closeCellLinkPopover();
      if (tableOlMenu.visible) closeTableOlMenu();
      if (tableNumberPicker.visible) closeTableNumberPicker();
      // Keep the cell-selection floating toolbar glued to the selected cells:
      // re-measure the (wrapper-relative) selection rect and re-convert it to
      // viewport space so the toolbar scrolls WITH the content instead of
      // staying pinned to the viewport. Mirrors BlockEditor's
      // refreshHoverToolbarRect for the text-selection toolbar.
      if (selectionDOMRect.value !== null && cellSel.value) {
        const raw = selectionRect(cellSel.value);
        if (raw) {
          const expanded = expandSelectionToFullRect(
            tattrs.value, raw.r1, raw.c1, raw.r2, raw.c2,
          );
          const rect = computeSelectionRectDOM(
            expanded.r1, expanded.c1, expanded.r2, expanded.c2,
          );
          if (rect) selectionDOMRect.value = toViewportRect(rect);
        }
      }
    }

    onMounted(() => {
      document.addEventListener('keydown', onDocKeyDown, true);
      document.addEventListener('selectionchange', onCellSelectionChange);
      document.addEventListener('mousedown', onDocMouseDownForCellLink, true);
      // Close table OL menu / number picker on page scroll or touch swipe.
      window.addEventListener('scroll', onTableMenuScrollOrTouch, true);
      document.addEventListener('touchmove', onTableMenuScrollOrTouch, { passive: true, capture: true });
    });

    // --- Column resize ----------------------------------------------------

    // Wrapper ref for measuring offsets relative to table.
    const wrapperRef = ref<HTMLDivElement | null>(null);

    // Per-row / per-column measurement state. Updated after every render
    // via measureOffsets(). Drive absolutely-positioned handle overlays.
    interface MeasureState {
      readonly rowTops: readonly number[];   // index by visual row (0..rows-1)
      readonly rowHeights: readonly number[];
      readonly colLefts: readonly number[];  // index by visual col (0..cols-1)
      readonly colWidths: readonly number[];
      readonly wrapperOffsetLeft: number;  // wrapper left relative to container
      readonly wrapperOffsetTop: number;   // wrapper top relative to container
      readonly tableTotalWidth: number;   // total width of all columns
      readonly tableTotalHeight: number;  // total height of all rows
    }
    const measureState = ref<MeasureState>({
      rowTops: [],
      rowHeights: [],
      colLefts: [],
      colWidths: [],
      wrapperOffsetLeft: 0,
      wrapperOffsetTop: 0,
      tableTotalWidth: 0,
      tableTotalHeight: 0,
    });

    function measureOffsets(): void {
      const tbl = tableEl.value;
      const wrap = wrapperRef.value;
      const container = containerRef.value;
      if (!tbl || !wrap || !container) return;
      const rows = tattrs.value.rows;
      const cols = tattrs.value.cols;

      const wrapRect = wrap.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();

      // Calculate wrapper offset relative to container (for fixed handle positioning).
      const wrapperOffsetLeft = Math.round(wrapRect.left - containerRect.left);
      const wrapperOffsetTop = Math.round(wrapRect.top - containerRect.top);

      // Measure each row's top + height from <tr> elements.
      const trs = Array.from(tbl.querySelectorAll('tr')) as HTMLTableRowElement[];
      const rowTops: number[] = [];
      const rowHeights: number[] = [];
      for (const tr of trs) {
        const r = tr.getBoundingClientRect();
        rowTops.push(Math.round(r.top - wrapRect.top));
        rowHeights.push(Math.round(r.height));
      }

      // Fill gaps if some rows are missing.
      while (rowTops.length < rows) {
        const lastTop = rowTops.length > 0
          ? (rowTops[rowTops.length - 1]! + rowHeights[rowHeights.length - 1]!)
          : 0;
        rowTops.push(lastTop);
        rowHeights.push(rowHeights.length > 0 ? rowHeights[rowHeights.length - 1]! : 32);
      }

      // Measure columns from <colgroup><col> elements — reliable even with
      // colspan/rowspan cells that would confuse a cell-based traversal.
      // Add wrap.scrollLeft to convert from viewport-relative (r.left −
      // wrapRect.left, which subtracts the scroll offset) to content-relative
      // coordinates. colStrips / resizeItems live INSIDE the scroll container
      // and use left:0 = content origin, so they need content-relative values.
      const scrollLeft = wrap.scrollLeft;
      const colLefts: number[] = [];
      const colWidths: number[] = [];
      const colEls = Array.from(tbl.querySelectorAll('colgroup > col')) as HTMLTableColElement[];
      if (colEls.length > 0) {
        for (const col of colEls) {
          const r = col.getBoundingClientRect();
          colLefts.push(Math.round(r.left - wrapRect.left + scrollLeft));
          colWidths.push(Math.round(r.width));
        }
      }
      while (colLefts.length < cols) {
        const lastLeft = colLefts.length > 0
          ? (colLefts[colLefts.length - 1]! + colWidths[colWidths.length - 1]!)
          : 0;
        colLefts.push(lastLeft);
        colWidths.push(colWidths.length > 0 ? colWidths[colWidths.length - 1]! : 80);
      }

      // Calculate total table dimensions for handle sizing.
      const tableTotalWidth = colWidths.reduce((a, b) => a + b, 0);
      const tableTotalHeight = rowHeights.reduce((a, b) => a + b, 0);

      measureState.value = {
        rowTops,
        rowHeights,
        colLefts,
        colWidths,
        wrapperOffsetLeft,
        wrapperOffsetTop,
        tableTotalWidth,
        tableTotalHeight,
      };
      // Structure changed (rows/cols/widths) → the wrapper's scrollWidth /
      // clamped scrollLeft may have changed too. Re-sync so the fixed
      // column insert-dot overlay recomputes against fresh dimensions.
      syncColScrollState();
    }

    // Re-measure after every render where table structure may have changed.
    watchEffect(() => {
      // Access tattrs to establish tracking.
      void tattrs.value.rows;
      void tattrs.value.cols;
      void tattrs.value.headerRow;
      // Trigger on focusedCell too (cell focus can change row height via outline).
      void focusedCell.value?.row;
      void focusedCell.value?.col;
      // Guard: during column resize, tattrs changes every mousemove frame.
      // If we let measureOffsets run here, each frame does:
      //   setAttrs → tattrs changes → watchEffect → nextTick → measureOffsets
      //   (getBoundingClientRect = forced reflow) → measureState updates →
      //   second render. That's double render + 1 reflow per frame = lag.
      // Skip measureOffsets during resize; a final sync runs in onColResizeEnd.
      nextTick(() => {
        if (resizingCol.value !== null) return;
        measureOffsets();
      });
    });

    // Re-measure when observed elements resize — column widths / row heights
    // can change when the viewport shrinks.
    let ro: ResizeObserver | null = null;
    onMounted(() => {
      ro = new ResizeObserver(() => {
        // Skip expensive DOM measurements during column resize — the widths
        // are being driven by the mouse, not by layout. A final measurement
        // runs in onColResizeEnd.
        if (resizingCol.value !== null) return;
        measureOffsets();
        // Wrapper size changed → re-read scroll viewport so the insert-dot
        // overlay recomputes against fresh dimensions.
        syncColScrollState();
      });
      if (wrapperRef.value) ro.observe(wrapperRef.value);
      if (tableEl.value) ro.observe(tableEl.value);
      // Observe the editor content area (.block-editor) so that layout
      // changes (sidebar toggle, panel resize, etc.) that alter the available
      // width — even without changing the wrapper's own dimensions — trigger
      // a re-measure and dot repositioning.
      const editorEl = containerRef.value?.closest('.block-editor') as HTMLElement | null;
      if (editorEl) ro.observe(editorEl);
      // Track horizontal scroll of the wrapper to drive the fixed column
      // insert-dot overlay.
      if (wrapperRef.value) {
        wrapperRef.value.addEventListener('scroll', onWrapperScroll, { passive: true });
      }
      syncColScrollState();
    });
    onBeforeUnmount(() => {
      ro?.disconnect();
      if (wrapperRef.value) {
        wrapperRef.value.removeEventListener('scroll', onWrapperScroll);
      }
      if (colScrollRafId) cancelAnimationFrame(colScrollRafId);
      if (colScrollIdleTimer) clearTimeout(colScrollIdleTimer);
    });

    function onColResizeStart(col: number, ev: MouseEvent): void {
      ev.preventDefault();
      ev.stopPropagation();
      resizingCol.value = col;
      // Use the measured colWidth for the drag start — matches <colgroup>.
      const ms = measureState.value;
      resizeStartW = ms.colWidths[col] ?? 80;
      resizeStartX = ev.clientX;
      document.addEventListener('mousemove', onColResizeMove, true);
      document.addEventListener('mouseup', onColResizeEnd, true);
      // Force col-resize cursor on the entire document so it doesn't flicker
      // between col-resize and default as the resizer element re-renders and
      // the mouse momentarily slips off it during each drag frame.
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    }
    function onColResizeMove(ev: MouseEvent): void {
      if (resizingCol.value === null) return;
      const dx = ev.clientX - resizeStartX;
      let newW = Math.max(40, Math.round(resizeStartW + dx));
      // Enforce table max-width, but only when the table is still within the
      // container. Once the table has reached or exceeded the container limit,
      // we stop clamping — the table is allowed to overflow and the browser
      // no longer shrinks columns (we use min-width instead of max-width on
      // the <table> to prevent proportional column compression).
      const wrap = wrapperRef.value;
      if (wrap) {
        // Available width for the table content inside the wrapper.
        // wrapper has no horizontal padding (margin-left creates the
        // gutter, not padding), so clientWidth is the full content width.
        const availW = wrap.clientWidth - 4;
        const otherW = tattrs.value.colWidths.reduce((a, b, i) => i === resizingCol.value ? a : a + b, 0);
        const totalW = otherW + newW;
        if (totalW <= availW) {
          // Still fits inside the wrapper — enforce the cap so the
          // horizontal scrollbar never flickers in-and-out during drag.
          const maxW = Math.max(40, availW - otherW);
          newW = Math.min(newW, maxW);
        }
        // else: table has already overflowed the wrapper — allow free
        // resizing; the wrapper's own horizontal scrollbar handles it.
      }
      const next = setColWidth(tattrs.value, resizingCol.value, newW);
      editor.commands.setAttrs?.({ id: blockId, attrs: next as unknown as Attrs });
    }
    function onColResizeEnd(): void {
      resizingCol.value = null;
      document.removeEventListener('mousemove', onColResizeMove, true);
      document.removeEventListener('mouseup', onColResizeEnd, true);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      // Final measurement after resize — the per-frame measurements were
      // skipped during drag for performance.
      nextTick(() => {
        measureOffsets();
        syncColScrollState();
      });
    }

    // --- Column insert dots: fixed overlay outside the scroll wrapper ----
    //
    // The column insertion dots used to live INSIDE .table-wrapper (the
    // horizontal scroll container) as part of .table-col-handles, so they
    // scrolled with the table. They are now rendered as a FIXED overlay
    // (.table-col-insert-dots) — a direct child of .block-table-container
    // and sibling to .table-wrapper — so they never scroll themselves.
    //
    // Their horizontal positions are COMPUTED from the current scroll
    // state: each column boundary's content-x is mapped to a viewport-x
    // (content-x − scrollLeft) and the dot is placed there. Only boundaries
    // inside the visible viewport are shown; when the table is scrolled to
    // its left/right edge (or needs no scrolling at all) the leftmost /
    // rightmost boundary dots are forced visible so the user can always
    // insert at the outer edges. The dots fade out while scrolling and
    // reappear (recomputed) once scrolling is stationary.

    const colScrollLeft = ref(0);
    const colViewportWidth = ref(0);
    const colScrollWidth = ref(0);
    // True while the wrapper is actively scrolling — fades the dots out so
    // they don't visually chase every intermediate scroll frame.
    const colScrolling = ref(false);
    let colScrollRafId = 0;
    let colScrollIdleTimer: ReturnType<typeof setTimeout> | undefined;

    // Read the wrapper's live scroll geometry into reactive refs so the
    // colDotItems computed can recompute without touching the DOM directly.
    function syncColScrollState(): void {
      const wrap = wrapperRef.value;
      if (!wrap) return;
      colScrollLeft.value = wrap.scrollLeft;
      colViewportWidth.value = wrap.clientWidth;
      colScrollWidth.value = wrap.scrollWidth;
    }

    function onWrapperScroll(): void {
      if (!colScrolling.value) colScrolling.value = true;
      // rAF-coalesce: one geometry read per frame instead of per event.
      if (colScrollRafId) cancelAnimationFrame(colScrollRafId);
      colScrollRafId = requestAnimationFrame(() => {
        colScrollRafId = 0;
        syncColScrollState();
      });
      if (colScrollIdleTimer) clearTimeout(colScrollIdleTimer);
      // Once scrolling has been idle for a beat, mark stationary and do a
      // final precise read so the dots settle on the resting position.
      colScrollIdleTimer = setTimeout(() => {
        colScrolling.value = false;
        syncColScrollState();
      }, 130);
    }

    // Boundary dot descriptors for the fixed overlay. Recomputes whenever
    // the measured column geometry OR the scroll state changes.
    const colDotItems = computed<{ c: number; left: number }[]>(() => {
      if (!editable.value) return [];
      const ms = measureState.value;
      const cols = tattrs.value.cols;
      const lefts = ms.colLefts;
      const widths = ms.colWidths;
      if (cols === 0 || lefts.length < cols || widths.length < cols) return [];
      const scrollLeft = colScrollLeft.value;
      const vw = colViewportWidth.value;
      const sw = colScrollWidth.value;
      if (vw <= 0) return [];

      const atLeftEdge = scrollLeft <= 0;
      const atRightEdge = scrollLeft + vw >= sw - 1;
      const noOverflow = sw <= vw + 1;
      // Keep dots fully inside the overlay (half-width ~5px + hover scale).
      const INSET = 6;
      const items: { c: number; left: number }[] = [];
      for (let c = 0; c <= cols; c++) {
        // Content-x of the boundary between column (c-1) and column c.
        const b = c === 0
          ? (lefts[0] ?? 0)
          : c === cols
            ? (lefts[cols - 1] ?? 0) + (widths[cols - 1] ?? 0)
            : (lefts[c] ?? 0);
        // Viewport-x: where this boundary currently sits in the visible area.
        const vp = b - scrollLeft;
        let visible = vp >= -1 && vp <= vw + 1;
        // Always offer insertion at the outer edges when the table can't
        // scroll any further in that direction (or doesn't scroll at all).
        if (c === 0 && (atLeftEdge || noOverflow)) visible = true;
        if (c === cols && (atRightEdge || noOverflow)) visible = true;
        if (!visible) continue;
        // Clamp so a dot resting on the viewport edge is never half-clipped.
        // Nudge non-first dots +2px right, first dot -2px left for visual spacing.
        const left = Math.max(INSET, Math.min(vp, vw - INSET)) + (c > 0 ? 2 : -2);
        items.push({ c, left });
      }
      return items;
    });

    // --- Structural actions dispatched through editor.commands -----------

    function action(name: string, extra?: Record<string, unknown>): void {
      const args = { id: blockId, ...extra } as unknown as Record<string, unknown>;
      (editor.commands as Record<string, (a: unknown) => boolean>)[name]?.(args);
    }

    // --- Render -----------------------------------------------------------

    return () => {
      const attr = tattrs.value;
      const rows = attr.rows;
      const cols = attr.cols;
      const rawSel = selectionRect(cellSel.value);
      // Expand the selection rectangle for visual highlighting too — so the
      // user immediately sees the closed rectangle that will be operated on.
      const sel = rawSel
        ? expandSelectionToFullRect(attr, rawSel.r1, rawSel.c1, rawSel.r2, rawSel.c2)
        : null;
      const ms = measureState.value;
      const tsel = tableSel.value;
      const children: VNode[] = [];

      // --- Minimal table header (title only, no action buttons) ----------
      // Rendered inside .table-wrapper as an absolutely positioned element so
      // it shares the same positioning context with table-corner-handle and
      // thus stays perfectly vertically aligned with it.
      const toolbarNode = h('div', { class: 'table-toolbar' }, [
        h('div', { class: 'table-toolbar-title' }, [
          h(SafeHtml, { html: ICON_TABLE, class: 'table-toolbar-icon' }),
          h('span', i18n.t('table.title')),
        ]),
      ]);

      // --- <table> element ---
      const colEls: VNode[] = [];
      for (let c = 0; c < cols; c++) {
        const w = attr.colWidths[c] ?? 0;
        const style: Record<string, string> = {};
        if (w && w > 0) style.width = `${w}px`;
        colEls.push(h('col', { 'data-col': c, style }));
      }
      const colGroup = h('colgroup', {}, colEls);

      const theadChildren: VNode[] = [];
      const tbodyChildren: VNode[] = [];
      const headStart = attr.headerRow ? 0 : -1;

      for (let r = 0; r < rows; r++) {
        const trChildren: VNode[] = [];
        for (let c = 0; c < cols; c++) {
          const cell = attr.cells[r]?.[c];
          if (!cell) continue;
          if (cell.covered) continue;
          const key = `${r}-${c}`;
          const isHeader = headStart === 0 && r === 0;
          const isSelected = !!sel && withinRect(r, c, sel);
          const isRowSel = tsel.kind === 'row' && tsel.row === r;
          const isColSel = tsel.kind === 'col' && tsel.col === c;
          const isAllSel = tsel.kind === 'all';
          const hasSelection = isSelected || isRowSel || isColSel || isAllSel;
          let cellHtml = inlineToHtml(cell.content);
          // Code-block cells use white-space: pre-wrap. Browsers collapse a
          // trailing "\n" visually (no visible empty last line), which makes
          // the first Enter at end-of-content look like a no-op and also
          // confuses caret rendering. Append a <br> after the last "\n" so
          // the trailing new line is rendered. <br> is ignored by
          // inlineFromDom, so it never enters the data model.
          if (cell.cellType === 'codeBlock' && cellHtml.endsWith('\n')) {
            cellHtml += '<br>';
          }
          const classes: string[] = ['table-cell'];
          if (isHeader) classes.push('table-cell-header');
          if (isSelected) classes.push('table-cell-selected');
          if (isRowSel || isColSel || isAllSel) classes.push('table-cell-selected');
          // Cell-level attrs: alignment + background color (rendered on the
          // td/th so they cover the whole cell area). Uses the same
          // .be-align-* / .be-bg-* class presets as other blocks.
          if (typeof cell.align === 'string' && cell.align !== 'left') {
            classes.push(`be-align-${cell.align}`);
          }
          if (typeof cell.bgColor === 'string' && cell.bgColor !== 'default') {
            classes.push(`be-bg-${cell.bgColor}`);
          }
          // Cell-level vertical alignment via inline style. Must override
          // the CSS default `vertical-align: top` on .table-cell, so we
          // explicitly set 'middle' too (it maps to undefined in the data
          // model but the CSS default is top, not middle).
          const cellVa = cell.verticalAlign ?? 'middle';
          let cellStyle: Record<string, string> | undefined;
          if (cellVa !== 'top') {
            cellStyle = { verticalAlign: cellVa };
          }
          // Focus (blue outline) and selection (blue background) are
          // mutually exclusive — don't show focus outline on a selected cell.
          const isEditing = !hasSelection && focusedCell.value?.row === r && focusedCell.value?.col === c;
          if (isEditing) {
            classes.push('table-cell-focused');
          }
          const innerClasses: string[] = ['table-cell-inner'];
          // Apply CSS classes that mirror text block styles for each cell type.
          const ct = cell.cellType;
          if (ct === 'heading' || ct === 'heading1') innerClasses.push('table-cell-heading', 'table-cell-h1');
          else if (ct === 'heading2') innerClasses.push('table-cell-heading', 'table-cell-h2');
          else if (ct === 'heading3') innerClasses.push('table-cell-heading', 'table-cell-h3');
          else if (ct === 'heading4') innerClasses.push('table-cell-heading', 'table-cell-h4');
          else if (ct === 'heading5') innerClasses.push('table-cell-heading', 'table-cell-h5');
          else if (ct === 'heading6') innerClasses.push('table-cell-heading', 'table-cell-h6');
          else if (ct === 'bulletList') innerClasses.push('table-cell-bullet');
          else if (ct === 'orderedList') innerClasses.push('table-cell-ordered');
          else if (ct === 'todoList') {
            innerClasses.push('table-cell-todo');
            if (cell.checked) innerClasses.push('todo-checked');
          } else if (ct === 'quote') innerClasses.push('table-cell-quote');
          else if (ct === 'codeBlock') innerClasses.push('table-cell-code');
          // Compute the ordered-list number for orderedList cells. For
          // clickable markers we render a REAL DOM element (not ::before)
          // so the user can click it to open the numbering menu in both
          // select state and edit state.
          const olNumber = ct === 'orderedList' ? orderedListCellNumber(attr, r, c) : -1;
          // Build the inner content div VNode. For todoList and orderedList
          // cells, wrap it in a flex container with a sibling element
          // (checkbox / number marker) so the sibling is clickable in
          // non-edit mode without affecting the contenteditable.
          const innerDiv = h('div', {
            class: innerClasses,
            // contenteditable is ONLY true when this cell is in editing
            // mode (set via focusedCell after dblclick) AND the editor is
            // in editable mode. Otherwise false → clicks won't grab focus,
            // enabling selection mode (or read-only display).
            contenteditable: (isEditing && editable.value) ? 'true' : 'false',
            'data-placeholder': i18n.t('table.cellPlaceholder'),
            // Use innerHTML for both editing and non-editing modes so
            // rich marks (bold/italic/color/link) are preserved. In
            // editing mode the DOM stays editable, and inlineFromDom
            // on blur/keydown syncs back to InlineSeq with full marks.
            innerHTML: cellHtml,
            ref: (el: unknown) => {
              if (el instanceof HTMLDivElement) cellRefs.set(key, el);
              else cellRefs.delete(key);
            },
            onBlur: (e: FocusEvent) => onCellBlur(r, c, e.currentTarget as HTMLDivElement, e),
            onFocus: (e: FocusEvent) => onCellFocus(r, c, e.currentTarget as HTMLDivElement),
          });
          // For todoList cells, render a checkbox + content wrapper so the
          // checkbox is clickable in non-edit mode (the checkbox is NOT
          // part of the contenteditable — it's a sibling element).
          //
          // For orderedList cells, render a clickable number marker +
          // content wrapper. Single-click opens the ordered-list menu
          // (continue / start new / modify number) regardless of whether
          // the cell is in select state or edit state.
          let cellChildren: VNode[];
          if (ct === 'todoList') {
            const checkbox = h('input', {
              type: 'checkbox',
              class: 'table-cell-todo-checkbox',
              checked: !!cell.checked,
              // The checkbox must be clickable in both edit and non-edit
              // modes. We stop propagation so the click doesn't trigger
              // cell selection / edit mode entry. We do NOT preventDefault
              // so the browser toggles the checkbox visually immediately;
              // the data model is synced via the onchange event below.
              onClick: (e: MouseEvent) => {
                e.stopPropagation();
              },
              // onchange fires after the browser has toggled the checkbox
              // state. We read the new state from the DOM and update the
              // data model. Vue re-renders with the correct `checked` prop.
              onchange: (e: Event) => {
                const target = e.target as HTMLInputElement;
                const next = setCellAttrs(tattrs.value, r, c, { checked: target.checked });
                editor.commands.setAttrs?.({ id: blockId, attrs: next as unknown as Attrs });
              },
            });
            cellChildren = [
              h('div', { class: 'table-cell-todo-wrapper' }, [checkbox, innerDiv]),
            ];
          } else if (ct === 'orderedList' && olNumber >= 1) {
            const markerEl = h(
              'div',
              {
                class: 'ol-marker table-cell-ol-marker',
                onMousedown: (e: MouseEvent) => {
                  e.preventDefault();
                  e.stopPropagation();
                },
                onClick: (e: MouseEvent) => {
                  e.stopPropagation();
                  const anchor = e.currentTarget as HTMLElement;
                  openTableOlMenu(r, c, anchor);
                },
              },
              `${olNumber}.`,
            );
            cellChildren = [
              h('div', { class: 'block-ordered-list-wrapper' }, [markerEl, innerDiv]),
            ];
          } else {
            cellChildren = [innerDiv];
          }
          const tdEl = h(
            isHeader ? 'th' : 'td',
            {
              rowspan: cell.rowspan > 1 ? cell.rowspan : undefined,
              colspan: cell.colspan > 1 ? cell.colspan : undefined,
              class: classes,
              style: cellStyle,
              'data-row': r,
              'data-col': c,
            },
            cellChildren,
          );
          trChildren.push(tdEl);
        }
        if (headStart === 0 && r === 0) {
          theadChildren.push(h('tr', { class: 'table-row table-row-head' }, trChildren));
        } else {
          tbodyChildren.push(h('tr', { class: 'table-row' }, trChildren));
        }
      }
      const tableChildren = [colGroup];
      if (theadChildren.length > 0) {
        tableChildren.push(h('thead', {}, theadChildren));
      }
      tableChildren.push(h('tbody', {}, tbodyChildren));

      const tableElVNode = h(
        'table',
        {
          ref: tableEl,
          class: 'block-table-grid',
        },
        tableChildren,
      );

      // --- Row selection strips (left gutter, outside wrapper) -------------
      // These live on .block-table-container so they stay fixed during scroll.
      // .table-row-handles is positioned at top:0, and rowTops are measured
      // relative to the wrapper's top edge (which includes the 20px padding-top
      // offset), so they already account for the col-handles area.
      const rowStrips: VNode[] = [];
      for (let r = 0; r < rows; r++) {
        const top = ms.rowTops[r];
        const rowH = ms.rowHeights[r] ?? 32;
        const isSel = tsel.kind === 'row' && tsel.row === r;
        rowStrips.push(h('div', {
          class: `table-row-strip${isSel ? ' is-selected' : ''}`,
          'data-row': r,
          style: { top: `${top}px`, height: `${rowH}px` },
          title: i18n.t('table.selectRow'),
          onClick: (e: MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            selectRow(r);
          },
        }));
      }

      // --- Column geometry: use pure arithmetic during resize ------------
      // During column resize, measureOffsets is skipped (guarded in the
      // watchEffect above) so measureState is frozen at the pre-drag
      // snapshot. To keep resizeItems (blue drag bars), colStrips (column
      // selection strips), and .table-col-handles width following the drag
      // in real time, compute column lefts/widths/total from the live
      // tattrs.value.colWidths — pure arithmetic, zero DOM measurement.
      const isResizing = resizingCol.value !== null;
      const effColLefts: number[] = [];
      const effColWidths: number[] = [];
      let effTableTotalWidth;
      if (isResizing) {
        const cw = attr.colWidths;
        let acc = 0;
        for (let c = 0; c < cols; c++) {
          effColLefts.push(acc);
          const w = cw[c] ?? 80;
          effColWidths.push(w);
          acc += w;
        }
        effTableTotalWidth = acc;
      } else {
        for (let c = 0; c < cols; c++) {
          effColLefts.push(ms.colLefts[c] ?? 0);
          effColWidths.push(ms.colWidths[c] ?? 0);
        }
        effTableTotalWidth = ms.tableTotalWidth;
      }

      // --- Column selection strips (top gutter, inside wrapper) ------------
      // .table-col-handles lives INSIDE .table-wrapper at top:0, left:0, so
      // it scrolls horizontally with the table. colLefts are measured
      // relative to the wrapper's left edge, so they apply directly.
      const colStrips: VNode[] = [];
      for (let c = 0; c < cols; c++) {
        const left = effColLefts[c];
        const w = effColWidths[c] ?? 0;
        const isSel = tsel.kind === 'col' && tsel.col === c;
        colStrips.push(h('div', {
          class: `table-col-strip${isSel ? ' is-selected' : ''}`,
          'data-col': c,
          style: { left: `${left}px`, width: `${w}px` },
          title: i18n.t('table.selectCol'),
          onClick: (e: MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            selectCol(c);
          },
        }));
      }

      // --- Insertion dots ------------------------------------------------
      // Row dots are children of .table-row-handles (outside wrapper, fixed).
      // Column dots are NO LONGER rendered here — they used to live inside
      // .table-col-handles (which scrolls with the table). They are now a
      // fixed overlay (.table-col-insert-dots) computed from the wrapper's
      // scroll state (see colDotItems) and rendered outside the wrapper.
      // Hidden entirely in read-only mode — inserting rows/cols is an
      // editing action.
      const rowDots: VNode[] = [];
      if (editable.value) {
        for (let r = 0; r <= rows; r++) {
          let posTop: number;
          if (r === 0) {
            posTop = (ms.rowTops[0] ?? 0) + 3;
          } else if (r === rows) {
            const lastTop = ms.rowTops[r - 1] ?? 0;
            const lastH = ms.rowHeights[r - 1] ?? 32;
            posTop = lastTop + lastH + 2;
          } else {
            const aboveBottom = (ms.rowTops[r - 1] ?? 0) + (ms.rowHeights[r - 1] ?? 32);
            const belowTop = ms.rowTops[r] ?? 0;
            posTop = Math.round((aboveBottom + belowTop) / 2);
          }
          rowDots.push(h('div', {
            class: 'table-insert-dot table-insert-dot-row',
            style: { top: `${posTop}px` },
            title: r < rows ? i18n.t('table.insertRowAbove') : i18n.t('table.insertRowBelow'),
            onClick: (e: MouseEvent) => {
              e.preventDefault();
              e.stopPropagation();
              action('tableInsertRow', { beforeRow: r });
            },
          }));
        }
      }

      // --- Column resizers (overlay the table area) ---------------------
      const resizeItems: VNode[] = [];
      for (let c = 0; c < cols; c++) {
        const left = effColLefts[c] ?? 0;
        const w = effColWidths[c] ?? 0;
        resizeItems.push(h('div', {
          class: 'table-col-resize-item',
          style: {
            left: `${left}px`,
            width: `${w}px`,
          },
        }, [
          h('div', {
            class: 'table-col-resizer',
            title: i18n.t('table.resizeCol'),
            onMousedown: (e: MouseEvent) => onColResizeStart(c, e),
          }),
        ]));
      }

      // --- Corner handle (top-left, select entire table) ----------------
      const cornerHandle = h('div', {
        class: 'table-corner-handle',
        title: i18n.t('table.selectAll'),
        onClick: (e: MouseEvent) => {
          e.preventDefault();
          e.stopPropagation();
          selectAll();
        },
      });

      // --- Toolbar strip + corner-handle live OUTSIDE the scroll wrapper
      // so they stay fixed when the table overflows.
      children.push(toolbarNode, cornerHandle);

      // --- Row handles (left gutter, outside wrapper) -------------------
      // Fixed during horizontal scroll (rows don't move horizontally).
      children.push(
        h('div', {
          class: 'table-row-handles',
          style: { height: `${ms.tableTotalHeight}px` },
        }, [
          ...rowStrips,
          ...rowDots,
        ]),
      );

      // Assemble the wrapper — this is the scroll container (overflow-x: auto).
      // col-handles lives INSIDE the wrapper so it scrolls horizontally with
      // the table (like Arco Design's table header). Row handles stay outside
      // because rows don't move horizontally. Column INSERT dots also stay
      // outside (see .table-col-insert-dots below) — they are computed from
      // the scroll state instead of scrolling with the content.
      children.push(
        h('div', {
          class: 'table-wrapper',
          ref: wrapperRef,
        }, [
          // Column handles (top gutter, scrolls with table). Only the
          // column selection strips remain here; the insert dots have been
          // moved to a fixed overlay outside the wrapper.
          h('div', {
            class: 'table-col-handles',
            style: { width: `${effTableTotalWidth}px` },
          }, [
            ...colStrips,
          ]),
          // Column resizers (overlay the table area, scrolls with table).
          h('div', { class: 'table-col-resizers' }, resizeItems),
          // The actual <table> (scrolls with wrapper).
          tableElVNode,
        ]),
      );

      // --- Column insert dots (fixed overlay, outside the scroll wrapper) --
      // Sibling to .table-wrapper. Horizontal positions come from
      // colDotItems, which maps each column boundary's content-x to a
      // viewport-x (content-x − scrollLeft). The overlay's left edge
      // aligns with the wrapper's visible left edge, so a dot's `left`
      // equals its viewport-x directly. The dots fade out while the
      // wrapper is actively scrolling and reappear (recomputed) once it
      // is stationary.
      children.push(
        h('div', {
          class: ['table-col-insert-dots', (colScrolling.value || resizingCol.value !== null) ? 'is-scrolling' : ''],
        }, colDotItems.value.map((d) => h('div', {
          class: 'table-insert-dot table-insert-dot-col',
          style: { left: `${d.left}px` },
          title: d.c < cols ? i18n.t('table.insertColLeft') : i18n.t('table.insertColRight'),
          onClick: (e: MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            action('tableInsertCol', { beforeCol: d.c });
          },
        }))),
      );

      // --- Floating toolbar (HoverToolbar component in table mode) ---
      // Always render — the `visible` prop controls CSS fade animations.
      const selRect = selectionDOMRect.value;
      const showingDelete = tsel.kind === 'row' || tsel.kind === 'col' || tsel.kind === 'all';

      // Resolve the raw selection rectangle (cell multi-select), then
      // expand it so we never operate on half a merged cell.
      const rawRect = selectionRect(cellSel.value);
      const expandedRect = rawRect
        ? expandSelectionToFullRect(tattrs.value, rawRect.r1, rawRect.c1, rawRect.r2, rawRect.c2)
        : null;

      // For single-focused cells, synthesize a 1x1 "rect" so the split
      // button still works when a merged cell has been dbl-clicked into
      // focused edit-mode.
      const singleFocusRect = focusedCell.value
        ? { r1: focusedCell.value.row, c1: focusedCell.value.col,
            r2: focusedCell.value.row, c2: focusedCell.value.col }
        : null;
      const effectiveRect = expandedRect ?? singleFocusRect;

      // Button visibility rules (precisely as specified):
      //   * showMerge — only when the user explicitly selected MULTIPLE
      //     (non-covered) cells inside a multi-cell rectangle (≥ 2).
      //   * showSplit — only if the effective rect (expanded + closed)
      //     contains at least one already-merged cell (rowspan>1 or
      //     colspan>1). This means the user must have selected merged
      //     cells before the split button appears.
      const nonCovered = effectiveRect
        ? countNonCoveredInRect(tattrs.value, effectiveRect.r1, effectiveRect.c1, effectiveRect.r2, effectiveRect.c2)
        : 0;
      const showingMerge = nonCovered >= 2;
      const showingSplit = effectiveRect
        ? rectContainsMergedCells(tattrs.value, effectiveRect.r1, effectiveRect.c1, effectiveRect.r2, effectiveRect.c2)
        : false;

      const deleteLabel
        = tsel.kind === 'row'
          ? i18n.t('table.deleteRow')
          : tsel.kind === 'col'
            ? i18n.t('table.deleteCol')
            : tsel.kind === 'all' ? i18n.t('table.deleteTable') : '';
      const deleteIcon
        = tsel.kind === 'row'
          ? ICON_DEL_ROW
          : tsel.kind === 'col'
            ? ICON_DEL_COL
            : ICON_DELETE_TABLE;
      const deleteHandler = () => {
        if (tsel.kind === 'row') action('tableRemoveRow', { row: tsel.row });
        else if (tsel.kind === 'col') action('tableRemoveCol', { col: tsel.col });
        else action('tableDelete');
      };
      const mergeHandler = () => {
        if (!effectiveRect) return;
        action('tableMergeCells', effectiveRect);
      };
      const splitHandler = () => {
        if (!effectiveRect) return;
        // Dispatch split operation on the whole (expanded) rect so every
        // merged cell within the current selection is split at once.
        action('tableSplitCellsInRect', effectiveRect);
      };
      const headerRowHandler = () => {
        action('tableToggleHeaderRow');
      };
      const closeHandler = () => {
        tableSel.value = { kind: 'none' };
        cellSel.value = null;
        hideToolbar(0);
      };

      // Get selected cell positions from cellSel or tableSel.
      function getSelectedPositions(): { row: number; col: number }[] {
        const rect = selectionRect(cellSel.value);
        if (!rect) return [];
        const positions: { row: number; col: number }[] = [];
        for (let r = rect.r1; r <= rect.r2; r++) {
          for (let c = rect.c1; c <= rect.c2; c++) {
            const cell = tattrs.value.cells[r]?.[c];
            if (cell && !cell.covered) positions.push({ row: r, col: c });
          }
        }
        return positions;
      }

      // --- Compute effective cell state for toolbar button feedback ---
      // When multiple cells are selected, a button is "active" only if
      // ALL selected cells share the same state (e.g. all bold, all
      // heading, all center-aligned). Mixed states show as inactive.
      const selPositions = getSelectedPositions();
      const selCells = selPositions
        .map((p) => tattrs.value.cells[p.row]?.[p.col])
        .filter((c): c is NonNullable<typeof c> => !!c && !c.covered);

      // Effective cell type: map cell type to block-level type + level
      // so the HoverToolbar type dropdown can show the correct active state.
      const cellTypeSet = new Set(selCells.map((c) => c.cellType ?? 'paragraph'));
      let effectiveBlockType = 'paragraph';
      let effectiveLevel: number | undefined;
      if (cellTypeSet.size === 1) {
        const ct = [...cellTypeSet][0]!;
        if (ct === 'heading' || ct === 'heading1') {
          effectiveBlockType = 'heading';
          effectiveLevel = 1;
        } else if (ct === 'heading2') {
          effectiveBlockType = 'heading';
          effectiveLevel = 2;
        } else if (ct === 'heading3') {
          effectiveBlockType = 'heading';
          effectiveLevel = 3;
        } else if (ct === 'heading4') {
          effectiveBlockType = 'heading';
          effectiveLevel = 4;
        } else if (ct === 'heading5') {
          effectiveBlockType = 'heading';
          effectiveLevel = 5;
        } else if (ct === 'heading6') {
          effectiveBlockType = 'heading';
          effectiveLevel = 6;
        } else if (ct === 'bulletList') {
          effectiveBlockType = 'bulletList';
        } else if (ct === 'orderedList') {
          effectiveBlockType = 'orderedList';
        } else if (ct === 'todoList') {
          effectiveBlockType = 'todoList';
        } else if (ct === 'quote') {
          effectiveBlockType = 'quote';
        } else if (ct === 'codeBlock') {
          effectiveBlockType = 'codeBlock';
        }
      }

      // Effective align: if all cells have same align, use it.
      const alignSet = new Set(selCells.map((c) => c.align ?? 'left'));
      const effectiveAlign = alignSet.size === 1 ? [...alignSet][0]! : 'left';
      const effectiveBlockAttrs: Record<string, unknown> = { align: effectiveAlign };
      // Effective verticalAlign: if all cells have same verticalAlign, use it.
      const verticalAlignSet = new Set(selCells.map((c) => c.verticalAlign ?? 'middle'));
      const effectiveVerticalAlign = verticalAlignSet.size === 1 ? [...verticalAlignSet][0]! : 'middle';
      effectiveBlockAttrs.verticalAlign = effectiveVerticalAlign;
      if (effectiveLevel !== undefined) effectiveBlockAttrs.level = effectiveLevel;

      // Effective marks: for each mark type, active only if ALL text runs
      // in ALL selected cells have it.
      const BASIC_MARKS = ['bold', 'italic', 'underline', 'strikethrough', 'code'] as const;
      const effectiveMarks = new Set<string>();
      for (const markType of BASIC_MARKS) {
        let allHave = true;
        let hasText = false;
        for (const cell of selCells) {
          for (const node of cell.content) {
            if (node.type !== 'text') continue;
            hasText = true;
            if (!node.marks?.some((m) => m.type === markType)) {
              allHave = false;
              break;
            }
          }
          if (!allHave) break;
        }
        if (hasText && allHave) effectiveMarks.add(markType);
      }

      // Effective text color: if all text runs have the same color mark.
      const textColorSet = new Set<string>();
      for (const cell of selCells) {
        for (const node of cell.content) {
          if (node.type !== 'text') continue;
          const colorMark = node.marks?.find((m) => m.type === 'color');
          const cKey = colorMark?.attrs?.color;
          if (typeof cKey === 'string') textColorSet.add(cKey);
        }
      }
      const effectiveTextColor = textColorSet.size === 1 ? [...textColorSet][0]! : '';

      // Effective bg color: if all cells have the same bgColor.
      const bgColorSet = new Set(selCells.map((c) => c.bgColor ?? ''));
      const effectiveBgColor = bgColorSet.size === 1 ? [...bgColorSet][0]! : '';

      // --- Update cached toolbar state only when there is a REAL
      // (non-empty) selection AND we're not in the middle of a selection
      // switch (where the rect hasn't moved to the new position yet).
      // During a switch, the cache stays frozen at the OLD state so the
      // toolbar at the OLD position doesn't flash the NEW state. Once
      // showToolbar() applies the new rect, isSwitchingSelection becomes
      // false and the cache updates in the same render cycle.
      const hasRealSelection
        = tsel.kind === 'row' || tsel.kind === 'col' || tsel.kind === 'all' || selCells.length > 0;
      if (hasRealSelection && !isSwitchingSelection) {
        cachedTbState.blockType = effectiveBlockType;
        // shallow-copy attrs to keep cache value stable across renders.
        cachedTbState.blockAttrs = { ...effectiveBlockAttrs };
        // Sync the Set contents.
        cachedTbState.marks.clear();
        for (const m of effectiveMarks) cachedTbState.marks.add(m);
        cachedTbState.textColor = effectiveTextColor;
        cachedTbState.bgColor = effectiveBgColor;
        cachedTbState.verticalAlign = effectiveVerticalAlign;
        cachedTbState.showDelete = showingDelete;
        cachedTbState.deleteLabel = deleteLabel;
        cachedTbState.deleteIcon = deleteIcon;
        cachedTbState.showMerge = showingMerge;
        cachedTbState.showSplit = showingSplit;
        // Header-row toggle is only exposed when the whole table is selected
        // (via corner-handle). The active state mirrors the table's headerRow flag.
        cachedTbState.showHeaderRow = tsel.kind === 'all';
        cachedTbState.headerRowActive = !!tattrs.value.headerRow;
      }

      const tableTypeHandler = (cellType: string) => {
        const positions = getSelectedPositions();
        if (positions.length === 0) return;
        const next = setCellsAttrs(tattrs.value, positions, { cellType });
        editor.commands.setAttrs?.({ id: blockId, attrs: next as unknown as Attrs });
      };
      const tableAlignHandler = (align: string) => {
        const positions = getSelectedPositions();
        if (positions.length === 0) return;
        const next = setCellsAttrs(tattrs.value, positions, { align });
        editor.commands.setAttrs?.({ id: blockId, attrs: next as unknown as Attrs });
      };
      const tableVerticalAlignHandler = (verticalAlign: string) => {
        const positions = getSelectedPositions();
        if (positions.length === 0) return;
        const next = setCellsAttrs(tattrs.value, positions, { verticalAlign });
        editor.commands.setAttrs?.({ id: blockId, attrs: next as unknown as Attrs });
      };
      const tableMarkHandler = (markType: string) => {
        const positions = getSelectedPositions();
        if (positions.length === 0) return;
        const next = toggleCellsMark(tattrs.value, positions, markType);
        editor.commands.setAttrs?.({ id: blockId, attrs: next as unknown as Attrs });
      };
      const tableTextColorHandler = (color: string | null) => {
        const positions = getSelectedPositions();
        if (positions.length === 0) return;
        const next = setCellsMark(tattrs.value, positions, 'color', color ? { color } : null);
        editor.commands.setAttrs?.({ id: blockId, attrs: next as unknown as Attrs });
      };
      const tableBgColorHandler = (color: string | null) => {
        const positions = getSelectedPositions();
        if (positions.length === 0) return;
        const next = setCellsAttrs(tattrs.value, positions, { bgColor: color ?? 'default' });
        editor.commands.setAttrs?.({ id: blockId, attrs: next as unknown as Attrs });
      };
      const tableCopyHandler = () => {
        const rect = selectionRect(cellSel.value);
        if (!rect) return;
        const lines: string[] = [];
        for (let r = rect.r1; r <= rect.r2; r++) {
          const parts: string[] = [];
          for (let c = rect.c1; c <= rect.c2; c++) {
            const cell = tattrs.value.cells[r]?.[c];
            if (cell && !cell.covered) {
              parts.push(cell.content.map((n) => (n.type === 'text' ? n.text : '')).join(''));
            } else {
              parts.push('');
            }
          }
          lines.push(parts.join('\t'));
        }
        const text = lines.join('\n');
        if (text) {
          void navigator.clipboard?.writeText(text);
        }
      };

      children.push(
        h(HoverToolbar, {
          visible: !!selRect,
          selectionRect: selRect,
          blockId: blockId as BlockId,
          // Use the cached (snapshot) state for props. When selection is
          // cleared mid-animation, the cache keeps the last valid state so
          // the toolbar doesn't flash "paragraph / left-aligned / empty"
          // before its fade-out completes.
          blockType: cachedTbState.blockType,
          blockAttrs: cachedTbState.blockAttrs,
          rootEl: document.querySelector('.block-editor') as HTMLElement | null,
          tableMode: true,
          tableActiveMarks: cachedTbState.marks,
          tableActiveColor: cachedTbState.textColor,
          tableActiveBgColor: cachedTbState.bgColor,
          tableActiveVerticalAlign: cachedTbState.verticalAlign,
          showDelete: cachedTbState.showDelete,
          deleteLabel: cachedTbState.deleteLabel,
          deleteIcon: cachedTbState.deleteIcon,
          showMerge: cachedTbState.showMerge,
          showSplit: cachedTbState.showSplit,
          showHeaderRow: cachedTbState.showHeaderRow,
          headerRowActive: cachedTbState.headerRowActive,
          onDelete: deleteHandler,
          onMerge: mergeHandler,
          onSplit: splitHandler,
          onTableHeaderRow: headerRowHandler,
          onClose: closeHandler,
          onTableType: tableTypeHandler,
          onTableAlign: tableAlignHandler,
          onTableVerticalAlign: tableVerticalAlignHandler,
          onTableMark: tableMarkHandler,
          onTableTextColor: tableTextColorHandler,
          onTableBgColor: tableBgColorHandler,
          onTableCopy: tableCopyHandler,
        }),
      );

      // Cell text editing toolbar (non-tableMode, uses execCommand).
      // Always render — the `visible` prop controls CSS fade animations.
      const fc = focusedCell.value;
      const focusedCellData = fc ? tattrs.value.cells[fc.row]?.[fc.col] : undefined;
      // Map cell type to block-level type + level for the toolbar.
      const fct = focusedCellData?.cellType;
      let cellBlockType = 'paragraph';
      const cellBlockAttrs: Record<string, unknown> = {};
      if (fct === 'heading' || fct === 'heading1') {
        cellBlockType = 'heading';
        cellBlockAttrs.level = 1;
      } else if (fct === 'heading2') {
        cellBlockType = 'heading';
        cellBlockAttrs.level = 2;
      } else if (fct === 'heading3') {
        cellBlockType = 'heading';
        cellBlockAttrs.level = 3;
      } else if (fct === 'heading4') {
        cellBlockType = 'heading';
        cellBlockAttrs.level = 4;
      } else if (fct === 'heading5') {
        cellBlockType = 'heading';
        cellBlockAttrs.level = 5;
      } else if (fct === 'heading6') {
        cellBlockType = 'heading';
        cellBlockAttrs.level = 6;
      } else if (fct === 'bulletList') {
        cellBlockType = 'bulletList';
      } else if (fct === 'orderedList') {
        cellBlockType = 'orderedList';
      } else if (fct === 'todoList') {
        cellBlockType = 'todoList';
      } else if (fct === 'quote') {
        cellBlockType = 'quote';
      } else if (fct === 'codeBlock') {
        cellBlockType = 'codeBlock';
      }
      if (typeof focusedCellData?.align === 'string') {
        cellBlockAttrs.align = focusedCellData.align;
      }
      if (typeof focusedCellData?.verticalAlign === 'string') {
        cellBlockAttrs.verticalAlign = focusedCellData.verticalAlign;
      }
      children.push(
        h(HoverToolbar, {
          visible: cellTextToolbar.visible && !!cellTextToolbar.selectionRect,
          selectionRect: cellTextToolbar.selectionRect,
          blockId: blockId as BlockId,
          blockType: cellBlockType,
          blockAttrs: cellBlockAttrs,
          rootEl: document.querySelector('.block-editor') as HTMLElement | null,
          cellEditMode: true,
          onClose: () => {
            cellTextToolbar.visible = false;
            cellTextToolbar.selectionRect = null;
          },
          onTableType: (cellType: string) => {
            if (!fc) return;
            const next = setCellsAttrs(tattrs.value, [{ row: fc.row, col: fc.col }], { cellType });
            editor.commands.setAttrs?.({ id: blockId, attrs: next as unknown as Attrs });
          },
          onTableAlign: (align: string) => {
            if (!fc) return;
            const next = setCellsAttrs(tattrs.value, [{ row: fc.row, col: fc.col }], { align });
            editor.commands.setAttrs?.({ id: blockId, attrs: next as unknown as Attrs });
          },
          onTableVerticalAlign: (verticalAlign: string) => {
            if (!fc) return;
            const next = setCellsAttrs(tattrs.value, [{ row: fc.row, col: fc.col }], { verticalAlign });
            editor.commands.setAttrs?.({ id: blockId, attrs: next as unknown as Attrs });
          },
          onLinkClick: () => {
            openCellLinkPopover();
          },
        }),
      );

      // Link popover for cell edit mode.
      children.push(
        h(LinkPopover, {
          visible: cellLinkPopover.visible,
          anchorRect: cellLinkPopover.anchorRect,
          blockId: null,
          from: 0,
          to: 0,
          href: cellLinkPopover.href,
          text: cellLinkPopover.text,
          initialMode: cellLinkPopover.initialMode,
          showTextInput: cellLinkPopover.showTextInput,
          readonly: !editable.value,
          onSaveLink: (url: string, text: string | undefined) => {
            onCellLinkSave(url, text);
            // Update popover state so view mode shows the new URL.
            cellLinkPopover.href = url;
            if (text !== undefined) cellLinkPopover.text = text;
          },
          onRemoveLinkMark: () => {
            onCellLinkRemove();
          },
          onClose: () => {
            closeCellLinkPopover();
          },
        }),
      );

      // Ordered-list menu (shown when user clicks the number marker of an
      // ordered-list cell). The `block-id` prop is typed as BlockId | null,
      // but OrderedListMenu only uses it to emit events — the actual cell
      // mutation goes through setCellAttrs which uses (row, col). Pass null.
      children.push(
        h(OrderedListMenu, {
          visible: tableOlMenu.visible,
          blockId: null,
          anchor: tableOlMenu.anchor,
          rootEl: document.querySelector('.block-editor') as HTMLElement | null,
          canContinue: tableOlMenu.canContinue,
          canStartNew: tableOlMenu.canStartNew,
          currentNumber: tableOlMenu.currentNumber,
          onContinue: onTableOlContinue,
          onStartNew: onTableOlStartNew,
          onModify: onTableOlModify,
          onClose: closeTableOlMenu,
        }),
      );

      // Number value picker for "modify number" in ordered-list cells.
      children.push(
        h(NumberPicker, {
          visible: tableNumberPicker.visible,
          initialValue: tableNumberPicker.initialValue,
          anchor: tableNumberPicker.anchor,
          rootEl: document.querySelector('.block-editor') as HTMLElement | null,
          onConfirm: onTableNumberPickerConfirm,
          onClose: closeTableNumberPicker,
        }),
      );

      return h(
        'div',
        {
          class: 'block-table-container',
          ref: containerRef,
          tabindex: '-1',
          onClick: onSelectBlock,
          onMousedown: onContainerMouseDown,
          onMouseover: onContainerMouseOver,
          onDblclick: onContainerDblClick,
          onFocusout: onContainerFocusOut,
          onKeydown: onContainerKeyDown,
        },
        children,
      );
    };
  },
});

// --- Helpers: cell navigation ----------------------------------------------

type Pos = { r: number; c: number };

function nextCellPos(attrs: TableAttrs, r: number, c: number, reverse: boolean): Pos | null {
  // Build a flat order of non-covered cells.
  const order: Pos[] = [];
  for (let rr = 0; rr < attrs.rows; rr++) {
    for (let cc = 0; cc < attrs.cols; cc++) {
      const cell = attrs.cells[rr]?.[cc];
      if (cell && !cell.covered) order.push({ r: rr, c: cc });
    }
  }
  const idx = order.findIndex((p) => p.r === r && p.c === c);
  if (idx === -1) return null;
  if (reverse) {
    if (idx === 0) return null;
    return order[idx - 1] ?? null;
  }
  if (idx === order.length - 1) return null;
  return order[idx + 1] ?? null;
}

function isLastCell(attrs: TableAttrs, r: number, c: number): boolean {
  let last: Pos | null = null;
  for (let rr = 0; rr < attrs.rows; rr++) {
    for (let cc = 0; cc < attrs.cols; cc++) {
      const cell = attrs.cells[rr]?.[cc];
      if (cell && !cell.covered) last = { r: rr, c: cc };
    }
  }
  return last !== null && last.r === r && last.c === c;
}

function placeCaretAtEnd(el?: HTMLElement | null): void {
  if (!el) return;
  el.focus();
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}
function placeCaretAtStart(el?: HTMLElement | null): void {
  if (!el) return;
  el.focus();
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(true);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

function selectionRect(sel: CellSel): { r1: number; c1: number; r2: number; c2: number } | null {
  if (!sel) return null;
  const a = sel.anchor;
  const f = sel.focus;
  const r1 = Math.min(a.row, f.row);
  const r2 = Math.max(a.row, f.row);
  const c1 = Math.min(a.col, f.col);
  const c2 = Math.max(a.col, f.col);
  return { r1, c1, r2, c2 };
}

function withinRect(r: number, c: number, rect: { r1: number; c1: number; r2: number; c2: number }): boolean {
  return r >= rect.r1 && r <= rect.r2 && c >= rect.c1 && c <= rect.c2;
}

// ---------------------------------------------------------------------------
// Command argument types
// ---------------------------------------------------------------------------

export interface TableInsertRowArgs {
  readonly id: BlockId;
  readonly beforeRow?: number;
}
export interface TableRemoveRowArgs {
  readonly id: BlockId;
  readonly row?: number;
}
export interface TableInsertColArgs {
  readonly id: BlockId;
  readonly beforeCol?: number;
}
export interface TableRemoveColArgs {
  readonly id: BlockId;
  readonly col?: number;
}
export interface TableToggleHeaderArgs {
  readonly id: BlockId;
}
export interface TableMergeCellsArgs {
  readonly id: BlockId;
  readonly r1: number;
  readonly c1: number;
  readonly r2: number;
  readonly c2: number;
}
export interface TableSplitCellArgs {
  readonly id: BlockId;
  readonly row: number;
  readonly col: number;
}
export interface TableSplitCellsInRectArgs {
  readonly id: BlockId;
  readonly r1: number;
  readonly c1: number;
  readonly r2: number;
  readonly c2: number;
}
export interface TableSetColWidthArgs {
  readonly id: BlockId;
  readonly col: number;
  readonly width: number;
}
export interface TableDeleteArgs {
  readonly id: BlockId;
}
export interface InsertTableArgs {
  readonly rows?: number;
  readonly cols?: number;
  readonly after?: BlockId;
  readonly replaceCurrent?: boolean;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function currentCellOfSelection(
  state: EditorState,
  id: BlockId,
): { row: number; col: number } | null {
  void state;
  void id;
  return null;
}

function withAttrs(
  state: EditorState,
  id: BlockId,
  dispatch: Dispatch | undefined,
  mutate: (a: TableAttrs) => TableAttrs,
): boolean {
  const block = state.doc.blocks.get(id);
  if (!block) return false;
  if (block.type !== 'table') return false;
  const cur = coerceTableAttrs(block.attrs as unknown as Record<string, unknown>);
  const next = mutate(cur);
  const builder = createTransaction();
  builder.setAttrs(id, next as unknown as Attrs);
  dispatch?.(builder.build());
  return true;
}

function tableInsertRowCommand(): CommandEntry<TableInsertRowArgs> {
  return {
    name: 'tableInsertRow',
    run: (args) => (state, dispatch) => {
      const block = state.doc.blocks.get(args.id);
      if (!block || block.type !== 'table') return false;
      const cur = attrsToTable(block.attrs as unknown as Record<string, JSONValue>);
      const focus = currentCellOfSelection(state, args.id);
      const beforeRow = args.beforeRow ?? (focus ? focus.row + 1 : cur.rows);
      return withAttrs(state, args.id, dispatch, (a) => insertRow(a, beforeRow));
    },
  };
}

function tableRemoveRowCommand(): CommandEntry<TableRemoveRowArgs> {
  return {
    name: 'tableRemoveRow',
    run: (args) => (state, dispatch) => {
      const block = state.doc.blocks.get(args.id);
      if (!block || block.type !== 'table') return false;
      const cur = attrsToTable(block.attrs as unknown as Record<string, JSONValue>);
      const focus = currentCellOfSelection(state, args.id);
      const row = args.row ?? (focus ? focus.row : cur.rows - 1);
      return withAttrs(state, args.id, dispatch, (a) => removeRow(a, row));
    },
  };
}

function tableInsertColCommand(): CommandEntry<TableInsertColArgs> {
  return {
    name: 'tableInsertCol',
    run: (args) => (state, dispatch) => {
      const block = state.doc.blocks.get(args.id);
      if (!block || block.type !== 'table') return false;
      const cur = attrsToTable(block.attrs as unknown as Record<string, JSONValue>);
      const focus = currentCellOfSelection(state, args.id);
      const beforeCol = args.beforeCol ?? (focus ? focus.col + 1 : cur.cols);
      return withAttrs(state, args.id, dispatch, (a) => insertCol(a, beforeCol));
    },
  };
}

function tableRemoveColCommand(): CommandEntry<TableRemoveColArgs> {
  return {
    name: 'tableRemoveCol',
    run: (args) => (state, dispatch) => {
      const block = state.doc.blocks.get(args.id);
      if (!block || block.type !== 'table') return false;
      const cur = attrsToTable(block.attrs as unknown as Record<string, JSONValue>);
      const focus = currentCellOfSelection(state, args.id);
      const col = args.col ?? (focus ? focus.col : cur.cols - 1);
      return withAttrs(state, args.id, dispatch, (a) => removeCol(a, col));
    },
  };
}

function tableToggleHeaderRowCommand(): CommandEntry<TableToggleHeaderArgs> {
  return {
    name: 'tableToggleHeaderRow',
    run: (args) => (state, dispatch) => {
      const block = state.doc.blocks.get(args.id);
      if (!block || block.type !== 'table') return false;
      return withAttrs(state, args.id, dispatch, toggleHeaderRow);
    },
  };
}

function tableMergeCellsCommand(): CommandEntry<Partial<TableMergeCellsArgs> & { id: BlockId }> {
  return {
    name: 'tableMergeCells',
    run: (args) => (state, dispatch) => {
      const block = state.doc.blocks.get(args.id);
      if (!block || block.type !== 'table') return false;
      const cur = attrsToTable(block.attrs as unknown as Record<string, JSONValue>);
      const focus = currentCellOfSelection(state, args.id);
      const rawR1 = args.r1 ?? (focus ? focus.row : 0);
      const rawC1 = args.c1 ?? (focus ? focus.col : 0);
      let rawR2 = args.r2 ?? (focus ? focus.row : 0);
      let rawC2 = args.c2 ?? (focus ? focus.col : 0);
      if (rawR1 === rawR2 && rawC1 === rawC2) {
        if (rawR2 + 1 < cur.rows) rawR2 = rawR1 + 1;
        if (rawC2 + 1 < cur.cols) rawC2 = rawC1 + 1;
        if (rawR1 === rawR2 && rawC1 === rawC2) return false;
      }
      // CRITICAL invariant: the selection must always be expanded to a closed
      // rectangle over merged-cell footprints before merge runs. This ensures
      // we never merge from a "half-selected merged cell" state that would
      // leave stray covered cells and break the table structure.
      const closed = expandSelectionToFullRect(cur, rawR1, rawC1, rawR2, rawC2);
      // After closing, a 1x1 rect cannot be merged — bail out.
      if (closed.r1 === closed.r2 && closed.c1 === closed.c2) return false;
      return withAttrs(state, args.id, dispatch,
        (a) => mergeRect(a, closed.r1, closed.c1, closed.r2, closed.c2));
    },
  };
}

function tableSplitCellCommand(): CommandEntry<TableSplitCellArgs> {
  return {
    name: 'tableSplitCell',
    run: (args) => (state, dispatch) => {
      const block = state.doc.blocks.get(args.id);
      if (!block || block.type !== 'table') return false;
      return withAttrs(state, args.id, dispatch, (a) => splitCell(a, args.row, args.col));
    },
  };
}

/** Split ALL merged cells inside an (expanded) rectangle. This is the
 *  command dispatched by the toolbar "Split cells" button when the user has
 *  a multi-cell selection that includes merges. The expansion is applied
 *  defensively here too, so API callers don't have to remember it. */
function tableSplitCellsInRectCommand(): CommandEntry<TableSplitCellsInRectArgs> {
  return {
    name: 'tableSplitCellsInRect',
    run: (args) => (state, dispatch) => {
      const block = state.doc.blocks.get(args.id);
      if (!block || block.type !== 'table') return false;
      const cur = attrsToTable(block.attrs as unknown as Record<string, JSONValue>);
      const closed = expandSelectionToFullRect(cur, args.r1, args.c1, args.r2, args.c2);
      if (!rectContainsMergedCells(cur, closed.r1, closed.c1, closed.r2, closed.c2)) {
        return false; // Nothing to split — bail out (keeps undo stack clean).
      }
      return withAttrs(state, args.id, dispatch,
        (a) => splitCellsInRect(a, closed.r1, closed.c1, closed.r2, closed.c2));
    },
  };
}

function tableSetColWidthCommand(): CommandEntry<TableSetColWidthArgs> {
  return {
    name: 'tableSetColWidth',
    run: (args) => (state, dispatch) => {
      const block = state.doc.blocks.get(args.id);
      if (!block || block.type !== 'table') return false;
      return withAttrs(state, args.id, dispatch, (a) => setColWidth(a, args.col, args.width));
    },
  };
}

function tableDeleteCommand(): CommandEntry<TableDeleteArgs> {
  return {
    name: 'tableDelete',
    run: (args) => (state, dispatch) => {
      const block = state.doc.blocks.get(args.id);
      if (!block || block.type !== 'table') return false;
      const builder = createTransaction();
      builder.removeBlock(args.id);
      dispatch?.(builder.build());
      return true;
    },
  };
}

function insertTableCommand(): CommandEntry<InsertTableArgs> {
  return {
    name: 'insertTable',
    run: (args) => (state, dispatch) => {
      const rowsInput = args.rows ?? 3;
      const colsInput = args.cols ?? 3;
      const rows = Math.max(1, Math.min(50, Number.isInteger(rowsInput) ? rowsInput : 3));
      const cols = Math.max(1, Math.min(20, Number.isInteger(colsInput) ? colsInput : 3));

      const empty = buildEmptyCells(rows, cols);
      const initAttrs: TableAttrs = {
        rows,
        cols,
        cells: recomputeCovered(empty, rows, cols),
        // Default column width: 120px gives newly-created tables a
        // reasonable visible width instead of collapsing to 0.
        colWidths: new Array(cols).fill(120),
        // New tables default to having a header row.
        headerRow: true,
      };
      const typedAttrs = initAttrs as unknown as Attrs;

      let parent: BlockId | null = null;
      let index = state.doc.root.length;
      let replaceId: BlockId | null = null;

      if (args.replaceCurrent) {
        const sel = state.selection;
        const primary = sel.kind === 'caret'
          ? sel.blockId
          : sel.kind === 'text'
            ? sel.focus.blockId
            : sel.blockIds[0] ?? null;
        if (primary) replaceId = primary;
      }
      if (replaceId) {
        const b = state.doc.blocks.get(replaceId);
        if (b) {
          parent = parentOf(state.doc, replaceId);
          index = indexOf(state.doc, replaceId);
        } else replaceId = null;
      }
      if (!replaceId) {
        if (args.after) {
          const after = state.doc.blocks.get(args.after);
          if (!after) return false;
          parent = parentOf(state.doc, args.after);
          index = indexOf(state.doc, args.after) + 1;
        } else {
          const sel = state.selection;
          const primary = sel.kind === 'caret'
            ? sel.blockId
            : sel.kind === 'text'
              ? sel.focus.blockId
              : sel.blockIds[0] ?? null;
          if (primary) {
            parent = parentOf(state.doc, primary);
            index = indexOf(state.doc, primary) + 1;
          }
        }
      }

      const builder = createTransaction();
      if (replaceId) builder.removeBlock(replaceId);
      const id = builder.insertBlock({
        parent,
        index,
        type: 'table' as BlockType,
        attrs: typedAttrs,
        content: [],
      });
      // Post-insert selection: pick adjacent non-table block so caret lands in
      // an editable contenteditable (tables have content:none).
      const temp = applySteps(state.doc, builder.peek());
      const after = blockAfter(temp.doc, id);
      const before = blockBefore(temp.doc, id);
      const target = after ?? before;
      if (target) builder.setSelection(caretSelection(target.id, 0));
      else builder.setSelection(caretSelection(id, 0));
      dispatch?.(builder.build());
      return true;
    },
  };
}

/** Build all table commands. The registry context is accepted for parity with
 *  other factories but currently unused — kept for future callers that need
 *  schema-level coordination. */
export function createTableCommands(
  _registries: EditorRegistries,
): AnyCommandEntry[] {
  void _registries;
  return [
    tableInsertRowCommand(),
    tableRemoveRowCommand(),
    tableInsertColCommand(),
    tableRemoveColCommand(),
    tableToggleHeaderRowCommand(),
    tableMergeCellsCommand(),
    tableSplitCellCommand(),
    tableSplitCellsInRectCommand(),
    tableSetColWidthCommand(),
    tableDeleteCommand(),
    insertTableCommand(),
  ];
}

// ---------------------------------------------------------------------------
// Extension spec
// ---------------------------------------------------------------------------

export const TableExtension: Extension = {
  name: 'table',
  schema: {
    type: 'table',
    content: 'none',
    nestable: false,
    isolating: true,
    inlineMarks: false,
    attrs: { ...TABLE_ATTRS },
    empty: (block: Block): boolean => {
      const t = coerceTableAttrs(block.attrs as unknown as Record<string, unknown>);
      for (let r = 0; r < t.rows; r++) {
        for (let c = 0; c < t.cols; c++) {
          const cell = t.cells[r]?.[c];
          if (!cell || cell.covered) continue;
          for (const run of cell.content) {
            if (run.type === 'text' && run.text.length > 0) return false;
          }
        }
      }
      return true;
    },
  },
  renderer: { component: TableBlock, editable: false },
  commands: [
    tableInsertRowCommand(),
    tableRemoveRowCommand(),
    tableInsertColCommand(),
    tableRemoveColCommand(),
    tableToggleHeaderRowCommand(),
    tableMergeCellsCommand(),
    tableSplitCellCommand(),
    tableSplitCellsInRectCommand(),
    tableSetColWidthCommand(),
    tableDeleteCommand(),
    insertTableCommand(),
  ],
  slashCommands: [
    {
      id: 'table-3x3',
      title: 'slash.table3x3.title',
      keywords: ['table', 'grid', 'spreadsheet', '表格', '数据表', '网格'],
      description: 'slash.table3x3.description',
      icon: ICON_TABLE,
      command: 'insertTable',
      category: 'other',
      args: (): unknown => ({ rows: 3, cols: 3, replaceCurrent: true }),
    },
    {
      id: 'table-2x2',
      title: 'slash.table2x2.title',
      keywords: ['table', 'grid', '表格', '2行2列'],
      description: 'slash.table2x2.description',
      icon: ICON_TABLE,
      command: 'insertTable',
      category: 'other',
      args: (): unknown => ({ rows: 2, cols: 2, replaceCurrent: true }),
    },
    {
      id: 'table-4x4',
      title: 'slash.table4x4.title',
      keywords: ['table', 'grid', '表格', '4行4列'],
      description: 'slash.table4x4.description',
      icon: ICON_TABLE,
      command: 'insertTable',
      category: 'other',
      args: (): unknown => ({ rows: 4, cols: 4, replaceCurrent: true }),
    },
  ],
  serialize: {
    toHTML: (block: Block): string => {
      if (block.type !== 'table') return '';
      const t = coerceTableAttrs(block.attrs as unknown as Record<string, unknown>);
      return tableToHtml(t);
    },
    toMarkdown: (block: Block): string => {
      if (block.type !== 'table') return '';
      const t = coerceTableAttrs(block.attrs as unknown as Record<string, unknown>);
      return tableToMarkdown(t);
    },
  },
};

// Icons exported so the toolbar / settings menu can reuse them.
export const TABLE_ICONS = {
  ICON_TABLE,
  ICON_ROW_ABOVE,
  ICON_ROW_BELOW,
  ICON_COL_LEFT,
  ICON_COL_RIGHT,
  ICON_DEL_ROW,
  ICON_DEL_COL,
  ICON_MERGE,
  ICON_SPLIT,
  ICON_HEADER,
  ICON_DELETE_TABLE,
};
