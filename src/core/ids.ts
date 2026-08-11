/**
 * Stable, opaque block id generation. Owned by the core so that identity is
 * never produced by extensions or persistence. Uses the Web Crypto API so the
 * core has zero runtime dependencies.
 *
 * See docs/editor-architecture.md §4.1 ("id is generated and owned by the
 * core").
 */

import type { BlockId } from './types';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-';
const ID_LENGTH = 12; // ~71 bits of entropy; plenty for a single document's blocks

function randomBytes(length: number): Uint8Array {
  // `globalThis.crypto` is available in modern browsers and Node 19+.
  const crypto = globalThis.crypto;
  if (!crypto || typeof crypto.getRandomValues !== 'function') {
    throw new Error('BlockEditor: Web Crypto getRandomValues is unavailable in this environment.');
  }
  const out = new Uint8Array(length);
  crypto.getRandomValues(out);
  return out;
}

/** Generate a fresh, unique block id. */
export function createBlockId(): BlockId {
  const bytes = randomBytes(ID_LENGTH);
  let id = '';
  for (let i = 0; i < ID_LENGTH; i++) {
    id += ALPHABET[bytes[i]! % ALPHABET.length];
  }
  return id as BlockId;
}

/** Coerce a string into a `BlockId` (use only when rehydrating trusted data). */
export function asBlockId(value: string): BlockId {
  return value as BlockId;
}
