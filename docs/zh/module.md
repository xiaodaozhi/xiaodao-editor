# 小刀编辑器模块参考

本文档是 `xiaodao-editor` 包的按模块 API 参考。这是一个 Notion 风格、块优先的编辑器，以可复用的 Vue 3 + TypeScript 库形式构建。**核心**（`src/core/**`）与框架无关——它零 Vue 导入，可移植到任何框架；而**视图层**（`src/view/**`）是连接 Vue 响应式和 DOM 的唯一桥梁。每个块类型和编辑行为都由一个**扩展**贡献，因此核心绝不对块类型做 switch。包内置 **13** 个扩展（Paragraph、Heading、BulletList、OrderedList、TodoList、Quote、CodeBlock、**Image**、**Table**、**Divider**、**TableOfContents**、Keymap、History），覆盖全部块类型、行内标记（加粗/斜体/下划线/删除线/代码/**带 href 属性和 URL 净化的 link mark**）、块级属性、斜杠菜单、输入规则、悬停工具栏（新增链接按钮）、拖拽手柄、剪贴板、国际化、主题、**图片上传管线（侧信道 + fileId cleanup 事件）**、**链接浮层（查看/编辑/复制/删除）+ Mod+K + 粘贴/键入 URL 自动加链**、**表格块（合并/拆分/切换标题行）**、**目录块（实时标题列表视图）**、JSON 持久化以及 Markdown/HTML 序列化/反序列化。本参考按子系统组织；设计理由和更新流程见 `docs/architecture.md`（特别是 §4 文档模型、§6 渲染、§7 命令、§10 状态、§11 键盘/IME、§14 阶段 6 图片 + 链接 Mark、阶段 7 表格 + 分割线、阶段 8 目录）。

## 文档模型与类型

### `src/core/types.ts`

**职责。** 编辑器数据模型的唯一权威来源。它刻意与框架无关，只包含类型定义加上几个纯类型守卫和辅助函数（`inlineText`、`inlineFromString`）。所有运行时行为都位于专门的模块中；此模块定义其他一切所操作于其上的形状。

**公共 API。**

```ts
type BlockId = string & { readonly __brand: 'BlockId' } // 带品牌的不透明 id
type BlockType = string
type JSONValue = string | number | boolean | null | JSONValue[] | { [k: string]: JSONValue }
type Attrs = Readonly<Record<string, JSONValue>>

interface Mark { readonly type: string; readonly attrs?: Attrs }
interface TextRun { readonly type: 'text'; readonly text: string; readonly marks?: readonly Mark[] }
type InlineNode = TextRun                  // 可判别联合;未来:mention | equation
type InlineSeq = readonly InlineNode[]

interface Block {
  readonly id: BlockId
  readonly type: BlockType
  readonly attrs: Attrs
  readonly content: InlineSeq
  readonly children: readonly BlockId[]
}

interface DocState {
  readonly id: string
  readonly root: readonly BlockId[]
  readonly blocks: ReadonlyMap<BlockId, Block>
  readonly parent: ReadonlyMap<BlockId, BlockId | null>
}

interface Anchor { readonly blockId: BlockId; readonly offset: number }
type Selection =
  | { readonly kind: 'caret'; readonly blockId: BlockId; readonly offset: number }
  | { readonly kind: 'text'; readonly anchor: Anchor; readonly focus: Anchor }
  | { readonly kind: 'blocks'; readonly blockIds: readonly BlockId[] }

interface BlockData { readonly id?: string; readonly type: string; readonly attrs?: Attrs; readonly content?: InlineSeq; readonly children?: readonly BlockData[] }
interface DocumentData { readonly id?: string; readonly blocks: readonly BlockData[] }

function isBlockId(value: unknown): value is BlockId
function isTextRun(node: InlineNode): node is TextRun
function inlineText(seq: InlineSeq): string            // 连接文本段
function inlineFromString(text: string): InlineSeq      // 从字符串构建序列
```

**交互。** 几乎被其他每个核心模块导入。`ids.ts` 产出 `BlockId`；`state/store.ts` 从 `DocumentData` 构建 `DocState`；`Step.ts` 变更 `DocState`；`Selection.ts` 构造 `Selection`；`primitiveCommands.ts` 使用 `inlineText`/`inlineFromString`。视图层导入 `Block`、`BlockId`、`InlineSeq`、`Selection` 用于渲染和 DOM 同步。

**扩展点。** `InlineNode` 联合已经是可判别联合：未来的行内原子（mention、equation、行内公式）扩展它而无需改动 `Block`。`children` 支持嵌套块（toggle、columns、table cells）。`Selection.kind` 是一个可以为未来选择模式增长联合。

### `src/core/ids.ts`

**职责。** 稳定、不透明的块 id 生成，完全由核心独占，因此身份绝不来自扩展或持久化。使用 Web Crypto API（`crypto.getRandomValues`），所以核心零运行时依赖。见 `docs/architecture.md` §4.1。

**公共 API。**

```ts
function createBlockId(): BlockId   // 64 符号字母表中的 12 个字符(~71 位)
function asBlockId(value: string): BlockId  // 强制转换可信字符串(仅重水合)
```

若 `globalThis.crypto.getRandomValues` 不可用，`createBlockId` 会抛出异常。`ALPHABET` 是 `A–Za–z0–9_-`，`ID_LENGTH` 是 12。

**交互。** 被 `state/store.ts`（导入时的 id 分配 / 碰撞）、`state/Transaction.ts`（`TransactionBuilder.insertBlock` 在未提供 id 时生成一个）和 `Editor.ts`（`seedEmptyDocument`）导入。仅依赖 `types.ts`（以获得 `BlockId` 类型）。

**扩展点。** 生成是集中式的；换成不同的方案（例如协作用的 UUID）只需编辑这一个模块。碰撞抵抗按单文档规模设计；协作传输可以加前缀或替换生成器，而无需触碰调用点。

## 状态管理

### `src/core/state/store.ts`

**职责。** 负责从嵌套 JSON 构建规范化的 `DocState`、序列化回 JSON，以及纯查找辅助函数（父、兄弟、文档序遍历）。它绝不就地变更 `DocState`——变更位于 `Step.ts` / `Transaction.ts`。见 `docs/architecture.md` §4.4（森林 + 规范化 store）和 §10。

**公共 API。**

```ts
interface DocBuildResult { readonly doc: DocState; readonly idMap: ReadonlyMap<string, BlockId> }

function docFromData(json: DocumentData): DocBuildResult   // 保留唯一的源 id,否则重新生成
function docToData(doc: DocState): DocumentData

// 纯查找
function getBlock(doc: DocState, id: BlockId): Block | undefined
function requireBlock(doc: DocState, id: BlockId): Block          // 缺失时抛出
function parentOf(doc: DocState, id: BlockId): BlockId | null
function siblingList(doc: DocState, id: BlockId): readonly BlockId[]
function indexOf(doc: DocState, id: BlockId): number
function prevSibling(doc: DocState, id: BlockId): Block | undefined
function nextSibling(doc: DocState, id: BlockId): Block | undefined
function flatten(doc: DocState): BlockId[]                        // 深度优先文档序
function blockBefore(doc: DocState, id: BlockId): Block | undefined
function blockAfter(doc: DocState, id: BlockId): Block | undefined
function lastDescendant(doc: DocState, id: BlockId): Block

// 内容辅助函数(产出新的不可变 Block)
function withContent(block: Block, content: InlineSeq): Block
function withAttrs(block: Block, attrs: Block['attrs']): Block
```

**交互。** 依赖 `types.ts` 和 `ids.ts`。被 `Step.ts`（apply 读取父/子）、`invert.ts`（`indexOf`、`parentOf`、`requireBlock` 以反转步骤）、`Editor.ts`（`docFromData`、`docToData`、`flatten`、`getBlock`）和 `primitiveCommands.ts`（遍历以支持 Enter/Backspace/导航）使用。

**扩展点。** id 策略（若唯一则保留，否则重新生成，返回 `idMap`）是改变导入身份规则的唯一地方——见待解决问题 §17.1。`flatten` 是视图桥接用来推导扁平渲染列表的接缝；未来的虚拟化 `BlockList` 消费同样的输出。

### `src/core/state/Step.ts`

**职责。** 定义变更文档的原子化、可序列化的结构操作（`Step`），以及 `applySteps`——它产出一个新的不可变 `DocState` 加一个 diff（`changed` / `removed`），视图桥接消费它以只更新受影响的块。步骤刻意保持底层和"笨"——它们携带完全解析好的数据，不做任何策略决策；命令分配 id 并对步骤排序。见 `docs/architecture.md` §7.2 和 §10.3。

**公共 API。**

```ts
type Step =
  | { op: 'insertBlock'; parent: BlockId | null; index: number; id: BlockId; type: BlockType; attrs: Attrs; content: InlineSeq }
  | { op: 'removeBlock'; id: BlockId }
  | { op: 'replaceBlock'; id: BlockId; type: BlockType; attrs: Attrs }
  | { op: 'moveBlock'; id: BlockId; toParent: BlockId | null; toIndex: number }
  | { op: 'setText'; id: BlockId; content: InlineSeq }
  | { op: 'setAttrs'; id: BlockId; attrs: Attrs }

interface ApplyResult { readonly doc: DocState; readonly changed: ReadonlySet<BlockId>; readonly removed: ReadonlySet<BlockId> }

function applySteps(doc: DocState, steps: readonly Step[]): ApplyResult
```

`removeBlock` 分离整个子树（递归删除后代）。`moveBlock` 同时处理兄弟内的重排和跨父的重挂。索引用 `Math.max(0, Math.min(index, len))` 做钳位。

**交互。** 依赖 `types.ts`。被 `EditorState.ts`（`applyTransaction` 调用 `applySteps`）、`Transaction.ts`（`Step` 类型）和 `invert.ts`（反转步骤列表）消费。diff（`changed`/`removed`）经 `applyTransaction` → `Editor.dispatch` → 视图层流出。

**扩展点。** 新的结构操作（例如 `insertInlineNode`、`setMark`）作为新的联合成员以及 `applySteps` 中的一个 `case` 加入。由于步骤可序列化，它们是未来协作传输会广播的单元——见 §15（协作）。

### `src/core/state/Transaction.ts`

**职责。** 定义 `Transaction`——变更编辑器状态的唯一路径——作为有序的 `Step` 列表加上可选的结果选择和元数据。提供一个流式的 `TransactionBuilder`，命令用它来组装事务。Meta 携带横切提示：`addToHistory`、`historyGroup`、`viewHints.skipDomWrite`，以及一个 `source` 溯源标签。见 `docs/architecture.md` §6.3、§7.2、§10.3。

**公共 API。**

```ts
interface TransactionMeta {
  readonly addToHistory?: boolean
  readonly historyGroup?: string | null
  readonly viewHints?: { readonly skipDomWrite?: readonly BlockId[] }
  readonly source?: string
  readonly [key: string]: unknown
}
interface Transaction { readonly steps: readonly Step[]; readonly selectionAfter?: Selection; readonly meta: TransactionMeta }
interface InsertBlockParams { parent: BlockId | null; index: number; type: BlockType; attrs?: Attrs; content?: InlineSeq; id?: BlockId }

class TransactionBuilder {
  insertBlock(params: InsertBlockParams): BlockId   // 返回(生成的或显式的)id
  removeBlock(id: BlockId): this
  replaceBlock(id: BlockId, type: BlockType, attrs: Attrs): this
  moveBlock(id: BlockId, toParent: BlockId | null, toIndex: number): this
  setText(id: BlockId, content: InlineSeq): this
  setAttrs(id: BlockId, attrs: Attrs): this
  appendSteps(steps: readonly Step[]): this          // 用于历史撤销/重做
  setSelection(selection: Selection): this
  setMeta(meta: Partial<TransactionMeta>): this
  addToHistory(value: boolean): this
  historyGroup(key: string | null): this
  skipDomWrite(ids: readonly BlockId[]): this
  build(): Transaction
}
function createTransaction(): TransactionBuilder
```

当省略 `params.id` 时，`insertBlock` 通过 `createBlockId()` 生成一个 id；显式形式用于撤销/重做和粘贴。

**交互。** 依赖 `types.ts`、`Step.ts`（`Step` 类型）和 `ids.ts`。被 `primitiveCommands.ts`（每个原语都构建一个事务）、`HistoryManager.ts`（`undo`/`redo` 通过 `appendSteps` 构建逆/原事务）和 `EditorState.ts`（应用 `Transaction`）使用。

**扩展点。** 新的 meta 键是开放的（索引签名 `[key: string]: unknown`），因此插件和未来特性可以附加提示而无需改变类型。`viewHints` 是视图层读取的契约，以在键入期间跳过对聚焦块的 DOM 写入（§6.3）。

### `src/core/state/EditorState.ts`

**职责。** 编辑器的不可变、带版本的状态：文档、选择、每插件状态和一个单调的 `version`。变更完全经由 `applyTransaction`，它产生带结构共享的*新* `EditorState`（未变化的 `Block` 对象保留引用同一性）。见 `docs/architecture.md` §10.1。

**公共 API。**

```ts
interface EditorState {
  readonly doc: DocState
  readonly selection: Selection
  readonly pluginState: Readonly<Record<string, PluginState>>
  readonly version: number
}
interface ApplyTransactionResult extends ApplyResult { readonly state: EditorState }

function applyTransaction(state: EditorState, tr: Transaction, plugins: readonly TransactionApplier[]): ApplyTransactionResult
function createState(doc: DocState, selection: Selection, pluginState?: Readonly<Record<string, PluginState>>): EditorState
```

`applyTransaction` 运行 `applySteps`，继承 `selectionAfter`（回退到先前选择），调用每个插件的 `applyTransaction` 钩子以更新其状态切片，并递增 `version`。插件作为一个最小的 `TransactionApplier` 视图（`{ name, applyTransaction? }`）传入，以避免与 `Plugin` 模块产生运行时耦合。

**交互。** 依赖 `types.ts`、`Step.ts`（`applySteps`、`ApplyResult`）、`Transaction.ts`（`Transaction` 类型），以及 `Plugin.ts` 的类型级导入（`PluginState`）。被 `Editor.ts`（持有当前状态，调用 `applyTransaction`）使用，并被每个命令（`primitiveCommands.ts` 检查 `state.doc` / `state.selection`）和插件读取。

**扩展点。** `pluginState` 是一个以插件名为键的开放记录；新插件在这里添加自己的切片，这正是让撤销/重做跨插件效果保持正确的关键（§9）。`version` 计数器是未来乐观协作排序的基础。

### `src/core/state/invert.ts`

**职责。** 计算对给定步骤列表做撤销所需的步骤（针对这些步骤应用*之前*的文档状态）。这实现了内存高效、正确的撤销/重做，而无需对整个文档做快照——只有事务触碰到的块被逆步骤引用。步骤以逆序反转，因此最后应用的更改最先被撤销。见 `docs/architecture.md` §9 和 §16。

**公共 API。**

```ts
function invertSteps(steps: readonly Step[], prevDoc: DocState): Step[]
```

逐操作反转：`insertBlock` → `removeBlock`；`removeBlock` → 重造子树的前序 `insertBlock` 序列（`reinsertSubtree`）；`replaceBlock`/`setText`/`setAttrs` → 从 `prevDoc` 恢复先前值；`moveBlock` → 移回先前的父和索引。

**交互。** 依赖 `types.ts`、`Step.ts` 和 `store.ts`（`indexOf`、`parentOf`、`requireBlock`）。被 `HistoryManager.ts` 消费，后者在记录事务时调用 `invertSteps`，使每个历史条目同时携带原始步骤和逆步骤。

**扩展点。** 新的步骤操作需要在这里有一个匹配的 `case`，否则撤销会静默跳过它们。该模块刻意独立，以便这段反转逻辑保持可审计——见 §13.1（"'invert.ts' 不在设计中 → 新增"）。

## Schema 系统

### `src/core/schema/BlockSchema.ts`

**职责。** 定义块类型声明的结构契约，以便核心*无需*知道类型就能推理它。核心绝不对 `block.type` 做 switch；它改为问 schema。提供 spec 类型、应用默认值的 `defineSchema` 规范化器、attr 强制转换/校验，以及纯结构谓词。见 `docs/architecture.md` §5.3。

**公共 API。**

```ts
interface AttrSpec { readonly default: JSONValue; readonly validate?: (value: unknown) => boolean }
interface BlockSchemaSpec {
  readonly type: BlockType
  readonly attrs?: Readonly<Record<string, AttrSpec>>
  readonly content?: 'text' | 'none'
  readonly nestable?: boolean
  readonly allowedChildren?: readonly BlockType[] | '*'
  readonly isolating?: boolean
  readonly empty?: (block: Block) => boolean
}
interface BlockSchema { /* 相同字段,全部必填,已规范化 */ }

function defineSchema(spec: BlockSchemaSpec): BlockSchema
function defaultAttrs(schema: BlockSchema): Attrs
function coerceAttrs(schema: BlockSchema, raw: Readonly<Record<string, unknown>>): Attrs
function canContain(parent: BlockSchema, childType: BlockType): boolean
function hasText(schema: BlockSchema): boolean
function isIsolating(schema: BlockSchema): boolean
function isEmpty(schema: BlockSchema, block: Block): boolean
```

默认 schema（字段被省略时）是 `content: 'text'`、`nestable: false`、`allowedChildren: '*'`、`isolating: false`，以及一个将无内容或全空文本段视为空的 `empty` 谓词。

**交互。** 依赖 `types.ts`。被 `SchemaRegistry.ts`（用类型键控查找包装它）使用，并间接被 `Registry.ts` 使用（`defineSchema` 规范化每个扩展的 spec）。谓词被 `primitiveCommands.ts` 通过 `SchemaRegistry` 读取，以驱动 Enter/Backspace/split/merge 而无需引用类型。

**扩展点。** 块类型扩展提供 `BlockSchemaSpec`；`defineSchema` 填补空隙。未来的结构标志（例如 `inlineContent: 'marks'`、`void: true`）是 spec 上的增量字段。`allowedChildren` 白名单是未来嵌套块（Toggle、Columns、Callout）约束其子块的方式——见 §15。

### `src/core/schema/SchemaRegistry.ts`

**职责。** 把 `BlockType` 映射到它的 `BlockSchema`，从扩展一次性构建并冻结。提供核心用来替代按类型名 switch 的结构谓词，并对未知类型使用一个类 paragraph 的回退 schema。见 `docs/architecture.md` §5.2。

**公共 API。**

```ts
class SchemaRegistry {
  constructor(schemas: ReadonlyMap<BlockType, BlockSchema>, fallback: BlockSchema)
  get(type: BlockType): BlockSchema          // 回退到类 paragraph 的默认值
  has(type: BlockType): boolean
  defaultAttrsFor(type: BlockType): Attrs
  coerceAttrsFor(type: BlockType, raw: Readonly<Record<string, unknown>>): Attrs
  canContain(parentType: BlockType, childType: BlockType): boolean
  hasText(type: BlockType): boolean
  isIsolating(type: BlockType): boolean
  isEmpty(block: Block): boolean
}
```

**交互。** 依赖 `BlockSchema.ts`（委托给它的纯函数）。由 `Registry.ts`（`buildRegistries`）用一个 `type: '__fallback__'` 的 `FALLBACK_SCHEMA` 构造。被 `primitiveCommands.ts` 大量读取（例如 `enter` 检查 `hasText`/`isEmpty`/`isIsolating`；`splitBlock` 检查 `hasText`），也被 `Editor.ts` 读取（播种空文档时的 `defaultAttrsFor`）。

**扩展点。** 回退 schema 让核心即使某个块类型缺失也能运行——在动态注册期间很有用。新增块类型就是"通过扩展注册一个 schema"；注册表在编辑器重新配置时重建（§5.4）。

## 命令系统

### `src/core/command/Command.ts`

**职责。** 定义 `Command` 类型（ProseMirror 形态的纯函数：`(args) => (state, dispatch?) => boolean`）、按名存储命令的 `CommandRegistry`，以及一个基于 `Proxy` 的命令代理，让调用者写 `editor.commands.insertBlock({...})`。见 `docs/architecture.md` §7.1。

**公共 API。**

```ts
type Dispatch = (tr: Transaction) => void
type CommandFn<TArgs = void> = (args: TArgs) => (state: EditorState, dispatch?: Dispatch) => boolean
interface CommandEntry<TArgs = void> { readonly name: string; readonly run: CommandFn<TArgs> }
type CommandSpec<TArgs = void> = CommandEntry<TArgs>
type AnyCommandEntry = CommandEntry<any>      // 为异构注册表擦除类型
type CommandDispatcher = (name: string, args: unknown) => boolean

class CommandRegistry {
  register(spec: AnyCommandEntry): void       // 同名时抛出
  override(spec: AnyCommandEntry): void       // 替换(扩展覆盖原语)
  has(name: string): boolean
  get(name: string): AnyCommandEntry | undefined
  createProxy(dispatch: CommandDispatcher): Record<string, (...args: unknown[]) => boolean>
}
```

代理对每次属性访问返回一个分发具名命令的函数；未知命令解析为 `() => false` 的"未处理"函数。

**交互。** 依赖 `EditorState.ts` 和 `Transaction.ts`（仅类型）。注册表由 `Editor.ts` 拥有，它先注册原语，然后让扩展按名 `override`，再注册核心 `undo`/`redo` 命令。该代理以 `editor.commands` 暴露，被 `primitiveCommands.ts`（命令组合其他命令，例如 `enter` 调用 `insertBlockCommand`/`splitBlockCommand`）、视图层（`BlockContent.vue` 调用 `editor.commands.setText`）和 `keymapHandler.ts` 使用。

**扩展点。** 扩展通过 `Extension.commands` 贡献命令；它们在原语之后注册，因此可以按名覆盖（`Editor` 在 `has(name)` 为真时调用 `override`）。类型安全在定义点保留（`CommandEntry<YourArgs>`），只在注册表内部被擦除。

### `src/core/command/primitiveCommands.ts`

**职责。** 编辑器核心提供的块类型无感知操作。每个都是 `(args) => (state, dispatch?) => boolean` 纯函数，*只*使用 schema 谓词（绝无 `block.type` switch）构建事务。它们用 `SchemaRegistry` 实现 Enter/Backspace/split/merge/导航/选择，因此行为完全由 schema 驱动。见 `docs/architecture.md` §7.3、§11.2、§11.3。

**公共 API。**

```ts
interface InsertBlockArgs { type: BlockType; attrs?: Attrs; content?: InlineSeq; after?: BlockId; parent?: BlockId | null; index?: number }
interface ReplaceBlockArgs { id: BlockId; type: BlockType; attrs?: Attrs }
interface SetTextArgs { id: BlockId; content: InlineSeq; selectionAfter?: Selection }
interface SplitBlockArgs { id: BlockId; offset: number }
interface MoveCaretArgs { offset?: number }
interface SetLinkArgs { readonly id: BlockId; readonly href: string; readonly from: number; readonly to: number; readonly text?: string }
interface UnsetLinkArgs { readonly id: BlockId; readonly from: number; readonly to: number }

function createPrimitiveCommands(registries: EditorRegistries): AnyCommandEntry[]
```

`createPrimitiveCommands` 返回以下条目的数组：`insertBlock`、`removeBlock`、`replaceBlock`、`setText`（携带 `historyGroup('type')` + `skipDomWrite` + `source: 'input'`）、`setAttrs`、`splitBlock`（在偏移处拆分文本，之后插入 `defaultBlockType`）、`mergeBlock`（与文档序中的前一块合并）、`enter`（拆分，或插入默认块以退出，或在非文本/isolating 块后插入）、`backspace`（在偏移 0 处合并、删除块内范围、或移除 blocks 选择；尊重 `isolating`）、`moveToPreviousBlock`、`moveToNextBlock`、`setSelection`、`selectBlock`、`moveBlock`，**`setLink`**（对块 `id` 的 `[from,to)` 范围应用 `{type:'link', attrs:{ href: sanitizeUrl(href) }}` mark；若提供 `text`，则在同一事务中把范围的字面文本替换为 `text`，以便统一改写链接文本；如果范围内含 `code` mark 则跳过，因为 code 与 link 互斥），和 **`unsetLink`**（去掉 `[from,to)` 范围上的 `link` mark）。

**交互。** 依赖 `types.ts`、`Transaction.ts`、`Command.ts`、`extension/Registry.ts`（`EditorRegistries`，用于 schema + `defaultBlockType`）、`state/store.ts`（遍历）和 `selection/Selection.ts`（构造器/守卫）。由 `Editor.ts` 注册。`enter`/`backspace` 命令内部组合其他原语（例如 `enter` 调用 `insertBlockCommand`/`splitBlockCommand`）。

**扩展点。** 块类型专属命令（例如 `toggleTodo`、`setHeadingLevel`）组合这些原语，并暴露在同一个 `editor.commands` 代理上。扩展可以按名 `override` 任何原语。新的结构原语（例如 §7.3 提到的 `liftBlock`、`wrapBlock`）在这里作为新条目加入，完全由 schema 谓词驱动。

### `src/core/command/Keymap.ts`

**职责。** 把标准化的键盘快捷键绑定到命令。绑定按优先级排序；第一个匹配胜出。键名遵循 ProseMirror 约定（`Mod-Enter`、`Shift-ArrowUp`、`Backspace`），其中 `Mod` 被解析为实际的平台修饰键（Mac 上是 Cmd，其他平台是 Ctrl）。见 `docs/architecture.md` §11.1。

**公共 API。**

```ts
interface KeymapBinding { readonly key: string; readonly command: string; readonly args?: unknown; readonly priority?: number }
type KeymapSpec = readonly KeymapBinding[]

function keyNameFromEvent(event: KeyboardEvent): string   // 例如 "Cmd-Shift-Z";裸修饰键为 ""
function keyMatches(bindingKey: string, eventKey: string): boolean  // 解析 Mod,不区分大小写

class KeymapRegistry {
  register(spec: KeymapSpec): void          // 按优先级重新排序(数字小者靠前)
  resolve(eventKey: string): KeymapBinding | undefined
}
```

`keyNameFromEvent` 标准化别名（`Esc`→`Escape`、`Left`→`ArrowLeft`、`Space`→` ` 等）并把单字符键转大写。裸修饰键按下返回 `""`（无绑定）。

**交互。** 只依赖 DOM 的 `KeyboardEvent`/`navigator.platform`。注册表由 `Registry.ts` 构建、由 `Editor` 拥有。`keymapHandler.ts` 调用 `keyNameFromEvent` 然后 `resolve`；`extensions/Keymap.ts` 和 `extensions/History.ts` 贡献 `KeymapSpec`。

**扩展点。** 扩展通过 `Extension.keymap` 添加绑定；数字较小的 `priority` 先运行，因此块类型可以覆盖默认绑定。`Mod` 占位符加上平台检测意味着同一个 spec 在 Mac 和 Windows 上都能用。

### `src/core/command/InputRule.ts`

**职责。** 定义输入规则契约：在光标处键入时触发命令的文本模式（例如 `# ` → 转为 heading）。由 `view/ui/inputRulesEngine.ts` 消费，后者在每次输入事件时针对当前块光标前的文本运行已注册的规则。见 `docs/architecture.md` §11。

**公共 API。**

```ts
interface InputRuleContext { readonly blockId: BlockId; readonly textBeforeCaret: string }
interface InputRuleSpec {
  readonly name: string
  readonly pattern: RegExp                  // 必须锚定,例如 /^# $/
  readonly command: string
  readonly args?: (match: RegExpExecArray) => unknown
}
interface InputRule extends InputRuleSpec {}

class InputRuleRegistry {
  register(spec: InputRuleSpec): void
  get all(): readonly InputRule[]
}
```

**交互。** 依赖 `types.ts`（`BlockId`）。注册表由 `Registry.ts` 构建，携带于 `EditorRegistries.inputRules`。视图层 `inputRulesEngine.ts` 在每次输入事件时针对 `InputRuleContext` 遍历 `all`。

**扩展点。** 扩展通过 `Extension.inputRules` 贡献规则。`args` 构造器让规则把捕获的组传给它的命令（例如来自 `## ` 的 heading 级别）。Markdown 快捷键（`# `、`> `、`[] `、```` ``` ````)即通过输入规则实现。

### `src/core/command/SlashCommand.ts`

**职责。** 定义斜杠命令/命令面板契约：出现在斜杠菜单(`PlusMenu.vue`)中的条目。注册表提供 `search` 方法用于按查询过滤条目。

**公共 API。**

```ts
interface SlashCommandSpec {
  readonly id: string
  readonly title: string
  readonly keywords?: readonly string[]
  readonly description?: string
  readonly icon?: unknown
  readonly command: string
  readonly args?: unknown
  readonly applicableTo?: readonly BlockType[]   // 限定到当前的块类型
}
type SlashCommand = SlashCommandSpec

class SlashCommandRegistry {
  register(spec: SlashCommandSpec): void        // 重复 id 时抛出
  get all(): readonly SlashCommand[]
  search(query: string): readonly SlashCommand[]  // 对 title+keywords 的朴素子串匹配
}
```

**交互。** 依赖 `types.ts`(`BlockType`)。由 `Registry.ts` 构建；携带于 `EditorRegistries.slash`。`PlusMenu.vue` 调用 `search`(或查询为空时 `all`)并在提交时分发匹配的命令。

**扩展点。** 扩展通过 `Extension.slashCommands` 添加条目。`applicableTo` 让命令只对某些块类型显示。`icon` 是视图层解释的不透明令牌，因此核心保持 UI 无关。精炼的排序/模糊搜索可以替换 `search` 而无需触碰扩展。

## 扩展系统

### `src/core/extension/Extension.ts`

**职责。** `Extension` 契约:编辑器获得新块类型和行为的唯一机制。扩展是一个普通 spec 对象(由工厂产出),在构造时贡献;核心从不导入扩展,它只把它们的 spec 处理进注册表。每个字段均可选——扩展只贡献它需要的部分。见 `docs/architecture.md` §5。

**公共 API。**

```ts
interface BlockRendererSpec { readonly component: unknown; readonly editable?: boolean }  // component 对 Vue 不透明
interface ToolbarActionSpec { readonly id: string; readonly label: string; readonly command: string; readonly args?: unknown; readonly icon?: unknown }

interface Extension {
  readonly name: string
  readonly uses?: readonly Extension[]            // 捆绑的扩展；摊平，按名去重
  readonly schema?: BlockSchemaSpec
  readonly renderer?: BlockRendererSpec
  readonly commands?: readonly AnyCommandEntry[]
  readonly keymap?: KeymapSpec
  readonly inputRules?: readonly InputRuleSpec[]
  readonly slashCommands?: readonly SlashCommandSpec[]
  readonly toolbar?: readonly ToolbarActionSpec[]
  readonly serialize?: SerializerSpec
  readonly deserialize?: DeserializerSpec
  readonly plugins?: readonly Plugin[]
}

function extensionBlockType(ext: Extension): BlockType | null   // 便捷：所声明的类型(若有)
```

`BlockRendererSpec.component` 被类型为 `unknown`，以便核心保持框架无关；`BlockHost.vue` 在唯一的视图层边界把它转换为 Vue 组件。

**交互。** 依赖(仅类型)`BlockSchema`、`Command`、`InputRule`、`Keymap`、`Plugin`、`SlashCommand`、`Serializer` 和 `types`。被 `Registry.ts`(`flattenExtensions` + `buildRegistries`)消费。内置扩展(`Paragraph`、`Heading`、`Keymap`、`History`)实现它；用户扩展被传给 `Editor` / `BlockEditor.vue`。

**扩展点。** *这就是*扩展点。新增块类型 = 创建一个带 `schema` + `renderer`(加上可选的 serialize/slash/commands)的 `Extension` 并传给编辑器——零核心改动(§5.4、§15)。`uses` 图支持组合(例如一个捆绑 `History` 类行为的 "CodeBlock" 扩展)。

### `src/core/extension/Registry.ts`

**职责。** 摊平扩展列表(解析 `uses`,按名去重,后者覆盖前者),并组装编辑器运行时查询的、已冻结的、带类型的注册表。还定义 `RendererRegistry` 和 `ToolbarRegistry`(两个不由自身模块拥有的注册表)。见 `docs/architecture.md` §5.2、§5.4。

**公共 API。**

```ts
class RendererRegistry {
  register(type: BlockType, spec: BlockRendererSpec): void  // 重复时抛出
  get(type: BlockType): BlockRendererSpec | undefined
}
class ToolbarRegistry {
  register(type: BlockType, actions: readonly ToolbarActionSpec[]): void  // 追加
  get(type: BlockType): readonly ToolbarActionSpec[]
}

interface EditorRegistries {
  readonly schema: SchemaRegistry
  readonly renderers: RendererRegistry
  readonly commands: CommandRegistry
  readonly keymap: KeymapRegistry
  readonly inputRules: InputRuleRegistry
  readonly slash: SlashCommandRegistry
  readonly toolbar: ToolbarRegistry
  readonly serializers: SerializerRegistry
  readonly deserializers: DeserializerRegistry
  readonly plugins: readonly Plugin[]
  readonly extensionCommands: readonly AnyCommandEntry[]
  readonly defaultBlockType: BlockType
}
interface BuildRegistriesOptions { readonly defaultBlockType?: BlockType }

function flattenExtensions(extensions: readonly Extension[]): Extension[]  // 按名后者胜出
function buildRegistries(extensions: readonly Extension[], options?: BuildRegistriesOptions): EditorRegistries
```

`buildRegistries` 遍历摊平后的列表，通过 `defineSchema` 规范化每个 schema，注册 renderers/keymaps/input rules/slash commands/toolbar actions/serializers/deserializers/plugins，并单独收集扩展命令(它们在原语之后注册，因此可以覆盖)。回退 schema 是 `type: '__fallback__'`。`defaultBlockType` 默认为 `'paragraph'`。

**交互。** 依赖每个注册表模块(`Command`、`InputRule`、`Keymap`、`SlashCommand`、`SchemaRegistry`、`BlockSchema`、`Serializer`)以及 `Extension.ts`/`Plugin.ts`。由 `Editor.ts` 在构造函数中调用一次。结果 `EditorRegistries` 是 `primitiveCommands.ts`、`Editor.ts` 和视图层读取的中央对象。

**扩展点。** `flattenExtensions` 的"后者胜出"规则是用户扩展覆盖同名内置扩展的方式。新增注册表(例如未来用于行内格式化的 `MarkRegistry`)意味着给 `EditorRegistries` 加一个字段、加一个类、在 `buildRegistries` 中加一个注册循环——局部改动，无命令/核心变更。

## 插件系统

### `src/core/plugin/Plugin.ts`

**职责。** `Plugin` 契约。插件在定义良好的钩子上增强编辑器行为。它们与扩展不同：扩展*声明*块/命令/键位映射；插件*响应*编辑器生命周期和事件。插件状态存储在 `EditorState` 内部(以名为键)，因此它是不可变的、带版本的状态的一部分——这正是让撤销/重做跨插件效果保持正确的关键。见 `docs/architecture.md` §9。

**公共 API。**

```ts
type PluginState = unknown

interface EventContext {
  readonly state: EditorState
  readonly dispatch: (tr: Transaction) => void
  readonly focusBlockId: () => string | null
}

interface Plugin {
  readonly name: string
  init?(state: EditorState): PluginState
  applyTransaction?(tr: Transaction, prevState: EditorState, nextDoc: EditorState['doc'], nextSelection: EditorState['selection']): PluginState
  onKeyDown?(event: KeyboardEvent, ctx: EventContext): boolean
  onInput?(event: InputEvent, ctx: EventContext): boolean
  onCompositionStart?(event: CompositionEvent, ctx: EventContext): void
  onCompositionEnd?(event: CompositionEvent, ctx: EventContext): void
  onDestroy?(): void
}
```

**交互。** 依赖(仅类型)`EditorState.ts` 和 `Transaction.ts`。插件被 `Registry.ts` 收集进 `EditorRegistries.plugins`。`Editor.ts` 在构造时调用 `init`,在每次分发时通过 `applyTransaction` 调用 `applyTransaction`,并通过 `handleKeyDown`/`handleInput`/`handleCompositionStart`/`handleCompositionEnd` 调用 `on*` 事件钩子(由视图层调用)。`EditorState.applyTransaction` 使用每个插件的最小 `TransactionApplier` 视图。

**扩展点。** 未来的插件(例如 InputRules、SelectionSync、Placeholder、装饰)实现此接口,并通过 `Extension.plugins` 贡献。因为插件状态存在于 `EditorState`,插件可以推导参与撤销/重做的装饰或信号。钩子集可以增长(例如 `onPaste`、`onScroll`)而不破坏现有插件。

## 选择模型

### `src/core/selection/Selection.ts`

**职责。** `Selection` 的构造器、类型守卫和纯辅助函数。Selection 是编辑器状态的一部分,但*与*文档*分离*(§8)。此模块绝不触碰 DOM——原生选择同步位于 `view/domSelection.ts`。见 `docs/architecture.md` §8。

**公共 API。**

```ts
function caretSelection(blockId: BlockId, offset: number): Selection
function textSelection(anchor: Anchor, focus: Anchor): Selection
function blocksSelection(blockIds: readonly BlockId[]): Selection
function isCaret(sel: Selection): sel is Extract<Selection, { kind: 'caret' }>
function isText(sel: Selection): sel is Extract<Selection, { kind: 'text' }>
function isBlocks(sel: Selection): sel is Extract<Selection, { kind: 'blocks' }>
function isCollapsed(sel: Selection): boolean
function primaryBlock(sel: Selection): BlockId | null       // Enter 等命令作用的地方
function focusOffset(sel: Selection): number
function orderedAnchors(sel: Selection, compare: (a: Anchor, b: Anchor) => number): readonly [Anchor, Anchor] | null
```

`primaryBlock` 返回光标的块、文本选择的焦点块,或第一个被选的块。`orderedAnchors` 规范化文本选择,使 anchor 在文档序中先于(或等于)focus,使用调用方提供的比较器。

**交互。** 依赖 `types.ts`。被 `primitiveCommands.ts`(守卫 + 用于 selection-after 的 `caretSelection`)、`Editor.ts`(初始选择的 `caretSelection`)和 `view/domSelection.ts`(`caretSelection`、`isCaret`、`isText`)使用。

**扩展点。** `types.ts` 中的 `Selection` 联合可以增长(例如未来用于表格选择的 `cells` 种类);此模块添加匹配的构造器/守卫。`orderedAnchors` 的可插拔比较器让未来多块文本选择无需 DOM 几何就能计算删除范围。

## 历史

### `src/core/history/HistoryManager.ts`

**职责。** 通过带分组的步骤反转实现撤销/重做。由 `Editor` 拥有(非 `EditorState` 的一部分),因为历史是编辑器实例状态,而非文档状态。带 `meta.addToHistory === false` 的事务(选择移动、撤销/重做本身)不被记录。共享一个 `historyGroup` 键的连续事务合并成单个撤销条目(用于键入段)。见 `docs/architecture.md` §9 和 §16。

**公共 API。**

```ts
class HistoryManager {
  constructor(limit?: number)                 // 默认 500 个条目
  record(tr: Transaction, prevSelection: Selection, prevDoc: DocState): void
  canUndo(): boolean
  canRedo(): boolean
  reset(): void                               // 清空两个栈(用于文档替换)
  undo(): Transaction | null                  // 构建逆事务；压入 redo
  redo(): Transaction | null                  // 重新应用原事务；压回 undo
}
```

`record` 通过 `invertSteps` 计算逆步骤，每个 `HistoryItem` 同时存储原始步骤和逆步骤。分组：若新事务的 `historyGroup` 与栈顶打开条目的组匹配，则该项被追加到该条目；否则压入新条目(并将栈裁剪到 `limit`)。任何新记录的更改都会清空 redo 栈。`undo` 以逆序应用逆步骤，带 `addToHistory: false` 和 `source: 'undo'`；`redo` 以正序重新应用原始步骤。

**交互。** 依赖 `types.ts`、`Step.ts`、`Transaction.ts`(`createTransaction`)和 `invert.ts`(`invertSteps`)。由 `Editor.ts` 拥有，它在 `dispatch` 内调用 `record`，并暴露 `undo()`/`redo()`/`canUndo()`/`canRedo()`。核心 `undo`/`redo` 命令(在 `Editor` 中注册)委托给它。

**扩展点。** `historyGroup` 是控制粒度的 meta 键——未来一种"词边界"分组策略只改变命令如何设置 `historyGroup`。`limit` 和基于反转(而非基于快照)的方法让大文档的内存保持有界。协作层可以读取栈来调和远程/本地历史。

## 序列化

### `src/core/serialize/Serializer.ts`

**职责。** 按块的 Markdown/HTML 序列化契约。规范 JSON 进/出由 `state/store.ts` 集中处理(`docFromData`/`docToData`)；这些 spec 让每个块类型都能贡献 Markdown(阶段二)和 HTML(阶段五)的往返，而无需核心改动。还定义按注册顺序尝试 Markdown 行解析器的 `DeserializerRegistry`，以及阶段 6 新增的 HTML 元素级 `fromHTML`(用于块级 HTML 粘贴——图片 `<figure>`/`<img>` 等)。

**公共 API。**

```ts
interface SerializeResult { readonly type: BlockType; readonly attrs?: Attrs; readonly content?: InlineSeq }
interface SerializerSpec {
  readonly toMarkdown?: (block: Block) => string
  readonly toHTML?: (block: Block) => string
}
interface DeserializerSpec {
  readonly fromMarkdown?: (line: string) => SerializeResult | null
  readonly fromHTML?: (node: HTMLElement, inlines: InlineSeq) => SerializeResult | null
}

class SerializerRegistry {
  register(type: BlockType, spec: SerializerSpec): void
  markdownFor(block: Block): string | undefined
  htmlFor(block: Block): string | undefined
}
class DeserializerRegistry {
  register(spec: DeserializerSpec): void
  parseMarkdownLine(line: string): SerializeResult | null   // 首个匹配胜出
  parseHtmlElement(node: HTMLElement, inlines: InlineSeq): SerializeResult | null
}
```

对 `link` mark(行内级)：序列化/反序列化由 `inlineDom.ts`（HTML）和 `Editor.ts`（Markdown，直接集成在 `editor.toMarkdown` / `editor.setDocFromMarkdown` 中）各自直接处理，不需要块级 `SerializerSpec`——它们把行内的 `{type:'link', attrs:{href}}` 分别写成 `<a href>` 和 `[text](href)`。对 `image` 块：Image 扩展提供 `serialize.toMarkdown` → `![](src "title")`(带 alt/caption 变体)和 `toHTML` → `<figure><img src alt title><figcaption>caption</figcaption></figure>`；粘贴反序列化由 `fromHTML`(处理 `<figure>`/`<img>`)和 `fromMarkdown`(处理 `![]()`)贡献，并结合 `clipboard.ts` 中的文件粘贴(见 `view/clipboard.ts`)。

**交互。** 依赖 `types.ts`。由 `Registry.ts` 构建(每个扩展的 `serialize`/`deserialize` 针对其块类型注册)。携带于 `EditorRegistries.serializers` / `deserializers`。被 `Editor.ts`（`toMarkdown` 行反序列化 + `setDocFromMarkdown` 解析）和 `view/clipboard.ts`(粘贴时调用 `deserializers.parseMarkdownLine` 与 `parseHtmlElement`)使用。

**扩展点。** 块类型扩展提供 `serialize`(和用于从 Markdown 粘贴的 `deserialize`)。因为解析是首个匹配的管道，`flattenExtensions` 中的注册顺序决定优先级。`fromHTML` 是阶段 6 新增的钩子，使 `<img>` 等非文本元素能贡献图片块(以及后续的 `<table>`/`<details>` 等新块类型)。

## 编辑器门面

### `src/core/Editor.ts`

**职责。** `Editor` 门面：框架无关核心的公共表面。它拥有注册表、当前 `EditorState`、历史管理器、命令分发、插件生命周期，以及订阅/通知的扇出。在此强制核心不变量：状态变更只通过 `dispatch(transaction)`；插件通过带类型的钩子接收事件(视图层从不直接调用插件)。见 `docs/architecture.md` §10 和 §13。

**公共 API。**

```ts
interface EditorConfig {
  readonly extensions: readonly Extension[]
  readonly defaultBlockType?: string
  readonly initialDocument?: DocumentData
  readonly initialSelection?: Selection
  readonly editable?: boolean
  readonly historyLimit?: number
}
interface StateUpdate { readonly state: EditorState; readonly changed: ReadonlySet<BlockId>; readonly removed: ReadonlySet<BlockId> }
type EditorListener = (update: StateUpdate) => void

class Editor {
  readonly registries: EditorRegistries
  readonly commands: Record<string, (...args: unknown[]) => boolean>
  editable: boolean
  focusBlockId: BlockId | null               // 由视图层设置（聚焦的 contenteditable）
  constructor(config: EditorConfig)
  getState(): EditorState
  toData(): DocumentData
  setDocument(json: DocumentData): void      // 整体替换；重置历史；重新初始化插件
  toMarkdown(): string                       // 把当前文档导出为 Markdown 字符串
  setDocFromMarkdown(markdown: string): void // 用 Markdown 解析结果整体替换文档；重置历史
  dispatch(tr: Transaction): void            // 唯一的变更路径；记录历史；通知
  undo(): boolean
  redo(): boolean
  canUndo(): boolean
  canRedo(): boolean
  subscribe(listener: EditorListener): () => void
  handleKeyDown(event: KeyboardEvent): boolean
  handleInput(event: InputEvent): boolean
  handleCompositionStart(event: CompositionEvent): void
  handleCompositionEnd(event: CompositionEvent): void
  destroy(): void
}

function hasBlock(editor: Editor, id: BlockId): boolean  // 调试辅助
```

构造：运行 `buildRegistries`，注册原语命令，让扩展命令按名 `override`，构建文档(若根为空则播种一个空默认块)，初始化插件(`init`)，注册核心 `undo`/`redo` 命令(委托给 `HistoryManager`)，并构建命令代理。`dispatch` 运行 `applyTransaction`，把事务记录到历史，并通过差异通知订阅者。`setDocument` 重建状态并调用 `history.reset()`。

**交互。** 依赖 `store.ts`、`EditorState.ts`、`Transaction.ts`、`Registry.ts`、`primitiveCommands.ts`、`Command.ts`、`Plugin.ts`、`HistoryManager.ts`、`Selection.ts`、`ids.ts` 和 `types.ts`。视图层(`BlockEditor.vue`)构造它、订阅它、把键盘/输入/组合事件路由到它的 `handle*` 方法，并读取 `editor.commands` / `editor.registries` / `editor.focusBlockId`。

**扩展点。** 扩展是唯一的配置面(`EditorConfig.extensions` 加上 `defaultBlockType`/`historyLimit`)。`focusBlockId` 字段是视图层写入的契约，让插件(通过 `EventContext.focusBlockId`)知道哪个块被聚焦。未来的无头/服务端用法会直接构造 `Editor`，而不用 Vue 组件。

### `src/core/index.ts`

**职责。** 核心 barrel：框架无关引擎的公共表面。再导出核心模块的每个类型、函数和类，让视图层、扩展和消费者从单个路径导入。此 barrel 中的任何东西都不导入 Vue。

**公共 API。** 再导出自：`types`(全部类型 + 辅助函数)、`ids`(`createBlockId`、`asBlockId`)、`schema/BlockSchema`(`defineSchema`、`defaultAttrs`、`coerceAttrs`、`canContain`、`hasText`、`isIsolating`、`isEmpty`、`SchemaRegistry`)、`state/store`(全部)、`state/Step`(`Step`、`applySteps`、`ApplyResult`)、`state/EditorState`(`createState`、`applyTransaction`、`EditorState`、`ApplyTransactionResult`)、`state/Transaction`(`createTransaction`、`TransactionBuilder`、`Transaction`、`TransactionMeta`、`InsertBlockParams`)、`state/invert`(`invertSteps`)、`selection/Selection`(全部)、`command/Command`(类型 + `CommandRegistry`)、`command/primitiveCommands`(`createPrimitiveCommands`)、`command/Keymap`(类型 + `KeymapRegistry`、`keyNameFromEvent`、`keyMatches`)、`command/InputRule`(类型 + `InputRuleRegistry`)、`command/SlashCommand`(类型 + `SlashCommandRegistry`)、`serialize/Serializer`(类型 + 注册表)、`plugin/Plugin`(类型)、`extension/Extension`(类型 + `extensionBlockType`)、`extension/Registry`(`flattenExtensions`、`buildRegistries`、`EditorRegistries`、`RendererRegistry`、`ToolbarRegistry`、`BuildRegistriesOptions`)、`history/HistoryManager`(`HistoryManager`)和 `Editor`(`Editor`、`EditorConfig`、`StateUpdate`、`EditorListener`)。

**交互。** 被 `src/index.ts`(包入口)、视图层和扩展导入。

**扩展点。** 新增核心模块意味着在这里添加它的再导出；这是公开暴露新核心能力的唯一必须改变的文件。

## 视图层

### `src/view/context.ts`

**职责。** 视图层共享上下文和类型。通过 Vue 的 provide/inject(`editorKey` / `useEditor`)向子组件提供框架无关的 `Editor` 实例，并定义 `BlockRenderItem`——从 `BlockEditor` 传给 `BlockList` 的 DTO。编辑器作为非响应式值提供——需要对状态变化做出反应的组件通过 `editor.subscribe()` 订阅，让编辑器内部状态留在 Vue 响应式系统之外(避免大文档上的深度响应式开销)。见 `docs/architecture.md` §6.2。

**公共 API。**

```ts
const editorKey: InjectionKey<Editor>
interface BlockRenderItem { readonly id: BlockId; readonly block: Block }
function useEditor(): Editor  // 在 <BlockEditor> 树之外调用时抛出
```

`BlockRenderItem` 把 id 与 `block` 分开携带，以便 `BlockList` 能把它用作 `:key` 而无需深入 block 对象。该类型位于这里(而非 `.vue` 文件中)，因为 TypeScript 的 `*.vue` 模块垫片只声明默认导出，无法从 `.vue` 文件再导出具名类型。

**交互。** 依赖 `vue`(`InjectionKey`、`inject`)和 `core/Editor` + `core/types`(仅类型)。`BlockEditor.vue` 提供编辑器；`BlockHost.vue`、`BlockContent.vue` 以及与 `keymapHandler.ts` 相邻的使用者调用 `useEditor()`。

**扩展点。** 未来的 `useBlock(blockId)` composable(按块订阅，返回 `BlockSnapshot` 浅层 ref)会住在这里，恢复设计的按块订阅接缝(§13.1 指出阶段一不需要它)。

### `src/view/BlockEditor.vue`

**职责。** 公开的根编辑器组件。从扩展 + 初始文档构造 `Editor`，维护一个只在顶层触发 Vue 响应式的 `shallowRef<EditorState>`(无深度响应式)，向子组件提供编辑器，处理键盘事件(先同步 DOM 选择 → 状态，再分发键位映射命令)，应用状态选择变化 → DOM(在 `nextTick` 之后)，emit `update:modelValue`，并在挂载时聚焦第一个块。同时负责 i18n/主题：把 `locale`/`theme` props 标准化为响应式 ref，通过 `provideI18n()` 提供给子组件，并把主题 class 同步到 `<body>`，使通过 `<Teleport>` 渲染的弹出层能继承 CSS 变量。**阶段 6 新增职责：(1)** 显式处理 `Mod+K` 链接快捷键——为当前选区打开链接浮层的编辑模式，或若光标位于已有 link mark 内则打开查看模式；**(2)** 持有 `<LinkPopover>` 的挂载与状态(view/edit 模式、目标 link 范围、来自 `LinkClickEvent` 或原生选择矩形的锚点坐标)；**(3)** 暴露 `uploadImage` prop 作为可选的外部上传钩子(S3/OSS 等)；未提供时回退到 `imageUpload.ts` 中内置的 mock 上传器；**(4)** 在每次 `applyTransaction` 的订阅回调中扫描 diff 的 changed+removed 块，检查它们 `fileId` attr 的前后值、维护每个 `fileId` 的引用计数，在一个 `fileId` 的引用数从 ≥1 降到 0 时 emit `cleanup:image-file`(宿主可在此回收未引用的存储对象)。见 `docs/architecture.md` §6.1、§6.2、§14(阶段 6)。

**公共 API(Props/Emits/Expose)。**

```ts
props: {
  extensions?: readonly Extension[]        // 默认 BuiltinExtensions（14 个扩展，含 Image/Table/Divider/Equation/TableOfContents）
  modelValue?: DocumentData                // 默认 { blocks: [] }
  editable?: boolean                       // 默认 true
  placeholder?: string                     // 默认 locale 感知（"输入文字，或按 '/' 获取命令…" / "Type '/' for commands…"）
  theme?: 'light' | 'dark'                 // 默认 'light'
  locale?: 'zh-CN' | 'en-US'               // 默认 'zh-CN'；任何非空非 'zh-CN' 值 ⇒ 'en-US'
  // —— 尺寸约束(可选)：数字按 CSS 像素解析；字符串原样使用 ——
  width?: string | number                  // 默认 undefined（填满容器）
  height?: string | number                 // 默认 undefined（随内容生长，宿主页面滚动）
  // —— 工具栏位置(FixedToolbar)：'auto' = 桌面端顶栏/移动端底栏。
  //    'float'（仅桌面端）隐藏 FixedToolbar，改用跟随文本选区的浮动 HoverToolbar；
  //    移动端回退为 'auto' ——
  toolbarPosition?: 'auto' | 'top' | 'bottom' | 'float'    // 默认 'auto'
  // —— 图片上传钩子(可选；见 src/view/imageUpload.ts) ——
  uploadImage?: (file: File, ctx: {
    blockId: BlockId
    onProgress(percent: number): void
  }) => Promise<{
    src: string
    fileId?: string
    alt?: string
    title?: string
    caption?: string
    width?: number
    height?: number
  }>
}
emits: {
  'update:modelValue': [DocumentData]
  // —— 阶段 6：fileId 清理(宿主应用删除未引用的存储对象) ——
  'cleanup:image-file': [{ fileId: string }]
}
expose: { editor: Editor }
```

`suppressSelectionSync` 标志防止反馈循环：当 DOM 选择被读取并分发到状态时，订阅回调绝不能把它写回 DOM。`renderItems` 是一个把 `doc.root` → `BlockRenderItem[]` 映射的 `computed`。`onKeyDown` 调用 `syncSelectionFromDom()`(把原生选择读入状态，带 `addToHistory: false`)，然后 `dispatchKeymap`；若已处理，则 `preventDefault()`。`Mod+K` 在 `BlockEditor.vue` 自身内部处理(而不走 keymap 注册表)，因为它需要桥接选择状态、link mark 和浮动 UI——纯 keymap 命令无法打开浮层。

**交互。** 导入 `vue`、`core/Editor`、`core/extension/Extension`、`core/types`、`core/state/EditorState`、`core/state/Transaction`、`view/context`(`editorKey`、`BlockRenderItem`)、`view/keymapHandler`(`dispatchKeymap`)、`view/domSelection`(`readDomSelection`、`applySelectionToDom`)、`view/inlineDom`、`view/clipboard`、**`view/imageUpload`**(订阅/取消订阅瞬时上传状态、持有 `fileId → 引用计数` map、调用 `uploadImage` prop 或 mock)、**`view/urlUtils`**(`sanitizeUrl` 用于链接浮层保存路径的 href 校验)、`i18n`(`provideI18n`、`useI18n`、`normalizeLocale`、`normalizeTheme`)以及 `BlockList.vue` + 8 个弹出组件(`PlusMenu`、`BlockSettingsMenu`、`HoverToolbar`、`OrderedListMenu`、`NumberPicker`、`CodeLangPicker`、**`LinkPopover`**)。订阅编辑器；卸载时取消订阅、从 `imageUpload` 撤销所有未完成的临时对象 URL，并调用 `editor.destroy()`。

**扩展点。** 此组件是唯一的响应式边界(设计的 `ViewBridge` 被并入其中——§13.1)。若视图层增长，可以在不改核心的情况下抽取桥接。虚拟化列表替换只替换 `BlockList`。`theme`/`locale` props 通过 provide/inject 流转，使所有子组件(包括通过 `<Teleport>` 渲染的弹出层)都能响应式地访问 `t(key)`。

### `src/view/BlockList.vue`

**职责。** **递归**渲染一个块列表：渲染每个块后再为它的 `children` 递归渲染自身（包在带独立缩进的 `.block-children` 容器里），使整棵嵌套树以正确的树状缩进显示。阶段一渲染一个扁平列表(`doc.root`)；权威的嵌套结构来自 `Block.children`(`DocState.parent`)，`attrs.indent` 只是其衍生镜像。当作为嵌套列表(`is-nested`)时，会禁用仅属于根列表的下拉指示器和首块占位符。使用 `:key="item.id"`，让 Vue 跨重渲染复用组件实例；因为 block 对象保持引用同一性(结构共享)，未变化的块不会触发 `BlockHost` 重渲染。这是**虚拟化接缝**——决定哪些块被挂载的唯一组件；虚拟化实现以后可以无缝替换，而不触碰块组件。见 `docs/architecture.md` §6.1、§12。

**公共 API(Props)。**

```ts
props: {
  items: readonly BlockRenderItem[]
  blocksMap: ReadonlyMap<BlockId, Block>   // 完整块视图；嵌套列表据此解析子块快照
  firstBlockPlaceholder?: string           // 只在第一个(根)块上显示
  isNested?: boolean                       // 为 true 表示为递归渲染的子列表
  hoveredBlockId: BlockId | null           // 转发，使手柄正确显示/隐藏
  focusedBlockId: BlockId | null
  hasTextSelection?: boolean
  draggingBlockId?: BlockId | null
  dropTargetBlockId?: BlockId | null
  dropPosition?: 'before' | 'after' | 'first' | 'last' | 'into'
  menuOpenBlockId?: BlockId | null
}
```

所有 props 和事件都会原样转发给递归渲染的嵌套列表，使树中的每个 `BlockHost` 都参与同一套 hover / 拖拽 / 放置 / 选区 / 菜单系统。

**交互。** 导入 `BlockHost.vue` 和 `view/context`(`BlockRenderItem`)。由 `BlockEditor.vue` 渲染。把每个 `block`(以及第一个块的占位符)传给 `BlockHost`。

**扩展点。** `VirtualizedBlockList` 可以替换此组件而不触碰 `BlockHost` 或块渲染器——块组件被保持无副作用且幂等，因此虚拟化是安全的(§12)，递归的嵌套列表复用同样的 `BlockRenderItem` 形状。

### `src/view/BlockHost.vue`

**职责。** 解析块类型的渲染器组件并渲染它。这是扩展系统(它注册渲染器)与视图层之间的桥梁：它查找该块类型的 `BlockRendererSpec`，动态渲染关联的 Vue 组件，把 `block` 作为 prop 传入。若没有注册渲染器，它直接回退到 `BlockContent`。此外它监听从 `BlockContent`(或渲染行内 `<a>` 的扩展渲染器)冒泡上来的 `linkClick` 事件，并向上重新 emit，使单一的 `BlockEditor` 实例能集中打开链接浮层，而无需每个块渲染器都注册自己的监听器。见 `docs/architecture.md` §6.1 和阶段 6。

**公共 API(Props/Emits)。**

```ts
props: { block: Block; placeholder?: string }
emits: { 'linkClick': [{ blockId: BlockId; href: string; from: number; to: number; clientRect: { left: number; top: number; right: number; bottom: number } }] }
```

`resolvedComponent` 是一个 `computed`，它读取 `editor.registries.renderers.get(block.type)` 并把不透明的 `component` 转换为 Vue `Component`——视图层解释框架无关 spec 的唯一边界。宿主把渲染器包裹在一个带 `data-block-type` 的 `.block-host` div 中。

**交互。** 导入 `vue`(`computed`、`Component`)、`core/types`、`view/context`(`useEditor`)和 `BlockContent.vue`(回退)。由 `BlockList.vue` 渲染；渲染扩展提供的组件(例如 `ParagraphBlock`、`HeadingBlock`)，它转而又渲染 `BlockContent`。此处转发的 `linkClick` 事件由 `BlockEditor.vue` 消费，以把 `LinkPopover` 定位在被点击的 `<a>` 上方。

**扩展点。** 新块类型只需通过其扩展注册一个渲染器；`BlockHost` 无需改代码就能解析它(Resolver 无需改动)。未来的 `nodeView` 工厂(用于 Database 等完全自定义的交互块)也会在这里解释。

### `src/view/BlockContent.vue`

**职责。** 按块的 contenteditable 组件——视图层最精细的部分。拥有单个 `contenteditable` 元素，负责：把块的行内内容作为 DOM 文本*(含 mark spans,其中 link mark 走 <a>,且 href 已由 inlineDom.ts 净化)* 渲染(挂载时和外部状态变化时)，通过 `setText` 命令把用户输入同步回状态，正确处理 IME(CJK)组合(组合期间不同步；DOM 是唯一来源)，跟踪焦点，以及为空时显示占位符。**阶段 6 link 新增特性：** 检测点击行内 `<a>` 后代并 emit `linkClick`，使 `BlockEditor.vue` 能以精确的点击矩形锚定浮层；空格/分词触发 URL 自动链接(用户在看起来像 URL 的文本后打空格，把当前 seq 交给 `autoLinkInlineSeq` 处理再调用 `setText`)；选中文本区粘贴纯文本 URL 时走链接化的粘贴路径。关键不变量：用户在键入时，它绝不向 DOM 写文本(`skipDomWrite` 事务 meta + `textContent !== newText` 守卫保护光标)。见 `docs/architecture.md` §6.3 和阶段 6。

**公共 API(Props/事件)。**

```ts
props: { block: Block; placeholder?: string }
// DOM: contenteditable="true", data-block-id, data-empty, data-placeholder
// 事件： @input， @compositionstart， @compositionend， @focus， @blur
// emits: 'linkClick' ({ blockId, href, from, to, clientRect })
```

在 `input` 上(组合之外)它先把 `autoLinkInlineSeq(newSeq)` 应用到用户刚键入完的 URL，然后分发 `editor.commands.setText({ id, content: seq })`——`setText` 携带 `historyGroup('type')` 和 `skipDomWrite([id])`，因此视图桥接不会写回聚焦元素。在 `compositionend` 上它分发一次 `setText`。`onFocus`/`onBlur` 设置/清除 `editor.focusBlockId`。一个对 `props.block` 的 `watch` 只在文本不同且块未在组合时把新文本写入 DOM。点击：contenteditable 的 `onClick` 走 `event.target.closest('a')`；若找到则计算这个 `<a>` 在块当前行内序列中的模型偏移，并携带点击包围矩形 emit `linkClick`，以便浮层定位。

**交互。** 导入 `vue`、`core/types`(`inlineText`、`inlineFromString`)、**`view/urlUtils`(`autoLinkInlineSeq`)** 和 `view/context`(`useEditor`)。由 `BlockHost.vue` 渲染(并作为回退直接渲染)。读/写 `editor.focusBlockId`；调用 `editor.commands.setText`。`data-block-id` 属性是 `domSelection.ts` 用来把 DOM 节点映射到块 id 的。粘贴：规范路径由 `BlockEditor.vue` 通过 `clipboard.ts`(见对应模块条目)执行，可升级为 link mark 设置。

**扩展点。** 当新的行内 marks 或非文本行内原子(mention、公式)到达时，此组件通过同一套 `inlineDom.ts` 管线渲染它们(已经能处理 mark spans)；这里不需要额外改动。IME 防护契约和 `skipDomWrite` meta 是富文本渲染期间保持光标放置正确的稳定接缝。

### `src/view/domSelection.ts`

**职责。** DOM 选择 ↔ 编辑器状态选择的同步。原生浏览器选择操作 DOM 节点/range；编辑器的模型操作块 id + 字符偏移。此模块弥合两者。阶段一策略(扁平块、仅文本内容)：每个 contenteditable 携带 `data-block-id`；字符偏移通过遍历文本节点计算；同步是**即时(just-in-time)**的(分发命令前读取，状态更新后写入)——它*不*监听 `selectionchange`(太嘈杂，会产生反馈循环)。见 `docs/architecture.md` §8.2。

**公共 API。**

```ts
function findBlockEl(root: HTMLElement, id: BlockId): HTMLElement | null
function readDomSelection(root: HTMLElement, doc: DocState): Selection | null
function applySelectionToDom(root: HTMLElement, selection: Selection): void
```

`readDomSelection` 从选择的末端节点向上走，找到最近的 `[data-block-id]` 祖先，通过把一个 range 克隆到元素起点来计算光标偏移，把它钳位到块的文本长度，并返回一个 `caret`(或在单块内非折叠时返回单块 `text` 选择)。`applySelectionToDom` 聚焦目标块的元素，并通过 `setCaretInElement`(遍历文本节点找到偏移，回退到内容末尾)放置光标。块选择尚未处理(阶段五)。

**交互。** 依赖 `core/types`(`BlockId`、`Selection`、`DocState`、`inlineText`)和 `core/selection/Selection`(`caretSelection`、`isCaret`、`isText`)。被 `BlockEditor.vue` 使用(`syncSelectionFromDom` 中的 `readDomSelection`、挂载时和订阅回调中的 `applySelectionToDom`)。`data-block-id` 属性由 `BlockContent.vue` 写入。

**扩展点。** 多块文本选择(阶段五)扩展 `readDomSelection` 以返回跨块的 `text` 选择，`applySelectionToDom` 以设置跨越块的 DOM `Range`。块选择渲染(`BlockHost` 上的 CSS 类)是另一个关注点，会读取 `isBlocks(selection)`。

### `src/view/inlineDom.ts`

**职责。** 在 `InlineSeq` 模型(带可选 marks 的文本运行)与 DOM 之间架桥。把行内序列转换为 HTML 以供渲染(通过 `inlineToHtml`)，并把 DOM 节点解析回行内序列(通过 `inlineFromDom`)。被 `BlockContent.vue` 用于渲染，也被 `clipboard.ts` 用于粘贴解析。**阶段 6(links)：** `inlineToHtml` 把 `link` mark 渲染为 `<a href="…">`——**href 始终由 `urlUtils.ts` 的 `sanitizeUrl()` 管道处理**，所以危险的协议(`javascript:`、`data:`、`vbscript:`)和混淆的 URL 绝不可能进入 DOM(它们渲染为无 href 的普通 `<span>`)。反之，`inlineFromDom` 收集 `<a href>` 属性并转换回 `{ type: 'link', attrs: { href: normalizeUrl(rawHref) } }` marks。

**公共 API。**

```ts
function inlineToHtml(content: InlineSeq): string
function inlineFromDom(node: Node, opts?: { trim?: boolean }): InlineSeq
```

`inlineToHtml` 把每个 mark 类型映射为其语义 HTML 标签(`<b>`、`<i>`、`<u>`、`<s>`、`<code>`、**`<a href=sanitizeUrl(attrs.href)>` 用于 link**),并应用颜色/背景色 class。`inlineFromDom` 遍历 DOM 文本节点和元素子节点,重建带 marks 的 `InlineSeq` 片段。

**交互。** 依赖 `core/types`(`InlineSeq`、`InlineNode`、`Mark`)和 **`view/urlUtils`(`sanitizeUrl`、`normalizeUrl`)**。被 `BlockContent.vue`(渲染)、`clipboard.ts`(粘贴)和 `BlockEditor.vue`(复制/剪切事件处理)使用。

### `src/view/clipboard.ts`

**职责。** 用于复制/剪切/粘贴的剪贴板解析。把粘贴的 HTML 或纯文本转换为 `ParsedBlock[]`(块类型 + attrs + 行内内容)，并把编辑器块序列化为干净的 HTML/纯文本以供剪贴板。剥离仅含空白的文本节点、按块修剪前导/尾随空白(非 code)、避免多余换行。**阶段 6 新增：**(1)若粘贴的 `clipboardData.files` 含图片类型(`image/png`、`image/jpeg` …)→ 返回一个特殊的 `type='image'` 的 `ParsedBlock`，携带瞬时 `_pendingFile` 字段(绝不写入 attrs；交给 `imageUpload.ts` 上传)——`BlockEditor.vue` 中的粘贴路径会为每个文件插入一个新图片块并启动上传。(2)若粘贴的 HTML 包含 `<img>`(单独或在 `<figure>` 内)，返回带 `attrs.src` 的图片块。(3)用户有非空文本选择且粘贴看起来像 URL 的纯文本 → 返回结构化提示 `{ wrapSelectionInLink: true, href }`，然后 `BlockEditor.vue` 分发 `setLink` 而非粘贴文本。(4)包含 URL 的纯文本剪贴板段落会走一遍 `autoLinkInlineSeq`，因此粘贴"访问 https://example.com"会自动变成链接。

**公共 API。**

```ts
interface ParsedBlock {
  type: BlockType
  attrs?: Attrs
  content: InlineSeq
  // —— 阶段 6 瞬时字段，绝不写入 DocState ——
  readonly _pendingFile?: File          // 剪贴板图片文件(走 imageUpload 管线上传)
}
interface PasteDecision {
  blocks?: ParsedBlock[]
  wrapSelectionInLink?: { href: string } // 非空选择 + URL 文本粘贴
}

function parseClipboardHtml(html: string): ParsedBlock[]
function parseClipboardText(text: string): ParsedBlock[]
function blocksToClipboardHtml(blocks: readonly Block[]): string
function blocksToClipboardText(blocks: readonly Block[]): string
```

**交互。** 依赖 `core/types`(`Block`、`InlineSeq`)、`view/inlineDom`(`inlineFromDom`、`inlineToHtml`)、**`view/urlUtils`(`looksLikeUrl`、`autoLinkInlineSeq`)**。被 `BlockEditor.vue` 的 `onCopy`/`onCut`/`onPaste` 处理器使用，后者拦截剪贴板事件、写入干净的数据模型 HTML/文本，并对上述阶段 6 的特殊情况分发图片块插入或 link mark 设置。

**扩展点。** 自定义块类型可以通过 `Extension.deserialize` 贡献反序列化器，以处理类型专属的粘贴(例如把 `<pre>` 解析为 `codeBlock`)。

### `src/view/imageUpload.ts`

**职责。** 图片块上传状态的瞬时侧信道。块模型的 `attrs` 只存储应该在保存/撤销/重做之间持久化的字段(`src`、`fileId`、`alt`、`title`、`caption`、`width`、`height`)；每块的上传状态、进度百分比、错误、临时对象 URL(`tempSrc`)是**只在运行期存在**的，只活在这里。本模块同时是 `uploadImage` prop(外部)与内置 mock 上传的唯一解析地。

**公共 API。**

```ts
type UploadStatus = 'idle' | 'uploading' | 'done' | 'error'
interface ImageUploadState {
  readonly status: UploadStatus
  readonly progress: number        // 0..100
  readonly error?: string
  readonly tempSrc?: string       // URL.createObjectURL(file); done/error 时 revoke
}

interface ImageUploadStore {
  readonly state: Readonly<Record<string, ImageUploadState>> // key = blockId
  subscribe(blockId: BlockId, cb: (s: ImageUploadState) => void): () => void
  beginUpload(blockId: BlockId, file: File, handlers: {
    onProgress(pct: number): void
    resolve(result: { src: string; fileId?: string; alt?: string; title?: string; caption?: string; width?: number; height?: number }): void
    reject(err: Error): void
  }): void
  retry(blockId: BlockId): void        // 重试缓存的 file;若无缓存则拒绝
  cancel(blockId: BlockId): void       // revoke temp URL, 清状态
  clearBlock(blockId: BlockId): void   // 块被移除/替换时调用
}

export const imageUploadStore: ImageUploadStore
export function setUploadHook(hook: any): void  // 对应 BlockEditor 的 uploadImage prop
```

若未提供 `uploadImage` prop，使用内置的 mock 上传器：等待 800–2500 ms，发出假进度 tick，约 30% 概率 reject——这样重试/错误 UI 可以在无后端的情况下开发测试。在 `beginUpload` 时创建 `tempSrc` 对象 URL 并推入状态，使 `Image.ts` 能立即显示；`resolve` 时调用者(BlockEditor)分发 `setAttrs` 以写入真实的 `src`/`fileId`，然后调用 `cancel(blockId)` 回收。`reject` 时保留错误字符串 + 缓存的 `File`，以便用户点击图片遮罩上的 **Retry** 按钮。

**交互。** 只依赖 `core/types`(获取 `BlockId` 品牌)。被 `BlockEditor.vue` 使用(当 prop 改变时调用 `setUploadHook`)，并在每次图片块插入 + 附带文件时调用 `beginUpload`，resolve 后分发 attrs 事务；当 fileId 引用数归零时 emit `cleanup:image-file`。`extensions/Image.ts` 渲染器订阅 `state[blockId]` 以驱动进度条、错误横幅和重试按钮。

**扩展点。** 外部宿主可以提供自己的 `uploadImage` prop(带签名 URL 的 S3 上传、OSS 等)而无需修改本模块。此处的瞬时状态模式可推广到其他需要异步副作用但绝不能持久化中间态的块类型(例如附件上传、Embed 的 oEmbed 元数据抓取)。

### `src/view/urlUtils.ts`

**职责。** 每个与链接相关的路径都会调用的 URL 工具。提供三个相关但独立的关注点：(a)启发式检测("这段文本看起来像 URL 吗?")、(b)规范化(缺省时补 `https://`、修剪尾随标点)、(c)**安全净化**，对危险的 URL 返回空串——以便调用者安全地省略 `href` 而不是渲染带毒的锚点。还暴露 `autoLinkInlineSeq`，它扫描一个 `InlineSeq` 寻找看起来像 URL 的文本运行，并自动加上 `link` mark。典型调用点是 `BlockContent.vue`(键入空格触发自动链接)和 `clipboard.ts`(粘贴纯文本段落)。

**公共 API。**

```ts
function looksLikeUrl(text: string): boolean
function normalizeUrl(text: string): string
function sanitizeUrl(raw: string): string  // 不安全/缺失 scheme 返回 ""

// InlineSeq 变换器： 不带 'link' / 'code' mark 的文本 run → 在 URL 边界拆分
// 并把 URL 片段包在 {type:'link', attrs:{ href: sanitizeUrl(match) }} mark 中。
// 若无匹配则原样返回。
function autoLinkInlineSeq(seq: InlineSeq): InlineSeq
```

`looksLikeUrl` 匹配：绝对 schemes `https?://`、`mailto:`、`tel:`;裸 `www.` 前缀(→ 规范化为 `https://www.`);匹配 `user@domain.tld` 的邮箱(→ 规范化为 `mailto:user@domain.tld`)。它刻意避免在 `code` mark 内部匹配任何东西。`sanitizeUrl` 只把 `http https mailto tel` 加入白名单、移除 URL 中段的 `\t\n\r`、拒绝含有非 ASCII 字母的 scheme、去除空白——结果要么为空，要么保证拥有白名单 scheme 且没有显见的混淆。调用者守则:**如果 `sanitizeUrl` 返回 `""`，就当作链接没有 href**(不要写 `href` 到 DOM)。

**交互。** 只依赖 `core/types`(`InlineSeq`、`InlineNode`、`Mark`)。被 `primitiveCommands.ts`(`setLink` 净化 href)、`inlineDom.ts`(渲染)、`clipboard.ts`(URL 粘贴检测 + 自动链接)、`BlockContent.vue`(空格触发的自动链接)、`LinkPopover.vue`(onSave 校验 href + 展示净化后的 URL)、`BlockEditor.vue`(Mod+K 保存路径) 使用。

### `src/view/ui/LinkPopover.vue`

**职责。** 浮动浮层(`<Teleport>` 到 `<body>`)，让用户能查看/编辑/移除链接，类似 Notion/Google Docs。有两种模式：`view` 和 `edit`。显示时锚定到一个原生 DOM 矩形——要么是用户当前文本选择的 `getBoundingClientRect()`，要么是被点击的已有 `<a>` 元素的矩形。浮层由 `BlockEditor.vue` 命令式控制——持有 `mode`、`href`、`text`、`blockId`、`from`、`to`、`anchorRect` refs——此组件纯展示，emit `open-link`、`copy-link`、`edit`、`remove`、`save({ href, text })` 和 `cancel` 事件。

**公共 API(Props/Emits)。**

```ts
props: {
  visible: boolean
  mode: 'view' | 'edit'
  href: string                    // 当前已净化的 href
  text: string                    // 当前可见链接文本(供编辑副本使用)
  anchor: { left: number; top: number; right: number; bottom: number } | null
}
emits: {
  'open-link': [string]           // 打开外部 URL。浮层也渲染自己的安全
                                  // <a target="_blank" rel="noopener noreferrer">，中键/右键都能工作；
                                  // 该 emit 用于统计。
  'copy-link': [string]           // → BlockEditor 把 href 写入剪贴板 + 显示 toast
  'edit': []                      // 切到 'edit' 模式
  'remove': []                    // → editor.commands.unsetLink
  'save': [{ href: string; text?: string }]
  'cancel': []
}
```

在 `view` 模式下渲染：可点击的 `<a :href="sanitizeUrl(currentHref)">`(显示 URL)，以及四个按钮(打开、复制链接、编辑链接、删除链接)。在 `edit` 模式下渲染两个输入：`href`(占位符 `https://…`、blur 时通过 `normalizeUrl` 自动规范化)和 `text`(可选，默认值是当前链接文本，用户可改写)。当 `sanitizeUrl(hrefInput.value) === ''` 时，保存按钮禁用。浮层使用 `view/ui/popup.ts` 的辅助在溢出视口时上下翻转。

**交互。** 导入 `vue`、`view/urlUtils`(`sanitizeUrl`、`normalizeUrl`)、`i18n`(`useI18n`)。渲染在 `BlockEditor.vue` 的 template 中(通过 `<Teleport>` 到 body)。事件由 `BlockEditor.vue` 处理：`edit` → 切模式；`remove` → `editor.commands.unsetLink` 然后隐藏；`save({ href, text })` → `editor.commands.setLink({ id, href, from, to, text })` 然后隐藏；`copy-link` → `navigator.clipboard.writeText(href)`；`cancel` / Escape → 隐藏。

**扩展点。** 相同的浮层形态可复用来编辑任何带属性的 mark(例如选择自定义颜色、编辑 mention 目标)，只需泛化 props。但保持为专用组件能让链接 UX 行为精确且易于审计。

### `src/view/ui/FixedToolbar.vue`

**职责。** 在**桌面端和移动端**都常驻的操作栏——替代原先仅用于移动端的 `MobileToolbar`。通过 `toolbarPosition` prop 控制放置位置：
- `'auto'`（默认）：桌面端顶栏、移动端底栏（通过 `visualViewport` API 始终显示在虚拟键盘之上；使用 `env(safe-area-inset-bottom)` 适配 iPhone 主屏指示条）。
- `'top'`：强制顶栏。PlusMenu / BlockSettingsMenu 等菜单改为**向下**弹出。
- `'bottom'`：强制底栏。菜单改为**向上**弹出。
- `'float'`：**仅桌面端**——隐藏 FixedToolbar，改由 `BlockEditor.vue` 渲染一个独立的浮动 `HoverToolbar`（Teleport 到 `<body>`，跟随文本选区）。在移动端（`(pointer: coarse)`）下 `'float'` 会回退为 `'auto'`。

内嵌一个 **inline 的** `<HoverToolbar>` 实例（而不是作为浮动叠加层渲染），这样用户点击格式化按钮时可以**保留文本选区状态**。左侧：plus 按钮（打开 `PlusMenu`）和 grip 按钮（打开 `BlockSettingsMenu`）。右侧：完整的 `HoverToolbar` 按钮集（类型 / 对齐 / 标记 / 颜色 / 复制 / 表格操作 / 链接操作）。它对外提供两个注入键，供下游菜单决定弹出方向：
- `fixedToolbarBottomKey: Ref<boolean>` — 当工具栏被钉在底部时为 `true`。
- `fixedToolbarBridgeKey: Ref<FixedToolbarDescriptor | null>` — 传递给内嵌的 HoverToolbar，告知当前需要展示哪个块类型/属性的动作。

**交互。** 导入 `vue`、`HoverToolbar.vue`、`i18n`（`useI18n`）和 `view/context`（`useEditor`、`fixedToolbarBridgeKey`、`fixedToolbarBottomKey`）。**条件**渲染在 `BlockEditor.vue` 的 template 中：当桌面端 `toolbarPosition='float'` 时跳过该组件（改为渲染浮动 `HoverToolbar`；移动端 `'float'` 回退为 `'auto'`，仍渲染 FixedToolbar）。发出的事件由 `BlockEditor.vue` 连接到与桌面端 `BlockHandle.vue` 相同的 `onOpenPlusMenu` / `onOpenSettingsMenu` 处理器。当表格单元格获得焦点时，`TableBlock` 通过 `fixedToolbarBridgeKey` 注入键发布描述符，使内嵌的 `HoverToolbar` 反映单元格/表格状态而非文本块状态。

**扩展点。** 工具栏描述符来源可通过 `fixedToolbarBridgeKey` 注入键插拔，未来具有自定义选区状态的块类型（如数据库块）可以向固定工具栏注入自己的动作，无需修改 `FixedToolbar.vue`。位置自动检测逻辑被封装在组件内部，外部调用方只需通过 `toolbarPosition` prop 就能覆盖行为。

### `src/view/keymapHandler.ts`

**职责。** 键盘事件路由器：针对键位映射注册表解析 `KeyboardEvent`，并分发绑定的命令。选择同步(DOM → 状态)由调用方(`BlockEditor.vue`)*在*调用此函数*之前*处理，因此命令收到最新的选择。见 `docs/architecture.md` §11.1。

**公共 API。**

```ts
function dispatchKeymap(editor: Editor, event: KeyboardEvent): boolean
```

若绑定匹配且命令返回 `true`(已处理)，则返回 `true`；调用方应在此时 `preventDefault()`。流程：`keyNameFromEvent(event)` → `editor.registries.keymap.resolve(key)` → `editor.commands[binding.command](binding.args)`。

**交互。** 依赖 `core/Editor` 和 `core/command/Keymap`(`keyNameFromEvent`)。被 `BlockEditor.vue` 的 `onKeyDown` 在 `syncSelectionFromDom` 之后调用。

**扩展点。** 解析顺序(注册表优先级排序)由 `KeymapRegistry` 拥有；此处理器刻意保持琐碎，这样未来按类型或块选择的键位映射层可以通过注册更低优先级的绑定来插入，而无需改变路由器。未来的 `blocks` 选择键位映射分支(§11.1)会在这里或 `BlockEditor.vue` 中、调用 `dispatchKeymap` 之前添加。

## 内置扩展

### `src/extensions/Paragraph.ts`

**职责。** Paragraph 块类型扩展——默认为文本块。注册 `"paragraph"` 块类型，带 `content: 'text'`、可嵌套的 schema(paragraph 可以做父，因此任何块都能缩进到它下面)，和一个简单的渲染器(`ParagraphBlock`)，它用一个 `block-paragraph` CSS 类包裹 `BlockContent`。Paragraph 是当用户在一个空块上按 Enter 或退出非文本块时使用的回退块类型。见 `docs/architecture.md` §11.2(默认块类型)。

**公共 API。**

```ts
export const ParagraphExtension: Extension
// schema: { type: 'paragraph', content: 'text', nestable: true }
// renderer: { component: ParagraphBlock }
```

`ParagraphBlock` 是一个 `defineComponent`，它渲染 `h(BlockContent, { block, placeholder, class: 'block-paragraph' })`。

**交互。** 导入 `vue`、`core/extension/Extension`、`core/types` 和 `view/BlockContent.vue`。捆绑于 `builtin.ts`。它的 schema 由 `Registry.ts` 注册；它的渲染器由 `BlockHost.vue` 解析。`Editor.ts` 在没有配置时用 `'paragraph'` 作为 `defaultBlockType`。

**扩展点。** 用户可以通过传入 `name: 'paragraph'` 的扩展覆盖 Paragraph(`flattenExtensions` 中后者胜出)。未来的 markdown 快捷键(`# ` → heading)会把 Paragraph 保留为"你要退入其中的"默认块。

### `src/extensions/Heading.ts`

**职责。** 用于 h1–h6 的 Heading 块类型扩展。`level` attr(1–6，已校验)决定视觉大小；渲染器(`HeadingBlock`)用 `block-heading block-heading-h${level}` CSS 类包裹 `BlockContent`。heading schema 是 `nestable: true`(标题可以做父)。Markdown 快捷键(`# `、`## `、……)和斜杠菜单条目由本扩展贡献。

**公共 API。**

```ts
export const HeadingExtension: Extension
// schema: { type: 'heading', content: 'text', nestable: true,
//   attrs: { level: { default: 1, validate: v => typeof v === 'number' && v >= 1 && v <= 6 } } }
// renderer: { component: HeadingBlock }
```

`HeadingBlock` 读取 `block.attrs.level ?? 1` 并渲染 `h(BlockContent, { block, placeholder, class: \`block-heading block-heading-h${level}\` })`。

**交互。** 导入 `vue`、`core/extension/Extension`、`core/types` 和 `view/BlockContent.vue`。捆绑于 `builtin.ts`。它的 `level` attr 校验由 `coerceAttrs`/`SchemaRegistry.coerceAttrsFor` 执行。`BlockHost.vue` 解析它的渲染器。

**扩展点。** 这是任何带判别 attr 的文本块类型的模板：声明 schema(带 `validate`)，提供一个读取 `attrs` 的渲染器，以及添加一个输入规则(`/^#{1,6} $/`)和一个斜杠命令。无需核心改动。

### `src/extensions/BulletList.ts`

**职责。** 项目符号列表块类型扩展。通过 CSS `::before` 在 `.block-bullet-list` 上渲染 `•` 标记，`BlockContent` 作为可编辑文本区域。支持通用属性(align/color/bgColor/indent)。

**公共 API。**

```ts
export const BulletListExtension: Extension
// schema: { type: 'bulletList', content: 'text', nestable: true,
//   attrs: COMMON_ATTRS }
// renderer: { component: BulletListBlock }
```

**交互。** 导入 `vue`、`core/extension/Extension`、`core/types`、`view/BlockContent.vue` 和 `extensions/_commonAttrs`(`COMMON_ATTRS`、`classesFromAttrs`)。捆绑于 `builtin.ts`。Markdown 快捷键 `- ` 把段落转为项目符号列表。

### `src/extensions/OrderedList.ts`

**职责。** 有序列表块类型扩展。在**同一父级(兄弟列表)内**自动编号：该列表内连续的有序列表兄弟连续编号；中间出现非有序列表兄弟(或父级边界)则打断链条。若设置了 `attrs.startNumber`(正整数)，则为显式覆盖，会重新锚定编号；否则序号为 `上一个有序列表兄弟的序号 + 1`(若前一个兄弟不是有序列表则为 1)。由于计数器按兄弟列表隔离，不同父级下的嵌套列表各自从 1 独立编号。

**公共 API。**

```ts
export const OrderedListExtension: Extension
// schema: { type: 'orderedList', content: 'text', nestable: true,
//   attrs: { ...COMMON_ATTRS, startNumber: { default: null, validate: v => v == null || (Number.isInteger(v) && v >= 1) } } }
// renderer: { component: OrderedListBlock }
```

`OrderedListBlock` 渲染一个 flex 包装器，包含可点击的 `.ol-marker`(数字)和 `BlockContent`。点击标记打开 `OrderedListMenu`(继续 / 新开始 / 修改编号)。

**交互。** 导入 `vue`、`core/extension/Extension`、`core/types`、`view/BlockContent.vue`、`view/context`(`useEditor`)、`extensions/_commonAttrs` 和 `core/state/store`(`siblingList`、`indexOf`、`parentOf`)。`orderedListNumber()` 辅助函数在该块自己的兄弟列表内向后遍历计算序号。`docVersion` ref 在文档任意变更时触发重渲染，保持编号正确。

### `src/extensions/TodoList.ts`

**职责。** 待办列表块类型扩展。渲染一个复选框(`attrs.checked`)，勾选时给文本加删除线。支持通用属性。

**公共 API。**

```ts
export const TodoListExtension: Extension
// schema: { type: 'todoList', content: 'text', nestable: true,
//   attrs: { ...COMMON_ATTRS, checked: { default: false, validate: v => typeof v === 'boolean' } } }
// renderer: { component: TodoListBlock }
```

`TodoListBlock` 渲染一个 flex 包装器，包含复选框(切换时分发 `setAttrs`)和带 `todo-checked` 类的 `BlockContent`。

**交互。** 导入 `vue`、`core/extension/Extension`、`core/types`、`view/BlockContent.vue`、`view/context`(`useEditor`)和 `extensions/_commonAttrs`。Markdown 快捷键 `[] ` 把段落转为待办。

### `src/extensions/Quote.ts`

**职责。** 引用块类型扩展。渲染带左边框和斜体文本的引用块。支持 align/color/bgColor 但**不支持**缩进(使用 `COMMON_ATTRS_NO_INDENT`)。行内斜体通过 `disallowedMarks: ['italic']` 禁用。

**公共 API。**

```ts
export const QuoteExtension: Extension
// schema: { type: 'quote', content: 'text', nestable: false,
//   attrs: COMMON_ATTRS_NO_INDENT, disallowedMarks: ['italic'] }
// renderer: { component: QuoteBlock }
```

**交互。** 导入 `vue`、`core/extension/Extension`、`core/types`、`view/BlockContent.vue` 和 `extensions/_commonAttrs`(`COMMON_ATTRS_NO_INDENT`、`classesFromAttrs`)。Markdown 快捷键 `> ` 把段落转为引用。

### `src/extensions/CodeBlock.ts`

**职责。** 代码块扩展。标记为**隔离块**：Enter 插入换行(而非新段落)，空代码块在 offset 0 处按 Backspace 会删除块而不合并。仅支持 `language` attr(使用 `CODE_BLOCK_ATTRS` — 无 align/color/bgColor/indent)。渲染器切换为 `white-space: pre; font-family: monospace`。

**公共 API。**

```ts
export const CodeBlockExtension: Extension
// schema: { type: 'codeBlock', content: 'text', isolating: true,
//   attrs: { language: { default: 'plain', validate: v => typeof v === 'string' } } }
// renderer: { component: CodeBlock, editable: true }
```

`CodeBlock` 渲染一个 `.block-code-wrapper`，包含可点击的 `.block-code-lang` 标签(大写语言标记)和带 `block-code` 类的 `BlockContent`。点击语言标签打开 `CodeLangPicker`。

**交互。** 导入 `vue`、`core/extension/Extension`、`core/types`、`view/BlockContent.vue`、`view/ui/icons`(`ICON_CODE`)和 `extensions/_commonAttrs`(`classesFromAttrs`、`CODE_BLOCK_ATTRS`)。Markdown 快捷键 ```` ``` ````（可选后跟语言）把段落转为代码块。

### `src/extensions/Image.ts`

**职责。** Image 块类型扩展(阶段 6 新增)。注册 `"image"` 块类型，`content: 'none'`(无行内文本)，带持久属性(`src`、`alt`、`title`、`width`、`height`、`caption`、`fileId`)。瞬时上传状态(progress/error/tempSrc)存放在**侧信道** `view/imageUpload.ts`，绝不进入 attrs(避免把临时对象 URL 或错误消息序列化到 JSON/撤销)。图片渲染器订阅 `imageUploadStore[blockId]`，并据此显示本地 `tempSrc` 预览 + 线性进度条、错误横幅带 Retry，或完成后显示真实 `src`(若有 caption 则下方放 `BlockContent` caption 子块)。也注册 slash 命令 `/image`——插入占位图片块 + 打开文件选择器。

**公共 API。**

```ts
export const ImageExtension: Extension
// schema: {
//   type: 'image',
//   content: 'none',
//   attrs: {
//     src:        { default: '',  validate: v => typeof v === 'string' },
//     alt:        { default: '',  validate: v => typeof v === 'string' },
//     title:      { default: '',  validate: v => typeof v === 'string' },
//     width:      { default: undefined, validate: v => v === undefined || (typeof v === 'number' && v > 0) },
//     height:     { default: undefined, validate: v => v === undefined || (typeof v === 'number' && v > 0) },
//     caption:    { default: '',  validate: v => typeof v === 'string' },
//     fileId:     { default: undefined, validate: v => v === undefined || typeof v === 'string' },
//   },
// }
// renderer: { component: ImageBlock, editable: true }
// serialize: {
//   toMarkdown: (b) => '![' + alt + '](' + src + (title ? ' "'+title+'"' : '') + ')'
//                    + (caption ? '\n' + caption : ''),
//   toHTML:     (b) => '<figure><img src="esc(src)" alt="esc(alt)" title="esc(title)"'
//                    + optional(width/height) + ' />'
//                    + (caption ? '<figcaption>'+inlineToHtml(caption)+'</figcaption>' : '')
//                    + '</figure>',
// }
// deserialize: {
//   fromMarkdown: /^!\[(.*)\]\((\S+)(?: "(.+)")?\)/ → image + 可能的后续 caption 行合并
//   fromHTML:    (node, inlines) → node.tagName === 'FIGURE' 查找 inner <img> + <figcaption>
//                                  或 node.tagName === 'IMG' 直接读 attrs
// }
// slash: [{ name: 'image', label: t('slash.image'), icon: ICON_IMAGE, command: insertImageBlock }]
```

Image 渲染器(`ImageBlock`)渲染：一个 `<figure>`，内层是绝对定位的遮罩(上传中/错误时可见)叠在 `<img>` 上方，进度条 100–0%，错误时红色重试按钮。`fileId` attr 是可选的**外部存储标识**(S3 key、OSS object id 等)——`BlockEditor.vue` 维护每个 `fileId` 的引用计数，当一个 block 从文档中被删除/替换(事务 diff)且该 `fileId` 的引用从 ≥1 降到 0 时，emit `cleanup:image-file`，以便宿主应用删除存储对象。

**交互。** 导入 `vue`、`core/extension/Extension`、`core/types`、`view/context`(`useEditor`)、`view/BlockContent.vue`(用于可选 caption)、`view/imageUpload`(订阅瞬时状态 `imageUploadStore`)、`view/ui/icons`(`ICON_IMAGE`)和 `extensions/_commonAttrs`(`IMAGE_ATTRS`)。捆绑于 `builtin.ts`；默认 `BuiltinExtensions` 为 14 个扩展。粘贴路径：剪贴板文件 → `clipboard.ts` 返回 `_pendingFile` → `BlockEditor.vue` 分发 `insertBlock`(Image) → `imageUploadStore.beginUpload`(创建 `tempSrc` → 进度 tick → resolve/reject → `setAttrs({ src, fileId, alt, ... })` 或 `retry` 重新 begin)。

### `src/extensions/Table.ts`

**职责。** Table 块类型扩展——使用 **attrs storage** 模式的 `content: 'none'` 块：**所有表格数据**（网格 `cells`、`colWidths`、`rows/cols`、`headerRow`、合并覆盖状态）作为 `attrs` 字段存储，`Block.children` 保持 `[]`，因此核心从不触碰表格内容，事务/撤销/重做通过 `setAttrs` 正常工作。渲染器是自包含 Vue 组件（行选择条、列选择条、角部全选手柄、浮动操作栏、行/列间插入点），直接读取 `block.attrs` 计算 `TableAttrs`；全部 UI 交互通过 editor `commands` 代理（`tableInsert*` / `tableRemove*` / `tableMergeRect` / `tableSplitCellsInRect` / `tableSetColWidth` / **`tableToggleHeaderRow`** / `tableSetCellAttrs` / `tableSetCellMark` / `tableToggleCellMark` / `tableInsert`）路由到 `tableModel.ts` 纯函数 → `editor.commands.setAttrs({ id, attrs: next })`。代码块单元格 Enter 直接插入换行（记录 caret offset、DOM 插入 `\n`、`syncCellContent` 同步 attrs、`nextTick` 后按 offset+1 重置光标）。

**公共 API。**

```ts
export const TableExtension: Extension
// name: 'table'
// schema: { content: 'none', nestable: false, attrs: TABLE_ATTRS_SCHEMA }
//   attrs 校验：rows>=1 / cols>=1 / colWidths.length===cols / cells 规整(默认值填充、covered 一致)
// renderer: { component: TableBlock, editable: true }
// commands: 通过 createTableCommands() 注册到 editor.commands（name 前缀 table*）

export function createTableCommands(editor: Editor): {
  tableInsert(args: { rows?: number; cols?: number; insertAfterBlockId?: BlockId }): BlockId
  tableInsertRow(args: { id: BlockId; index: number; count?: number }): void
  tableRemoveRow(args: { id: BlockId; index: number }): void
  tableInsertCol(args: { id: BlockId; index: number; count?: number }): void
  tableRemoveCol(args: { id: BlockId; index: number }): void
  tableMergeRect(args: { id: BlockId; rect: TableSelectionRect }): void
  tableSplitCell(args: { id: BlockId; row: number; col: number }): void
  tableSplitCellsInRect(args: { id: BlockId; rect: TableSelectionRect }): void
  tableToggleHeaderRow(args: { id: BlockId }): void
  tableSetColWidth(args: { id: BlockId; col: number; width: number }): void
  tableSetCellAttrs<A extends Record<string, unknown>>(args: { id: BlockId; cells: ReadonlyArray<{ row: number; col: number }>; attrs: A }): void
  tableSetCellMark(args: { id: BlockId; cells: ReadonlyArray<{ row: number; col: number }>; mark: Mark }): void
  tableToggleCellMark(args: { id: BlockId; cells: ReadonlyArray<{ row: number; col: number }>; markType: MarkType }): void
  tableTransformCellType(args: { id: BlockId; cells: ReadonlyArray<{ row: number; col: number }>; targetType: 'paragraph' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'quote' | 'todo' | 'bullet' | 'ordered' | 'codeBlock' }): void
}
```

`TableBlock` 组件行为要点：
- 顶层 `.block-table-container`（padding-top/left=20px 为选择条让位，无聚焦 outline）；内部 `.table-wrapper` 是 `overflow-x: auto + width: 100%`，内部 `table` 为 `width: max-content + table-layout: fixed`；因此内部水平滚动独立于编辑区滚动。
- 行选择条、列选择条、角部全选手柄、浮动操作栏、行/列间插入点 **全部是 `.block-table-container` 的直接子元素（fixed-to-container）**，不随滚动位移。
- 单元格状态三级：**默认**（白底 / 灰边）、**选中**（浅蓝底 `.cell-selected`）、**聚焦编辑**（蓝框阴影 `.cell-focus-outline`）。单击 → 选中；双击 → 聚焦编辑（独立 `contenteditable`）；Escape → 失焦。
- `cellType` 控制每行前缀/视觉：heading（字号与正文 heading 一致）、quote（左边框引用）、todo（复选框 + 删除线）、bullet/ordered（前缀符/编号）、codeBlock（等宽字体 + 代码灰底 + `white-space: pre-wrap`）。
- 合并单元格：`cells[r][c].colspan > 1 || rowspan > 1` 时 `<td>` 渲染属性；`covered: true` 的单元格不渲染。UI 中拖拽选中范围含合并单元格时自动调用 `expandSelectionToFullRect`。
- **浮动操作栏**：单行选中 → 显示"删除行"；单列选中 → 显示"删除列"；全表选中 → 显示"删除表" + **"标题行"切换按钮**（`tsel.kind === 'all'` 时 `.ht-btn.active` 高亮）；多非覆盖选中 ≥ 2 → 显示"合并单元格"；选区含合并单元格 → 显示"拆分单元格"。
- 行/列间插入点：鼠标悬停在行/列之间的 3px 热区，出现蓝色插入指示条，点击在该位置插入新行/列（行插入时继承列宽，列插入时宽度 120px）。
- Tab / Shift+Tab 导航；最后一个单元格 Tab → 自动追加新行；非代码块单元格 Enter → 退出聚焦（同步内容）+ 保持单格选中态。

**交互。** 导入 `vue`（`h / ref / computed / watch / nextTick / onBeforeUnmount`）、`core/types`（`BlockAttrs` / `EditorRef` / `BlockId` / `Mark` / `MarkType`）、`core/editor`（`Editor`）、`core/extension/Extension`（`defineExtension`）、`view/context`（`useEditor`）、`extensions/tableModel`（全部纯函数 + `TABLE_ATTRS_SCHEMA` / `expandSelectionToFullRect`）、`view/ui/HoverToolbar.vue`（浮动操作栏）、`i18n`（`t()`）、`core/inlineDom`（`inlineToHtml` / `inlineFromHtml` / `inlineToMarkdown` / `markdownToInline` / 在 `syncCellContent` 内部间接使用）。`BuiltinExtensions` 默认包含。与 Image 一样，Table 是 `content: 'none'` 块，通过 `attrs` 存储所有数据，零核心改动。与其他扩展无相互依赖；**不导入 core 外的扩展**（仅 `tableModel.ts` 同目录）。

### `src/extensions/Equation.ts`

**职责。** 公式（LaTeX 数学公式）块类型扩展——一个 `content: 'none'`、**isolated** 块，只保存 `attrs.expression`（原始 LaTeX 源码）。渲染器是独立的 Vue 组件（`EquationBlock`）：查看态调用 `katex.renderToString` 即时渲染居中展示公式（渲染出的 DOM 永不持久化，只序列化 `attrs.expression`）；编辑态显示绑定 `attrs.expression` 的 textarea 并带 KaTeX 实时预览，外加一个浮动 ✎ 按钮用于（重新）打开编辑器。空块在插入时自动进入编辑态。选中与嵌套遵循编辑器的通用非文本块约定：根元素携带 `block-focus-root`，因此块手柄/选中环完全由 `focusedBlockId` 驱动（组件内不做 `isSelected` 订阅）；`classesFromAttrs(attrs)` 注入 `be-indent-N` 类，使块作为子块嵌套时按深度正确缩进（`attrs.indent` 即为深度镜像）。Markdown 导出序列化为 `$$$ … $$$` 围栏块；HTML 导出输出 `<div class="equation-block-rendered">`。非法 LaTeX 会渲染为 `katex-error-block` 兜底而非抛错。

**交互。** 导入 `vue`、`core/types`、`core/editor`（`Editor`）、`core/extension/Extension`（`defineExtension`）、`view/ui/SafeHtml.vue`、`view/ui/icons`（`ICON_EQUATION`、`ICON_EDIT`）、`extensions/_commonAttrs`（`COMMON_ATTRS`、`classesFromAttrs`）、`view/context`（`useEditor` / `useEditable`）、`i18n`（`useI18n`）以及 `katex`（外加 `katex/dist/katex.min.css`）。`BuiltinExtensions` 默认包含。与 Image/Table 一样，Equation 是 `content: 'none'` 的 attrs 存储块——零核心改动。空公式块按 Enter 退出到默认块类型；编辑按钮在进入编辑态前调用 `editor.commands.selectBlock({ id })`，确保编辑时块始终处于选中态。

### `src/extensions/tableModel.ts`

**职责。** 表格结构的**纯函数库**：所有 `TableAttrs` 变换都在这里，输入不可变、返回新对象；UI/命令层（`Table.ts`）把 `tableModel.fn(attrs, args)` 的结果通过 `editor.commands.setAttrs({ id, attrs })` 打包成标准事务，因此 undo/redo 免费。

**公共 API。**

```ts
export const TABLE_ATTRS_SCHEMA: BlockSchemaSpec['attrs']
// → rows>=1, cols>=1, colWidths?.length===cols, cells 整体由 validateTableAttrs 规整

export function validateTableAttrs(attrs: Attrs): Attrs          // 规范：缺行/列/cells/colWidths/headerRow 用默认补齐；cells 缺 rowspan/colspan/covered/content 填默认；covered 与 rowspan/colspan 重新对齐

export function createEmptyTableAttrs(rows: number, cols: number, opts?: { defaultColWidth?: number; headerRow?: boolean }): TableAttrs

export function insertRows(attrs: TableAttrs, index: number, count?: number): TableAttrs
export function removeRow(attrs: TableAttrs, index: number): TableAttrs
export function insertCols(attrs: TableAttrs, index: number, count?: number, newColWidth?: number): TableAttrs
export function removeCol(attrs: TableAttrs, index: number): TableAttrs
export function setColWidth(attrs: TableAttrs, col: number, width: number): TableAttrs

export function isRect(attrs: TableAttrs, cells: readonly { row: number; col: number }[]): boolean
export function expandSelectionToFullRect(attrs: TableAttrs, cells: readonly { row: number; col: number }[]): TableSelectionRect
export function mergeCellsInRect(attrs: TableAttrs, rect: TableSelectionRect): TableAttrs
export function splitCell(attrs: TableAttrs, row: number, col: number): TableAttrs
export function splitCellsInRect(attrs: TableAttrs, rect: TableSelectionRect): TableAttrs

export function toggleHeaderRow(attrs: TableAttrs): TableAttrs
export function setCellsAttrs<A extends Record<string, unknown>>(attrs: TableAttrs, cells: readonly { row: number; col: number }[], patch: A): TableAttrs
export function setCellsMark(attrs: TableAttrs, cells: readonly { row: number; col: number }[], mark: Mark): TableAttrs
export function toggleCellsMark(attrs: TableAttrs, cells: readonly { row: number; col: number }[], markType: MarkType): TableAttrs
export function transformCellsToType(attrs: TableAttrs, cells: readonly { row: number; col: number }[], targetType: CellType): TableAttrs

export function recomputeCovered(cells: TableCell[][], rows: number, cols: number): TableCell[][]
export function getColWidthsSum(colWidths: readonly number[]): number

// 序列化 / 反序列化（供扩展的 serializers/deserializers 调用）
export function tableToHtml(attrs: Attrs, inlineToHtml: (inline: readonly InlineNode[]) => string): string
export function tableFromHtml(html: string, inlineFromHtml: (html: string) => InlineNode[]): TableAttrs
export function tableToMarkdown(attrs: Attrs, inlineToMd: (inline: readonly InlineNode[]) => string): string
export function tableFromMarkdown(md: string, mdToInline: (md: string) => InlineNode[]): TableAttrs

export interface TableAttrs { rows: number; cols: number; cells: TableCell[][]; colWidths: number[]; headerRow?: boolean }
export interface TableCell { content: InlineNode[]; rowspan: number; colspan: number; covered: boolean; cellType?: CellType; align?: 'left'|'center'|'right'; bgColor?: string }
export type CellType = 'paragraph' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'quote' | 'todo' | 'bullet' | 'ordered' | 'codeBlock'
export interface TableSelectionRect { startRow: number; endRow: number; startCol: number; endCol: number }
```

**交互。** 依赖 `core/types`（类型级别的 `Attrs` / `InlineNode` / `Mark` / `MarkType`）。**不依赖 Vue / core/Editor / 任何其他扩展**——纯函数。被 `Table.ts`（`createTableCommands` 的每个命令都对应一个 `tableModel.xxx` 调用、渲染器计算使用 `isRect` / `expandSelectionToFullRect` / `getColWidthsSum` 等）与 `validateTableAttrs` 内部使用（schema attr 默认值填充）。被 `tableToHtml` / `tableFromHtml` / `tableToMarkdown` / `tableFromMarkdown` 作为序列化出口，在 TableExtension 注册的 serializers/deserializers 中调用。

### `src/extensions/Divider.ts`

**职责。** Divider 块类型扩展——极简隔离型块，渲染 `<hr class="block-divider">`，`content: 'none'`，attrs 为空。输入规则 `---`、`***`、`___` 在空段落上触发时转换为 divider；加号菜单提供"分割线"条目（斜杠 `/divider`）。

**公共 API。**

```ts
export const DividerExtension: Extension
// name: 'divider'
// schema: { content: 'none', nestable: false, isolation: true, attrs: {} }
// renderer: { component: DividerBlock, editable: true }
// inputRules: [ '^--- +$' / '^\\*\\*\\* +$' / '^___ +$' → replaceWith('divider') ]
// slash: [{ name: 'divider', label: t('slash.divider'), icon: ICON_DIVIDER, command: insertDividerCommand }]
```

**交互。** 依赖 `vue` / `core/types` / `core/extension/Extension` / `i18n` / `view/ui/icons`。`BuiltinExtensions` 默认包含。

### `src/extensions/TableOfContents.ts`

**职责。** 目录（TOC）块类型扩展——一种特殊的**不可编辑**块，渲染文档中所有标题的实时层级列表。它刻意不存储任何标题数据（`content: 'none'`、空 attrs）：列表是每次渲染时从当前编辑器状态计算的**动态视图**，因此始终与文档保持同步（标题的增删、文本/级别/顺序变化）。`content: 'none'` + `inlineMarks: false` + `renderer.editable: false` 使其构造上不可编辑——无光标、无行内文本。

**公共 API。**

```ts
export interface TocItem {
  readonly id: BlockId
  readonly level: number
  readonly text: string
}

export function collectHeadings(doc: DocState): readonly TocItem[]
// 通过 `flatten` 遍历块树，过滤 `type === 'heading'`，跳过空标题；
// 按文档顺序返回 { id, level, text }。表格单元格内的标题自动排除
// （单元格内容存在 Block.attrs 中，不在块树内）。

export const TableOfContentsExtension: Extension
// name: 'tableOfContents'
// schema: { type: 'tableOfContents', content: 'none', nestable: false,
//           inlineMarks: false, attrs: {}, empty: () => false }
// renderer: { component: TocBlock, editable: false }
// slash: [{ id: 'tableOfContents', title: 'slash.tableOfContents.title',
//           keywords: ['toc','contents','table of contents','outline','目录','标题','大纲'],
//           command: 'convertBlock', args: () => ({ id: '__currentBlock__', type: 'tableOfContents' }) }]
// serialize: { toHTML: () => '', toMarkdown: () => '' }
```

渲染器订阅编辑器状态更新（`editor.subscribe`）并在每次变更时重新计算标题集合，因此文档变化时目录会重新渲染。点击条目分发 `setSelection`（通过 `caretSelection(id, 0)` 将光标置于标题处），然后 `scrollIntoView({ block: 'center', behavior: 'smooth' })`——复用已有的 Selection / DOM 定位机制，而不改动文档结构。

**交互。** 导入 `vue`（computed/defineComponent/h/nextTick/ref）、`core/types`（`Block`、`BlockId`、`DocState`、`inlineText`）、`core/state/store`（`flatten`）、`core/selection/Selection`（`caretSelection`）、`view/domSelection`（`findBlockEl`）、`view/context`（`useEditor`）、`i18n`（`useI18n`）、`view/ui/icons`（`ICON_TOC`）。`BuiltinExtensions` 默认包含。

**扩展点。** HTML 与 Markdown 序列化均输出空字符串——生成的标题列表是视图而非编辑器内容，真正的标题已由各自块导出，因此目录不会在导出中被重复。标题收集是纯函数（`collectHeadings`），可复用或自定义（例如按级别过滤、添加编号）而无需触碰核心。

### `src/extensions/_commonAttrs.ts`

**职责。** 应用于每个文本承载块的共享 schema 属性规范。保持 align/color/bgColor/indent 在 Paragraph/Heading/List/Quote 间一致。同时定义 `BlockSettingsMenu` 和 `HoverToolbar` 使用的颜色预设表（`TEXT_COLOR_PRESETS`、`BG_COLOR_PRESETS`）。**阶段 6 新增** `IMAGE_ATTRS`(空)，作为 `image` 块类型 attr 规范的一致引用——image 块有意不带文本块属性(无 align/color/indent)，并保持 `content: 'none'`。

**公共 API。**

```ts
export const COMMON_ATTRS: BlockSchemaSpec['attrs']             // align + color + bgColor + indent
export const COMMON_ATTRS_NO_INDENT: BlockSchemaSpec['attrs']   // align + color + bgColor(quote)
export const COMMON_ATTRS_NO_INDENT_NO_ALIGN: BlockSchemaSpec['attrs'] // color + bgColor
export const CODE_BLOCK_ATTRS: BlockSchemaSpec['attrs']         // {}(codeBlock：无属性)
export const IMAGE_ATTRS: BlockSchemaSpec['attrs']              // {}(image： 持久化 attrs 由 Image.schema 定义，不含文本/缩进/颜色)
export const INDENT_TYPES: readonly string[]                     // 支持缩进的块类型
export const MAX_INDENT = 10
export function classesFromAttrs(attrs: Attrs): string[]         // → ['be-align-center', 'be-color-red', …]
export interface ColorPreset { readonly key: string; readonly label: string; readonly cssValue: string; readonly opacity: number }
export const TEXT_COLOR_PRESETS: readonly ColorPreset[]
export const BG_COLOR_PRESETS: readonly ColorPreset[]
```

颜色预设使用 CSS 变量（`var(--be-color-gray)`、`var(--be-swatch-bg-gray)`），因此能自动适配浅色/深色主题。背景色使用带 `opacity` 字段的半透明色。

**交互。** 被 10 个块类型扩展导入（7 个文本 + image / table / divider）。Table / Divider 不导入 `COMMON_ATTRS`（表格文本属性存于每个 cell 的 attrs，不含块级 align/indent；divider 为隔离块空 attrs）。`classesFromAttrs` 由每个渲染器调用来应用 CSS 类。`SchemaRegistry` 中的 `coerceAttrsFor()` 使用 schema 的属性规范在转换块类型时剥离无效属性（例如转为 `quote` 时移除 `indent`，转为 `codeBlock` 时移除所有属性，转为 `image` 时移除所有文本属性并确保持久化字段仅来自 `ImageExtension.schema.attrs`，转为 `divider` / `table` 时清空块级 attrs 并由各自 schema 处理）。

### `src/extensions/Keymap.ts`

**职责。** 默认键位映射扩展：把核心编辑键绑定到原语命令。这些是每个文本编辑器都需要、 Enter 用于拆分/退出、Backspace/Delete 用于合并/删除、方向键用于跨块导航。扩展可以注册更高优先级（更小的数字）的额外键位映射来覆盖这些默认值。见 `docs/architecture.md` §11.1、§11.2、§11.3。

**公共 API。**

```ts
export const KeymapExtension: Extension
// name: 'default-keymap'
// keymap: [
//   { key: 'Enter', command: 'enter' },
//   { key: 'Backspace', command: 'backspace' },
//   { key: 'Delete', command: 'backspace' },
//   { key: 'ArrowUp', command: 'moveToPreviousBlock' },
//   { key: 'ArrowDown', command: 'moveToNextBlock' },
// ]
```

阶段一（单行块）中，ArrowUp/Down 总是在块之间移动；多行光标导航在块能包含换行时到达。

**交互。** 仅导入 `core/extension/Extension`。捆绑于 `builtin.ts`；它的 `KeymapSpec` 由 `Registry.ts` 注册，由 `keymapHandler.ts` 解析。绑定的命令（`enter`、`backspace`、`moveToPreviousBlock`、`moveToNextBlock`）在 `primitiveCommands.ts` 中定义。

**扩展点。** 块类型可以通过注册一个带更低 `priority` 的键位映射条目来覆盖默认绑定。块边界处的 ArrowLeft/ArrowRight（§11.3）和 Tab/Shift-Tab 缩进/反缩进（阶段四）作为进一步绑定添加在这里或一个专门扩展中。

### `src/extensions/History.ts`

**职责。** 历史键位映射扩展：绑定撤销/重做快捷键。实际的撤销/重做逻辑位于 `HistoryManager`（由 `Editor` 拥有）和 `undo`/`redo` 核心命令中；此扩展只贡献键盘绑定。Mac 上：Cmd+Z（撤销）、Cmd+Shift+Z（重做）。Windows 上：Ctrl+Z（撤销）、Ctrl+Y（重做）、Ctrl+Shift+Z（重做）。`Mod` 占位符由 `Keymap.ts` 按平台解析。

**公共 API。**

```ts
export const HistoryExtension: Extension
// name: 'history-keymap'
// keymap: [
//   { key: 'Mod-z', command: 'undo' },
//   { key: 'Mod-Shift-z', command: 'redo' },
//   { key: 'Mod-y', command: 'redo' },
// ]
```

**交互。** 仅导入 `core/extension/Extension`。捆绑于 `builtin.ts`；它的绑定由 `Registry.ts` 注册，由 `keymapHandler.ts` 解析。`undo`/`redo` 命令由 `Editor.ts` 注册并委托给 `HistoryManager`。

**扩展点。** 用户可以通过按名覆盖 `history-keymap` 扩展来禁用默认的撤销/重做快捷键，或通过直接分发 `editor.commands.undo()` 添加替代绑定（例如一个工具栏按钮）。`HistoryManager`（引擎）与此扩展（仅键位映射）的分离是刻意的——见 §13.1。

### `src/extensions/builtin.ts`

**职责。** 内置扩展捆绑：每个编辑器实例默认都应包含的一组。用户可以添加更多扩展，或通过提供同名（`name`）扩展来覆盖它们（在 `flattenExtensions` 中后到者胜出）。顺序只对键位映射优先级有意义；所有内置键位映射都使用默认优先级（0）。需要覆盖内置绑定的扩展应以更小的优先级数字注册。见 `docs/architecture.md` §5.4。

**公共 API。**

```ts
export const BuiltinExtensions: readonly Extension[]
// = [ ParagraphExtension, HeadingExtension, BulletListExtension,
//     OrderedListExtension, TodoListExtension, QuoteExtension,
//     CodeBlockExtension, ImageExtension, TableExtension, DividerExtension,
//     TableOfContentsExtension, KeymapExtension, HistoryExtension ]

export { ParagraphExtension } from './Paragraph'
export { HeadingExtension } from './Heading'
export { BulletListExtension } from './BulletList'
export { OrderedListExtension } from './OrderedList'
export { TodoListExtension } from './TodoList'
export { QuoteExtension } from './Quote'
export { CodeBlockExtension } from './CodeBlock'
export { ImageExtension } from './Image'
export { TableExtension, createTableCommands } from './Table'
export { DividerExtension } from './Divider'
export { TableOfContentsExtension } from './TableOfContents'
export { KeymapExtension } from './Keymap'
export { HistoryExtension } from './History'
```

**交互。** 导入 13 个内置扩展模块和 `core/extension/Extension`。由 `src/index.ts` 再导出。消费者组合 `[...BuiltinExtensions, ...userExtensions]`，或完全省略 `extensions`（`BlockEditor` prop 默认为 `BuiltinExtensions`）。

**扩展点。** 新增内置块类型或行为意味着把它的扩展加到此数组（并再导出它）。因为覆盖是基于名字的，用户可以替换任何一个内置项而无需派生出捆绑。

## 序列化格式（HTML/JSON/Markdown）

### HTML 序列化（view 层，无独立 `core/html.ts`）

**职责。** 顶层 HTML 序列化/反序列化**不在核心层**——不存在 `core/html.ts`，也没有 `blocksToHtml`/`htmlToBlocks`。行内序列化在 `view/inlineDom.ts`（`inlineToHtml`），块级复制/粘贴在 `view/clipboard.ts`（`parseHtml`），每块类型贡献 `serialize.toHTML`（`core/serialize/Serializer.ts`），元素级解串由扩展的 `fromHTML` 提供（例如 Image 为 `<figure>`/`<img>`）。

块级 HTML：`serializers.htmlFor(block)` 未命中时回退到 `<div class="be-block be-block-${type}">` + 行内内容的通用序列化。行内 HTML：`inlineToHtml` 把 `InlineSeq` 渲染为语义标签——marks 对应 `<b>`/`<i>`/`<u>`/`<s>`/`<code>`，`link` mark 渲染为 `<a href="sanitizeUrl(attrs.href)" target="_blank" rel="noopener noreferrer">`，颜色/背景色 marks 渲染为 `<span class="be-color-…">`。HTML 解析：`clipboard.ts` 的 `parseHtml` 用 `DOMParser` 遍历 `<body>` 子节点，先尝 `deserializers.parseHtmlElement(node, inlines)`，未命中则走内置标签映射（heading level、list item wrapper、code language detection），文本节点按空行分段为默认类型（通常是 paragraph）块。

**交互。** 依赖 `view/inlineDom.ts`、`view/urlUtils.ts`（`sanitizeUrl`）、`view/clipboard.ts`。被 `BlockEditor.vue` 的 copy/cut（序列化选中块为 HTML 写入剪贴板）与 paste（用 `parseHtml` 得到块）使用。

### 文档 ↔ JSON（`types.ts` + `state/store.ts`，无独立 `core/json.ts`）

**职责。** 文档 ↔ JSON 往返由 `types.ts` 的 `DocumentData`/`BlockData` 契约与 `state/store.ts` 的 `docFromData`/`docToData` 承担——不存在 `core/json.ts`，也没有 `validateDocumentData`。

**契约（`types.ts`）。**

```ts
export interface BlockData {
  readonly id?: string
  readonly type: string
  readonly attrs?: Attrs                    // 含 image 的 src/alt/title/width/height/caption/fileId
  readonly content?: InlineSeq
  readonly children?: readonly BlockData[]  // 真实嵌套的子块
}
export interface DocumentData {
  readonly id?: string
  readonly blocks: readonly BlockData[]
}
```

**`docFromData`（`store.ts`）。** 从嵌套 JSON 构建规范化的 `DocState`：按 `children` 递归摄入、必要时重新生成唯一 id、构建 `parent` 映射；随后做**旧式迁移**——若所有块都是根同级且存在 `attrs.indent > 0`，用缩进栈重建 `parent/children` 树（非 nestable 块被钳制到根级且不能有子）；最后把每个块的 `attrs.indent` 规范化为 `depthOf`（0..10 钳制）。

**`docToData`（`store.ts`）。** 深度优先文档序序列化 `DocState` 回 `DocumentData`：深拷贝 `InlineSeq`（避免与活动状态共享对象引用），递归携带 `children`，只写 schema 白名单 attrs。

**不变量。** image 块出站无瞬态泄漏（`width/height` 为 `number | undefined`，绝无 `progress`/`error`/`tempSrc`；`ImageExtension.schema.attrs.validate` 在 `setAttrs` 时拒绝，`docToData` 只写白名单 attrs）；未知块类型的 `attrs`/`content` 原样保留，老客户端可 round-trip 回存未知扩展。

**交互。** 消费者（`BlockEditor.vue` 的 `modelValue` prop、外部保存 API、`v-model` 用户）读写 `DocumentData`。

### 文档 ↔ Markdown 转换（原生集成于 `Editor`）

**职责。** 文档 ↔ Markdown 往返。**没有独立的 `core/markdown.ts` 模块**——解析与序列化逻辑直接内嵌在 `src/core/Editor.ts` 中，作为 `Editor` 的原生方法（`toMarkdown` / `setDocFromMarkdown`），不经过任何中间 `DocumentData` 表示。针对 Notion/Typora 风格的 CommonMark 子集进行稳定序列化/解析——保证 `doc → markdown → doc` 的往返保留文本块内容、link marks 和 image 块，并尽量保留标题级别、列表深度、引用、代码语言。行内 marks(b/i/u/s/code + link + color)按优先级渲染：link 优先包装，因为 Markdown 的 `[text](url)` 语法天然把格式化包含在方括号内。

**公共 API**（`Editor` 方法，见上文 `src/core/Editor.ts`）：

```ts
toMarkdown(): string                       // 导出：doc → markdown
setDocFromMarkdown(markdown: string): void // 导入：markdown → doc（重置历史）
```

**序列化（toMarkdown）。** 对每个块调用 `serializers.markdownFor(block)`;回退是按块类型的通用格式。**阶段 6 的块级：** 图片块序列化为 `![alt](src "title")` 后跟可选的 caption 行。**阶段 6 的行内：** 行内级 `link` mark 序列化为 `[格式化文本](href)`——`href` 经 `normalizeUrl` 确保不丢失 scheme，而方括号内的文本**保留内部 marks 的 markdown 语法**(例如 `[**粗体链接**](https://…)`);`code` mark 内部**不套 link**(与编辑器内的 mark 互斥规则一致)。**支持嵌套：** 顶层块之间用恰好一个空行分隔；同一父级下同种类型的连续列表块(ul/ol/todo)之间不加空行，嵌套(不同缩进层级)的父子列表之间也不加空行；缩进前缀由 `depthOf` 计算，有序列表编号按**同一父级的兄弟列表**隔离。行内 code 块用反引号包裹；多个空行会被折叠为单个空行。

**解析（setDocFromMarkdown）。** 按段落块(空行分隔)扫行：每个段落先尝 `deserializers.parseMarkdownLine(line)`(所有块类型的 Markdown 快捷规则)，如未命中则用**正则 + 逐字解析行内**匹配 heading(`#` 前缀)、ul(`-|*|+ `)、ol(`1. `)、todo(`[ ] `、`[x] `)、quote(`> `)、code fence(```` ``` ```` + 可选语言 + 结束 fence)。**阶段 6：** 段落行扫描行内 `![alt](url "title")`(匹配成功则产出 Image 块，而非留在段落内)以及 `[text](url)`(产出带 `link` mark 的行内节点，`attrs.href = sanitizeUrl(url)`)。通过**缩进栈**把前导空格解析为块层级——更深缩进压栈成为父块，更浅缩进弹栈回到祖先，从而构建 `children`/`parent` 嵌套树；对突然的大幅缩进做溢出保护，挂到最近的有效祖先上。空/纯空白输入回退为默认段落块。

## 国际化与主题

### `src/i18n.ts`

**职责。** 轻量级 i18n + 主题模块。locale（`zh-CN` 默认，`en-US`）控制所有静态 UI 字符串（工具提示、菜单标签、占位符、按钮文本）。theme（`light` 默认，`dark`）作为响应式 ref 提供，子组件可响应其变化。刻意避免 `vue-i18n`，使包零运行时依赖。

**公共 API。**

```ts
export type Theme = 'light' | 'dark'
export type Locale = 'zh-CN' | 'en-US'

export function normalizeLocale(raw: string | undefined | null): Locale  // '' / null / 'zh-CN' → 'zh-CN';否则 → 'en-US'
export function normalizeTheme(raw: string | undefined | null): Theme    // 'dark' → 'dark';否则 → 'light'

export const localeKey: InjectionKey<Ref<Locale>>
export const themeKey: InjectionKey<Ref<Theme>>
export function provideI18n(locale: Ref<Locale>, theme: Ref<Theme>): void
export function useI18n(): I18nBundle    // { locale, theme, t(key) }
```

`provideI18n` 直接提供原始的 locale/theme ref（不包装在对象中），使每个使用者的 `t()` 函数读取 `localeRef.value` —— 一个普通的 ref 读取，Vue 响应式系统能可靠地跨 `<Teleport>` 边界追踪。`useI18n()` 注入 ref 并构建新的 `t()`，在当前 locale 的字典中查找 key，找不到时回退到原始 key。

**交互。** 导入 `vue`（`InjectionKey`、`Ref`、`inject`、`provide`、`ref`）。`BlockEditor.vue` 在 `setup()` 中调用 `provideI18n()`，通过 `watch(normalizedLocale, …)` 更新 ref。所有 UI 组件（`BlockHandle`、`BlockSettingsMenu`、`HoverToolbar`、`PlusMenu`、`OrderedListMenu`、`NumberPicker`、`CodeLangPicker`）调用 `useI18n()` 获取 `t()`。

**扩展点。** 新增 locale 意味着向 `DICTS` 添加字典对象并扩展 `Locale` 类型。新增静态字符串意味着向 `zhCN` 和 `enUS` 字典都添加 key。

### `src/style.css`

**职责。** 编辑器自包含的样式表。所有设计 token 都是 CSS 变量，定义在 `:root`（浅色）和 `.block-editor.theme-dark` / `body.theme-dark`（深色）下。`.block-editor` 元素刻意不设置 `background` —— 由宿主页控制编辑器背景。

**关键 CSS 变量。**

```css
:root {
  --be-bg, --be-border, --be-text, --be-muted, --be-accent, --be-hover,
  --be-active, --be-danger, --be-shadow, --be-radius, --be-fg,
  /* 文本颜色预设(10 个) */
  --be-color-{gray,brown,orange,yellow,green,blue,purple,pink,red},
  /* 背景色板预设(9 个，半透明色) */
  --be-swatch-bg-{gray,brown,orange,yellow,green,blue,purple,pink,red}
}
```

深色模式覆盖定义在 `.block-editor.theme-dark` 和 `body.theme-dark` 上（后者使通过 `<Teleport>` 渲染的弹出层能继承）。主题 class 由 `BlockEditor.vue` 的 `watch(normalizedTheme, …)` 同步到 `<body>`。

**交互。** 由 `BlockEditor.vue` 导入（`import '../style.css'`）。playground 添加自己的 `playground.css` 用于外壳（标题栏、调试面板），使用独立的 `--pg-*` 变量。

## 包入口点

### `src/index.ts`

**职责。** `xiaodao-editor` 包的公开入口点。导出核心引擎（框架无关）、Vue 组件、内置扩展、i18n/主题模块，以及用于自定义块类型的扩展/schema/命令构建块。这是消费者使用的唯一导入路径。

**公共 API。**

```ts
// 核心引擎(框架无关)— 再导出 core/index.ts
export * from './core/index'

// Vue 组件
export { default as BlockEditor } from './view/BlockEditor.vue'
export { default as BlockList } from './view/BlockList.vue'
export { default as BlockHost } from './view/BlockHost.vue'
export { default as BlockContent } from './view/BlockContent.vue'
export { editorKey, useEditor } from './view/context'
export type { BlockRenderItem } from './view/context'

// 内置扩展
export { BuiltinExtensions } from './extensions/builtin'
export { ParagraphExtension } from './extensions/Paragraph'
export { HeadingExtension } from './extensions/Heading'
export { BulletListExtension } from './extensions/BulletList'
export { OrderedListExtension } from './extensions/OrderedList'
export { TodoListExtension } from './extensions/TodoList'
export { QuoteExtension } from './extensions/Quote'
export { CodeBlockExtension } from './extensions/CodeBlock'
export { ImageExtension } from './extensions/Image'
export { TableExtension, createTableCommands } from './extensions/Table'
export { DividerExtension } from './extensions/Divider'
export { KeymapExtension } from './extensions/Keymap'
export { HistoryExtension } from './extensions/History'

// i18n + 主题
export { useI18n, provideI18n, normalizeLocale, normalizeTheme } from './i18n'
export type { Theme, Locale, I18nBundle } from './i18n'
```

**交互。** 导入 `core/index`、四个 `.vue` 组件、`view/context`、`i18n.ts`、`view/urlUtils`、`view/imageUpload` 以及内置扩展捆绑（14 个扩展，含 `Equation`/`TableOfContents`）。这是包的 `main`/`module` 字段指向的文件；`playground/App.vue` 和外部消费者从这里导入。

**扩展点。** 新的公共能力（核心或视图）通过在这里添加它的再导出暴露。`core/index.ts`（框架无关表面）与此文件（添加 Vue + 扩展）的分离强化了层边界：只想要引擎的消费者可以在包暴露该子路径时导入 `xiaodao-editor/core`，或摇树掉 Vue 组件。
