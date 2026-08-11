/**
 * Core domain types for the block editor.
 *
 * This module is the single source of truth for the editor's data model. It is
 * intentionally framework-agnostic (no Vue) and contains only type definitions
 * plus a few pure type guards. All runtime behavior lives in dedicated modules.
 *
 * See docs/editor-architecture.md §4 (Document model) and §8 (Selection).
 */

// ---------------------------------------------------------------------------
// Identifiers
// ---------------------------------------------------------------------------

/**
 * A stable, opaque identifier for a block. Branded so that a plain `string`
 * cannot be passed where a `BlockId` is expected — this catches an entire
 * class of bugs at compile time.
 */
export type BlockId = string & { readonly __brand: 'BlockId' };

/** A registered block type id (e.g. "paragraph", "heading"). */
export type BlockType = string;

// ---------------------------------------------------------------------------
// JSON values & attributes
// ---------------------------------------------------------------------------

export type JSONValue
  = | string
    | number
    | boolean
    | null
    | JSONValue[]
    | { [key: string]: JSONValue };

/** Block-level attributes. A plain JSON object shaped by the block's schema. */
export type Attrs = Readonly<Record<string, JSONValue>>;

// ---------------------------------------------------------------------------
// Inline content
// ---------------------------------------------------------------------------

/** An inline mark applied to a text run (bold, italic, link, …). */
export interface Mark {
  readonly type: string;
  readonly attrs?: Attrs;
}

/**
 * A single inline node. Phase 1 only has text runs; the model is already a
 * discriminated union so future inline atoms (mention, equation) extend it
 * without changing the block shape.
 */
export interface TextRun {
  readonly type: 'text';
  readonly text: string;
  readonly marks?: readonly Mark[];
}

export type InlineNode = TextRun;

/** The ordered inline content of a block. An empty array means "no text". */
export type InlineSeq = readonly InlineNode[];

// ---------------------------------------------------------------------------
// Block (internal, normalized, immutable)
// ---------------------------------------------------------------------------

/**
 * A block. Treated as immutable within an `EditorState` version: any mutation
 * produces a new `Block` object while siblings keep referential identity.
 */
export interface Block {
  readonly id: BlockId;
  readonly type: BlockType;
  readonly attrs: Attrs;
  readonly content: InlineSeq;
  /** Ordered child block ids. Nesting is resolved via the document store. */
  readonly children: readonly BlockId[];
}

/**
 * The normalized document: a forest of blocks stored in a map keyed by id,
 * plus the ordered list of top-level ids and a parent index for O(1) upward
 * navigation. Plain (non-reactive) data; see docs §10.
 */
export interface DocState {
  readonly id: string;
  readonly root: readonly BlockId[];
  readonly blocks: ReadonlyMap<BlockId, Block>;
  /** Parent of each block; `null` means "top-level (child of root)". */
  readonly parent: ReadonlyMap<BlockId, BlockId | null>;
}

// ---------------------------------------------------------------------------
// Selection (separate from the document; see docs §8)
// ---------------------------------------------------------------------------

export interface Anchor {
  readonly blockId: BlockId;
  readonly offset: number;
}

export type Selection
  = | { readonly kind: 'caret'; readonly blockId: BlockId; readonly offset: number }
    | { readonly kind: 'text'; readonly anchor: Anchor; readonly focus: Anchor }
    | { readonly kind: 'blocks'; readonly blockIds: readonly BlockId[] };

// ---------------------------------------------------------------------------
// Serializable JSON forms (import / export only — never the source of truth)
// ---------------------------------------------------------------------------

export interface BlockData {
  readonly id?: string;
  readonly type: string;
  readonly attrs?: Attrs;
  readonly content?: InlineSeq;
  readonly children?: readonly BlockData[];
}

export interface DocumentData {
  readonly id?: string;
  readonly blocks: readonly BlockData[];
}

// ---------------------------------------------------------------------------
// Type guards / pure helpers
// ---------------------------------------------------------------------------

export function isBlockId(value: unknown): value is BlockId {
  return typeof value === 'string' && value.length > 0;
}

export function isTextRun(node: InlineNode): node is TextRun {
  return node.type === 'text';
}

/** Concatenate all text in an inline sequence. */
export function inlineText(seq: InlineSeq): string {
  return seq.reduce((acc, node) => (node.type === 'text' ? acc + node.text : acc), '');
}

/** Build an inline sequence from a plain string. */
export function inlineFromString(text: string): InlineSeq {
  return text.length === 0 ? [] : [{ type: 'text', text }];
}

/**
 * Split an InlineSeq at character offset into two halves.
 * TextRuns that straddle the boundary are split into two TextRun copies
 * (preserving marks). Empty runs are omitted.
 */
export function splitInline(seq: InlineSeq, offset: number): readonly [InlineSeq, InlineSeq] {
  const o = Math.max(0, Math.floor(offset));
  if (o <= 0) return [[], seq];
  const total = inlineText(seq).length;
  if (o >= total) return [seq, []];

  const left: InlineNode[] = [];
  const right: InlineNode[] = [];
  let acc = 0;
  for (const node of seq) {
    if (node.type !== 'text') {
      // Non-text atoms are treated as length-0 (Phase 2 this will need update)
      if (acc < o) left.push(node);
      else right.push(node);
      continue;
    }
    const runLen = node.text.length;
    if (acc + runLen <= o) {
      left.push(node);
      acc += runLen;
      continue;
    }
    if (acc >= o) {
      right.push(node);
      continue;
    }
    // straddles the boundary
    const splitAt = o - acc;
    const lText = node.text.slice(0, splitAt);
    const rText = node.text.slice(splitAt);
    if (lText.length > 0) {
      left.push(node.marks ? { ...node, text: lText } : { ...node, text: lText, marks: undefined });
    }
    if (rText.length > 0) {
      right.push(node.marks ? { ...node, text: rText } : { ...node, text: rText, marks: undefined });
    }
    acc += runLen;
  }
  return [left, right];
}
