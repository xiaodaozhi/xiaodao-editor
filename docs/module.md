# Xiaodao Editor Module Reference

This document is the per-module API reference for the `xiaodao-editor` package, a Notion-style, block-first editor built as a reusable Vue 3 + TypeScript library. The **core** (`src/core/**`) is framework-agnostic — it has zero Vue imports and is portable to any framework — while the **view layer** (`src/view/**`) is the sole bridge to Vue reactivity and the DOM. Every block type and editing behavior is contributed by an **extension**, so the core never switches on a block type. The package ships 14 built-in extensions (Paragraph, Heading, BulletList, OrderedList, TodoList, Quote, CodeBlock, Image, Table, Divider, **Equation**, **TableOfContents**, Keymap, History) covering all block types, inline marks (bold/italic/underline/strike/code/**link with href attribute + URL sanitization**), block-level attrs, slash menu, input rules, hover toolbar (+ link button), drag handle, clipboard, i18n, theming, **image upload pipeline with transient side-channel and fileId cleanup events**, **link popover (view/edit/copy/remove), Mod+K, paste/type URL auto-link**, **table block with merge/split/header-row**, **equation block (LaTeX/KaTeX with live preview and nesting)**, **table-of-contents block (live heading list view)**, JSON persistence, and Markdown/HTML serialize/deserialize. This reference is organized by subsystem; for design rationale and the update flow, see `docs/architecture.md` (notably §4 document model, §6 rendering, §7 commands, §10 state, §11 keyboard/IME, §14 Phase 6 Image + Link Mark, Phase 7 Table + Divider, Phase 8 Table of Contents).

## Document Model & Types

### `src/core/types.ts`

**Responsibility.** The single source of truth for the editor's data model. It is intentionally framework-agnostic and contains only type definitions plus a few pure type guards and helpers (`inlineText`, `inlineFromString`). All runtime behavior lives in dedicated modules; this module defines the shapes everything else operates on.

**Public API.**

```ts
type BlockId = string & { readonly __brand: 'BlockId' } // branded opaque id
type BlockType = string
type JSONValue = string | number | boolean | null | JSONValue[] | { [k: string]: JSONValue }
type Attrs = Readonly<Record<string, JSONValue>>

interface Mark { readonly type: string; readonly attrs?: Attrs }
interface TextRun { readonly type: 'text'; readonly text: string; readonly marks?: readonly Mark[] }
type InlineNode = TextRun                  // discriminated union; future: mention | equation
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
function inlineText(seq: InlineSeq): string            // concatenate text runs
function inlineFromString(text: string): InlineSeq      // build a seq from a string
```

**Interactions.** Imported by virtually every other core module. `ids.ts` produces `BlockId`; `state/store.ts` builds `DocState` from `DocumentData`; `Step.ts` mutates `DocState`; `Selection.ts` constructs `Selection`; `primitiveCommands.ts` uses `inlineText`/`inlineFromString`. The view layer imports `Block`, `BlockId`, `InlineSeq`, `Selection` for rendering and DOM sync.

**Extension points.** The `InlineNode` union is already a discriminated union: future inline atoms (mention, equation, inline math) extend it without altering `Block`. `children` enables nested blocks (toggle, columns, table cells). `Selection.kind` is a union that can grow for future selection modes.

### `src/core/ids.ts`

**Responsibility.** Stable, opaque block-id generation owned exclusively by the core, so identity is never produced by extensions or persistence. Uses the Web Crypto API (`crypto.getRandomValues`) so the core has zero runtime dependencies. See `docs/architecture.md` §4.1.

**Public API.**

```ts
function createBlockId(): BlockId   // 12 chars from a 64-symbol alphabet (~71 bits)
function asBlockId(value: string): BlockId  // coerce trusted strings (rehydration only)
```

`createBlockId` throws if `globalThis.crypto.getRandomValues` is unavailable. `ALPHABET` is `A–Za–z0–9_-` and `ID_LENGTH` is 12.

**Interactions.** Imported by `state/store.ts` (id assignment on import / collision), `state/Transaction.ts` (`TransactionBuilder.insertBlock` generates an id when none is supplied), and `Editor.ts` (`seedEmptyDocument`). Depends only on `types.ts` (for the `BlockId` type).

**Extension points.** Generation is centralized; swapping in a different scheme (e.g. UUID for collaboration) means editing this one module. Collision-resistance is sized for a single document; a collaborative transport can prefix or replace the generator without touching call sites.

## State Management

### `src/core/state/store.ts`

**Responsibility.** Owns construction of a normalized `DocState` from nested JSON, serialization back to JSON, and pure lookup helpers (parent, sibling, document-order traversal). It never mutates a `DocState` in place — mutations live in `Step.ts` / `Transaction.ts`. See `docs/architecture.md` §4.4 (forest + normalized store) and §10.

**Public API.**

```ts
interface DocBuildResult { readonly doc: DocState; readonly idMap: ReadonlyMap<string, BlockId> }

function docFromData(json: DocumentData): DocBuildResult   // preserve unique source ids, else regenerate
function docToData(doc: DocState): DocumentData

// Pure lookups
function getBlock(doc: DocState, id: BlockId): Block | undefined
function requireBlock(doc: DocState, id: BlockId): Block          // throws if missing
function parentOf(doc: DocState, id: BlockId): BlockId | null
function siblingList(doc: DocState, id: BlockId): readonly BlockId[]
function indexOf(doc: DocState, id: BlockId): number
function prevSibling(doc: DocState, id: BlockId): Block | undefined
function nextSibling(doc: DocState, id: BlockId): Block | undefined
function flatten(doc: DocState): BlockId[]                        // depth-first document order
function blockBefore(doc: DocState, id: BlockId): Block | undefined
function blockAfter(doc: DocState, id: BlockId): Block | undefined
function lastDescendant(doc: DocState, id: BlockId): Block

// Content helpers (produce new immutable Block)
function withContent(block: Block, content: InlineSeq): Block
function withAttrs(block: Block, attrs: Block['attrs']): Block
```

**Interactions.** Depends on `types.ts` and `ids.ts`. Used by `Step.ts` (apply reads parents/children), `invert.ts` (`indexOf`, `parentOf`, `requireBlock` to invert steps), `Editor.ts` (`docFromData`, `docToData`, `flatten`, `getBlock`), and `primitiveCommands.ts` (traversal for Enter/Backspace/navigation).

**Extension points.** The id policy (preserve if unique, else regenerate, returning an `idMap`) is the single place to change import identity rules — see open question §17.1. `flatten` is the seam the view bridge uses to derive a flat render list; a future virtualized `BlockList` consumes the same output.

### `src/core/state/Step.ts`

**Responsibility.** Defines the atomic, serializable structural operations (`Step`) that mutate a document, and `applySteps`, which produces a new immutable `DocState` plus a diff (`changed` / `removed`) that the view bridge consumes to update only affected blocks. Steps are intentionally low-level and dumb — they carry fully-resolved data and make no policy decisions; commands assign ids and sequence steps. See `docs/architecture.md` §7.2 and §10.3.

**Public API.**

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

`removeBlock` detaches an entire subtree (recursively deleting descendants). `moveBlock` handles both reorder-within-siblings and cross-parent reparenting. Indexes are clamped with `Math.max(0, Math.min(index, len))`.

**Interactions.** Depends on `types.ts`. Consumed by `EditorState.ts` (`applyTransaction` calls `applySteps`), `Transaction.ts` (the `Step` type), and `invert.ts` (inverts step lists). The diff (`changed`/`removed`) flows out through `applyTransaction` → `Editor.dispatch` → the view layer.

**Extension points.** New structural operations (e.g. `insertInlineNode`, `setMark`) are added as new union members plus a `case` in `applySteps`. Because steps are serializable, they are the unit a future collaboration transport would broadcast — see §15 (collaboration).

### `src/core/state/Transaction.ts`

**Responsibility.** Defines `Transaction` — the only path to mutate editor state — as an ordered list of `Step`s plus an optional resulting selection and metadata. Provides a fluent `TransactionBuilder` that commands use to assemble transactions. Meta carries cross-cutting hints: `addToHistory`, `historyGroup`, `viewHints.skipDomWrite`, and a `source` provenance tag. See `docs/architecture.md` §6.3, §7.2, §10.3.

**Public API.**

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
  insertBlock(params: InsertBlockParams): BlockId   // returns the (generated or explicit) id
  removeBlock(id: BlockId): this
  replaceBlock(id: BlockId, type: BlockType, attrs: Attrs): this
  moveBlock(id: BlockId, toParent: BlockId | null, toIndex: number): this
  setText(id: BlockId, content: InlineSeq): this
  setAttrs(id: BlockId, attrs: Attrs): this
  appendSteps(steps: readonly Step[]): this          // used by history undo/redo
  setSelection(selection: Selection): this
  setMeta(meta: Partial<TransactionMeta>): this
  addToHistory(value: boolean): this
  historyGroup(key: string | null): this
  skipDomWrite(ids: readonly BlockId[]): this
  build(): Transaction
}
function createTransaction(): TransactionBuilder
```

`insertBlock` generates an id via `createBlockId()` when `params.id` is omitted; the explicit form is used by undo/redo and paste.

**Interactions.** Depends on `types.ts`, `Step.ts` (the `Step` type), and `ids.ts`. Used by `primitiveCommands.ts` (every primitive builds a transaction), `HistoryManager.ts` (`undo`/`redo` build inverse/original transactions via `appendSteps`), and `EditorState.ts` (applies the `Transaction`).

**Extension points.** New meta keys are open-ended (the index signature `[key: string]: unknown`) so plugins and future features can attach hints without changing the type. `viewHints` is the contract the view layer reads to skip DOM writes for the focused block during typing (§6.3).

### `src/core/state/EditorState.ts`

**Responsibility.** The immutable, versioned state of the editor: the document, the selection, per-plugin state, and a monotonic `version`. Mutations go exclusively through `applyTransaction`, which produces a *new* `EditorState` with structural sharing (unchanged `Block` objects keep referential identity). See `docs/architecture.md` §10.1.

**Public API.**

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

`applyTransaction` runs `applySteps`, inherits `selectionAfter` (falling back to the prior selection), invokes each plugin's `applyTransaction` hook to update its state slice, and bumps `version`. Plugins are passed as a minimal `TransactionApplier` view (`{ name, applyTransaction? }`) to avoid a runtime coupling to the `Plugin` module.

**Interactions.** Depends on `types.ts`, `Step.ts` (`applySteps`, `ApplyResult`), `Transaction.ts` (the `Transaction` type), and a type-only import of `Plugin.ts` (`PluginState`). Used by `Editor.ts` (holds the current state, calls `applyTransaction`), and read by every command (`primitiveCommands.ts` inspects `state.doc` / `state.selection`) and plugin.

**Extension points.** `pluginState` is an open record keyed by plugin name; new plugins add their slice here, which is what makes undo/redo correct across plugin effects (§9). The `version` counter is the foundation for future optimistic-collaboration sequencing.

### `src/core/state/invert.ts`

**Responsibility.** Computes the steps that undo a given step list against the document state *before* those steps were applied. This enables memory-light, correct undo/redo without snapshotting the whole document — only the blocks a transaction touched are referenced by the inverse. Steps are inverted in reverse order so the last-applied change is undone first. See `docs/architecture.md` §9 and §16.

**Public API.**

```ts
function invertSteps(steps: readonly Step[], prevDoc: DocState): Step[]
```

Per-op inversion: `insertBlock` → `removeBlock`; `removeBlock` → a pre-order `insertBlock` sequence recreating the subtree (`reinsertSubtree`); `replaceBlock`/`setText`/`setAttrs` → restore the previous value from `prevDoc`; `moveBlock` → move back to the previous parent and index.

**Interactions.** Depends on `types.ts`, `Step.ts`, and `store.ts` (`indexOf`, `parentOf`, `requireBlock`). Consumed by `HistoryManager.ts`, which calls `invertSteps` when recording a transaction so each history item carries both its original and inverse steps.

**Extension points.** New step ops require a matching `case` here, otherwise undo would silently skip them. The module is deliberately standalone so this inversion logic stays auditable — see §13.1 ("`invert.ts` not in design → Added").

## Schema System

### `src/core/schema/BlockSchema.ts`

**Responsibility.** Defines the structural contract a block type declares so the core can reason about it *without* knowing the type. The core never switches on `block.type`; it asks the schema instead. Provides the spec type, a `defineSchema` normalizer that applies defaults, attr coercion/validation, and pure structural predicates. See `docs/architecture.md` §5.3.

**Public API.**

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
interface BlockSchema { /* same fields, all required, normalized */ }

function defineSchema(spec: BlockSchemaSpec): BlockSchema
function defaultAttrs(schema: BlockSchema): Attrs
function coerceAttrs(schema: BlockSchema, raw: Readonly<Record<string, unknown>>): Attrs
function canContain(parent: BlockSchema, childType: BlockType): boolean
function hasText(schema: BlockSchema): boolean
function isIsolating(schema: BlockSchema): boolean
function isEmpty(schema: BlockSchema, block: Block): boolean
```

The default schema (when a field is omitted) is `content: 'text'`, `nestable: false`, `allowedChildren: '*'`, `isolating: false`, and an `empty` predicate that treats no-content or all-empty-text-runs as empty.

**Interactions.** Depends on `types.ts`. Used by `SchemaRegistry.ts` (which wraps it with type-keyed lookup) and indirectly by `Registry.ts` (`defineSchema` normalizes every extension's spec). Predicates are read by `primitiveCommands.ts` via `SchemaRegistry` to drive Enter/Backspace/split/merge without referencing types.

**Extension points.** A block type extension supplies a `BlockSchemaSpec`; `defineSchema` fills the gaps. Future structural flags (e.g. `inlineContent: 'marks'`, `void: true`) are additive fields on the spec. `allowedChildren` whitelists are how future nested blocks (Toggle, Columns, Callout) constrain their children — see §15.

### `src/core/schema/SchemaRegistry.ts`

**Responsibility.** Maps a `BlockType` to its `BlockSchema`, built once from extensions and frozen. Provides the structural predicates the core uses instead of switching on type names, with a paragraph-like fallback schema for unknown types. See `docs/architecture.md` §5.2.

**Public API.**

```ts
class SchemaRegistry {
  constructor(schemas: ReadonlyMap<BlockType, BlockSchema>, fallback: BlockSchema)
  get(type: BlockType): BlockSchema          // falls back to the paragraph-like default
  has(type: BlockType): boolean
  defaultAttrsFor(type: BlockType): Attrs
  coerceAttrsFor(type: BlockType, raw: Readonly<Record<string, unknown>>): Attrs
  canContain(parentType: BlockType, childType: BlockType): boolean
  hasText(type: BlockType): boolean
  isIsolating(type: BlockType): boolean
  isEmpty(block: Block): boolean
}
```

**Interactions.** Depends on `BlockSchema.ts` (delegates to its pure functions). Constructed by `Registry.ts` (`buildRegistries`) with a `FALLBACK_SCHEMA` of `type: '__fallback__'`. Read heavily by `primitiveCommands.ts` (e.g. `enter` checks `hasText`/`isEmpty`/`isIsolating`; `splitBlock` checks `hasText`) and by `Editor.ts` (`defaultAttrsFor` when seeding an empty document).

**Extension points.** The fallback schema is what lets the core operate even if a block type is missing — useful during dynamic registration. Adding a new block type is "register a schema via an extension"; the registry rebuilds on editor reconfiguration (§5.4).

## Command System

### `src/core/command/Command.ts`

**Responsibility.** Defines the `Command` type (ProseMirror-shaped pure functions: `(args) => (state, dispatch?) => boolean`), the `CommandRegistry` that stores them by name, and a `Proxy`-based command proxy so callers write `editor.commands.insertBlock({...})`. See `docs/architecture.md` §7.1.

**Public API.**

```ts
type Dispatch = (tr: Transaction) => void
type CommandFn<TArgs = void> = (args: TArgs) => (state: EditorState, dispatch?: Dispatch) => boolean
interface CommandEntry<TArgs = void> { readonly name: string; readonly run: CommandFn<TArgs> }
type CommandSpec<TArgs = void> = CommandEntry<TArgs>
type AnyCommandEntry = CommandEntry<any>      // type-erased for the heterogeneous registry
type CommandDispatcher = (name: string, args: unknown) => boolean

class CommandRegistry {
  register(spec: AnyCommandEntry): void       // throws on duplicate name
  override(spec: AnyCommandEntry): void       // replace (extensions override primitives)
  has(name: string): boolean
  get(name: string): AnyCommandEntry | undefined
  createProxy(dispatch: CommandDispatcher): Record<string, (...args: unknown[]) => boolean>
}
```

The proxy returns a function per property access that dispatches the named command; unknown commands resolve to a `() => false` "not handled" function.

**Interactions.** Depends on `EditorState.ts` and `Transaction.ts` (types only). The registry is owned by `Editor.ts`, which registers primitives first, then lets extensions `override` by name, then registers the core `undo`/`redo` commands. The proxy is exposed as `editor.commands`, used by `primitiveCommands.ts` (commands compose other commands, e.g. `enter` calls `insertBlockCommand`/`splitBlockCommand`), the view layer (`BlockContent.vue` calls `editor.commands.setText`), and `keymapHandler.ts`.

**Extension points.** Extensions contribute commands via `Extension.commands`; they are registered after primitives so they can override by name (`Editor` calls `override` when `has(name)` is true). Type safety is preserved at definition sites (`CommandEntry<YourArgs>`) and erased only inside the registry.

### `src/core/command/primitiveCommands.ts`

**Responsibility.** The block-type-agnostic operations the editor core provides. Each is a pure `(args) => (state, dispatch?) => boolean` that builds a transaction using *only* schema predicates (never `block.type` switches). These implement Enter/Backspace/split/merge/navigation/selection using `SchemaRegistry`, so behavior is fully driven by schema. See `docs/architecture.md` §7.3, §11.2, §11.3.

**Public API.**

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

`createPrimitiveCommands` returns entries for: `insertBlock`, `removeBlock`, `replaceBlock`, `setText` (carries `historyGroup('type')` + `skipDomWrite` + `source: 'input'`), `setAttrs`, `splitBlock` (splits text at offset, inserts the `defaultBlockType` after), `mergeBlock` (joins with the previous block in document order), `enter` (split, or insert default block to exit, or insert after a non-text/isolating block), `backspace` (merge at offset 0, delete a within-block range, or remove a blocks selection; respects `isolating`), `moveToPreviousBlock`, `moveToNextBlock`, `setSelection`, `selectBlock`, `moveBlock`, **`setLink`** (applies `{type:'link', attrs:{href: sanitizeUrl(href)}}` mark to `[from,to)` in block `id`; when `text` is provided, replaces the range's literal text with `text` in the same transaction so link text can be rewritten atomically; skips ranges containing a `code` mark since code & link are mutually exclusive), and **`unsetLink`** (strips the `link` mark from `[from,to)`).

**Interactions.** Depends on `types.ts`, `Transaction.ts`, `Command.ts`, `extension/Registry.ts` (`EditorRegistries` for schema + `defaultBlockType`), `state/store.ts` (traversal), and `selection/Selection.ts` (constructors/guards). Registered by `Editor.ts`. The `enter`/`backspace` commands internally compose other primitives (e.g. `enter` calls `insertBlockCommand`/`splitBlockCommand`).

**Extension points.** Block-type-specific commands (e.g. `toggleTodo`, `setHeadingLevel`) compose these primitives and are exposed on the same `editor.commands` proxy. Extensions can `override` any primitive by name. New structural primitives (e.g. `liftBlock`, `wrapBlock` mentioned in §7.3) are added as new entries here, driven entirely by schema predicates.

### `src/core/command/Keymap.ts`

**Responsibility.** Binds normalized keyboard shortcuts to commands. Bindings are ordered by priority; the first match wins. Key names follow ProseMirror conventions (`Mod-Enter`, `Shift-ArrowUp`, `Backspace`), with `Mod` resolved to the actual platform modifier (Cmd on Mac, Ctrl elsewhere). See `docs/architecture.md` §11.1.

**Public API.**

```ts
interface KeymapBinding { readonly key: string; readonly command: string; readonly args?: unknown; readonly priority?: number }
type KeymapSpec = readonly KeymapBinding[]

function keyNameFromEvent(event: KeyboardEvent): string   // e.g. "Cmd-Shift-Z"; "" for bare modifier
function keyMatches(bindingKey: string, eventKey: string): boolean  // resolves Mod, case-insensitive

class KeymapRegistry {
  register(spec: KeymapSpec): void          // re-sorts by priority (lower first)
  resolve(eventKey: string): KeymapBinding | undefined
}
```

`keyNameFromEvent` normalizes aliases (`Esc`→`Escape`, `Left`→`ArrowLeft`, `Space`→` `, etc.) and uppercases single-character keys. Bare modifier presses return `""` (no binding).

**Interactions.** Depends on nothing but the DOM `KeyboardEvent`/`navigator.platform`. The registry is built by `Registry.ts` and owned by `Editor`. `keymapHandler.ts` calls `keyNameFromEvent` then `resolve`; `extensions/Keymap.ts` and `extensions/History.ts` contribute `KeymapSpec`s.

**Extension points.** Extensions add bindings via `Extension.keymap`; lower `priority` numbers run first, so a block type can override a default binding. The `Mod` placeholder plus platform detection means the same spec works on Mac and Windows.

### `src/core/command/InputRule.ts`

**Responsibility.** Defines the input-rule contract: text patterns that trigger a command when typed at the caret (e.g. `# ` → convert to heading). Consumed by `view/ui/inputRulesEngine.ts` which runs registered rules against the current block's text before the caret on each input event. See `docs/architecture.md` §11.

**Public API.**

```ts
interface InputRuleContext { readonly blockId: BlockId; readonly textBeforeCaret: string }
interface InputRuleSpec {
  readonly name: string
  readonly pattern: RegExp                  // must be anchored, e.g. /^# $/
  readonly command: string
  readonly args?: (match: RegExpExecArray) => unknown
}
type InputRule = InputRuleSpec

class InputRuleRegistry {
  register(spec: InputRuleSpec): void
  get all(): readonly InputRule[]
}
```

**Interactions.** Depends on `types.ts` (`BlockId`). The registry is built by `Registry.ts` and carried in `EditorRegistries.inputRules`. The view-layer `inputRulesEngine.ts` iterates `all` against `InputRuleContext` on each input event.

**Extension points.** Extensions contribute rules via `Extension.inputRules`. The `args` builder lets a rule pass captured groups to its command (e.g. heading level from `## `). Markdown shortcuts (`# `, `> `, `[] `, ```` ``` ````) are implemented as input rules.

### `src/core/command/SlashCommand.ts`

**Responsibility.** Defines the slash-command / command-palette contract: entries that appear in the slash menu (`PlusMenu.vue`). The registry provides a `search` method for filtering entries by query.

**Public API.**

```ts
interface SlashCommandSpec {
  readonly id: string
  readonly title: string
  readonly keywords?: readonly string[]
  readonly description?: string
  readonly icon?: unknown
  readonly command: string
  readonly args?: unknown
  readonly applicableTo?: readonly BlockType[]   // restrict to current block types
}
type SlashCommand = SlashCommandSpec

class SlashCommandRegistry {
  register(spec: SlashCommandSpec): void        // throws on duplicate id
  get all(): readonly SlashCommand[]
  search(query: string): readonly SlashCommand[]  // naive substring over title+keywords
}
```

**Interactions.** Depends on `types.ts` (`BlockType`). Built by `Registry.ts`; carried in `EditorRegistries.slash`. `PlusMenu.vue` calls `search` (or `all` when query is empty) and dispatches the matched command on commit.

**Extension points.** Extensions add entries via `Extension.slashCommands`. `applicableTo` lets a command show only for certain block types. The `icon` is an opaque token the view layer interprets, so the core stays UI-agnostic. Refined ranking/fuzzy search can replace `search` without touching extensions.

## Extension System

### `src/core/extension/Extension.ts`

**Responsibility.** The `Extension` contract: the single mechanism by which the editor gains new block types and behaviors. An extension is a plain spec object (produced by a factory) contributed at construction; the core never imports extensions, it only processes their specs into registries. Each field is optional — an extension contributes only what it needs. See `docs/architecture.md` §5.

**Public API.**

```ts
interface BlockRendererSpec { readonly component: unknown; readonly editable?: boolean }  // component is Vue-opaque
interface ToolbarActionSpec { readonly id: string; readonly label: string; readonly command: string; readonly args?: unknown; readonly icon?: unknown }

interface Extension {
  readonly name: string
  readonly uses?: readonly Extension[]            // bundled extensions; flattened, de-duped by name
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

function extensionBlockType(ext: Extension): BlockType | null   // convenience: the declared type, if any
```

`BlockRendererSpec.component` is typed `unknown` so the core stays framework-agnostic; `BlockHost.vue` casts it to a Vue component at the single view-layer boundary.

**Interactions.** Depends (type-only) on `BlockSchema`, `Command`, `InputRule`, `Keymap`, `Plugin`, `SlashCommand`, `Serializer`, and `types`. Consumed by `Registry.ts` (`flattenExtensions` + `buildRegistries`). The built-in extensions (`Paragraph`, `Heading`, `Keymap`, `History`) implement it; user extensions are passed to `Editor` / `BlockEditor.vue`.

**Extension points.** This *is* the extension point. Adding a block type = create an `Extension` with `schema` + `renderer` (+ optional serialize/slash/commands) and pass it to the editor — zero core changes (§5.4, §15). The `uses` graph enables composition (e.g. a "CodeBlock" extension that bundles a `History`-like behavior).

### `src/core/extension/Registry.ts`

**Responsibility.** Flattens an extension list (resolving `uses`, de-duplicating by name with later entries overriding earlier ones) and assembles the frozen, typed registries the editor consults at runtime. Also defines `RendererRegistry` and `ToolbarRegistry` (the two registries not owned by their own modules). See `docs/architecture.md` §5.2, §5.4.

**Public API.**

```ts
class RendererRegistry {
  register(type: BlockType, spec: BlockRendererSpec): void  // throws on duplicate
  get(type: BlockType): BlockRendererSpec | undefined
}
class ToolbarRegistry {
  register(type: BlockType, actions: readonly ToolbarActionSpec[]): void  // appends
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

function flattenExtensions(extensions: readonly Extension[]): Extension[]  // last wins by name
function buildRegistries(extensions: readonly Extension[], options?: BuildRegistriesOptions): EditorRegistries
```

`buildRegistries` iterates the flattened list, normalizing each schema via `defineSchema`, registering renderers/keymaps/input rules/slash commands/toolbar actions/serializers/deserializers/plugins, and collecting extension commands separately (they are registered after primitives so they can override). The fallback schema is `type: '__fallback__'`. `defaultBlockType` defaults to `'paragraph'`.

**Interactions.** Depends on every registry module (`Command`, `InputRule`, `Keymap`, `SlashCommand`, `SchemaRegistry`, `BlockSchema`, `Serializer`) and `Extension.ts`/`Plugin.ts`. Called once by `Editor.ts` in its constructor. The resulting `EditorRegistries` is the central object `primitiveCommands.ts`, `Editor.ts`, and the view layer read from.

**Extension points.** `flattenExtensions`'s "last wins" rule is how user extensions override built-ins with the same `name`. Adding a new registry (e.g. a future `MarkRegistry` for inline formatting) means adding a field to `EditorRegistries`, a class, and a registration loop in `buildRegistries` — localized, no command/core changes.

## Plugin System

### `src/core/plugin/Plugin.ts`

**Responsibility.** The `Plugin` contract. Plugins augment editor behavior at well-defined hooks. They differ from extensions: extensions *declare* blocks/commands/keymaps; plugins *react* to editor lifecycle and events. Plugin state is stored inside `EditorState` (keyed by name) so it is part of the immutable, versioned state — this is what makes undo/redo correct across plugin effects. See `docs/architecture.md` §9.

**Public API.**

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

**Interactions.** Depends (type-only) on `EditorState.ts` and `Transaction.ts`. Plugins are collected by `Registry.ts` into `EditorRegistries.plugins`. `Editor.ts` calls `init` on construction, `applyTransaction` (via `applyTransaction`) on every dispatch, and the `on*` event hooks via `handleKeyDown`/`handleInput`/`handleCompositionStart`/`handleCompositionEnd` (which the view layer invokes). `EditorState.applyTransaction` uses a minimal `TransactionApplier` view of each plugin.

**Extension points.** A future plugin (e.g. InputRules, SelectionSync, Placeholder, decorations) implements this interface and is contributed via `Extension.plugins`. Because plugin state lives in `EditorState`, plugins can derive decorations or signals that participate in undo/redo. The hook set can grow (e.g. `onPaste`, `onScroll`) without breaking existing plugins.

## Selection Model

### `src/core/selection/Selection.ts`

**Responsibility.** Constructors, type guards, and pure helpers for `Selection`. Selection is part of editor state but *separate* from the document (§8). This module never touches the DOM — native-selection sync lives in `view/domSelection.ts`. See `docs/architecture.md` §8.

**Public API.**

```ts
function caretSelection(blockId: BlockId, offset: number): Selection
function textSelection(anchor: Anchor, focus: Anchor): Selection
function blocksSelection(blockIds: readonly BlockId[]): Selection
function isCaret(sel: Selection): sel is Extract<Selection, { kind: 'caret' }>
function isText(sel: Selection): sel is Extract<Selection, { kind: 'text' }>
function isBlocks(sel: Selection): sel is Extract<Selection, { kind: 'blocks' }>
function isCollapsed(sel: Selection): boolean
function primaryBlock(sel: Selection): BlockId | null       // where commands like Enter operate
function focusOffset(sel: Selection): number
function orderedAnchors(sel: Selection, compare: (a: Anchor, b: Anchor) => number): readonly [Anchor, Anchor] | null
```

`primaryBlock` returns the caret's block, the text selection's focus block, or the first selected block. `orderedAnchors` normalizes a text selection so the anchor precedes (or equals) the focus in document order, using a caller-supplied comparator.

**Interactions.** Depends on `types.ts`. Used by `primitiveCommands.ts` (guards + `caretSelection` for selection-after), `Editor.ts` (`caretSelection` for the initial selection), and `view/domSelection.ts` (`caretSelection`, `isCaret`, `isText`).

**Extension points.** The `Selection` union in `types.ts` can grow (e.g. a future `cells` kind for table selection); this module adds matching constructors/guards. `orderedAnchors`'s pluggable comparator lets future multi-block text selection compute deletion ranges without DOM geometry.

## History

### `src/core/history/HistoryManager.ts`

**Responsibility.** Undo/redo via step inversion with grouping. Owned by the `Editor` (not part of `EditorState`) because history is editor-instance state, not document state. Transactions with `meta.addToHistory === false` (selection moves, undo/redo themselves) are not recorded. Consecutive transactions sharing a `historyGroup` key collapse into a single undo entry (used for typing runs). See `docs/architecture.md` §9 and §16.

**Public API.**

```ts
class HistoryManager {
  constructor(limit?: number)                 // default 500 entries
  record(tr: Transaction, prevSelection: Selection, prevDoc: DocState): void
  canUndo(): boolean
  canRedo(): boolean
  reset(): void                               // clears both stacks (used on document replace)
  undo(): Transaction | null                  // builds the inverse transaction; pushes to redo
  redo(): Transaction | null                  // re-applies originals; pushes back to undo
}
```

`record` computes inverses via `invertSteps` and stores both original and inverse per `HistoryItem`. Grouping: if the new transaction's `historyGroup` matches the open top entry's group, the item is appended to that entry; otherwise a new entry is pushed (and the stack is trimmed to `limit`). Any new recorded change clears the redo stack. `undo` applies inverses in reverse order with `addToHistory: false` and `source: 'undo'`; `redo` re-applies originals in forward order.

**Interactions.** Depends on `types.ts`, `Step.ts`, `Transaction.ts` (`createTransaction`), and `invert.ts` (`invertSteps`). Owned by `Editor.ts`, which calls `record` inside `dispatch` and exposes `undo()`/`redo()`/`canUndo()`/`canRedo()`. The `undo`/`redo` core commands (registered in `Editor`) delegate to it.

**Extension points.** `historyGroup` is the meta key that controls granularity — a future "word-boundary" grouping strategy changes only how commands set `historyGroup`. The `limit` and the inversion-based (not snapshot-based) approach keep memory bounded for large documents. A collaboration layer can read the stacks to reconcile remote/local history.

## Serialization

### `src/core/serialize/Serializer.ts`

**Responsibility.** Per-block Markdown/HTML serialization contracts. Canonical JSON import/export is handled centrally by `state/store.ts` (`docFromData`/`docToData`); these specs let each block type contribute Markdown (Phase 2) and HTML (Phase 5) round-trips without core changes. Also defines the `DeserializerRegistry` that tries Markdown-line parsers in registration order.

**Public API.**

```ts
interface SerializeResult { readonly type: BlockType; readonly attrs?: Attrs; readonly content?: InlineSeq }
interface SerializerSpec {
  readonly toMarkdown?: (block: Block) => string
  readonly toHTML?: (block: Block) => string
}
interface DeserializerSpec {
  readonly fromMarkdown?: (line: string) => SerializeResult | null
}

class SerializerRegistry {
  register(type: BlockType, spec: SerializerSpec): void
  markdownFor(block: Block): string | undefined
  htmlFor(block: Block): string | undefined
}
class DeserializerRegistry {
  register(spec: DeserializerSpec): void
  parseMarkdownLine(line: string): SerializeResult | null   // first match wins
}
```

**Interactions.** Depends on `types.ts`. Built by `Registry.ts` (each extension's `serialize`/`deserialize` is registered against its block type). Carried in `EditorRegistries.serializers` / `deserializers`. Consumed by `Editor.toMarkdown()` (block-level Markdown export) and `view/clipboard.ts` (paste: `deserializers.parseMarkdownLine` + `parseHtmlElement`).

**Extension points.** A block-type extension supplies `serialize` (and `deserialize` for paste-from-Markdown). Because parsing is a first-match pipeline, the registration order in `flattenExtensions` determines precedence. HTML round-trips for Phase-5 clipboard add `toHTML`/`fromHTML` (the latter would extend `DeserializerSpec`) without touching the core.

## Editor Facade

### `src/core/Editor.ts`

**Responsibility.** The `Editor` facade: the framework-agnostic core's public surface. It owns the registries, the current `EditorState`, the history manager, the command dispatch, plugin lifecycle, and the subscription/notification fan-out. Core invariants enforced here: state changes ONLY through `dispatch(transaction)`; plugins receive events via typed hooks (the view never calls plugins directly). See `docs/architecture.md` §10 and §13.

**Public API.**

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
  focusBlockId: BlockId | null               // set by the view layer (focused contenteditable)
  constructor(config: EditorConfig)
  getState(): EditorState
  toData(): DocumentData
  setDocument(json: DocumentData): void      // replace wholesale; resets history; re-inits plugins
  toMarkdown(): string                       // export the current document as a Markdown string
  setDocFromMarkdown(markdown: string): void // replace the whole document by parsing Markdown; resets history
  dispatch(tr: Transaction): void            // the single mutation path; records history; notifies
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

function hasBlock(editor: Editor, id: BlockId): boolean  // debugging helper
```

Construction: `buildRegistries`, register primitive commands, let extension commands `override` by name, build the document (seeding an empty default block if root is empty), initialize plugins (`init`), register the core `undo`/`redo` commands (which delegate to `HistoryManager`), and build the command proxy. `dispatch` runs `applyTransaction`, records the transaction in history, and notifies subscribers with the diff. `setDocument` rebuilds state and calls `history.reset()`.

**Interactions.** Depends on `store.ts`, `EditorState.ts`, `Transaction.ts`, `Registry.ts`, `primitiveCommands.ts`, `Command.ts`, `Plugin.ts`, `HistoryManager.ts`, `Selection.ts`, `ids.ts`, and `types.ts`. The view layer (`BlockEditor.vue`) constructs it, subscribes to it, routes keyboard/input/composition events to its `handle*` methods, and reads `editor.commands` / `editor.registries` / `editor.focusBlockId`.

**Extension points.** Extensions are the only configuration surface (`EditorConfig.extensions` plus `defaultBlockType`/`historyLimit`). The `focusBlockId` field is the contract the view layer writes so plugins (via `EventContext.focusBlockId`) know which block is focused. A future headless/server usage would construct `Editor` directly without the Vue components.

### `src/core/index.ts`

**Responsibility.** The core barrel: the public surface of the framework-agnostic engine. Re-exports every type, function, and class from the core modules so the view layer, extensions, and consumers import from a single path. Nothing in this barrel imports Vue.

**Public API.** Re-exports from: `types` (all types + helpers), `ids` (`createBlockId`, `asBlockId`), `schema/BlockSchema` (`defineSchema`, `defaultAttrs`, `coerceAttrs`, `canContain`, `hasText`, `isIsolating`, `isEmpty`, `SchemaRegistry`), `state/store` (all), `state/Step` (`Step`, `applySteps`, `ApplyResult`), `state/EditorState` (`createState`, `applyTransaction`, `EditorState`, `ApplyTransactionResult`), `state/Transaction` (`createTransaction`, `TransactionBuilder`, `Transaction`, `TransactionMeta`, `InsertBlockParams`), `state/invert` (`invertSteps`), `selection/Selection` (all), `command/Command` (types + `CommandRegistry`), `command/primitiveCommands` (`createPrimitiveCommands`), `command/Keymap` (types + `KeymapRegistry`, `keyNameFromEvent`, `keyMatches`), `command/InputRule` (types + `InputRuleRegistry`), `command/SlashCommand` (types + `SlashCommandRegistry`), `serialize/Serializer` (types + registries), `plugin/Plugin` (types), `extension/Extension` (types + `extensionBlockType`), `extension/Registry` (`flattenExtensions`, `buildRegistries`, `EditorRegistries`, `RendererRegistry`, `ToolbarRegistry`, `BuildRegistriesOptions`), `history/HistoryManager` (`HistoryManager`), and `Editor` (`Editor`, `EditorConfig`, `StateUpdate`, `EditorListener`).

**Interactions.** Imported by `src/index.ts` (the package entry), the view layer, and the extensions.

**Extension points.** Adding a new core module means adding its re-export here; this is the only file that must change to expose a new core capability publicly.

## View Layer

### `src/view/context.ts`

**Responsibility.** View-layer shared context and types. Provides the framework-agnostic `Editor` instance to child components via Vue's provide/inject (`editorKey` / `useEditor`), and defines `BlockRenderItem`, the DTO passed from `BlockEditor` to `BlockList`. The editor is provided as a non-reactive value — components that need to react to state changes subscribe via `editor.subscribe()`, keeping the editor's internal state outside Vue's reactivity system (avoiding deep-reactivity overhead on large documents). See `docs/architecture.md` §6.2.

**Public API.**

```ts
const editorKey: InjectionKey<Editor>
interface BlockRenderItem { readonly id: BlockId; readonly block: Block }
function useEditor(): Editor  // throws if called outside a <BlockEditor> tree
```

`BlockRenderItem` carries the id separately from `block` so `BlockList` can use it as a `:key` without reaching into the block object. The type lives here (not in a `.vue` file) because TypeScript's `*.vue` module shim only declares a default export, making named type re-exports from `.vue` files impossible.

**Interactions.** Depends on `vue` (`InjectionKey`, `inject`) and `core/Editor` + `core/types` (types only). `BlockEditor.vue` provides the editor; `BlockHost.vue`, `BlockContent.vue`, and `keymapHandler.ts`-adjacent consumers call `useEditor()`.

**Extension points.** A future `useBlock(blockId)` composable (per-block subscription returning a `BlockSnapshot` shallow ref) would live here, restoring the design's per-block subscription seam (§13.1 notes it was unnecessary for Phase 1).

### `src/view/BlockEditor.vue`

**Responsibility.** The public root editor component. Constructs the `Editor` from extensions + initial document, maintains a `shallowRef<EditorState>` that triggers Vue reactivity only at the top level (no deep reactivity), provides the editor to children, handles keyboard events (sync DOM selection → state, then dispatch keymap commands), applies state selection changes → DOM (after `nextTick`), emits `update:modelValue`, and focuses the first block on mount. Also owns i18n/theme: normalizes `locale`/`theme` props into reactive refs, provides them via `provideI18n()`, and syncs the theme class to `<body>` so `<Teleport>`-ed popovers inherit CSS variables. **Phase-6 additions here:** (1) handles `Mod+K` shortcut for links — opens the link popover in edit mode for the current selection or, if the caret sits inside an existing link, in view mode; (2) owns the `<LinkPopover>` mount and its state (view vs edit mode, target link range, anchor rect from `LinkClickEvent` or native selection rect); (3) exposes the `uploadImage` prop as an optional external upload hook (S3/OSS/…); when missing, falls back to the built-in mock uploader in `imageUpload.ts`; (4) in every `applyTransaction` subscription, scans the `changed + removed` diff blocks for before/after `fileId` attr values, maintains a per-`fileId` refcount, and emits `cleanup:image-file` when a `fileId`'s refcount drops from ≥1 to 0 (so hosts can purge unreferenced storage objects). See `docs/architecture.md` §6.1, §6.2, §14 (Phase 6).

**Public API (props/emits/expose).**

```ts
props: {
  extensions?: readonly Extension[]        // default BuiltinExtensions (14 extensions, including Image/Table/Divider/Equation/TableOfContents)
  modelValue?: DocumentData                // default { blocks: [] }
  editable?: boolean                       // default true
  placeholder?: string                     // default locale-aware ("输入文字，或按 '/' 获取命令…" / "Type '/' for commands…")
  theme?: 'light' | 'dark'                 // default 'light'
  locale?: 'zh-CN' | 'en-US'               // default 'zh-CN'; any non-empty non-'zh-CN' value ⇒ 'en-US'
  // — Sizing (optional): a number is interpreted as CSS pixels; a string is used as-is —
  width?: string | number                  // default undefined (fills container, width: 100%)
  height?: string | number                 // default undefined (grows with content; host page scrolls)
  // — Toolbar placement (FixedToolbar): 'auto' = top on desktop / bottom on mobile.
  //   'float' (desktop only) hides the FixedToolbar and renders a floating
  //   HoverToolbar that follows the text selection; falls back to 'auto' on mobile.
  toolbarPosition?: 'auto' | 'top' | 'bottom' | 'float'    // default 'auto'
  // — Image upload hook (optional; see src/view/imageUpload.ts) —
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
  // — Phase 6: fileId cleanup (host app deletes unreferenced storage objects) —
  'cleanup:image-file': [{ fileId: string }]
}
expose: { editor: Editor }
```

The `suppressSelectionSync` flag prevents feedback loops: when the DOM selection is read and dispatched to state, the subscribe callback must NOT write it back to the DOM. `renderItems` is a `computed` mapping `doc.root` → `BlockRenderItem[]`. `onKeyDown` calls `syncSelectionFromDom()` (reads the native selection into state with `addToHistory: false`) then `dispatchKeymap`; if handled, `preventDefault()`. Mod+K is handled inside `BlockEditor.vue` itself (not via the keymap registry) because it bridges selection state, the link mark, and the floating UI — a pure keymap command could not open the popover.

**Interactions.** Imports `vue`, `core/Editor`, `core/extension/Extension`, `core/types`, `core/state/EditorState`, `core/state/Transaction`, `view/context` (`editorKey`, `BlockRenderItem`), `view/keymapHandler` (`dispatchKeymap`), `view/domSelection` (`readDomSelection`, `applySelectionToDom`), `view/inlineDom`, `view/clipboard`, **`view/imageUpload`** (subscribes/unsubscribes transient upload states, owns the fileId→refcount map, invokes `uploadImage` prop or mock), **`view/urlUtils`** (`sanitizeUrl` guards href in link popover save path), `i18n` (`provideI18n`, `useI18n`, `normalizeLocale`, `normalizeTheme`), `BlockList.vue` + 8 popup components (`PlusMenu`, `BlockSettingsMenu`, `HoverToolbar`, `OrderedListMenu`, `NumberPicker`, `CodeLangPicker`, **`LinkPopover`**). Subscribes to the editor; on unmount it unsubscribes, revokes any outstanding temporary object URLs from `imageUpload`, and calls `editor.destroy()`.

**Extension points.** This component is the sole reactivity boundary (the design's `ViewBridge` was folded into it — §13.1). If the view layer grows, the bridge can be extracted without changing the core. A virtualized list swap replaces `BlockList` only. The `theme`/`locale` props flow through provide/inject so all child components (including `<Teleport>`-ed popovers) can access `t(key)` reactively.

### `src/view/BlockList.vue`

**Responsibility.** Renders a list of blocks **recursively**: it renders each block, then re-renders itself for that block's `children` (wrapped in a `.block-children` container with its own indent), so the whole nesting tree displays with proper indentation. Phase 1 rendered a flat list (`doc.root`); the authoritative nesting is `Block.children` (`DocState.parent`), with `attrs.indent` only a derived shadow. When nested (`is-nested`), it disables the root-only drop indicators and the first-block placeholder. Uses `:key="item.id"` so Vue reuses component instances across re-renders; because block objects maintain referential identity (structural sharing), unchanged blocks don't trigger `BlockHost` re-renders. This is the **virtualization seam** — the single component that decides which blocks are mounted; a virtualized implementation can drop in later without touching block components. See `docs/architecture.md` §6.1, §12.

**Public API (props).**

```ts
props: {
  items: readonly BlockRenderItem[]
  blocksMap: ReadonlyMap<BlockId, Block>   // full blocks view; nested lists resolve child snapshots
  firstBlockPlaceholder?: string           // shown only on the first (root) block
  isNested?: boolean                       // true for recursively-rendered child lists
  hoveredBlockId: BlockId | null           // forwarded so handles show/hide correctly
  focusedBlockId: BlockId | null
  hasTextSelection?: boolean
  draggingBlockId?: BlockId | null
  dropTargetBlockId?: BlockId | null
  dropPosition?: 'before' | 'after' | 'first' | 'last' | 'into'
  menuOpenBlockId?: BlockId | null
}
```

All props and events are forwarded verbatim to the recursively-rendered nested lists so every `BlockHost` in the tree participates in the same hover / drag / drop / selection / menu system.

**Interactions.** Imports `BlockHost.vue` and `view/context` (`BlockRenderItem`). Rendered by `BlockEditor.vue`. Passes each `block` (and the first-block placeholder) to `BlockHost`.

**Extension points.** A `VirtualizedBlockList` can replace this component without touching `BlockHost` or block renderers — block components are kept side-effect-free and idempotent so virtualization is safe (§12), and the recursive nested lists reuse the same `BlockRenderItem` shape.

### `src/view/BlockHost.vue`

**Responsibility.** Resolves the renderer component for a block type and renders it. This is the bridge between the extension system (which registers renderers) and the view layer: it looks up the `BlockRendererSpec` for the block's type and dynamically renders the associated Vue component, passing the `block` as a prop. If no renderer is registered, it falls back to `BlockContent` directly. Additionally, it listens for `linkClick` events bubbling up from `BlockContent` (or extension renderers that render an inline `<a>`) and re-emits them upward, so the single `BlockEditor` instance can open the link popover without every block renderer registering its own listener. See `docs/architecture.md` §6.1 and Phase 6.

**Public API (props/events).**

```ts
props: { block: Block; placeholder?: string }
emits: { 'linkClick': [{ blockId: BlockId; href: string; from: number; to: number; clientRect: { left: number; top: number; right: number; bottom: number } }] }
```

`resolvedComponent` is a `computed` that reads `editor.registries.renderers.get(block.type)` and casts the opaque `component` to a Vue `Component` — the single boundary where the view layer interprets the framework-agnostic spec. The host wraps the renderer in a `.block-host` div carrying `data-block-type`.

**Interactions.** Imports `vue` (`computed`, `Component`), `core/types`, `view/context` (`useEditor`), and `BlockContent.vue` (fallback). Rendered by `BlockList.vue`; renders the extension-supplied component (e.g. `ParagraphBlock`, `HeadingBlock`) which in turn renders `BlockContent`. The `linkClick` event forwarded here is consumed by `BlockEditor.vue` to position the `LinkPopover` over the clicked `<a>`.

**Extension points.** A new block type just registers a renderer via its extension; `BlockHost` resolves it with no code change. Future `nodeView` factories (for fully custom interactive blocks like Database) would be interpreted here as well.

### `src/view/BlockContent.vue`

**Responsibility.** The per-block contenteditable component — the most delicate view-layer piece. Owns a single `contenteditable` element and is responsible for: rendering the block's inline content as DOM text *with mark spans* (including `<a>` elements for the `link` mark, all hrefs sanitized by `inlineDom.ts`), syncing user input back to state via the `setText` command, correctly handling IME (CJK) composition (no sync during composition; the DOM is the source of truth), tracking focus, showing a placeholder when empty, **(Phase 6 link features)** detecting clicks on inline `<a>` descendants and emitting `linkClick` so `BlockEditor.vue` can open the popover anchored to the exact click rectangle, auto-linking URLs on space/word-break (when the user types a space after what `looksLikeUrl` detected, replaces the current inline seq with `autoLinkInlineSeq(output)` via `setText`), and auto-linking when a plain-text URL is pasted over a text selection. Key invariant: it NEVER writes text to the DOM while the user is typing (the `skipDomWrite` transaction meta + the `textContent !== newText` guard protect the caret). See `docs/architecture.md` §6.3 and Phase 6.

**Public API (props/events).**

```ts
props: { block: Block; placeholder?: string }
// DOM: contenteditable="true", data-block-id, data-empty, data-placeholder
// events: @input, @compositionstart, @compositionend, @focus, @blur
// emits: 'linkClick' ({ blockId, href, from, to, clientRect })
```

On `input` (outside composition) it first applies `autoLinkInlineSeq(newSeq)` to detect URLs the user just finished typing, then dispatches `editor.commands.setText({ id, content: seq })` — `setText` carries `historyGroup('type')` and `skipDomWrite([id])` so the view bridge does not write back to the focused element. On `compositionend` it dispatches one `setText`. `onFocus`/`onBlur` set/clear `editor.focusBlockId`. A `watch` on `props.block` writes new text to the DOM only if it differs and the block is not composing. Clicks: the contenteditable's `onClick` walks `event.target.closest('a')`; if found it computes the model offset of that `<a>` within the block's current inline seq, and emits `linkClick` with the click bounding rect so the popover can position itself.

**Interactions.** Imports `vue`, `core/types` (`inlineText`, `inlineFromString`), **`view/urlUtils`** (`autoLinkInlineSeq`), and `view/context` (`useEditor`). Rendered by `BlockHost.vue` (and directly as the fallback). Reads/writes `editor.focusBlockId`; calls `editor.commands.setText`. The `data-block-id` attribute is what `domSelection.ts` uses to map DOM nodes to block ids. Paste handling: `clipboard.ts` is the canonical path (see its module entry) via `BlockEditor.vue`, which can also upgrade a URL paste to a link mark.

**Extension points.** When new inline marks or non-text inline atoms (mention, equation) arrive, this component renders them via the same `inlineDom.ts` pipeline (which already handles mark spans); no other changes needed here. The IME-guard contract and the `skipDomWrite` meta are the stable seams that keep caret placement correct during rich-text rendering.

### `src/view/domSelection.ts`

**Responsibility.** DOM selection ↔ editor-state selection sync. The native browser selection operates on DOM nodes/ranges; the editor's model operates on block ids + character offsets. This module bridges the two. Strategy (flat blocks, rich-text content): each contenteditable carries `data-block-id`; character offsets are computed by walking text nodes; sync is **just-in-time** (read before dispatching a command, write after a state update) — it does NOT listen to `selectionchange` (too noisy, creates feedback loops). Also provides cross-block text selection rect computation for the selection overlay. See `docs/architecture.md` §8.2.

**Public API.**

```ts
function findBlockEl(root: HTMLElement, id: BlockId): HTMLElement | null
function readDomSelection(root: HTMLElement, doc: DocState): Selection | null
function applySelectionToDom(root: HTMLElement, selection: Selection): void
function positionFromPoint(root: HTMLElement, x: number, y: number): { blockId: BlockId; offset: number } | null
function crossBlockSelectionRects(root: HTMLElement, selection: Selection): DOMRect[]
function isCrossBlockText(selection: Selection): boolean
```

`readDomSelection` walks up from the selection's end node to find the nearest `[data-block-id]` ancestor, computes the caret offset by cloning a range to the element start, clamps it to the block's text length, and returns a `caret` (or a single-block `text` selection when non-collapsed within one block). `applySelectionToDom` focuses the target block's element and places the caret via `setCaretInElement`. `crossBlockSelectionRects` computes the per-line rectangles spanning multiple blocks for the selection overlay rendered by `BlockEditor.vue`.

**Interactions.** Depends on `core/types` (`BlockId`, `Selection`, `DocState`, `inlineText`) and `core/selection/Selection` (`caretSelection`, `isCaret`, `isText`). Used by `BlockEditor.vue` (`readDomSelection` in `syncSelectionFromDom`, `applySelectionToDom` on mount and in the subscribe callback, `crossBlockSelectionRects` for the overlay). The `data-block-id` attribute is written by `BlockContent.vue`.

**Extension points.** Block-selection rendering (CSS classes on `BlockHost`s) is a separate concern that will read `isBlocks(selection)`.

### `src/view/inlineDom.ts`

**Responsibility.** Bridges the `InlineSeq` model (text runs with optional marks) and the DOM. Converts inline sequences to HTML for rendering (via `inlineToHtml`) and parses DOM nodes back into inline sequences (via `inlineFromDom`). Used by `BlockContent.vue` for rendering and `clipboard.ts` for paste parsing. **Phase 6 (links):** `inlineToHtml` renders the `link` mark as `<a href="…">` — **href is always piped through `sanitizeUrl()` from `urlUtils.ts`**, so dangerous schemes (`javascript:`, `data:`, `vbscript:`) and obfuscated URLs never hit the DOM (they render as plain `<span>` without href). Conversely, `inlineFromDom` collects `<a href>` attributes and converts them back into `{ type: 'link', attrs: { href: normalizeUrl(rawHref) } }` marks.

**Public API.**

```ts
function inlineToHtml(content: InlineSeq): string
function inlineFromDom(node: Node, opts?: { trim?: boolean }): InlineSeq
```

`inlineToHtml` maps each mark type to its semantic HTML tag (`<b>`, `<i>`, `<u>`, `<s>`, `<code>`, **`<a href=sanitizeUrl(attrs.href)>` for `link`**) and applies color/background-color classes. `inlineFromDom` walks DOM text nodes and element children, reconstructing `InlineSeq` runs with marks.

**Interactions.** Depends on `core/types` (`InlineSeq`, `InlineNode`, `Mark`) and **`view/urlUtils` (`sanitizeUrl`, `normalizeUrl`)**. Used by `BlockContent.vue` (render), `clipboard.ts` (paste), and `BlockEditor.vue` (copy/cut event handlers).

### `src/view/clipboard.ts`

**Responsibility.** Clipboard parsing for copy/cut/paste. Converts pasted HTML or plain text into `ParsedBlock[]` (block-type + attrs + inline content), and serializes editor blocks into clean HTML/plain-text for the clipboard. Strips whitespace-only text nodes, trims leading/trailing whitespace per block (non-code), and avoids extra newlines. **Phase 6 additions:** (1) If paste's `clipboardData.files` contains image types (`image/png`, `image/jpeg`, …) → return a special `ParsedBlock` of type `'image'` with a transient `_pendingFile` field (never stored in attrs; passed to `imageUpload.ts` for uploading) — the paste path in `BlockEditor.vue` inserts a new image block per file and starts upload. (2) If pasted HTML contains a `<img>` (standalone or within `<figure>`), return a `ParsedBlock` with `type='image'` and `attrs.src` set from the `src` attribute. (3) If the user has a non-empty text selection and pastes plain text that `looksLikeUrl(text)` → return a structured hint `{ wrapSelectionInLink: true, href }` and `BlockEditor.vue` dispatches `setLink` instead of pasting text. (4) Plain-text clipboard paragraphs that contain URLs receive `autoLinkInlineSeq` so a paste of e.g. "Visit https://example.com" becomes a link automatically.

**Public API.**

```ts
interface ParsedBlock {
  type: BlockType
  attrs?: Attrs
  content: InlineSeq
  // — Phase 6 transient, never written into DocState —
  readonly _pendingFile?: File           // clipboard image file (uploaded via imageUpload pipeline)
}
interface PasteDecision {
  blocks?: ParsedBlock[]
  wrapSelectionInLink?: { href: string } // when non-empty selection + URL text paste
}

function parseClipboardHtml(html: string): ParsedBlock[]
function parseClipboardText(text: string): ParsedBlock[]
function blocksToClipboardHtml(blocks: readonly Block[]): string
function blocksToClipboardText(blocks: readonly Block[]): string
```

**Interactions.** Depends on `core/types` (`Block`, `InlineSeq`), `view/inlineDom` (`inlineFromDom`, `inlineToHtml`), **`view/urlUtils` (`looksLikeUrl`, `autoLinkInlineSeq`)**. Used by `BlockEditor.vue`'s `onCopy`/`onCut`/`onPaste` handlers, which intercept clipboard events to write clean data-model HTML/text instead of the browser's default DOM serialization and which dispatch image-block insertion or link-mark setting for the special Phase-6 cases above.

**Extension points.** Custom block types can contribute deserializers via `Extension.deserialize` to handle type-specific paste (e.g. parsing a `<pre>` into a `codeBlock`).

### `src/view/imageUpload.ts`

**Responsibility.** Transient side-channel for image-block upload state. The block-model's `attrs` only stores fields that should persist across saves/undo/redo (`src`, `fileId`, `alt`, `title`, `caption`, `width`, `height`). Per-block upload status, progress percent, upload error, and temporary object URLs (`tempSrc`) are **runtime-only** and live here. This module is also the single place where `uploadImage` prop (external) vs built-in mock upload is resolved.

**Public API.**

```ts
type UploadStatus = 'idle' | 'uploading' | 'done' | 'error'
interface ImageUploadState {
  readonly status: UploadStatus
  readonly progress: number         // 0..100
  readonly error?: string
  readonly tempSrc?: string         // URL.createObjectURL(file); revoked on done/error
}

interface ImageUploadStore {
  readonly state: Readonly<Record<string, ImageUploadState>> // key = blockId
  subscribe(blockId: BlockId, cb: (s: ImageUploadState) => void): () => void
  beginUpload(blockId: BlockId, file: File, handlers: {
    onProgress(pct: number): void
    resolve(result: { src: string; fileId?: string; alt?: string; title?: string; caption?: string; width?: number; height?: number }): void
    reject(err: Error): void
  }): void
  retry(blockId: BlockId): void        // retries the cached file (rejects if none cached)
  cancel(blockId: BlockId): void       // revokes temp URL, clears state
  clearBlock(blockId: BlockId): void   // called when block is removed / replaced
}

export const imageUploadStore: ImageUploadStore
export function setUploadHook(hook: BlockEditorProps['uploadImage']): void
```

If no `uploadImage` prop is given, a built-in mock uploader is used: it waits 800–2500 ms, emits fake progress ticks, and ~30% of the time rejects — so retry/error UI can be developed and tested without a backend. On `beginUpload`, the `tempSrc` object URL is created and pushed to state so `Image.ts` can render it immediately; on `resolve` the caller (BlockEditor) dispatches `setAttrs` to write the real `src`/`fileId` and then calls `cancel(blockId)` to revoke. On `reject` the error string is kept in state plus the cached `File`, so the user can click **Retry** on the image overlay.

**Interactions.** Depends only on `core/types` (for the `BlockId` brand). Used by `BlockEditor.vue` (it calls `setUploadHook(props.uploadImage)` when the prop changes, and on every image-block insert with a file it calls `beginUpload` then on resolve dispatches the attrs transaction and on emit `cleanup:image-file` when fileId refcount drops). The `extensions/Image.ts` renderer subscribes to `state[blockId]` to drive the progress bar, error banner, and retry button.

**Extension points.** External hosts can provide their own `uploadImage` prop (S3 upload via signed URL, OSS, etc.) without modifying this module. The transient-state pattern here is generalizable to other block types that require async side-effects but must not persist intermediate states (e.g. Attachment uploads, Embeds fetching oEmbed metadata).

### `src/view/urlUtils.ts`

**Responsibility.** URL helpers that every link-related path calls. Provides three related but distinct concerns: (a) heuristic detection ("does this text look like a URL?"), (b) normalization (adding `https://` when missing, trimming trailing punctuation), and (c) **security sanitization** that returns the empty string for dangerous URLs (so callers can safely omit `href` instead of rendering poisoned anchors). Also exposes `autoLinkInlineSeq`, which scans a `InlineSeq` for text runs that look like URLs and automatically applies a `link` mark — the canonical call sites are `BlockContent.vue` (space-triggered auto-link while typing) and `clipboard.ts` (pasted plain text paragraphs).

**Public API.**

```ts
function looksLikeUrl(text: string): boolean
function normalizeUrl(text: string): string
function sanitizeUrl(raw: string): string  // returns "" on unsafe/missing scheme

// InlineSeq transformer: text runs without a 'link' or 'code' mark → split at URL boundaries
// and wrap URL segments in a {type:'link', attrs:{ href: sanitizeUrl(match) }} mark.
// Returns seq unchanged if no matches.
function autoLinkInlineSeq(seq: InlineSeq): InlineSeq
```

`looksLikeUrl` matches: absolute schemes `https?://`, `mailto:`, `tel:`; bare `www.` prefix (→ normalized to `https://www.`); emails matching `user@domain.tld` (→ normalized to `mailto:user@domain.tld`). It deliberately avoids matching anything inside a `code` mark. `sanitizeUrl` whitelists only `http https mailto tel`, removes `\t\n\r` mid-URL, rejects schemes with non-ASCII letters, and strips whitespace — the result is either empty or guaranteed to have a whitelisted scheme and no obvious obfuscation. Caller rule: **if `sanitizeUrl` returns `""`, treat the link as having no href** (do not write `href` to DOM).

**Interactions.** Depends only on `core/types` (`InlineSeq`, `InlineNode`, `Mark`). Used by `primitiveCommands.ts` (`setLink` sanitizes href), `inlineDom.ts` (render), `clipboard.ts` (URL paste detection + auto-link), `BlockContent.vue` (space-triggered auto-link), `LinkPopover.vue` (onSave validates href + displays sanitized URL), `BlockEditor.vue` (Mod+K save path).

### `src/view/ui/LinkPopover.vue`

**Responsibility.** Floating popover (`<Teleport>`-ed to `<body>`) that lets users view/edit/remove a link, similar to Notion/Google Docs. Has two modes: `view` and `edit`. Appears anchored to a native DOM rectangle (either the user's current text selection `getBoundingClientRect()`, or the click rectangle of an existing `<a>` element). The popover is controlled imperatively by `BlockEditor.vue` which holds `mode`, `href`, `text`, `blockId`, `from`, `to`, and `anchorRect` refs — this component is purely presentational and emits `open-link`, `copy-link`, `edit`, `remove`, `save({ href, text })`, and `cancel` events.

**Public API (props/emits).**

```ts
props: {
  visible: boolean
  mode: 'view' | 'edit'
  href: string                    // current sanitized href
  text: string                    // current visible link text (for editable copy)
  anchor: { left: number; top: number; right: number; bottom: number } | null
}
emits: {
  'open-link': [string]           // Open external URL. The popover also renders its own
                                  // safe <a target="_blank" rel="noopener noreferrer"> so
                                  // middle-click/right-click work; the emit is for analytics.
  'copy-link': [string]           // → BlockEditor writes href to clipboard + shows toast
  'edit': []                      // switch mode to 'edit'
  'remove': []                    // → editor.commands.unsetLink
  'save': [{ href: string; text?: string }]
  'cancel': []
}
```

In `view` mode it renders: a clickable `<a :href="sanitizeUrl(currentHref)">` with URL display, and four buttons (`Open`, `Copy link`, `Edit link`, `Remove link`). In `edit` mode it renders two inputs: `href` (placeholder `https://…`, auto-normalizes on blur via `normalizeUrl`) and `text` (optional; default value is current link text so user can override). Save is disabled while `sanitizeUrl(hrefInput.value) === ''`. The popover uses `view/ui/popup.ts` helpers to flip above/below the anchor when it would overflow the viewport.

**Interactions.** Imports `vue`, `view/urlUtils` (`sanitizeUrl`, `normalizeUrl`), `i18n` (`useI18n`). Rendered inside `BlockEditor.vue`'s template (Teleport to body). Events are handled by `BlockEditor.vue`: `edit` → switch mode; `remove` → `editor.commands.unsetLink` then hide; `save({ href, text })` → `editor.commands.setLink({ id, href, from, to, text })` then hide; `copy-link` → `navigator.clipboard.writeText(href)`; `cancel` / Escape → hide.

**Extension points.** The same popover shape could be reused to edit any mark with attributes (e.g. to pick a custom color, or to edit a `mention` target) by generalizing its props, but keeping it a dedicated component keeps the link UX behavior precise and easy to audit.

### `src/view/ui/FixedToolbar.vue`

**Responsibility.** Persistent action bar visible on **both desktop and mobile** — replaces the old mobile-only `MobileToolbar`. The `toolbarPosition` prop controls placement:
- `'auto'` (default): top on desktop, bottom on mobile (stays above the virtual keyboard via the `visualViewport` API; uses `env(safe-area-inset-bottom)` for iPhone home-indicator spacing).
- `'top'`: force top. Menus (PlusMenu, BlockSettingsMenu) open **downward**.
- `'bottom'`: force bottom. Menus open **upward**.
- `'float'`: **desktop only** — the FixedToolbar is hidden and `BlockEditor.vue` renders a standalone floating `HoverToolbar` (teleported to `<body>`, follows the text/table selection) instead. On mobile (`(pointer: coarse)`), `'float'` falls back to `'auto'`.

Embeds a single `<HoverToolbar>` instance **inline** (instead of rendering it as a floating overlay) so text-selection state is preserved when the user clicks formatting buttons. Left side: plus button (opens `PlusMenu`) and grip button (opens `BlockSettingsMenu`). Right side: the full `HoverToolbar` button set (type / align / marks / color / copy / table ops / link ops). Provides two injection keys that downstream menus consume to decide popup direction:
- `fixedToolbarBottomKey: Ref<boolean>` — `true` when the toolbar is pinned to the bottom.
- `fixedToolbarBridgeKey: Ref<FixedToolbarDescriptor | null>` — passed to the embedded HoverToolbar so it knows what block type / attrs to show actions for.

**Interactions.** Imports `vue`, `HoverToolbar.vue`, `i18n` (`useI18n`), and `view/context` (`useEditor`, `fixedToolbarBridgeKey`, `fixedToolbarBottomKey`). Rendered **conditionally** inside `BlockEditor.vue`'s template: it is skipped when `toolbarPosition='float'` on desktop (a floating `HoverToolbar` is rendered in its place; on mobile `'float'` falls back to `'auto'` and the FixedToolbar still renders). Emits events that `BlockEditor.vue` wires to the same `onOpenPlusMenu` / `onOpenSettingsMenu` handlers used by the desktop `BlockHandle.vue`. When a table cell is focused, `TableBlock` publishes a descriptor via the `fixedToolbarBridgeKey` injection key so the embedded `HoverToolbar` reflects cell/table state instead of text-block state.

**Extension points.** The toolbar descriptor source is pluggable via the `fixedToolbarBridgeKey` injection key, so future block types with custom selection state (e.g. a database block) can feed their own actions into the fixed toolbar without modifying `FixedToolbar.vue`. The position auto-detection is isolated inside the component so external callers can override behavior purely via the `toolbarPosition` prop.

### `src/view/keymapHandler.ts`

**Responsibility.** Keyboard-event router: resolves a `KeyboardEvent` against the keymap registry and dispatches the bound command. Selection sync (DOM → state) is handled by the caller (`BlockEditor.vue`) *before* invoking this function, so commands receive an up-to-date selection. See `docs/architecture.md` §11.1.

**Public API.**

```ts
function dispatchKeymap(editor: Editor, event: KeyboardEvent): boolean
```

Returns `true` if a binding matched and the command returned `true` (handled); the caller should `preventDefault()` in that case. Flow: `keyNameFromEvent(event)` → `editor.registries.keymap.resolve(key)` → `editor.commands[binding.command](binding.args)`.

**Interactions.** Depends on `core/Editor` and `core/command/Keymap` (`keyNameFromEvent`). Called by `BlockEditor.vue`'s `onKeyDown` after `syncSelectionFromDom`.

**Extension points.** The resolution order (registry priority sort) is owned by `KeymapRegistry`; this handler is intentionally trivial so that per-type or block-selection keymap layers can be inserted by registering bindings with lower priority rather than changing the router.

## Built-in Extensions

### `src/extensions/Paragraph.ts`

**Responsibility.** The Paragraph block-type extension — the default text block. Registers the `"paragraph"` block type with a `content: 'text'`, nestable schema (paragraph can be a parent, so any block can be tab-indented under it) and a simple renderer (`ParagraphBlock`) that wraps `BlockContent` with a `block-paragraph` CSS class. Paragraph is the fallback block type used when the user presses Enter on an empty block or exits a non-text block. See `docs/architecture.md` §11.2 (default block type).

**Public API.**

```ts
export const ParagraphExtension: Extension
// schema: { type: 'paragraph', content: 'text', nestable: true }
// renderer: { component: ParagraphBlock }
```

`ParagraphBlock` is a `defineComponent` that renders `h(BlockContent, { block, placeholder, class: 'block-paragraph' })`.

**Interactions.** Imports `vue`, `core/extension/Extension`, `core/types`, and `view/BlockContent.vue`. Bundled in `builtin.ts`. Its schema is registered by `Registry.ts`; its renderer is resolved by `BlockHost.vue`. `Editor.ts` uses `'paragraph'` as the `defaultBlockType` when none is configured.

**Extension points.** A user can override Paragraph by passing an extension with `name: 'paragraph'` (last wins in `flattenExtensions`). Markdown shortcuts (`# `, `> `, etc.) convert other block types into Paragraph when exiting.

### `src/extensions/Heading.ts`

**Responsibility.** The Heading block-type extension for h1–h6. The `level` attr (1–6, validated) determines the visual size; the renderer (`HeadingBlock`) wraps `BlockContent` with `block-heading block-heading-h${level}` CSS classes. The heading schema is `nestable: true` (headings can be parents). Markdown shortcuts (`# `, `## `, …) and slash-menu entries are contributed by this extension.

**Public API.**

```ts
export const HeadingExtension: Extension
// schema: { type: 'heading', content: 'text', nestable: true,
//   attrs: { level: { default: 1, validate: v => typeof v === 'number' && v >= 1 && v <= 6 } } }
// renderer: { component: HeadingBlock }
```

`HeadingBlock` reads `block.attrs.level ?? 1` and renders `h(BlockContent, { block, placeholder, class: \`block-heading block-heading-h${level}\` })`.

**Interactions.** Imports `vue`, `core/extension/Extension`, `core/types`, and `view/BlockContent.vue`. Bundled in `builtin.ts`. Its `level` attr validation is exercised by `coerceAttrs`/`SchemaRegistry.coerceAttrsFor`. `BlockHost.vue` resolves its renderer.

**Extension points.** This is the template for any text block type with a discriminating attr: declare the schema (with `validate`), provide a renderer that reads `attrs`, and add an input rule (`/^#{1,6} $/`) and a slash command. No core changes required.

### `src/extensions/BulletList.ts`

**Responsibility.** The bullet list block-type extension. Renders a `•` marker via CSS `::before` on `.block-bullet-list`, with `BlockContent` as the editable text region. Supports the common attrs (align/color/bgColor/indent).

**Public API.**

```ts
export const BulletListExtension: Extension
// schema: { type: 'bulletList', content: 'text', nestable: true,
//   attrs: COMMON_ATTRS }
// renderer: { component: BulletListBlock }
```

**Interactions.** Imports `vue`, `core/extension/Extension`, `core/types`, `view/BlockContent.vue`, and `extensions/_commonAttrs` (`COMMON_ATTRS`, `classesFromAttrs`). Bundled in `builtin.ts`. Markdown shortcut `- ` converts a paragraph into a bullet list.

### `src/extensions/OrderedList.ts`

**Responsibility.** The ordered list block-type extension. Auto-numbers blocks within the **same parent (sibling list)**: consecutive `orderedList` siblings in that one list are numbered continuously; any non-ordered-list sibling in between (or a parent boundary) breaks the chain. If `attrs.startNumber` is set (a positive integer), it's an explicit override that re-anchors numbering; otherwise the ordinal is `previous orderedList sibling's ordinal + 1` (or 1 if the previous sibling isn't an ordered list). Because the counter is scoped per sibling list, nested lists under different parents each number independently from 1.

**Public API.**

```ts
export const OrderedListExtension: Extension
// schema: { type: 'orderedList', content: 'text', nestable: true,
//   attrs: { ...COMMON_ATTRS, startNumber: { default: null, validate: v => v == null || (Number.isInteger(v) && v >= 1) } } }
// renderer: { component: OrderedListBlock }
```

`OrderedListBlock` renders a flex wrapper with a clickable `.ol-marker` (the number) and `BlockContent`. Clicking the marker opens `OrderedListMenu` (continue / start new / modify number).

**Interactions.** Imports `vue`, `core/extension/Extension`, `core/types`, `view/BlockContent.vue`, `view/context` (`useEditor`), `extensions/_commonAttrs`, and `core/state/store` (`siblingList`, `indexOf`, `parentOf`). The `orderedListNumber()` helper walks the block's own sibling list backward to compute the ordinal. A `docVersion` ref triggers re-rendering on any document change so numbers stay correct.

### `src/extensions/TodoList.ts`

**Responsibility.** The to-do list block-type extension. Renders a checkbox (`attrs.checked`) and strikes through the text when checked. Supports the common attrs.

**Public API.**

```ts
export const TodoListExtension: Extension
// schema: { type: 'todoList', content: 'text', nestable: true,
//   attrs: { ...COMMON_ATTRS, checked: { default: false, validate: v => typeof v === 'boolean' } } }
// renderer: { component: TodoListBlock }
```

`TodoListBlock` renders a flex wrapper with a checkbox (toggling it dispatches `setAttrs`) and `BlockContent` with `todo-checked` class when checked.

**Interactions.** Imports `vue`, `core/extension/Extension`, `core/types`, `view/BlockContent.vue`, `view/context` (`useEditor`), and `extensions/_commonAttrs`. Markdown shortcut `[] ` converts a paragraph into a to-do.

### `src/extensions/Quote.ts`

**Responsibility.** The quote block-type extension. Renders a blockquote with a left border and italic text. Supports align/color/bgColor but NOT indent (uses `COMMON_ATTRS_NO_INDENT`). Inline italic is disabled via `disallowedMarks: ['italic']`.

**Public API.**

```ts
export const QuoteExtension: Extension
// schema: { type: 'quote', content: 'text', nestable: false,
//   attrs: COMMON_ATTRS_NO_INDENT, disallowedMarks: ['italic'] }
// renderer: { component: QuoteBlock }
```

**Interactions.** Imports `vue`, `core/extension/Extension`, `core/types`, `view/BlockContent.vue`, and `extensions/_commonAttrs` (`COMMON_ATTRS_NO_INDENT`, `classesFromAttrs`). Markdown shortcut `> ` converts a paragraph into a quote.

### `src/extensions/CodeBlock.ts`

**Responsibility.** The code block extension. Marked as **isolating**: Enter inserts a newline (not a new paragraph), Backspace at offset 0 on an empty code block removes it without merging. Supports only `language` attr (uses `CODE_BLOCK_ATTRS` — no align/color/bgColor/indent). The renderer switches to `white-space: pre; font-family: monospace`.

**Public API.**

```ts
export const CodeBlockExtension: Extension
// schema: { type: 'codeBlock', content: 'text', isolating: true,
//   attrs: { language: { default: 'plain', validate: v => typeof v === 'string' } } }
// renderer: { component: CodeBlock, editable: true }
```

`CodeBlock` renders a `.block-code-wrapper` with a clickable `.block-code-lang` label (uppercase language tag) and `BlockContent` with `block-code` class. Clicking the lang label opens `CodeLangPicker`.

**Interactions.** Imports `vue`, `core/extension/Extension`, `core/types`, `view/BlockContent.vue`, `view/ui/icons` (`ICON_CODE`), and `extensions/_commonAttrs` (`classesFromAttrs`, `CODE_BLOCK_ATTRS`). Markdown shortcut ```` ``` ```` (optionally followed by a language) converts a paragraph into a code block.

### `src/extensions/_commonAttrs.ts`

**Responsibility.** Shared schema attribute specs applied to every text-carrying block. Keeps align/color/bgColor/indent consistent across Paragraph/Heading/List/Quote. Also defines the color preset tables (`TEXT_COLOR_PRESETS`, `BG_COLOR_PRESETS`) used by `BlockSettingsMenu` and `HoverToolbar`.

**Public API.**

```ts
export const COMMON_ATTRS: BlockSchemaSpec['attrs']             // align + color + bgColor + indent
export const COMMON_ATTRS_NO_INDENT: BlockSchemaSpec['attrs']   // align + color + bgColor (quote)
export const COMMON_ATTRS_NO_INDENT_NO_ALIGN: BlockSchemaSpec['attrs'] // color + bgColor
export const CODE_BLOCK_ATTRS: BlockSchemaSpec['attrs']         // {} (codeBlock: no attrs)
export const INDENT_TYPES: readonly string[]                     // block types that support indent
export const MAX_INDENT = 10
export function classesFromAttrs(attrs: Attrs): string[]         // → ['be-align-center', 'be-color-red', …]
export interface ColorPreset { readonly key: string; readonly label: string; readonly cssValue: string; readonly opacity: number }
export const TEXT_COLOR_PRESETS: readonly ColorPreset[]
export const BG_COLOR_PRESETS: readonly ColorPreset[]
export const IMAGE_ATTRS: BlockSchemaSpec['attrs']              // {} (image: persistent attrs defined by ImageExtension.schema.attrs, no text/indent/color attrs)
```

Color presets use CSS variables (`var(--be-color-gray)`, `var(--be-swatch-bg-gray)`) so they adapt to light/dark themes automatically. Background colors use semi-transparent tints with an `opacity` field.

**Interactions.** Imported by 10 block-type extensions (7 text blocks + image / table / divider). Table and Divider intentionally avoid importing `COMMON_ATTRS` — table's text attrs live per-cell (no block-level align/indent), and divider is an isolating block with empty attrs. `classesFromAttrs` is called by each renderer that carries text attrs. `coerceAttrsFor()` in `SchemaRegistry` uses the schema's attr specs to strip invalid attrs when converting block types (e.g. removing `indent` when converting to `quote`, removing all attrs when converting to `codeBlock`, stripping all block-level text attrs when converting to `image`/`divider`/`table` and letting each schema handle its own attrs).

### `src/extensions/Image.ts`

**Responsibility.** The Image block-type extension. A `content: 'none'` block — no inline text content inside the block itself; the editable caption is implemented as a separate `contenteditable` child in the renderer. All display data lives in persistent `attrs`: `src` (string), `alt?`, `title?`, `width?`, `height?`, `caption?`, `fileId?`. The transient upload state (`status`, `progress`, `error`, `tempSrc`) is **never** stored in attrs and comes from `view/imageUpload.ts`. Entry points: slash command `/image` (opens local file picker or lets user paste an image URL into `src`), and the paste paths in `clipboard.ts` + `BlockEditor.vue` (pasted files or `<img>` HTML).

**Public API.**

```ts
export const ImageExtension: Extension
// name: 'image'
// schema: {
//   type: 'image',
//   content: 'none',
//   attrs: {
//     src:        { default: '',  validate: v => typeof v === 'string' },
//     alt:        { default: '',  validate: v => typeof v === 'string' },
//     title:      { default: '',  validate: v => typeof v === 'string' },
//     width:      { default: undefined as unknown, validate: v => v === undefined || (typeof v === 'number' && v > 0) },
//     height:     { default: undefined as unknown, validate: v => v === undefined || (typeof v === 'number' && v > 0) },
//     caption:    { default: '',  validate: v => typeof v === 'string' },
//     fileId:     { default: undefined as unknown, validate: v => v === undefined || typeof v === 'string' },
//   },
// }
// renderer: { component: ImageBlock, editable: false }
// slash: [{ name: 'image', label: t('command.image'), icon: ICON_IMAGE, run: openFilePickerOrPromptUrl }]
// serialize html:  (block) => `<figure><img src alt title width height><figcaption>caption</figcaption></figure>`
// serialize md  :  (block) => block has caption/width/height
//                    ? `<figure>…</figure>` (html fallback to preserve attrs)
//                    : `![alt](src "title")`
// deserialize html: `figure > img` → attrs + figcaption text as caption
// deserialize md  : `![alt](src "title")` → attrs
```

The `ImageBlock` renderer renders `.block-image-wrapper` → `<img class="block-image-content">` with width/height. Upload UI:
- If `imageUploadStore.state[blockId].status === 'uploading'`, overlay a progress bar over the bottom 4px.
- If `'error'`, overlay a red banner with error text and **Retry** / **Cancel** buttons (Retry calls `imageUploadStore.retry(blockId)`; Cancel removes the block).
- On block hover, show an overlay toolbar at top-right with **Replace image** (re-opens file picker and starts a new upload, replacing attrs on success) and **Delete image** (`editor.commands.removeBlock`).
- Four drag-resize handles are positioned at the image corners; dragging calls `setAttrs` with new `width`/`height`, enforcing a minimum width of 64 px and preserving aspect ratio when Shift is held.
- A `contenteditable="true"` `.block-image-caption` sits below the image; its text writes to `attrs.caption` via `setAttrs` on blur/input.

**Interactions.** Imports `vue`, `core/extension/Extension`, `core/types`, `view/context` (`useEditor`), `view/imageUpload` (subscribes per-block state), `view/ui/icons` (`ICON_IMAGE`, `ICON_REPLACE`, `ICON_DELETE`, `ICON_RETRY`), and `i18n` (`useI18n`). Bundled in `builtin.ts`; default `BuiltinExtensions` counts 14 extensions. Drag/resize uses standard pointer events (no extra library). Caption contenteditable uses the same IME-guardless (single caret, no marks) pattern as blocks can contain inline text but caption deliberately does not support inline marks.

### `src/extensions/Table.ts`

**Responsibility.** Table block type extension — a `content: 'none'` block using the **attrs storage** pattern (same as Image): **all table grid data** (`cells`, `colWidths`, `rows/cols`, `headerRow`, merged-cell coverage state) lives inside `attrs`, `Block.children` stays `[]`, so the core never inspects table internals and transactions/undo/redo flow through `setAttrs` for free. The renderer is a self-contained Vue component (row selector bar, column selector bar, corner all-select handle, floating toolbar, between-row/column insertion handles). All UI interactions route through the editor `commands` proxy (`tableInsert*` / `tableRemove*` / `tableMergeRect` / `tableSplitCellsInRect` / `tableSetColWidth` / **`tableToggleHeaderRow`** / `tableSetCellAttrs` / `tableSetCellMark` / `tableToggleCellMark` / `tableInsert`) which call `tableModel.ts` pure functions → `editor.commands.setAttrs({ id, attrs: next })`. Enter in a code-block cell inserts a literal newline (records caret offset, DOM-inserts `\n` TextNode, calls `syncCellContent`, then re-places caret at offset+1 in `nextTick` after Vue's async DOM patch).

**Public API.**

```ts
export const TableExtension: Extension
// name: 'table'
// schema: { content: 'none', nestable: false, attrs: TABLE_ATTRS_SCHEMA }
//   attr validation: rows>=1 / cols>=1 / colWidths.length===cols / cells globally coerced (defaults fill, coverage reconciled)
// renderer: { component: TableBlock, editable: true }
// commands: registered via createTableCommands() on editor.commands (table* prefix)

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

`TableBlock` component behavior:
- Outer `.block-table-container` uses `padding-top/left=20px` to make room for selector bars and has no focus outline; the inner `.table-wrapper` has `overflow-x: auto + width: 100%`, and the inner `<table>` uses `width: max-content + table-layout: fixed`, so horizontal scrolling is independent of the editor canvas scroll.
- Row selector bar, column selector bar, corner all-select handle, floating toolbar, and between-row/column insertion markers are **all direct children of `.block-table-container` (fixed-to-container)** — they never scroll with the content.
- Three cell visual states: **default** (white bg / gray border), **selected** (light-blue bg `.cell-selected`), **focus editing** (blue drop-shadow `.cell-focus-outline`). Single-click → selected; double-click → focused independent `contenteditable`; Escape → blur.
- `cellType` controls per-row prefix/visual: heading (font size matches body headings), quote (left border), todo (checkbox + strikethrough), bullet/ordered (prefix glyphs/numbers), codeBlock (monospace font + code gray bg + `white-space: pre-wrap`).
- Merged cells: when `cells[r][c].colspan > 1 || rowspan > 1`, the rendered `<td>` carries those attributes; `covered: true` cells are not rendered. Drag selection containing merged cells auto-calls `expandSelectionToFullRect`.
- **Floating toolbar**: single row selected → "Delete row"; single column selected → "Delete column"; table fully selected → "Delete table" + **"Header row" toggle** (`.ht-btn.active` highlights when `tsel.kind === 'all'`); ≥ 2 non-covered cells selected → "Merge cells"; selection contains any merged cell → "Split cells".
- Row/column insertion points: hovering over the 3px hot zone between cells shows a blue insertion indicator; clicking inserts a new row/column there (new rows inherit col widths, new columns default to 120 px width).
- Tab / Shift+Tab for cell navigation; Tab in last cell → auto appends new row; non-code-block Enter → exits focus (syncs content) + stays in single-cell selected mode.

**Interactions.** Imports `vue` (`h / ref / computed / watch / nextTick / onBeforeUnmount`), `core/types` (`BlockAttrs` / `EditorRef` / `BlockId` / `Mark` / `MarkType`), `core/editor` (`Editor`), `core/extension/Extension` (`defineExtension`), `view/context` (`useEditor`), `extensions/tableModel` (all pure functions + `TABLE_ATTRS_SCHEMA` / `expandSelectionToFullRect`), `view/ui/HoverToolbar.vue` (floating toolbar), `i18n` (`t()`), and indirectly uses `core/inlineDom` (via `syncCellContent` and `inlineToHtml` / `inlineFromHtml` / `inlineToMarkdown` / `markdownToInline` calls). Included by default in `BuiltinExtensions`. Like Image, Table is a `content: 'none'` attrs-storage block — zero core changes. No cross-extension imports beyond its sibling `tableModel.ts`.

### `src/extensions/Equation.ts`

**Responsibility.** Equation (LaTeX math) block type extension — a `content: 'none'`, **isolated** block that stores only `attrs.expression` (the raw LaTeX source). The renderer is a self-contained Vue component (`EquationBlock`): in view mode it calls `katex.renderToString` to produce a centered display formula on the fly (the rendered DOM is never persisted — only `attrs.expression` is serialized); in edit mode it shows a textarea bound to `attrs.expression` with a live KaTeX preview, plus a floating ✎ button to (re)open the editor. An empty block auto-enters edit mode on insert. Selection and nesting follow the editor-wide generic non-text block convention: the root element carries `block-focus-root` so the block-handle/selection ring is driven entirely by `focusedBlockId` (no per-component `isSelected` subscription), and `classesFromAttrs(attrs)` injects the `be-indent-N` class so the block indents correctly when nested as a child (`attrs.indent` mirrors depth). Markdown export serializes as `$$$ … $$$` fenced blocks; HTML export emits `<div class="equation-block-rendered">`. Invalid LaTeX is rendered as a `katex-error-block` fallback rather than throwing.

**Interactions.** Imports `vue`, `core/types`, `core/editor` (`Editor`), `core/extension/Extension` (`defineExtension`), `view/ui/SafeHtml.vue`, `view/ui/icons` (`ICON_EQUATION`, `ICON_EDIT`), `extensions/_commonAttrs` (`COMMON_ATTRS`, `classesFromAttrs`), `view/context` (`useEditor` / `useEditable`), `i18n` (`useI18n`), and `katex` (plus `katex/dist/katex.min.css`). Included by default in `BuiltinExtensions`. Like Image/Table, Equation is a `content: 'none'` attrs-storage block — zero core changes. Enter on an empty equation exits to the default block type; the edit button calls `editor.commands.selectBlock({ id })` before entering edit mode so the block is always selected while editing.

### `src/extensions/tableModel.ts`

**Responsibility.** Pure-functional library of table-structure operations: every `TableAttrs` transform is here, inputs are immutable, a new object is returned. The UI/command layer (`Table.ts`) pipes `tableModel.fn(attrs, args)` results through `editor.commands.setAttrs({ id, attrs })` as a standard transaction → undo/redo is free.

**Public API.**

```ts
export const TABLE_ATTRS_SCHEMA: BlockSchemaSpec['attrs']
// → rows>=1, cols>=1, colWidths?.length===cols, cells globally normalized by validateTableAttrs

export function validateTableAttrs(attrs: Attrs): Attrs         // coerce defaults: missing rows/cols/cells/colWidths/headerRow filled; missing rowspan/colspan/covered/content per-cell filled; coverage re-aligned to rowspan/colspan

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

// Serialize / deserialize (called by the extension's serializers/deserializers)
export function tableToHtml(attrs: Attrs, inlineToHtml: (inline: readonly InlineNode[]) => string): string
export function tableFromHtml(html: string, inlineFromHtml: (html: string) => InlineNode[]): TableAttrs
export function tableToMarkdown(attrs: Attrs, inlineToMd: (inline: readonly InlineNode[]) => string): string
export function tableFromMarkdown(md: string, mdToInline: (md: string) => InlineNode[]): TableAttrs

export interface TableAttrs { rows: number; cols: number; cells: TableCell[][]; colWidths: number[]; headerRow?: boolean }
export interface TableCell { content: InlineNode[]; rowspan: number; colspan: number; covered: boolean; cellType?: CellType; align?: 'left'|'center'|'right'; bgColor?: string }
export type CellType = 'paragraph' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'quote' | 'todo' | 'bullet' | 'ordered' | 'codeBlock'
export interface TableSelectionRect { startRow: number; endRow: number; startCol: number; endCol: number }
```

**Interactions.** Depends only on `core/types` (type-level `Attrs` / `InlineNode` / `Mark` / `MarkType`). **No Vue / core Editor / other extension imports** — pure functions. Consumed by `Table.ts` (each command in `createTableCommands` calls a matching `tableModel.xxx`; the renderer computes selection helpers using `isRect` / `expandSelectionToFullRect` / `getColWidthsSum` etc). `validateTableAttrs` is used inside the schema coercion entry point (fills defaults). `tableToHtml` / `tableFromHtml` / `tableToMarkdown` / `tableFromMarkdown` are the serialize/deserialize exits registered in TableExtension.

### `src/extensions/Divider.ts`

**Responsibility.** Divider block type extension — a minimal isolating block that renders `<hr class="block-divider">`, has `content: 'none'`, and empty attrs. Input rules `---`, `***`, `___` on an empty paragraph convert to divider; slash menu offers a "divider" entry (`/divider`).

**Public API.**

```ts
export const DividerExtension: Extension
// name: 'divider'
// schema: { content: 'none', nestable: false, isolation: true, attrs: {} }
// renderer: { component: DividerBlock, editable: true }
// inputRules: [ '^--- +$' / '^\\*\\*\\* +$' / '^___ +$' → replaceWith('divider') ]
// slash: [{ name: 'divider', label: t('command.divider'), icon: ICON_DIVIDER, run: insertDividerCommand }]
```

**Interactions.** Depends on `vue` / `core/types` / `core/extension/Extension` / `i18n` / `view/ui/icons`. Included by default in `BuiltinExtensions`.

### `src/extensions/TableOfContents.ts`

**Responsibility.** Table-of-Contents (TOC) block type extension — a special, **non-editable** block that renders a live, hierarchical list of every heading in the document. It deliberately stores no heading data (`content: 'none'`, empty attrs): the list is a **dynamic view** computed from the current editor state on every render, so it always stays in sync with the document (heading add/remove, text/level/order changes). `content: 'none'` + `inlineMarks: false` + `renderer.editable: false` make the block non-editable by construction — no caret, no inline text.

**Public API.**

```ts
export interface TocItem {
  readonly id: BlockId
  readonly level: number
  readonly text: string
}

export function collectHeadings(doc: DocState): readonly TocItem[]
// Walks the block tree via `flatten`, filters `type === 'heading'`, skips
// empty headings; returns { id, level, text } in document order. Table-cell
// headings are automatically excluded (cell content lives in Block.attrs,
// not the block tree).

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

The renderer subscribes to editor state updates (`editor.subscribe`) and recomputes the heading collection on every change, so the TOC re-renders whenever the document changes. Clicking an entry dispatches `setSelection` (caret at the heading, via `caretSelection(id, 0)`) and then `scrollIntoView({ block: 'center', behavior: 'smooth' })` — reusing the existing Selection / DOM positioning machinery instead of mutating the document structure.

**Interactions.** Imports `vue` (computed/defineComponent/h/nextTick/ref), `core/types` (`Block`, `BlockId`, `DocState`, `inlineText`), `core/state/store` (`flatten`), `core/selection/Selection` (`caretSelection`), `view/domSelection` (`findBlockEl`), `view/context` (`useEditor`), `i18n` (`useI18n`), `view/ui/icons` (`ICON_TOC`). Included by default in `BuiltinExtensions`.

**Extension points.** Serialization emits empty strings for both HTML and Markdown — the generated heading list is a view, not editor content, and the real headings are exported by their own blocks, so a TOC is never duplicated into exports. Heading collection is a pure function (`collectHeadings`) that could be reused or customized (e.g. filter by level, add numbering) without touching the core.

### `src/extensions/Keymap.ts`

**Responsibility.** The default keymap extension: binds core editing keys to primitive commands. These are the shortcuts every text editor needs — Enter to split/exit, Backspace/Delete to merge/delete, and Arrow keys for inter-block navigation. Extensions may register additional keymaps with higher priority (lower number) to override these defaults. See `docs/architecture.md` §11.1, §11.2, §11.3.

**Public API.**

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

For Phase 1 (single-line blocks), ArrowUp/Down always move between blocks; multi-line caret navigation arrives when blocks can contain line breaks.

**Interactions.** Imports `core/extension/Extension` only. Bundled in `builtin.ts`; its `KeymapSpec` is registered by `Registry.ts` and resolved by `keymapHandler.ts`. The bound commands (`enter`, `backspace`, `moveToPreviousBlock`, `moveToNextBlock`) are defined in `primitiveCommands.ts`.

**Extension points.** A block type can override a default binding by registering a keymap entry with a lower `priority`. ArrowLeft/ArrowRight at block boundaries (§11.3) and Tab/Shift-Tab indent/outdent (Phase 4) are added as further bindings here or in a dedicated extension.

### `src/extensions/History.ts`

**Responsibility.** The history keymap extension: binds undo/redo shortcuts. The actual undo/redo logic lives in `HistoryManager` (owned by `Editor`) and the `undo`/`redo` core commands; this extension only contributes the keyboard bindings. On Mac: Cmd+Z (undo), Cmd+Shift+Z (redo). On Windows: Ctrl+Z (undo), Ctrl+Y (redo), Ctrl+Shift+Z (redo). The `Mod` placeholder is resolved per-platform by `Keymap.ts`.

**Public API.**

```ts
export const HistoryExtension: Extension
// name: 'history-keymap'
// keymap: [
//   { key: 'Mod-z', command: 'undo' },
//   { key: 'Mod-Shift-z', command: 'redo' },
//   { key: 'Mod-y', command: 'redo' },
// ]
```

**Interactions.** Imports `core/extension/Extension` only. Bundled in `builtin.ts`; its bindings are registered by `Registry.ts` and resolved by `keymapHandler.ts`. The `undo`/`redo` commands are registered by `Editor.ts` and delegate to `HistoryManager`.

**Extension points.** A user can disable the default undo/redo shortcuts by overriding the `history-keymap` extension by name, or add alternative bindings (e.g. a toolbar button) by dispatching `editor.commands.undo()` directly. The split between `HistoryManager` (engine) and this extension (keymap only) is deliberate — see §13.1.

### `src/extensions/builtin.ts`

**Responsibility.** The built-in extensions bundle: the default set every editor instance should include. Users can add more extensions or override these by providing extensions with the same `name` (later entries win in `flattenExtensions`). Order matters only for keymap priority; all built-in keymaps use the default priority (0). Extensions that need to override a built-in binding should register with a lower priority number. See `docs/architecture.md` §5.4.

**Public API.**

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

**Interactions.** Imports the 14 built-in extension modules and `core/extension/Extension`. Re-exported by `src/index.ts`. Consumers compose `[...BuiltinExtensions, ...userExtensions]`, or omit `extensions` entirely (the `BlockEditor` prop defaults to `BuiltinExtensions`).

**Extension points.** Adding a new built-in block type or behavior means adding its extension to this array (and re-exporting it). Because override is name-based, a user can replace any single built-in without forking the bundle.

## i18n & Theming

### `src/i18n.ts`

**Responsibility.** Lightweight i18n + theme module. Locale (`zh-CN` default, `en-US`) controls all static UI strings (tooltips, menu labels, placeholders, button text). Theme (`light` default, `dark`) is provided as a reactive ref so child components can react to changes. Deliberately avoids `vue-i18n` so the package has zero runtime dependencies.

**Public API.**

```ts
export type Theme = 'light' | 'dark'
export type Locale = 'zh-CN' | 'en-US'

export function normalizeLocale(raw: string | undefined | null): Locale  // '' / null / 'zh-CN' → 'zh-CN'; else → 'en-US'
export function normalizeTheme(raw: string | undefined | null): Theme    // 'dark' → 'dark'; else → 'light'

export const localeKey: InjectionKey<Ref<Locale>>
export const themeKey: InjectionKey<Ref<Theme>>
export function provideI18n(locale: Ref<Locale>, theme: Ref<Theme>): void
export function useI18n(): I18nBundle    // { locale, theme, t(key) }
```

`provideI18n` provides the raw locale/theme refs directly (not wrapped in an object) so each consumer's `t()` function reads `localeRef.value` — a plain ref read that Vue's reactivity system tracks reliably across `<Teleport>` boundaries. `useI18n()` injects the refs and builds a fresh `t()` that looks up the key in the current locale's dictionary, falling back to the raw key if missing.

**Interactions.** Imports `vue` (`InjectionKey`, `Ref`, `inject`, `provide`, `ref`). `BlockEditor.vue` calls `provideI18n()` in `setup()` and updates the refs via `watch(normalizedLocale, …)`. All UI components (`BlockHandle`, `BlockSettingsMenu`, `HoverToolbar`, `PlusMenu`, `OrderedListMenu`, `NumberPicker`, `CodeLangPicker`) call `useI18n()` to get `t()`.

**Extension points.** Adding a new locale means adding a dictionary object to `DICTS` and extending the `Locale` type. Adding a new static string means adding keys to both `zhCN` and `enUS` dictionaries.

### `src/style.css`

**Responsibility.** The editor's self-contained stylesheet. All design tokens are CSS variables defined under `:root` (light) and `.block-editor.theme-dark` / `body.theme-dark` (dark). The `.block-editor` element intentionally has no `background` — the host page controls the editor's background.

**Key CSS variables.**

```css
:root {
  --be-bg, --be-border, --be-text, --be-muted, --be-accent, --be-hover,
  --be-active, --be-danger, --be-shadow, --be-radius, --be-fg,
  /* Text color presets (10) */
  --be-color-{gray,brown,orange,yellow,green,blue,purple,pink,red},
  /* Background swatch presets (9, semi-transparent tints) */
  --be-swatch-bg-{gray,brown,orange,yellow,green,blue,purple,pink,red}
}
```

Dark mode overrides are defined on `.block-editor.theme-dark` and `body.theme-dark` (the latter so `<Teleport>`-ed popovers inherit them). The theme class is synced to `<body>` by `BlockEditor.vue`'s `watch(normalizedTheme, …)`.

**Phase-6 rules:** Adds:
- `.block-editor a.link` link text styles (accent color, underline on hover, `cursor: pointer`; inherits current text color for non-accent aesthetic when needed).
- `.block-image-wrapper` + overlay toolbar (`.block-image-toolbar`) + resize handles (`.block-image-resize-nw/sw/ne/se`), `.block-image-progress` bar, `.block-image-error` banner with Retry/Cancel.
- `.link-popover` (Teleport-ed body-level) styles, `.link-popover-view`/`.link-popover-edit` layouts, focus-ring inputs, action buttons.

**Interactions.** Imported by `BlockEditor.vue` (`import '../style.css'`). The playground adds its own `playground.css` for chrome (title bar, debug panel) using separate `--pg-*` variables.

## Package Entry Points

### `src/index.ts`

**Responsibility.** The public entry point for the `xiaodao-editor` package. Exports the core engine (framework-agnostic), the Vue components, the built-in extensions, the i18n/theme module, and the extension/schema/command building blocks for custom block types. This is the single import path consumers use.

**Public API.**

```ts
// Core engine (framework-agnostic) — re-exports core/index.ts
export * from './core/index'

// Vue components
export { default as BlockEditor } from './view/BlockEditor.vue'
export { default as BlockList } from './view/BlockList.vue'
export { default as BlockHost } from './view/BlockHost.vue'
export { default as BlockContent } from './view/BlockContent.vue'
export { editorKey, useEditor } from './view/context'
export type { BlockRenderItem } from './view/context'

// Built-in extensions
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

// — Phase 6 utilities —
export { sanitizeUrl, looksLikeUrl, normalizeUrl, autoLinkInlineSeq } from './view/urlUtils'
export { imageUploadStore, setUploadHook } from './view/imageUpload'
export type { UploadStatus, ImageUploadState } from './view/imageUpload'

// i18n + theme
export { useI18n, provideI18n, normalizeLocale, normalizeTheme } from './i18n'
export type { Theme, Locale, I18nBundle } from './i18n'
```

**Interactions.** Imports `core/index`, the four `.vue` components, `view/context`, `i18n.ts`, `view/urlUtils`, `view/imageUpload`, and the built-in extensions bundle (14 extensions, including `Equation`/`TableOfContents`). This is the file the package `main`/`module` fields point at; the `playground/App.vue` and external consumers import from here.

**Extension points.** A new public capability (core or view) is exposed by adding its re-export here. The split between `core/index.ts` (framework-agnostic surface) and this file (adds Vue + extensions) enforces the layer boundary: a consumer who wants only the engine can import `xiaodao-editor/core` if the package exposes that subpath, or tree-shake the Vue components.
