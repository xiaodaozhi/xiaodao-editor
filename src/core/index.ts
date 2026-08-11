/**
 * Public surface of the framework-agnostic editor core. The view layer and
 * extensions import from here. Nothing in this barrel imports Vue.
 */

export * from './types';
export { createBlockId, asBlockId } from './ids';
export type {
  BlockSchema,
  BlockSchemaSpec,
  AttrSpec,
} from './schema/BlockSchema';
export {
  defineSchema,
  defaultAttrs,
  coerceAttrs,
  canContain,
  hasText,
  isIsolating,
  isEmpty,
} from './schema/BlockSchema';
export { SchemaRegistry } from './schema/SchemaRegistry';

export * from './state/store';
export type { Step } from './state/Step';
export { applySteps, type ApplyResult } from './state/Step';
export { createState, applyTransaction, type EditorState, type ApplyTransactionResult } from './state/EditorState';
export {
  createTransaction,
  TransactionBuilder,
  type Transaction,
  type TransactionMeta,
  type InsertBlockParams,
} from './state/Transaction';
export { invertSteps } from './state/invert';

export * from './selection/Selection';

export type { CommandFn, CommandEntry, CommandSpec, AnyCommandEntry, Dispatch, CommandDispatcher } from './command/Command';
export { CommandRegistry } from './command/Command';
export { createPrimitiveCommands } from './command/primitiveCommands';
export type { KeymapBinding, KeymapSpec } from './command/Keymap';
export { KeymapRegistry, keyNameFromEvent, keyMatches } from './command/Keymap';
export type { InputRuleSpec, InputRule } from './command/InputRule';
export { InputRuleRegistry } from './command/InputRule';
export type { SlashCommandSpec, SlashCommand } from './command/SlashCommand';
export { SlashCommandRegistry } from './command/SlashCommand';

export type { SerializerSpec, DeserializerSpec, SerializeResult } from './serialize/Serializer';
export { SerializerRegistry, DeserializerRegistry } from './serialize/Serializer';

export type { Plugin, PluginState, EventContext } from './plugin/Plugin';
export type { Extension, BlockRendererSpec, ToolbarActionSpec } from './extension/Extension';
export { extensionBlockType } from './extension/Extension';
export { flattenExtensions, buildRegistries } from './extension/Registry';
export type {
  EditorRegistries,
  RendererRegistry,
  ToolbarRegistry,
  BuildRegistriesOptions,
} from './extension/Registry';

export { HistoryManager } from './history/HistoryManager';
export { Editor } from './Editor';
export type { EditorConfig, StateUpdate, EditorListener } from './Editor';
