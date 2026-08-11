/**
 * Adds wheel + touch scroll support to a menu scroll container.
 *
 * Designed for popup menus (PlusMenu, BlockSettingsMenu) that hide the
 * native scrollbar and expose up/down scroll buttons instead. The wheel
 * and touch handlers here translate user input into `scrollTop` changes
 * and invoke `onScroll` so the caller can refresh its scroll-button
 * visibility flags.
 *
 * - Wheel: `deltaY` is applied to `scrollTop`. Line-mode deltas (Firefox)
 *   are scaled to a rough pixel equivalent. `preventDefault` stops the
 *   page from scrolling.
 * - Touch: a single-finger drag scrolls the container; `preventDefault`
 *   on `touchmove` stops the page from following the finger.
 *
 * Listeners are attached to whichever element the `scrollEl` ref currently
 * points to, and are cleaned up when the ref changes or the component
 * unmounts — so it is safe to use with `v-if` menus.
 */
import { type Ref, watch, onBeforeUnmount } from 'vue';

export function useMenuScroll(
  scrollEl: Ref<HTMLElement | null>,
  onScroll: () => void,
): void {
  let touchY = 0;

  function onWheel(e: WheelEvent): void {
    const el = scrollEl.value;
    if (!el) return;
    e.preventDefault();
    // Normalize: Firefox sends deltaY in lines (deltaMode=1); other
    // browsers send pixels (deltaMode=0).
    const delta = e.deltaMode === WheelEvent.DOM_DELTA_LINE
      ? e.deltaY * 22
      : e.deltaY;
    el.scrollTop += delta;
    onScroll();
  }

  function onTouchStart(e: TouchEvent): void {
    if (e.touches.length !== 1) return;
    touchY = e.touches[0]!.clientY;
  }

  function onTouchMove(e: TouchEvent): void {
    if (e.touches.length !== 1) return;
    const el = scrollEl.value;
    if (!el) return;
    const y = e.touches[0]!.clientY;
    // Finger moves down (y increases) → scroll up (scrollTop decreases).
    el.scrollTop -= y - touchY;
    touchY = y;
    e.preventDefault();
    onScroll();
  }

  function attach(el: HTMLElement | null): void {
    if (!el) return;
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
  }

  function detach(el: HTMLElement | null): void {
    if (!el) return;
    el.removeEventListener('wheel', onWheel);
    el.removeEventListener('touchstart', onTouchStart);
    el.removeEventListener('touchmove', onTouchMove);
  }

  let currentEl: HTMLElement | null = null;

  watch(
    scrollEl,
    (el, _old, onCleanup) => {
      detach(currentEl);
      currentEl = el;
      attach(el);
      onCleanup(() => {
        detach(el);
        if (currentEl === el) currentEl = null;
      });
    },
    { immediate: true },
  );

  onBeforeUnmount(() => {
    detach(currentEl);
    currentEl = null;
  });
}
