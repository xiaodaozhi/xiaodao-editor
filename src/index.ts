/**
 * Public entry point for the xiaodao-editor package.
 *
 * Exports:
 *  - Core types and engine (framework-agnostic)
 *  - Vue components (BlockEditor, BlockList, BlockHost, BlockContent)
 *  - Built-in extensions (Paragraph, Heading, Keymap, History)
 *  - Extension/Schema/Command building blocks for custom block types
 */

// Core engine (framework-agnostic)
export * from './core/index';

// Vue components
export { default as BlockEditor } from './view/BlockEditor.vue';
export { default as BlockList } from './view/BlockList.vue';
export { default as BlockHost } from './view/BlockHost.vue';
export { default as BlockContent } from './view/BlockContent.vue';
// Headless editor factory (framework-agnostic; pairs with `<BlockEditor :editor>`)
export { createEditor } from './view/createEditor';
export type { CreateEditorOptions } from './view/createEditor';

export { editorKey, useEditor } from './view/context';
export type { BlockRenderItem } from './view/context';

// Built-in extensions
export { BuiltinExtensions } from './extensions/builtin';
export { ParagraphExtension } from './extensions/Paragraph';
export { HeadingExtension } from './extensions/Heading';
export { KeymapExtension } from './extensions/Keymap';
export { HistoryExtension } from './extensions/History';
export { ImageExtension } from './extensions/Image';
export {
  createImageExtension,
  CANCEL_IMAGE_UPLOAD_COMMAND,
  START_IMAGE_UPLOAD_METHOD,
} from './extensions/Image';
export type { ImageAttrs, ImageExtensionOptions } from './extensions/Image';
export {
  EquationExtension,
  createEquationExtension,
  builtinEquationRenderer,
  EquationBlock,
  renderEquation,
} from './extensions/Equation';
export type {
  EquationAttrs,
  EquationDiagnostic,
  EquationExtensionOptions,
  EquationRenderer,
  EquationRenderOptions,
  EquationRenderResult,
  RenderResult,
} from './extensions/Equation';

// Built-in math engine (advanced usage: custom renderers, tooling)
export { parseMath, SUPPORTED_COMMANDS } from './extensions/math';
export type { MathNode, ParseResult as MathParseResult } from './extensions/math';
export { TableExtension } from './extensions/Table';
export type { TableAttrs, TableCellData } from './extensions/tableModel';
export { DividerExtension } from './extensions/Divider';
export { TableOfContentsExtension } from './extensions/TableOfContents';
export type { ImageUploadResult, UploadImageHandler } from './view/imageUpload';

// I18n + theme (re-exported so consumers can type props safely)
export type { Theme, Locale, I18nBundle } from './i18n';
export { useI18n, normalizeLocale, normalizeTheme } from './i18n';
