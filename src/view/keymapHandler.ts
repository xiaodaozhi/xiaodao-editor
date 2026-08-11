/**
 * Keyboard event router: resolves a `KeyboardEvent` against the keymap
 * registry and dispatches the bound command.
 *
 * Selection sync (DOM → state) is handled by the caller (`BlockEditor.vue`)
 * *before* invoking this function, so commands receive an up-to-date
 * selection.
 */

import type { Editor } from '../core/Editor';
import { keyNameFromEvent } from '../core/command/Keymap';

/**
 * Resolve a keyboard event to a command and dispatch it.
 * Returns `true` if a binding matched and the command returned `true`
 * (handled). The caller should `preventDefault()` in that case.
 */
export function dispatchKeymap(editor: Editor, event: KeyboardEvent): boolean {
  const key = keyNameFromEvent(event);
  if (!key) return false;

  const binding = editor.registries.keymap.resolve(key);
  if (!binding) return false;

  const handler = editor.commands[binding.command];
  if (!handler) return false;

  return handler(binding.args) === true;
}
