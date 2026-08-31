<!--
  BlockEditor: the root editor component.

  Responsibilities:
    1. Construct the `Editor` instance from extensions + initial document.
    2. Maintain a `shallowRef<EditorState>` that triggers Vue reactivity on
       state changes — but only at the top level (no deep reactivity).
    3. Provide the editor to child components via injection.
    4. Host three popups (all Teleported to body):
         • PlusMenu  - opened by "/" (mode="slash") or left "+" button (mode="insert")
         • BlockSettingsMenu - opened by the left "⋮⋮" grip button
         • HoverToolbar - shown when text is selected inside a block
    5. Handle keyboard events: when a popup is open, route keys there first,
       otherwise sync DOM → state → keymap command.
    6. Apply state selection changes → DOM (after Vue re-renders, via nextTick).
    7. Emit `update:modelValue` when the document changes.
    8. Focus the first block on mount.
    9. Watch document `selectionchange` to show/hide the HoverToolbar.

  PlusMenu 2-mode design:
    • mode="slash"  → triggered by "/" within a block. The slash prefix is
      stripped, then the command runs against the same block.
    • mode="insert" → triggered by "+" button on the left. If the source
      block is empty, behaves like "slash" against the same block. Otherwise
      first inserts a new empty paragraph AFTER the source block, then opens
      PlusMenu with `mode = "insert"` against the NEW block so the chosen
      command converts it.
-->

<template>
  <div
    ref="rootEl"
    class="block-editor"
    :class="[themeClass, { 'block-editor-dragging': draggingBlockId !== null, 'is-mobile': isMobile }]"
    :style="editorStyle"
    :contenteditable="false"
    @keydown="onKeyDown"
    @copy="onCopy"
    @cut="onCut"
    @dragover.prevent="onFileDragOver"
    @dragleave="onFileDragLeave"
    @drop.prevent="onFileDrop"
  >
    <!-- Fixed action bar (always visible — plus/handle + contextual buttons).
         Position is auto-detected: top on desktop, bottom on mobile.
         Can be overridden via the `toolbarPosition` prop. -->
    <FixedToolbar
      :root-el="rootEl"
      :focus-block-id="focusedBlockId"
      :hover-visible="hoverToolbar.visible"
      :hover-selection-rect="hoverToolbar.selectionRect"
      :hover-block-id="hoverToolbar.blockId"
      :hover-block-type="hoverToolbar.blockType"
      :hover-block-attrs="hoverToolbar.blockAttrs"
      :plus-menu-visible="plusMenu.visible"
      :settings-menu-visible="settingsMenu.visible"
      :position="toolbarPosition"
      @toolbar-interacting="markToolbarInteracting"
      @open-plus-menu="onOpenPlusMenu"
      @open-settings-menu="onOpenSettingsMenu"
      @link-click="onHoverToolbarLinkClick"
      @hover-close="hoverToolbar.visible = false"
    />
    <!-- Scrollable content area — vertical scrolling lives here, not on the
         editor root. When height is set this area scrolls internally; when
         height is unset it grows with its content and the page scrolls. -->
    <div class="editor-content">
      <BlockList
        ref="blockListRef"
        :items="renderItems"
        :blocks-map="state.doc.blocks"
        :first-block-placeholder="effectivePlaceholder"
        :hovered-block-id="hoveredBlockId"
        :focused-block-id="focusedBlockId"
        :has-text-selection="hoverToolbar.visible"
        :dragging-block-id="draggingBlockId"
        :drop-target-block-id="dropTargetBlockId"
        :drop-position="dropPosition"
        :menu-open-block-id="settingsMenu.visible ? settingsMenu.blockId : null"
        @open-settings-menu="onOpenSettingsMenu"
        @open-plus-menu="onOpenPlusMenu"
        @slash-trigger="onSlashTrigger"
        @input-changed="onInputChanged"
        @hover-change="onHoverChange"
        @grip-pointer-down="onGripPointerDown"
        @grip-pointer-up="onGripPointerUp"
        @link-click="onBlockLinkClick"
        @focus-in="onBlockFocusIn"
      />
    </div>
    <!-- Cross-block text selection overlay.
         Teleported to <body> so ancestor transforms (scale/translate) don't
         break the alignment. getClientRects() reports viewport-relative
         coordinates — only a document-level overlay can match them. -->
    <Teleport to="body">
      <div
        v-if="crossBlockRects.length > 0"
        class="cross-block-selection-overlay"
        aria-hidden="true"
      >
        <div
          v-for="(r, i) in crossBlockRects"
          :key="i"
          class="cross-block-selection-rect"
          :style="{
            left: r.left + 'px',
            top: r.top + 'px',
            width: r.width + 'px',
            height: r.height + 'px',
          }"
        />
      </div>
    </Teleport>
    <!-- Unified PlusMenu (slash + insert) -->
    <PlusMenu
      ref="plusMenuRef"
      :visible="plusMenu.visible"
      :anchor-el="plusMenu.anchorEl"
      :block-id="plusMenu.blockId"
      :query="plusMenu.query"
      :root-el="rootEl"
      :mode="plusMenu.mode"
      @close="closePlusMenu"
      @commit="onPlusCommit"
    />
    <!-- Block Settings Menu (⋮⋮ grip) -->
    <BlockSettingsMenu
      ref="settingsMenuRef"
      :visible="settingsMenu.visible"
      :anchor-el="settingsMenu.anchorEl"
      :block-id="settingsMenu.blockId"
      :root-el="rootEl"
      @close="closeSettingsMenu"
    />
    <!-- Ordered-list marker click menu -->
    <OrderedListMenu
      :visible="olMenu.visible"
      :block-id="olMenu.blockId"
      :anchor="olMenu.anchor"
      :root-el="rootEl"
      :can-continue="olMenu.canContinue"
      :can-start-new="olMenu.canStartNew"
      :current-number="olMenu.currentNumber"
      @continue="onOlContinue"
      @start-new="onOlStartNew"
      @modify="onOlModify"
      @close="closeOlMenu"
    />
    <!-- Number value picker (for "modify number" action) -->
    <NumberPicker
      :visible="numberPicker.visible"
      :initial-value="numberPicker.initialValue"
      :anchor="numberPicker.anchor"
      :root-el="rootEl"
      @confirm="onNumberPickerConfirm"
      @close="closeNumberPicker"
    />
    <!-- Code language picker (for code-block lang label click) -->
    <CodeLangPicker
      :visible="codeLangPicker.visible"
      :initial-value="codeLangPicker.initialValue"
      :anchor="codeLangPicker.anchor"
      :root-el="rootEl"
      @confirm="onCodeLangPickerConfirm"
      @close="closeCodeLangPicker"
    />
    <!-- Link Popover (view/edit/copy/delete) -->
    <LinkPopover
      :visible="linkPopover.visible"
      :anchor-rect="linkPopover.anchorRect"
      :block-id="linkPopover.blockId"
      :from="linkPopover.from"
      :to="linkPopover.to"
      :href="linkPopover.href"
      :text="linkPopover.text"
      :initial-mode="linkPopover.initialMode"
      :show-text-input="linkPopover.showTextInput"
      :readonly="!editableRef"
      @close="closeLinkPopover"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, shallowRef, computed, provide, onMounted, onBeforeUnmount, nextTick, reactive, watch } from 'vue';
import type { Extension } from '../core/extension/Extension';
import type { DocumentData, BlockId, Block, InlineSeq, Anchor, Selection as EditorSelection } from '../core/types';
import { inlineText, inlineFromString, splitInline } from '../core/types';
import { Editor } from '../core/Editor';
import type { EditorState } from '../core/state/EditorState';
import type { Transaction } from '../core/state/Transaction';
import { editorKey, imageUploadKey, editableKey, mobileKey, fixedToolbarBridgeKey, fixedToolbarBottomKey } from './context';
import type { FixedToolbarDescriptor, BlockRenderItem, BeginImageUploadFn  } from './context';

import { dispatchKeymap } from './keymapHandler';
import { readDomSelection, applySelectionToDom, findBlockEl, positionFromPoint, crossBlockSelectionRects, isCrossBlockText } from './domSelection';
import { caretSelection, isBlocks, textSelection } from '../core/selection/Selection';
import BlockList from './BlockList.vue';
import PlusMenu from './ui/PlusMenu.vue';
import BlockSettingsMenu from './ui/BlockSettingsMenu.vue';
import FixedToolbar from './ui/FixedToolbar.vue';
import OrderedListMenu from './ui/OrderedListMenu.vue';
import NumberPicker from './ui/NumberPicker.vue';
import CodeLangPicker from './ui/CodeLangPicker.vue';
import LinkPopover from './ui/LinkPopover.vue';
import type { SlashCommand } from '../core/command/SlashCommand';
import { blockBefore, flatten as flattenDoc, indexOf as blockIndexOf, parentOf } from '../core/state/store';
import { orderedListNumber } from '../extensions/OrderedList';
import { inlineToHtml } from './inlineDom';
import { BuiltinExtensions } from '../extensions/builtin';
import '../style.css';
import { provideI18n, useI18n, normalizeLocale, normalizeTheme, type Theme, type Locale } from '../i18n';
import {
  subscribeToUploadChanges,
  clearAllUploadStates,
  revokeAllTempUrls,
  beginUpload,
  registerUploadHandler,
  mockUpload,
  cleanupUploadState,
  type UploadImageHandler,
} from './imageUpload';
import type { ImageAttrs } from '../extensions/Image';
import { defaultAttrs } from '../core/schema/BlockSchema';

type PlusMenuMode = 'slash' | 'insert';

const props = withDefaults(defineProps<{
  extensions?: readonly Extension[];
  modelValue?: DocumentData;
  editable?: boolean;
  placeholder?: string;
  /** 'light' (default) or 'dark'. */
  theme?: Theme | string;
  /** 'zh-CN' (default) or 'en-US'.  Any non-empty non-'zh-CN' value ⇒ en-US. */
  locale?: Locale | string;
  /**
   * Optional: image upload delegation function. When provided, the editor
   * delegates image uploads to this function instead of using the built-in
   * mock upload. The function receives the file name, File, an
   * AbortController (aborted if the block is removed or the editor unmounts),
   * and an onProgress callback (0–100). It must return a Promise that
   * resolves with the final uploaded URL or rejects with an error.
   *
   * If omitted, the editor falls back to an internal mock upload that stores
   * the file in memory as an object URL — fine for demos but NOT for
   * persisted documents.
   */
  uploadImage?: UploadImageHandler;
  /** Optional: fixed width for the editor (e.g. '800px', '100%', 600). */
  width?: string | number;
  /** Optional: fixed height for the editor. When set, the editor scrolls
   *  internally instead of growing unbounded. */
  height?: string | number;
  /** Optional: placement of the persistent FixedToolbar.
   *  - 'auto' (default): top on desktop, bottom on mobile.
   *  - 'top' / 'bottom': force the toolbar to top or bottom. */
  toolbarPosition?: 'auto' | 'top' | 'bottom';
}>(), {
  extensions: () => BuiltinExtensions,
  modelValue: () => ({ blocks: [] }),
  editable: true,
  theme: 'light',
  locale: 'zh-CN',
  placeholder: '',

  // optional: when omitted, the editor falls back to its built-in mock upload.
  uploadImage: undefined,
  width: undefined,
  height: undefined,
  toolbarPosition: 'auto',
});
// Placeholder has a locale-aware default, so we only use the raw value when
// the consumer explicitly passed a non-empty one.  This keeps the signature
// tiny: if the consumer omits `placeholder` entirely we still localise it.
const hasExplicitPlaceholder = props.placeholder !== '';

const emit = defineEmits<{
  'update:modelValue': [DocumentData];
  /**
   * Emitted when the last image block referencing a given fileId has been
   * removed or replaced with a different file. Consumers can use this hook
   * to reclaim cloud storage for orphaned files.
   * fileId === 0 ("no managed file") is never emitted.
   */
  'cleanup:image-file': [fileId: number];
}>();

// --- I18n + theme -------------------------------------------------------

const normalizedLocale = computed<Locale>(() => normalizeLocale(props.locale));
const normalizedTheme = computed<Theme>(() => normalizeTheme(props.theme));

// Create refs that will be provided to all child components.  Each child
// injects these refs and builds its own `t()` that reads `localeRef.value`
// directly — a plain ref read that Vue tracks reliably even across
// <Teleport> boundaries.
const localeRef = ref<Locale>(normalizedLocale.value);
const themeRef = ref<Theme>(normalizedTheme.value);
provideI18n(localeRef, themeRef);

watch(
  [normalizedLocale, normalizedTheme],
  ([locale, theme]) => {
    localeRef.value = locale;
    themeRef.value = theme;
  },
);

// Locally we read the bundle via the standard helper.
const i18n = useI18n();

const themeClass = computed<string>(() => `theme-${normalizedTheme.value}`);

// Apply width/height props. Defaults to 100% so the editor always has a
// constrained size and scrolls internally via .editor-content.
const editorStyle = computed(() => {
  const s: Record<string, string> = {};
  s.width = props.width !== undefined
    ? (typeof props.width === 'number' ? `${props.width}px` : props.width)
    : '100%';
  s.height = props.height !== undefined
    ? (typeof props.height === 'number' ? `${props.height}px` : props.height)
    : '100%';
  return s;
});

// Sync the theme class to <body> so that Teleport-ed popovers (PlusMenu,
// BlockSettingsMenu, HoverToolbar, …) render with the correct CSS variables
// even though they live outside the `.block-editor` DOM subtree.
watch(
  normalizedTheme,
  (theme) => {
    if (typeof document === 'undefined') return;
    const body = document.body;
    body.classList.toggle('theme-dark', theme === 'dark');
    body.classList.toggle('theme-light', theme === 'light');
  },
  { immediate: true },
);
const effectivePlaceholder = computed<string>(
  () => (hasExplicitPlaceholder ? (props.placeholder ?? '') : i18n.t('editor.placeholder')),
);

// --- Editor construction ------------------------------------------------

const editor = new Editor({
  extensions: props.extensions,
  initialDocument: props.modelValue,
  editable: props.editable,
});

// Reactive editable flag — provided to child components so they can
// reactively bind `contenteditable` and gate editing actions. The Editor
// instance itself is non-reactive; this ref bridges the prop → view layer.
const editableRef = ref(props.editable);
provide(editableKey, editableRef);
provide(editorKey, editor);

// --- Mobile detection -----------------------------------------------------
// `(pointer: coarse)` matches touch-first devices (iOS / iPadOS / Android).
// This is provided to child components (TableBlock) so they can adapt
// their rendering for mobile. The FixedToolbar is always visible.
//
// NOTE: matchMedia is synchronous — create the MQL and read `.matches`
// IMMEDIATELY during setup so the FIRST render already uses the correct
// mobile state. Otherwise we'd render the desktop layout (block handles,
// HoverToolbar, etc.) for one frame before flipping to mobile, causing
// an obvious flash.
const mobileMql: MediaQueryList | null
  = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(pointer: coarse)')
    : null;
const isMobile = ref<boolean>(!!mobileMql?.matches);
function updateMobile(): void {
  isMobile.value = !!mobileMql?.matches;
}
// Provide the bridge BEFORE TableBlock's setup reads it (provide is hoisted
// in the component tree, so this is fine as long as it's in setup scope).
const fixedToolbarBridge = ref<FixedToolbarDescriptor | null>(null);
provide(mobileKey, isMobile);
provide(fixedToolbarBridgeKey, fixedToolbarBridge);

// Resolve the FixedToolbar position: 'auto' → mobile=bottom, desktop=top.
// 'top'/'bottom' props override the auto-detected default.
const toolbarPosition = computed<'top' | 'bottom'>(() => {
  if (props.toolbarPosition === 'top') return 'top';
  if (props.toolbarPosition === 'bottom') return 'bottom';
  return isMobile.value ? 'bottom' : 'top';
});

// Provide the bottom flag so PlusMenu / BlockSettingsMenu (rendered as
// direct children of BlockEditor, NOT inside FixedToolbar) know which
// direction to pop their dropdowns: bottom bar → UPWARD, top bar → downward.
provide(fixedToolbarBottomKey, computed(() => toolbarPosition.value === 'bottom'));

// Keep both the ref and the Editor instance in sync when the prop changes.
watch(
  () => props.editable,
  (v) => {
    editableRef.value = v;
    editor.editable = v;
    // Switching into read-only mode: dismiss every editing-related floating
    // panel so no editing affordance lingers on screen.
    if (!v) {
      hoverToolbar.visible = false;
      hoverToolbar.selectionRect = null;
      hoverToolbar.blockId = null;
      hoverToolbar.blockType = null;
      hoverToolbar.blockAttrs = {};
      closeOlMenu();
      closeNumberPicker();
      closeCodeLangPicker();
      closeLinkPopover();
      closePlusMenu();
      closeSettingsMenu();
      // 只读模式：清空块级 focus 蓝框（只读不应有"当前编辑块"的视觉信号），
      // 并顺带清除任何活跃的编辑器 Selection（图片/表格/代码块的 blocks 选择）。
      setFocusedBlock(null, { clearNativeSelection: true });
      editor.commands.clearSelection?.();
    }
  },
);

// --- Image upload orchestration ----------------------------------------
//
// Transient upload state lives in the side-channel `imageUpload.ts` and is
// intentionally never written into the document. The flow is:
//   1. Caller (slash / paste / drop / replace) creates an EMPTY image block
//      in the doc and then invokes `beginUpload` with that blockId + file.
//   2. imageUpload.ts tracks pending/progress/error state → UI reads it
//      reactively (via uploadSubscribers + Vue re-renders).
//   3. When the upload succeeds (with a FINAL url, not a blob: URL), a
//      setAttrs command writes that src (and width/height) into the block.
//
// If the consumer provided an `uploadImage` prop function, we call it;
// otherwise we fall back to an in-memory mock upload (blob: URL).

// Register the global upload request handler. This is called by
// imageUpload.beginUpload / dispatchUploadRequest whenever a File needs to
// be turned into a final URL. It routes either to the consumer's
// `uploadImage` prop function or to our internal mock.
registerUploadHandler((name, file, controller, callbacks) => {
  const { onProgress: onProgressCb, onSuccess, onError } = callbacks;
  const handler = props.uploadImage;
  if (typeof handler === 'function') {
    // External handler: call the prop function with (name, file, controller, onProgress).
    // The function returns a Promise<ImageUploadResult> — on resolve we write
    // the final attrs (including optional fileId / alt / title) into the block.
    handler(name, file, controller, (pct: number) => {
      // External handlers report progress as 0–100; internal uses 0–1.
      const clamped = Number.isFinite(pct) ? Math.max(0, Math.min(1, pct / 100)) : 0;
      onProgressCb(clamped);
    })
      .then((result) => {
        onSuccess({
          url: result.url,
          width: result.width,
          height: result.height,
          alt: result.alt,
          title: result.title,
          fileId: result.fileId,
        });
      })
      .catch((err) => {
        // If the upload was aborted (block removed / editor unmounted),
        // don't surface an error — the state has already been cleaned up.
        if (controller.signal.aborted) return;
        onError(err instanceof Error ? err.message : String(err));
      });
  } else {
    // No external handler: use the built-in mock upload (stored in-memory
    // as object URL). This is demo-safe, but because object URLs are NOT
    // serialisable, consumers MUST provide `uploadImage` if they intend
    // to persist and reload documents.
    void mockUpload(file, onProgressCb).then(
      (r) => onSuccess({ url: r.url, width: r.width, height: r.height }),
      (err) => onError(err instanceof Error ? err.message : String(err)),
    );
  }
});

/**
 * The reactive upload-state map used by Vue renderers. Every mutation to
 * the upload store (setUploadState) bumps this ref's value so components
 * that read from it re-render. This is the single Vue-reactive bridge
 * between the framework-agnostic upload state store and the Vue render
 * tree.
 */
const uploadStateTick = ref(0);
const _unsubUpload = subscribeToUploadChanges(() => {
  uploadStateTick.value++;
});

/**
 * Kick off an image upload flow:
 *
 *   - If given a File: creates/resolves an image block, starts the upload,
 *     then writes the final attrs into the block.
 *   - If given a URL string: creates the block and writes attrs directly
 *     (assumes the URL is already a final, serialisable URL — e.g. a public
 *     image URL inserted via the command API).
 *
 * Returns the (possibly newly-created) image block id, or null if the
 * editor had no suitable block to attach to.
 */
const beginImageUpload: BeginImageUploadFn = async (fileOrSrc, opts = {}) => {
  const {
    relativeToBlockId = null,
    position = 'after',
    convertIfEmpty = true,
  } = opts;

  // Touch the tick so Vue tracks us as a reactive reader — any upload-state
  // change during this function's async gaps will re-render consumers.
  void uploadStateTick.value;

  // --- Step 1: resolve the target image block id ------------------------
  let imageBlockId: BlockId | null = null;

  // Prefer explicit reference block, else fall back to current selection.
  let anchorBlockId: BlockId | null = relativeToBlockId ?? null;
  if (!anchorBlockId) {
    const sel = editor.getState().selection;
    if (sel.kind === 'caret') anchorBlockId = sel.blockId;
    else if (sel.kind === 'text') anchorBlockId = sel.anchor.blockId;
  }
  // Absolute last-resort: first block in the document or create one.
  if (!anchorBlockId) {
    const firstId = state.value.doc.root[0] ?? null;
    anchorBlockId = firstId;
  }

  if (position === 'replace' && anchorBlockId) {
    // Convert an existing block (usually another image block that failed or
    // is being replaced) into a fresh image block with empty attrs.
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
    // If the anchor block is an empty paragraph, CONVERT it in-place. This
    // is what slash-command does: the empty paragraph the user typed "/"
    // into becomes the new image block, preserving focus.
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
    // Default path: insert a new image block AFTER the anchor.
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
    // No anchor at all: append to the end of the (possibly empty) doc.
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
      // Empty document: we need a block, so try to insert as first child
      // via insertBlock with "after: null" — fall back to commands
      // primitives if that isn't supported.
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

  // --- Step 2: if a string URL, write attrs directly and finish. --------
  if (typeof fileOrSrc === 'string') {
    const src = fileOrSrc;
    // Try to measure natural dims via an off-screen HTMLImageElement.
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
        // Safety timeout.
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

  // --- Step 3: it's a File → dispatch to upload + await final attrs. ---
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
};

// Provide it so slash menu, image block replace, block-list drop, etc.
// can call useBeginImageUpload() and kick off a fresh upload.
provide(imageUploadKey, beginImageUpload);

// --- Reactive state -----------------------------------------------------

const state = shallowRef<EditorState>(editor.getState());
let prevSelection = editor.getState().selection;
let suppressSelectionSync = false;
// When insertCodeBlockNewline sets the caret directly via the live DOM
// selection, we skip the subsequent applySelectionToDom call — it would
// call el.focus() + setCaretInElement which can clobber the caret position
// (especially when a trailing <br> is present for pre-wrap rendering).
let skipNextSelectionApply = false;

const renderItems = computed<readonly BlockRenderItem[]>(() => {
  const doc = state.value.doc;
  const items: BlockRenderItem[] = [];
  for (const id of doc.root) {
    const block = doc.blocks.get(id);
    if (block) items.push({ id, block });
  }
  return items;
});

// --- Popup state --------------------------------------------------------

interface PlusMenuState {
  visible: boolean;
  anchorEl: HTMLElement | null;
  /**
   * When mode='slash': the block containing the "/..." prefix.
   * When mode='insert': the TARGET block the chosen command will convert
   * (always a newly-inserted empty paragraph unless user clicked + on an
   * already-empty block, in which case it's the same block).
   */
  blockId: BlockId;
  query: string;
  mode: PlusMenuMode;
  /**
   * Only used when mode='insert' with a previously non-empty source block.
   * We remember the SOURCE block id so, if the user closes the menu without
   * picking anything, we can leave the inserted empty paragraph in place
   * (standard Notion behavior).
   */
  sourceBlockId?: BlockId;
}

interface SettingsMenuState {
  visible: boolean;
  anchorEl: HTMLElement | null;
  blockId: BlockId | null;
}

interface HoverToolbarState {
  visible: boolean;
  selectionRect: DOMRect | null;
  blockId: BlockId | null;
  blockType: string | null;
  blockAttrs: Readonly<Record<string, unknown>>;
}

interface OrderedListMenuState {
  visible: boolean;
  blockId: BlockId | null;
  anchor: HTMLElement | null;
  canContinue: boolean;
  canStartNew: boolean;
  currentNumber: number;
}

interface NumberPickerState {
  visible: boolean;
  initialValue: number;
  anchor: HTMLElement | null;
  blockId: BlockId | null;
}

interface CodeLangPickerState {
  visible: boolean;
  initialValue: string;
  anchor: HTMLElement | null;
  blockId: BlockId | null;
}

const plusMenu = reactive<PlusMenuState>({
  visible: false,
  anchorEl: null,
  blockId: '' as BlockId,
  query: '',
  mode: 'slash',
});
const plusMenuRef = ref<InstanceType<typeof PlusMenu> | null>(null);

const settingsMenu = reactive<SettingsMenuState>({
  visible: false,
  anchorEl: null,
  blockId: null,
});
const settingsMenuRef = ref<InstanceType<typeof BlockSettingsMenu> | null>(null);

const hoverToolbar = reactive<HoverToolbarState>({
  visible: false,
  selectionRect: null,
  blockId: null,
  blockType: null,
  blockAttrs: {},
});

// Grace period: when the user interacts with the FixedToolbar / HoverToolbar
// buttons, the browser may fire selectionchange (collapsing the text selection)
// before the click action completes. During this window we ignore
// selectionchange-driven hiding so the buttons remain interactive.
let toolbarInteracting = false;
let toolbarInteractingTimer: ReturnType<typeof setTimeout> | null = null;

function markToolbarInteracting(): void {
  toolbarInteracting = true;
  if (toolbarInteractingTimer) clearTimeout(toolbarInteractingTimer);
  toolbarInteractingTimer = setTimeout(() => {
    toolbarInteracting = false;
    toolbarInteractingTimer = null;
    // Protection window is closed. Re-run selection sync once to ensure any
    // selection-restore that happened DURING the protected window (and was
    // therefore skipped for the "clear" paths) is now re-evaluated so
    // hoverToolbar lands on the correct final visible=true / rect state.
    //
    // `force:true` bypasses the `isMouseDown` early return: the 500ms timer
    // fires when the user might still be holding down a toolbar button
    // (outside the contenteditable area) — we want to materialise any
    // legitimate still-existing DOM selection into hoverToolbar state so
    // the toolbar buttons don't stay disabled until the next mouseup click
    // cycle re-runs selectionchange.
    onDocumentSelectionChange({ force: true });
  }, 500);
}

const olMenu = reactive<OrderedListMenuState>({
  visible: false,
  blockId: null,
  anchor: null,
  canContinue: false,
  canStartNew: false,
  currentNumber: 1,
});

const numberPicker = reactive<NumberPickerState>({
  visible: false,
  initialValue: 1,
  anchor: null,
  blockId: null,
});

const codeLangPicker = reactive<CodeLangPickerState>({
  visible: false,
  initialValue: 'plain',
  anchor: null,
  blockId: null,
});

// --- Link popover state ---------------------------------------------------

interface LinkPopoverState {
  visible: boolean;
  anchorRect: DOMRect | null;
  blockId: BlockId | null;
  from: number;
  to: number;
  href: string;
  text: string;
  initialMode: 'view' | 'edit';
  showTextInput: boolean;
}

const linkPopover = reactive<LinkPopoverState>({
  visible: false,
  anchorRect: null,
  blockId: null,
  from: 0,
  to: 0,
  href: '',
  text: '',
  initialMode: 'view',
  showTextInput: false,
});

function closeLinkPopover(): void {
  linkPopover.visible = false;
}

// When the link popover opens, close the HoverToolbar to avoid both being
// visible simultaneously and to ensure clean focus/selection handling.
watch(
  () => linkPopover.visible,
  (v) => {
    if (v) {
      hoverToolbar.visible = false;
    }
  },
);

/**
 * Find the link mark covering the character at `offset` in a block.
 * Returns { from, to, href, text } or null if no link covers the offset.
 */
function findLinkAtOffset(blockId: BlockId, offset: number): {
  from: number; to: number; href: string; text: string;
} | null {
  const block = editor.getState().doc.blocks.get(blockId);
  if (!block) return null;
  let pos = 0;
  for (const run of block.content) {
    if (run.type !== 'text') continue;
    const runStart = pos;
    const runEnd = pos + run.text.length;
    if (offset >= runStart && offset <= runEnd) {
      const linkMark = run.marks?.find((m) => m.type === 'link');
      if (linkMark && typeof linkMark.attrs?.href === 'string') {
        return {
          from: runStart,
          to: runEnd,
          href: linkMark.attrs.href,
          text: run.text,
        };
      }
      // No link on this run. An offset equal to runEnd is a SHARED boundary
      // with the next run (runs are contiguous, runEnd === next runStart) —
      // e.g. the exact start of a link run. In that case keep scanning so
      // the next run gets a chance to match; only truly-covering offsets
      // (offset < runEnd) terminate the search.
      if (offset < runEnd) return null;
    }
    pos = runEnd;
  }
  return null;
}

/**
 * Open the link popover for a given block + character range.
 * If the range already has a link mark, shows in "view" mode.
 * If no link, shows in "edit" mode for creating a new link.
 */
function openLinkPopover(blockId: BlockId, from: number, to: number): void {
  const block = editor.getState().doc.blocks.get(blockId);
  if (!block) return;

  // Check if the range already has a link mark.
  let existingHref = '';
  let existingText = '';
  let pos = 0;
  for (const run of block.content) {
    if (run.type !== 'text') continue;
    const runStart = pos;
    const runEnd = pos + run.text.length;
    if (runEnd > from && runStart < to) {
      const linkMark = run.marks?.find((m) => m.type === 'link');
      if (linkMark && typeof linkMark.attrs?.href === 'string') {
        existingHref = linkMark.attrs.href;
        existingText = run.text;
        break;
      }
    }
    pos = runEnd;
  }

  // Get the DOM rect of the text range for positioning.
  let anchorRect: DOMRect | null = null;
  const blockEl = rootEl.value?.querySelector(`[data-block-id="${blockId}"]`);
  if (blockEl) {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      if (blockEl.contains(range.commonAncestorContainer)) {
        anchorRect = range.getBoundingClientRect();
      }
    }
    if (!anchorRect) {
      // Fallback: use the block element's rect.
      anchorRect = blockEl.getBoundingClientRect();
    }
  }

  const hasSelection = from < to;
  // Close other floating panels before opening link popover (consistent with
  // how ol-menu / code-lang-picker / number-picker open).
  closePlusMenu();
  closeSettingsMenu();
  closeOlMenu();
  closeNumberPicker();
  closeCodeLangPicker();
  linkPopover.blockId = blockId;
  linkPopover.from = from;
  linkPopover.to = to;
  linkPopover.href = existingHref;
  linkPopover.text = existingText;
  linkPopover.anchorRect = anchorRect;
  // Read-only: even a new-link selection opens in view mode (empty URL);
  // editing a link is forbidden.
  linkPopover.initialMode = (existingHref || !editableRef.value) ? 'view' : 'edit';
  linkPopover.showTextInput = !hasSelection && !existingHref;
  linkPopover.visible = true;
}

/**
 * Handle Ctrl/Cmd+K: open link popover for the current selection or cursor.
 */
function onLinkShortcut(): void {
  // Read-only: the link shortcut must not open the popover in edit mode.
  if (!editableRef.value) return;
  syncSelectionFromDom();
  const sel = editor.getState().selection;
  if (sel.kind === 'caret') {
    // Cursor — check if it's inside a link.
    const linkInfo = findLinkAtOffset(sel.blockId, sel.offset);
    if (linkInfo) {
      linkPopover.blockId = sel.blockId;
      linkPopover.from = linkInfo.from;
      linkPopover.to = linkInfo.to;
      linkPopover.href = linkInfo.href;
      linkPopover.text = linkInfo.text;
      // Get anchor rect from the link DOM element.
      const blockEl = rootEl.value?.querySelector(`[data-block-id="${sel.blockId}"]`);
      const linkEl = blockEl?.querySelector('a');
      linkPopover.anchorRect = linkEl?.getBoundingClientRect() ?? blockEl?.getBoundingClientRect() ?? null;
      linkPopover.initialMode = 'view';
      linkPopover.showTextInput = false;
      linkPopover.visible = true;
    } else {
      // No link at cursor — do nothing (need a selection to create a link).
    }
  } else if (sel.kind === 'text' && !isCrossBlockText(sel)) {
    openLinkPopover(sel.focus.blockId, sel.anchor.offset, sel.focus.offset);
  }
}

/**
 * Handle link button click from HoverToolbar.
 * Opens the link popover for the current text selection.
 */
function onHoverToolbarLinkClick(blockId: BlockId, from: number, to: number): void {
  openLinkPopover(blockId, from, to);
}

/**
 * Handle link click from BlockContent (user clicked an <a> in the editor).
 * Finds the link mark at the click offset and opens the popover in view mode.
 */
function onBlockLinkClick(blockId: BlockId, offset: number): void {
  const linkInfo = findLinkAtOffset(blockId, offset);
  if (!linkInfo) return;
  const blockEl = rootEl.value?.querySelector(`[data-block-id="${blockId}"]`);
  const linkEl = blockEl?.querySelector('a');
  linkPopover.blockId = blockId;
  linkPopover.from = linkInfo.from;
  linkPopover.to = linkInfo.to;
  linkPopover.href = linkInfo.href;
  linkPopover.text = linkInfo.text;
  linkPopover.anchorRect = linkEl?.getBoundingClientRect() ?? blockEl?.getBoundingClientRect() ?? null;
  linkPopover.initialMode = 'view';
  linkPopover.showTextInput = false;
  linkPopover.visible = true;
}

/**
 * BlockContent 获得 DOM focus（光标进入文本块）时触发；
 * 非文本块通过事件委托走 onBlockRootClick，两者都汇聚到 setFocusedBlock()，
 * 保证同一时刻最多只有一个 focusedBlockId 生效。
 */
function onBlockFocusIn(blockId: BlockId): void {
  setFocusedBlock(blockId);
}

// --- Handle visibility: hovered + focused block tracking ----------------

const hoveredBlockId = ref<BlockId | null>(null);
const focusedBlockId = ref<BlockId | null>(null);
const draggingBlockId = ref<BlockId | null>(null);
/** True while the primary mouse button is held down inside the editor. */
let isMouseDown = false;
/**
 * True when the mousedown that set isMouseDown landed on a non-text block
 * (table / TOC / image / divider / codeBlock etc.). When true, onMouseUp
 * MUST NOT call onDocumentSelectionChange, because the DOM selection is
 * either empty or stale (caret left-over from a previously-edited text
 * block). Calling selectionchange here would overwrite focusedBlockId
 * that was legitimately set by selectBlock / onBlockRootClick.
 */
let mouseDownOnNonTextBlock = false;

type DropPosition = 'before' | 'after' | 'first' | 'last' | 'into';

/**
 * 统一的块级焦点设置入口 — focusedBlockId 的唯一写入点。
 *
 * @param id  要聚焦的块 id；传 null 表示清空所有块级焦点
 * @param opts.clearNativeSelection  true 时顺带移除浏览器原生的 DOM 文本选区/光标。
 *        用在"点击非文本块获得 focus"的场景：避免出现"文本光标还在 P1，
 *        但 P3 的图片又显示蓝框"这种双焦点信号并存的情况。
 */
function setFocusedBlock(
  id: BlockId | null,
  opts: { clearNativeSelection?: boolean } = {},
): void {
  const { clearNativeSelection = false } = opts;
  if (clearNativeSelection) {
    try {
      const sel = window.getSelection();
      if (sel) sel.removeAllRanges();
    } catch {
      /* ignore */
    }
  }
  focusedBlockId.value = id;
}

// --- Cross-block text selection -----------------------------------------
//
// Each block is an independent contenteditable, so the browser's native
// Selection cannot span blocks. We build cross-block selections manually:
//   1. mousedown inside a .block-content records the start anchor.
//   2. mousemove tracks the current hit position. If it lands in a different
//      block than the start, we enter cross-block mode: clear the native
//      selection, dispatch a `text` selection spanning the two anchors, and
//      render highlight rectangles via the overlay.
//   3. mouseup ends tracking. The selection stays in editor state and the
//      HoverToolbar is shown.

interface PendingSelection {
  start: Anchor;
  /** Whether we've already entered cross-block mode for this drag. */
  crossBlock: boolean;
}
let pendingSel: PendingSelection | null = null;
/** rAF id for throttling mousemove-driven selection updates. */
let selRafId = 0;
/** Latest mouse event to process on the next rAF tick. */
let lastMoveEvent: MouseEvent | null = null;

const crossBlockRects = ref<DOMRect[]>([]);

function onHoverChange(blockId: BlockId | null): void {
  hoveredBlockId.value = blockId;
}

/** Update overlay rectangles from the current editor selection. */
function updateCrossBlockOverlay(): void {
  const root = rootEl.value;
  if (!root) {
    crossBlockRects.value = [];
    return;
  }
  const sel = editor.getState().selection;
  if (sel.kind !== 'text' || !isCrossBlockText(sel)) {
    crossBlockRects.value = [];
    return;
  }
  crossBlockRects.value = crossBlockSelectionRects(root, editor.getState().doc, sel);
}

/** Prevent the browser from rebuilding its native selection while we're in
 *  cross-block mode (the overlay is the source of truth for highlighting). */
function onCrossBlockSelectStart(e: Event): void {
  e.preventDefault();
}

/** Process a mousemove during a pending cross-block selection drag. */
function processSelectionMove(e: MouseEvent): void {
  const root = rootEl.value;
  if (!root || !pendingSel) return;
  const hit = positionFromPoint(e.clientX, e.clientY, root, editor.getState().doc);
  if (!hit) return;
  const start = pendingSel.start;
  if (hit.blockId === start.blockId) {
    // Same block as the start: let the native selection handle it.
    if (pendingSel.crossBlock) {
      // We were in cross-block mode but returned to the start block.
      // Clear cross-block state so the native selection can resume.
      pendingSel.crossBlock = false;
      crossBlockRects.value = [];
      document.removeEventListener('selectstart', onCrossBlockSelectStart, true);
      const ns = window.getSelection();
      if (ns) ns.removeAllRanges();
    }
    return;
  }
  // Cross-block: take over selection.
  if (!pendingSel.crossBlock) {
    pendingSel.crossBlock = true;
    // Suppress native selection rebuild for the duration of cross-block mode.
    document.addEventListener('selectstart', onCrossBlockSelectStart, true);
    const ns = window.getSelection();
    if (ns) ns.removeAllRanges();
  }
  const focus: Anchor = { blockId: hit.blockId, offset: hit.offset };
  const sel = textSelection(start, focus);
  suppressSelectionSync = true;
  editor.commands.setSelection?.({ selection: sel });
  suppressSelectionSync = false;
  updateCrossBlockOverlay();
}

function onSelectionMouseMove(e: MouseEvent): void {
  if (!pendingSel) return;
  lastMoveEvent = e;
  if (selRafId) return;
  selRafId = requestAnimationFrame(() => {
    selRafId = 0;
    if (lastMoveEvent) processSelectionMove(lastMoveEvent);
  });
}

function onSelectionMouseUp(): void {
  if (!pendingSel) return;
  pendingSel = null;
  if (selRafId) {
    cancelAnimationFrame(selRafId);
    selRafId = 0;
  }
  lastMoveEvent = null;
  document.removeEventListener('mousemove', onSelectionMouseMove, true);
  document.removeEventListener('mouseup', onSelectionMouseUp, true);
  document.removeEventListener('selectstart', onCrossBlockSelectStart, true);
  // Refresh overlay one more time in case the final move was throttled.
  updateCrossBlockOverlay();
  // Show HoverToolbar if we ended with a cross-block selection.
  const sel = editor.getState().selection;
  if (sel.kind === 'text' && isCrossBlockText(sel)) {
    showHoverToolbarForCrossBlock(sel);
  }
}

// --- Subscribe to editor updates ----------------------------------------

/**
 * Block types that own their own interaction surface and are NOT edited
 * via a contenteditable text region. For these blocks, the focus state
 * is driven by explicit click delegation (onBlockRootClick / selectBlock),
 * NOT by DOM caret position. A stray caret left in a previously-edited
 * text block must never overwrite focus on these blocks.
 */
const NON_TEXT_BLOCK_TYPES = new Set([
  'image', 'divider', 'table', 'toc', 'tableOfContents', 'codeBlock', 'equation',
]);

// fileId → reference-count (number of image blocks referencing the file).
// When the count drops to zero (last referencing block is removed or
// replaced), we emit `cleanup:image-file` so the consumer can reclaim
// cloud storage.
const fileIdRefCountsMap = new Map<number, number>();
// Snapshot of the doc.blocks Map BEFORE the current update; used to look
// up the PREVIOUS fileId of changed/removed blocks. Populated at the end
// of each update and at mount (from initial doc).
let stateBeforeDocRef: ReadonlyMap<BlockId, Block> = editor.getState().doc.blocks;
// Initialise fileId counts from the initial doc (so the consumer can pass
// a pre-populated doc via `modelValue` and we won't spuriously emit
// cleanup for the files already referenced there).
{
  const doc = editor.getState().doc;
  for (const id of doc.root) {
    const b = doc.blocks.get(id);
    if (!b || b.type !== 'image') continue;
    const fid = (b.attrs as unknown as ImageAttrs).fileId as number;
    if (typeof fid === 'number' && Number.isFinite(fid) && fid > 0) {
      fileIdRefCountsMap.set(fid, (fileIdRefCountsMap.get(fid) ?? 0) + 1);
    }
  }
}

/**
 * Guard flag: while true, the `watch(props.modelValue)` callback must skip
 * applying external changes, because a document change from INSIDE the
 * editor has just been serialized and emitted, and the v-model assignment
 * in the parent is about to bounce back through the prop.  Without this,
 * every user keystroke would trigger setDocument() (resetting history and
 * the caret position) at the next tick.
 */
let externalEmitInFlight = false;

const unsubscribe = editor.subscribe((update) => {
  state.value = update.state;
  if (update.removed.size > 0) {
    // Clean up transient upload state for any removed blocks. This prevents
    // object-URL leaks when an image block is deleted (via backspace,
    // removeBlock, undo…). Because upload state lives outside the doc, a
    // normal transaction rollback won't touch it.
    cleanupUploadState(update.removed);
  }

  // --- Recompute fileId reference counts and emit cleanup:image-file ---
  //
  // For every image block in the updated doc, collect which fileIds they
  // reference. Compare against the reference map from the PREVIOUS state of
  // any blocks that were changed or removed (the delta). Any fileId whose
  // reference count drops to zero is reported back to the consumer so they
  // can reclaim cloud storage.
  // fileId === 0 ("no managed file") is always skipped.
  if (update.changed.size > 0 || update.removed.size > 0) {
    // 1. Build the NEW reference map (fileId → number of blocks referencing it,
    //    across the ENTIRE doc). This keeps the logic simple even when blocks
    //    are moved or converted.
    const newCounts = new Map<number, number>();
    for (const id of update.state.doc.root) {
      const b = update.state.doc.blocks.get(id);
      if (!b || b.type !== 'image') continue;
      const fid = (b.attrs as unknown as ImageAttrs).fileId as number;
      if (typeof fid === 'number' && Number.isFinite(fid) && fid > 0) {
        newCounts.set(fid, (newCounts.get(fid) ?? 0) + 1);
      }
    }
    // 2. Find the set of fileIds present in the PREVIOUS state of changed
    //    or removed blocks (the only ones whose reference counts might have
    //    dropped) + any in the new map (to catch added-then-zeroed cases).
    const candidates = new Set<number>();
    for (const id of update.changed) {
      const prevB = id ? stateBeforeDocRef.get(id) : undefined;
      if (prevB && prevB.type === 'image') {
        const fid = (prevB.attrs as unknown as ImageAttrs).fileId as number;
        if (typeof fid === 'number' && Number.isFinite(fid) && fid > 0) candidates.add(fid);
      }
    }
    for (const id of update.removed) {
      const prevB = id ? stateBeforeDocRef.get(id) : undefined;
      if (prevB && prevB.type === 'image') {
        const fid = (prevB.attrs as unknown as ImageAttrs).fileId as number;
        if (typeof fid === 'number' && Number.isFinite(fid) && fid > 0) candidates.add(fid);
      }
    }
    for (const fid of newCounts.keys()) candidates.add(fid);
    for (const fid of candidates) {
      const newCount = newCounts.get(fid) ?? 0;
      const prevCount = fileIdRefCountsMap.get(fid) ?? 0;
      fileIdRefCountsMap.set(fid, newCount);
      if (newCount === 0 && prevCount > 0) {
        emit('cleanup:image-file', fid);
      }
    }
    // Snapshot current doc blocks for the next update's "before" comparison.
    stateBeforeDocRef = update.state.doc.blocks;

    externalEmitInFlight = true;
    emit('update:modelValue', editor.toData());
    // The parent's v-model assignment runs synchronously (Vue emits then
    // parent reactivity propagates).  Queue a microtask to clear the guard
    // after that prop update has been observed, so that truly external
    // changes scheduled later (next frame / user code) are honoured.
    Promise.resolve().then(() => {
      externalEmitInFlight = false;
    });
  }
  const sel = update.state.selection;
  // Track focused block for handle visibility.
  const nextFocused = sel.kind === 'caret'
    ? sel.blockId
    : sel.kind === 'text'
      ? sel.focus.blockId
      : sel.kind === 'blocks'
        ? (sel.blockIds[0] ?? null)
        : null;
  // [Guard 3] Refuse stale caret overwrite in subscribe callback.
  // Same rationale as Guard 2 in onDocumentSelectionChange. If the
  // current focused block is a non-text type (table / TOC / etc.) AND
  // the new selection is a caret/text pointing at a DIFFERENT block,
  // keep the existing non-text focus — the caret change is from stale
  // DOM state, not a real user intent to move focus. `kind: blocks`
  // is an explicit block-level selection so it always wins — UNLESS
  // blockIds is empty (a clearSelection dispatch), in which case we
  // preserve non-text focus to prevent flicker during mousedown.
  let finalFocused = nextFocused;
  if (
    focusedBlockId.value !== null
    && finalFocused !== focusedBlockId.value
  ) {
    const curBlock = update.state.doc.blocks.get(focusedBlockId.value);
    if (curBlock && NON_TEXT_BLOCK_TYPES.has(curBlock.type)) {
      // For kind='blocks' with empty blockIds (clearSelection), keep focus.
      // For kind='caret'/'text' pointing at a different block, keep focus.
      if (sel.kind === 'blocks' ? (sel.blockIds.length === 0) : true) {
        finalFocused = focusedBlockId.value;
      }
    }
  }
  // During toolbar interaction (bold / color / type buttons, …) the DOM is
  // often in a transitive state where innerHTML has been rewritten but the
  // native selection hasn't been restored yet, and plugins or selection
  // fallbacks can briefly produce nonsensical focus signals. Ignore any
  // attempt to move focusedBlockId during the 500ms grace period — the
  // block the user had focused before clicking the toolbar is the correct
  // one and we don't want to flash "Heading 1" / first-block UI because of
  // it.
  if (!toolbarInteracting) {
    setFocusedBlock(finalFocused);
  }
  if (!suppressSelectionSync && sel !== prevSelection) {
    if (skipNextSelectionApply) {
      skipNextSelectionApply = false;
    } else {
      nextTick(() => {
        const root = rootEl.value;
        if (root) {
          applySelectionToDom(root, sel);
        }
      });
    }
  }
  // Refresh the cross-block overlay whenever the selection or document changes.
  if (sel.kind === 'text' && isCrossBlockText(sel)) {
    nextTick(() => {
      updateCrossBlockOverlay();
      // Show the HoverToolbar for programmatic cross-block selections
      // (e.g. Mod-a) when not actively dragging.
      if (!pendingSel && !isMouseDown) {
        showHoverToolbarForCrossBlock(sel);
      }
    });
  } else if (crossBlockRects.value.length > 0) {
    crossBlockRects.value = [];
  }
  prevSelection = sel;
});

// --- External document sync (props.modelValue → editor) -------------------

/**
 * Deep equality for plain JSON-like documents. Used to decide whether an
 * incoming `modelValue` prop change is truly different from what the
 * editor currently holds. Prevents unnecessary setDocument() calls which
 * would reset history/selection.
 */
function jsonEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== (b as unknown[]).length) return false;
    for (let i = 0; i < a.length; i++) if (!jsonEqual(a[i], (b as unknown[])[i])) return false;
    return true;
  }
  const ak = Object.keys(a as Record<string, unknown>);
  const bk = Object.keys(b as Record<string, unknown>);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!jsonEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  }
  return true;
}

watch(
  () => props.modelValue,
  (nextDoc) => {
    // Ignore the "bounce-back" prop change triggered by our own emit.
    if (externalEmitInFlight) return;
    if (nextDoc === undefined) return;
    // Skip if identical (cheap), then do a deep compare for values.
    const current = editor.toData();
    if (jsonEqual(current, nextDoc)) return;
    editor.setDocument(nextDoc);
  },
  { deep: true },
);

// --- Keyboard handling --------------------------------------------------

const rootEl = ref<HTMLElement | null>(null);
// BlockList expose helper: define an explicit interface so the ref type
// knows about setBlockHandleDragging (the defineExpose return type of a
// Vue SFC isn't always surfaced by InstanceType<>).
interface BlockListApi {
  setBlockHandleDragging(blockId: BlockId, active: boolean): void;
}
const blockListRef = ref<InstanceType<typeof BlockList> | null>(null);
const blockListApi = (): BlockListApi | null => (blockListRef.value as unknown as BlockListApi | null);

function syncSelectionFromDom(): void {
  const root = rootEl.value;
  if (!root) return;
  const domSel = readDomSelection(root, editor.getState().doc);
  if (!domSel) return;
  const tr: Transaction = {
    steps: [],
    selectionAfter: domSel,
    meta: { addToHistory: false },
  };
  suppressSelectionSync = true;
  editor.dispatch(tr);
  suppressSelectionSync = false;
}

function onKeyDown(event: KeyboardEvent): void {
  if (plusMenu.visible && plusMenuRef.value?.onKeyDown(event)) return;
  if (settingsMenu.visible && settingsMenuRef.value?.onKeyDown(event)) return;

  // Read-only mode: block every key that would modify the document, but
  // leave read-only-safe keys untouched (copy / select-all / navigation /
  // scrolling / browser shortcuts). Intercepted:
  //   • Printable characters (would type into the contenteditable)
  //   • Enter / Backspace / Delete (structure-changing keys)
  //   • Cut / paste / undo / redo / duplicate (Mod-x / Mod-v / Mod-z /
  //     Mod-y / Mod-Shift-z / Mod-d)
  if (!editableRef.value) {
    const k = event.key;
    const mod = event.ctrlKey || event.metaKey;
    const isPrintable = k.length === 1 && !mod && !event.altKey && !event.isComposing;
    const isStructureKey = k === 'Enter' || k === 'Backspace' || k === 'Delete';
    const modKey = k.toLowerCase();
    const isEditShortcut = mod && (
      modKey === 'x' // cut
      || modKey === 'v' // paste
      || modKey === 'z' // undo (Mod-z) / redo (Mod-Shift-z)
      || modKey === 'y' // redo (Mod-y)
      || modKey === 'd' // duplicate block
    );
    if (isPrintable || isStructureKey || isEditShortcut) {
      event.preventDefault();
      return;
    }
    // Select-all: run the editor's own selectAll so the whole DOCUMENT is
    // selected (the browser default would select the whole page instead).
    if (mod && modKey === 'a') {
      event.preventDefault();
      editor.commands.selectAll?.();
      return;
    }
    // Copy: a cross-block selection has an empty native selection, so the
    // browser copy event cannot carry the text — serialize it here.
    if (mod && modKey === 'c') {
      const sel = editor.getState().selection;
      if (sel.kind === 'text' && isCrossBlockText(sel)) {
        const data = serializeCrossBlockSelection(sel);
        if (data) {
          event.preventDefault();
          const ClipboardItemCtor = (window as unknown as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem;
          if (ClipboardItemCtor) {
            const clipboardItem = new ClipboardItemCtor({
              'text/plain': new Blob([data.text], { type: 'text/plain' }),
              'text/html': new Blob([data.html], { type: 'text/html' }),
            });
            navigator.clipboard.write([clipboardItem]).catch(() => {
              navigator.clipboard.writeText(data.text).catch(() => {});
            });
          } else {
            navigator.clipboard.writeText(data.text).catch(() => {});
          }
        }
      }
      return;
    }
    return;
  }

  // Ctrl/Cmd+K: open link editor.
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && !event.isComposing) {
    event.preventDefault();
    onLinkShortcut();
    return;
  }

  // Some non-block-content elements are also contenteditable (e.g. image
  // caption, the caption input). For these we must NOT route keys through
  // the keymap / command system — otherwise dispatchKeymap calls
  // preventDefault() on printable chars and the user cannot type text.
  const target = event.target as HTMLElement | null;
  if (target && target.classList.contains('image-block-caption')) {
    return; // let the browser handle native contenteditable editing
  }
  // Equation editor textarea: let the textarea handle all keys natively so the
  // user can type LaTeX, press Enter to submit / Escape to cancel, etc.,
  // without the editor keymap intercepting them.
  if (target && target.closest('[data-equation-edit]')) {
    return;
  }
  // Table cells manage their own keyboard handling (Enter exits edit mode,
  // Tab navigates cells). Skip the editor-level keymap to avoid creating
  // new blocks or dispatching competing commands.
  if (target && target.closest('.table-cell-inner')) {
    return;
  }

  // During cross-block text selection, the native DOM selection is empty
  // (we use a custom overlay). Syncing from DOM here would overwrite the
  // cross-block selection with a caret, breaking Ctrl+C/Ctrl+X and other
  // operations that rely on the editor state. Skip sync in that case.
  const preSyncSel = editor.getState().selection;
  if (!(preSyncSel.kind === 'text' && isCrossBlockText(preSyncSel))) {
    syncSelectionFromDom();
  }

  // If a cross-block text selection is active, editable keys must first
  // delete the selection. Backspace/Delete/Mod-a are handled by the keymap
  // below; here we cover printable characters, Enter, Tab, and IME.
  const preSel = editor.getState().selection;
  if (preSel.kind === 'text' && isCrossBlockText(preSel) && !event.isComposing) {
    const k = event.key;
    const isPrintable = k.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;
    if (isPrintable || k === 'Enter' || k === 'Tab') {
      event.preventDefault();
      editor.commands.backspace?.();
      if (isPrintable) {
        // Insert the typed character at the merged caret.
        const afterSel = editor.getState().selection;
        if (afterSel.kind === 'caret') {
          const block = editor.getState().doc.blocks.get(afterSel.blockId);
          if (block) {
            const [before, after] = splitInline(block.content, afterSel.offset);
            const newContent: InlineSeq = [...before, { type: 'text', text: k }, ...after];
            editor.commands.setText?.({
              id: afterSel.blockId,
              content: newContent,
              selectionAfter: caretSelection(afterSel.blockId, afterSel.offset + 1),
            });
          }
        }
      }
      // For Enter / Tab, the backspace already collapsed the selection to a
      // caret; let the next keystroke handle split/indent. We return here
      // because preventDefault already stopped the original event.
      return;
    }
    // Ctrl/Cmd+C and Ctrl/Cmd+X: copy/cut cross-block selection.
    // The browser won't fire copy/cut events because the native selection
    // is empty during cross-block mode, so we must handle them here.
    if ((event.ctrlKey || event.metaKey) && (k === 'c' || k === 'C' || k === 'x' || k === 'X')) {
      const data = serializeCrossBlockSelection(preSel);
      if (data) {
        event.preventDefault();
        // Use the async Clipboard API to write text/html.
        const ClipboardItemCtor = (window as unknown as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem;
        if (ClipboardItemCtor) {
          const clipboardItem = new ClipboardItemCtor({
            'text/plain': new Blob([data.text], { type: 'text/plain' }),
            'text/html': new Blob([data.html], { type: 'text/html' }),
          });
          navigator.clipboard.write([clipboardItem]).catch(() => {
            navigator.clipboard.writeText(data.text).catch(() => {});
          });
        } else {
          navigator.clipboard.writeText(data.text).catch(() => {});
        }
        if (k === 'x' || k === 'X') {
          editor.commands.backspace?.();
        }
      }
      return;
    }
    // Arrow keys collapse the selection to its start (Left/Up) or end
    // (Right/Down). A subsequent press navigates normally.
    if (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'ArrowRight' || k === 'ArrowDown') {
      event.preventDefault();
      const flat = flattenDoc(editor.getState().doc);
      const ia = flat.indexOf(preSel.anchor.blockId);
      const ib = flat.indexOf(preSel.focus.blockId);
      const [start, end] = ia <= ib ? [preSel.anchor, preSel.focus] : [preSel.focus, preSel.anchor];
      const target = (k === 'ArrowLeft' || k === 'ArrowUp') ? start : end;
      crossBlockRects.value = [];
      editor.commands.setSelection?.({ selection: caretSelection(target.blockId, target.offset) });
      return;
    }
  }

  // For isolating blocks (code blocks) with multi-line content, ArrowUp/Down
  // should navigate WITHIN the block (between lines) when the caret is not on
  // the first/last line. Only when the caret is on the first line (ArrowUp)
  // or last line (ArrowDown) do we fall through to the keymap's
  // moveToPreviousBlock/moveToNextBlock. Without this, the keymap always
  // jumps to another block, making it impossible to move the caret between
  // lines in a code block with the arrow keys.
  if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && !event.shiftKey && !event.isComposing) {
    const sel = editor.getState().selection;
    if (sel.kind === 'caret' || sel.kind === 'text') {
      const blockId = sel.kind === 'caret' ? sel.blockId : sel.focus.blockId;
      const offset = sel.kind === 'caret' ? sel.offset : sel.focus.offset;
      const block = editor.getState().doc.blocks.get(blockId);
      if (block) {
        const schema = editor.registries.schema.get(block.type);
        if (schema.isolating) {
          const text = inlineText(block.content);
          // Find the line boundaries around the caret.
          const before = text.slice(0, offset);
          const after = text.slice(offset);
          const lineStart = before.lastIndexOf('\n') + 1; // 0 if no \n found
          const nextNewline = after.indexOf('\n');
          const lineEnd = nextNewline === -1 ? text.length : offset + nextNewline;
          const isFirstLine = lineStart === 0;
          const isLastLine = lineEnd === text.length;
          if (event.key === 'ArrowUp' && !isFirstLine) {
            return; // let browser handle in-block line navigation
          }
          if (event.key === 'ArrowDown' && !isLastLine) {
            return; // let browser handle in-block line navigation
          }
          // On first/last line: fall through to keymap for inter-block nav.
        }
      }
    }
  }

  const handled = dispatchKeymap(editor, event);
  if (handled) {
    event.preventDefault();
    return;
  }
  // Handle Enter in isolating blocks (e.g. code blocks).
  //
  // enterCommand returns false for isolating blocks (schema.isolating === true),
  // which means the keymap didn't handle it. The browser default for
  // contenteditable would insert <br> or <div> wrappers instead of a plain
  // "\n" character — and inlineFromDom skips <br>, so the newline would be
  // lost from the data model.
  //
  // Fix: dispatch a setText transaction that inserts "\n" at the caret offset.
  // The view layer's normal update flow (BlockContent watch + applySelectionToDom)
  // then updates the DOM and places the caret after the newline.
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    const sel = editor.getState().selection;
    if (sel.kind === 'caret' || sel.kind === 'text') {
      const blockId = sel.kind === 'caret' ? sel.blockId : sel.focus.blockId;
      const offset = sel.kind === 'caret' ? sel.offset : sel.focus.offset;
      const block = editor.getState().doc.blocks.get(blockId);
      if (block) {
        const schema = editor.registries.schema.get(block.type);
        if (schema.isolating) {
          event.preventDefault();
          insertCodeBlockNewline(blockId, offset);
        }
      }
    }
  }
}

/**
 * Insert a "\n" character at the given offset in an isolating block (code
 * block). Dispatches a setText transaction — the view layer's normal update
 * flow handles the DOM update and caret placement.
 */
function insertCodeBlockNewline(blockId: BlockId, offset: number): void {
  const block = editor.getState().doc.blocks.get(blockId);
  if (!block) return;
  const [before, after] = splitInline(block.content, offset);
  const newContent: InlineSeq = [...before, { type: 'text', text: '\n' }, ...after];
  const newText = inlineText(newContent);

  // Update the DOM directly by manipulating the current selection's text
  // node. This preserves the browser's native caret management so the
  // caret correctly renders on the new line under white-space: pre-wrap.
  //
  // Why not just set textContent? Setting textContent rebuilds all child
  // nodes. When "\n" ends up as the last character, browsers using
  // pre-wrap do NOT render a visible new line — the caret appears stuck on
  // the previous line. By using the live selection and inserting a Text
  // node (or splitting), the browser handles the caret rendering natively.
  const root = rootEl.value;
  const el = root ? findBlockEl(root, blockId) : null;
  const sel = window.getSelection();
  if (el && sel && sel.rangeCount > 0) {
    const range = sel.getRangeAt(0);
    if (el.contains(range.commonAncestorContainer)) {
      // Delete any selected text first, then insert "\n".
      if (!range.collapsed) range.deleteContents();
      const newlineNode = document.createTextNode('\n');
      range.insertNode(newlineNode);
      // Move caret after the inserted "\n".
      range.setStartAfter(newlineNode);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);

      // If the "\n" is now the last content, append a <br> so the browser
      // renders the new line visibly (pre-wrap needs trailing content).
      // <br> is skipped by inlineFromDom so it won't pollute the data model.
      const needsTrailingBr = newText.endsWith('\n');
      if (needsTrailingBr) {
        // Remove any existing trailing <br> first to avoid accumulation.
        const lastChild = el.lastChild;
        if (lastChild && lastChild.nodeType === Node.ELEMENT_NODE
          && (lastChild as HTMLElement).tagName === 'BR') {
          el.removeChild(lastChild);
        }
        el.appendChild(document.createElement('br'));
      }
      // We set the caret directly above; skip the next applySelectionToDom
      // so it doesn't clobber the caret (especially with the trailing <br>).
      skipNextSelectionApply = true;
    } else {
      el.textContent = newText;
    }
  } else if (el) {
    el.textContent = newText;
  }

  const tr: Transaction = {
    steps: [{ op: 'setText', id: blockId, content: newContent }],
    selectionAfter: caretSelection(blockId, offset + 1),
    meta: { source: 'input', addToHistory: true },
  };
  editor.dispatch(tr);
}

// --- BlockList / BlockHost events ---------------------------------------
//
// UNIFIED DRAG LIFECYCLE — the BlockEditor is the single owner of all
// document-level capture listeners used for block reorder drags.
//
// Flow:
//   1. gripPointerDown arrives from BlockHandle (via BlockHost → BlockList)
//      → install ONE document capture listener pair (mousemove + mouseup)
//   2. Pending phase: track pointer distance from start coords.
//      If user releases before threshold, it was a "click", do nothing.
//   3. Past threshold → "drag officially starts" phase:
//        a. Hide source content (.block-being-dragged)
//        b. Create & position fixed-position ghost that follows cursor
//        c. Set reactive draggingBlockId → faint blue bg
//        d. Compute drop targets on every mousemove → blue indicators
//   4. mouseup → compute final position → call moveBlock command → cleanup.

const dropTargetBlockId = ref<BlockId | null>(null);
const dropPosition = ref<DropPosition>('after');

// Drag state (shared between pending + active phases).
let dragPhase: 'idle' | 'pending' | 'active' = 'idle';
let dragStartX = 0;
let dragStartY = 0;
let dragThresholdPx = 4;
let dragPendingBlockId: BlockId | null = null;

let ghostEl: HTMLDivElement | null = null;
let ghostOffsetX = 0;
let ghostOffsetY = 0;
let dragSrcHostEl: HTMLElement | null = null;
let activeDragBlockId: BlockId | null = null;

// Drop-"into" hover state. When the pointer pauses inside the MIDDLE 50%
// vertical band of a nestable target host for >= INTO_HOVER_MS, we switch
// the drop mode from before/after (sibling insert) to "into" (nest under
// that block as its first child) with a whole-block highlight.
const INTO_HOVER_MS = 200;
const INTO_BAND_TOP = 0.25;    // top quarter → "before"
const INTO_BAND_BOTTOM = 0.75; // bottom quarter → "after"
let intoHoverBlockId: BlockId | null = null;
let intoHoverTimer: ReturnType<typeof setTimeout> | null = null;

function clearIntoHover(): void {
  if (intoHoverTimer !== null) {
    clearTimeout(intoHoverTimer);
    intoHoverTimer = null;
  }
  intoHoverBlockId = null;
}

function cleanUpActiveDrag(): void {
  if (dragSrcHostEl) {
    dragSrcHostEl.classList.remove('block-being-dragged');
    dragSrcHostEl = null;
  }
  if (ghostEl) {
    ghostEl.remove();
    ghostEl = null;
  }
  if (activeDragBlockId !== null) {
    blockListApi()?.setBlockHandleDragging(activeDragBlockId, false);
  }
  activeDragBlockId = null;
  dragPendingBlockId = null;
  dragPhase = 'idle';
  draggingBlockId.value = null;
  dropTargetBlockId.value = null;
  dropPosition.value = 'after';
  clearIntoHover();
}

function removeGlobalDragListeners(): void {
  document.removeEventListener('mousemove', onGlobalDragMouseMove, true);
  document.removeEventListener('mouseup', onGlobalDragMouseUp, true);
  document.removeEventListener('selectstart', onDragSelectStart, true);
}

/** Entry point: BlockHandle grip was just pressed down. This is the ONLY
 *  place we ever install the global capture listeners for a drag sequence. */
function onGripPointerDown(
  blockId: BlockId,
  startX: number,
  startY: number,
  options: { thresholdPx: number },
): void {
  // Read-only mode: no dragging.
  if (!editableRef.value) return;
  // Guard: if for some reason a previous drag left listeners around,
  // clear them first to avoid duplicate handlers.
  if (dragPhase !== 'idle') {
    removeGlobalDragListeners();
    cleanUpActiveDrag();
  }

  dragPhase = 'pending';
  dragPendingBlockId = blockId;
  dragStartX = startX;
  dragStartY = startY;
  dragThresholdPx = options.thresholdPx;

  // Immediately prevent text selection for the duration of the press.
  document.addEventListener('selectstart', onDragSelectStart, true);
  document.addEventListener('mousemove', onGlobalDragMouseMove, true);
  document.addEventListener('mouseup', onGlobalDragMouseUp, true);
}

function onGripPointerUp(_blockId: BlockId): void {
  // No-op: the real mouseup handler is onGlobalDragMouseUp. Kept so the
  // event name exists as a symmetrical pair.
}

function onDragSelectStart(e: Event): void {
  e.preventDefault();
}

/** SINGLE mousemove handler that covers BOTH the threshold-detection phase
 *  AND the active ghost-following + drop-calculation phase. */
function onGlobalDragMouseMove(e: MouseEvent): void {
  // --- Phase 1: PENDING (threshold not yet exceeded) ---------------------
  if (dragPhase === 'pending') {
    const dx = e.clientX - dragStartX;
    const dy = e.clientY - dragStartY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist <= dragThresholdPx) return;
    transitionPendingToActive();
    // fall through into the active phase below for this first mousemove.
  }

  // --- Phase 2: ACTIVE (ghost follows cursor + compute drop) -------------
  if (dragPhase !== 'active') return;

  // Keep the native DOM selection empty throughout the ENTIRE drag.
  // selectstart preventDefault catches new drag-selections, but on some
  // browsers (particularly Chromium) a prior or partially-created range
  // can still grow while the pointer moves over text nodes — we zap it
  // on every mousemove to be absolutely sure. This is a no-op visually
  // (the user is dragging a block, not selecting text) and cheap.
  try {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) sel.removeAllRanges();
  } catch { /* ignore */ }

  // 2a. Move ghost.
  if (ghostEl) {
    ghostEl.style.left = `${e.clientX + ghostOffsetX}px`;
    ghostEl.style.top = `${e.clientY + ghostOffsetY}px`;
  }
  const bid = activeDragBlockId;
  if (!bid) return;

  // 2b. Compute drop target.
  const hosts = Array.from(document.querySelectorAll<HTMLElement>('.block-host'));
  if (hosts.length <= 1) {
    dropTargetBlockId.value = null;
    return;
  }

  const firstRect = hosts[0]!.getBoundingClientRect();
  const lastRect = hosts[hosts.length - 1]!.getBoundingClientRect();

  if (e.clientY < firstRect.top + firstRect.height / 2) {
    clearIntoHover();
    dropTargetBlockId.value = null;
    dropPosition.value = 'first';
    return;
  }
  if (e.clientY > lastRect.bottom - lastRect.height / 2) {
    clearIntoHover();
    dropTargetBlockId.value = null;
    dropPosition.value = 'last';
    return;
  }

  const el = document.elementFromPoint(e.clientX, e.clientY);
  if (!el) {
    clearIntoHover();
    dropTargetBlockId.value = null;
    return;
  }
  const host = el.closest('.block-host') as HTMLElement | null;
  if (!host) {
    clearIntoHover();
    dropTargetBlockId.value = null;
    return;
  }
  const targetBlockId = host.dataset.blockId as BlockId | undefined;
  if (!targetBlockId || targetBlockId === bid) {
    clearIntoHover();
    dropTargetBlockId.value = null;
    return;
  }

  const hostRect = host.getBoundingClientRect();
  const yRatio = hostRect.height === 0 ? 0 : (e.clientY - hostRect.top) / hostRect.height;
  // ---------- Drop-into candidate check ----------
  // Cycle/nestable guard here purely for UX: don't arm the 200ms timer for
  // targets that can never accept children. The command layer would still
  // reject at drop time, but this avoids showing a misleading into state.
  let targetCanInto = false;
  const docNow = editor.getState().doc;
  const tBlock = docNow.blocks.get(targetBlockId);
  if (tBlock) {
    const tSchema = editor.registries.schema.get(tBlock.type);
    if (tSchema?.nestable) {
      // Ensure we're not about to nest bid under one of its own descendants.
      let cyc: BlockId | null = targetBlockId;
      targetCanInto = true;
      while (cyc !== null) {
        if (cyc === bid) {
          targetCanInto = false;
          break;
        }
        cyc = parentOf(docNow, cyc);
      }
    }
  }

  const inCenterBand = yRatio > INTO_BAND_TOP && yRatio < INTO_BAND_BOTTOM;
  const armInto = inCenterBand && targetCanInto;

  if (armInto) {
    // In the center band, over an eligible target — arm the 200ms timer.
    // Until the timer fires we STILL show the immediate before/after line so
    // fast movement is predictable.
    dropTargetBlockId.value = targetBlockId;
    // Compute a transient before/after to show while user hasn't paused yet.
    const before = yRatio < 0.5;
    if (intoHoverBlockId !== targetBlockId) {
      clearIntoHover();
      intoHoverBlockId = targetBlockId;
      intoHoverTimer = setTimeout(() => {
        // Only promote to "into" if pointer is still over the same band.
        // (onGlobalDragMouseMove may set a fresh state, but we only flip here
        //  when the timer actually fires for the currently-armed target.)
        if (intoHoverBlockId === targetBlockId) {
          dropTargetBlockId.value = targetBlockId;
          dropPosition.value = 'into';
        }
      }, INTO_HOVER_MS);
    }
    // Timer armed but not yet fired → keep before/after lines visible.
    if (dropPosition.value !== 'into') {
      dropPosition.value = before ? 'before' : 'after';
    }
  } else {
    // Outside center band, or ineligible target → instant before/after,
    // cancel any pending into timer.
    clearIntoHover();
    dropTargetBlockId.value = targetBlockId;
    dropPosition.value = yRatio < 0.5 ? 'before' : 'after';
  }
}

/** SINGLE mouseup handler — runs once, teardown everything and maybe move. */
function onGlobalDragMouseUp(_e: MouseEvent): void {
  removeGlobalDragListeners();

  if (dragPhase === 'pending') {
    // Never exceeded threshold → pure click, no drag side effects.
    dragPhase = 'idle';
    dragPendingBlockId = null;
    return;
  }

  // dragPhase === 'active' — do drop + move.
  const bid = activeDragBlockId;
  const finalTarget = dropTargetBlockId.value;
  const finalPos = dropPosition.value;

  cleanUpActiveDrag();

  if (!bid) return;
  // into mode requires a concrete target; first/last are OK with null target.
  if (finalPos === 'into' && !finalTarget) return;
  if (!finalTarget && finalPos !== 'first' && finalPos !== 'last') return;
  onMoveBlock(bid, finalTarget, finalPos);
}

/** Pending → Active: hide source, spawn ghost, update reactive state,
 *  tell the source BlockHandle to show the "grabbing" cursor. */
function transitionPendingToActive(): void {
  const blockId = dragPendingBlockId;
  if (!blockId) return;
  const startX = dragStartX;
  const startY = dragStartY;

  // 0. Clear any native text selection before the drag fully starts.
  //    Without this, elementFromPoint during onGlobalDragMouseMove lands on
  //    a contenteditable and the browser extends a text selection across
  //    blocks as the pointer moves — visually wrong and fights overlays.
  //    selectstart prevent-default (onDragSelectStart) stops NEW selections
  //    from being started, but clearing here removes any pre-existing or
  //    in-flight native range that started before the capture listener
  //    attached (e.g. mousedown began on a text character, not the grip).
  try {
    const sel = window.getSelection();
    if (sel) sel.removeAllRanges();
  } catch { /* ignore */ }

  // 0b. Cancel any pending cross-block text selection. The document-level
  //     mousedown listener (onMouseDown) may have armed pendingSel before
  //     onGripPointerDown ran; if we don't cancel it here, processSelectionMove
  //     will keep firing during the drag and paint the cross-block highlight
  //     overlay on target blocks — the exact "text selected" bug.
  if (pendingSel) {
    pendingSel = null;
    if (selRafId) {
      cancelAnimationFrame(selRafId);
      selRafId = 0;
    }
    lastMoveEvent = null;
    document.removeEventListener('mousemove', onSelectionMouseMove, true);
    document.removeEventListener('mouseup', onSelectionMouseUp, true);
    document.removeEventListener('selectstart', onCrossBlockSelectStart, true);
    crossBlockRects.value = [];
  }

  // 0c. 拖动期间临时清空块级 focus，避免蓝框与拖放目标高亮叠加产生视觉冲突。
  //     拖动结束后用户会重新点击或设置 Selection 恢复 focus。
  setFocusedBlock(null);

  // 1. Locate the source block host in the DOM.
  // use the data-block-id attribute (which BlockHost writes on
  // every host, nested or not) to find the src host directly — no need to
  // line up a flat renderItems index with document.querySelectorAll().
  const srcHost = document.querySelector<HTMLElement>(`.block-host[data-block-id="${blockId}"]`);
  if (!srcHost) {
    // Can't find the DOM → bail out of this drag entirely.
    removeGlobalDragListeners();
    dragPhase = 'idle';
    dragPendingBlockId = null;
    return;
  }

  // 2. Hide source content (preserve layout).
  srcHost.classList.add('block-being-dragged');
  dragSrcHostEl = srcHost;

  // 3. Clone inner content as fixed-position drag ghost.
  const srcContent = srcHost.querySelector<HTMLElement>('.block-host-content');
  if (!srcContent) {
    srcHost.classList.remove('block-being-dragged');
    dragSrcHostEl = null;
    removeGlobalDragListeners();
    dragPhase = 'idle';
    dragPendingBlockId = null;
    return;
  }
  const srcRect = srcContent.getBoundingClientRect();
  const srcContentRect = (srcContent.firstElementChild as HTMLElement | null)?.getBoundingClientRect() ?? srcRect;

  ghostOffsetX = srcContentRect.left - startX;
  ghostOffsetY = srcContentRect.top - startY;

  const ghost = document.createElement('div');
  ghost.className = 'drag-ghost';
  const cloneSrc = srcContent.firstElementChild as HTMLElement | null;
  if (cloneSrc) {
    ghost.appendChild(cloneSrc.cloneNode(true));
  }
  ghost.style.width = `${srcContentRect.width}px`;
  ghost.style.left = `${startX + ghostOffsetX}px`;
  ghost.style.top = `${startY + ghostOffsetY}px`;
  document.body.appendChild(ghost);
  ghostEl = ghost;

  // 4. Reactive state + tell handle to enter local drag mode.
  draggingBlockId.value = blockId;
  activeDragBlockId = blockId;
  dropTargetBlockId.value = null;
  dropPosition.value = 'after';
  blockListApi()?.setBlockHandleDragging(blockId, true);

  dragPhase = 'active';
}

function onMoveBlock(blockId: BlockId, targetBlockId: BlockId | null, position: DropPosition): void {
  draggingBlockId.value = null;

  const doc = editor.getState().doc;
  const block = doc.blocks.get(blockId);
  if (!block) return;

  // Cycle guard: never allow a block to be dropped onto itself or onto any
  // of its own descendants. Otherwise the parent chain becomes circular and
  // depthOf / flatten infinite-loop.
  if (targetBlockId) {
    let cursor: BlockId | null = targetBlockId;
    while (cursor !== null) {
      if (cursor === blockId) return; // onto self → invalid drop.
      cursor = parentOf(doc, cursor);
    }
  }

  // Resolve source location (any nesting level) using the store helpers.
  const srcParent = parentOf(doc, blockId);
  const srcIdx = blockIndexOf(doc, blockId);
  if (srcIdx === -1) return;

  let targetParent: BlockId | null = null;
  let targetIndex: number;

  if (position === 'first') {
    targetParent = null;
    targetIndex = 0;
  } else if (position === 'last') {
    targetParent = null;
    targetIndex = doc.root.length;
  } else if (position === 'into' && targetBlockId) {
    // Drop-INTO: place the dragged block as the FIRST child of targetBlockId.
    // UX-level guards (nestable:true / not own descendant) were already
    // checked before the into-timer armed; still double-check here and let
    // the command layer reject firmly otherwise.
    const tBlock = doc.blocks.get(targetBlockId);
    if (!tBlock) return;
    const tSchema = editor.registries.schema.get(tBlock.type);
    if (!tSchema?.nestable) return;
    // Still run the cycle guard to be safe against any state race.
    let cursor: BlockId | null = targetBlockId;
    while (cursor !== null) {
      if (cursor === blockId) return;
      cursor = parentOf(doc, cursor);
    }
    targetParent = targetBlockId;
    targetIndex = 0;
  } else if ((position === 'before' || position === 'after') && targetBlockId) {
    const tParent = parentOf(doc, targetBlockId);
    const tIdx = blockIndexOf(doc, targetBlockId);
    if (tIdx === -1) return;
    targetParent = tParent;
    targetIndex = position === 'before' ? tIdx : tIdx + 1;
  } else {
    return;
  }

  // Adjust index if the block is being moved to a LATER position within the
  // SAME sibling list: removal of the source (at srcIdx) happens before the
  // insert in the underlying Step semantics, so a later target shifts -1.
  const sameSiblingList = srcParent === targetParent;
  if (sameSiblingList && srcIdx < targetIndex) {
    targetIndex--;
  } else if (!sameSiblingList) {
    // Cross-parent move: if src and target share the same grand-sibling
    // ordering via flat walk we don't need to adjust. The moveBlock Step
    // operates on raw (parent,index) tuples and does not reinterpret indices.
  }

  targetIndex = Math.max(0, targetIndex);
  const siblings = targetParent === null
    ? doc.root
    : (doc.blocks.get(targetParent)?.children as readonly BlockId[] | undefined);
  if (siblings) targetIndex = Math.min(targetIndex, siblings.length);

  editor.commands.moveBlock?.({ id: blockId, toParent: targetParent, toIndex: targetIndex });
}

// --- External file drag & drop (image insert from OS) -------------------
//
// Separate from the internal grip-handle drag/move flow. When the user
// drags image files from their OS onto the editor, we compute drop targets
// (reusing the same dropTargetBlockId + dropPosition refs so the blue
// indicators light up), then insert image blocks on drop and feed each
// file through beginImageUpload.
//
// State: `fileDragActive` tracks whether the current drag actually contains
// image files (other drags — e.g. links from browser, plain text, internal
// block drags — are deliberately ignored so we don't show spurious drop
// indicators).

const fileDragActive = ref(false);

function collectImageFilesFromDataTransfer(data: DataTransfer): File[] {
  const files: File[] = [];
  if (!data || !data.types) return files;
  if (!Array.from(data.types).includes('Files')) return files;

  const seen = new Set<string>();
  if (data.items && data.items.length > 0) {
    for (let i = 0; i < data.items.length; i++) {
      const item = data.items[i]!;
      if (item.kind !== 'file') continue;
      const f = item.getAsFile();
      if (!f || !f.type.startsWith('image/')) continue;
      const key = `${f.name || ''}:${f.size}:${f.type}`;
      if (seen.has(key)) continue;
      seen.add(key);
      files.push(f);
    }
  }

  if (data.files && data.files.length > 0) {
    for (let i = 0; i < data.files.length; i++) {
      const f = data.files[i]!;
      if (!f.type.startsWith('image/')) continue;
      const key = `${f.name || ''}:${f.size}:${f.type}`;
      if (seen.has(key)) continue;
      seen.add(key);
      files.push(f);
    }
  }
  return files;
}

function onFileDragOver(e: DragEvent): void {
  // Ignore internal block drags (those go through grip handlers).
  if (draggingBlockId.value) return;
  const dt = e.dataTransfer;
  if (!dt) return;
  const images = collectImageFilesFromDataTransfer(dt);
  if (images.length === 0) return;

  if (!fileDragActive.value) fileDragActive.value = true;

  // Reuse the same drop-target calculation from internal drag.
  const hosts = Array.from(document.querySelectorAll<HTMLElement>('.block-host'));
  if (hosts.length === 0) {
    dropTargetBlockId.value = null;
    dropPosition.value = 'last';
    return;
  }

  const firstRect = hosts[0]!.getBoundingClientRect();
  const lastRect = hosts[hosts.length - 1]!.getBoundingClientRect();
  const y = e.clientY;

  if (y < firstRect.top + firstRect.height / 2) {
    dropTargetBlockId.value = null;
    dropPosition.value = 'first';
    return;
  }
  if (y > lastRect.bottom - lastRect.height / 2) {
    dropTargetBlockId.value = null;
    dropPosition.value = 'last';
    return;
  }

  const el = document.elementFromPoint(e.clientX, e.clientY);
  if (!el) {
    dropTargetBlockId.value = null;
    dropPosition.value = 'last';
    return;
  }
  const host = el.closest('.block-host') as HTMLElement | null;
  if (!host) {
    dropTargetBlockId.value = null;
    dropPosition.value = 'last';
    return;
  }
  const hostRect = host.getBoundingClientRect();
  // host may be nested; read its id directly.
  const targetBlockId = host.dataset.blockId as BlockId | undefined;
  if (!targetBlockId) {
    dropTargetBlockId.value = null;
    dropPosition.value = 'last';
    return;
  }
  dropTargetBlockId.value = targetBlockId;
  dropPosition.value = y < hostRect.top + hostRect.height / 2 ? 'before' : 'after';
}

function onFileDragLeave(e: DragEvent): void {
  // Only clear when the pointer actually left the root (not just moved over
  // a different child — browsers fire dragleave rapidly between children).
  const to = e.relatedTarget as Node | null;
  const root = rootEl.value;
  if (root && to && root.contains(to)) return;
  if (fileDragActive.value) {
    fileDragActive.value = false;
    dropTargetBlockId.value = null;
    dropPosition.value = 'after';
  }
}

async function onFileDrop(e: DragEvent): Promise<void> {
  if (draggingBlockId.value) return; // internal drag — let grip handler run
  const dt = e.dataTransfer;
  if (!dt) return;
  const images = collectImageFilesFromDataTransfer(dt);
  if (images.length === 0) return;

  // Compute anchor block + position, then reset indicators.
  const finalTarget: BlockId | null = dropTargetBlockId.value;
  const finalPos: DropPosition = dropPosition.value;
  fileDragActive.value = false;
  dropTargetBlockId.value = null;
  dropPosition.value = 'after';

  // Convert 'first'/'last' + targetBlockId into a (relativeBlockId, position)
  // that beginImageUpload understands. We do this BEFORE the async loop so
  // the (possibly empty) document snapshot is taken immediately.
  let relativeTo: BlockId | null = finalTarget;
  let pos: 'before' | 'after' = finalPos === 'before' ? 'before' : 'after';

  const doc = editor.getState().doc;
  if (finalPos === 'first') {
    const firstId = doc.root[0] ?? null;
    relativeTo = firstId;
    pos = 'before';
  } else if (finalPos === 'last') {
    const lastId = doc.root[doc.root.length - 1] ?? null;
    relativeTo = lastId;
    pos = 'after';
  }

  // For empty documents: beginImageUpload already has fallbacks, so passing
  // `null` is fine.

  let lastBlockId = relativeTo;
  for (let i = 0; i < images.length; i++) {
    const file = images[i]!;
    const bid = await beginImageUpload(file, {
      relativeToBlockId: lastBlockId,
      position: i === 0 ? pos : 'after',
      convertIfEmpty: i === 0,
    });
    if (bid) lastBlockId = bid;
  }
}

function onOpenSettingsMenu(blockId: BlockId, anchor: HTMLElement): void {
  closePlusMenu();
  closeSettingsMenu();
  settingsMenu.visible = true;
  settingsMenu.anchorEl = anchor;
  settingsMenu.blockId = blockId;
}

function closeSettingsMenu(): void {
  settingsMenu.visible = false;
  settingsMenu.anchorEl = null;
  // Note: do NOT clear blockId here. The fade-out animation (shouldRender)
  // keeps the menu mounted for ~300ms; clearing blockId would make
  // isImageBlock flip to false, causing hidden text-block sections to
  // briefly flash before the menu disappears.
}

/**
 * Handle a click on the left "+" button of a block.
 * Rules:
 *   - If the source block is EMPTY: open PlusMenu directly on it (mode=slash,
 *     so the chosen command converts this empty block).
 *   - Otherwise: INSERT a new empty paragraph AFTER the source block, focus
 *     it, and then open PlusMenu against the NEW block (mode=insert) so the
 *     user's choice converts the freshly-inserted block into the desired
 *     type.
 */
function onOpenPlusMenu(sourceBlockId: BlockId, anchor: HTMLElement): void {
  // Read-only mode: no adding blocks.
  if (!editableRef.value) return;
  closeSettingsMenu();
  closePlusMenu();

  const src = editor.getState().doc.blocks.get(sourceBlockId);
  if (!src) return;

  const schema = editor.registries.schema.get(src.type);
  const supportsText = schema?.content === 'text';
  const isEmpty = supportsText && inlineText(src.content).length === 0;

  if (isEmpty) {
    // Convert the current block in place.
    plusMenu.visible = true;
    plusMenu.anchorEl = anchor;
    plusMenu.blockId = sourceBlockId;
    plusMenu.query = '';
    plusMenu.mode = 'slash';
    plusMenu.sourceBlockId = undefined;
    return;
  }

  // Otherwise first insert a new empty paragraph after the source block.
  // The insertBlock command sets selection to the new block, so we can read
  // the new block id from the updated state immediately after dispatch.
  editor.commands.insertBlock?.({
    type: editor.registries.defaultBlockType,
    after: sourceBlockId,
    content: [],
  });

  const sel = editor.getState().selection;
  const targetBlock: BlockId = sel.kind === 'caret' ? sel.blockId : sourceBlockId;

  plusMenu.visible = true;
  plusMenu.anchorEl = anchor;
  plusMenu.blockId = targetBlock;
  plusMenu.query = '';
  plusMenu.mode = 'insert';
  plusMenu.sourceBlockId = sourceBlockId;
}

function onSlashTrigger(el: HTMLElement, blockId: BlockId, query: string): void {
  // Read-only mode: no slash commands.
  if (!editableRef.value) return;
  closeSettingsMenu();
  plusMenu.visible = true;
  plusMenu.anchorEl = el;
  plusMenu.blockId = blockId;
  plusMenu.query = query;
  plusMenu.mode = 'slash';
  plusMenu.sourceBlockId = undefined;
}

function onInputChanged(blockId: BlockId, text: string): void {
  if (!plusMenu.visible) return;
  if (blockId !== plusMenu.blockId) {
    closePlusMenu();
    return;
  }
  const m = text.match(/\/([^/]*)$/);
  if (!m) {
    closePlusMenu();
    return;
  }
  plusMenu.query = m[1] ?? '';
}

function closePlusMenu(): void {
  plusMenu.visible = false;
  plusMenu.anchorEl = null;
  plusMenu.query = '';
  plusMenu.sourceBlockId = undefined;
}

// When text is selected, the HoverToolbar takes over — close any open menus
// and hide block handles (handles are hidden via hasTextSelection prop).
watch(() => hoverToolbar.visible, (visible) => {
  // On mobile the user can tap the handle / plus buttons on the bottom
  // toolbar while text is selected — that path opens PlusMenu /
  // BlockSettingsMenu directly (onOpenPlusMenu / onOpenSettingsMenu set
  // them visible), then a subsequent selectionchange updates hoverToolbar
  // and fires this watch. Without the guards the newly-opened menu is
  // closed immediately, producing a one-frame flash.
  if (visible) {
    if (!plusMenu.visible) closePlusMenu();
    if (!settingsMenu.visible) closeSettingsMenu();
  }
});

// --- PlusMenu commit (handles both slash + insert modes) ----------------

/**
 * Process a PlusMenu commit:
 *   Slash mode:
 *     1. Strip "/{query}" from the block.
 *     2. Run the slash command (usually convertBlock) against the same block.
 *   Insert mode:
 *     The block is already a freshly inserted empty paragraph. But the user
 *     may have typed "/query" while the menu was open (filtering items), so
 *     we also strip any slash prefix. Then run the command (usually
 *     convertBlock) against the target block.
 */
function onPlusCommit(cmd: SlashCommand, _mode: PlusMenuMode): void {
  const blockId = plusMenu.blockId;
  const rawText = currentDomTextOf(blockId);
  const textWithoutSlash = stripSlashPrefix(rawText);

  editor.history.beginGroup();
  try {
    if (rawText !== textWithoutSlash) {
      editor.commands.setText?.({ id: blockId, content: inlineFromString(textWithoutSlash) });
    }
    const spec = editor.registries.slash.all.find((c: SlashCommand) => c.id === cmd.id);
    if (spec) {
      const built = typeof spec.args === 'function'
        ? (spec.args as (m: null) => unknown)(null)
        : spec.args;
      const argsRecord = built && typeof built === 'object'
        ? { ...(built as Record<string, unknown>) }
        : {};
      // Resolve command args: if this is a convertBlock command that uses
      // `__currentBlock__`, substitute it with the target block id.
      if (argsRecord.id === '__currentBlock__') argsRecord.id = blockId;
      if (argsRecord.after === '__currentBlock__') argsRecord.after = blockId;
      const runner = editor.commands[spec.command];
      runner?.(argsRecord);
      // Ensure selection is on the converted block at offset 0.
      editor.commands.setSelection?.({
        selection: {
          kind: 'caret',
          blockId,
          offset: 0,
        },
      });

      // --- Post-commit special-case: Image block -------------------------
      //
      // When the user picks `/image`, convertBlock turns the target block
      // into an empty image block with a dashed placeholder prompt. For
      // better UX, we ALSO immediately open the system file picker so the
      // user can choose an image straight away. If they cancel, the empty
      // placeholder stays (they can click it or retry via slash later).
      //
      // We use nextTick so the renderer has swapped to ImageBlock before we
      // try to access anything; but we don't actually need the renderer,
      // we just need a temp <input> + beginImageUpload with position=replace.
      if (cmd.id === 'image') {
        nextTick(() => {
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = 'image/*';
          input.multiple = false;
          input.addEventListener('change', () => {
            const f = input.files?.[0];
            if (f) {
              void beginImageUpload(f, {
                relativeToBlockId: blockId,
                position: 'replace',
                convertIfEmpty: true,
              });
            }
          });
          input.click();
        });
      }
    }
  } finally {
    editor.history.endGroup();
  }

  closePlusMenu();
}

function currentDomTextOf(blockId: BlockId): string {
  const root = rootEl.value;
  if (!root) return '';
  const node = root.querySelector<HTMLElement>(`.block-content[data-block-id="${blockId}"]`);
  return node?.textContent ?? '';
}

function stripSlashPrefix(text: string): string {
  const idx = text.lastIndexOf('/');
  if (idx < 0) return text;
  return text.slice(0, idx);
}

// --- Hover toolbar: show on mouseup, not during drag -------------------

function onDocumentSelectionChange(_eventOrOpts?: Event | { force?: boolean }): void {
  // The same function is used for both:
  //   1. document.addEventListener('selectionchange', onDocumentSelectionChange)
  //      → first arg is an Event object (we never use it; we re-read from
  //        window.getSelection() directly inside).
  //   2. Internal programmatic calls from markToolbarInteracting timeout etc.
  //      → first arg is `{ force: true }` (or `{}`) to request bypassing
  //        the `isMouseDown` drag-suppression guard.
  // Detect which case we're in by checking if the arg looks like our opts.
  let force = false;
  if (_eventOrOpts && typeof _eventOrOpts === 'object' && !('type' in _eventOrOpts)) {
    force = Boolean((_eventOrOpts as { force?: boolean }).force);
  }
  const editorRoot = rootEl.value;
  if (editorRoot) {
    const domSel = window.getSelection();
    let nextFocused: BlockId | null = null;
    if (domSel && domSel.rangeCount > 0) {
      const focusNode = domSel.focusNode;
      const contentEl = (focusNode?.nodeType === 1
        ? (focusNode as HTMLElement).closest<HTMLElement>('.block-content')
        : (focusNode?.parentElement?.closest<HTMLElement>('.block-content')));
      if (contentEl && editorRoot.contains(contentEl)) {
        const bid = contentEl.getAttribute('data-block-id');
        if (bid) nextFocused = bid as BlockId;
      }
    }
    // [Guard 2] Refuse stale-caret overwrite.
    if (nextFocused !== null && focusedBlockId.value !== null && nextFocused !== focusedBlockId.value) {
      const curBlock = editor.getState().doc.blocks.get(focusedBlockId.value);
      if (curBlock && NON_TEXT_BLOCK_TYPES.has(curBlock.type)) {
        nextFocused = null;
      }
    }
    // [Guard 3] Refuse ANY focus change during the toolbar interaction
    // grace period — even legit-looking ones. Clicking a bold/italic/type
    // button inside FixedToolbar sometimes fires a transient focusin /
    // selectionchange combo that briefly points at a DIFFERENT block (e.g.
    // the document's first block) before the action's own selection restores
    // things. Skipping setFocusedBlock here keeps the previously-focused
    // block stable so the type dropdown doesn't flash "一级标题".
    if (nextFocused !== null && !toolbarInteracting) {
      setFocusedBlock(nextFocused);
    }
  }

  // Read-only: never show the hover toolbar on text selection.
  if (!editableRef.value) {
    hoverToolbar.visible = false;
    hoverToolbar.selectionRect = null;
    hoverToolbar.blockId = null;
    hoverToolbar.blockType = null;
    hoverToolbar.blockAttrs = {};
    return;
  }
  const root = rootEl.value;
  if (!root) return;
  // If the editor state holds a cross-block text selection, the native
  // selection is intentionally empty — don't let selectionchange hide the
  // toolbar or overlay. The selection is cleared on the next mousedown.
  const stateSel = editor.getState().selection;
  if (stateSel.kind === 'text' && isCrossBlockText(stateSel) && !pendingSel) {
    return;
  }
  // Grace period: when the user is interacting with the FixedToolbar buttons,
  // the browser fires selectionchange (collapsing / emptying the text
  // selection) before the click action completes. We only want to GUARD
  // against the "hide toolbar / null out rect" destructive assignments
  // below — we still allow the POSITIVE "set visible=true + fill rect"
  // branch at the bottom to run freely, so that selection-restore after
  // BlockContent's innerHTML rewrite always materialises into state.
  // Accordingly, there is no blanket `return;` here; each destructive
  // site checks the flag on its own.
  //
  // A block selection (e.g. a selected image) is active but the caret has
  // moved into a text block — a plain click into contenteditable dispatches
  // no editor transaction, so the selection state would stay stuck on the
  // selected block. Adopt the native caret position to drop the selection.
  if (isBlocks(stateSel) && stateSel.blockIds.length > 0) {
    // If a collapsed caret has appeared (e.g. the user clicked into a text
    // block while a block selection was active), downgrade the block selection
    // to that caret. This is what deselects a non-text block (image/equation/
    // table/...) when you click elsewhere — without it the block would stay
    // "selected" forever. Selecting a non-text block itself never reaches this
    // branch (its mousedown arms mouseDownOnNonTextBlock, so onMouseUp skips
    // onDocumentSelectionChange entirely), so this downgrade never interferes
    // with the non-text block's own selection.
    const domSel = window.getSelection();
    if (domSel && domSel.rangeCount > 0 && domSel.getRangeAt(0).collapsed) {
      const read = readDomSelection(root, editor.getState().doc);
      if (read && read.kind === 'caret') {
        suppressSelectionSync = true;
        editor.commands.setSelection?.({ selection: read });
        suppressSelectionSync = false;
      }
    }
  }
  const sel = window.getSelection();
  // Destructive "clear hoverToolbar state" exits below — each is guarded by
  // BOTH !toolbarInteracting AND !isMouseDown. Why two flags?
  //   * `toolbarInteracting` covers the 500ms window AFTER a FixedToolbar /
  //     HoverToolbar button mousedown: click inside a teleported dropdown or
  //     button fires selectionchange synchronously while the command is still
  //     applying; clearing state here would cause the "toolbar flashes
  //     disabled" bug because the POSITIVE branch at the bottom hasn't fired
  //     yet for the post-command restored selection.
  //   * `isMouseDown` covers everything BEFORE a mouseup — i.e. the user is
  //     actively DRAGGING inside contenteditable to extend/shrink the text
  //     selection, or is still HOLDING a toolbar button down (no mouseup yet
  //     → no click handler fired → no command run → no POSITIVE refill). In
  //     either case, native selectionchange fires continuously with transient
  //     collapsed / no-range / wrong-ancestor snapshots; wiping state on each
  //     would kill the POSITIVE state the user saw on the previous mouseup,
  //     and when combined with FixedToolbar's lazy-clear timer (1.5s) a long
  //     enough button hold would clear the cache *despite* the 500ms
  //     protection, locking the toolbar on the Priority-4 focused-block
  //     fallback with all buttons disabled.
  // NOTE: the POSITIVE branch at the bottom (visible=true + fill rect + block
  // info) never checks either flag — selection-restore during command apply
  // must always be allowed to populate state so subsequent lazy-clear runs
  // find a valid descriptor to latch on to.
  if (!sel || sel.rangeCount === 0) {
    if (!toolbarInteracting && !isMouseDown) {
      hoverToolbar.visible = false;
      hoverToolbar.selectionRect = null;
      hoverToolbar.blockId = null;
      hoverToolbar.blockType = null;
      hoverToolbar.blockAttrs = {};
    }
    return;
  }
  const range = sel.getRangeAt(0);
  if (range.collapsed) {
    if (!toolbarInteracting && !isMouseDown) {
      hoverToolbar.visible = false;
      hoverToolbar.selectionRect = null;
      hoverToolbar.blockId = null;
    }
    return;
  }
  if (!root.contains(range.commonAncestorContainer)) {
    if (!toolbarInteracting && !isMouseDown) {
      hoverToolbar.visible = false;
      hoverToolbar.selectionRect = null;
      hoverToolbar.blockId = null;
    }
    return;
  }
  // Drag-in-progress suppression inside editor content (NOT the force:true
  // post-timeout resync case — see inlined comment).
  if (isMouseDown && !force) return;
  const anchorNode = sel.anchorNode;
  // If the selection is inside a table cell's contenteditable, the TableBlock
  // renderer manages its own HoverToolbar (cellEditMode). Skip the editor-level
  // toolbar to avoid showing a second toolbar with the wrong block context.
  const cellInner = (anchorNode?.nodeType === 1
    ? (anchorNode as HTMLElement).closest<HTMLElement>('.table-cell-inner')
    : (anchorNode?.parentElement?.closest<HTMLElement>('.table-cell-inner')));
  if (cellInner) {
    if (!toolbarInteracting && !isMouseDown) {
      hoverToolbar.visible = false;
      hoverToolbar.selectionRect = null;
      hoverToolbar.blockId = null;
      hoverToolbar.blockType = null;
      hoverToolbar.blockAttrs = {};
    }
    return;
  }
  const contentEl = (anchorNode?.nodeType === 1
    ? (anchorNode as HTMLElement).closest<HTMLElement>('.block-content')
    : (anchorNode?.parentElement?.closest<HTMLElement>('.block-content')));
  if (!contentEl) {
    if (!toolbarInteracting && !isMouseDown) {
      hoverToolbar.visible = false;
      hoverToolbar.selectionRect = null;
      hoverToolbar.blockId = null;
    }
    return;
  }
  const blockId = contentEl.getAttribute('data-block-id') as BlockId | null;
  if (!blockId) {
    if (!toolbarInteracting && !isMouseDown) {
      hoverToolbar.visible = false;
      hoverToolbar.selectionRect = null;
      hoverToolbar.blockId = null;
    }
    return;
  }
  const doc = editor.getState().doc;
  const block: Block | undefined = doc.blocks.get(blockId);
  const rect = range.getBoundingClientRect();
  const finalRect: DOMRect = (rect.width === 0 && rect.height === 0)
    ? contentEl.getBoundingClientRect()
    : rect;
  hoverToolbar.visible = true;
  hoverToolbar.selectionRect = finalRect;
  hoverToolbar.blockId = blockId;
  hoverToolbar.blockType = block?.type ?? null;
  hoverToolbar.blockAttrs = block?.attrs ?? {};
  void inlineText;
}

/**
 * Re-read the live selection rect from the DOM. Called on scroll/resize so
 * the hover toolbar follows the selected text instead of staying at a fixed
 * screen position. `selectionRect` is a viewport-relative DOMRect captured
 * at mouseup time — it goes stale the moment the page scrolls, so we must
 * refresh it from the current selection range.
 */
function refreshHoverToolbarRect(): void {
  // For cross-block selections, recompute the overlay rects (they are
  // viewport-relative and go stale on scroll/resize).
  const sel = editor.getState().selection;
  if (sel.kind === 'text' && isCrossBlockText(sel)) {
    updateCrossBlockOverlay();
    if (hoverToolbar.visible) {
      const root = rootEl.value;
      if (root) {
        const rects = crossBlockSelectionRects(root, editor.getState().doc, sel);
        if (rects.length > 0) {
          hoverToolbar.selectionRect = unionRects(rects);
        }
      }
    }
    return;
  }
  if (!hoverToolbar.visible) return;
  const ns = window.getSelection();
  if (!ns || ns.rangeCount === 0) return;
  const range = ns.getRangeAt(0);
  if (range.collapsed) return;
  const rect = range.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return;
  hoverToolbar.selectionRect = rect;
}

/** Compute the bounding box of an array of rects. */
function unionRects(rects: DOMRect[]): DOMRect {
  if (rects.length === 0) return new DOMRect(0, 0, 0, 0);
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const r of rects) {
    left = Math.min(left, r.left);
    top = Math.min(top, r.top);
    right = Math.max(right, r.right);
    bottom = Math.max(bottom, r.bottom);
  }
  return new DOMRect(left, top, right - left, bottom - top);
}

/** Show the HoverToolbar for a cross-block text selection. */
function showHoverToolbarForCrossBlock(sel: Extract<EditorSelection, { kind: 'text' }>): void {
  // Read-only: never show the hover toolbar on cross-block selection.
  if (!editableRef.value) return;
  const root = rootEl.value;
  if (!root) return;
  const rects = crossBlockSelectionRects(root, editor.getState().doc, sel);
  if (rects.length === 0) return;
  const rect = unionRects(rects);
  // Use the focus block's type/attrs for the toolbar context.
  const doc = editor.getState().doc;
  const block = doc.blocks.get(sel.focus.blockId);
  hoverToolbar.visible = true;
  hoverToolbar.selectionRect = rect;
  hoverToolbar.blockId = sel.focus.blockId;
  hoverToolbar.blockType = block?.type ?? null;
  hoverToolbar.blockAttrs = block?.attrs ?? {};
}

function onMouseDown(e: MouseEvent): void {
  const root = rootEl.value;
  if (!root) return;
  // On touch devices the browser fires synthetic mouse events AFTER the
  // touch sequence completes. Letting onMouseDown run there would collapse
  // a just-completed mobile cross-block selection to a caret and clear the
  // overlay/toolbar. Mobile selection is handled entirely by touch handlers.
  if (isMobile.value) return;
  // Only track mousedown inside the editor for drag-selection.
  // Clicks on the hover toolbar (teleported to <body>) must NOT hide it.
  if (!root.contains(e.target as Node)) return;
  // Skip cross-block selection tracking when the press is on a block handle
  // (grip / plus button) — those start a block DRAG, not a text selection,
  // and leaving pendingSel active would cause the cross-block highlight
  // overlay to follow the cursor during the drag.
  const targetEl = e.target as HTMLElement | null;
  if (targetEl && targetEl.closest('.block-handle')) return;
  isMouseDown = true;
  hoverToolbar.visible = false;
  // Clear any existing cross-block selection: the new click starts fresh.
  const prevSel = editor.getState().selection;
  if (prevSel.kind === 'text' && isCrossBlockText(prevSel)) {
    crossBlockRects.value = [];
  }
  // Start cross-block selection tracking if the press is inside a block content.
  // Skip for non-text blocks (table, TOC, image, divider, codeBlock, etc.)
  // — these blocks manage their own mouse events. Mark mouseDownOnNonTextBlock
  // so onMouseUp skips calling onDocumentSelectionChange (which would read
  // a stale caret in a previously-edited text block and clear the focus
  // border set by selectBlock / onBlockRootClick).
  if (e.button === 0 && !e.shiftKey) {
    const targetEl = e.target as HTMLElement | null;
    if (targetEl && (
      targetEl.closest('.table-cell-inner, .block-table-container, .block-table-of-contents')
      || (targetEl.closest('.block-focus-root') && !targetEl.closest('[contenteditable="true"]') && !targetEl.closest('[data-equation-edit]'))
      // An equation rendered in VIEW mode (not editing) owns no text caret,
      // so it must be treated like the other non-text blocks: skip drag
      // selection tracking and, crucially, let the click's selectBlock win
      // instead of being overwritten by a stale caret on mouseup.
      || (targetEl.closest('.equation-block') && !targetEl.closest('[data-equation-edit]'))
    )) {
      mouseDownOnNonTextBlock = true;
      try {
        const sel = window.getSelection();
        if (sel) sel.removeAllRanges();
      } catch { /* ignore */ }
      return;
    } else {
      mouseDownOnNonTextBlock = false;
    }
    const hit = positionFromPoint(e.clientX, e.clientY, root, editor.getState().doc);
    if (hit) {
      // If there was a cross-block selection, collapse to the click position.
      if (prevSel.kind === 'text' && isCrossBlockText(prevSel)) {
        suppressSelectionSync = true;
        editor.commands.setSelection?.({ selection: caretSelection(hit.blockId, hit.offset) });
        suppressSelectionSync = false;
      }
      pendingSel = {
        start: { blockId: hit.blockId, offset: hit.offset },
        crossBlock: false,
      };
      document.addEventListener('mousemove', onSelectionMouseMove, true);
      document.addEventListener('mouseup', onSelectionMouseUp, true);
    }
  }
}

function onMouseUp(): void {
  if (!isMouseDown) return;
  // Synthetic mouse events from mobile touch sequences must not interfere
  // with mobile cross-block selection (which is handled entirely by touch
  // handlers). Already handled by the early return in onMouseDown, but
  // guard here too for safety.
  if (isMobile.value) {
    isMouseDown = false;
    return;
  }
  isMouseDown = false;
  // [Guard 1] If this mouse-down→up cycle started on a non-text block
  // (table / TOC / image / divider / codeBlock), the DOM selection is
  // either empty or a stale caret left-over from a previously-edited text
  // block. Calling onDocumentSelectionChange would read that stale caret
  // and overwrite focusedBlockId — exactly the bug where the table focus
  // border disappears on mouseup. Skip entirely.
  if (mouseDownOnNonTextBlock) {
    mouseDownOnNonTextBlock = false;
    return;
  }
  // Re-check selection now that the mouse is released.
  // If a cross-block selection is active, the native selection is empty —
  // onDocumentSelectionChange would hide the toolbar, so we skip it.
  const sel = editor.getState().selection;
  if (sel.kind === 'text' && isCrossBlockText(sel)) return;
  onDocumentSelectionChange();
}

// --- Mobile touch cross-block selection -----------------------------------
// On mobile:
//   1. Long-press (> 400ms) on text inside block content initiates
//      cross-block selection. Prevents native selection (which can't cross
//      independent contenteditable elements).
//   2. After selection is initiated, drag finger across blocks extends
//      selection exactly like on desktop.
//   3. Lift finger to end selection. FixedToolbar shows for copy/edit.

interface MobileTouchGesture {
  longPressTimer: number;
  startTouch: Touch;
}

let mobileTouchGesture: MobileTouchGesture | null = null;
let isMobileTouchMoved = false;

const LONG_PRESS_DELAY_MS = 400;

function onTouchStart(e: TouchEvent): void {
  if (!isMobile.value) return;
  const root = rootEl.value;
  if (!root || !root.contains(e.target as Node)) return;

  const targetEl = e.target as HTMLElement | null;
  if (!targetEl) return;

  // Only intercept touches inside block content (text editing areas).
  const contentEl = targetEl.closest('.block-content');
  if (!contentEl) return;

  // Skip handles, buttons, links — let them handle their own events.
  if (targetEl.closest('.block-handle, .tt-btn, .ht-btn, a[href]')) return;

  const touch = e.touches[0];
  if (!touch) return;

  // Store pending gesture. We'll start cross-block selection after the
  // long-press delay if the finger hasn't moved far enough to be a scroll.
  isMobileTouchMoved = false;
  mobileTouchGesture = {
    longPressTimer: window.setTimeout(() => {
      // Long-press confirmed: start cross-block selection.
      if (!mobileTouchGesture) return;
      startMobileSelection(root, mobileTouchGesture.startTouch);
    }, LONG_PRESS_DELAY_MS),
    startTouch: touch,
  };

  // Track the rest of the gesture so we can (a) cancel the long-press when
  // the finger moves into a scroll, and (b) once selection starts, drag
  // across blocks. touchmove must be non-passive so we can preventDefault
  // to stop scrolling after selection begins. These are removed in onTouchEnd.
  document.addEventListener('touchmove', onTouchMove, { passive: false, capture: true });
  document.addEventListener('touchend', onTouchEnd, true);
  document.addEventListener('touchcancel', onTouchEnd, true);

  // Do NOT prevent default on touchstart — this lets normal scrolling
  // and single-tap caret positioning continue unmodified.
}

function onTouchMove(e: TouchEvent): void {
  if (!mobileTouchGesture) return;
  isMobileTouchMoved = true;

  const root = rootEl.value;
  if (!root) return;

  // If selection hasn't started yet (still within the long-press window)
  // and the finger has moved a lot, it's just a normal scroll — cancel the
  // long-press timer and let the browser handle scrolling.
  if (!pendingSel) {
    const touch = e.touches[0];
    if (!touch) return;
    const dx = touch.clientX - mobileTouchGesture.startTouch.clientX;
    const dy = touch.clientY - mobileTouchGesture.startTouch.clientY;
    if (Math.hypot(dx, dy) > 10) {
      if (mobileTouchGesture.longPressTimer) {
        clearTimeout(mobileTouchGesture.longPressTimer);
      }
      mobileTouchGesture = null;
      return;
    }
    return;
  }

  // Selection is active: hit-test the finger position.
  const touch = e.touches[0];
  if (!touch) return;
  const hit = positionFromPoint(touch.clientX, touch.clientY, root, editor.getState().doc);
  if (!hit) return;

  const start = pendingSel.start;
  if (hit.blockId === start.blockId) {
    // Same block as the start: let the native selection handle it (native
    // selection handles can select within a single contenteditable). Do NOT
    // preventDefault here so native selection/scroll can proceed.
    if (pendingSel.crossBlock) {
      pendingSel.crossBlock = false;
      crossBlockRects.value = [];
      document.removeEventListener('selectstart', onCrossBlockSelectStart, true);
      const ns = window.getSelection();
      if (ns) ns.removeAllRanges();
    }
    return;
  }

  // Cross-block: prevent scrolling, suppress native selection, and take
  // over rendering the selection with the overlay.
  e.preventDefault();
  if (!pendingSel.crossBlock) {
    pendingSel.crossBlock = true;
    document.addEventListener('selectstart', onCrossBlockSelectStart, true);
    const ns = window.getSelection();
    if (ns) ns.removeAllRanges();
  }

  const focus: Anchor = { blockId: hit.blockId, offset: hit.offset };
  const sel = textSelection(start, focus);
  suppressSelectionSync = true;
  editor.commands.setSelection?.({ selection: sel });
  suppressSelectionSync = false;
  updateCrossBlockOverlay();
}

function startMobileSelection(root: HTMLElement, touch: Touch): void {
  const hit = positionFromPoint(touch.clientX, touch.clientY, root, editor.getState().doc);
  if (!hit) {
    mobileTouchGesture = null;
    return;
  }

  hoverToolbar.visible = false;

  // Clear any existing cross-block selection overlay.
  const prevSel = editor.getState().selection;
  if (prevSel.kind === 'text' && isCrossBlockText(prevSel)) {
    crossBlockRects.value = [];
  }

  // Start pending selection tracking.
  pendingSel = {
    start: { blockId: hit.blockId, offset: hit.offset },
    crossBlock: false,
  };
}

function onTouchEnd(): void {
  // If gesture was started but selection hasn't started (the timer fired
  // but we were cancelled by a large move), just clean up.
  if (mobileTouchGesture) {
    if (mobileTouchGesture.longPressTimer) {
      clearTimeout(mobileTouchGesture.longPressTimer);
    }
    mobileTouchGesture = null;
  }

  if (!pendingSel) {
    // Cleanup stale listeners.
    document.removeEventListener('touchmove', onTouchMove, true);
    document.removeEventListener('touchend', onTouchEnd, true);
    document.removeEventListener('touchcancel', onTouchEnd, true);
    return;
  }

  pendingSel = null;

  document.removeEventListener('touchmove', onTouchMove, true);
  document.removeEventListener('touchend', onTouchEnd, true);
  document.removeEventListener('touchcancel', onTouchEnd, true);
  document.removeEventListener('selectstart', onCrossBlockSelectStart, true);

  if (!isMobileTouchMoved) {
    // Long-press released without dragging: let the browser's native
    // word-selection (or caret) behavior stand. We must NOT touch the
    // selection here — placing a caret would destroy the native handles
    // the OS just showed. pendingSel has already been cleared above.
    return;
  }

  // Drag completed: refresh overlay.
  updateCrossBlockOverlay();

  // Show the toolbar (floating HoverToolbar on desktop, FixedToolbar on mobile)
  // if cross-block selection is active.
  const sel = editor.getState().selection;
  if (sel.kind === 'text' && isCrossBlockText(sel)) {
    showHoverToolbarForCrossBlock(sel);
  }
}

// --- Cross-block copy / cut ---------------------------------------------

/** Extract the text + html representation of a cross-block text selection. */
function serializeCrossBlockSelection(
  sel: Extract<EditorSelection, { kind: 'text' }>,
): { text: string; html: string } | null {
  const doc = editor.getState().doc;
  const flat = flattenDoc(doc);
  const ia = flat.indexOf(sel.anchor.blockId);
  const ib = flat.indexOf(sel.focus.blockId);
  if (ia === -1 || ib === -1) return null;
  const [startId, endId] = ia <= ib ? [sel.anchor, sel.focus] : [sel.focus, sel.anchor];
  const startIdx = flat.indexOf(startId.blockId);
  const endIdx = flat.indexOf(endId.blockId);
  if (startIdx === -1 || endIdx === -1) return null;

  const textParts: string[] = [];
  const htmlParts: string[] = [];
  for (let i = startIdx; i <= endIdx; i++) {
    const id = flat[i]!;
    const block = doc.blocks.get(id);
    if (!block) continue;
    const textLen = inlineText(block.content).length;
    let lo = 0;
    let hi = textLen;
    if (i === startIdx) lo = Math.min(startId.offset, textLen);
    if (i === endIdx) hi = Math.min(endId.offset, textLen);
    if (lo > hi) [lo, hi] = [hi, lo];
    const [, rest1] = splitInline(block.content, lo);
    const [selected] = splitInline(rest1, hi - lo);
    textParts.push(inlineText(selected));
    htmlParts.push(inlineToHtml(selected));
  }
  return { text: textParts.join('\n'), html: htmlParts.join('<br>') };
}

function onCopy(e: ClipboardEvent): void {
  const sel = editor.getState().selection;
  if (sel.kind !== 'text' || !isCrossBlockText(sel)) return;
  const data = serializeCrossBlockSelection(sel);
  if (!data) return;
  e.preventDefault();
  e.clipboardData?.setData('text/plain', data.text);
  e.clipboardData?.setData('text/html', data.html);
}

function onCut(e: ClipboardEvent): void {
  // Read-only: cutting would delete content — block it entirely.
  if (!editableRef.value) {
    e.preventDefault();
    return;
  }
  const sel = editor.getState().selection;
  if (sel.kind !== 'text' || !isCrossBlockText(sel)) return;
  const data = serializeCrossBlockSelection(sel);
  if (!data) return;
  e.preventDefault();
  e.clipboardData?.setData('text/plain', data.text);
  e.clipboardData?.setData('text/html', data.html);
  // Delete the selected range via the backspace command.
  editor.commands.backspace?.();
}

// --- Ordered-list marker click menu -------------------------------------

function onOlMarkerClick(e: Event): void {
  // Read-only: clicking the ordered-list number must not open its menu.
  if (!editableRef.value) return;
  const detail = (e as CustomEvent).detail as { blockId?: BlockId; anchor?: HTMLElement } | undefined;
  if (!detail?.blockId || !detail?.anchor) return;
  const bid = detail.blockId;
  const doc = editor.getState().doc;
  const self = doc.blocks.get(bid);
  const prev = blockBefore(doc, bid);
  const hasStartNumber = typeof (self?.attrs as { startNumber?: unknown }).startNumber === 'number';
  // "Continue previous" is only meaningful if the block has a custom
  // startNumber to remove AND the previous block is an ordered-list item.
  const canContinue = hasStartNumber && !!prev && prev.type === 'orderedList';
  const num = orderedListNumber(doc, bid);
  // "Start new list" sets startNumber=1; no-op if the ordinal is already 1.
  const canStartNew = num !== 1;

  closePlusMenu();
  closeSettingsMenu();
  closeNumberPicker();
  closeLinkPopover();
  hoverToolbar.visible = false;
  olMenu.visible = true;
  olMenu.blockId = bid;
  olMenu.anchor = detail.anchor;
  olMenu.canContinue = canContinue;
  olMenu.canStartNew = canStartNew;
  olMenu.currentNumber = num;
}

function closeOlMenu(): void {
  olMenu.visible = false;
  olMenu.anchor = null;
  olMenu.blockId = null;
}

function onOlContinue(): void {
  if (!olMenu.blockId) return;
  // Clear any explicit startNumber override so the block auto-continues.
  editor.commands.setStartNumber?.({ id: olMenu.blockId, startNumber: null });
  closeOlMenu();
}

function onOlStartNew(): void {
  if (!olMenu.blockId) return;
  editor.commands.setStartNumber?.({ id: olMenu.blockId, startNumber: 1 });
  closeOlMenu();
}

function onOlModify(value: number): void {
  if (!olMenu.blockId) return;
  const anchorEl = olMenu.anchor;
  const blockId = olMenu.blockId;
  // Close the menu first, then open the number picker.
  closeOlMenu();
  if (!anchorEl) return;
  numberPicker.visible = true;
  numberPicker.initialValue = value;
  numberPicker.anchor = anchorEl;
  numberPicker.blockId = blockId;
}

function closeNumberPicker(): void {
  numberPicker.visible = false;
  numberPicker.anchor = null;
  numberPicker.blockId = null;
}

function onNumberPickerConfirm(value: number): void {
  if (!numberPicker.blockId) {
    closeNumberPicker();
    return;
  }
  editor.commands.setStartNumber?.({ id: numberPicker.blockId, startNumber: value });
  closeNumberPicker();
  closeOlMenu();
}

// --- Code-block language label click menu ----------------------------------

function onCodeLangClick(e: Event): void {
  // Read-only: clicking the code language label must not open its picker.
  if (!editableRef.value) return;
  const detail = (e as CustomEvent).detail as { blockId?: BlockId; anchor?: HTMLElement } | undefined;
  if (!detail?.blockId || !detail?.anchor) return;
  const bid = detail.blockId;
  const doc = editor.getState().doc;
  const self = doc.blocks.get(bid);
  if (!self) return;
  const lang = (self.attrs.language as string) ?? 'plain';

  closePlusMenu();
  closeSettingsMenu();
  closeNumberPicker();
  closeOlMenu();
  closeLinkPopover();
  hoverToolbar.visible = false;
  codeLangPicker.visible = true;
  codeLangPicker.blockId = bid;
  codeLangPicker.anchor = detail.anchor;
  codeLangPicker.initialValue = lang;
}

function closeCodeLangPicker(): void {
  codeLangPicker.visible = false;
  codeLangPicker.anchor = null;
  codeLangPicker.blockId = null;
}

function onCodeLangPickerConfirm(value: string): void {
  if (!codeLangPicker.blockId) {
    closeCodeLangPicker();
    return;
  }
  editor.commands.setAttrs?.({ id: codeLangPicker.blockId, attrs: { language: value } });
  closeCodeLangPicker();
}

// Close ol-menu / number picker / code-lang picker / link-popover on outside click or touch.
function onWindowOutsideDown(e: Event): void {
  const target = e.target as Node;
  // OrderedListMenu + NumberPicker + CodeLangPicker + LinkPopover are teleported to body.
  const olMenuEl = document.querySelector('.ordered-list-menu');
  const npEl = document.querySelector('.number-picker');
  const clpEl = document.querySelector('.code-lang-picker');
  const lpEl = document.querySelector('.link-popover');
  if (olMenuEl && olMenuEl.contains(target)) return;
  if (npEl && npEl.contains(target)) return;
  if (clpEl && clpEl.contains(target)) return;
  if (lpEl && lpEl.contains(target)) return;
  // Clicked on an ordered-list marker? Let the bubbled CustomEvent open it.
  if (target instanceof Node && (target as HTMLElement).closest?.('.ol-marker')) return;
  // Clicked on a code-block language label? Let the bubbled CustomEvent open it.
  if (target instanceof Node && (target as HTMLElement).closest?.('.block-code-lang')) return;
  // Clicked on an inline <a> (link mark)? The bubbled CustomEvent decides.
  if (target instanceof Node && (target as HTMLElement).closest?.('a[href]')) return;
  // Otherwise close all.
  closeOlMenu();
  closeNumberPicker();
  closeCodeLangPicker();
  closeLinkPopover();
  // Clicking outside the editor, or on editor whitespace, drops any active
  // block selection (e.g. a selected image block). Clicks inside an editable
  // region or a block body are left to their own handlers — selectionchange
  // adopts the caret for text blocks, and image/table/code blocks re-select
  // via their own click handlers.
  const stateSel = editor.getState().selection;
  if (stateSel.kind === 'blocks' && stateSel.blockIds.length > 0) {
    const root = rootEl.value;
    if (root && root.contains(target)) {
      const el = target.nodeType === 1 ? (target as HTMLElement) : (target.parentElement ?? null);
      if (el) {
        if (el.closest('[contenteditable]')) return;
        if (el.closest(
          '.block-image-wrapper, .block-image-container, .block-table-container, '
          + '.block-code-wrapper, .block-divider, .block-todo-checkbox, '
          + '.block-ordered-list-wrapper, .block-video, .block-file, .block-embed, .block-callout',
        )) return;
      }
    }
    editor.commands.clearSelection?.();
  }
}

// Close ol-menu / number picker / code-lang picker / link-popover on page
// scroll or touch-move (swipe). These popups are positioned relative to the
// viewport, so they go stale the moment the page scrolls.
// NOTE: scroll/touch events that originate INSIDE one of the popups (their
// own list scrolling, wheel-to-list scrolling, or touch dragging over the
// menu) are ignored — the scroll event of an inner overflow element still
// reaches this window-capture listener, and must not close the menu itself.
function onScrollOrTouchClose(e: Event): void {
  const target = e.target;
  if (target instanceof Element) {
    const insidePopup
      = target.closest('.code-lang-picker')
        || target.closest('.ordered-list-menu')
        || target.closest('.number-picker')
        || target.closest('.link-popover');
    if (insidePopup) return;
  }
  if (olMenu.visible) closeOlMenu();
  if (numberPicker.visible) closeNumberPicker();
  if (codeLangPicker.visible) closeCodeLangPicker();
  if (linkPopover.visible) closeLinkPopover();
}

// Escape drops any active block selection (image/table/code blocks have no
// caret to hold it). Bound on document capture because after clicking such a
// block the focus may sit outside the editor root, where the template-level
// @keydown would never fire. We deliberately do NOT stopPropagation: an open
// menu (e.g. settings) may also want to react to Escape and close itself.
function onGlobalKeyDown(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return;
  const stateSel = editor.getState().selection;
  if (stateSel.kind === 'blocks' && stateSel.blockIds.length > 0) {
    e.preventDefault();
    editor.commands.clearSelection?.();
  }
}

// --- Block-level focus via click delegation -----------------------------
//
// 非文本块（图片/分隔符/TOC/表格/代码等）没有 contenteditable 光标，
// 所以靠"点击"来获得块级 focus。为了避免每个扩展各自绑定 click 事件，
// 用事件委托统一处理：只要 renderer 的根元素有 .block-focus-root 类，
// 点击后就会把该块设为 focused；同时清除原生文本选区，避免出现
// "P1 有光标 + P3 图片有蓝框"的双焦点信号。
//
// 空白点击（直接点击 editor 根元素，即 padding 区域）：清空 focus。

function onBlockRootClick(e: MouseEvent): void {
  const target = e.target as HTMLElement | null;
  if (!target) return;
  if (target.closest('.block-handle')) return;
  // Clicks inside a contenteditable text region (e.g. the code block's
  // .block-code) must NOT clear the native selection: the contenteditable
  // owns its own caret. Clearing it here is what makes the caret vanish
  // the instant the mouse is released. The same applies to the Equation
  // block's LaTeX <textarea> — it is a real text-editing surface (tagged
  // with [data-equation-edit]) and must keep its caret/selection.
  if (target.closest('[contenteditable="true"]')) return;
  if (target.closest('[data-equation-edit]')) return;
  const focusRoot = target.closest('.block-focus-root');
  if (!focusRoot) return;
  const host = (focusRoot as HTMLElement).closest('.block-host');
  if (!host) return;
  const root = rootEl.value;
  if (!root || !root.contains(host)) return;
  const blockId = host.getAttribute('data-block-id') as BlockId | null;
  if (!blockId) return;
  setFocusedBlock(blockId, { clearNativeSelection: true });
}

function onEditorBlankClick(e: MouseEvent): void {
  if (e.target === rootEl.value) {
    setFocusedBlock(null, { clearNativeSelection: true });
  }
}

// --- Lifecycle ----------------------------------------------------------

onMounted(() => {
  nextTick(() => {
    const root = rootEl.value;
    if (!root) return;
    const sel = editor.getState().selection;
    applySelectionToDom(root, sel);
    // Ordered-list marker click CustomEvent listener (captured on root).
    root.addEventListener('ordered-list-marker-click', onOlMarkerClick as unknown as (e: Event) => void);
    // Code-block language label click CustomEvent listener (captured on root).
    root.addEventListener('code-lang-click', onCodeLangClick as unknown as (e: Event) => void);
    // Non-text block click → block-level focus（事件委托）.
    root.addEventListener('click', onBlockRootClick);
    // Click on editor blank padding area → clear focus.
    root.addEventListener('click', onEditorBlankClick);
  });
  document.addEventListener('selectionchange', onDocumentSelectionChange);
  document.addEventListener('mousedown', onMouseDown, true);
  document.addEventListener('mouseup', onMouseUp, true);
  // Outside-click/touch close for ordered-list menu / number picker / code-lang picker.
  document.addEventListener('mousedown', onWindowOutsideDown, true);
  document.addEventListener('touchstart', onWindowOutsideDown, true);
  // Capture phase so we refresh the rect before the HoverToolbar's own
  // scroll handler repositions — the toolbar then reads a fresh rect.
  window.addEventListener('scroll', refreshHoverToolbarRect, true);
  window.addEventListener('resize', refreshHoverToolbarRect);
  // Close ol-menu / number picker / code-lang picker on scroll or touch swipe.
  window.addEventListener('scroll', onScrollOrTouchClose, true);
  document.addEventListener('touchmove', onScrollOrTouchClose, { passive: true, capture: true });
  // Escape drops any active block selection, even when focus is outside the root.
  document.addEventListener('keydown', onGlobalKeyDown, true);
  // Mobile detection listener. The MQL was created synchronously in setup
  // so the initial render already has the correct value; here we just
  // subscribe to changes (e.g. iPad user toggles pointer settings).
  mobileMql?.addEventListener('change', updateMobile);
  // Mobile cross-block selection: touchstart intercepts long-press so we can
  // build selections spanning contenteditable blocks (native selection cannot).
  document.addEventListener('touchstart', onTouchStart, { passive: false, capture: true });
});

onBeforeUnmount(() => {
  const root = rootEl.value;
  if (root) {
    root.removeEventListener('ordered-list-marker-click', onOlMarkerClick as unknown as (e: Event) => void);
    root.removeEventListener('code-lang-click', onCodeLangClick as unknown as (e: Event) => void);
    root.removeEventListener('click', onBlockRootClick);
    root.removeEventListener('click', onEditorBlankClick);
  }
  document.removeEventListener('selectionchange', onDocumentSelectionChange);
  document.removeEventListener('mousedown', onMouseDown, true);
  document.removeEventListener('mouseup', onMouseUp, true);
  document.removeEventListener('mousedown', onWindowOutsideDown, true);
  document.removeEventListener('touchstart', onWindowOutsideDown, true);
  window.removeEventListener('scroll', refreshHoverToolbarRect, true);
  window.removeEventListener('resize', refreshHoverToolbarRect);
  window.removeEventListener('scroll', onScrollOrTouchClose, true);
  document.removeEventListener('touchmove', onScrollOrTouchClose, true);
  document.removeEventListener('keydown', onGlobalKeyDown, true);
  mobileMql?.removeEventListener('change', updateMobile);
  document.removeEventListener('touchstart', onTouchStart, true);
  // Clean up any in-flight mobile selection listeners.
  document.removeEventListener('touchmove', onTouchMove, true);
  document.removeEventListener('touchend', onTouchEnd, true);
  document.removeEventListener('touchcancel', onTouchEnd, true);
  unsubscribe();
  editor.destroy();
  // Image upload side-channel cleanup.
  _unsubUpload();
  clearAllUploadStates();
  revokeAllTempUrls();
});

defineExpose({ editor });
</script>
