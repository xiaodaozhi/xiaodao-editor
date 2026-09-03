<!--
  BlockSettingsMenu (opened by clicking the ⋮⋮ grip on the left handle):

  Organized into sections:
    1. Turn into    – Text, H1-H6, Bullet/Ordered/Todo list, Quote, Code
    2. Align        – Left / Center / Right / Justify
    3. Color        – Text color presets + Background color presets (swatches)
    4. Actions      – Duplicate, Move up/down, Cut, Copy, Delete
-->

<template>
  <Teleport to="body">
    <div
      v-if="shouldRender && rootEl"
      ref="menuEl"
      class="block-settings-menu"
      :class="{ 'menu-closing': !visible }"
      :style="menuStyle"
      role="menu"
    >
      <!-- Up scroll button -->
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
      <!-- Scrollable content area -->
      <div
        ref="scrollEl"
        class="bsm-scroll"
        @scroll="updateScrollState"
      >
        <!-- 1. Turn into (no label) — hidden for non-text blocks like image/table/divider,
             and for the equation block (equations can't be converted to other blocks). -->
        <template v-if="!isImageBlock && !isDividerBlock && !isEquationBlock">
          <div class="bsm-group">
            <div class="bsm-icon-grid">
              <button
                v-for="it in turnIntoActions"
                :key="it.id"
                class="bsm-icon-cell"
                :class="{ active: isActive(it.id) }"
                :title="it.title"
                role="menuitem"
                @mousedown.prevent="onPick(it)"
                @mouseenter="activeId = it.id"
              >
                <SafeHtml
                  class="bsm-icon-svg"
                  :html="it.iconHtml"
                />
              </button>
            </div>
          </div>
          <div class="bsm-sep" />
        </template>

        <!-- 2. Align & Indent (collapsible) — hidden for divider/table -->
        <div
          v-if="!hideAlignSection"
          class="bsm-group"
        >
          <button
            class="bsm-collapse-header"
            :class="{ 'bsm-disabled': alignDisabled && !canIndent, 'expanded': expandedSections.alignIndent }"
            role="menuitem"
            @mousedown.prevent="toggleSection('alignIndent')"
          >
            <span class="bsm-collapse-title">{{ t('bsm.section.alignIndent') }}</span>
            <svg
              class="bsm-collapse-chevron"
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
          <div
            v-show="expandedSections.alignIndent"
            class="bsm-collapse-body"
          >
            <div class="bsm-row">
              <button
                v-for="a in alignActions"
                :key="a.id"
                class="bsm-icon-btn"
                :class="{ 'active': !alignDisabled && align === a.value, 'bsm-disabled': alignDisabled }"
                :disabled="alignDisabled"
                :title="a.title"
                role="menuitem"
                @mousedown.prevent="!alignDisabled && onPick(a)"
              >
                <svg
                  viewBox="0 0 16 16"
                  width="15"
                  height="15"
                  aria-hidden="true"
                >
                  <template v-if="a.value === 'left'">
                    <line
                      x1="2"
                      y1="4"
                      x2="14"
                      y2="4"
                      stroke="currentColor"
                      stroke-width="1.3"
                      stroke-linecap="round"
                    />
                    <line
                      x1="2"
                      y1="8"
                      x2="10"
                      y2="8"
                      stroke="currentColor"
                      stroke-width="1.3"
                      stroke-linecap="round"
                    />
                    <line
                      x1="2"
                      y1="12"
                      x2="12"
                      y2="12"
                      stroke="currentColor"
                      stroke-width="1.3"
                      stroke-linecap="round"
                    />
                  </template>
                  <template v-else-if="a.value === 'center'">
                    <line
                      x1="2"
                      y1="4"
                      x2="14"
                      y2="4"
                      stroke="currentColor"
                      stroke-width="1.3"
                      stroke-linecap="round"
                    />
                    <line
                      x1="4"
                      y1="8"
                      x2="12"
                      y2="8"
                      stroke="currentColor"
                      stroke-width="1.3"
                      stroke-linecap="round"
                    />
                    <line
                      x1="3"
                      y1="12"
                      x2="13"
                      y2="12"
                      stroke="currentColor"
                      stroke-width="1.3"
                      stroke-linecap="round"
                    />
                  </template>
                  <template v-else-if="a.value === 'right'">
                    <line
                      x1="2"
                      y1="4"
                      x2="14"
                      y2="4"
                      stroke="currentColor"
                      stroke-width="1.3"
                      stroke-linecap="round"
                    />
                    <line
                      x1="6"
                      y1="8"
                      x2="14"
                      y2="8"
                      stroke="currentColor"
                      stroke-width="1.3"
                      stroke-linecap="round"
                    />
                    <line
                      x1="4"
                      y1="12"
                      x2="14"
                      y2="12"
                      stroke="currentColor"
                      stroke-width="1.3"
                      stroke-linecap="round"
                    />
                  </template>
                  <template v-else>
                    <line
                      x1="2"
                      y1="4"
                      x2="14"
                      y2="4"
                      stroke="currentColor"
                      stroke-width="1.3"
                      stroke-linecap="round"
                    />
                    <line
                      x1="2"
                      y1="8"
                      x2="14"
                      y2="8"
                      stroke="currentColor"
                      stroke-width="1.3"
                      stroke-linecap="round"
                    />
                    <line
                      x1="2"
                      y1="12"
                      x2="14"
                      y2="12"
                      stroke="currentColor"
                      stroke-width="1.3"
                      stroke-linecap="round"
                    />
                  </template>
                </svg>
              </button>
            </div>
            <div
              class="bsm-row"
            >
              <button
                class="bsm-icon-btn"
                :disabled="outdentDisabled"
                :class="{ 'bsm-disabled': outdentDisabled }"
                :title="t('bsm.indent.decrease')"
                role="menuitem"
                @mousedown.prevent="!outdentDisabled && onPick({ id: 'outdent', run: doOutdent })"
              >
                <svg
                  viewBox="0 0 1024 1024"
                  width="15"
                  height="15"
                  aria-hidden="true"
                >
                  <path
                    d="M906.666667 379.733333h-448c-17.066667 0-32 14.933333-32 32s14.933333 32 32 32h448c17.066667 0 32-14.933333 32-32s-14.933333-32-32-32zM906.666667 580.266667h-448c-17.066667 0-32 14.933333-32 32s14.933333 32 32 32h448c17.066667 0 32-14.933333 32-32s-14.933333-32-32-32zM117.333333 245.333333h789.333334c17.066667 0 32-14.933333 32-32s-14.933333-32-32-32h-789.333334C100.266667 181.333333 85.333333 196.266667 85.333333 213.333333s14.933333 32 32 32zM906.666667 778.666667h-789.333334c-17.066667 0-32 14.933333-32 32s14.933333 32 32 32h789.333334c17.066667 0 32-14.933333 32-32s-14.933333-32-32-32zM285.866667 657.066667c14.933333 8.533333 34.133333 0 34.133333-17.066667V384c0-17.066667-19.2-27.733333-34.133333-17.066667l-192 128c-12.8 8.533333-12.8 27.733333 0 36.266667l192 125.866667z"
                    fill="currentColor"
                  />
                </svg>
              </button>
              <button
                class="bsm-icon-btn"
                :disabled="indentDisabled"
                :class="{ 'bsm-disabled': indentDisabled }"
                :title="t('bsm.indent.increase')"
                role="menuitem"
                @mousedown.prevent="!indentDisabled && onPick({ id: 'indent', run: doIndent })"
              >
                <svg
                  viewBox="0 0 1024 1024"
                  width="15"
                  height="15"
                  aria-hidden="true"
                >
                  <path
                    d="M906.666667 379.733333h-448c-17.066667 0-32 14.933333-32 32s14.933333 32 32 32h448c17.066667 0 32-14.933333 32-32s-14.933333-32-32-32zM906.666667 580.266667h-448c-17.066667 0-32 14.933333-32 32s14.933333 32 32 32h448c17.066667 0 32-14.933333 32-32s-14.933333-32-32-32zM117.333333 245.333333h789.333334c17.066667 0 32-14.933333 32-32s-14.933333-32-32-32h-789.333334C100.266667 181.333333 85.333333 196.266667 85.333333 213.333333s14.933333 32 32 32zM906.666667 778.666667h-789.333334c-17.066667 0-32 14.933333-32 32s14.933333 32 32 32h789.333334c17.066667 0 32-14.933333 32-32s-14.933333-32-32-32zM119.466667 657.066667A21.333333 21.333333 0 0 1 85.333333 640V384c0-17.066667 19.2-27.733333 34.133334-17.066667l192 128c12.8 8.533333 12.8 27.733333 0 36.266667l-192 125.866667z"
                    fill="currentColor"
                  />
                </svg>
              </button>
            </div>
          </div>
        </div>

        <!-- 2b. Indent only (collapsible) — for blocks that don't support
             alignment but can still be indented as children: table, TOC,
             divider. Shows only the indent/outdent buttons. -->
        <div
          v-if="hideAlignSection"
          class="bsm-group"
        >
          <button
            class="bsm-collapse-header"
            :class="{ 'bsm-disabled': !canIndent, 'expanded': expandedSections.indent }"
            role="menuitem"
            @mousedown.prevent="toggleSection('indent')"
          >
            <span class="bsm-collapse-title">{{ t('bsm.section.indent') }}</span>
            <svg
              class="bsm-collapse-chevron"
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
          <div
            v-show="expandedSections.indent"
            class="bsm-collapse-body"
          >
            <div class="bsm-row">
              <button
                class="bsm-icon-btn"
                :disabled="outdentDisabled"
                :class="{ 'bsm-disabled': outdentDisabled }"
                :title="t('bsm.indent.decrease')"
                role="menuitem"
                @mousedown.prevent="!outdentDisabled && onPick({ id: 'outdent', run: doOutdent })"
              >
                <svg
                  viewBox="0 0 1024 1024"
                  width="15"
                  height="15"
                  aria-hidden="true"
                >
                  <path
                    d="M906.666667 379.733333h-448c-17.066667 0-32 14.933333-32 32s14.933333 32 32 32h448c17.066667 0 32-14.933333 32-32s-14.933333-32-32-32zM906.666667 580.266667h-448c-17.066667 0-32 14.933333-32 32s14.933333 32 32 32h448c17.066667 0 32-14.933333 32-32s-14.933333-32-32-32zM117.333333 245.333333h789.333334c17.066667 0 32-14.933333 32-32s-14.933333-32-32-32h-789.333334C100.266667 181.333333 85.333333 196.266667 85.333333 213.333333s14.933333 32 32 32zM906.666667 778.666667h-789.333334c-17.066667 0-32 14.933333-32 32s14.933333 32 32 32h789.333334c17.066667 0 32-14.933333 32-32s-14.933333-32-32-32zM285.866667 657.066667c14.933333 8.533333 34.133333 0 34.133333-17.066667V384c0-17.066667-19.2-27.733333-34.133333-17.066667l-192 128c-12.8 8.533333-12.8 27.733333 0 36.266667l192 125.866667z"
                    fill="currentColor"
                  />
                </svg>
              </button>
              <button
                class="bsm-icon-btn"
                :disabled="indentDisabled"
                :class="{ 'bsm-disabled': indentDisabled }"
                :title="t('bsm.indent.increase')"
                role="menuitem"
                @mousedown.prevent="!indentDisabled && onPick({ id: 'indent', run: doIndent })"
              >
                <svg
                  viewBox="0 0 1024 1024"
                  width="15"
                  height="15"
                  aria-hidden="true"
                >
                  <path
                    d="M906.666667 379.733333h-448c-17.066667 0-32 14.933333-32 32s14.933333 32 32 32h448c17.066667 0 32-14.933333 32-32s-14.933333-32-32-32zM906.666667 580.266667h-448c-17.066667 0-32 14.933333-32 32s14.933333 32 32 32h448c17.066667 0 32-14.933333 32-32s-14.933333-32-32-32zM117.333333 245.333333h789.333334c17.066667 0 32-14.933333 32-32s-14.933333-32-32-32h-789.333334C100.266667 181.333333 85.333333 196.266667 85.333333 213.333333s14.933333 32 32 32zM906.666667 778.666667h-789.333334c-17.066667 0-32 14.933333-32 32s14.933333 32 32 32h789.333334c17.066667 0 32-14.933333 32-32s-14.933333-32-32-32zM119.466667 657.066667A21.333333 21.333333 0 0 1 85.333333 640V384c0-17.066667 19.2-27.733333 34.133334-17.066667l192 128c12.8 8.533333 12.8 27.733333 0 36.266667l-192 125.866667z"
                    fill="currentColor"
                  />
                </svg>
              </button>
            </div>
          </div>
        </div>

        <!-- 3. Text color (collapsible) — hidden for non-text blocks like image/table/divider -->
        <div
          v-if="!isImageBlock && !isDividerBlock"
          class="bsm-group bsm-colors"
        >
          <button
            class="bsm-collapse-header"
            :class="{ 'bsm-disabled': colorsDisabled, 'expanded': expandedSections.textColor }"
            role="menuitem"
            @mousedown.prevent="!colorsDisabled && toggleSection('textColor')"
          >
            <span class="bsm-collapse-title">{{ t('bsm.section.textColor') }}</span>
            <svg
              class="bsm-collapse-chevron"
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
          <div
            v-show="expandedSections.textColor"
            class="bsm-collapse-body"
          >
            <div class="bsm-swatches">
              <button
                v-for="c in textColors"
                :key="'tc-' + c.key"
                class="bsm-swatch"
                :class="{ 'active': currentColor === c.key, 'bsm-disabled': colorsDisabled }"
                :title="t(c.key === 'default' ? 'color.default' : 'color.' + c.key)"
                :style="{ backgroundColor: c.displayCssValue ?? c.cssValue }"
                :disabled="colorsDisabled"
                @mousedown.prevent="!colorsDisabled && onPick({ id: `tc-${c.key}`, run: () => setTextColor(c.key) })"
              />
            </div>
          </div>
        </div>

        <!-- 4. Background color (collapsible) — hidden for non-text blocks like image/table/divider -->
        <div
          v-if="!isImageBlock && !isDividerBlock"
          class="bsm-group bsm-colors"
        >
          <button
            class="bsm-collapse-header"
            :class="{ 'bsm-disabled': colorsDisabled, 'expanded': expandedSections.bgColor }"
            role="menuitem"
            @mousedown.prevent="!colorsDisabled && toggleSection('bgColor')"
          >
            <span class="bsm-collapse-title">{{ t('bsm.section.bgColor') }}</span>
            <svg
              class="bsm-collapse-chevron"
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
          <div
            v-show="expandedSections.bgColor"
            class="bsm-collapse-body"
          >
            <div class="bsm-swatches">
              <button
                v-for="c in bgColors"
                :key="'bc-' + c.key"
                class="bsm-swatch"
                :class="[
                  { 'active': currentBgColor === c.key, 'bsm-disabled': colorsDisabled },
                  c.key === 'default' ? 'bsm-swatch--none' : '',
                ]"
                :title="t(c.key === 'default' ? 'color.none' : 'color.' + c.key)"
                :style="{ backgroundColor: c.displayCssValue ?? c.cssValue }"
                :disabled="colorsDisabled"
                @mousedown.prevent="!colorsDisabled && onPick({ id: `bc-${c.key}`, run: () => setBgColor(c.key) })"
              />
            </div>
          </div>
        </div>
        <div class="bsm-sep" />

        <!-- 5. Actions -->
        <div class="bsm-group">
          <button
            v-for="it in actionItems"
            :key="it.id"
            class="bsm-item bsm-action"
            :class="{ danger: it.danger }"
            role="menuitem"
            @mousedown.prevent="onPick(it)"
            @mouseenter="activeId = it.id"
          >
            <SafeHtml
              class="bsm-action-icon"
              :html="it.iconHtml"
            />
            <span class="bsm-title">{{ it.title }}</span>
            <SafeHtml
              v-if="it.shortcutHtml"
              class="bsm-shortcut"
              :html="it.shortcutHtml"
            /><span
              v-else-if="it.shortcut"
              class="bsm-shortcut"
            >{{ it.shortcut }}</span>
          </button>
        </div>
      </div>
      <!-- Down scroll button -->
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
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref, inject, shallowRef, reactive, watch, nextTick, onMounted, onBeforeUnmount } from 'vue';
import { placeBelow } from './popup';
import { useEditor, fixedToolbarBottomKey } from '../context';
import { useMenuScroll } from './useMenuScroll';
import { useMenuDismiss } from './useMenuDismiss';
import SafeHtml from './SafeHtml.vue';
import type { BlockId, Block } from '../../core/types';
import type { EditorState } from '../../core/state/EditorState';
import { inlineText } from '../../core/types';
import {
  TEXT_COLOR_PRESETS,
  BG_COLOR_PRESETS,
  type AlignValue,
  type ColorPreset,
} from '../../extensions/_commonAttrs';
import { depthOf, prevSibling } from '../../core/state/store';
import {
  ICON_PARAGRAPH,
  ICON_H1,
  ICON_H2,
  ICON_H3,
  ICON_H4,
  ICON_H5,
  ICON_H6,
  ICON_BULLET_LIST,
  ICON_ORDERED_LIST,
  ICON_TODO,
  ICON_QUOTE,
  ICON_CODE,
} from './icons';
import { useI18n } from '../../i18n';

export interface SettingsItem {
  readonly id: string;
  readonly icon?: string;
  readonly iconHtml?: string;
  readonly title?: string;
  readonly shortcut?: string;
  readonly shortcutHtml?: string;
  readonly danger?: boolean;
  readonly run: () => void;
  readonly value?: string;
  readonly kind?: 'turnInto' | 'align' | 'color' | 'action';
}

const props = defineProps<{
  visible: boolean;
  anchorEl: HTMLElement | null;
  blockId: BlockId | null;
  rootEl: HTMLElement | null;
}>();

const emit = defineEmits<{
  close: [];
}>();

const { t } = useI18n();

const editor = useEditor();
// True when FixedToolbar is pinned to the bottom → dropdowns must pop UPWARD.
const isFixedToolbarBottom = inject(fixedToolbarBottomKey, ref(false));
const menuEl = ref<HTMLElement | null>(null);
const scrollEl = ref<HTMLElement | null>(null);
const activeId = ref<string>('paragraph');
const position = ref({ top: 0, left: 0, availableHeight: 520, above: false, bottom: 0, topBaseline: 0 });
const positioned = ref(false);
const canScrollUp = ref(false);
const canScrollDown = ref(false);
const MENU_WIDTH = 260;
const MENU_MIN_HEIGHT = 80;
const SCROLL_BTN_HEIGHT = 24;

// Collapsible sections — all collapsed by default
type SectionKey = 'alignIndent' | 'indent' | 'textColor' | 'bgColor';
const expandedSections = reactive<Record<SectionKey, boolean>>({
  alignIndent: false,
  indent: false,
  textColor: false,
  bgColor: false,
});
// Keep the element in the DOM for 300ms after `visible` becomes false so
// the CSS fade-out transition can play. Matches HoverToolbar timing.
const shouldRender = ref(false);
let closeTimer: ReturnType<typeof setTimeout> | null = null;
watch(() => props.visible, (visible) => {
  if (visible) {
    if (closeTimer) {
      clearTimeout(closeTimer);
      closeTimer = null;
    }
    shouldRender.value = true;
  } else {
    closeTimer = setTimeout(() => {
      shouldRender.value = false;
      closeTimer = null;
    }, 300);
  }
}, { immediate: true });

// --- Current block attrs --------------------------------------------------

/**
 * The editor's state is NOT a Vue reactive object — `editor.getState()`
 * returns a plain field, so a `computed` over it would cache forever and
 * never reflect attribute changes (align/color/bgColor would always appear
 * at their first-evaluated value). To stay reactive we subscribe to the
 * editor and mirror the latest state into a `shallowRef`.
 */
const latestState = shallowRef<EditorState>(editor.getState());
let unsubscribe: (() => void) | null = null;

const currentBlock = computed<Block | undefined>(() =>
  props.blockId != null ? latestState.value.doc.blocks.get(props.blockId) : undefined,
);

/**
 * 菜单打开时记录的块类型。删除块后 `currentBlock` 会变为 undefined，若用
 * 它做区域显隐判断，会在菜单关闭前的那一帧闪现/隐藏错误区域。这里用打开
 * 时的类型做门控，保证删除瞬间区域显示保持不变。
 */
const openedBlockType = ref<string | undefined>(undefined);

const align = computed<AlignValue>(() => {
  const v = currentBlock.value?.attrs.align;
  return (typeof v === 'string' ? v : 'left') as AlignValue;
});

/** 当前块是否支持对齐属性（代码块只允许左对齐）。 */
const alignDisabled = computed<boolean>(() => {
  const t = openedBlockType.value;
  if (!t) return true;
  const schema = editor.registries.schema.get(t);
  return !('align' in schema.attrs);
});

/** 图片块、表格块等非文本块：不显示"转为"、文字颜色、背景颜色，缩进也不可用 */
const isImageBlock = computed<boolean>(() =>
  openedBlockType.value === 'image' || openedBlockType.value === 'table',
);

/** 分割线块、目录块等特殊块：隐藏"转为"、对齐与缩进、文字颜色、背景颜色，只保留操作区 */
const isDividerBlock = computed<boolean>(() =>
  openedBlockType.value === 'divider' || openedBlockType.value === 'tableOfContents',
);

/** 公式块：不显示"转为"区域（公式不能转成其他块，其他块也不能转成公式）。 */
const isEquationBlock = computed<boolean>(() =>
  openedBlockType.value === 'equation',
);

/** 需要隐藏"对齐与缩进"区域的块类型：分割线、表格、目录、公式（公式无 align 属性） */
const hideAlignSection = computed<boolean>(() =>
  openedBlockType.value === 'divider'
  || openedBlockType.value === 'table'
  || openedBlockType.value === 'tableOfContents'
  || openedBlockType.value === 'equation',
);

/** 当前块是否支持颜色属性（代码块不支持 color / bgColor）。 */
const colorsDisabled = computed<boolean>(() => {
  const t = openedBlockType.value;
  if (!t) return true;
  const schema = editor.registries.schema.get(t);
  return !('color' in schema.attrs) || !('bgColor' in schema.attrs);
});

/** indent level is authoritative from depthOf(doc, id).
 *  `attrs.indent` is only kept as a synchronized shadow for legacy consumers. */
const currentIndent = computed<number>(() => {
  const b = currentBlock.value;
  if (!b) return 0;
  return depthOf(latestState.value.doc, b.id);
});

/** Whether the prev sibling type can ACT as a parent (schema.nestable).
 *  Mirrors the list inside indentBlockCommand — paragraph/heading + 3 list types. */
function isParentableType(type: string): boolean {
  return ['paragraph', 'heading', 'orderedList', 'bulletList', 'todoList'].includes(type);
}

/** Any block type can be INDENTED (made a child of something else) — the
 *  "nestable: true" restriction is on WHETHER A BLOCK CAN BE A PARENT (i.e.
 *  ACCEPT children), not on whether it can be a child. So codeBlock, hr,
 *  table, divider, quote, image — any of them can be indented under a
 *  nestable sibling. Therefore canIndent is always true for any existing
 *  block; real availability is derived dynamically in indentDisabled. */
const canIndent = computed<boolean>(() => {
  return !!openedBlockType.value; // Always open the indent row in the menu for valid blocks.
});

/** Increase indent button availability.
 *  Matches `indentBlockCommand` exactly:
 *    (1) depthOf(prev sibling) must already be < MAX_INDENT (10),
 *        because indenting under prev makes this block sit at depthOf(prev)+1
 *    (2) there must be a PREVIOUS SIBLING (same parent, earlier index)
 *    (3) that previous sibling must be a NESTABLE type (can be a parent) */
const indentDisabled = computed<boolean>(() => {
  const b = currentBlock.value;
  if (!b) return true;
  const doc = latestState.value.doc;
  const prev = prevSibling(doc, b.id);
  if (!prev) return true; // no sibling above → nothing to nest under
  if (!isParentableType(prev.type)) return true; // sibling can't be a parent
  // Note: the current block would be at depthOf(prev)+1. If prev is already at
  // MAX_INDENT, the resulting depth would exceed MAX_INDENT → disallow.
  if (depthOf(doc, prev.id) >= 10) return true;
  return false;
});

/** Decrease indent button availability: any block currently under a parent
 *  (depthOf > 0) can be promoted one level up, regardless of its own type. */
const outdentDisabled = computed<boolean>(() => {
  return currentIndent.value <= 0;
});

const currentColor = computed<string>(() => {
  const v = currentBlock.value?.attrs.color;
  return typeof v === 'string' ? v : 'default';
});

const currentBgColor = computed<string>(() => {
  const v = currentBlock.value?.attrs.bgColor;
  return typeof v === 'string' ? v : 'default';
});

// --- Menu contents --------------------------------------------------------

/**
 * Turn the current block into `type`. The equation block is intentionally
 * excluded from both directions of the "turn into" menu (equations can't be
 * converted to other blocks, and other blocks can't be converted to equations),
 * so this only ever converts between ordinary text-ish block types.
 */
function applyTurnInto(type: string, attrs?: Record<string, unknown>): void {
  const blockId = props.blockId;
  if (!blockId) return;
  const b = editor.getState().doc.blocks.get(blockId);
  if (!b) return;
  editor.commands.convertBlock?.({ id: blockId, type, attrs });
}

const turnIntoActions = computed<readonly SettingsItem[]>(() => [
  {
    id: 'paragraph', iconHtml: ICON_PARAGRAPH, title: t('turnInto.paragraph'), kind: 'turnInto',
    run: () => void applyTurnInto('paragraph'),
  },
  {
    id: 'h1', iconHtml: ICON_H1, title: t('turnInto.h1'), kind: 'turnInto',
    run: () => void applyTurnInto('heading', { level: 1 }),
  },
  {
    id: 'h2', iconHtml: ICON_H2, title: t('turnInto.h2'), kind: 'turnInto',
    run: () => void applyTurnInto('heading', { level: 2 }),
  },
  {
    id: 'h3', iconHtml: ICON_H3, title: t('turnInto.h3'), kind: 'turnInto',
    run: () => void applyTurnInto('heading', { level: 3 }),
  },
  {
    id: 'h4', iconHtml: ICON_H4, title: t('turnInto.h4'), kind: 'turnInto',
    run: () => void applyTurnInto('heading', { level: 4 }),
  },
  {
    id: 'h5', iconHtml: ICON_H5, title: t('turnInto.h5'), kind: 'turnInto',
    run: () => void applyTurnInto('heading', { level: 5 }),
  },
  {
    id: 'h6', iconHtml: ICON_H6, title: t('turnInto.h6'), kind: 'turnInto',
    run: () => void applyTurnInto('heading', { level: 6 }),
  },
  {
    id: 'bullet', iconHtml: ICON_BULLET_LIST, title: t('turnInto.bullet'), kind: 'turnInto',
    run: () => void applyTurnInto('bulletList'),
  },
  {
    id: 'ordered', iconHtml: ICON_ORDERED_LIST, title: t('turnInto.ordered'), kind: 'turnInto',
    run: () => void applyTurnInto('orderedList'),
  },
  {
    id: 'todo', iconHtml: ICON_TODO, title: t('turnInto.todo'), kind: 'turnInto',
    run: () => void applyTurnInto('todoList', { checked: false }),
  },
  {
    id: 'quote', iconHtml: ICON_QUOTE, title: t('turnInto.quote'), kind: 'turnInto',
    run: () => void applyTurnInto('quote'),
  },
  {
    id: 'code', iconHtml: ICON_CODE, title: t('turnInto.code'), kind: 'turnInto',
    run: () => void applyTurnInto('codeBlock', { language: 'plain' }),
  },
]);

type TurnIntoId = (typeof turnIntoActions.value)[number]['id'];

function isTurnIntoActive(id: TurnIntoId): boolean {
  const b = currentBlock.value;
  if (!b) return false;
  switch (id) {
    case 'paragraph': return b.type === 'paragraph';
    case 'h1': return b.type === 'heading' && Number(b.attrs.level) === 1;
    case 'h2': return b.type === 'heading' && Number(b.attrs.level) === 2;
    case 'h3': return b.type === 'heading' && Number(b.attrs.level) === 3;
    case 'h4': return b.type === 'heading' && Number(b.attrs.level) === 4;
    case 'h5': return b.type === 'heading' && Number(b.attrs.level) === 5;
    case 'h6': return b.type === 'heading' && Number(b.attrs.level) === 6;
    case 'bullet': return b.type === 'bulletList';
    case 'ordered': return b.type === 'orderedList';
    case 'todo': return b.type === 'todoList';
    case 'quote': return b.type === 'quote';
    case 'code': return b.type === 'codeBlock';
    default: return false;
  }
}

function isActive(id: string): boolean {
  return isTurnIntoActive(id as TurnIntoId);
}

watch(
  () => props.visible,
  (visible) => {
    if (!visible) return;
    // 记录打开时的块类型，作为本菜单会话的区域显隐依据。
    // 注意：关闭时不能清空 openedBlockType —— shouldRender 有 300ms 淡出延迟，
    // 若关闭瞬间将其置为 undefined，特殊块被隐藏的区域会在菜单消失前闪现。
    // 每次打开都会经过 visible=false→true，因此这里会写入最新的块类型。
    openedBlockType.value = props.blockId != null
      ? latestState.value.doc.blocks.get(props.blockId)?.type
      : undefined;
    const match = turnIntoActions.value.find((it) => isTurnIntoActive(it.id));
    activeId.value = match ? match.id : 'paragraph';
    // Reset all collapsible sections to collapsed state on each open
    expandedSections.alignIndent = false;
    expandedSections.indent = false;
    expandedSections.textColor = false;
    expandedSections.bgColor = false;
  },
  { immediate: true },
);

const alignActions = computed<(SettingsItem & { value: AlignValue })[]>(() => {
  const base: (SettingsItem & { value: AlignValue })[] = [
    { id: 'align-left', value: 'left', title: t('align.left'), run: () => setAlign('left') },
    { id: 'align-center', value: 'center', title: t('align.center'), run: () => setAlign('center') },
    { id: 'align-right', value: 'right', title: t('align.right'), run: () => setAlign('right') },
  ];
  // Image blocks don't support justify alignment.
  if (!isImageBlock.value) {
    base.push({ id: 'align-justify', value: 'justify', title: t('align.justify'), run: () => setAlign('justify') });
  }
  return base;
});

function setAlign(a: AlignValue): void {
  void editor.commands.setBlockAlign?.({ id: props.blockId, align: a });
}

function doIndent(): void {
  void editor.commands.indentBlock?.({ id: props.blockId });
}

function doOutdent(): void {
  void editor.commands.outdentBlock?.({ id: props.blockId });
}

const textColors: readonly ColorPreset[] = TEXT_COLOR_PRESETS;
const bgColors: readonly ColorPreset[] = BG_COLOR_PRESETS;

function setTextColor(key: string): void {
  void editor.commands.setBlockColor?.({ id: props.blockId, color: key });
}
function setBgColor(key: string): void {
  void editor.commands.setBlockBgColor?.({ id: props.blockId, bgColor: key });
}

// Clipboard helpers
//
// Chain of fallbacks for maximum reliability on Windows (and elsewhere):
//   1. `navigator.clipboard.write()` with web-standard MIME types only.
//      Custom MIME types like `application/x-blockeditor-block` are rejected
//      by Chromium on Windows, silently failing the whole write — so we
//      never send them.
//   2. `navigator.clipboard.writeText()` — simpler but universally works for
//      plain text.
//   3. `document.execCommand('copy')` via an offscreen textarea — needed for
//      non-secure contexts (file://, http://) where navigator.clipboard is
//      undefined.
async function copyBlock(): Promise<void> {
  const b = currentBlock.value;
  if (!b) return;
  // Equation blocks carry their content in `attrs.expression`, not inline text.
  const text = b.type === 'equation'
    ? String((b.attrs as { expression?: unknown }).expression ?? '')
    : inlineText(b.content);
  const payload = JSON.stringify({ id: b.id, type: b.type, attrs: b.attrs, text });
  const htmlPayload = `<meta charset="utf-8"><!-- blockeditor:${payload.replace(/--/g, '\\-\\-')} -->${
    escapeHtml(text)
  }`;

  let ok = false;

  // 1. Multi-format write (best-effort: text/plain + text/html).
  //    We intentionally AVOID custom MIME types here — Chromium rejects
  //    anything outside a small allowlist and throws for the whole call.
  try {
    if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
      const item = new ClipboardItem({
        'text/plain': new Blob([text], { type: 'text/plain' }),
        'text/html': new Blob([htmlPayload], { type: 'text/html' }),
      });
      await navigator.clipboard.write([item]);
      ok = true;
    }
  } catch {
    ok = false;
  }

  // 2. Fallback to plain writeText.
  if (!ok) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        ok = true;
      }
    } catch {
      ok = false;
    }
  }

  // 3. Fallback to execCommand via offscreen textarea.
  if (!ok) ok = fallbackCopyText(text);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fallbackCopyText(text: string): boolean {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.top = '-9999px';
  ta.style.left = '-9999px';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  const prev = document.activeElement as HTMLElement | null;
  ta.focus();
  ta.select();
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    document.body.removeChild(ta);
    // Restore focus to the previously active element (typically a block
    // contenteditable) so typing can continue immediately.
    if (prev && typeof prev.focus === 'function') {
      try {
        prev.focus();
      } catch {
        /* ignore */
      }
    }
  }
}

function cutBlock(): void {
  void copyBlock().then(() => editor.commands.removeBlock?.({ id: props.blockId }));
}

// SVG icon strings for action items
const ICON_DUPLICATE = '<svg viewBox="0 0 16 16" width="14" height="14"><rect x="5" y="5" width="8" height="8" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M3 10.5V3.5C3 2.67 3.67 2 4.5 2H10" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>';
const ICON_COPY = '<svg viewBox="0 0 16 16" width="14" height="14"><rect x="5" y="5" width="8" height="8" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M3 10.5V3.5C3 2.67 3.67 2 4.5 2H10" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>';
const ICON_CUT = '<svg viewBox="0 0 16 16" width="14" height="14"><circle cx="4.5" cy="11.5" r="1.8" fill="none" stroke="currentColor" stroke-width="1.2"/><circle cx="11.5" cy="11.5" r="1.8" fill="none" stroke="currentColor" stroke-width="1.2"/><line x1="6" y1="10" x2="13" y2="3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><line x1="10" y1="10" x2="3" y2="3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>';
const ICON_UP = '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M8 12V4M4 8L8 4L12 8" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_DOWN = '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M8 4V12M4 8L8 12L12 8" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_DELETE = '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M3.5 4.5H12.5M6.5 4.5V3C6.5 2.45 6.95 2 7.5 2H8.5C9.05 2 9.5 2.45 9.5 3V4.5M5 4.5L5.5 13C5.55 13.55 6 14 6.55 14H9.45C10 14 10.45 13.55 10.5 13L11 4.5" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_BACKSPACE = '<svg viewBox="0 0 1024 1024" width="14" height="14" aria-hidden="true"><path d="M597.333333 451.669333l55.168-55.168a42.666667 42.666667 0 0 1 60.330667 60.330667L657.664 512l55.168 55.168a42.666667 42.666667 0 0 1-60.330667 60.330667L597.333333 572.330667l-55.168 55.168a42.666667 42.666667 0 0 1-60.330666-60.330667L537.002667 512l-55.168-55.168a42.666667 42.666667 0 0 1 60.330666-60.330667L597.333333 451.669333zM874.581333 832H376.32c-47.402667 0-106.730667-25.941333-138.752-60.672l-163.178667-176.938667c-42.325333-45.866667-42.346667-118.869333 0-164.778666l163.2-176.938667C269.525333 218.026667 329.045333 192 376.32 192h498.24A106.666667 106.666667 0 0 1 981.333333 298.837333v426.325334A106.752 106.752 0 0 1 874.581333 832z m0-85.333333C886.4 746.666667 896 737.088 896 725.162667V298.837333c0-11.946667-9.514667-21.504-21.418667-21.504H376.32c-23.466667 0-60.224 16.064-76.010667 33.194667l-163.2 176.917333c-12.181333 13.226667-12.16 35.882667 0 49.109334l163.2 176.917333C316.16 730.666667 352.746667 746.666667 376.32 746.666667h498.24z" fill="currentColor"/></svg>';
const ICON_SHIFT = '<svg viewBox="0 0 1024 1024" width="14" height="14" aria-hidden="true"><path d="M672.01024 896l-320 0c-17.67424 0-32.01024-14.336-32.01024-32.01024l0-352.01024-128 0c-12.94336 0-24.61696-7.80288-29.57312-19.7632s-2.21184-25.72288 6.94272-34.87744l320-320c12.4928-12.4928 32.768-12.4928 45.2608 0l320 320c9.15456 9.15456 11.89888 22.91712 6.94272 34.87744s-16.62976 19.7632-29.57312 19.7632l-128 0 0 352.01024c0 17.67424-14.336 32.01024-32.01024 32.01024zM384 832l256 0 0-352.01024c0-17.67424 14.336-32.01024 32.01024-32.01024l82.7392 0-242.74944-242.74944-242.74944 242.74944 82.7392 0c17.67424 0 32.01024 14.336 32.01024 32.01024l0 352.01024z" fill="currentColor"/></svg>';
const ICON_ARROW_UP = '<svg viewBox="0 0 1024 1024" width="14" height="14" aria-hidden="true"><path d="M512.00988746 141.21142578c10.45623779 0 19.24145531 3.50024414 26.37542748 10.71331811l259.5421145 259.55200196C805.03668189 418.58105492 808.63085938 427.33660865 808.63085938 437.84228516c0 10.60949731-3.53485132 19.46887183-10.56994606 26.46936011-7.02026391 7.00543237-15.88952661 10.60949731-26.50891137 10.60949731-10.44140625 0-19.22167969-3.60900903-26.35565185-10.71331811L549.09863305 267.79370094V845.7097168c0 10.19915748-3.62384057 18.94976782-10.89624071 26.16284179-7.23284888 7.31195068-15.97357177 10.91601563-26.2122798 10.91601563-10.23376465 0-18.959656-3.60900903-26.22216796-10.91601563-7.24273705-7.21307397-10.87646508-15.96862769-10.87646508-26.16284179V267.79370094l-196.10760522 196.41906761C271.65484619 471.31213355 262.87951684 474.92114258 252.41833496 474.92114258c-10.61938477 0-19.45898438-3.60900903-26.4990232-10.60949731C218.86444068 457.31115699 215.36914062 448.45178247 215.36914062 437.84228516c0-10.50567651 3.55462623-19.26123023 10.69354248-26.36553931l259.53717042-259.55200196C492.7288816 144.71166992 501.52398658 141.21142578 511.97033691 141.21142578h0.03955055z" fill="currentColor"/></svg>';
const ICON_ARROW_DOWN = '<svg viewBox="0 0 1024 1024" width="14" height="14" aria-hidden="true"><path d="M511.99011254 141.21142578c10.23376465 0 18.95471191 3.60900903 26.2122798 10.81713891 7.25262451 7.20812988 10.86657691 15.96862769 10.86657763 26.2666626v577.89129615l196.1619873-196.43884254c7.099365-7.00543237 15.90435815-10.61444068 26.34082031-10.61444139 10.61938477 0 19.43426538 3.50518822 26.51385474 10.51062059 7.04498291 7.10430908 10.54522705 15.96862769 10.54522706 26.57318092 0 10.40679908-3.54473877 19.16235352-10.69354248 26.37542748l-259.55694604 259.48278761C531.23156714 879.28833008 522.44635033 882.78857422 512.00988746 882.78857422c-10.45623779 0-19.24145531-3.50024414-26.3704834-10.71331811l-259.55200195-259.48278761C218.94848656 605.37939453 215.36914062 596.62384009 215.36914062 586.21704102c0-10.60949731 3.52496314-19.46887183 10.56994606-26.57318092C232.99395776 552.63842773 241.82861328 549.12829614 252.44799805 549.12829614c10.42163062 0 19.2167356 3.60900903 26.36553931 10.61444068l196.1125493 196.43884253V178.29522729c0-10.30297828 3.60900903-19.05853271 10.88635255-26.2666626C493.05517555 144.81549073 501.80084252 141.21142578 512.02966309 141.21142578h-0.03955055z" fill="currentColor"/></svg>';
const ICON_KEY_C = '<svg viewBox="0 0 100 100" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M 75,28.5 L 71,32 C 67,26.8 61.5,22.5 53.5,22.5 C 38,22.5 24.5,34.5 24.5,50 C 24.5,65.5 38,77.5 53.5,77.5 C 61.5,77.5 67,73.2 71,68 L 75,71.5 C 70,77.8 62.5,83 53.5,83 C 34.5,83 19,68.5 19,50 C 19,31.5 34.5,17 53.5,17 C 62.5,17 70,22.2 75,28.5 Z"/></svg>';
const ICON_KEY_D = '<svg viewBox="0 0 100 100" width="14" height="14" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M 22,17 H 49 C 68,17 79,30.5 79,50 C 79,69.5 68,83 49,83 H 22 Z M 27.5,22.5 H 48.5 C 64.5,22.5 73.5,33.5 73.5,50 C 73.5,66.5 64.5,77.5 48.5,77.5 H 27.5 Z"/></svg>';
const ICON_KEY_X = '<svg viewBox="0 0 100 100" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M 20,17 L 26.5,17 L 50,46.2 L 73.5,17 L 80,17 L 53.8,50 L 80,83 L 73.5,83 L 50,53.8 L 26.5,83 L 20,83 L 46.2,50 Z"/></svg>';
const ICON_CMD = '<svg viewBox="0 0 1024 1024" width="14" height="14" aria-hidden="true"><path d="M768 597.333333h-85.333333V426.666667h85.333333c94.250667 0 170.666667-76.416 170.666667-170.666667S862.250667 85.333333 768 85.333333c-94.261333 0-170.666667 76.416-170.666667 170.666667v85.333333H426.666667v-85.333333c0-94.250667-76.416-170.666667-170.666667-170.666667S85.333333 161.749333 85.333333 256s76.416 170.666667 170.666667 170.666667h85.333333v170.666666h-85.333333c-94.250667 0-170.666667 76.416-170.666667 170.666667s76.416 170.666667 170.666667 170.666667c94.261333 0 170.666667-76.416 170.666667-170.666667v-85.333333h170.666666v85.12l-0.010666 0.213333c0 94.250667 76.416 170.666667 170.666666 170.666667s170.666667-76.416 170.666667-170.666667S862.250667 597.354667 768 597.333333z m0-426.666666a85.333333 85.333333 0 0 1 0 170.666666h-85.333333v-85.333333a85.333333 85.333333 0 0 1 85.333333-85.333333z m-597.333333 85.333333a85.333333 85.333333 0 0 1 170.666666 0v85.333333h-85.333333c-47.125333 0-85.333333-38.218667-85.333333-85.333333z m85.333333 597.333333a85.333333 85.333333 0 0 1 0-170.666666h85.333333v85.333333a85.333333 85.333333 0 0 1-85.333333 85.333333z m170.666667-256V426.666667h170.666666v170.666666H426.666667z m341.333333 256a85.333333 85.333333 0 0 1-85.333333-85.333333v-85.333333h85.322666A85.333333 85.333333 0 0 1 768 853.333333z" fill="currentColor"/></svg>';
const ICON_CTRL = '<svg viewBox="0 0 100 100" width="14" height="14" aria-hidden="true"><rect x="8" y="8" width="84" height="84" rx="16" fill="none" stroke="currentColor" stroke-width="4.8" stroke-linecap="round" stroke-linejoin="round"/><path fill="currentColor" d="M 43.5,32 C 40.3,30.3 36.3,29.5 31.5,29.5 C 20.5,29.5 14,38.2 14,50 C 14,61.8 20.5,70.5 31.5,70.5 C 36.3,70.5 40.3,69.7 43.5,68 L 43.5,60.5 C 40.5,62.8 36.5,64 32,64 C 23.7,64 20,58 20,50 C 20,42 23.7,36 32,36 C 36.5,36 40.5,37.2 43.5,39.5 Z M 50,32 H 56 V 41.5 H 59.5 V 47.5 H 56 V 62 C 56,64.2 57,65 59,65 H 60 V 70.5 C 58.5,70.8 56.7,71 54.5,71 C 50,71 48,68.5 48,63 V 47.5 H 44.5 V 41.5 H 48 V 32 Z M 62.5,41.5 H 68 V 47 C 70,43.2 73,41.5 76.5,41.5 V 47.5 C 74,47.5 71,49 68.5,52.5 V 70.5 H 62.5 V 41.5 Z M 79.5,32 H 85.5 V 70.5 H 79.5 Z"/></svg>';

/** Platform-aware modifier key icon (⌘ on macOS, Ctrl on Windows/Linux). */
const MOD_ICON = /Mac|iP(hone|[ao]d)/.test(navigator.platform) ? ICON_CMD : ICON_CTRL;

/** Build a shortcut HTML string with SVG icons instead of text symbols. */
function cmdShortcut(...icons: string[]): string {
  return icons.join('');
}

const actionItems = computed<readonly SettingsItem[]>(() => [
  {
    id: 'dup', iconHtml: ICON_DUPLICATE, title: t('action.duplicate'), shortcutHtml: cmdShortcut(MOD_ICON, ICON_KEY_D),
    run: () => void editor.commands.duplicateBlock?.({ id: props.blockId }),
  },
  {
    id: 'copy', iconHtml: ICON_COPY, title: t('action.copy'), shortcutHtml: cmdShortcut(MOD_ICON, ICON_KEY_C),
    run: () => void copyBlock(),
  },
  {
    id: 'cut', iconHtml: ICON_CUT, title: t('action.cut'), shortcutHtml: cmdShortcut(MOD_ICON, ICON_KEY_X),
    run: () => void cutBlock(),
  },
  {
    id: 'up', iconHtml: ICON_UP, title: t('action.moveUp'), shortcutHtml: cmdShortcut(MOD_ICON, ICON_SHIFT, ICON_ARROW_UP),
    run: () => void editor.commands.moveBlockUp?.({ id: props.blockId }),
  },
  {
    id: 'down', iconHtml: ICON_DOWN, title: t('action.moveDown'), shortcutHtml: cmdShortcut(MOD_ICON, ICON_SHIFT, ICON_ARROW_DOWN),
    run: () => void editor.commands.moveBlockDown?.({ id: props.blockId }),
  },
  {
    id: 'del', iconHtml: ICON_DELETE, title: t('action.delete'),
    shortcutHtml: ICON_BACKSPACE,
    danger: true,
    run: () => void editor.commands.removeBlock?.({ id: props.blockId }),
  },
]);

// --- Positioning ----------------------------------------------------------

// Reset position state BEFORE the component renders when visible changes.
// Without this, reopening the menu inherits the previous position and
// the user sees a flash at the stale location before the post-watch
// corrects it.  flush:'pre' (the default) fires before the render.
watch(
  () => props.visible,
  (v) => {
    if (v) {
      positioned.value = false;
      position.value = { top: 0, left: 0, availableHeight: 520, above: false, bottom: 0, topBaseline: 0 };
    }
  },
);

function recomputePlacement(): void {
  const anchor = props.anchorEl;
  const root = props.rootEl;
  const me = menuEl.value;
  if (!props.visible || !anchor || !root || !me) return;
  void nextTick().then(() => {
    const el = menuEl.value;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const fromToolbar = !!anchor.closest('.fixed-toolbar');
    const forceDirection: 'auto' | 'down' | 'up' = fromToolbar
      ? (isFixedToolbarBottom.value ? 'up' : 'down')
      : 'auto';
    const viewportGap = fromToolbar ? 10 : 0;
    const placement = placeBelow(root, anchor, {
      width: Math.max(rect.width, MENU_WIDTH),
      height: rect.height,
    }, 8, forceDirection, viewportGap, viewportGap);
    position.value = placement;
    positioned.value = true;
    nextTick(updateScrollState);
  });
}

watch(
  [() => props.visible, () => props.anchorEl, menuEl, canScrollUp, canScrollDown],
  recomputePlacement,
  { flush: 'post' },
);

function toggleSection(key: SectionKey): void {
  expandedSections[key] = !expandedSections[key];
  nextTick(recomputePlacement);
}

// --- Scroll state tracking -----------------------------------------------

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

// Wheel + touch scroll support on the scroll container.
useMenuScroll(scrollEl, updateScrollState);

const menuStyle = computed(() => {
  if (!props.rootEl) return { display: 'none' };
  // Hide the menu until the first position calculation completes. Without
  // this, the menu briefly appears at (0,0) before the watch measures its
  // height and computes the correct placement.
  //
  // Override --scroll-max-height to 100vh so the pre-measurement render
  // isn't clipped by .bsm-scroll's 520px CSS fallback (the fallback would
  // otherwise make rect.height smaller than the true content height and
  // produce a wrong placeBelow `top`, causing the positioned menu to
  // overflow the viewport bottom).
  if (!positioned.value) return { visibility: 'hidden', top: '0px', left: '0px', width: `${MENU_WIDTH}px`, '--scroll-max-height': '100vh' };
  const above = position.value.above;
  const left = position.value.left;
  const scrollBtnsH = (canScrollUp.value ? SCROLL_BTN_HEIGHT : 0) + (canScrollDown.value ? SCROLL_BTN_HEIGHT : 0);
  const maxScrollAreaHeight = position.value.availableHeight - scrollBtnsH;
  const base: Record<string, string> = {
    left: `${left}px`,
    width: `${MENU_WIDTH}px`,
    maxHeight: `${position.value.availableHeight}px`,
    '--scroll-max-height': `${Math.max(MENU_MIN_HEIGHT, maxScrollAreaHeight)}px`,
  };
  if (above) {
    const viewportH = document.documentElement.clientHeight;
    base.bottom = `${Math.max(0, viewportH - position.value.bottom)}px`;
    base.top = 'auto';
  } else {
    base.top = `${position.value.top}px`;
    base.bottom = 'auto';
  }
  return base;
});

// --- Running + closing ---------------------------------------------------

function onPick(item: SettingsItem): void {
  // If the clicked item is a turn-into action that is already active,
  // convert the block to paragraph instead (toggle behavior).
  if (item.kind === 'turnInto' && isActive(item.id)) {
    const paragraph = turnIntoActions.value.find((a) => a.id === 'paragraph');
    if (paragraph) {
      activeId.value = 'paragraph';
      paragraph.run();
      emit('close');
      return;
    }
  }
  activeId.value = item.id;
  item.run();
  emit('close');
}

function onKeyDown(event: KeyboardEvent): boolean {
  const all = [...turnIntoActions.value, ...actionItems.value];
  if (all.length === 0) return false;
  const idx = all.findIndex((i) => i.id === activeId.value);
  const wrap = (i: number): number => ((i % all.length) + all.length) % all.length;
  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault();
      activeId.value = all[wrap(idx + 1)]!.id;
      return true;
    case 'ArrowUp':
      event.preventDefault();
      activeId.value = all[wrap(idx - 1)]!.id;
      return true;
    case 'Enter':
      event.preventDefault();
      onPick(all[wrap(idx)]!);
      return true;
    case 'Escape':
      event.preventDefault();
      emit('close');
      return true;
    default:
      return false;
  }
}

defineExpose({ onKeyDown });

// --- Auto-dismiss on outside interaction --------------------------------
// Closes the menu on: mousedown/touchstart outside, wheel outside, and
// mouseleave from the menu. Replaces the old manual click-outside handler.
useMenuDismiss(
  menuEl,
  () => props.visible,
  () => emit('close'),
  () => props.anchorEl,
);

onMounted(() => {
  unsubscribe = editor.subscribe((update) => {
    latestState.value = update.state;
  });
});
onBeforeUnmount(() => {
  unsubscribe?.();
  unsubscribe = null;
});
</script>
