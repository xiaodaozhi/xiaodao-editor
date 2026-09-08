import { describe, it, expect, vi } from 'vitest';
import {
  Editor,
  createImageExtension,
  type UploadImageHandler,
  type DocumentData,
} from '@/index';
import { BuiltinExtensions } from '@/extensions/builtin';
import { START_IMAGE_UPLOAD_METHOD, CANCEL_IMAGE_UPLOAD_COMMAND } from '@/extensions/Image';
import {
  setUploadState,
  getUploadState,
  hasUploadRequestHandler,
} from '@/view/imageUpload';

/**
 * Tests for `createImageExtension({ upload, onFileCleanup })`.
 *
 * The host (BlockEditor) no longer couples to the Image extension: it
 * only forwards the extension's commands and the on-cleanup callback
 * via `:extensions`. This file verifies the public surface that the
 * host actually relies on stays correct:
 *
 *   1. The upload handler is registered with the imageUpload side-channel
 *      for the lifetime of the editor, and cleared on `destroy()`.
 *   2. The async `startImageUpload` method is exposed on the editor and
 *      unregistered on destroy.
 *   3. `onFileCleanup(fileId)` fires when the LAST block referencing a
 *      fileId is removed (only when count drops from > 0 to 0).
 *   4. The `cancelImageUpload` synchronous command clears in-flight
 *      upload state for a given block.
 *
 * The convention used in the host code is: replace the built-in Image
 * extension by name (`...BuiltinExtensions.filter(e => e.name !== 'image')`),
 * then append the user-supplied extension. That's also what this test
 * does.
 */

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
} {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function newEditor(
  upload: UploadImageHandler,
  onFileCleanup?: (fid: number) => void,
): Editor {
  return new Editor({
    extensions: [
      ...BuiltinExtensions.filter((e) => e.name !== 'image'),
      createImageExtension({ upload, onFileCleanup }),
    ],
  });
}

// Helpers ----------------------------------------------------------------

const imgAttrs = (fileId: number, src = ''): Record<string, unknown> => ({
  src: src || `https://example.test/f${fileId}.png`,
  alt: '',
  title: '',
  width: 0,
  height: 0,
  caption: '',
  fileId,
});

function seedDoc(blocks: Array<{ type: string; attrs: Record<string, unknown> }>): DocumentData {
  return {
    blocks: blocks.map((b, i) => ({
      id: `b${i + 1}`,
      type: b.type,
      attrs: b.attrs,
      content: [],
      children: [],
    })) as unknown as DocumentData['blocks'],
  };
}

// ---------------------------------------------------------------------------
// (1) Side-channel handler wiring
// ---------------------------------------------------------------------------

describe('upload handler side-channel registration', () => {
  it('registers a handler once the editor is built and clears it on destroy', () => {
    expect(hasUploadRequestHandler()).toBe(false);

    const upload: UploadImageHandler = async () => ({
      url: 'https://example.test/x.png',
      width: 100,
      height: 100,
    });

    const editor = newEditor(upload, () => {});
    expect(hasUploadRequestHandler()).toBe(true);

    editor.destroy();
    expect(hasUploadRequestHandler()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// (2) Async command surface
// ---------------------------------------------------------------------------

describe('startImageUpload extension method', () => {
  it('is registered on the editor while it lives, removed on destroy', () => {
    const editor = newEditor(async () => ({ url: '', width: 0, height: 0 }));
    expect(typeof editor.getExtensionMethod(START_IMAGE_UPLOAD_METHOD)).toBe('function');
    editor.destroy();
    expect(editor.getExtensionMethod(START_IMAGE_UPLOAD_METHOD)).toBeUndefined();
  });

  it('creates an image block, calls the handler, and writes the resolved attrs', async () => {
    const d = deferred<Awaited<ReturnType<UploadImageHandler>>>();
    const upload: UploadImageHandler = (_n, _f, _c, onProgress) => {
      // onProgress is reported in PERCENT (0–100), not 0–1.
      onProgress(50);
      return d.promise;
    };

    const editor = newEditor(upload, () => {});
    const start = editor.getExtensionMethod<(
      fileOrSrc: File | string,
      opts?: { relativeToBlockId?: unknown; position?: 'after' | 'before' | 'replace'; convertIfEmpty?: boolean },
    ) => Promise<string | null>>(START_IMAGE_UPLOAD_METHOD);
    expect(typeof start).toBe('function');

    // Use a real File so the upload branch fires (string-URL branch
    // only writes src/width/height; fileId is meaningful only for the
    // File branch where the handler is actually invoked).
    const fakeFile = new File([new Uint8Array([0])], 'x.png', { type: 'image/png' });
    const promise = start!(fakeFile);
    d.resolve({
      url: 'https://example.test/up.png',
      width: 320,
      height: 200,
      alt: '',
      title: '',
      fileId: 99,
    });

    const newId = await promise;
    expect(typeof newId).toBe('string');

    const block = editor.getState().doc.blocks.get(newId as never);
    expect(block?.type).toBe('image');
    expect((block?.attrs as { src?: string })?.src).toBe('https://example.test/up.png');
    expect((block?.attrs as { fileId?: number })?.fileId).toBe(99);

    editor.destroy();
  });
});

// ---------------------------------------------------------------------------
// (3) fileId ref-count tracking + onFileCleanup callback
// ---------------------------------------------------------------------------

describe('onFileCleanup ref-count tracking', () => {
  it('does NOT fire while a fileId still has at least one reference', () => {
    const onFileCleanup = vi.fn();
    const editor = newEditor(
      async () => ({ url: '', width: 0, height: 0 }),
      onFileCleanup,
    );

    // Seed exactly two image blocks both referencing fileId=42. Using
    // setDocument (rather than insertBlock twice) keeps the doc free
    // of the seeded default paragraph so block-id → image map is exact.
    editor.setDocument(seedDoc([
      { type: 'image', attrs: imgAttrs(42) },
      { type: 'image', attrs: imgAttrs(42) },
    ]));
    const ids = Array.from(editor.getState().doc.root).map((s) => s as unknown as string);
    expect(ids.length).toBe(2);

    // Remove ONE: ref-count drops 2 → 1; onFileCleanup must NOT fire.
    editor.commands.removeBlock?.({ id: ids[0]! });
    expect(onFileCleanup).not.toHaveBeenCalled();

    // Remove the LAST: ref-count drops 1 → 0; onFileCleanup fires.
    editor.commands.removeBlock?.({ id: ids[1]! });
    expect(onFileCleanup).toHaveBeenCalledTimes(1);
    expect(onFileCleanup).toHaveBeenCalledWith(42);

    editor.destroy();
  });

  it('never fires for fileId === 0 (no managed file)', () => {
    const onFileCleanup = vi.fn();
    const editor = newEditor(
      async () => ({ url: '', width: 0, height: 0 }),
      onFileCleanup,
    );

    editor.setDocument(seedDoc([{ type: 'image', attrs: imgAttrs(0) }]));
    const [id] = Array.from(editor.getState().doc.root).map((s) => s as unknown as string);
    expect(id).toBeDefined();

    editor.commands.removeBlock?.({ id: id! });
    expect(onFileCleanup).not.toHaveBeenCalled();

    editor.destroy();
  });
});

// ---------------------------------------------------------------------------
// (4) Synchronous cancel command
// ---------------------------------------------------------------------------

describe('cancelImageUpload synchronous command', () => {
  it('clears the in-flight upload state for a block id', () => {
    const editor = newEditor(async () => ({ url: '', width: 0, height: 0 }));

    const fakeBid = 'fake-bid-1';
    setUploadState(fakeBid, {
      status: 'pending',
      progress: 0.5,
      controller: new AbortController(),
    });
    expect(getUploadState(fakeBid)).not.toBeNull();

    const dispatcher = editor.commands as unknown as Record<
      string,
      (args: { blockId: string }) => boolean
    >;
    const ok = dispatcher[CANCEL_IMAGE_UPLOAD_COMMAND]?.({ blockId: fakeBid });
    expect(ok).toBe(true);
    expect(getUploadState(fakeBid)).toBeNull();

    editor.destroy();
  });
});
