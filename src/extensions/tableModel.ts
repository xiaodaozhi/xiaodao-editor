/**
 * Table block data structures (stored in block attrs).
 *
 * We use the "attrs storage" pattern exactly like the Image extension — the
 * table block declares `content: 'none'` so the editor core never looks at
 * inline text for this block. Everything (cells, row count, column count,
 * header flag, merged cells, column widths) lives in attrs as plain JSON
 * values. This guarantees:
 *
 *   - JSON serialize/deserialize is a no-op (attrs already round-trip via
 *     the core's standard `docFromData` / `docToData`).
 *   - Undo/redo works out of the box: any mutation goes through the typed
 *     `editor.commands.setAttrs` primitive which wraps the change in a
 *     transaction (the same primitive used by image resize, code-block
 *     language switch, etc.).
 *   - The existing clipboard copy/paste of full blocks ("copy block" from
 *     handle menu) works transparently because it copies attrs verbatim.
 *
 * The model is intentionally minimal:
 *   - rows/cols define the logical grid dimensions.
 *   - `cells[i]` stores the i-th row's cells, so the grid is
 *     `cells[row][col]`. Every logical cell is explicitly present (even
 *     cells covered by a rowspan/colspan span — their `covered` flag is
 *     true). Rendering, serialization and structural operations always
 *     iterate rows × cols so we never get out-of-sync.
 *   - `colWidths` stores per-column widths in CSS pixels. 0 means
 *     "auto / not yet set" (renderer then uses `table-layout: auto`).
 *   - `headerRow` = when true, the first row renders as <thead> with
 *     bold styling + a different background.
 */

import type { InlineNode, InlineSeq, JSONValue } from '../core/types';
import { inlineFromDom } from '../view/inlineDom';
import { sanitizeUrl } from '../view/urlUtils';

// ---------------------------------------------------------------------------
// Cell-level validation constants
// ---------------------------------------------------------------------------

/** Valid cell types for table cells. */
const VALID_CELL_TYPES: readonly string[] = [
  'paragraph', 'heading', 'heading1', 'heading2', 'heading3',
  'heading4', 'heading5', 'heading6',
  'bulletList', 'orderedList', 'todoList', 'quote', 'codeBlock',
];

/** Cell types that support the `checked` flag (todoList only). */
const CHECKED_CELL_TYPES: readonly string[] = ['todoList'];

/** Cell types that support the `startNumber` flag (orderedList only). */
const START_NUMBER_CELL_TYPES: readonly string[] = ['orderedList'];

/** Valid alignment values for table cells. Note: 'justify' is excluded
 *  because table cells are too narrow for justified text to look good. */
const VALID_CELL_ALIGN: readonly string[] = ['left', 'center', 'right'];

/** Valid vertical alignment values for table cells. */
const VALID_CELL_VERTICAL_ALIGN: readonly string[] = ['top', 'middle', 'bottom'];

/** Valid background color keys (from BG_COLOR_PRESETS in _commonAttrs.ts). */
const VALID_CELL_BG_COLORS: readonly string[] = [
  'gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red',
];

/** Marks that are incompatible with inline code — mirrors the
 *  CODE_INCOMPATIBLE list in primitiveCommands.ts. When a text run has
 *  the `code` mark, all of these must be stripped. */
const CODE_INCOMPATIBLE_MARKS: readonly string[] = [
  'bold', 'italic', 'underline', 'strikethrough', 'color', 'bgColor', 'link',
];

/** All valid mark types recognized by the editor. Marks not in this set
 *  are silently dropped during cell content sanitization. */
const VALID_MARK_TYPES: readonly string[] = [
  'bold', 'italic', 'underline', 'strikethrough', 'code', 'link', 'color', 'bgColor',
];

// ---------------------------------------------------------------------------
// Cell model
// ---------------------------------------------------------------------------

export interface TableCellData {
  /** Cell content — reuses the editor's InlineSeq so rich inline marks
   *  (bold/italic/link/code) are first-class inside cells. */
  readonly content: InlineSeq;
  /** How many rows this cell spans (≥ 1). 1 = no row span. */
  readonly rowspan: number;
  /** How many columns this cell spans (≥ 1). 1 = no column span. */
  readonly colspan: number;
  /**
   * True when this logical (row,col) position is *covered* by a merged
   * cell anchored at an earlier position. Covered cells carry no content
   * and renderers must emit no DOM for them.
   */
  readonly covered: boolean;
  /** Cell text type: 'paragraph' (default), 'heading'. Controls how cell text is styled. */
  readonly cellType?: string;
  /** Cell text alignment: 'left' (default), 'center', 'right'. */
  readonly align?: string;
  /** Cell vertical alignment: 'top', 'middle' (default), 'bottom'. */
  readonly verticalAlign?: string;
  /** Cell background color key (e.g. 'red', 'blue', or undefined for none). */
  readonly bgColor?: string;
  /** Todo-list cell checkbox state. Only meaningful when cellType === 'todoList'. */
  readonly checked?: boolean;
  /** Ordered-list cell explicit start number (≥ 1). Only meaningful when
   *  cellType === 'orderedList'. When set, overrides auto-continuation. */
  readonly startNumber?: number;
}

/** Internal mutable variant used during pure structural operations. */
type MutableCell = {
  content: InlineNode[];
  rowspan: number;
  colspan: number;
  covered: boolean;
  cellType?: string;
  align?: string;
  verticalAlign?: string;
  bgColor?: string;
  checked?: boolean;
  startNumber?: number;
};

function makeEmptyCell(): MutableCell {
  return { content: [], rowspan: 1, colspan: 1, covered: false };
}

/**
 * Sanitize an InlineSeq for table cell storage. Applies the same rules
 * as the editor core's mark validation:
 *
 *   1. Drop marks with unknown types (not in VALID_MARK_TYPES).
 *   2. Inline code is incompatible with other formatting marks: if a text
 *      run has the `code` mark, strip all CODE_INCOMPATIBLE_MARKS from it
 *      (code wins, mirroring primitiveCommands.ts behavior).
 *   3. Link marks with an invalid/dangerous href are dropped (sanitizeUrl).
 *   4. Cell-type restrictions (mirroring text-block disallowedMarks):
 *      - codeBlock cells: no inline marks at all (plain text only).
 *      - quote cells: no italic (the quote style itself is italic).
 *
 * Returns a new InlineSeq — the input is not mutated.
 */
function sanitizeCellContent(seq: InlineSeq, cellType?: string): InlineNode[] {
  const isCodeBlockCell = cellType === 'codeBlock';
  const isQuoteCell = cellType === 'quote';
  const out: InlineNode[] = [];
  for (const node of seq) {
    if (node.type !== 'text') {
      out.push({ ...node });
      continue;
    }
    // codeBlock cells: strip ALL marks (plain text only).
    if (isCodeBlockCell) {
      out.push({ type: 'text', text: node.text });
      continue;
    }
    let marks = node.marks ? node.marks.filter((m) => VALID_MARK_TYPES.includes(m.type)) : undefined;
    if (marks && marks.some((m) => m.type === 'code')) {
      // Inline code present: strip all incompatible marks, keep code.
      marks = marks.filter((m) => m.type === 'code' || !CODE_INCOMPATIBLE_MARKS.includes(m.type));
    }
    // quote cells: strip italic (quote is already italic via CSS).
    if (isQuoteCell && marks) {
      marks = marks.filter((m) => m.type !== 'italic');
    }
    // Sanitize link marks: drop links with dangerous/empty hrefs.
    if (marks) {
      marks = marks.filter((m) => {
        if (m.type !== 'link') return true;
        const href = m.attrs?.href;
        if (typeof href !== 'string') return false;
        return sanitizeUrl(href) !== null;
      });
    }
    // Drop marks array if empty.
    if (marks && marks.length === 0) marks = undefined;
    out.push(marks ? { ...node, marks } : { type: 'text', text: node.text });
  }
  return out;
}

function cloneCell(c: TableCellData): MutableCell {
  return {
    content: c.content.map((r) => ({ ...r })),
    rowspan: c.rowspan,
    colspan: c.colspan,
    covered: c.covered,
    cellType: c.cellType,
    align: c.align,
    verticalAlign: c.verticalAlign,
    bgColor: c.bgColor,
    checked: c.checked,
    startNumber: c.startNumber,
  };
}

// ---------------------------------------------------------------------------
// Selection rect expansion — close over merged cell footprints
// ---------------------------------------------------------------------------

/**
 * Expand a selection rectangle so that it fully covers every merged cell
 * whose anchor or covered portion intersects the initial rectangle.
 *
 * The expansion iterates: on each pass, it walks the currently-included
 * logical cells, and for every (covered or anchor) cell that belongs to
 * a merged block whose anchor rectangle pokes outside the current bounds,
 * the bounds are widened to include that merged block in full. The loop
 * repeats until a pass produces no change, guaranteeing a closed rectangle.
 *
 * This implements the invariant: "the user can never select only half of a
 * merged cell". The returned rectangle is guaranteed to contain the full
 * footprint of every merged cell that originally touched the selection.
 */
export function expandSelectionToFullRect(
  attrs: TableAttrs,
  r1: number,
  c1: number,
  r2: number,
  c2: number,
): { r1: number; c1: number; r2: number; c2: number } {
  let rs = Math.max(0, Math.min(r1, r2));
  let re = Math.min(attrs.rows - 1, Math.max(r1, r2));
  let cs = Math.max(0, Math.min(c1, c2));
  let ce = Math.min(attrs.cols - 1, Math.max(c1, c2));
  let changed = true;
  while (changed) {
    changed = false;
    for (let r = rs; r <= re; r++) {
      for (let c = cs; c <= ce; c++) {
        const cell = attrs.cells[r]?.[c];
        if (!cell) continue;
        // Find the anchor cell that owns the logical (r, c) position.
        // If (r, c) is not covered, it IS the anchor. If covered, scan
        // all non-covered cells at (ar, ac) where ar <= r and ac <= c
        // to find the one whose rowspan/colspan footprint covers (r, c).
        let anchorRow = r;
        let anchorCol = c;
        if (cell.covered) {
          let found = false;
          for (let ar = r; ar >= 0 && !found; ar--) {
            for (let ac = c; ac >= 0 && !found; ac--) {
              const a = attrs.cells[ar]?.[ac];
              if (!a || a.covered) continue;
              if (ar + Math.max(1, a.rowspan) > r && ac + Math.max(1, a.colspan) > c) {
                anchorRow = ar;
                anchorCol = ac;
                found = true;
              }
            }
          }
          if (!found) continue;
        }
        const anchor = attrs.cells[anchorRow]?.[anchorCol];
        if (!anchor || anchor.covered) continue;
        const are = anchorRow + Math.max(1, anchor.rowspan) - 1;
        const ace = anchorCol + Math.max(1, anchor.colspan) - 1;
        if (rs > anchorRow) {
          rs = anchorRow;
          changed = true;
        }
        if (re < are) {
          re = are;
          changed = true;
        }
        if (cs > anchorCol) {
          cs = anchorCol;
          changed = true;
        }
        if (ce < ace) {
          ce = ace;
          changed = true;
        }
      }
    }
  }
  return { r1: rs, c1: cs, r2: re, c2: ce };
}

/**
 * Return true if the non-covered cells inside a rectangle include at least
 * one merged cell (rowspan > 1 or colspan > 1). Used by the floating
 * toolbar to decide whether to show the "Split cells" button.
 */
export function rectContainsMergedCells(
  attrs: TableAttrs,
  r1: number,
  c1: number,
  r2: number,
  c2: number,
): boolean {
  const rs = Math.max(0, Math.min(r1, r2));
  const re = Math.min(attrs.rows - 1, Math.max(r1, r2));
  const cs = Math.max(0, Math.min(c1, c2));
  const ce = Math.min(attrs.cols - 1, Math.max(c1, c2));
  for (let r = rs; r <= re; r++) {
    for (let c = cs; c <= ce; c++) {
      const cell = attrs.cells[r]?.[c];
      if (!cell || cell.covered) continue;
      if (cell.rowspan > 1 || cell.colspan > 1) return true;
    }
  }
  return false;
}

/** Count non-covered cells inside a rectangle. Used by the toolbar to
 *  distinguish single-cell vs multi-cell selection. */
export function countNonCoveredInRect(
  attrs: TableAttrs,
  r1: number,
  c1: number,
  r2: number,
  c2: number,
): number {
  const rs = Math.max(0, Math.min(r1, r2));
  const re = Math.min(attrs.rows - 1, Math.max(r1, r2));
  const cs = Math.max(0, Math.min(c1, c2));
  const ce = Math.min(attrs.cols - 1, Math.max(c1, c2));
  let n = 0;
  for (let r = rs; r <= re; r++) {
    for (let c = cs; c <= ce; c++) {
      const cell = attrs.cells[r]?.[c];
      if (cell && !cell.covered) n += 1;
    }
  }
  return n;
}

function sealCell(c: MutableCell): TableCellData {
  return {
    content: c.content,
    rowspan: c.rowspan,
    colspan: c.colspan,
    covered: c.covered,
    cellType: c.cellType,
    align: c.align,
    verticalAlign: c.verticalAlign,
    bgColor: c.bgColor,
    checked: c.checked,
    startNumber: c.startNumber,
  };
}

// ---------------------------------------------------------------------------
// Full table attrs (persisted shape)
// ---------------------------------------------------------------------------

export interface TableAttrs {
  readonly rows: number;
  readonly cols: number;
  /** cells[r][c] for all 0 ≤ r < rows, 0 ≤ c < cols. */
  readonly cells: readonly (readonly TableCellData[])[];
  readonly colWidths: readonly number[];
  readonly headerRow: boolean;
}

// --- Defaults / validation ------------------------------------------------

export const TABLE_DEFAULTS: TableAttrs = {
  rows: 3,
  cols: 3,
  cells: [],
  colWidths: [],
  headerRow: false,
};

/** Build a fresh N×M grid of empty cells with no merges. */
export function buildEmptyCells(rows: number, cols: number): TableCellData[][] {
  const grid: TableCellData[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: TableCellData[] = [];
    for (let c = 0; c < cols; c++) row.push(makeEmptyCell());
    grid.push(row);
  }
  return grid;
}

/** Validate + coerce arbitrary raw attrs into TableAttrs. Used by schema
 *  validate and by every command that reads attrs (never trust runtime
 *  user-supplied JSON without a pass through here). */
export function coerceTableAttrs(raw: Readonly<Record<string, unknown>>): TableAttrs {
  const rawRows = raw.rows;
  const rawCols = raw.cols;
  const rows = typeof rawRows === 'number' && Number.isInteger(rawRows) && rawRows >= 1 ? rawRows : 1;
  const cols = typeof rawCols === 'number' && Number.isInteger(rawCols) && rawCols >= 1 ? rawCols : 1;

  // --- colWidths ---
  let colWidths: number[] = [];
  const rawCw = raw.colWidths;
  if (Array.isArray(rawCw)) {
    for (const v of rawCw) {
      colWidths.push(typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
    }
  }
  while (colWidths.length < cols) colWidths.push(0);
  if (colWidths.length > cols) colWidths = colWidths.slice(0, cols);

  // --- headerRow ---
  const headerRow = typeof raw.headerRow === 'boolean' ? raw.headerRow : false;

  // --- cells ---
  // Reject malformed entries and fill with empty cells when short.
  let cells: TableCellData[][] = [];
  const rawCells = raw.cells;
  if (Array.isArray(rawCells)) {
    for (let r = 0; r < rows; r++) {
      const rawRow = (rawCells as unknown[])[r];
      const rowOut: TableCellData[] = [];
      if (Array.isArray(rawRow)) {
        for (let c = 0; c < cols; c++) {
          const v = rawRow[c];
          rowOut.push(coerceCell(v));
        }
      } else {
        for (let c = 0; c < cols; c++) rowOut.push(makeEmptyCell());
      }
      cells.push(rowOut);
    }
  }
  while (cells.length < rows) {
    const row: TableCellData[] = [];
    for (let c = 0; c < cols; c++) row.push(makeEmptyCell());
    cells.push(row);
  }
  if (cells.length > rows) cells = cells.slice(0, rows);

  // Rebuild covered flags — ensures merges are internally consistent even
  // if the source JSON was inconsistent.
  cells = recomputeCovered(cells, rows, cols);

  return { rows, cols, cells, colWidths, headerRow };
}

function coerceCell(v: unknown): TableCellData {
  if (!v || typeof v !== 'object') return makeEmptyCell();
  const obj = v as Record<string, unknown>;
  const rawContent = Array.isArray(obj.content) ? (obj.content as InlineSeq) : [];
  // Validate cellType — must be in VALID_CELL_TYPES. Resolve it first so
  // sanitizeCellContent can enforce cell-type-specific mark restrictions.
  const rawCellType = typeof obj.cellType === 'string' ? obj.cellType : undefined;
  const cellType = rawCellType && VALID_CELL_TYPES.includes(rawCellType) ? rawCellType : undefined;
  // Sanitize content: strip invalid marks, enforce code incompatibility,
  // sanitize link hrefs, and enforce cell-type mark restrictions.
  const content = sanitizeCellContent(rawContent, cellType);
  const rowspan = typeof obj.rowspan === 'number' && Number.isInteger(obj.rowspan) && obj.rowspan >= 1 ? obj.rowspan : 1;
  const colspan = typeof obj.colspan === 'number' && Number.isInteger(obj.colspan) && obj.colspan >= 1 ? obj.colspan : 1;
  const covered = typeof obj.covered === 'boolean' ? obj.covered : false;
  // Validate align — only 'left', 'center', 'right' (no 'justify').
  const rawAlign = typeof obj.align === 'string' ? obj.align : undefined;
  const align = rawAlign && VALID_CELL_ALIGN.includes(rawAlign) ? rawAlign : undefined;
  // Validate verticalAlign — only 'top', 'middle', 'bottom'.
  const rawVerticalAlign = typeof obj.verticalAlign === 'string' ? obj.verticalAlign : undefined;
  const verticalAlign = rawVerticalAlign && VALID_CELL_VERTICAL_ALIGN.includes(rawVerticalAlign) ? rawVerticalAlign : undefined;
  // Validate bgColor — must be a known preset key.
  const rawBgColor = typeof obj.bgColor === 'string' ? obj.bgColor : undefined;
  const bgColor = rawBgColor && VALID_CELL_BG_COLORS.includes(rawBgColor) ? rawBgColor : undefined;
  // Validate checked — only meaningful for todoList cells.
  const rawChecked = typeof obj.checked === 'boolean' ? obj.checked : false;
  const checked = cellType && CHECKED_CELL_TYPES.includes(cellType) ? rawChecked : undefined;
  // Validate startNumber — only meaningful for orderedList cells (≥ 1).
  const rawStartNumber = typeof obj.startNumber === 'number' && Number.isInteger(obj.startNumber) && obj.startNumber >= 1 ? obj.startNumber : undefined;
  const startNumber = cellType && START_NUMBER_CELL_TYPES.includes(cellType) ? rawStartNumber : undefined;
  return { content, rowspan, colspan, covered, cellType, align, verticalAlign, bgColor, checked, startNumber };
}

/**
 * Walk every cell top→bottom, left→right. When we hit an anchor cell with
 * rowspan/colspan > 1 we mark the covered cells accordingly (setting
 * content=[], rowspan=colspan=1, covered=true so the renderer skips).
 *
 * Clamps out-of-bounds spans to the actual grid — this prevents malformed
 * input from ever producing a cell with a span larger than the grid.
 */
export function recomputeCovered(
  cells: readonly (readonly TableCellData[])[],
  rows: number,
  cols: number,
): TableCellData[][] {
  const mutable: MutableCell[][] = cells.map((row) => row.map(cloneCell));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = mutable[r]![c]!;
      if (cell.covered) continue;
      const rs = Math.max(1, Math.min(cell.rowspan, rows - r));
      const cs = Math.max(1, Math.min(cell.colspan, cols - c));
      cell.rowspan = rs;
      cell.colspan = cs;
      if (rs === 1 && cs === 1) continue;
      for (let rr = r; rr < r + rs; rr++) {
        for (let cc = c; cc < c + cs; cc++) {
          if (rr === r && cc === c) continue;
          mutable[rr]![cc] = { content: [], rowspan: 1, colspan: 1, covered: true };
        }
      }
    }
  }
  return mutable.map((row) => row.map(sealCell));
}

// ---------------------------------------------------------------------------
// Structural operations — pure functions that produce a new TableAttrs.
// Callers (commands) feed the result into editor.commands.setAttrs.
// ---------------------------------------------------------------------------

/** Insert a new row before `beforeRow` (0 ≤ beforeRow ≤ rows). When
 *  beforeRow === rows appends at the bottom. New row cells are empty
 *  clones of the row above (same column spans — but only if they start
 *  on the row being cloned). Otherwise plain empty cells. */
export function insertRow(attrs: TableAttrs, beforeRow: number): TableAttrs {
  const { rows, cols, cells, colWidths, headerRow } = attrs;
  const idx = Math.max(0, Math.min(beforeRow, rows));
  const newCellsArr: MutableCell[][] = cells.map((r) => r.map(cloneCell));
  const newRow: MutableCell[] = [];
  for (let c = 0; c < cols; c++) {
    if (idx > 0) {
      const above = newCellsArr[idx - 1]?.[c];
      if (above && !above.covered) {
        const spanEnd = idx - 1 + above.rowspan;
        if (spanEnd > idx) {
          newRow.push({ content: [], rowspan: 1, colspan: 1, covered: true });
          continue;
        }
      }
    }
    newRow.push(makeEmptyCell());
  }
  newCellsArr.splice(idx, 0, newRow);
  if (idx > 0) {
    for (let c = 0; c < cols; c++) {
      const above = newCellsArr[idx - 1]?.[c];
      if (above && !above.covered) {
        const originalSpanEnd = idx - 1 + above.rowspan;
        if (originalSpanEnd > idx) {
          above.rowspan = above.rowspan + 1;
        }
      }
    }
  }
  const finalCells = recomputeCovered(newCellsArr, rows + 1, cols);
  return { rows: rows + 1, cols, cells: finalCells, colWidths: [...colWidths], headerRow };
}

/** Remove row `rowIndex`. When the last row is removed we still keep 1 row
 *  (empty tables with zero rows are not allowed). */
export function removeRow(attrs: TableAttrs, rowIndex: number): TableAttrs {
  const { rows, cols, colWidths, headerRow } = attrs;
  if (rows <= 1) return attrs;
  const idx = Math.max(0, Math.min(rowIndex, rows - 1));
  const newCellsArr: MutableCell[][] = attrs.cells.map((r) => r.map(cloneCell));
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < idx; r++) {
      const cell = newCellsArr[r]?.[c];
      if (!cell || cell.covered) continue;
      const spanEnd = r + cell.rowspan;
      if (spanEnd > idx) {
        cell.rowspan = Math.max(1, cell.rowspan - 1);
      }
    }
  }
  newCellsArr.splice(idx, 1);
  let newHeaderRow = headerRow;
  if (headerRow && idx === 0) newHeaderRow = false;
  const finalCells = recomputeCovered(newCellsArr, rows - 1, cols);
  return { rows: rows - 1, cols, cells: finalCells, colWidths: [...colWidths], headerRow: newHeaderRow };
}

/** Insert a new column before `beforeCol` (0 ≤ beforeCol ≤ cols). */
export function insertCol(attrs: TableAttrs, beforeCol: number): TableAttrs {
  const { rows, cols, cells, colWidths, headerRow } = attrs;
  const idx = Math.max(0, Math.min(beforeCol, cols));
  const newCellsArr: MutableCell[][] = cells.map((r) => r.map(cloneCell));
  for (let r = 0; r < rows; r++) {
    let handledBySpan = false;
    if (idx > 0) {
      const left = newCellsArr[r]![idx - 1];
      if (left && !left.covered) {
        const spanEnd = idx - 1 + left.colspan;
        if (spanEnd > idx) {
          left.colspan = left.colspan + 1;
          handledBySpan = true;
        }
      }
    }
    newCellsArr[r]!.splice(idx, 0, handledBySpan
      ? { content: [], rowspan: 1, colspan: 1, covered: true }
      : makeEmptyCell(),
    );
  }
  const newWidths = [...colWidths];
  // New column inherits a sensible default so its initial visual width
  // matches surrounding columns instead of collapsing to 0.
  const existing = newWidths.filter((w) => w > 0);
  const defaultW = existing.length > 0
    ? Math.round(existing.reduce((a, b) => a + b, 0) / existing.length)
    : 120;
  newWidths.splice(idx, 0, defaultW);
  const finalCells = recomputeCovered(newCellsArr, rows, cols + 1);
  return { rows, cols: cols + 1, cells: finalCells, colWidths: newWidths, headerRow };
}

/** Remove column `colIndex`. Last column cannot be removed. */
export function removeCol(attrs: TableAttrs, colIndex: number): TableAttrs {
  const { rows, cols, cells, headerRow } = attrs;
  if (cols <= 1) return attrs;
  const idx = Math.max(0, Math.min(colIndex, cols - 1));
  const newCellsArr: MutableCell[][] = cells.map((r) => r.map(cloneCell));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < idx; c++) {
      const cell = newCellsArr[r]![c];
      if (!cell || cell.covered) continue;
      const spanEnd = c + cell.colspan;
      if (spanEnd > idx) cell.colspan = Math.max(1, cell.colspan - 1);
    }
    newCellsArr[r]!.splice(idx, 1);
  }
  const newWidths = [...attrs.colWidths];
  newWidths.splice(idx, 1);
  const finalCells = recomputeCovered(newCellsArr, rows, cols - 1);
  return { rows, cols: cols - 1, cells: finalCells, colWidths: newWidths, headerRow };
}

/** Replace the InlineSeq of a single non-covered cell. No-ops if the cell
 *  is covered or indices out of range. Content is sanitized through
 *  sanitizeCellContent to enforce mark validation rules. */
export function setCellContent(
  attrs: TableAttrs,
  row: number,
  col: number,
  content: InlineSeq,
): TableAttrs {
  if (row < 0 || row >= attrs.rows || col < 0 || col >= attrs.cols) return attrs;
  const cell = attrs.cells[row]?.[col];
  if (!cell || cell.covered) return attrs;
  const sanitized = sanitizeCellContent(content, cell.cellType);
  const newCellsArr = attrs.cells.map((r, ri) =>
    r.map((c, ci) => (ri === row && ci === col ? sealCell({ ...cloneCell(c), content: sanitized }) : c)),
  );
  return { ...attrs, cells: newCellsArr };
}

/** Update a single cell's attrs (rowspan / colspan). Used by merge/split. */
export function setCellSpans(
  attrs: TableAttrs,
  row: number,
  col: number,
  rowspan: number,
  colspan: number,
): TableAttrs {
  if (row < 0 || row >= attrs.rows || col < 0 || col >= attrs.cols) return attrs;
  const cell = attrs.cells[row]?.[col];
  if (!cell || cell.covered) return attrs;
  const newCellsArr: MutableCell[][] = attrs.cells.map((r) => r.map(cloneCell));
  const target = newCellsArr[row]![col]!;
  target.rowspan = Math.max(1, rowspan);
  target.colspan = Math.max(1, colspan);
  const finalCells = recomputeCovered(newCellsArr, attrs.rows, attrs.cols);
  return { ...attrs, cells: finalCells };
}

/** Set align / verticalAlign / bgColor / cellType / checked / startNumber on a single non-covered cell.
 *  Values are validated: cellType must be in VALID_CELL_TYPES, align in
 *  VALID_CELL_ALIGN, verticalAlign in VALID_CELL_VERTICAL_ALIGN, bgColor in
 *  VALID_CELL_BG_COLORS. Invalid values are silently dropped (reverted to default). */
export function setCellAttrs(
  attrs: TableAttrs,
  row: number,
  col: number,
  changes: { cellType?: string; align?: string; verticalAlign?: string; bgColor?: string; checked?: boolean; startNumber?: number | null },
): TableAttrs {
  if (row < 0 || row >= attrs.rows || col < 0 || col >= attrs.cols) return attrs;
  const cell = attrs.cells[row]?.[col];
  if (!cell || cell.covered) return attrs;
  const newCellsArr = attrs.cells.map((r, ri) =>
    r.map((c, ci) => {
      if (ri !== row || ci !== col) return c;
      const cloned = cloneCell(c);
      if (changes.cellType !== undefined) {
        cloned.cellType = changes.cellType === 'paragraph'
          ? undefined
          : VALID_CELL_TYPES.includes(changes.cellType) ? changes.cellType : undefined;
        // Re-sanitize content with the new cell type to enforce mark
        // restrictions (codeBlock: no marks; quote: no italic).
        cloned.content = sanitizeCellContent(cloned.content, cloned.cellType);
        // Clear type-specific fields when the type no longer supports them.
        if (!cloned.cellType || !CHECKED_CELL_TYPES.includes(cloned.cellType)) {
          cloned.checked = undefined;
        }
        if (!cloned.cellType || !START_NUMBER_CELL_TYPES.includes(cloned.cellType)) {
          cloned.startNumber = undefined;
        }
      }
      if (changes.align !== undefined) {
        cloned.align = changes.align === 'left'
          ? undefined
          : VALID_CELL_ALIGN.includes(changes.align) ? changes.align : undefined;
      }
      if (changes.verticalAlign !== undefined) {
        cloned.verticalAlign = changes.verticalAlign === 'middle'
          ? undefined
          : VALID_CELL_VERTICAL_ALIGN.includes(changes.verticalAlign) ? changes.verticalAlign : undefined;
      }
      if (changes.bgColor !== undefined) {
        cloned.bgColor = changes.bgColor === 'default'
          ? undefined
          : VALID_CELL_BG_COLORS.includes(changes.bgColor) ? changes.bgColor : undefined;
      }
      if (changes.checked !== undefined) {
        cloned.checked = cloned.cellType && CHECKED_CELL_TYPES.includes(cloned.cellType)
          ? changes.checked
          : undefined;
      }
      if (changes.startNumber !== undefined) {
        if (changes.startNumber === null) {
          cloned.startNumber = undefined;
        } else {
          cloned.startNumber = cloned.cellType && START_NUMBER_CELL_TYPES.includes(cloned.cellType)
            && typeof changes.startNumber === 'number' && Number.isInteger(changes.startNumber) && changes.startNumber >= 1
            ? changes.startNumber
            : undefined;
        }
      }
      return sealCell(cloned);
    }),
  );
  return { ...attrs, cells: newCellsArr };
}

/** Apply align / verticalAlign / bgColor / cellType / checked / startNumber changes to multiple cells at once.
 *  Same validation as setCellAttrs. */
export function setCellsAttrs(
  attrs: TableAttrs,
  positions: readonly { row: number; col: number }[],
  changes: { cellType?: string; align?: string; verticalAlign?: string; bgColor?: string; checked?: boolean; startNumber?: number | null },
): TableAttrs {
  const posSet = new Set(positions.map((p) => `${p.row}-${p.col}`));
  const newCellsArr = attrs.cells.map((r, ri) =>
    r.map((c, ci) => {
      if (!posSet.has(`${ri}-${ci}`) || c.covered) return c;
      const cloned = cloneCell(c);
      if (changes.cellType !== undefined) {
        cloned.cellType = changes.cellType === 'paragraph'
          ? undefined
          : VALID_CELL_TYPES.includes(changes.cellType) ? changes.cellType : undefined;
        // Re-sanitize content with the new cell type to enforce mark
        // restrictions (codeBlock: no marks; quote: no italic).
        cloned.content = sanitizeCellContent(cloned.content, cloned.cellType);
        // Clear type-specific fields when the type no longer supports them.
        if (!cloned.cellType || !CHECKED_CELL_TYPES.includes(cloned.cellType)) {
          cloned.checked = undefined;
        }
        if (!cloned.cellType || !START_NUMBER_CELL_TYPES.includes(cloned.cellType)) {
          cloned.startNumber = undefined;
        }
      }
      if (changes.align !== undefined) {
        cloned.align = changes.align === 'left'
          ? undefined
          : VALID_CELL_ALIGN.includes(changes.align) ? changes.align : undefined;
      }
      if (changes.verticalAlign !== undefined) {
        cloned.verticalAlign = changes.verticalAlign === 'middle'
          ? undefined
          : VALID_CELL_VERTICAL_ALIGN.includes(changes.verticalAlign) ? changes.verticalAlign : undefined;
      }
      if (changes.bgColor !== undefined) {
        cloned.bgColor = changes.bgColor === 'default'
          ? undefined
          : VALID_CELL_BG_COLORS.includes(changes.bgColor) ? changes.bgColor : undefined;
      }
      if (changes.checked !== undefined) {
        cloned.checked = cloned.cellType && CHECKED_CELL_TYPES.includes(cloned.cellType)
          ? changes.checked
          : undefined;
      }
      if (changes.startNumber !== undefined) {
        if (changes.startNumber === null) {
          cloned.startNumber = undefined;
        } else {
          cloned.startNumber = cloned.cellType && START_NUMBER_CELL_TYPES.includes(cloned.cellType)
            && typeof changes.startNumber === 'number' && Number.isInteger(changes.startNumber) && changes.startNumber >= 1
            ? changes.startNumber
            : undefined;
        }
      }
      return sealCell(cloned);
    }),
  );
  return { ...attrs, cells: newCellsArr };
}

/** Apply a mark (bold/italic/etc.) to ALL text runs in the given cells.
 *  Passing `attrs === null` removes the mark instead.
 *  Enforces code incompatibility: adding `code` strips incompatible marks,
 *  and adding an incompatible mark to a code segment is a no-op. */
export function setCellsMark(
  attrs: TableAttrs,
  positions: readonly { row: number; col: number }[],
  markType: string,
  markAttrs?: Record<string, JSONValue> | null,
): TableAttrs {
  const posSet = new Set(positions.map((p) => `${p.row}-${p.col}`));
  const newCellsArr = attrs.cells.map((r, ri) =>
    r.map((c, ci) => {
      if (!posSet.has(`${ri}-${ci}`) || c.covered) return c;
      // codeBlock cells don't allow ANY inline marks.
      if (c.cellType === 'codeBlock') return c;
      // quote cells don't allow italic (the quote style itself is italic).
      if (c.cellType === 'quote' && markType === 'italic') return c;
      const cloned = cloneCell(c);
      // Apply mark to all text runs in the cell
      cloned.content = cloned.content.map((node) => {
        if (node.type !== 'text') return node;
        const existingMarks = node.marks ? [...node.marks] : [];
        const hasCode = existingMarks.some((m) => m.type === 'code');

        if (markType === 'code' && markAttrs !== null) {
          // Adding inline code: strip all incompatible marks, then add code.
          const filtered = existingMarks.filter((m) => m.type === 'code' || !CODE_INCOMPATIBLE_MARKS.includes(m.type));
          if (!filtered.some((m) => m.type === 'code')) {
            filtered.push({ type: 'code' });
          }
          return { ...node, marks: filtered.length > 0 ? filtered : undefined };
        }

        if (markAttrs !== null && CODE_INCOMPATIBLE_MARKS.includes(markType) && hasCode) {
          // Don't apply formatting marks to segments that are inline code.
          return node;
        }

        // Remove existing mark of same type
        const filtered = existingMarks.filter((m) => m.type !== markType);
        if (markAttrs !== null) {
          filtered.push(markAttrs ? { type: markType, attrs: markAttrs } : { type: markType });
        }
        return { ...node, marks: filtered.length > 0 ? filtered : undefined };
      });
      return sealCell(cloned);
    }),
  );
  return { ...attrs, cells: newCellsArr };
}

/** Toggle a mark on all text runs in the given cells. Removes the mark if
 *  every selected cell already has it on all its text runs, otherwise adds. */
export function toggleCellsMark(
  attrs: TableAttrs,
  positions: readonly { row: number; col: number }[],
  markType: string,
): TableAttrs {
  const posSet = new Set(positions.map((p) => `${p.row}-${p.col}`));
  // Filter out cells where this mark type is disallowed (codeBlock: no
  // marks at all; quote: no italic). If no eligible cells remain, no-op.
  const eligiblePositions = positions.filter((p) => {
    const cell = attrs.cells[p.row]?.[p.col];
    if (!cell || cell.covered) return false;
    if (cell.cellType === 'codeBlock') return false;
    if (cell.cellType === 'quote' && markType === 'italic') return false;
    return true;
  });
  if (eligiblePositions.length === 0) return attrs;
  // Check if ALL eligible cells have the mark on ALL their text runs
  let allHaveMark = true;
  for (const p of eligiblePositions) {
    const cell = attrs.cells[p.row]?.[p.col];
    if (!cell || cell.covered) continue;
    if (cell.content.length === 0) continue;
    for (const node of cell.content) {
      if (node.type !== 'text') continue;
      const has = node.marks?.some((m) => m.type === markType) ?? false;
      if (!has) {
        allHaveMark = false;
        break;
      }
    }
    if (!allHaveMark) break;
  }
  void posSet; // positions are re-passed to setCellsMark below
  // Toggle: if all have it, remove; otherwise add
  return setCellsMark(attrs, eligiblePositions, markType, allHaveMark ? null : {});
}

/**
 * Merge the rectangle of cells from (r1,c1) → (r2,c2) inclusive. Anchor is
 * always the top-left. Existing merges inside the rect are flattened.
 *
 * Content policy: ONLY the cell that originally occupied the top-left
 * anchor position (rs, cs) — or the anchor of the merged block that covers
 * it — contributes its InlineSeq to the merged cell. Every other cell's
 * content is discarded (matches Notion's "first cell wins" semantics).
 * The anchor's cell-level attrs (cellType / align / bgColor) are also
 * preserved unchanged.
 */
export function mergeRect(
  attrs: TableAttrs,
  r1: number,
  c1: number,
  r2: number,
  c2: number,
): TableAttrs {
  const rs = Math.max(0, Math.min(r1, r2));
  const re = Math.min(attrs.rows - 1, Math.max(r1, r2));
  const cs = Math.max(0, Math.min(c1, c2));
  const ce = Math.min(attrs.cols - 1, Math.max(c1, c2));
  if (rs === re && cs === ce) return attrs; // 1x1 rect: no-op
  const newCellsArr: MutableCell[][] = attrs.cells.map((r) => r.map(cloneCell));
  // First pass: reset every logical cell inside the rect to a plain 1x1
  // non-covered placeholder. This flattens any pre-existing merges whose
  // anchors lie within the rect and clears stale covered flags.
  for (let r = rs; r <= re; r++) {
    for (let c = cs; c <= ce; c++) {
      newCellsArr[r]![c] = {
        content: [],
        rowspan: 1,
        colspan: 1,
        covered: false,
      };
    }
  }
  // Locate the anchor cell for (rs, cs) BEFORE resetting so we can preserve
  // its content + cellType/align/bgColor. If (rs, cs) was a covered cell we
  // walk to the real merged anchor (which may lie outside the rect but that
  // is OK — the first-pass reset above has already freed the logical
  // position inside our rect).
  let ar = rs;
  let ac = cs;
  while (ar >= 0 && attrs.cells[ar]?.[ac]?.covered) {
    if (ac > 0) {
      ac -= 1;
      continue;
    }
    ar -= 1;
    ac = attrs.cols - 1;
  }
  const anchorCell = ar >= 0 ? attrs.cells[ar]?.[ac] : undefined;
  const anchorContent: InlineNode[] = anchorCell
    ? anchorCell.content.map((n) => ({ ...n }))
    : [];
  const anchorType = anchorCell?.cellType;
  const anchorAlign = anchorCell?.align;
  const anchorVerticalAlign = anchorCell?.verticalAlign;
  const anchorBgColor = anchorCell?.bgColor;
  const anchorChecked = anchorCell?.checked;
  const anchorStartNumber = anchorCell?.startNumber;
  newCellsArr[rs]![cs] = {
    content: sanitizeCellContent(anchorContent, anchorType),
    rowspan: re - rs + 1,
    colspan: ce - cs + 1,
    covered: false,
    cellType: anchorType,
    align: anchorAlign,
    verticalAlign: anchorVerticalAlign,
    bgColor: anchorBgColor,
    checked: anchorChecked,
    startNumber: anchorStartNumber,
  };
  const finalCells = recomputeCovered(newCellsArr, attrs.rows, attrs.cols);
  return { ...attrs, cells: finalCells };
}

/** Split a previously-merged cell back to rowspan=colspan=1. Data stays on
 *  the top-left (anchor) cell; every other previously-covered cell becomes
 *  an empty plain 1x1 cell. */
export function splitCell(attrs: TableAttrs, row: number, col: number): TableAttrs {
  if (row < 0 || row >= attrs.rows || col < 0 || col >= attrs.cols) return attrs;
  const anchor = attrs.cells[row]?.[col];
  if (!anchor || anchor.covered) return attrs;
  const re = row + anchor.rowspan - 1;
  const ce = col + anchor.colspan - 1;
  const newCellsArr: MutableCell[][] = attrs.cells.map((r) => r.map(cloneCell));
  for (let r = row; r <= re; r++) {
    for (let c = col; c <= ce; c++) {
      newCellsArr[r]![c] = {
        content: r === row && c === col ? [...anchor.content] : [],
        rowspan: 1,
        colspan: 1,
        covered: false,
      };
    }
  }
  const finalCells = recomputeCovered(newCellsArr, attrs.rows, attrs.cols);
  return { ...attrs, cells: finalCells };
}

/** Split ALL merged cells whose anchors lie within the given rectangle.
 *  This is the operation triggered by the "Split cells" toolbar button
 *  when the user has a multi-cell selection. Each merged cell inside the
 *  (expanded) rect is split independently using the same rule as splitCell
 *  above — its data stays on its own top-left position. */
export function splitCellsInRect(
  attrs: TableAttrs,
  r1: number,
  c1: number,
  r2: number,
  c2: number,
): TableAttrs {
  const rs = Math.max(0, Math.min(r1, r2));
  const re = Math.min(attrs.rows - 1, Math.max(r1, r2));
  const cs = Math.max(0, Math.min(c1, c2));
  const ce = Math.min(attrs.cols - 1, Math.max(c1, c2));
  let next = attrs;
  // We need to split in an order that doesn't shift anchor positions.
  // Splitting from bottom-right to top-left ensures that an anchor's
  // (row, col) stays stable while we iterate, because later anchors
  // (lower rows, or higher cols in same row) are processed earlier than
  // earlier anchors that could expand into their space.
  for (let r = re; r >= rs; r--) {
    for (let c = ce; c >= cs; c--) {
      const cell = next.cells[r]?.[c];
      if (!cell || cell.covered) continue;
      if (cell.rowspan === 1 && cell.colspan === 1) continue;
      next = splitCell(next, r, c);
    }
  }
  return next;
}

/** Toggle the header-row flag on/off. */
export function toggleHeaderRow(attrs: TableAttrs): TableAttrs {
  return { ...attrs, headerRow: !attrs.headerRow };
}

/** Set a single column width (0 = auto). */
export function setColWidth(attrs: TableAttrs, col: number, width: number): TableAttrs {
  if (col < 0 || col >= attrs.cols) return attrs;
  const w = Math.max(0, Math.round(width));
  const widths = [...attrs.colWidths];
  while (widths.length < attrs.cols) widths.push(0);
  widths[col] = w;
  return { ...attrs, colWidths: widths };
}

// ---------------------------------------------------------------------------
// Serialization helpers (HTML / Markdown)
// ---------------------------------------------------------------------------

/** Plain-text dump of a single cell. Used by Markdown and for copying a
 *  single cell to the clipboard. */
export function cellPlainText(cell: TableCellData): string {
  let s = '';
  for (const run of cell.content) if (run.type === 'text') s += run.text;
  return s;
}

/** Escape a Markdown table cell body so pipes/newlines don't break the grid. */
export function escapeMdCell(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}

/** Build a Markdown pipe-delimited table (compatible with GitHub). */
export function tableToMarkdown(attrs: TableAttrs): string {
  const lines: string[] = [];
  const colWidthsPx = attrs.colWidths;
  void colWidthsPx; // column widths have no Markdown equivalent
  const header: string[] = [];
  const sep: string[] = [];
  for (let c = 0; c < attrs.cols; c++) {
    const cell = attrs.cells[0]?.[c];
    const text = cell && !cell.covered ? cellPlainText(cell) : '';
    header.push(escapeMdCell(text));
    sep.push(attrs.headerRow ? '---' : '-');
  }
  const startRow = attrs.headerRow ? 1 : 0;
  if (attrs.headerRow) {
    lines.push(`| ${header.join(' | ')} |`);
    lines.push(`| ${sep.join(' | ')} |`);
  } else {
    // No header row — emit plain table with an empty first separator row so
    // markdown parsers still detect a table (GFM requires header + sep).
    lines.push(`| ${header.join(' | ')} |`);
    lines.push(`| ${sep.join(' | ')} |`);
  }
  for (let r = startRow; r < attrs.rows; r++) {
    const cells: string[] = [];
    for (let c = 0; c < attrs.cols; c++) {
      const cell = attrs.cells[r]?.[c];
      const text = cell && !cell.covered ? cellPlainText(cell) : '';
      cells.push(escapeMdCell(text));
    }
    lines.push(`| ${cells.join(' | ')} |`);
  }
  return lines.join('\n');
}

/** Build an HTML <table> representation. */
export function tableToHtml(attrs: TableAttrs): string {
  const out: string[] = ['<table>'];
  // Colgroup for widths.
  const cg: string[] = [];
  for (let c = 0; c < attrs.cols; c++) {
    const w = attrs.colWidths[c] ?? 0;
    cg.push(w > 0 ? `<col style="width:${w}px">` : '<col>');
  }
  if (cg.length > 0) out.push(`<colgroup>${cg.join('')}</colgroup>`);
  const bodyRowsStart = attrs.headerRow ? 1 : 0;
  if (attrs.headerRow) {
    out.push('<thead><tr>');
    for (let c = 0; c < attrs.cols; c++) {
      const cell = attrs.cells[0]?.[c];
      if (!cell || cell.covered) continue;
      const rs = cell.rowspan > 1 ? ` rowspan="${cell.rowspan}"` : '';
      const cs = cell.colspan > 1 ? ` colspan="${cell.colspan}"` : '';
      out.push(`<th${rs}${cs}>${escapeHtml(cellPlainText(cell))}</th>`);
    }
    out.push('</tr></thead>');
  }
  out.push('<tbody>');
  for (let r = bodyRowsStart; r < attrs.rows; r++) {
    out.push('<tr>');
    for (let c = 0; c < attrs.cols; c++) {
      const cell = attrs.cells[r]?.[c];
      if (!cell || cell.covered) continue;
      const rs = cell.rowspan > 1 ? ` rowspan="${cell.rowspan}"` : '';
      const cs = cell.colspan > 1 ? ` colspan="${cell.colspan}"` : '';
      out.push(`<td${rs}${cs}>${escapeHtml(cellPlainText(cell))}</td>`);
    }
    out.push('</tr>');
  }
  out.push('</tbody></table>');
  return out.join('');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Parse a DOM <table> element into TableAttrs. Used by clipboard HTML
 *  parsing (Word/Google Docs). */
export function parseHtmlTable(tableEl: HTMLTableElement): TableAttrs | null {
  // Flatten rows, mapping <thead>/<tbody>/<tr> into an ordered list.
  const trs = Array.from(tableEl.querySelectorAll('tr'));
  if (trs.length === 0) return null;
  // Determine column count by looking at the row with the most logical cells.
  let cols = 0;
  const rowCellEls: HTMLTableCellElement[][] = [];
  for (const tr of trs) {
    const arr = Array.from(tr.children).filter(
      (e): e is HTMLTableCellElement => e.tagName === 'TH' || e.tagName === 'TD',
    );
    let logical = 0;
    for (const c of arr) logical += (c.colSpan || 1);
    if (logical > cols) cols = logical;
    rowCellEls.push(arr);
  }
  cols = Math.max(1, cols);
  const rows = trs.length;
  const grid: MutableCell[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: MutableCell[] = [];
    for (let c = 0; c < cols; c++) row.push(makeEmptyCell());
    grid.push(row);
  }
  for (let r = 0; r < rows; r++) {
    const cells = rowCellEls[r] ?? [];
    let colCursor = 0;
    for (const td of cells) {
      while (colCursor < cols && grid[r]![colCursor]!.covered) colCursor++;
      if (colCursor >= cols) break;
      const rs = Math.max(1, Math.min(td.rowSpan || 1, rows - r));
      const cs = Math.max(1, Math.min(td.colSpan || 1, cols - colCursor));
      // Use inlineFromDom on the <td>/<th> element so we preserve rich
      // marks (bold/italic/color/link) when pasting from Word, HTML, etc.
      // Then sanitize to enforce code incompatibility and link safety.
      const inline = sanitizeCellContent(inlineFromDom(td));
      grid[r]![colCursor] = {
        content: inline,
        rowspan: rs,
        colspan: cs,
        covered: false,
      };
      for (let rr = r; rr < r + rs; rr++) {
        for (let cc = colCursor; cc < colCursor + cs; cc++) {
          if (rr === r && cc === colCursor) continue;
          if (rr < rows && cc < cols) {
            grid[rr]![cc] = { content: [], rowspan: 1, colspan: 1, covered: true };
          }
        }
      }
      colCursor += cs;
    }
  }
  const hasHeader
    = tableEl.querySelectorAll('thead tr').length > 0
      || rowCellEls[0]?.every((c) => c.tagName === 'TH') === true;
  const widths: number[] = [];
  for (let c = 0; c < cols; c++) widths.push(0);
  const sealedGrid: TableCellData[][] = grid.map((row) => row.map(sealCell));
  const finalCells = recomputeCovered(sealedGrid, rows, cols);
  return { rows, cols, cells: finalCells, colWidths: widths, headerRow: hasHeader };
}

// Attrs validate helper — ensures JSONValue attrs conform to TableAttrs.
export function validateTableAttrs(v: unknown): boolean {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  if (typeof o.rows !== 'number' || !Number.isInteger(o.rows) || o.rows < 1) return false;
  if (typeof o.cols !== 'number' || !Number.isInteger(o.cols) || o.cols < 1) return false;
  return true;
}

/** Shallow-cast Attrs → TableAttrs via JSONValue round trip. Used in
 *  commands after the schema has already validated the raw attrs shape. */
export function attrsToTable(a: Readonly<Record<string, JSONValue>>): TableAttrs {
  return coerceTableAttrs(a);
}

// ---------------------------------------------------------------------------
// Ordered-list cell numbering
// ---------------------------------------------------------------------------

/**
 * Compute the displayed 1-based ordinal for an ordered-list cell at (row, col).
 *
 * Mirrors the text-block ordered-list numbering rules:
 *   1. If the cell has `startNumber = N` (explicit override), return N.
 *   2. Otherwise, walk backwards in the SAME COLUMN (skipping covered cells):
 *        - If the previous non-covered cell in the same column is also an
 *          orderedList, this cell's ordinal is previousOrdinal + 1.
 *        - If it is NOT an orderedList (or there is no previous cell), the
 *          ordinal is 1 (implicit start of a list).
 *
 * Numbering is per-column because table cells are laid out in a grid, and a
 * vertical sequence of orderedList cells in one column should form a numbered
 * list independent of other columns.
 *
 * Returns 1 for non-orderedList cells (should not be called for them).
 */
export function orderedListCellNumber(attrs: TableAttrs, row: number, col: number): number {
  const cell = attrs.cells[row]?.[col];
  if (!cell || cell.covered) return 1;
  // Explicit startNumber override.
  if (typeof cell.startNumber === 'number') return cell.startNumber;
  // Walk backwards in the same column.
  for (let r = row - 1; r >= 0; r--) {
    const prev = attrs.cells[r]?.[col];
    if (!prev || prev.covered) continue;
    if (prev.cellType !== 'orderedList') break;
    // Found a previous orderedList cell — its number + 1.
    return orderedListCellNumber(attrs, r, col) + 1;
  }
  // No orderedList predecessor in this column → start from 1.
  return 1;
}
