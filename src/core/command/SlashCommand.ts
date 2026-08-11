/**
 * Slash commands: entries that appear in the slash menu / command palette.
 * The contract is defined here so the extension system is complete; the slash
 * menu UI and search logic land in Phase 2.
 */

import type { BlockType } from '../types';

export interface SlashCommandSpec {
  readonly id: string;
  readonly title: string;
  readonly keywords?: readonly string[];
  readonly description?: string;
  /** Opaque icon token; the view layer interprets it. */
  readonly icon?: unknown;
  /** Command to dispatch when chosen. */
  readonly command: string;
  readonly args?: unknown;
  /** If set, only show when the current block is one of these types. */
  readonly applicableTo?: readonly BlockType[];
  /** Optional category for visual grouping in the menu. */
  readonly category?: string;
}

export type SlashCommand = SlashCommandSpec;

export class SlashCommandRegistry {
  private readonly commands: Map<string, SlashCommand> = new Map();

  register(spec: SlashCommandSpec): void {
    if (this.commands.has(spec.id)) {
      throw new Error(`BlockEditor: duplicate slash command "${spec.id}"`);
    }
    this.commands.set(spec.id, spec);
  }

  get all(): readonly SlashCommand[] {
    return [...this.commands.values()];
  }

  /** Naive substring search over title + keywords; refined in Phase 2. */
  search(query: string): readonly SlashCommand[] {
    const q = query.trim().toLowerCase();
    if (!q) return this.all;
    return this.all.filter((c) => {
      const haystack = (c.title + ' ' + (c.keywords ?? []).join(' ')).toLowerCase();
      return haystack.includes(q);
    });
  }
}
