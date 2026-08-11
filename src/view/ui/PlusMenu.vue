<!--
  PlusMenu: unified insert / slash menu used by two triggers:

    1. Slash (mode="slash"):  typed within a block → converts the CURRENT block.
    2. Plus  (mode="insert"): left-handle "+" button → creates a NEW block below
       the source block and then applies the picked command to that new block.

  Commands are grouped by category (basic / list / other) with section headers.
  The menu always pops DOWN below the anchor, auto-scales its height to fit the
  viewport, and uses built-in up/down scroll buttons instead of a scrollbar.
  Keyboard nav: ArrowUp/Down/Enter/Esc/PageUp/PageDown/Home/End.
-->

<template>
  <Teleport to="body">
    <div
      v-if="shouldRender && rootEl"
      ref="menuEl"
      class="plus-menu slash-menu"
      :class="{ 'menu-closing': !visible }"
      :style="menuStyle"
      role="listbox"
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
      <!-- Scrollable content area (no scrollbar, overflow hidden) -->
      <div
        ref="scrollEl"
        class="slash-menu-scroll"
        @scroll="updateScrollState"
      >
        <div
          v-if="filtered.length === 0"
          class="slash-menu-empty"
        >
          {{ t('plus.noMatch') }}
        </div>
        <template v-else>
          <div
            v-for="group in grouped"
            :key="group.category"
            class="slash-menu-group"
          >
            <div
              v-if="group.label"
              class="slash-menu-group-label"
            >
              {{ group.label }}
            </div>
            <div
              v-for="item in group.items"
              :key="item.id"
              class="slash-menu-item"
              :class="{ active: flatIndex(item.id) === selectedIndex }"
              :aria-selected="flatIndex(item.id) === selectedIndex"
              role="option"
              @mousedown.prevent="onItemClick(item)"
              @mouseenter="selectedIndex = flatIndex(item.id)"
            >
              <SafeHtml
                class="slash-menu-icon"
                :html="iconHtml(item.icon)"
              />
              <div class="slash-menu-text">
                <div class="slash-menu-title">
                  {{ item.title }}
                </div>
                <div
                  v-if="item.description"
                  class="slash-menu-desc"
                >
                  {{ item.description }}
                </div>
              </div>
            </div>
          </div>
        </template>
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
import { computed, ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import type { SlashCommand } from '../../core/command/SlashCommand';
import { useEditor } from '../context';
import { placeBelow } from './popup';
import { useMenuScroll } from './useMenuScroll';
import { useMenuDismiss } from './useMenuDismiss';
import SafeHtml from './SafeHtml.vue';
import type { BlockId } from '../../core/types';
import { useI18n } from '../../i18n';

type PlusMenuMode = 'slash' | 'insert';

interface MenuGroup {
  category: string;
  label: string;
  items: readonly SlashCommand[];
}

const props = withDefaults(
  defineProps<{
    visible: boolean;
    anchorEl: HTMLElement | null;
    blockId: BlockId;
    query: string;
    rootEl: HTMLElement | null;
    mode?: PlusMenuMode;
  }>(),
  { mode: 'slash' },
);

const emit = defineEmits<{
  close: [];
  commit: [command: SlashCommand, mode: PlusMenuMode];
}>();

const { t } = useI18n();

// Category labels are localised so the slash-menu section headers respect
// the parent editor's `locale` prop.
const CATEGORY_LABELS = computed<Record<string, string>>(() => ({
  basic: t('plus.category.basic'),
  list: t('plus.category.list'),
  other: t('plus.category.other'),
}));

const editor = useEditor();
const menuEl = ref<HTMLElement | null>(null);
const scrollEl = ref<HTMLElement | null>(null);
const selectedIndex = ref(0);
const position = ref({ top: 0, left: 0, availableHeight: 360 });
const positioned = ref(false);
const canScrollUp = ref(false);
const canScrollDown = ref(false);
const MENU_WIDTH = 300;
const MENU_MIN_HEIGHT = 80;
const SCROLL_BTN_HEIGHT = 24;

// --- Delayed unmount for fade-out animation ------------------------------
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

/** Render the slash-command icon. Icons are SVG strings; fall back to a
 *  bullet glyph for commands that don't define one. */
function iconHtml(icon: unknown): string {
  return typeof icon === 'string' ? icon : '•';
}

// --- Search + grouping ---------------------------------------------------

const filtered = computed<readonly SlashCommand[]>(() =>
  editor.registries.slash.search(props.query),
);

const grouped = computed<MenuGroup[]>(() => {
  const groups: MenuGroup[] = [];
  const map = new Map<string, SlashCommand[]>();
  for (const cmd of filtered.value) {
    const cat = cmd.category ?? 'other';
    if (!map.has(cat)) map.set(cat, []);
    map.get(cat)!.push(cmd);
  }
  const order = ['basic', 'list', 'other'];
  for (const cat of order) {
    const items = map.get(cat);
    if (items && items.length > 0) {
      groups.push({ category: cat, label: CATEGORY_LABELS.value[cat] ?? cat, items });
    }
  }
  for (const [cat, items] of map) {
    if (!order.includes(cat)) {
      groups.push({ category: cat, label: CATEGORY_LABELS.value[cat] ?? cat, items });
    }
  }
  return groups;
});

function flatIndex(id: string): number {
  return filtered.value.findIndex((c) => c.id === id);
}

watch([filtered, () => props.visible], () => {
  selectedIndex.value = 0;
  nextTick(() => {
    if (scrollEl.value) scrollEl.value.scrollTop = 0;
    updateScrollState();
  });
});

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
      position.value = { top: 0, left: 0, availableHeight: 360 };
    }
  },
);

watch(
  [() => props.visible, () => props.anchorEl, menuEl],
  async () => {
    if (!props.visible || !props.anchorEl || !props.rootEl) return;
    await nextTick();
    const el = menuEl.value;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const placement = placeBelow(props.rootEl, props.anchorEl, {
      width: MENU_WIDTH,
      height: rect.height,
    });
    position.value = placement;
    positioned.value = true;
    nextTick(updateScrollState);
  },
  { flush: 'post' },
);

const menuStyle = computed(() => {
  if (!props.rootEl) return { display: 'none' };
  // Hide the menu until the first position calculation completes. Without
  // this, the menu briefly appears at (0,0) before the watch measures its
  // height and computes the correct placement — causing it to flash at the
  // top-left corner and then jump.
  //
  // IMPORTANT: also override --scroll-max-height to 100vh here. The
  // .slash-menu-scroll CSS has a fallback of 360px which would silently
  // clamp the scroll region and make getBoundingClientRect().height report
  // a value way smaller than the true content height. For tall menus near
  // the viewport bottom, that small measured height caused placeBelow to
  // miscalculate `top` such that the menu still overflowed downward.
  if (!positioned.value) return { visibility: 'hidden', top: '0px', left: '0px', width: `${MENU_WIDTH}px`, '--scroll-max-height': '100vh' };
  const top = position.value.top;
  const left = position.value.left;
  const scrollBtnsH = (canScrollUp.value ? SCROLL_BTN_HEIGHT : 0) + (canScrollDown.value ? SCROLL_BTN_HEIGHT : 0);
  const maxScrollAreaHeight = position.value.availableHeight - scrollBtnsH;
  return {
    top: `${top}px`,
    left: `${left}px`,
    width: `${MENU_WIDTH}px`,
    maxHeight: `${position.value.availableHeight}px`,
    '--scroll-max-height': `${Math.max(MENU_MIN_HEIGHT, maxScrollAreaHeight)}px`,
  } as Record<string, string>;
});

// --- Keyboard navigation --------------------------------------------------

function moveSelection(delta: number): void {
  if (filtered.value.length === 0) return;
  const n = filtered.value.length;
  selectedIndex.value = ((selectedIndex.value + delta) % n + n) % n;
  scrollSelectedIntoView();
}

function scrollSelectedIntoView(): void {
  const items = scrollEl.value?.querySelectorAll<HTMLElement>('.slash-menu-item');
  const targetItem = items?.[selectedIndex.value];
  if (targetItem) {
    targetItem.scrollIntoView({ block: 'nearest' });
  }
  nextTick(updateScrollState);
}

function onKeyDown(event: KeyboardEvent): boolean {
  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault();
      moveSelection(1);
      return true;
    case 'ArrowUp':
      event.preventDefault();
      moveSelection(-1);
      return true;
    case 'PageDown':
      event.preventDefault();
      moveSelection(5);
      return true;
    case 'PageUp':
      event.preventDefault();
      moveSelection(-5);
      return true;
    case 'Home':
      event.preventDefault();
      selectedIndex.value = 0;
      scrollSelectedIntoView();
      return true;
    case 'End':
      event.preventDefault();
      selectedIndex.value = Math.max(0, filtered.value.length - 1);
      scrollSelectedIntoView();
      return true;
    case 'Enter':
      event.preventDefault();
      acceptSelection();
      return true;
    case 'Escape':
      event.preventDefault();
      emit('close');
      return true;
    default:
      return false;
  }
}

function acceptSelection(): void {
  const item = filtered.value[selectedIndex.value];
  if (item) emit('commit', item, props.mode);
  emit('close');
}

function onItemClick(item: SlashCommand): void {
  const idx = filtered.value.indexOf(item);
  if (idx >= 0) selectedIndex.value = idx;
  acceptSelection();
}

defineExpose({ onKeyDown });

// --- Auto-dismiss on outside interaction --------------------------------
// Closes the menu on: mousedown/touchstart outside, wheel outside, and
// mouseleave from the menu. Replaces the old manual click-outside handler.
useMenuDismiss(menuEl, () => props.visible, () => emit('close'));

onMounted(() => {
  window.addEventListener('resize', updateScrollState);
});
onBeforeUnmount(() => {
  window.removeEventListener('resize', updateScrollState);
});
</script>
