/**
 * Per-block serialization contracts. Canonical JSON import/export is handled
 * centrally by `state/store.ts` (`docFromData` / `docToData`). These specs let
 * each block type contribute Markdown (Phase 2) and HTML (Phase 5) round-trips
 * without core changes.
 */

import type { Attrs, Block, BlockType, InlineSeq } from '../types';

export interface SerializeResult {
  readonly type: BlockType;
  readonly attrs?: Attrs;
  readonly content?: InlineSeq;
}

export interface SerializerSpec {
  /** Serialize a block to a Markdown line/representation. */
  readonly toMarkdown?: (block: Block) => string;
  /** Serialize a block to an HTML string. */
  readonly toHTML?: (block: Block) => string;
}

export interface DeserializerSpec {
  /**
   * Attempt to parse a single Markdown line into a block descriptor, or return
   * null if this deserializer does not match.
   */
  readonly fromMarkdown?: (line: string) => SerializeResult | null;
}

export class SerializerRegistry {
  private readonly toMarkdown = new Map<BlockType, (block: Block) => string>();
  private readonly toHTML = new Map<BlockType, (block: Block) => string>();

  register(type: BlockType, spec: SerializerSpec): void {
    if (spec.toMarkdown) this.toMarkdown.set(type, spec.toMarkdown);
    if (spec.toHTML) this.toHTML.set(type, spec.toHTML);
  }

  markdownFor(block: Block): string | undefined {
    return this.toMarkdown.get(block.type)?.(block);
  }

  htmlFor(block: Block): string | undefined {
    return this.toHTML.get(block.type)?.(block);
  }
}

export class DeserializerRegistry {
  private readonly fromMarkdown: ((line: string) => SerializeResult | null)[] = [];

  register(spec: DeserializerSpec): void {
    if (spec.fromMarkdown) this.fromMarkdown.push(spec.fromMarkdown);
  }

  parseMarkdownLine(line: string): SerializeResult | null {
    for (const fn of this.fromMarkdown) {
      const result = fn(line);
      if (result) return result;
    }
    return null;
  }
}
