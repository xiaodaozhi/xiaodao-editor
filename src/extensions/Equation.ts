/**
 * Equation block extension (LaTeX math, rendered with KaTeX).
 *
 * Design notes:
 *  - The block stores ONLY the raw LaTeX *source* string in `attrs.expression`.
 *    KaTeX output (HTML/SVG) is NEVER persisted — it is recomputed on the fly
 *    from `expression` inside the renderer and during HTML/markdown export.
 *    This keeps the document serializable and free of volatile render output.
 *  - Rendering uses `katex.renderToString` (string-based, no DOM), which is
 *    safe for SSR and for unit tests in a node environment. We deliberately
 *    avoid `katex.render` (DOM-based).
 *  - `displayMode: true` so the formula is centered as a block.
 *  - `throwOnError: false` so a malformed formula never crashes the editor;
 *    instead a light error state is shown. `trust: false` so user input can
 *    never inject raw HTML through KaTeX.
 *  - The renderer is a pure view: it reads `block.attrs.expression` and only
 *    mutates document state through editor commands (setAttrs / removeBlock).
 */
import { defineComponent, h, ref, computed, watch, nextTick, onBeforeUnmount, type PropType, type VNode } from 'vue';
import type { Extension } from '../core/extension/Extension';
import type { Block, BlockId } from '../core/types';
import type { Editor } from '../core/Editor';
import SafeHtml from '../view/ui/SafeHtml.vue';
import { ICON_EQUATION, ICON_EDIT } from '../view/ui/icons';
import { classesFromAttrs, COMMON_ATTRS } from './_commonAttrs';
import { useEditor, useEditable } from '../view/context';
import { useI18n } from '../i18n';
import { inlineFromString } from '../core/types';

// Import KaTeX once. The CSS is bundled a single time by the bundler; the
// editor core never touches it, so there is no duplication across renderers.
import 'katex/dist/katex.min.css';
import katex from 'katex';

// ---------------------------------------------------------------------------
// Pure render layer (no Vue, no DOM requirement)
// ---------------------------------------------------------------------------

export interface RenderResult {
  /** KaTeX HTML output (safe to insert via v-html because trust:false). */
  readonly html: string;
  /** True when the source could not be parsed by KaTeX. */
  readonly error: boolean;
}

/**
 * Render a LaTeX expression to HTML. Always returns a result — parse failures
 * surface as `error: true` with a KaTeX error span rather than throwing.
 * Safe to call on the server (no `document` access).
 */
export function renderEquation(expression: string): RenderResult {
  const src = expression ?? '';
  try {
    const html = katex.renderToString(src, {
      displayMode: true,
      throwOnError: false,
      trust: false,
      strict: false,
      output: 'htmlAndMathml',
    });
    // KaTeX emits a `katex-error` span (with throwOnError:false) for invalid
    // input; detect it so the UI can show a light error badge.
    const error = /class="katex-error"/.test(html);
    return { html, error };
  } catch {
    // Extreme fallback: should not happen with throwOnError:false, but guard
    // against any unexpected KaTeX throw so the editor never hard-crashes.
    return { html: '', error: true };
  }
}

// ---------------------------------------------------------------------------
// Schema attrs (persisted — ONLY the raw LaTeX source)
// ---------------------------------------------------------------------------

export interface EquationAttrs {
  readonly expression: string;
}

const EQUATION_ATTRS = {
  expression: {
    default: '' as const,
    validate: (v: unknown): boolean => typeof v === 'string',
  },
  // A formula can be a CHILD block (indented under a nestable sibling), so it
  // needs the `indent` attr to reflect its nesting depth and render the
  // be-indent-N class. (nestable=false only means it can't be a parent.)
  indent: COMMON_ATTRS.indent,
} as const;

// ---------------------------------------------------------------------------
// Turn-into helpers (also unit-tested directly)
// ---------------------------------------------------------------------------

/** Paragraph/text block → Equation: the block's plain text becomes the LaTeX source. */
export function turnIntoEquation(editor: Editor, id: BlockId, expression: string): void {
  editor.commands.convertBlock?.({ id, type: 'equation', attrs: { expression } });
}

/**
 * Equation → Paragraph: the LaTeX source becomes the paragraph's text.
 * (A plain convertBlock would drop the expression because the paragraph schema
 * has no `expression` attr, so we restore it as text explicitly.)
 */
export function turnEquationIntoParagraph(editor: Editor, id: BlockId): void {
  const b = editor.getState().doc.blocks.get(id);
  const expr = b && b.type === 'equation' ? String(b.attrs.expression ?? '') : '';
  editor.commands.convertBlock?.({ id, type: 'paragraph' });
  if (expr) {
    editor.commands.setText?.({ id, content: inlineFromString(expr) });
  }
}

// ---------------------------------------------------------------------------
// Renderer component
// ---------------------------------------------------------------------------

export const EquationBlock = defineComponent({
  name: 'EquationBlock',
  props: {
    block: { type: Object as PropType<Block>, required: true },
    placeholder: { type: String, default: undefined },
  },
  setup(props) {
    const editor = useEditor();
    const editable = useEditable();
    const i18n = useI18n();
    const blockId = props.block.id;

    const editing = ref(false);
    const draft = ref('');
    const initialExpression = ref('');
    const previewHtml = ref('');
    const previewError = ref(false);
    const textareaRef = ref<HTMLTextAreaElement | null>(null);

    function expression(): string {
      const v = props.block.attrs.expression;
      return typeof v === 'string' ? v : '';
    }

    const display = computed<RenderResult>(() => renderEquation(expression()));
    const isEmpty = computed(() => expression().trim().length === 0);

    // Selection display follows the SAME generic mechanism as every other
    // non-text block (image / table / divider / …): a block is "selected"
    // when its host carries the `.block-host.block-focused` class, driven by
    // BlockEditor's reactive `focusedBlockId`. The host's click delegation
    // (`onBlockRootClick`, bound because this root has `.block-focus-root`)
    // sets focus on a plain click; no per-component `isSelected` / subscription
    // is needed. The `.equation-selected` ring and the edit button are shown
    // purely via CSS on `.block-host.block-focused .equation-block`.

    // --- Debounced live preview (rAF) ------------------------------------
    let rafId = 0;
    function schedulePreview(): void {
      if (typeof requestAnimationFrame === 'undefined') {
        const r = renderEquation(draft.value);
        previewHtml.value = r.html;
        previewError.value = r.error;
        return;
      }
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const r = renderEquation(draft.value);
        previewHtml.value = r.html;
        previewError.value = r.error;
      });
    }

    function refreshPreview(): void {
      const r = renderEquation(draft.value);
      previewHtml.value = r.html;
      previewError.value = r.error;
    }

    // Grow the textarea to fit its content. Setting height to 'auto' first
    // resets any previously pinned height so scrollHeight reflects the live
    // content (not a stale value); then we pin it to scrollHeight.
    function autoResize(): void {
      const el = textareaRef.value;
      if (!el) return;
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    }

    // --- Outside-click handling ------------------------------------------
    function onDocMouseDown(e: MouseEvent): void {
      if (!editing.value) return;
      const target = e.target as HTMLElement | null;
      if (target && target.closest('[data-equation-edit]')) return;
      submit();
    }

    function startOutsideWatch(): void {
      if (typeof document !== 'undefined') {
        document.addEventListener('mousedown', onDocMouseDown, true);
      }
    }
    function stopOutsideWatch(): void {
      if (typeof document !== 'undefined') {
        document.removeEventListener('mousedown', onDocMouseDown, true);
      }
    }

    // --- Edit lifecycle --------------------------------------------------
    function enterEdit(): void {
      if (!editable.value) return; // read-only: never enter edit mode
      if (editing.value) return;
      initialExpression.value = expression();
      draft.value = expression();
      editing.value = true;
      nextTick(() => {
        const el = textareaRef.value;
        if (el) {
          el.focus();
          const len = el.value.length;
          el.setSelectionRange(len, len);
          autoResize();
        }
        refreshPreview();
      });
      startOutsideWatch();
    }

    function submit(): void {
      if (!editing.value) return;
      stopOutsideWatch();
      editing.value = false;
      const value = draft.value;
      const trimmed = value.trim();
      // Empty / whitespace-only → remove the block to avoid orphan empties.
      if (trimmed.length === 0) {
        editor.commands.removeBlock?.({ id: blockId });
        return;
      }
      editor.commands.setAttrs?.({ id: blockId, attrs: { expression: value } });
    }

    function cancel(): void {
      if (!editing.value) return;
      stopOutsideWatch();
      editing.value = false;
      // Revert: a brand-new empty equation (no prior expression) is removed;
      // an existing equation keeps its previously-stored expression because we
      // never wrote the draft back.
      if (initialExpression.value.trim().length === 0) {
        editor.commands.removeBlock?.({ id: blockId });
      }
    }

    function onKeydown(e: KeyboardEvent): void {
      // Stop the BlockEditor-level keymap from hijacking keys while editing.
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        cancel();
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submit();
        return;
      }
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        submit();
        return;
      }
      // Shift+Enter inserts a newline in the textarea (multiline LaTeX).
    }

    // The edit button can be revealed by hovering a block that is NOT the
    // current selection (the toolbar is shown on :hover, not only when
    // selected). Clicking it must first make this block the selected block so
    // the editor's selection stays consistent with what is being edited. We use
    // the SAME generic block-focus mechanism as every other non-text block:
    // `selectBlock` sets a `blocks` selection, whose subscription flips the
    // host's `.block-host.block-focused` class — there is no per-component
    // `isSelected` (that divergence is what previously desynced the equation
    // ring from the real selection). `selectBlock` is idempotent, so calling it
    // when already selected is harmless.
    function onEditClick(e: MouseEvent): void {
      e.stopPropagation();
      if (!editable.value) return;
      editor.commands.selectBlock?.({ id: blockId });
      enterEdit();
    }

    // An empty equation has no separate "view" state — it always opens in
    // edit mode. We re-enter edit if the expression is cleared back to empty
    // (e.g. an existing equation is emptied via the editor).
    watch(
      isEmpty,
      (emptyNow) => {
        if (emptyNow && editable.value && !editing.value) {
          enterEdit();
        }
      },
    );

    // Auto-enter edit for an empty equation on mount. This covers insertion
    // via the plus menu and the slash command, which both create an empty
    // equation block: the new block opens directly in edit mode.
    if (editable.value && isEmpty.value) {
      enterEdit();
    }

    onBeforeUnmount(() => {
      stopOutsideWatch();
      if (rafId && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(rafId);
    });

    return () => {
      const attrs = props.block.attrs;
      void attrs;
      const placeholder = props.placeholder ?? i18n.t('equation.placeholder');

      // An empty equation never has a "view" mode — it renders the editor
      // directly. (editable.value && isEmpty.value) is a defensive guard in
      // case the edit flag is ever out of sync with an empty expression.
      if (editing.value || (editable.value && isEmpty.value)) {
        return h(
          'div',
          {
            class: ['equation-block', 'equation-editing', 'block-focus-root', ...classesFromAttrs(props.block.attrs)],
            'data-equation-block': '',
            'data-equation-edit': '',
          },
          [
            h('div', { class: 'equation-edit', 'data-equation-edit': '' }, [
              h('textarea', {
                ref: textareaRef,
                class: 'equation-edit-input',
                'data-equation-edit': '',
                value: draft.value,
                placeholder,
                spellcheck: false,
                autocapitalize: 'off',
                autocomplete: 'off',
                onInput: (e: Event) => {
                  draft.value = (e.currentTarget as HTMLTextAreaElement).value;
                  schedulePreview();
                  autoResize();
                },
                onKeydown: onKeydown as unknown as (e: KeyboardEvent) => void,
              }),
            ]),
            h('div', { class: 'equation-edit-preview' }, [
              previewError.value
                ? h('div', { class: 'equation-error-badge' }, i18n.t('equation.invalid'))
                : null,
              h(SafeHtml, { html: previewHtml.value, class: 'equation-preview-html' }),
            ]),
          ],
        );
      }

      const displayHtml = display.value.html;
      const hasError = display.value.error;

      const inner: VNode[] = [];
      if (isEmpty.value) {
        inner.push(
          h('span', { class: 'equation-placeholder' }, [placeholder]),
        );
      } else if (hasError) {
        inner.push(
          h('span', { class: 'equation-error-inline' }, [i18n.t('equation.invalid')]),
        );
      } else {
        inner.push(h(SafeHtml, { html: displayHtml, class: 'equation-render' }));
      }

      // Floating edit button (top-right), shown for content-bearing blocks
      // only. Empty equations live in edit mode already, so they need no
      // button; read-only blocks never show one.
      if (editable.value && !isEmpty.value) {
        inner.push(
          h(
            'div',
            {
              class: ['equation-toolbar'],
            },
            [
              h(
                'button',
                {
                  type: 'button',
                  class: 'equation-edit-btn',
                  title: i18n.t('equation.edit'),
                  onClick: onEditClick as unknown as (e: MouseEvent) => void,
                },
                [h(SafeHtml, { html: ICON_EDIT })],
              ),
            ],
          ),
        );
      }

      return h(
        'div',
        {
          class: ['equation-block', 'block-focus-root', ...classesFromAttrs(props.block.attrs)],
          'data-equation-block': '',
        },
        inner,
      );
    };
  },
});

// ---------------------------------------------------------------------------
// Extension spec
// ---------------------------------------------------------------------------

export const EquationExtension: Extension = {
  name: 'equation',
  schema: {
    type: 'equation',
    // Equations carry no inline text — the LaTeX source lives in `attrs`.
    // `isolating` keeps Enter/Backspace from merging with neighbours, and
    // `nestable: false` because a formula has no children.
    content: 'none',
    nestable: false,
    isolating: true,
    attrs: { ...EQUATION_ATTRS },
    empty: (block: Block): boolean => {
      const e = block.attrs.expression;
      return typeof e !== 'string' || e.trim().length === 0;
    },
  },
  renderer: { component: EquationBlock, editable: false },
  slashCommands: [
    {
      id: 'equation',
      title: 'slash.equation.title',
      keywords: ['math', 'equation', 'formula', 'latex', 'tex', '公式', '数学', 'tex'],
      description: 'slash.equation.description',
      icon: ICON_EQUATION,
      command: 'convertBlock',
      category: 'other',
      args: (): unknown => ({ id: '__currentBlock__', type: 'equation', attrs: { expression: '' } }),
    },
  ],
  serialize: {
    // KaTeX output derived from the raw expression — never stored in the doc.
    toHTML: (block: Block): string => {
      const e = block.attrs.expression;
      const src = typeof e === 'string' ? e : '';
      if (!src.trim()) return '';
      const { html, error } = renderEquation(src);
      if (error) return `<p class="katex-error-block">${escapeHtmlText(src)}</p>`;
      return `<div class="equation-block-rendered">${html}</div>`;
    },
    toMarkdown: (block: Block): string => {
      const e = block.attrs.expression;
      const src = typeof e === 'string' ? e : '';
      if (!src.trim()) return '';
      const body = src.length ? src.split('\n') : [''];
      return `$$$\n${body.join('\n')}\n$$$`;
    },
  },
};

// --- Helpers for serialize ------------------------------------------------

function escapeHtmlText(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
