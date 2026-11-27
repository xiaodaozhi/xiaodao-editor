import { describe, expect, it } from 'vitest';
import { Editor } from '@/core/Editor';
import type { BlockData } from '@/core/types';

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

describe('Editor.toMarkdown()', () => {
  it.each([
    { name: 'before text', paragraphs: ['', '', 'A'], expected: '\n\nA' },
    { name: 'between paragraphs', paragraphs: ['A', '', '', 'B'], expected: 'A\n\n\n\nB' },
    { name: 'after text', paragraphs: ['A', '', ''], expected: 'A\n\n' },
    { name: 'in an all-empty document', paragraphs: ['', '', ''], expected: '\n\n' },
  ])('preserves empty paragraphs $name', ({ paragraphs, expected }) => {
    expect(exportMarkdown(paragraphs.map((text) => paragraph(text)))).toBe(expected);
  });

  it('keeps a fresh document empty', () => {
    expect(exportMarkdown([])).toBe('');
  });

  it('keeps empty paragraphs in nested document order', () => {
    const blocks = [paragraph('A', [paragraph(), paragraph('B')]), paragraph('C')];

    expect(exportMarkdown(blocks)).toBe('A\n\n  B\nC');
  });

  it('outputs ordinary paragraph separators and uninterrupted list items', () => {
    const list = (text: string): BlockData => ({ type: 'bulletList', content: [{ type: 'text', text }] });
    const blocks = [paragraph('A'), paragraph('B'), list('C'), { type: 'tableOfContents' }, list('D')];

    expect(exportMarkdown(blocks)).toBe('A\n\nB\n\n- C\n- D');
    expect(exportMarkdown([list('C'), paragraph(), list('D')])).toBe('- C\n\n- D');
  });
});
