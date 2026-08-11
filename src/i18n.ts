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

  // BlockSettingsMenu: collapsible section titles
  'bsm.section.turnInto': '转换为',
  'bsm.section.alignIndent': '对齐与缩进',
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

  // BlockSettingsMenu
  'bsm.section.turnInto': 'Turn into',
  'bsm.section.alignIndent': 'Align & Indent',
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
  'hoverToolbar.linkBtnTitle': 'Link',

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
