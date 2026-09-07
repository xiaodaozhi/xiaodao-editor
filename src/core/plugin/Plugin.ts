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
import type { EditorRegistries } from '../extension/Registry';

/** Opaque per-plugin state slice. Each plugin owns its concrete type. */
export type PluginState = unknown;

/**
 * Minimal Editor surface exposed to plugins. Defined here (rather than
 * importing the `Editor` class) to avoid a circular type dependency:
 * `plugin/Plugin.ts` is imported by `Editor.ts`, which would otherwise
 * import `Editor.ts` back. Any method added to the live Editor that
 * plugins should be able to call needs to be declared here too.
 *
 * The interface intentionally mirrors what plugins actually use today
 * (registries for schema reads, commands for transaction dispatch,
 * dispatch for plugin-internal transactions, subscribe for side-channel
 * cleanup tracking). It can grow as new plugins need more access.
 */
export interface PluginEditor {
  readonly registries: EditorRegistries;
  readonly commands: Record<string, (...args: unknown[]) => boolean>;
  getState(): EditorState;
  subscribe(listener: (update: { readonly state: EditorState }) => void): () => void;
  /**
   * Register a callable under a string key. `T` is inferred from the
   * call site so concrete function types are preserved. The returned
   * function unregisters the method. Plugins use this to expose async
   * commands (e.g. `startImageUpload`) or any other callable surface
   * that the view layer needs to invoke through the editor.
   */
  registerExtensionMethod<T>(name: string, fn: T): () => void;
  /** Look up a previously-registered extension method. */
  getExtensionMethod<T = unknown>(name: string): T | undefined;
}

/** Context passed to `Plugin.init`. Provided once when the editor is built. */
export interface PluginInitContext {
  readonly editor: PluginEditor;
}

export interface EventContext {
  readonly state: EditorState;
  readonly dispatch: (tr: Transaction) => void;
  /** The focused block id, if any (the block owning the active contenteditable). */
  readonly focusBlockId: () => string | null;
  /** The editor instance, exposing the same surface as `PluginInitContext.editor`. */
  readonly editor: PluginEditor;
}

export interface Plugin {
  readonly name: string;

  /** Called once when the editor is created. Returns the initial plugin state.
   *  `ctx` carries a handle to the editor so the plugin can register
   *  extension methods on it. */
  init?(state: EditorState, ctx: PluginInitContext): PluginState;

  /**
   * Called for every applied transaction. Receives the transaction, the
   * *previous* state, and the new (doc/selection) state being assembled,
   * plus the same context as the event hooks. Returns the plugin's new
   * state slice.
   */
  applyTransaction?(
    tr: Transaction,
    prevState: EditorState,
    nextDoc: EditorState['doc'],
    nextSelection: EditorState['selection'],
    ctx: PluginInitContext,
  ): PluginState;

  onKeyDown?(event: KeyboardEvent, ctx: EventContext): boolean;
  onInput?(event: InputEvent, ctx: EventContext): boolean;
  onCompositionStart?(event: CompositionEvent, ctx: EventContext): void;
  onCompositionEnd?(event: CompositionEvent, ctx: EventContext): void;
  onDestroy?(): void;
}
