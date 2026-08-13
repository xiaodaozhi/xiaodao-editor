/**
 * Built-in extensions bundle: the default set every editor instance should
 * include. Users can add more extensions or override these by providing
 * extensions with the same `name` (later entries win in `flattenExtensions`).
 *
 * Order matters only for keymap priority; all built-in keymaps use the
 * default priority (0). Extensions that need to override a built-in binding
 * should register with a lower priority number.
 */

import type { Extension } from '../core/extension/Extension';
import { ParagraphExtension } from './Paragraph';
import { HeadingExtension } from './Heading';
import { KeymapExtension } from './Keymap';
import { HistoryExtension } from './History';
import { BulletListExtension } from './BulletList';
import { OrderedListExtension } from './OrderedList';
import { TodoListExtension } from './TodoList';
import { QuoteExtension } from './Quote';
import { CodeBlockExtension } from './CodeBlock';
import { ImageExtension } from './Image';
import { TableExtension } from './Table';
import { DividerExtension } from './Divider';
import { TableOfContentsExtension } from './TableOfContents';

export const BuiltinExtensions: readonly Extension[] = [
  ParagraphExtension,
  HeadingExtension,
  BulletListExtension,
  OrderedListExtension,
  TodoListExtension,
  QuoteExtension,
  CodeBlockExtension,
  ImageExtension,
  TableExtension,
  DividerExtension,
  TableOfContentsExtension,
  KeymapExtension,
  HistoryExtension,
];

export { ParagraphExtension } from './Paragraph';
export { HeadingExtension } from './Heading';
export { KeymapExtension } from './Keymap';
export { HistoryExtension } from './History';
export { BulletListExtension } from './BulletList';
export { OrderedListExtension } from './OrderedList';
export { TodoListExtension } from './TodoList';
export { QuoteExtension } from './Quote';
export { CodeBlockExtension } from './CodeBlock';
export { ImageExtension } from './Image';
export { TableExtension, createTableCommands } from './Table';
export { DividerExtension } from './Divider';
export { TableOfContentsExtension } from './TableOfContents';
