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
  <Teleport
    to="body"
    :disabled="mobile"
  >
    <div
      class="hover-toolbar-shell"
      :class="{ visible, 'mobile-shell': mobile, 'mobile-visible': mobile && visible }"
      :style="mobile ? undefined : shellStyle"
      :aria-hidden="!visible"
    >
      <div
        ref="toolbarEl"
        class="hover-toolbar"
        :class="{
          'above': placement.above,
          'below': !placement.above,
          'ht-overflow': htOverflow,
          'mobile-mode': mobile,
        }"
        :style="mobile ? undefined : toolbarStyle"
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
          @touchstart.stop
          @touchend.stop="onHtNavTouchEnd(-1, $event)"
          @click.prevent.stop
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
          :class="{ 'dropdown-open': !mobile && !!openDropdown }"
          @scroll="updateHtScrollState"
          @touchmove.passive="onHtTouchMove"
          @touchend.stop="onHtTouchEnd"
        >
          <!-- Block type dropdown (shown in all modes) -->
          <div class="ht-dropdown-wrap">
            <button
              ref="typeBtnEl"
              class="ht-btn ht-type-btn"
              :class="{ open: openDropdown === 'type', disabled: typeDisabled }"
              :title="t('hoverToolbar.typeBtnTitle')"
              :disabled="typeDisabled"
              @mousedown.prevent.stop="!typeDisabled && toggleDropdown('type')"
              @touchstart.stop="hireTap(() => { if (!typeDisabled) toggleDropdown('type'); }, $event)"
              @click.prevent.stop
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
            <!-- Teleport to body on mobile so the menu escapes the
                 .fixed-toolbar overflow:hidden clip. -->
            <Teleport
              to="body"
              :disabled="!mobile"
            >
              <div
                v-if="openDropdown === 'type'"
                ref="typeDropdownEl"
                class="ht-dropdown"
                :class="[mobile ? 'ht-dropdown-mobile' : '', { above: dropdownAbove }]"
                :style="[dropdownStyle, dropdownFixedStyle]"
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
            </Teleport>
          </div>
          <!-- Align dropdown (shown in all modes) -->
          <div class="ht-dropdown-wrap">
            <button
              ref="alignBtnEl"
              class="ht-btn ht-icon-only"
              :class="{ open: openDropdown === 'align', disabled: alignDisabled }"
              :title="t('hoverToolbar.alignBtnTitle')"
              :disabled="alignDisabled"
              @mousedown.prevent.stop="!alignDisabled && toggleDropdown('align')"
              @touchstart.stop="hireTap(() => { if (!alignDisabled) toggleDropdown('align'); }, $event)"
              @click.prevent.stop
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
            <!-- Teleport to body on mobile so the menu escapes the
                 .fixed-toolbar overflow:hidden clip. -->
            <Teleport
              to="body"
              :disabled="!mobile"
            >
              <div
                v-if="openDropdown === 'align'"
                ref="alignDropdownEl"
                class="ht-dropdown"
                :class="[mobile ? 'ht-dropdown-mobile' : '', { above: dropdownAbove }]"
                :style="[dropdownStyle, dropdownFixedStyle]"
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
            </Teleport>
          </div>
          <!-- Vertical align dropdown (only in table mode / cell edit mode) -->
          <div
            v-if="tableMode || cellEditMode"
            class="ht-dropdown-wrap"
          >
            <button
              ref="verticalAlignBtnEl"
              class="ht-btn ht-icon-only"
              :class="{ open: openDropdown === 'verticalAlign', disabled: alignDisabled }"
              :title="t('hoverToolbar.verticalAlignBtnTitle')"
              :disabled="alignDisabled"
              @mousedown.prevent.stop="!alignDisabled && toggleDropdown('verticalAlign')"
              @touchstart.stop="hireTap(() => { if (!alignDisabled) toggleDropdown('verticalAlign'); }, $event)"
              @click.prevent.stop
            >
              <svg
                viewBox="0 0 16 16"
                width="15"
                height="15"
                aria-hidden="true"
              >
                <template v-if="currentVerticalAlign === 'top'">
                  <line
                    x1="2"
                    y1="3"
                    x2="14"
                    y2="3"
                    stroke="currentColor"
                    stroke-width="1.3"
                    stroke-linecap="round"
                  />
                  <line
                    x1="4"
                    y1="7"
                    x2="12"
                    y2="7"
                    stroke="currentColor"
                    stroke-width="1.3"
                    stroke-linecap="round"
                  />
                  <line
                    x1="5"
                    y1="11"
                    x2="11"
                    y2="11"
                    stroke="currentColor"
                    stroke-width="1.3"
                    stroke-linecap="round"
                  />
                </template>
                <template v-else-if="currentVerticalAlign === 'bottom'">
                  <line
                    x1="5"
                    y1="5"
                    x2="11"
                    y2="5"
                    stroke="currentColor"
                    stroke-width="1.3"
                    stroke-linecap="round"
                  />
                  <line
                    x1="4"
                    y1="9"
                    x2="12"
                    y2="9"
                    stroke="currentColor"
                    stroke-width="1.3"
                    stroke-linecap="round"
                  />
                  <line
                    x1="2"
                    y1="13"
                    x2="14"
                    y2="13"
                    stroke="currentColor"
                    stroke-width="1.3"
                    stroke-linecap="round"
                  />
                </template>
                <template v-else>
                  <line
                    x1="5"
                    y1="3"
                    x2="11"
                    y2="3"
                    stroke="currentColor"
                    stroke-width="1.3"
                    stroke-linecap="round"
                  />
                  <line
                    x1="3"
                    y1="8"
                    x2="13"
                    y2="8"
                    stroke="currentColor"
                    stroke-width="1.3"
                    stroke-linecap="round"
                  />
                  <line
                    x1="5"
                    y1="13"
                    x2="11"
                    y2="13"
                    stroke="currentColor"
                    stroke-width="1.3"
                    stroke-linecap="round"
                  />
                </template>
              </svg>
            </button>
            <!-- Teleport to body on mobile so the menu escapes the
                 .fixed-toolbar overflow:hidden clip. -->
            <Teleport
              to="body"
              :disabled="!mobile"
            >
              <div
                v-if="openDropdown === 'verticalAlign'"
                ref="verticalAlignDropdownEl"
                class="ht-dropdown"
                :class="[mobile ? 'ht-dropdown-mobile' : '', { above: dropdownAbove }]"
                :style="[dropdownStyle, dropdownFixedStyle]"
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
                    v-for="va in verticalAlignOptions"
                    :key="va.id"
                    class="ht-dropdown-item ht-align-item"
                    :class="{ active: currentVerticalAlign === va.value }"
                    @mousedown.prevent.stop="onVerticalAlignPick(va.value)"
                  >
                    <svg
                      viewBox="0 0 16 16"
                      width="15"
                      height="15"
                      aria-hidden="true"
                    >
                      <template v-if="va.value === 'top'">
                        <line
                          x1="2"
                          y1="3"
                          x2="14"
                          y2="3"
                          stroke="currentColor"
                          stroke-width="1.3"
                          stroke-linecap="round"
                        />
                        <line
                          x1="4"
                          y1="7"
                          x2="12"
                          y2="7"
                          stroke="currentColor"
                          stroke-width="1.3"
                          stroke-linecap="round"
                        />
                        <line
                          x1="5"
                          y1="11"
                          x2="11"
                          y2="11"
                          stroke="currentColor"
                          stroke-width="1.3"
                          stroke-linecap="round"
                        />
                      </template>
                      <template v-else-if="va.value === 'bottom'">
                        <line
                          x1="5"
                          y1="5"
                          x2="11"
                          y2="5"
                          stroke="currentColor"
                          stroke-width="1.3"
                          stroke-linecap="round"
                        />
                        <line
                          x1="4"
                          y1="9"
                          x2="12"
                          y2="9"
                          stroke="currentColor"
                          stroke-width="1.3"
                          stroke-linecap="round"
                        />
                        <line
                          x1="2"
                          y1="13"
                          x2="14"
                          y2="13"
                          stroke="currentColor"
                          stroke-width="1.3"
                          stroke-linecap="round"
                        />
                      </template>
                      <template v-else>
                        <line
                          x1="5"
                          y1="3"
                          x2="11"
                          y2="3"
                          stroke="currentColor"
                          stroke-width="1.3"
                          stroke-linecap="round"
                        />
                        <line
                          x1="3"
                          y1="8"
                          x2="13"
                          y2="8"
                          stroke="currentColor"
                          stroke-width="1.3"
                          stroke-linecap="round"
                        />
                        <line
                          x1="5"
                          y1="13"
                          x2="11"
                          y2="13"
                          stroke="currentColor"
                          stroke-width="1.3"
                          stroke-linecap="round"
                        />
                      </template>
                    </svg>
                    <span>{{ va.label }}</span>
                    <svg
                      v-if="currentVerticalAlign === va.value"
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
            </Teleport>
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
            @touchstart.stop="hireTap(() => { if (!isMarkBtnDisabled(m.id)) onToggleMark(m.id); }, $event)"
            @click.prevent.stop
          >
            <SafeHtml :html="m.iconHtml" />
          </button>
          <!-- Link button (hidden in tableMode; shown in cellEditMode) -->
          <button
            v-if="!tableMode"
            class="ht-btn ht-icon-only"
            :class="{ active: activeMarks.has('link'), disabled: isMarkBtnDisabled('link') }"
            :title="t('hoverToolbar.linkBtnTitle')"
            :disabled="isMarkBtnDisabled('link')"
            @mousedown.prevent.stop="!isMarkBtnDisabled('link') && onLinkClick()"
            @touchstart.stop="hireTap(() => { if (!isMarkBtnDisabled('link')) onLinkClick(); }, $event)"
            @click.prevent.stop
          >
            <svg
              viewBox="0 0 1024 1024"
              width="15"
              height="15"
              aria-hidden="true"
            >
              <path
                d="M394.666667 298.666667a32 32 0 0 1 4.693333 63.658666l-4.693333 0.341334H298.666667a149.333333 149.333333 0 0 0-8.789334 298.410666L298.666667 661.333333h96a32 32 0 0 1 4.693333 63.658667L394.666667 725.333333H298.666667a213.333333 213.333333 0 0 1-10.666667-426.410666L298.666667 298.666667h96zM725.333333 298.666667a213.333333 213.333333 0 0 1 10.666667 426.410666L725.333333 725.333333h-96a32 32 0 0 1-4.693333-63.658666l4.693333-0.341334H725.333333a149.333333 149.333333 0 0 0 8.789334-298.410666L725.333333 362.666667h-96a32 32 0 0 1-4.693333-63.658667L629.333333 298.666667H725.333333zM298.666667 480h426.666666a32 32 0 0 1 4.352 63.701333L725.333333 544H298.666667a32 32 0 0 1-4.352-63.701333L298.666667 480h426.666666H298.666667z"
                fill="currentColor"
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
              @touchstart.stop="hireTap(() => { if (!isMarkBtnDisabled('color')) toggleDropdown('color'); }, $event)"
              @click.prevent.stop
            >
              <svg
                viewBox="0 0 1024 1024"
                width="15"
                height="15"
                aria-hidden="true"
              >
                <path
                  d="M163.797333 249.941333c125.44-167.082667 385.28-215.68 570.197334-100.693333 182.613333 113.493333 249.770667 331.818667 174.933333 536.618667-70.613333 193.408-256.682667 269.994667-390.784 172.714666-50.218667-36.437333-69.717333-82.133333-79.104-156.330666l-4.522667-42.112-1.92-16.981334c-5.248-39.850667-13.269333-57.685333-30.08-67.072-22.826667-12.714667-38.058667-13.013333-68.053333-1.408l-14.976 6.229334-7.637333 3.328c-43.264 18.773333-72.021333 25.386667-108.416 17.749333l-8.533334-2.005333-6.997333-2.005334c-118.997333-36.864-136.618667-198.272-24.106667-348.032z m41.984 286.549334l5.248 1.578666 5.717334 1.28c18.730667 3.712 34.730667 0.64 61.312-10.325333l25.685333-10.965333c51.285333-21.034667 84.693333-23.04 129.962667 2.133333 39.125333 21.845333 54.4 55.381333 62.165333 113.493333l2.261333 19.584 2.346667 22.698667 2.005333 18.005333c7.338667 58.069333 20.693333 89.173333 53.248 112.810667 97.066667 70.4 236.117333 13.184 293.12-142.890667 64.682667-177.152 7.424-363.264-148.650666-460.330666-156.8-97.450667-379.690667-55.722667-485.248 84.778666-88.533333 117.888-77.653333 225.28-9.173334 248.149334z m478.933334-85.077334a53.333333 53.333333 0 1 1 102.997333-27.605333 53.333333 53.333333 0 0 1-102.997333 27.605333z m21.077333 148.821334a53.333333 53.333333 0 1 1 103.04-27.605334 53.333333 53.333333 0 0 1-103.04 27.605334zM600.32 323.285333a53.333333 53.333333 0 1 1 103.04-27.605333 53.333333 53.333333 0 0 1-103.04 27.605333z m-1.194667 383.914667a53.333333 53.333333 0 1 1 102.997334-27.605333 53.333333 53.333333 0 0 1-102.997334 27.605333z m-149.205333-425.386667a53.333333 53.333333 0 1 1 103.04-27.562666 53.333333 53.333333 0 0 1-103.04 27.562666z"
                  fill="currentColor"
                />
              </svg>
            </button>
            <!-- Teleport to body on mobile so the menu escapes the
                 .fixed-toolbar overflow:hidden clip. -->
            <Teleport
              to="body"
              :disabled="!mobile"
            >
              <div
                v-if="openDropdown === 'color'"
                ref="colorDropdownEl"
                class="ht-dropdown ht-color-dropdown"
                :class="[mobile ? 'ht-dropdown-mobile' : '', { above: dropdownAbove }]"
                :style="[dropdownStyle, dropdownFixedStyle]"
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
            </Teleport>
          </div>
          <div class="ht-sep" />
          <!-- Copy (selection only) -->
          <button
            class="ht-btn ht-icon-only"
            :class="{ disabled: noTextSelection }"
            :title="t('hoverToolbar.copySelection')"
            :aria-label="t('hoverToolbar.copySelection')"
            :disabled="noTextSelection"
            @mousedown.prevent.stop="!noTextSelection && onCopy()"
            @touchstart.stop="hireTap(() => { if (!noTextSelection) onCopy(); }, $event)"
            @click.prevent.stop
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
          <!-- Table-mode specific buttons -->
          <template v-if="tableMode">
            <div
              v-if="showMerge || showSplit || showHeaderRow || showDelete"
              class="ht-sep"
            />
            <!-- Merge cells -->
            <button
              v-if="showMerge"
              class="ht-btn ht-icon-only"
              :title="t('table.mergeCells')"
              @mousedown.prevent.stop="emit('merge')"
              @touchstart.stop="hireTap(() => emit('merge'), $event)"
              @click.prevent.stop
            >
              <svg
                viewBox="0 0 1024 1024"
                width="15"
                height="15"
                fill="currentColor"
                aria-hidden="true"
              ><path d="M266.666667 128A138.666667 138.666667 0 0 0 128 266.666667v490.666666A138.666667 138.666667 0 0 0 266.666667 896h490.666666A138.666667 138.666667 0 0 0 896 757.333333V266.666667A138.666667 138.666667 0 0 0 757.333333 128H266.666667zM192 266.666667c0-41.216 33.450667-74.666667 74.666667-74.666667H469.333333v128H192V266.666667z m341.333333 437.333333h298.666667v53.333333a74.666667 74.666667 0 0 1-74.666667 74.666667H533.333333v-128z m298.666667-384h-298.666667v-128h224c41.216 0 74.666667 33.450667 74.666667 74.666667V320z m-362.666667 384v128H266.666667a74.666667 74.666667 0 0 1-74.666667-74.666667V704H469.333333zM192 384h640v256h-640V384z" /></svg>
            </button>
            <!-- Split cell -->
            <button
              v-if="showSplit"
              class="ht-btn ht-icon-only"
              :title="t('table.splitCell')"
              @mousedown.prevent.stop="emit('split')"
              @touchstart.stop="hireTap(() => emit('split'), $event)"
              @click.prevent.stop
            >
              <svg
                viewBox="0 0 1024 1024"
                width="15"
                height="15"
                fill="currentColor"
                aria-hidden="true"
              ><path d="M533.333333 426.666667H469.333333v170.666666h64v-170.666666z" /><path d="M128 266.666667A138.666667 138.666667 0 0 1 266.666667 128h490.666666A138.666667 138.666667 0 0 1 896 266.666667v490.666666A138.666667 138.666667 0 0 1 757.333333 896H266.666667A138.666667 138.666667 0 0 1 128 757.333333V266.666667zM266.666667 192A74.666667 74.666667 0 0 0 192 266.666667V320H469.333333v-128H266.666667z m565.333333 512h-298.666667v128h224a74.666667 74.666667 0 0 0 74.666667-74.666667V704z m0-437.333333a74.666667 74.666667 0 0 0-74.666667-74.666667H533.333333v128h298.666667V266.666667zM192 704v53.333333c0 41.216 33.450667 74.666667 74.666667 74.666667H469.333333v-128H192z m0-64h640V384h-640v256z" /></svg>
            </button>
            <!-- Toggle header row (only when entire table is selected) -->
            <button
              v-if="showHeaderRow"
              class="ht-btn ht-icon-only"
              :class="{ active: headerRowActive }"
              :title="t('table.toggleHeader')"
              @mousedown.prevent.stop="emit('tableHeaderRow')"
              @touchstart.stop="hireTap(() => emit('tableHeaderRow'), $event)"
              @click.prevent.stop
            >
              <svg
                viewBox="0 0 16 16"
                width="15"
                height="15"
                fill="none"
                stroke="currentColor"
                stroke-width="1.3"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              ><rect
                x="2"
                y="2"
                width="12"
                height="12"
                rx="1"
              /><path d="M2 6h12" /><path d="M5 2v4" /></svg>
            </button>
            <!-- Delete (row / col / table) -->
            <template v-if="showDelete">
              <div
                v-if="showMerge || showSplit || showHeaderRow"
                class="ht-sep"
              />
              <button
                class="ht-btn ht-danger ht-icon-only"
                :title="deleteLabel || t('hoverToolbar.deleteBlock')"
                @mousedown.prevent.stop="emit('delete')"
                @touchstart.stop="hireTap(() => emit('delete'), $event)"
                @click.prevent.stop
              >
                <SafeHtml :html="deleteIcon || '<svg viewBox=\'0 0 1024 1024\' width=\'15\' height=\'15\' fill=\'currentColor\' aria-hidden=\'true\'><path d=\'M128 266.666667A138.666667 138.666667 0 0 1 266.666667 128h490.666666A138.666667 138.666667 0 0 1 896 266.666667v246.272a276.096 276.096 0 0 0-64-30.250667V426.666667h-170.666667v56.021333a276.096 276.096 0 0 0-64 30.250667V426.666667h-170.666666v170.666666h86.272a276.096 276.096 0 0 0-30.250667 64H426.666667v170.666667h56.021333c7.381333 22.784 17.578667 44.245333 30.250667 64H266.666667A138.666667 138.666667 0 0 1 128 757.333333V266.666667zM266.666667 192A74.666667 74.666667 0 0 0 192 266.666667V362.666667h170.666667v-170.666667H266.666667zM192 426.666667v170.666666h170.666667v-170.666666h-170.666667z m469.333333-64h170.666667V266.666667a74.666667 74.666667 0 0 0-74.666667-74.666667H661.333333v170.666667z m-64-170.666667h-170.666666v170.666667h170.666666v-170.666667z m-405.333333 469.333333v96c0 41.216 33.450667 74.666667 74.666667 74.666667H362.666667v-170.666667h-170.666667z\'/><path d=\'M981.333333 746.666667a234.666667 234.666667 0 1 1-469.333333 0 234.666667 234.666667 0 0 1 469.333333 0z m-234.666666-30.165334l-70.229334-70.272a21.333333 21.333333 0 0 0-30.208 30.208l70.272 70.229334-70.272 70.229333a21.333333 21.333333 0 0 0 30.208 30.208l70.229334-70.272 70.229333 70.272a21.333333 21.333333 0 0 0 30.208-30.208L776.832 746.666667l70.272-70.229334a21.333333 21.333333 0 0 0-30.208-30.208L746.666667 716.501333z\'/></svg>'" />
              </button>
            </template>
          </template>
        </div>
        <!-- Right nav button (shown when content overflows) -->
        <button
          v-if="htOverflow"
          class="ht-nav-btn ht-nav-right"
          :class="{ disabled: !canHtScrollRight }"
          :title="t('ui.scrollRight')"
          :aria-label="t('ui.scrollRight')"
          @mousedown.prevent.stop="htScrollBy(1)"
          @touchstart.stop
          @touchend.stop="onHtNavTouchEnd(1, $event)"
          @click.prevent.stop
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
import { computed, ref, inject, watch, nextTick, onMounted, onBeforeUnmount, shallowRef } from 'vue';
import { placeBelowSelection as placeSelection, placePreferAbove } from './popup';
import { useEditor, fixedToolbarBottomKey } from '../context';
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
  // Table mode extras
  tableMode?: boolean;
  showDelete?: boolean;
  deleteLabel?: string;
  deleteIcon?: string;
  showMerge?: boolean;
  showSplit?: boolean;
  showHeaderRow?: boolean;
  headerRowActive?: boolean;
  // Cell edit mode: when editing a cell and text is selected, the toolbar
  // uses document.execCommand for marks/colors instead of editor.commands.
  cellEditMode?: boolean;
  // Table mode active state: pre-computed by the TableBlock renderer from
  // the selected cells. Used for button state feedback (active marks,
  // active colors) when there is no DOM text selection to inspect.
  tableActiveMarks?: Set<string>;
  tableActiveColor?: string;
  tableActiveBgColor?: string;
  tableActiveVerticalAlign?: string;
  // Inline mode: render as a static top bar instead of a floating toolbar.
  // Disables Teleport, absolute positioning, arrow, and fade animation.
  // The parent (FixedToolbar) provides the fixed bar container.
  mobile?: boolean;
}>();

const emit = defineEmits<{
  close: [];
  linkClick: [blockId: BlockId, from: number, to: number];
  delete: [];
  merge: [];
  split: [];
  tableHeaderRow: [];
  // Table cell operations (emitted in tableMode)
  tableType: [cellType: string];
  tableAlign: [align: string];
  tableVerticalAlign: [verticalAlign: string];
  tableMark: [markType: string];
  tableTextColor: [color: string | null];
  tableBgColor: [color: string | null];
  tableCopy: [];
}>();

const { t } = useI18n();

const editor = useEditor();
// When embedded in FixedToolbar, this flag tells dropdowns which way to pop:
// true → toolbar is at the bottom, dropdowns pop UPWARD.
const isFixedToolbarBottom = inject(fixedToolbarBottomKey, ref(false));
const toolbarEl = ref<HTMLElement | null>(null);
const typeDropdownEl = ref<HTMLElement | null>(null);
const alignDropdownEl = ref<HTMLElement | null>(null);
const verticalAlignDropdownEl = ref<HTMLElement | null>(null);
const colorDropdownEl = ref<HTMLElement | null>(null);
const typeBtnEl = ref<HTMLElement | null>(null);
const alignBtnEl = ref<HTMLElement | null>(null);
const verticalAlignBtnEl = ref<HTMLElement | null>(null);
const colorBtnEl = ref<HTMLElement | null>(null);
const placement = ref({ top: 0, left: 0, above: false });
const openDropdown = ref<'type' | 'align' | 'verticalAlign' | 'color' | null>(null);
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
// In inline mode, dropdowns are teleported to <body> (to escape the
// .fixed-toolbar overflow:hidden clip). We need position:fixed coords
// (left/top or bottom relative to the viewport), computed from the trigger
// button's getBoundingClientRect.
const dropdownFixedRect = ref<{ left: number; top?: number; bottom?: number; right?: number } | null>(null);
const dropdownFixedStyle = computed(() => {
  if (!props.mobile || !dropdownFixedRect.value) return undefined;
  const r = dropdownFixedRect.value;
  const style: Record<string, string> = {
    position: 'fixed',
    left: `${r.left}px`,
  };
  if (r.top !== undefined) style.top = `${r.top}px`;
  if (r.bottom !== undefined) style.bottom = `${r.bottom}px`;
  if (r.right !== undefined) style.right = `${r.right}px`;
  return style;
});
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
  if (props.cellEditMode || props.tableMode) {
    const v = props.blockAttrs.align;
    return (typeof v === 'string' ? v : 'left') as AlignValue;
  }
  const v = currentBlock.value?.attrs.align;
  return (typeof v === 'string' ? v : 'left') as AlignValue;
});

type VerticalAlignValue = 'top' | 'middle' | 'bottom';

const currentVerticalAlign = computed<VerticalAlignValue>(() => {
  if (props.tableMode) {
    const v = props.tableActiveVerticalAlign;
    return (typeof v === 'string' ? v : 'middle') as VerticalAlignValue;
  }
  if (props.cellEditMode) {
    const v = props.blockAttrs.verticalAlign;
    return (typeof v === 'string' ? v : 'middle') as VerticalAlignValue;
  }
  return 'middle';
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

/** Find the container element for mark/color detection. In normal mode this
 *  is the [data-block-id] element; in cellEditMode it's the .table-cell-inner
 *  that contains the current selection. */
function findMarkContainer(): HTMLElement | null {
  if (!props.rootEl) return null;
  if (props.cellEditMode) {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);
    const container = (range.commonAncestorContainer.nodeType === 1
      ? (range.commonAncestorContainer as HTMLElement)
      : range.commonAncestorContainer.parentElement
    )?.closest('.table-cell-inner') as HTMLElement | null;
    return container;
  }
  return props.rootEl.querySelector(`[data-block-id="${props.blockId}"]`);
}

function updateActiveMarks(): void {
  const marks = new Set<string>();
  if (!props.visible || !props.blockId || !props.rootEl) {
    activeMarks.value = marks;
    return;
  }
  // In tableMode (cell selection, not cell edit), there is no DOM text
  // selection to inspect. Use the pre-computed marks from the TableBlock
  // renderer instead.
  if (props.tableMode && props.tableActiveMarks) {
    activeMarks.value = new Set(props.tableActiveMarks);
    return;
  }
  // ---- DOM-based path: try the current selection.
  const blockEl = findMarkContainer();
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
          // Only commit the DOM-derived set when it actually found a mark. If
          // the DOM selection is momentarily unavailable or still reflects a
          // just-rewritten tree (e.g. right after toggling bold/italic/color —
          // Chromium briefly collapses the selection before BlockContent
          // re-applies it), fall through to the authoritative editor-state
          // computation below. Otherwise the buttons would blank to "not
          // active" for one frame and stay that way because the DOM read
          // races the re-render.
          if (marks.size > 0) {
            activeMarks.value = marks;
            return;
          }
        }
      }
    }
  }

  // ---- State-based fallback: used when the DOM selection is unavailable or
  // has not yet been re-added after a DOM rewrite (e.g. right after a mark
  // command rewrites innerHTML, or on mobile where the touch interaction
  // transiently clears the DOM selection). We read the authoritative editor
  // selection (latestState) instead of the DOM, which is reliable on mobile.
  const st = latestState.value;
  const blk = props.blockId ? st.doc.blocks.get(props.blockId) : undefined;
  if (!blk) {
    activeMarks.value = marks;
    return;
  }
  // Resolve [from, to) from the editor selection for THIS block. For a text
  // selection that spans this block, use the anchor/focus offsets; otherwise
  // fall back to the DOM selection offsets.
  const stSel = st.selection;
  let from = 0;
  let to = inlineText(blk.content).length;
  if (stSel.kind === 'text' && stSel.anchor.blockId === props.blockId && stSel.focus.blockId === props.blockId) {
    from = Math.min(stSel.anchor.offset, stSel.focus.offset);
    to = Math.max(stSel.anchor.offset, stSel.focus.offset);
  } else {
    const offsets = getSelectionOffsets();
    if (offsets) {
      from = offsets.from;
      to = offsets.to;
    }
  }
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

// In mobile mode without a text selection, the bottom toolbar is always shown
// but its selection-dependent buttons (marks / color / copy) are disabled.
// Block-level actions (type / align) remain enabled as long as a block is
// focused, because they operate on the entire block not the text range.
// tableMode and cellEditMode are handled separately (their own
// selectionRect is supplied by the table renderer).
const noTextSelection = computed(() =>
  props.mobile && !props.tableMode && !props.cellEditMode && !props.selectionRect,
);

// Block-level: code blocks disallow all inline marks.
const marksDisabled = computed(() =>
  noTextSelection.value || props.blockType === 'codeBlock',
);

// Block-level type selector — only disabled when there's no focused block at all.
// Unlike marks, it works on the whole block even without a text selection.
const typeDisabled = computed(() => {
  if (props.tableMode || props.cellEditMode) return noTextSelection.value;
  return !props.blockId;
});

/** 当前块是否支持对齐属性（代码块只允许左对齐）。
 *  块级操作：光标在块内即可交互，无需文本选区。
 *  代码块例外：对齐方式不允许被交互。 */
const alignDisabled = computed(() => {
  if (props.tableMode || props.cellEditMode) {
    if (noTextSelection.value) return true;
    return props.blockType === 'codeBlock';
  }
  if (!props.blockId) return true;
  if (props.blockType === 'codeBlock') return true;
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
  if (props.tableMode || props.cellEditMode) {
    // codeBlock cells: no inline marks at all (mirrors text-block codeBlock).
    if (props.blockType === 'codeBlock') return true;
    // quote cells: italic disabled (quote is already italic via CSS).
    if (props.blockType === 'quote' && markId === 'italic') return true;
    // Inline code incompatibility: when the selection is inline code, all
    // other formatting marks are disabled (code wins). The code button
    // itself stays enabled so it can be toggled off.
    if (markId !== 'code' && activeMarks.value.has('code')) return true;
    return false;
  }
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

  const all = [
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
  // All block types are available in all modes (including table/cell-edit).
  return all;
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

const verticalAlignOptions = computed<{ id: string; label: string; value: VerticalAlignValue }[]>(() => [
  { id: 'top', label: t('verticalAlign.top'), value: 'top' },
  { id: 'middle', label: t('verticalAlign.middle'), value: 'middle' },
  { id: 'bottom', label: t('verticalAlign.bottom'), value: 'bottom' },
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
  // Preserve the current horizontal scroll offset. Temporarily removing
  // maxWidth below makes the container as wide as its content (no overflow),
  // which makes the browser reset scrollLeft to 0; we restore it afterwards
  // (clamped) so the left/right nav buttons can actually scroll without the
  // content snapping back to the start.
  const prevScrollLeft = content.scrollLeft;
  // Temporarily remove any prior maxWidth so we can measure the true natural
  // scrollWidth (the total width of all flex children without wrapping).
  content.style.maxWidth = '';
  // Force a reflow so scrollWidth reflects the unbounded size.
  const _unused = content.offsetWidth;
  void _unused;
  const naturalWidth = content.scrollWidth;
  // Available width for the toolbar content area.
  // - Inline mode: the toolbar lives inside FixedToolbar's content row
  //   (which already subtracts the plus/handle buttons). Use the parent
  //   element's clientWidth so the overflow threshold matches the actual
  //   container, not the full viewport.
  // - Floating mode: use the viewport clientWidth (excluding scrollbar)
  //   with a 16px margin on each side.
  const totalAvailable = props.mobile
    ? Math.max(120, (el.parentElement?.clientWidth ?? el.clientWidth) - 8)
    : Math.max(200, document.documentElement.clientWidth - 32);

  // If overflowing, we need 2 × HT_NAV_BTN_WIDTH for the left/right buttons.
  const navOverhead = HT_NAV_BTN_WIDTH * 2;
  const contentAvailable = totalAvailable - navOverhead;

  if (naturalWidth > contentAvailable) {
    htOverflow.value = true;
    content.style.maxWidth = `${contentAvailable}px`;
    // Restore the previous scroll offset, clamped to the valid range after
    // the re-layout.
    const maxScroll = Math.max(0, content.scrollWidth - content.clientWidth);
    content.scrollLeft = Math.min(prevScrollLeft, maxScroll);
    updateHtScrollState();
  } else {
    htOverflow.value = false;
    content.style.maxWidth = '';
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
  // Close any open dropdown when navigating left/right.
  openDropdown.value = null;
  const el = htContentEl.value;
  if (!el) return;
  el.scrollLeft += dir * HT_SCROLL_STEP;
  updateHtScrollState();
}

// --- Mobile tap vs. horizontal-swipe discrimination -----------------------
//
// The buttons used to run their action from `touchstart` with `.prevent`,
// but `preventDefault()` on touchstart cancels the native `pan-x` scroll of
// the .ht-content strip, so the user could not swipe the toolbar left/right
// (and a swipe starting on a button would also fire that button's action).
//
// New scheme:
//   • Button `touchstart` no longer prevents anything and only registers the
//     pending action + start point (`hireTap`). No `.prevent` → the OS can
//     still start a horizontal pan.
//   • The .ht-content container owns `touchmove` (marks a swipe once the
//     finger travels far enough) and `touchend` (runs the pending action
//     ONLY if it was a tap, and `preventDefault()`s to suppress the synthetic
//     mouse events so the desktop `mousedown` action doesn't fire twice).
//   • Desktop keeps using `mousedown` (touch events never fire there).
const HT_TAP_SLOP = 10; // px of movement that still counts as a tap
let pendingTapAction: (() => void) | null = null;
let pressedStartX = 0;
let pressedStartY = 0;
let pressActive = false;
let swipeDetected = false;

function onHtTouchMove(e: TouchEvent): void {
  if (!pressActive) return;
  const t = e.touches[0];
  if (!t) return;
  const dx = Math.abs(t.clientX - pressedStartX);
  const dy = Math.abs(t.clientY - pressedStartY);
  if (dx > HT_TAP_SLOP || dy > HT_TAP_SLOP) {
    if (!swipeDetected) {
      // A swipe just started — close any open dropdown.
      openDropdown.value = null;
    }
    swipeDetected = true;
  }
}

function onHtTouchEnd(e: TouchEvent): void {
  if (!pressActive) return;
  const act = pendingTapAction;
  pendingTapAction = null;
  pressActive = false;
  const swipe = swipeDetected;
  swipeDetected = false;
  if (!swipe) {
    // Only a tap needs to suppress the synthetic mouse events (the desktop
    // mousedown handler would otherwise fire the same action twice). During
    // a swipe the browser may be mid-scroll and the event is non-cancelable,
    // so guard with `cancelable` to avoid the console intervention warning.
    if (e.cancelable) e.preventDefault();
    if (act) act();
  }
}

/** Run the left/right scroll button action on touchend. `preventDefault`
 *  suppresses the synthetic mousedown that would double-fire `htScrollBy`,
 *  but only when the event is cancelable (it is not during an active scroll). */
function onHtNavTouchEnd(dir: 1 | -1, e: TouchEvent): void {
  if (e.cancelable) e.preventDefault();
  htScrollBy(dir);
}

/** Register a button's action so it runs on `touchend` only when the touch
 *  turns out to be a tap (not a horizontal swipe of the toolbar strip). */
function hireTap(act: () => void, e: TouchEvent): void {
  const t = e.touches[0];
  if (t) {
    pressedStartX = t.clientX;
    pressedStartY = t.clientY;
  }
  pendingTapAction = act;
  pressActive = true;
  swipeDetected = false;
}

watch(
  [() => props.visible, () => props.selectionRect, toolbarEl, () => props.mobile],
  async () => {
    // Mobile mode: no floating placement — just measure overflow so the
    // left/right nav buttons work inside the fixed bottom bar.
    if (props.mobile) {
      if (props.visible) measureHtOverflow();
      return;
    }
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
    placement.value = (props.tableMode
      ? placePreferAbove(props.rootEl, props.selectionRect, {
          width: actualWidth,
          height: actualHeight,
        })
      : placeSelection(props.rootEl, props.selectionRect, {
          width: actualWidth,
          height: actualHeight,
        }));
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

async function toggleDropdown(kind: 'type' | 'align' | 'verticalAlign' | 'color'): Promise<void> {
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
      : kind === 'verticalAlign'
        ? verticalAlignDropdownEl.value
        : colorDropdownEl.value;
  const btn = kind === 'type'
    ? typeBtnEl.value
    : kind === 'align'
      ? alignBtnEl.value
      : kind === 'verticalAlign'
        ? verticalAlignBtnEl.value
        : colorBtnEl.value;
  if (!dropdown || !btn) return;
  const btnRect = btn.getBoundingClientRect();
  const viewportH = window.innerHeight;
  const margin = 6;
  const spaceBelow = Math.floor(viewportH - btnRect.bottom - margin);
  const spaceAbove = Math.floor(btnRect.top - margin);
  const natural = dropdown.scrollHeight;

  // Mobile/inline mode: the toolbar is pinned to either the viewport top or
  // bottom (FixedToolbar). Use the injected `fixedToolbarBottomKey` flag
  // (provided by FixedToolbar based on its `position` prop) to decide which
  // way dropdowns pop — bottom bar → UPWARD, top bar → downward.
  // Dropdowns are teleported to <body>, so we compute position:fixed coords
  // using the viewport-relative button rect (escapes the .fixed-toolbar
  // overflow:hidden clip).
  if (props.mobile) {
    const vh = document.documentElement.clientHeight;
    const VIEWPORT_GAP = 10; // keep 10px from the viewport edge the dropdown grows toward
    const popUpward = isFixedToolbarBottom.value;
    if (popUpward) {
      // Fixed at bottom — pop upward. Reserve VIEWPORT_GAP at the viewport top.
      dropdownAbove.value = true;
      dropdownMaxHeight.value = Math.max(120, spaceAbove - VIEWPORT_GAP);
      const bottomVal = vh - btnRect.top + margin;
      if (kind === 'color') {
        const vw = document.documentElement.clientWidth;
        dropdownFixedRect.value = {
          left: 8,
          bottom: bottomVal,
          right: Math.max(8, vw - btnRect.right),
        };
      } else {
        dropdownFixedRect.value = {
          left: Math.max(8, btnRect.left),
          bottom: bottomVal,
        };
      }
    } else {
      // Fixed at top — pop downward. Reserve VIEWPORT_GAP at the viewport bottom.
      dropdownAbove.value = false;
      dropdownMaxHeight.value = Math.max(120, spaceBelow - VIEWPORT_GAP);
      const topVal = btnRect.bottom + margin;
      if (kind === 'color') {
        const vw = document.documentElement.clientWidth;
        dropdownFixedRect.value = {
          left: 8,
          top: topVal,
          right: Math.max(8, vw - btnRect.right),
        };
      } else {
        dropdownFixedRect.value = {
          left: Math.max(8, btnRect.left),
          top: topVal,
        };
      }
    }
    nextTick(updateScrollState);
    return;
  }
  // Desktop / floating mode: no fixed rect needed (absolute within wrap).
  dropdownFixedRect.value = null;

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
  if (props.tableMode || props.cellEditMode) {
    // Map heading + level to table cell type (heading1, heading2, etc.)
    // so the TableBlock renderer can store the correct cellType.
    if (opt.convertType === 'heading' && opt.convertAttrs?.level) {
      emit('tableType', `heading${opt.convertAttrs.level}`);
    } else {
      emit('tableType', opt.convertType);
    }
    openDropdown.value = null;
    if (props.tableMode) emit('close');
    return;
  }
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
  if (props.tableMode || props.cellEditMode) {
    emit('tableAlign', align);
    openDropdown.value = null;
    return;
  }
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

function onVerticalAlignPick(verticalAlign: VerticalAlignValue): void {
  if (props.tableMode || props.cellEditMode) {
    emit('tableVerticalAlign', verticalAlign);
    openDropdown.value = null;
    return;
  }
  openDropdown.value = null;
}

function onTextColorPick(key: string): void {
  if (props.tableMode) {
    emit('tableTextColor', key === 'default' ? null : key);
    openDropdown.value = null;
    return;
  }
  if (props.cellEditMode) {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
      const range = sel.getRangeAt(0);
      if (key === 'default') {
        // Remove be-color-* spans from the extracted selection.
        const frag = range.extractContents();
        frag.querySelectorAll('span[class*="be-color-"]').forEach((span) => {
          const cls = span.className.replace(/be-color-\w+/g, '').trim();
          if (cls) span.className = cls;
          else {
            while (span.firstChild) span.parentNode!.insertBefore(span.firstChild, span);
            span.parentNode!.removeChild(span);
          }
        });
        range.insertNode(frag);
      } else {
        const span = document.createElement('span');
        span.className = `be-color-${key}`;
        span.appendChild(range.extractContents());
        range.insertNode(span);
        sel.removeAllRanges();
        const nr = document.createRange();
        nr.selectNodeContents(span);
        sel.addRange(nr);
      }
    }
    openDropdown.value = null;
    updateActiveColors();
    return;
  }
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
  if (props.tableMode) {
    emit('tableBgColor', key === 'default' ? null : key);
    openDropdown.value = null;
    return;
  }
  if (props.cellEditMode) {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
      const range = sel.getRangeAt(0);
      if (key === 'default') {
        // Remove be-bg-* spans from the extracted selection.
        const frag = range.extractContents();
        frag.querySelectorAll('span[class*="be-bg-"]').forEach((span) => {
          const cls = span.className.replace(/be-bg-\w+/g, '').trim();
          if (cls) span.className = cls;
          else {
            while (span.firstChild) span.parentNode!.insertBefore(span.firstChild, span);
            span.parentNode!.removeChild(span);
          }
        });
        range.insertNode(frag);
      } else {
        const span = document.createElement('span');
        span.className = `be-bg-${key}`;
        span.appendChild(range.extractContents());
        range.insertNode(span);
        sel.removeAllRanges();
        const nr = document.createRange();
        nr.selectNodeContents(span);
        sel.addRange(nr);
      }
    }
    openDropdown.value = null;
    updateActiveColors();
    return;
  }
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
  // In tableMode, use the pre-computed values from the TableBlock renderer.
  if (props.tableMode) {
    activeColor.value = props.tableActiveColor ?? '';
    activeBgColor.value = props.tableActiveBgColor ?? '';
    return;
  }
  // Try DOM-based path first (current selection).
  if (props.visible && props.blockId && props.rootEl) {
    const blockEl = findMarkContainer();
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
        // Only commit the DOM-derived colors when at least one is found; if
        // the DOM selection races a just-rewritten tree (same as marks above),
        // fall through to the editor-state computation below.
        if (colorKeys.size > 0 || bgKeys.size > 0) {
          activeColor.value = colorKeys.size === 1 ? [...colorKeys][0]! : '';
          activeBgColor.value = bgKeys.size === 1 ? [...bgKeys][0]! : '';
          return;
        }
      }
    }
  }
  // Fallback: read directly from editor state. This path fires after the
  // BlockContent watcher rewrites `innerHTML` and Chromium temporarily
  // collapses the native selection before our restore logic runs (and on
  // mobile where the touch interaction may clear the DOM selection).
  const st = latestState.value;
  const blk = props.blockId ? st.doc.blocks.get(props.blockId) : undefined;
  if (!blk) {
    activeColor.value = '';
    activeBgColor.value = '';
    return;
  }
  // Determine the effective character range. Prefer the authoritative editor
  // selection for this block; otherwise the current DOM offsets; finally fall
  // back to the entire block (covers "tool just opened" and "selection lost
  // after innerHTML write" / mobile touch scenarios).
  const stSel = st.selection;
  let from: number;
  let to: number;
  if (stSel.kind === 'text' && stSel.anchor.blockId === props.blockId && stSel.focus.blockId === props.blockId) {
    from = Math.min(stSel.anchor.offset, stSel.focus.offset);
    to = Math.max(stSel.anchor.offset, stSel.focus.offset);
  } else {
    const offsets = getSelectionOffsets();
    from = offsets ? offsets.from : 0;
    to = offsets ? offsets.to : inlineText(blk.content).length;
  }
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
  if (props.tableMode) {
    emit('tableMark', markType);
    return;
  }
  if (props.cellEditMode) {
    // Map mark types to execCommand names.
    const cmdMap: Record<string, string> = {
      bold: 'bold',
      italic: 'italic',
      underline: 'underline',
      strikethrough: 'strikeThrough',
      code: 'insertHTML',
    };
    const cmd = cmdMap[markType];
    if (cmd === 'insertHTML') {
      // Wrap selection in <code> tags.
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
        const range = sel.getRangeAt(0);
        const codeEl = document.createElement('code');
        try {
          codeEl.appendChild(range.extractContents());
          range.insertNode(codeEl);
          sel.removeAllRanges();
          const newRange = document.createRange();
          newRange.selectNodeContents(codeEl);
          sel.addRange(newRange);
        } catch { /* ignore */ }
      }
    } else if (cmd) {
      document.execCommand(cmd);
    }
    updateActiveMarks();
    return;
  }
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
  // Cell edit mode: emit linkClick with dummy offsets. The TableBlock
  // renderer reads the selection directly from window.getSelection() to
  // open the LinkPopover, so offsets are not needed.
  if (props.cellEditMode) {
    emit('linkClick', currentBlockId.value ?? '' as BlockId, 0, 0);
    return;
  }
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
  if (props.tableMode) {
    emit('tableCopy');
    emit('close');
    return;
  }
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

defineExpose({});

// Reposition on scroll/resize.
async function onScrollOrResize(): Promise<void> {
  if (props.mobile) {
    // Mobile: no floating placement to refresh — just re-measure overflow
    // and update dropdown position if one is open.
    if (props.visible) measureHtOverflow();
    if (openDropdown.value) positionActiveDropdown();
    updateScrollState();
    updateActiveMarks();
    updateActiveColors();
    return;
  }
  if (props.visible && props.selectionRect && props.rootEl && toolbarEl.value) {
    // Same ordering as the watch callback: measure overflow → await reflow
    // → read actual rect → compute placement.
    measureHtOverflow();
    await nextTick();
    const rect = toolbarEl.value.getBoundingClientRect();
    placement.value = (props.tableMode
      ? placePreferAbove(props.rootEl, props.selectionRect, {
          width: rect.width,
          height: Math.max(rect.height, TOOLBAR_HEIGHT),
        })
      : placeSelection(props.rootEl, props.selectionRect, {
          width: rect.width,
          height: Math.max(rect.height, TOOLBAR_HEIGHT),
        }));
  }
  if (openDropdown.value) positionActiveDropdown();
  updateScrollState();
  // Refresh active marks since selection may have shifted.
  updateActiveMarks();
  updateActiveColors();
}

function closeDropdownIfOutside(target: EventTarget | null): void {
  if (!openDropdown.value) return;
  const dropdowns = [typeDropdownEl.value, alignDropdownEl.value, verticalAlignDropdownEl.value, colorDropdownEl.value];
  const buttons = [typeBtnEl.value, alignBtnEl.value, verticalAlignBtnEl.value, colorBtnEl.value];
  for (const d of dropdowns) {
    if (d && d.contains(target as Node)) return;
  }
  for (const b of buttons) {
    if (b && b.contains(target as Node)) return;
  }
  openDropdown.value = null;
}

// Close dropdown on outside click.
function onWindowMouseDown(e: MouseEvent): void {
  if (!props.visible) return;
  const toolbar = toolbarEl.value;
  // If the click was on the toolbar itself (including the left/right nav buttons
  // for horizontal scroll), do NOT close the toolbar. Also preventDefault so the
  // browser's default mousedown action (moving focus / clearing the selection)
  // never fires — otherwise in table cell-edit mode the selected text loses its
  // selection state and the toolbar disappears. This capture-phase handler runs
  // before the individual buttons' own `@mousedown.prevent`, guaranteeing the
  // selection is preserved even if a control forgets to preventDefault.
  if (toolbar && toolbar.contains(e.target as Node)) {
    e.preventDefault();
    return;
  }

  closeDropdownIfOutside(e.target);
}

// Touch variant of the above. On touch devices mousedown is synthesized only
// if no touch handler called preventDefault(), so the buttons use
// `@touchstart.prevent.stop` to trigger reliably. We add a capture touchstart
// listener here to mirror the mousedown logic: keep selection when tapping
// inside the toolbar, and close an open dropdown when tapping outside.
//
// IMPORTANT: we must NOT preventDefault touches inside the horizontal-scroll
// container (.ht-content), otherwise the touch scroll gesture is blocked and
// the user cannot swipe the toolbar left/right. We only preventDefault on the
// toolbar chrome OUTSIDE that container (nav buttons are outside it; the
// content strip scrolls natively).
function onWindowTouchStart(e: TouchEvent): void {
  if (!props.visible) return;
  const t = e.touches[0];
  if (!t) return;
  const target = e.target;
  const toolbar = toolbarEl.value;
  if (toolbar && toolbar.contains(target as Node)) {
    // Allow the scrollable content strip to receive touches (for horizontal
    // swiping). Only preserve the selection for touches on the fixed chrome
    // (nav buttons / separators) that sit outside the scroll container.
    const content = htContentEl.value;
    if (content && content.contains(target as Node)) {
      return;
    }
    e.preventDefault();
    return;
  }
  closeDropdownIfOutside(target);
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
  window.addEventListener('touchstart', onWindowTouchStart, true);
  // Refresh active mark/color state whenever the DOM selection changes (e.g.
  // the user selects a different text range). The editor only notifies on
  // document dispatch, so selection-only changes would otherwise never update
  // the button highlight until a scroll/resize happens.
  document.addEventListener('selectionchange', onDocumentSelectionChange);
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
  window.removeEventListener('touchstart', onWindowTouchStart, true);
  document.removeEventListener('selectionchange', onDocumentSelectionChange);
  unsubscribe?.();
  unsubscribe = null;
});

function onDocumentSelectionChange(): void {
  if (!props.visible) return;
  // Debounce via rAF so rapid selection changes don't thrash the DOM reads.
  if (selectionRaf !== null) return;
  selectionRaf = requestAnimationFrame(() => {
    selectionRaf = null;
    if (!props.visible) return;
    updateActiveMarks();
    updateActiveColors();
  });
}
let selectionRaf: number | null = null;
</script>
