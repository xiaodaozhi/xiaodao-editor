import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { ref, nextTick } from 'vue';
import { EquationBlock } from '@/extensions/Equation';
import { editorKey, editableKey } from '@/view/context';
import type { Block } from '@/core/types';

function makeBlock(expression: string, indent = 0): Block {
  return {
    id: 'eq1',
    type: 'equation',
    attrs: { expression, indent },
    content: [],
    children: [],
  } as unknown as Block;
}

function mountEquation(expression: string, initialSelection: any = { kind: 'none' }) {
  const calls = {
    convertBlock: vi.fn(),
    setAttrs: vi.fn(),
    removeBlock: vi.fn(),
    setText: vi.fn(),
    selectBlock: vi.fn(),
    subscribe: vi.fn(),
  };
  const block = makeBlock(expression);
  const editor: any = {
    commands: calls,
    getState: () => ({
      doc: { blocks: new Map([[block.id, block]]) },
      selection: initialSelection,
    }),
    subscribe: calls.subscribe,
  };
  const wrapper = mount(EquationBlock, {
    props: { block },
    global: {
      provide: {
        // provide/inject keys are Symbols; index with `as any`
        [editorKey as any]: editor,
        [editableKey as any]: ref(true),
      },
    },
  });
  return { wrapper, calls };
}

describe('EquationBlock component', () => {
  beforeEach(() => vi.clearAllMocks());

  it('opens the editor directly for an empty editable block (no view placeholder)', () => {
    const { wrapper } = mountEquation('');
    // An empty equation has no "view" mode — it opens straight in edit mode.
    expect(wrapper.find('textarea.equation-edit-input').exists()).toBe(true);
    // The view-mode placeholder span must NOT be present for an empty block.
    expect(wrapper.find('.equation-placeholder').exists()).toBe(false);
    // The floating edit button is only for content-bearing blocks.
    expect(wrapper.find('.equation-edit-btn').exists()).toBe(false);
  });

  it('renders the KaTeX output for a valid expression (read mode)', () => {
    const { wrapper } = mountEquation('x^2');
    expect(wrapper.find('.equation-placeholder').exists()).toBe(false);
    expect(wrapper.find('.equation-render').exists()).toBe(true);
    expect(wrapper.html()).toContain('katex');
  });

  it('carries the `.block-focus-root` class so block-level click selection is handled by the shared delegation', () => {
    // Non-text blocks (image / table / divider / …) rely on the generic
    // `onBlockRootClick` delegation in BlockEditor, which only fires for roots
    // tagged `.block-focus-root`. The equation must carry that class in BOTH
    // the view and edit render branches.
    const view = mountEquation('x^2');
    expect(view.wrapper.find('[data-equation-block].block-focus-root').exists()).toBe(true);

    const edit = mountEquation('');
    expect(edit.wrapper.find('[data-equation-block].block-focus-root').exists()).toBe(true);
  });

  it('selects the block (via selectBlock) when the edit button is clicked', async () => {
    // setup mounts with selection.kind === 'none', so the block is NOT selected.
    const { wrapper, calls } = mountEquation('x^2');
    expect(wrapper.find('textarea.equation-edit-input').exists()).toBe(false);
    const btn = wrapper.find('.equation-edit-btn');
    expect(btn.exists()).toBe(true);
    await btn.trigger('click');
    await nextTick();
    // Clicking edit must first make this block the selected block (generic
    // block-focus mechanism) so the editor selection matches what is edited.
    expect(calls.selectBlock).toHaveBeenCalledTimes(1);
    expect(calls.selectBlock.mock.calls[0][0]).toEqual({ id: 'eq1' });
    expect(wrapper.find('textarea.equation-edit-input').exists()).toBe(true);
  });

  it('selects the block before editing even when it was already a block selection', async () => {
    const calls = {
      convertBlock: vi.fn(),
      setAttrs: vi.fn(),
      removeBlock: vi.fn(),
      setText: vi.fn(),
      selectBlock: vi.fn(),
      subscribe: vi.fn(),
    };
    const block = makeBlock('x^2');
    const editor: any = {
      commands: calls,
      getState: () => ({
        doc: { blocks: new Map([['eq1', block]]) },
        // Already selected as a block selection.
        selection: { kind: 'blocks', blockIds: ['eq1'] },
      }),
      subscribe: calls.subscribe,
    };
    const wrapper = mount(EquationBlock, {
      props: { block },
      global: {
        provide: {
          [editorKey as any]: editor,
          [editableKey as any]: ref(true),
        },
      },
    });
    const btn = wrapper.find('.equation-edit-btn');
    expect(btn.exists()).toBe(true);
    await btn.trigger('click');
    await nextTick();
    // `selectBlock` is idempotent, so it is always called to ensure selection.
    expect(calls.selectBlock).toHaveBeenCalledTimes(1);
    expect(wrapper.find('textarea.equation-edit-input').exists()).toBe(true);
  });

  it('submits the LaTeX via setAttrs when Enter is pressed', async () => {
    // An empty block opens directly in edit mode (no button click needed).
    const { wrapper, calls } = mountEquation('');
    const ta = wrapper.find('textarea.equation-edit-input');
    expect(ta.exists()).toBe(true);
    await ta.setValue('E=mc^2');
    await ta.trigger('keydown', { key: 'Enter' });
    await nextTick();
    expect(calls.setAttrs).toHaveBeenCalledTimes(1);
    expect(calls.setAttrs.mock.calls[0][0]).toEqual({
      id: 'eq1',
      attrs: { expression: 'E=mc^2' },
    });
  });

  it('cancels and removes an empty new block when Escape is pressed', async () => {
    // An empty block opens directly in edit mode (no button click needed).
    const { wrapper, calls } = mountEquation('');
    const ta = wrapper.find('textarea.equation-edit-input');
    expect(ta.exists()).toBe(true);
    await ta.setValue('   '); // only whitespace → treated as empty on cancel
    await ta.trigger('keydown', { key: 'Escape' });
    await nextTick();
    expect(calls.removeBlock).toHaveBeenCalledWith({ id: 'eq1' });
    expect(calls.setAttrs).not.toHaveBeenCalled();
  });

  it('does not enter edit mode when read-only', async () => {
    const calls = {
      convertBlock: vi.fn(),
      setAttrs: vi.fn(),
      removeBlock: vi.fn(),
      setText: vi.fn(),
      subscribe: vi.fn(),
    };
    const block = makeBlock('');
    const editor: any = {
      commands: calls,
      getState: () => ({ doc: { blocks: new Map([['eq1', block]]) }, selection: { kind: 'none' } }),
      subscribe: calls.subscribe,
    };
    const wrapper = mount(EquationBlock, {
      props: { block },
      global: {
        provide: {
          [editorKey as any]: editor,
          [editableKey as any]: ref(false), // read-only
        },
      },
    });
    await wrapper.find('[data-equation-block]').trigger('click');
    await nextTick();
    expect(wrapper.find('textarea.equation-edit-input').exists()).toBe(false);
  });

  it('renders the be-indent-N class when the equation is nested as a child block', () => {
    // A formula can be a CHILD block (indented under a nestable sibling). Its
    // `attrs.indent` mirrors the nesting depth, and the renderer must surface it
    // as `be-indent-N` (same as image / table / divider) so the block visually
    // indents. Regression guard for the "formula stays full-width when nested" bug.
    const view = mountEquation('x^2', undefined);
    // default indent = 0 → no be-indent class
    expect(view.wrapper.find('[data-equation-block]').classes()).not.toContain('be-indent-1');

    const nested = mountEquation('x^2');
    nested.wrapper.setProps({ block: makeBlock('x^2', 2) });
    // re-render after the indent change
    return nested.wrapper.vm.$nextTick().then(() => {
      expect(nested.wrapper.find('[data-equation-block]').classes()).toContain('be-indent-2');
    });
  });

  it('renders the be-indent-N class in edit mode too (empty nested equation)', () => {
    const edit = mountEquation('');
    edit.wrapper.setProps({ block: makeBlock('', 3) });
    return edit.wrapper.vm.$nextTick().then(() => {
      expect(edit.wrapper.find('[data-equation-block]').classes()).toContain('be-indent-3');
    });
  });
});
