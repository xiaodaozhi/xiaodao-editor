/**
 * Shared schema attribute specs applied to every text-carrying block.
 * Keeps attrs consistent across Paragraph/Heading/List/etc. blocks.
 *
 * Attrs:
 *   align:   'left' | 'center' | 'right' | 'justify'
 *   color:   text color preset key (e.g. 'default', 'red-1', 'gray-2')
 *   bgColor: background color preset key (e.g. 'default', 'yellow-1')
 *   indent:  0-10, indentation level (0 = no indent)
 */

import type { BlockSchemaSpec } from '../core/schema/BlockSchema';
import type { Attrs } from '../core/types';

export type AlignValue = 'left' | 'center' | 'right' | 'justify';

const VALID_ALIGN: readonly AlignValue[] = ['left', 'center', 'right', 'justify'];

/** 支持缩进属性的块类型。 */
export const INDENT_TYPES: readonly string[] = [
  'paragraph',
  'heading',
  'orderedList',
  'bulletList',
  'todoList',
];

/** 缩进上限。 */
export const MAX_INDENT = 10;

export const COMMON_ATTRS = {
  align: {
    default: 'left' as const,
    validate: (v: unknown): boolean => VALID_ALIGN.includes(v as AlignValue),
  },
  color: {
    default: 'default' as const,
    validate: (v: unknown): boolean => typeof v === 'string' && v.length > 0,
  },
  bgColor: {
    default: 'default' as const,
    validate: (v: unknown): boolean => typeof v === 'string' && v.length > 0,
  },
  indent: {
    default: 0 as const,
    validate: (v: unknown): boolean =>
      typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= MAX_INDENT,
  },
} as const satisfies BlockSchemaSpec['attrs'];

/**
 * 不支持缩进的块类型（quote）使用此子集，
 * coerceAttrs 会自动丢弃 indent 属性。
 */
export const COMMON_ATTRS_NO_INDENT = {
  align: COMMON_ATTRS.align,
  color: COMMON_ATTRS.color,
  bgColor: COMMON_ATTRS.bgColor,
} as const satisfies BlockSchemaSpec['attrs'];

/**
 * 既不支持缩进也不支持对齐的块类型（codeBlock）使用此子集。
 * 代码块只能左对齐：coerceAttrs 会自动丢弃 align 和 indent 属性，
 * 这样将文本块转为代码块时会自动清除对齐属性。
 */
export const COMMON_ATTRS_NO_INDENT_NO_ALIGN = {
  color: COMMON_ATTRS.color,
  bgColor: COMMON_ATTRS.bgColor,
} as const satisfies BlockSchemaSpec['attrs'];

/**
 * 代码块（codeBlock）单独使用的空 attrs 集合。
 * 代码块不允许 color / bgColor / align / indent，
 * coerceAttrs 会自动丢弃以上所有属性，转换时自动清除。
 */
export const CODE_BLOCK_ATTRS = {} as const satisfies BlockSchemaSpec['attrs'];

/**
 * Apply common attrs (align/color/bgColor) as CSS classes so the playground
 * stylesheet can render them. The renderer uses `classList` instead of
 * inline styles for theming consistency.
 */
export function classesFromAttrs(attrs: Attrs): string[] {
  const cls: string[] = [];
  const a = attrs.align;
  if (typeof a === 'string' && a !== 'left') cls.push(`be-align-${a}`);
  const c = attrs.color;
  if (typeof c === 'string' && c !== 'default') cls.push(`be-color-${c}`);
  const b = attrs.bgColor;
  if (typeof b === 'string' && b !== 'default') cls.push(`be-bg-${b}`);
  const ind = attrs.indent;
  if (typeof ind === 'number' && ind > 0) cls.push(`be-indent-${ind}`);
  return cls;
}

/** Preset text + background colors shown in the block settings menu. */
export interface ColorPreset {
  readonly key: string;
  readonly label: string;
  readonly cssValue: string;
  /** Background opacity (0-1). Only meaningful for bg color presets. */
  readonly opacity: number;
}

export const TEXT_COLOR_PRESETS: readonly ColorPreset[] = [
  { key: 'default', label: 'Default', cssValue: 'var(--be-fg)', opacity: 1 },
  { key: 'gray', label: 'Gray', cssValue: 'var(--be-color-gray)', opacity: 1 },
  { key: 'brown', label: 'Brown', cssValue: 'var(--be-color-brown)', opacity: 1 },
  { key: 'orange', label: 'Orange', cssValue: 'var(--be-color-orange)', opacity: 1 },
  { key: 'yellow', label: 'Yellow', cssValue: 'var(--be-color-yellow)', opacity: 1 },
  { key: 'green', label: 'Green', cssValue: 'var(--be-color-green)', opacity: 1 },
  { key: 'blue', label: 'Blue', cssValue: 'var(--be-color-blue)', opacity: 1 },
  { key: 'purple', label: 'Purple', cssValue: 'var(--be-color-purple)', opacity: 1 },
  { key: 'pink', label: 'Pink', cssValue: 'var(--be-color-pink)', opacity: 1 },
  { key: 'red', label: 'Red', cssValue: 'var(--be-color-red)', opacity: 1 },
];

export const BG_COLOR_PRESETS: readonly ColorPreset[] = [
  { key: 'default', label: 'None', cssValue: 'transparent', opacity: 0 },
  { key: 'gray', label: 'Gray', cssValue: 'var(--be-swatch-bg-gray)', opacity: 0.15 },
  { key: 'brown', label: 'Brown', cssValue: 'var(--be-swatch-bg-brown)', opacity: 0.18 },
  { key: 'orange', label: 'Orange', cssValue: 'var(--be-swatch-bg-orange)', opacity: 0.18 },
  { key: 'yellow', label: 'Yellow', cssValue: 'var(--be-swatch-bg-yellow)', opacity: 0.18 },
  { key: 'green', label: 'Green', cssValue: 'var(--be-swatch-bg-green)', opacity: 0.18 },
  { key: 'blue', label: 'Blue', cssValue: 'var(--be-swatch-bg-blue)', opacity: 0.18 },
  { key: 'purple', label: 'Purple', cssValue: 'var(--be-swatch-bg-purple)', opacity: 0.18 },
  { key: 'pink', label: 'Pink', cssValue: 'var(--be-swatch-bg-pink)', opacity: 0.18 },
  { key: 'red', label: 'Red', cssValue: 'var(--be-swatch-bg-red)', opacity: 0.18 },
];
