/**
 * The `Editor` facade: the framework-agnostic core's public surface. It owns
 * the registries, the current `EditorState`, the history manager, the command
 * dispatch, and plugin lifecycle. The view layer (`view/createEditor.ts`)
 * assembles built-in + user extensions and constructs this.
 *
 * Core invariants enforced here:
 *  - State changes ONLY through `dispatch(transaction)`.
 *  - Plugins receive events via typed hooks; the view never calls plugins directly.
 *
 * See docs/editor-architecture.md §10 (state management), §13 (Editor facade).
 */

import type { Block, BlockId, DocState, DocumentData, Selection } from './types';
import { docFromData, docToData, flatten, getBlock } from './state/store';
import { applyTransaction, createState, type EditorState } from './state/EditorState';
import type { Transaction } from './state/Transaction';
import { buildRegistries, type EditorRegistries } from './extension/Registry';
import type { Extension } from './extension/Extension';
import { createPrimitiveCommands } from './command/primitiveCommands';
import type { CommandDispatcher } from './command/Command';
import type { EventContext } from './plugin/Plugin';
import { HistoryManager } from './history/HistoryManager';
import { caretSelection } from './selection/Selection';
import { createBlockId } from './ids';

export interface EditorConfig {
  readonly extensions: readonly Extension[];
  readonly defaultBlockType?: string;
  readonly initialDocument?: DocumentData;
  readonly initialSelection?: Selection;
  readonly editable?: boolean;
  readonly historyLimit?: number;
}

export interface StateUpdate {
  readonly state: EditorState;
  readonly changed: ReadonlySet<BlockId>;
  readonly removed: ReadonlySet<BlockId>;
}

export type EditorListener = (update: StateUpdate) => void;

/** Public read-only history API exposed by the Editor facade. */
export interface EditorHistory {
  /** True if an undo entry exists. */
  canUndo(): boolean;
  /** True if a redo entry exists. */
  canRedo(): boolean;
  /**
   * Open an explicit grouping scope. Any `dispatch` between `beginGroup()` and
   * the matching `endGroup()` merges into one undo entry. Scopes nest; only
   * the outermost close "commits". Prefer this over using the
   * `meta.historyGroup` key manually.
   */
  beginGroup(): string;
  /** Close an explicit grouping scope opened by `beginGroup()`. */
  endGroup(): void;
}

export class Editor {
  readonly registries: EditorRegistries;
  private state: EditorState;
  private readonly listeners = new Set<EditorListener>();
  private readonly _history: HistoryManager;
  readonly commands: Record<string, (...args: unknown[]) => boolean>;
  editable: boolean;
  /** The block id currently owning the focused contenteditable (set by the view). */
  focusBlockId: BlockId | null = null;

  /** Public history API: canUndo/canRedo plus grouping helpers. */
  readonly history: EditorHistory;

  constructor(config: EditorConfig) {
    this.registries = buildRegistries(config.extensions, {
      defaultBlockType: config.defaultBlockType,
    });

    // Register primitive commands first (defaults), then let extensions override.
    for (const cmd of createPrimitiveCommands(this.registries)) {
      this.registries.commands.register(cmd);
    }
    for (const cmd of this.registries.extensionCommands) {
      if (this.registries.commands.has(cmd.name)) {
        this.registries.commands.override(cmd);
      } else {
        this.registries.commands.register(cmd);
      }
    }

    // Build the initial document, ensuring at least one default block.
    const { doc } = docFromData(config.initialDocument ?? { blocks: [] });
    const docWithContent = doc.root.length === 0 ? this.seedEmptyDocument(doc.id) : doc;

    // Initialise plugins.
    const pluginState: Record<string, unknown> = {};
    const firstBlockId = docWithContent.root[0] ?? null;
    const selection: Selection
      = config.initialSelection ?? (firstBlockId ? caretSelection(firstBlockId, 0) : { kind: 'blocks', blockIds: [] });
    const initialState = createState(docWithContent, selection, pluginState);
    for (const plugin of this.registries.plugins) {
      if (plugin.init) pluginState[plugin.name] = plugin.init(initialState);
    }
    this.state = initialState;

    this._history = new HistoryManager(config.historyLimit);
    const hm = this._history;
    this.history = {
      canUndo: () => hm.canUndo(),
      canRedo: () => hm.canRedo(),
      beginGroup: () => hm.beginGroup(),
      endGroup: () => hm.endGroup(),
    };
    this.editable = config.editable ?? true;

    // Undo/redo are core commands because they require the HistoryManager,
    // which the Editor owns. Extensions can still override them by name.
    this.registries.commands.register({
      name: 'undo',
      run: () => (_state, dispatch) => {
        if (!dispatch) return this._history.canUndo();
        const tr = this._history.undo();
        if (tr) {
          dispatch(tr);
          return true;
        }
        return false;
      },
    });
    this.registries.commands.register({
      name: 'redo',
      run: () => (_state, dispatch) => {
        if (!dispatch) return this._history.canRedo();
        const tr = this._history.redo();
        if (tr) {
          dispatch(tr);
          return true;
        }
        return false;
      },
    });

    const dispatcher: CommandDispatcher = (name, args) => {
      const entry = this.registries.commands.get(name);
      if (!entry) return false;
      return entry.run(args)(this.state, (tr) => this.dispatch(tr));
    };
    this.commands = this.registries.commands.createProxy(dispatcher);
  }

  // --- State access -------------------------------------------------------

  getState(): EditorState {
    return this.state;
  }

  toData(): DocumentData {
    return docToData(this.state.doc);
  }

  /** Replace the whole document (e.g. on external `v-model` change). Resets history. */
  setDocument(json: DocumentData): void {
    const { doc } = docFromData(json);
    const docWithContent = doc.root.length === 0 ? this.seedEmptyDocument(doc.id) : doc;
    const firstBlockId = docWithContent.root[0] ?? null;
    const selection: Selection = firstBlockId
      ? caretSelection(firstBlockId, 0)
      : { kind: 'blocks', blockIds: [] };
    const pluginState: Record<string, unknown> = {};
    const next = createState(docWithContent, selection, pluginState);
    for (const plugin of this.registries.plugins) {
      if (plugin.init) pluginState[plugin.name] = plugin.init(next);
    }
    this.state = next;
    this._history.reset();
    this.notify({ state: next, changed: new Set(flatten(docWithContent)), removed: new Set() });
  }

  // --- Mutation -----------------------------------------------------------

  dispatch(tr: Transaction): void {
    const prev = this.state;
    const result = applyTransaction(prev, tr, this.registries.plugins);
    this.state = result.state;
    this._history.record(tr, prev.selection, prev.doc);
    this.notify(result);
  }

  undo(): boolean {
    const tr = this._history.undo();
    if (!tr) return false;
    this.dispatch(tr);
    return true;
  }

  redo(): boolean {
    const tr = this._history.redo();
    if (!tr) return false;
    this.dispatch(tr);
    return true;
  }

  canUndo(): boolean {
    return this._history.canUndo();
  }

  canRedo(): boolean {
    return this._history.canRedo();
  }

  // --- Subscription -------------------------------------------------------

  subscribe(listener: EditorListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(update: StateUpdate): void {
    for (const listener of this.listeners) listener(update);
  }

  // --- Plugin event dispatch (called by the view layer) -------------------

  private eventContext(): EventContext {
    return {
      state: this.state,
      dispatch: (tr) => this.dispatch(tr),
      focusBlockId: () => this.focusBlockId,
    };
  }

  handleKeyDown(event: KeyboardEvent): boolean {
    const ctx = this.eventContext();
    for (const plugin of this.registries.plugins) {
      if (plugin.onKeyDown?.(event, ctx)) return true;
    }
    return false;
  }

  handleInput(event: InputEvent): boolean {
    const ctx = this.eventContext();
    for (const plugin of this.registries.plugins) {
      if (plugin.onInput?.(event, ctx)) return true;
    }
    return false;
  }

  handleCompositionStart(event: CompositionEvent): void {
    const ctx = this.eventContext();
    for (const plugin of this.registries.plugins) plugin.onCompositionStart?.(event, ctx);
  }

  handleCompositionEnd(event: CompositionEvent): void {
    const ctx = this.eventContext();
    for (const plugin of this.registries.plugins) plugin.onCompositionEnd?.(event, ctx);
  }

  destroy(): void {
    for (const plugin of this.registries.plugins) plugin.onDestroy?.();
    this.listeners.clear();
  }

  // --- Internal -----------------------------------------------------------

  private seedEmptyDocument(docId: string): DocState {
    const id = createBlockId();
    const type = this.registries.defaultBlockType;
    const block: Block = {
      id,
      type,
      attrs: this.registries.schema.defaultAttrsFor(type),
      content: [],
      children: [],
    };
    const blocks = new Map<BlockId, Block>([[id, block]]);
    const parent = new Map<BlockId, BlockId | null>([[id, null]]);
    return { id: docId, root: [id], blocks, parent };
  }
}

/** Validate that a block id exists in the current state (debugging helper). */
export function hasBlock(editor: Editor, id: BlockId): boolean {
  return getBlock(editor.getState().doc, id) !== undefined;
}
