<template>
  <div class="playground" :class="`pg-theme-${theme}`">
    <header class="playground-title">
      <span class="pg-title-text">Block Editor Playground</span>
      <div class="pg-toolbar">
        <!-- Language switch -->
        <div class="pg-switch" role="group" aria-label="Language">
          <button
            type="button"
            class="pg-switch-btn"
            :class="{ active: locale === 'zh-CN' }"
            @click="locale = 'zh-CN'"
          >中文</button>
          <button
            type="button"
            class="pg-switch-btn"
            :class="{ active: locale === 'en-US' }"
            @click="locale = 'en-US'"
          >EN</button>
        </div>
        <!-- Theme switch -->
        <div class="pg-switch" role="group" aria-label="Theme">
          <button
            type="button"
            class="pg-switch-btn pg-switch-btn-icon"
            :class="{ active: theme === 'light' }"
            :title="locale === 'zh-CN' ? '浅色模式' : 'Light mode'"
            @click="theme = 'light'"
          >
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <circle cx="8" cy="8" r="3" fill="currentColor"/>
              <g stroke="currentColor" stroke-width="1.2" stroke-linecap="round">
                <line x1="8" y1="1.5" x2="8" y2="3"/>
                <line x1="8" y1="13" x2="8" y2="14.5"/>
                <line x1="1.5" y1="8" x2="3" y2="8"/>
                <line x1="13" y1="8" x2="14.5" y2="8"/>
                <line x1="3.3" y1="3.3" x2="4.4" y2="4.4"/>
                <line x1="11.6" y1="11.6" x2="12.7" y2="12.7"/>
                <line x1="3.3" y1="12.7" x2="4.4" y2="11.6"/>
                <line x1="11.6" y1="4.4" x2="12.7" y2="3.3"/>
              </g>
            </svg>
          </button>
          <button
            type="button"
            class="pg-switch-btn pg-switch-btn-icon"
            :class="{ active: theme === 'dark' }"
            :title="locale === 'zh-CN' ? '深色模式' : 'Dark mode'"
            @click="theme = 'dark'"
          >
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <path d="M13.5 9.2A5.6 5.6 0 0 1 6.8 2.5a.6.6 0 0 0-.85-.74A6.5 6.5 0 1 0 14.24 9.95a.6.6 0 0 0-.74-.75z" fill="currentColor"/>
            </svg>
          </button>
        </div>
      </div>
    </header>
    <BlockEditor
      v-model="doc"
      :locale="locale"
      :theme="theme"
      :extensions="extensions"
      :placeholder="locale === 'zh-CN' ? placeholderZh : placeholderEn"
    />
    <details class="playground-debug">
      <summary>Document JSON</summary>
      <pre>{{ JSON.stringify(doc, null, 2) }}</pre>
    </details>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { BlockEditor, BuiltinExtensions } from '../src'
import type { DocumentData, Locale, Theme } from '../src'

const extensions = BuiltinExtensions

const locale = ref<Locale>('zh-CN')
const theme = ref<Theme>('light')

const placeholderZh = "输入文字，或按 '/' 获取命令…"
const placeholderEn = "Type '/' for commands…"

const doc = ref<DocumentData>({
  blocks: [
    // --- Headings 1-6 ---------------------------------------------------
    {
      type: 'heading',
      attrs: { level: 1 },
      content: [{ type: 'text', text: '块编辑器 playground' }],
    },
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: '二级标题' }],
    },
    {
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: '三级标题' }],
    },
    {
      type: 'heading',
      attrs: { level: 4 },
      content: [{ type: 'text', text: '四级标题' }],
    },
    {
      type: 'heading',
      attrs: { level: 5 },
      content: [{ type: 'text', text: '五级标题' }],
    },
    {
      type: 'heading',
      attrs: { level: 6 },
      content: [{ type: 'text', text: '六级标题' }],
    },

    // --- Paragraph + inline marks ---------------------------------------
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: '内联标记' }],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: '普通文本、' },
        { type: 'text', text: '加粗', marks: [{ type: 'bold' }] },
        { type: 'text', text: '、' },
        { type: 'text', text: '斜体', marks: [{ type: 'italic' }] },
        { type: 'text', text: '、' },
        { type: 'text', text: '下划线', marks: [{ type: 'underline' }] },
        { type: 'text', text: '、' },
        { type: 'text', text: '删除线', marks: [{ type: 'strikethrough' }] },
        { type: 'text', text: '、' },
        { type: 'text', text: '行内代码', marks: [{ type: 'code' }] },
        { type: 'text', text: ' 可以混排在一个段落里。' },
      ],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: '嵌套标记：', marks: [{ type: 'bold' }] },
        { type: 'text', text: '加粗+斜体', marks: [{ type: 'bold' }, { type: 'italic' }] },
        { type: 'text', text: '、' },
        { type: 'text', text: '加粗+代码', marks: [{ type: 'bold' }, { type: 'code' }] },
        { type: 'text', text: '、' },
        { type: 'text', text: '斜体+下划线+删除线', marks: [{ type: 'italic' }, { type: 'underline' }, { type: 'strikethrough' }] },
        { type: 'text', text: '。' },
      ],
    },

    // --- Block-level attrs (align / color / bgColor) --------------------
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: '块级属性' }],
    },
    {
      type: 'paragraph',
      attrs: { align: 'center' },
      content: [{ type: 'text', text: '这段文字居中对齐。' }],
    },
    {
      type: 'paragraph',
      attrs: { align: 'right' },
      content: [{ type: 'text', text: '这段文字右对齐。' }],
    },
    {
      type: 'paragraph',
      attrs: { align: 'justify' },
      content: [{ type: 'text', text: '这段文字两端对齐：The quick brown fox jumps over the lazy dog. 望长城内外，惟余莽莽；大河上下，顿失滔滔。' }],
    },
    {
      type: 'paragraph',
      attrs: { color: 'red' },
      content: [{ type: 'text', text: '红色文字。' }],
    },
    {
      type: 'paragraph',
      attrs: { color: 'blue' },
      content: [{ type: 'text', text: '蓝色文字。' }],
    },
    {
      type: 'paragraph',
      attrs: { bgColor: 'yellow' },
      content: [{ type: 'text', text: '黄色背景。' }],
    },
    {
      type: 'paragraph',
      attrs: { bgColor: 'green' },
      content: [{ type: 'text', text: '绿色背景。' }],
    },
    {
      type: 'paragraph',
      attrs: { color: 'purple', bgColor: 'pink' },
      content: [{ type: 'text', text: '紫色文字 + 粉色背景。' }],
    },
    {
      type: 'paragraph',
      attrs: { align: 'center', color: 'orange', bgColor: 'gray' },
      content: [{ type: 'text', text: '居中 + 橙色文字 + 灰色背景组合。' }],
    },

    // --- Lists ----------------------------------------------------------
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: '列表' }],
    },
    {
      type: 'bulletList',
      content: [{ type: 'text', text: '无序列表第一项' }],
    },
    {
      type: 'bulletList',
      content: [{ type: 'text', text: '无序列表第二项' }],
    },
    {
      type: 'bulletList',
      content: [
        { type: 'text', text: '带' },
        { type: 'text', text: '加粗', marks: [{ type: 'bold' }] },
        { type: 'text', text: '的列表项' },
      ],
    },
    {
      type: 'orderedList',
      content: [{ type: 'text', text: '有序列表第一项' }],
    },
    {
      type: 'orderedList',
      content: [{ type: 'text', text: '有序列表第二项' }],
    },
    {
      type: 'orderedList',
      content: [{ type: 'text', text: '有序列表第三项' }],
    },
    {
      type: 'todoList',
      attrs: { checked: false },
      content: [{ type: 'text', text: '未完成的待办' }],
    },
    {
      type: 'todoList',
      attrs: { checked: true },
      content: [{ type: 'text', text: '已完成的待办' }],
    },
    {
      type: 'todoList',
      attrs: { checked: false },
      content: [
        { type: 'text', text: '含' },
        { type: 'text', text: '行内代码', marks: [{ type: 'code' }] },
        { type: 'text', text: '的待办' },
      ],
    },

    // --- Quote ----------------------------------------------------------
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: '引用' }],
    },
    {
      type: 'quote',
      content: [
        { type: 'text', text: '引用可以包含' },
        { type: 'text', text: '加粗', marks: [{ type: 'bold' }] },
        { type: 'text', text: '与' },
        { type: 'text', text: '斜体', marks: [{ type: 'italic' }] },
        { type: 'text', text: '。' },
      ],
    },
    {
      type: 'quote',
      attrs: { color: 'brown', bgColor: 'orange' },
      content: [{ type: 'text', text: '带颜色与背景的引用。' }],
    },

    // --- Code block -----------------------------------------------------
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: '代码块' }],
    },
    {
      type: 'codeBlock',
      attrs: { language: 'typescript' },
      content: [{ type: 'text', text: 'function fibonacci(n: number): number {\n  return n <= 1 ? n : fibonacci(n - 1) + fibonacci(n - 2)\n}' }],
    },
    {
      type: 'codeBlock',
      attrs: { language: 'plain' },
      content: [{ type: 'text', text: '纯文本代码块：行1\n行2\n行3' }],
    },

    // --- Empty block (placeholder demo) ---------------------------------
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: '空块' }],
    },
    {
      type: 'paragraph',
      content: [],
    },
  ],
})

watch(() => doc, (newDoc) => {
  console.log(newDoc)
})
</script>
