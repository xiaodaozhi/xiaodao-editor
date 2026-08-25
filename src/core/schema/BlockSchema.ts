/**
 * Block schema: the structural contract a block type declares so the core can
 * reason about it *without* knowing the type. The core never switches on
 * `block.type`; it asks the schema registry instead.
 *
 * See docs/architecture.md §5.3.
 */

import type { Attrs, Block, BlockType, JSONValue } from '../types';

export interface AttrSpec {
  /** Default value used when a block is created without this attr. */
  readonly default: JSONValue;
  /** Optional runtime validation; rejected attrs fall back to the default. */
  readonly validate?: (value: unknown) => boolean;
}

export interface BlockSchemaSpec {
  readonly type: BlockType;
  readonly attrs?: Readonly<Record<string, AttrSpec>>;
  /** Does this block own an editable inline text region? */
  readonly content?: 'text' | 'none';
  /** May this block contain child blocks? */
  readonly nestable?: boolean;
  /** Whitelist of allowed child types. Omit / '*' means any registered type. */
  readonly allowedChildren?: readonly BlockType[] | '*';
  /**
   * If true, this block is a boundary for delete/merge: Backspace at its start
   * will not merge it into the previous block (e.g. a code block).
   */
  readonly isolating?: boolean;
  /**
   * If true, this block is a list item (bullet / ordered / todo). Enter on a
   * non-empty item continues the list by inserting a new item of the same
   * type; Backspace at offset 0 converts it to a paragraph instead of
   * merging into the previous block. The core uses this schema flag rather
   * than switching on `block.type`.
   */
  readonly listLike?: boolean;
  /**
   * If false, inline marks (bold/italic/underline/strikethrough/code) and
   * block-level color/bgColor are not allowed on this block. When a block
   * is converted to a type with inlineMarks=false, all existing marks are
   * stripped and color/bgColor are reset to defaults.
   */
  readonly inlineMarks?: boolean;
  /**
   * Inline mark types that are disallowed on this block type even though
   * inlineMarks=true. Used when a block renders a mark globally (e.g. quote
   * blocks render italic by default) so the corresponding inline mark would
   * be redundant. The toggleMark command refuses to apply these; the UI
   * should disable the matching buttons.
   */
  readonly disallowedMarks?: readonly string[];
  /** Is this block "empty" (used for placeholder + "empty Enter exits")? */
  readonly empty?: (block: Block) => boolean;
}

export interface BlockSchema {
  readonly type: BlockType;
  readonly attrs: Readonly<Record<string, AttrSpec>>;
  readonly content: 'text' | 'none';
  readonly nestable: boolean;
  readonly allowedChildren: readonly BlockType[] | '*';
  readonly isolating: boolean;
  readonly listLike: boolean;
  readonly inlineMarks: boolean;
  readonly disallowedMarks: readonly string[];
  readonly empty: (block: Block) => boolean;
}

const DEFAULT_SCHEMA: Omit<BlockSchema, 'type'> = {
  attrs: {},
  content: 'text',
  nestable: false,
  allowedChildren: '*',
  isolating: false,
  listLike: false,
  inlineMarks: true,
  disallowedMarks: [],
  empty: (block) => block.content.length === 0 || block.content.every((n) => n.text === ''),
};

/** Normalize a spec into a full schema with defaults applied. */
export function defineSchema(spec: BlockSchemaSpec): BlockSchema {
  return {
    type: spec.type,
    attrs: spec.attrs ?? {},
    content: spec.content ?? 'text',
    nestable: spec.nestable ?? false,
    allowedChildren: spec.allowedChildren ?? '*',
    isolating: spec.isolating ?? false,
    listLike: spec.listLike ?? false,
    inlineMarks: spec.inlineMarks ?? true,
    disallowedMarks: spec.disallowedMarks ?? [],
    empty: spec.empty ?? DEFAULT_SCHEMA.empty,
  };
}

/** Compute the default attrs for a schema (used when creating a block). */
export function defaultAttrs(schema: BlockSchema): Attrs {
  const out: Record<string, JSONValue> = {};
  for (const [name, spec] of Object.entries(schema.attrs)) {
    out[name] = spec.default;
  }
  return out;
}

/** Coerce arbitrary attrs through a schema, validating and filling defaults. */
export function coerceAttrs(schema: BlockSchema, raw: Readonly<Record<string, unknown>>): Attrs {
  const out: Record<string, JSONValue> = {};
  for (const [name, spec] of Object.entries(schema.attrs)) {
    const value = raw[name];
    if (value !== undefined && (!spec.validate || spec.validate(value))) {
      out[name] = value as JSONValue;
    } else {
      out[name] = spec.default;
    }
  }
  return out;
}

/** Does the parent schema permit a child of the given type? */
export function canContain(parent: BlockSchema, childType: BlockType): boolean {
  if (!parent.nestable) return false;
  if (parent.allowedChildren === '*') return true;
  return parent.allowedChildren.includes(childType);
}

export function hasText(schema: BlockSchema): boolean {
  return schema.content === 'text';
}

export function isIsolating(schema: BlockSchema): boolean {
  return schema.isolating;
}

export function isEmpty(schema: BlockSchema, block: Block): boolean {
  return schema.empty(block);
}
