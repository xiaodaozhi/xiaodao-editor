/**
 * Image block extension.
 *
 * Image is a first-class block with content: 'none' (no inline text editing).
 * The document attrs carry ONLY the final, persisted image state:
 *   src    : the final, uploaded image URL. Empty means "not yet uploaded".
 *   alt    : optional accessibility text.
 *   title  : optional tooltip.
 *   width  : display width in px. Missing means "use natural size".
 *   height : display height in px.
 *   caption: optional caption text (stored as attr; rendered under the image).
 *
 * UPLOAD STATUS IS NOT STORED IN ATTRS. Pending / progress / error state
 * lives in the view-side imageUpload.ts transient map. This guarantee:
 *   - undo/redo restores the *block itself* (with its final src if any)
 *   - docFromData never sees "blob:" URLs or "progress" values
 *   - reload from persistence: no temporary state is restored
 *
 * Uploads are initiated:
 *   1. Via slash menu (/image) → opens file picker.
 *   2. Via paste of an image file or HTML <img>.
 *   3. Via drag-and-drop of image files into the editor.
 *   4. Programmatically via the `startImageUpload` async command exposed
 *      via `editor.getExtensionMethod('startImageUpload')`.
 *
 * The upload handler is supplied via `createImageExtension({ upload })`:
 * the host application injects a real upload function at extension creation
 * time. If omitted, an in-memory mock upload is used (suitable for demos;
 * NOT for persisted documents because `blob:` URLs do not survive reload).
 *
 * `onFileCleanup` is invoked when the last block referencing a given fileId
 * is removed, so the host can reclaim cloud storage.
 */

import { defineComponent, h, ref, type PropType, onBeforeUnmount, type VNode } from 'vue';
import type { Extension } from '../core/extension/Extension';
import type { Plugin, PluginEditor } from '../core/plugin/Plugin';
import type { Block, BlockId } from '../core/types';
import { inlineText } from '../core/types';
import SafeHtml from '../view/ui/SafeHtml.vue';
import {
  ICON_IMAGE, ICON_SPINNER, ICON_RETRY, ICON_CLOSE, ICON_REPLACE, ICON_UPLOAD,
} from '../view/ui/icons';
import {
  getUploadState, subscribeUploadState, setUploadState, dispatchUploadRequest,
  createTempObjectUrl, registerUploadHandler, beginUpload, cleanupUploadState,
  mockUpload,
  type UploadState,
  type UploadImageHandler,
  type UploadRequestHandler,
  type UploadCallbacks,
} from '../view/imageUpload';
import { useEditor, useEditable } from '../view/context';
import { useI18n } from '../i18n';
import { COMMON_ATTRS, classesFromAttrs } from './_commonAttrs';
import { defaultAttrs } from '../core/schema/BlockSchema';

// ---------------------------------------------------------------------------
// Command names
// ---------------------------------------------------------------------------

/** Synchronous command that aborts an in-flight upload for a block. */
export const CANCEL_IMAGE_UPLOAD_COMMAND = 'cancelImageUpload';

// ---------------------------------------------------------------------------
// Schema attrs (persisted: nothing transient here)
// ---------------------------------------------------------------------------

export interface ImageAttrs {
  readonly align: string;
  readonly src: string;
  readonly alt: string;
  readonly title: string;
  readonly width: number;
  readonly height: number;
  readonly caption: string;
  /**
   * Optional server-side file identifier (integer). Set by the
   * `UploadImageHandler` passed to `createImageExtension({ upload })`
   * when it resolves. The `image-upload` plugin tracks reference counts
   * for each fileId and invokes `onFileCleanup` (also passed to
   * `createImageExtension`) when the last block referencing a fileId is
   * removed, so the consumer can reclaim cloud storage.
   * 0 (the default) means "no file id" / not uploaded yet / no managed file.
   */
  readonly fileId: number;
}

const IMAGE_ATTRS = {
  align: COMMON_ATTRS.align,
  // image can be a CHILD block, so it needs `indent` to reflect its
  // nesting depth and render the be-indent-N class (nestable=false only means
  // it can't be a parent).
  indent: COMMON_ATTRS.indent,
  src: {
    default: '' as const,
    validate: (v: unknown): boolean => typeof v === 'string',
  },
  alt: {
    default: '' as const,
    validate: (v: unknown): boolean => typeof v === 'string',
  },
  title: {
    default: '' as const,
    validate: (v: unknown): boolean => typeof v === 'string',
  },
  width: {
    default: 0 as const,
    validate: (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v) && v >= 0,
  },
  height: {
    default: 0 as const,
    validate: (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v) && v >= 0,
  },
  caption: {
    default: '' as const,
    validate: (v: unknown): boolean => typeof v === 'string',
  },
  fileId: {
    default: 0 as const,
    validate: (v: unknown): boolean =>
      typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v) && v >= 0,
  },
} as const;

// ---------------------------------------------------------------------------
// Renderer component
// ---------------------------------------------------------------------------

const ImageBlock = defineComponent({
  name: 'ImageBlock',
  props: {
    block: { type: Object as PropType<Block>, required: true },
    placeholder: { type: String, default: undefined },
  },
  setup(props) {
    void props.placeholder; // reserved for future use
    const editor = useEditor();
    const editable = useEditable();
    const i18n = useI18n();
    const blockId = props.block.id;

    // Live upload status (side-channel, not in attrs)
    const uploadState = ref<UploadState | null>(getUploadState(blockId));
    const unsub = subscribeUploadState((id, s) => {
      if (id === blockId) uploadState.value = s;
    });
    onBeforeUnmount(() => {
      unsub();
    });

    // Natural-size measurement for resize UX
    const naturalSize = ref<{ w: number; h: number } | null>(null);
    const imgEl = ref<HTMLImageElement | null>(null);

    // Resize drag state
    const isResizing = ref(false);
    let resizeStartW = 0;
    let resizeStartH = 0;
    let resizeStartMouseX = 0;
    let resizeRatio = 1;

    function onImgLoad(): void {
      const el = imgEl.value;
      if (!el) return;
      naturalSize.value = { w: el.naturalWidth, h: el.naturalHeight };
      // If width/height attrs aren't set yet, initialize from natural size.
      const attrs = props.block.attrs;
      if ((!attrs.width || attrs.width === 0) && (!attrs.height || attrs.height === 0)) {
        editor.commands.setAttrs?.({
          id: blockId,
          attrs: {
            ...attrs,
            width: el.naturalWidth,
            height: el.naturalHeight,
          },
        });
      }
    }

    function onResizeStart(e: MouseEvent): void {
      e.preventDefault();
      e.stopPropagation();
      const attrs = props.block.attrs;
      // 拖拽基准必须与实际显示尺寸一致：attrs 里存的是自然尺寸，可能大于
      // 容器宽度（CSS max-width:100% 视觉压缩）或超过高度上限
      // （max-height:600px 等比压缩）。若直接以 attrs 为基准，move 里的
      // 钳制会让首次拖动瞬间跳变/卡死。故先把宽高折算成当前显示尺寸。
      const container = imgEl.value?.closest('.block-image-container') as HTMLElement | null;
      const maxContainerW = container ? container.clientWidth - 8 : 0;
      let baseW = (attrs.width as number) || naturalSize.value?.w || 200;
      let baseH = (attrs.height as number) || naturalSize.value?.h || 150;
      if (baseH > MAX_IMAGE_HEIGHT) {
        const ratio = baseW / Math.max(1, baseH);
        baseH = MAX_IMAGE_HEIGHT;
        baseW = Math.round(baseH * ratio);
      }
      if (maxContainerW > 0 && baseW > maxContainerW) {
        const ratio = baseW / Math.max(1, baseH);
        baseW = maxContainerW;
        baseH = Math.round(baseW / ratio);
      }
      resizeStartW = baseW;
      resizeStartH = baseH;
      resizeStartMouseX = e.clientX;
      resizeRatio = resizeStartW / Math.max(1, resizeStartH);
      isResizing.value = true;
      document.addEventListener('mousemove', onResizeMove, true);
      document.addEventListener('mouseup', onResizeEnd, true);
      document.addEventListener('selectstart', onResizeSelectStart, true);
    }

    const MAX_IMAGE_HEIGHT = 600;

    function onResizeMove(e: MouseEvent): void {
      if (!isResizing.value) return;
      const dx = e.clientX - resizeStartMouseX;
      // Use the X axis as primary, preserve aspect ratio.
      let newW = Math.max(40, Math.round(resizeStartW + dx));
      let newH = Math.max(40, Math.round(newW / resizeRatio));
      // Enforce max height constraint.
      if (newH > MAX_IMAGE_HEIGHT) {
        newH = MAX_IMAGE_HEIGHT;
        newW = Math.max(40, Math.round(newH * resizeRatio));
      }
      // Enforce max width based on container width.
      const container = imgEl.value?.closest('.block-image-container') as HTMLElement | null;
      if (container) {
        const maxContainerW = container.clientWidth - 8; // minus padding
        if (newW > maxContainerW) {
          newW = Math.max(40, maxContainerW);
          newH = Math.max(40, Math.round(newW / resizeRatio));
        }
      }
      editor.commands.setAttrs?.({
        id: blockId,
        attrs: {
          ...props.block.attrs,
          width: newW,
          height: newH,
        },
      });
    }

    function onResizeEnd(): void {
      isResizing.value = false;
      document.removeEventListener('mousemove', onResizeMove, true);
      document.removeEventListener('mouseup', onResizeEnd, true);
      document.removeEventListener('selectstart', onResizeSelectStart, true);
    }

    function onResizeSelectStart(e: Event): void {
      e.preventDefault();
    }

    // File picker (for replace / first-time choose)
    const fileInputRef = ref<HTMLInputElement | null>(null);
    function openFilePicker(): void {
      if (!fileInputRef.value) {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.multiple = false;
        fileInputRef.value = input;
        input.addEventListener('change', () => {
          const f = input.files?.[0];
          if (f) handleChosenFile(f);
          input.value = '';
        });
      }
      fileInputRef.value.click();
    }

    function handleChosenFile(file: File): void {
      // If this block already has a src, we are replacing it:
      // mark it as pending for this block, and dispatch the upload.
      // The block itself stays; only attrs change.
      const tempPreviewUrl = createTempObjectUrl(file);
      const controller = new AbortController();
      setUploadState(blockId, {
        status: 'pending',
        progress: 0,
        file,
        tempPreviewUrl,
        controller,
      });
      dispatchUploadRequest(file.name, file, controller, {
        onProgress: (p01) => {
          const cur = getUploadState(blockId);
          if (!cur) return;
          setUploadState(blockId, { ...cur, progress: Math.max(0, Math.min(1, p01)) });
        },
        onSuccess: (result) => {
          const prev = getUploadState(blockId);
          if (prev?.tempPreviewUrl && prev.tempPreviewUrl !== result.url) {
            try {
              URL.revokeObjectURL(prev.tempPreviewUrl);
            } catch { /* ignore */ }
          }
          const baseAttrs = { ...props.block.attrs, src: result.url } as unknown as ImageAttrs;
          const mergedAttrs: ImageAttrs = {
            ...baseAttrs,
            width: (result.width ?? baseAttrs.width) as number,
            height: (result.height ?? baseAttrs.height) as number,
            alt: (result.alt ?? baseAttrs.alt) as string,
            title: (result.title ?? baseAttrs.title) as string,
            fileId: (result.fileId ?? baseAttrs.fileId) as number,
          };
          editor.commands.setAttrs?.({ id: blockId, attrs: mergedAttrs });
          setUploadState(blockId, null);
        },
        onError: (msg) => {
          const cur = getUploadState(blockId);
          if (!cur) return;
          setUploadState(blockId, { ...cur, status: 'error', progress: 0, error: msg });
        },
      });
    }

    function onRetryClick(): void {
      const cur = getUploadState(blockId);
      if (!cur || !cur.file) return;
      handleChosenFile(cur.file);
    }

    function onRemoveClick(): void {
      // Remove the block itself. The upload state is cleaned up by the
      // image-upload plugin's applyTransaction hook.
      editor.commands.removeBlock?.({ id: blockId });
    }

    // Detect effective src: if upload has a temp preview, use that for the
    // live DOM preview but DO NOT touch attrs. Otherwise use the persisted src.
    function effectiveSrc(): string {
      const us = uploadState.value;
      if (us?.tempPreviewUrl) return us.tempPreviewUrl;
      return (props.block.attrs.src as string) ?? '';
    }

    return () => {
      const attrs = props.block.attrs;
      const src = effectiveSrc();
      const us = uploadState.value;
      const imageW = attrs.width as number;
      const imageH = attrs.height as number;

      // Effective DISPLAY width: the wrapper and <img> must hug the image's
      // actual on-screen width, not the raw attr width. CSS caps the img at
      // max-height: MAX_IMAGE_HEIGHT, so a tall image (e.g. 800×1600) renders
      // 300×600: using the raw 800px attr width here would stretch the
      // wrapper to ~100% of the container with empty side gutters, until a
      // resize drag (which enforces the same cap) snaps it back.
      let displayW = imageW;
      if (imageW > 0 && imageH > MAX_IMAGE_HEIGHT) {
        displayW = Math.max(1, Math.round((imageW * MAX_IMAGE_HEIGHT) / imageH));
      }

      const wrapperStyle: Record<string, string> = {};
      const hasError = us?.status === 'error';
      if (imageW && imageW > 0 && !hasError) wrapperStyle.width = `${displayW}px`;
      const children: VNode[] = [];

      // Toolbar overlay (shown always on hover; forced-visible when the
      // block has a pending/error upload state). Hidden entirely in
      // read-only mode: replace/remove are editing actions.
      // Selection is shown by the SAME generic block-focus mechanism as every
      // other non-text block (image / table / divider / equation): the host's
      // `.block-host.block-focused` class, set by `setFocusedBlock`, drives the
      // toolbar via CSS. We no longer read `editor.getState().selection` here.
      // `forceToolbarVisible` (pending/errored upload) is a side-channel state
      // that must still force the toolbar open regardless of focus.
      const forceToolbarVisible = !!us && us.status !== 'success';
      if (editable.value) {
        children.push(
          h('div', {
            class: [
              'image-block-toolbar',
              { 'image-block-toolbar-forced': forceToolbarVisible },
            ],
          }, [
            h('button', {
              class: 'image-block-btn',
              title: i18n.t('image.replace'),
              onClick: (e: MouseEvent) => {
                e.stopPropagation();
                openFilePicker();
              },
            }, [h(SafeHtml, { html: ICON_REPLACE })]),
            h('button', {
              class: 'image-block-btn',
              title: i18n.t('image.remove'),
              onClick: (e: MouseEvent) => {
                e.stopPropagation();
                onRemoveClick();
              },
            }, [h(SafeHtml, { html: ICON_CLOSE })]),
          ]),
        );
      }

      // --- Upload pending ---
      if (us?.status === 'pending') {
        const pct = Math.round(us.progress * 100);
        children.push(
          h('div', { class: 'image-block-upload-overlay' }, [
            h(SafeHtml, { html: ICON_SPINNER, class: 'image-block-spinner' }),
            h('div', { class: 'image-block-upload-label' }, i18n.t('image.uploading')),
            h('div', { class: 'image-block-progress-track' }, [
              h('div', {
                class: 'image-block-progress-bar',
                style: { width: `${pct}%` },
              }),
            ]),
            h('div', { class: 'image-block-progress-pct' }, `${pct}%`),
          ]),
        );
      }

      // --- Upload error ---
      if (us?.status === 'error') {
        children.push(
          h('div', { class: 'image-block-error-overlay' }, [
            h('div', { class: 'image-block-error-icon' }, '!'),
            h('div', { class: 'image-block-error-title' }, i18n.t('image.uploadFailed')),
            h('div', { class: 'image-block-error-msg' }, us.error ?? ''),
            h('button', {
              class: 'image-block-retry-btn',
              onClick: (e: MouseEvent) => {
                e.stopPropagation();
                onRetryClick();
              },
            }, [
              h(SafeHtml, { html: ICON_RETRY }),
              ' ',
              i18n.t('image.retry'),
            ]),
          ]),
        );
      }

      // --- No image yet (empty src, not uploading) → placeholder area.
      if (!src && (!us || us.status === 'success')) {
        children.push(
          h('div', {
            class: 'image-block-empty',
            onClick: (e: MouseEvent) => {
              e.stopPropagation();
              // Read-only: the placeholder is informational only.
              if (!editable.value) return;
              openFilePicker();
            },
          }, [
            h(SafeHtml, { html: ICON_UPLOAD, class: 'image-block-empty-icon' }),
            h('div', { class: 'image-block-empty-title' }, i18n.t('image.emptyTitle')),
            h('div', { class: 'image-block-empty-sub' }, i18n.t('image.emptySub')),
          ]),
        );
      }

      // --- Actual image element (rendered only when there's a src and NOT in error state) ---
      if (src && us?.status !== 'error') {
        const imgStyle: Record<string, string> = {};
        if (imageW && imageW > 0) imgStyle.width = `${displayW}px`;
        const imageArea: VNode[] = [
          h('img', {
            ref: imgEl,
            class: 'image-block-img',
            src,
            alt: (attrs.alt as string) || '',
            title: (attrs.title as string) || '',
            style: imgStyle,
            draggable: false,
            onLoad: onImgLoad,
            onError: () => {
              if (!us || (us.status !== 'pending' && us.status !== 'error')) {
                setUploadState(blockId, {
                  status: 'error',
                  progress: 0,
                  error: i18n.t('image.loadFailed'),
                  tempPreviewUrl: undefined,
                });
              }
            },
          }),
        ];
        // Resize handle: only when natural size is known AND editable.
        if (naturalSize.value && editable.value) {
          imageArea.push(
            h('div', {
              class: 'image-block-resize-handle',
              onMousedown: onResizeStart,
              title: i18n.t('image.resize'),
            }),
          );
        }
        children.push(
          h('div', { class: 'image-block-main' }, imageArea),
        );
      }

      // --- Caption (attr, persisted) ---
      // Always render the caption so users can click the placeholder to add
      // text, but hide it when the upload has failed: there is no image to
      // caption yet and the error card already fills the block area.
      const caption = (attrs.caption as string) || '';
      const isError = us?.status === 'error';
      if (!isError && (caption || src)) {
        children.push(
          h('div', {
            class: 'image-block-caption',
            contenteditable: editable.value ? 'true' : 'false',
            'data-placeholder': i18n.t('image.captionPlaceholder'),
            onBlur: (e: FocusEvent) => {
              const newText = (e.currentTarget as HTMLElement).textContent ?? '';
              if (newText !== caption) {
                editor.commands.setAttrs?.({
                  id: blockId,
                  attrs: { ...props.block.attrs, caption: newText },
                });
              }
            },
            onInput: () => { /* sync to model on blur to to not per-keystroke tr */ },
            onMousedown: (e: MouseEvent) => { e.stopPropagation(); },
            onClick: (e: MouseEvent) => { e.stopPropagation(); },
          }, caption),
        );
      }

      const wrapperClasses = ['block-image-wrapper'];
      if (us?.status === 'error') {
        wrapperClasses.push('image-block-wrapper-error');
      }
      if (us?.status === 'pending' && !src && !us.tempPreviewUrl) {
        wrapperClasses.push('image-block-wrapper-loading');
      }

      return h(
        'div',
        {
          class: ['block-image-container', 'block-focus-root', ...classesFromAttrs(attrs)],
        },
        [
          h(
            'div',
            {
              class: wrapperClasses,
              style: wrapperStyle,
            },
            children,
          ),
        ],
      );
    };
  },
});

// ---------------------------------------------------------------------------
// Options for `createImageExtension`. Following the same pattern as Tiptap /
// ProseMirror / Lexical / Plate: the host injects the *implementation*
// (upload function, file-cleanup callback) at extension creation time.
// `BlockEditor.vue` itself never touches these options.
// ---------------------------------------------------------------------------

export interface ImageExtensionOptions {
  /**
   * Real upload handler. When omitted the extension falls back to an
   * in-memory mock upload that stores the file as an object URL: fine
   * for demos but NOT for persisted documents (object URLs do not
   * survive reload).
   */
  readonly upload?: UploadImageHandler;
  /**
   * Invoked when the LAST image block referencing a given fileId is
   * removed/replaced. Hosts can use this to reclaim cloud storage.
   */
  readonly onFileCleanup?: (fileId: number) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeHtmlAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeHtmlText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Wrap an `UploadImageHandler` (Promise-based, percent 0–100) into the
 * `UploadRequestHandler` shape that `imageUpload.ts` expects internally
 * (callback-based, percent 0–1). When `handler` is null, fall back to the
 * built-in mock upload (object URL with fake progress).
 */
function buildUploadRequestHandler(handler: UploadImageHandler | null): UploadRequestHandler {
  if (handler) {
    return (name, file, controller, callbacks) => {
      handler(name, file, controller, (pct: number) => {
        const clamped = Number.isFinite(pct) ? Math.max(0, Math.min(1, pct / 100)) : 0;
        callbacks.onProgress(clamped);
      })
        .then((result) => {
          callbacks.onSuccess({
            url: result.url,
            width: result.width,
            height: result.height,
            alt: result.alt,
            title: result.title,
            fileId: result.fileId,
          });
        })
        .catch((err) => {
          if (controller.signal.aborted) return;
          callbacks.onError(err instanceof Error ? err.message : String(err));
        });
    };
  }
  return (_name, file, _controller, callbacks: UploadCallbacks) => {
    void mockUpload(file, callbacks.onProgress).then(
      (r) => callbacks.onSuccess({ url: r.url, width: r.width, height: r.height }),
      (err) => callbacks.onError(err instanceof Error ? err.message : String(err)),
    );
  };
}

// ---------------------------------------------------------------------------
// Async upload command implementation (file/string URL → image block → attrs)
// ---------------------------------------------------------------------------

export interface BeginImageUploadOpts {
  readonly relativeToBlockId?: BlockId | null;
  readonly position?: 'after' | 'before' | 'replace';
  readonly convertIfEmpty?: boolean;
}

export type BeginImageUploadFn = (
  fileOrSrc: File | string,
  opts?: BeginImageUploadOpts,
) => Promise<BlockId | null>;

/** Key under which the async command is registered on the Editor. */
export const START_IMAGE_UPLOAD_METHOD = 'startImageUpload';

/**
 * Resolve a target image-block id and either replace an empty paragraph
 * (slash-command path) or insert a fresh image block (drop / paste /
 * programmatic path), then write final attrs into it.
 *
 * Migrated verbatim from the previous `beginImageUpload` orchestration
 * in `BlockEditor.vue`. Now lives on the ImageExtension side of the
 * boundary; `BlockEditor.vue` simply forwards to it.
 *
 * Takes the `PluginEditor` handle exposed by `PluginInitContext`: that
 * handle carries the registries, commands and dispatch surfaces that
 * image upload needs, so the orchestrator can run without the view
 * layer being involved.
 */
async function runStartImageUpload(
  editor: PluginEditor,
  fileOrSrc: File | string,
  opts: BeginImageUploadOpts = {},
): Promise<BlockId | null> {
  const {
    relativeToBlockId = null,
    position = 'after',
    convertIfEmpty = true,
  } = opts;

  // --- Step 1: resolve the target image block id ------------------------
  let imageBlockId: BlockId | null = null;

  let anchorBlockId: BlockId | null = relativeToBlockId ?? null;
  if (!anchorBlockId) {
    const sel = editor.getState().selection;
    if (sel.kind === 'caret') anchorBlockId = sel.blockId;
    else if (sel.kind === 'text') anchorBlockId = sel.anchor.blockId;
  }
  if (!anchorBlockId) {
    const firstId = editor.getState().doc.root[0] ?? null;
    anchorBlockId = firstId;
  }

  if (position === 'replace' && anchorBlockId) {
    const schema = editor.registries.schema.get('image');
    if (schema) {
      editor.commands.replaceBlock?.({
        id: anchorBlockId,
        type: 'image',
        attrs: defaultAttrs(schema),
      });
      imageBlockId = anchorBlockId;
    }
  }

  if (!imageBlockId && anchorBlockId && convertIfEmpty && position !== 'before') {
    const doc = editor.getState().doc;
    const anchor = doc.blocks.get(anchorBlockId);
    if (anchor && anchor.type === 'paragraph' && inlineText(anchor.content).length === 0) {
      const schema = editor.registries.schema.get('image');
      if (schema) {
        editor.commands.replaceBlock?.({
          id: anchorBlockId,
          type: 'image',
          attrs: defaultAttrs(schema),
        });
        imageBlockId = anchorBlockId;
      }
    }
  }

  if (!imageBlockId && anchorBlockId && position === 'before') {
    const schema = editor.registries.schema.get('image');
    if (schema) {
      editor.commands.insertBlock?.({
        before: anchorBlockId,
        type: 'image',
        attrs: defaultAttrs(schema),
      });
      const sel = editor.getState().selection;
      if (sel.kind === 'caret') imageBlockId = sel.blockId;
      else if (sel.kind === 'text') imageBlockId = sel.anchor.blockId;
    }
  }

  if (!imageBlockId && anchorBlockId) {
    const schema = editor.registries.schema.get('image');
    if (schema) {
      editor.commands.insertBlock?.({
        after: anchorBlockId,
        type: 'image',
        attrs: defaultAttrs(schema),
      });
      const sel = editor.getState().selection;
      if (sel.kind === 'caret') imageBlockId = sel.blockId;
      else if (sel.kind === 'text') imageBlockId = sel.anchor.blockId;
    }
  }

  if (!imageBlockId) {
    const schema = editor.registries.schema.get('image');
    if (!schema) return null;
    const doc = editor.getState().doc;
    const lastId = doc.root[doc.root.length - 1] ?? null;
    if (lastId) {
      editor.commands.insertBlock?.({
        after: lastId,
        type: 'image',
        attrs: defaultAttrs(schema),
      });
    } else {
      editor.commands.insertBlock?.({
        after: null as unknown as BlockId,
        type: 'image',
        attrs: defaultAttrs(schema),
      });
    }
    const sel = editor.getState().selection;
    if (sel.kind === 'caret') imageBlockId = sel.blockId;
    else if (sel.kind === 'text') imageBlockId = sel.anchor.blockId;
  }

  if (!imageBlockId) return null;

  // --- Step 2: string URL → measure dims + setAttrs (no upload) -------
  if (typeof fileOrSrc === 'string') {
    const src = fileOrSrc;
    try {
      const measured = await new Promise<{ width?: number; height?: number }>((resolve) => {
        if (typeof document === 'undefined') return resolve({});
        const img = document.createElement('img');
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          resolve({
            width: img.naturalWidth || undefined,
            height: img.naturalHeight || undefined,
          });
        };
        img.onload = finish;
        img.onerror = finish;
        img.src = src;
        setTimeout(finish, 4000);
      });
      const attrs: Partial<ImageAttrs> = {
        src,
        width: measured.width,
        height: measured.height,
      };
      editor.commands.setAttrs?.({ id: imageBlockId, attrs });
    } catch {
      editor.commands.setAttrs?.({ id: imageBlockId, attrs: { src } });
    }
    return imageBlockId;
  }

  // --- Step 3: File → upload + setAttrs -------------------------------
  const result = await beginUpload(imageBlockId, fileOrSrc);
  if (result.ok) {
    const r = result.value;
    const attrs: Partial<ImageAttrs> = {
      src: r.url,
      alt: r.alt,
      title: r.title,
      width: r.width,
      height: r.height,
      fileId: r.fileId,
    };
    editor.commands.setAttrs?.({ id: imageBlockId, attrs });
  }
  return imageBlockId;
}

// ---------------------------------------------------------------------------
// Plugin: upload handler wiring + fileId ref-count tracking + cleanup
// ---------------------------------------------------------------------------

interface ImagePluginState {
  readonly refCounts: Map<number, number>;
  readonly prevBlocks: ReadonlyMap<BlockId, Block>;
}

/** Walk every block in the document, count fileIds across all image blocks.
 *  `fileId === 0` is the "no managed file" sentinel and is skipped. */
function computeRefCounts(blocks: ReadonlyMap<BlockId, Block>): Map<number, number> {
  const out = new Map<number, number>();
  for (const block of blocks.values()) {
    if (block.type !== 'image') continue;
    const fid = (block.attrs as unknown as ImageAttrs).fileId;
    if (typeof fid === 'number' && Number.isFinite(fid) && fid > 0) {
      out.set(fid, (out.get(fid) ?? 0) + 1);
    }
  }
  return out;
}

function createImageUploadPlugin(
  upload: UploadImageHandler | null,
  onFileCleanup: ((fileId: number) => void) | undefined,
): Plugin {
  // Held in a closure-scoped let so onDestroy can call them. `ctx.editor`
  // is only available inside `init`, but `onDestroy` does not receive ctx.
  let unregisterStartMethod: (() => void) | null = null;

  return {
    name: 'image-upload',

    init(state, ctx) {
      // 1) Inject the upload handler into the imageUpload.ts side-channel
      //    so ImageBlock's replace/upload flow can call it.
      const uploadHandler = buildUploadRequestHandler(upload);
      registerUploadHandler(uploadHandler);

      // 2) Expose the async `startImageUpload` orchestrator as an
      //    extension method. The view layer (BlockEditor) reads it via
      //    `editor.getExtensionMethod('startImageUpload')` and forwards
      //    to Vue components through the existing useBeginImageUpload()
      //    injection key: no Image-specific knowledge in BlockEditor.
      unregisterStartMethod = ctx.editor.registerExtensionMethod(
        START_IMAGE_UPLOAD_METHOD,
        (fileOrSrc: File | string, beginOpts?: BeginImageUploadOpts) =>
          runStartImageUpload(ctx.editor, fileOrSrc, beginOpts ?? {}),
      );

      // 3) Seed plugin state with ref-counts derived from the initial doc
      //    so the first applyTransaction comparison is accurate.
      return {
        refCounts: computeRefCounts(state.doc.blocks),
        prevBlocks: state.doc.blocks,
      } satisfies ImagePluginState;
    },

    applyTransaction(_tr, prevState, nextDoc, _nextSelection, _ctx) {
      const prev = prevState.pluginState['image-upload'] as ImagePluginState | undefined;
      const prevRefCounts = prev?.refCounts ?? new Map<number, number>();
      const prevBlocks = prev?.prevBlocks ?? nextDoc.blocks;

      const newRefCounts = computeRefCounts(nextDoc.blocks);

      // Trigger onFileCleanup for any fileId whose reference count
      // dropped from >0 to 0 in this transaction.
      for (const [fid, prevCount] of prevRefCounts) {
        const newCount = newRefCounts.get(fid) ?? 0;
        if (newCount === 0 && prevCount > 0) {
          onFileCleanup?.(fid);
        }
      }

      // Clean up transient upload state for any removed blocks. The
      // upload side-channel lives outside the document so a normal
      // transaction rollback wouldn't touch it.
      const removed: BlockId[] = [];
      for (const [id] of prevBlocks) {
        if (!nextDoc.blocks.has(id)) removed.push(id);
      }
      if (removed.length > 0) cleanupUploadState(removed);

      return {
        refCounts: newRefCounts,
        prevBlocks: nextDoc.blocks,
      } satisfies ImagePluginState;
    },

    onDestroy() {
      registerUploadHandler(null);
      unregisterStartMethod?.();
      unregisterStartMethod = null;
    },
  };
}

// ---------------------------------------------------------------------------
// Extension spec
// ---------------------------------------------------------------------------

/**
 * Create the Image block extension with optional upload + cleanup hooks.
 *
 * Usage:
 *   ```ts
 *   const myExt = createImageExtension({
 *     upload: async (name, file, controller, onProgress) => {
 *       // upload `file` to your cloud; return { url, width, height, fileId }
 *     },
 *     onFileCleanup: (fileId) => api.deleteCloudFile(fileId),
 *   });
 *   new Editor({ extensions: [...BuiltinExtensions.filter(e => e.name !== 'image'), myExt] });
 *   ```
 *
 * `BlockEditor.vue` itself does NOT know about upload or file cleanup:
 * it only forwards the existing `useBeginImageUpload()` Vue injection to
 * the async command this extension registers on the editor.
 */
export function createImageExtension(options: ImageExtensionOptions = {}): Extension {
  const plugin = createImageUploadPlugin(options.upload ?? null, options.onFileCleanup);

  return {
    name: 'image',
    schema: {
      type: 'image',
      // Image blocks have no inline text: caption is stored as an attr and
      // edited via a separate contenteditable in the renderer.
      content: 'none',
      nestable: false,
      attrs: { ...IMAGE_ATTRS },
      empty: (block: Block): boolean => {
        const s = block.attrs.src;
        return typeof s !== 'string' || s.length === 0;
      },
    },
    renderer: { component: ImageBlock, editable: false },
    // Synchronous command surface: cancel an in-flight upload. The async
    // half (startImageUpload) lives on the editor as an extension method
    // so it can return a Promise without breaking the synchronous
    // CommandFn contract.
    commands: [
      {
        name: CANCEL_IMAGE_UPLOAD_COMMAND,
        run: (args) => (_state, _dispatch) => {
          const blockId = (args as { blockId?: BlockId })?.blockId;
          if (typeof blockId !== 'string') return false;
          setUploadState(blockId, null);
          return true;
        },
      },
    ],
    plugins: [plugin],
    slashCommands: [
      {
        id: 'image',
        title: 'slash.image.title',
        keywords: ['image', 'picture', 'photo', 'img', '图片', '图像', '照片'],
        description: 'slash.image.description',
        icon: ICON_IMAGE,
        command: 'convertBlock',
        category: 'other',
        args: (): unknown => ({ id: '__currentBlock__', type: 'image', attrs: {} }),
      },
    ],
    serialize: {
      toHTML: (block: Block): string => {
        const a = block.attrs;
        const src = a.src as string;
        if (!src) return '';
        const alt = (a.alt as string) || '';
        const title = (a.title as string) || '';
        const w = a.width as number;
        const h = a.height as number;
        const caption = (a.caption as string) || '';
        const styleParts: string[] = [];
        if (w && w > 0) styleParts.push(`width:${w}px`);
        if (h && h > 0) styleParts.push(`height:${h}px`);
        const styleAttr = styleParts.length ? ` style="${styleParts.join(';')}"` : '';
        const titleAttr = title ? ` title="${escapeHtmlAttr(title)}"` : '';
        const img = `<img src="${escapeHtmlAttr(src)}" alt="${escapeHtmlAttr(alt)}"${titleAttr}${styleAttr}>`;
        if (caption) {
          return `<figure>${img}<figcaption>${escapeHtmlText(caption)}</figcaption></figure>`;
        }
        return img;
      },
      toMarkdown: (block: Block): string => {
        const a = block.attrs;
        const src = a.src as string;
        if (!src) return '';
        const alt = (a.alt as string) || '';
        const title = (a.title as string) || '';
        const caption = (a.caption as string) || '';
        const md = title
          ? `![${alt}](${src} "${title}")`
          : `![${alt}](${src})`;
        return caption ? `${md}\n*${caption}*` : md;
      },
    },
  };
}

/**
 * The default Image extension bundled with the editor. Uses an in-memory
 * mock upload (object URLs) and never invokes a cleanup callback. Suitable
 * for demos; persisted documents need `createImageExtension({ upload, onFileCleanup })`.
 */
export const ImageExtension: Extension = createImageExtension();
