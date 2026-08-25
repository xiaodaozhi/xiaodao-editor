/**
 * The `Extension` contract: the single mechanism by which the editor gains new
 * block types and behaviors. An extension is a plain spec object (produced by
 * a factory) contributed to the editor at construction. The core never imports
 * extensions; it only processes their specs into registries.
 *
 * Each field is optional — an extension contributes only what it needs. A
 * block-type extension (e.g. `Heading`) provides `schema` + `renderer` +
 * `serialize`/`deserialize`; a behavior extension (e.g. `History`) provides
 * only `plugins`.
 *
 * See docs/architecture.md §5.
 */

import type { BlockSchemaSpec } from '../schema/BlockSchema';
import type { BlockType } from '../types';
import type { AnyCommandEntry } from '../command/Command';
import type { InputRuleSpec } from '../command/InputRule';
import type { KeymapSpec } from '../command/Keymap';
import type { Plugin } from '../plugin/Plugin';
import type { SlashCommandSpec } from '../command/SlashCommand';
import type { DeserializerSpec, SerializerSpec } from '../serialize/Serializer';

/**
 * Framework-opaque renderer spec. `component` is a Vue component in practice
 * but typed as `unknown` so the core stays framework-agnostic; the view layer
 * (`BlockHost`) interprets it.
 */
export interface BlockRendererSpec {
  readonly component: unknown;
  /** Does this block own a contenteditable text region? Default: from schema. */
  readonly editable?: boolean;
}

export interface ToolbarActionSpec {
  readonly id: string;
  readonly label: string;
  readonly command: string;
  readonly args?: unknown;
  readonly icon?: unknown;
}

export interface Extension {
  readonly name: string;
  /** Other extensions this one bundles. Flattened and de-duplicated by name. */
  readonly uses?: readonly Extension[];

  /** Declares a block type (schema). */
  readonly schema?: BlockSchemaSpec;
  /** Vue component that renders blocks of this type. */
  readonly renderer?: BlockRendererSpec;
  /** Commands contributed by this extension. */
  readonly commands?: readonly AnyCommandEntry[];
  /** Keyboard shortcut → command bindings. */
  readonly keymap?: KeymapSpec;
  /** Text patterns → command (activated in Phase 2). */
  readonly inputRules?: readonly InputRuleSpec[];
  /** Slash-menu / command-palette entries (activated in Phase 2). */
  readonly slashCommands?: readonly SlashCommandSpec[];
  /** Hover/insert toolbar actions (activated in Phase 4). */
  readonly toolbar?: readonly ToolbarActionSpec[];
  /** Per-block serialization (Markdown/HTML). */
  readonly serialize?: SerializerSpec;
  /** Per-block deserialization (Markdown/HTML). */
  readonly deserialize?: DeserializerSpec;
  /** Editor-level plugins (history, keymap, selection sync, …). */
  readonly plugins?: readonly Plugin[];
}

/** A block type this extension declares (for convenience). */
export function extensionBlockType(ext: Extension): BlockType | null {
  return ext.schema?.type ?? null;
}
