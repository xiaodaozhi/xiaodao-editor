/**
 * Image block extension.
 *
 * Image is a first-class block with content: 'none' (no inline text editing).
 * The document attrs carry ONLY the final, persiste image state:
 *   src     — the final, uploaded image URL. Empty means "not yet uploaded".
 *   alt     — optional accessibility text.
 *   title   — optional tooltip.
 *   width   — display width in px. Missing means "use natural size".
 *   height  — display height in px.
 *   caption — optional caption text (stored as attr; rendered under the image).
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
 *   4. Programmatically via editor.commands.insertImageFile / insertImageUrl.
 *
 * In every case the Image extension only owns the SCHEMA + RENDERER + the
 * COMMANDS that create the image block. The *upload side-channel* is
 * mediated by BlockEditor.vue through imageUpload.ts so consumers can
 * hook `uploadImage` prop to take over.
 */

import { defineComponent, h, ref, type PropType, onBeforeUnmount } from 'vue';
import type { Extension } from '../core/extension/Extension';
import type { Block, BlockId } from '../core/types';
import SafeHtml from '../view/ui/SafeHtml.vue';
import {
  ICON_IMAGE, ICON_SPINNER, ICON_RETRY, ICON_CLOSE, ICON_REPLACE, ICON_UPLOAD,
} from '../view/ui/icons';
import {
  getUploadState, subscribeUploadState, setUploadState, dispatchUploadRequest,
  createTempObjectUrl,
  type UploadState,
} from '../view/imageUpload';
import { useEditor } from '../view/context';
import { useI18n } from '../i18n';

// ---------------------------------------------------------------------------
// Schema attrs (persisted — nothing transient here)
// ---------------------------------------------------------------------------

export interface ImageAttrs {
  readonly src: string;
  readonly alt: string;
  readonly title: string;
  readonly width: number;
  readonly height: number;
  readonly caption: string;
  /**
   * Optional server-side file identifier (integer). Set by the external
   * `uploadImage` handler when it returns a result. The editor tracks
   * reference counts for each fileId and emits `cleanup:image-file` when
   * the last block referencing a fileId is removed, so the consumer can
   * reclaim cloud storage.
   * 0 (the default) means "no file id" / not uploaded yet / no managed file.
   */
  readonly fileId: number;
}

const IMAGE_ATTRS = {
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
    const i18n = useI18n();
    const blockId = props.block.id;

    // Live upload status (side-channel, not in attrs)
    const uploadState = ref<UploadState | null>(getUploadState(blockId));
    const unsub = subscribeUploadState((id, s) => {
      if (id === blockId) uploadState.value = s;
    });
    onBeforeUnmount(() => { unsub(); });

    // Natural-size measurement for resize UX
    const naturalSize = ref<{ w: number; h: number } | null>(null);
    const imgEl = ref<HTMLImageElement | null>(null);

    // Resize drag state
    const isResizing = ref(false);
    let resizeStartW = 0;
    let resizeStartH = 0;
    let resizeStartMouseX = 0;
    let resizeStartMouseY = 0;
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
      resizeStartW = (attrs.width as number) || naturalSize.value?.w || 200;
      resizeStartH = (attrs.height as number) || naturalSize.value?.h || 150;
      resizeStartMouseX = e.clientX;
      resizeStartMouseY = e.clientY;
      resizeRatio = resizeStartW / Math.max(1, resizeStartH);
      isResizing.value = true;
      document.addEventListener('mousemove', onResizeMove, true);
      document.addEventListener('mouseup', onResizeEnd, true);
      document.addEventListener('selectstart', onResizeSelectStart, true);
    }

    function onResizeMove(e: MouseEvent): void {
      if (!isResizing.value) return;
      const dx = e.clientX - resizeStartMouseX;
      const dy = e.clientY - resizeStartMouseY;
      // Use the larger of the two deltas, preserve aspect ratio by default.
      // Holding Shift allows free resize; for simplicity we always lock ratio
      // using the X axis as primary.
      let newW = Math.max(40, Math.round(resizeStartW + dx));
      let newH = Math.max(40, Math.round(newW / resizeRatio));
      void dy;
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
            try { URL.revokeObjectURL(prev.tempPreviewUrl); } catch { /* ignore */ }
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
      // Remove the block itself. The upload state is cleaned up by
      // BlockEditor's subscribe → cleanupRemovedBlockIds.
      editor.commands.removeBlock?.({ id: blockId });
    }

    // Detect effective src: if upload has a temp preview, use that for the
    // live DOM preview but DO NOT touch attrs. Otherwise use the persisted src.
    function effectiveSrc(): string {
      const us = uploadState.value;
      if (us?.tempPreviewUrl) return us.tempPreviewUrl;
      return (props.block.attrs.src as string) ?? '';
    }

    function onBlockClick(e: MouseEvent): void {
      // Clicking the image shell selects the block (Notion-style).
      e.stopPropagation();
      editor.commands.selectBlock?.({ blockId });
    }

    return () => {
      const attrs = props.block.attrs;
      const src = effectiveSrc();
      const us = uploadState.value;
      const imageW = attrs.width as number;
      const imageH = attrs.height as number;

      const wrapperStyle: Record<string, string> = {};
      if (imageW && imageW > 0) wrapperStyle.width = `${imageW}px`;

      const children: any[] = [];

      // Toolbar overlay (shown always on hover; forced-visible when the
      // block has a pending/error upload state).
      const forceToolbarVisible = !!us && us.status !== 'success';
      const sel = editor.getState().selection;
      const isSelectedAsBlock = sel.kind === 'blocks' && sel.blockIds.includes(blockId);
      children.push(
        h('div', {
          class: [
            'image-block-toolbar',
            { 'image-block-toolbar-visible': forceToolbarVisible || isSelectedAsBlock },
          ],
        }, [
          h('button', {
            class: 'image-block-btn',
            title: i18n.t('image.replace'),
            onClick: (e: MouseEvent) => { e.stopPropagation(); openFilePicker(); },
          }, [h(SafeHtml, { html: ICON_REPLACE })]),
          h('button', {
            class: 'image-block-btn',
            title: i18n.t('image.remove'),
            onClick: (e: MouseEvent) => { e.stopPropagation(); onRemoveClick(); },
          }, [h(SafeHtml, { html: ICON_CLOSE })]),
        ]),
      );

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
              onClick: (e: MouseEvent) => { e.stopPropagation(); onRetryClick(); },
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
            onClick: (e: MouseEvent) => { e.stopPropagation(); openFilePicker(); },
          }, [
            h(SafeHtml, { html: ICON_UPLOAD, class: 'image-block-empty-icon' }),
            h('div', { class: 'image-block-empty-title' }, i18n.t('image.emptyTitle')),
            h('div', { class: 'image-block-empty-sub' }, i18n.t('image.emptySub')),
          ]),
        );
      }

      // --- Actual image element (rendered only when there's a src) ---
      if (src) {
        const imgStyle: Record<string, string> = {};
        if (imageW && imageW > 0) imgStyle.width = `${imageW}px`;
        if (imageH && imageH > 0 && !isResizing.value) imgStyle.height = `${imageH}px`;
        children.push(
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
        );
        // Resize handle — only when natural size is known.
        if (naturalSize.value) {
          children.push(
            h('div', {
              class: 'image-block-resize-handle',
              onMousedown: onResizeStart,
              title: i18n.t('image.resize'),
            }),
          );
        }
      }

      // --- Caption (attr, persisted) ---
      // Always render the caption so users can click the placeholder to add
      // text. The contenteditable div owns its own focus; click events must
      // NOT propagate to the wrapper (which would call selectBlock and steal
      // focus away from the editable caption).
      const caption = (attrs.caption as string) || '';
      if (caption || src) {
        children.push(
          h('div', {
            class: 'image-block-caption',
            contenteditable: 'true',
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
            onInput: () => { /* sync to model on blur to avoid per-keystroke tr */ },
            onMousedown: (e: MouseEvent) => { e.stopPropagation(); },
            onClick: (e: MouseEvent) => { e.stopPropagation(); },
          }, caption),
        );
      }

      return h(
        'div',
        {
          class: 'block-image-wrapper',
          style: wrapperStyle,
          onClick: onBlockClick,
        },
        children,
      );
    };
  },
});

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------
//
// insertImageBlock: insert an (empty) image block and optionally begin an
// upload for a File.

export interface InsertImageBlockArgs {
  readonly after?: BlockId;
  readonly parent?: BlockId | null;
  readonly index?: number;
  readonly attrs?: { src?: string; alt?: string; title?: string; width?: number; height?: number; caption?: string };
}

// ---------------------------------------------------------------------------
// Extension spec
// ---------------------------------------------------------------------------

export const ImageExtension: Extension = {
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
  slashCommands: [
    {
      id: 'image',
      title: '图片',
      keywords: ['image', 'picture', 'photo', 'img', '图片', '图像', '照片'],
      description: '插入一张图片（从本地上传或选择文件）。',
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

// --- Helpers for serialize ------------------------------------------------

function escapeHtmlAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeHtmlText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
