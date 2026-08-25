/**
 * Keymap: binds normalized keyboard shortcuts to commands. Bindings are
 * ordered by priority; the first match wins and a handler returning `true`
 * stops propagation. Key names follow ProseMirror conventions
 * (e.g. "Mod-Enter", "Shift-ArrowUp", "Backspace").
 *
 * See docs/architecture.md §11.1.
 */

export interface KeymapBinding {
  /** Normalized key, e.g. "Enter", "Shift-Tab", "Mod-B", "ArrowUp". */
  readonly key: string;
  /** Command name to dispatch when the key matches. */
  readonly command: string;
  /** Args passed to the command. */
  readonly args?: unknown;
  /** Lower numbers run first. Default 0. */
  readonly priority?: number;
}

export type KeymapSpec = readonly KeymapBinding[];

const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
  ? 'Cmd'
  : 'Ctrl';

const ALIASES: Record<string, string> = {
  Esc: 'Escape',
  Del: 'Delete',
  Space: ' ',
  Left: 'ArrowLeft',
  Right: 'ArrowRight',
  Up: 'ArrowUp',
  Down: 'ArrowDown',
};

/**
 * Derive a normalized key name from a keyboard event. Produces the *actual*
 * platform modifier (Ctrl or Cmd), not a generic "Mod" token. Binding keys
 * use "Mod" as a placeholder; `keyMatches` resolves it to the same actual
 * modifier before comparing.
 *
 * Example: Cmd+Shift+Z on Mac → "Cmd-Shift-Z".
 */
export function keyNameFromEvent(event: KeyboardEvent): string {
  const parts: string[] = [];
  if (event.ctrlKey) parts.push('Ctrl');
  if (event.metaKey) parts.push('Cmd');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');

  let key = event.key;
  if (key === 'Meta' || key === 'Control') return ''; // modifier alone — not a binding
  // Letter keys normalized to uppercase for stable matching.
  if (key.length === 1) key = key.toUpperCase();
  key = ALIASES[key] ?? key;

  parts.push(key);
  return parts.join('-');
}

/**
 * Match a binding key (which may use "Mod" as a placeholder) against an
 * event key (which uses the actual modifier: Ctrl or Cmd).
 *
 * Comparison is case-insensitive so that binding keys may use lowercase
 * letters (e.g. "Mod-z") while event keys use uppercase ("Cmd-Z").
 */
export function keyMatches(bindingKey: string, eventKey: string): boolean {
  const normalized = bindingKey.replace(/\bMod\b/g, MOD);
  return normalized.toLowerCase() === eventKey.toLowerCase();
}

export class KeymapRegistry {
  private readonly bindings: KeymapBinding[] = [];

  register(spec: KeymapSpec): void {
    for (const b of spec) this.bindings.push(b);
    this.bindings.sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
  }

  /** Resolve the first matching binding for an event key. */
  resolve(eventKey: string): KeymapBinding | undefined {
    return this.bindings.find((b) => keyMatches(b.key, eventKey));
  }
}
