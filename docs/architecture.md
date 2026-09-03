# Xiaodao Editor Architecture

This document defines the architecture for a production-grade, Notion-style
block editor that ships as a **reusable Vue 3 + TypeScript package**. It is the
single source of truth for the editor's design. Implementation must conform to
this document; when implementation reveals a flaw, we update this document
first, then the code.

---

## 1. Executive summary

We build a **custom block-first editor core**. The core operates on a JSON tree
of **blocks** and knows nothing about specific block types (paragraph, heading,
todo, …). Every block type is contributed by an **extension** that registers
its schema, Vue renderer, commands, keymaps, input rules, slash commands and
serializers.

Inline text editing is delegated to the browser's native `contenteditable`,
**scoped per block**. The core owns the *block tree*, *cross-block selection*,
*transactions*, *history*, and *command dispatch*. The browser owns caret
placement and IME composition *within a single block*.

```
┌──────────────────────────────────────────────────────────────┐
│                        Application                            │
│   uses <BlockEditor :model> / useEditor() API                 │
└──────────────────────────────────────────────────────────────┘
                              │
┌──────────────────────────────────────────────────────────────┐
│  Editor Package (this repo)                                   │
│                                                               │
│  ┌────────────┐   ┌──────────────┐   ┌─────────────────────┐ │
│  │  Core API  │──▶│   State /    │──▶│   View Bridge       │ │
│  │ (commands, │   │ Transactions │   │ (Vue <-> state)     │ │
│  │  plugins)  │   │  History     │   │ per-block subscribe │ │
│  └─────┬──────┘   └──────────────┘   └─────────┬───────────┘ │
│        │                                        │             │
│        │           ┌────────────────────────────┘             │
│        ▼           ▼                                          │
│  ┌──────────────────────────┐   ┌──────────────────────────┐ │
│  │   Extension Registry     │   │   Block Renderers (Vue)  │ │
│  │ schema/cmd/keymap/rules/ │   │ <BlockHost> resolves     │ │
│  │ slash/serialize          │   │ type -> component        │ │
│  └──────────────────────────┘   └──────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

---

## 2. Investigation: how modern block editors are designed

### 2.1 ProseMirror

ProseMirror is a **document editor toolkit**, not a block editor. Its model is a
tree of *nodes* (block and inline) with *marks* (inline formatting), described
by a **schema**. State is immutable; mutations go through **transactions**
(`EditorState.apply(tr)`). Rendering is driven by a single document-wide
`contenteditable` that ProseMirror reconciles to its model via a diff/patch
step. Plugins extend behavior (keymap, history, decorations, input rules).

- Strengths: extremely mature; handles IME, selection, clipboard, undo/redo at
  a quality level that took years to reach; used by NYT, Guardian, GitLab.
- Weaknesses for our case: **text/prose-first**. A "block" is just a node; the
  real unit of editing is the inline document. Block-level operations (move a
  block, multi-block selection, nested interactive blocks) require heavy
  **node-view** machinery that fights ProseMirror's ownership of the DOM. The
  schema is **defined once at construction**; dynamic block registration is
  awkward. Rendering control is limited because ProseMirror owns the DOM.

### 2.2 Tiptap

Tiptap is a **headless** wrapper over ProseMirror with a clean
extension/composable API and framework bindings (Vue, React). It makes
ProseMirror ergonomic and provides a Vue renderer via `NodeViewWrapper`.

- Strengths: best-in-class DX on top of ProseMirror; headless (styling freedom);
  collaborative editing via Yjs.
- Weaknesses: inherits all of ProseMirror's prose-first constraints. Dynamic
  block registration still fights the schema. The Vue node-view bridge is a
  compromise — ProseMirror still owns the document DOM, so per-block Vue
  components live inside a contenteditable it controls.

### 2.3 BlockNote

BlockNote is a **Notion-style** editor built on Tiptap/ProseMirror. It imposes a
"block" abstraction on top: every block is a ProseMirror node with a content
node, and block operations are encoded as ProseMirror transactions.

- Strengths: closest to our target UX out of the box; proves the Notion model
  can run on ProseMirror.
- Weaknesses: **React-first** (no first-class Vue). It is a layer of abstraction
  *over* a prose editor, so its block model inherits ProseMirror's constraints
  and a large dependency surface. Customizing deeply (Database, Columns,
  MindMap) means descending into ProseMirror node views.

### 2.4 Lexical

Lexical (Meta) is a **node-based** editor with a React-style reconciler. State
is a node tree; updates produce a new state and Lexical diffs/reconciles the
DOM. Nodes are classes with lifecycle hooks.

- Strengths: fine-grained updates, good performance, modern architecture,
  designed for concurrency/collaboration.
- Weaknesses: **React-first**; Vue story is unofficial/weak. Still **text-first**
  — blocks are a composition of nodes, not a first-class unit. Adopting it
  means buying Meta's node paradigm and binding it to Vue ourselves.

### 2.5 Slate

Slate is an **immutable JSON** model with a function-based plugin system,
React-first. Its model is conceptually close to "everything is a tree of
objects".

- Strengths: clean immutable model; flexible.
- Weaknesses: **React-only** in practice; historically unstable API; still
  text-first; you build the block editor yourself on top.

### 2.6 Notion (proprietary, reference UX)

Notion's editor is custom. Everything is a block; blocks have `id`, `type`,
`properties` (content), and `children`. Block-level operations are first-class;
inline text is edited within a block. This is the UX and model we target.

---

## 3. Tradeoffs and the chosen architecture

### 3.1 The core decision

**Decision: build a custom block-first core with per-block `contenteditable`.**

We do **not** build on ProseMirror/Tiptap/Lexical/Slate, and we do **not** wrap
BlockNote.

### 3.2 Why custom, not ProseMirror-based

| Requirement from the brief | ProseMirror-based fit | Custom block-first fit |
|---|---|---|
| "Core knows NOTHING about paragraph/heading/todo" | Schema is defined upfront and text-first | Core knows only `Block`; types come from extensions |
| "New block types require ~zero core changes" | New node + node view + schema patch | Register an extension |
| "Never rely on HTML; document is JSON" | JSON exists but model is prose-centric | Block tree is the model, by design |
| "Editor manipulates document structure, not DOM" | ProseMirror reconciles DOM it owns | Core mutates JSON tree; DOM is a projection |
| Vue components as block renderers with full control | Node-view bridge is a compromise | Each block is a normal Vue component |
| Future: Database, Columns, MindMap, Mermaid, Embed | Non-prose widgets are awkward node views | Just another block component |
| Per-block stable cursor / correct IME | Document-wide contenteditable, harder to scope | Per-block contenteditable, browser handles IME |

The brief repeatedly insists on a **block-first** model where the core is
block-type-agnostic and the document is a JSON tree. ProseMirror is a
*prose-first* toolkit whose unit of editing is the inline document; bending it
to a Notion model means a permanent layer of abstraction fighting its grain.
Notion itself built a custom core for the same reason.

### 3.3 Why this is safe (the hard parts are addressed)

The genuinely hard problems in a browser editor are **IME composition**,
**caret/selection**, **clipboard**, and **undo/redo**. Our design mitigates each:

- **IME / CJK input**: confined to a single block's `contenteditable`. The
  browser handles `compositionstart…compositionend`. We **never** mutate the DOM
  or dispatch transactions during composition; we reconcile on `compositionend`.
  This is the standard correct approach and is far simpler to get right than in
  a document-wide contenteditable.
- **Caret/selection within a block**: native. The browser places the caret.
- **Cross-block selection & block operations**: our core owns these, operating
  on the JSON tree (not DOM ranges) — tractable because they're structural.
- **Undo/redo**: a transaction-based history plugin (state snapshots / diffs),
  the same proven pattern as ProseMirror's `prosemirror-history`.
- **Clipboard**: handled at the block level in Phase 5, mapping selection →
  JSON fragment → HTML/text on copy and reverse on paste.

### 3.4 What we deliberately do NOT do

- No document-wide `contenteditable`. Each block owns its own.
- No deep Vue reactivity over the whole document. The document is a normalized,
  mostly-plain store; rendering subscribes per block.
- No giant composable or 3000-line component. Modules are small and own one
  responsibility.
- No "utils.ts". Helpers live in focused, named modules.

---

## 4. Document model

### 4.1 Block

```ts
interface Block {
  id: BlockId            // opaque, stable, generated by core (nanoid)
  type: BlockType        // registered type id, e.g. "paragraph", "heading"
  attrs: Attrs           // block-level attributes, e.g. { level: 2 }
  content: InlineSeq     // inline content of this block (empty seq if none)
  children: BlockId[]    // ordered child block ids (nesting)
}
```

- `id` is **generated and owned by the core**, never by extensions or
  persistence. On import, foreign ids are preserved if present and unique;
  otherwise regenerated. This keeps identity stable across reloads and enables
  collaboration.
- `type` is a string registered in the schema registry. The core never switches
  on it.
- `attrs` is a plain JSON object whose shape is declared by the block's schema
  (default values + validation).
- `content` is an ordered sequence of inline nodes. For Phase 1 it is a single
  text run; the model supports marks (bold/italic/code/link) and future inline
  nodes (mention, inline math) without structural change.
- `children` enables nesting: toggle bodies, quote children, table cells,
  columns, callouts. A block may have **both** `content` and `children`
  (e.g. a toggle has a title and a body).

### 4.2 Inline content

```ts
type InlineSeq = InlineNode[]

interface InlineNode {
  type: 'text'            // extensible later: 'mention' | 'equation' | ...
  text: string
  marks?: Mark[]          // [{ type: 'bold' }, { type: 'link', attrs: { href } }]
}
```

Inline editing is plain text in Phase 1. Marks and rich inline nodes arrive
later without changing the block model. This keeps Phase 1 small while the
schema already accounts for them.

### 4.3 Document

```ts
interface Document {
  id: string              // document id
  root: BlockId[]         // ordered top-level block ids
  // blocks live in a normalized store keyed by id (see §10)
}
```

The document is a **forest**: `root` lists top-level block ids; each block's
`children` lists its child ids. The store is normalized (`Map<BlockId, Block>`)
so access, parent lookup, and structural edits are O(depth) and never require
deep cloning.

### 4.4 Why a forest + normalized store, not a nested object tree

- **O(1) block access** by id for rendering, selection, commands.
- **Structural sharing**: a transaction rewrites only the `children` arrays
  along the edited path; unaffected `Block` objects keep referential identity,
  so Vue skips re-rendering them.
- **Stable identity** for `key=blockId` in `v-for`, which is what keeps DOM and
  caret stable across reorders.
- **No deep reactivity**: the store is plain; updates are explicit and
  versioned (see §10).

### 4.5 Block identity, equality, immutability

- `Block` objects are treated as **immutable** within a state version. A
  transaction that changes a block produces a *new* `Block` object; siblings
  and ancestors along the unchanged branches are reused.
- Equality for render-skip: referential (`===`). The view layer compares the
  block reference it subscribed to; if unchanged, it does nothing.

---

## 5. Extension system

### 5.1 The `Extension` contract

An extension is a **plain spec object** (produced by a factory function) that
the editor processes once at construction. Extensions are composable: an
extension may `use(...)` other extensions.

```ts
interface Extension {
  name: string
  uses?: Extension[]

  schema?: BlockSchemaSpec          // declares a block type (if any)
  renderer?: BlockRendererSpec      // Vue component for the block
  commands?: CommandSpec[]          // commands this extension contributes
  keymap?: KeymapSpec               // shortcut -> command
  inputRules?: InputRuleSpec[]      // text patterns -> transform
  slashCommands?: SlashCommandSpec[]// entries in the slash menu
  toolbar?: ToolbarActionSpec[]     // hover/insert toolbar actions
  nodeView?: NodeViewFactory        // for fully custom interactive blocks
  serialize?: SerializerSpec        // block -> HTML / Markdown / JSON
  deserialize?: DeserializerSpec    // Markdown / HTML / JSON -> block
  plugins?: PluginSpec[]            // editor-level plugins (history, etc.)
}
```

Each field is optional; an extension contributes only what it needs. A pure
block-type extension (e.g. `Heading`) provides `schema` + `renderer` +
`serialize`/`deserialize` + maybe `slashCommands`. A behavior extension (e.g.
`History`) provides only `plugins`.

### 5.2 Registries (the result of processing extensions)

The editor builds typed registries from all extensions:

| Registry | Key | Value |
|---|---|---|
| `BlockSchemaRegistry` | `BlockType` | `BlockSchema` |
| `RendererRegistry` | `BlockType` | Vue component |
| `CommandRegistry` | command name | `Command` |
| `KeymapRegistry` | priority + key | command binding |
| `InputRuleRegistry` | — | ordered `InputRule[]` |
| `SlashCommandRegistry` | command id | `SlashCommand` |
| `ToolbarRegistry` | block type | `ToolbarAction[]` |
| `SerializerRegistry` | `BlockType` | `Serializer` |
| `DeserializerRegistry` | source kind | `Deserializer` |
| `PluginRegistry` | — | `Plugin[]` |

Registries are **immutable after construction** (frozen). Reconfiguring the
editor means rebuilding it — this keeps dispatch and rendering branch-free.

### 5.3 Block schema

```ts
interface BlockSchema {
  type: BlockType
  attrs: AttrsSpec                   // { name: { default, validate? } }
  content: 'text' | 'none' | 'inline*'   // does this block edit inline text?
  nestable: boolean                  // may it have children?
  allowedChildren?: BlockType[] | '*'   // child type whitelist
  isolating?: boolean                // boundary for delete/merge (e.g. code)
  empty?: (block) => boolean         // is this block "empty"? (placeholder, merge)
}
```

The schema lets the core answer structural questions without knowing types:
"can block A contain block B?", "is this block empty?", "does this block own a
contenteditable?". This is how Enter/Backspace/merge stay block-type-agnostic.

### 5.4 Auto-discovery

The editor accepts `extensions: Extension[]`. It flattens the `uses` graph
(dedup by `name`), processes every contribution into the registries, and
freezes them. Built-in extensions (`Paragraph`, `Heading`, `BulletList`,
`OrderedList`, `TodoList`, `Quote`, `CodeBlock`, **`Image`**, **`Table`**,
**`Divider`**, **`TableOfContents`**, `Keymap`, `History` — 13 total) are
included by default via `BuiltinExtensions` and can be overridden by passing
an extension with the same `name`. Adding a new block type is "create one
file, pass it to the editor" — zero core changes.

---

## 6. Rendering model

### 6.1 Components

- **`<BlockEditor>`** — public root component. Props: `modelValue` (document
  JSON), `extensions` (defaults to `BuiltinExtensions`), `editable`,
  `placeholder` (locale-aware default), `theme` (`'light' | 'dark'`), `locale`
  (`'zh-CN' | 'en-US'`). Exposes `useEditor()` via `provide`.
- **`<BlockList>`** — renders an ordered list of block ids (root or a parent's
  children). **Virtualization seam**: this component is the only place that
  decides *which* blocks are mounted; a virtualized implementation can drop in
  later without touching block components.
- **`<BlockHost>`** — resolves `block.type` → renderer via the registry and
  mounts it. Provides per-block context (`blockId`, editor API, selection
  state). Uses `key=blockId` so Vue reuses the DOM across reorders.
- **Block renderer components** — normal Vue components. For content blocks they
  render a `contenteditable` bound to their block's content. They read state
  via `useBlock(blockId)` and dispatch via `useEditor()`.

### 6.2 The view bridge (state → Vue)

The editor core is framework-agnostic and emits **state versions**. The view
bridge is the only module that touches Vue reactivity:

- It keeps a `Map<BlockId, Ref<BlockSnapshot>>` (shallow refs).
- On each new state version, it walks the **diff** between the previous and new
  state (computed during transaction application) and updates **only** the
  shallow refs whose block changed. Unchanged blocks are never touched, so
  Vue skips their render functions.
- Selection is a separate reactive ref; selection changes never re-render block
  bodies (only the host adds/removes a CSS class).
- `v-for` over the root/children id arrays uses `key=blockId`; reordering an
  array moves DOM without unmounting components, preserving caret.

### 6.3 Per-block contenteditable contract

Each content block renderer owns exactly one `contenteditable` element. Rules:

1. The **model** is the source of truth for persisted content; the **DOM** is
   the source of truth for the *live, focused* element. The renderer writes
   model → DOM **only when** the block's content reference changed **and** the
   element is not focused (to avoid clobbering the caret / IME).
2. On each `input` event **outside composition**, the renderer dispatches a
   `setText` transaction carrying two meta flags:
   `{ history: 'group', view: 'skip-dom-write' }`. `history: 'group'` merges
   consecutive typing into one undo entry; `view: 'skip-dom-write'` tells the
   view bridge **not** to write back to the focused element (the DOM already
   has the text). This keeps the model **always fresh** so that Enter/Backspace/
   arrow commands read correct text/offsets without touching the DOM, while
   avoiding any caret-disrupting DOM reflow.
3. During `compositionstart…compositionend`, the renderer dispatches **nothing**
   and writes **nothing** to the DOM. On `compositionend`, it reads the composed
   text and dispatches one `setText` (also grouped, also skip-dom-write).
4. Caret offset is read from the native `Selection` only when a command needs it
   (Enter splitting, Backspace merging, arrow navigation across blocks).

This contract gives correct IME and a stable caret, keeps the model fresh for
structural commands, and avoids per-keystroke DOM reflow.

---

## 7. Command system

### 7.1 Commands are pure functions

Adopting ProseMirror's proven shape:

```ts
type Command<TArgs = void> = (args: TArgs) => (state: EditorState, dispatch?: Dispatch) => boolean
```

- A command inspects `state` and, if applicable, builds a **transaction** and
  calls `dispatch(tr)`. It returns `true` if it handled the input (so keymaps
  can fall through).
- Commands are registered by name and dispatched via `editor.commands.<name>(args)`,
  which is a thin proxy that calls the registered command with the current
  state and the core's `dispatch`.

### 7.2 Transactions are the only mutation path

```ts
interface Transaction {
  steps: Step[]            // ordered, structural operations
  selectionAfter?: Selection
  meta: Record<string, unknown>   // e.g. { history: 'ignore' }
}
```

`Step` is a small, serializable structural op: `insertBlock`, `removeBlock`,
`replaceBlock`, `moveBlock`, `setText`, `setAttrs`, `setSelection`. Applying a
transaction produces a **new `EditorState`** (immutable) and a **diff** of which
blocks changed. There is no other way to mutate state — this is what makes
history, persistence, and (future) collaboration possible.

### 7.3 Core-provided primitive commands (block-type-agnostic)

`insertBlock`, `removeBlock`, `replaceBlock`, `moveBlock`, `updateAttrs`,
`setText`, `splitBlock`, `mergeBlock`, `setSelection`, `selectBlock`,
`liftBlock`, `wrapBlock`. These implement Enter/Backspace/move/lift/wrap using
**only** the schema's structural predicates (`nestable`, `allowedChildren`,
`isolating`, `empty`). No block type is referenced.

### 7.4 Extension-provided commands

Block types add their own commands (e.g. `toggleTodo`, `setHeadingLevel`).
These compose core primitives and are exposed on the same `editor.commands`
proxy.

---

## 8. Selection model

Selection is **part of editor state but separate from the document**. Three
kinds:

```ts
type Selection =
  | { kind: 'caret'; blockId: BlockId; offset: number }
  | { kind: 'text'; anchor: Anchor; focus: Anchor }   // within or across blocks
  | { kind: 'blocks'; blockIds: BlockId[] }           // Notion-style block selection

interface Anchor { blockId: BlockId; offset: number }
```

- **`caret`/`text`**: source of truth for the *offset* is the native
  `Selection`, read on demand. The model records it so commands and rendering
  can reason about it without touching the DOM. We sync native → model on
  selectionchange, and model → native when a command moves the caret.
- **`blocks`**: fully owned by the core (mouse drag in the left gutter,
  Shift-click, Escape-to-select). Reflected in the view by a CSS class on the
  selected `BlockHost`s; never touches `contenteditable`.

### 8.1 Rules

- At most one selection kind is active at a time.
- A `blocks` selection takes precedence: when active, contenteditables are
  `contenteditable=false` and arrow keys / Enter / Backspace operate on the
  block set (move, indent, delete).
- `text` selection across blocks is the bridge to multi-block copy/paste
  (Phase 5); for Phase 1 we support `caret` and single-block `text`.

---

## 9. Plugin system

A **plugin** augments editor behavior at well-defined hooks. Plugins differ
from extensions: extensions *declare* blocks/commands/keymaps; plugins *react*
to editor lifecycle and events.

```ts
interface Plugin {
  name: string
  init?(state: EditorState, editor: Editor): PluginState
  applyTransaction?(tr: Transaction, prevState: EditorState): PluginState
  apply?(state: EditorState): EditorState        // read/update state (decorations)
  onKeyDown?(event: KeyboardEvent, ctx: EventContext): boolean
  onInput?(event: InputEvent, ctx: EventContext): boolean
  onCompositionStart?(event, ctx): void
  onCompositionEnd?(event, ctx): void
  onDestroy?(): void
}
```

Built-in plugins (contributed by built-in extensions):

- **History** — undo/redo stacks of transactions, with grouping and
  `addToHistory` meta. Time-travels by reapplying steps.
- **Keymap** — ordered shortcut resolution; returns `true` to consume.
- **InputRules** — pattern matching on text input (e.g. `# ` → heading).
- **SelectionSync** — native ↔ model selection synchronization, including the
  IME guard.
- **Placeholder** — derives whether a block is empty and signals the renderer.

Plugin state is stored in `EditorState` keyed by plugin name, so it is part of
the immutable, versioned state (enables correct undo across plugin effects).

---

## 10. State management

### 10.1 EditorState

```ts
interface EditorState {
  doc: Document               // normalized forest + Map<BlockId, Block>
  selection: Selection
  pluginState: Readonly<Record<string, PluginState>>
  version: number             // monotonic; bumped per applied transaction
}
```

`EditorState` is **immutable**: applying a transaction returns a new state with
structural sharing. The previous state is retained for history.

### 10.2 The store

The normalized `Map<BlockId, Block>` is **not** deeply reactive. It is a plain
map inside the state object. The view bridge (§6.2) is the sole consumer that
exposes slices to Vue via shallow refs. This deliberately avoids Vue's deep
reactivity over thousands of blocks — the explicit performance hazard called
out in the brief.

### 10.3 Update flow

```
user event / command
        │
        ▼
   build Transaction (steps)
        │
        ▼
   applyTransaction(state, tr)  ──▶  new EditorState + diff
        │                              (plugins observe)
        ▼
   history plugin pushes tr (unless meta history:ignore)
        │
        ▼
   view bridge applies diff ──▶ updates only changed block shallow refs
        │                        + selection ref
        ▼
   Vue re-renders only affected <BlockHost> components
```

### 10.4 Persistence

- `v-model` emits the document as plain JSON on debounced changes (or on blur).
- Loading replaces state wholesale (new `EditorState`); the view bridge diffs
  against the previous state to minimize DOM churn.

---

## 11. Keyboard, input rules, and IME

### 11.1 Keymap resolution order

1. If `selection.kind === 'blocks'`: block-set keymap (ArrowUp/Down to extend,
   Delete to remove, Esc to clear).
2. Else, per-type keymap for the focused block (registered by its extension).
3. Core keymap (Enter, Backspace, ArrowUp/Down/Left/Right at block boundaries,
   Tab/Shift-Tab indent/outdent).
4. Fall through to native contenteditable for ordinary text input.

A handler returns `true` to stop propagation. This ordering keeps cross-block
navigation in the core while letting block types customize their own keys.

### 11.2 Enter / Backspace (core, type-agnostic)

- **Enter**: reads caret offset from the native selection, then: if the block's
  schema says `content: 'text'` and the caret is mid text → `splitBlock` at
  offset (the model text is already fresh due to per-input sync, §6.3). If at
  the end and the block is "empty" per schema → `insertBlock` of the
  **default block type** after it (Notion's "empty Enter exits" a styled block).
  If the block is `isolating` and caret at end → insert default block after.
  Behavior is fully driven by schema predicates, never by `type`.
- **Backspace**: at offset 0 with a non-`blocks` selection → `mergeBlock` with
  the previous sibling (respecting `isolating`: code blocks don't merge into
  prose). Mid-text → native delete (contenteditable); the `input` event then
  syncs the model via the per-input `setText` path (§6.3), so no separate sync
  is needed.

The **default block type** is declared in editor config (`defaultBlockType`,
conventionally `"paragraph"`) and resolved through the schema registry — the
core never hardcodes a type name.

### 11.3 Arrow navigation

- ArrowUp/Down at the visual top/bottom of a block → move caret to the
  previous/next block (geometric, using `getBoundingClientRect`). For Phase 1 a
  simple "first/last line → previous/next block" heuristic suffices.
- ArrowLeft at offset 0 → previous block's end; ArrowRight at end → next
  block's start.

### 11.4 IME / CJK

Per-block contenteditable confines composition. The `SelectionSync` plugin
guards the window: from `compositionstart` to `compositionend`, no transaction
is dispatched and no DOM write is performed by the renderer for the composing
block. On `compositionend`, the composed text is read and a single `setText`
transaction is dispatched. This is the same approach used by mature editors and
is correct for Chinese/Japanese/Korean input.

---

## 12. Performance strategy

Target: smooth editing at 1k / 5k / 10k blocks.

- **No deep reactivity** over the document. State is immutable plain data;
  rendering subscribes per block via shallow refs.
- **Structural sharing** so a transaction keeps referential identity for all
  unchanged blocks; the view bridge skips them.
- **Diff-driven rendering**: the bridge updates only blocks in the transaction
  diff, plus selection.
- **Stable keys**: `key=blockId` so reorders move DOM, not recreate it.
- **Virtualization seam**: `<BlockList>` is the single mount point; a
  virtualized variant can replace it without touching block components. We keep
  block components side-effect-free and idempotent so virtualization is safe.
- **Per-input model sync with history grouping** for typed text (§6.3): each
  keystroke dispatches a cheap `setText` that changes only one block (structural
  sharing) and carries `view: 'skip-dom-write'` so the focused element is never
  re-written — no caret-disrupting reflow, no per-keystroke DOM reconciliation.
- **No `watch` over the whole document**; the brief explicitly forbids deep
  watch, and we comply.

---

## 13. Package structure and module ownership

The editor is a single publishable package (`xiaodao-editor`). Modules
are small, each with one responsibility and a documented public API. The
structure below reflects the **as-built** codebase (Phases 1–8).

```
src/
  core/                         # framework-agnostic core (no Vue imports)
    types.ts                    # Block, DocState, Selection, InlineSeq, JSON forms
    ids.ts                      # BlockId generation (Web Crypto, zero deps)
    state/
      store.ts                  # normalized Map<BlockId,Block> + parent index + lookups
      Step.ts                   # serializable structural ops + applySteps (produces diff)
      Transaction.ts            # TransactionBuilder + Transaction + meta
      EditorState.ts            # immutable state + applyTransaction
      invert.ts                 # step inversion for undo/redo
    command/
      Command.ts                # Command type + CommandRegistry + proxy
      primitiveCommands.ts      # insert/remove/replace/move/setText/split/merge/enter/backspace/nav + setLink/unsetLink
      Keymap.ts                 # KeymapRegistry + key name normalization (Mod → Ctrl/Cmd)
      InputRule.ts              # InputRuleRegistry (type alias of InputRuleSpec)
      SlashCommand.ts           # SlashCommandRegistry + search (type alias of SlashCommandSpec)
    selection/
      Selection.ts              # constructors + guards + pure helpers
    plugin/
      Plugin.ts                 # Plugin interface + EventContext
    extension/
      Extension.ts              # Extension contract
      Registry.ts               # flattenExtensions + buildRegistries + RendererRegistry + ToolbarRegistry
    schema/
      BlockSchema.ts            # schema spec → schema + structural predicates
      SchemaRegistry.ts         # type → schema lookup with fallback
    history/
      HistoryManager.ts         # undo/redo stacks + grouping + step inversion
    serialize/
      Serializer.ts             # per-block Markdown/HTML serializer + deserializer registries
    Editor.ts                   # facade: state, dispatch, commands proxy, history, plugins
    index.ts                    # core barrel (public surface of the framework-agnostic engine)
  view/                         # Vue-specific bridge + components
    context.ts                  # editorKey/useEditor (provide/inject) + BlockRenderItem type
    BlockEditor.vue             # public root: constructs Editor, subscribes, keymap, selection sync, i18n/theme, upload-image hook, link popover orchestration, fileId ref-count + cleanup:event
    BlockList.vue               # flat block list (virtualization seam)
    BlockHost.vue               # type → renderer resolution via RendererRegistry; forwards linkClick
    BlockContent.vue            # per-block contenteditable (IME guard, input sync, placeholder, link detection on click, URL paste auto-link, space-triggered auto-link)
    domSelection.ts             # native Selection ↔ model (caret offset read/restore, cross-block rects)
    keymapHandler.ts            # KeyboardEvent → keymap → command dispatch
    inlineDom.ts                # InlineSeq ↔ DOM (HTML serialization incl. <a href sanitization>, inlineFromDom incl. <a> → link mark)
    imageUpload.ts              # image upload side-channel: per-blockId transient state (pending/progress/error), mock upload, external handler dispatch, temp object URLs, subscribe/cleanup API
    urlUtils.ts                 # URL utilities: looksLikeUrl, normalizeUrl, sanitizeUrl (whitelist safe schemes), autoLinkInlineSeq (detect URLs in text runs and wrap with link mark)
    clipboard.ts                # clipboard HTML/plain-text → ParsedBlock[] (copy/cut/paste); image-file + <img> paste → image-block insert; URL paste over selection → link mark
    ui/                         # floating UI components (all Teleported to <body>)
      BlockHandle.vue           # left-gutter plus/grip buttons (drag, settings menu)
      BlockSettingsMenu.vue     # grip menu: turn-into, align/indent, color, actions
      HoverToolbar.vue          # text-selection toolbar: type, marks, align, color + link button
      PlusMenu.vue              # slash menu + insert menu (searchable command palette)
      OrderedListMenu.vue       # ordered-list marker click menu (continue / start new / modify)
      NumberPicker.vue          # modify starting number value
      CodeLangPicker.vue        # set code-block language
      LinkPopover.vue           # link popover (view mode: open/copy/edit/remove; edit mode: href + text; positioned over selection or clicked <a>)
      FixedToolbar.vue            # persistent top/bottom action bar (embeds HoverToolbar inline + plus/handle buttons).
                                  # Position via toolbarPosition prop: 'auto' (top desktop / bottom mobile), 'top', 'bottom', 'float'
                                  # ('float' = desktop only: hide this bar, render a floating HoverToolbar that follows the text/table selection).
      SafeHtml.vue              # isolates v-html for trusted SVG/HTML glyph rendering
      icons.ts                  # inline SVG icon strings (no <text> elements)
      inputRulesEngine.ts       # markdown shortcuts (# , > , [] , ```)
      popup.ts                  # viewport-aware popup positioning helpers
      useMenuScroll.ts          # shared scroll composable (up/down buttons, wheel, touch swipe)
      useMenuDismiss.ts         # shared outside-click/Escape dismiss composable
  extensions/
    Paragraph.ts                # paragraph block type (schema + renderer)
    Heading.ts                  # heading block type h1–h6 (schema + renderer + attr validation)
    BulletList.ts               # bullet list block type
    OrderedList.ts              # ordered list block type (auto-numbering, startNumber attr)
    TodoList.ts                 # to-do list block type (checked attr)
    Quote.ts                    # quote block type (no inline italic)
    CodeBlock.ts                # code block type (isolating, language attr, no align/color/indent)
    Image.ts                    # image block type (content:none, src/alt/title/width/height/caption/fileId attrs; replace/remove overlay, drag-resize handle, editable caption; slash /image; serialize HTML/MD)
    Table.ts                    # table block type (content:none, attrs grid; Vue renderer + command reg; row/col selectors; floating toolbar; merge/split/header-row; code-cell Enter inserts newline)
    tableModel.ts               # pure-functional table structure ops: insert/remove row/col, merge/split, full-rect expand, toggle headerRow, col-width helpers, HTML/MD serialize, attrs validation/coercion
    Divider.ts                  # divider block type (isolating horizontal rule)
    TableOfContents.ts          # table-of-contents block type (non-editable; live heading list view; content:'none', empty attrs; slash /table of contents)
    Keymap.ts                   # default keymap: Enter/Backspace/ArrowUp/ArrowDown
    History.ts                  # undo/redo keymap: Mod-z / Mod-Shift-z / Mod-y
    _commonAttrs.ts             # shared align/color/bgColor/indent specs + color presets
    builtin.ts                  # BuiltinExtensions bundle (14 extensions) + re-exports
  i18n.ts                       # locale (zh-CN/en-US) + theme (light/dark) module
  style.css                     # editor stylesheet (CSS variables, light/dark tokens; link anchor styles; image block overlays + upload UI; link popover styles)
  index.ts                      # public package entry point
```

### 13.1 Deviations from the original design (and why)

The original design (Phase 0) proposed a slightly different layout. The
following changes were made during implementation (Phases 1–9) for clarity or
because the design over-anticipated needs:

| Design proposal | As-built | Reason |
|---|---|---|
| `state/diff.ts` | Merged into `Step.ts` (`applySteps` returns `changed`/`removed`) | The diff is a by-product of applying steps; a separate module added indirection without value. |
| `serialize/json.ts` | `serialize/Serializer.ts` | JSON in/out is handled by `store.ts`; this module owns per-block Markdown/HTML specs only. |
| `view/ViewBridge.ts` | Absent — `BlockEditor.vue` owns the `shallowRef<EditorState>` directly | A separate bridge class was unnecessary for Phase 1; the root component is the sole reactivity boundary. Can be extracted if the view layer grows. |
| `view/useEditor.ts` + `view/useBlock.ts` | `view/context.ts` (editorKey + useEditor + BlockRenderItem) | `useBlock` was not needed in Phase 1 (blocks receive props, not subscriptions). |
| `view/dom/selectionSync.ts` + `view/dom/caret.ts` | `view/domSelection.ts` | The two concerns are tightly coupled; splitting them added ceremony without clarity. |
| `view/contenteditable.ts` | `view/BlockContent.vue` | The contenteditable contract is a component, not a composable. |
| `extensions/paragraph/` (directory) | `extensions/Paragraph.ts` (file) | Each Phase 1 extension is small enough for one file. Directories can be adopted when an extension grows (e.g. Code Block with syntax highlighting). |
| `extensions/selection/`, `extensions/inputRules/`, `extensions/placeholder/` | Absent | Selection sync lives in the view layer (`domSelection.ts` + `BlockEditor.vue`). InputRules is Phase 2. Placeholder is handled by `BlockContent.vue` via `data-empty` CSS. |
| `history/` as a plugin | `history/HistoryManager.ts` (owned by Editor) + `extensions/History.ts` (keymap only) | History requires the Editor's dispatch and state; making it a plugin would need privileged access. The keymap is a separate extension. |
| `SchemaRegistry.ts` not in design | Added | The design described schema lookups inline; a registry centralizes fallback logic and keeps `Editor.ts` thin. |
| `state/invert.ts` not in design | Added | Step inversion is non-trivial and deserves its own focused module. |
| `extensions/selection/`, `extensions/inputRules/`, `extensions/placeholder/` (Phase 2) | `view/ui/inputRulesEngine.ts` + `view/BlockContent.vue` placeholder | Input rules engine lives in the view layer (needs DOM access). Placeholder remains in `BlockContent.vue`. |
| `extensions/` (Phase 3: Todo, Quote, CodeBlock, BulletList, OrderedList) | 5 separate files under `extensions/` | Each is a self-contained extension with schema + renderer. CodeBlock is `isolating`. |
| `view/ui/` directory (Phase 4) | 9 Vue components + 6 composable/helper files | Floating UI components are Teleported to `<body>`. Shared scroll/dismiss composables deduplicate behavior. `MobileToolbar.vue` was later renamed/expanded into `FixedToolbar.vue` with a `toolbarPosition` prop (auto/top/bottom/float) so the toolbar is persistent across desktop and mobile, menus flip direction, and a `fixedToolbarBottomKey` injection key lets downstream menus know whether to open up or down. The `'float'` value is desktop-only: it hides the FixedToolbar and renders a standalone floating `HoverToolbar` that follows the text selection. |
| `view/clipboard.ts` + `view/inlineDom.ts` (Phase 5) | Added | Clipboard parsing (HTML/plain-text → blocks) and InlineSeq ↔ DOM conversion are view-layer concerns. |
| `i18n.ts` + `theme` prop (cross-cutting) | Added | Zero-dep i18n module via provide/inject; theme synced to `<body>` for Teleport-ed popovers. |
| `view/ui/SafeHtml.vue` | Added | Isolates `v-html` to a single component so the rest of the codebase satisfies `vue/no-v-html`. Only used for trusted internal SVG/HTML glyph strings. |
| **`extensions/Image.ts` + `view/imageUpload.ts` (Phase 6)** | Added as a `content: 'none'` block extension plus a separate view-side upload side-channel map. Upload transient state (pending/progress/error) lives OUTSIDE `Block.attrs`; only the final `src` (and fileId/alt/title/width/height/caption) is persisted. Guarantees undo restores only blocks, no "blob:" URLs leak into JSON, and reload-from-persistence never revives temporary uploads. `BlockEditor.vue` runs a fileId reference counter and emits `cleanup:image-file` when the last block referencing a fileId is removed, so consumers can reclaim cloud storage. Drag-drop + image-file paste + HTML `<img>` paste all dispatch through the same upload pipeline. |
| **`view/urlUtils.ts` (Phase 6, link mark safety)** | Added. `sanitizeUrl` is the single trust boundary: it rejects `javascript:`, `vbscript:`, `data:`, `file:` schemes (plus protocol-relative `//…` when not http/https) and only allows an explicit whitelist (`http`, `https`, `mailto`, `tel`). `looksLikeUrl` + `normalizeUrl` drive the paste auto-link and typing auto-link. `autoLinkInlineSeq` walks a freshly-typed `InlineSeq` and applies link marks to detected URLs, skipping already-linked runs and inline-code runs. |
| **`setLink`/`unsetLink` primitives + `<a>` round-trip in `inlineDom.ts` + `LinkPopover.vue` (Phase 6)** | Added. Link is a Mark (not an InlineNode), fully compatible with the existing mark system and incompatible with inline code via `CODE_INCOMPATIBLE`. HTML serialization always calls `sanitizeUrl` before writing `href` and always emits `target="_blank" rel="noopener noreferrer"`; deserialization reconstructs the link mark from any `<a>` element whose href passes `sanitizeUrl`. `BlockContent.vue` detects clicks on `<a>` and emits `linkClick`, forwarded up through `BlockHost` / `BlockList` to `BlockEditor.vue`, which opens `LinkPopover.vue` (positioned over the `<a>` rect). The popover provides open / copy / edit / remove (view mode) and href + text inputs with validation (edit mode). HoverToolbar has a link button, and `Mod-K` (`Ctrl/Cmd+K`) opens the editor for the current selection or the clicked link. Pasting a URL over a text selection calls `setLink` directly (no separate text change). Typing whitespace re-runs `autoLinkInlineSeq` so typed URLs link without user action. Ctrl/Cmd+click the anchor opens the page (browsers enforce `rel=noopener noreferrer`). |
| **`Table` (Phase 7)** only noted as future extension in the design | `extensions/Table.ts` + `extensions/tableModel.ts`, registered in `BuiltinExtensions` | Table is a high-priority built-in feature. Uses the same **attrs storage** pattern as Image (grid data lives entirely in `attrs`, `Block.children=[]`), so the core never touches table internals and undo/redo is free via `setAttrs`. Self-contained Vue renderer: row/column/corner selectors, a floating toolbar with delete/merge/split/**header-row toggle** buttons, row/col insertion handles, code-cell Enter inserts newline with offset-based caret re-placement. Zero core changes. |
| **`Divider` (Phase 7)** not anticipated as built-in in the design | `extensions/Divider.ts` as a minimal isolating block | Horizontal rule is a high-frequency tool block and belongs built-in rather than user-defined. |
| **`TableOfContents` (Phase 8)** not anticipated in the design | `extensions/TableOfContents.ts` as a non-editable `content: 'none'` block with empty attrs | The TOC is a **dynamic view** computed from editor state (collects all `heading` blocks via `flatten`), not persisted content. `content: 'none'` + `inlineMarks: false` + `renderer.editable: false` make it non-editable by construction. Clicking an entry dispatches the existing `setSelection` command + `scrollIntoView`. Serialization emits empty strings so the TOC is never duplicated in exports. Zero core changes. |

Ownership rules (unchanged from design):

- `core/` imports **nothing** from Vue. It is unit-testable in isolation and
  portable to any framework. Enforced by an ESLint `no-restricted-imports`
  rule on `src/core/**`.
- `view/` is the only layer that touches Vue reactivity and the DOM.
- `extensions/` import from `core` and `view` but never from each other except
  via composition (`uses`).
- No `utils.ts`. Helpers belong to the module that owns the concept (e.g.
  `domSelection.ts`, `invert.ts`, `ids.ts`).

---

## 14. Phased roadmap

### Phase 1 — Foundation ✅
Core types, normalized store, immutable state, transactions + diff, command
registry + primitive commands, selection, plugin/extension/registry system,
view bridge, `BlockEditor`/`BlockList`/`BlockHost`, per-block contenteditable
contract, SelectionSync (IME guard), History, Keymap, Placeholder. Extensions:
`Paragraph`, `Heading`. UX: caret, Enter, Backspace, arrow nav, placeholder.

### Phase 2 — Authoring assistance ✅
Slash menu (`PlusMenu.vue`: search, keyboard nav, command palette), input
rules / markdown shortcuts (`# `, `## `, `> `, `[] `, ```` ``` ````) via
`inputRulesEngine.ts`.

### Phase 3 — More block types ✅
Todo, Quote, Code Block, BulletList, OrderedList (each a self-contained
extension; code block is `isolating`).

### Phase 4 — Block manipulation UI ✅
Drag handle (`BlockHandle.vue`), hover toolbar (`HoverToolbar.vue`), insert
button (`+`), block movement (drag, keyboard move up/down), indent/outdent,
grip menu (`BlockSettingsMenu.vue`: turn-into, align, color, actions).

### Phase 5 — Clipboard & multi-select ✅
Multi-block text selection overlay, copy/cut/paste (clean HTML/plain-text
serialization via `clipboard.ts`), duplicate, delete, paste-from-external
(HTML deserialization). **Mobile cross-block text selection**: long-press on
touch devices starts a drag-select that spans multiple blocks via
`positionFromPoint` hit-testing in `domSelection.ts`; synthetic mouse events
are suppressed during touch interaction.

### Cross-cutting (added after Phase 1) ✅
- **i18n** (`src/i18n.ts`): `locale` prop (`zh-CN`/`en-US`), zero-dep
  translation module via provide/inject; popovers stay reactive across
  `<Teleport>`.
- **Theming** (`theme` prop): light/dark CSS variables on `.block-editor` and
  synced to `<body>`; per-preset text/background colors with opacity.
- **Inline marks**: bold, italic, underline, strikethrough, inline code,
  per-selection text color and background color.
- **Link mark (Phase 6)**: `{ type: 'link', attrs: { href } }` with full
  authoring UX (Mod-K, popover view/edit/copy/remove, paste-URL-over-selection
  → setLink, whitespace-triggered auto-link detection via
  `autoLinkInlineSeq`, `<a>` ↔ mark round-trip). **Security: every `href`
  written to the DOM or reconstructed from the DOM passes `sanitizeUrl`**
  with a scheme whitelist (http/https/mailto/tel); `javascript:`,
  `vbscript:`, `data:`, `file:`, and untrusted protocol-relative URLs are
  silently dropped. Rendered anchors always carry
  `target="_blank" rel="noopener noreferrer"`. Link mark is incompatible with
  inline code so code runs can never be clickable.
- **Image block + upload pipeline (Phase 6)**: `ImageExtension`
  (`content: 'none'`) with persisted attrs `src/alt/title/width/height/
  caption/fileId` and transient upload state held in `view/imageUpload.ts`
  (never serialized). Authoring UX: slash `/image` (file picker), drag &
  drop image files, paste of image files or HTML `<img>`, replace/remove
  overlay toolbar, corner resize handle (locked aspect ratio by default),
  editable caption as a separate contenteditable under the image.
  `uploadImage?: UploadImageHandler` prop dispatches uploads with progress
  and cancellation (`AbortController`); a safe in-memory mock is provided
  as the default but it produces `blob:` URLs that are not serialisable,
  so **consumers must provide `uploadImage` if they intend to persist**.
  `fileId` (integer returned by the upload handler) uses a per-editor
  reference counter that emits `cleanup:image-file` when the last block
  referencing a fileId is removed, so consumers can clean up cloud storage.
- **Block-level attrs**: align (left/center/right/justify), text color,
  background color, indent (0–10).

### Phase 6 — Media & Link Marks ✅
Image block (schema + renderer) with upload pipeline (side-channel state,
`uploadImage` prop, `cleanup:image-file` event), link mark (`setLink`/
`unsetLink` commands, Mod-K shortcut, `LinkPopover`), URL safety utilities
(`sanitizeUrl`, `looksLikeUrl`, `normalizeUrl`, `autoLinkInlineSeq`), `<a>`
round-trip in `inlineDom.ts`, URL paste / image paste / drag-and-drop in
`clipboard.ts` + `BlockContent.vue`.

### Phase 7 — Table block + Divider ✅

**Table block**
- Schema: `content: 'none'` with **attrs storage** pattern (same as Image):
  `rows`, `cols`, `cells[r][c] = { content, rowspan, colspan, covered, cellType?, align?, bgColor? }`, `colWidths[col]`, `headerRow`. Schema validates
  row/col dims + colWidths length, `validateTableAttrs` does global cells
  coercion.
- Entry: plus-menu table icon dispatches `insertTableCommand` (default 3×3,
  **default col width 120 px**, **default `headerRow: true`**).
- Rendering: outer `.block-table-container` (padding-top/left=20px for
  selector bars, no focus outline) wraps an Arco-style `.table-wrapper`
  (`overflow-x: auto`, inner table `width: max-content`) for internal
  horizontal scroll. **Row selector bar, column selector bar, corner
  all-select handle, floating toolbar, row/col between-cell insertion
  markers** are fixed-to-container direct children — they never scroll with
  the content. The floating toolbar shows a delete-row/column/table button
  when one row/col/all is selected; **merge cells** when ≥ 2 non-covered
  cells are selected; **split cells** when selection contains a merged
  cell; **header-row toggle** (sets/unsets `headerRow`) only when
  corner-selected (`tsel.kind === 'all'`).
- Cells: every visible cell renders its own `.table-cell-inner[contenteditable]`.
  Supports paragraph / heading h1–h6 / quote / todo / bullet / ordered /
  `codeBlock` as `cellType`. **Enter in a code-block cell inserts a literal
  newline**: records caret offset, inserts `\n` TextNode in DOM, calls
  `syncCellContent`, then **re-places caret at offset+1 in `nextTick`**
  after Vue's re-render; rendering appends a trailing `<br>` when the text
  ends with `\n`; `white-space: pre-wrap` makes newlines visible.
  Tab / Shift+Tab navigates (last-cell Tab appends a new row). Non-code
  Enter exits edit + goes to single-cell selected (blue bg). Double-click
  focuses (blue focus outline); single-click selects; drag selects a rect;
  selection including merged cells auto-expands to the full minimal
  enclosing rectangle (`expandSelectionToFullRect`).
- Commands (registered on `editor.commands` proxy for UI buttons):
  `tableInsertRow` / `tableRemoveRow` / `tableInsertCol` / `tableRemoveCol`
  / `tableMergeRect` / `tableSplitCell` / `tableSplitCellsInRect` /
  `tableSetColWidth` / **`tableToggleHeaderRow`** / `tableSetCellAttrs` /
  `tableSetCellMark` / `tableToggleCellMark` / `tableInsert`. Every command
  calls a `tableModel.ts` pure function (immutable → new `TableAttrs`) and
  wraps the result in a standard `setAttrs` transaction → undo/redo is free.
- Serialization: HTML → `<table>` with first row wrapped in `<thead>` when
  `headerRow`, else all rows in `<tbody>`, merged cells write
  `rowspan`/`colspan`, each cell uses standard `inlineToHtml`, col widths
  are emitted as `<colgroup>` styles. Markdown → table with separator row
  and a syntax header row when `headerRow`, each cell as inline Markdown.

**Divider block**
- Minimal isolating block: `<hr class="block-divider">`. Empty attrs; input
  rules `---` / `***` / `___` (on an empty paragraph) convert to divider.

### Phase 8 — Table of Contents ✅

**Table of Contents (TOC) block**
- Schema: `content: 'none'`, `inlineMarks: false`, empty `attrs`, `nestable:
  false`, `empty: () => false` (the TOC always renders its panel). Renderer
  `editable: false` — the block is non-editable by construction (no caret, no
  inline text).
- Heading collection: `collectHeadings(doc)` walks the block tree via
  `flatten`, filters `type === 'heading'`, and returns `{ id, level, text }`
  for each heading that has non-empty text. Table-cell headings are
  automatically excluded because table cell content lives in `Block.attrs`,
  not in the block tree.
- Rendering: the Vue component subscribes to editor state updates
  (`editor.subscribe`) and recomputes the heading list on every document
  change, so the TOC stays a **live view**. Each entry is a `<button>` with
  `data-toc-target` and a `paddingLeft` indent based on `level`. Clicking an
  entry dispatches `setSelection` (caret at the heading) and then
  `scrollIntoView({ block: 'center', behavior: 'smooth' })`.
- Entry: slash menu `/table of contents` (keywords: `toc`, `contents`,
  `outline`, `目录`, `标题`, `大纲`). Dispatches `convertBlock` to turn the
  current block into a TOC.
- Serialization: both `toHTML` and `toMarkdown` emit empty strings — the
  generated heading list is a view, not editor content, and the real headings
  are already exported by their own blocks. This prevents a TOC from being
  duplicated into HTML / Markdown exports.
- i18n: `toc.title` ("目录" / "Table of Contents"), `toc.empty` ("暂无标题" /
  "No headings").

### Future (architecture already supports)
Callout, Toggle, Columns, Database, Mention, Math, Mermaid, MindMap,
Attachment, Embed, AI — each arrives as an extension (schema + renderer +
serialize + maybe nodeView) with **no core changes**.

---

## 15. Future extensibility

The architecture is shaped so that every future feature is an extension:

- **Columns / Callout / Toggle**: blocks with `nestable: true` and
  `allowedChildren` whitelists. Their renderers mount nested `<BlockList>`s.
- **Database**: a block whose renderer is an interactive Vue widget; data lives
  in `attrs`. The core treats it like any block; the `nodeView` factory allows
  full DOM control if needed.
- **Mention / inline Math**: new `InlineNode` types. The contenteditable
  contract and inline model already accept non-text inline nodes; rendering
  renders them as immutable inline atoms.
- **Mermaid / MindMap / Embed / Attachment**: `content: 'none'` blocks whose
  renderer is a self-contained component reading `attrs`.
- **AI**: commands (`/ai`, inline transform) and a block type for AI output.
  Commands are first-class; AI is just another command source.
- **Collaboration**: transactions are serializable steps; a future transport
  can broadcast steps and apply remote transactions. History already
  separates local undo from applied state.

No future feature requires modifying `core/`. This is the central design
guarantee of the brief.

---

## 16. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Custom contenteditable edge cases (caret, IME) | Per-block scope; defer to native; explicit IME guard; never write DOM while focused/composing |
| Performance at 10k blocks | Immutable state + structural sharing + diff-driven per-block shallow refs; virtualization seam in `BlockList` |
| Undo/redo correctness | Transaction steps + history plugin with grouping; `addToHistory` meta; tested via state replay |
| Cross-block caret geometry | Use `getBoundingClientRect` line detection; Phase-1 heuristic, refined later |
| Schema rigidity over time | Schema is per-extension, not global; registries are rebuilt on reconfigure |
| Feature creep into core | `core/` has zero Vue imports and zero block-type switches; enforced by lint boundary tests |
| Deep reactivity accidents | Document is plain; only `ViewBridge` creates refs; code review + a lint rule banning `reactive(doc)`/`watch(doc,…, deep)` |

---

## 17. Open questions (to resolve during Phase 1)

1. **ID generation on import**: preserve foreign ids unconditionally, or
   regenerate on collision only? → Lean: preserve if unique, else regenerate,
   and emit a mapping. Decided in `store.ts`.
2. **Virtualization default**: ship `BlockList` non-virtualized in Phase 1 with
   a clean interface; add a `VirtualizedBlockList` when measured need arises.
3. **Inline marks timing**: Phase 1 keeps content as a single text run; marks
   arrive with bold/italic (post-Phase-3). The `InlineSeq` model is already in
   place so this is additive.
4. **Collaboration transport**: out of scope now, but transactions are shaped to
   support it (serializable steps, version numbers).

---

## 18. Review checklist (self-review)

- [x] Core knows nothing about specific block types (no `switch(type)` in `core/`).
- [x] Every block type is contributed by an extension; new types need zero core changes.
- [x] Document is JSON; HTML/Markdown are import/export only.
- [x] Single mutation path: transactions → new immutable state.
- [x] Selection is separate from document and never re-renders block bodies.
- [x] Per-block contenteditable; IME guarded; stable cursor via `key=blockId`.
- [x] No deep reactivity; rendering subscribes per block via shallow refs.
- [x] Modules are small and single-responsibility; no `utils.ts`. (Domain helpers live in their own modules — e.g. `urlUtils.ts`, `imageUpload.ts`.)
- [x] Future features (Callout, Database, Columns, AI, …) require no core changes.
- [x] **Phases 1–8 implemented**: 12 built-in block types (Paragraph, Heading, BulletList, OrderedList, TodoList, Quote, CodeBlock, Image, **Table**, **Divider**, **Equation**, **TableOfContents**) = 14 built-in extensions (incl. Keymap + History); inline marks including `link` with href sanitization; image block with transient upload side-channel, drag resize, caption, slash entry, fileId reference counting and `cleanup:image-file` emit; block-level attrs, slash menu, input rules, hover toolbar (incl. link button + table header-row toggle when table corner-selected), drag handle, clipboard (incl. URL paste → link, image paste → upload), i18n, theming; table of contents block (live heading list view, non-editable, slash entry, serialize → empty).
- [x] **Table block invariants**: table content lives entirely in `Block.attrs` (`content: 'none'`) so core transactions/undo are untouched; all cell operations route through `editor.commands.setAttrs` → pure `tableModel.ts` (immutable in, new attrs out); code-block-cell Enter inserts a newline character rather than splitting the block.
- [x] **Security — link href sanitization**: every path that writes or reconstructs a link `href` (`inlineToHtml`, `inlineFromDom`, `LinkPopover` save, `BlockContent` URL paste/auto-link) funnels through the single `sanitizeUrl` whitelist; unsafe schemes (`javascript:`, `vbscript:`, `data:`, `file:`) never reach the DOM.
- [x] **Image upload invariants**: `Block.attrs` never stores transient upload state (pending/progress/error/blob URLs) — transient state lives in `view/imageUpload.ts`; undo/redo and reload-from-persistence therefore never resurrect invalid `blob:` or `pending` state.
- [x] **All phases implemented**: `vue-tsc --noEmit`, `eslint`, and `vite build` all pass.
- [x] **All phases implemented**: Per-module documentation in `docs/module.md`.
- [x] **All phases implemented**: ESLint boundary rule enforces no Vue imports in `src/core/`.
