/**
 * History manager: undo/redo via step inversion with grouping.
 *
 * Owned by the `Editor` (not part of `EditorState`) because history is
 * editor-instance state, not document state. Transactions with
 * `meta.addToHistory === false` (selection moves, undo/redo themselves) are
 * not recorded. Consecutive transactions sharing a `historyGroup` key
 * collapse into a single undo entry (used for typing runs).
 *
 * See docs/architecture.md §9 (History) and §16 (undo/redo correctness).
 */

import type { DocState, Selection } from '../types';
import type { Step } from '../state/Step';
import type { Transaction } from '../state/Transaction';
import { createTransaction } from '../state/Transaction';
import { invertSteps } from '../state/invert';

interface HistoryItem {
  readonly original: readonly Step[];
  readonly inverse: Step[];
  readonly selectionBefore: Selection;
}

interface HistoryEntry {
  readonly trs: HistoryItem[];
  selectionAfter: Selection;
  readonly group: string | null;
  open: boolean;
}

export class HistoryManager {
  private readonly undoStack: HistoryEntry[] = [];
  private readonly redoStack: HistoryEntry[] = [];
  private readonly limit: number;
  /** Stack of explicit groups opened by `beginGroup`/`endGroup`. */
  private manualGroupStack: string[] = [];
  /** Monotonically increasing counter for unique group ids. */
  private groupCounter = 0;

  constructor(limit = 500) {
    this.limit = limit;
  }

  /**
   * Begin a new explicit grouping scope. Any `record()` call made between
   * `beginGroup()` and the matching `endGroup()` (even across nested scopes)
   * will be assigned to the same generated `historyGroup` key, so they merge
   * into a single undo entry. Scopes nest: the outermost `endGroup()` closes
   * the group (subsequent records become their own entries again).
   *
   * Typical use: bracket a sequence of commands (e.g. `setText` + `convertBlock`)
   * so the user can undo them as one step.
   */
  beginGroup(): string {
    const id = `g-${++this.groupCounter}`;
    this.manualGroupStack.push(id);
    return id;
  }

  /** Close an explicit grouping scope opened by `beginGroup()`. */
  endGroup(): void {
    this.manualGroupStack.pop();
    // Close any currently-open top entry that was opened by the manual group.
    const top = this.undoStack[this.undoStack.length - 1];
    if (top && top.open) top.open = false;
  }

  /** The currently-active manual group id, or null if none. */
  get currentGroup(): string | null {
    const stack = this.manualGroupStack;
    return stack.length > 0 ? stack[stack.length - 1]! : null;
  }

  /** Record a transaction against the state that preceded it. */
  record(tr: Transaction, prevSelection: Selection, prevDoc: DocState): void {
    if (tr.meta.addToHistory === false) return;
    if (tr.steps.length === 0) return; // pure selection change — nothing to undo

    const item: HistoryItem = {
      original: tr.steps,
      inverse: invertSteps(tr.steps, prevDoc),
      selectionBefore: prevSelection,
    };
    // Manual group (if any) wins over the transaction-local group.
    const group = this.currentGroup ?? (tr.meta.historyGroup ?? null);
    const top = this.undoStack[this.undoStack.length - 1];

    if (group !== null && top && top.open && top.group === group) {
      top.trs.push(item);
      top.selectionAfter = tr.selectionAfter ?? prevSelection;
    } else {
      const entry: HistoryEntry = {
        trs: [item],
        selectionAfter: tr.selectionAfter ?? prevSelection,
        group,
        open: group !== null,
      };
      this.undoStack.push(entry);
      if (this.undoStack.length > this.limit) this.undoStack.shift();
    }
    // Any new recorded change invalidates the redo stack.
    this.redoStack.length = 0;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Clear all history (used when the document is replaced wholesale). */
  reset(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }

  /** Build the transaction that undoes the last entry, or null if none. */
  undo(): Transaction | null {
    const entry = this.undoStack.pop();
    if (!entry) return null;

    // Apply inverses in reverse order (last transaction's inverse first).
    const steps: Step[] = [];
    for (let i = entry.trs.length - 1; i >= 0; i--) {
      steps.push(...entry.trs[i]!.inverse);
    }
    const selectionAfter = entry.trs[0]!.selectionBefore;

    // Push to redo; the entry remains "closed" on the redo side.
    this.redoStack.push({ ...entry, open: false });

    return createTransaction()
      .setMeta({ addToHistory: false, source: 'undo' })
      .setSelection(selectionAfter)
      .appendSteps(steps)
      .build();
  }

  /** Build the transaction that redoes the last undone entry, or null if none. */
  redo(): Transaction | null {
    const entry = this.redoStack.pop();
    if (!entry) return null;

    // Re-apply originals in forward order.
    const steps: Step[] = [];
    for (const item of entry.trs) steps.push(...item.original);
    const selectionAfter = entry.selectionAfter;

    this.undoStack.push({ ...entry, open: false });

    return createTransaction()
      .setMeta({ addToHistory: false, source: 'redo' })
      .setSelection(selectionAfter)
      .appendSteps(steps)
      .build();
  }
}
