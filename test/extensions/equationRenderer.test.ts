import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { ref } from 'vue';
import { Editor } from '@/core/Editor';
import BlockEditor from '@/view/BlockEditor.vue';
import { BuiltinExtensions } from '@/extensions/builtin';
import {
  builtinEquationRenderer,
  createEquationBlock,
  createEquationExtension,
  EquationExtension,
  type EquationRenderer,
} from '@/extensions/Equation';
import { editorKey, editableKey } from '@/view/context';
import type { Block } from '@/core/types';

/**
 * A stand-in for a third-party engine (KaTeX / MathJax). It only produces an
 * HTML string, exactly like a real KaTeX adapter would.
 */
function fakeRenderer(marker: string): EquationRenderer {
  return {
    render(expression) {
      return {
        html: `<span class="fake-eq">${marker}:${expression}</span>`,
        vnode: null,
        error: false,
        diagnostics: [],
      };
    },
  };
}

function makeBlock(expression: string): Block {
  return {
    id: 'eq1',
    type: 'equation',
    attrs: { expression },
    content: [],
    children: [],
  } as unknown as Block;
}

function mountWith(block: Block, renderer: EquationRenderer) {
  const calls = {
    setAttrs: vi.fn(),
    removeBlock: vi.fn(),
    selectBlock: vi.fn(),
    subscribe: vi.fn(),
  };
  const editor: any = {
    commands: calls,
    getState: () => ({ doc: { blocks: new Map([['eq1', block]]) } }),
    subscribe: calls.subscribe,
  };
  const wrapper = mount(createEquationBlock(renderer), {
    props: { block },
    global: {
      provide: {
        [editorKey as any]: editor,
        [editableKey as any]: ref(true),
      },
    },
  });
  return { wrapper, calls };
}

describe('equation renderer injection', () => {
  it('defaults to the built-in (zero-dependency) renderer', () => {
    const html = EquationExtension.serialize!.toHTML!(makeBlock('x^2'));
    expect(html).toContain('math-equation');
    expect(html).not.toContain('fake-eq');
  });

  it('uses the injected renderer for serialize.toHTML', () => {
    const ext = createEquationExtension({ renderer: fakeRenderer('X') });
    const html = ext.serialize!.toHTML!(makeBlock('x^2'));
    expect(html).toContain('X:x^2');
    expect(html).not.toContain('math-equation');
  });

  it('uses the injected renderer inside the block component', () => {
    const { wrapper } = mountWith(makeBlock('x^2'), fakeRenderer('FAKE'));
    expect(wrapper.html()).toContain('FAKE:x^2');
    expect(wrapper.html()).not.toContain('math-equation');
  });

  it('keeps the built-in renderer when none is injected', () => {
    const { wrapper } = mountWith(makeBlock('x^2'), builtinEquationRenderer);
    expect(wrapper.html()).toContain('math-equation');
    expect(wrapper.html()).not.toContain('fake-eq');
  });

  it('survives a renderer that throws (no editor crash, error state instead)', () => {
    const boom: EquationRenderer = {
      render() {
        throw new Error('renderer exploded');
      },
    };
    const { wrapper } = mountWith(makeBlock('x^2'), boom);
    expect(wrapper.html()).toContain('equation-error-inline');
  });

  it('survives a renderer that returns garbage', () => {
    const garbage: EquationRenderer = { render: (() => null) as any };
    const { wrapper } = mountWith(makeBlock('x^2'), garbage);
    // No crash: the block still renders (empty output, no error state).
    expect(wrapper.find('.equation-block').exists()).toBe(true);
  });
});

describe('extension override mechanism (what <BlockEditor :equation-renderer> relies on)', () => {
  it('built-in extensions register the default equation component', () => {
    const editor = new Editor({ extensions: BuiltinExtensions });
    const spec = editor.registries.renderers.get('equation');
    expect(spec?.component).toBe(EquationExtension.renderer!.component);
  });

  it('a later `equation` extension wins (name-based de-duplication)', () => {
    const editor = new Editor({
      extensions: [...BuiltinExtensions, createEquationExtension({ renderer: fakeRenderer('Y') })],
    });
    const spec = editor.registries.renderers.get('equation');
    expect(spec?.component).not.toBe(EquationExtension.renderer!.component);
    // and it really is the injected one
    const html = createEquationExtension({ renderer: fakeRenderer('Y') }).serialize!.toHTML!(
      makeBlock('q'),
    );
    expect(html).toContain('Y:q');
  });
});

describe('<BlockEditor :equation-renderer>', () => {
  it('renders formulas through the injected renderer', () => {
    const wrapper = mount(BlockEditor as any, {
      props: {
        modelValue: {
          blocks: [
            { id: 'b1', type: 'equation', attrs: { expression: 'x^2' }, content: [], children: [] },
          ],
        },
        equationRenderer: fakeRenderer('ZZ'),
      },
    });
    const html = wrapper.html();
    expect(html).toContain('ZZ:x^2');
    expect(html).not.toContain('math-equation');
  });

  it('renders formulas through the built-in renderer when no prop is given', () => {
    const wrapper = mount(BlockEditor as any, {
      props: {
        modelValue: {
          blocks: [
            { id: 'b1', type: 'equation', attrs: { expression: 'x^2' }, content: [], children: [] },
          ],
        },
      },
    });
    expect(wrapper.html()).toContain('math-equation');
  });
});
