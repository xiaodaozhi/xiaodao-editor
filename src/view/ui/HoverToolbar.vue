<!--
  HoverToolbar: the floating mini-toolbar that appears when the user selects
  text inside a block. Inspired by Feishu's selection toolbar.

  Layout:
    [Type ▾] | [B] [I] [U] [S] [</>] | [Align ▾] | [Color ▾] | [Copy] [Delete]

  - Type:    dropdown to switch block type (Text / H1-H6 / Bullet / Ordered /
             Todo / Quote / Code).
  - Marks:   toggle bold / italic / underline / strikethrough / inline-code on
             the selected text range.
  - Align:   dropdown for block-level text alignment.
  - Color:   dropdown for text color + background color presets.
  - Copy:    copies ONLY the selected text (not the whole block).
  - Delete:  removes the block.

  Positioning: above the selection (or below if no space above). Smooth
  fade+scale animation on show/hide.
-->

<template>
  <Teleport to="body">
    <div
      class="hover-toolbar-shell"
      :class="{ visible }"
      :style="shellStyle"
      :aria-hidden="!visible"
    >
      <div
        ref="toolbarEl"
        class="hover-toolbar"
        :class="{ 'above': placement.above, 'below': !placement.above, 'ht-overflow': htOverflow }"
        :style="toolbarStyle"
        role="toolbar"
        :aria-label="t('hoverToolbar.label')"
      >
        <!-- Left nav button (shown when content overflows) -->
        <button
          v-if="htOverflow"
          class="ht-nav-btn ht-nav-left"
          :class="{ disabled: !canHtScrollLeft }"
          :title="t('ui.scrollLeft')"
          :aria-label="t('ui.scrollLeft')"
          @mousedown.prevent.stop="htScrollBy(-1)"
        >
          <svg
            viewBox="0 0 12 12"
            width="10"
            height="10"
            aria-hidden="true"
          >
            <path
              d="M7.5 3L4.5 6L7.5 9"
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
          ref="htContentEl"
          class="ht-content"
          :class="{ 'dropdown-open': !!openDropdown }"
          @scroll="updateHtScrollState"
        >
          <!-- Block type dropdown -->
          <div class="ht-dropdown-wrap">
            <button
              ref="typeBtnEl"
              class="ht-btn ht-type-btn"
              :class="{ open: openDropdown === 'type' }"
              :title="t('hoverToolbar.typeBtnTitle')"
              @mousedown.prevent.stop="toggleDropdown('type')"
            >
              <span class="ht-type-label">{{ currentTypeLabel }}</span>
              <svg
                class="ht-caret"
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
              v-if="openDropdown === 'type'"
              ref="typeDropdownEl"
              class="ht-dropdown"
              :class="{ above: dropdownAbove }"
              :style="dropdownStyle"
            >
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
                class="ht-dropdown-scroll"
                @scroll="updateScrollState"
              >
                <button
                  v-for="opt in typeOptions"
                  :key="opt.id"
                  class="ht-dropdown-item"
                  :class="{ active: opt.active }"
                  @mousedown.prevent.stop="onTypePick(opt)"
                >
                  <SafeHtml
                    class="ht-dropdown-icon"
                    :html="opt.iconHtml"
                  />
                  <span>{{ opt.label }}</span>
                  <svg
                    v-if="opt.active"
                    class="ht-check"
                    viewBox="0 0 12 12"
                    width="14"
                    height="14"
                    aria-hidden="true"
                  >
                    <path
                      d="M2.5 6L5 8.5L9.5 4"
                      stroke="currentColor"
                      stroke-width="1.5"
                      fill="none"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />
                  </svg>
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
            </div>
          </div>
          <!-- Align dropdown -->
          <div class="ht-dropdown-wrap">
            <button
              ref="alignBtnEl"
              class="ht-btn ht-icon-only"
              :class="{ open: openDropdown === 'align', disabled: alignDisabled }"
              :title="t('hoverToolbar.alignBtnTitle')"
              :disabled="alignDisabled"
              @mousedown.prevent.stop="!alignDisabled && toggleDropdown('align')"
            >
              <svg
                viewBox="0 0 16 16"
                width="15"
                height="15"
                aria-hidden="true"
              >
                <template v-if="currentAlign === 'left'">
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
                <template v-else-if="currentAlign === 'center'">
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
                <template v-else-if="currentAlign === 'right'">
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
            <div
              v-if="openDropdown === 'align'"
              ref="alignDropdownEl"
              class="ht-dropdown"
              :class="{ above: dropdownAbove }"
              :style="dropdownStyle"
            >
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
                class="ht-dropdown-scroll"
                @scroll="updateScrollState"
              >
                <button
                  v-for="a in alignOptions"
                  :key="a.id"
                  class="ht-dropdown-item ht-align-item"
                  :class="{ active: currentAlign === a.value }"
                  @mousedown.prevent.stop="onAlignPick(a.value)"
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
                  <span>{{ a.label }}</span>
                  <svg
                    v-if="currentAlign === a.value"
                    class="ht-check"
                    viewBox="0 0 12 12"
                    width="14"
                    height="14"
                    aria-hidden="true"
                  >
                    <path
                      d="M2.5 6L5 8.5L9.5 4"
                      stroke="currentColor"
                      stroke-width="1.5"
                      fill="none"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />
                  </svg>
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
            </div>
          </div>
          <div class="ht-sep" />
          <!-- Inline marks -->
          <button
            v-for="m in markButtons"
            :key="m.id"
            class="ht-btn ht-icon-only"
            :class="{ active: activeMarks.has(m.id), disabled: isMarkBtnDisabled(m.id) }"
            :title="m.title"
            :disabled="isMarkBtnDisabled(m.id)"
            @mousedown.prevent.stop="!isMarkBtnDisabled(m.id) && onToggleMark(m.id)"
          >
            <SafeHtml :html="m.iconHtml" />
          </button>
          <!-- Link button -->
          <button
            class="ht-btn ht-icon-only"
            :class="{ active: activeMarks.has('link'), disabled: isMarkBtnDisabled('link') }"
            :title="t('hoverToolbar.linkBtnTitle')"
            :disabled="isMarkBtnDisabled('link')"
            @mousedown.prevent.stop="!isMarkBtnDisabled('link') && onLinkClick()"
          >
            <svg
              viewBox="0 0 16 16"
              width="15"
              height="15"
              aria-hidden="true"
            >
              <path
                d="M6.5 9.5a2.5 2.5 0 0 0 3.5 0l2-2a2.5 2.5 0 0 0-3.5-3.5l-1 1"
                fill="none"
                stroke="currentColor"
                stroke-width="1.3"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
              <path
                d="M9.5 6.5a2.5 2.5 0 0 0-3.5 0l-2 2a2.5 2.5 0 0 0 3.5 3.5l1-1"
                fill="none"
                stroke="currentColor"
                stroke-width="1.3"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </button>
          <div class="ht-sep" />
          <!-- Color dropdown -->
          <div class="ht-dropdown-wrap">
            <button
              ref="colorBtnEl"
              class="ht-btn ht-icon-only"
              :class="{ open: openDropdown === 'color', disabled: isMarkBtnDisabled('color') }"
              :title="t('hoverToolbar.colorBtnTitle')"
              :disabled="isMarkBtnDisabled('color')"
              @mousedown.prevent.stop="!isMarkBtnDisabled('color') && toggleDropdown('color')"
            >
              <svg
                viewBox="0 0 16 16"
                width="15"
                height="15"
                aria-hidden="true"
              >
                <path
                  d="M8 2.5C5 2.5 2.5 5 2.5 8S5 13.5 8 13.5c1.5 0 2.5-1 2.5-2 0-1.5-1-1.5-1-2.5 0-.8.7-1.5 1.5-1.5h1C13.3 5.5 13.5 4.5 13.5 4c0-1-2.5-1.5-5.5-1.5z"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.2"
                />
                <circle
                  cx="5.5"
                  cy="6"
                  r="0.9"
                  fill="currentColor"
                />
                <circle
                  cx="8"
                  cy="5"
                  r="0.9"
                  fill="currentColor"
                />
                <circle
                  cx="10.5"
                  cy="6.5"
                  r="0.9"
                  fill="currentColor"
                />
              </svg>
            </button>
            <div
              v-if="openDropdown === 'color'"
              ref="colorDropdownEl"
              class="ht-dropdown ht-color-dropdown"
              :class="{ above: dropdownAbove }"
              :style="dropdownStyle"
            >
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
                class="ht-dropdown-scroll"
                @scroll="updateScrollState"
              >
                <div class="ht-color-section">
                  <div class="ht-color-label">
                    {{ t('hoverToolbar.textColor') }}
                  </div>
                  <div class="ht-swatches">
                    <button
                      v-for="c in textColors"
                      :key="'tc-' + c.key"
                      class="ht-swatch"
                      :class="{ active: activeColor === c.key }"
                      :title="t(c.key === 'default' ? 'color.default' : 'color.' + c.key)"
                      :style="{ backgroundColor: c.cssValue }"
                      @mousedown.prevent.stop="onTextColorPick(c.key)"
                    />
                  </div>
                </div>
                <div class="ht-color-section">
                  <div class="ht-color-label">
                    {{ t('hoverToolbar.bgColor') }}
                  </div>
                  <div class="ht-swatches">
                    <button
                      v-for="c in bgColors"
                      :key="'bc-' + c.key"
                      class="ht-swatch"
                      :class="{ active: activeBgColor === c.key }"
                      :title="t(c.key === 'default' ? 'color.none' : 'color.' + c.key)"
                      :style="{ backgroundColor: c.cssValue }"
                      @mousedown.prevent.stop="onBgColorPick(c.key)"
                    />
                  </div>
                </div>
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
            </div>
          </div>
          <div class="ht-sep" />
          <!-- Copy (selection only) -->
          <button
            class="ht-btn ht-icon-only"
            :title="t('hoverToolbar.copySelection')"
            :aria-label="t('hoverToolbar.copySelection')"
            @mousedown.prevent.stop="onCopy"
          >
            <svg
              viewBox="0 0 16 16"
              width="15"
              height="15"
              aria-hidden="true"
            >
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
          <!-- Delete -->
          <button
            class="ht-btn ht-icon-only ht-danger"
            :title="t('hoverToolbar.deleteBlock')"
            :aria-label="t('hoverToolbar.deleteBlock')"
            @mousedown.prevent.stop="onDelete"
          >
            <svg
              viewBox="0 0 16 16"
              width="15"
              height="15"
              aria-hidden="true"
            >
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
        <!-- Right nav button (shown when content overflows) -->
        <button
          v-if="htOverflow"
          class="ht-nav-btn ht-nav-right"
          :class="{ disabled: !canHtScrollRight }"
          :title="t('ui.scrollRight')"
          :aria-label="t('ui.scrollRight')"
          @mousedown.prevent.stop="htScrollBy(1)"
        >
          <svg
            viewBox="0 0 12 12"
            width="10"
            height="10"
            aria-hidden="true"
          >
            <path
              d="M4.5 3L7.5 6L4.5 9"
              stroke="currentColor"
              stroke-width="1.5"
              fill="none"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref, watch, nextTick, onMounted, onBeforeUnmount, shallowRef } from 'vue';
import { placeBelowSelection as placeSelection } from './popup';
import { useEditor } from '../context';
import { useMenuScroll } from './useMenuScroll';
import SafeHtml from './SafeHtml.vue';
import { inlineText, splitInline } from '../../core/types';
import type { BlockId, BlockType } from '../../core/types';
import { flatten as flattenDoc } from '../../core/state/store';
import { isCrossBlockText } from '../domSelection';
import { inlineToHtml } from '../inlineDom';
import {
  TEXT_COLOR_PRESETS,
  BG_COLOR_PRESETS,
  type AlignValue,
  type ColorPreset,
} from '../../extensions/_commonAttrs';
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

export interface ToolbarButton {
  readonly id: string;
  readonly icon: string;
  readonly title: string;
  readonly active?: boolean;
  readonly convertType?: string;
  readonly convertAttrs?: Readonly<Record<string, unknown>>;
}

interface TypeOption {
  id: string;
  label: string;
  iconHtml: string;
  active: boolean;
  convertType: string;
  convertAttrs?: Readonly<Record<string, unknown>>;
}

const props = defineProps<{
  visible: boolean;
  selectionRect: DOMRect | null;
  blockId: BlockId | null;
  blockType: string | null;
  blockAttrs: Readonly<Record<string, unknown>>;
  rootEl: HTMLElement | null;
}>();

const emit = defineEmits<{
  close: [];
  linkClick: [blockId: BlockId, from: number, to: number];
}>();

const { t } = useI18n();

const editor = useEditor();
const toolbarEl = ref<HTMLElement | null>(null);
const typeDropdownEl = ref<HTMLElement | null>(null);
const alignDropdownEl = ref<HTMLElement | null>(null);
const colorDropdownEl = ref<HTMLElement | null>(null);
const typeBtnEl = ref<HTMLElement | null>(null);
const alignBtnEl = ref<HTMLElement | null>(null);
const colorBtnEl = ref<HTMLElement | null>(null);
const placement = ref({ top: 0, left: 0, above: false });
const openDropdown = ref<'type' | 'align' | 'color' | null>(null);
const dropdownAbove = ref(false);
const dropdownMaxHeight = ref<number | null>(null);
const scrollEl = ref<HTMLElement | null>(null);
const canScrollUp = ref(false);
const canScrollDown = ref(false);

// --- Horizontal overflow (narrow viewport) -------------------------------
const htContentEl = ref<HTMLElement | null>(null);
const htOverflow = ref(false);
const canHtScrollLeft = ref(false);
const canHtScrollRight = ref(false);
const HT_SCROLL_STEP = 80;
const HT_NAV_BTN_WIDTH = 24; // px each (left + right nav buttons when overflowing)

const dropdownStyle = computed(() => ({
  maxHeight: dropdownMaxHeight.value !== null ? `${dropdownMaxHeight.value}px` : undefined,
}));
const TOOLBAR_HEIGHT = 36;
const TOOLBAR_WIDTH_EST = 360;
const currentBlockId = shallowRef<BlockId | null>(null);

watch(() => props.blockId, (id) => {
  currentBlockId.value = id;
}, { immediate: true });

// --- Editor state subscription (for reactive align/color) ------------------

const latestState = shallowRef(editor.getState());
let unsubscribe: (() => void) | null = null;

const currentBlock = computed(() =>
  latestState.value.doc.blocks.get(currentBlockId.value ?? ('' as BlockId)),
);

const currentAlign = computed<AlignValue>(() => {
  const v = currentBlock.value?.attrs.align;
  return (typeof v === 'string' ? v : 'left') as AlignValue;
});

// Active inline color/bgColor marks on the current selection (not block-level).
const activeColor = ref('');
const activeBgColor = ref('');

// Close dropdown when toolbar hides or block changes
watch(() => props.visible, (v) => {
  if (!v) openDropdown.value = null;
});
watch(() => props.blockId, () => {
  openDropdown.value = null;
});

// --- Active marks (bold/italic/etc. on current selection) ------------------

const activeMarks = ref<Set<string>>(new Set());
const marksVersion = ref(0);

function updateActiveMarks(): void {
  const marks = new Set<string>();
  if (!props.visible || !props.blockId || !props.rootEl) {
    activeMarks.value = marks;
    return;
  }
  // ---- DOM-based path: try the current selection.
  const blockEl = props.rootEl.querySelector(`[data-block-id="${props.blockId}"]`);
  if (blockEl) {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      if (!range.collapsed && blockEl.contains(range.commonAncestorContainer)) {
        const textNodes: Text[] = [];
        const walker = document.createTreeWalker(blockEl, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const node = walker.currentNode as Text;
          const text = node.nodeValue ?? '';
          if (text.length === 0) continue;
          if (!range.intersectsNode(node)) continue;
          textNodes.push(node);
        }
        if (textNodes.length > 0) {
          const MARK_TAGS: Record<string, string[]> = {
            bold: ['B', 'STRONG'],
            italic: ['I', 'EM'],
            underline: ['U'],
            strikethrough: ['S', 'STRIKE', 'DEL'],
            code: ['CODE'],
            link: ['A'],
          };
          for (const [markType, tags] of Object.entries(MARK_TAGS)) {
            const allHave = textNodes.every((node) => {
              let el: Node | null = node.parentNode;
              while (el && el !== blockEl) {
                if (el.nodeType === Node.ELEMENT_NODE && tags.includes(el.nodeName)) return true;
                el = el.parentNode;
              }
              return false;
            });
            if (allHave) marks.add(markType);
          }
          activeMarks.value = marks;
          return;
        }
      }
    }
  }

  // ---- State-based fallback: used when the DOM watcher rewrites innerHTML
  // and the browser fires `selectionchange` has not yet re-added the range.
  const st = editor.getState();
  const blk = props.blockId ? st.doc.blocks.get(props.blockId) : undefined;
  if (!blk) {
    activeMarks.value = marks;
    return;
  }
  const offsets = getSelectionOffsets();
  const from = offsets ? offsets.from : 0;
  const to = offsets ? offsets.to : inlineText(blk.content).length;
  if (from >= to) {
    activeMarks.value = marks;
    return;
  }
  const BASIC_MARKS = ['bold', 'italic', 'underline', 'strikethrough', 'code', 'link'] as const;
  for (const markType of BASIC_MARKS) {
    let allHaveFlag = true;
    let anyOverlap = false;
    let pos = 0;
    for (const run of blk.content) {
      if (run.type !== 'text') continue;
      const runStart = pos;
      const runEnd = pos + run.text.length;
      const overlap = runEnd > from && runStart < to;
      if (overlap) {
        anyOverlap = true;
        if (!run.marks || !run.marks.some((m) => m.type === markType)) {
          allHaveFlag = false;
          break;
        }
      }
      pos = runEnd;
    }
    if (anyOverlap && allHaveFlag) marks.add(markType);
  }
  activeMarks.value = marks;
}

// --- Mark button definitions -----------------------------------------------

// Block-level: code blocks disallow all inline marks.
const marksDisabled = computed(() => props.blockType === 'codeBlock');

/** 当前块是否支持对齐属性（代码块只允许左对齐）。 */
const alignDisabled = computed(() => {
  const bt = props.blockType;
  if (!bt) return false;
  const schema = editor.registries.schema.get(bt as BlockType);
  return !('align' in schema.attrs);
});

/**
 * Whether a given mark button should be disabled.
 *  - Code blocks: all marks disabled (block-level).
 *  - Quote blocks: italic disabled (rendered globally italic via CSS).
 *  - Inline code: when the whole selection is inline code, bold/italic/
 *    underline/strikethrough and color are disabled (the code button itself
 *    stays enabled so it can be toggled back off).
 */
function isMarkBtnDisabled(markId: string): boolean {
  if (marksDisabled.value) return true;
  if (markId === 'italic') {
    const bt = props.blockType;
    if (bt && editor.registries.schema.isMarkDisallowed(bt as BlockType, 'italic')) return true;
  }
  // Link button: disabled for cross-block selections because a link mark
  // can only span a single block.
  if (markId === 'link') {
    const sel = editor.getState().selection;
    if (sel.kind === 'text' && isCrossBlockText(sel)) return true;
    return false;
  }
  if (markId !== 'code' && activeMarks.value.has('code')) return true;
  return false;
}

const markButtons = computed<readonly { id: string; title: string; iconHtml: string }[]>(() => [
  { id: 'bold', title: t('mark.bold'), iconHtml: '<svg viewBox="0 0 1024 1024" width="15" height="15" aria-hidden="true"><path d="M214.857 889.143v-68.571h68.571V203.429H214.857v-68.571h411.429v1.257c96.114 10.629 171.429 87.383 171.429 181.6 0 58.971-29.486 111.086-75.109 144.457 72.069 39.291 120.823 113.234 120.823 198.4 0 119.291-95.634 216.594-217.12 227.543l-0.286.029H214.857z m388.572-388.571H352v320h251.429c95.086 0 171.429-72.091 171.429-160s-76.343-160-171.429-160z m0-297.143H352v228.571h251.429l5.211-0.091c67.52-2.515 120.503-53.235 120.503-114.195 0-62.537-55.749-114.285-125.714-114.285z" fill="currentColor"/></svg>' },
  { id: 'italic', title: t('mark.italic'), iconHtml: '<svg viewBox="0 0 1024 1024" width="15" height="15" aria-hidden="true"><path d="M730.143 127.714v64.286h-112.329l-166.521 621.429h128.871v64.286H276.286v-64.286h108.45l166.5-621.429H426.286V127.714h303.857z" fill="currentColor"/></svg>' },
  { id: 'underline', title: t('mark.underline'), iconHtml: '<svg viewBox="0 0 1024 1024" width="15" height="15" aria-hidden="true"><path d="M512 123.639a36.409 36.409 0 0 1 33.642 22.525l230.59 558.27a36.409 36.409 0 1 1-67.284 27.768L638.072 560.545H385.928l-70.876 171.656a36.409 36.409 0 1 1-67.332-27.768l230.59-558.27A36.409 36.409 0 0 1 512 123.639z m-95.974 364.089h191.948L512 255.439l-95.974 232.289zM769.289 827.544c19.418 0 38.836 14.564 38.836 38.836 0 19.418-14.564 33.982-29.127 33.982H259.565c-19.418 0-38.836-14.564-38.836-38.836 0-19.418 14.564-33.982 29.127-33.982h519.433z" fill="currentColor"/></svg>' },
  { id: 'strikethrough', title: t('mark.strikethrough'), iconHtml: '<svg viewBox="0 0 1024 1024" width="15" height="15" aria-hidden="true"><path d="M182.044 490.667h659.911a34.133 34.133 0 0 1 4.642 67.948l-4.597 0.319h-135.395c40.05 37 60.803 81.601 60.803 133.575 0 128.569-147.092 211.171-307.382 192.512-101.717-11.833-173.352-52.565-210.944-122.971a34.133 34.133 0 0 1 60.211-32.176c25.942 48.606 77.46 77.915 158.606 87.381 124.837 14.473 231.242-45.283 231.242-124.746 0-53.339-36.636-96.802-116.736-131.345l-5.279-2.23H182.044a34.133 34.133 0 0 1-33.815-29.492L147.911 524.8a34.133 34.133 0 0 1 29.491-33.815l4.642-0.318z m68.767-176.447c6.918-128.796 128.432-203.343 287.812-184.82 99.579 11.56 175.81 47.923 226.737 109.636a34.133 34.133 0 1 1-52.657 43.463c-38.775-47.013-98.759-75.639-181.999-85.288-123.654-14.381-211.627 36.591-211.627 117.009 0 35.135 10.65 61.349 37.774 90.203l5.826 6.007c4.278 4.369 8.966 8.875 11.377 10.923l1.411 0.91H288.085l-1.092-1.729c-6.508-9.376-38.958-54.386-36.182-106.314z" fill="currentColor"/></svg>' },
  { id: 'code', title: t('mark.inlineCode'), iconHtml: '<svg viewBox="0 0 1024 1024" width="15" height="15" aria-hidden="true"><path d="M197.802 747.664v-145.287a58.916 58.916 0 0 0-58.916-58.916h-19.619v-62.922h19.619a58.916 58.916 0 0 0 58.916-58.916V276.336a117.832 117.832 0 0 1 117.832-117.832h39.297v78.535h-39.356a39.297 39.297 0 0 0-39.238 39.297v161.017A78.594 78.594 0 0 1 222.37 512a78.594 78.594 0 0 1 53.967 74.646V747.664a39.238 39.238 0 0 0 39.238 39.238h39.356v78.594h-39.356a117.832 117.832 0 0 1-117.832-117.832z m628.456-145.287V747.664a117.832 117.832 0 0 1-117.832 117.832h-39.356v-78.594h39.356a39.238 39.238 0 0 0 39.238-39.238v-161.017A78.535 78.535 0 0 1 801.63 512a78.594 78.594 0 0 1-53.967-74.646V276.336a39.297 39.297 0 0 0-39.238-39.297h-39.356V158.504h39.356a117.832 117.832 0 0 1 117.832 117.832v145.287a58.916 58.916 0 0 0 58.916 58.916h19.56v62.922h-19.56a58.916 58.916 0 0 0-58.916 58.916z" fill="currentColor"/></svg>' },
]);

// --- Block type label + options -------------------------------------------

const typeOptions = computed<TypeOption[]>(() => {
  const bt = props.blockType;
  const ba = props.blockAttrs;
  const isActive = (type: string, level?: number): boolean =>
    bt === type && (level === undefined || Number(ba.level) === level);

  return [
    { id: 'text', label: t('turnInto.paragraph'), iconHtml: ICON_PARAGRAPH, active: isActive('paragraph'), convertType: 'paragraph' },
    { id: 'h1', label: t('turnInto.h1'), iconHtml: ICON_H1, active: isActive('heading', 1), convertType: 'heading', convertAttrs: { level: 1 } },
    { id: 'h2', label: t('turnInto.h2'), iconHtml: ICON_H2, active: isActive('heading', 2), convertType: 'heading', convertAttrs: { level: 2 } },
    { id: 'h3', label: t('turnInto.h3'), iconHtml: ICON_H3, active: isActive('heading', 3), convertType: 'heading', convertAttrs: { level: 3 } },
    { id: 'h4', label: t('turnInto.h4'), iconHtml: ICON_H4, active: isActive('heading', 4), convertType: 'heading', convertAttrs: { level: 4 } },
    { id: 'h5', label: t('turnInto.h5'), iconHtml: ICON_H5, active: isActive('heading', 5), convertType: 'heading', convertAttrs: { level: 5 } },
    { id: 'h6', label: t('turnInto.h6'), iconHtml: ICON_H6, active: isActive('heading', 6), convertType: 'heading', convertAttrs: { level: 6 } },
    { id: 'bullet', label: t('turnInto.bullet'), iconHtml: ICON_BULLET_LIST, active: isActive('bulletList'), convertType: 'bulletList' },
    { id: 'ordered', label: t('turnInto.ordered'), iconHtml: ICON_ORDERED_LIST, active: isActive('orderedList'), convertType: 'orderedList' },
    { id: 'todo', label: t('turnInto.todo'), iconHtml: ICON_TODO, active: isActive('todoList'), convertType: 'todoList', convertAttrs: { checked: false } },
    { id: 'quote', label: t('turnInto.quote'), iconHtml: ICON_QUOTE, active: isActive('quote'), convertType: 'quote' },
    { id: 'code', label: t('turnInto.code'), iconHtml: ICON_CODE, active: isActive('codeBlock'), convertType: 'codeBlock', convertAttrs: { language: 'plain' } },
  ];
});

const currentTypeLabel = computed(() => {
  const match = typeOptions.value.find((o) => o.active);
  return match ? match.label : t('turnInto.paragraph');
});

// --- Align options ---------------------------------------------------------

const alignOptions = computed<{ id: string; label: string; value: AlignValue }[]>(() => [
  { id: 'left', label: t('align.left'), value: 'left' },
  { id: 'center', label: t('align.center'), value: 'center' },
  { id: 'right', label: t('align.right'), value: 'right' },
  { id: 'justify', label: t('align.justify'), value: 'justify' },
]);

// --- Color presets ---------------------------------------------------------

const textColors: readonly ColorPreset[] = TEXT_COLOR_PRESETS;
const bgColors: readonly ColorPreset[] = BG_COLOR_PRESETS;

// --- Positioning ----------------------------------------------------------

/** Measure the toolbar's natural width (sum of all content) and determine
 *  whether horizontal overflow mode is needed. When the viewport is too
 *  narrow to fit the full toolbar, we clamp its width and show left/right
 *  nav buttons to scroll the content area. */
function measureHtOverflow(): void {
  const el = toolbarEl.value;
  const content = htContentEl.value;
  if (!el || !content) {
    htOverflow.value = false;
    return;
  }
  // Temporarily remove any prior maxWidth so we can measure the true natural
  // scrollWidth (the total width of all flex children without wrapping).
  content.style.maxWidth = '';
  // Force a reflow so scrollWidth reflects the unbounded size.
  const _unused = content.offsetWidth;
  void _unused;
  const naturalWidth = content.scrollWidth;
  // Available viewport width for the ENTIRE toolbar (with 16px margin
  // on each side of the viewport so it doesn't stick to the edges).
  // Use clientWidth instead of innerWidth so the 15–17px vertical
  // scrollbar is excluded — otherwise the max-width is computed against
  // a viewport that's wider than the actually visible area, and the
  // toolbar right edge still overflows.
  const viewportW = document.documentElement.clientWidth;
  const margin = 16;
  const totalAvailable = Math.max(200, viewportW - margin * 2);

  // If overflowing, we need 2 × HT_NAV_BTN_WIDTH for the left/right buttons.
  const navOverhead = HT_NAV_BTN_WIDTH * 2;
  const contentAvailable = totalAvailable - navOverhead;

  if (naturalWidth > contentAvailable) {
    htOverflow.value = true;
    content.style.maxWidth = `${contentAvailable}px`;
    // Reset scroll offset to the leftmost position so the user starts at
    // the beginning of the toolbar on each re-render.
    content.scrollLeft = 0;
    updateHtScrollState();
  } else {
    htOverflow.value = false;
    content.style.maxWidth = '';
    content.scrollLeft = 0;
    canHtScrollLeft.value = false;
    canHtScrollRight.value = false;
  }
}

/** Update left/right scroll availability flags. */
function updateHtScrollState(): void {
  const el = htContentEl.value;
  if (!el) return;
  canHtScrollLeft.value = el.scrollLeft > 0;
  canHtScrollRight.value = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
}

/** Scroll the toolbar content by one step in the given direction. */
function htScrollBy(dir: 1 | -1): void {
  const el = htContentEl.value;
  if (!el) return;
  el.scrollLeft += dir * HT_SCROLL_STEP;
  updateHtScrollState();
}

watch(
  [() => props.visible, () => props.selectionRect, toolbarEl],
  async () => {
    if (!props.visible || !props.selectionRect || !props.rootEl) return;
    const el = toolbarEl.value;
    if (!el) return;
    // Step 1: measure overflow FIRST (this sets content.style.maxWidth and
    // toggles htOverflow → adds/removes the nav buttons).  We must do this
    // BEFORE reading getBoundingClientRect(), otherwise we'd be sizing with
    // the pre-adjustment width and the final clamp would be wrong, causing
    // the toolbar to overflow the right edge when text is selected near the
    // right viewport boundary.
    measureHtOverflow();
    // Let Vue re-render the buttons/maxWidth and the browser reflow.
    await nextTick();
    const rect = el.getBoundingClientRect();
    // Use the ACTUAL rendered width/height for positioning so the viewport
    // clamp in placeBelowSelection operates on accurate dimensions.
    const actualWidth = rect.width;
    const actualHeight = Math.max(rect.height, TOOLBAR_HEIGHT);
    placement.value = placeSelection(props.rootEl, props.selectionRect, {
      width: actualWidth,
      height: actualHeight,
    });
  },
  { flush: 'post', immediate: true },
);

const shellStyle = computed(() => ({
  top: '0px',
  left: '0px',
  width: '100vw',
  height: '100vh',
}));

const toolbarStyle = computed(() => {
  const el = toolbarEl.value;
  const toolbarW = el?.offsetWidth ?? TOOLBAR_WIDTH_EST;
  // Use clientWidth — it excludes the ~15–17px vertical scrollbar width
  // that window.innerWidth includes.  Otherwise this final clamp still
  // allows the toolbar right edge to be hidden behind the scrollbar.
  const viewportW = document.documentElement.clientWidth;
  const margin = 8;
  // Primary position from placement computation.
  let left = placement.value.left;
  // Final safety clamp: ensure the toolbar never overflows the left or right
  // viewport edge (with an 8px margin).  This guards against edge cases where
  // the width used for placement differs slightly from the final rendered
  // width (e.g. right after overflow toggling adds/removes nav buttons).
  const maxLeft = Math.max(margin, viewportW - toolbarW - margin);
  left = Math.max(margin, Math.min(maxLeft, left));

  const style: Record<string, string> = {
    top: `${placement.value.top}px`,
    left: `${left}px`,
  };
  // Position the arrow at the selection center (relative to the toolbar's
  // left edge) so it still points at the text even after the safety clamp
  // has shifted the toolbar horizontally.
  if (props.selectionRect) {
    const selCenter = props.selectionRect.left + props.selectionRect.width / 2;
    const arrowX = selCenter - left;
    // Clamp within the toolbar so the arrow stays visible.
    const clamped = Math.max(10, Math.min(toolbarW - 10, arrowX));
    style['--ht-arrow-x'] = `${clamped}px`;
  }
  return style;
});

// --- Dropdown management ---------------------------------------------------

async function toggleDropdown(kind: 'type' | 'align' | 'color'): Promise<void> {
  openDropdown.value = openDropdown.value === kind ? null : kind;
  if (openDropdown.value) {
    await nextTick();
    positionActiveDropdown();
  }
}

/**
 * Position the active dropdown: decide whether it pops below or above its
 * trigger button, and clamp its maxHeight to the available viewport space.
 *
 * Logic (consistent with BlockSettingsMenu's placeBelow + availableHeight
 * approach, plus a container-bottom-aware override):
 *
 *   1. Compute the dropdown's natural height and the space available below
 *      and above the trigger button (within the viewport).
 *   2. EXTRA RULE: if the toolbar itself is very close to the bottom edge of
 *      the editor root container AND there's a lot of space above, force the
 *      dropdown to pop UP — even if the button still has some room below.
 *      This prevents the dropdown from overflowing the container.
 *   3. Otherwise: if the natural height fits below → below; else pick the
 *      side with more space.
 *   4. Clamp maxHeight to [120, 360] so the dropdown never gets too tall.
 */
const NEAR_BOTTOM_THRESHOLD = 200; // px — toolbar within this distance of container bottom is "near"

function positionActiveDropdown(): void {
  const kind = openDropdown.value;
  if (!kind) return;
  const dropdown = kind === 'type'
    ? typeDropdownEl.value
    : kind === 'align'
      ? alignDropdownEl.value
      : colorDropdownEl.value;
  const btn = kind === 'type'
    ? typeBtnEl.value
    : kind === 'align'
      ? alignBtnEl.value
      : colorBtnEl.value;
  if (!dropdown || !btn) return;
  const btnRect = btn.getBoundingClientRect();
  const viewportH = window.innerHeight;
  const margin = 6;
  const spaceBelow = Math.floor(viewportH - btnRect.bottom - margin);
  const spaceAbove = Math.floor(btnRect.top - margin);
  const natural = dropdown.scrollHeight;

  // Extra rule: toolbar near container bottom + lots of space above → force up.
  let forceAbove = false;
  if (props.rootEl && toolbarEl.value) {
    const rootRect = props.rootEl.getBoundingClientRect();
    const toolbarRect = toolbarEl.value.getBoundingClientRect();
    const distToContainerBottom = rootRect.bottom - toolbarRect.bottom;
    if (distToContainerBottom < NEAR_BOTTOM_THRESHOLD && spaceAbove > NEAR_BOTTOM_THRESHOLD) {
      forceAbove = true;
    }
  }

  let above = false;
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
  dropdownAbove.value = above;
  dropdownMaxHeight.value = Math.max(120, Math.min(maxH, 360));
  nextTick(updateScrollState);
}

// --- Scroll state (up/down buttons + wheel + touch) -----------------------

function updateScrollState(): void {
  const el = scrollEl.value;
  if (!el) {
    canScrollUp.value = false;
    canScrollDown.value = false;
    return;
  }
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

// Wheel + touch scroll support on the dropdown scroll container.
useMenuScroll(scrollEl, updateScrollState);

// --- Actions --------------------------------------------------------------

function onTypePick(opt: TypeOption): void {
  const cb = getCrossBlockRanges();
  if (cb) {
    for (const r of cb.ranges) {
      editor.commands.convertBlock?.({
        id: r.id,
        type: opt.convertType as string,
        attrs: opt.convertAttrs ?? {},
      });
    }
    openDropdown.value = null;
    emit('close');
    return;
  }
  if (!currentBlockId.value) return;
  editor.commands.convertBlock?.({
    id: currentBlockId.value,
    type: opt.convertType as string,
    attrs: opt.convertAttrs ?? {},
  });
  openDropdown.value = null;
  emit('close');
}

function onAlignPick(align: AlignValue): void {
  const cb = getCrossBlockRanges();
  if (cb) {
    for (const r of cb.ranges) {
      editor.commands.setBlockAlign?.({ id: r.id, align });
    }
    openDropdown.value = null;
    return;
  }
  if (!currentBlockId.value) return;
  editor.commands.setBlockAlign?.({ id: currentBlockId.value, align });
  openDropdown.value = null;
}

function onTextColorPick(key: string): void {
  const cb = getCrossBlockRanges();
  if (cb) {
    for (const r of cb.ranges) {
      editor.commands.setInlineMark?.({
        id: r.id,
        markType: 'color',
        attrs: key === 'default' ? null : { color: key },
        from: r.from,
        to: r.to,
      });
    }
    return;
  }
  if (!currentBlockId.value) return;
  const range = getSelectionOffsets();
  if (!range) return;
  editor.commands.setInlineMark?.({
    id: currentBlockId.value,
    markType: 'color',
    attrs: key === 'default' ? null : { color: key },
    from: range.from,
    to: range.to,
  });
  // setInlineMark rewrites innerHTML (to render the new color span), which
  // used to destroy the DOM selection and cause us to blindly close the
  // toolbar (making the user think "setting the color didn't work").
  // BlockContent.vue now restores the character selection after the write;
  // but even if that restore hasn't run yet, we still update the active
  // swatches via the state-based fallback in updateActiveColors().
  nextTick(() => {
    const sel = window.getSelection();
    const blockEl = props.rootEl?.querySelector(`[data-block-id="${props.blockId}"]`);
    const r = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
    const blockStillAlive = !!blockEl;
    const rangeStillInBlock = !!(r && blockEl && blockEl.contains(r.commonAncestorContainer));
    const selectionStillValid = !!(r && !r.collapsed && rangeStillInBlock);
    // Close ONLY if the entire block has vanished (e.g. the block was
    // deleted). Otherwise keep the toolbar around and refresh state so the
    // swatches show the color the user just applied.
    if (!blockStillAlive) {
      emit('close');
      return;
    }
    if (!selectionStillValid && !rangeStillInBlock) {
      emit('close');
      return;
    }
    updateActiveColors();
    updateActiveMarks();
  });
}

function onBgColorPick(key: string): void {
  const cb = getCrossBlockRanges();
  if (cb) {
    for (const r of cb.ranges) {
      editor.commands.setInlineMark?.({
        id: r.id,
        markType: 'bgColor',
        attrs: key === 'default' ? null : { bgColor: key },
        from: r.from,
        to: r.to,
      });
    }
    return;
  }
  if (!currentBlockId.value) return;
  const range = getSelectionOffsets();
  if (!range) return;
  editor.commands.setInlineMark?.({
    id: currentBlockId.value,
    markType: 'bgColor',
    attrs: key === 'default' ? null : { bgColor: key },
    from: range.from,
    to: range.to,
  });
  nextTick(() => {
    const sel = window.getSelection();
    const blockEl = props.rootEl?.querySelector(`[data-block-id="${props.blockId}"]`);
    const r = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
    const blockStillAlive = !!blockEl;
    const rangeStillInBlock = !!(r && blockEl && blockEl.contains(r.commonAncestorContainer));
    const selectionStillValid = !!(r && !r.collapsed && rangeStillInBlock);
    if (!blockStillAlive) {
      emit('close');
      return;
    }
    if (!selectionStillValid && !rangeStillInBlock) {
      emit('close');
      return;
    }
    updateActiveColors();
    updateActiveMarks();
  });
}

/** Detect inline color/bgColor marks in the current selection. */
function updateActiveColors(): void {
  // Try DOM-based path first (current selection).
  if (props.visible && props.blockId && props.rootEl) {
    const blockEl = props.rootEl.querySelector(`[data-block-id="${props.blockId}"]`);
    const sel = window.getSelection();
    if (blockEl && sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      if (!range.collapsed && blockEl.contains(range.commonAncestorContainer)) {
        const colorKeys = new Set<string>();
        const bgKeys = new Set<string>();
        const textNodes: Text[] = [];
        const walker = document.createTreeWalker(blockEl, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const node = walker.currentNode as Text;
          if ((node.nodeValue ?? '').length === 0) continue;
          if (!range.intersectsNode(node)) continue;
          textNodes.push(node);
        }
        for (const node of textNodes) {
          let el: Node | null = node.parentNode;
          while (el && el !== blockEl) {
            if (el.nodeType === Node.ELEMENT_NODE) {
              const cls = (el as HTMLElement).className;
              if (typeof cls === 'string') {
                const cm = cls.match(/be-color-(\w+)/);
                if (cm) colorKeys.add(cm[1]!);
                const bm = cls.match(/be-bg-(\w+)/);
                if (bm) bgKeys.add(bm[1]!);
              }
            }
            el = el.parentNode;
          }
        }
        activeColor.value = colorKeys.size === 1 ? [...colorKeys][0]! : '';
        activeBgColor.value = bgKeys.size === 1 ? [...bgKeys][0]! : '';
        return;
      }
    }
  }
  // Fallback: read directly from editor state. This path fires after the
  // BlockContent watcher rewrites `innerHTML` and Chromium temporarily
  // collapses the native selection before our restore logic runs.
  const st = editor.getState();
  const blk = props.blockId ? st.doc.blocks.get(props.blockId) : undefined;
  if (!blk) {
    activeColor.value = '';
    activeBgColor.value = '';
    return;
  }
  // Determine the effective character range. Prefer the current DOM offsets;
  // otherwise assume the entire block text is selected (covers the
  // "tool was just opened" and "selection was lost after innerHTML write"
  // scenarios where the caller previously had a valid text selection).
  const offsets = getSelectionOffsets();
  const from = offsets ? offsets.from : 0;
  const to = offsets ? offsets.to : inlineText(blk.content).length;
  if (from >= to) {
    activeColor.value = '';
    activeBgColor.value = '';
    return;
  }
  const colorKeys = new Set<string>();
  const bgKeys = new Set<string>();
  let pos = 0;
  for (const run of blk.content) {
    if (run.type !== 'text') continue;
    const runStart = pos;
    const runEnd = pos + run.text.length;
    if (runEnd > from && runStart < to && run.marks) {
      for (const m of run.marks) {
        if (m.type === 'color' && m.attrs && typeof m.attrs.color === 'string') colorKeys.add(m.attrs.color);
        if (m.type === 'bgColor' && m.attrs && typeof m.attrs.bgColor === 'string') bgKeys.add(m.attrs.bgColor);
      }
    }
    pos = runEnd;
  }
  activeColor.value = colorKeys.size === 1 ? [...colorKeys][0]! : '';
  activeBgColor.value = bgKeys.size === 1 ? [...bgKeys][0]! : '';
}

/**
 * Get the character offsets [from, to) of the current DOM selection within
 * the block's contenteditable element. Used by toggleMark to know which
 * characters to apply the mark to.
 */
function getSelectionOffsets(): { from: number; to: number } | null {
  if (!props.blockId || !props.rootEl) return null;
  const blockEl = props.rootEl.querySelector(`[data-block-id="${props.blockId}"]`);
  if (!blockEl) return null;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (range.collapsed || !blockEl.contains(range.commonAncestorContainer)) return null;
  const preRange = document.createRange();
  preRange.selectNodeContents(blockEl);
  preRange.setEnd(range.startContainer, range.startOffset);
  const from = preRange.toString().length;
  preRange.setEnd(range.endContainer, range.endOffset);
  const to = preRange.toString().length;
  return { from: Math.min(from, to), to: Math.max(from, to) };
}

// --- Cross-block selection support ---------------------------------------
//
// When the selection spans multiple blocks, the native DOM Selection is empty
// (each block is an independent contenteditable). We read the selection from
// editor state instead, and apply operations to every covered block.

interface CrossBlockRange {
  /** Document-order list of covered blocks with their [from, to) ranges. */
  ranges: Array<{ id: BlockId; from: number; to: number }>;
}

/** If the current editor selection is a cross-block text selection, return
 *  the per-block character ranges it covers. Otherwise null. */
function getCrossBlockRanges(): CrossBlockRange | null {
  const sel = latestState.value.selection;
  if (sel.kind !== 'text' || !isCrossBlockText(sel)) return null;
  const doc = latestState.value.doc;
  const flat = flattenDoc(doc);
  const ia = flat.indexOf(sel.anchor.blockId);
  const ib = flat.indexOf(sel.focus.blockId);
  if (ia === -1 || ib === -1) return null;
  const [start, end] = ia <= ib ? [sel.anchor, sel.focus] : [sel.focus, sel.anchor];
  const startIdx = flat.indexOf(start.blockId);
  const endIdx = flat.indexOf(end.blockId);
  if (startIdx === -1 || endIdx === -1 || startIdx > endIdx) return null;
  const ranges: CrossBlockRange['ranges'] = [];
  for (let i = startIdx; i <= endIdx; i++) {
    const id = flat[i]!;
    const block = doc.blocks.get(id);
    if (!block) continue;
    const textLen = inlineText(block.content).length;
    let lo = 0;
    let hi = textLen;
    if (i === startIdx) lo = Math.min(start.offset, textLen);
    if (i === endIdx) hi = Math.min(end.offset, textLen);
    ranges.push({ id, from: lo, to: hi });
  }
  return { ranges };
}

/** Serialize the current cross-block selection to {text, html}. */
function serializeCrossBlock(): { text: string; html: string } | null {
  const sel = latestState.value.selection;
  if (sel.kind !== 'text' || !isCrossBlockText(sel)) return null;
  const cb = getCrossBlockRanges();
  if (!cb) return null;
  const doc = latestState.value.doc;
  const textParts: string[] = [];
  const htmlParts: string[] = [];
  for (const r of cb.ranges) {
    const block = doc.blocks.get(r.id);
    if (!block) continue;
    const [, rest1] = splitInline(block.content, r.from);
    const [selected] = splitInline(rest1, r.to - r.from);
    textParts.push(inlineText(selected));
    htmlParts.push(inlineToHtml(selected));
  }
  return { text: textParts.join('\n'), html: htmlParts.join('<br>') };
}

function onToggleMark(markType: string): void {
  const cb = getCrossBlockRanges();
  if (cb) {
    for (const r of cb.ranges) {
      editor.commands.toggleMark?.({
        id: r.id,
        markType,
        from: r.from,
        to: r.to,
      });
    }
    return;
  }
  if (!currentBlockId.value) return;
  const range = getSelectionOffsets();
  if (!range) return;
  editor.commands.toggleMark?.({
    id: currentBlockId.value,
    markType,
    from: range.from,
    to: range.to,
  });
  // toggleMark rewrites the block's innerHTML (to render the new tags),
  // which used to destroy the native selection and cause us to blindly
  // close the HoverToolbar — leading the user to think the click had no
  // effect. BlockContent.vue now restores the character selection after
  // the write, and our state-based fallback paths also kick in.
  nextTick(() => {
    marksVersion.value++;
    const sel = window.getSelection();
    const blockEl = props.rootEl?.querySelector(`[data-block-id="${props.blockId}"]`);
    const r = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
    const blockStillAlive = !!blockEl;
    const rangeStillInBlock = !!(r && blockEl && blockEl.contains(r.commonAncestorContainer));
    const selectionStillValid = !!(r && !r.collapsed && rangeStillInBlock);
    if (!blockStillAlive) {
      emit('close');
      return;
    }
    if (!selectionStillValid && !rangeStillInBlock) {
      emit('close');
      return;
    }
    updateActiveMarks();
    updateActiveColors();
  });
}

function onLinkClick(): void {
  // Pass selection offsets directly to avoid syncSelectionFromDom
  // which would trigger a re-render and destroy the DOM selection.
  if (currentBlockId.value) {
    const range = getSelectionOffsets();
    if (range) {
      emit('linkClick', currentBlockId.value, range.from, range.to);
    }
  }
}

function onCopy(): void {
  // Cross-block: serialize from editor state (native selection is empty).
  const cb = serializeCrossBlock();
  if (cb) {
    void navigator.clipboard?.writeText(cb.text);
    emit('close');
    return;
  }
  // Single-block: copy ONLY the selected text, not the whole block.
  const sel = window.getSelection();
  const text = sel ? sel.toString() : '';
  if (text) {
    void navigator.clipboard?.writeText(text);
  }
  emit('close');
}

function onDelete(): void {
  const cb = getCrossBlockRanges();
  if (cb) {
    // Remove all covered blocks (reverse order to keep indices valid).
    for (let i = cb.ranges.length - 1; i >= 0; i--) {
      editor.commands.removeBlock?.({ id: cb.ranges[i]!.id });
    }
    emit('close');
    return;
  }
  if (!currentBlockId.value) return;
  editor.commands.removeBlock?.({ id: currentBlockId.value });
  emit('close');
}

defineExpose({});

// Reposition on scroll/resize.
async function onScrollOrResize(): Promise<void> {
  if (props.visible && props.selectionRect && props.rootEl && toolbarEl.value) {
    // Same ordering as the watch callback: measure overflow → await reflow
    // → read actual rect → compute placement.
    measureHtOverflow();
    await nextTick();
    const rect = toolbarEl.value.getBoundingClientRect();
    placement.value = placeSelection(props.rootEl, props.selectionRect, {
      width: rect.width,
      height: Math.max(rect.height, TOOLBAR_HEIGHT),
    });
  }
  if (openDropdown.value) positionActiveDropdown();
  updateScrollState();
  // Refresh active marks since selection may have shifted.
  updateActiveMarks();
  updateActiveColors();
}

// Close dropdown on outside click.
function onWindowMouseDown(e: MouseEvent): void {
  if (!openDropdown.value) return;
  const dropdowns = [typeDropdownEl.value, alignDropdownEl.value, colorDropdownEl.value];
  const buttons = [typeBtnEl.value, alignBtnEl.value, colorBtnEl.value];
  for (const d of dropdowns) {
    if (d && d.contains(e.target as Node)) return;
  }
  for (const b of buttons) {
    if (b && b.contains(e.target as Node)) return;
  }
  openDropdown.value = null;
}

// Update active marks when toolbar becomes visible.
watch(() => props.visible, (v) => {
  if (v) {
    nextTick(() => {
      updateActiveMarks();
      updateActiveColors();
    });
  }
});

onMounted(() => {
  window.addEventListener('scroll', onScrollOrResize, true);
  window.addEventListener('resize', onScrollOrResize);
  window.addEventListener('mousedown', onWindowMouseDown, true);
  unsubscribe = editor.subscribe(() => {
    nextTick(() => {
      const state = editor.getState();
      latestState.value = state;
      marksVersion.value++;
      updateActiveMarks();
      updateActiveColors();
    });
  });
});
onBeforeUnmount(() => {
  window.removeEventListener('scroll', onScrollOrResize, true);
  window.removeEventListener('resize', onScrollOrResize);
  window.removeEventListener('mousedown', onWindowMouseDown, true);
  unsubscribe?.();
  unsubscribe = null;
});
</script>
