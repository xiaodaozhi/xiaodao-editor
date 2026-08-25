/**
 * Normalized document store.
 *
 * Owns construction of a `DocState` from JSON, serialization back to JSON, and
 * pure lookup helpers. Mutations live in `Step.ts` / `Transaction.ts`. This
 * module never mutates a `DocState` in place.
 *
 * Key concepts:
 *   • Block.parent / DocState.parent Map ARE the authoritative nesting model.
 *   • attrs.indent is a DERIVED / SYNCHRONIZED shadow of the parent-chain depth
 *     (depthOf(id)), kept so renderers (classesFromAttrs, ordered-list
 *     numbering, menu UI) continue to work without rework. No code path
 *     should *write* attrs.indent to express nesting anymore.
 *   • Legacy flat JSON (attrs.indent > 0, all parent=null, no children) is
 *     automatically rebuilt into a real parent/children tree at load time,
 *     using the same stack-by-indent algorithm Markdown parsing uses.
 *
 * See docs/architecture.md §4.4 (forest + normalized store) and §10.
 */

import type {
  Attrs,
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

/** Block types that support nesting (Tab moves them under a previous sibling). */
const NESTABLE_TYPES = new Set([
  'paragraph',
  'heading',
  'bulletList',
  'orderedList',
  'todoList',
]);

/**
 * Build a normalized `DocState` from nested JSON.
 *
 * Id policy (docs §4.1, §17.1): a source id is preserved if it is non-empty
 * and unique within this document; otherwise a fresh id is generated. The
 * mapping from source id → assigned id is returned for caller use.
 *
 * Legacy migration: if the input JSON is "flat-by-indent" (children never
 * written; every block sits at root level; attrs.indent encodes depth) we
 * rebuild the real parent/children tree so the rest of the editor operates
 * on a real tree. The attrs.indent field on each block is then normalized to
 * mirror the computed depth so downstream renderers stay consistent.
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

  // ---- Legacy flat-by-indent migration ------------------------------------
  const allParentNull = Array.from(parent.values()).every((p) => p === null);
  let hasAttrIndent = false;
  for (const b of blocks.values()) {
    if (typeof b.attrs.indent === 'number' && b.attrs.indent > 0) {
      hasAttrIndent = true;
      break;
    }
  }
  if (allParentNull && hasAttrIndent) {
    rebuildFromFlatAttrsIndent(blocks, parent, root);
  }

  // ---- Normalize attrs.indent = depthOf(...) ------------------------------
  // Use MAX clamp (10) matching the COMMON_ATTRS.validate so coerceAttrs
  // never rejects a value we write here.
  const MAX_INDENT = 10;
  for (const [id, block] of blocks) {
    const d = Math.min(MAX_INDENT, depthOfMap(parent, id));
    const curIndent = typeof block.attrs.indent === 'number' ? block.attrs.indent : 0;
    if (curIndent === d) continue;
    const { indent: _omit, ...rest } = block.attrs;
    const nextAttrs: Attrs = d > 0 ? { ...rest, indent: d } : rest;
    blocks.set(id, { ...block, attrs: nextAttrs });
  }

  const doc: DocState = {
    id: json.id ?? generateDocId(),
    root,
    blocks,
    parent,
  };
  return { doc, idMap };
}

/**
 * Rebuild the parent/children tree of a legacy document — one where every
 * block is a root sibling and depth is encoded in `attrs.indent`. The order
 * of blocks in doc.root (flat, document order) is preserved as the
 * depth-first walk order of the rebuilt tree.
 *
 * Algorithm: indent-stack. Walk the root order; for each block pop the stack
 * until we find an ancestor with strictly smaller indent; the top becomes
 * our parent (or null if stack is empty). Push self onto stack.
 *
 * Mutates in place: `parent`, `root`, and every `Block` object in `blocks`
 * gets a fresh `children` slice and updated `attrs` (indent untouched here,
 * the caller re-syncs attrs.indent afterwards if needed).
 */
function rebuildFromFlatAttrsIndent(
  blocks: Map<BlockId, Block>,
  parent: Map<BlockId, BlockId | null>,
  root: BlockId[],
): void {
  const flatIds: BlockId[] = [...root];

  // Reset per-block children (we will re-assign every list below).
  for (const [id, block] of blocks) {
    blocks.set(id, { ...block, children: [] });
  }

  // Stack: strictly-increasing indent levels.
  const stack: Array<{ indent: number; id: BlockId }> = [];
  const newRoot: BlockId[] = [];

  const appendChild = (parentId: BlockId | null, childId: BlockId): void => {
    if (parentId === null) {
      newRoot.push(childId);
      parent.set(childId, null);
      return;
    }
    const p = blocks.get(parentId);
    if (!p) {
      newRoot.push(childId);
      parent.set(childId, null);
      return;
    }
    const next: Block = { ...p, children: [...p.children, childId] };
    blocks.set(parentId, next);
    parent.set(childId, parentId);
  };

  for (const id of flatIds) {
    const block = blocks.get(id);
    if (!block) continue;
    const rawIndent = typeof block.attrs.indent === 'number' ? block.attrs.indent : 0;
    // Only nestable block types participate in parent/child relationships via
    // indent numbers. A non-nestable block (codeBlock/quote/etc.) with a
    // spurious positive indent attr is clamped to root level.
    const supportsNest = NESTABLE_TYPES.has(block.type);
    const indent = supportsNest ? Math.max(0, rawIndent) : 0;

    // Pop until stack top indent is strictly less than `indent`.
    while (stack.length > 0 && stack[stack.length - 1]!.indent >= indent) {
      stack.pop();
    }
    const parentId = stack.length > 0 ? stack[stack.length - 1]!.id : null;

    // But also: non-nestable blocks cannot have children. So we need to
    // validate that `parentId` (if any) points to a nestable parent. If not,
    // walk up until we find a nestable ancestor or null. This guards against
    // a quote block somehow having a positive indent in legacy data.
    let resolvedParent: BlockId | null = parentId;
    while (resolvedParent !== null) {
      const rp = blocks.get(resolvedParent);
      if (!rp || !NESTABLE_TYPES.has(rp.type)) {
        resolvedParent = parent.get(resolvedParent) ?? null;
      } else {
        break;
      }
    }

    appendChild(resolvedParent, id);
    if (supportsNest) {
      stack.push({ indent, id });
    }
  }

  // Swap root in place (the caller owns this mutable ref).
  root.length = 0;
  for (const r of newRoot) root.push(r);
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

/**
 * Nesting depth of a block: count of ancestors.
 *   • Root blocks: depth 0
 *   • Direct child of a root block: depth 1
 *   • etc.
 *
 * This is the AUTHORITATIVE source for indent level; `attrs.indent` is only a
 * synchronized mirror kept for backward compatibility with the CSS class
 * pipeline (`classesFromAttrs`) and legacy renderers.
 */
export function depthOf(doc: DocState, id: BlockId): number {
  return depthOfMap(doc.parent, id);
}

function depthOfMap(parent: ReadonlyMap<BlockId, BlockId | null>, id: BlockId): number {
  let depth = 0;
  let cur: BlockId | null | undefined = parent.get(id);
  // Cycle guard: because we build the parent map in docFromData / Step.ts in
  // well-formed ways there should never be a cycle, but this bounds the loop
  // just in case corrupted state arrives via a future JSON import.
  const seen = new Set<BlockId | null | undefined>();
  while (cur !== undefined && cur !== null) {
    if (seen.has(cur)) break; // cycle detected — stop counting.
    seen.add(cur);
    depth++;
    cur = parent.get(cur);
  }
  return depth;
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

/** The previous block in document (depth-first) order across nesting. */
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
// Indent-attr synchronization (make `attrs.indent` a mirror of depth)
// ---------------------------------------------------------------------------

/**
 * Returns the setAttrs patches needed to make every block's `attrs.indent`
 * exactly equal to `depthOf(doc, id)` (clamped to 0..MAX_INDENT). Any block
 * whose indent already matches is omitted so we don't emit spurious changed
 * entries in the next transaction.
 *
 * This is the SINGLE place that is allowed to *write* `attrs.indent`.
 * Commands and transaction callers should NOT manually set attrs.indent;
 * instead they should manipulate parent/children (via moveBlock /
 * insertBlock/removeBlock) and then run this synchronizer at the end of the
 * transaction build.
 *
 * If a `schema` is supplied, blocks whose schema does not declare an
 * `indent` attr have the indent key stripped entirely (matching the
 * coerceAttrs convention used across extensions).
 */
export function collectIndentSyncPatches(
  doc: DocState,
  schema?: { get(type: string): { attrs: Readonly<Record<string, unknown>> } },
): Array<{ id: BlockId; attrs: Attrs }> {
  const MAX_INDENT = 10;
  const patches: Array<{ id: BlockId; attrs: Attrs }> = [];
  for (const [id, block] of doc.blocks) {
    const d = Math.min(MAX_INDENT, depthOfMap(doc.parent, id));
    const schemaAttrs = schema ? schema.get(block.type).attrs : undefined;
    const supportsIndentAttr = schemaAttrs ? 'indent' in schemaAttrs : true;
    const targetIndent = supportsIndentAttr ? d : 0;
    const curIndent = typeof block.attrs.indent === 'number' ? block.attrs.indent : 0;
    if (curIndent === targetIndent) continue;
    const { indent: _omit, ...rest } = block.attrs;
    const nextAttrs: Attrs
      = targetIndent > 0 && supportsIndentAttr ? { ...rest, indent: targetIndent } : rest;
    patches.push({ id, attrs: nextAttrs });
  }
  return patches;
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
