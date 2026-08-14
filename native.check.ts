import { Editor, defineSchema } from './src/core/index.ts';

const md = `# Hello

This is **bold** and *italic*.

- item
- item2

> quote

\`\`\`ts
const x = 1;
\`\`\`

---

- [x] done
`;

const editor = new Editor({
  extensions: [
    { name: 'paragraph', schema: defineSchema({ type: 'paragraph', content: 'text', nestable: false }) },
    { name: 'heading', schema: defineSchema({ type: 'heading', content: 'text', nestable: false, attrs: { level: { default: 1, validate: (v: unknown) => typeof v === 'number' } } }) },
    { name: 'bulletList', schema: defineSchema({ type: 'bulletList', content: 'text', nestable: false, listLike: true }) },
    { name: 'todoList', schema: defineSchema({ type: 'todoList', content: 'text', nestable: false, listLike: true, attrs: { checked: { default: false, validate: (v: unknown) => typeof v === 'boolean' } } }) },
    { name: 'quote', schema: defineSchema({ type: 'quote', content: 'text', nestable: false }) },
    { name: 'codeBlock', schema: defineSchema({ type: 'codeBlock', content: 'text', nestable: false, isolating: true, attrs: { language: { default: 'plain', validate: (v: unknown) => typeof v === 'string' } } }) },
    { name: 'divider', schema: defineSchema({ type: 'divider', content: 'none', nestable: false }) },
  ],
  defaultBlockType: 'paragraph',
});

// Native import
editor.setDocFromMarkdown(md);
console.log('=== setDocFromMarkdown types ===');
console.log(editor.getState().doc.root.map((id) => editor.getState().doc.blocks.get(id)?.type).join(', '));

// Native export
const out = editor.toMarkdown();
console.log('\n=== toMarkdown ===');
console.log(out);

// Round trip
editor.setDocFromMarkdown(out);
console.log('\nround-trip identical:', editor.toMarkdown() === out);
console.log('HAS setDocFromMarkdown:', typeof (editor as never as Record<string, unknown>).setDocFromMarkdown === 'function');
console.log('HAS toMarkdown:', typeof (editor as never as Record<string, unknown>).toMarkdown === 'function');
console.log('NATIVE METHODS OK');
