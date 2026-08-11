/**
 * Input-rules engine: on every `BlockContent` input event, test the registered
 * input rules against the block's text leading up to the caret. If a rule
 * matches, fire its command (and strip the matched text when the rule's args
 * carry a `__stripPrefix` hint).
 *
 * The engine is called from `BlockContent.onInput` via a global helper exported
 * here. This keeps the per-block component small; the rule registry is the
 * single source of truth.
 */

import type { InputRuleRegistry } from '../../core/command/InputRule';
import type { Editor } from '../../core/Editor';
import type { BlockId } from '../../core/types';
import { inlineFromString } from '../../core/types';

export interface InputRuleRunContext {
  readonly editor: Editor;
  readonly registry: InputRuleRegistry;
  readonly blockId: BlockId;
  /** The full text currently in the block (after the just-typed character). */
  readonly text: string;
  /** True if we're in the middle of IME composition — we skip rules. */
  readonly composing?: boolean;
}

/**
 * Test all registered rules. Returns `true` if a rule matched and fired, so
 * the caller can stop syncing a setText (it was replaced by a transaction).
 *
 * For rule-matching we only examine the text currently in the block's leading
 * prefix (i.e. no newline; rules always match a single-line prefix up to the
 * caret). Because the editor's caret may be anywhere, `textBeforeCaret` is the
 * full block text passed in — rules are responsible for anchoring patterns with
 * `^…$`. This matches ProseMirror / Tiptap input-rule semantics.
 */
export function runInputRules(ctx: InputRuleRunContext): boolean {
  if (ctx.composing) return false;
  const { registry, blockId, text, editor } = ctx;

  // Walk rules in registration order.
  for (const rule of registry.all) {
    const m = rule.pattern.exec(text);
    if (!m) continue;

    // Build args, fall back to the match-less args builder.
    const built = rule.args?.(m);
    const argsRecord = built && typeof built === 'object' ? (built as Record<string, unknown>) : {};
    const finalArgs: Record<string, unknown> = { ...argsRecord };

    // Resolve the __currentBlock__ placeholder.
    if (finalArgs.id === '__currentBlock__') {
      finalArgs.id = blockId;
    }

    // Private hint: strip N leading characters from the block before applying.
    // Used by heading input rules (e.g. "## " → 3 chars).
    const strip = typeof argsRecord.__stripPrefix === 'number' ? argsRecord.__stripPrefix : 0;

    const command = editor.commands[rule.command];
    if (!command) continue;

    // Two-step: first strip prefix (setText) then apply the rule's command.
    // We build a single combined transaction ourselves to keep history as one
    // undo-step (the editor's history manager groups consecutive sync-less
    // dispatches per microtask via `beginGroup`; since we do two synchronous
    // dispatches we must explicitly bracket them).
    editor.history.beginGroup();
    try {
      if (strip > 0) {
        const stripped = text.slice(strip);
        const textCmd = editor.commands.setText;
        if (textCmd) {
          textCmd({ id: blockId, content: inlineFromString(stripped) });
        }
      }
      command(finalArgs);
    } finally {
      editor.history.endGroup();
    }
    return true;
  }
  return false;
}

/**
 * Returns true when a text change starts a slash-menu trigger: the user typed
 * "/" at the block start, or anywhere in an otherwise-empty block.
 *
 * This is a very lightweight check, called by `BlockContent` so it can signal
 * the root `BlockEditor` to open the slash menu. The menu is kept in the root
 * so it can float above sibling blocks without being clipped by a block's
 * `overflow: hidden` or similar.
 */
export function isSlashTrigger(text: string): boolean {
  if (!text.includes('/')) return false;
  // Accept "/" at start OR block with only "/…query".
  return text.startsWith('/') || /^\s*\/\S*/.test(text);
}
