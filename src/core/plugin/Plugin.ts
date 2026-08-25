/**
 * Plugin contract. A plugin augments editor behavior at well-defined hooks.
 *
 * Plugins differ from extensions: extensions *declare* blocks/commands/
 * keymaps; plugins *react* to editor lifecycle and events. Plugin state is
 * stored inside `EditorState` (keyed by name) so it is part of the immutable,
 * versioned state — this is what makes undo/redo correct across plugin
 * effects.
 *
 * See docs/architecture.md §9.
 */

import type { EditorState } from '../state/EditorState';
import type { Transaction } from '../state/Transaction';

/** Opaque per-plugin state slice. Each plugin owns its concrete type. */
export type PluginState = unknown;

export interface EventContext {
  readonly state: EditorState;
  readonly dispatch: (tr: Transaction) => void;
  /** The focused block id, if any (the block owning the active contenteditable). */
  readonly focusBlockId: () => string | null;
}

export interface Plugin {
  readonly name: string;

  /** Called once when the editor is created. Returns the initial plugin state. */
  init?(state: EditorState): PluginState;

  /**
   * Called for every applied transaction. Receives the transaction, the
   * *previous* state, and the new (doc/selection) state being assembled.
   * Returns the plugin's new state slice.
   */
  applyTransaction?(tr: Transaction, prevState: EditorState, nextDoc: EditorState['doc'], nextSelection: EditorState['selection']): PluginState;

  onKeyDown?(event: KeyboardEvent, ctx: EventContext): boolean;
  onInput?(event: InputEvent, ctx: EventContext): boolean;
  onCompositionStart?(event: CompositionEvent, ctx: EventContext): void;
  onCompositionEnd?(event: CompositionEvent, ctx: EventContext): void;
  onDestroy?(): void;
}
