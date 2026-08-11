/**
 * Schema registry: maps a `BlockType` to its `BlockSchema`. Built once from
 * extensions and frozen. Provides structural predicates the core uses instead
 * of switching on type names.
 *
 * See docs/editor-architecture.md §5.2.
 */

import type { Block, BlockType } from '../types';
import { type BlockSchema, canContain, coerceAttrs, defaultAttrs, hasText, isEmpty, isIsolating } from './BlockSchema';

export class SchemaRegistry {
  private readonly schemas: ReadonlyMap<BlockType, BlockSchema>;
  private readonly fallback: BlockSchema;

  constructor(schemas: ReadonlyMap<BlockType, BlockSchema>, fallback: BlockSchema) {
    this.schemas = schemas;
    this.fallback = fallback;
  }

  /** Resolve a schema by type, falling back to the paragraph-like default. */
  get(type: BlockType): BlockSchema {
    return this.schemas.get(type) ?? this.fallback;
  }

  has(type: BlockType): boolean {
    return this.schemas.has(type);
  }

  /** Compute default attrs for a type (used when creating a block). */
  defaultAttrsFor(type: BlockType) {
    return defaultAttrs(this.get(type));
  }

  /** Coerce raw attrs through the type's schema. */
  coerceAttrsFor(type: BlockType, raw: Readonly<Record<string, unknown>>) {
    return coerceAttrs(this.get(type), raw);
  }

  canContain(parentType: BlockType, childType: BlockType): boolean {
    return canContain(this.get(parentType), childType);
  }

  hasText(type: BlockType): boolean {
    return hasText(this.get(type));
  }

  isIsolating(type: BlockType): boolean {
    return isIsolating(this.get(type));
  }

  isListLike(type: BlockType): boolean {
    return this.get(type).listLike;
  }

  hasInlineMarks(type: BlockType): boolean {
    return this.get(type).inlineMarks;
  }

  /** Is the given inline mark type disallowed on this block type? */
  isMarkDisallowed(type: BlockType, markType: string): boolean {
    return this.get(type).disallowedMarks.includes(markType);
  }

  isEmpty(block: Block): boolean {
    return isEmpty(this.get(block.type), block);
  }
}
