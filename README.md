# Xiaodao Editor

[中文](./README.ZH.md) | **English** | [Demo](https://editor.xdz.me)

[![Downloads](https://img.shields.io/npm/d18m/xiaodao-editor)](https://www.npmjs.com/package/xiaodao-editor)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Vue 3.4+](https://img.shields.io/badge/Vue-3.4+-42b883.svg)](https://vuejs.org/)
[![TypeScript 5.4+](https://img.shields.io/badge/TypeScript-5.4+-3178C6.svg)](https://www.typescriptlang.org/)
[![Vite 5.0+](https://img.shields.io/badge/Vite-5.0+-646CFF.svg)](https://vitejs.dev/)

Notion-style **block editor** for Vue 3 + TypeScript. Ships as a single
zero-runtime-dependency package: a framework-agnostic core plus a Vue view
layer. Every block type (paragraph, heading, list, code, …) is contributed
by an **extension**, so the core never switches on a block type.

![Preview](./img/preview-1.png)

## Features

- **12 built-in block types**: paragraph, h1–h6 (heading), bullet list,
  ordered list, to-do, quote, code block, **image**, **equation** (LaTeX math),
  **divider**, **table**, **table of contents** (14 extensions total including
  Keymap and History behavior extensions)
- **Equation (LaTeX math) block**: renders LaTeX as a centered display
  formula via the **built-in zero-dependency math renderer** (a lightweight
  LaTeX-math subset: fractions, roots, scripts, Greek letters, functions,
  large operators, matrices, aligned rows). The document stores **only the raw
  `expression` string**: rendered output is recomputed on the fly and never
  persisted, so serialization stays lean. The renderer is **pluggable**: pass
  `createEquationExtension({ renderer })` (compose it after `BuiltinExtensions`)
  to swap in KaTeX, MathJax or any custom engine with full LaTeX support.
  Insert via the `/equation` slash command or the `+` menu; an empty block
  opens directly in edit mode. Click the block to select it; the floating ✎
  button (or clicking an empty block) opens the source editor with a live
  preview. Supports block selection and **nesting as a child block** (indents
  to match its depth). Markdown export uses `$$$ … $$$` fenced blocks.
- **Table block**: `attrs`-based N×M grid; default 120 px column widths,
  new tables default to header row; row/column selection strips,
  corner-handle to select the whole table; insert dots between rows/cols;
  floating action bar with merge/split cells, **toggle header row** (sets
  `attrs.headerRow`), and delete row/col/table; each cell uses its own
  `contenteditable` with paragraph/heading/codeBlock cell types, rich
  inline marks, cell background color, and alignment; Tab navigates
  between cells, Enter exits edit (code-block cells: Enter inserts a
  newline), Escape blurs; internal horizontal scrollbar à la Arco Design;
  full-rect merge-cell selection expansion so you can never select half
  of a merged cell.
- **Inline marks**: bold, italic, underline, strikethrough, inline code,
  **link** (`Mod-K`, URL pasting, auto-link, popover with view/edit/copy/remove,
  href sanitization to block `javascript:` / XSS), per-selection text color
  and background color
- **Block-level attrs**: alignment (left/center/right/justify), text color,
  background color, indentation (0–10); image additionally carries
  `src`, `alt`, `title`, `width`, `height`, `caption`, `fileId`
- **Slash menu**: `/` opens a searchable command palette; input rules
  (`# `, `> `, `[] `, ``` ``` ````) convert blocks on the fly; `/image`
  opens the file picker
- **Block manipulation**: drag handle, hover toolbar, `+` insert button,
  grip menu with duplicate / copy / cut / move up / move down / delete;
  **real nesting** (Tab/Shift-Tab indent/outdent builds a parent–child tree;
  drag-and-drop supports before/after sibling insert plus a **drop-into**
  mode: pause over a block's center to nest under it as its first child);
  duplicate clones the whole subtree; image additionally exposes replace /
  remove / drag-resize corner handle with locked aspect ratio and editable
  caption
- **Fixed toolbar**: persistent action bar with a contextual
  **HoverToolbar** embedded inline (so text selection is preserved when
  clicking formatting buttons). Supports four placement modes via the
  `toolbarPosition` prop: `'auto'` (default: top on desktop, bottom on
  mobile), `'top'` (always top), `'bottom'` (always bottom), or `'float'`
  (desktop only: hides the FixedToolbar and shows a floating selection
  toolbar that follows the text/table selection; falls back to the FixedToolbar
  on mobile). Menus (PlusMenu / BlockSettingsMenu) open downward when the
  toolbar is at the top.
- **Sizing & internal scrolling**: constrain the editor with `width`
  and `height` props (numbers are treated as pixels). The content area
  scrolls vertically inside the editor instead of growing unbounded,
  so embedding layouts stay in control of overflow.
- **Clipboard**: clean copy/cut/paste of HTML and plain text; multi-block
  selection overlay; **HTML `<img>` / image-file paste + drag-and-drop
  automatically create image blocks** and dispatch the upload; selecting text
  and pasting a URL wraps it as a link
- **Mobile support**: long-press to start text selection, then drag your
  finger to select **across multiple independent `contenteditable` blocks**
  via a hit-tested overlay (the native Selection API cannot cross block
  boundaries). The fixed toolbar auto-drops to the bottom above the virtual
  keyboard.
- **History**: undo/redo with typing grouping (`Mod-Z` / `Mod-Shift-Z`);
  undo restores blocks but never resurrects transient upload state
- **i18n**: `zh-CN` (default) and `en-US` via the `locale` prop; zero-dep
  translation module (no `vue-i18n`)
- **Theming**: `light` (default) and `dark` via the `theme` prop; CSS
  variables for all design tokens
- **Accessible**: keyboard navigation throughout, ARIA roles on menus
- **Table of contents**: a live, non-editable block that renders a
  hierarchical list of every heading in the document; stays in sync as
  headings are added, removed, or edited; click an entry to jump to the
  heading; insert via slash menu `/table of contents`
- **Markdown import / export**: the `Editor` instance exposes
  `toMarkdown()` and `setDocFromMarkdown(string)`. Round-trips are
  implemented natively on top of the live `DocState` (no intermediate
  `BlockData` or external converter), so heading/list nesting, inline
  code marks, and blank-line separation stay stable.

## Quick start

```sh
npm install xiaodao-editor
# or: pnpm add xiaodao-editor
```

```vue
<script setup lang="ts">
import { ref } from 'vue';
import { BlockEditor } from 'xiaodao-editor';
import type { DocumentData } from 'xiaodao-editor';
import 'xiaodao-editor/style.css';

// `initialData` seeds the document once; it is NOT two-way. Listen to
// `change` to observe edits.
const initialData: DocumentData = { blocks: [] };
const latest = ref<DocumentData>(initialData);

function onChange(doc: DocumentData): void {
  latest.value = doc;
}
</script>

<template>
  <BlockEditor :initial-data="initialData" @change="onChange" />
</template>
```

The editor ships with all 14 built-in extensions by default: no need to pass
`extensions` unless you want a custom set.

## Pluggable equation renderer

The equation block stores only the raw LaTeX `expression` string. How that
string becomes pixels is up to a pluggable renderer:

```ts
interface EquationRenderer {
  render(expression: string, options?: { displayMode?: boolean }): EquationRenderResult;
}

interface EquationRenderResult {
  /** Safe HTML string, always available (export / SSR / non-Vue consumers). */
  html: string;
  /** Optional Vue VNode tree; when present the view renders it directly (no innerHTML). */
  vnode: VNode | VNode[] | null;
  /** True when the expression has at least one error diagnostic. */
  error: boolean;
  diagnostics: readonly EquationDiagnostic[];
}
```

By default the editor uses the **built-in math renderer**, a zero-dependency
implementation of a lightweight LaTeX-math subset (tokenizer → parser → AST →
DOM): numbers/identifiers, operators (`\pm \times \div \cdot \le \ge \neq …`),
superscripts/subscripts, `\frac`, `\sqrt` / `\sqrt[n]`, Greek letters,
`\sin \cos \tan \log \ln \exp \lim \min \max`, large operators
(`\sum \prod \int` with display limits), `\begin{matrix}` and
`\begin{aligned}`. Unknown commands degrade gracefully (rendered literally)
and syntax errors show an inline warning instead of crashing: the source is
always preserved and re-parses automatically once fixed. It is *not* a full
TeX engine; for that, inject an external renderer via the
`createEquationExtension({ renderer })` factory; `<BlockEditor>` itself has no
`equationRenderer` prop, because the boundary lives at the extension layer:

```vue
<script setup lang="ts">
// KaTeX itself is NOT a dependency of xiaodao-editor, install it yourself:
//   pnpm add katex
import katex from 'katex';
// ★ KaTeX's CSS MUST be imported. KaTeX produces a flat HTML tree whose
//   positioning (superscripts, subscripts, integral limits, fraction bars,
//   combined glyphs like ∫ with upper/lower limit, etc.) is done entirely
//   by the `.katex` / `.strut` / `<sup>` / `<sub>` / `.mord` … classes. If
//   the CSS is missing, every span lays out inline and "garbled" output
//   like `∫ab`, `αx3`, `e−λx` (and any upper/lower limit, fraction) is the
//   symptom you'll see. Load it once, in your app entry (putting it next
//   to the renderer keeps the demo self-contained.
import 'katex/dist/katex.min.css';
import { createEquationExtension, BuiltinExtensions, type EquationRenderer } from 'xiaodao-editor';

const katexRenderer: EquationRenderer = {
  render(expression, options) {
    const src = expression ?? '';
    try {
      const html = katex.renderToString(src, {
        displayMode: options?.displayMode ?? true,
        throwOnError: false,   // never throw: KaTeX wraps the bad fragment
                               // in `<span class="katex-error">…</span>` instead
        trust: false,          // REQUIRED: `trust: true` allows `\href` /
                               // `\url` to inject raw HTML (XSS). Keep off.
        strict: false,         // lenient: unknown commands warn but still render
        output: 'htmlAndMathml',
      });
      // KaTeX's error sentinel class is `katex-error` (not `merror`; that
      // one is from later KaTeX versions). Surface it as `error: true` so
      // the equation block shows the ⚠ badge.
      const error = /class="katex-error"/.test(html);
      return { html, vnode: null, error, diagnostics: [] };
    } catch {
      return { html: '', vnode: null, error: true, diagnostics: [] };
    }
  },
};

// Append your renderer-bearing extension AFTER `BuiltinExtensions`. The
// extension registry is name-based deduplicated (last entry wins), so the
// appended `createEquationExtension({ renderer })` replaces the built-in's
// `EquationExtension`. Do NOT add both; pick one.
const extensions = [
  ...BuiltinExtensions,
  createEquationExtension({ renderer: katexRenderer }),
];
</script>

<template>
  <BlockEditor :extensions="extensions" />
</template>
```

`createEquationExtension({ renderer })` is the only supported way to override
the equation renderer; there is no component-level prop for this. The
registry deduplicates by extension `name` so the override extension must
appear **after** `BuiltinExtensions` (or anywhere later in the array) to
take effect. You can also import the built-in engine pieces (`parseMath`,
`renderMathToHtml`, …) from `xiaodao-editor` to build custom renderers on
top of the AST.

## Props

| Prop              | Type                                     | Default            | Description                                                                   |
| ----------------- | ---------------------------------------- | ------------------ | ----------------------------------------------------------------------------- |
| `editor`         | `Editor`                                 | `undefined`        | A pre-built instance from `createEditor()`. When set, `extensions` and `initialData` are ignored and the instance is NOT destroyed on unmount. See *External editor instance* below. |
| `initialData`     | `DocumentData \| string`                 | `{ blocks: [] }`   | The initial document. Pass a `DocumentData` object (JSON) or a Markdown `string` (parsed natively at construction). Used only at construction: changing it later does NOT reload the document (no two-way binding). Ignored when `editor` is passed. |
| `extensions`      | `readonly Extension[]`                   | `BuiltinExtensions`| Extensions to register. Override to add custom blocks, replace the equation renderer (`createEquationExtension({ renderer })`), or replace the image upload pipeline (`createImageExtension({ upload, onFileCleanup })`). Ignored when `editor` is passed. |
| `editable`        | `boolean`                                | `true`             | Read-only mode when `false`.                                                  |
| `placeholder`     | `string`                                 | locale-aware       | Placeholder for the first empty block. Defaults to a localized string.        |
| `theme`           | `'light' \| 'dark'`                      | `'light'`          | Color theme. The class is applied to `.block-editor` and synced to `<body>`.  |
| `locale`          | `'zh-CN' \| 'en-US'`                     | `'zh-CN'`          | UI language. Any non-empty value other than `'zh-CN'` ⇒ `'en-US'`.            |
| `width`           | `string \| number`                       | `undefined`        | Optional fixed width. A number is interpreted as CSS pixels; a string is used as-is (e.g. `'800px'`, `'100%'`). When unset, the editor fills its container (`width: 100%`). |
| `height`          | `string \| number`                       | `undefined`        | Optional fixed height. When set, the editor scrolls its content area **internally** rather than growing unbounded; when unset the editor grows with content and the host page scrolls. |
| `toolbarPosition` | `'auto' \| 'top' \| 'bottom' \| 'float'` | `'auto'`           | Placement of the toolbar / action bar. `'auto'` = top on desktop, bottom on mobile (above the virtual keyboard). `'float'` (desktop only) hides the FixedToolbar and uses a floating selection toolbar (HoverToolbar) that follows the text selection; on mobile it falls back to the auto FixedToolbar. |

### Pluggable image upload

Image uploads are injected by composing `createImageExtension({ upload,
onFileCleanup })` AFTER the built-in extensions. This replaces the default
mock upload (which produces `blob:` URLs that don't survive a page reload),
giving the host full control over the upload pipeline.

```ts
import {
  BuiltinExtensions,
  createImageExtension,
  type UploadImageHandler,
} from 'xiaodao-editor';

const upload: UploadImageHandler = async (name, file, controller, onProgress) => {
  // 1. request a signed URL from your backend
  const { url, fields } = await api.presign(name);

  // 2. PUT the file (with abort signal + progress)
  const xhr = new XMLHttpRequest();
  xhr.upload.addEventListener('progress', (e) => {
    if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
  });
  // ...wire controller.signal.abort into xhr.abort()...

  // 3. resolve with the public URL + a stable fileId so cleanup can fire
  return {
    url: `${CDN}/${name}`,
    width: 0, height: 0,
    fileId: hashOf(name + size), // host-chosen stable id; 0 disables cleanup
  };
};

const extensions = [
  ...BuiltinExtensions.filter((e) => e.name !== 'image'),
  createImageExtension({
    upload,
    onFileCleanup: (fileId) => api.deleteCloudFile(fileId),
  }),
];
```

The default extension bundled with `BuiltinExtensions` uses an in-memory mock
upload (with a small random failure rate) that lives only as a demo and
NOT for persisted documents.

### Emits

| Event    | Payload        | When                                                                                  |
| -------- | -------------- | ------------------------------------------------------------------------------------- |
| `change` | `DocumentData` | Fires with the latest document JSON whenever the content changes (a block added / edited / removed, not selection-only moves). Only emitted in internal-editor mode (no `editor` prop). When you own the instance, use `editor.onChange()` directly. |
| `change-markdown` | `string` | Markdown counterpart of `change`: fires with the latest document as a Markdown string on the same trigger. Only emitted in internal-editor mode (no `editor` prop). When you own the instance, use `editor.onChangeMarkdown()` directly. |

### Expose

| Member   | Type     | Description                                                                                                                                          |
| -------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `editor` | `Editor` | The framework-agnostic `Editor` instance. Useful methods: <br>`toData(): DocumentData`: export JSON. <br>`setDocument(json: DocumentData)`: replace JSON. <br>`onChange(handler: (doc: DocumentData) => void): () => void`: subscribe to document changes as JSON (returns an unsubscribe fn). <br>`onChangeMarkdown(handler: (md: string) => void): () => void`: subscribe to document changes as Markdown. <br>`toMarkdown(): string`: export native Markdown. <br>`setDocFromMarkdown(md: string)`: import native Markdown (resets history). |

This is the injected instance when the `editor` prop is used, and the
internally created one otherwise.

## External editor instance (createEditor)

By default `<BlockEditor>` creates the `Editor` itself. When you need the
instance outside the component (custom toolbars, keyboard shortcuts, a store,
tests), create it with `createEditor()` and pass it in:

```vue
<script setup lang="ts">
import { onBeforeUnmount, shallowRef } from 'vue';
import { BlockEditor, createEditor, type DocumentData } from 'xiaodao-editor';
import 'xiaodao-editor/style.css';

// The editor is framework-agnostic and never touches the DOM, so it can be
// created outside the render cycle.
const editor = createEditor({
  initialData: {
    blocks: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }],
  },
});

// You own the instance, so subscribe to changes directly (no `@change` emit).
const latest = shallowRef<DocumentData>(editor.toData());
editor.onChange((doc) => { latest.value = doc; });

// Whoever creates the editor destroys it. Call this exactly once.
onBeforeUnmount(() => {
  editor.destroy();
});
</script>

<template>
  <BlockEditor :editor="editor" />
</template>
```

Rules of ownership:

1. **`extensions` and `initialData` are ignored.** Both are fixed when the editor is built, so pass them to `createEditor()` instead. In dev mode you get a one-time console warning if you pass `extensions` (or a non-empty `initialData`) alongside `:editor`.
2. **`editable` keeps working.** `:editable="false"` still switches the view to read-only. There is no `v-model`: read the document via `editor.toData()` and observe edits via `editor.onChange()` (the component does not re-emit `change` for an injected instance).
3. **The component never destroys an injected editor.** Call
   `editor.destroy()` yourself, exactly once.
4. **Never hot-swap the prop.** `provide()` happens once during setup, so a
   different instance requires a remount:

```vue
<BlockEditor :key="editorId" :editor="editor" />
```

> Store the instance in a plain `const` or a `shallowRef`. A deep `ref()` or
> `reactive()` would hand the view layer a reactive proxy of the editor.
>
> Do not create the editor at module scope in an SSR app: the instance would be
> shared across requests. Create it per request (or per component) instead.

## Theming

All design tokens are CSS variables. Light values live under `:root`; dark
values are defined on `.block-editor.theme-dark` and `body.theme-dark` (the
latter so `<Teleport>`-ed popovers inherit them too).

```css
/* Override tokens in your app */
:root {
  --be-accent: #6366f1;
  --be-radius: 4px;
}
```

The `.block-editor` element intentionally has **no background**: the host
page controls the editor's background so it blends into the surrounding UI.
Set it explicitly if needed:

```css
.block-editor {
  background: var(--be-bg); /* or any color you want */
}
```

## Built-in extensions

`BuiltinExtensions` bundles these **14 extensions** (12 block types + 2 behavior extensions):

| Extension             | Block type      | Notes                                                            |
| --------------------- | --------------- | ---------------------------------------------------------------- |
| `ParagraphExtension`  | `paragraph`     | Default block type.                                              |
| `HeadingExtension`    | `heading`       | h1–h6 via `attrs.level` (1–6).                                   |
| `BulletListExtension` | `bulletList`    | Unordered list.                                                  |
| `OrderedListExtension`| `orderedList`   | Auto-numbered; `attrs.startNumber` for explicit override.        |
| `TodoListExtension`   | `todoList`      | Checkbox via `attrs.checked`.                                    |
| `QuoteExtension`      | `quote`         | Blockquote. No inline italic (disabled by schema).               |
| `CodeBlockExtension`  | `codeBlock`     | `attrs.language`; isolating: Enter inserts a newline.           |
| `ImageExtension`      | `image`         | `content: 'none'`; attrs `src/alt/title/width/height/caption/fileId`; serialize → HTML `<figure>`/`<img>` + Markdown `![alt](url "title")`; replace + drag-resize handle + editable caption; upload side-channel via `createImageExtension({ upload, onFileCleanup })` (see *Pluggable image upload*). The default `ImageExtension` bundled with `BuiltinExtensions` uses an in-memory mock upload (object URLs that don't survive reload) and never invokes an `onFileCleanup` callback. |
| `EquationExtension`   | `equation`      | `content: 'none'`; isolated block that stores only `attrs.expression` (raw LaTeX). A pluggable renderer produces the centered display formula on the fly (output never persisted); the default is the built-in **zero-dependency math renderer** (lightweight LaTeX subset, see the *Pluggable equation renderer* section), and KaTeX/MathJax can be injected via `createEquationExtension({ renderer })` composed after `BuiltinExtensions`. Insert via `/equation` or `+`; empty block auto-opens in edit mode; floating ✎ button edits the source with live preview. Supports block selection and nesting (indents as a child; `attrs.indent` mirrors depth). Markdown export uses `$$$ … $$$` fenced blocks. |
| `TableExtension`      | `table`         | `content: 'none'`; attrs `rows/cols/cells/colWidths/headerRow`; cell InlineSeq per cell with cellType/align/bgColor/rowspan/colspan; row/col selection strips + corner handle; floating toolbar with merge/split, **toggle header row**, delete row/col/table; row/col insert dots; full-rect selection expansion for merged cells. Default column width 120 px; new tables default to `headerRow: true`. |
| `DividerExtension`    | `divider`       | Isolating horizontal rule.                                       |
| `TableOfContentsExtension` | `tableOfContents` | `content: 'none'`; empty attrs: the heading list is a **dynamic view** computed from the editor state on every render. Non-editable block (`editable: false`); collects all `heading` blocks in document order (table-cell headings excluded automatically); click an entry to scroll the heading into view. Serialize emits empty string (the real headings are exported by their own blocks). |
| `KeymapExtension`     | n/a             | Enter / Backspace / ArrowUp / ArrowDown bindings.                |
| `HistoryExtension`    | n/a             | `Mod-Z` / `Mod-Shift-Z` / `Mod-Y` undo/redo keymap.              |

To use a **custom subset**, pass `extensions` explicitly:

```ts
import {
  ParagraphExtension, HeadingExtension,
  KeymapExtension, HistoryExtension,
} from 'xiaodao-editor';

const extensions = [
  ParagraphExtension, HeadingExtension,
  KeymapExtension, HistoryExtension,
];
```

## Document model

```ts
interface Block {
  id: BlockId;
  type: BlockType;
  attrs: Attrs;             // e.g. { level: 2, align: 'center', color: 'red' }
  content: InlineSeq;       // text runs with optional marks
  children: BlockId[];      // child block ids, real nesting:
                            // paragraph/heading + the 3 list kinds can be parents;
                            // any block type can be a child. `attrs.indent` is a
                            // derived mirror of the nesting depth.
}

interface DocumentData {
  id?: string;
  blocks: BlockData[];      // nested JSON; normalized on import
}
```

Example document:

```ts
const doc: DocumentData = {
  blocks: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Title' }] },
    { type: 'paragraph', content: [
      { type: 'text', text: 'Normal ' },
      { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
      { type: 'text', text: ' and a ' },
      { type: 'text', text: 'link', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }] },
      { type: 'text', text: '.' },
    ]},
    { type: 'codeBlock', attrs: { language: 'ts' }, content: [{ type: 'text', text: 'const x = 1' }] },
    { type: 'image', attrs: {
        src: 'https://cdn.example.com/hero.png', alt: 'Hero',
        width: 1200, height: 630, caption: 'Fig. 1: Architecture overview', fileId: 42,
      }, content: [] },
    { type: 'divider' },
    { type: 'table', attrs: {
        rows: 2, cols: 3,
        headerRow: true,
        colWidths: [120, 120, 120],
        cells: [
          [{ content: [{ type: 'text', text: 'A' }], rowspan: 1, colspan: 1, covered: false },
           { content: [{ type: 'text', text: 'B' }], rowspan: 1, colspan: 1, covered: false },
           { content: [{ type: 'text', text: 'C' }], rowspan: 1, colspan: 1, covered: false }],
          [{ content: [{ type: 'text', text: '1' }], rowspan: 1, colspan: 1, covered: false },
           { content: [{ type: 'text', text: '2' }], rowspan: 1, colspan: 1, covered: false },
           { content: [{ type: 'text', text: '3' }], rowspan: 1, colspan: 1, covered: false }],
        ],
      }, content: [] },
    { type: 'equation', attrs: { expression: 'E = mc^2' }, content: [] },
  ],
};
```

## Custom extensions

A block-type extension provides a `name`, a `schema` (block type, content kind,
and attrs with defaults + validators), and a `renderer` (a Vue component that
receives `block` and `placeholder` props). Extensions can also contribute
input rules, slash commands, keymap bindings, and Markdown/HTML
serialization. A minimal block-type extension provides a schema and a Vue
renderer:

```ts
import { defineComponent, h } from 'vue';
import type { Extension } from 'xiaodao-editor';
import { BlockContent } from 'xiaodao-editor';

const CalloutBlock = defineComponent({
  props: ['block', 'placeholder'],
  setup(props) {
    return () => h(BlockContent, {
      block: props.block,
      placeholder: props.placeholder,
      class: 'block-callout',
    });
  },
});

export const CalloutExtension: Extension = {
  name: 'callout',
  schema: {
    type: 'callout',
    content: 'text',
    attrs: {
      color: { default: 'default' },
      bgColor: { default: 'yellow' },
    },
  },
  renderer: { component: CalloutBlock },
};
```

Register it alongside the built-ins:

```ts
import { BuiltinExtensions, BlockEditor } from 'xiaodao-editor';
import { CalloutExtension } from './callout';

const extensions = [...BuiltinExtensions, CalloutExtension];
```

## Architecture

- **`src/core/`**: framework-agnostic engine (zero Vue imports, enforced by
  ESLint). Owns the document model, transactions, history, commands, schema,
  extension registries, and **native Markdown import/export**
  (`Editor.toMarkdown()` / `Editor.setDocFromMarkdown()`: operates straight
  on `DocState`, no intermediate `BlockData`).
- **`src/view/`**: Vue bridge: `BlockEditor.vue` (root), `BlockList`,
  `BlockHost`, `BlockContent` (per-block `contenteditable`), and the UI
  components (`BlockHandle`, `BlockSettingsMenu`, `HoverToolbar`, `PlusMenu`,
  `OrderedListMenu`, `NumberPicker`, `CodeLangPicker`, `LinkPopover`,
  `FixedToolbar`).
- **`src/extensions/`**: the 14 built-in extensions plus `_commonAttrs.ts`
  (shared align/color/bgColor/indent specs and color presets, plus
  `ImageExtension`'s upload-side-channel renderer logic). **Table** lives in
  `Table.ts` (Vue renderer + command registrations) and `tableModel.ts` (pure
  structural helpers: insert/remove row/col, merge/split cells, full-rect
  selection expansion, header row toggle, column width helpers, HTML/Markdown
  serialization, attrs validation/coercion). **Divider** lives in `Divider.ts`.
  **Table of contents** lives in `TableOfContents.ts` (non-editable block that
  renders a live heading list). **Equation** lives in `Equation.ts` (LaTeX math
  block; stores only `attrs.expression`, renders a centered display formula; its
  `attrs.indent` mirrors nesting depth so it indents as a child block). The
  built-in math engine lives in `extensions/math/` (tokenizer → parser → AST →
  render tree → DOM/HTML), with zero third-party dependencies.
- **`src/i18n.ts`**: locale + theme module; provides `t(key)` via Vue's
  provide/inject so popovers rendered through `<Teleport>` stay reactive.

## Development

```bash
pnpm install
pnpm dev          # playground at http://localhost:5173
pnpm typecheck    # vue-tsc --noEmit
pnpm build        # vue-tsc --noEmit && vite build  → library dist/
pnpm build:demo   # vue-tsc --noEmit && vite build --mode demo  → demo dist-demo/ (playground/App.vue)
pnpm lint         # eslint --fix
```

## License

MIT
