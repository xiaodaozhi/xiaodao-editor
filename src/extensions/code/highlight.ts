/**
 * Built-in, zero-dependency code highlighter.
 *
 * Why this exists: the code block used to bundle highlight.js (24 language
 * grammars) for syntax coloring. That made the package carry a runtime
 * dependency and bloated the bundle. This module replaces it with a small,
 * self-contained tokenizer so the editor ships with NO third-party code
 * highlighter by default.
 *
 * Design:
 *  - Single pass, never throws; every text fragment is escaped before it is
 *    emitted, so the returned string is always safe to assign to innerHTML.
 *  - Output uses the SAME `hljs-*` token class names as highlight.js, so the
 *    existing stylesheet (`src/style.css`, the `.block-code-highlight .hljs-*`
 *    palette) keeps working unchanged, and an external highlight.js adapter
 *    produces visually identical output. Class names are just strings: this
 *    module never imports highlight.js.
 *  - Languages the built-in does not special-case degrade gracefully to
 *    escaped plain text (the prior contract: unknown `attrs.language` => no
 *    highlighting, just escaped text).
 *
 * Injectability: the code block extension accepts a `CodeHighlighter` via
 * `createCodeBlockExtension({ highlighter })`. Swap in highlight.js / Shiki /
 * Prism / any engine by implementing `highlightCode(text, lang)`.
 */

/** A pluggable code highlighter. Implement this to override the built-in. */
export interface CodeHighlighter {
  /**
   * Return highlighted, HTML-escaped markup for `text` written in `language`.
   * The implementation MUST escape the text itself (it is injected via
   * innerHTML). For languages it cannot handle, return escaped plain text.
   */
  highlightCode(text: string, language: string): string;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function span(cls: string, raw: string): string {
  return `<span class="${cls}">${escapeHtml(raw)}</span>`;
}

// ---------------------------------------------------------------------------
// Shared keyword tables (a pragmatic, language-agnostic subset)
// ---------------------------------------------------------------------------

const C_KEYWORDS = new Set([
  'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'do',
  'switch', 'case', 'break', 'continue', 'new', 'class', 'extends', 'super', 'this',
  'typeof', 'instanceof', 'in', 'of', 'await', 'async', 'yield', 'try', 'catch',
  'finally', 'throw', 'delete', 'void', 'import', 'export', 'from', 'default',
  'static', 'public', 'private', 'protected', 'get', 'set', 'interface', 'type',
  'enum', 'implements', 'abstract', 'package', 'using', 'namespace', 'struct',
  'def', 'lambda', 'elif', 'except', 'raise', 'with', 'as', 'pass', 'global',
  'nonlocal', 'begin', 'end', 'then', 'unless', 'module', 'fn', 'mut', 'pub',
  'where', 'select', 'group', 'order', 'join', 'into',
]);

const C_LITERALS = new Set([
  'true', 'false', 'null', 'undefined', 'nil', 'None', 'True', 'False', 'void',
]);

const C_BUILTINS = new Set([
  'console', 'Math', 'Array', 'String', 'Number', 'Boolean', 'Object', 'JSON',
  'document', 'window', 'setTimeout', 'setInterval', 'Promise', 'parseInt',
  'parseFloat', 'require', 'module', 'exports', 'len', 'print', 'range', 'int',
  'str', 'bool', 'list', 'dict', 'tuple', 'open', 'enumerate', 'zip', 'map',
  'filter', 'sum', 'min', 'max', 'abs', 'sorted',
]);

// ---------------------------------------------------------------------------
// Generic C-like scanner (covers JS/TS/Java/C/C++/C#/Go/Rust/Swift/Kotlin/
// PHP/Dart/Python/Ruby/Lua/Shell/SQL/... via per-language comment delimiters)
// ---------------------------------------------------------------------------

interface ClikeProfile {
  lineComments: string[];
  blockComments: Array<[string, string]>;
  strings: string[];
  keywords: Set<string>;
  literals: Set<string>;
  builtins: Set<string>;
}

function makeProfile(extra: {
  lineComments?: string[];
  blockComments?: Array<[string, string]>;
  keywords?: string[];
  builtins?: string[];
}): ClikeProfile {
  return {
    lineComments: extra.lineComments ?? [],
    blockComments: extra.blockComments ?? [['/*', '*/']],
    strings: ['"', "'", '`'],
    keywords: new Set([...C_KEYWORDS, ...(extra.keywords ?? [])]),
    literals: C_LITERALS,
    builtins: new Set([...C_BUILTINS, ...(extra.builtins ?? [])]),
  };
}

function isIdentStart(ch: string): boolean {
  return /[A-Za-z_$]/.test(ch);
}

function isDigitStart(text: string, i: number): boolean {
  const c = text.charAt(i);
  if (c >= '0' && c <= '9') return true;
  return c === '.' && text.charAt(i + 1) >= '0' && text.charAt(i + 1) <= '9';
}

function consumeIdent(text: string, i: number): number {
  let j = i;
  while (j < text.length && /[A-Za-z0-9_$]/.test(text.charAt(j))) j++;
  return j;
}

function consumeNumber(text: string, i: number): number {
  let j = i;
  if (text.charAt(j) === '0' && (text.charAt(j + 1) === 'x' || text.charAt(j + 1) === 'X')) {
    j += 2;
    while (j < text.length && /[0-9a-fA-F_]/.test(text.charAt(j))) j++;
    return j;
  }
  while (j < text.length && /[0-9_]/.test(text.charAt(j))) j++;
  if (text.charAt(j) === '.') {
    j++;
    while (j < text.length && /[0-9_]/.test(text.charAt(j))) j++;
  }
  if (text.charAt(j) === 'e' || text.charAt(j) === 'E') {
    j++;
    if (text.charAt(j) === '+' || text.charAt(j) === '-') j++;
    while (j < text.length && /[0-9_]/.test(text.charAt(j))) j++;
  }
  while (j < text.length && /[A-Za-z_]/.test(text.charAt(j))) j++; // type/format suffix
  return j;
}

function lineCommentStop(text: string, i: number, p: ClikeProfile): number {
  for (const lc of p.lineComments) {
    if (!text.startsWith(lc, i)) continue;
    const prev = i === 0 ? '\n' : text.charAt(i - 1);
    // Avoid turning `http://` or `a//b` into a comment: require a boundary
    // before the delimiter (line start or whitespace/punctuation).
    if (prev === '\n' || prev === ' ' || prev === '\t' || prev === '('
      || prev === '{' || prev === ';' || prev === ',' || prev === '=') {
      const nl = text.indexOf('\n', i);
      return nl === -1 ? text.length : nl;
    }
  }
  return -1;
}

function highlightClike(text: string, p: ClikeProfile): string {
  let out = '';
  let i = 0;
  const n = text.length;
  while (i < n) {
    // Block comment
    let matched = false;
    for (const [open, close] of p.blockComments) {
      if (text.startsWith(open, i)) {
        const end = text.indexOf(close, i + open.length);
        const stop = end === -1 ? n : end + close.length;
        out += span('hljs-comment', text.slice(i, stop));
        i = stop;
        matched = true;
        break;
      }
    }
    if (matched) continue;

    // Line comment
    const lcStop = lineCommentStop(text, i, p);
    if (lcStop !== -1) {
      out += span('hljs-comment', text.slice(i, lcStop));
      i = lcStop;
      continue;
    }

    const ch = text.charAt(i);

    // String
    if (p.strings.includes(ch)) {
      const delim = ch;
      let j = i + 1;
      while (j < n) {
        if (text.charAt(j) === '\\') { j += 2; continue; }
        if (text.charAt(j) === delim) { j++; break; }
        j++;
      }
      out += span('hljs-string', text.slice(i, j));
      i = j;
      continue;
    }

    // Number
    if (isDigitStart(text, i)) {
      const j = consumeNumber(text, i);
      out += span('hljs-number', text.slice(i, j));
      i = j;
      continue;
    }

    // Identifier / keyword / built-in / function call
    if (isIdentStart(ch)) {
      const j = consumeIdent(text, i);
      const word = text.slice(i, j);
      let cls: string | null = null;
      if (p.keywords.has(word)) cls = 'hljs-keyword';
      else if (p.literals.has(word)) cls = 'hljs-literal';
      else if (p.builtins.has(word)) cls = 'hljs-built_in';
      else {
        let k = j;
        while (k < n && (text.charAt(k) === ' ' || text.charAt(k) === '\t')) k++;
        if (text.charAt(k) === '(') cls = 'hljs-title';
      }
      out += cls ? span(cls, word) : escapeHtml(word);
      i = j;
      continue;
    }

    // Punctuation / operator / whitespace: emit escaped as-is.
    out += escapeHtml(ch);
    i++;
  }
  return out;
}

const dosProfile = makeProfile({
  lineComments: [],
  keywords: ['rem', 'echo', 'set', 'if', 'for', 'call', 'goto', 'pause', 'exit', 'cd', 'dir'],
});

const PROFILES: Record<string, ClikeProfile> = {
  javascript: makeProfile({ lineComments: ['//'] }),
  typescript: makeProfile({ lineComments: ['//'] }),
  java: makeProfile({ lineComments: ['//'] }),
  c: makeProfile({ lineComments: ['//'] }),
  cpp: makeProfile({ lineComments: ['//'] }),
  csharp: makeProfile({ lineComments: ['//'] }),
  go: makeProfile({ lineComments: ['//'] }),
  rust: makeProfile({ lineComments: ['//'] }),
  swift: makeProfile({ lineComments: ['//'] }),
  kotlin: makeProfile({ lineComments: ['//'] }),
  dart: makeProfile({ lineComments: ['//'] }),
  php: makeProfile({ lineComments: ['//', '#'] }),
  python: makeProfile({
    lineComments: ['#'],
    builtins: ['print', 'len', 'range', 'int', 'str', 'bool', 'list', 'dict', 'tuple', 'open', 'enumerate', 'zip', 'sum', 'min', 'max', 'abs', 'sorted'],
  }),
  ruby: makeProfile({
    lineComments: ['#'],
    keywords: ['def', 'end', 'do', 'require', 'attr', 'nil'],
    builtins: ['puts', 'print', 'require'],
  }),
  lua: makeProfile({
    lineComments: ['--'],
    blockComments: [['--[[', ']]']],
    keywords: ['function', 'end', 'then', 'elseif', 'local', 'nil'],
    builtins: ['print', 'pairs', 'ipairs', 'tonumber', 'tostring'],
  }),
  bash: makeProfile({
    lineComments: ['#'],
    keywords: ['if', 'then', 'else', 'elif', 'fi', 'for', 'in', 'do', 'done', 'while', 'case', 'esac', 'function', 'return', 'export', 'source'],
    builtins: ['echo', 'cd', 'ls', 'cat', 'grep', 'sed', 'awk', 'printf', 'read', 'set', 'unset', 'exit'],
  }),
  shell: makeProfile({
    lineComments: ['#'],
    keywords: ['if', 'then', 'else', 'elif', 'fi', 'for', 'in', 'do', 'done', 'while', 'case', 'esac', 'function', 'return', 'export'],
    builtins: ['echo', 'cd', 'ls', 'cat', 'grep', 'sed', 'awk', 'printf', 'read', 'set'],
  }),
  powershell: makeProfile({
    lineComments: ['#'],
    blockComments: [['<#', '#>']],
    keywords: ['function', 'process', 'begin', 'end', 'if', 'else', 'elseif', 'for', 'foreach', 'while', 'switch', 'return', 'param'],
    builtins: ['Write-Host', 'Write-Output', 'Get-ChildItem', 'Set-Location'],
  }),
  sql: makeProfile({
    lineComments: ['--'],
    keywords: [
      'select', 'from', 'where', 'insert', 'update', 'delete', 'create', 'table',
      'drop', 'alter', 'join', 'on', 'group', 'by', 'order', 'having', 'limit',
      'values', 'into', 'set', 'as', 'and', 'or', 'not', 'null', 'distinct',
      'count', 'sum', 'avg', 'min', 'max',
    ],
  }),
  cmd: dosProfile,
  bat: dosProfile,
  dos: dosProfile,
  yaml: makeProfile({ lineComments: ['#'] }),
};

// ---------------------------------------------------------------------------
// Specialized scanners for markup / data languages
// ---------------------------------------------------------------------------

function highlightXml(text: string): string {
  let out = '';
  let i = 0;
  const n = text.length;
  while (i < n) {
    if (text.startsWith('<!--', i)) {
      const end = text.indexOf('-->', i + 4);
      const stop = end === -1 ? n : end + 3;
      out += span('hljs-comment', text.slice(i, stop));
      i = stop;
      continue;
    }
    if (text.charAt(i) === '<') {
      let j = i + 1;
      let tagOut = '&lt;';
      if (text.charAt(j) === '/') { tagOut += '/'; j++; }
      const nameStart = j;
      while (j < n && /[A-Za-z0-9_:.-]/.test(text.charAt(j))) j++;
      if (j > nameStart) tagOut += span('hljs-name', text.slice(nameStart, j));
      while (j < n && text.charAt(j) !== '>') {
        const ch = text.charAt(j);
        if (ch === '"' || ch === "'") {
          const delim = ch;
          let k = j + 1;
          while (k < n && text.charAt(k) !== delim) k++;
          k = Math.min(k + 1, n);
          tagOut += span('hljs-string', text.slice(j, k));
          j = k;
          continue;
        }
        if (/[A-Za-z_:-]/.test(ch) && ch !== '=') {
          const aStart = j;
          while (j < n && /[A-Za-z0-9_:-]/.test(text.charAt(j)) && text.charAt(j) !== '=') j++;
          tagOut += span('hljs-attr', text.slice(aStart, j));
          continue;
        }
        tagOut += escapeHtml(ch);
        j++;
      }
      if (text.charAt(j) === '>') { tagOut += '&gt;'; j++; }
      out += span('hljs-tag', tagOut);
      i = j;
      continue;
    }
    out += escapeHtml(text.charAt(i));
    i++;
  }
  return out;
}

function highlightCss(text: string): string {
  let out = '';
  let i = 0;
  const n = text.length;
  while (i < n) {
    if (text.startsWith('/*', i)) {
      const end = text.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      out += span('hljs-comment', text.slice(i, stop));
      i = stop;
      continue;
    }
    const c = text.charAt(i);
    if (c === '"' || c === "'") {
      const delim = c;
      let k = i + 1;
      while (k < n && text.charAt(k) !== delim) k++;
      k = Math.min(k + 1, n);
      out += span('hljs-string', text.slice(i, k));
      i = k;
      continue;
    }
    if (isIdentStart(c)) {
      const j = consumeIdent(text, i);
      const word = text.slice(i, j);
      let k = j;
      while (k < n && (text.charAt(k) === ' ' || text.charAt(k) === '\t')) k++;
      if (text.charAt(k) === ':') out += span('hljs-attr', word);
      else if (text.charAt(k) === '{') out += span(word.startsWith('@') ? 'hljs-keyword' : 'hljs-selector-tag', word);
      else out += escapeHtml(word);
      i = j;
      continue;
    }
    if (isDigitStart(text, i)) {
      const j = consumeNumber(text, i);
      out += span('hljs-number', text.slice(i, j));
      i = j;
      continue;
    }
    out += escapeHtml(c);
    i++;
  }
  return out;
}

function highlightJson(text: string): string {
  let out = '';
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text.charAt(i);
    if (c === '"') {
      const k = i + 1;
      let j = k;
      while (j < n) {
        if (text.charAt(j) === '\\') { j += 2; continue; }
        if (text.charAt(j) === '"') { j++; break; }
        j++;
      }
      const str = text.slice(i, j);
      let p = j;
      while (p < n && (text.charAt(p) === ' ' || text.charAt(p) === '\t')) p++;
      out += span(text.charAt(p) === ':' ? 'hljs-attr' : 'hljs-string', str);
      i = j;
      continue;
    }
    if (isDigitStart(text, i)) {
      const j = consumeNumber(text, i);
      out += span('hljs-number', text.slice(i, j));
      i = j;
      continue;
    }
    if (c === 't' && text.startsWith('true', i)) { out += span('hljs-literal', 'true'); i += 4; continue; }
    if (c === 'f' && text.startsWith('false', i)) { out += span('hljs-literal', 'false'); i += 5; continue; }
    if (c === 'n' && text.startsWith('null', i)) { out += span('hljs-literal', 'null'); i += 4; continue; }
    out += escapeHtml(c);
    i++;
  }
  return out;
}

function highlightYaml(text: string): string {
  const yamlProfile = PROFILES.yaml ?? makeProfile({ lineComments: ['#'] });
  return text
    .split('\n')
    .map((line) => {
      const ci = line.indexOf('#');
      const code = ci === -1 ? line : line.slice(0, ci);
      const comment = ci === -1 ? '' : line.slice(ci);
      const m = /^(\s*(?:-\s+)?)([A-Za-z_][\w$.-]*)(:)(\s|$)/.exec(code);
      let out: string;
      if (m) {
        const full = m[0];
        const rest = code.slice(full.length);
        out = escapeHtml(m[1] ?? '') + span('hljs-attr', m[2] ?? '') + escapeHtml(m[3] ?? '') + escapeHtml(m[4] ?? '') + highlightClike(rest, yamlProfile);
      } else {
        out = highlightClike(code, yamlProfile);
      }
      return comment ? out + span('hljs-comment', comment) : out;
    })
    .join('\n');
}

function highlightMarkdown(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      const h = /^(#{1,6})\s+/.exec(line);
      if (h) return span('hljs-title', line);
      let out = '';
      let i = 0;
      while (i < line.length) {
        if (line.charAt(i) === '`') {
          const k = line.indexOf('`', i + 1);
          const stop = k === -1 ? line.length : k + 1;
          out += span('hljs-string', line.slice(i, stop));
          i = stop;
          continue;
        }
        const link = /\]\(([^)]*)\)/.exec(line.slice(i));
        if (line.charAt(i) === '[' && link) {
          const len = link[0].length + 1;
          out += span('hljs-string', line.slice(i, i + len));
          i += len;
          continue;
        }
        out += escapeHtml(line.charAt(i));
        i++;
      }
      return out;
    })
    .join('\n');
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

function builtinHighlight(text: string, lang: string): string {
  switch (lang) {
    case 'xml':
    case 'html':
      return highlightXml(text);
    case 'css':
      return highlightCss(text);
    case 'markdown':
      return highlightMarkdown(text);
    case 'json':
      return highlightJson(text);
    case 'yaml':
      return highlightYaml(text);
    default: {
      const profile = PROFILES[lang];
      return profile ? highlightClike(text, profile) : escapeHtml(text);
    }
  }
}

/** The default code highlighter: zero third-party dependencies. */
export const builtinCodeHighlighter: CodeHighlighter = {
  highlightCode(text, language) {
    if (!text) return '';
    try {
      return builtinHighlight(text, language ?? 'plain');
    } catch {
      return escapeHtml(text);
    }
  },
};
