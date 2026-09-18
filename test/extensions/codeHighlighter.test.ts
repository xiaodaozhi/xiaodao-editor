import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { Editor } from '@/core/Editor';
import BlockEditor from '@/view/BlockEditor.vue';
import { BuiltinExtensions } from '@/extensions/builtin';
import {
  builtinCodeHighlighter,
  createCodeBlockExtension,
  CodeBlockExtension,
  type CodeHighlighter,
} from '@/extensions/CodeBlock';
import { inlineFromString } from '@/core/types';
import type { Block } from '@/core/types';

/**
 * A stand-in for a third-party engine (highlight.js / Shiki / ...). It only
 * produces an HTML string, exactly like a real adapter would.
 */
function fakeHighlighter(marker: string): CodeHighlighter {
  return {
    highlightCode(text) {
      return `<span class="fake-code">${marker}:${text}</span>`;
    },
  };
}

function makeBlock(code: string, language = 'javascript'): Block {
  return {
    id: 'cb1',
    type: 'codeBlock',
    attrs: { language },
    content: inlineFromString(code),
    children: [],
  } as unknown as Block;
}

describe('code highlighter injection', () => {
  it('defaults to the built-in (zero-dependency) highlighter', () => {
    const html = CodeBlockExtension.serialize!.toHTML!(makeBlock('const x = 1;', 'javascript'));
    expect(html).toContain('block-code-highlight');
    expect(html).toContain('hljs-keyword'); // `const` is highlighted
    expect(html).toContain('const');
  });

  it('uses the injected highlighter for serialize.toHTML', () => {
    const ext = createCodeBlockExtension({ highlighter: fakeHighlighter('X') });
    const html = ext.serialize!.toHTML!(makeBlock('const x = 1;'));
    expect(html).toContain('X:const x = 1;');
    expect(html).toContain('fake-code');
    expect(html).not.toContain('hljs-keyword');
  });

  it('uses the injected highlighter inside the block component', () => {
    const wrapper = mount(BlockEditor as any, {
      props: {
        initialData: {
          blocks: [
            { id: 'b1', type: 'codeBlock', attrs: { language: 'javascript' }, content: inlineFromString('const x = 1;'), children: [] },
          ],
        },
        extensions: [...BuiltinExtensions, createCodeBlockExtension({ highlighter: fakeHighlighter('ZZ') })],
      },
    });
    const html = wrapper.html();
    expect(html).toContain('ZZ:const x = 1;');
    expect(html).toContain('fake-code');
    expect(html).not.toContain('hljs-keyword');
  });

  it('keeps the built-in highlighter when none is injected', () => {
    const wrapper = mount(BlockEditor as any, {
      props: {
        initialData: {
          blocks: [
            { id: 'b1', type: 'codeBlock', attrs: { language: 'javascript' }, content: inlineFromString('const x = 1;'), children: [] },
          ],
        },
      },
    });
    expect(wrapper.html()).toContain('hljs-keyword');
    expect(wrapper.html()).not.toContain('fake-code');
  });

  it('survives a highlighter that throws (degrades to escaped plain text)', () => {
    const boom: CodeHighlighter = { highlightCode() { throw new Error('boom'); } };
    const html = createCodeBlockExtension({ highlighter: boom }).serialize!.toHTML!(makeBlock('a < b'));
    expect(html).toContain('block-code-highlight');
    expect(html).toContain('a &lt; b'); // escaped, no crash
  });

  it('survives a highlighter that returns garbage (no crash)', () => {
    const garbage: CodeHighlighter = { highlightCode: (() => null) as any };
    const html = createCodeBlockExtension({ highlighter: garbage }).serialize!.toHTML!(makeBlock('const x = 1;'));
    expect(html).toContain('block-code-highlight'); // still renders, no throw
  });

  it('built-in highlighter escapes HTML in code', () => {
    const html = builtinCodeHighlighter.highlightCode('const x = "<b>";', 'javascript');
    expect(html).toContain('&lt;b&gt;');
    expect(html).not.toContain('<b>');
  });
});

describe('extension override mechanism (what `createCodeBlockExtension({ highlighter })` relies on)', () => {
  it('built-in extensions register the default code block component', () => {
    const editor = new Editor({ extensions: BuiltinExtensions });
    const spec = editor.registries.renderers.get('codeBlock');
    expect(spec?.component).toBe(CodeBlockExtension.renderer!.component);
  });

  it('a later `codeBlock` extension wins (name-based de-duplication)', () => {
    const editor = new Editor({
      extensions: [...BuiltinExtensions, createCodeBlockExtension({ highlighter: fakeHighlighter('Y') })],
    });
    const spec = editor.registries.renderers.get('codeBlock');
    expect(spec?.component).not.toBe(CodeBlockExtension.renderer!.component);
    const html = createCodeBlockExtension({ highlighter: fakeHighlighter('Y') }).serialize!.toHTML!(makeBlock('q'));
    expect(html).toContain('Y:q');
  });
});

describe('<BlockEditor :extensions> with custom CodeBlockExtension', () => {
  it('renders code through the injected highlighter passed via :extensions', () => {
    const wrapper = mount(BlockEditor as any, {
      props: {
        initialData: {
          blocks: [
            { id: 'b1', type: 'codeBlock', attrs: { language: 'javascript' }, content: inlineFromString('const x = 1;'), children: [] },
          ],
        },
        extensions: [...BuiltinExtensions, createCodeBlockExtension({ highlighter: fakeHighlighter('ZZ') })],
      },
    });
    const html = wrapper.html();
    expect(html).toContain('ZZ:const x = 1;');
    expect(html).not.toContain('hljs-keyword');
  });

  it('renders code through the built-in highlighter when :extensions is omitted', () => {
    const wrapper = mount(BlockEditor as any, {
      props: {
        initialData: {
          blocks: [
            { id: 'b1', type: 'codeBlock', attrs: { language: 'javascript' }, content: inlineFromString('const x = 1;'), children: [] },
          ],
        },
      },
    });
    expect(wrapper.html()).toContain('hljs-keyword');
  });
});
