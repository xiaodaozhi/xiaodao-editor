/**
 * TodoList / To-do / Checkbox item block extension.
 *
 * Attr `checked: boolean` controls the checkbox state. The renderer wraps
 * BlockContent with an <input type="checkbox"> prepended. Clicking the
 * checkbox dispatches `setAttrs` to flip the `checked` flag.
 */

import { defineComponent, h, type PropType } from 'vue';
import type { Extension } from '../core/extension/Extension';
import type { Block } from '../core/types';
import BlockContent from '../view/BlockContent.vue';
import { useEditor } from '../view/context';
import { ICON_TODO } from '../view/ui/icons';
import { classesFromAttrs, COMMON_ATTRS } from './_commonAttrs';

const TodoListBlock = defineComponent({
  name: 'TodoListBlock',
  props: {
    block: { type: Object as PropType<Block>, required: true },
    placeholder: { type: String, default: undefined },
  },
  setup(props) {
    const editor = useEditor();

    function onCheckboxChange(e: Event): void {
      const el = e.target as HTMLInputElement;
      editor.commands.setAttrs?.({
        id: props.block.id,
        attrs: { ...props.block.attrs, checked: el.checked },
      });
    }

    return () => {
      const checked = Boolean(props.block.attrs.checked);
      const allClasses = classesFromAttrs(props.block.attrs);
      const indentClasses = allClasses.filter((c) => c.startsWith('be-indent-'));
      const nonIndentClasses = allClasses.filter((c) => !c.startsWith('be-indent-'));
      const classes = [
        'block-todo-list',
        checked ? 'todo-checked' : 'todo-unchecked',
        ...nonIndentClasses,
      ];
      return h('div', { class: ['block-todo-wrapper', ...indentClasses] }, [
        h('input', {
          type: 'checkbox',
          class: 'block-todo-checkbox',
          checked,
          onchange: onCheckboxChange,
        }),
        h(BlockContent, {
          block: props.block,
          placeholder: props.placeholder,
          class: classes,
        }),
      ]);
    };
  },
});

export const TodoListExtension: Extension = {
  name: 'todoList',
  schema: {
    type: 'todoList',
    content: 'text',
    nestable: false,
    listLike: true,
    attrs: {
      ...COMMON_ATTRS,
      checked: {
        default: false,
        validate: (v: unknown): boolean => typeof v === 'boolean',
      },
    },
  },
  renderer: { component: TodoListBlock },
  slashCommands: [
    {
      id: 'todo-list',
      title: '待办列表',
      keywords: ['todo', 'task', 'checkbox', '待办', '任务', '复选框', '[]', '[ ]'],
      description: '用复选框追踪待办任务。',
      icon: ICON_TODO,
      command: 'convertBlock',
      category: 'list',
      args: (): unknown => ({ id: '__currentBlock__', type: 'todoList', attrs: { checked: false } }),
    },
  ],
  inputRules: [
    {
      name: 'todo-empty',
      pattern: /^\[\] $/,
      command: 'convertBlock',
      args: (): unknown => ({ id: '__currentBlock__', type: 'todoList', attrs: { checked: false }, __stripPrefix: 3 }),
    },
    {
      name: 'todo-space-bracket',
      pattern: /^\[ \] $/,
      command: 'convertBlock',
      args: (): unknown => ({ id: '__currentBlock__', type: 'todoList', attrs: { checked: false }, __stripPrefix: 4 }),
    },
  ],
};
