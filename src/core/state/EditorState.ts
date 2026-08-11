/**
 * `EditorState`: the immutable, versioned state of the editor. It bundles the
 * document, the selection, and per-plugin state. Mutations go exclusively
 * through `applyTransaction`, which produces a *new* `EditorState` with
 * structural sharing (unchanged `Block` objects keep referential identity).
 *
 * See docs/editor-architecture.md §10.1.
 */

import type { DocState, Selection } from '../types';
import type { Plugin, PluginState } from '../plugin/Plugin';
import type { Transaction } from './Transaction';
import { applySteps, type ApplyResult } from './Step';

export interface EditorState {
  readonly doc: DocState;
  readonly selection: Selection;
  readonly pluginState: Readonly<Record<string, PluginState>>;
  /** Monotonic counter; bumped once per applied transaction. */
  readonly version: number;
}

export interface ApplyTransactionResult extends ApplyResult {
  readonly state: EditorState;
}

// A minimal view of plugins sufficient to apply transactions, to avoid a
// runtime coupling to the Plugin module (type-only import keeps it clean).
interface TransactionApplier {
  readonly name: string;
  readonly applyTransaction?: NonNullable<Plugin['applyTransaction']>;
}

/**
 * Apply a transaction to a state, producing a new state plus a diff
 * (changed / removed) that the view bridge consumes.
 */
export function applyTransaction(
  state: EditorState,
  tr: Transaction,
  plugins: readonly TransactionApplier[],
): ApplyTransactionResult {
  const { doc, changed, removed } = applySteps(state.doc, tr.steps);
  const selection = tr.selectionAfter ?? state.selection;

  const pluginState: Record<string, PluginState> = { ...state.pluginState };
  for (const plugin of plugins) {
    if (plugin.applyTransaction) {
      pluginState[plugin.name] = plugin.applyTransaction(tr, state, doc, selection);
    }
  }

  return {
    doc,
    state: {
      doc,
      selection,
      pluginState,
      version: state.version + 1,
    },
    changed,
    removed,
  };
}

/** Create the initial state from a document and a (possibly null) selection. */
export function createState(
  doc: DocState,
  selection: Selection,
  pluginState: Readonly<Record<string, PluginState>> = {},
): EditorState {
  return { doc, selection, pluginState, version: 0 };
}
