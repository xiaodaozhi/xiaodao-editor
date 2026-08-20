<template>
  <div class="playground" :class="`pg-theme-${theme}`">
    <header class="playground-title">
      <span class="pg-title-text">{{ locale === 'zh-CN' ? '小刀编辑器' : 'Xiaodao Editor' }}</span>
      <div class="pg-toolbar">
        <!-- Language switch -->
        <div class="pg-switch" role="group" aria-label="Language">
          <button
            type="button"
            class="pg-switch-btn pg-switch-btn-icon"
            :class="{ active: locale === 'zh-CN' }"
            :title="locale === 'zh-CN' ? '中文' : 'Chinese'"
            @click="locale = 'zh-CN'"
          >
            <!-- Chinese character '中' icon -->
            <svg viewBox="0 0 1024 1024" width="16" height="16" aria-hidden="true" fill="currentColor">
              <path d="M555.231787 330.203429v-107.997284h-68.202727v108.038827H263.433935v273.457531H487.02906v210.976899h68.202727V603.70431h224.21827V330.203429H555.231787z m-68.202727 209.074952h-157.337694v-144.605675h157.335888v144.605675z m226.131053 0H555.195662v-144.605675h157.962645v144.605675z" />
            </svg>
          </button>
          <button
            type="button"
            class="pg-switch-btn pg-switch-btn-icon"
            :class="{ active: locale === 'en-US' }"
            :title="locale === 'zh-CN' ? '英文' : 'English'"
            @click="locale = 'en-US'"
          >
            <!-- Latin letter A icon -->
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 13L8 3l5 10" />
              <path d="M5 9h6" />
            </svg>
          </button>
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
        <!-- Editable switch -->
        <div class="pg-switch" role="group" aria-label="Editable">
          <button
            type="button"
            class="pg-switch-btn pg-switch-btn-icon"
            :class="{ active: !editable }"
            :title="locale === 'zh-CN' ? '只读模式' : 'Read-only mode'"
            @click="editable = false"
          >
            <!-- Open book icon (read-only) -->
            <svg viewBox="0 0 1024 1024" width="16" height="16" aria-hidden="true" fill="currentColor">
              <path d="M192 768h640V192h-160a128 128 0 0 0-128 128h-64a128 128 0 0 0-128-128H192v576z m426.666667 64a106.773333 106.773333 0 0 0-92.309334 53.333333v0.042667a16.426667 16.426667 0 0 1-28.458666-0.042667A106.389333 106.389333 0 0 0 405.333333 832H170.666667a42.666667 42.666667 0 0 1-42.666667-42.666667V170.666667a42.666667 42.666667 0 0 1 42.666667-42.666667h181.333333a191.829333 191.829333 0 0 1 160 85.824A191.829333 191.829333 0 0 1 672 128H853.333333a42.666667 42.666667 0 0 1 42.666667 42.666667v618.666666a42.666667 42.666667 0 0 1-42.666667 42.666667H618.666667z m-170.666667-64c23.765333 0 44.501333 12.778667 55.530667 32a9.856 9.856 0 0 0 17.066666 0.021333l0.021334-0.021333A64.064 64.064 0 0 1 576 768h-128z m32-448h64v352a32 32 0 0 1-64 0V320z" />
            </svg>
          </button>
          <button
            type="button"
            class="pg-switch-btn pg-switch-btn-icon"
            :class="{ active: editable }"
            :title="locale === 'zh-CN' ? '编辑模式' : 'Edit mode'"
            @click="editable = true"
          >
            <!-- Pencil edit icon -->
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M11.5 2.5l2 2-8 8.5-3.5 1 1-3.5z" />
              <path d="M10 4l2 2" />
            </svg>
          </button>
        </div>
      </div>
    </header>
    <div class="playground-body">
      <BlockEditor
        v-model="doc"
        :locale="locale"
        :theme="theme"
        :extensions="extensions"
        :editable="editable"
        :placeholder="locale === 'zh-CN' ? placeholderZh : placeholderEn"
      />
    </div>
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
const editable = ref(true)

const placeholderZh = "输入文字，或按 '/' 获取命令…"
const placeholderEn = "Type '/' for commands…"

const doc = ref<DocumentData>({
  blocks: [
    // =====================================================================
    // 标题层级测试
    // =====================================================================
    {
      type: 'heading',
      attrs: { level: 1 },
      content: [{ type: 'text', text: '块编辑器技术文档' }],
    },
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: '1. 概述' }],
    },
    {
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: '1.1 背景' }],
    },
    {
      type: 'heading',
      attrs: { level: 4 },
      content: [{ type: 'text', text: '1.1.1 设计目标' }],
    },
    {
      type: 'heading',
      attrs: { level: 5 },
      content: [{ type: 'text', text: '1.1.1.1 核心原则' }],
    },
    {
      type: 'heading',
      attrs: { level: 6 },
      content: [{ type: 'text', text: '1.1.1.1.1 实现约束' }],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: '本文档是块编辑器（Block Editor）的技术规格说明，涵盖' },
        { type: 'text', text: '数据模型', marks: [{ type: 'bold' }] },
        { type: 'text', text: '、' },
        { type: 'text', text: '渲染机制', marks: [{ type: 'bold' }] },
        { type: 'text', text: '、' },
        { type: 'text', text: '命令系统', marks: [{ type: 'bold' }] },
        { type: 'text', text: '与' },
        { type: 'text', text: '扩展架构', marks: [{ type: 'bold' }] },
        { type: 'text', text: '四个核心模块。编辑器采用 ' },
        { type: 'text', text: 'Vue 3', marks: [{ type: 'code' }] },
        { type: 'text', text: ' 渲染层与 ' },
        { type: 'text', text: 'TypeScript', marks: [{ type: 'code' }] },
        { type: 'text', text: ' 类型系统，不依赖 ProseMirror / TipTap，完全自研。源码仓库：' },
        { type: 'text', text: 'https://github.com/xiaodaozhi/xiaodao-editor', marks: [{ type: 'link', attrs: { href: 'https://github.com/xiaodaozhi/xiaodao-editor' } }] },
        { type: 'text', text: '。' },
      ],
    },

    // =====================================================================
    // 内联标记
    // =====================================================================
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: '2. 内联标记系统' }],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: '编辑器支持以下内联标记：' },
        { type: 'text', text: '加粗', marks: [{ type: 'bold' }] },
        { type: 'text', text: '（bold）、' },
        { type: 'text', text: '斜体', marks: [{ type: 'italic' }] },
        { type: 'text', text: '（italic）、' },
        { type: 'text', text: '下划线', marks: [{ type: 'underline' }] },
        { type: 'text', text: '（underline）、' },
        { type: 'text', text: '删除线', marks: [{ type: 'strikethrough' }] },
        { type: 'text', text: '（strikethrough）、' },
        { type: 'text', text: '行内代码', marks: [{ type: 'code' }] },
        { type: 'text', text: '（code）和' },
        { type: 'text', text: '超链接', marks: [{ type: 'link', attrs: { href: 'https://vuejs.org' } }] },
        { type: 'text', text: '（link）。' },
      ],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: '标记可嵌套组合，例如' },
        { type: 'text', text: '加粗+斜体', marks: [{ type: 'bold' }, { type: 'italic' }] },
        { type: 'text', text: '、' },
        { type: 'text', text: '加粗+下划线', marks: [{ type: 'bold' }, { type: 'underline' }] },
        { type: 'text', text: '、' },
        { type: 'text', text: '斜体+删除线', marks: [{ type: 'italic' }, { type: 'strikethrough' }] },
        { type: 'text', text: '、' },
        { type: 'text', text: '加粗+斜体+下划线+删除线', marks: [{ type: 'bold' }, { type: 'italic' }, { type: 'underline' }, { type: 'strikethrough' }] },
        { type: 'text', text: '。注意：行内代码与加粗/斜体/下划线/删除线/颜色/链接互斥——添加 code 标记时会自动剥离其他标记。' },
      ],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: '内联文本颜色与背景色：' },
        { type: 'text', text: '红色文字', marks: [{ type: 'color', attrs: { color: 'red' } }] },
        { type: 'text', text: '、' },
        { type: 'text', text: '蓝色文字', marks: [{ type: 'color', attrs: { color: 'blue' } }] },
        { type: 'text', text: '、' },
        { type: 'text', text: '绿色背景', marks: [{ type: 'bgColor', attrs: { bgColor: 'green' } }] },
        { type: 'text', text: '、' },
        { type: 'text', text: '橙色背景', marks: [{ type: 'bgColor', attrs: { bgColor: 'orange' } }] },
        { type: 'text', text: '、' },
        { type: 'text', text: '紫色文字+粉色背景', marks: [{ type: 'color', attrs: { color: 'purple' } }, { type: 'bgColor', attrs: { bgColor: 'pink' } }] },
        { type: 'text', text: '。内联颜色优先级高于块级颜色。' },
      ],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: '链接与文本混排示例：参见' },
        { type: 'text', text: 'Vue 3 官方文档', marks: [{ type: 'link', attrs: { href: 'https://vuejs.org' } }] },
        { type: 'text', text: '和' },
        { type: 'text', text: 'TypeScript 手册', marks: [{ type: 'link', attrs: { href: 'https://www.typescriptlang.org/docs' } }] },
        { type: 'text', text: '。点击链接可弹出查看浮动栏，支持编辑、复制、打开和删除。' },
      ],
    },

    // =====================================================================
    // 块级属性
    // =====================================================================
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: '3. 块级属性' }],
    },
    {
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: '3.1 对齐方式' }],
    },
    {
      type: 'paragraph',
      attrs: { align: 'left' },
      content: [{ type: 'text', text: '左对齐（默认）。' }],
    },
    {
      type: 'paragraph',
      attrs: { align: 'center' },
      content: [{ type: 'text', text: '居中对齐。' }],
    },
    {
      type: 'paragraph',
      attrs: { align: 'right' },
      content: [{ type: 'text', text: '右对齐。' }],
    },
    {
      type: 'paragraph',
      attrs: { align: 'justify' },
      content: [{ type: 'text', text: '两端对齐：The quick brown fox jumps over the lazy dog. 编辑器支持四种对齐方式，代码块和图片仅支持左对齐、居中和右对齐，不支持两端对齐。' }],
    },
    {
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: '3.2 块级颜色与背景' }],
    },
    {
      type: 'paragraph',
      attrs: { color: 'gray' },
      content: [{ type: 'text', text: '灰色文字。' }],
    },
    {
      type: 'paragraph',
      attrs: { color: 'brown' },
      content: [{ type: 'text', text: '棕色文字。' }],
    },
    {
      type: 'paragraph',
      attrs: { color: 'orange' },
      content: [{ type: 'text', text: '橙色文字。' }],
    },
    {
      type: 'paragraph',
      attrs: { color: 'yellow' },
      content: [{ type: 'text', text: '黄色文字。' }],
    },
    {
      type: 'paragraph',
      attrs: { color: 'green' },
      content: [{ type: 'text', text: '绿色文字。' }],
    },
    {
      type: 'paragraph',
      attrs: { color: 'blue' },
      content: [{ type: 'text', text: '蓝色文字。' }],
    },
    {
      type: 'paragraph',
      attrs: { color: 'purple' },
      content: [{ type: 'text', text: '紫色文字。' }],
    },
    {
      type: 'paragraph',
      attrs: { color: 'pink' },
      content: [{ type: 'text', text: '粉色文字。' }],
    },
    {
      type: 'paragraph',
      attrs: { color: 'red' },
      content: [{ type: 'text', text: '红色文字。' }],
    },
    {
      type: 'paragraph',
      attrs: { bgColor: 'gray' },
      content: [{ type: 'text', text: '灰色背景。' }],
    },
    {
      type: 'paragraph',
      attrs: { bgColor: 'brown' },
      content: [{ type: 'text', text: '棕色背景。' }],
    },
    {
      type: 'paragraph',
      attrs: { bgColor: 'orange' },
      content: [{ type: 'text', text: '橙色背景。' }],
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
      attrs: { bgColor: 'blue' },
      content: [{ type: 'text', text: '蓝色背景。' }],
    },
    {
      type: 'paragraph',
      attrs: { bgColor: 'purple' },
      content: [{ type: 'text', text: '紫色背景。' }],
    },
    {
      type: 'paragraph',
      attrs: { bgColor: 'pink' },
      content: [{ type: 'text', text: '粉色背景。' }],
    },
    {
      type: 'paragraph',
      attrs: { bgColor: 'red' },
      content: [{ type: 'text', text: '红色背景。' }],
    },
    {
      type: 'paragraph',
      attrs: { align: 'center', color: 'blue', bgColor: 'yellow' },
      content: [
        { type: 'text', text: '组合：居中 + ' },
        { type: 'text', text: '蓝色', marks: [{ type: 'bold' }] },
        { type: 'text', text: '文字 + 黄色背景。' },
      ],
    },

    // =====================================================================
    // 缩进
    // =====================================================================
    {
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: '3.3 缩进' }],
    },
    {
      type: 'paragraph',
      content: [{ type: 'text', text: '缩进级别 0（默认）。' }],
    },
    {
      type: 'paragraph',
      attrs: { indent: 1 },
      content: [{ type: 'text', text: '缩进级别 1。' }],
    },
    {
      type: 'paragraph',
      attrs: { indent: 2 },
      content: [{ type: 'text', text: '缩进级别 2。' }],
    },
    {
      type: 'paragraph',
      attrs: { indent: 3 },
      content: [{ type: 'text', text: '缩进级别 3。' }],
    },
    {
      type: 'paragraph',
      attrs: { indent: 4 },
      content: [{ type: 'text', text: '缩进级别 4（最大 10）。引用、代码块、图片、表格、分隔线不支持缩进。' }],
    },

    // =====================================================================
    // 列表
    // =====================================================================
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: '4. 列表' }],
    },
    {
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: '4.1 无序列表' }],
    },
    {
      type: 'bulletList',
      content: [{ type: 'text', text: '数据模型层（Data Model）' }],
    },
    {
      type: 'bulletList',
      attrs: { indent: 1 },
      content: [{ type: 'text', text: 'Block / InlineNode / Mark 类型定义' }],
    },
    {
      type: 'bulletList',
      attrs: { indent: 1 },
      content: [{ type: 'text', text: 'SchemaRegistry 块类型注册' }],
    },
    {
      type: 'bulletList',
      content: [{ type: 'text', text: '状态管理层（State）' }],
    },
    {
      type: 'bulletList',
      attrs: { indent: 1 },
      content: [
        { type: 'text', text: 'EditorState 存储 ' },
        { type: 'text', text: 'doc', marks: [{ type: 'code' }] },
        { type: 'text', text: ' 与 ' },
        { type: 'text', text: 'selection', marks: [{ type: 'code' }] },
      ],
    },
    {
      type: 'bulletList',
      attrs: { indent: 1 },
      content: [{ type: 'text', text: 'Transaction 事务分发与 Step 应用' }],
    },
    {
      type: 'bulletList',
      attrs: { indent: 2 },
      content: [{ type: 'text', text: 'replaceTextStep / setAttrsStep / replaceStep' }],
    },
    {
      type: 'bulletList',
      content: [{ type: 'text', text: '渲染层（View）' }],
    },
    {
      type: 'bulletList',
      content: [
        { type: 'text', text: 'Vue 组件：' },
        { type: 'text', text: 'BlockEditor', marks: [{ type: 'code' }] },
        { type: 'text', text: ' → ' },
        { type: 'text', text: 'BlockList', marks: [{ type: 'code' }] },
        { type: 'text', text: ' → ' },
        { type: 'text', text: 'BlockHost', marks: [{ type: 'code' }] },
        { type: 'text', text: ' → ' },
        { type: 'text', text: 'BlockContent', marks: [{ type: 'code' }] },
      ],
    },
    {
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: '4.2 有序列表' }],
    },
    {
      type: 'orderedList',
      content: [{ type: 'text', text: '初始化 Editor 实例，注册扩展。' }],
    },
    {
      type: 'orderedList',
      content: [{ type: 'text', text: '挂载 BlockEditor 组件，传入 v-model 绑定 DocumentData。' }],
    },
    {
      type: 'orderedList',
      content: [{ type: 'text', text: '用户输入触发 DOM 事件 → dispatch Transaction → 应用 Step → 更新 doc。' }],
    },
    {
      type: 'orderedList',
      content: [{ type: 'text', text: 'Vue 响应式重新渲染受影响的 Block。' }],
    },
    {
      type: 'paragraph',
      content: [{ type: 'text', text: '有序列表支持 startNumber 显式设定起始序号：' }],
    },
    {
      type: 'orderedList',
      attrs: { startNumber: 10 },
      content: [{ type: 'text', text: '从 10 开始计数。' }],
    },
    {
      type: 'orderedList',
      attrs: { startNumber: 10 },
      content: [{ type: 'text', text: '第二项。' }],
    },
    {
      type: 'orderedList',
      attrs: { startNumber: 10 },
      content: [{ type: 'text', text: '第三项。' }],
    },
    {
      type: 'paragraph',
      content: [{ type: 'text', text: '未设置 startNumber 时自动从上一有序列表续号：' }],
    },
    {
      type: 'orderedList',
      content: [{ type: 'text', text: '自动续号第一项。' }],
    },
    {
      type: 'orderedList',
      content: [{ type: 'text', text: '自动续号第二项。' }],
    },
    {
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: '4.3 待办列表' }],
    },
    {
      type: 'todoList',
      attrs: { checked: false },
      content: [{ type: 'text', text: '实现拖拽排序功能' }],
    },
    {
      type: 'todoList',
      attrs: { checked: false },
      content: [{ type: 'text', text: '添加协同编辑支持' }],
    },
    {
      type: 'todoList',
      attrs: { checked: true },
      content: [{ type: 'text', text: '完成基础块类型（段落、标题、列表）' }],
    },
    {
      type: 'todoList',
      attrs: { checked: true },
      content: [
        { type: 'text', text: '完成 ' },
        { type: 'text', text: 'HoverToolbar', marks: [{ type: 'code' }] },
        { type: 'text', text: ' 浮动工具栏' },
      ],
    },
    {
      type: 'todoList',
      attrs: { checked: false },
      content: [
        { type: 'text', text: '参考 ' },
        { type: 'text', text: '飞书云文档', marks: [{ type: 'link', attrs: { href: 'https://www.feishu.cn' } }] },
        { type: 'text', text: ' 的表格交互设计' },
      ],
    },

    // =====================================================================
    // 引用
    // =====================================================================
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: '5. 引用块' }],
    },
    {
      type: 'quote',
      content: [
        { type: 'text', text: '好的代码是其自己最好的文档。当你需要添加注释时，你应该重新思考你的命名。' },
        { type: 'text', text: '—— Steve McConnell' },
      ],
    },
    {
      type: 'quote',
      attrs: { color: 'brown', bgColor: 'orange' },
      content: [
        { type: 'text', text: '引用块支持' },
        { type: 'text', text: '加粗', marks: [{ type: 'bold' }] },
        { type: 'text', text: '、' },
        { type: 'text', text: '下划线', marks: [{ type: 'underline' }] },
        { type: 'text', text: '、' },
        { type: 'text', text: '删除线', marks: [{ type: 'strikethrough' }] },
        { type: 'text', text: '和' },
        { type: 'text', text: '行内代码', marks: [{ type: 'code' }] },
        { type: 'text', text: '，但不支持斜体。引用可设置块级颜色和背景色。' },
      ],
    },
    {
      type: 'quote',
      attrs: { align: 'center', color: 'blue' },
      content: [{ type: 'text', text: '简洁是可靠的前提。' }],
    },

    // =====================================================================
    // 代码块
    // =====================================================================
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: '6. 代码块' }],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: '代码块使用 ' },
        { type: 'text', text: 'content: "none"', marks: [{ type: 'code' }] },
        { type: 'text', text: ' 模式，文本存储在 attrs 中。代码块不支持对齐、颜色、背景色和缩进属性。点击语言标签可切换语言。' },
      ],
    },
    {
      type: 'codeBlock',
      attrs: { language: 'typescript' },
      content: [{ type: 'text', text: '/**\n * Editor 核心类：管理文档状态、选区和命令分发。\n */\nexport class Editor {\n  private state: EditorState;\n  readonly commands: CommandProxy;\n  readonly schema: SchemaRegistry;\n\n  constructor(extensions: readonly Extension[]) {\n    const registries = compileExtensions(extensions);\n    this.schema = registries.schema;\n    this.state = EditorState.create(registries);\n    this.commands = new CommandProxy(this);\n  }\n\n  /** 分发一个事务并通知所有订阅者。 */\n  dispatch(tr: Transaction): void {\n    this.state = applyTransaction(this.state, tr);\n    this.emit("change", this.state);\n  }\n\n  get getState(): EditorState {\n    return this.state;\n  }\n}' }],
    },
    {
      type: 'codeBlock',
      attrs: { language: 'typescript' },
      content: [{ type: 'text', text: '// 块类型定义\ntype BlockType =\n  | "paragraph"\n  | "heading"\n  | "bulletList"\n  | "orderedList"\n  | "todoList"\n  | "quote"\n  | "codeBlock"\n  | "image"\n  | "table"\n  | "divider";\n\ninterface Block {\n  readonly id: BlockId;\n  readonly type: BlockType;\n  readonly attrs: Attrs;\n  readonly content: InlineSeq;\n}' }],
    },
    {
      type: 'codeBlock',
      attrs: { language: 'python' },
      content: [{ type: 'text', text: '# 块编辑器后端 API 示例\nfrom fastapi import FastAPI, HTTPException\nfrom pydantic import BaseModel\n\napp = FastAPI(title="Block Editor API")\n\nclass Document(BaseModel):\n    id: str\n    title: str\n    blocks: list[dict]\n\n@app.post("/documents")\nasync def create_document(doc: Document):\n    # 保存文档到数据库\n    saved = await db.documents.insert_one(doc.dict())\n    return {"id": str(saved.inserted_id)}\n\n@app.get("/documents/{doc_id}")\nasync def get_document(doc_id: str):\n    doc = await db.documents.find_one({"_id": doc_id})\n    if not doc:\n        raise HTTPException(status_code=404, detail="Document not found")\n    return Document(**doc)' }],
    },
    {
      type: 'codeBlock',
      attrs: { language: 'sql' },
      content: [{ type: 'text', text: '-- 文档存储表结构\nCREATE TABLE documents (\n    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),\n    title       VARCHAR(200) NOT NULL,\n    content     JSONB NOT NULL,\n    owner_id    UUID NOT NULL REFERENCES users(id),\n    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),\n    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()\n);\n\n-- 查询用户文档列表\nSELECT id, title, updated_at\nFROM documents\nWHERE owner_id = $1\nORDER BY updated_at DESC\nLIMIT 20 OFFSET $2;' }],
    },
    {
      type: 'codeBlock',
      attrs: { language: 'bash' },
      content: [{ type: 'text', text: '# 安装依赖\nnpm install\n\n# 开发模式启动\nnpm run dev\n\n# 类型检查\nnpx vue-tsc --noEmit\n\n# 构建\nnpm run build' }],
    },
    {
      type: 'codeBlock',
      attrs: { language: 'plain' },
      content: [{ type: 'text', text: '纯文本代码块示例\n第二行\n第三行\n\n空行上方\n空行下方' }],
    },

    // =====================================================================
    // 表格
    // =====================================================================
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: '7. 表格' }],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: '表格使用 ' },
        { type: 'text', text: 'content: "none"', marks: [{ type: 'code' }] },
        { type: 'text', text: ' + attrs 存储模式，所有状态保存在 ' },
        { type: 'text', text: 'TableAttrs', marks: [{ type: 'code' }] },
        { type: 'text', text: ' 中。支持表头行、列宽拖拽、单元格合并/拆分、单元格富文本（加粗/斜体/颜色/链接）、单元格背景色、单元格类型切换。点击行/列选择条可选择整行/整列。' },
      ],
    },
    {
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: '7.1 块类型支持矩阵' }],
    },
    {
      type: 'table',
      attrs: {
        rows: 5,
        cols: 4,
        headerRow: true,
        colWidths: [100, 110, 110, 110],
        cells: [
          [
            { content: [{ type: 'text', text: '块类型' }], rowspan: 1, colspan: 1, covered: false, cellType: 'paragraph', align: 'center', bgColor: 'gray' },
            { content: [{ type: 'text', text: '支持缩进' }], rowspan: 1, colspan: 1, covered: false, cellType: 'paragraph', align: 'center', bgColor: 'gray' },
            { content: [{ type: 'text', text: '支持颜色' }], rowspan: 1, colspan: 1, covered: false, cellType: 'paragraph', align: 'center', bgColor: 'gray' },
            { content: [{ type: 'text', text: '内联标记' }], rowspan: 1, colspan: 1, covered: false, cellType: 'paragraph', align: 'center', bgColor: 'gray' },
          ],
          [
            { content: [{ type: 'text', text: 'paragraph' }], rowspan: 1, colspan: 1, covered: false, cellType: 'codeBlock' },
            { content: [{ type: 'text', text: '是' }], rowspan: 1, colspan: 1, covered: false, cellType: 'paragraph', align: 'center' },
            { content: [{ type: 'text', text: '是' }], rowspan: 1, colspan: 1, covered: false, cellType: 'paragraph', align: 'center' },
            { content: [{ type: 'text', text: '全部支持' }], rowspan: 1, colspan: 1, covered: false, cellType: 'paragraph', align: 'center' },
          ],
          [
            { content: [{ type: 'text', text: 'heading' }], rowspan: 1, colspan: 1, covered: false, cellType: 'codeBlock' },
            { content: [{ type: 'text', text: '是' }], rowspan: 1, colspan: 1, covered: false, cellType: 'paragraph', align: 'center' },
            { content: [{ type: 'text', text: '是' }], rowspan: 1, colspan: 1, covered: false, cellType: 'paragraph', align: 'center' },
            { content: [{ type: 'text', text: '全部支持' }], rowspan: 1, colspan: 1, covered: false, cellType: 'paragraph', align: 'center' },
          ],
          [
            { content: [{ type: 'text', text: 'quote' }], rowspan: 1, colspan: 1, covered: false, cellType: 'codeBlock' },
            { content: [{ type: 'text', text: '否' }], rowspan: 1, colspan: 1, covered: false, cellType: 'paragraph', align: 'center', bgColor: 'red' },
            { content: [{ type: 'text', text: '是' }], rowspan: 1, colspan: 1, covered: false, cellType: 'paragraph', align: 'center' },
            { content: [{ type: 'text', text: '不含斜体' }], rowspan: 1, colspan: 1, covered: false, cellType: 'paragraph', align: 'center' },
          ],
          [
            { content: [{ type: 'text', text: 'codeBlock' }], rowspan: 1, colspan: 1, covered: false, cellType: 'codeBlock' },
            { content: [{ type: 'text', text: '否' }], rowspan: 1, colspan: 1, covered: false, cellType: 'paragraph', align: 'center', bgColor: 'red' },
            { content: [{ type: 'text', text: '否' }], rowspan: 1, colspan: 1, covered: false, cellType: 'paragraph', align: 'center', bgColor: 'red' },
            { content: [{ type: 'text', text: '不支持' }], rowspan: 1, colspan: 1, covered: false, cellType: 'paragraph', align: 'center', bgColor: 'red' },
          ],
        ],
      },
      content: [],
    },
    {
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: '7.1.1 宽表横向滚动测试' }],
    },
    {
      type: 'paragraph',
      content: [{ type: 'text', text: '下表列数较多，会触发横向滚动。滚动静止后，列间插入圆点会重新计算并显示在可视区域的列间隙上方；滚到最左/最右时显示边界圆点。' }],
    },
    {
      type: 'table',
      attrs: {
        rows: 4,
        cols: 8,
        headerRow: true,
        colWidths: [120, 120, 120, 120, 120, 120, 120, 120],
        cells: [
          [
            { content: [{ type: 'text', text: '列 A' }], rowspan: 1, colspan: 1, covered: false, cellType: 'paragraph', align: 'center', bgColor: 'gray' },
            { content: [{ type: 'text', text: '列 B' }], rowspan: 1, colspan: 1, covered: false, cellType: 'paragraph', align: 'center', bgColor: 'gray' },
            { content: [{ type: 'text', text: '列 C' }], rowspan: 1, colspan: 1, covered: false, cellType: 'paragraph', align: 'center', bgColor: 'gray' },
            { content: [{ type: 'text', text: '列 D' }], rowspan: 1, colspan: 1, covered: false, cellType: 'paragraph', align: 'center', bgColor: 'gray' },
            { content: [{ type: 'text', text: '列 E' }], rowspan: 1, colspan: 1, covered: false, cellType: 'paragraph', align: 'center', bgColor: 'gray' },
            { content: [{ type: 'text', text: '列 F' }], rowspan: 1, colspan: 1, covered: false, cellType: 'paragraph', align: 'center', bgColor: 'gray' },
            { content: [{ type: 'text', text: '列 G' }], rowspan: 1, colspan: 1, covered: false, cellType: 'paragraph', align: 'center', bgColor: 'gray' },
            { content: [{ type: 'text', text: '列 H' }], rowspan: 1, colspan: 1, covered: false, cellType: 'paragraph', align: 'center', bgColor: 'gray' },
          ],
          [
            { content: [{ type: 'text', text: '1' }], rowspan: 1, colspan: 1, covered: false, cellType: 'paragraph', align: 'center' },
            { content: [{ type: 'text', text: '2' }], rowspan: 1, colspan: 1, covered: false, cellType: 'paragraph', align: 'center' },
            { content: [{ type: 'text', text: '3' }], rowspan: 1, colspan: 1, covered: false, cellType: 'paragraph', align: 'center' },
            { content: [{ type: 'text', text: '4' }], rowspan: 1, colspan: 1, covered: false, cellType: 'paragraph', align: 'center' },
            { content: [{ type: 'text', text: '5' }], rowspan: 1, colspan: 1, covered: false, cellType: 'paragraph', align: 'center' },
            { content: [{ type: 'text', text: '6' }], rowspan: 1, colspan: 1, covered: false, cellType: 'paragraph', align: 'center' },
            { content: [{ type: 'text', text: '7' }], rowspan: 1, colspan: 1, covered: false, cellType: 'paragraph', align: 'center' },
            { content: [{ type: 'text', text: '8' }], rowspan: 1, colspan: 1, covered: false, cellType: 'paragraph', align: 'center' },
          ],
          [
            { content: [{ type: 'text', text: '一' }], rowspan: 1, colspan: 1, covered: false, cellType: 'paragraph', align: 'center' },
            { content: [{ type: 'text', text: '二' }], rowspan: 1, colspan: 1, covered: false, cellType: 'paragraph', align: 'center' },
            { content: [{ type: 'text', text: '三' }], rowspan: 1, colspan: 1, covered: false, cellType: 'paragraph', align: 'center' },
            { content: [{ type: 'text', text: '四' }], rowspan: 1, colspan: 1, covered: false, cellType: 'paragraph', align: 'center' },
            { content: [{ type: 'text', text: '五' }], rowspan: 1, colspan: 1, covered: false, cellType: 'paragraph', align: 'center' },
            { content: [{ type: 'text', text: '六' }], rowspan: 1, colspan: 1, covered: false, cellType: 'paragraph', align: 'center' },
            { content: [{ type: 'text', text: '七' }], rowspan: 1, colspan: 1, covered: false, cellType: 'paragraph', align: 'center' },
            { content: [{ type: 'text', text: '八' }], rowspan: 1, colspan: 1, covered: false, cellType: 'paragraph', align: 'center' },
          ],
          [
            { content: [{ type: 'text', text: '甲' }], rowspan: 1, colspan: 1, covered: false, cellType: 'paragraph', align: 'center' },
            { content: [{ type: 'text', text: '乙' }], rowspan: 1, colspan: 1, covered: false, cellType: 'paragraph', align: 'center' },
            { content: [{ type: 'text', text: '丙' }], rowspan: 1, colspan: 1, covered: false, cellType: 'paragraph', align: 'center' },
            { content: [{ type: 'text', text: '丁' }], rowspan: 1, colspan: 1, covered: false, cellType: 'paragraph', align: 'center' },
            { content: [{ type: 'text', text: '戊' }], rowspan: 1, colspan: 1, covered: false, cellType: 'paragraph', align: 'center' },
            { content: [{ type: 'text', text: '己' }], rowspan: 1, colspan: 1, covered: false, cellType: 'paragraph', align: 'center' },
            { content: [{ type: 'text', text: '庚' }], rowspan: 1, colspan: 1, covered: false, cellType: 'paragraph', align: 'center' },
            { content: [{ type: 'text', text: '辛' }], rowspan: 1, colspan: 1, covered: false, cellType: 'paragraph', align: 'center' },
          ],
        ],
      },
      content: [],
    },
    {
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: '7.2 合并单元格 + 富文本单元格' }],
    },
    {
      type: 'paragraph',
      content: [{ type: 'text', text: '下表测试合并单元格（第1行第2-3列合并、第3-4行第1列合并）以及单元格内富文本标记：' }],
    },
    {
      type: 'table',
      attrs: {
        rows: 4,
        cols: 3,
        headerRow: true,
        colWidths: [140, 180, 140],
        cells: [
          [
            { content: [{ type: 'text', text: '模块' }], rowspan: 1, colspan: 1, covered: false, cellType: 'paragraph', align: 'center', bgColor: 'blue' },
            { content: [{ type: 'text', text: '说明（合并单元格）' }], rowspan: 1, colspan: 2, covered: false, cellType: 'paragraph', align: 'center', bgColor: 'blue' },
            { content: [], rowspan: 1, colspan: 1, covered: true },
          ],
          [
            { content: [{ type: 'text', text: '数据模型' }], rowspan: 1, colspan: 1, covered: false, cellType: 'paragraph', align: 'center' },
            { content: [
              { type: 'text', text: '使用 ' },
              { type: 'text', text: 'Block', marks: [{ type: 'bold' }, { type: 'code' }] },
              { type: 'text', text: ' / ' },
              { type: 'text', text: 'InlineSeq', marks: [{ type: 'bold' }, { type: 'code' }] },
              { type: 'text', text: ' / ' },
              { type: 'text', text: 'Mark', marks: [{ type: 'bold' }, { type: 'code' }] },
              { type: 'text', text: ' 类型，文档：' },
              { type: 'text', text: '类型定义文档', marks: [{ type: 'link', attrs: { href: 'https://github.com' } }] },
            ], rowspan: 1, colspan: 1, covered: false, cellType: 'paragraph' },
            { content: [{ type: 'text', text: '已完成', marks: [{ type: 'bold' }] }], rowspan: 1, colspan: 1, covered: false, cellType: 'paragraph', align: 'center', bgColor: 'green' },
          ],
          [
            { content: [
              { type: 'text', text: '命令系统', marks: [{ type: 'bold' }] },
              { type: 'text', text: '\n（跨行合并）' },
            ], rowspan: 2, colspan: 1, covered: false, cellType: 'paragraph', align: 'center', bgColor: 'yellow' },
            { content: [
              { type: 'text', text: '命令注册：' },
              { type: 'text', text: 'CommandEntry', marks: [{ type: 'code' }] },
              { type: 'text', text: ' → ' },
              { type: 'text', text: 'CommandProxy', marks: [{ type: 'code' }] },
            ], rowspan: 1, colspan: 1, covered: false, cellType: 'paragraph' },
            { content: [{ type: 'text', text: '进行中', marks: [{ type: 'italic' }] }], rowspan: 1, colspan: 1, covered: false, cellType: 'paragraph', align: 'center', bgColor: 'orange' },
          ],
          [
            { content: [], rowspan: 1, colspan: 1, covered: true },
            { content: [
              { type: 'text', text: '事务分发：' },
              { type: 'text', text: 'dispatch(tr)', marks: [{ type: 'code' }] },
              { type: 'text', text: ' → ' },
              { type: 'text', text: 'applySteps', marks: [{ type: 'code' }] },
              { type: 'text', text: '，支持' },
              { type: 'text', text: '撤销/重做', marks: [{ type: 'underline' }] },
            ], rowspan: 1, colspan: 1, covered: false, cellType: 'paragraph' },
            { content: [{ type: 'text', text: '进行中', marks: [{ type: 'italic' }] }], rowspan: 1, colspan: 1, covered: false, cellType: 'paragraph', align: 'center', bgColor: 'orange' },
          ],
        ],
      },
      content: [],
    },
    {
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: '7.3 单元格链接测试' }],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: '下表测试单元格内链接：在编辑模式和非编辑模式下点击链接都应弹出链接查看浮动栏。' },
      ],
    },
    {
      type: 'table',
      attrs: {
        rows: 3,
        cols: 2,
        headerRow: true,
        colWidths: [160, 240],
        cells: [
          [
            { content: [{ type: 'text', text: '资源' }], rowspan: 1, colspan: 1, covered: false, cellType: 'paragraph', align: 'center', bgColor: 'purple' },
            { content: [{ type: 'text', text: '链接' }], rowspan: 1, colspan: 1, covered: false, cellType: 'paragraph', align: 'center', bgColor: 'purple' },
          ],
          [
            { content: [{ type: 'text', text: 'Vue 3 文档', marks: [{ type: 'bold' }] }], rowspan: 1, colspan: 1, covered: false, cellType: 'paragraph' },
            { content: [
              { type: 'text', text: 'https://vuejs.org', marks: [{ type: 'link', attrs: { href: 'https://vuejs.org' } }] },
            ], rowspan: 1, colspan: 1, covered: false, cellType: 'paragraph' },
          ],
          [
            { content: [{ type: 'text', text: 'TypeScript 中文网', marks: [{ type: 'bold' }] }], rowspan: 1, colspan: 1, covered: false, cellType: 'paragraph' },
            { content: [
              { type: 'text', text: '点击访问 ', marks: [{ type: 'italic' }] },
              { type: 'text', text: 'TypeScript 官网', marks: [{ type: 'link', attrs: { href: 'https://www.typescriptlang.org' } }] },
            ], rowspan: 1, colspan: 1, covered: false, cellType: 'paragraph' },
          ],
        ],
      },
      content: [],
    },

    // =====================================================================
    // 分隔线
    // =====================================================================
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: '8. 分隔线' }],
    },
    {
      type: 'paragraph',
      content: [{ type: 'text', text: '分隔线用于内容分节，不支持任何属性：' }],
    },
    {
      type: 'divider',
      attrs: {},
      content: [],
    },
    {
      type: 'paragraph',
      content: [{ type: 'text', text: '上方是分隔线。' }],
    },

    // =====================================================================
    // 组合测试
    // =====================================================================
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: '9. 架构设计' }],
    },
    {
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: '9.1 扩展系统' }],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: '编辑器采用' },
        { type: 'text', text: '扩展（Extension）', marks: [{ type: 'bold' }] },
        { type: 'text', text: '架构，每个块类型（paragraph、heading、codeBlock 等）都是一个独立扩展，通过 ' },
        { type: 'text', text: 'BuiltinExtensions', marks: [{ type: 'code' }] },
        { type: 'text', text: ' 数组统一注册。扩展可贡献：' },
      ],
    },
    {
      type: 'bulletList',
      attrs: { indent: 1 },
      content: [
        { type: 'text', text: 'Schema', marks: [{ type: 'bold' }] },
        { type: 'text', text: '：声明块类型、attrs 规格、content 模式' },
      ],
    },
    {
      type: 'bulletList',
      attrs: { indent: 1 },
      content: [
        { type: 'text', text: 'Commands', marks: [{ type: 'bold' }] },
        { type: 'text', text: '：注册命令（如 ' },
        { type: 'text', text: 'setAttrs', marks: [{ type: 'code' }] },
        { type: 'text', text: '、' },
        { type: 'text', text: 'toggleMark', marks: [{ type: 'code' }] },
        { type: 'text', text: '）' },
      ],
    },
    {
      type: 'bulletList',
      attrs: { indent: 1 },
      content: [
        { type: 'text', text: 'Renderer', marks: [{ type: 'bold' }] },
        { type: 'text', text: '：Vue 渲染函数，将 Block 渲染为 DOM' },
      ],
    },
    {
      type: 'bulletList',
      attrs: { indent: 1 },
      content: [
        { type: 'text', text: 'SlashCommands', marks: [{ type: 'bold' }] },
        { type: 'text', text: '：斜杠菜单项（输入 ' },
        { type: 'text', text: '/', marks: [{ type: 'code' }] },
        { type: 'text', text: ' 触发）' },
      ],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: '自定义扩展示例见 ' },
        { type: 'text', text: '项目 README', marks: [{ type: 'link', attrs: { href: 'https://github.com/xiaodaozhi/xiaodao-editor/blob/main/README.md' } }] },
        { type: 'text', text: '。' },
      ],
    },
    {
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: '9.2 选区与命令' }],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: '选区（Selection）有两种类型：' },
        { type: 'text', text: 'caret', marks: [{ type: 'code' }] },
        { type: 'text', text: '（光标）和 ' },
        { type: 'text', text: 'text', marks: [{ type: 'code' }] },
        { type: 'text', text: '（文本范围）。跨块选区用 ' },
        { type: 'text', text: 'isCrossBlockText()', marks: [{ type: 'code' }] },
        { type: 'text', text: ' 判断。命令通过 ' },
        { type: 'text', text: 'editor.commands.xxx(args)', marks: [{ type: 'code' }] },
        { type: 'text', text: ' 调用，内部 dispatch Transaction → 应用 Step → 更新状态。' },
      ],
    },
    {
      type: 'codeBlock',
      attrs: { language: 'typescript' },
      content: [{ type: 'text', text: '// 选区类型\ninterface CaretSelection {\n  kind: "caret";\n  blockId: BlockId;\n  offset: number;\n}\n\ninterface TextSelection {\n  kind: "text";\n  anchor: { blockId: BlockId; offset: number };\n  focus: { blockId: BlockId; offset: number };\n}\n\ntype Selection = CaretSelection | TextSelection;\n\n// 调用命令示例\neditor.commands.toggleMark?.({ id: blockId, mark: "bold" });\neditor.commands.setAttrs?.({ id: blockId, attrs: { align: "center" } });\neditor.commands.setLink?.({ id: blockId, href: url, from, to });' }],
    },
    {
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: '9.3 键盘快捷键' }],
    },
    {
      type: 'table',
      attrs: {
        rows: 7,
        cols: 2,
        headerRow: true,
        colWidths: [180, 220],
        cells: [
          [
            { content: [{ type: 'text', text: '快捷键' }], rowspan: 1, colspan: 1, covered: false, cellType: 'paragraph', align: 'center', bgColor: 'green' },
            { content: [{ type: 'text', text: '功能' }], rowspan: 1, colspan: 1, covered: false, cellType: 'paragraph', align: 'center', bgColor: 'green' },
          ],
          [
            { content: [
              { type: 'text', text: 'Ctrl/Cmd + B', marks: [{ type: 'code' }] },
            ], rowspan: 1, colspan: 1, covered: false, cellType: 'paragraph' },
            { content: [{ type: 'text', text: '切换加粗' }], rowspan: 1, colspan: 1, covered: false, cellType: 'paragraph' },
          ],
          [
            { content: [
              { type: 'text', text: 'Ctrl/Cmd + I', marks: [{ type: 'code' }] },
            ], rowspan: 1, colspan: 1, covered: false, cellType: 'paragraph' },
            { content: [{ type: 'text', text: '切换斜体' }], rowspan: 1, colspan: 1, covered: false, cellType: 'paragraph' },
          ],
          [
            { content: [
              { type: 'text', text: 'Ctrl/Cmd + K', marks: [{ type: 'code' }] },
            ], rowspan: 1, colspan: 1, covered: false, cellType: 'paragraph' },
            { content: [{ type: 'text', text: '插入/编辑链接' }], rowspan: 1, colspan: 1, covered: false, cellType: 'paragraph' },
          ],
          [
            { content: [
              { type: 'text', text: 'Ctrl/Cmd + C / X', marks: [{ type: 'code' }] },
            ], rowspan: 1, colspan: 1, covered: false, cellType: 'paragraph' },
            { content: [{ type: 'text', text: '复制/剪切选中文本（干净序列化）' }], rowspan: 1, colspan: 1, covered: false, cellType: 'paragraph' },
          ],
          [
            { content: [
              { type: 'text', text: 'Tab / Shift+Tab', marks: [{ type: 'code' }] },
            ], rowspan: 1, colspan: 1, covered: false, cellType: 'paragraph' },
            { content: [{ type: 'text', text: '增加/减少缩进（列表中导航）' }], rowspan: 1, colspan: 1, covered: false, cellType: 'paragraph' },
          ],
          [
            { content: [
              { type: 'text', text: 'Enter', marks: [{ type: 'code' }] },
            ], rowspan: 1, colspan: 1, covered: false, cellType: 'paragraph' },
            { content: [{ type: 'text', text: '换行 / 新建块 / 退出列表' }], rowspan: 1, colspan: 1, covered: false, cellType: 'paragraph' },
          ],
        ],
      },
      content: [],
    },

    // =====================================================================
    // 分隔线
    // =====================================================================
    {
      type: 'divider',
      attrs: {},
      content: [],
    },

    // =====================================================================
    // 总结
    // =====================================================================
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: '10. 总结' }],
    },
    {
      type: 'paragraph',
      attrs: { align: 'center' },
      content: [
        { type: 'text', text: '本技术文档涵盖了块编辑器的全部核心功能。', marks: [{ type: 'bold' }] },
      ],
    },
    {
      type: 'todoList',
      attrs: { checked: true },
      content: [{ type: 'text', text: '标题层级 H1-H6' }],
    },
    {
      type: 'todoList',
      attrs: { checked: true },
      content: [{ type: 'text', text: '内联标记（加粗/斜体/下划线/删除线/代码/链接/颜色）' }],
    },
    {
      type: 'todoList',
      attrs: { checked: true },
      content: [{ type: 'text', text: '块级属性（对齐/颜色/背景/缩进）' }],
    },
    {
      type: 'todoList',
      attrs: { checked: true },
      content: [{ type: 'text', text: '列表（无序/有序/待办）与嵌套缩进' }],
    },
    {
      type: 'todoList',
      attrs: { checked: true },
      content: [{ type: 'text', text: '引用块（含限制标记）' }],
    },
    {
      type: 'todoList',
      attrs: { checked: true },
      content: [{ type: 'text', text: '代码块（多语言）' }],
    },
    {
      type: 'todoList',
      attrs: { checked: true },
      content: [{ type: 'text', text: '表格（合并/富文本/链接/背景色）' }],
    },
    {
      type: 'todoList',
      attrs: { checked: true },
      content: [{ type: 'text', text: '分隔线' }],
    },
    {
      type: 'todoList',
      attrs: { checked: false },
      content: [
        { type: 'text', text: '如发现问题，请提 ' },
        { type: 'text', text: 'Issue', marks: [{ type: 'link', attrs: { href: 'https://github.com/xiaodaozhi/xiaodao-editor/issues' } }] },
        { type: 'text', text: '。' },
      ],
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

// Update document title based on locale (i18n)
watch(locale, (v) => {
  document.title = v === 'zh-CN' ? '小刀编辑器' : 'Xiaodao Editor'
}, { immediate: true })
</script>
