/**
 * Command system. Commands are pure functions of the shape popularized by
 * ProseMirror: `(args) => (state, dispatch?) => boolean`. They inspect state
 * and, if applicable, build a transaction and call `dispatch`. Returning
 * `true` means "handled" (so keymaps can fall through).
 *
 * See docs/editor-architecture.md §7.1.
 */

import type { EditorState } from '../state/EditorState';
import type { Transaction } from '../state/Transaction';

export type Dispatch = (tr: Transaction) => void;

export type CommandFn<TArgs = void> = (args: TArgs) => (state: EditorState, dispatch?: Dispatch) => boolean;

export interface CommandEntry<TArgs = void> {
  readonly name: string;
  readonly run: CommandFn<TArgs>;
}

/** A command contributed by an extension. */
export type CommandSpec<TArgs = void> = CommandEntry<TArgs>;

/**
 * A command entry with type-erased arguments, as stored in the registry.
 * The registry is fundamentally heterogeneous (each command has its own arg
 * type), so the arg type is erased at registration. Type safety is preserved
 * at definition sites (`CommandEntry<YourArgs>`) and at typed command proxies.
 */

export type AnyCommandEntry = CommandEntry<any>;

/** Resolves a command name + args to a boolean (handled?), given live state. */
export type CommandDispatcher = (name: string, args: unknown) => boolean;

export class CommandRegistry {
  private readonly entries: Map<string, AnyCommandEntry> = new Map();

  register(spec: AnyCommandEntry): void {
    if (this.entries.has(spec.name)) {
      throw new Error(`BlockEditor: duplicate command "${spec.name}"`);
    }
    this.entries.set(spec.name, spec);
  }

  /** Replace an existing command (used so extensions can override primitives). */
  override(spec: AnyCommandEntry): void {
    this.entries.set(spec.name, spec);
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  get(name: string): AnyCommandEntry | undefined {
    return this.entries.get(name);
  }

  /**
   * Build a proxy so callers can write `editor.commands.insertBlock({...})`.
   * Each property access returns a function that dispatches the named command.
   */
  createProxy(dispatch: CommandDispatcher): Record<string, (...args: unknown[]) => boolean> {
    const target = this.entries;
    return new Proxy(
      {},
      {
        get: (_t, prop: string) => {
          if (!target.has(prop)) {
            return () => {
              // Unknown command — treat as "not handled".
              return false;
            };
          }
          return (args: unknown) => dispatch(prop, args);
        },
      },
    );
  }
}
