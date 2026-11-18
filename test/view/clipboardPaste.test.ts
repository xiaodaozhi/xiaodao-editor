import { describe, expect, it, onTestFinished } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { caretSelection } from '@/core/selection/Selection';
import { inlineFromString, inlineText } from '@/core/types';
import BlockEditor from '@/view/BlockEditor.vue';
import { createEditor } from '@/view/createEditor';

function mountEditor(type: 'codeBlock' | 'paragraph', text = '') {
  const attrs = type === 'codeBlock' ? { language: 'javascript' } : {};
  const editor = createEditor({
    initialData: {
      blocks: [
        { id: 'target', type, attrs, content: inlineFromString(text) },
        { id: 'sibling', type: 'paragraph', content: inlineFromString('Next block') },
      ],
    },
  });
  const wrapper = mount(BlockEditor, { attachTo: document.body, props: { editor } });
  onTestFinished(() => {
    wrapper.unmount();
    editor.destroy();
  });
  return { editor, target: wrapper.get<HTMLElement>('.block-content[data-block-id="target"]').element };
}

async function paste(target: HTMLElement, text: string, html = ''): Promise<void> {
  const data = new DataTransfer();
  if (text) data.setData('text/plain', text);
  if (html) data.setData('text/html', html);
  const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data });
  target.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  await nextTick();
}

describe('clipboard paste', () => {
  it.each(['', '<div>Rich text</div><div>More rich text</div>'])(
    'keeps all plain-text lines and whitespace in the code block (HTML %j)',
    async (html) => {
      const { editor, target } = mountEditor('codeBlock');
      target.focus();
      await paste(target, '\r\n  function greet() {\r\n\r\n\treturn "hello";  \r\n}\r\n', html);
      const expected = '\n  function greet() {\n\n\treturn "hello";  \n}\n';

      expect(editor.toData().blocks).toHaveLength(2);
      expect(editor.toData().blocks[0]).toMatchObject({
        id: 'target',
        type: 'codeBlock',
        attrs: { language: 'javascript' },
        content: inlineFromString(expected),
      });
      expect(target.textContent).toBe(expected);
      expect(editor.getState().selection).toEqual(caretSelection('target', expected.length));
    },
  );

  it('replaces the selected code and keeps the suffix in the same block', async () => {
    const { editor, target } = mountEditor('codeBlock', 'before OLD after');
    target.focus();
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.setStart(target.firstChild!, 7);
    range.setEnd(target.firstChild!, 10);
    selection.removeAllRanges();
    selection.addRange(range);

    const inserted = 'new();\nmore();';
    await paste(target, inserted);

    expect(target.textContent).toBe(`before ${inserted} after`);
    expect(editor.getState().selection).toEqual(caretSelection('target', 7 + inserted.length));
    expect(selection.anchorNode).toBe(target.firstChild);
    expect(selection.anchorOffset).toBe(7 + inserted.length);
    expect(selection.isCollapsed).toBe(true);

    expect(editor.undo()).toBe(true);
    await nextTick();
    expect(target.textContent).toBe('before OLD after');
    expect(editor.toData().blocks.map((block) => block.id)).toEqual(['target', 'sibling']);
  });

  it('keeps HTML-only text in the code block without importing inline marks', async () => {
    const { editor, target } = mountEditor('codeBlock');
    await paste(target, '', '<p><b>first()</b></p><p>second()</p>');

    expect(editor.toData().blocks).toHaveLength(2);
    expect(editor.toData().blocks[0]?.content).toEqual(inlineFromString('first()\nsecond()'));
  });

  it('still creates separate blocks when pasting plain text into a paragraph', async () => {
    const { editor, target } = mountEditor('paragraph');
    await paste(target, 'first\nsecond');

    expect(editor.toData().blocks.map((block) => [block.type, inlineText(block.content ?? [])])).toEqual([
      ['paragraph', 'first'],
      ['paragraph', 'second'],
      ['paragraph', 'Next block'],
    ]);
  });
});
