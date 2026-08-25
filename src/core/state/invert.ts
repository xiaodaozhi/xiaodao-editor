/**
 * Step inversion: compute the steps that undo a given step list against the
 * document state *before* those steps were applied. This enables memory-light,
 * correct undo/redo without snapshotting the whole document — only the blocks
 * a transaction touched are referenced by the inverse.
 *
 * See docs/architecture.md §9 (History) and §16 (undo/redo correctness).
 */

import type { BlockId, DocState, InlineSeq } from '../types';
import type { Step } from './Step';
import { indexOf, parentOf, requireBlock } from './store';

/**
 * Invert a sequence of steps against the pre-state. Returns a new step list
 * that, when applied to the post-state, restores the pre-state. Steps are
 * inverted in reverse order so the last-applied change is undone first.
 *
 * Important — forward-step is a sequential program:
 *   [ setAttrs(A, x'), insertBlock(B), replaceBlock(B), setAttrs(B) ]
 * When reversing, we may see `replaceBlock(B)` / `setAttrs(B)` BEFORE we see
 * the `insertBlock(B)` that actually added B to the document. In that case
 * B is NOT present in `prevDoc` (prevDoc is the pre-transaction snapshot,
 * not the mid-transaction intermediate). Inverting B's attribute/replace
 * changes is redundant because the final `insertBlock(B)` → inverse
 * `removeBlock(B)` already erases B entirely. So these "unknown id" cases
 * are skipped — the block is handled by its matching insertBlock inverse
 * further up the step list.
 */
export function invertSteps(steps: readonly Step[], prevDoc: DocState): Step[] {
  const inverse: Step[] = [];

  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i]!;
    switch (step.op) {
      case 'insertBlock':
        inverse.push({ op: 'removeBlock', id: step.id });
        break;
      case 'removeBlock':
        inverse.push(...reinsertSubtree(step.id, prevDoc));
        break;
      case 'replaceBlock': {
        const prev = prevDoc.blocks.get(step.id);
        if (!prev) {
          // Same-tx freshly-inserted block: handled by insertBlock inverse.
          break;
        }
        inverse.push({ op: 'replaceBlock', id: step.id, type: prev.type, attrs: prev.attrs });
        break;
      }
      case 'moveBlock': {
        inverse.push({
          op: 'moveBlock',
          id: step.id,
          toParent: parentOf(prevDoc, step.id),
          toIndex: indexOf(prevDoc, step.id),
        });
        break;
      }
      case 'setText': {
        const prev = prevDoc.blocks.get(step.id);
        if (!prev) {
          // Same-tx freshly-inserted block: handled by insertBlock inverse.
          break;
        }
        inverse.push({ op: 'setText', id: step.id, content: prev.content as InlineSeq });
        break;
      }
      case 'setAttrs': {
        const prev = prevDoc.blocks.get(step.id);
        if (!prev) {
          // Same-tx freshly-inserted block: handled by insertBlock inverse.
          // This is the HIT CASE for splitBlock / insertBlock + indent sync:
          //   insertBlock(X) → collectIndentSyncPatches → setAttrs(X, {indent:N})
          // prevDoc has no X (it was inserted in this tx), so skipping avoids
          // the "BlockEditor: unknown block X" throw and correctly leaves
          // undo responsibility to the insertBlock → removeBlock inverse.
          break;
        }
        inverse.push({ op: 'setAttrs', id: step.id, attrs: prev.attrs });
        break;
      }
    }
  }

  return inverse;
}

/** Build insertBlock steps that recreate a removed subtree in pre-order. */
function reinsertSubtree(rootId: BlockId, prevDoc: DocState): Step[] {
  const steps: Step[] = [];
  const walk = (id: BlockId): void => {
    const block = requireBlock(prevDoc, id);
    steps.push({
      op: 'insertBlock',
      parent: parentOf(prevDoc, id),
      index: indexOf(prevDoc, id),
      id,
      type: block.type,
      attrs: block.attrs,
      content: block.content as InlineSeq,
    });
    for (const child of block.children) walk(child);
  };
  walk(rootId);
  return steps;
}
