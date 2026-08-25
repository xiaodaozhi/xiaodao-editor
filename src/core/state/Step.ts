/**
 * Structural steps: the atomic, serializable operations that mutate a document.
 *
 * Steps are intentionally low-level and dumb: they carry fully-resolved data
 * (including ids) and perform no policy decisions. Commands (see
 * `command/primitiveCommands.ts`) are responsible for assigning ids and
 * sequencing steps. Applying steps produces a new immutable `DocState` plus a
 * diff (changed / removed) that the view bridge consumes to update only the
 * affected blocks.
 *
 * See docs/architecture.md §7.2 (transactions are the only mutation
 * path) and §10.3 (update flow).
 */

import type { Attrs, Block, BlockId, BlockType, DocState, InlineSeq } from '../types';

// ---------------------------------------------------------------------------
// Step type
// ---------------------------------------------------------------------------

export type Step
  = | { readonly op: 'insertBlock'; readonly parent: BlockId | null; readonly index: number; readonly id: BlockId; readonly type: BlockType; readonly attrs: Attrs; readonly content: InlineSeq }
    | { readonly op: 'removeBlock'; readonly id: BlockId }
    | { readonly op: 'replaceBlock'; readonly id: BlockId; readonly type: BlockType; readonly attrs: Attrs }
    | { readonly op: 'moveBlock'; readonly id: BlockId; readonly toParent: BlockId | null; readonly toIndex: number }
    | { readonly op: 'setText'; readonly id: BlockId; readonly content: InlineSeq }
    | { readonly op: 'setAttrs'; readonly id: BlockId; readonly attrs: Attrs };

// ---------------------------------------------------------------------------
// Result of applying steps
// ---------------------------------------------------------------------------

export interface ApplyResult {
  readonly doc: DocState;
  /** Block ids whose `Block` reference changed (content/attrs/type) or were inserted. */
  readonly changed: ReadonlySet<BlockId>;
  /** Block ids removed from the document (the subtree roots and their descendants). */
  readonly removed: ReadonlySet<BlockId>;
}

// ---------------------------------------------------------------------------
// Internal mutable draft
// ---------------------------------------------------------------------------

interface Draft {
  id: string;
  root: BlockId[];
  blocks: Map<BlockId, Block>;
  parent: Map<BlockId, BlockId | null>;
  changed: Set<BlockId>;
  removed: Set<BlockId>;
}

function toDocState(draft: Draft): DocState {
  return {
    id: draft.id,
    root: draft.root,
    blocks: draft.blocks,
    parent: draft.parent,
  };
}

/** Replace a block in the draft with a new reference and mark it changed. */
function replaceBlock(draft: Draft, id: BlockId, next: Block): void {
  draft.blocks.set(id, next);
  draft.changed.add(id);
}

/** Replace a parent's children array with a new one (marks the parent changed). */
function setChildren(draft: Draft, parentId: BlockId | null, children: BlockId[]): void {
  if (parentId === null) {
    draft.root = children;
  } else {
    const parent = draft.blocks.get(parentId);
    if (!parent) throw new Error(`BlockEditor: unknown parent ${parentId}`);
    replaceBlock(draft, parentId, { ...parent, children });
  }
}

function getChildren(draft: Draft, parentId: BlockId | null): BlockId[] {
  if (parentId === null) return draft.root;
  const parent = draft.blocks.get(parentId);
  if (!parent) throw new Error(`BlockEditor: unknown parent ${parentId}`);
  return parent.children as BlockId[];
}

function detachSubtree(draft: Draft, id: BlockId): void {
  const block = draft.blocks.get(id);
  if (!block) throw new Error(`BlockEditor: cannot remove unknown block ${id}`);
  const parentId = draft.parent.get(id) ?? null;

  // Remove from parent's children list.
  const siblings = getChildren(draft, parentId).filter((sib) => sib !== id);
  setChildren(draft, parentId, siblings);

  // Recursively remove descendants.
  const stack: BlockId[] = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    const curBlock = draft.blocks.get(cur);
    if (curBlock) {
      for (const child of curBlock.children) stack.push(child);
    }
    draft.blocks.delete(cur);
    draft.parent.delete(cur);
    draft.removed.add(cur);
    draft.changed.delete(cur); // removed trumps changed
  }
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

export function applySteps(doc: DocState, steps: readonly Step[]): ApplyResult {
  const draft: Draft = {
    id: doc.id,
    root: [...doc.root],
    blocks: new Map(doc.blocks),
    parent: new Map(doc.parent),
    changed: new Set(),
    removed: new Set(),
  };

  for (const step of steps) {
    switch (step.op) {
      case 'insertBlock': {
        if (draft.blocks.has(step.id)) {
          throw new Error(`BlockEditor: insertBlock id collision ${step.id}`);
        }
        const block: Block = {
          id: step.id,
          type: step.type,
          attrs: step.attrs,
          content: step.content,
          children: [],
        };
        draft.blocks.set(step.id, block);
        draft.parent.set(step.id, step.parent);
        draft.changed.add(step.id);
        const siblings = [...getChildren(draft, step.parent)];
        const idx = Math.max(0, Math.min(step.index, siblings.length));
        siblings.splice(idx, 0, step.id);
        setChildren(draft, step.parent, siblings);
        break;
      }
      case 'removeBlock': {
        detachSubtree(draft, step.id);
        break;
      }
      case 'replaceBlock': {
        const prev = draft.blocks.get(step.id);
        if (!prev) throw new Error(`BlockEditor: replaceBlock unknown ${step.id}`);
        replaceBlock(draft, step.id, {
          ...prev,
          type: step.type,
          attrs: step.attrs,
        });
        break;
      }
      case 'moveBlock': {
        const block = draft.blocks.get(step.id);
        if (!block) throw new Error(`BlockEditor: moveBlock unknown ${step.id}`);
        const oldParent = draft.parent.get(step.id) ?? null;
        if (oldParent === step.toParent) {
          // Reorder within the same sibling list.
          const siblings = getChildren(draft, oldParent).filter((s) => s !== step.id);
          const idx = Math.max(0, Math.min(step.toIndex, siblings.length));
          siblings.splice(idx, 0, step.id);
          setChildren(draft, oldParent, siblings);
        } else {
          // Detach from old parent, attach to new parent.
          const oldSiblings = getChildren(draft, oldParent).filter((s) => s !== step.id);
          setChildren(draft, oldParent, oldSiblings);
          const newSiblings = [...getChildren(draft, step.toParent)];
          const idx = Math.max(0, Math.min(step.toIndex, newSiblings.length));
          newSiblings.splice(idx, 0, step.id);
          setChildren(draft, step.toParent, newSiblings);
          draft.parent.set(step.id, step.toParent);
        }
        break;
      }
      case 'setText': {
        const prev = draft.blocks.get(step.id);
        if (!prev) throw new Error(`BlockEditor: setText unknown ${step.id}`);
        replaceBlock(draft, step.id, { ...prev, content: step.content });
        break;
      }
      case 'setAttrs': {
        const prev = draft.blocks.get(step.id);
        if (!prev) throw new Error(`BlockEditor: setAttrs unknown ${step.id}`);
        replaceBlock(draft, step.id, { ...prev, attrs: step.attrs });
        break;
      }
    }
  }

  return { doc: toDocState(draft), changed: draft.changed, removed: draft.removed };
}
