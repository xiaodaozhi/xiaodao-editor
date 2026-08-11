/**
 * Registry builder: flattens an extension list (resolving `uses`, de-duplic by
 * name with later entries overriding earlier ones) and assembles the frozen,
 * typed registries the editor consults at runtime.
 *
 * See docs/editor-architecture.md §5.2, §5.4.
 */

import type { BlockSchemaSpec } from '../schema/BlockSchema';
import type { BlockType } from '../types';
import type { AnyCommandEntry } from '../command/Command';
import { CommandRegistry } from '../command/Command';
import { InputRuleRegistry } from '../command/InputRule';
import { KeymapRegistry } from '../command/Keymap';
import { SlashCommandRegistry } from '../command/SlashCommand';
import type { BlockRendererSpec, Extension, ToolbarActionSpec } from './Extension';
import type { Plugin } from '../plugin/Plugin';
import { defineSchema } from '../schema/BlockSchema';
import { SchemaRegistry } from '../schema/SchemaRegistry';
import { DeserializerRegistry, SerializerRegistry } from '../serialize/Serializer';

/** Opaque renderer registry: maps a block type to its renderer spec. */
export class RendererRegistry {
  private readonly map: Map<BlockType, BlockRendererSpec> = new Map();
  register(type: BlockType, spec: BlockRendererSpec): void {
    if (this.map.has(type)) throw new Error(`BlockEditor: duplicate renderer for "${type}"`);
    this.map.set(type, spec);
  }

  get(type: BlockType): BlockRendererSpec | undefined {
    return this.map.get(type);
  }
}

export class ToolbarRegistry {
  private readonly map: Map<BlockType, readonly ToolbarActionSpec[]> = new Map();
  register(type: BlockType, actions: readonly ToolbarActionSpec[]): void {
    const existing = this.map.get(type) ?? [];
    this.map.set(type, [...existing, ...actions]);
  }

  get(type: BlockType): readonly ToolbarActionSpec[] {
    return this.map.get(type) ?? [];
  }
}

export interface EditorRegistries {
  readonly schema: SchemaRegistry;
  readonly renderers: RendererRegistry;
  readonly commands: CommandRegistry;
  readonly keymap: KeymapRegistry;
  readonly inputRules: InputRuleRegistry;
  readonly slash: SlashCommandRegistry;
  readonly toolbar: ToolbarRegistry;
  readonly serializers: SerializerRegistry;
  readonly deserializers: DeserializerRegistry;
  readonly plugins: readonly Plugin[];
  /** Extension-contributed commands (registered after primitives so they can override). */
  readonly extensionCommands: readonly AnyCommandEntry[];
  /** The block type used by "empty Enter exits" (default: 'paragraph'). */
  readonly defaultBlockType: BlockType;
}

export interface BuildRegistriesOptions {
  readonly defaultBlockType?: BlockType;
}

const FALLBACK_SCHEMA = defineSchema({ type: '__fallback__', content: 'text', nestable: false });

/**
 * Flatten an extension array: recursively expand `uses`, de-duplicate by name
 * keeping the *last* occurrence (so user-provided extensions override
 * built-ins with the same name).
 */
export function flattenExtensions(extensions: readonly Extension[]): Extension[] {
  const byName = new Map<string, Extension>();
  const walk = (ext: Extension): void => {
    if (ext.uses) for (const u of ext.uses) walk(u);
    byName.set(ext.name, ext); // last wins
  };
  for (const ext of extensions) walk(ext);
  return [...byName.values()];
}

export function buildRegistries(
  extensions: readonly Extension[],
  options: BuildRegistriesOptions = {},
): EditorRegistries {
  const flat = flattenExtensions(extensions);

  const schemas = new Map<BlockType, ReturnType<typeof defineSchema>>();
  const renderers = new RendererRegistry();
  const commands = new CommandRegistry();
  const keymap = new KeymapRegistry();
  const inputRules = new InputRuleRegistry();
  const slash = new SlashCommandRegistry();
  const toolbar = new ToolbarRegistry();
  const serializers = new SerializerRegistry();
  const deserializers = new DeserializerRegistry();
  const plugins: Plugin[] = [];
  const extensionCommands: AnyCommandEntry[] = [];

  for (const ext of flat) {
    let schemaSpec: BlockSchemaSpec | undefined;
    if (ext.schema) {
      schemaSpec = ext.schema;
      const schema = defineSchema(schemaSpec);
      schemas.set(schema.type, schema);
    }
    if (ext.renderer && schemaSpec) {
      renderers.register(schemaSpec.type, ext.renderer);
    }
    if (ext.commands) {
      for (const cmd of ext.commands) extensionCommands.push(cmd);
    }
    if (ext.keymap) keymap.register(ext.keymap);
    if (ext.inputRules) for (const r of ext.inputRules) inputRules.register(r);
    if (ext.slashCommands) for (const s of ext.slashCommands) slash.register(s);
    if (ext.toolbar && schemaSpec) toolbar.register(schemaSpec.type, ext.toolbar);
    if (ext.serialize && schemaSpec) serializers.register(schemaSpec.type, ext.serialize);
    if (ext.deserialize) deserializers.register(ext.deserialize);
    if (ext.plugins) for (const p of ext.plugins) plugins.push(p);
  }

  const defaultBlockType = options.defaultBlockType ?? 'paragraph';
  const schemaRegistry = new SchemaRegistry(schemas, FALLBACK_SCHEMA);

  return {
    schema: schemaRegistry,
    renderers,
    commands,
    keymap,
    inputRules,
    slash,
    toolbar,
    serializers,
    deserializers,
    plugins,
    extensionCommands,
    defaultBlockType,
  };
}
