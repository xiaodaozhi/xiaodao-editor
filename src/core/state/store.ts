/**
 * Normalized document store.
 *
 * Owns construction of a `DocState` from JSON, serialization back to JSON, and
 * pure lookup helpers. Mutations live in `Step.ts` / `Transaction.ts`. This
 * module never mutates a `DocState` in place.
 *
 * See docs/editor-architecture.md §4.4 (forest + normalized store) and §10.
 */

import type {
  Block,
  BlockId,
  BlockData,
  DocState,
  DocumentData,
  InlineSeq,
} from '../types';
import { asBlockId, createBlockId } from '../ids';

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

export interface DocBuildResult {
  readonly doc: DocState;
  /** Map from source JSON id (if any) to the assigned stable `BlockId`. */
  readonly idMap: ReadonlyMap<string, BlockId>;
}

/**
 * Build a normalized `DocState` from nested JSON.
 *
 * Id policy (docs §4.1, §17.1): a source id is preserved if it is non-empty
 * and unique within this document; otherwise a fresh id is generated. The
 * mapping from source id → assigned id is returned for caller use.
 */
export function docFromData(json: DocumentData): DocBuildResult {
  const blocks = new Map<BlockId, Block>();
  const parent = new Map<BlockId, BlockId | null>();
  const idMap = new Map<string, BlockId>();
  const used = new Set<BlockId>();

  const assignId = (sourceId: string | undefined): BlockId => {
    if (sourceId && !used.has(sourceId as BlockId)) {
      const id = asBlockId(sourceId);
      used.add(id);
      if (sourceId) idMap.set(sourceId, id);
      return id;
    }
    // Generate until unique (extremely unlikely to collide).
    let id = createBlockId();
    while (used.has(id)) id = createBlockId();
    used.add(id);
    return id;
  };

  const ingest = (node: BlockData, parentId: BlockId | null): BlockId => {
    const id = assignId(node.id);
    parent.set(id, parentId);
    const children: BlockId[] = [];
    for (const child of node.children ?? []) {
      children.push(ingest(child, id));
    }
    blocks.set(id, {
      id,
      type: node.type,
      attrs: node.attrs ?? {},
      content: node.content ?? [],
      children,
    });
    return id;
  };

  const root: BlockId[] = [];
  for (const node of json.blocks ?? []) {
    root.push(ingest(node, null));
  }

  const doc: DocState = {
    id: json.id ?? generateDocId(),
    root,
    blocks,
    parent,
  };
  return { doc, idMap };
}

/** Serialize a `DocState` to nested JSON (the external format). */
export function docToData(doc: DocState): DocumentData {
  /** Deep-copy InlineSeq so the emitted JSON never shares internal Mark/Run
   *  object references with the live editor state.  Without this, a caller
   *  that mutates a received `content` or `attrs` would silently poison the
   *  state, and a shallow-reference-equal watch could miss a subsequent
   *  update because a shared object ref looked "unchanged". */
  const cloneContent = (seq: InlineSeq): InlineSeq =>
    seq.map((run) =>
      run.type === 'text'
        ? {
            type: 'text',
            text: run.text,
            marks:
              run.marks && run.marks.length > 0
                ? run.marks.map((m) => ({
                    type: m.type,
                    attrs: m.attrs ? { ...m.attrs } : undefined,
                  }))
                : undefined,
          }
        : { ...run },
    );

  const serializeBlock = (id: BlockId): BlockData => {
    const block = doc.blocks.get(id);
    if (!block) throw new Error(`BlockEditor: missing block ${id} during serialization`);
    const children = block.children.map(serializeBlock);
    return {
      id,
      type: block.type,
      attrs: block.attrs ? { ...block.attrs } : undefined,
      content: cloneContent(block.content),
      ...(children.length ? { children } : {}),
    };
  };
  return {
    id: doc.id,
    blocks: doc.root.map(serializeBlock),
  };
}

// ---------------------------------------------------------------------------
// Lookups (pure)
// ---------------------------------------------------------------------------

export function getBlock(doc: DocState, id: BlockId): Block | undefined {
  return doc.blocks.get(id);
}

export function requireBlock(doc: DocState, id: BlockId): Block {
  const block = doc.blocks.get(id);
  if (!block) throw new Error(`BlockEditor: unknown block ${id}`);
  return block;
}

export function parentOf(doc: DocState, id: BlockId): BlockId | null {
  return doc.parent.get(id) ?? null;
}

/** The ordered sibling list a block belongs to (root or a parent's children). */
export function siblingList(doc: DocState, id: BlockId): readonly BlockId[] {
  const parent = doc.parent.get(id);
  if (parent === undefined || parent === null) return doc.root;
  const parentBlock = doc.blocks.get(parent);
  return parentBlock ? parentBlock.children : doc.root;
}

export function indexOf(doc: DocState, id: BlockId): number {
  return siblingList(doc, id).indexOf(id);
}

export function prevSibling(doc: DocState, id: BlockId): Block | undefined {
  const i = indexOf(doc, id);
  if (i <= 0) return undefined;
  const sibs = siblingList(doc, id);
  return doc.blocks.get(sibs[i - 1]!);
}

export function nextSibling(doc: DocState, id: BlockId): Block | undefined {
  const sibs = siblingList(doc, id);
  const i = sibs.indexOf(id);
  if (i < 0 || i >= sibs.length - 1) return undefined;
  return doc.blocks.get(sibs[i + 1]!);
}

/**
 * All block ids in document order (root-first, depth-first). Used by the view
 * bridge to derive the flat render list and by navigation to find the
 * previous/next *visible* block across nesting boundaries.
 */
export function flatten(doc: DocState): BlockId[] {
  const out: BlockId[] = [];
  const walk = (ids: readonly BlockId[]) => {
    for (const id of ids) {
      out.push(id);
      const block = doc.blocks.get(id);
      if (block) walk(block.children);
    }
  };
  walk(doc.root);
  return out;
}

/**
 * The previous/next block in document (depth-first) order. For Phase 1, where
 * blocks are not nested, this is equivalent to the previous/next root block.
 */
export function blockBefore(doc: DocState, id: BlockId): Block | undefined {
  const flat = flatten(doc);
  const i = flat.indexOf(id);
  if (i <= 0) return undefined;
  return doc.blocks.get(flat[i - 1]!);
}

export function blockAfter(doc: DocState, id: BlockId): Block | undefined {
  const flat = flatten(doc);
  const i = flat.indexOf(id);
  if (i < 0 || i >= flat.length - 1) return undefined;
  return doc.blocks.get(flat[i + 1]!);
}

/** The deepest last descendant of a block (or the block itself if leaf). */
export function lastDescendant(doc: DocState, id: BlockId): Block {
  const block = requireBlock(doc, id);
  if (block.children.length === 0) return block;
  const lastChild = block.children[block.children.length - 1]!;
  return lastDescendant(doc, lastChild);
}

// ---------------------------------------------------------------------------
// Content helpers (pure)
// ---------------------------------------------------------------------------

export function withContent(block: Block, content: InlineSeq): Block {
  return { ...block, content };
}

export function withAttrs(block: Block, attrs: Block['attrs']): Block {
  return { ...block, attrs };
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

function generateDocId(): string {
  // Document id is not security-sensitive; reuse the block id alphabet.
  return 'doc_' + Math.random().toString(36).slice(2, 10);
}
