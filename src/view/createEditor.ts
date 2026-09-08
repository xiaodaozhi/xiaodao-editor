/**
 * Headless editor factory: the framework-agnostic way to build an `Editor`,
 * and the counterpart of `<BlockEditor :editor="editor">`.
 *
 * Despite living under `src/view/` this module imports zero Vue: it is the
 * assembly point the `Editor` class comment refers to, and it sits next to its
 * only in-repo consumer for that reason.
 *
 * Why this exists instead of calling `new Editor()` directly:
 *  - `EditorConfig.extensions` is REQUIRED, so a headless caller would have to
 *    know about `BuiltinExtensions` and import it themselves. Here it is the
 *    default, which is exactly the policy `<BlockEditor>` applies to its
 *    `extensions` prop.
 *  - It is the single place that owns "which extensions does a default editor
 *    get", so the component path and the headless path cannot drift apart.
 *  - It is the natural home for dev-only config sanity checks (empty extension
 *    list, block types with no registered schema).
 *
 * Ownership: the caller owns the returned instance and is responsible for
 * calling `editor.destroy()` exactly once. `<BlockEditor :editor>` never
 * destroys an injected instance.
 */

import { Editor } from '../core/Editor';
import type { EditorConfig } from '../core/Editor';
import type { Extension } from '../core/extension/Extension';
import { BuiltinExtensions } from '../extensions/builtin';

/**
 * Same as `EditorConfig`, except `extensions` is optional: when omitted the
 * built-in bundle (`BuiltinExtensions`) is used.
 */
export type CreateEditorOptions = Omit<EditorConfig, 'extensions'> & {
  readonly extensions?: readonly Extension[];
};

export function createEditor(options: CreateEditorOptions = {}): Editor {
  const extensions = options.extensions ?? BuiltinExtensions;
  const editor = new Editor({ ...options, extensions });

  if (import.meta.env.DEV) {
    if (extensions.length === 0) {
      // eslint-disable-next-line no-console -- intentional DEV-only warning
      console.warn(
        '[xiaodao-editor] createEditor(): `extensions` is empty, so no block type is registered. '
        + 'Pass `extensions: BuiltinExtensions` (or your own list), or omit the option entirely.',
      );
    }

    const unknown = new Set<string>();
    for (const block of editor.getState().doc.blocks.values()) {
      if (!editor.registries.schema.has(block.type)) unknown.add(block.type);
    }
    if (unknown.size > 0) {
      // eslint-disable-next-line no-console -- intentional DEV-only warning
      console.warn(
        `[xiaodao-editor] createEditor(): initialData (or its parsed Markdown) contains block type(s) [${[...unknown].join(', ')}] `
        + 'with no registered schema; they fall back to a paragraph-like schema and may lose '
        + 'content. Add the matching extension to `extensions`.',
      );
    }
  }

  return editor;
}
