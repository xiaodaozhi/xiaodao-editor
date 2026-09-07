# 小刀编辑器 (Xiaodao Editor)

**中文** | [English](./README.md) | [演示](https://editor.xdz.me)

[![Downloads](https://img.shields.io/npm/d18m/xiaodao-editor)](https://www.npmjs.com/package/xiaodao-editor)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Vue 3.4+](https://img.shields.io/badge/Vue-3.4+-42b883.svg)](https://vuejs.org/)
[![TypeScript 5.4+](https://img.shields.io/badge/TypeScript-5.4+-3178C6.svg)](https://www.typescriptlang.org/)
[![Vite 5.0+](https://img.shields.io/badge/Vite-5.0+-646CFF.svg)](https://vitejs.dev/)

基于 Vue 3 + TypeScript 的 Notion 风格 **块编辑器**。以零运行时依赖的单一包形式提供：一个与框架无关的核心层 + 一个 Vue 视图层。每一种块类型（段落、标题、列表、代码块……）都由 **扩展（extension）** 提供，因此核心层永远不需要根据块类型做分支判断。

![预览](./img/preview-1.png)

## 功能特性

- **12 种内置块类型** — 段落、h1–h6（标题）、无序列表、有序列表、待办事项、引用、代码块、**图片**、**公式**（LaTeX 数学公式）、**分割线**、**表格**、**目录**（共 **14 个扩展**，另含 Keymap 与 History 两个行为扩展）
- **公式（LaTeX 数学）块** — 通过**内置零依赖数学渲染器**渲染居中的展示型公式（轻量 LaTeX 数学子集：分数、根号、上下标、希腊字母、常用函数、大型运算符、矩阵、aligned 多行对齐）。文档中**只保存原始 `expression` 字符串**——渲染输出在渲染时即时计算、永不持久化，因此序列化保持精简。渲染器**可插拔**：通过 `createEquationExtension({ renderer })` 追加在 `BuiltinExtensions` 之后（name-based 去重，后排赢出）即可注入 KaTeX、MathJax 或任何自定义引擎获得完整 LaTeX 支持；**`<BlockEditor>` 没有 `equationRenderer` 这个 prop**。通过 `/公式` 斜杠命令或 `+` 菜单插入；空块会直接进入编辑态。点击块即可选中；右上角的浮动 ✎ 按钮（或点击空块）打开源码编辑器并带实时预览。支持块级选中，也**可作为子块嵌套**（按嵌套深度自动缩进）。Markdown 导出使用 `$$$ … $$$` 围栏块。
- **表格块** — 基于 `attrs` 的 N×M 网格；新建表格默认列宽 120 px、默认启用标题行；行/列选择条 + 左上角角部全选手柄；行/列之间插入点；浮动操作栏提供合并/拆分单元格、**切换标题行**（设置 `attrs.headerRow`）、删除行/列/整个表；单元格使用独立的 `contenteditable`，支持段落/标题/代码块类型、富行内标记、单元格背景色与对齐；Tab 在单元格间导航，Enter 退出编辑（代码块单元格按 Enter 插入换行），Escape 失焦；仿 Arco Design 的内部水平滚动条；矩形选区遇到合并单元格时会自动扩展以保证永远不会只选中合并单元格的一半。
- **行内样式标记** — 粗体、斜体、下划线、删除线、行内代码、**链接**（`Mod-K` 快捷键、粘贴 URL、自动识别、浮层查看/编辑/复制/删除、href 净化阻断 `javascript:` / XSS），以及按选区设置的文字颜色与背景色
- **块级属性** — 对齐方式（左/中/右/两端）、文字颜色、背景色、缩进（0–10 级）；图片额外携带 `src`、`alt`、`title`、`width`、`height`、`caption`、`fileId`
- **斜杠菜单** — 输入 `/` 打开可搜索的命令面板；输入规则（`# `、`> `、`[] `、```` ``` ````）可即时转换块类型；`/image` 打开文件选择器
- **块操作** — 拖拽手柄、悬浮工具栏、`+` 插入按钮，含「复制 / 剪切 / 上移 / 下移 / 删除」的操作菜单；**真实嵌套**（Tab / Shift-Tab 缩进/反缩进构建父子树；拖拽支持兄弟节点的上/下插入 + **"拖入块内"** 模式 — 在块中心停顿一下即可作为第一个子块嵌套进去）；复制会克隆整个子树；图片额外提供替换 / 删除、角部等比缩放手柄、可编辑 caption
- **固定工具栏（FixedToolbar）** — 常驻操作栏，在工具栏内部内嵌了上下文相关的 **HoverToolbar**（点击格式化按钮时可以保持文本选区不丢失）。通过 `toolbarPosition` prop 控制四种位置：`'auto'`（默认，桌面端顶、移动端底）、`'top'`（强制顶部）、`'bottom'`（强制底部），或 `'float'`（仅桌面端——隐藏 FixedToolbar，改用跟随文本选区浮现的浮动工具栏；移动端自动回退为 FixedToolbar）。工具栏在顶部时，PlusMenu / 手柄菜单会改为向下弹出。
- **尺寸控制与内部滚动** — 通过 `width` 和 `height` prop 约束编辑器（数字按 px 解析）。内容区域会**在编辑器内部纵向滚动**，而不是无限向下生长，外部布局无需自行管理 overflow。
- **剪贴板** — HTML 与纯文本的干净复制 / 剪切 / 粘贴；多块选区覆盖层；**粘贴 HTML `<img>` / 图片文件 + 拖拽文件到编辑器内会自动创建图片块并发起上传**；选中文本后粘贴 URL 会包裹为链接
- **移动端支持** — 长按后开始选中文本，然后拖动手指即可**跨多个独立 `contenteditable` 块**进行选择（通过 hit-testing + overlay 实现，因为原生 Selection API 不支持跨块边界）。固定工具栏会自动落到屏幕底部，位于虚拟键盘之上。
- **历史记录** — 按输入分组的撤销 / 重做（`Mod-Z` / `Mod-Shift-Z`）；撤销只会恢复块本身，不会"复活"临时的上传状态
- **国际化 i18n** — 通过 `locale` prop 切换 `zh-CN`（默认）与 `en-US`；零依赖翻译模块（不需要 `vue-i18n`）
- **主题** — 通过 `theme` prop 切换 `light`（默认）与 `dark`；所有设计令牌均以 CSS 变量暴露
- **可访问性** — 全程键盘导航，菜单具备 ARIA 角色
- **目录（Table of Contents）** — 不可编辑的动态块，实时渲染文档中所有标题的层级列表；标题增删改时自动同步；点击条目可跳转到对应标题；通过斜杠菜单 `/目录` 插入
- **Markdown 原生导入 / 导出** — `Editor` 实例暴露了 `toMarkdown()` 和 `setDocFromMarkdown(string)` 方法。往返转换直接基于实时 `DocState`（不经过中间的 `BlockData` 或外部转换器），标题/列表的嵌套层级、行内代码标记、块间空行分隔均能稳定保持。

## 快速开始

```sh
npm install xiaodao-editor
# 或者：pnpm add xiaodao-editor
```

```vue
<script setup lang="ts">
import { ref } from 'vue';
import { BlockEditor } from 'xiaodao-editor';
import type { DocumentData } from 'xiaodao-editor';
import 'xiaodao-editor/style.css';

const doc = ref<DocumentData>({ blocks: [] });
</script>

<template>
  <BlockEditor v-model="doc" />
</template>
```

编辑器默认内置全部 14 种扩展 — 除非你需要自定义集合，否则无需传入 `extensions`。

## 可插拔公式渲染器

公式块只保存原始 LaTeX `expression` 字符串，字符串如何变成像素由可插拔的渲染器决定：

```ts
interface EquationRenderer {
  render(expression: string, options?: { displayMode?: boolean }): EquationRenderResult;
}

interface EquationRenderResult {
  /** 安全 HTML 字符串 —— 始终可用（导出 / SSR / 非 Vue 消费方）。 */
  html: string;
  /** 可选的 Vue VNode 树；存在时视图直接渲染它（不走 innerHTML）。 */
  vnode: VNode | VNode[] | null;
  /** 表达式存在 error 级诊断时为 true。 */
  error: boolean;
  diagnostics: readonly EquationDiagnostic[];
}
```

默认使用**内置数学渲染器** —— 零第三方依赖的轻量 LaTeX 数学子集实现
（tokenizer → parser → AST → DOM）：数字/标识符、运算符（`\pm \times \div \cdot \le \ge \neq` 等）、
上下标、`\frac`、`\sqrt` / `\sqrt[n]`、希腊字母、`\sin \cos \tan \log \ln \exp \lim \min \max`、
大型运算符（`\sum \prod \int`，display 模式下上下标置于符号上下方）、
`\begin{matrix}` 与 `\begin{aligned}`。未知命令会优雅降级（原样显示），
语法错误显示内联警告而不会让编辑器崩溃——源码始终保留，修复后自动重新解析。
它**不是**完整 TeX 引擎；需要完整支持时注入外部渲染器：

```vue
<script setup lang="ts">
// KaTeX 本身不是 xiaodao-editor 的依赖 —— 自行安装：
//   pnpm add katex
import katex from 'katex';
// ★ KaTeX 的 CSS 必须显式引入 ★
//   KaTeX 渲染出的是平铺的 HTML 树，「上下标、积分限、分式、∫ 上下限」等
//   一切排版都由 .katex / .strut / <sup> / <sub> 等类名驱动。没引 CSS 时，
//   所有 span 会按行内文本平铺——「∫ab」「αx3」「e−λx」之类错位就是这症状。
//   在 app 入口加载一次即可；这里引入只是让 demo 自洽。
import 'katex/dist/katex.min.css';
import { createEquationExtension, BuiltinExtensions, type EquationRenderer } from 'xiaodao-editor';

const katexRenderer: EquationRenderer = {
  render(expression, options) {
    const src = expression ?? '';
    try {
      // `output: 'htmlAndMathml'` 与项目 449885a 之前的版本一致：视觉上
      // 与 HTML 无异，同时内联一段 <math>，对读屏 / SSR 友好。改 `html`
      // 也可以，但会丢掉 MathML 分支。
      const html = katex.renderToString(src, {
        displayMode: options?.displayMode ?? true,
        throwOnError: false,   // 不抛错 —— 出错片段包成 <span class="katex-error">…</span>
        trust: false,          // 必选：trust: true 会放开 \href / \url 的原始 HTML 注入（XSS）
        strict: false,         // 宽松：未知命令不报警
        output: 'htmlAndMathml',
      });
      // KaTeX 标记错误的 class 是 `katex-error`（不是 merror —— merror 是更新版）。
      // 命中后让 Equation 块显示 ⚠ 徽章。
      const error = /class="katex-error"/.test(html);
      return { html, vnode: null, error, diagnostics: [] };
    } catch {
      return { html: '', vnode: null, error: true, diagnostics: [] };
    }
  },
};

// 把带自定义渲染器的扩展 append 到 BuiltinExtensions 之后，
// 注册器按 name 去重（后写赢），所以最终生效的是这个。
// 不要并列塞两个 createEquationExtension —— 二选一。
const extensions = [
  ...BuiltinExtensions,
  createEquationExtension({ renderer: katexRenderer }),
];
</script>

<template>
  <BlockEditor v-model="doc" :extensions="extensions" />
</template>
```

`createEquationExtension({ renderer })` 把带自定义渲染器的公式扩展追加到 `BuiltinExtensions` 之后（name-based 去重，后排赢出）即可覆盖内置版本——`<BlockEditor>` 没有 `equationRenderer` prop。也可以从 `xiaodao-editor` 导入内置引擎的基础件（`parseMath`、`SUPPORTED_COMMANDS` 等），在 AST 之上构建自定义渲染器。

## Props 属性

| 属性名            | 类型                                     | 默认值                 | 说明                                                                          |
| ----------------- | ---------------------------------------- | ---------------------- | ----------------------------------------------------------------------------- |
| `modelValue`      | `DocumentData`                           | `{ blocks: [] }`       | 文档 JSON（通过 `v-model` 双向绑定）。                                         |
| `extensions`      | `readonly Extension[]`                   | `BuiltinExtensions`    | 要注册的扩展。可覆盖此值以添加自定义块、覆盖公式渲染器（`createEquationExtension({ renderer })`）、或替换图片上传管线（`createImageExtension({ upload, onFileCleanup })`）。 |
| `editable`        | `boolean`                                | `true`                 | 为 `false` 时进入只读模式。                                                    |
| `placeholder`     | `string`                                 | 跟随 locale            | 首个空块的占位符，默认使用本地化字符串。                                        |
| `theme`           | `'light' \| 'dark'`                      | `'light'`              | 颜色主题。对应类名会应用到 `.block-editor` 并同步到 `<body>`。                   |
| `locale`          | `'zh-CN' \| 'en-US'`                     | `'zh-CN'`              | UI 语言。非 `'zh-CN'` 的任何非空值都会落到 `'en-US'`。                         |
| `width`           | `string \| number`                       | `undefined`            | 可选：编辑器宽度。数字按 CSS px 解析；字符串直接使用（如 `'800px'`、`'100%'`）。未设置时默认撑满容器（`width: 100%`）。 |
| `height`          | `string \| number`                       | `undefined`            | 可选：编辑器高度。设置后内容区域会在编辑器**内部**滚动，不再无限向下生长；未设置时编辑器随内容扩展，由宿主页面接管滚动。 |
| `toolbarPosition` | `'auto' \| 'top' \| 'bottom' \| 'float'` | `'auto'`               | 工具栏 / 操作栏的位置。`'auto'` = 桌面端自动顶栏、移动端自动底栏（位于虚拟键盘上方）。`'float'`（仅桌面端）隐藏 `FixedToolbar`，改用跟随文本/表格选区的浮动工具栏（HoverToolbar）；移动端自动回退为 `FixedToolbar`。 |

### 可插拔图片上传

图片上传由 `createImageExtension({ upload, onFileCleanup })` 在 `BuiltinExtensions`
之后组成来注入。这会替换默认的 mock 上传（默认 mock 会产生 `blob:` URL，
页面刷新后失效），由宿主完全控制上传管线。

```ts
import {
  BuiltinExtensions,
  createImageExtension,
  type UploadImageHandler,
} from 'xiaodao-editor';

const upload: UploadImageHandler = async (name, file, controller, onProgress) => {
  // 1. 向你的后端请求签名 URL
  const { url, fields } = await api.presign(name);

  // 2. PUT 文件（带 abort + 进度上报）
  const xhr = new XMLHttpRequest();
  xhr.upload.addEventListener('progress', (e) => {
    if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
  });
  // ...把 controller.signal.abort 接到 xhr.abort() ...

  // 3. resolve 出公开 URL + 一个稳定的 fileId，便于清理回调触发
  return {
    url: `${CDN}/${name}`,
    width: 0, height: 0,
    fileId: hashOf(name + size), // 宿主自选的稳定 id；传 0 会禁掉清理回调
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

`BuiltinExtensions` 默认携带的 `ImageExtension` 使用内存内 mock 上传（带随机
失败率），仅作为演示；**不可用于持久化文档**。

### Emits 事件

| 事件名                    | 载荷           | 触发时机                                                                              |
| ------------------------- | -------------- | ------------------------------------------------------------------------------------- |
| `update:modelValue`       | `DocumentData` | 文档变更（失焦时做防抖处理）。                                                          |

### Expose 暴露成员

| 成员名   | 类型     | 说明                                                                                                                                                                                                  |
| -------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `editor` | `Editor` | 与框架无关的 `Editor` 实例。常用方法：<br>`toData(): DocumentData` — 导出 JSON。<br>`setDocument(json: DocumentData)` — 用新 JSON 替换整个文档。<br>`toMarkdown(): string` — 原生导出 Markdown。<br>`setDocFromMarkdown(md: string)` — 原生导入 Markdown（会重置历史）。 |

## 主题化

所有设计令牌均为 CSS 变量。浅色值定义在 `:root` 下；深色值定义在 `.block-editor.theme-dark` 与 `body.theme-dark` 上（后者用于让 `<Teleport>` 渲染的浮层也能继承主题）。

```css
/* 在你的应用中覆盖令牌 */
:root {
  --be-accent: #6366f1;
  --be-radius: 4px;
}
```

`.block-editor` 元素**故意不设置背景** — 由宿主页面控制编辑器的背景，以便自然融入周围 UI。如需显式设置：

```css
.block-editor {
  background: var(--be-bg); /* 或任意颜色 */
}
```

## 内置扩展

`BuiltinExtensions` 打包了以下 **14 种扩展**（12 种块类型 + 2 个行为扩展）：

| 扩展名称               | 块类型         | 说明                                                                 |
| ---------------------- | -------------- | -------------------------------------------------------------------- |
| `ParagraphExtension`   | `paragraph`    | 默认块类型。                                                          |
| `HeadingExtension`     | `heading`      | 通过 `attrs.level` 控制 h1–h6（1–6）。                                |
| `BulletListExtension`  | `bulletList`   | 无序列表。                                                            |
| `OrderedListExtension` | `orderedList`  | 自动编号；可通过 `attrs.startNumber` 显式覆盖起始序号。                  |
| `TodoListExtension`    | `todoList`     | 通过 `attrs.checked` 控制复选框状态。                                  |
| `QuoteExtension`       | `quote`        | 引用块。schema 禁用了行内斜体。                                        |
| `CodeBlockExtension`   | `codeBlock`    | `attrs.language` 设置语言；隔离模式 — Enter 插入换行。                 |
| `ImageExtension`       | `image`        | `content: 'none'`；属性：`src/alt/title/width/height/caption/fileId`；序列化：HTML `<figure>`/`<img>` + Markdown `![alt](url "title")`；提供替换 / 删除 / 等比缩放手柄 + 可编辑 caption；通过 `createImageExtension({ upload, onFileCleanup })` 注入上传侧信道，详见「可插拔图片上传」。`BuiltinExtensions` 默认携带的 `ImageExtension` 使用内存内 mock 上传（`blob:` URL 无法跨刷新存活），不会触发任何 `onFileCleanup` 回调。 |
| `EquationExtension`    | `equation`     | `content: 'none'`；隔离型块——只保存 `attrs.expression`（原始 LaTeX）。**默认使用零依赖的内置数学渲染器**（轻量 LaTeX 子集，见「可插拔公式渲染器」），通过 `createEquationExtension({ renderer })` 追加在 `BuiltinExtensions` 之后（name-based 去重，后排赢出）注入 KaTeX/MathJax 即可覆盖。**`<BlockEditor>` 没有 `equationRenderer` prop**。通过 `/公式` 或 `+` 插入；空块自动进入编辑态；浮动 ✎ 按钮打开带实时预览的源码编辑器。支持块级选中与嵌套（作为子块时随深度缩进，`attrs.indent` 即为深度镜像）。Markdown 导出使用 `$$$ … $$$` 围栏块。 |
| `TableExtension`       | `table`        | `content: 'none'`；属性：`rows/cols/cells/colWidths/headerRow`；单元格 InlineSeq 含 cellType/align/bgColor/rowspan/colspan；行/列选择条 + 角部全选手柄；浮动操作栏提供合并/拆分、**切换标题行**、删除行/列/表格；行/列插入点；合并单元格选区自动扩展为完整矩形。默认列宽 120 px；新建表格默认 `headerRow: true`。 |
| `DividerExtension`     | `divider`      | 隔离型水平分割线。                                                     |
| `TableOfContentsExtension` | `tableOfContents` | `content: 'none'`；空 attrs — 标题列表是每次渲染时从编辑器状态计算的**动态视图**。不可编辑块（`editable: false`）；按文档顺序收集所有 `heading` 块（表格单元格内的标题自动排除）；点击条目滚动到对应标题。序列化输出空字符串（真正的标题由各自的块导出）。 |
| `KeymapExtension`      | —              | 绑定 Enter / Backspace / ↑ / ↓。                                      |
| `HistoryExtension`     | —              | `Mod-Z` / `Mod-Shift-Z` / `Mod-Y` 撤销 / 重做快捷键。                  |

要使用**自定义子集**，请显式传入 `extensions`：

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

## 文档模型

```ts
interface Block {
  id: BlockId;
  type: BlockType;
  attrs: Attrs;             // 例如 { level: 2, align: 'center', color: 'red' }
  content: InlineSeq;       // 带可选标记的文本片段
  children: BlockId[];      // 子块 id — 真实嵌套：paragraph/heading +
                            // 3 种列表块可以做父；任何块类型都能做子。`attrs.indent`
                            // 是嵌套深度的衍生镜像。
}

interface DocumentData {
  id?: string;
  blocks: BlockData[];      // 嵌套 JSON；导入时会做规范化
}
```

文档示例：

```ts
const doc: DocumentData = {
  blocks: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: '标题' }] },
    { type: 'paragraph', content: [
      { type: 'text', text: '普通 ' },
      { type: 'text', text: '粗体', marks: [{ type: 'bold' }] },
      { type: 'text', text: ' 和一个 ' },
      { type: 'text', text: '链接', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }] },
      { type: 'text', text: '。' },
    ]},
    { type: 'codeBlock', attrs: { language: 'ts' }, content: [{ type: 'text', text: 'const x = 1' }] },
    { type: 'image', attrs: {
        src: 'https://cdn.example.com/hero.png', alt: '主图',
        width: 1200, height: 630, caption: '图 1 — 架构总览', fileId: 42,
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

## 自定义扩展

一个块类型扩展需要提供 `name`（名称）、`schema`（块类型、内容类型、带默认值与校验器的属性）和 `renderer`（接收 `block` 与 `placeholder` props 的 Vue 组件）。扩展还可以贡献输入规则、斜杠命令、键位映射绑定以及 Markdown/HTML 序列化。最小化的块类型扩展只需提供 schema 和 Vue 渲染器：

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

将其与内置扩展一起注册：

```ts
import { BuiltinExtensions, BlockEditor } from 'xiaodao-editor';
import { CalloutExtension } from './callout';

const extensions = [...BuiltinExtensions, CalloutExtension];
```

## 架构

- **`src/core/`** — 与框架无关的引擎（零 Vue 导入，由 ESLint 强制约束）。负责文档模型、事务、历史记录、命令、schema、扩展注册表，以及 **Markdown 原生导入/导出**
  （`Editor.toMarkdown()` / `Editor.setDocFromMarkdown()` — 直接操作 `DocState`，不经过中间的 `BlockData`）。
- **`src/view/`** — Vue 桥接层：`BlockEditor.vue`（根组件）、`BlockList`、`BlockHost`、`BlockContent`（每个块的 `contenteditable`），以及 UI 组件（`BlockHandle`、`BlockSettingsMenu`、`HoverToolbar`、`PlusMenu`、`OrderedListMenu`、`NumberPicker`、`CodeLangPicker`、`LinkPopover`、`FixedToolbar`）。
- **`src/extensions/`** — 14 种内置扩展，以及 `_commonAttrs.ts`（共享的 align / color / bgColor / indent 规格与颜色预设，`ImageExtension` 还在此层实现了上传侧信道的渲染逻辑）。**表格** 位于 `Table.ts`（Vue 渲染器 + 命令注册）与 `tableModel.ts`（纯函数式结构操作：插入/删除行/列、合并/拆分单元格、合并选区完整矩形扩展、切换标题行、列宽辅助、HTML/Markdown 序列化、attrs 校验/规整）。**分割线** 位于 `Divider.ts`。**目录** 位于 `TableOfContents.ts`（不可编辑的动态块，实时渲染文档标题列表）。**公式** 位于 `Equation.ts`（LaTeX 数学块；只保存 `attrs.expression`，渲染居中展示公式；`attrs.indent` 镜像嵌套深度，作为子块时随深度缩进）。内置数学引擎位于 `extensions/math/`（tokenizer → parser → AST → 渲染树 → DOM/HTML），零第三方依赖。
- **`src/i18n.ts`** — locale + 主题模块；通过 Vue 的 provide/inject 提供 `t(key)`，让 `<Teleport>` 渲染的浮层也保持响应式。

## 开发

```bash
pnpm install
pnpm dev          # playground 地址：http://localhost:5173
pnpm typecheck    # vue-tsc --noEmit
pnpm build        # vue-tsc --noEmit && vite build  → 产物 dist/（库模式）
pnpm build:demo   # vue-tsc --noEmit && vite build --mode demo  → 产物 dist-demo/（演示模式，含 playground/App.vue）
pnpm lint         # eslint --fix
```

## 许可证

MIT
