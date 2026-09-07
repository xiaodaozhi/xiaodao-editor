/**
 * Equation block extension.
 *
 * Design notes:
 *  - The block stores ONLY the raw LaTeX *source* string in `attrs.expression`.
 *    Renderer output (HTML/VNode/AST) is NEVER persisted — it is recomputed on
 *    the fly from `expression`. This keeps the document serializable and free
 *    of volatile render output.
 *  - Rendering goes through an injectable `EquationRenderer`. The default is
 *    the built-in, zero-dependency math engine (see `./math`), which supports
 *    a lightweight LaTeX subset. Consumers swap in KaTeX / MathJax / any
 *    engine by composing `createEquationExtension({ renderer })` AFTER the
 *    built-in `EquationExtension` in `:extensions` — name-based deduplication
 *    makes the later entry win. BlockEditor itself never carries an equation
 *    renderer (it has no `equationRenderer` prop); the boundary is at the
 *    extension layer.
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
import { escapeHtmlText, parseMath, renderMathToHtml, renderMathToVNode } from './math';

// ---------------------------------------------------------------------------
// Renderer contract
// ---------------------------------------------------------------------------

export interface EquationRenderOptions {
  /** Block-level formula (centered, limits above/below). Default: true. */
  readonly displayMode?: boolean;
}

export interface EquationDiagnostic {
  /** `error` surfaces a visible problem; `warning` is recoverable (e.g. unknown command). */
  readonly severity: 'error' | 'warning';
  readonly message: string;
  readonly start: number;
  readonly end: number;
}

export interface EquationRenderResult {
  /** Safe HTML string, always available (export / SSR / non-Vue consumers). */
  readonly html: string;
  /**
   * Vue VNode tree. When present the view renders it directly, so no HTML
   * string is ever assigned to innerHTML. Adapters for string-only engines
   * (KaTeX, MathJax) leave this `null` and fill `html` instead.
   */
  readonly vnode: VNode | VNode[] | null;
  /** True when the expression has at least one `error` diagnostic. */
  readonly error: boolean;
  readonly diagnostics: readonly EquationDiagnostic[];
}

export interface EquationRenderer {
  render(expression: string, options?: EquationRenderOptions): EquationRenderResult;
}

const EMPTY_RESULT: EquationRenderResult = {
  html: '',
  vnode: null,
  error: false,
  diagnostics: [],
};

/**
 * Call a renderer defensively. A third-party renderer must never be able to
 * take the editor down: anything it throws becomes an error state.
 */
function safeRender(
  renderer: EquationRenderer,
  expression: string,
  options: EquationRenderOptions,
): EquationRenderResult {
  const src = expression ?? '';
  try {
    const result = renderer.render(src, options);
    if (!result || typeof result !== 'object') return EMPTY_RESULT;
    return {
      html: typeof result.html === 'string' ? result.html : '',
      vnode: result.vnode ?? null,
      error: result.error === true,
      diagnostics: Array.isArray(result.diagnostics) ? result.diagnostics : [],
    };
  } catch {
    return {
      html: '',
      vnode: null,
      error: true,
      diagnostics: [
        { severity: 'error', message: 'Equation renderer failed', start: 0, end: src.length },
      ],
    };
  }
}

// ---------------------------------------------------------------------------
// Built-in renderer (zero third-party dependencies)
// ---------------------------------------------------------------------------

/**
 * Default renderer: Tokenizer -> Parser -> AST -> render tree -> VNode + HTML.
 * Supports a lightweight subset of LaTeX math (see `SUPPORTED_COMMANDS`).
 */
export const builtinEquationRenderer: EquationRenderer = {
  render(expression, options) {
    const displayMode = options?.displayMode ?? true;
    const { nodes, diagnostics } = parseMath(expression ?? '');
    return {
      html: renderMathToHtml(nodes, { displayMode }),
      vnode: renderMathToVNode(nodes, { displayMode }),
      error: diagnostics.some((d) => d.severity === 'error'),
      diagnostics,
    };
  },
};

/**
 * Legacy convenience wrapper retained for backward compatibility: render with
 * the built-in renderer and return the historical `{ html, error }` shape.
 */
export interface RenderResult {
  /** Renderer HTML output (safe to insert via v-html: it is never raw input). */
  readonly html: string;
  /** True when the source could not be parsed. */
  readonly error: boolean;
}

export function renderEquation(expression: string): RenderResult {
  const result = safeRender(builtinEquationRenderer, expression, { displayMode: true });
  return { html: result.html, error: result.error };
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

/** Paragraph/text block -> Equation: the block's plain text becomes the LaTeX source. */
export function turnIntoEquation(editor: Editor, id: BlockId, expression: string): void {
  editor.commands.convertBlock?.({ id, type: 'equation', attrs: { expression } });
}

/**
 * Equation -> Paragraph: the LaTeX source becomes the paragraph's text.
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

/** Build the equation block component bound to a specific renderer. */
export function createEquationBlock(renderer: EquationRenderer) {
  return defineComponent({
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
      const preview = ref<EquationRenderResult>(EMPTY_RESULT);
      const textareaRef = ref<HTMLTextAreaElement | null>(null);

      function expression(): string {
        const v = props.block.attrs.expression;
        return typeof v === 'string' ? v : '';
      }

      // displayMode lives here (renderer option) rather than being baked into
      // the built-in renderer, so an inline-math block can reuse this component.
      const display = computed<EquationRenderResult>(() =>
        safeRender(renderer, expression(), { displayMode: true }),
      );
      const isEmpty = computed(() => expression().trim().length === 0);

      // Selection display follows the SAME generic mechanism as every other
      // non-text block (image / table / divider / ...): a block is "selected"
      // when its host carries the `.block-host.block-focused` class, driven by
      // BlockEditor's reactive `focusedBlockId`.

      // --- Debounced live preview (rAF) ------------------------------------
      let rafId = 0;
      function renderPreview(): void {
        preview.value = safeRender(renderer, draft.value, { displayMode: true });
      }
      function schedulePreview(): void {
        if (typeof requestAnimationFrame === 'undefined') {
          renderPreview();
          return;
        }
        if (rafId) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => {
          renderPreview();
        });
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
          renderPreview();
        });
        startOutsideWatch();
      }

      function submit(): void {
        if (!editing.value) return;
        stopOutsideWatch();
        editing.value = false;
        const value = draft.value;
        const trimmed = value.trim();
        // Empty / whitespace-only -> remove the block to avoid orphan empties.
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
      // current selection. Clicking it must first make this block the selected
      // block so the editor's selection stays consistent with what is edited.
      function onEditClick(e: MouseEvent): void {
        e.stopPropagation();
        if (!editable.value) return;
        editor.commands.selectBlock?.({ id: blockId });
        enterEdit();
      }

      // An empty equation has no separate "view" state — it always opens in
      // edit mode. We re-enter edit if the expression is cleared back to empty.
      watch(
        isEmpty,
        (emptyNow) => {
          if (emptyNow && editable.value && !editing.value) {
            enterEdit();
          }
        },
      );

      // Auto-enter edit for an empty equation on mount. This covers insertion
      // via the plus menu and the slash command.
      if (editable.value && isEmpty.value) {
        enterEdit();
      }

      onBeforeUnmount(() => {
        stopOutsideWatch();
        if (rafId && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(rafId);
      });

      return () => {
        const placeholder = props.placeholder ?? i18n.t('equation.placeholder');

        // An empty equation never has a "view" mode — it renders the editor
        // directly.
        if (editing.value || (editable.value && isEmpty.value)) {
          const previewVNode = preview.value.vnode;
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
                preview.value.error
                  ? h('div', { class: 'equation-error-badge' }, i18n.t('equation.invalid'))
                  : null,
                previewVNode
                  ? h('div', { class: 'equation-preview-html' }, [previewVNode])
                  : h(SafeHtml, { html: preview.value.html, class: 'equation-preview-html' }),
              ]),
            ],
          );
        }

        const inner: VNode[] = [];
        if (isEmpty.value) {
          inner.push(
            h('span', { class: 'equation-placeholder' }, [placeholder]),
          );
        } else if (display.value.error) {
          inner.push(
            h('span', { class: 'equation-error-inline' }, [i18n.t('equation.invalid')]),
          );
        } else if (display.value.vnode) {
          inner.push(h('div', { class: 'equation-render' }, [display.value.vnode]));
        } else {
          inner.push(h(SafeHtml, { html: display.value.html, class: 'equation-render' }));
        }

        // Floating edit button (top-right), shown for content-bearing blocks
        // only.
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
}

/** The equation block bound to the built-in (zero-dependency) renderer. */
export const EquationBlock = createEquationBlock(builtinEquationRenderer);

// ---------------------------------------------------------------------------
// Extension spec
// ---------------------------------------------------------------------------

export interface EquationExtensionOptions {
  /**
   * Custom renderer (KaTeX / MathJax / ...). When omitted the built-in
   * zero-dependency renderer is used. The renderer is captured at extension
   * creation time, so the component and `serialize.toHTML` always agree.
   */
  readonly renderer?: EquationRenderer;
}

export function createEquationExtension(options: EquationExtensionOptions = {}): Extension {
  const renderer = options.renderer ?? builtinEquationRenderer;
  const component = createEquationBlock(renderer);

  return {
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
    renderer: { component, editable: false },
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
      // Renderer output derived from the raw expression — never stored in the doc.
      toHTML: (block: Block): string => {
        const e = block.attrs.expression;
        const src = typeof e === 'string' ? e : '';
        if (!src.trim()) return '';
        const result = safeRender(renderer, src, { displayMode: true });
        if (result.error) return `<p class="math-error-block">${escapeHtmlText(src)}</p>`;
        return `<div class="equation-block-rendered">${result.html}</div>`;
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
}

export const EquationExtension: Extension = createEquationExtension();
