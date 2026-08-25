/**
 * Transactions: the only path to mutate editor state.
 *
 * A `Transaction` is an ordered list of serializable `Step`s plus an optional
 * resulting selection and metadata. Commands build transactions via
 * `TransactionBuilder`; the editor applies them through `applyTransaction`,
 * which yields a new immutable `EditorState`.
 *
 * Meta carries cross-cutting hints:
 *  - `addToHistory` (default true): whether the history plugin records this tr.
 *  - `historyGroup`: consecutive trs with the same non-null key collapse into
 *    a single undo entry (used for typing runs).
 *  - `viewHints.skipDomWrite`: block ids the view bridge must NOT write back to
 *    the DOM (e.g. the focused contenteditable that already has the text).
 *
 * See docs/architecture.md §6.3, §7.2, §10.3.
 */

import type { Attrs, BlockId, BlockType, InlineSeq, Selection } from '../types';
import type { Step } from './Step';
import { createBlockId } from '../ids';

export interface TransactionMeta {
  readonly addToHistory?: boolean;
  readonly historyGroup?: string | null;
  readonly viewHints?: { readonly skipDomWrite?: readonly BlockId[] };
  /** Provenance hint for debugging: 'input' | 'command' | 'clipboard' | ... */
  readonly source?: string;
  readonly [key: string]: unknown;
}

export interface Transaction {
  readonly steps: readonly Step[];
  readonly selectionAfter?: Selection;
  readonly meta: TransactionMeta;
}

export interface InsertBlockParams {
  readonly parent: BlockId | null;
  readonly index: number;
  readonly type: BlockType;
  readonly attrs?: Attrs;
  readonly content?: InlineSeq;
  /** Optional explicit id (otherwise generated). Used by undo/redo & paste. */
  readonly id?: BlockId;
}

/**
 * Fluent builder. Each step method returns `this` for chaining. `build()`
 * freezes the result into a `Transaction`.
 */
export class TransactionBuilder {
  private readonly steps: Step[] = [];
  private selectionAfter?: Selection;
  private meta: TransactionMeta = {};

  insertBlock(params: InsertBlockParams): BlockId {
    const id = params.id ?? createBlockId();
    this.steps.push({
      op: 'insertBlock',
      parent: params.parent,
      index: params.index,
      id,
      type: params.type,
      attrs: params.attrs ?? {},
      content: params.content ?? [],
    });
    return id;
  }

  removeBlock(id: BlockId): this {
    this.steps.push({ op: 'removeBlock', id });
    return this;
  }

  replaceBlock(id: BlockId, type: BlockType, attrs: Attrs): this {
    this.steps.push({ op: 'replaceBlock', id, type, attrs });
    return this;
  }

  moveBlock(id: BlockId, toParent: BlockId | null, toIndex: number): this {
    this.steps.push({ op: 'moveBlock', id, toParent, toIndex });
    return this;
  }

  setText(id: BlockId, content: InlineSeq): this {
    this.steps.push({ op: 'setText', id, content });
    return this;
  }

  setAttrs(id: BlockId, attrs: Attrs): this {
    this.steps.push({ op: 'setAttrs', id, attrs });
    return this;
  }

  /** Return a snapshot of the steps accumulated so far (read-only). */
  peek(): readonly Step[] {
    return this.steps;
  }

  /** Append a pre-built list of steps (used by history undo/redo). */
  appendSteps(steps: readonly Step[]): this {
    for (const s of steps) this.steps.push(s);
    return this;
  }

  setSelection(selection: Selection): this {
    this.selectionAfter = selection;
    return this;
  }

  setMeta(meta: Partial<TransactionMeta>): this {
    this.meta = { ...this.meta, ...meta };
    return this;
  }

  addToHistory(value: boolean): this {
    this.meta = { ...this.meta, addToHistory: value };
    return this;
  }

  historyGroup(key: string | null): this {
    this.meta = { ...this.meta, historyGroup: key };
    return this;
  }

  skipDomWrite(ids: readonly BlockId[]): this {
    this.meta = { ...this.meta, viewHints: { ...this.meta.viewHints, skipDomWrite: ids } };
    return this;
  }

  build(): Transaction {
    return {
      steps: this.steps,
      selectionAfter: this.selectionAfter,
      meta: this.meta,
    };
  }
}

export function createTransaction(): TransactionBuilder {
  return new TransactionBuilder();
}
