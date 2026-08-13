/**
 * Lightweight i18n + theme module for the block editor.
 *
 * - Locale: 'zh-CN' (default) or 'en-US'. Any non-empty, non-'zh-CN'
 *   value is treated as 'en-US' per the public contract.
 * - Theme:  'light' (default) or 'dark'.
 *
 * Static UI strings (tooltips, menu labels, placeholders, button text, …)
 * are centralised here so the consumer can swap languages via the
 * `<BlockEditor :locale="…">` prop without forking the component source.
 *
 * Translations are plain nested objects; we deliberately avoid vue-i18n so
 * the package has zero runtime dependencies.  `useI18n()` returns a tiny
 * `t(key)` helper that reads from the injected dictionary via Vue's
 * provide/inject (matching how the editor instance flows down the tree).
 */

import type { InjectionKey, Ref } from 'vue';
import { inject, provide, ref } from 'vue';

// --- Types ---------------------------------------------------------------

export type Theme = 'light' | 'dark';
export type Locale = 'zh-CN' | 'en-US';

/** Normalise user-supplied locale values to the canonical two-member set. */
export function normalizeLocale(raw: string | undefined | null): Locale {
  if (raw === 'zh-CN' || raw === null || raw === undefined || raw === '') {
    return 'zh-CN';
  }
  // Contract: any non-empty value other than 'zh-CN' ⇒ en-US.
  return 'en-US';
}

export function normalizeTheme(raw: string | undefined | null): Theme {
  return raw === 'dark' ? 'dark' : 'light';
}

// --- Translation dictionaries -------------------------------------------

type Dict = Readonly<Record<string, string>>;

const zhCN: Dict = {
  // BlockEditor
  'editor.placeholder': '输入文字，或按 \'/\' 获取命令…',

  // BlockHandle
  'handle.plus.title': '点击添加块',
  'handle.plus.ariaLabel': 'Insert block below',
  'handle.grip.title': '拖拽移动 / 点击设置',
  'handle.grip.ariaLabel': 'Drag to move block, click to open settings',

  // Shared scroll buttons (PlusMenu / BlockSettingsMenu / HoverToolbar dropdowns)
  'ui.scrollUp': '向上滚动',
  'ui.scrollDown': '向下滚动',
  'ui.scrollLeft': '向左',
  'ui.scrollRight': '向右',

  // PlusMenu (slash + insert)
  'plus.category.basic': '基本区块',
  'plus.category.list': '列表',
  'plus.category.other': '其他',
  'plus.noMatch': '未找到匹配的命令',
  'plus.searchPlaceholder': '搜索命令…',

  // Slash command titles + descriptions
  'slash.paragraph.title': '正文',
  'slash.paragraph.description': '普通文本段落。',
  'slash.heading1.title': '一级标题',
  'slash.heading1.description': '用于文章的主标题。',
  'slash.heading2.title': '二级标题',
  'slash.heading2.description': '用于主要章节的标题。',
  'slash.heading3.title': '三级标题',
  'slash.heading3.description': '用于子章节的标题。',
  'slash.heading4.title': '四级标题',
  'slash.heading4.description': '用于更细分层的标题。',
  'slash.heading5.title': '五级标题',
  'slash.heading5.description': '用于较小层级的标题。',
  'slash.heading6.title': '六级标题',
  'slash.heading6.description': '用于最小层级的标题。',
  'slash.bulletList.title': '项目符号列表',
  'slash.bulletList.description': '创建一个无序列表。',
  'slash.orderedList.title': '编号列表',
  'slash.orderedList.description': '创建一个带编号的有序列表。',
  'slash.todoList.title': '待办列表',
  'slash.todoList.description': '用复选框追踪待办任务。',
  'slash.quote.title': '引用',
  'slash.quote.description': '引用一段话。',
  'slash.codeBlock.title': '代码块',
  'slash.codeBlock.description': '插入一段代码块。',
  'codeBlock.title': '代码块',
  'slash.divider.title': '分隔符',
  'slash.divider.description': '插入一条水平分隔线。',
  'slash.image.title': '图片',
  'slash.image.description': '插入一张图片（从本地上传或选择文件）。',
  'slash.table3x3.title': '表格（3×3）',
  'slash.table3x3.description': '插入一个 3 行 3 列的表格。',
  'slash.table2x2.title': '表格（2×2）',
  'slash.table2x2.description': '插入一个 2 行 2 列的表格。',
  'slash.table4x4.title': '表格（4×4）',
  'slash.table4x4.description': '插入一个 4 行 4 列的表格。',

  // BlockSettingsMenu: collapsible section titles
  'bsm.section.turnInto': '转换为',
  'bsm.section.alignIndent': '对齐与缩进',
  'bsm.section.align': '对齐',
  'bsm.section.action': '操作',
  'bsm.section.textColor': '文字颜色',
  'bsm.section.bgColor': '背景颜色',
  // Indent buttons
  'bsm.indent.decrease': '减少缩进',
  'bsm.indent.increase': '增加缩进',
  // "Turn into" block types (left sidebar)
  'turnInto.paragraph': '正文',
  'turnInto.h1': '一级标题',
  'turnInto.h2': '二级标题',
  'turnInto.h3': '三级标题',
  'turnInto.h4': '四级标题',
  'turnInto.h5': '五级标题',
  'turnInto.h6': '六级标题',
  'turnInto.bullet': '项目符号',
  'turnInto.ordered': '编号列表',
  'turnInto.todo': '待办',
  'turnInto.quote': '引用',
  'turnInto.code': '代码块',
  // Alignment options (shared with HoverToolbar)
  'align.left': '左对齐',
  'align.center': '居中',
  'align.right': '右对齐',
  'align.justify': '两端对齐',
  // Vertical alignment options
  'verticalAlign.top': '顶端对齐',
  'verticalAlign.middle': '垂直居中',
  'verticalAlign.bottom': '底端对齐',
  'hoverToolbar.verticalAlignBtnTitle': '垂直对齐',
  // Clipboard + move block actions (grip menu bottom)
  'action.duplicate': '复制',
  'action.copy': '拷贝',
  'action.cut': '剪切',
  'action.moveUp': '上移',
  'action.moveDown': '下移',
  'action.delete': '删除',

  // Ordered-list marker menu
  'ol.continue': '继续之前的编号',
  'ol.startNew': '开始新列表（从1开始）',
  'ol.modify': '修改编号值…',

  // NumberPicker
  'numberPicker.title': '修改编号值',
  'numberPicker.inputLabel': '编号值',
  'numberPicker.confirm': '确定',

  // Code language picker
  'codeLang.title': '设置代码类型',
  'codeLang.inputLabel': '代码类型',
  'codeLang.placeholder': '请输入代码类型',
  'codeLang.confirm': '确定',
  'codeLang.custom': '自定义…',
  'codeLang.cancel': '取消',
  'codeLang.plain': '纯文本',

  // HoverToolbar
  'hoverToolbar.label': '格式化',
  'hoverToolbar.typeBtnTitle': '切换块类型',
  'hoverToolbar.alignBtnTitle': '对齐方式',
  'hoverToolbar.colorBtnTitle': '颜色',
  'hoverToolbar.textColor': '文字颜色',
  'hoverToolbar.bgColor': '背景颜色',
  'hoverToolbar.copySelection': '复制选中文本',
  'hoverToolbar.deleteBlock': '删除块',
  // Inline mark buttons
  'mark.bold': '加粗',
  'mark.italic': '斜体',
  'mark.underline': '下划线',
  'mark.strikethrough': '删除线',
  'mark.inlineCode': '行内代码',
  'mark.link': '链接',

  // Link popover
  'link.popoverLabel': '链接',
  'link.open': '打开链接',
  'link.copy': '复制链接',
  'link.edit': '编辑链接',
  'link.remove': '移除链接',
  'link.save': '保存',
  'link.cancel': '取消',
  'link.urlPlaceholder': '输入链接地址…',
  'link.textPlaceholder': '链接文本…',
  'link.emptyUrl': '(空链接)',
  'link.invalidUrl': '请输入有效的链接地址',
  'hoverToolbar.linkBtnTitle': '链接',

  // Color preset names (text color + background color)
  'color.default': '默认',
  'color.gray': '灰色',
  'color.brown': '棕色',
  'color.orange': '橙色',
  'color.yellow': '黄色',
  'color.green': '绿色',
  'color.blue': '蓝色',
  'color.purple': '紫色',
  'color.pink': '粉色',
  'color.red': '红色',
  'color.none': '无',

  // Image block
  'image.uploading': '正在上传图片…',
  'image.uploadFailed': '上传失败',
  'image.loadFailed': '图片加载失败',
  'image.retry': '重试',
  'image.replace': '替换图片',
  'image.remove': '删除图片',
  'image.resize': '拖拽调整尺寸',
  'image.emptyTitle': '点击上传图片',
  'image.emptySub': '或拖入图片文件到此处',
  'image.captionPlaceholder': '添加图片说明…',
  'turnInto.image': '图片',

  // Table block
  'table.title': '表格',
  'table.cellPlaceholder': '输入内容…',
  'table.resizeCol': '拖拽调整列宽',
  'table.rowActions': '行操作',
  'table.colActions': '列操作',
  'table.selectRow': '选择此行',
  'table.selectCol': '选择此列',
  'table.selectAll': '选择整个表格',
  'table.insertRowAbove': '在上方插入行',
  'table.insertRowBelow': '在下方插入行',
  'table.insertColLeft': '在左侧插入列',
  'table.insertColRight': '在右侧插入列',
  'table.removeRow': '删除此行',
  'table.removeCol': '删除此列',
  'table.deleteRow': '删除行',
  'table.deleteCol': '删除列',
  'table.toggleHeader': '切换表头行',
  'table.mergeCells': '合并单元格',
  'table.splitCell': '拆分单元格',
  'table.deleteTable': '删除表格',
  'turnInto.table': '表格',
};

const enUS: Dict = {
  // BlockEditor
  'editor.placeholder': 'Type \'/\' for commands...',

  // BlockHandle
  'handle.plus.title': 'Insert block below',
  'handle.plus.ariaLabel': 'Insert block below',
  'handle.grip.title': 'Drag to move / click for settings',
  'handle.grip.ariaLabel': 'Drag to move block, click to open settings',

  // Shared scroll buttons
  'ui.scrollUp': 'Scroll up',
  'ui.scrollDown': 'Scroll down',
  'ui.scrollLeft': 'Scroll left',
  'ui.scrollRight': 'Scroll right',

  // PlusMenu
  'plus.category.basic': 'Basic blocks',
  'plus.category.list': 'Lists',
  'plus.category.other': 'Other',
  'plus.noMatch': 'No matching commands',
  'plus.searchPlaceholder': 'Search commands...',

  // Slash command titles + descriptions
  'slash.paragraph.title': 'Paragraph',
  'slash.paragraph.description': 'Plain text paragraph.',
  'slash.heading1.title': 'Heading 1',
  'slash.heading1.description': 'Main title for the document.',
  'slash.heading2.title': 'Heading 2',
  'slash.heading2.description': 'Title for major sections.',
  'slash.heading3.title': 'Heading 3',
  'slash.heading3.description': 'Title for sub-sections.',
  'slash.heading4.title': 'Heading 4',
  'slash.heading4.description': 'Title for finer hierarchy levels.',
  'slash.heading5.title': 'Heading 5',
  'slash.heading5.description': 'Title for smaller hierarchy levels.',
  'slash.heading6.title': 'Heading 6',
  'slash.heading6.description': 'Title for the smallest hierarchy level.',
  'slash.bulletList.title': 'Bullet list',
  'slash.bulletList.description': 'Create an unordered list.',
  'slash.orderedList.title': 'Numbered list',
  'slash.orderedList.description': 'Create a numbered ordered list.',
  'slash.todoList.title': 'To-do list',
  'slash.todoList.description': 'Track tasks with checkboxes.',
  'slash.quote.title': 'Quote',
  'slash.quote.description': 'Quote a passage of text.',
  'slash.codeBlock.title': 'Code block',
  'slash.codeBlock.description': 'Insert a code block.',
  'codeBlock.title': 'Code block',
  'slash.divider.title': 'Divider',
  'slash.divider.description': 'Insert a horizontal divider line.',
  'slash.image.title': 'Image',
  'slash.image.description': 'Insert an image (upload or choose a file).',
  'slash.table3x3.title': 'Table (3×3)',
  'slash.table3x3.description': 'Insert a 3-row 3-column table.',
  'slash.table2x2.title': 'Table (2×2)',
  'slash.table2x2.description': 'Insert a 2-row 2-column table.',
  'slash.table4x4.title': 'Table (4×4)',
  'slash.table4x4.description': 'Insert a 4-row 4-column table.',

  // BlockSettingsMenu
  'bsm.section.turnInto': 'Turn into',
  'bsm.section.alignIndent': 'Align & Indent',
  'bsm.section.align': 'Align',
  'bsm.section.action': 'Actions',
  'bsm.section.textColor': 'Text color',
  'bsm.section.bgColor': 'Background color',
  'bsm.indent.decrease': 'Decrease indent',
  'bsm.indent.increase': 'Increase indent',
  // Turn into
  'turnInto.paragraph': 'Paragraph',
  'turnInto.h1': 'Heading 1',
  'turnInto.h2': 'Heading 2',
  'turnInto.h3': 'Heading 3',
  'turnInto.h4': 'Heading 4',
  'turnInto.h5': 'Heading 5',
  'turnInto.h6': 'Heading 6',
  'turnInto.bullet': 'Bullet list',
  'turnInto.ordered': 'Numbered list',
  'turnInto.todo': 'To-do',
  'turnInto.quote': 'Quote',
  'turnInto.code': 'Code block',
  // Align
  'align.left': 'Align left',
  'align.center': 'Center',
  'align.right': 'Align right',
  'align.justify': 'Justify',
  // Vertical alignment options
  'verticalAlign.top': 'Align top',
  'verticalAlign.middle': 'Vertical center',
  'verticalAlign.bottom': 'Align bottom',
  'hoverToolbar.verticalAlignBtnTitle': 'Vertical align',
  // Actions
  'action.duplicate': 'Duplicate',
  'action.copy': 'Copy',
  'action.cut': 'Cut',
  'action.moveUp': 'Move up',
  'action.moveDown': 'Move down',
  'action.delete': 'Delete',

  // Ordered-list menu
  'ol.continue': 'Continue previous numbering',
  'ol.startNew': 'Start a new list (from 1)',
  'ol.modify': 'Modify starting number...',

  // NumberPicker
  'numberPicker.title': 'Modify number value',
  'numberPicker.inputLabel': 'Number value',
  'numberPicker.confirm': 'Confirm',

  // Code language picker
  'codeLang.title': 'Set code language',
  'codeLang.inputLabel': 'Code language',
  'codeLang.placeholder': 'Enter code language',
  'codeLang.confirm': 'Confirm',
  'codeLang.custom': 'Custom…',
  'codeLang.cancel': 'Cancel',
  'codeLang.plain': 'Plain text',

  // HoverToolbar
  'hoverToolbar.label': 'Formatting',
  'hoverToolbar.typeBtnTitle': 'Switch block type',
  'hoverToolbar.alignBtnTitle': 'Alignment',
  'hoverToolbar.colorBtnTitle': 'Color',
  'hoverToolbar.textColor': 'Text color',
  'hoverToolbar.bgColor': 'Background color',
  'hoverToolbar.copySelection': 'Copy selection',
  'hoverToolbar.deleteBlock': 'Delete block',
  // Inline marks
  'mark.bold': 'Bold',
  'mark.italic': 'Italic',
  'mark.underline': 'Underline',
  'mark.strikethrough': 'Strikethrough',
  'mark.inlineCode': 'Inline code',
  'mark.link': 'Link',

  // Link popover
  'link.popoverLabel': 'Link',
  'link.open': 'Open link',
  'link.copy': 'Copy link',
  'link.edit': 'Edit link',
  'link.remove': 'Remove link',
  'link.save': 'Save',
  'link.cancel': 'Cancel',
  'link.urlPlaceholder': 'Enter URL...',
  'link.textPlaceholder': 'Link text...',
  'link.emptyUrl': '(empty link)',
  'link.invalidUrl': 'Please enter a valid URL',
  'hoverToolbar.linkBtnTitle': 'Link',
  'hoverToolbar.linkPrompt': 'Enter URL:',

  // Color preset names
  'color.default': 'Default',
  'color.gray': 'Gray',
  'color.brown': 'Brown',
  'color.orange': 'Orange',
  'color.yellow': 'Yellow',
  'color.green': 'Green',
  'color.blue': 'Blue',
  'color.purple': 'Purple',
  'color.pink': 'Pink',
  'color.red': 'Red',
  'color.none': 'None',

  // Image block
  'image.uploading': 'Uploading image...',
  'image.uploadFailed': 'Upload failed',
  'image.loadFailed': 'Failed to load image',
  'image.retry': 'Retry',
  'image.replace': 'Replace image',
  'image.remove': 'Remove image',
  'image.resize': 'Drag to resize',
  'image.emptyTitle': 'Click to upload an image',
  'image.emptySub': 'or drag an image file here',
  'image.captionPlaceholder': 'Add a caption...',
  'turnInto.image': 'Image',

  // Table block
  'table.title': 'Table',
  'table.cellPlaceholder': 'Type here...',
  'table.resizeCol': 'Drag to resize column',
  'table.rowActions': 'Row actions',
  'table.colActions': 'Column actions',
  'table.selectRow': 'Select row',
  'table.selectCol': 'Select column',
  'table.selectAll': 'Select entire table',
  'table.insertRowAbove': 'Insert row above',
  'table.insertRowBelow': 'Insert row below',
  'table.insertColLeft': 'Insert column left',
  'table.insertColRight': 'Insert column right',
  'table.removeRow': 'Delete row',
  'table.removeCol': 'Delete column',
  'table.deleteRow': 'Delete row',
  'table.deleteCol': 'Delete column',
  'table.toggleHeader': 'Toggle header row',
  'table.mergeCells': 'Merge cells',
  'table.splitCell': 'Split cell',
  'table.deleteTable': 'Delete table',
  'turnInto.table': 'Table',
};

const DICTS: Readonly<Record<Locale, Dict>> = {
  'zh-CN': zhCN,
  'en-US': enUS,
};

// --- Injection + helper -------------------------------------------------

export interface I18nBundle {
  readonly locale: Locale;
  readonly theme: Theme;
  /** Translate a key.  Falls back to the raw key if missing. */
  t(key: string): string;
}

/**
 * Reactive refs for locale and theme.  These are provided directly (not
 * wrapped in an object) so that each consumer's `t()` function accesses
 * `localeRef.value` — a plain ref read — which Vue's reactivity system
 * tracks reliably across <Teleport> boundaries.
 */
export const localeKey: InjectionKey<Ref<Locale>> = Symbol('be-locale');
export const themeKey: InjectionKey<Ref<Theme>> = Symbol('be-theme');

export function provideI18n(locale: Ref<Locale>, theme: Ref<Theme>): void {
  provide(localeKey, locale);
  provide(themeKey, theme);
}

/**
 * Access the i18n/theme bundle within a child component.  Each call
 * injects the raw locale/theme refs and builds a fresh `t()` that reads
 * `localeRef.value` directly — no computed, no closure-over-computed.
 *
 * When the parent updates `localeRef.value`, every template or computed
 * that called `t('key')` re-renders because the ref read was tracked
 * at call time.
 */
export function useI18n(): I18nBundle {
  const localeRef = inject(localeKey, ref<Locale>('zh-CN'));
  const themeRef = inject(themeKey, ref<Theme>('light'));

  return {
    get locale() { return localeRef.value; },
    get theme() { return themeRef.value; },
    t(key: string): string {
      const dict = DICTS[localeRef.value];
      const v = dict[key];
      return typeof v === 'string' ? v : key;
    },
  };
}
