/**
 * Popup helpers: position a floating element relative to an anchor (an
 * `HTMLElement` or a DOM `Rect`). Used by the slash menu, the block
 * settings menu, and the hover toolbar.
 *
 * All popups now prefer placing BELOW the anchor. The available height
 * below the anchor (within the viewport) is returned so callers can
 * auto-scale the menu height and use up/down scroll buttons instead of
 * a scrollbar.
 */

export interface PopupPlacement {
  readonly top: number;
  readonly left: number;
  readonly above: boolean;
  /** Available height (px) in the viewport below the anchor. */
  readonly availableHeight: number;
  /**
   * When `above=true`, the popup should expand *upward* from this
   * viewport-relative "bottom" coordinate (the baseline next to the
   * anchor). This lets callers set the popup's CSS `bottom` property
   * instead of `top`, so height changes grow upward rather than
   * downward.  When `above=false` this equals the same numeric value
   * as `top` so callers can always fall back to `top`.
   */
  readonly bottom: number;
  /**
   * Viewport-relative "top" coordinate of the anchor baseline (same
   * semantics as `bottom`): used when `above=false` (popup expands
   * downward from this point).  Provided for symmetry.
   */
  readonly topBaseline: number;
}

/**
 * Position a popup below an anchor element (or rect). If the anchor is close
 * to the container bottom **and** the viewport below is too cramped while
 * there is more room above the anchor in the viewport, place it above
 * instead.
 *
 * All returned coordinates are **viewport-relative**, suitable for use with
 * `position: fixed` (e.g. menus that teleport to `<body>`). Callers that
 * operate within a container-relative coordinate space should subtract the
 * container's `getBoundingClientRect().top/left` themselves.
 */
export function placeBelow(
  root: HTMLElement,
  anchor: HTMLElement | DOMRect,
  popupSize: { readonly width: number; readonly height: number },
  margin = 6,
  forceDirection: 'auto' | 'down' | 'up' = 'auto',
  bottomMargin = 0,
  topMargin = 0,
): PopupPlacement {
  void root;
  const anchorRect = anchor instanceof HTMLElement ? anchor.getBoundingClientRect() : anchor;

  const viewportHeight = document.documentElement.clientHeight;
  const vw = viewportWidth();
  const spaceBelow = Math.max(0, viewportHeight - anchorRect.bottom - margin - bottomMargin);
  const spaceAbove = Math.max(0, anchorRect.top - margin - topMargin);

  const fitsBelow = spaceBelow >= popupSize.height + margin;
  const fitsAbove = spaceAbove >= popupSize.height + margin;
  // When forced down (top bar), always pop below the anchor.
  // When forced up (bottom bar), always pop above the anchor.
  // Otherwise auto-pick the side with more room.
  const above
    = forceDirection === 'down'
      ? false
      : forceDirection === 'up'
        ? true
        : (!fitsBelow && (fitsAbove || spaceAbove > spaceBelow));

  let top: number;
  let bottom: number;
  let availableHeight: number;
  const topBaseline = anchorRect.bottom + margin;
  const bottomBaseline = anchorRect.top - margin;
  if (above) {
    top = Math.max(margin + topMargin, bottomBaseline - popupSize.height);
    bottom = bottomBaseline;
    availableHeight = Math.max(120, spaceAbove);
  } else {
    // Pop down (default, and forced when forceDirection='down').
    top = topBaseline;
    bottom = top + popupSize.height;
    availableHeight = Math.max(120, spaceBelow);
  }

  // Clamp horizontally to the viewport.
  const maxLeft = vw - popupSize.width - margin;
  const left = Math.max(margin, Math.min(maxLeft, anchorRect.left));

  return { top, left, above, availableHeight, bottom, topBaseline };
}

/**
 * Position a popup below a selection rect (for the hover toolbar).
 * Falls back to above only if there's zero space below.
 * Returns viewport-relative coordinates (for use with position:fixed
 * or a full-viewport positioning container).
 */
export function placeBelowSelection(
  _root: HTMLElement,
  selectionRect: DOMRect,
  popupSize: { readonly width: number; readonly height: number },
  margin = 8,
): PopupPlacement {
  // Use clientWidth/clientHeight — these are the VISIBLE viewport dimensions
  // EXCLUDING scrollbars.  innerWidth includes the scrollbar (~15px), which
  // makes the horizontal right-clamp too loose and the toolbar right edge
  // ends up covered by the scrollbar or the very edge of the viewport.
  const viewportHeight = document.documentElement.clientHeight;
  const viewportW = document.documentElement.clientWidth;

  // Viewport-relative coordinates — no rootRect subtraction.
  const centerLeft = selectionRect.left + (selectionRect.width - popupSize.width) / 2;
  const left = Math.max(margin, Math.min(viewportW - popupSize.width - margin, centerLeft));

  const spaceBelow = viewportHeight - selectionRect.bottom - margin;
  const spaceAbove = selectionRect.top - margin;
  const fitsBelow = spaceBelow >= popupSize.height;
  const fitsAbove = spaceAbove >= popupSize.height;
  const above = !fitsBelow && (fitsAbove || spaceAbove > spaceBelow);

  const topBaseline = selectionRect.bottom + margin;
  const bottomBaseline = selectionRect.top - margin;
  const top = above
    ? Math.max(margin, bottomBaseline - popupSize.height)
    : topBaseline;
  const bottom = above
    ? bottomBaseline
    : top + popupSize.height;

  const availableHeight = above
    ? Math.max(120, spaceAbove)
    : Math.max(120, spaceBelow);

  return { top, left, above, availableHeight, bottom, topBaseline };
}

/** Kept for backward compatibility — delegates to placeBelowSelection. */
export function placeAboveSelection(
  root: HTMLElement,
  selectionRect: DOMRect,
  popupSize: { readonly width: number; readonly height: number },
  margin = 8,
): PopupPlacement {
  return placeBelowSelection(root, selectionRect, popupSize, margin);
}

/**
 * Position a popup ABOVE a selection rect, falling back to below only if
 * there is not enough space above.  Used by the table cell selection
 * toolbar so it doesn't obscure the selected cells below.
 */
export function placePreferAbove(
  _root: HTMLElement,
  selectionRect: DOMRect,
  popupSize: { readonly width: number; readonly height: number },
  margin = 8,
): PopupPlacement {
  const viewportHeight = document.documentElement.clientHeight;
  const viewportW = document.documentElement.clientWidth;

  const centerLeft = selectionRect.left + (selectionRect.width - popupSize.width) / 2;
  const left = Math.max(margin, Math.min(viewportW - popupSize.width - margin, centerLeft));

  const spaceAbove = selectionRect.top - margin;
  const spaceBelow = viewportHeight - selectionRect.bottom - margin;
  const fitsAbove = spaceAbove >= popupSize.height;
  const fitsBelow = spaceBelow >= popupSize.height;
  // Prefer above; only go below if above doesn't fit AND below has more room.
  const above = fitsAbove || (!fitsBelow && spaceAbove > spaceBelow) || spaceAbove >= spaceBelow;

  const topBaseline = selectionRect.bottom + margin;
  const bottomBaseline = selectionRect.top - margin;
  const top = above
    ? Math.max(margin, bottomBaseline - popupSize.height)
    : topBaseline;
  const bottom = above
    ? bottomBaseline
    : top + popupSize.height;

  const availableHeight = above
    ? Math.max(120, spaceAbove)
    : Math.max(120, spaceBelow);

  return { top, left, above, availableHeight, bottom, topBaseline };
}

/**
 * Compute a rect relative to the editor root.
 */
export function relativeRect(root: HTMLElement, el: HTMLElement): DOMRect {
  const r = root.getBoundingClientRect();
  const e = el.getBoundingClientRect();
  return new DOMRect(e.left - r.left, e.top - r.top, e.width, e.height);
}

function viewportWidth(): number {
  // clientWidth excludes scrollbar width (unlike window.innerWidth which
  // includes it), so clamped popups remain fully visible within the actual
  // scrollbar-free viewport.
  return document.documentElement.clientWidth;
}
