/**
 * Default keymap extension: binds core editing keys to primitive commands.
 *
 * These are the keyboard shortcuts every text editor needs: Enter to
 * split/exit, Backspace to merge/delete, and Arrow keys for inter-block
 * navigation. Extensions may register additional keymaps with higher
 * priority to override these defaults.
 */

import type { Extension } from '../core/extension/Extension';

export const KeymapExtension: Extension = {
  name: 'default-keymap',
  keymap: [
    { key: 'Enter', command: 'enter' },
    { key: 'Backspace', command: 'backspace' },
    { key: 'Delete', command: 'backspace' },
    // Tab: 在支持缩进的文本块中增加缩进层级。
    // Shift-Tab: 减少缩进层级。
    { key: 'Tab', command: 'indentBlock' },
    { key: 'Shift-Tab', command: 'outdentBlock' },
    // Select all (cross-block): produces a text selection spanning the whole
    // document, rendered via the cross-block overlay when multiple blocks.
    { key: 'Mod-a', command: 'selectAll' },
    // Inter-block navigation. For Phase 1 (single-line blocks), ArrowUp/Down
    // always move between blocks. Multi-line caret navigation arrives when
    // blocks can contain line breaks.
    { key: 'ArrowUp', command: 'moveToPreviousBlock' },
    { key: 'ArrowDown', command: 'moveToNextBlock' },
  ],
};
