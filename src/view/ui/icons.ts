/**
 * SVG icon strings for block types, shared by the slash menu (PlusMenu),
 * the block settings menu (BlockSettingsMenu), and the hover toolbar.
 *
 * All icons use a 1024×1024 viewBox with `currentColor` fill so they adapt
 * to the surrounding text color.
 */

/** Paragraph — uppercase "T" glyph drawn as two merged rounded-rect strokes. */
export const ICON_PARAGRAPH = `<svg viewBox="0 0 1024 1024" width="16" height="16" aria-hidden="true"><path d="M426.666667 939.050667a32 32 0 1 1 0-64h53.333333V160H235.093333V170.666667a32 32 0 0 1-27.648 31.701333l-4.352 0.298667A32 32 0 0 1 171.093333 170.666667V128a32 32 0 0 1 32-32H820.693333a32 32 0 0 1 31.701334 27.648l0.298666 4.352v42.666667a32 32 0 1 1-64 0l-0.042666-10.666667H544v715.050667H597.333333a32 32 0 0 1 31.701334 27.648l0.298666 4.352a32 32 0 0 1-32 32h-170.666666z" fill="currentColor"/></svg>`;

// --- Heading icons -------------------------------------------------------
// H1-H6 all use a unified left-side "H" glyph (two vertical posts +
// horizontal crossbar) paired with a distinct right-side digit path.
// All paths are fill-based, 1024×1024 viewBox.

/** Shared "H" glyph used as the left half of every heading icon. */
const H_GLYPH = 'M544 170.922667a32 32 0 0 1 32 32v618.666666a32 32 0 1 1-64 0V544H192v277.674667a32 32 0 0 1-27.648 31.701333l-4.352 0.298667a32 32 0 0 1-32-32v-618.666667a32 32 0 0 1 64 0v276.992H512V202.922667a32 32 0 0 1 27.648-31.701334l4.352-0.298666z';

/** H1 — digit "1": simple vertical post with a short left serif (top). */
export const ICON_H1 = `<svg viewBox="0 0 1024 1024" width="16" height="16" aria-hidden="true"><path d="${H_GLYPH} M848.512 366.933333A32 32 0 0 1 896 394.965333v426.666667a32 32 0 1 1-64 0v-372.565333l-80.554667 44.416a32 32 0 0 1-41.130666-8.96l-2.346667-3.626667a32 32 0 0 1 12.586667-43.477333l128-70.485334z" fill="currentColor"/></svg>`;

/** H2 — digit "2": mirrored-S arc flowing into a horizontal baseline bar. */
export const ICON_H2 = `<svg viewBox="0 0 1024 1024" width="16" height="16" aria-hidden="true"><path d="${H_GLYPH} M786.133333 362.666667a152.661333 152.661333 0 0 1 107.946667 260.693333l-166.058667 165.973333h178.773334a32 32 0 0 1 31.744 27.648l0.256 4.352a32 32 0 0 1-32 32h-256a32 32 0 0 1-22.613334-54.613333l220.672-220.672A88.661333 88.661333 0 0 0 786.133333 426.666667h-7.338666a96 96 0 0 0-96 96v20.565333a32 32 0 0 1-64 0v-20.565333a160 160 0 0 1 160-160h7.338666z" fill="currentColor"/></svg>`;

/** H3 — digit "3": rounded double-stack form (upper + lower lobes). */
export const ICON_H3 = `<svg viewBox="0 0 1024 1024" width="16" height="16" aria-hidden="true"><path d="${H_GLYPH} m362.410667 192a32 32 0 0 1 22.613333 54.656L809.813333 536.746667l1.792 0.341333a160.085333 160.085333 0 0 1 126.506667 148.053333l0.256 8.490667a160 160 0 0 1-310.912 53.248 32 32 0 0 1 60.373333-21.333333 96 96 0 1 0 90.538667-127.914667h-42.666667a32 32 0 0 1-22.613333-54.613333l116.010667-116.053334h-178.773334a32 32 0 0 1-31.701333-27.648l-0.256-4.352a32 32 0 0 1 32-32h256z" fill="currentColor"/></svg>`;

/** H4 — digit "4": vertical post + horizontal crossbar + diagonal connector. */
export const ICON_H4 = `<svg viewBox="0 0 1024 1024" width="16" height="16" aria-hidden="true"><path d="${H_GLYPH} m244.309333 193.493333a32 32 0 0 1 20.992 40.106667l-93.738666 299.776h116.48v-96a32 32 0 0 1 64 0v96h10.666666a32 32 0 0 1 31.744 27.648l0.298667 4.352a32 32 0 0 1-32 32H896v53.333333a32 32 0 1 1-64 0v-53.333333h-160a32 32 0 0 1-30.506667-41.557334l106.666667-341.333333a32 32 0 0 1 40.106667-20.992z" fill="currentColor"/></svg>`;

/** H5 — digit "5": top bar + left stem + mid bar + sweeping lower arc. */
export const ICON_H5 = `<svg viewBox="0 0 1024 1024" width="16" height="16" aria-hidden="true"><path d="${H_GLYPH} m363.477333 192.426666a32 32 0 1 1 0 64h-145.706666l-28.245334 113.450667 5.12-1.493333a160.042667 160.042667 0 0 1 100.949334 6.4l9.472 4.266666a160 160 0 1 1-189.610667 249.856 32 32 0 0 1 48-42.325333 96 96 0 1 0 0-126.976c-22.186667 25.130667-63.146667 3.584-55.04-28.928l53.333333-214.016a32 32 0 0 1 31.061334-24.234667h170.666666z" fill="currentColor"/></svg>`;

/** H6 — digit "6": descending loop with inner oval and opening stroke. */
export const ICON_H6 = `<svg viewBox="0 0 1024 1024" width="16" height="16" aria-hidden="true"><path d="${H_GLYPH} m292.522667 153.173333a32 32 0 0 1 12.586666 43.52l-93.141333 168.874667a159.957333 159.957333 0 0 1 102.4 19.712 158.848 158.848 0 0 1 58.581333 217.685333 160.426667 160.426667 0 0 1-218.453333 58.24 158.890667 158.890667 0 0 1-62.762667-209.962667l157.312-285.44a32 32 0 0 1 43.52-12.586666z m-141.226667 322.517333a94.890667 94.890667 0 0 0 35.072 130.048 96.426667 96.426667 0 0 0 131.242667-34.901333 94.848 94.848 0 0 0-35.114667-130.048 96.426667 96.426667 0 0 0-131.242667 34.901333z" fill="currentColor"/></svg>`;

// --- List / quote / code icons ------------------------------------------

/** Unordered / bullet list — three filled dots with lines. */
export const ICON_BULLET_LIST = `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="3" cy="4" r="1.1" fill="currentColor" stroke="none"/><circle cx="3" cy="8" r="1.1" fill="currentColor" stroke="none"/><circle cx="3" cy="12" r="1.1" fill="currentColor" stroke="none"/><line x1="6.5" y1="4" x2="13.5" y2="4"/><line x1="6.5" y1="8" x2="13.5" y2="8"/><line x1="6.5" y1="12" x2="13.5" y2="12"/></svg>`;

/**
 * Ordered / numbered list — three rows, each with a small numeral
 * drawn as SVG strokes (1, 2, 3) followed by a text line.
 * The numerals are drawn purely with paths — no `<text>` elements.
 */
export const ICON_ORDERED_LIST = `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.3 3.7L3.1 2.8L3.1 5.8" stroke-width="1.1"/><line x1="6.5" y1="4" x2="13.5" y2="4" stroke-width="1.3"/><path d="M1.8 7.4C1.8 6.6 4.2 6.6 4.2 7.4C4.2 8.2 1.8 9.5 1.8 9.5L4.2 9.5" stroke-width="1.1"/><line x1="6.5" y1="8" x2="13.5" y2="8" stroke-width="1.3"/><path d="M4.2 11.2C4.2 10.5 3 10.5 1.8 11.5C1.8 12 3 12 3 12C3 12 4.2 12 4.2 13C4.2 13.5 3 13.5 1.8 12.8" stroke-width="1.1"/><line x1="6.5" y1="12" x2="13.5" y2="12" stroke-width="1.3"/></svg>`;

/** To-do list — checkbox with checkmark. */
export const ICON_TODO = `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="2.5" width="11" height="11" rx="2.5"/><path d="M5.5 8L7 9.8L10.8 5.8"/></svg>`;

/** Quote / blockquote — left bar with text lines. */
export const ICON_QUOTE = `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="3" width="2" height="10" rx="1" fill="currentColor" stroke="none"/><line x1="6.5" y1="5" x2="13" y2="5"/><line x1="6.5" y1="8" x2="13" y2="8"/><line x1="6.5" y1="11" x2="10" y2="11"/></svg>`;

/** Code block — angle brackets with slash. */
export const ICON_CODE = `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4L2 8L5 12"/><path d="M11 4L14 8L11 12"/><line x1="10" y1="3" x2="6" y2="13"/></svg>`;

/** Image — rectangle with mountain + sun. Drawn purely with SVG paths, no <text>. */
export const ICON_IMAGE = `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="3" width="12" height="10" rx="1.5"/><circle cx="5.5" cy="6.5" r="1.1" fill="currentColor" stroke="none"/><path d="M13 11.5L10 8.5L7 11.5L5 9.5L3 11.5"/></svg>`;

/** Upload progress spinner — dashed arc, drawn purely with paths. */
export const ICON_SPINNER = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 3a9 9 0 0 1 9 9" opacity="0.25"/><path d="M12 3a9 9 0 0 0-9 9" class="be-spinner-arc"/></g></svg>`;

/** Retry / refresh icon — circular arrow, pure paths. */
export const ICON_RETRY = `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8a5 5 0 0 1 8.5-3.5M13 3v3h-3"/><path d="M13 8a5 5 0 0 1-8.5 3.5M3 13v-3h3"/></svg>`;

/** Close / delete icon — X, pure paths. */
export const ICON_CLOSE = `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4L12 12"/><path d="M12 4L4 12"/></svg>`;

/** Replace / swap icon — two horizontal arrows, pure paths. */
export const ICON_REPLACE = `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 5H12M9 2L12 5L9 8"/><path d="M14 11H4M7 8L4 11L7 14"/></svg>`;

/** Upload (cloud + arrow) icon, pure paths. */
export const ICON_UPLOAD = `<svg viewBox="0 0 1024 1024" width="32" height="32" aria-hidden="true"><path d="M768.35456 416a256 256 0 1 0-512 0 192 192 0 1 0 0 384v64a256 256 0 0 1-58.88-505.216 320.128 320.128 0 0 1 629.76 0A256.128 256.128 0 0 1 768.35456 864v-64a192 192 0 0 0 0-384z m-512 384h128v64H256.35456v-64z m384 0h128v64h-128v-64z" fill="currentColor"/><path d="M539.04256 589.184v333.056a32.448 32.448 0 0 1-32 32.192 32.448 32.448 0 0 1-32-32.192V589.184l-36.096 36.096a32.192 32.192 0 0 1-45.056-0.192 31.616 31.616 0 0 1-0.192-45.056l90.88-90.88a31.36 31.36 0 0 1 22.528-9.152 30.08 30.08 0 0 1 22.4 9.088l90.88 90.944a32.192 32.192 0 0 1-0.192 45.056 31.616 31.616 0 0 1-45.056 0.192l-36.096-36.096z" fill="currentColor"/></svg>`;
