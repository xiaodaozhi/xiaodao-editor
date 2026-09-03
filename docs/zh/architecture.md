# 小刀编辑器架构设计

本文档定义了面向生产环境的、Notion 风格的**块编辑器**架构，该编辑器以**可复用的 Vue 3 + TypeScript 包**形式交付。它是编辑器设计的唯一权威来源。实现必须遵循本文档；当实现暴露出缺陷时，我们**先**更新本文档，**再**修改代码。

---

## 1. 执行摘要

我们构建一个**自定义的、块优先（block-first）的编辑器核心**。该核心作用于一棵由**块**组成的 JSON 树，并且对具体的块类型（paragraph、heading、todo……）一无所知。每种块类型都由一个**扩展（extension）**贡献，扩展会注册自己的 schema、Vue 渲染器、命令、键位映射、输入规则、斜杠命令和序列化器。

行内文本编辑被委托给浏览器原生的 `contenteditable`，并**按块作用域（per block）**隔离。核心拥有*块树*、*跨块选择*、*事务（wallet transactions）*、*历史（history）* 和*命令分发（command dispatch）*。浏览器则负责*单个块内*的光标放置与 IME 组合（composition）。

```
┌──────────────────────────────────────────────────────────────┐
│                        应用层(Application)                    │
│   使用 <BlockEditor :model> / useEditor() API                │
└──────────────────────────────────────────────────────────────┘
                              │
┌──────────────────────────────────────────────────────────────┐
│  编辑器包(本仓库)                                             │
│                                                              │
│  ┌────────────┐   ┌──────────────┐   ┌─────────────────────┐ │
│  │  核心 API   │──▶│   状态 /      │──▶│  视图桥接           │ │
│  │ (commands, │   │ 事务 · 历史   │   │ (Vue <-> state)     │ │
│  │  plugins)  │   │             │   │ 按块订阅             │ │
│  └─────┬──────┘   └──────────────┘   └─────────┬───────────┘ │
│        │                                        │             │
│        │           ┌────────────────────────────┘             │
│        ▼           ▼                                          │
│  ┌──────────────────────────┐   ┌──────────────────────────┐ │
│  │   扩展注册表              │   │   块渲染器(Vue)           │ │
│  │ schema/命令/键位/规则/    │   │ <BlockHost> 解析          │ │
│  │ 斜杠/序列化               │   │ type -> component        │ │
│  └──────────────────────────┘   └──────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

---

## 2. 调研：现代块编辑器是如何设计的

### 2.1 ProseMirror

ProseMirror 是一个**文档编辑器工具包**，而不是块编辑器。它的模型是一棵由*节点*（块级与行内）组成的树，并带有*标记（marks）*（行内格式化），由**schema** 描述。状态是不可变的；变更通过**事务（transactions）**（`EditorState.apply(tr)`）进行。渲染由单个文档级的 `contenteditable` 驱动，ProseMirror 通过 diff/patch 步骤将其与自身模型进行调和（reconcile）。插件扩展其行为（键位映射、历史、装饰、输入规则）。

- 优势：非常成熟；处理 IME、选择、剪贴板、撤销/重做的质量达到了需要多年才达到的水平；被纽约时报、卫报、GitLab 使用。
- 对我们场景的劣势：**文本/散文优先（text/prose-first）**。一个"块"只是一个节点；真正的编辑单位是行内文档。块级操作（移动块、多块选择、嵌套交互块）需要繁重的**node-view** 机制，而这会与 ProseMirror 对 DOM 的所有权相冲突。schema 在**构造时一次性定义**；动态注册块很别扭。由于 ProseMirror 拥有 DOM，渲染控制受限。

### 2.2 Tiptap

Tiptap 是 ProseMirror 之上的一个**无头（headless）**封装，提供干净的扩展/composable API 和框架绑定（Vue、React）。它让 ProseMirror 更易用，并通过 `NodeViewWrapper` 提供 Vue 渲染器。

- 优势：ProseMirror 之上最优秀的开发体验；无头（样式自由）；通过 Yjs 支持协作编辑。
- 劣势：继承了 ProseMirror 全部"散文优先"的约束。动态块注册仍然与 schema 冲突。Vue node-view 桥接是一种妥协——ProseMirror 仍然拥有文档 DOM，因此按块划分的 Vue 组件生活在它控制的 contenteditable 内部。

### 2.3 BlockNote

BlockNote 是构建在 Tiptap/ProseMirror 之上的一个 **Notion 风格**编辑器。它在之上施加了一层"块"抽象：每个块都是一个带内容节点的 ProseMirror 节点，块操作被编码为 ProseMirror 事务。

- 优势：开箱即用地最接近我们的目标体验；证明了 Notion 模型可以在 ProseMirror 上运行。
- 劣势：**React 优先**（没有一等公民的 Vue）。它是*叠在*散文编辑器之上的一层抽象，因此其块模型继承了 ProseMirror 的约束和庞大的依赖面。深度定制（Database、Columns、MindMap）意味着要深入 ProseMirror node view。

### 2.4 Lexical

Lexical（Meta）是一个**基于节点（node-based）**的编辑器，带有 React 风格的 reconciler。状态是一个节点树；更新产生新状态，Lexical 对 DOM 做 diff/reconcile。节点是带有生命周期钩子的类。

- 优势：细粒度更新、性能好、架构现代、为并发/协作而设计。
- 劣势：**React 优先**；Vue 的支持是非官方/薄弱的。仍然是**文本优先**——块是节点的组合，而不是一等公民单元。采用它意味着接受 Meta 的节点范式，并自己把它绑定到 Vue。

### 2.5 Slate

Slate 是一个**不可变 JSON** 模型，带函数式插件系统，React 优先。它的模型在概念上接近"一切皆对象树"。

- 优势：干净的不变模型；灵活。
- 劣势：实践中**仅限 React**；历史上 API 不稳定；仍然文本优先；你得自己在其上构建块编辑器。

### 2.6 Notion（专有，参考体验）

Notion 的编辑器是自定义的。一切都是块；块拥有 `id`、`type`、`properties`（内容）和 `children`。块级操作是一等公民；行内文本在块内编辑。这就是我们追求的用户体验与模型。

---

## 3. 权衡与所选的架构

### 3.1 核心决策

**决策：构建自定义的块优先核心，并采用按块 `contenteditable`。**

我们**不**基于 ProseMirror/Tiptap/Lexical/Slate 构建，也**不**封装 BlockNote。

### 3.2 为什么自定义，而不基于 ProseMirror

| 需求（来自简报）                          | 基于 ProseMirror 的契合度                      | 自定义块优先后端的契合度                  |
|---|---|---|
| "核心对 paragraph/heading/todo 一无所知" | schema 预先定义且文本优先                    | 核心只知道 `Block`；类型来自扩展          |
| "新增块类型几乎零核心改动"                | 新增节点 + node view + schema 补丁          | 注册一个扩展                            |
| "绝不依赖 HTML；文档是 JSON"              | JSON 存在，但模型以散文为中心               | 块树即为模型，设计如此                 |
| "编辑器操作文档结构，而非 DOM"             | ProseMirror 调和它自己拥有的 DOM            | 核心变更 JSON 树；DOM 只是投影           |
| Vue 组件作为块渲染器，拥有完全控制权        | node-view 桥接是一种妥协                   | 每个块都是普通的 Vue 组件               |
| 未来：Database、Columns、MindMap、Mermaid、Embed | 非散文 widget 是不顺手的 node view | 只是又一个块组件                       |
| 按块稳定光标 / 正确的 IME                  | 文档级 contenteditable，更难作用域隔离       | 按块 contenteditable，浏览器处理 IME    |

简报反复强调**块优先**模型：核心对块类型无感知，文档是一棵 JSON 树。ProseMirror 是一个*散文优先*的工具包，其编辑单位是行内文档；把它硬掰成 Notion 模型意味着要永远保留一层与其本性相悖的抽象。Notion 自己也因同样的原因构建了自定义核心。

### 3.3 为什么这样安全（难点都已解决）

浏览器编辑器真正困难的问题在于 **IME 组合**、**光标/选择**、**剪贴板**和**撤销/重做**。我们的设计逐一缓解：

- **IME / 中日韩输入**：限制在单个块的 `contenteditable` 内。浏览器处理 `compositionstart…compositionend`。在组合期间我们**绝不**变更 DOM 或分发事务；我们在 `compositionend` 上进行调和。这是标准的正确做法，而且比在文档级 contenteditable 中做要简单得多。
- **块内光标/选择**：原生处理。浏览器放置光标。
- **跨块选择与块操作**：由我们的核心负责，操作作用于 JSON 树（而非 DOM range）——因为它们是结构性的，所以可控。
- **撤销/重做**：基于事务的历史插件（状态快照/差异），与 ProseMirror 的 `prosemirror-history` 是同一套被证明的模式。
- **剪贴板**：在阶段五（Pi階段 5）中按块处理，把 selection → JSON 片段 → HTML/文本用于复制，反向用于粘贴。

### 3.4 我们刻意不做的事

- 不使用文档级 `contenteditable`。每个块拥有自己的。
- 不对整个文档做深度 Vue 响应式。文档是规范化的、基本纯数据的 store；渲染按块订阅。
- 不搞巨型 composable 或 3000 行的组件。模块小而单一职责。
- 没有 "utils.ts"。辅助函数位于聚焦的、具名的模块中。

---

## 4. 文档模型

### 4.1 Block（块）

```ts
interface Block {
  id: BlockId            // 不透明、稳定、由核心生成(nanoid)
  type: BlockType        // 已注册的类型 id,例如 "paragraph"、"heading"
  attrs: Attrs           // 块级属性,例如 { level: 2 }
  content: InlineSeq     // 该块的行内内容(无则空序列)
  children: BlockId[]    // 有序的子块 id(嵌套)
}
```

- `id` **由核心生成和拥有**，绝不来自扩展或持久化。导入时，若外部 id 存在且唯一则保留，否则重新生成。这保证了跨重载的身份稳定，并支持协作。
- `type` 是注册在 schema 注册表中的字符串。核心绝不对其做 switch。
- `attrs` 是普通 JSON 对象，其形状由块的 schema 声明（默认值 + 校验）。
- `content` 是有序的行内节点序列。阶段一只是一个文本段；模型支持 marks（加粗/斜体/代码/链接）和未来的行内节点（mention、行内公式），而无需结构性改动。
- `children` 支持嵌套：折叠（toggle）主体、引用子块、表格单元格、分栏、callout。一个块可以**同时**拥有 `content` 和 `children`（例如折叠块有标题和主体）。

### 4.2 行内内容

```ts
type InlineSeq = InlineNode[]

interface InlineNode {
  type: 'text'            // 以后可扩展:'mention' | 'equation' | ...
  text: string
  marks?: Mark[]          // [{ type: 'bold' }, { type: 'link', attrs: { href } }]
}
```

阶段一的行内编辑是纯文本。Marks 和富行内节点之后到来，而不改变块模型。这让阶段一保持小巧，同时 schema 已经为其留出空间。

### 4.3 文档（Document）

```ts
interface Document {
  id: string              // 文档 id
  root: BlockId[]         // 有序的顶层块 id
  // 块存于以 id 为键的规范化 store 中(见 §10)
}
```

文档是一棵**森林（forest）**:`root` 列出顶层块 id；每个块的 `children` 列出其子 id。store 是规范化的（`Map<BlockId, Block>`），因此访问、父查找和结构性编辑都是 O（depth），且永远不需要深克隆。

### 4.4 为什么用森林 + 规范化 store，而不是嵌套对象树

- **按 id 的 O（1） 块访问**，用于渲染、选择、命令。
- **结构共享（structural sharing）**：一个事务只重写编辑路径上的 `children` 数组；未受影响的 `Block` 对象保留引用同一性，因此 Vue 会跳过对它们的重新渲染。
- 为 `v-for` 中的 `key=blockId` 提供**稳定身份**，这是跨重排保持 DOM 和光标稳定的关键。
- **无深度响应式**：store 是纯数据的；更新是显式且带版本号的（见 §10）。

### 4.5 块的同一性、相等性、不可变性

- `Block` 对象在一个状态版本内被视作**不可变**。改变某个块的事务会产生一个*新的* `Block` 对象；未改变分支上的兄弟和祖先被复用。
- 渲染跳过的相等性：引用（`===`）。视图层比较它订阅到的块引用；若未变化，则什么都不做。

---

## 5. 扩展系统

### 5.1 `Extension` 契约

一个扩展是一个**普通 spec 对象**（由工厂函数产出），编辑器在构造时对它处理一次。扩展是可组合的：一个扩展可以 `use(...)` 其他扩展。

```ts
interface Extension {
  name: string
  uses?: Extension[]

  schema?: BlockSchemaSpec          // 声明一个块类型(若有)
  renderer?: BlockRendererSpec      // 该块的 Vue 组件
  commands?: CommandSpec[]          // 该扩展贡献的命令
  keymap?: KeymapSpec               // 快捷键 -> 命令
  inputRules?: InputRuleSpec[]      // 文本模式 -> 变换
  slashCommands?: SlashCommandSpec[]// 斜杠菜单中的条目
  toolbar?: ToolbarActionSpec[]     // 悬停/插入工具栏动作
  nodeView?: NodeViewFactory        // 用于完全自定义的交互块
  serialize?: SerializerSpec        // 块 -> HTML / Markdown / JSON
  deserialize?: DeserializerSpec    // Markdown / HTML / JSON -> 块
  plugins?: PluginSpec[]            // 编辑器级插件(历史等)
}
```

每个字段均可选；一个扩展只贡献它需要的部分。纯块类型扩展（例如 `Heading`）提供 `schema` + `renderer` + `serialize`/`deserialize` + 或许 `slashCommands`。行为扩展（例如 `History`）只提供 `plugins`。

### 5.2 注册表（处理扩展的结果）

编辑器根据所有扩展构建带类型的注册表：

| 注册表 | 键 | 值 |
|---|---|---|
| `BlockSchemaRegistry` | `BlockType` | `BlockSchema` |
| `RendererRegistry` | `BlockType` | Vue 组件 |
| `CommandRegistry` | 命令名 | `Command` |
| `KeymapRegistry` | 优先级 + 键 | 命令绑定 |
| `InputRuleRegistry` | — | 有序的 `InputRule[]` |
| `SlashCommandRegistry` | 命令 id | `SlashCommand` |
| `ToolbarRegistry` | 块类型 | `ToolbarAction[]` |
| `SerializerRegistry` | `BlockType` | `Serializer` |
| `DeserializerRegistry` | 来源种类 | `Deserializer` |
| `PluginRegistry` | — | `Plugin[]` |

注册表在**构造后不可变**（冻结）。重新配置编辑器意味着重建它——这保证分发和渲染无分支。

### 5.3 块 schema

```ts
interface BlockSchema {
  type: BlockType
  attrs: AttrsSpec                   // { name: { default, validate? } }
  content: 'text' | 'none' | 'inline*'   // 该块是否编辑行内文本?
  nestable: boolean                  // 是否可以拥有子块?
  allowedChildren?: BlockType[] | '*'   // 子类型白名单
  isolating?: boolean                // 删除/合并的边界(例如代码块)
  empty?: (block) => boolean         // 该块是否"为空"?(占位符、合并)
}
```

schema 让核心无需知道类型就能回答结构性问题："块 A 能包含块 B 吗？"、"这个块空吗？"、"这个块拥有 contenteditable 吗？"。这就是 Enter/Backspace/合并保持块类型无感知的方式。

### 5.4 自动发现

编辑器接受 `extensions: Extension[]`。它摊平 `uses` 图（按 `name` 去重），把每个贡献处理进注册表，然后冻结它们。内置扩展（`Paragraph`、`Heading`、`BulletList`、`OrderedList`、`TodoList`、`Quote`、`CodeBlock`、**`Image`**、**`Table`**、**`Divider`**、**`TableOfContents`**、`Keymap`、`History`，共 13 个）通过 `BuiltinExtensions` 默认包含，可以通过传入同名（`name`）扩展来覆盖。新增一个块类型就是"创建一个文件，传给编辑器"——零核心改动。

---

## 6. 渲染模型

### 6.1 组件

- **`<BlockEditor>`** — 公开的根组件。Props:`modelValue`（文档 JSON）、`extensions`（默认 `BuiltinExtensions`）、`editable`、`placeholder`（locale 感知默认值）、`theme`（`'light' | 'dark'`）、`locale`（`'zh-CN' | 'en-US'`）。通过 `provide` 暴露 `useEditor()` 和 i18n 上下文。
- **`<BlockList>`** — 渲染有序的块 id 列表（根或某个父节点的子块）。**虚拟化接缝**：此组件是唯一决定*哪些*块被挂载的地方；虚拟化实现以后可以无缝替换，而无需触碰块组件。
- **`<BlockHost>`** — 通过注册表把 `block.type` 解析为渲染器并挂载它。提供按块上下文（`blockId`、编辑器 API、选择状态）。使用 `key=blockId` 让 Vue 跨重排复用 DOM。
- **块渲染器组件** — 普通的 Vue 组件。对内容块，它们渲染绑定到各自块内容的 `contenteditable`。它们通过 `useBlock(blockId)` 读取状态，通过 `useEditor()` 分发。

### 6.2 视图桥接（状态 → Vue）

编辑器核心与框架无关，并 emits **状态版本**。视图桥接是唯一触碰 Vue 响应式的模块：

- 它维护一个 `Map<BlockId, Ref<BlockSnapshot>>`（浅层 ref）。
- 每来一个新状态版本，它遍历上一个状态与新旧状态之间的**diff**（在事务应用时计算），只更新发生变化的那些块的浅层 ref。未变化的块从不被触碰，因此 Vue 跳过它们的渲染函数。
- 选择是一个独立的响应式 ref；选择变化从不重新渲染块主体（宿主只添加/移除一个 CSS 类）。
- 对根/子 id 数组的 `v-for` 使用 `key=blockId`；重排数组只移动 DOM 而不卸载组件，从而保住光标。

### 6.3 按块 contenteditable 契约

每个内容块渲染器恰好拥有一个 `contenteditable` 元素。规则：

1. **模型**是持久化内容的唯一来源；**DOM** 是*实时的、聚焦的*元素的唯一来源。渲染器**仅当**块的内容引用发生变化**且**元素未聚焦时才写 模型 → DOM（以避免覆盖光标 / IME）。
2. 在组合**之外**的每次 `input` 事件上，渲染器分发一个携带两个 meta 标志的 `setText` 事务：`{ history: 'group', view: 'skip-dom-write' }`。`history: 'group'` 把连续的键入合并成一个撤销条目；`view: 'skip-dom-write'` 告诉视图桥接**不要**写回聚焦元素（DOM 已经有文本了）。这让模型**始终保持最新**，使 Enter/Backspace/方向键命令无需触碰 DOM 就能读到正确的文本/偏移，同时避免任何干扰光标的 DOM 重排。
3. 在 `compositionstart…compositionend` 期间，渲染器**不**分发任何东西，**不**往 DOM 写任何东西。在 `compositionend` 时，它读取组合后的文本并分发一次 `setText`（同样分组，同样 skip-dom-write）。
4. 只在一个命令需要时（Enter 拆分、Backspace 合并、跨块的方向键导航），才从原生 `Selection` 读取光标偏移。

这个契约给出正确的 IME 和稳定的光标，让模型对结构化命令保持最新，并避免每次按键的 DOM 重排。

---

## 7. 命令系统

### 7.1 命令是纯函数

采纳 ProseMirror 被证明的形式：

```ts
type Command<TArgs = void> = (args: TArgs) => (state: EditorState, dispatch?: Dispatch) => boolean
```

- 命令检查 `state`，若适用，则构建一个**事务**并调用 `dispatch(tr)`。若它处理了该输入则返回 `true`（这样键位映射可以回退/穿透）。
- 命令按名字注册，通过 `editor.commands.<name>(args)` 分发，它是一个薄代理，用当前状态和核心的 `dispatch` 调用注册的命令。

### 7.2 事务是唯一的变更路径

```ts
interface Transaction {
  steps: Step[]            // 有序的结构性操作
  selectionAfter?: Selection
  meta: Record<string, unknown>   // 例如 { history: 'ignore' }
}
```

`Step` 是一个很小的、可序列化的结构性操作：`insertBlock`、`removeBlock`、`replaceBlock`、`moveBlock`、`setText`、`setAttrs`、`setSelection`。应用一个事务产生一个**新的 `EditorState`**（不可变）和一个哪些块发生了变化的**diff**。没有其他方式可以变更状态——这正是让历史、持久化以及（未来的）协作成为可能的原因。

### 7.3 核心提供的原语命令（块类型无感知）

`insertBlock`、`removeBlock`、`replaceBlock`、`moveBlock`、`updateAttrs`、`setText`、`splitBlock`、`mergeBlock`、`setSelection`、`selectBlock`、`liftBlock`、`wrapBlock`。这些仅使用 schema 的结构性谓词（`nestable`、`allowedChildren`、`isolating`、`empty`）实现 Enter/Backspace/移动/lift/wrap。不引用任何块类型。

### 7.4 扩展提供的命令

块类型添加自己的命令（例如 `toggleTodo`、`setHeadingLevel`）。它们组合核心原语，并暴露在同一个 `editor.commands` 代理上。

---

## 8. 选择模型

选择是**编辑器状态的一部分，但与文档分离**。有三种：

```ts
type Selection =
  | { kind: 'caret'; blockId: BlockId; offset: number }
  | { kind: 'text'; anchor: Anchor; focus: Anchor }   // 块内或跨块
  | { kind: 'blocks'; blockIds: BlockId[] }           // Notion 风格块选择

interface Anchor { blockId: BlockId; offset: number }
```

- **`caret`/`text`**：对于*偏移*的唯一来源是原生 `Selection`，按需读取。模型记录它，以便命令和渲染无需触碰 DOM 就能推理。我们在 selectionchange 时同步 原生 → 模型，并在命令移动光标时同步 模型 → 原生。
- **`blocks`**：完全由核心拥有（左侧装订区鼠标拖拽、Shift 点击、Escape 全选）。在视图层通过被选中 `BlockHost` 上的 CSS 类体现；绝不触碰 `contenteditable`。

### 8.1 规则

- 一次至多一个选择类型处于激活状态。
- `blocks` 选择具有最高优先级：激活时，contenteditable 设为 `contenteditable=false`，方向键 / Enter / Backspace 操作块集合（移动、缩进、删除）。
- 跨块的 `text` 选择是多块复制/粘贴的桥梁（阶段五）；阶段一只支持 `caret` 和单块的 `text`。

---

## 9. 插件系统

一个**插件（plugin）**在定义良好的钩子上增强编辑器行为。插件与扩展不同：扩展*声明*块/命令/键盘映射；插件*响应*编辑器生命周期和事件。

```ts
interface Plugin {
  name: string
  init?(state: EditorState, editor: Editor): PluginState
  applyTransaction?(tr: Transaction, prevState: EditorState): PluginState
  apply?(state: EditorState): EditorState        // 读/更新状态(装饰)
  onKeyDown?(event: KeyboardEvent, ctx: EventContext): boolean
  onInput?(event: InputEvent, ctx: EventContext): boolean
  onCompositionStart?(event, ctx): void
  onCompositionEnd?(event, ctx): void
  onDestroy?(): void
}
```

内置插件（由内置扩展贡献）:

- **History** — 撤销/重做的事务栈，带分组和 `addToHistory` meta。通过重放步骤进行时间旅行。
- **Keymap** — 有序的快捷键解析；返回 `true` 以消费。
- **InputRules** — 对文本输入做模式匹配（例如 `# ` → heading）。
- **SelectionSync** — 原生 ↔ 模型选择同步，包括 IME 防护。
- **Placeholder** — 推导某块是否为空，并通知渲染器。

插件状态存储在 `EditorState` 中，以插件名为键，因此它是不可变、带版本的状态的一部分（支持跨插件效果的正确撤销）。

---

## 10. 状态管理

### 10.1 EditorState

```ts
interface EditorState {
  doc: Document               // 规范化森林 + Map<BlockId, Block>
  selection: Selection
  pluginState: Readonly<Record<string, PluginState>>
  version: number             // 单调递增;每应用一个事务就加一
}
```

`EditorState` 是**不可变的**：应用一个事务会返回一个带结构共享的新状态。上一个状态被保留用于历史。

### 10.2 store

规范化的 `Map<BlockId, Block>` **不是**深度响应式的。它是状态对象内部的一个普通 map。视图桥接（§6.2）是唯一通过浅层 ref 向 Vue 暴露切片的使用者。这刻意避免了 Vue 对数千个块做深度响应式——正是简报中点名的显式性能隐患。

### 10.3 更新流程

```
用户事件 / 命令
        │
        ▼
   构建 Transaction(steps)
        │
        ▼
   applyTransaction(state, tr)  ──▶  新的 EditorState + diff
        │                              (插件观察)
        ▼
   history 插件压入 tr(除非 meta history:ignore)
        │
        ▼
   视图桥接应用 diff ──▶ 只更新发生变化的块的浅层 ref
        │                        + selection ref
        ▼
   Vue 只重新渲染受影响的 <BlockHost> 组件
```

### 10.4 持久化

- `v-model` 在防抖变化时（或失焦时）把文档作为普通 JSON emit 出去。
- 加载是整体替换状态（新的 `EditorState`）；视图桥接与上一状态做 diff，以最小化 DOM 变动。

---

## 11. 键盘、输入规则与 IME

### 11.1 键位映射解析顺序

1. 若 `selection.kind === 'blocks'`：使用块集合键位映射（ArrowUp/Down 扩展选择，Delete 移除，Esc 清除）。
2. 否则，使用聚焦块按类型的键位映射（由其扩展注册）。
3. 核心键位映射（Enter、Backspace、块边界处的 ArrowUp/Down/Left/Right、Tab/Shift-Tab 缩进/反缩进）。
4. 对普通文本输入回退到原生 contenteditable。

处理器返回 `true` 以阻止传播。这个顺序把跨块导航放在核心中，同时让块类型自定义自己的按键。

### 11.2 Enter / Backspace（核心，类型无感知）

- **Enter**：从原生选择读取光标偏移，然后：若块的 schema 说是 `content: 'text'` 且光标位于文本中间 → 在偏移处 `splitBlock`（由于输入同步 §6.3，模型文本已经最新）。若位于末尾且块按 schema 判定为"空" → 在它后面 `insertBlock` 一个**默认块类型**（Notion 的"空 Enter 退出"一个带样式块）。若块是 `isolating` 且光标在末尾 → 在它后面插入默认块。行为完全由 schema 谓词驱动，绝不依据 `type`。
- **Backspace**：在偏移 0 且非 `blocks` 选择时 → 与上一个兄弟 `mergeBlock`（尊重 `isolating`：代码块不并入正文）。文本中间 → 原生删除（contenteditable）；随后 `input` 事件通过每次输入的 `setText` 路径（§6.3）同步模型，因此无需额外的同步。

**默认块类型**在编辑器配置中声明（`defaultBlockType`，通常为 `"paragraph"`），并通过 schema 注册表解析——核心绝不硬编码类型名。

### 11.3 方向键导航

- 在块的视觉顶部/底部的 ArrowUp/Down → 把光标移动到上一个/下一个块（几何方式，用 `getBoundingClientRect`）。阶段一用简单的"首/末行 → 上一个/下一个块"启发式即可。
- 偏移 0 时的 ArrowLeft → 上一个块的末尾；末尾时的 ArrowRight → 下一个块的开头。

### 11.4 IME / 中日韩

按块 contenteditable 把组合限制在块内。`SelectionSync` 插件守护这个窗口：从 `compositionstart` 到 `compositionend`，不分发事务，渲染器也不对正在组合的块写 DOM。在 `compositionend` 时，读取组合后的文本并分发单个 `setText` 事务。这与成熟编辑器采用的做法一致，对中文/日文/韩文输入是正确的。

---

## 12. 性能策略

目标：在 1k / 5k / 10k 块时保持流畅编辑。

- **不对文档做深度响应式**。状态是不可变的纯数据；渲染通过浅层 ref 按块订阅。
- **结构共享**，让事务对所有未变化的块保持引用同一性；视图桥接跳过它们。
- **diff 驱动渲染**：桥接只更新事务 diff 中的块，加上选择。
- **稳定键**：`key=blockId` 让重排移动 DOM，而非重建。
- **虚拟化接缝**：`<BlockList>` 是唯一的挂载点；虚拟化变体可以替换它而不触碰块组件。我们让块组件无副作用且幂等，因此虚拟化是安全的。
- **带历史分组的每次输入模型同步**（§6.3）：每次击键分发一个廉价的 `setText`，它只改变一个块（结构共享）并携带 `view: 'skip-dom-write'`，因此聚焦元素永远不会被重写——无干扰光标的回流，无每次按键的 DOM 调和。
- **不对整个文档做 `watch`**；简报明确禁止深度 watch，我们遵从。

---

## 13. 包结构与模块职责

这个编辑器是一个可发布的包（`xiaodao-editor`）。模块小而单一职责，拥有文档化的公共 API。下面的结构反映**已建成（as-built）**的代码库（阶段一至九）。

```
src/
  core/                         # 与框架无关的核心(无 Vue 导入)
    types.ts                    # Block, DocState, Selection, InlineSeq, JSON 形式
    ids.ts                      # BlockId 生成(Web Crypto,零依赖)
    state/
      store.ts                  # 规范化 Map<BlockId,Block> + 父索引 + 查找
      Step.ts                   # 可序列化结构操作 + applySteps(产出 diff)
      Transaction.ts            # TransactionBuilder + Transaction + meta
      EditorState.ts            # 不可变状态 + applyTransaction
      invert.ts                 # 用于撤销/重做的步骤反转
    command/
      Command.ts                # Command 类型 + CommandRegistry + 代理
      primitiveCommands.ts      # insert/remove/replace/move/setText/split/merge/enter/backspace/nav + setLink/unsetLink
      Keymap.ts                 # KeymapRegistry + 键名标准化(Mod → Ctrl/Cmd)
      InputRule.ts              # InputRuleRegistry(InputRuleSpec 的类型别名)
      SlashCommand.ts           # SlashCommandRegistry + 搜索(SlashCommandSpec 的类型别名)
    selection/
      Selection.ts              # 构造器 + 守护 + 纯辅助函数
    plugin/
      Plugin.ts                 # Plugin 接口 + EventContext
    extension/
      Extension.ts              # Extension 契约
      Registry.ts               # flattenExtensions + buildRegistries + RendererRegistry + ToolbarRegistry
    schema/
      BlockSchema.ts            # schema spec → schema + 结构谓词
      SchemaRegistry.ts         # type → schema 查找(带回退)
    history/
      HistoryManager.ts         # 撤销/重做栈 + 分组 + 步骤反转
    serialize/
      Serializer.ts             # 按块 Markdown/HTML 序列化器 + 反序列化注册表
    Editor.ts                   # 门面:state、dispatch、commands 代理、history、plugins
    index.ts                    # core barrel(框架无关引擎的公共面)
  view/                         # Vue 专属桥接 + 组件
    context.ts                  # editorKey/useEditor (provide/inject) + BlockRenderItem 类型
    BlockEditor.vue             # 公开根:构造 Editor、订阅、键位映射、选择同步、i18n/主题、uploadImage 钩子、链接浮层编排、fileId 引用计数 + cleanup 事件
    BlockList.vue               # 扁平块列表(虚拟化接缝)
    BlockHost.vue               # 通过 RendererRegistry 把 type → renderer 解析；向上转发 linkClick
    BlockContent.vue            # 按块 contenteditable(IME 防护、输入同步、占位符、点击 <a> 链接检测、粘贴 URL 自动加链、空格触发自动链接)
    domSelection.ts             # 原生 Selection ↔ 模型(光标偏移读/恢复、跨块矩形)
    keymapHandler.ts            # KeyboardEvent → keymap → command 分发
    inlineDom.ts                # InlineSeq ↔ DOM(含 <a href 净化> 的 HTML 序列化；inlineFromDom 含 <a> → link mark)
    imageUpload.ts              # 图片上传侧信道：按 blockId 存瞬时状态(进行中/进度/错误)、mock 上传、外部处理器分发、临时对象 URL、订阅/清理 API
    urlUtils.ts                 # URL 工具：looksLikeUrl、normalizeUrl、sanitizeUrl(安全协议白名单)、autoLinkInlineSeq(在文本片段中检测 URL 并加 link mark)
    clipboard.ts                # 剪贴板 HTML/纯文本 → ParsedBlock[](复制/剪切/粘贴)；粘贴图片文件 + <img> → 插入图片块；选区上粘贴 URL → 加 link mark
    ui/                         # 浮动 UI 组件(全部 Teleport 到 <body>)
      BlockHandle.vue           # 左侧手柄 plus/grip 按钮(拖拽、设置菜单)
      BlockSettingsMenu.vue     # grip 菜单:转换、对齐/缩进、颜色、操作
      HoverToolbar.vue          # 文本选择工具栏:类型、标记、对齐、颜色 + 链接按钮
      PlusMenu.vue              # slash 菜单 + 插入菜单(可搜索命令面板)
      OrderedListMenu.vue       # 有序列表标记点击菜单(继续 / 新开始 / 修改)
      NumberPicker.vue          # 修改起始编号值
      CodeLangPicker.vue        # 设置代码块语言
      LinkPopover.vue           # 链接浮层（查看模式：打开/复制/编辑/删除；编辑模式：href + 文本；定位在选区或被点击的 <a> 上方）
      FixedToolbar.vue            # 常驻顶/底操作栏（内嵌 HoverToolbar + plus/handle 按钮）。
                                  # 通过 toolbarPosition prop 控制位置：'auto'(桌面顶/移动端底)、'top'、'bottom'、'float'
                                  # ('float' 仅桌面端：隐藏该栏，改为渲染跟随文本/表格选区的浮动 HoverToolbar)。
      SafeHtml.vue              # 隔离 v-html,用于可信的 SVG/HTML 图形渲染
      icons.ts                  # 内联 SVG 图标字符串(无 <text> 元素)
      inputRulesEngine.ts       # markdown 快捷键(# , > , [] , ```)
      popup.ts                  # 视口感知的弹出定位辅助
      useMenuScroll.ts          # 共享滚动组合式（上/下按钮、滚轮、触摸滑动）
      useMenuDismiss.ts         # 共享外部点击/Escape 关闭组合式
  extensions/
    Paragraph.ts                # paragraph 块类型（schema + renderer）
    Heading.ts                  # heading 块类型 h1–h6（schema + renderer + attr 校验）
    BulletList.ts               # bullet list 块类型
    OrderedList.ts              # ordered list 块类型（自动编号、startNumber attr）
    TodoList.ts                 # todo list 块类型（checked attr）
    Quote.ts                    # quote 块类型（无行内斜体）
    CodeBlock.ts                # code block 块类型（隔离、language attr、无 align/color/indent）
    Image.ts                    # image 块类型（content:none、attr:src/alt/title/width/height/caption/fileId；替换/删除遮罩工具栏、拖拽缩放手柄、可编辑 caption、斜杠 /image、HTML/MD 序列化）
    Table.ts                    # table 块类型（content:none、attrs 网格、Vue 渲染器 + 命令注册、行/列选择条、浮动操作栏、合并/拆分/标题行、代码块单元格 Enter 插入换行）
    tableModel.ts               # 表格纯函数结构操作：插入/删除行/列/合并/拆分/完整矩形扩展/切换标题行/列宽辅助/HTML/MD 序列化/attrs 校验/规整
    Divider.ts                  # divider 块类型（隔离水平分割线）
    TableOfContents.ts          # 目录块类型（不可编辑；实时标题列表视图；content:'none'，空 attrs；斜杠 /目录）
    Keymap.ts                   # 默认键位映射：Enter/Backspace/ArrowUp/ArrowDown
    History.ts                  # 撤销/重做键位映射：Mod-z / Mod-Shift-z / Mod-y
    _commonAttrs.ts             # 共享 align/color/bgColor/indent 规范 + 颜色预设
    builtin.ts                  # BuiltinExtensions 捆绑（14 个扩展）+ 再导出
  i18n.ts                       # locale （zh-CN/en-US） + 主题 （light/dark） 模块
  style.css                     # 编辑器样式表（CSS 变量、浅色/深色 token；链接 <a> 样式；图片块遮罩 + 上传 UI；链接浮层样式）
  index.ts                      # 公开的包入口点
```

### 13.1 与原设计的差异（及原因）

原设计（阶段零）提出了略有不同的布局。实现期间（阶段一至九）为了清晰或因为设计过度预期需求，做了以下改动：

| 设计提案 | 建成形态 | 原因 |
|---|---|---|
| `state/diff.ts` | 并入 `Step.ts`（`applySteps` 返回 `changed`/`removed`） | diff 是应用步骤的副产品；独立的模块增加了间接性而无价值。 |
| `serialize/json.ts` | `serialize/Serializer.ts` | JSON 进/出由 `store.ts` 处理；此模块只负责按块的 Markdown/HTML spec。 |
| `view/ViewBridge.ts` | 不存在—`BlockEditor.vue` 直接持有 `shallowRef<EditorState>` | 阶段一不需要单独的桥接类；根组件是唯一的响应式边界。若视图层增长可以抽取出来。 |
| `view/useEditor.ts` + `view/useBlock.ts` | `view/context.ts`（editorKey + useEditor + BlockRenderItem） | 阶段一不需要 `useBlock`（块接收 props，而非订阅）。 |
| `view/dom/selectionSync.ts` + `view/dom/caret.ts` | `view/domSelection.ts` | 两个关注点紧密耦合；拆分增加了仪式感而无清晰度。 |
| `view/contenteditable.ts` | `view/BlockContent.vue` | contenteditable 契约是一个组件，而非 composable。 |
| `extensions/paragraph/`（目录） | `extensions/Paragraph.ts`（文件） | 每个阶段一扩展都够小，一个文件即可。当扩展变大时（例如带语法高亮的代码块）可以采用目录。 |
| `extensions/selection/`、`extensions/inputRules/`、`extensions/placeholder/` | 不存在 | 选择同步位于视图层（`domSelection.ts` + `BlockEditor.vue`）。InputRules 属阶段二。占位符由 `BlockContent.vue` 通过 `data-empty` CSS 处理。 |
| `history/` 作为一个插件 | `history/HistoryManager.ts`（由 Editor 持有）+ `extensions/History.ts`（仅键位映射） | 历史需要 Editor 的 dispatch 和 state；做成插件需要特权访问。键位映射是一个独立的扩展。 |
| 设计中没有 `SchemaRegistry.ts` | 新增 | 设计描述了内联的 schema 查找；注册表集中了回退逻辑，让 `Editor.ts` 保持精简。 |
| 设计中没有 `state/invert.ts` | 新增 | 步骤反转并不平凡，值得一个独立专注的模块。 |
| 设计中没有图片上传侧信道 | `view/imageUpload.ts` + `BlockEditor.vue` props `uploadImage` + 引用计数 `cleanup:image-file` 事件 | 图片上传中的瞬时状态（进行中/进度/错误）不得进入持久化的 block attrs；用侧信道管理并支持未完成时的临时对象 URL、失败重试与文件引用清理。 |
| 设计中没有 `view/urlUtils.ts` 与链接浮层 | `view/urlUtils.ts`（`sanitizeUrl` / `autoLinkInlineSeq`） + `view/ui/LinkPopover.vue` + `BlockEditor.vue` 编排 | 链接是"行内 mark + 属性（href）"，需要独立的安全净化层（阻止 `javascript:` 等）、自动识别（键入/粘贴 URL → 自动加链）、以及与选择浮层协作的编辑体验；这是一个 mark 级特性，不需要修改 `core/`。 |
| 设计中 `mark` 未定义属性模型 | 在 `types.ts` 中 mark 为 `{ type, attrs? }`；`primitiveCommands.ts` 新增 `setLink` / `unsetLink` 命令；`inlineDom.ts` 在 `<a>` 序列化时强制经过 `sanitizeUrl` | 为了支持 link mark 保存 href、同时保持与 HTML/Markdown 的互操作性和 XSS 安全性，必须把 URL 作为 mark 属性并在所有出站路径上强制执行净化。 |
| 设计中 **Table** 仅作为未来扩展提及 | `extensions/Table.ts` + `extensions/tableModel.ts`，并在 `BuiltinExtensions` 中注册 | 表格是高优先级内建特性；使用 `attrs` 存储网格（cells/colWidths/headerRow）的 "attrs storage" 模式与 Image 相同；渲染器为自包含 Vue 组件（行/列选择、浮动操作栏、合并/拆分、标题行、代码块单元格 Enter 插入换行），核心零修改。 |
| 设计中未预期 Divider 内建 | `extensions/Divider.ts` 作为极简隔离型块 | 分割线是高频工具块，内建比用户自定义更自然。 |
| 设计中未预期目录（TableOfContents）内建（阶段八） | `extensions/TableOfContents.ts` 作为不可编辑的 `content: 'none'` 块（空 attrs） | 目录是从编辑器状态计算的**动态视图**（通过 `flatten` 收集所有 `heading` 块），而非持久化内容。`content: 'none'` + `inlineMarks: false` + `renderer.editable: false` 使其构造上不可编辑。点击条目分发已有的 `setSelection` 命令 + `scrollIntoView`。序列化输出空字符串，导出不重复。核心零修改。 |

职责规则（与设计一致）：

- `core/` **不导入** Vue 的任何东西。它可以隔离地进行单元测试，并移植到任何框架。由 `src/core/**` 上的 ESLint `no-restricted-imports` 规则强制。
- `view/` 是唯一触碰 Vue 响应式和 DOM 的层。
- `extensions/` 从 `core` 和 `view` 导入，但彼此之间除了通过组合（`uses`）外绝不互相导入。
- 没有 `utils.ts`。辅助函数属于拥有该概念的模块（例如 `domSelection.ts`、`invert.ts`、`ids.ts`）。

---

## 14. 分阶段路线图

### 阶段一 — 基础 ✅
核心类型、规范化 store、不可变状态、事务 + diff、命令注册表 + 原语命令、选择、插件/扩展/注册表系统、视图桥接、`BlockEditor`/`BlockList`/`BlockHost`、按块 contenteditable 契约、SelectionSync（IME 防护）、History、Keymap、Placeholder。扩展：`Paragraph`、`Heading`。UX：光标、Enter、Backspace、方向键导航、占位符。

### 阶段二 — 写作辅助 ✅
斜杠菜单（`PlusMenu.vue`：搜索、键盘导航、命令面板）、输入规则 / markdown 快捷键（`# `、`## `、`> `、`[] `、```` ``` ````）通过 `inputRulesEngine.ts` 实现。

### 阶段三 — 更多块类型 ✅
Todo、Quote、Code Block、BulletList、OrderedList（每个都是自包含扩展；代码块是 `isolating`）。

### 阶段四 — 块操作 UI ✅
拖拽手柄（`BlockHandle.vue`）、悬停工具栏（`HoverToolbar.vue`）、插入按钮（`+`）、块移动（拖拽、键盘上移/下移）、缩进/反缩进、grip 菜单（`BlockSettingsMenu.vue`：转换、对齐、颜色、操作）。

### 阶段五 — 剪贴板与多选 ✅
多块文本选择叠层、复制/剪切/粘贴（通过 `clipboard.ts` 做干净的 HTML/纯文本序列化）、重复、删除、从外部粘贴（HTML 反序列化）。**移动端跨块文本选择**：触屏设备上长按启动拖拽选择，通过 `domSelection.ts` 的 `positionFromPoint` 命中测试跨越多个块；触摸交互期间抑制合成的鼠标事件。

### 阶段六 — 图片块 + 链接 Mark ✅

**图片块（Image block）**
- Schema：`content: 'none'`，`attrs: { src, alt?, title?, width?, height?, caption?, fileId? }`（均为持久化字段）。
- 入口：斜杠菜单 `/image`（可选本地文件 / 粘贴 URL），粘贴图片文件（`clipboardData.files[i].type.startsWith("image/")`）→ 插入图片块，粘贴 HTML `<img src>` → 写入 `src`。
- 渲染：顶层是 `<div class="block-image-wrapper" draggable>`，内含 `<img class="block-image-content" draggable="false" alt src title width height>`、可编辑 `contenteditable` 的 `.block-image-caption`（无聚焦时隐藏占位符）、hover 时显示的遮罩工具栏（**替换图片 / 删除图片**两个按钮）、四角拖拽缩放手柄（支持最小 64px 宽度）。
- 上传管线：插入本地文件时，先写入**瞬时** `tempSrc = URL.createObjectURL(file)` 立即显示，并通过侧信道 `view/imageUpload.ts` 注册 `{ status: 'uploading', progress, error }`；成功后事务写入 `{ src, fileId }` 并 `revokeObjectURL`；失败保留 `tempSrc` 并显示重试按钮。
  - `BlockEditor.vue` 暴露 prop `uploadImage?: (file: File, ctx: { blockId: BlockId; onProgress(pct: number): void }) => Promise<{ src: string; fileId?: string; alt?: string; width?: number; height?: number; title?: string; caption?: string }>`；未提供时走内置 mock 上传（随机延迟 30% 返回错误，便于测试重试 UI）。
  - **持久化 vs 瞬时的硬边界**：`status/progress/error/tempSrc` **绝不**进入 `block.attrs`，因此 undo/redo 不会把上传中状态写进历史栈、不会被 JSON 持久化。所有瞬时状态只存在于 `imageUpload.ts` 的响应式 map。
- fileId 引用计数与清理：`BlockEditor.vue` 在每次 `applyTransaction` 的 diff（changed + removed）里扫描受影响块的 `fileId` 前后值，计算每个 `fileId` 的**当前引用数**。引用数从 >0 → 0 时 `emit('cleanup:image-file', { fileId })`，宿主应用可在此删除对象存储。
- Serializer：
  - HTML：`<figure><img src alt title width height><figcaption>caption</figcaption></figure>`（反序列化 `figure > img` → 写入 attrs；忽略 `<figcaption>` 以外的 wrapper 结构）。
  - Markdown：`![alt](src "title")`（若有 `caption/width/height`，降级为 HTML 以保真）。

**链接（Link mark）**
- Mark 模型：`marks: [{ type: 'link', attrs: { href } }]`，与加粗等 mark 并列。
- 入口：
  - 文本选中时 `HoverToolbar` 新增**链接按钮**；点击弹出 `LinkPopover`。
  - 快捷键 `Mod+K`（`BlockEditor.vue` 中显式处理：若 selection 非空或 cursor 正位于 link 上，打开编辑；否则空 href 创建 link mark）。
  - 粘贴：选区非空 + 粘贴文本 `looksLikeUrl` → `setLink(href)`，直接把选中文字变成链接。
  - 输入：空格触发 `autoLinkInlineSeq(seq)` 扫描文本，把看起来像 URL 的片段（以非空白/标点边界开始、匹配 `https?://mailtotel://` 或 `www.` 或 `x@y.z`）自动加 `link` mark。
- 链接浮层 `LinkPopover.vue`：
  - **查看模式**（点击已有 <a> 或 Mod+K 且 cursor 在 link 上时）：展示可点击 `<a>` 以 `target="_blank" rel="noopener noreferrer"` 打开，按钮组：**打开链接 / 复制链接 / 编辑链接 / 删除链接**（删除 = `unsetLink`）。
  - **编辑模式**：输入 `href` 与 `text`；`text` 非空时在 `setLink` 里把所选区间的文本一并替换为 `text`；"保存" 要求 href 非空且经 `sanitizeUrl` 后与原 URL 一致不返回空（非法方案拒绝保存）。
- 安全（XSS 防线）：所有写进 `<a href>` 的路径统一走 `view/urlUtils.ts` 的 `sanitizeUrl`（允许 `http https mailto tel`；禁止 `javascript: data: vbscript:`、禁止协议无关的 `\t\n` 混淆、禁止非 ASCII 的 scheme；不合法返回空串且**不写 `href`**，渲染为普通 `span`）。该函数在 `inlineDom.ts` → `renderMarks` 和 `LinkPopover.vue` → `onSave` 中被强制调用。
- Serializer：
  - HTML：`serializeInlines` 把 link mark 包为 `<a href=sanitizeUrl(href)>`；`inlineFromDom` 对 `<a>` 读取 `href` 并 `normalizeUrl`。
  - Markdown：`[text](url)`，行内 `<a>` 反序列化等价。
- Selection / 继承：`applyMarkToRange` / `removeMarkFromRange` 正确处理区间端点位于不同 mark 集合时的分裂与合并（与 code 互斥：若区间内已存在 `code` mark，则跳过加链；反之亦然）。

### 跨阶段（阶段一之后新增）✅
- **国际化**（`src/i18n.ts`）：`locale` prop（`zh-CN`/`en-US`），零依赖翻译模块，通过 provide/inject 实现；通过 `<Teleport>` 渲染的弹出层保持响应式。
- **主题**（`theme` prop）：`.block-editor` 和 `<body>` 上的浅色/深色 CSS 变量；每预设的文本/背景色带透明度。
- **行内标记**：加粗、斜体、下划线、删除线、行内代码、按选区的文本色和背景色。
- **块级属性**：对齐（left/center/right/justify）、文本色、背景色、缩进（0–10）。
- **Link mark**：带 `href` 属性的行内 mark；`Mod+K` → 打开链接浮层；粘贴/键入 URL → 自动加链；支持修改链接文本；HTML/Markdown 序列化走 `<a>` / `[text](url)`；所有 `<a href>` 序列化强制经过 `sanitizeUrl` 安全协议白名单（http/https/mailto/tel，阻止 `javascript:` / `data:` / `vbscript:`）。
- **图片上传管线**：斜杠 `/image` 或粘贴图片文件/HTML `<img>` 插入图片块；`BlockEditor.vue` 通过 `uploadImage?: (file: File, ctx) => Promise<ImageUploadResult>` 暴露上传钩子；内置 mock 上传（`imageUpload.ts`）作为回退；`cleanup:image-file` 事件在 `fileId` 引用计数归零时触发，用于外部存储清理。

### 阶段七 — 表格块 + 分割线 ✅
**表格块（Table block）**
- Schema：`content: 'none'`，使用 **attrs storage** 模式（与 Image 相同）：`attrs` 包含 `rows`、`cols`、`cells[r][c] = { content, rowspan, colspan, covered, cellType?, align?, bgColor? }`、`colWidths[col]`、`headerRow`。`rows/cols/colWidths/headerRow` 有 schema 默认值 + 校验，`cells` 由 `validateTableAttrs` 做整体校验。
- 入口：加号菜单点击表格图标 → `insertTableCommand`（默认 3×3、默认列宽 120 px、**默认 `headerRow: true`**）。
- 渲染：顶层 `.block-table-container`（padding-top/left=20px，无聚焦 outline），内含仿 Arco Design 的 `.table-wrapper`（`overflow-x: auto`，内部 table `width: max-content`）以提供内部水平滚动；**左侧行选择条、顶部列选择条、左上角角部全选手柄、浮动操作栏、行/列之间的插入点**全部固定不随内容滚动。单行/单列/全表选中时在浮动操作栏展示"删除行/列/表格"按钮；**多非覆盖单元格 ≥ 2 时展示"合并单元格"**；选区含合并单元格时展示"拆分单元格"；**角部全选时额外展示"标题行"切换按钮**（设置/取消 `headerRow`）。
- 单元格：每个可见单元格渲染独立的 `.table-cell-inner[contenteditable]`。支持 `paragraph` / heading（h1–h6） / quote / todo / bullet / ordered / `codeBlock` 作为 `cellType`。**代码块单元格 Enter 插入换行**（与文本代码块一致：记录 caret offset、DOM 插入 `\n` TextNode、`syncCellContent` 同步、`nextTick` 后按 offset+1 重置光标；渲染时若文本以 `\n` 结尾追加 `<br>` 保证尾部空行可见；`white-space: pre-wrap` 让换行生效）。Tab / Shift+Tab 在单元格间导航（最后一格 Tab 自动追加新行），非代码块 Enter 退出编辑并进入单格选中态（蓝色背景），Escape 失焦/清除选区。双击进入编辑（聚焦态：蓝色边框）；单击进入选中态；拖拽选择矩形范围；合并单元格会自动扩展选区为完整矩形（`expandSelectionToFullRect`）。
- 命令（注册在 `editor.commands` 代理中，供 UI 按钮调用）：`tableInsertRow`、`tableRemoveRow`、`tableInsertCol`、`tableRemoveCol`、`tableSetCellAttrs`、`tableSetCellMark`、`tableToggleCellMark`、`tableMergeRect`、`tableSplitCell`、`tableSplitCellsInRect`、`tableSetColWidth`、**`tableToggleHeaderRow`**、`tableInsert`。纯函数在 `tableModel.ts`（不可变的 → 新的 TableAttrs），所有调用路径通过 `editor.commands.setAttrs({ id, attrs: nextAttrs })` 打包成标准事务 → undo/redo 免费。
- 序列化：HTML → `<table>`（headerRow 时 `<thead>` 包装第一行，否则全行进 `<tbody>`，合并单元格写 `rowspan/colspan`，单元格内容使用标准 `inlineToHtml`，列宽转 `<colgroup>`）；Markdown → 带分隔头行（headerRow 时渲染语法头），每个单元格使用内联 Markdown。

**分割线块（Divider block）**
- 极简隔离块：`<hr class="block-divider">`。Schema 为空 attrs；输入规则 `---`、`***`、`___` 触发转换为 divider。

### 阶段八 — 目录块（Table of Contents）✅

**目录块（TOC block）**
- Schema：`content: 'none'`，`inlineMarks: false`，空 `attrs`，`nestable: false`，`empty: () => false`（目录始终渲染其面板）。渲染器 `editable: false` — 构造上不可编辑（无光标、无行内文本）。
- 标题收集：`collectHeadings(doc)` 通过 `flatten` 遍历块树，过滤 `type === 'heading'`，对每个有非空文本的标题返回 `{ id, level, text }`。表格单元格内的标题自动排除（因为表格单元格内容存在 `Block.attrs` 中，不在块树内）。
- 渲染：Vue 组件订阅编辑器状态更新（`editor.subscribe`），在每次文档变更时重新计算标题列表，因此目录始终是**实时视图**。每个条目是一个 `<button>`，带 `data-toc-target` 属性和基于 `level` 的 `paddingLeft` 缩进。点击条目分发 `setSelection`（光标置于标题处），然后 `scrollIntoView({ block: 'center', behavior: 'smooth' })`。
- 入口：斜杠菜单 `/目录`（关键词：`toc`、`contents`、`outline`、`目录`、`标题`、`大纲`）。分发 `convertBlock` 将当前块转换为目录。
- 序列化：`toHTML` 和 `toMarkdown` 均输出空字符串 — 生成的标题列表是视图而非编辑器内容，真正的标题已由各自块导出。这防止目录在 HTML / Markdown 导出中被重复。
- i18n：`toc.title`（"目录" / "Table of Contents"），`toc.empty`（"暂无标题" / "No headings"）。

### 未来（架构已支持）
Callout、Toggle、Columns、Database、Mention、Math、Mermaid、MindMap、Attachment、Embed、AI —— 每个都作为一个扩展到达（schema + renderer + serialize + 或许 nodeView），**无需核心改动**。

---

## 15. 未来的可扩展性

架构被塑造成让每个未来特性都是一个扩展：

- **Columns / Callout / Toggle**：带 `nestable: true` 和 `allowedChildren` 白名单的块。它们的渲染器挂载嵌套的 `<BlockList>`。
- **Database**：渲染器是一个交互式 Vue widget 的块；数据存于 `attrs`。核心把它当普通块对待；`nodeView` 工厂在需要时允许完全的 DOM 控制。
- **Mention / 行内 Math**：新的 `InlineNode` 类型。contenteditable 契约和行内模型已经接受非文本的行内节点；渲染时把它们渲染为不可变的行内原子。
- **Mermaid / MindMap / Embed / Attachment**：`content: 'none'` 块，其渲染器是读取 `attrs` 的自包含组件。
- **AI**：命令（`/ai`、行内变换）以及一个用于 AI 输出的块类型。命令是一等公民；AI 只是另一个命令来源。
- **协作**：事务是可序列化的步骤；未来的传输层可以广播步骤并应用远程事务。历史已经把本地撤销与已应用状态分离。

没有任何未来特性需要修改 `core/`。这是简报的核心设计保证。

---

## 16. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 自定义 contenteditable 的边界情况（光标、IME） | 按块作用域；交给原生；显式 IME 防护；聚焦/组合时绝不写 DOM |
| 10k 块的性能 | 不可变状态 + 结构共享 + 基于 diff 的按块浅层 ref；`BlockList` 中的虚拟化接缝 |
| 撤销/重做的正确性 | 事务步骤 + 带分组的历史插件；`addToHistory` meta；通过状态重放测试 |
| 跨块光标几何 | 使用 `getBoundingClientRect` 行检测；阶段一启发式，之后打磨 |
| 随时间推移的 schema 僵化 | schema 是每扩展的，而非全局；重新配置时重建注册表 |
| 核心的特性蔓延 | `core/` 零 Vue 导入、零块类型 switch；由 lint 边界测试强制 |
| 深度响应式事故 | 文档是纯数据的；只有 `ViewBridge` 创建 ref；代码评审 + 一条禁止 `reactive(doc)`/`watch(doc,…, deep)` 的 lint 规则 |

---

## 17. 待解决问题（在阶段一期间解决）

1. **导入时的 ID 生成**：无条件保留外部 id，还是仅在碰撞时重新生成？→ 倾向：若唯一则保留，否则重新生成，并输出一个映射。在 `store.ts` 中决定。
2. **虚拟化默认值**：阶段一先发布非虚拟化的 `BlockList`，带干净接口；当测量出需要时再添加 `VirtualizedBlockList`。
3. **行内 marks 的时机**：阶段一将内容保持为单个文本段；marks 随加粗/斜体（阶段三之后）到来。`InlineSeq` 模型已经就位，因此这是增量添加。
4. **协作传输**：目前超出范围，但事务已被塑造成支持它（可序列化的步骤、版本号）。

---

## 18. 评审清单（自评）

- [x] 核心对具体的块类型一无所知（`core/` 中没有 `switch(type)`）。
- [x] 每个块类型都由扩展贡献；新增类型零核心改动。
- [x] 文档是 JSON；HTML/Markdown 仅用于导入/导出。
- [x] 单一变更路径：事务 → 新的不可变状态。
- [x] 选择与文档分离，绝不重新渲染块主体。
- [x] 按块 contenteditable；IME 受防护；通过 `key=blockId` 保持光标稳定。
- [x] 无深度响应式；渲染通过浅层 ref 按块订阅。
- [x] 模块小而单一职责；无 `utils.ts`。
- [x] 未来特性（Table、Database、Columns、AI……）无需核心改动。
- [x] **阶段一至五已实现**：7 个内置块类型、行内标记、块级属性、slash 菜单、输入规则、悬停工具栏、拖拽手柄、剪贴板、国际化、主题。
- [x] **阶段六已实现**：ImageExtension（含 `content:none` schema、替换/删除遮罩、caption、拖拽缩放、HTML/MD 序列化、`uploadImage` 钩子）+ 链接 mark（`setLink`/`unsetLink` 命令、`Mod+K`、链接浮层查看/编辑/复制/删除、粘贴/键入 URL 自动加链、HTML/MD 兼容、Undo/Redo、选区/mark 继承校验）。
- [x] **阶段七已实现**：TableExtension（`attrs` storage 网格、行/列选择条 + 角部全选手柄、浮动操作栏合并/拆分/切换标题行、插入点、完整矩形选区扩展、代码块单元格 Enter 插入换行、HTML/MD 序列化）+ DividerExtension（`---`/`***`/`___` 输入规则）。
- [x] **阶段八已实现**：TableOfContentsExtension（不可编辑的 `content: 'none'` 动态视图块，实时收集所有 `heading` 块并渲染层级列表；点击条目跳转到标题；序列化输出空字符串；斜杠 `/目录` 入口）。
- [x] **安全不变量**：所有 `<a href>` 的生成路径必须经过 `sanitizeUrl`（协议白名单 + 净化），禁止把未净化的用户字符串写入 `href`；禁止 mark 属性携带非字符串标量。
- [x] **安全不变量**：图片块的瞬时上传状态（status/progress/error/tempSrc）**绝不能**进入 `block.attrs`；所有 fileId 的引用数为 0 时必须触发外部清理事件。
- [x] **全部阶段已实现**：`vue-tsc --noEmit`、`eslint` 和 `vite build` 全部通过。
- [x] **全部阶段已实现**：各模块文档见 `docs/module.md`。
- [x] **全部阶段已实现**：ESLint 边界规则强制 `src/core/` 中无 Vue 导入。
