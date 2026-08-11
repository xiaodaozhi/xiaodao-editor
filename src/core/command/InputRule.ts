/**
 * Input rules: text patterns that trigger a command when typed at the caret
 * (e.g. `# ` → convert to heading). The contract is defined here so the
 * extension system is complete; the InputRules plugin that runs them lands in
 * Phase 2.
 */

import type { BlockId } from '../types';

export interface InputRuleContext {
  readonly blockId: BlockId;
  /** Full block text up to and including the just-typed character. */
  readonly textBeforeCaret: string;
}

export interface InputRuleSpec {
  readonly name: string;
  /** Tested against `textBeforeCaret`. Must be anchored (e.g. /^# $/). */
  readonly pattern: RegExp;
  /** Command to dispatch when the pattern matches. */
  readonly command: string;
  /** Build command args from the match (optional). */
  readonly args?: (match: RegExpExecArray) => unknown;
}

export type InputRule = InputRuleSpec;

export class InputRuleRegistry {
  private readonly rules: InputRule[] = [];

  register(spec: InputRuleSpec): void {
    this.rules.push(spec);
  }

  get all(): readonly InputRule[] {
    return this.rules;
  }
}
