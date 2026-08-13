<!--
  CodeLangPicker: a dropdown menu listing preset code languages.
  Used when the user clicks the language label of a code block.

  Positioning follows the SAME logic as the hover-toolbar block-type
  dropdown (HoverToolbar.vue / positionActiveDropdown):
    - Natural height is read via `scrollHeight` (immune to max-height
      clamping, no layout-timing hacks).
    - Direction: pop DOWN by default; flip ABOVE when the natural height
      does not fit below and there is more (or equal) space above; force
      ABOVE when the anchor sits near the editor root's bottom edge and
      there is plenty of room above.
    - The rendered height is clamped to [120, 360] px.
    - Coordinates are viewport-relative (Teleport to <body>, position:fixed).

  Scrolling follows the shared editor-menu pattern (useMenuScroll + up/down
  buttons, no native scrollbar) — identical to the hover-toolbar dropdowns:
    - Up/down arrow buttons appear at the top/bottom of the list when the
      content overflows.
    - Wheel & touch drags inside the list are converted to list scrolling
      and `preventDefault`ed, so the page itself never scrolls while the
      pointer is over the menu (the menu no longer disappears on wheel).

  A "自定义… / Custom…" entry at the bottom opens an inline input for
  arbitrary letter-only language names (backward-compatible with the old
  text-input picker).
-->

<template>
  <Teleport to="body">
    <div
      v-if="visible && anchor && rootEl"
      ref="menuEl"
      class="code-lang-picker"
      :class="{ above: placement.above }"
      :style="menuStyle"
      role="menu"
      :aria-label="t('codeLang.title')"
      @mousedown.stop
      @touchstart.stop
      @wheel.prevent
      @touchmove.prevent
    >
      <!-- Custom language input mode -->
      <div
        v-if="customMode"
        class="clp-custom"
      >
        <form
          class="clp-form"
          @submit.prevent="onConfirmCustom"
        >
          <input
            ref="inputEl"
            v-model="draftValue"
            type="text"
            class="clp-input"
            maxlength="20"
            :placeholder="t('codeLang.placeholder')"
            :aria-label="t('codeLang.inputLabel')"
            autocomplete="off"
            spellcheck="false"
            @input="onInput"
            @keydown.escape="closeCustom"
          >
          <!-- Buttons below the input, right-aligned (mirrors the link
               edit bar: .link-popover-edit-actions) -->
          <div class="clp-actions">
            <button
              class="clp-ok"
              type="submit"
            >
              {{ t('codeLang.confirm') }}
            </button>
            <button
              class="clp-cancel"
              type="button"
              @click="closeCustom"
            >
              {{ t('codeLang.cancel') }}
            </button>
          </div>
        </form>
      </div>

      <!-- Preset language list (shared up/down scroll buttons, no scrollbar) -->
      <template v-else>
        <button
          v-if="canScrollUp"
          class="menu-scroll-btn menu-scroll-up"
          type="button"
          :aria-label="t('ui.scrollUp')"
          @mousedown.prevent="scrollUp"
        >
          <svg
            viewBox="0 0 12 12"
            width="10"
            height="10"
            aria-hidden="true"
          >
            <path
              d="M3 7.5L6 4.5L9 7.5"
              stroke="currentColor"
              stroke-width="1.5"
              fill="none"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>
        <div
          ref="scrollEl"
          class="clp-list"
          @scroll="updateScrollState"
        >
          <button
            v-for="lang in LANGUAGES"
            :key="lang"
            class="clp-item"
            :class="{ active: lang === currentLang }"
            role="menuitem"
            @click="emit('confirm', lang)"
          >
            <span class="clp-item-name">{{ labelFor(lang) }}</span>
            <span
              v-if="lang === currentLang"
              class="clp-item-check"
              aria-hidden="true"
            >✓</span>
          </button>
          <button
            class="clp-item clp-item-custom"
            role="menuitem"
            @click="openCustom"
          >
            <span class="clp-item-name">{{ t('codeLang.custom') }}</span>
          </button>
        </div>
        <button
          v-if="canScrollDown"
          class="menu-scroll-btn menu-scroll-down"
          type="button"
          :aria-label="t('ui.scrollDown')"
          @mousedown.prevent="scrollDown"
        >
          <svg
            viewBox="0 0 12 12"
            width="10"
            height="10"
            aria-hidden="true"
          >
            <path
              d="M3 4.5L6 7.5L9 4.5"
              stroke="currentColor"
              stroke-width="1.5"
              fill="none"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>
      </template>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useI18n } from '../../i18n';
import { useMenuScroll } from './useMenuScroll';

const props = defineProps<{
  visible: boolean;
  initialValue: string;
  /** Anchor element (e.g. the code-block language label). */
  anchor: HTMLElement | null;
  rootEl: HTMLElement | null;
}>();

const emit = defineEmits<{
  confirm: [value: string];
  close: [];
}>();

const { t } = useI18n();

/** Preset languages shown in the dropdown (plain = no explicit language). */
const LANGUAGES: readonly string[] = [
  'plain', 'javascript', 'typescript', 'python', 'java', 'c', 'cpp',
  'csharp', 'go', 'rust', 'ruby', 'php', 'swift', 'kotlin', 'html',
  'css', 'json', 'xml', 'yaml', 'markdown', 'lua',
  // Command / script shells
  'bash', 'shell', 'powershell', 'cmd', 'bat',
  'sql', 'dart',
];

const menuEl = ref<HTMLElement | null>(null);
const inputEl = ref<HTMLInputElement | null>(null);
const scrollEl = ref<HTMLElement | null>(null);
const customMode = ref(false);
const draftValue = ref<string>('');
const currentLang = ref<string>(props.initialValue);
const placement = ref({ top: 0, left: 0, above: false, maxHeight: 360 });
const MARGIN = 6;
const NEAR_BOTTOM_THRESHOLD = 200; // px — anchor within this distance of the root bottom is "near"
const MENU_MIN_HEIGHT = 120;
const MENU_MAX_HEIGHT = 360;
const canScrollUp = ref(false);
const canScrollDown = ref(false);

function labelFor(lang: string): string {
  return lang === 'plain' ? t('codeLang.plain') : lang;
}

/**
 * Position the menu relative to the anchor, mirroring the hover-toolbar
 * block-type dropdown (HoverToolbar.vue positionActiveDropdown):
 *
 *   1. Natural height = the menu's full content `scrollHeight` (immune to
 *      max-height clamping — no need to wait a frame for layout).
 *   2. Direction: pop DOWN by default; if the natural height does not fit
 *      below, pop UP when there is more (or equal) space above.
 *      EXTRA RULE: when the anchor sits close to the editor root's bottom
 *      edge AND there is plenty of space above, force the menu UP — even
 *      if some room remains below.
 *   3. Rendered height is clamped to [120, 360].
 *   4. When popping UP, the menu's bottom edge hugs the anchor's top edge
 *      (equivalent to the hover-toolbar's `bottom: calc(100% + 6px)`).
 */
function positionMenu(): void {
  if (!props.visible || !props.anchor || !props.rootEl) return;
  const el = menuEl.value;
  if (!el) return;
  const anchorRect = props.anchor.getBoundingClientRect();
  const viewportH = window.innerHeight;
  const spaceBelow = Math.floor(viewportH - anchorRect.bottom - MARGIN);
  const spaceAbove = Math.floor(anchorRect.top - MARGIN);
  const natural = el.scrollHeight;

  // Extra rule: anchor near the root's bottom edge + lots of space above → force up.
  let forceAbove = false;
  const rootRect = props.rootEl.getBoundingClientRect();
  const distToContainerBottom = rootRect.bottom - anchorRect.bottom;
  if (distToContainerBottom < NEAR_BOTTOM_THRESHOLD && spaceAbove > NEAR_BOTTOM_THRESHOLD) {
    forceAbove = true;
  }

  let above: boolean;
  let maxH: number;
  if (forceAbove) {
    above = true;
    maxH = spaceAbove;
  } else if (natural <= spaceBelow) {
    above = false;
    maxH = spaceBelow;
  } else if (spaceAbove > spaceBelow) {
    above = true;
    maxH = spaceAbove;
  } else {
    above = false;
    maxH = spaceBelow;
  }
  const maxHeight = Math.max(MENU_MIN_HEIGHT, Math.min(maxH, MENU_MAX_HEIGHT));

  const vw = document.documentElement.clientWidth;
  const width = Math.max(el.clientWidth, 200);
  const left = Math.max(MARGIN, Math.min(vw - width - MARGIN, anchorRect.left));
  const top = above
    ? Math.max(MARGIN, anchorRect.top - MARGIN - Math.min(natural, maxHeight))
    : anchorRect.bottom + MARGIN;

  placement.value = { top, left, above, maxHeight };
  nextTick(updateScrollState);
}

watch(
  [() => props.visible, () => props.anchor, () => props.initialValue],
  async () => {
    if (!props.visible) return;
    customMode.value = false;
    currentLang.value = props.initialValue ?? 'plain';
    draftValue.value = currentLang.value === 'plain' ? '' : currentLang.value;
    await nextTick();
    positionMenu();
  },
  { flush: 'post', immediate: true },
);

// --- Scroll state (shared up/down buttons, no native scrollbar) ----------

function updateScrollState(): void {
  const el = scrollEl.value;
  if (!el) return;
  canScrollUp.value = el.scrollTop > 1;
  canScrollDown.value = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
}

function scrollUp(): void {
  const el = scrollEl.value;
  if (!el) return;
  el.scrollTop -= el.clientHeight * 0.8;
}

function scrollDown(): void {
  const el = scrollEl.value;
  if (!el) return;
  el.scrollTop += el.clientHeight * 0.8;
}

// Wheel + touch scroll support on the list. Wheel deltas are translated to
// list scrolling and preventDefault'ed, so the page never scrolls (and the
// menu never closes) while the pointer is over the menu.
useMenuScroll(scrollEl, updateScrollState);

function openCustom(): void {
  customMode.value = true;
  draftValue.value = currentLang.value === 'plain' ? '' : currentLang.value;
  nextTick(() => {
    inputEl.value?.focus();
    inputEl.value?.select();
    positionMenu();
  });
}

function closeCustom(): void {
  customMode.value = false;
  nextTick(positionMenu);
}

/** Only letters (a-z, A-Z) — strip everything else. */
function onInput(): void {
  const cleaned = draftValue.value.replace(/[^a-zA-Z]/g, '').slice(0, 20);
  if (cleaned !== draftValue.value) {
    draftValue.value = cleaned;
  }
}

function onConfirmCustom(): void {
  const v = (draftValue.value ?? '').replace(/[^a-zA-Z]/g, '').slice(0, 20);
  // 空值 → plain
  emit('confirm', v.length === 0 ? 'plain' : v);
}

const menuStyle = computed(() => ({
  top: `${placement.value.top}px`,
  left: `${placement.value.left}px`,
  maxHeight: `${placement.value.maxHeight}px`,
}));
</script>
