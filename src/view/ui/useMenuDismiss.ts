/**
 * Auto-dismiss a popup menu on outside interaction.
 *
 * Closes the menu when any of the following happens while the menu is open:
 *   - mousedown / touchstart outside the menu (click, tap, or start of drag)
 *   - wheel scroll while the pointer is outside the menu
 *   - mouseleave from the menu element itself
 *
 * The menu element is tracked via `menuEl` (a ref), so the `mouseleave`
 * listener is re-attached whenever the ref changes (e.g. when the menu is
 * `v-if`'d in and out). The window-level listeners (mousedown / touchstart /
 * wheel) are bound once on mount and check `isInsideMenu(target)` at event
 * time so they no-op when the menu is closed.
 *
 * Does NOT call `preventDefault()` / `stopPropagation()` — the underlying
 * interaction (e.g. clicking a block to focus it, scrolling the page) is
 * allowed to proceed naturally; the menu simply closes on top.
 */
import { type Ref, watch, onMounted, onBeforeUnmount } from 'vue';

export function useMenuDismiss(
  menuEl: Ref<HTMLElement | null>,
  isVisible: () => boolean,
  onClose: () => void,
  /** Optional extra elements that should also be treated as "inside the menu"
   *  (e.g. the trigger/anchor button). This is critical for mobile when the
   *  menu is teleported to <body>: a capture-phase `touchstart` listener on
   *  window fires BEFORE the element-level `@touchstart.stop` handler on the
   *  trigger; without treating the trigger as inside, the newly-opened menu
   *  closes instantly on the very same tap. */
  extraInside?: () => (HTMLElement | null)[] | HTMLElement | null,
): void {
  function isInsideMenu(target: EventTarget | null): boolean {
    const el = menuEl.value;
    if (!el || !target) return false;
    if (target instanceof Node && el.contains(target)) return true;
    if (extraInside) {
      const extras = extraInside();
      const arr = Array.isArray(extras) ? extras : [extras];
      for (const extra of arr) {
        if (extra && target instanceof Node && extra.contains(target)) return true;
      }
    }
    return false;
  }

  function onPointerDown(e: MouseEvent | TouchEvent): void {
    if (!isVisible()) return;
    if (isInsideMenu(e.target)) return;
    onClose();
  }

  function onWheel(e: WheelEvent): void {
    if (!isVisible()) return;
    if (isInsideMenu(e.target)) return;
    onClose();
  }

  function onMouseLeave(): void {
    if (!isVisible()) return;
    onClose();
  }

  // --- menu element: mouseleave -------------------------------------------

  function attachMouseLeave(el: HTMLElement | null): void {
    if (!el) return;
    el.addEventListener('mouseleave', onMouseLeave);
  }

  function detachMouseLeave(el: HTMLElement | null): void {
    if (!el) return;
    el.removeEventListener('mouseleave', onMouseLeave);
  }

  let currentEl: HTMLElement | null = null;

  watch(
    menuEl,
    (el, _old, onCleanup) => {
      detachMouseLeave(currentEl);
      currentEl = el;
      attachMouseLeave(el);
      onCleanup(() => {
        detachMouseLeave(el);
        if (currentEl === el) currentEl = null;
      });
    },
    { immediate: true },
  );

  // --- window: mousedown / touchstart / wheel (capture phase) -------------

  onMounted(() => {
    window.addEventListener('mousedown', onPointerDown, true);
    window.addEventListener('touchstart', onPointerDown, true);
    window.addEventListener('wheel', onWheel, true);
  });

  onBeforeUnmount(() => {
    window.removeEventListener('mousedown', onPointerDown, true);
    window.removeEventListener('touchstart', onPointerDown, true);
    window.removeEventListener('wheel', onWheel, true);
    detachMouseLeave(currentEl);
    currentEl = null;
  });
}
