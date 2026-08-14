/**
 * CodeBlock / fenced code extension.
 *
 * Marked as an *isolating* block:
 *   - Enter inserts a newline inside the block (not a new paragraph).
 *   - Backspace at offset 0 on an empty code block removes it; it will NOT
 *     merge into the previous block.
 *   - Schema `content: 'text'` but the renderer switches to `white-space: pre;
 *     font-family: monospace`.
 *
 * Markdown shortcuts: ```  (three backticks + Enter or space) or ```lang.
 *
 * Syntax highlighting (highlight.js):
 *   The block renders as a two-layer stack so code can be highlighted
 *   without ever writing rich HTML into the contenteditable:
 *     - A decorative `<pre class="block-code-highlight">` layer
 *       (position: absolute, pointer-events: none, aria-hidden) that shows
 *       the highlighted tokens, aligned pixel-for-pixel with the text layer.
 *     - The normal `BlockContent` editable layer on top. Its text color is
 *       transparent by default (only the caret stays visible) so the
 *       highlight layer shows through. While the block is focused, the text
 *       layer becomes visible again (plain text, like Notion) and the
 *       highlight layer fades out — no visual overlap, and the editor model
 *       keeps plain text at all times.
 */

import { defineComponent, h, ref, computed, type PropType } from 'vue';
import { useI18n } from '../i18n';
import type { Extension } from '../core/extension/Extension';
import type { Block } from '../core/types';
import { inlineText } from '../core/types';
import BlockContent from '../view/BlockContent.vue';
import { useEditable } from '../view/context';
import { ICON_CODE } from '../view/ui/icons';
import { classesFromAttrs, CODE_BLOCK_ATTRS } from './_commonAttrs';

// --- Syntax highlighting -------------------------------------------------
// Tree-shaken highlight.js: core only + the languages the editor exposes in
// the code-language dropdown. Registering under a canonical hljs name also
// enables its aliases (`xml` covers html, `bash` covers shell/sh/zsh,
// `dos` covers cmd/bat).
import hljs from 'highlight.js/lib/core';
import type { LanguageFn } from 'highlight.js';
import langJavascript from 'highlight.js/lib/languages/javascript';
import langTypescript from 'highlight.js/lib/languages/typescript';
import langPython from 'highlight.js/lib/languages/python';
import langJava from 'highlight.js/lib/languages/java';
import langC from 'highlight.js/lib/languages/c';
import langCpp from 'highlight.js/lib/languages/cpp';
import langCsharp from 'highlight.js/lib/languages/csharp';
import langGo from 'highlight.js/lib/languages/go';
import langRust from 'highlight.js/lib/languages/rust';
import langRuby from 'highlight.js/lib/languages/ruby';
import langPhp from 'highlight.js/lib/languages/php';
import langSwift from 'highlight.js/lib/languages/swift';
import langKotlin from 'highlight.js/lib/languages/kotlin';
import langXml from 'highlight.js/lib/languages/xml';
import langCss from 'highlight.js/lib/languages/css';
import langJson from 'highlight.js/lib/languages/json';
import langYaml from 'highlight.js/lib/languages/yaml';
import langMarkdown from 'highlight.js/lib/languages/markdown';
import langLua from 'highlight.js/lib/languages/lua';
import langBash from 'highlight.js/lib/languages/bash';
import langPowershell from 'highlight.js/lib/languages/powershell';
import langDos from 'highlight.js/lib/languages/dos';
import langSql from 'highlight.js/lib/languages/sql';
import langDart from 'highlight.js/lib/languages/dart';

const HLJS_LANGS: Array<[string, LanguageFn]> = [
  ['javascript', langJavascript],
  ['typescript', langTypescript],
  ['python', langPython],
  ['java', langJava],
  ['c', langC],
  ['cpp', langCpp],
  ['csharp', langCsharp],
  ['go', langGo],
  ['rust', langRust],
  ['ruby', langRuby],
  ['php', langPhp],
  ['swift', langSwift],
  ['kotlin', langKotlin],
  ['xml', langXml], // html is an alias of xml
  ['css', langCss],
  ['json', langJson],
  ['yaml', langYaml],
  ['markdown', langMarkdown],
  ['lua', langLua],
  ['bash', langBash], // shell / sh / zsh are aliases of bash
  ['powershell', langPowershell],
  ['dos', langDos], // cmd / bat are aliases of dos
  ['sql', langSql],
  ['dart', langDart],
];
for (const [name, fn] of HLJS_LANGS) hljs.registerLanguage(name, fn);

/**
 * Editor language attr → highlight.js grammar name.
 * Languages absent from this map (including `plain`) fall back to escaped
 * plain text with no highlighting.
 */
const HLJS_LANG_MAP: Record<string, string> = {
  javascript: 'javascript',
  typescript: 'typescript',
  python: 'python',
  java: 'java',
  c: 'c',
  cpp: 'cpp',
  csharp: 'csharp',
  go: 'go',
  rust: 'rust',
  ruby: 'ruby',
  php: 'php',
  swift: 'swift',
  kotlin: 'kotlin',
  html: 'xml',
  css: 'css',
  json: 'json',
  xml: 'xml',
  yaml: 'yaml',
  markdown: 'markdown',
  lua: 'lua',
  bash: 'bash',
  shell: 'bash',
  powershell: 'powershell',
  cmd: 'dos',
  bat: 'dos',
  sql: 'sql',
  dart: 'dart',
};

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Render plain text as highlighted HTML (or escaped plain text). */
function highlightCode(text: string, lang: string): string {
  const grammar = HLJS_LANG_MAP[lang];
  if (!grammar || text.length === 0) return escapeHtml(text);
  try {
    return hljs.highlight(text, { language: grammar, ignoreIllegals: true }).value;
  } catch {
    return escapeHtml(text);
  }
}

const CodeBlock = defineComponent({
  name: 'CodeBlock',
  props: {
    block: { type: Object as PropType<Block>, required: true },
    placeholder: { type: String, default: undefined },
  },
  setup(props) {
    const langEl = ref<HTMLElement | null>(null);
    const i18n = useI18n();
    const editable = useEditable();

    // Decorative highlight HTML. Computed so re-highlighting only happens
    // when the block's content or language actually changes.
    const highlightHtml = computed(() =>
      highlightCode(
        inlineText(props.block.content),
        (props.block.attrs.language as string) ?? 'plain',
      ),
    );

    return () => {
      const lang = (props.block.attrs.language as string) ?? 'plain';
      const langLabel = h(
        'div',
        {
          ref: langEl,
          class: 'block-code-lang',
          onMousedown: (e: MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
          },
          onClick: (e: MouseEvent) => {
            e.stopPropagation();
            // Read-only: clicking the language label must not open the picker.
            if (!editable.value) return;
            const ev = new CustomEvent('code-lang-click', {
              bubbles: true,
              detail: { blockId: props.block.id, anchor: langEl.value },
            })
            ;(e.currentTarget as HTMLElement).dispatchEvent(ev);
          },
        },
        lang.toUpperCase(),
      );
      // Static "code block" label pinned to the top-left corner, sharing the
      // typography of the language label (top-right). Purely decorative —
      // clicks pass through to the editable area (pointer-events: none).
      const titleLabel = h('div', { class: 'block-code-title' }, i18n.t('codeBlock.title'));
      // Highlight layer: absolutely positioned under the editable text layer.
      const highlightLayer = h(
        'pre',
        { class: 'block-code-highlight', 'aria-hidden': 'true' },
        [h('code', { class: 'hljs', innerHTML: highlightHtml.value })],
      );
      return h('div', { class: ['block-code-wrapper', 'block-focus-root', ...classesFromAttrs(props.block.attrs)], 'data-lang': lang }, [
        titleLabel,
        langLabel,
        highlightLayer,
        h(BlockContent, {
          block: props.block,
          placeholder: props.placeholder,
          class: 'block-code',
        }),
      ]);
    };
  },
});

export const CodeBlockExtension: Extension = {
  name: 'codeBlock',
  schema: {
    type: 'codeBlock',
    content: 'text',
    nestable: false,
    isolating: true,
    inlineMarks: false,
    attrs: {
      ...CODE_BLOCK_ATTRS,
      language: {
        default: 'plain',
        validate: (v: unknown): boolean => typeof v === 'string' && v.length > 0,
      },
    },
  },
  renderer: { component: CodeBlock },
  slashCommands: [
    {
      id: 'code-block',
      title: 'slash.codeBlock.title',
      keywords: ['code', 'fence', 'pre', '代码', '代码块', '```', 'codeblock'],
      description: 'slash.codeBlock.description',
      icon: ICON_CODE,
      command: 'convertBlock',
      category: 'other',
      args: (): unknown => ({ id: '__currentBlock__', type: 'codeBlock', attrs: { language: 'plain' } }),
    },
  ],
  inputRules: [
    {
      name: 'code-fence',
      pattern: /^``` ?$/,
      command: 'convertBlock',
      args: (m: RegExpExecArray | null): unknown => {
        const text = m?.input ?? '';
        // Extract language if user typed ```js — the pattern's $ ensures it's
        // just ``` plus optional trailing space, so language defaults to plain.
        void text;
        return {
          id: '__currentBlock__',
          type: 'codeBlock',
          attrs: { language: 'plain' },
          __stripPrefix: 3,
        };
      },
    },
  ],
};
