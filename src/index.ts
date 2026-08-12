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
export { editorKey, useEditor } from './view/context';
export type { BlockRenderItem } from './view/context';

// Built-in extensions
export { BuiltinExtensions } from './extensions/builtin';
export { ParagraphExtension } from './extensions/Paragraph';
export { HeadingExtension } from './extensions/Heading';
export { KeymapExtension } from './extensions/Keymap';
export { HistoryExtension } from './extensions/History';
export { ImageExtension } from './extensions/Image';
export type { ImageAttrs } from './extensions/Image';
export { TableExtension } from './extensions/Table';
export type { TableAttrs, TableCellData } from './extensions/tableModel';
export { DividerExtension } from './extensions/Divider';
export type { ImageUploadResult, UploadImageHandler } from './view/imageUpload';

// I18n + theme (re-exported so consumers can type props safely)
export type { Theme, Locale, I18nBundle } from './i18n';
export { useI18n, normalizeLocale, normalizeTheme } from './i18n';
