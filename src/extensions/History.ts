/**
 * History keymap extension: binds undo/redo shortcuts.
 *
 * The actual undo/redo logic lives in the `HistoryManager` (owned by the
 * `Editor`) and the `undo`/`redo` core commands. This extension only
 * contributes the keyboard bindings so users can press Mod+Z / Mod+Shift+Z.
 *
 * On Mac: Cmd+Z (undo), Cmd+Shift+Z (redo).
 * On Windows: Ctrl+Z (undo), Ctrl+Y (redo), Ctrl+Shift+Z (redo).
 */

import type { Extension } from '../core/extension/Extension';

export const HistoryExtension: Extension = {
  name: 'history-keymap',
  keymap: [
    { key: 'Mod-z', command: 'undo' },
    { key: 'Mod-Shift-z', command: 'redo' },
    { key: 'Mod-y', command: 'redo' },
  ],
};
