/**
 * The `Editor` facade: the framework-agnostic core's public surface. It owns
 * the registries, the current `EditorState`, the history manager, the command
 * dispatch, and plugin lifecycle. The view layer (`view/createEditor.ts`)
 * assembles built-in + user extensions and constructs this.
 *
 * Core invariants enforced here:
 *  - State changes ONLY through `dispatch(transaction)`.
 *  - Plugins receive events via typed hooks; the view never calls plugins directly.
 *
 * See docs/architecture.md §10 (state management), §13 (Editor facade).
 */

import type { Attrs, Block, BlockId, DocState, DocumentData, InlineSeq, JSONValue, Mark, Selection, TextRun } from './types';
import { docFromData, docToData, depthOf, flatten, getBlock } from './state/store';
import { applyTransaction, createState, type EditorState } from './state/EditorState';
import type { Transaction } from './state/Transaction';
import { buildRegistries, type EditorRegistries } from './extension/Registry';
import type { Extension } from './extension/Extension';
import { createPrimitiveCommands } from './command/primitiveCommands';
import type { CommandDispatcher } from './command/Command';
import type { EventContext } from './plugin/Plugin';
import { HistoryManager } from './history/HistoryManager';
import { caretSelection } from './selection/Selection';
import { createBlockId } from './ids';

export interface EditorConfig {
  readonly extensions: readonly Extension[];
  readonly defaultBlockType?: string;
  readonly initialDocument?: DocumentData;
  readonly initialSelection?: Selection;
  readonly editable?: boolean;
  readonly historyLimit?: number;
}

export interface StateUpdate {
  readonly state: EditorState;
  readonly changed: ReadonlySet<BlockId>;
  readonly removed: ReadonlySet<BlockId>;
}

export type EditorListener = (update: StateUpdate) => void;

/** Public read-only history API exposed by the Editor facade. */
export interface EditorHistory {
  /** True if an undo entry exists. */
  canUndo(): boolean;
  /** True if a redo entry exists. */
  canRedo(): boolean;
  /**
   * Open an explicit grouping scope. Any `dispatch` between `beginGroup()` and
   * the matching `endGroup()` merges into one undo entry. Scopes nest; only
   * the outermost close "commits". Prefer this over using the
   * `meta.historyGroup` key manually.
   */
  beginGroup(): string;
  /** Close an explicit grouping scope opened by `beginGroup()`. */
  endGroup(): void;
}

export class Editor {
  readonly registries: EditorRegistries;
  private state: EditorState;
  private readonly listeners = new Set<EditorListener>();
  private readonly _history: HistoryManager;
  readonly commands: Record<string, (...args: unknown[]) => boolean>;
  editable: boolean;
  /** The block id currently owning the focused contenteditable (set by the view). */
  focusBlockId: BlockId | null = null;

  /** Public history API: canUndo/canRedo plus grouping helpers. */
  readonly history: EditorHistory;

  constructor(config: EditorConfig) {
    this.registries = buildRegistries(config.extensions, {
      defaultBlockType: config.defaultBlockType,
    });

    // Register primitive commands first (defaults), then let extensions override.
    for (const cmd of createPrimitiveCommands(this.registries)) {
      this.registries.commands.register(cmd);
    }
    for (const cmd of this.registries.extensionCommands) {
      if (this.registries.commands.has(cmd.name)) {
        this.registries.commands.override(cmd);
      } else {
        this.registries.commands.register(cmd);
      }
    }

    // Build the initial document, ensuring at least one default block.
    const { doc } = docFromData(config.initialDocument ?? { blocks: [] });
    const docWithContent = doc.root.length === 0 ? this.seedEmptyDocument(doc.id) : doc;

    // Initialise plugins.
    const pluginState: Record<string, unknown> = {};
    const firstBlockId = docWithContent.root[0] ?? null;
    const selection: Selection
      = config.initialSelection ?? (firstBlockId ? caretSelection(firstBlockId, 0) : { kind: 'blocks', blockIds: [] });
    const initialState = createState(docWithContent, selection, pluginState);
    for (const plugin of this.registries.plugins) {
      if (plugin.init) pluginState[plugin.name] = plugin.init(initialState);
    }
    this.state = initialState;

    this._history = new HistoryManager(config.historyLimit);
    const hm = this._history;
    this.history = {
      canUndo: () => hm.canUndo(),
      canRedo: () => hm.canRedo(),
      beginGroup: () => hm.beginGroup(),
      endGroup: () => hm.endGroup(),
    };
    this.editable = config.editable ?? true;

    // Undo/redo are core commands because they require the HistoryManager,
    // which the Editor owns. Extensions can still override them by name.
    this.registries.commands.register({
      name: 'undo',
      run: () => (_state, dispatch) => {
        if (!dispatch) return this._history.canUndo();
        const tr = this._history.undo();
        if (tr) {
          dispatch(tr);
          return true;
        }
        return false;
      },
    });
    this.registries.commands.register({
      name: 'redo',
      run: () => (_state, dispatch) => {
        if (!dispatch) return this._history.canRedo();
        const tr = this._history.redo();
        if (tr) {
          dispatch(tr);
          return true;
        }
        return false;
      },
    });

    const dispatcher: CommandDispatcher = (name, args) => {
      const entry = this.registries.commands.get(name);
      if (!entry) return false;
      return entry.run(args)(this.state, (tr) => this.dispatch(tr));
    };
    this.commands = this.registries.commands.createProxy(dispatcher);
  }

  // --- State access -------------------------------------------------------

  getState(): EditorState {
    return this.state;
  }

  toData(): DocumentData {
    return docToData(this.state.doc);
  }

  /**
   * Export the current document as a Markdown string. Serializes the editor's
   * own live document state directly (see `docToMarkdown` below); no external
   * converter or intermediate re-serialization is involved.
   */
  toMarkdown(): string {
    return docToMarkdown(this.state.doc);
  }

  /**
   * Replace the whole document by parsing a Markdown string. Resets history.
   * The Markdown is parsed natively by the editor (see `markdownToDoc` below)
   * straight into its document state; no external converter and no
   * intermediate `DocumentData` round-trip is involved.
   */
  setDocFromMarkdown(markdown: string): void {
    this.adoptDoc(markdownToDoc(markdown));
  }

  /** Replace the whole document (e.g. on external `v-model` change). Resets history. */
  setDocument(json: DocumentData): void {
    this.adoptDoc(docFromData(json).doc);
  }

  /** Take ownership of a normalized document and reset the editor state. */
  private adoptDoc(doc: DocState): void {
    const docWithContent = doc.root.length === 0 ? this.seedEmptyDocument(doc.id) : doc;
    const firstBlockId = docWithContent.root[0] ?? null;
    const selection: Selection = firstBlockId
      ? caretSelection(firstBlockId, 0)
      : { kind: 'blocks', blockIds: [] };
    const pluginState: Record<string, unknown> = {};
    const next = createState(docWithContent, selection, pluginState);
    for (const plugin of this.registries.plugins) {
      if (plugin.init) pluginState[plugin.name] = plugin.init(next);
    }
    this.state = next;
    this._history.reset();
    this.notify({ state: next, changed: new Set(flatten(docWithContent)), removed: new Set() });
  }

  // --- Mutation -----------------------------------------------------------

  dispatch(tr: Transaction): void {
    const prev = this.state;
    const result = applyTransaction(prev, tr, this.registries.plugins);
    this.state = result.state;
    this._history.record(tr, prev.selection, prev.doc);
    this.notify(result);
  }

  undo(): boolean {
    const tr = this._history.undo();
    if (!tr) return false;
    this.dispatch(tr);
    return true;
  }

  redo(): boolean {
    const tr = this._history.redo();
    if (!tr) return false;
    this.dispatch(tr);
    return true;
  }

  canUndo(): boolean {
    return this._history.canUndo();
  }

  canRedo(): boolean {
    return this._history.canRedo();
  }

  // --- Subscription -------------------------------------------------------

  subscribe(listener: EditorListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(update: StateUpdate): void {
    for (const listener of this.listeners) listener(update);
  }

  // --- Plugin event dispatch (called by the view layer) -------------------

  private eventContext(): EventContext {
    return {
      state: this.state,
      dispatch: (tr) => this.dispatch(tr),
      focusBlockId: () => this.focusBlockId,
    };
  }

  handleKeyDown(event: KeyboardEvent): boolean {
    const ctx = this.eventContext();
    for (const plugin of this.registries.plugins) {
      if (plugin.onKeyDown?.(event, ctx)) return true;
    }
    return false;
  }

  handleInput(event: InputEvent): boolean {
    const ctx = this.eventContext();
    for (const plugin of this.registries.plugins) {
      if (plugin.onInput?.(event, ctx)) return true;
    }
    return false;
  }

  handleCompositionStart(event: CompositionEvent): void {
    const ctx = this.eventContext();
    for (const plugin of this.registries.plugins) plugin.onCompositionStart?.(event, ctx);
  }

  handleCompositionEnd(event: CompositionEvent): void {
    const ctx = this.eventContext();
    for (const plugin of this.registries.plugins) plugin.onCompositionEnd?.(event, ctx);
  }

  destroy(): void {
    for (const plugin of this.registries.plugins) plugin.onDestroy?.();
    this.listeners.clear();
  }

  // --- Internal -----------------------------------------------------------

  private seedEmptyDocument(docId: string): DocState {
    const id = createBlockId();
    const type = this.registries.defaultBlockType;
    const block: Block = {
      id,
      type,
      attrs: this.registries.schema.defaultAttrsFor(type),
      content: [],
      children: [],
    };
    const blocks = new Map<BlockId, Block>([[id, block]]);
    const parent = new Map<BlockId, BlockId | null>([[id, null]]);
    return { id: docId, root: [id], blocks, parent };
  }
}

/** Validate that a block id exists in the current state (debugging helper). */
export function hasBlock(editor: Editor, id: BlockId): boolean {
  return getBlock(editor.getState().doc, id) !== undefined;
}

// ---------------------------------------------------------------------------
// Native Markdown <-> document conversion (editor-internal, not exported)
// ---------------------------------------------------------------------------
//
// These are the editor's own Markdown serialization / parsing routines, kept
// module-private. They operate directly on the editor's document state
// (`DocState`), so conversion only ever happens through the `Editor` methods
// `toMarkdown()` / `setDocFromMarkdown()` — there is no standalone converter
// API and no intermediate data round-trip for the caller to chain.
//
// Supported block types: paragraph, heading, quote, codeBlock, bulletList,
// orderedList, todoList, divider, image, table, tableOfContents (emits
// nothing). Inline marks: bold, italic, underline, strikethrough, inline code
// and links. Color/background-color marks have no Markdown equivalent, so
// they are emitted as plain text on export and dropped on import.

const ESCAPE_RE = /([\\`*_[\]])/g;

function escapeMdText(s: string): string {
  return s.replace(ESCAPE_RE, '\\$1');
}

function hasMark(run: TextRun, type: string): boolean {
  return !!run.marks?.some((m) => m.type === type);
}

/** Serialize a single InlineSeq into a Markdown inline string. */
function inlineToMarkdown(seq: InlineSeq): string {
  let out = '';
  for (const run of seq) {
    if (run.type !== 'text') continue;
    const text = run.text;
    if (text.length === 0) continue;
    const marks = run.marks ?? [];
    let s = hasMark(run, 'code') ? `\`${text}\`` : escapeMdText(text);
    if (hasMark(run, 'bold')) s = `**${s}**`;
    if (hasMark(run, 'italic')) s = `*${s}*`;
    if (hasMark(run, 'strikethrough')) s = `~~${s}~~`;
    if (hasMark(run, 'underline')) s = `++${s}++`;
    const link = marks.find((m) => m.type === 'link');
    const href = typeof link?.attrs?.href === 'string' ? link.attrs.href : undefined;
    if (href) s = `[${s}](${href})`;
    out += s;
  }
  return out;
}

interface InlineToken {
  readonly type: 'text' | 'bold' | 'italic' | 'strikethrough' | 'underline' | 'code' | 'link';
  readonly text: string;
  readonly href?: string;
}

function tokenizeInline(src: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let i = 0;
  let plain = '';

  const flush = (): void => {
    if (plain.length > 0) {
      tokens.push({ type: 'text', text: plain });
      plain = '';
    }
  };

  while (i < src.length) {
    const ch = src[i];
    if (ch === '\\' && i + 1 < src.length) {
      plain += src[i + 1];
      i += 2;
      continue;
    }
    if (ch === '[') {
      const close = src.indexOf(']', i + 1);
      if (close !== -1 && src.charAt(close + 1) === '(') {
        const paren = src.indexOf(')', close + 2);
        if (paren !== -1) {
          const label = src.slice(i + 1, close);
          const href = src.slice(close + 2, paren);
          if (href.length > 0) {
            flush();
            tokens.push({ type: 'link', text: label, href });
            i = paren + 1;
            continue;
          }
        }
      }
    }
    if (ch === '`') {
      const end = src.indexOf('`', i + 1);
      if (end !== -1) {
        flush();
        tokens.push({ type: 'code', text: src.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    // Handle the "***bold+italic***" convention: three identical chars at
    // both ends wraps an italic shell around a bold body (recursively
    // tokenized). We check this before the separate ** / * rules because
    // otherwise ** would greedily consume the first two and orphan a star.
    const tripleMatch
      = src.startsWith('***', i)
        ? '***'
        : src.startsWith('___', i)
          ? '___'
          : null;
    if (tripleMatch) {
      const end = src.indexOf(tripleMatch, i + 3);
      if (end !== -1) {
        flush();
        tokens.push({ type: 'italic', text: `**${src.slice(i + 3, end)}**` });
        i = end + 3;
        continue;
      }
    }

    if (src.startsWith('**', i) || src.startsWith('__', i)) {
      const marker = src.charAt(i + 1);
      const end = src.indexOf(marker + marker, i + 2);
      if (end !== -1) {
        flush();
        tokens.push({ type: 'bold', text: src.slice(i + 2, end) });
        i = end + 2;
        continue;
      }
    }
    if (src.startsWith('~~', i)) {
      const end = src.indexOf('~~', i + 2);
      if (end !== -1) {
        flush();
        tokens.push({ type: 'strikethrough', text: src.slice(i + 2, end) });
        i = end + 2;
        continue;
      }
    }
    if (src.startsWith('++', i)) {
      const end = src.indexOf('++', i + 2);
      if (end !== -1) {
        flush();
        tokens.push({ type: 'underline', text: src.slice(i + 2, end) });
        i = end + 2;
        continue;
      }
    }
    if (ch === '*' || ch === '_') {
      // Do not match a stray '*' that was part of an unmatched double-marker
      // (the triple case is handled above). If the current char actually
      // starts a double-marker that failed to close above, avoid a wrong
      // italic match as well: we just treat it as plain text.
      if (src.charAt(i + 1) === ch && i + 1 < src.length) {
        // This is really the case "double-marker failed to close" (bold).
        // Fall through to plain text so the markers stay visible.
      } else {
        const end = src.indexOf(ch, i + 1);
        if (end !== -1) {
          flush();
          tokens.push({ type: 'italic', text: src.slice(i + 1, end) });
          i = end + 1;
          continue;
        }
      }
    }
    plain += ch;
    i += 1;
  }
  flush();
  return tokens;
}

function attrEq(a: Attrs | undefined, b: Attrs | undefined): boolean {
  if (a === undefined && b === undefined) return true;
  if (a === undefined || b === undefined) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => a[k] === b[k]);
}

function marksEqual(a: readonly Mark[], b: readonly Mark[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((m, i) => m.type === b[i]!.type && attrEq(m.attrs, b[i]!.attrs));
}

/** Convert a Markdown inline string to an InlineSeq. */
function markdownToInline(md: string): InlineSeq {
  const runs: TextRun[] = [];
  const append = (text: string, marks: readonly Mark[]): void => {
    // Empty text without marks contributes nothing; but empty text with marks
    // (e.g. an empty `[](href)` link label) still produces a run so the mark
    // survives round-trip.
    if (text.length === 0 && marks.length === 0) return;
    const last = runs[runs.length - 1];
    if (last && marksEqual(last.marks ?? [], marks)) {
      runs[runs.length - 1] = { ...last, text: last.text + text };
      return;
    }
    runs.push({ type: 'text', text, marks: marks.length > 0 ? [...marks] : undefined });
  };

  const convert = (tokens: InlineToken[], marks: readonly Mark[]): void => {
    for (const tok of tokens) {
      if (tok.type === 'text') {
        append(tok.text, marks);
      } else if (tok.type === 'link') {
        append(tok.text, [...marks, { type: 'link', attrs: { href: tok.href ?? '' } as Attrs }]);
      } else if (tok.type === 'code') {
        append(tok.text, [...marks, { type: 'code' }]);
      } else if (tok.type === 'bold') {
        convert(tokenizeInline(tok.text), [...marks, { type: 'bold' }]);
      } else if (tok.type === 'italic') {
        convert(tokenizeInline(tok.text), [...marks, { type: 'italic' }]);
      } else if (tok.type === 'strikethrough') {
        convert(tokenizeInline(tok.text), [...marks, { type: 'strikethrough' }]);
      } else if (tok.type === 'underline') {
        convert(tokenizeInline(tok.text), [...marks, { type: 'underline' }]);
      }
    }
  };

  convert(tokenizeInline(md), []);
  return runs;
}

function blockPlainText(block: Block): string {
  return block.content.reduce((acc, r) => (r.type === 'text' ? acc + r.text : acc), '');
}

interface TableCellShape {
  readonly covered?: boolean;
  readonly content?: InlineSeq;
}

function tableToMarkdownLines(attrs: Attrs): string[] {
  const rows = typeof attrs.rows === 'number' ? attrs.rows : 0;
  const cols = typeof attrs.cols === 'number' ? attrs.cols : 0;
  const rawCells = Array.isArray(attrs.cells) && attrs.cells.length > 0 ? attrs.cells : [];
  const headerRow = attrs.headerRow === true;
  if (rows === 0 || cols === 0) return [];
  const cellText = (r: number, c: number): string => {
    const row = rawCells[r] as JSONValue[] | undefined;
    const cell = row?.[c] as TableCellShape | undefined;
    if (!cell || cell.covered) return '';
    return escapeMdCell(inlineToMarkdown(cell.content ?? []));
  };
  const header = Array.from({ length: cols }, (_, c) => cellText(0, c));
  const sep = Array.from({ length: cols }, () => '---');
  const body: string[] = [];
  const start = headerRow ? 1 : 0;
  for (let r = start; r < rows; r++) {
    body.push(`| ${Array.from({ length: cols }, (_, c) => cellText(r, c)).join(' | ')} |`);
  }
  return [`| ${header.join(' | ')} |`, `| ${sep.join(' | ')} |`, ...body];
}

function escapeMdCell(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}

/** Tag for each top-level "chunk" in the serializer output. */
interface MdChunk {
  /** Markdown lines for this block (potentially multi-line, e.g. code fence). */
  readonly lines: readonly string[];
  /**
   * Logical indentation level used by the list-continuity rule. Nested list
   * children sit one level deeper than their parent; list blocks at the root
   * are level 0.
   */
  readonly level: number;
  /** Block type (`bulletList`, `orderedList`, `todoList`, ...) so we can decide continuity. */
  readonly type: string;
}

function isListType(t: string): boolean {
  return t === 'bulletList' || t === 'orderedList' || t === 'todoList';
}

/** Serialize a single block to tagged chunks.
 *
 * Uses `attrs.indent` (the editor's REAL indent mechanism) instead of
 * `block.children`: the view layer does not render children at all, and
 * Tab/Shift+Tab manipulate `attrs.indent` as a number. So every block is
 * treated as a flat root item whose `level` comes directly from its
 * `attrs.indent`; `block.children` is intentionally ignored. */
function blockToChunks(doc: DocState, id: BlockId, _level: number): MdChunk[] {
  const block = doc.blocks.get(id);
  if (!block) return [];
  // authoritative level from parent-chain depth.
  // attrs.indent is kept only as a back-compat sync shadow; the tree is the
  // source of truth here.
  const level = depthOf(doc, id);
  const pad = ' '.repeat(level * 2);
  const inline = (b: Block): string => inlineToMarkdown(b.content);

  let lines: string[] = [];
  switch (block.type) {
    case 'heading': {
      const level0 = typeof block.attrs?.level === 'number' ? block.attrs.level : 1;
      const clamped = Math.max(1, Math.min(6, level0));
      lines = [`${pad}${'#'.repeat(clamped)} ${inline(block)}`];
      break;
    }
    case 'quote': {
      const inner = inline(block);
      if (inner.length > 0) {
        lines = inner.split('\n').map((l) => `${pad}> ${l}`);
      }
      break;
    }
    case 'codeBlock': {
      const lang = typeof block.attrs?.language === 'string' && block.attrs.language ? block.attrs.language : '';
      const code = blockPlainText(block);
      const fence = code.includes('```') ? '````' : '```';
      lines = [`${pad}${fence}${lang}`, ...code.split('\n').map((l) => `${pad}${l}`), `${pad}${fence}`];
      break;
    }
    case 'bulletList': {
      lines = [`${pad}- ${inline(block)}`];
      break;
    }
    case 'orderedList': {
      const start = typeof block.attrs?.startNumber === 'number' ? block.attrs.startNumber : 1;
      lines = [`${pad}${start}. ${inline(block)}`];
      break;
    }
    case 'todoList': {
      const checked = block.attrs?.checked === true;
      lines = [`${pad}- ${checked ? '[x]' : '[ ]'} ${inline(block)}`];
      break;
    }
    case 'divider': {
      lines = [`${pad}---`];
      break;
    }
    case 'image': {
      const a = block.attrs ?? {};
      const src = typeof a.src === 'string' ? a.src : '';
      if (!src) break;
      const alt = typeof a.alt === 'string' ? a.alt : '';
      const title = typeof a.title === 'string' ? a.title : '';
      const caption = typeof a.caption === 'string' ? a.caption : '';
      const md = title ? `![${alt}](${src} "${title}")` : `![${alt}](${src})`;
      lines = caption ? [`${pad}${md}`, `${pad}*${caption}*`] : [`${pad}${md}`];
      break;
    }
    case 'table': {
      lines = tableToMarkdownLines(block.attrs ?? {});
      break;
    }
    case 'tableOfContents': {
      lines = [];
      break;
    }
    case 'equation': {
      const e = block.attrs?.expression;
      const expr = typeof e === 'string' ? e : '';
      if (expr.trim().length > 0) {
        const body = expr.split('\n');
        lines = [`${pad}$$$`, ...body.map((l) => `${pad}${l}`), `${pad}$$$`];
      }
      break;
    }
    default: {
      const text = inline(block);
      if (text.length > 0) lines = [`${pad}${text}`];
      break;
    }
  }

  // emit the block's own chunk, then depth-first-walk its children
  // (so that every descendant immediately follows its parent).
  const out: MdChunk[] = [];
  if (lines.length > 0) out.push({ lines, level, type: block.type });
  for (const childId of block.children) {
    out.push(...blockToChunks(doc, childId, level + 1));
  }
  return out;
}

/** Serialize the editor's whole document state straight into a Markdown string. */
function docToMarkdown(doc: DocState): string {
  const chunks: MdChunk[] = [];
  for (const rootId of doc.root) {
    chunks.push(...blockToChunks(doc, rootId, 0));
  }

  // Walk in output order. Between two adjacent chunks we emit a blank line
  // UNLESS, for every (non-empty) indentation level that is present in the
  // chunk pair, the "continuity" rule holds: same-level peers of the same
  // list-kind stay together.
  const out: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const curr = chunks[i]!;
    if (i > 0) {
      const prev = chunks[i - 1]!;
      const needBlank = !shouldKeepAdjacent(prev, curr);
      if (needBlank) out.push('');
    }
    for (const l of curr.lines) out.push(l);
  }

  // Collapse leading / trailing / duplicated blank lines (purely cosmetic).
  const trimmed: string[] = [];
  for (const l of out) {
    if (l === '' && (trimmed.length === 0 || trimmed[trimmed.length - 1] === '')) continue;
    trimmed.push(l);
  }
  return trimmed.join('\n');
}

/**
 * Decide whether two adjacent chunks must remain on consecutive lines (no
 * blank line between them).
 *
 * Rule (user-spec):
 *  - First "ignore chunks with indentation" (i.e. different levels) entirely:
 *    level-different chunk pairs are always kept adjacent. Blank lines are
 *    only ever inserted between same-level peers.
 *  - If two consecutive chunks at the SAME level are both bullet / both
 *    ordered / both todo, they belong to the same list: no blank line.
 *  - Otherwise (different types, or either one is not a list-kind), they are
 *    separate blocks: insert a blank line.
 */
function shouldKeepAdjacent(a: MdChunk, b: MdChunk): boolean {
  if (a.level !== b.level) return true; // 跳过（忽略）有缩进/跨层级的边界
  return isListType(a.type) && isListType(b.type) && a.type === b.type;
}

interface ParsedBlock {
  readonly type: string;
  readonly attrs?: Attrs;
  readonly content?: InlineSeq;
}

/** Try to parse a single logical line into a block descriptor, or null. */
function parseLine(line: string): ParsedBlock | null {
  const heading = /^(#{1,6})\s+(.*)$/.exec(line);
  if (heading) {
    return { type: 'heading', attrs: { level: heading[1]!.length }, content: markdownToInline(heading[2]!) };
  }
  const quote = /^>\s?(.*)$/.exec(line);
  if (quote) {
    return { type: 'quote', content: markdownToInline(quote[1] ?? '') };
  }
  const todo = /^[-*+]\s+\[([ xX])\]\s+(.*)$/.exec(line);
  if (todo) {
    return { type: 'todoList', attrs: { checked: todo[1]!.toLowerCase() === 'x' }, content: markdownToInline(todo[2]!) };
  }
  const ordered = /^(\d+)\.\s+(.*)$/.exec(line);
  if (ordered) {
    return { type: 'orderedList', attrs: { startNumber: Number(ordered[1]) }, content: markdownToInline(ordered[2]!) };
  }
  const bullet = /^[-*+]\s+(.*)$/.exec(line);
  if (bullet) {
    return { type: 'bulletList', content: markdownToInline(bullet[1]!) };
  }
  if (/^-{3,}$/.test(line) || /^\*{3,}$/.test(line) || /^_{3,}$/.test(line)) {
    return { type: 'divider' };
  }
  const image = /^!\[([^\]]*)\]\((\S+?)(?:\s+"([^"]*)")?\)$/.exec(line.trim());
  if (image) {
    const attrs: Record<string, JSONValue> = { src: image[2] ?? '', alt: image[1] ?? '' };
    if (image[3]) attrs.title = image[3];
    return { type: 'image', attrs: attrs as Attrs };
  }
  if (line.trim().length === 0) return null;
  return { type: 'paragraph', content: markdownToInline(line) };
}

type LogicalBlock
  = | { kind: 'fence'; lang: string; body: string[] }
    | { kind: 'table'; lines: string[] }
    | { kind: 'math'; body: string[] }
    | { kind: 'lines'; lines: string[] };

/** Split raw markdown into top-level logical blocks (code fences, tables). */
function splitBlocks(md: string): LogicalBlock[] {
  const rawLines = md.replace(/\r\n/g, '\n').split('\n');
  const blocks: LogicalBlock[] = [];
  let cur: string[] = [];
  let i = 0;

  const flush = (): void => {
    if (cur.length > 0) blocks.push({ kind: 'lines', lines: cur });
    cur = [];
  };

  while (i < rawLines.length) {
    const line = rawLines[i] ?? '';
    const fence = /^(\s*)(```+|~~~+)\s*(\S*)\s*$/.exec(line);
    if (fence) {
      flush();
      const fenceChar = fence[2]![0];
      const lang = fence[3] ?? '';
      const body: string[] = [];
      i += 1;
      while (i < rawLines.length) {
        const l = rawLines[i]!;
        if (new RegExp(`^\\s*${fenceChar}{3,}\\s*$`).test(l)) break;
        body.push(l);
        i += 1;
      }
      blocks.push({ kind: 'fence', lang, body });
      i += 1;
      continue;
    }
    // Math fence: a line that is exactly "$$" (whitespace allowed) opens a
    // block-level LaTeX equation; a following "$$" line closes it. The body is
    // the raw LaTeX source.
    const mathFence = /^\s*\$\$\s*$/.exec(line);
    if (mathFence) {
      flush();
      const body: string[] = [];
      i += 1;
      while (i < rawLines.length) {
        const l = rawLines[i]!;
        if (/^\s*\$\$\s*$/.test(l)) break;
        body.push(l);
        i += 1;
      }
      blocks.push({ kind: 'math', body });
      i += 1;
      continue;
    }
    if (line.includes('|') && i + 1 < rawLines.length && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(rawLines[i + 1] ?? '')) {
      flush();
      const table: string[] = [line, rawLines[i + 1]!];
      i += 2;
      while (i < rawLines.length && (rawLines[i] ?? '').includes('|')) {
        table.push(rawLines[i]!);
        i += 1;
      }
      blocks.push({ kind: 'table', lines: table });
      continue;
    }
    cur.push(line);
    i += 1;
  }
  flush();
  return blocks;
}

/** Parse a Markdown pipe-delimited table into a `table` block. */
function parseTable(lines: string[]): ParsedBlock {
  const parseRow = (raw: string): string[] => {
    const trimmed = raw.trim().replace(/^\|/, '').replace(/\|$/, '');
    return trimmed.split('|').map((c) => c.trim());
  };
  const header = parseRow(lines[0] ?? '');
  const body = lines.slice(2).map((l) => parseRow(l));
  const cols = Math.max(header.length, ...body.map((r) => r.length));
  const rows = body.length + 1;
  const cells: JSONValue[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: JSONValue[] = [];
    const srcRow: string[] = r === 0 ? header : body[r - 1] ?? [];
    for (let c = 0; c < cols; c++) {
      row.push({ content: markdownToInline(unescapeMdCell(srcRow[c] ?? '')) as unknown as JSONValue, covered: false });
    }
    cells.push(row);
  }
  return {
    type: 'table',
    attrs: { cells, rows, cols, headerRow: true, colWidths: [] } as Attrs,
  };
}

function unescapeMdCell(s: string): string {
  return s.replace(/<br>/gi, '\n').replace(/\\\|/g, '|').replace(/\\\\/g, '\\');
}

/** Parse a Markdown string straight into a normalized document state. */
function markdownToDoc(md: string): DocState {
  const items: { indent: number; block: ParsedBlock }[] = [];
  const logical = splitBlocks(md);

  for (const group of logical) {
    if (group.kind === 'fence') {
      items.push({
        indent: 0,
        block: {
          type: 'codeBlock',
          attrs: group.lang ? { language: group.lang } : undefined,
          content: [{ type: 'text', text: group.body.join('\n') }],
        },
      });
      continue;
    }
    if (group.kind === 'table') {
      items.push({ indent: 0, block: parseTable(group.lines) });
      continue;
    }
    if (group.kind === 'math') {
      items.push({
        indent: 0,
        block: {
          type: 'equation',
          attrs: { expression: group.body.join('\n') },
          content: [],
        },
      });
      continue;
    }
    // Parse lines, tracking whether a blank line preceded each one so we
    // can merge consecutive quote / paragraph lines into a single block.
    const parsed: { indent: number; block: ParsedBlock; blankBefore: boolean }[] = [];
    let blankBefore = false;
    for (const line of group.lines) {
      if (line.trim().length === 0) {
        blankBefore = true;
        continue;
      }
      const indent = line.length - line.trimStart().length;
      const block = parseLine(line.trim());
      if (!block) {
        blankBefore = false;
        continue;
      }
      parsed.push({ indent, block, blankBefore });
      blankBefore = false;
    }

    // Merge consecutive quote / paragraph lines (same indent, no blank line
    // between them) into one block, using "\n" as the line separator.
    for (const pl of parsed) {
      const last = items[items.length - 1];
      if (
        last
        && !pl.blankBefore
        && last.indent === pl.indent
        && last.block.type === pl.block.type
        && (pl.block.type === 'quote' || pl.block.type === 'paragraph')
      ) {
        const prevContent = last.block.content ?? [];
        const newContent = pl.block.content ?? [];
        items[items.length - 1] = {
          indent: last.indent,
          block: {
            type: last.block.type,
            ...(last.block.attrs ? { attrs: last.block.attrs } : {}),
            content: [...prevContent, { type: 'text', text: '\n' }, ...newContent],
          },
        };
      } else {
        items.push({ indent: pl.indent, block: pl.block });
      }
    }
  }

  // build an actual parent/children tree from the
  // per-block indent levels using the standard indent-stack algorithm. The
  // resulting DocState has block.children / DocState.parent populated, and
  // `attrs.indent` is then written as a faithful mirror of depthOf() so the
  // view-layer indent class pipeline and legacy CSS indent rendering remain
  // consistent.
  //
  // Only INDENTABLE_TYPES (paragraph, heading, list kinds) can serve as a
  // PARENT; non-nestable blocks (codeBlock, table, image, divider, …) are
  // never pushed onto the stack, so no block can ever end up nested under a
  // non-nestable parent. However, ANY block type can BE a child — the
  // `supportsIndent` flag only controls stack-push (being a parent), not
  // whether the block's own indent level is honoured.
  const blocks = new Map<BlockId, Block>();
  const parent = new Map<BlockId, BlockId | null>();
  const root: BlockId[] = [];

  type StackEntry = { indent: number; id: BlockId };
  const stack: StackEntry[] = [];

  /** Block types that can serve as a PARENT (i.e. accept children). This
   *  mirrors `schema.nestable` but is hard-coded here because `markdownToDoc`
   *  runs before the schema registry is available. Any block type NOT in this
   *  set can still BE a child — it just can't have children of its own. */
  const PARENTABLE_TYPES = new Set([
    'paragraph', 'heading', 'bulletList', 'orderedList', 'todoList',
  ]);
  const MAX_INDENT = 10;

  // Insert helper: updates `blocks` (with fresh children array), `parent`,
  // and either `root` or the designated parent's children slice.
  const appendChild = (parentId: BlockId | null, id: BlockId, block: Block): void => {
    blocks.set(id, block);
    parent.set(id, parentId);
    if (parentId === null) {
      root.push(id);
      return;
    }
    const p = blocks.get(parentId);
    if (!p) {
      // Fallback (shouldn't happen) — re-root to top level so we don't drop.
      root.push(id);
      parent.set(id, null);
      return;
    }
    blocks.set(parentId, { ...p, children: [...p.children, id] });
  };

  for (const item of items) {
    const id = createBlockId();
    const canBeParent = PARENTABLE_TYPES.has(item.block.type);
    // 1 indentation level = 2 spaces (matches serializer pad).
    let logical = Math.floor(item.indent / 2);
    if (logical < 0) logical = 0;
    if (logical > MAX_INDENT) logical = MAX_INDENT;
    // NOTE: we do NOT clamp logical to 0 for non-PARENTABLE types — any block
    // type can be a CHILD. `canBeParent` only governs whether this block
    // can be a PARENT (i.e. be pushed onto the indent stack).

    // Pop until the stack top has strictly smaller indent. If the top block
    // is non-nestable (shouldn't be on the stack anyway), also pop it — the
    // canBeParent guard on push ensures this is belt-and-suspenders.
    while (stack.length > 0 && stack[stack.length - 1]!.indent >= logical) {
      stack.pop();
    }
    const parentId: BlockId | null = stack.length > 0 ? stack[stack.length - 1]!.id : null;

    const attrs: Record<string, JSONValue> = { ...(item.block.attrs ?? {}) };
    // NOTE: indent is NOT written from logical here; we sync attrs.indent
    // from depthOf() AFTER the entire tree is built. That way both attrs and
    // the parent chain are guaranteed consistent (same rule as every other
    // transaction in the system — single source of truth = parent chain).

    const freshBlock: Block = {
      id,
      type: item.block.type,
      attrs,
      content: item.block.content ?? [],
      children: [],
    };

    appendChild(parentId, id, freshBlock);

    if (canBeParent) {
      stack.push({ indent: logical, id });
    }
  }

  // Sync attrs.indent = depthOf() over every block (so legacy consumers of
  // the indent attr still see consistent numbers without having to walk the
  // parent chain themselves).
  const MAX_INDENT_SYNC = 10;
  for (const [id, block] of blocks) {
    let d = 0;
    let cur: BlockId | null | undefined = parent.get(id);
    const seen = new Set<BlockId | null | undefined>();
    while (cur !== undefined && cur !== null) {
      if (seen.has(cur)) break;
      seen.add(cur);
      d++;
      cur = parent.get(cur);
    }
    d = Math.min(MAX_INDENT_SYNC, d);
    const curIndent = typeof block.attrs.indent === 'number' ? (block.attrs.indent as number) : 0;
    if (curIndent === d) continue;
    const { indent: _omit, ...rest } = block.attrs;
    const nextAttrs: Attrs = d > 0 ? { ...rest, indent: d } : rest;
    blocks.set(id, { ...block, attrs: nextAttrs });
  }

  return { id: 'doc_' + Math.random().toString(36).slice(2, 10), root, blocks, parent };
}
