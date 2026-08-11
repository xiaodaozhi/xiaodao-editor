<!--
  LinkPopover: floating popover for viewing, editing, copying, and deleting
  link marks. Similar to Notion's link editor.

  Two modes:
    - "view": shows the URL with actions (open, copy, edit, delete)
    - "edit": shows URL input + text input with save/cancel

  Triggered by:
    - Ctrl/Cmd+K when text is selected (or cursor is in a link)
    - Clicking a link in the block content
    - Clicking the link button in HoverToolbar
-->

<template>
  <Teleport to="body">
    <div
      v-if="shouldRender"
      ref="popoverEl"
      class="link-popover"
      :class="{ visible: positioned }"
      :style="popoverStyle"
      role="dialog"
      :aria-label="t('link.popoverLabel')"
    >
      <!-- View mode -->
      <div v-if="mode === 'view'" class="link-popover-view">
        <a
          :href="safeHref"
          target="_blank"
          rel="noopener noreferrer"
          class="link-popover-url"
          :title="currentHref"
          @click="onOpenLink"
        >
          {{ displayUrl }}
        </a>
        <div class="link-popover-actions">
          <button
            class="link-popover-btn"
            :title="t('link.open')"
            :aria-label="t('link.open')"
            @mousedown.prevent.stop="onOpenLink"
          >
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <path
                d="M6 3H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2v-2"
                fill="none"
                stroke="currentColor"
                stroke-width="1.3"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
              <path
                d="M9 3h4v4M13 3L7 9"
                fill="none"
                stroke="currentColor"
                stroke-width="1.3"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </button>
          <button
            class="link-popover-btn"
            :title="t('link.copy')"
            :aria-label="t('link.copy')"
            @mousedown.prevent.stop="onCopyLink"
          >
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <rect
                x="5"
                y="5"
                width="8"
                height="8"
                rx="1.5"
                fill="none"
                stroke="currentColor"
                stroke-width="1.3"
              />
              <path
                d="M3 10.5V3.5C3 2.67 3.67 2 4.5 2H10"
                fill="none"
                stroke="currentColor"
                stroke-width="1.3"
                stroke-linecap="round"
              />
            </svg>
          </button>
          <button
            class="link-popover-btn"
            :title="t('link.edit')"
            :aria-label="t('link.edit')"
            @mousedown.prevent.stop="switchToEdit"
          >
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <path
                d="M11.5 2.5l2 2L6 12l-2.5.5L4 10l7.5-7.5z"
                fill="none"
                stroke="currentColor"
                stroke-width="1.3"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </button>
          <button
            class="link-popover-btn link-popover-danger"
            :title="t('link.remove')"
            :aria-label="t('link.remove')"
            @mousedown.prevent.stop="onRemoveLink"
          >
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <path
                d="M3.5 4.5H12.5M6.5 4.5V3C6.5 2.45 6.95 2 7.5 2H8.5C9.05 2 9.5 2.45 9.5 3V4.5M5 4.5L5.5 13C5.55 13.55 6 14 6.55 14H9.45C10 14 10.45 13.55 10.5 13L11 4.5"
                fill="none"
                stroke="currentColor"
                stroke-width="1.2"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>
      <!-- Edit mode -->
      <div v-else class="link-popover-edit">
        <input
          ref="urlInputEl"
          v-model="editUrl"
          class="link-popover-input"
          type="text"
          :placeholder="t('link.urlPlaceholder')"
          @keydown.enter="onSave"
          @keydown.escape="onCancelEdit"
        />
        <input
          v-if="showTextInput"
          v-model="editText"
          class="link-popover-input"
          type="text"
          :placeholder="t('link.textPlaceholder')"
          @keydown.enter="onSave"
          @keydown.escape="onCancelEdit"
        />
        <div class="link-popover-edit-actions">
          <button
            class="link-popover-btn link-popover-save"
            :title="t('link.save')"
            @mousedown.prevent.stop="onSave"
          >
            {{ t('link.save') }}
          </button>
          <button
            class="link-popover-btn link-popover-cancel"
            :title="t('link.cancel')"
            @mousedown.prevent.stop="onCancelEdit"
          >
            {{ t('link.cancel') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, computed, onBeforeUnmount } from 'vue';
import { useEditor } from '../context';
import { useI18n } from '../../i18n';
import { useMenuDismiss } from './useMenuDismiss';
import { sanitizeUrl, normalizeUrl } from '../urlUtils';
import type { BlockId } from '../../core/types';

type PopoverMode = 'view' | 'edit';

const props = defineProps<{
  visible: boolean;
  /** Viewport-relative rect of the link text (for positioning). */
  anchorRect: DOMRect | null;
  /** The block containing the link. */
  blockId: BlockId | null;
  /** Character offset where the link starts. */
  from: number;
  /** Character offset where the link ends. */
  to: number;
  /** Current href (empty if creating a new link). */
  href: string;
  /** Current link text (empty if creating a new link). */
  text: string;
  /** Whether to open in edit mode immediately (e.g. when creating a new link). */
  initialMode?: PopoverMode;
  /** Whether to show the text input field (hide when editing from Ctrl+K on selection). */
  showTextInput?: boolean;
}>();

const emit = defineEmits<{
  close: [];
}>();

const { t } = useI18n();
const editor = useEditor();

const popoverEl = ref<HTMLElement | null>(null);
const urlInputEl = ref<HTMLInputElement | null>(null);
const shouldRender = ref(false);
const positioned = ref(false);
const mode = ref<PopoverMode>('view');
const editUrl = ref('');
const editText = ref('');
const placement = ref({ top: 0, left: 0 });

const showTextInput = computed(() => props.showTextInput ?? false);

const currentHref = computed(() => {
  if (mode.value === 'edit') return editUrl.value;
  return props.href;
});

const safeHref = computed(() => {
  const normalized = normalizeUrl(currentHref.value);
  return sanitizeUrl(normalized) ?? '#';
});

const displayUrl = computed(() => {
  const url = currentHref.value;
  if (!url) return t('link.emptyUrl');
  // Truncate long URLs for display.
  return url.length > 60 ? url.slice(0, 57) + '...' : url;
});

// --- Positioning ---

const popoverStyle = computed(() => ({
  top: `${placement.value.top}px`,
  left: `${placement.value.left}px`,
  visibility: positioned.value ? ('visible' as const) : ('hidden' as const),
}));

async function updatePosition(): Promise<void> {
  if (!props.visible || !props.anchorRect || !popoverEl.value) return;
  await nextTick();
  const el = popoverEl.value;
  const rect = el.getBoundingClientRect();
  const margin = 8;
  const viewportW = document.documentElement.clientWidth;
  const viewportH = document.documentElement.clientHeight;

  // Position below the anchor (or above if no space below).
  const spaceBelow = viewportH - props.anchorRect.bottom - margin;
  const spaceAbove = props.anchorRect.top - margin;
  const above = spaceBelow < rect.height + margin && spaceAbove > spaceBelow;

  const top = above
    ? Math.max(margin, props.anchorRect.top - rect.height - margin)
    : props.anchorRect.bottom + margin;

  // Center horizontally on the anchor.
  const centerLeft = props.anchorRect.left + (props.anchorRect.width - rect.width) / 2;
  const maxLeft = Math.max(margin, viewportW - rect.width - margin);
  const left = Math.max(margin, Math.min(maxLeft, centerLeft));

  placement.value = { top, left };
  positioned.value = true;
}

// --- Lifecycle ---

watch(
  () => props.visible,
  (v) => {
    if (v) {
      shouldRender.value = true;
      mode.value = props.initialMode ?? (props.href ? 'view' : 'edit');
      editUrl.value = props.href;
      editText.value = props.text;
      positioned.value = false;
      nextTick(() => {
        updatePosition();
        if (mode.value === 'edit') {
          urlInputEl.value?.focus();
          urlInputEl.value?.select();
        }
      });
    } else {
      positioned.value = false;
      // Delay unmount to let fade-out animation play.
      setTimeout(() => {
        if (!props.visible) shouldRender.value = false;
      }, 200);
    }
  },
  { immediate: true },
);

watch(
  () => props.anchorRect,
  () => {
    if (props.visible) updatePosition();
  },
);

// --- Auto-dismiss ---

useMenuDismiss(popoverEl, () => props.visible, () => emit('close'));

// --- Actions ---

function switchToEdit(): void {
  mode.value = 'edit';
  editUrl.value = props.href;
  editText.value = props.text;
  nextTick(() => {
    urlInputEl.value?.focus();
    urlInputEl.value?.select();
  });
}

function onSave(): void {
  if (!props.blockId) return;
  const normalized = normalizeUrl(editUrl.value);
  const safe = sanitizeUrl(normalized);
  if (!safe) {
    // Invalid URL — focus the input and keep the popover open.
    urlInputEl.value?.focus();
    return;
  }

  // If we have text input and it changed, update the link text too.
  const hasTextChange = showTextInput.value && editText.value !== props.text;

  editor.commands.setLink?.({
    id: props.blockId,
    href: safe,
    from: props.from,
    to: props.to,
    text: hasTextChange ? editText.value : undefined,
  });

  // After saving, switch to view mode (or close if the popover was for creation).
  if (props.href) {
    // Was editing an existing link — switch to view mode.
    mode.value = 'view';
    // Update props-like state from the command result.
    nextTick(() => {
      updatePosition();
    });
  } else {
    // Was creating a new link — close the popover.
    emit('close');
  }
}

function onCancelEdit(): void {
  if (props.href) {
    // Was editing an existing link — go back to view mode.
    mode.value = 'view';
    editUrl.value = props.href;
    editText.value = props.text;
  } else {
    // Was creating a new link — close.
    emit('close');
  }
}

function onRemoveLink(): void {
  if (!props.blockId) return;
  editor.commands.unsetLink?.({
    id: props.blockId,
    from: props.from,
    to: props.to,
  });
  emit('close');
}

function onCopyLink(): void {
  const url = normalizeUrl(props.href);
  if (url) {
    void navigator.clipboard?.writeText(url);
  }
  // Brief visual feedback could be added here.
}

function onOpenLink(): void {
  const url = normalizeUrl(props.href);
  const safe = sanitizeUrl(url);
  if (safe && safe !== '#') {
    window.open(safe, '_blank', 'noopener,noreferrer');
  }
}

// Clean up on unmount.
onBeforeUnmount(() => {
  shouldRender.value = false;
});

// Expose for parent keyboard handling.
defineExpose({
  isEditing: () => mode.value === 'edit',
  save: onSave,
  cancel: onCancelEdit,
});
</script>
