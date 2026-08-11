/**
 * Image upload state management.
 *
 * IMPORTANT DESIGN NOTE:
 * Upload status (pending / progress / error) is NEVER stored in the
 * document attrs. The document model only carries the FINAL image URL.
 * This module owns a side-channel Map<BlockId, UploadState> that the
 * renderer reads for live UI feedback. When a document is reloaded from
 * persistence the transient upload map is empty by construction, so
 * "in-progress", "blob:" or "error" state can never leak into the
 * saved document.
 *
 * Upload flow:
 *   1. Caller (paste / drop / slash / file picker) calls `beginUpload`
 *      with a File and a target block placement hint (afterId / insertAtEnd).
 *   2. `beginUpload` inserts an image block with a PLACEHOLDER src
 *      (empty string) via a normal transaction — so undo/redo can
 *      remove the *block itself*. It records the upload in the
 *      transient map as { status: 'pending', progress: 0 }.
 *   3. `beginUpload` asks BlockEditor (via the global emitter hook, see
 *      `registerUploadRequestHandler`) to run the actual upload. If the
 *      user provided an `uploadImage` prop function we hand off to them;
 *      otherwise we run a mock upload that returns a data-URL.
 *   4. On progress: update the transient map → renderer re-renders.
 *   5. On success: dispatch a setAttrs transaction setting `src` to the
 *      FINAL URL, clear the transient entry (or mark 'success' briefly
 *      for a fade, currently we clear immediately).
 *   6. On error: mark transient entry as 'error' with error.message.
 *      User can click "Retry" → we re-run step 3.
 *   7. If the block is removed (undo / delete) the transient entry is
 *      cleaned up via a document-change subscription in BlockEditor.
 */

import type { BlockId } from '../core/types';

export type UploadStatus = 'pending' | 'success' | 'error';

export interface UploadState {
  readonly status: UploadStatus;
  /** 0–1 (0%–100%), meaningful only when status==='pending'. */
  readonly progress: number;
  /** Error message, meaningful only when status==='error'. */
  readonly error?: string;
  /** Original file so retry can re-upload it. */
  readonly file?: File;
  /** Temporary preview URL (object URL for local preview only).
   *  NOT saved to the document. */
  readonly tempPreviewUrl?: string;
  /** Block attributes to apply on success (width/height detected from file). */
  readonly pendingAttrs?: { width?: number; height?: number };
  /** AbortController for the in-flight upload. Aborted when the block is
   *  removed or the editor is unmounted. */
  readonly controller?: AbortController;
}

/** UploadResult: the final outcome handed back from the upload handler (either
 *  external uploadImage prop or internal mockUpload). */
export interface UploadResult {
  readonly url: string;
  readonly width?: number;
  readonly height?: number;
  readonly alt?: string;
  readonly title?: string;
  /** Optional server-managed file identifier (integer). When provided,
   *  the editor tracks references and emits `cleanup:image-file` when
   *  the last block referencing this fileId is removed. */
  readonly fileId?: number;
}

/**
 * The public-facing result type returned by the `uploadImage` prop function.
 * Identical to UploadResult but exported under a separate name so consumers
 * have a clean public API type.
 */
export interface ImageUploadResult {
  readonly url: string;
  readonly width?: number;
  readonly height?: number;
  readonly alt?: string;
  readonly title?: string;
  /** Optional server-managed file identifier (integer). When provided,
   *  the editor tracks references and emits `cleanup:image-file` when
   *  the last block referencing this fileId is removed. */
  readonly fileId?: number;
}

/**
 * The `uploadImage` prop function signature. When provided, the editor delegates
 * image uploads to this function instead of using the built-in mock upload.
 *
 * The function receives:
 *   - name:      the original file name (file.name)
 *   - file:      the File object to upload
 *   - controller: AbortController — the editor will call .abort() if the
 *                 image block is removed or the editor is unmounted
 *   - onProgress:  callback to report progress as 0–100
 *
 * The function must return a Promise that resolves with the final uploaded
 * URL (and optional dimensions/metadata) or rejects with an error.
 */
export type UploadImageHandler = (
  name: string,
  file: File,
  controller: AbortController,
  onProgress: (percent: number) => void,
) => Promise<ImageUploadResult>;

/** Convenience alias: UploadProgress = pct 0-1 callback. */
export type UploadProgress = (progress01: number) => void;
//  UploadProgressFn is defined below. DO NOT re-declare it here to avoid
//  TS2300 duplicate-identifier errors.

// --- Transient state (NOT persisted) -------------------------------------

const uploadStates = new Map<BlockId, UploadState>();
type StateChangeListener = (blockId: BlockId, state: UploadState | null) => void;
const listeners = new Set<StateChangeListener>();

function notify(blockId: BlockId, state: UploadState | null): void {
  for (const fn of listeners) fn(blockId, state);
}

export function getUploadState(blockId: BlockId): UploadState | null {
  return uploadStates.get(blockId) ?? null;
}

export function setUploadState(blockId: BlockId, state: UploadState | null): void {
  if (state === null) {
    if (uploadStates.has(blockId)) {
      const prev = uploadStates.get(blockId);
      if (prev?.tempPreviewUrl) URL.revokeObjectURL(prev.tempPreviewUrl);
      // Abort any in-flight upload when the state is cleared (block removed,
      // upload succeeded, editor unmounted, etc.).
      if (prev?.controller) {
        try {
          prev.controller.abort();
        } catch { /* ignore */ }
      }
      uploadStates.delete(blockId);
      notify(blockId, null);
    }
  } else {
    uploadStates.set(blockId, state);
    notify(blockId, state);
  }
}

export function subscribeUploadState(fn: StateChangeListener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Alias for subscribeUploadState (used by BlockEditor). */
export const subscribeToUploadChanges = subscribeUploadState;

/** Release any object URLs and wipe the transient map.
 *  Called by BlockEditor on destroy / document replacement. */
export function resetAllUploadStates(): void {
  for (const [, s] of uploadStates) {
    if (s?.tempPreviewUrl) URL.revokeObjectURL(s.tempPreviewUrl);
    if (s?.controller) {
      try {
        s.controller.abort();
      } catch { /* ignore */ }
    }
  }
  uploadStates.clear();
  // Notify all listeners for every previously-tracked block so they can
  // unconditionally drop stale UI state.
  for (const fn of listeners) fn('' as BlockId, null);
}

/** Alias for resetAllUploadStates. */
export const clearAllUploadStates = resetAllUploadStates;

/** Explicitly release all temp preview URLs (blob: object URLs). The upload
 *  state map is not cleared so UI error states are preserved. Called when the
 *  Editor unmounts in addition to resetAllUploadStates — double-clean is safe
 *  because URL.revokeObjectURL on a freed URL is a no-op. */
const tempUrls = new Set<string>();
export function revokeAllTempUrls(): void {
  for (const url of tempUrls) {
    try {
      URL.revokeObjectURL(url);
    } catch { /* ignore */ }
  }
  tempUrls.clear();
}

/** Wrap URL.createObjectURL and track in tempUrls so revokeAllTempUrls can
 *  release everything in one shot. */
export function createTempObjectUrl(file: Blob): string {
  const url = URL.createObjectURL(file);
  tempUrls.add(url);
  return url;
}

/** Clean up upload state for a set of removed blocks.
 *  Called by BlockEditor's document-change subscription. */
export function cleanupRemovedBlockIds(removed: Iterable<BlockId>): void {
  for (const id of removed) setUploadState(id, null);
}

/** Alias for cleanupRemovedBlockIds. */
export function cleanupUploadState(removed: Iterable<BlockId>): void {
  cleanupRemovedBlockIds(removed);
}

// --- Upload request dispatch (between this module and BlockEditor) ------
//
// The view bridge (BlockEditor) registers a handler here at mount time.
// That handler:
//   - Creates the image block via editor.commands (transactional)
//   - Calls the `uploadImage` prop function so consumers can take over
//   - Falls back to mock upload if no handler was provided
//
// This avoids a direct import cycle: this module knows nothing about
// Vue or the Editor class.

export type UploadProgressFn = (progress01: number) => void;
export interface UploadCallbacks {
  readonly onProgress: UploadProgressFn;
  readonly onSuccess: (result: UploadResult) => void;
  readonly onError: (message: string) => void;
}

export type UploadRequestHandler = (
  name: string,
  file: File,
  controller: AbortController,
  callbacks: UploadCallbacks,
) => void;

let uploadRequestHandler: UploadRequestHandler | null = null;

export function registerUploadRequestHandler(handler: UploadRequestHandler | null): void {
  uploadRequestHandler = handler;
}

/** Alias used by BlockEditor.vue (shorter name). */
export const registerUploadHandler = registerUploadRequestHandler;

export function hasUploadRequestHandler(): boolean {
  return uploadRequestHandler !== null;
}

export function dispatchUploadRequest(
  name: string,
  file: File,
  controller: AbortController,
  callbacks: UploadCallbacks,
): void {
  if (!uploadRequestHandler) {
    // No one is listening → the block was inserted with empty src.
    // Mark as error so the UI shows a sensible state.
    callbacks.onError('Upload handler not registered');
    return;
  }
  uploadRequestHandler(name, file, controller, callbacks);
}

// ---------------------------------------------------------------------------
// Result type (used by beginUpload below)
// ---------------------------------------------------------------------------

type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

// ---------------------------------------------------------------------------
// Mock upload (used when NO external `uploadImage` prop is provided)
// ---------------------------------------------------------------------------

/**
 * Simulate an upload for demo / dev environments where no real server is
 * configured. Produces a blob: object URL in ~600 ms with fake progress.
 *
 * IMPORTANT: blob: object URLs are NOT serialisable across page reloads.
 * Consumers that intend to persist and reload documents MUST provide an
 * `uploadImage` prop. This mock exists purely so the editor still works
 * out of the box in demos and tests.
 */
export function mockUpload(
  file: File,
  onProgress?: (progress01: number) => void,
): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    const startMs = Date.now();
    const totalMs = 500 + Math.min(2500, Math.round(file.size / 2000));
    let cancelled = false;

    const update = () => {
      if (cancelled) return;
      const elapsed = Date.now() - startMs;
      const rawPct = Math.min(1, elapsed / totalMs);
      // Ease-out fake progress for a more natural feel.
      const eased = 1 - Math.pow(1 - rawPct, 2);
      onProgress?.(eased);
      if (rawPct < 1) {
        requestAnimationFrame(update);
      } else {
        // Measure natural dims via an offscreen img + object URL.
        const obj = createTempObjectUrl(file);
        if (typeof document === 'undefined') {
          resolve({ url: obj });
          return;
        }
        const img = document.createElement('img');
        let settled = false;
        const finish = (w?: number, h?: number) => {
          if (settled) return;
          settled = true;
          resolve({ url: obj, width: w, height: h });
        };
        img.onload = () => finish(img.naturalWidth || undefined, img.naturalHeight || undefined);
        img.onerror = () => finish();
        img.src = obj;
        setTimeout(() => finish(), 5000); // safety
      }
    };
    requestAnimationFrame(update);

    // Safety: if the file is not an image, reject quickly.
    if (!file.type.startsWith('image/')) {
      cancelled = true;
      setTimeout(() => reject(new Error('Not an image file')), 30);
    }
  });
}

// ---------------------------------------------------------------------------
// `beginUpload` — the single entry-point used by BlockEditor to start a File
// upload for an EXISTING image block.
//
// This wraps the callback-based dispatchUploadRequest into a Promise-based
// API so call sites can simply `await beginUpload(blockId, file)` and get
// a typed Result<UploadResult, string>.
// ---------------------------------------------------------------------------

export function beginUpload(
  blockId: BlockId,
  file: File,
): Promise<Result<UploadResult, string>> {
  return new Promise((resolve) => {
    // 1. Create a temp preview URL and AbortController.
    const tempUrl = createTempObjectUrl(file);
    const controller = new AbortController();
    setUploadState(blockId, {
      status: 'pending',
      progress: 0,
      file,
      tempPreviewUrl: tempUrl,
      controller,
    });

    // 2. Measure natural dims synchronously-ish via an offscreen img so we
    //    can hand dimensions back to the caller along with the final URL.
    let measuredW: number | undefined;
    let measuredH: number | undefined;
    if (typeof document !== 'undefined') {
      const probe = document.createElement('img');
      let probeDone = false;
      const finish = () => {
        if (probeDone) return;
        probeDone = true;
        measuredW = probe.naturalWidth || undefined;
        measuredH = probe.naturalHeight || undefined;
      };
      probe.onload = finish;
      probe.onerror = finish;
      probe.src = tempUrl;
      setTimeout(finish, 4000);
    }

    // 3. Dispatch via the registered handler (external or mock-upstream).
    //    If dispatchUploadRequest synchronously calls onError (e.g. "no handler
    //    registered"), we still fall through to the same promise-settle path.
    try {
      dispatchUploadRequest(file.name, file, controller, {
        onProgress: (p01) => {
          const cur = getUploadState(blockId);
          if (!cur) return;
          const clamped = Math.max(0, Math.min(1, Number.isFinite(p01) ? p01 : 0));
          setUploadState(blockId, { ...cur, progress: clamped });
        },
        onSuccess: (result) => {
          const prev = getUploadState(blockId);
          if (prev?.tempPreviewUrl && prev.tempPreviewUrl !== result.url) {
            try {
              URL.revokeObjectURL(prev.tempPreviewUrl);
            } catch { /* ignore */ }
            tempUrls.delete(prev.tempPreviewUrl);
          }
          setUploadState(blockId, null);
          resolve({
            ok: true,
            value: {
              url: result.url,
              width: result.width ?? measuredW,
              height: result.height ?? measuredH,
              alt: result.alt,
              title: result.title,
              fileId: result.fileId,
            },
          });
        },
        onError: (msg) => {
          const prev = getUploadState(blockId);
          // Keep tempPreviewUrl around on error so users can still see what
          // the image would have been — it's cleaned up via setUploadState.
          setUploadState(blockId, {
            status: 'error',
            progress: 0,
            error: msg,
            file: prev?.file ?? file,
            tempPreviewUrl: prev?.tempPreviewUrl,
          });
          resolve({ ok: false, error: msg });
        },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setUploadState(blockId, {
        status: 'error',
        progress: 0,
        error: msg,
        file,
        tempPreviewUrl: tempUrl,
      });
      resolve({ ok: false, error: msg });
    }
  });
}

// ---------------------------------------------------------------------------
// srcToFile: convert an <img src="..."> value to a File for upload.
// Supports data: URIs (base64), blob: URIs, and http(s):// URLs.
// ---------------------------------------------------------------------------

/**
 * Convert an image src string (from an <img> tag in pasted HTML) to a File
 * object suitable for the upload pipeline.
 *
 * - `data:image/...;base64,...` → decode base64 → Blob → File
 * - `blob:...`                  → fetch blob → File
 * - `http://` / `https://`      → fetch (may fail due to CORS) → File
 *
 * Returns null if the conversion fails (e.g. CORS, invalid data, network).
 */
export async function srcToFile(
  src: string,
  fallbackName?: string,
): Promise<File | null> {
  if (!src) return null;

  try {
    // 1. data: URI — parse inline, no network needed.
    if (src.startsWith('data:')) {
      return dataUriToFile(src, fallbackName);
    }

    // 2. blob: URI — fetch the already-local blob.
    // 3. http(s):// URL — fetch the remote resource (may throw on CORS).
    const response = await fetch(src);
    if (!response.ok) return null;
    const blob = await response.blob();
    // Some servers return generic "application/octet-stream"; infer from URL.
    const ext = guessExtension(blob.type, src);
    const name = fallbackName
      ? ensureExtension(fallbackName, ext)
      : `image-${Date.now()}${ext}`;
    return new File([blob], name, { type: blob.type || 'image/png' });
  } catch {
    return null;
  }
}

/** Parse a `data:` URI into a File. */
function dataUriToFile(dataUri: string, fallbackName?: string): File | null {
  const match = dataUri.match(/^data:([^;,]+)?(;base64)?,(.*)$/);
  if (!match) return null;
  const [, mimeRaw, isBase64, data] = match;
  const mime = mimeRaw || 'image/png';
  const isB64 = !!isBase64;

  let bytes: Uint8Array;
  if (isB64) {
    // Decode base64 to binary.
    const binary = atob(data!);
    bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  } else {
    // URL-encoded plain text (rare for images but technically valid).
    const text = decodeURIComponent(data!);
    bytes = new TextEncoder().encode(text);
  }

  const ext = guessExtension(mime, dataUri);
  const name = fallbackName
    ? ensureExtension(fallbackName, ext)
    : `image-${Date.now()}${ext}`;
  // Wrap in a new Blob — some TS lib targets need the cast.
  const blob = new Blob([bytes as BlobPart], { type: mime });
  return new File([blob], name, { type: mime });
}

/** Guess the file extension from mime type or URL. */
function guessExtension(mime: string, url: string): string {
  if (mime.includes('png')) return '.png';
  if (mime.includes('jpeg') || mime.includes('jpg')) return '.jpg';
  if (mime.includes('gif')) return '.gif';
  if (mime.includes('webp')) return '.webp';
  if (mime.includes('svg')) return '.svg';
  if (mime.includes('bmp')) return '.bmp';
  // Fall back to URL path extension.
  const urlMatch = url.match(/\.(png|jpe?g|gif|webp|svg|bmp)$/i);
  if (urlMatch) return `.${urlMatch[1]!.toLowerCase()}`;
  return '.png';
}

/** Ensure a filename ends with the given extension. */
function ensureExtension(name: string, ext: string): string {
  if (name.toLowerCase().endsWith(ext.toLowerCase())) return name;
  return name + ext;
}
