import { describe, expect, it } from 'vitest';
import { Editor } from '@/core/Editor';
import { inlineText, type BlockData } from '@/core/types';

function paragraph(text = '', children?: readonly BlockData[]): BlockData {
  return {
    type: 'paragraph',
    content: text ? [{ type: 'text', text }] : [],
    children,
  };
}

function exportMarkdown(blocks: readonly BlockData[]): string {
  const editor = new Editor({ extensions: [], initialData: { blocks } });
  const markdown = editor.toMarkdown();
  editor.destroy();
  return markdown;
}

interface BlockShape {
  type: string;
  text: string;
  children: BlockShape[];
}

function blockShape(block: BlockData): BlockShape {
  return {
    type: block.type,
    text: inlineText(block.content ?? []),
    children: (block.children ?? []).map(blockShape),
  };
}

function expectRoundTrip(blocks: readonly BlockData[], expectedMarkdown: string): void {
  const editor = new Editor({ extensions: [], initialData: { blocks } });
  const markdown = editor.toMarkdown();
  expect(markdown).toBe(expectedMarkdown);

  editor.setDocFromMarkdown(markdown);
  expect(editor.toData().blocks.map(blockShape)).toEqual(blocks.map(blockShape));
  expect(editor.toMarkdown()).toBe(markdown);
  editor.destroy();
}

describe('Markdown empty paragraphs', () => {
  it.each([
    { name: 'adjacent paragraphs', paragraphs: ['A', 'B'], expected: 'A\n\nB' },
    { name: 'one empty paragraph', paragraphs: ['A', '', 'B'], expected: 'A\n\n\n\nB' },
    { name: 'two empty paragraphs', paragraphs: ['A', '', '', 'B'], expected: 'A\n\n\n\n\n\nB' },
    { name: 'empty paragraphs at both ends', paragraphs: ['', '', 'A', ''], expected: '\n\n\n\nA\n\n' },
    { name: 'an all-empty document', paragraphs: ['', '', ''], expected: '\n\n\n\n' },
  ])('round-trips $name', ({ paragraphs, expected }) => {
    expectRoundTrip(paragraphs.map((text) => paragraph(text)), expected);
  });

  it('keeps a fresh document empty', () => {
    expect(exportMarkdown([])).toBe('');
    expectRoundTrip([paragraph()], '');
  });

  it('round-trips empty paragraphs in nested document order', () => {
    const blocks = [paragraph('A', [paragraph(), paragraph('B')]), paragraph('C')];

    expectRoundTrip(blocks, 'A\n\n  \n\n  B\nC');
  });

  it('round-trips a leading empty paragraph with children', () => {
    const blocks = [paragraph('', [paragraph('A'), paragraph()]), paragraph('B')];

    expectRoundTrip(blocks, '\n\n  A\n\n  \n\nB');
  });

  it('outputs ordinary paragraph separators and uninterrupted list items', () => {
    const list = (text: string): BlockData => ({ type: 'bulletList', content: [{ type: 'text', text }] });
    const blocks = [paragraph('A'), paragraph('B'), list('C'), { type: 'tableOfContents' }, list('D')];

    expect(exportMarkdown(blocks)).toBe('A\n\nB\n\n- C\n- D');
    expectRoundTrip([list('C'), paragraph(), list('D')], '- C\n\n\n\n- D');
  });

  it('imports CRLF and counts complete pairs beyond the normal separator', () => {
    const editor = new Editor({ extensions: [], initialData: 'A\r\nB\r\n\r\n\r\n\r\n\r\nC\r\n' });

    expect(editor.toData().blocks.map(blockShape)).toEqual([paragraph('A\nB'), paragraph(), paragraph('C')].map(blockShape));
    expect(editor.toMarkdown()).toBe('A\nB\n\n\n\nC');
    editor.destroy();
  });

  it('restores empty paragraphs around fenced blocks and tables', () => {
    const code = '```text\nA\n\n\n\nB\n```';
    const math = '$$$\nx\n\n\n\ny\n$$$';
    const table = '| A | B |\n| --- | --- |\n| C | D |';
    const editor = new Editor({ extensions: [], initialData: ['', code, '', math, '', table, '', 'C', ''].join('\n\n') });
    const blocks = editor.toData().blocks;

    expect(blocks.map(({ type }) => type)).toEqual([
      'paragraph', 'codeBlock', 'paragraph', 'equation', 'paragraph', 'table', 'paragraph', 'paragraph', 'paragraph',
    ]);
    expect(inlineText(blocks[1]?.content ?? [])).toBe('A\n\n\n\nB');
    expect(blocks[3]?.attrs?.expression).toBe('x\n\n\n\ny');
    expect(blocks.filter(({ type }) => type === 'paragraph').map(blockShape)).toEqual([
      paragraph(), paragraph(), paragraph(), paragraph(), paragraph('C'), paragraph(),
    ].map(blockShape));
    editor.destroy();
  });
});
