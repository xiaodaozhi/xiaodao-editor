import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick, reactive } from 'vue';
import BlockEditor from '@/view/BlockEditor.vue';
import { createEditor } from '@/view/createEditor';
import { Editor } from '@/core/Editor';
import type { DocumentData } from '@/core/types';
import { BuiltinExtensions } from '@/extensions/builtin';
import { ParagraphExtension } from '@/extensions/Paragraph';
import { START_IMAGE_UPLOAD_METHOD } from '@/extensions/Image';

/**
 * External editor ownership: `<BlockEditor :editor="editor">` plus the
 * `createEditor()` factory, and the `initialData` (one-way) prop with the
 * `change` / `editor.onChange` document-change event replacing two-way
 * `v-model`.
 *
 * The contract under test:
 *  1. An injected instance is used as-is (no second editor is built).
 *  2. The component never destroys an instance it did not create.
 *  3. `editable` sync keeps working either way.
 *  4. Creation-time props (`extensions`, `initialData` as the initial
 *     document) are ignored when `:editor` is set, and dev mode says so.
 *  5. `initialData` seeds the document once at construction; changing it
 *     later does NOT reload the document (no two-way binding).
 *  6. Document changes surface via `change` (internal mode) / `editor.onChange`
 *     (external mode). There is no `update:modelValue` anymore.
 */

function docWithText(text: string): DocumentData {
  return {
    blocks: [
      {
        id: 'b1',
        type: 'paragraph',
        attrs: {},
        content: [{ type: 'text', text }],
        children: [],
      },
    ],
  };
}

function exposedEditor(wrapper: ReturnType<typeof mount>): Editor {
  return (wrapper.vm as { editor: Editor }).editor;
}

describe('createEditor()', () => {
  it('defaults to the built-in extension bundle', () => {
    const editor = createEditor();
    expect(editor).toBeInstanceOf(Editor);
    expect(editor.registries.schema.has('paragraph')).toBe(true);
    expect(editor.registries.schema.has('heading')).toBe(true);
    editor.destroy();
  });

  it('uses an explicit extension list verbatim (no built-ins mixed in)', () => {
    const editor = createEditor({ extensions: [ParagraphExtension] });
    expect(editor.registries.schema.has('paragraph')).toBe(true);
    expect(editor.registries.schema.has('heading')).toBe(false);
    editor.destroy();
  });

  it('honours initialData', () => {
    const editor = createEditor({ initialData: docWithText('hello') });
    expect(JSON.stringify(editor.toData())).toContain('hello');
    editor.destroy();
  });

  it('is destructible exactly once (destroy is idempotent)', () => {
    const editor = createEditor();
    editor.destroy();
    expect(() => editor.destroy()).not.toThrow();
  });

  it('fires onChange when the content changes', () => {
    const editor = createEditor();
    const seen: DocumentData[] = [];
    const unsubscribe = editor.onChange((doc) => seen.push(doc));
    editor.setDocument(docWithText('changed'));
    expect(seen.length).toBe(1);
    expect(JSON.stringify(seen[0])).toContain('changed');
    unsubscribe();
    editor.destroy();
  });

  it('parses a Markdown string passed as initialData', () => {
    const editor = createEditor({ initialData: '# 标题\n\n正文段落' });
    const blocks = editor.toData().blocks;
    expect(blocks[0]?.type).toBe('heading');
    expect(blocks[1]?.type).toBe('paragraph');
    expect(editor.toMarkdown()).toContain('# 标题');
    editor.destroy();
  });

  it('fires onChangeMarkdown with Markdown on content change', () => {
    const editor = createEditor();
    const seen: string[] = [];
    const unsubscribe = editor.onChangeMarkdown((md) => seen.push(md));
    editor.setDocument(docWithText('changed'));
    expect(seen.length).toBe(1);
    expect(seen[0]).toBe(editor.toMarkdown());
    expect(seen[0]).toContain('changed');
    unsubscribe();
    editor.destroy();
  });
});

describe('<BlockEditor :editor>', () => {
  it('uses the injected instance instead of building its own', () => {
    const editor = createEditor();
    const wrapper = mount(BlockEditor as never, { props: { editor } });
    expect(exposedEditor(wrapper)).toBe(editor);
    wrapper.unmount();
    editor.destroy();
  });

  it('does not destroy the injected instance on unmount', () => {
    const editor = createEditor();
    const destroy = vi.spyOn(editor, 'destroy');
    const wrapper = mount(BlockEditor as never, { props: { editor } });

    wrapper.unmount();

    expect(destroy).not.toHaveBeenCalled();

    // A destroyed editor clears its listeners, so still receiving updates is
    // the real proof that the instance survived the unmount.
    const seen: unknown[] = [];
    const unsubscribe = editor.subscribe((update) => seen.push(update));
    editor.setDocument(docWithText('after unmount'));
    expect(seen.length).toBeGreaterThan(0);
    unsubscribe();

    destroy.mockRestore();
    editor.destroy();
  });

  it('still destroys an instance it created itself', () => {
    const wrapper = mount(BlockEditor as never);
    const editor = exposedEditor(wrapper);
    const destroy = vi.spyOn(editor, 'destroy');

    wrapper.unmount();

    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('does NOT emit `change` for an injected instance (host uses editor.onChange)', async () => {
    const editor = createEditor();
    const emitted: DocumentData[] = [];
    const wrapper = mount(BlockEditor as never, {
      props: { editor, onChange: (doc: DocumentData) => emitted.push(doc) },
    });

    editor.setDocument(docWithText('from editor'));
    await nextTick();

    expect(emitted.length).toBe(0);

    wrapper.unmount();
    editor.destroy();
  });

  it('keeps the editable prop in sync with the injected instance', async () => {
    const editor = createEditor({ initialData: docWithText('editable') });
    const wrapper = mount(BlockEditor as never, { props: { editor, editable: true } });
    expect(editor.editable).toBe(true);

    await wrapper.setProps({ editable: false });
    await nextTick();

    expect(editor.editable).toBe(false);
    const editableEl = wrapper.findAll('[contenteditable]')[0];
    expect(editableEl?.attributes('contenteditable')).toBe('false');

    wrapper.unmount();
    editor.destroy();
  });

  it('survives being mounted, unmounted and mounted again', () => {
    const editor = createEditor();

    const first = mount(BlockEditor as never, { props: { editor } });
    first.unmount();

    const second = mount(BlockEditor as never, { props: { editor } });
    // If the component had destroyed the editor, `extensionMethods` would be
    // empty and the image upload entry point would be gone.
    expect(editor.getExtensionMethod(START_IMAGE_UPLOAD_METHOD)).toBeTypeOf('function');
    expect(exposedEditor(second)).toBe(editor);

    second.unmount();
    editor.destroy();
  });

  it('warns in dev when creation-time props are passed alongside :editor', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const editor = createEditor();
    const wrapper = mount(BlockEditor as never, {
      props: { editor, extensions: [ParagraphExtension] },
    });

    const messages = warn.mock.calls.map((call) => String(call[0]));
    expect(messages.some((m) => m.includes('extensions'))).toBe(true);

    wrapper.unmount();
    editor.destroy();
    warn.mockRestore();
  });

  it('warns in dev and ignores a mid-flight :editor swap', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const editor = createEditor();
    const replacement = createEditor();
    const wrapper = mount(BlockEditor as never, { props: { editor } });

    await wrapper.setProps({ editor: replacement });
    await nextTick();

    const messages = warn.mock.calls.map((call) => String(call[0]));
    expect(messages.some((m) => m.includes('editor'))).toBe(true);
    expect(exposedEditor(wrapper)).toBe(editor);

    wrapper.unmount();
    editor.destroy();
    replacement.destroy();
    warn.mockRestore();
  });

  it('uses the raw instance even when the host hands over a reactive proxy', () => {
    // A host that keeps the editor in a `ref()` or `reactive()` object passes
    // a deep reactive proxy down. The component must unwrap it, otherwise
    // Vue warns about rendering reactive components and identity comparisons
    // against the caller's instance break.
    const editor = createEditor();
    const proxied = reactive({ editor }).editor;
    const wrapper = mount(BlockEditor as never, { props: { editor: proxied } });

    expect(exposedEditor(wrapper)).toBe(editor);

    wrapper.unmount();
    editor.destroy();
  });

  it('does not warn when :editor is used on its own', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const editor = createEditor();
    const wrapper = mount(BlockEditor as never, { props: { editor } });

    expect(warn).not.toHaveBeenCalled();

    wrapper.unmount();
    editor.destroy();
    warn.mockRestore();
  });

  it('leaves the default extensions prop untouched for the injected path', () => {
    // Guards the reference check used by the dev warning: `extensions` must
    // keep defaulting to the `BuiltinExtensions` array itself.
    const wrapper = mount(BlockEditor as never);
    const editor = exposedEditor(wrapper);
    expect(editor.registries.schema.has('heading')).toBe(true);
    expect(BuiltinExtensions.length).toBeGreaterThan(1);
    wrapper.unmount();
  });
});

describe('<BlockEditor> internal mode (initialData + change)', () => {
  it('seeds the document from initialData', () => {
    const wrapper = mount(BlockEditor as never, {
      props: { initialData: docWithText('seed') },
    });
    expect(JSON.stringify(exposedEditor(wrapper).toData())).toContain('seed');
    wrapper.unmount();
  });

  it('does NOT reload the document when initialData changes after mount', async () => {
    const wrapper = mount(BlockEditor as never, {
      props: { initialData: docWithText('seed') },
    });
    const editor = exposedEditor(wrapper);

    await wrapper.setProps({ initialData: docWithText('swapped') });
    await nextTick();

    // Two-way binding is gone: the editor keeps its original content.
    expect(JSON.stringify(editor.toData())).toContain('seed');
    expect(JSON.stringify(editor.toData())).not.toContain('swapped');

    wrapper.unmount();
  });

  it('emits `change` with the latest DocumentData on content change', async () => {
    const emitted: DocumentData[] = [];
    const wrapper = mount(BlockEditor as never, {
      props: {
        initialData: docWithText('seed'),
        onChange: (doc: DocumentData) => emitted.push(doc),
      },
    });
    const editor = exposedEditor(wrapper);

    editor.setDocument(docWithText('after edit'));
    await nextTick();

    expect(emitted.length).toBeGreaterThan(0);
    expect(JSON.stringify(emitted[emitted.length - 1])).toContain('after edit');

    wrapper.unmount();
  });

  it('does not emit `change` on selection-only updates', async () => {
    const emitted: DocumentData[] = [];
    const wrapper = mount(BlockEditor as never, {
      props: {
        initialData: docWithText('seed'),
        onChange: (doc: DocumentData) => emitted.push(doc),
      },
    });
    const editor = exposedEditor(wrapper);

    // A pure selection move should not count as a document change.
    editor.commands.setSelection?.({ selection: { kind: 'blocks', blockIds: [] } });
    await nextTick();

    expect(emitted.length).toBe(0);

    wrapper.unmount();
  });

  it('seeds the document from a Markdown string initialData', () => {
    const wrapper = mount(BlockEditor as never, {
      props: { initialData: '# 标题\n\n正文段落' },
    });
    const blocks = exposedEditor(wrapper).toData().blocks;
    expect(blocks[0]?.type).toBe('heading');
    expect(blocks[1]?.type).toBe('paragraph');
    wrapper.unmount();
  });

  it('emits `change-markdown` with Markdown on content change', async () => {
    const emitted: string[] = [];
    const wrapper = mount(BlockEditor as never, {
      props: {
        initialData: docWithText('seed'),
        onChangeMarkdown: (md: string) => emitted.push(md),
      },
    });
    const editor = exposedEditor(wrapper);

    editor.setDocument(docWithText('after edit'));
    await nextTick();

    expect(emitted.length).toBeGreaterThan(0);
    expect(emitted[emitted.length - 1]).toContain('after edit');

    wrapper.unmount();
  });
});
