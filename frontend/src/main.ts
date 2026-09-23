import { basicSetup } from "codemirror";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { indentWithTab, undo, redo } from "@codemirror/commands";
import { HighlightStyle, LanguageDescription, syntaxHighlighting } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { gotoLine, openSearchPanel } from "@codemirror/search";
import { tags } from "@lezer/highlight";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { languageBadge } from "./language-icons";
import "./style.css";

interface Bridge {
  ready: Promise<void>;
  locale: string;
  theme?: { appearance?: string };
  capabilities?: { storage?: boolean };
  storage?: {
    get(key: string): Promise<unknown>;
    set(key: string, value: unknown): Promise<void>;
  };
  invoke<T>(method: string, params: Record<string, unknown>, options?: { timeoutMs: number }): Promise<T>;
}

declare global {
  interface Window {
    dbxPlugin?: Bridge;
  }
}

interface Workspace {
  workspaceId: string;
  path: string;
  name: string;
  singleFile?: boolean;
  selectedFile?: string;
}

interface Entry {
  name: string;
  path: string;
  kind: "file" | "directory" | "symlink";
  size: number;
}

interface ProjectSearchMatch { path: string; line: number; column: number; preview: string }
interface ProjectSearchResult { matches: ProjectSearchMatch[]; filesScanned: number; truncated: boolean }

interface TreeNode extends Entry {
  expanded?: boolean;
  children?: TreeNode[];
  loading?: boolean;
}

interface EditorTab {
  name: string;
  path: string;
  content: string;
  savedContent: string;
  revision: string;
  encoding?: string;
  dirty: boolean;
  selection: number;
  scrollTop: number;
  state?: EditorState;
  untitled?: boolean;
  languageId: LanguageId;
  languageAuto: boolean;
  preview?: boolean;
  draftPersisted?: boolean;
  draftError?: boolean;
}

interface DraftRecord {
  id: string;
  name: string;
  content: string;
  languageId: LanguageId;
  languageAuto: boolean;
  selection: number;
  scrollTop: number;
  updatedAt: number;
}

interface DraftQueue {
  latest: DraftRecord | null;
  running: Promise<void> | null;
  discarded: boolean;
}

type Locale = "en" | "zh";
type LanguageId = string;
type PaletteMode = "files" | "commands" | "languages" | "encodings" | "fonts";
type EditorFontId = "default" | "sf-mono" | "menlo" | "monaco" | "andale-mono" | "courier-new" | "pt-mono" | "songti-sc" | "hiragino-sans-gb" | "stheiti";
type MenuName = "file" | "edit" | "view" | "go";

interface PaletteItem {
  label: string;
  detail?: string;
  shortcut?: string;
  token?: string;
  category?: string;
  previewFont?: string;
  selected?: boolean;
  action: () => void | Promise<void>;
}

interface SavedFilePosition { path: string; selection: number; scrollTop: number }
interface SavedSession { workspacePath: string; singleFile: boolean; openFiles: string[]; activeFile: string; activeDraft: string }

const strings = {
  en: {
    openFolder: "Open folder",
    openFile: "Open file…",
    selectEncoding: "Reopen with encoding",
    selectFont: "Editor font",
    fontPreview: "Preview · 中文 ABC 123",
    defaultFont: "Default monospace",
    increaseFontSize: "Increase editor font size",
    decreaseFontSize: "Decrease editor font size",
    resetFontSize: "Reset editor font size",
    newFile: "New file",
    newFolder: "New folder",
    newFileInProject: "Create file in project",
    create: "Create",
    createHint: "Enter a path relative to the open folder. Parent folders must already exist.",
    nameOrPath: "Name or relative path",
    createFailed: "Could not create item",
    recentFolder: "Recent folder",
    recentFolders: "Recent folders",
    recentFiles: "Recent files",
    welcomeTip: "Double-click empty space to create a temporary file.",
    chooseLanguageNew: "New file with language",
    selectLanguage: "Select language",
    previewMarkdown: "Preview Markdown",
    closeMarkdownPreview: "Close Markdown preview",
    markdownPreviewEmpty: "Start writing Markdown to see a preview.",
    projectFiles: "Project files",
    editorMenu: "Editor menu",
    editorRegion: "Editor",
    bottomPanelRegion: "Bottom panel",
    resizeProjectPanel: "Resize project panel",
    closeBottomPanel: "Close bottom panel",
    languageAuto: "Auto detect",
    openEditors: "OPEN EDITORS",
    files: "FILES",
    output: "Output",
    terminal: "Terminal",
    problems: "Problems",
    panelReserved: "This panel is reserved for a future version.",
    outputReady: "Editor output will appear here.",
    browse: "Browse…",
    menuFile: "File",
    menuEdit: "Edit",
    menuView: "View",
    menuGo: "Go",
    replaceInFile: "Replace in file",
    undo: "Undo",
    redo: "Redo",
    toggleBottomPanel: "Toggle bottom panel",
    quickActions: "Quick actions",
    toggleTheme: "Toggle theme",
    untitled: "Untitled",
    saveAs: "Save file as",
    open: "Open",
    save: "Save",
    goToFile: "Go to file",
    commands: "Commands",
    projectPanel: "Project",
    localFiles: "Local files",
    noFileSelected: "No file selected",
    navigate: "Navigate",
    select: "Select",
    workspaceLabel: "WORKSPACE",
    unsavedChanges: "UNSAVED CHANGES",
    toggleProjectPanel: "Toggle project panel",
    commandPalette: "Command palette",
    findInFile: "Find in file",
    closeFile: "Close file",
    newTemporaryFile: "New temporary file",
    draftSaved: "Temporary note saved locally",
    draftSaving: "Saving temporary note…",
    draftSaveFailed: "Could not save temporary note",
    draftDeleteFailed: "Could not remove temporary note",
    draftRestoreFailed: "Could not restore temporary notes",
    preferencesSaveFailed: "Could not save editor preferences",
    goToLine: "Go to line",
    enableWrap: "Enable word wrap",
    disableWrap: "Disable word wrap",
    line: "Ln",
    column: "Col",
    loadingFiles: "Indexing project files…",
    noMatchingFiles: "No matching files",
    noCommands: "No matching commands",
    fileIndexFailed: "Could not list project files",
    findFileByName: "Find file by name",
    searchProject: "Search project",
    searchProjectText: "Search text in project",
    caseSensitive: "Match case",
    includeBuildFolders: "Include dependencies and build folders",
    searchingProject: "Searching project…",
    searchPrompt: "Enter a keyword to search this project",
    searchResults: "{count} matching lines in {files} files",
    searchNoResults: "No matching text found",
    searchFailed: "Project search failed",
    searchTruncated: "Result limit reached; narrow the search",
    expandAllFolders: "Expand all folders",
    collapseAllFolders: "Collapse all folders",
    expandingFolders: "Expanding folders…",
    expandLimit: "Expansion reached its size limit; expand remaining folders manually",
    recursiveFolderHint: "Alt-click to expand or collapse this folder recursively",
    indexLimit: "Index limit reached; some files are omitted",
    explorer: "Explorer",
    folderHint: "Enter an absolute path to a folder on this computer.",
    folderPath: "Folder path",
    cancel: "Cancel",
    keepEditing: "Keep editing",
    discard: "Discard",
    discardTitle: "Discard changes?",
    noFolder: "No folder open",
    startHint: "Open a folder to get started.",
    emptyFolder: "This folder is empty.",
    welcomeTitle: "Every file you open is a chance to make it better.",
    welcomeDescription: "Open a project folder to browse, create and edit files.",
    chooseTitle: "Every file you open is a chance to make it better.",
    chooseDescription: "Choose a file from the explorer, or create one to get started.",
    ready: "Ready",
    saved: "Saved",
    unsaved: "Unsaved changes",
    saving: "Saving…",
    refresh: "Refresh files",
    dismiss: "Dismiss",
    fileChanged: "This file changed on disk. Your edits are still here.",
    reload: "Reload from disk",
    diskUpdated: "File updated from disk.",
    confirmClose: "Your unsaved edits to {name} will be lost.",
    confirmCloseTemp: "Closing {name} deletes its locally saved temporary note.",
    confirmFolder: "Opening another folder will discard unsaved edits.",
    confirmReload: "Reloading {name} will discard your unsaved edits.",
    symlink: "Symlinks are not available in this first version.",
    hostMissing: "Open this editor through the DBX plugin development host or DBX desktop app.",
    openFailed: "Could not open folder",
    readFailed: "Could not open file",
    saveFailed: "Could not save file",
    plainText: "Plain text"
  },
  zh: {
    openFolder: "打开文件夹",
    openFile: "打开文件…",
    selectEncoding: "按指定编码重新打开",
    selectFont: "编辑器字体",
    fontPreview: "预览 · 中文 ABC 123",
    defaultFont: "默认等宽字体",
    increaseFontSize: "放大编辑器字号",
    decreaseFontSize: "缩小编辑器字号",
    resetFontSize: "恢复默认字号",
    newFile: "新建文件",
    newFolder: "新建文件夹",
    newFileInProject: "在项目中新建文件",
    create: "创建",
    createHint: "输入相对于已打开文件夹的路径；上级文件夹需要已存在。",
    nameOrPath: "名称或相对路径",
    createFailed: "创建失败",
    recentFolder: "最近打开的文件夹",
    recentFolders: "最近打开",
    recentFiles: "最近文件",
    welcomeTip: "双击空白处可新建临时文件。",
    chooseLanguageNew: "指定语言新建文件",
    selectLanguage: "选择语言模式",
    previewMarkdown: "预览 Markdown",
    closeMarkdownPreview: "关闭 Markdown 预览",
    markdownPreviewEmpty: "输入 Markdown 后在这里查看预览。",
    projectFiles: "项目文件",
    editorMenu: "编辑器菜单",
    editorRegion: "编辑区",
    bottomPanelRegion: "底部面板",
    resizeProjectPanel: "调整项目栏宽度",
    closeBottomPanel: "关闭底部面板",
    languageAuto: "自动识别",
    openEditors: "已打开的编辑器",
    files: "文件",
    output: "输出",
    terminal: "终端",
    problems: "问题",
    panelReserved: "这个面板将在后续版本接入。",
    outputReady: "编辑器输出会显示在这里。",
    browse: "浏览…",
    menuFile: "文件",
    menuEdit: "编辑",
    menuView: "视图",
    menuGo: "转到",
    replaceInFile: "在文件中替换",
    undo: "撤销",
    redo: "重做",
    toggleBottomPanel: "切换底部面板",
    quickActions: "快捷操作",
    toggleTheme: "切换主题",
    untitled: "未命名",
    saveAs: "文件另存为",
    open: "打开",
    save: "保存",
    goToFile: "前往文件",
    commands: "命令",
    projectPanel: "项目",
    localFiles: "本地文件",
    noFileSelected: "未选择文件",
    navigate: "选择项目",
    select: "打开",
    workspaceLabel: "工作区",
    unsavedChanges: "未保存的更改",
    toggleProjectPanel: "切换项目面板",
    commandPalette: "命令面板",
    findInFile: "在文件中查找",
    closeFile: "关闭文件",
    newTemporaryFile: "新建临时文件",
    draftSaved: "临时随笔已存本机",
    draftSaving: "正在保存临时随笔…",
    draftSaveFailed: "临时随笔保存失败",
    draftDeleteFailed: "无法删除临时随笔",
    draftRestoreFailed: "无法恢复临时随笔",
    preferencesSaveFailed: "无法保存编辑器设置",
    goToLine: "跳转到行",
    enableWrap: "开启自动换行",
    disableWrap: "关闭自动换行",
    line: "行",
    column: "列",
    loadingFiles: "正在索引项目文件…",
    noMatchingFiles: "没有匹配的文件",
    noCommands: "没有匹配的命令",
    fileIndexFailed: "无法列出项目文件",
    findFileByName: "按文件名模糊搜索",
    searchProject: "搜索项目内容",
    searchProjectText: "在项目中搜索文本",
    caseSensitive: "区分大小写",
    includeBuildFolders: "包含依赖与构建目录",
    searchingProject: "正在搜索项目…",
    searchPrompt: "输入关键字搜索整个项目",
    searchResults: "在 {files} 个文件中找到 {count} 行",
    searchNoResults: "没有找到匹配内容",
    searchFailed: "项目搜索失败",
    searchTruncated: "结果达到上限，请缩小搜索范围",
    expandAllFolders: "展开全部文件夹",
    collapseAllFolders: "折叠全部文件夹",
    expandingFolders: "正在展开文件夹…",
    expandLimit: "展开数量达到上限，其余文件夹可手动展开",
    recursiveFolderHint: "按住 Option/Alt 点击可递归展开或折叠此文件夹",
    indexLimit: "已达到索引上限，部分文件未显示",
    explorer: "文件",
    folderHint: "输入此电脑上文件夹的绝对路径。",
    folderPath: "文件夹路径",
    cancel: "取消",
    keepEditing: "继续编辑",
    discard: "放弃更改",
    discardTitle: "放弃未保存的更改？",
    noFolder: "未打开文件夹",
    startHint: "打开文件夹开始编辑。",
    emptyFolder: "此文件夹为空。",
    welcomeTitle: "每一次的打开，都是为了更好",
    welcomeDescription: "打开项目文件夹，浏览、新建并编辑文件。",
    chooseTitle: "每一次的打开，都是为了更好",
    chooseDescription: "从左侧选择文件，或新建一个文件开始编辑。",
    ready: "就绪",
    saved: "已保存",
    unsaved: "未保存",
    saving: "保存中…",
    refresh: "刷新文件",
    dismiss: "关闭",
    fileChanged: "磁盘上的文件已变化；当前编辑内容仍在。",
    reload: "从磁盘重新加载",
    diskUpdated: "已从磁盘更新文件。",
    confirmClose: "关闭后将丢失 {name} 中未保存的编辑。",
    confirmCloseTemp: "关闭 {name} 会删除保存在本机的临时随笔。",
    confirmFolder: "打开另一个文件夹将丢失未保存的编辑。",
    confirmReload: "重新加载 {name} 将丢失未保存的编辑。",
    symlink: "首版暂不打开符号链接。",
    hostMissing: "请通过 DBX 插件开发环境或 DBX 桌面版打开编辑器。",
    openFailed: "无法打开文件夹",
    readFailed: "无法打开文件",
    saveFailed: "无法保存文件",
    plainText: "纯文本"
  }
} as const;

function element<T extends HTMLElement = HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing element: ${id}`);
  return found as T;
}

const bridge = window.dbxPlugin;
let locale: Locale = "en";
let workspace: Workspace | null = null;
let tree: TreeNode[] = [];
let tabs: EditorTab[] = [];
let activePath: string | null = null;
let editor: EditorView | null = null;
let editorTab: EditorTab | null = null;
let recentFolders: string[] = [];
let recentFiles: string[] = [];
let recentPositions: SavedFilePosition[] = [];
let busy = false;
let sidebarVisible = true;
let wordWrap = false;
let createKind: "file" | "directory" = "file";
let createMode: "new" | "saveAs" = "new";
let savingUntitled: EditorTab | null = null;
let pendingUntitledSave = false;
let untitledCount = 0;
let themePreference: "light" | "dark" = "dark";
let editorFontPreference: EditorFontId = "default";
let editorFontSize = 12.5;
let positionSaveTimer: number | undefined;
let paletteMode: PaletteMode = "files";
let paletteItems: PaletteItem[] = [];
let paletteSelection = 0;
let paletteReturnFocus: HTMLElement | null = null;
let fileIndex: Entry[] = [];
let fileIndexWorkspaceId: string | null = null;
let fileIndexPromise: Promise<void> | null = null;
let fileIndexGeneration = 0;
let fileIndexTruncated = false;
let projectSearchMode = false;
let projectSearchSequence = 0;
let projectSearchTimer: number | undefined;
let projectSearchResult: ProjectSearchResult | null = null;
let projectSearchQuery = "";
let projectSearchState: "idle" | "loading" | "error" = "idle";
let projectSearchError = "";
let treeExpansionSequence = 0;
let workspaceOpenSequence = 0;
let recentTabs: string[] = [];
let tabCycleOrder: string[] | null = null;
let tabCycleIndex = 0;
const draftQueues = new Map<string, DraftQueue>();
let draftErrorShown = false;
let preferenceWrite: Promise<void> = Promise.resolve();
const wrapCompartment = new Compartment();
const languageCompartment = new Compartment();
let openMenu: MenuName | null = null;
let bottomPanelTab: "output" | "terminal" | "problems" = "output";
let pendingEncodingEntry: Entry | null = null;
let nativePickerOpen = false;
let markdownPreviewTimer: number | undefined;

const editorTheme = EditorView.theme({
  "&": { backgroundColor: "var(--editor-bg)", color: "var(--text)" },
  ".cm-scroller": { fontFamily: "var(--editor-font)", fontSize: "var(--editor-font-size)", lineHeight: "1.65" },
  ".cm-gutters": { backgroundColor: "var(--pane-bg)", color: "var(--muted)" },
  ".cm-activeLine": { backgroundColor: "color-mix(in srgb, var(--accent) 6%, transparent)" },
  ".cm-activeLineGutter": { backgroundColor: "color-mix(in srgb, var(--accent) 8%, transparent)" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": { backgroundColor: "color-mix(in srgb, var(--accent) 28%, transparent)" },
  ".cm-cursor": { borderLeftColor: "var(--accent)" }
});

const highlight = HighlightStyle.define([
  { tag: [tags.keyword, tags.controlKeyword, tags.moduleKeyword, tags.operatorKeyword], color: "var(--syntax-keyword)", fontWeight: "600" },
  { tag: [tags.string, tags.special(tags.string), tags.regexp], color: "var(--syntax-string)" },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], color: "var(--syntax-number)" },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: "var(--syntax-comment)" },
  { tag: [tags.function(tags.variableName), tags.definition(tags.function(tags.variableName))], color: "var(--syntax-function)" },
  { tag: [tags.propertyName, tags.attributeName], color: "var(--syntax-property)" },
  { tag: [tags.typeName, tags.className, tags.namespace], color: "var(--syntax-type)" },
  { tag: tags.tagName, color: "var(--syntax-type)" },
  { tag: tags.heading, color: "var(--syntax-heading)", fontWeight: "650" },
  { tag: tags.strong, color: "var(--syntax-strong)", fontWeight: "650" },
  { tag: tags.emphasis, color: "var(--syntax-emphasis)", fontStyle: "italic" },
  { tag: tags.monospace, color: "var(--syntax-string)" },
  { tag: tags.link, color: "var(--syntax-link)", textDecoration: "underline" },
  { tag: [tags.operator, tags.escape], color: "var(--syntax-operator)" },
  { tag: tags.invalid, color: "var(--syntax-invalid)", textDecoration: "underline wavy" }
]);

function t(key: keyof typeof strings.en): string {
  return strings[locale][key];
}

function interpolate(template: string, name: string): string {
  return template.replace("{name}", name);
}

function languageFromName(name: string): LanguageId {
  if (/\.jsonc$/i.test(name)) return "JSON";
  return LanguageDescription.matchFilename(languages, name)?.name ?? "plain";
}

function normalizeLanguageId(id: string): LanguageId {
  if (id === "plain") return id;
  return languages.find((language) => language.name.toLowerCase() === id.toLowerCase())?.name ?? "plain";
}

function detectLanguage(name: string, content: string): LanguageId {
  const fromName = languageFromName(name);
  if (fromName !== "plain") return fromName;
  const sample = content.trimStart().slice(0, 4096);
  if (!sample) return "plain";
  if (/^#!.*\bpython(?:3)?\b/m.test(sample) || /^(?:from\s+\w+\s+import|import\s+\w+|def\s+\w+\s*\(|class\s+\w+\s*[:(])/m.test(sample)) return "Python";
  if (/^package\s+\w+\s*$/m.test(sample) && /\b(?:func|import|type)\b/.test(sample)) return "Go";
  if (/^<(!doctype\s+html|html\b|\?xml\b)/i.test(sample)) return "HTML";
  if (/^(?:select|insert|update|delete|create\s+table|with)\b/i.test(sample)) return "SQL";
  if (/^[{[]/.test(sample)) { try { JSON.parse(sample); return "JSON"; } catch { /* Keep detecting. */ } }
  if (/^(?:#\s+\S|```|---\s*\n)/.test(sample)) return "Markdown";
  if (/\b(?:const|let|function|export|import)\s+/.test(sample)) return "JavaScript";
  return "plain";
}

function languageExtension(id: LanguageId) {
  return languages.find((language) => language.name === id)?.support ?? [];
}

async function loadLanguageFor(tab: EditorTab) {
  const id = tab.languageId;
  const description = languages.find((language) => language.name === id);
  if (!description) return;
  try {
    const support = await description.load();
    if (editorTab === tab && tab.languageId === id && editor) {
      editor.dispatch({ effects: languageCompartment.reconfigure(support) });
    }
  } catch (error) {
    if (tab.languageId !== id) return;
    if (tab.languageAuto) {
      tab.languageId = "plain";
      if (editorTab === tab && editor) editor.dispatch({ effects: languageCompartment.reconfigure([]) });
      syncMarkdownPreview();
      updateStatus();
    } else {
      showNotice(`${t("selectLanguage")}: ${String(error instanceof Error ? error.message : error)}`);
    }
  }
}

function isMarkdownTab(tab: EditorTab | null): tab is EditorTab {
  return Boolean(tab && (tab.languageId === "Markdown" || /\.(?:md|markdown)$/i.test(tab.name)));
}

function renderMarkdownPreview(tab: EditorTab) {
  if (activeTab() !== tab || !tab.preview || !isMarkdownTab(tab)) return;
  const body = element("markdown-preview-body");
  if (!tab.content.trim()) {
    body.textContent = t("markdownPreviewEmpty");
    return;
  }
  try {
    body.innerHTML = DOMPurify.sanitize(marked.parse(tab.content, { async: false, gfm: true }));
    body.querySelectorAll<HTMLAnchorElement>("a[href]").forEach((link) => {
      if (link.getAttribute("href")?.startsWith("#")) return;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
    });
  } catch {
    body.textContent = tab.content;
  }
}

function queueMarkdownPreview(tab: EditorTab) {
  window.clearTimeout(markdownPreviewTimer);
  markdownPreviewTimer = window.setTimeout(() => renderMarkdownPreview(tab), 130);
}

function syncMarkdownPreview() {
  const tab = activeTab();
  const available = isMarkdownTab(tab);
  const open = available && Boolean(tab.preview);
  const toggle = element<HTMLButtonElement>("toggle-markdown-preview");
  toggle.hidden = !available;
  toggle.setAttribute("aria-pressed", String(open));
  toggle.title = t(open ? "closeMarkdownPreview" : "previewMarkdown");
  toggle.setAttribute("aria-label", toggle.title);
  element("editor-content").classList.toggle("preview-open", open);
  element("markdown-preview").hidden = !open;
  element("markdown-preview-title").textContent = t("previewMarkdown") + (tab ? ` · ${tab.name}` : "");
  if (open) renderMarkdownPreview(tab);
}

function toggleMarkdownPreview() {
  const tab = activeTab();
  if (!isMarkdownTab(tab)) return;
  tab.preview = !tab.preview;
  syncMarkdownPreview();
  if (!tab.preview) editor?.focus();
}

const editorFonts: { id: EditorFontId; label: string; stack: string }[] = [
  { id: "default", label: "Default monospace", stack: "var(--code-font)" },
  { id: "sf-mono", label: "SF Mono", stack: '"SFMono-Regular", "SF Mono", Menlo, monospace' },
  { id: "menlo", label: "Menlo", stack: 'Menlo, Monaco, monospace' },
  { id: "monaco", label: "Monaco", stack: 'Monaco, Menlo, monospace' },
  { id: "andale-mono", label: "Andale Mono", stack: '"Andale Mono", Menlo, monospace' },
  { id: "courier-new", label: "Courier New", stack: '"Courier New", Courier, monospace' },
  { id: "pt-mono", label: "PT Mono", stack: '"PT Mono", Menlo, monospace' },
  { id: "songti-sc", label: "Songti SC · 宋体", stack: '"Songti SC", "Songti TC", serif' },
  { id: "hiragino-sans-gb", label: "Hiragino Sans GB · 冬青黑体", stack: '"Hiragino Sans GB", sans-serif' },
  { id: "stheiti", label: "STHeiti · 黑体", stack: 'STHeiti, sans-serif' }
];

function languageLabel(id: LanguageId): string { return id === "plain" ? t("plainText") : id; }

function applyEditorTypography() {
  const font = editorFonts.find((item) => item.id === editorFontPreference) ?? editorFonts[0];
  document.documentElement.style.setProperty("--editor-font", font.stack);
  document.documentElement.style.setProperty("--editor-font-size", `${editorFontSize}px`);
  element("editor-font").textContent = font.id === "default" ? t("defaultFont") : font.label;
  element("editor-font-size").textContent = `${editorFontSize}px`;
  if (editor) {
    for (const node of [editor.dom, editor.scrollDOM, editor.contentDOM]) {
      node.style.setProperty("font-family", font.stack, "important");
      node.style.setProperty("font-size", `${editorFontSize}px`, "important");
    }
    editor.requestMeasure();
  }
}

function selectEditorFont(id: EditorFontId) {
  editorFontPreference = id;
  applyEditorTypography();
  queuePreferencesSave();
}

function changeEditorFontSize(amount: number) {
  editorFontSize = amount === 0 ? 12.5 : Math.max(10, Math.min(24, editorFontSize + amount));
  applyEditorTypography();
  queuePreferencesSave();
}

function absolutePathForTab(tab: EditorTab): string | null {
  if (!workspace || tab.untitled) return null;
  return workspace.singleFile ? workspace.path : workspace.path.replace(/\/$/, "") + "/" + tab.path;
}

function rememberFilePosition(tab: EditorTab) {
  const path = absolutePathForTab(tab);
  if (!path) return;
  recentPositions = [{ path, selection: tab.selection, scrollTop: Math.round(tab.scrollTop) }, ...recentPositions.filter((item) => item.path !== path)].slice(0, 20);
  window.clearTimeout(positionSaveTimer);
  positionSaveTimer = window.setTimeout(queuePreferencesSave, 450);
}

function fileKind(name: string): { token: string; category: string; label: string } {
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  if (["js", "jsx", "ts", "tsx", "mjs", "cjs"].includes(extension)) return { token: extension.toUpperCase().slice(0, 2), category: "code", label: extension.toUpperCase() };
  if (extension === "sql") return { token: "SQL", category: "sql", label: "SQL" };
  if (["md", "markdown"].includes(extension)) return { token: "MD", category: "md", label: "Markdown" };
  if (["json", "jsonc"].includes(extension)) return { token: "{}", category: "json", label: "JSON" };
  if (extension === "py") return { token: "PY", category: "code", label: "Python" };
  if (extension === "html") return { token: "<>", category: "code", label: "HTML" };
  if (["css", "scss"].includes(extension)) return { token: "#", category: "code", label: "CSS" };
  if (extension === "go") return { token: "GO", category: "code", label: "Go" };
  return { token: "▤", category: "text", label: t("plainText") };
}

async function invoke<T>(method: string, params: Record<string, unknown>, timeoutMs = 30000): Promise<T> {
  if (!bridge) throw new Error(t("hostMissing"));
  return bridge.invoke<T>(method, params, { timeoutMs });
}

function applyLocale() {
  document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
  applyEditorTypography();
  document.querySelectorAll<HTMLElement>("[data-i18n]").forEach((node) => {
    const key = node.dataset.i18n as keyof typeof strings.en;
    if (key in strings.en) node.textContent = t(key);
  });
  element("workspace-name").textContent = workspace?.name ?? t("noFolder");
  element("folder-path").textContent = workspace?.path ?? t("startHint");
  element("refresh-tree").setAttribute("title", t("refresh"));
  element("refresh-tree").setAttribute("aria-label", t("refresh"));
  for (const [id, key] of [
    ["quick-open", "findFileByName"], ["find-file", "findFileByName"],
    ["search-project", "searchProject"], ["project-search-submit", "searchProject"],
    ["expand-all-folders", "expandAllFolders"], ["collapse-all-folders", "collapseAllFolders"],
    ["toggle-sidebar", "toggleProjectPanel"], ["command-palette", "commandPalette"],
    ["find-in-file", "findInFile"], ["close-active-tab", "closeFile"],
    ["open-folder", "openFolder"], ["workspace-switcher", "openFolder"],
    ["open-file", "openFile"], ["file-encoding", "selectEncoding"],
    ["new-file", "newFile"], ["new-folder", "newFolder"], ["toggle-theme", "toggleTheme"],
    ["new-temporary-file", "newTemporaryFile"],
    ["toggle-bottom-panel", "toggleBottomPanel"], ["file-type", "selectLanguage"],
    ["editor-font", "selectFont"], ["font-size-decrease", "decreaseFontSize"],
    ["font-size-increase", "increaseFontSize"], ["editor-font-size", "resetFontSize"],
    ["close-bottom-panel", "closeBottomPanel"],
    ["toggle-markdown-preview", "previewMarkdown"],
    ["close-markdown-preview", "closeMarkdownPreview"]
  ] as const) {
    element(id).setAttribute("title", t(key));
    element(id).setAttribute("aria-label", t(key));
  }
  element("notice-close").setAttribute("aria-label", t("dismiss"));
  element("notice-close").setAttribute("title", t("dismiss"));
  element("explorer").setAttribute("aria-label", t("projectFiles"));
  element("menu-bar").setAttribute("aria-label", t("editorMenu"));
  element("editor-pane").setAttribute("aria-label", t("editorRegion"));
  element("bottom-panel").setAttribute("aria-label", t("bottomPanelRegion"));
  element("sidebar-resizer").setAttribute("aria-label", t("resizeProjectPanel"));
  element("markdown-preview").setAttribute("aria-label", t("previewMarkdown"));
  element<HTMLInputElement>("project-search-input").placeholder = t("searchProjectText");
  element<HTMLInputElement>("project-search-input").setAttribute("aria-label", t("searchProjectText"));
  element("project-search-panel").setAttribute("aria-label", t("searchProject"));
  if (!element("tree-progress").hidden) element("tree-progress").textContent = t("expandingFolders");
  element("close-active-tab").setAttribute("title", `${t("closeFile")} (Ctrl+Alt+W)`);
  element("new-temporary-file").setAttribute("title", `${t("newTemporaryFile")} (⌘⌥N / Ctrl+Alt+N)`);
  const fontModifier = navigator.platform.toLowerCase().includes("mac") ? "⌘⌥" : "Ctrl+Alt+";
  element("font-size-increase").setAttribute("title", `${t("increaseFontSize")} (${fontModifier}=)`);
  element("font-size-decrease").setAttribute("title", `${t("decreaseFontSize")} (${fontModifier}-)`);
  element("editor-font-size").setAttribute("title", `${t("resetFontSize")} (${fontModifier}0)`);
  element("welcome-title").textContent = workspace ? t("chooseTitle") : t("welcomeTitle");
  element("welcome-description").textContent = workspace ? t("chooseDescription") : t("welcomeDescription");
  element("create-modal-title").textContent = createMode === "saveAs" ? t("saveAs") : t(createKind === "file" ? "newFile" : "newFolder");
  updateStatus();
  renderTree();
  renderTabs();
  renderBreadcrumbs();
  renderWelcome();
  syncMarkdownPreview();
  renderProjectSearchResults();
  renderBottomPanel();
  if (openMenu) renderMenu(openMenu);
  if (!element("palette").hidden) renderPalette();
}

function applyTheme() {
  document.documentElement.dataset.appearance = themePreference;
  element("toggle-theme").textContent = themePreference === "dark" ? "☀" : "☾";
  const modifier = navigator.platform.toLowerCase().includes("mac") ? "⌘" : "Ctrl";
  document.querySelectorAll<HTMLElement>(".mod-key").forEach((key) => { key.textContent = modifier; });
  element("quick-open-shortcut").textContent = modifier === "⌘" ? "⌘ P" : "Ctrl+P";
  const shortcuts = modifier === "⌘" ? ["⌘ ⌥ N", "⌘ O", "⌘ ⇧ P"] : ["Ctrl+Alt+N", "Ctrl+O", "Ctrl+Shift+P"];
  document.querySelectorAll<HTMLElement>(".mod-shortcut").forEach((key, index) => { key.textContent = shortcuts[index]; });
}

function showNotice(message: string, actionLabel?: string, action?: () => void) {
  element("notice-text").textContent = message;
  const actionButton = element<HTMLButtonElement>("notice-action");
  actionButton.hidden = !action;
  actionButton.textContent = actionLabel ?? "";
  actionButton.onclick = action ? () => action() : null;
  element("notice").hidden = false;
}

function hideNotice() {
  element("notice").hidden = true;
  element<HTMLButtonElement>("notice-action").onclick = null;
}

function activeTab(): EditorTab | null {
  return tabs.find((tab) => tab.path === activePath) ?? null;
}

function draftId(tab: EditorTab): string { return tab.path.slice("untitled:".length); }

function newDraftId(): string {
  const browserCrypto: Partial<Crypto> | undefined = globalThis.crypto;
  if (typeof browserCrypto?.randomUUID === "function") return browserCrypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (typeof browserCrypto?.getRandomValues === "function") browserCrypto.getRandomValues(bytes);
  else for (let index = 0; index < bytes.length; index++) bytes[index] = Math.floor(Math.random() * 256);
  return `${Date.now().toString(16)}-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function draftSnapshot(tab: EditorTab): DraftRecord {
  return {
    id: draftId(tab), name: tab.name, content: tab.content, languageId: tab.languageId,
    languageAuto: tab.languageAuto, selection: tab.selection, scrollTop: tab.scrollTop, updatedAt: Date.now()
  };
}

function pumpDraft(id: string, queue: DraftQueue) {
  if (queue.running || queue.discarded || !queue.latest || !bridge) return;
  queue.running = (async () => {
    await bridge.ready;
    while (queue.latest && !queue.discarded) {
      const snapshot = queue.latest;
      queue.latest = null;
      try {
        await invoke("draft/save", snapshot as unknown as Record<string, unknown>);
        const tab = tabs.find((item) => item.untitled && draftId(item) === id);
        if (tab && !queue.latest && tab.content === snapshot.content && tab.languageId === snapshot.languageId) {
          tab.draftPersisted = true;
          tab.draftError = false;
          if (tab === activeTab()) updateStatus();
        }
        draftErrorShown = false;
      } catch (error) {
        const tab = tabs.find((item) => item.untitled && draftId(item) === id);
        if (tab) {
          tab.draftError = true;
          if (tab === activeTab()) updateStatus();
        }
        if (!draftErrorShown) {
          showNotice(`${t("draftSaveFailed")}: ${String(error instanceof Error ? error.message : error)}`);
          draftErrorShown = true;
        }
      }
    }
  })().catch((error) => {
    const tab = tabs.find((item) => item.untitled && draftId(item) === id);
    if (tab) {
      tab.draftError = true;
      if (tab === activeTab()) updateStatus();
    }
    if (!draftErrorShown) {
      showNotice(`${t("draftSaveFailed")}: ${String(error instanceof Error ? error.message : error)}`);
      draftErrorShown = true;
    }
  }).finally(() => {
    queue.running = null;
    if (queue.latest && !queue.discarded) pumpDraft(id, queue);
  });
}

function queueDraftSave(tab: EditorTab) {
  if (!tab.untitled || !tabs.includes(tab) || !bridge) return;
  tab.draftPersisted = false;
  tab.draftError = false;
  const id = draftId(tab);
  let queue = draftQueues.get(id);
  if (!queue) {
    queue = { latest: null, running: null, discarded: false };
    draftQueues.set(id, queue);
  }
  queue.latest = draftSnapshot(tab);
  pumpDraft(id, queue);
  if (tab === activeTab()) updateStatus();
}

function queuePreferencesSave() {
  if (!bridge) return;
  const session: SavedSession = workspace ? {
    workspacePath: workspace.path, singleFile: Boolean(workspace.singleFile),
    openFiles: tabs.filter((tab) => !tab.untitled).slice(0, 12).map((tab) => tab.path),
    activeFile: activeTab()?.untitled ? "" : activePath ?? "",
    activeDraft: activeTab()?.untitled ? draftId(activeTab()!) : ""
  } : { workspacePath: "", singleFile: false, openFiles: [], activeFile: "", activeDraft: activeTab()?.untitled ? draftId(activeTab()!) : "" };
  const snapshot = { recentFolders: [...recentFolders], recentFiles: [...recentFiles], recentPositions: [...recentPositions], session, theme: themePreference, editorFont: editorFontPreference, editorFontSize };
  preferenceWrite = preferenceWrite.catch(() => {}).then(async () => {
    await bridge.ready;
    await invoke("preferences/save", snapshot);
  }).catch((error) => {
    showNotice(`${t("preferencesSaveFailed")}: ${String(error instanceof Error ? error.message : error)}`);
  });
}

async function deleteDraft(id: string) {
  const queue = draftQueues.get(id);
  if (queue) {
    queue.discarded = true;
    queue.latest = null;
    await queue.running;
    draftQueues.delete(id);
  }
  await invoke("draft/delete", { id });
}

async function restoreDrafts() {
  const drafts: DraftRecord[] = [];
  let unreadable = 0;
  let after = "";
  do {
    const page = await invoke<{ ids: string[]; next: string }>("draft/list", { after });
    for (let index = 0; index < page.ids.length; index += 8) {
      const loaded = await Promise.all(page.ids.slice(index, index + 8).map((id) =>
        invoke<DraftRecord>("draft/read", { id }).catch(() => null)
      ));
      unreadable += loaded.filter((item) => item === null).length;
      drafts.push(...loaded.filter((item): item is DraftRecord => item !== null));
    }
    after = page.next;
  } while (after);
  drafts.sort((a, b) => a.updatedAt - b.updatedAt);
  const existing = new Set(tabs.filter((tab) => tab.untitled).map((tab) => draftId(tab)));
  let latest: EditorTab | null = null;
  for (const draft of drafts) {
    if (!draft || typeof draft.id !== "string" || existing.has(draft.id) || typeof draft.name !== "string" || typeof draft.content !== "string") continue;
    const tab: EditorTab = {
      name: draft.name, path: `untitled:${draft.id}`, content: draft.content, savedContent: "", revision: "",
      dirty: draft.content.length > 0, selection: Math.max(0, Math.min(draft.selection || 0, draft.content.length)),
      scrollTop: Math.max(0, draft.scrollTop || 0), untitled: true, languageId: normalizeLanguageId(draft.languageId),
      languageAuto: Boolean(draft.languageAuto), draftPersisted: true, draftError: false
    };
    tabs.push(tab);
    latest = tab;
    existing.add(draft.id);
    const count = /-(\d+)$/.exec(draft.name);
    if (count) untitledCount = Math.max(untitledCount, Number(count[1]));
  }
  if (!activePath && latest) activePath = latest.path;
  renderTabs();
  renderTree();
  renderEditor();
  if (unreadable) showNotice(`${t("draftRestoreFailed")}: ${unreadable}`);
}

function updateStatus() {
  const tab = activeTab();
  const status = element("save-state");
  status.textContent = busy ? t("saving") : tab?.untitled ?
    (tab.draftError ? t("draftSaveFailed") : tab.draftPersisted ? t("draftSaved") : t("draftSaving")) :
    tab ? (tab.dirty ? t("unsaved") : t("saved")) : t("ready");
  element("file-type").textContent = tab ? languageLabel(tab.languageId) : t("plainText");
  element<HTMLButtonElement>("file-type").disabled = !tab;
  element("file-encoding").textContent = (tab?.encoding ?? "utf-8").toUpperCase().replace("UTF-8-BOM", "UTF-8 BOM");
  element<HTMLButtonElement>("file-encoding").disabled = !tab || Boolean(tab.untitled);
  element("save-file").hidden = !tab;
  element("save-file").toggleAttribute("disabled", !tab || (!tab.dirty && !tab.untitled) || busy);
  element("find-in-file").toggleAttribute("disabled", !tab);
  element("close-active-tab").toggleAttribute("disabled", !tab);
  element("refresh-tree").toggleAttribute("disabled", !workspace);
  element("search-project").toggleAttribute("disabled", !workspace);
  element("expand-all-folders").toggleAttribute("disabled", !workspace || Boolean(workspace.singleFile));
  element("collapse-all-folders").toggleAttribute("disabled", !workspace || Boolean(workspace.singleFile));
  element("new-file").toggleAttribute("disabled", !workspace || Boolean(workspace.singleFile));
  element("new-folder").toggleAttribute("disabled", !workspace || Boolean(workspace.singleFile));
  element("quick-open-label").textContent = workspace ? t("goToFile") : t("openFolder");
  element("welcome-open-label").textContent = t("openFolder");
  element("workspace-name").textContent = workspace?.name ?? t("noFolder");
  element("folder-path").textContent = workspace?.path ?? t("startHint");
  document.querySelector(".status-light")?.classList.toggle("dirty", Boolean(tab?.dirty));
  if (editor && tab) {
    const position = editor.state.doc.lineAt(editor.state.selection.main.head);
    element("cursor-position").textContent = `${t("line")} ${position.number}, ${t("column")} ${editor.state.selection.main.head - position.from + 1}`;
  } else {
    element("cursor-position").textContent = `${t("line")} 1, ${t("column")} 1`;
  }
}

function renderBreadcrumbs() {
  const container = element("breadcrumbs");
  container.replaceChildren();
  const tab = activeTab();
  if (!tab) {
    const label = document.createElement("span");
    label.textContent = t("noFileSelected");
    container.append(label);
    return;
  }
  if (tab.untitled) {
    const label = document.createElement("span");
    label.className = "current";
    label.textContent = tab.name;
    container.append(label);
    return;
  }
  const parts = [workspace?.name ?? "", ...tab.path.split("/")].filter(Boolean);
  parts.forEach((part, index) => {
    if (index) {
      const separator = document.createElement("span");
      separator.className = "separator";
      separator.textContent = "/";
      container.append(separator);
    }
    const segment = document.createElement("span");
    segment.textContent = part;
    if (index === parts.length - 1) segment.className = "current";
    container.append(segment);
  });
}

function renderWelcome() {
  const visible = !activeTab();
  element("welcome").hidden = !visible;
  element("editor-content").hidden = visible;
  element("welcome-title").textContent = workspace ? t("chooseTitle") : t("welcomeTitle");
  element("welcome-description").textContent = workspace ? t("chooseDescription") : t("welcomeDescription");
  element("welcome-recent").hidden = recentFolders.length === 0;
  element("welcome-recent-files").hidden = recentFiles.length === 0;
  const container = element("recent-folders");
  container.replaceChildren();
  for (const path of recentFolders) {
    const button = document.createElement("button");
    button.type = "button";
    button.title = path;
    button.textContent = path;
    button.onclick = () => { void openWorkspace(path).catch((error) => showNotice(`${t("openFailed")}: ${String(error)}`)); };
    container.append(button);
  }
  const files = element("recent-files");
  files.replaceChildren();
  for (const path of recentFiles) {
    const button = document.createElement("button");
    button.type = "button";
    button.title = path;
    button.textContent = path;
    button.onclick = () => { void openWorkspace(path, true).catch((error) => showNotice(`${t("readFailed")}: ${String(error)}`)); };
    files.append(button);
  }
}

function renderOpenEditors() {
  element("open-editors-section").hidden = tabs.length === 0;
  const list = element("open-editors");
  list.replaceChildren();
  for (const tab of tabs) {
    const item = document.createElement("div");
    item.className = "open-editor-item";
    const row = document.createElement("button");
    row.type = "button";
    row.className = "open-editor-row" + (tab.path === activePath ? " active" : "");
    row.title = tab.untitled ? tab.name : tab.path;
    const kind = fileKind(tab.name);
    const token = document.createElement("span");
    token.className = `file-token ${kind.category}`;
    token.textContent = kind.token;
    const label = document.createElement("span");
    label.className = "open-editor-name";
    label.textContent = tab.name;
    row.append(token, label);
    if (tab.dirty) {
      const dot = document.createElement("span");
      dot.className = "tab-dirty";
      row.append(dot);
    }
    row.onclick = () => activateTab(tab.path);
    const close = document.createElement("button");
    close.type = "button";
    close.className = "open-editor-close";
    close.textContent = "×";
    close.title = t("closeFile") + ": " + tab.name;
    close.setAttribute("aria-label", close.title);
    close.onclick = () => { void closeTab(tab); };
    item.append(row, close);
    list.append(item);
  }
}

function renderTree() {
  renderOpenEditors();
  const root = element("tree-root");
  const focusedPath = (document.activeElement as HTMLElement | null)?.dataset.path;
  root.replaceChildren();
  if (!workspace) {
    const empty = document.createElement("div");
    empty.className = "tree-empty";
    empty.textContent = t("startHint");
    const action = document.createElement("button");
    action.type = "button";
    action.className = "tree-empty-action";
    action.textContent = t("openFolder");
    action.onclick = () => { void chooseFolder(); };
    empty.append(action);
    root.append(empty);
    return;
  }
  if (tree.length === 0) {
    const empty = document.createElement("div");
    empty.className = "tree-empty";
    empty.textContent = t("emptyFolder");
    root.append(empty);
    return;
  }
  const append = (nodes: TreeNode[], depth: number, parent: HTMLElement) => {
    for (const node of nodes) {
      const branch = document.createElement("div");
      branch.className = "tree-node";
      branch.setAttribute("role", "none");
      const row = document.createElement("button");
      row.type = "button";
      row.dataset.path = node.path;
      row.setAttribute("role", "treeitem");
      row.setAttribute("aria-level", String(depth + 1));
      if (node.kind === "directory") row.setAttribute("aria-expanded", String(Boolean(node.expanded)));
      row.className = `tree-row ${node.kind} ${node.expanded ? "expanded" : ""} ${activePath === node.path ? "active" : ""}`;
      row.title = node.kind === "symlink" ? t("symlink") : node.kind === "directory" ? `${node.path}\n${t("recursiveFolderHint")}` : node.path;
      const caret = document.createElement("span");
      caret.className = "tree-caret";
      caret.textContent = node.kind === "directory" ? (node.loading ? "…" : node.expanded ? "▾" : "▸") : "";
      const token = document.createElement("span");
      const kind = fileKind(node.name);
      token.className = `file-token ${node.kind === "directory" ? "folder" : kind.category}`;
      if (node.kind === "directory") {
        const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        icon.setAttribute("viewBox", "0 0 20 20");
        icon.setAttribute("aria-hidden", "true");
        const outline = document.createElementNS("http://www.w3.org/2000/svg", "path");
        outline.setAttribute("d", "M2.5 5.5h5.2l1.7 1.8h8.1v8.6a1.2 1.2 0 0 1-1.2 1.2H3.7a1.2 1.2 0 0 1-1.2-1.2z");
        icon.append(outline);
        token.append(icon);
      } else token.textContent = kind.token;
      const label = document.createElement("span");
      label.className = "tree-name";
      label.textContent = node.name;
      row.append(caret, token, label);
      row.onclick = (event) => {
        if (node.kind === "directory" && event.altKey) {
          if (node.expanded) collapseFolders([node]);
          else void expandFolders([node]);
        } else if (node.kind === "directory") void toggleDirectory(node);
        else if (node.kind === "file") void openFile(node);
      };
      row.onkeydown = (event) => {
        const rows = Array.from(root.querySelectorAll<HTMLButtonElement>(".tree-row:not(.symlink)"));
        const index = rows.indexOf(row);
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          rows[Math.max(0, Math.min(rows.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)))]?.focus();
        } else if (event.key === "ArrowRight" && node.kind === "directory") {
          event.preventDefault();
          if (!node.expanded) void toggleDirectory(node);
          else rows[index + 1]?.focus();
        } else if (event.key === "ArrowLeft") {
          event.preventDefault();
          if (node.kind === "directory" && node.expanded) void toggleDirectory(node);
          else rows.find((candidate) => candidate.dataset.path === node.path.split("/").slice(0, -1).join("/"))?.focus();
        }
      };
      branch.append(row);
      parent.append(branch);
      if (node.kind === "directory" && node.expanded && node.children?.length) {
        const children = document.createElement("div");
        children.className = "tree-children";
        children.setAttribute("role", "group");
        branch.append(children);
        append(node.children, depth + 1, children);
      }
    }
  };
  append(tree, 0, root);
  if (focusedPath) Array.from(root.querySelectorAll<HTMLButtonElement>(".tree-row")).find((row) => row.dataset.path === focusedPath)?.focus({ preventScroll: true });
}

async function toggleDirectory(node: TreeNode) {
  treeExpansionSequence++;
  element("tree-progress").hidden = true;
  if (node.expanded) {
    node.expanded = false;
    renderTree();
    return;
  }
  node.expanded = true;
  const currentWorkspace = workspace;
  if (!node.children && currentWorkspace) {
    node.loading = true;
    renderTree();
    try {
      const result = await invoke<{ entries: Entry[] }>("workspace/list", { workspaceId: currentWorkspace.workspaceId, path: node.path });
      if (workspace !== currentWorkspace) return;
      node.children = result.entries;
    } catch (error) {
      node.expanded = false;
      showNotice(String(error instanceof Error ? error.message : error));
    } finally {
      node.loading = false;
    }
  }
  renderTree();
}

function collapseFolders(nodes: TreeNode[] = tree) {
  treeExpansionSequence++;
  const collapse = (items: TreeNode[]) => {
    for (const node of items) {
      node.expanded = false;
      if (node.children) collapse(node.children);
    }
  };
  collapse(nodes);
  element("tree-progress").hidden = true;
  renderTree();
}

async function expandFolders(nodes: TreeNode[] = tree) {
  const currentWorkspace = workspace;
  if (!currentWorkspace || currentWorkspace.singleFile) return;
  const sequence = ++treeExpansionSequence;
  const pending = nodes.filter((node) => node.kind === "directory");
  let processed = 0;
  let visibleRows = nodes.length;
  element("tree-progress").textContent = t("expandingFolders");
  element("tree-progress").hidden = false;
  try {
    while (pending.length && processed < 800 && visibleRows < 8000 && workspace === currentWorkspace && sequence === treeExpansionSequence) {
      const node = pending.shift()!;
      node.expanded = true;
      if (!node.children) {
        try {
          const result = await invoke<{ entries: Entry[] }>("workspace/list", { workspaceId: currentWorkspace.workspaceId, path: node.path });
          if (workspace !== currentWorkspace || sequence !== treeExpansionSequence) return;
          node.children = result.entries;
        } catch {
          node.expanded = false;
          continue;
        }
      }
      visibleRows += node.children.length;
      pending.push(...node.children.filter((child) => child.kind === "directory"));
      processed++;
      if (processed % 24 === 0) renderTree();
    }
    if (workspace === currentWorkspace && sequence === treeExpansionSequence) {
      renderTree();
      if (pending.length) showNotice(t("expandLimit"));
    }
  } finally {
    if (sequence === treeExpansionSequence) element("tree-progress").hidden = true;
  }
}

function renderTabs() {
  renderOpenEditors();
  const container = element("tabs");
  container.replaceChildren();
  for (const tab of tabs) {
    const item = document.createElement("div");
    item.className = `tab ${tab.path === activePath ? "active" : ""}`;
    item.setAttribute("role", "tab");
    item.setAttribute("aria-selected", String(tab.path === activePath));
    item.tabIndex = 0;
    item.title = tab.untitled ? tab.name : tab.path;
    const kind = fileKind(tab.name);
    const token = document.createElement("span");
    token.className = `file-token ${kind.category}`;
    token.textContent = kind.token;
    const label = document.createElement("span");
    label.className = "tab-label";
    label.textContent = tab.name;
    item.append(token, label);
    if (tab.dirty) {
      const dot = document.createElement("span");
      dot.className = "tab-dirty";
      item.append(dot);
    }
    const close = document.createElement("button");
    close.className = "tab-close";
    close.type = "button";
    close.textContent = "×";
    close.setAttribute("aria-label", t("closeFile") + ": " + tab.name);
    close.title = t("closeFile") + ": " + tab.name;
    close.onclick = (event) => { event.stopPropagation(); void closeTab(tab); };
    item.append(close);
    item.onclick = () => activateTab(tab.path);
    item.onkeydown = (event) => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); activateTab(tab.path); }
    };
    container.append(item);
  }
  updateStatus();
}

function rememberEditorPosition() {
  if (editor && editorTab) {
    editorTab.state = editor.state;
    editorTab.selection = editor.state.selection.main.head;
    editorTab.scrollTop = editor.scrollDOM.scrollTop;
    if (editorTab.untitled && tabs.includes(editorTab)) queueDraftSave(editorTab);
    else rememberFilePosition(editorTab);
  }
}

function renderEditor(resetState = false) {
  if (!resetState) rememberEditorPosition();
  editor?.destroy();
  editor = null;
  editorTab = activeTab();
  element("editor-surface").replaceChildren();
  renderWelcome();
  renderBreadcrumbs();
  const tab = editorTab;
  if (!tab) { syncMarkdownPreview(); updateStatus(); return; }
  if (resetState) tab.state = undefined;
  editor = new EditorView({
    state: tab.state ?? EditorState.create({
      doc: tab.content,
      selection: { anchor: Math.min(tab.selection, tab.content.length) },
      extensions: [
        basicSetup,
        keymap.of([indentWithTab]),
        languageCompartment.of(languageExtension(tab.languageId)),
        syntaxHighlighting(highlight),
        editorTheme,
        wrapCompartment.of(wordWrap ? EditorView.lineWrapping : []),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            const wasDirty = tab.dirty;
            tab.content = update.state.doc.toString();
            tab.dirty = tab.content !== tab.savedContent;
            if (tab.languageAuto && languageFromName(tab.name) === "plain") {
              const detected = detectLanguage(tab.name, tab.content);
              if (detected !== tab.languageId) {
                tab.languageId = detected;
                queueMicrotask(() => {
                  if (editorTab === tab && editor) {
                    editor.dispatch({ effects: languageCompartment.reconfigure(languageExtension(detected)) });
                    void loadLanguageFor(tab);
                    syncMarkdownPreview();
                  }
                });
              }
            }
            if (wasDirty !== tab.dirty) renderTabs();
            if (tab.preview) queueMarkdownPreview(tab);
          }
          if (update.selectionSet || update.docChanged) {
            tab.selection = update.state.selection.main.head;
            tab.scrollTop = update.view.scrollDOM.scrollTop;
            if (tab.untitled) queueDraftSave(tab);
            else rememberFilePosition(tab);
            updateStatus();
          }
        })
      ]
    }),
    parent: element("editor-surface")
  });
  applyEditorTypography();
  const restoredScrollTop = tab.scrollTop;
  let restoringPosition = restoredScrollTop > 0;
  editor.scrollDOM.scrollTop = restoredScrollTop;
  editor.scrollDOM.addEventListener("scroll", () => {
    if (editorTab !== tab || !editor || restoringPosition) return;
    tab.scrollTop = editor.scrollDOM.scrollTop;
    if (tab.untitled) queueDraftSave(tab);
    else rememberFilePosition(tab);
  }, { passive: true });
  if (restoringPosition) requestAnimationFrame(() => {
    if (editorTab === tab && editor) editor.scrollDOM.scrollTop = restoredScrollTop;
    requestAnimationFrame(() => { restoringPosition = false; });
  });
  void loadLanguageFor(tab);
  syncMarkdownPreview();
  editor.focus();
  updateStatus();
}

function activateTab(path: string, remember = true) {
  if (remember) tabCycleOrder = null;
  if (activePath === path) { editor?.focus(); return; }
  activePath = path;
  if (remember) recentTabs = [path, ...recentTabs.filter((item) => item !== path)];
  renderTabs();
  renderTree();
  renderEditor();
  queuePreferencesSave();
  void checkExternalChange();
}

function newUntitledTab() {
  untitledCount += 1;
  const path = `untitled:${newDraftId()}`;
  const tab: EditorTab = {
    name: `${t("untitled")}-${untitledCount}`, path, content: "", savedContent: "", revision: "",
    dirty: false, selection: 0, scrollTop: 0, untitled: true, languageId: "plain", languageAuto: true,
    draftPersisted: false, draftError: false
  };
  tabs.push(tab);
  activePath = path;
  recentTabs = [path, ...recentTabs.filter((item) => item !== path)];
  renderTabs();
  renderTree();
  renderEditor();
  queueDraftSave(tab);
  queuePreferencesSave();
}

interface ReadDocumentResult { content: string; revision: string; encoding: string }

async function readDocument(currentWorkspace: Workspace, path: string, encoding = ""): Promise<ReadDocumentResult> {
  const result = await invoke<ReadDocumentResult & { readId?: string; chunks?: number }>("workspace/read", {
    workspaceId: currentWorkspace.workspaceId, path, encoding
  }, 120000);
  if (!result.readId) return result;
  const pieces: string[] = [];
  try {
    for (let index = 0; index < (result.chunks ?? 0); index++) {
      const part = await invoke<{ content: string }>("workspace/readChunk", {
        workspaceId: currentWorkspace.workspaceId, readId: result.readId, index
      }, 120000);
      pieces.push(part.content);
    }
    return { content: pieces.join(""), revision: result.revision, encoding: result.encoding };
  } finally {
    void invoke("workspace/readEnd", { workspaceId: currentWorkspace.workspaceId, readId: result.readId }).catch(() => {});
  }
}

async function saveDocument(currentWorkspace: Workspace, tab: EditorTab, content: string): Promise<{ revision: string }> {
  const params = { workspaceId: currentWorkspace.workspaceId, path: tab.path, expectedRevision: tab.revision, encoding: tab.encoding ?? "" };
  if (new TextEncoder().encode(content).length <= 512 * 1024) {
    return invoke<{ revision: string }>("workspace/save", { ...params, content }, 120000);
  }
  const { saveId } = await invoke<{ saveId: string }>("workspace/saveStart", params, 120000);
  for (let offset = 0; offset < content.length;) {
    let end = Math.min(offset + 65536, content.length);
    if (end < content.length && /[\uD800-\uDBFF]/.test(content[end - 1])) end--;
    await invoke("workspace/saveChunk", { workspaceId: currentWorkspace.workspaceId, saveId, content: content.slice(offset, end) }, 120000);
    offset = end;
  }
  return invoke<{ revision: string }>("workspace/saveCommit", { workspaceId: currentWorkspace.workspaceId, saveId }, 120000);
}

async function openFile(node: Entry, encoding = "") {
  if (!workspace) return;
  if (tabs.some((tab) => tab.path === node.path)) {
    activateTab(node.path);
    return;
  }
  const currentWorkspace = workspace;
  try {
    const result = await readDocument(currentWorkspace, node.path, encoding);
    if (workspace !== currentWorkspace) return;
    if (tabs.some((tab) => tab.path === node.path)) { activateTab(node.path); return; }
    const absolutePath = currentWorkspace.singleFile ? currentWorkspace.path : currentWorkspace.path.replace(/\/$/, "") + "/" + node.path;
    const position = recentPositions.find((item) => item.path === absolutePath);
    tabs.push({ name: node.name, path: node.path, content: result.content, savedContent: result.content, revision: result.revision, encoding: result.encoding, dirty: false, selection: Math.min(position?.selection ?? 0, result.content.length), scrollTop: position?.scrollTop ?? 0, languageId: detectLanguage(node.name, result.content), languageAuto: true });
    activePath = node.path;
    recentTabs = [node.path, ...recentTabs.filter((item) => item !== node.path)];
    hideNotice();
    pendingEncodingEntry = null;
    recentFiles = [absolutePath, ...recentFiles.filter((item) => item !== absolutePath)].slice(0, 8);
    queuePreferencesSave();
    renderTabs();
    renderTree();
    renderEditor();
  } catch (error) {
    const message = String(error instanceof Error ? error.message : error);
    const chooseEncoding = /encoding|UTF-8|binary/i.test(message);
    showNotice(`${t("readFailed")}: ${message}`, chooseEncoding ? t("selectEncoding") : undefined, chooseEncoding ? () => {
      pendingEncodingEntry = node;
      showPalette("encodings");
    } : undefined);
  }
}

async function saveActive() {
  const tab = activeTab();
  const currentWorkspace = workspace;
  if (!tab || (!tab.dirty && !tab.untitled) || busy) return;
  if (tab.untitled) { saveUntitled(tab); return; }
  if (!currentWorkspace) return;
  const snapshot = tab.content;
  busy = true;
  updateStatus();
  try {
    const result = await saveDocument(currentWorkspace, tab, snapshot);
    if (workspace !== currentWorkspace) return;
    tab.revision = result.revision;
    tab.savedContent = snapshot;
    tab.dirty = tab.content !== snapshot;
    hideNotice();
    renderTabs();
  } catch (error) {
    showNotice(`${t("saveFailed")}: ${error instanceof Error ? error.message : error}`, t("reload"), () => { void reloadActive(); });
  } finally {
    busy = false;
    updateStatus();
  }
}

async function checkExternalChange() {
  const tab = activeTab();
  const currentWorkspace = workspace;
  if (!tab || tab.untitled || !currentWorkspace) return;
  try {
    const result = await readDocument(currentWorkspace, tab.path, tab.encoding);
    if (workspace !== currentWorkspace || activeTab() !== tab || result.revision === tab.revision) return;
    if (tab.dirty) {
      showNotice(t("fileChanged"), t("reload"), () => { void reloadActive(); });
      return;
    }
    tab.content = result.content;
    tab.savedContent = result.content;
    tab.revision = result.revision;
    tab.encoding = result.encoding;
    tab.selection = Math.min(tab.selection, result.content.length);
    renderEditor(true);
    showNotice(t("diskUpdated"));
  } catch {
    // A failed background check should not interrupt the current draft.
  }
}

async function reloadActive() {
  const tab = activeTab();
  const currentWorkspace = workspace;
  if (!tab || tab.untitled || !currentWorkspace) return;
  if (tab.dirty && !(await confirmDiscard(interpolate(t("confirmReload"), tab.name)))) return;
  if (workspace !== currentWorkspace || activeTab() !== tab) return;
  try {
    const result = await readDocument(currentWorkspace, tab.path, tab.encoding);
    if (workspace !== currentWorkspace || activeTab() !== tab) return;
    tab.content = result.content;
    tab.savedContent = result.content;
    tab.revision = result.revision;
    tab.encoding = result.encoding;
    tab.dirty = false;
    tab.selection = 0;
    tab.scrollTop = 0;
    hideNotice();
    renderTabs();
    renderEditor(true);
  } catch (error) {
    showNotice(`${t("readFailed")}: ${error instanceof Error ? error.message : error}`);
  }
}

async function reopenWithEncoding(encoding: string) {
  const tab = activeTab();
  const currentWorkspace = workspace;
  if (!tab || tab.untitled || !currentWorkspace) return;
  if (tab.dirty && !(await confirmDiscard(interpolate(t("confirmReload"), tab.name)))) return;
  if (workspace !== currentWorkspace || activeTab() !== tab) return;
  try {
    const result = await readDocument(currentWorkspace, tab.path, encoding);
    if (workspace !== currentWorkspace || activeTab() !== tab) return;
    tab.content = result.content;
    tab.savedContent = result.content;
    tab.revision = result.revision;
    tab.encoding = result.encoding;
    tab.dirty = false;
    tab.selection = 0;
    tab.scrollTop = 0;
    hideNotice();
    renderTabs();
    renderEditor(true);
  } catch (error) {
    showNotice(`${t("readFailed")}: ${String(error instanceof Error ? error.message : error)}`);
  }
}

async function closeTab(tab: EditorTab) {
  if (tab.dirty && !(await confirmDiscard(interpolate(t(tab.untitled ? "confirmCloseTemp" : "confirmClose"), tab.name)))) return;
  const index = tabs.indexOf(tab);
  if (index < 0) return;
  if (tab.untitled) {
    try {
      await deleteDraft(draftId(tab));
    } catch (error) {
      showNotice(`${t("draftDeleteFailed")}: ${String(error instanceof Error ? error.message : error)}`);
      return;
    }
  }
  tabs.splice(index, 1);
  recentTabs = recentTabs.filter((path) => path !== tab.path);
  if (activePath === tab.path) {
    activePath = tabs[Math.min(index, tabs.length - 1)]?.path ?? null;
    if (activePath) recentTabs = [activePath, ...recentTabs.filter((path) => path !== activePath)];
    renderEditor();
  }
  renderTabs();
  renderTree();
  queuePreferencesSave();
}

async function openWorkspace(path: string, singleFile = false) {
  const sequence = ++workspaceOpenSequence;
  const confirmedDrafts = new Map(tabs.filter((tab) => tab.dirty && !tab.untitled).map((tab) => [tab, tab.content]));
  if (confirmedDrafts.size && !(await confirmDiscard(t("confirmFolder")))) return false;
  const previousWorkspace = workspace;
  const next = await invoke<Workspace>(singleFile ? "workspace/openFile" : "workspace/open", { path });
  const closeNext = () => { void invoke("workspace/close", { workspaceId: next.workspaceId }).catch(() => {}); };
  let result: { entries: Entry[] };
  try {
    result = await invoke<{ entries: Entry[] }>("workspace/list", { workspaceId: next.workspaceId, path: "" });
  } catch (error) {
    closeNext();
    throw error;
  }
  if (sequence !== workspaceOpenSequence || workspace !== previousWorkspace) { closeNext(); return false; }
  if (tabs.some((tab) => tab.dirty && !tab.untitled && confirmedDrafts.get(tab) !== tab.content)) {
    if (!(await confirmDiscard(t("confirmFolder")))) { closeNext(); return false; }
  }
  if (sequence !== workspaceOpenSequence || workspace !== previousWorkspace) { closeNext(); return false; }
  rememberEditorPosition();
  editorTab = null;
  if (workspace) void invoke("workspace/close", { workspaceId: workspace.workspaceId }).catch(() => {});
  workspace = next;
  treeExpansionSequence++;
  projectSearchSequence++;
  window.clearTimeout(projectSearchTimer);
  projectSearchResult = null;
  projectSearchQuery = "";
  projectSearchState = "idle";
  element<HTMLInputElement>("project-search-input").value = "";
  element("tree-progress").hidden = true;
  setProjectSearchMode(false);
  renderProjectSearchResults();
  if (!singleFile) recentFolders = [next.path, ...recentFolders.filter((item) => item !== next.path)].slice(0, 8);
  tree = result.entries;
  tabs = tabs.filter((tab) => tab.untitled);
  if (!tabs.some((tab) => tab.path === activePath)) activePath = null;
  recentTabs = recentTabs.filter((path) => tabs.some((tab) => tab.path === path));
  tabCycleOrder = null;
  fileIndex = [];
  fileIndexWorkspaceId = null;
  fileIndexPromise = null;
  fileIndexGeneration += 1;
  fileIndexTruncated = false;
  setSidebarVisible(true);
  hideNotice();
  renderTree();
  renderTabs();
  renderEditor();
  if (singleFile && result.entries[0]) await openFile(result.entries[0]);
  if (bridge?.capabilities?.storage && bridge.storage) {
    void bridge.storage.set("recentFolders", recentFolders).catch(() => {});
  }
  queuePreferencesSave();
  return true;
}

async function restoreSavedSession(saved?: SavedSession) {
  let session = saved;
  if (!session?.workspacePath && recentFiles.length) {
    const path = recentFiles[0];
    const folder = recentFolders.find((item) => path.startsWith(item.replace(/\/$/, "") + "/"));
    session = folder ? {
      workspacePath: folder, singleFile: false,
      openFiles: [path.slice(folder.replace(/\/$/, "").length + 1)],
      activeFile: path.slice(folder.replace(/\/$/, "").length + 1), activeDraft: ""
    } : { workspacePath: path, singleFile: true, openFiles: [], activeFile: "", activeDraft: "" };
  }
  if (!session?.workspacePath) return;
  try {
    const opened = await openWorkspace(session.workspacePath, Boolean(session.singleFile));
    if (!opened || session.singleFile) return;
    for (const path of (Array.isArray(session.openFiles) ? session.openFiles : []).slice(0, 12)) {
      if (typeof path !== "string" || !path || path.startsWith("/") || path.split("/").includes("..")) continue;
      await openFile({ name: path.split("/").pop() ?? path, path, kind: "file", size: 0 });
    }
    if (session.activeFile && tabs.some((tab) => tab.path === session.activeFile)) activateTab(session.activeFile);
  } catch (error) {
    showNotice(`${t("readFailed")}: ${String(error instanceof Error ? error.message : error)}`);
  }
}

async function refreshTree() {
  const currentWorkspace = workspace;
  if (!currentWorkspace) return;
  treeExpansionSequence++;
  element("tree-progress").hidden = true;
  try {
    const result = await invoke<{ entries: Entry[] }>("workspace/list", { workspaceId: currentWorkspace.workspaceId, path: "" });
    if (workspace !== currentWorkspace) return;
    tree = result.entries;
    fileIndex = [];
    fileIndexWorkspaceId = null;
    fileIndexPromise = null;
    fileIndexGeneration += 1;
    fileIndexTruncated = false;
    renderTree();
  } catch (error) {
    showNotice(String(error instanceof Error ? error.message : error));
  }
}

function showFolderModal() {
  element<HTMLInputElement>("folder-input").value = workspace?.path ?? recentFolders[0] ?? "";
  element("folder-error").hidden = true;
  element("folder-modal").hidden = false;
  element<HTMLInputElement>("folder-input").focus();
}

async function chooseFolder() {
  if (!bridge) { showFolderModal(); return; }
  if (nativePickerOpen) return;
  nativePickerOpen = true;
  let selected: { path?: string; cancelled?: boolean; busy?: boolean };
  try {
    selected = await invoke<typeof selected>("workspace/pickFolder", {}, 300000);
  } catch (error) {
    showFolderModal();
    element("folder-error").textContent = String(error instanceof Error ? error.message : error);
    element("folder-error").hidden = false;
    return;
  } finally {
    nativePickerOpen = false;
  }
  if (selected.busy) return;
  try {
    if (selected.cancelled || !selected.path) {
      if (element("folder-modal").hidden) { pendingUntitledSave = false; savingUntitled = null; }
      return;
    }
    const opened = await openWorkspace(selected.path);
    if (opened) {
      const continueSave = pendingUntitledSave;
      hideFolderModal();
      if (continueSave && savingUntitled) showCreateModal("file", "saveAs", savingUntitled);
    } else if (element("folder-modal").hidden) {
      pendingUntitledSave = false;
      savingUntitled = null;
    }
  } catch (error) {
    showFolderModal();
    element("folder-error").textContent = String(error instanceof Error ? error.message : error);
    element("folder-error").hidden = false;
  }
}

async function chooseFile() {
  if (!bridge) { showNotice(t("hostMissing")); return; }
  if (nativePickerOpen) return;
  nativePickerOpen = true;
  let selected: { path?: string; cancelled?: boolean; busy?: boolean };
  try {
    selected = await invoke<typeof selected>("workspace/pickFile", {}, 300000);
  } catch (error) {
    showNotice(`${t("readFailed")}: ${String(error instanceof Error ? error.message : error)}`);
    return;
  } finally {
    nativePickerOpen = false;
  }
  if (selected.busy) return;
  try {
    if (selected.cancelled || !selected.path) return;
    if (workspace && !workspace.singleFile && selected.path.startsWith(workspace.path.replace(/\/$/, "") + "/")) {
      const relative = selected.path.slice(workspace.path.replace(/\/$/, "").length + 1);
      await openFile({ name: relative.split("/").pop() ?? relative, path: relative, kind: "file", size: 0 });
      return;
    }
    await openWorkspace(selected.path, true);
  } catch (error) {
    showNotice(`${t("readFailed")}: ${String(error instanceof Error ? error.message : error)}`);
  }
}

function hideFolderModal() {
  element("folder-modal").hidden = true;
  pendingUntitledSave = false;
}

async function submitFolder() {
  const path = element<HTMLInputElement>("folder-input").value.trim();
  const error = element("folder-error");
  const button = element<HTMLButtonElement>("folder-confirm");
  button.disabled = true;
  try {
    const opened = await openWorkspace(path);
    if (opened) {
      const continueSave = pendingUntitledSave;
      hideFolderModal();
      if (continueSave && savingUntitled) showCreateModal("file", "saveAs", savingUntitled);
    }
  } catch (caught) {
    error.textContent = `${t("openFailed")}: ${caught instanceof Error ? caught.message : caught}`;
    error.hidden = false;
  } finally {
    button.disabled = false;
  }
}

function saveUntitled(tab: EditorTab) {
  savingUntitled = tab;
  if (!workspace || workspace.singleFile) {
    pendingUntitledSave = true;
    void chooseFolder();
    return;
  }
  showCreateModal("file", "saveAs", tab);
}

function showCreateModal(kind: "file" | "directory", mode: "new" | "saveAs" = "new", tab: EditorTab | null = null) {
  if (workspace?.singleFile) { void chooseFolder(); return; }
  if (!workspace) return;
  createKind = kind;
  createMode = mode;
  savingUntitled = tab;
  element("create-modal-title").textContent = mode === "saveAs" ? t("saveAs") : t(kind === "file" ? "newFile" : "newFolder");
  element("create-confirm").textContent = mode === "saveAs" ? t("save") : t("create");
  element("create-error").hidden = true;
  const parent = mode === "new" && activeTab() && !activeTab()?.untitled
    ? activeTab()!.path.split("/").slice(0, -1).join("/") : "";
  const input = element<HTMLInputElement>("create-input");
  input.value = parent ? parent + "/" : "";
  input.placeholder = kind === "directory" ? "src/components" : "src/example.ts";
  element("create-modal").hidden = false;
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}

function hideCreateModal() {
  element("create-modal").hidden = true;
  savingUntitled = null;
}

async function submitCreate() {
  const currentWorkspace = workspace;
  if (!currentWorkspace) return;
  const path = element<HTMLInputElement>("create-input").value.trim();
  const error = element("create-error");
  const button = element<HTMLButtonElement>("create-confirm");
  const tab = createMode === "saveAs" ? savingUntitled : null;
  const content = tab?.content ?? "";
  button.disabled = true;
  try {
    const result = await invoke<{ entry: Entry; revision: string }>("workspace/create", {
      workspaceId: currentWorkspace.workspaceId, path, kind: createKind, content
    });
    if (workspace !== currentWorkspace) return;
    hideCreateModal();
    if (tab && tabs.includes(tab)) {
      const oldPath = tab.path;
      tab.path = result.entry.path;
      tab.name = result.entry.name;
      tab.revision = result.revision;
      tab.savedContent = content;
      tab.dirty = tab.content !== content;
      tab.untitled = false;
      if (tab.languageAuto) tab.languageId = detectLanguage(tab.name, tab.content);
      recentTabs = recentTabs.map((item) => item === oldPath ? tab.path : item);
      if (activePath === oldPath) activePath = tab.path;
      renderTabs();
      renderEditor(true);
      try { await deleteDraft(oldPath.slice("untitled:".length)); }
      catch (error) { showNotice(`${t("draftDeleteFailed")}: ${String(error instanceof Error ? error.message : error)}`); }
    }
    await refreshTree();
    await revealFile(result.entry.path);
    if (createKind === "file" && !tab) await openFile(result.entry);
    if (createKind === "directory") {
      element("tree-root").querySelector<HTMLElement>(`[data-path="${CSS.escape(result.entry.path)}"]`)?.focus();
    }
  } catch (caught) {
    error.textContent = `${t("createFailed")}: ${caught instanceof Error ? caught.message : caught}`;
    error.hidden = false;
  } finally {
    button.disabled = false;
  }
}

function confirmDiscard(message: string): Promise<boolean> {
  const modal = element("confirm-modal");
  element("confirm-modal-message").textContent = message;
  modal.hidden = false;
  element<HTMLButtonElement>("confirm-cancel").focus();
  return new Promise((resolve) => {
    const finish = (answer: boolean) => {
      modal.hidden = true;
      element<HTMLButtonElement>("confirm-discard").onclick = null;
      element<HTMLButtonElement>("confirm-cancel").onclick = null;
      resolve(answer);
    };
    element<HTMLButtonElement>("confirm-discard").onclick = () => finish(true);
    element<HTMLButtonElement>("confirm-cancel").onclick = () => finish(false);
  });
}

function modifierLabel(): string {
  return navigator.platform.toLowerCase().includes("mac") ? "⌘" : "Ctrl+";
}

function setSidebarVisible(visible: boolean) {
  sidebarVisible = visible;
  element("app-shell").classList.toggle("sidebar-hidden", !visible);
  element("toggle-sidebar").setAttribute("aria-pressed", String(visible));
}

function focusExplorer() {
  setSidebarVisible(true);
  const rows = Array.from(element("tree-root").querySelectorAll<HTMLButtonElement>(".tree-row:not(.symlink)"));
  (rows.find((row) => row.dataset.path === activePath) ?? rows[0])?.focus();
}

function toggleWordWrap() {
  wordWrap = !wordWrap;
  const extension = wordWrap ? EditorView.lineWrapping : [];
  editor?.dispatch({ effects: wrapCompartment.reconfigure(extension) });
  for (const tab of tabs) {
    if (tab !== editorTab && tab.state) {
      tab.state = tab.state.update({ effects: wrapCompartment.reconfigure(extension) }).state;
    }
  }
}

function toggleTheme() {
  themePreference = themePreference === "dark" ? "light" : "dark";
  applyTheme();
  if (bridge?.capabilities?.storage && bridge.storage) {
    void bridge.storage.set("editorTheme", themePreference).catch(() => {});
  }
  queuePreferencesSave();
}

function findInFile() {
  if (!editor) return;
  openSearchPanel(editor);
}

function replaceInFile() {
  findInFile();
  requestAnimationFrame(() => editor?.dom.querySelector<HTMLInputElement>('.cm-search input[name="replace"]')?.focus());
}

function selectLanguage(id: LanguageId | "auto") {
  const tab = activeTab();
  if (!tab) return;
  tab.languageAuto = id === "auto";
  tab.languageId = id === "auto" ? detectLanguage(tab.name, tab.content) : id;
  if (editorTab === tab && editor) editor.dispatch({ effects: languageCompartment.reconfigure(languageExtension(tab.languageId)) });
  void loadLanguageFor(tab);
  syncMarkdownPreview();
  updateStatus();
  queueDraftSave(tab);
  editor?.focus();
}

function setBottomPanelVisible(visible: boolean) {
  element("bottom-panel").hidden = !visible;
  element("toggle-bottom-panel").setAttribute("aria-pressed", String(visible));
  element("editor-pane")?.classList.toggle("panel-open", visible);
  if (visible) renderBottomPanel();
}

function renderBottomPanel() {
  const content = element("output-lines");
  for (const id of ["output", "terminal", "problems"] as const) {
    const button = element(`${id}-tab`);
    button.classList.toggle("active", bottomPanelTab === id);
    button.setAttribute("aria-selected", String(bottomPanelTab === id));
  }
  content.textContent = bottomPanelTab === "output" ? t("outputReady") : t("panelReserved");
}

function renderMenu(name: MenuName) {
  const popover = element("menu-popover");
  popover.replaceChildren();
  const mod = modifierLabel();
  const fontMod = mod === "⌘" ? "⌘⌥" : "Ctrl+Alt+";
  type MenuItem = { label: string; shortcut?: string; detail?: string; fullPath?: string; action: () => void | Promise<void>; enabled?: boolean };
  const current = activeTab();
  const sections: MenuItem[][] = name === "file" ? [
    [{ label: t("newTemporaryFile"), shortcut: mod === "⌘" ? "⌘⌥N" : "Ctrl+Alt+N", action: newUntitledTab },
      { label: t("newFileInProject"), action: () => showCreateModal("file"), enabled: Boolean(workspace && !workspace.singleFile) },
      { label: t("newFolder"), action: () => showCreateModal("directory"), enabled: Boolean(workspace && !workspace.singleFile) },
      { label: t("openFile"), shortcut: mod + "O", action: chooseFile },
      { label: t("openFolder"), action: chooseFolder },
      { label: t("goToFile"), shortcut: mod + "P", action: () => showPalette("files"), enabled: Boolean(workspace) }],
    [{ label: t("save"), shortcut: mod + "S", action: saveActive, enabled: Boolean(current) },
      { label: t("closeFile"), shortcut: "Ctrl+Alt+W", action: () => { if (current) void closeTab(current); }, enabled: Boolean(current) }]
  ] : name === "edit" ? [
    [{ label: t("undo"), shortcut: mod + "Z", action: () => { if (editor) undo(editor); }, enabled: Boolean(editor) },
      { label: t("redo"), shortcut: mod + "⇧Z", action: () => { if (editor) redo(editor); }, enabled: Boolean(editor) }],
    [{ label: t("findInFile"), shortcut: mod + "F", action: findInFile, enabled: Boolean(editor) },
      { label: t("replaceInFile"), shortcut: mod + "⌥F", action: replaceInFile, enabled: Boolean(editor) },
      { label: t("searchProject"), shortcut: mod === "⌘" ? "⌘⇧F" : "Ctrl+Shift+F", action: () => setProjectSearchMode(true), enabled: Boolean(workspace) }]
  ] : name === "view" ? [
    [{ label: t("toggleProjectPanel"), shortcut: mod + "B", action: () => setSidebarVisible(!sidebarVisible) },
      { label: t("toggleBottomPanel"), action: () => setBottomPanelVisible(element("bottom-panel").hidden) },
      { label: t("toggleTheme"), action: toggleTheme },
      { label: wordWrap ? t("disableWrap") : t("enableWrap"), shortcut: "Alt+Z", action: toggleWordWrap },
      { label: t("expandAllFolders"), action: () => expandFolders(), enabled: Boolean(workspace && !workspace.singleFile) },
      { label: t("collapseAllFolders"), action: () => collapseFolders(), enabled: Boolean(workspace && !workspace.singleFile) }],
    [{ label: t("selectFont"), action: () => showPalette("fonts") },
      { label: t("increaseFontSize"), shortcut: fontMod + "=", action: () => changeEditorFontSize(1) },
      { label: t("decreaseFontSize"), shortcut: fontMod + "-", action: () => changeEditorFontSize(-1) },
      { label: t("resetFontSize"), shortcut: fontMod + "0", action: () => changeEditorFontSize(0) }]
  ] : [
    [{ label: t("goToFile"), shortcut: mod + "P", action: () => showPalette("files"), enabled: Boolean(workspace) },
      { label: t("goToLine"), action: jumpToLine, enabled: Boolean(editor) },
      { label: t("commandPalette"), shortcut: mod + "⇧P", action: () => showPalette("commands") }]
  ];
  const sectionTitles = new Map<number, string>();
  const recentPathItem = (path: string, action: () => void): MenuItem => {
    const trimmed = path.replace(/[\\/]+$/, "") || path;
    const separator = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
    const parent = trimmed.slice(0, separator) || trimmed;
    const parts = parent.split(/[\\/]/).filter(Boolean);
    const detail = parts.length > 2 ? `…/${parts.slice(-2).join("/")}` : parent;
    return { label: trimmed.slice(separator + 1) || trimmed, detail, fullPath: path, action };
  };
  if (name === "file" && recentFolders.length) {
    sectionTitles.set(sections.length, t("recentFolders"));
    sections.push(recentFolders.slice(0, 5).map((path) => recentPathItem(path, () => {
      void openWorkspace(path).catch((error) => showNotice(`${t("openFailed")}: ${String(error)}`));
    })));
  }
  if (name === "file" && recentFiles.length) {
    sectionTitles.set(sections.length, t("recentFiles"));
    sections.push(recentFiles.slice(0, 5).map((path) => recentPathItem(path, () => {
      void openWorkspace(path, true).catch((error) => showNotice(`${t("readFailed")}: ${String(error)}`));
    })));
  }
  sections.forEach((items, sectionIndex) => {
    if (sectionIndex) {
      const separator = document.createElement("div");
      separator.className = "menu-separator";
      popover.append(separator);
    }
    const sectionTitle = sectionTitles.get(sectionIndex);
    if (sectionTitle) {
      const heading = document.createElement("div");
      heading.className = "menu-section-heading";
      heading.textContent = sectionTitle;
      popover.append(heading);
    }
    items.forEach((item) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "menu-item";
      button.setAttribute("role", "menuitem");
      button.disabled = item.enabled === false;
      if (item.fullPath) {
        button.classList.add("menu-item-recent");
        button.title = item.fullPath;
        button.setAttribute("aria-label", item.fullPath);
        const copy = document.createElement("span");
        copy.className = "menu-path-copy";
        const label = document.createElement("span");
        label.className = "menu-path-name";
        label.textContent = item.label;
        const detail = document.createElement("span");
        detail.className = "menu-path-parent";
        detail.textContent = item.detail ?? "";
        copy.append(label, detail);
        button.append(copy);
      } else {
        const label = document.createElement("span");
        label.textContent = item.label;
        button.append(label);
      }
      if (item.shortcut) {
        const shortcut = document.createElement("kbd");
        shortcut.textContent = item.shortcut;
        button.append(shortcut);
      }
      button.onclick = () => { hideMenu(); void item.action(); };
      popover.append(button);
    });
  });
  const trigger = document.querySelector<HTMLElement>(`.menu-trigger[data-menu="${name}"]`);
  if (trigger) popover.style.left = trigger.offsetLeft + "px";
  document.querySelectorAll<HTMLElement>(".menu-trigger").forEach((button) => button.setAttribute("aria-expanded", String(button === trigger)));
  popover.hidden = false;
}

function hideMenu() {
  openMenu = null;
  element("menu-popover").hidden = true;
  document.querySelectorAll<HTMLElement>(".menu-trigger").forEach((button) => button.setAttribute("aria-expanded", "false"));
}

function jumpToLine() {
  if (!editor) return;
  gotoLine(editor);
}

function cycleTab(direction: number) {
  if (tabs.length < 2) return;
  if (!tabCycleOrder) {
    tabCycleOrder = [activePath, ...recentTabs, ...tabs.map((tab) => tab.path)]
      .filter((path): path is string => Boolean(path) && tabs.some((tab) => tab.path === path))
      .filter((path, index, paths) => paths.indexOf(path) === index);
    tabCycleIndex = 0;
  }
  tabCycleIndex = (tabCycleIndex + direction + tabCycleOrder.length) % tabCycleOrder.length;
  activateTab(tabCycleOrder[tabCycleIndex], false);
}

function finishTabCycle() {
  if (!tabCycleOrder) return;
  if (activePath) recentTabs = [activePath, ...recentTabs.filter((path) => path !== activePath)];
  tabCycleOrder = null;
}

function setProjectSearchMode(open: boolean) {
  if (open && !workspace) return;
  projectSearchMode = open;
  element("explorer").classList.toggle("search-mode", open);
  element("project-search-panel").hidden = !open;
  element("search-project").setAttribute("aria-pressed", String(open));
  if (open) {
    setSidebarVisible(true);
    element<HTMLInputElement>("project-search-input").focus();
  }
}

function renderProjectSearchResults() {
  const container = element("project-search-results");
  const status = element("project-search-status");
  container.replaceChildren();
  if (projectSearchState === "loading") { status.textContent = t("searchingProject"); return; }
  if (projectSearchState === "error") { status.textContent = `${t("searchFailed")}: ${projectSearchError}`; return; }
  if (!projectSearchResult) { status.textContent = t("searchPrompt"); return; }
  const groups = new Map<string, ProjectSearchMatch[]>();
  for (const match of projectSearchResult.matches) {
    const group = groups.get(match.path) ?? [];
    group.push(match);
    groups.set(match.path, group);
  }
  status.textContent = groups.size
    ? t("searchResults").replace("{count}", String(projectSearchResult.matches.length)).replace("{files}", String(groups.size))
    : t("searchNoResults");
  if (projectSearchResult.truncated) status.textContent += ` · ${t("searchTruncated")}`;
  for (const [path, matches] of groups) {
    const file = document.createElement("div");
    file.className = "project-search-file";
    file.textContent = path.split("/").pop() ?? path;
    file.title = path;
    const location = document.createElement("small");
    location.textContent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : workspace?.name ?? "";
    file.append(location);
    container.append(file);
    for (const match of matches) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "project-search-match";
      row.title = `${match.path}:${match.line}:${match.column}`;
      const line = document.createElement("span");
      line.className = "project-search-line";
      line.textContent = String(match.line);
      const snippet = document.createElement("span");
      snippet.className = "project-search-snippet";
      const haystack = element<HTMLInputElement>("project-search-case").checked ? match.preview : match.preview.toLocaleLowerCase();
      const needle = element<HTMLInputElement>("project-search-case").checked ? projectSearchQuery : projectSearchQuery.toLocaleLowerCase();
      const index = haystack.indexOf(needle);
      if (index >= 0 && needle) {
        snippet.append(document.createTextNode(match.preview.slice(0, index)));
        const highlight = document.createElement("mark");
        highlight.textContent = match.preview.slice(index, index + projectSearchQuery.length);
        snippet.append(highlight, document.createTextNode(match.preview.slice(index + projectSearchQuery.length)));
      } else snippet.textContent = match.preview;
      row.append(line, snippet);
      row.onclick = () => { void openSearchMatch(match); };
      container.append(row);
    }
  }
}

async function openSearchMatch(match: ProjectSearchMatch) {
  await openFile({ name: match.path.split("/").pop() ?? match.path, path: match.path, kind: "file", size: 0 });
  if (activePath !== match.path || !editor) return;
  const line = editor.state.doc.line(Math.min(match.line, editor.state.doc.lines));
  const position = Math.min(line.to, line.from + Math.max(0, match.column - 1));
  editor.dispatch({ selection: { anchor: position }, effects: EditorView.scrollIntoView(position, { y: "center" }) });
  editor.focus();
  await revealFile(match.path);
}

async function runProjectSearch() {
  const currentWorkspace = workspace;
  if (!currentWorkspace) return;
  const query = element<HTMLInputElement>("project-search-input").value.trim();
  const sequence = ++projectSearchSequence;
  projectSearchQuery = query;
  projectSearchResult = null;
  if (!query) {
    projectSearchState = "idle";
    renderProjectSearchResults();
    return;
  }
  projectSearchState = "loading";
  renderProjectSearchResults();
  try {
    const result = await invoke<ProjectSearchResult>("workspace/search", {
      workspaceId: currentWorkspace.workspaceId,
      query,
      caseSensitive: element<HTMLInputElement>("project-search-case").checked,
      includeBuild: element<HTMLInputElement>("project-search-build").checked
    }, 30000);
    if (workspace !== currentWorkspace || sequence !== projectSearchSequence) return;
    projectSearchResult = result;
    projectSearchState = "idle";
  } catch (error) {
    if (workspace !== currentWorkspace || sequence !== projectSearchSequence) return;
    projectSearchError = String(error instanceof Error ? error.message : error);
    projectSearchState = "error";
  }
  renderProjectSearchResults();
}

function fileScore(item: Entry, query: string): number {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return recentTabs.indexOf(item.path) >= 0 ? recentTabs.indexOf(item.path) : 100;
  const name = item.name.toLowerCase();
  const path = item.path.toLowerCase();
  let total = 0;
  for (const term of terms) {
    if (name === term) continue;
    if (name.startsWith(term)) { total += 1; continue; }
    if (name.includes(term)) { total += 3; continue; }
    if (path.includes(term)) { total += 6; continue; }
    let cursor = 0;
    for (const character of term) {
      cursor = path.indexOf(character, cursor);
      if (cursor < 0) return Infinity;
      cursor += 1;
    }
    total += 12;
  }
  return total;
}

async function ensureFileIndex() {
  const currentWorkspace = workspace;
  if (!currentWorkspace || fileIndexWorkspaceId === currentWorkspace.workspaceId) return;
  if (fileIndexPromise) return fileIndexPromise;
  const generation = fileIndexGeneration;
  const scan = (async () => {
    const result = await invoke<{ entries: Entry[]; truncated: boolean }>("workspace/index", { workspaceId: currentWorkspace.workspaceId }, 30000);
    if (workspace === currentWorkspace && fileIndexGeneration === generation) {
      fileIndex = result.entries;
      fileIndexWorkspaceId = currentWorkspace.workspaceId;
      fileIndexTruncated = result.truncated;
    }
  })();
  fileIndexPromise = scan;
  renderPalette();
  try {
    await scan;
  } finally {
    if (fileIndexPromise === scan) fileIndexPromise = null;
    if (!element("palette").hidden && paletteMode === "files") renderPalette();
  }
}

async function revealFile(path: string) {
  const currentWorkspace = workspace;
  if (!currentWorkspace) return;
  let nodes = tree;
  let prefix = "";
  for (const segment of path.split("/").slice(0, -1)) {
    prefix = prefix ? prefix + "/" + segment : segment;
    const node = nodes.find((item) => item.path === prefix && item.kind === "directory");
    if (!node) return;
    node.expanded = true;
    if (!node.children) {
      try {
        const result = await invoke<{ entries: Entry[] }>("workspace/list", {
          workspaceId: currentWorkspace.workspaceId, path: node.path
        });
        if (workspace !== currentWorkspace) return;
        node.children = result.entries;
      } catch { return; }
    }
    nodes = node.children;
  }
  renderTree();
}

function commandItems(): PaletteItem[] {
  const mod = modifierLabel();
  const fontMod = mod === "⌘" ? "⌘⌥" : "Ctrl+Alt+";
  const items: PaletteItem[] = [
    { label: t("newTemporaryFile"), shortcut: mod === "⌘" ? "⌘⌥N" : "Ctrl+Alt+N", action: newUntitledTab },
    { label: t("openFile"), shortcut: mod + "O", action: chooseFile },
    { label: t("openFolder"), action: chooseFolder },
    { label: t("toggleProjectPanel"), shortcut: mod + "B", action: () => setSidebarVisible(!sidebarVisible) },
    { label: t("toggleTheme"), action: toggleTheme },
    { label: t("selectFont"), action: () => showPalette("fonts") },
    { label: t("increaseFontSize"), shortcut: fontMod + "=", action: () => changeEditorFontSize(1) },
    { label: t("decreaseFontSize"), shortcut: fontMod + "-", action: () => changeEditorFontSize(-1) },
    { label: t("resetFontSize"), shortcut: fontMod + "0", action: () => changeEditorFontSize(0) }
  ];
  if (workspace) {
    items.push(
      { label: t("goToFile"), shortcut: mod + "P", action: () => showPalette("files") },
      { label: t("searchProject"), shortcut: mod === "⌘" ? "⌘⇧F" : "Ctrl+Shift+F", action: () => setProjectSearchMode(true) },
      { label: t("refresh"), action: refreshTree }
    );
    if (!workspace.singleFile) items.push(
      { label: t("newFileInProject"), action: () => showCreateModal("file") },
      { label: t("newFolder"), action: () => showCreateModal("directory") },
      { label: t("expandAllFolders"), action: () => expandFolders() },
      { label: t("collapseAllFolders"), action: () => collapseFolders() }
    );
  }
  if (activeTab()) {
    items.push(
      { label: t("save"), shortcut: mod + "S", action: saveActive },
      { label: t("findInFile"), shortcut: mod + "F", action: findInFile },
      { label: t("replaceInFile"), action: replaceInFile },
      { label: t("selectLanguage"), action: () => showPalette("languages") },
      { label: t("selectEncoding"), action: () => showPalette("encodings") },
      { label: t("goToLine"), action: jumpToLine },
      { label: t("closeFile"), shortcut: "Ctrl+Alt+W", action: () => closeTab(activeTab()!) }
    );
  }
  if (isMarkdownTab(activeTab())) items.push({ label: t("previewMarkdown"), action: toggleMarkdownPreview });
  items.push({ label: wordWrap ? t("disableWrap") : t("enableWrap"), shortcut: "Alt+Z", action: toggleWordWrap });
  items.push({ label: t("toggleBottomPanel"), action: () => setBottomPanelVisible(element("bottom-panel").hidden) });
  return items;
}

function renderPalette() {
  if (element("palette").hidden) return;
  const input = element<HTMLInputElement>("palette-input");
  const results = element("palette-results");
  const title = paletteMode === "files" ? t("goToFile") : paletteMode === "languages" ? t("selectLanguage") : paletteMode === "encodings" ? t("selectEncoding") : paletteMode === "fonts" ? t("selectFont") : t("commandPalette");
  element("palette-title").textContent = title + (paletteMode === "files" && fileIndexTruncated ? " · " + t("indexLimit") : "");
  input.placeholder = paletteMode === "files" ? t("findFileByName") : title;
  const query = input.value;
  if (paletteMode === "files") {
    paletteItems = fileIndex
      .map((entry) => ({ entry, score: fileScore(entry, query) }))
      .filter((item) => Number.isFinite(item.score))
      .sort((a, b) => a.score - b.score || a.entry.path.localeCompare(b.entry.path))
      .slice(0, 60)
      .map(({ entry }) => {
        const kind = fileKind(entry.name);
        return {
          label: entry.name, detail: entry.path, token: kind.token, category: kind.category,
          action: async () => { await openFile(entry); await revealFile(entry.path); }
        };
      });
  } else if (paletteMode === "languages") {
    const tab = activeTab();
    const choices = [{ id: "auto", label: t("languageAuto"), search: "auto" }, { id: "plain", label: t("plainText"), search: "plain text txt" },
      ...languages.map((language) => ({ id: language.name, label: language.name, search: [language.name, ...language.alias, ...language.extensions].join(" ") }))];
    paletteItems = choices.filter((item) => item.search.toLowerCase().includes(query.toLowerCase()) || item.label.toLowerCase().includes(query.toLowerCase())).map((item) => ({
      label: item.label,
      ...languageBadge(item.id),
      selected: Boolean(tab && (item.id === "auto" ? tab.languageAuto : !tab.languageAuto && tab.languageId === item.id)),
      action: () => selectLanguage(item.id)
    }));
  } else if (paletteMode === "fonts") {
    paletteItems = editorFonts.filter((font) => (font.id === "default" ? t("defaultFont") : font.label).toLowerCase().includes(query.toLowerCase())).map((font) => ({
      label: font.id === "default" ? t("defaultFont") : font.label, detail: t("fontPreview"), previewFont: font.stack,
      selected: font.id === editorFontPreference,
      action: () => selectEditorFont(font.id)
    }));
  } else if (paletteMode === "encodings") {
    const tab = activeTab();
    const target = pendingEncodingEntry;
    paletteItems = [
      { id: "", label: locale === "zh" ? "自动识别" : "Auto detect" },
      { id: "utf-8", label: "UTF-8" }, { id: "utf-8-bom", label: "UTF-8 BOM" },
      { id: "utf-16le", label: "UTF-16 LE" }, { id: "utf-16be", label: "UTF-16 BE" },
      { id: "gb18030", label: "GB18030 / GBK" }, { id: "big5", label: "Big5" },
      { id: "shift_jis", label: "Shift JIS" }, { id: "euc-kr", label: "EUC-KR" },
      { id: "windows-1252", label: "Western (Windows-1252)" }
    ].filter((item) => item.label.toLowerCase().includes(query.toLowerCase())).map((item) => ({
      label: item.label, detail: tab?.encoding === item.id ? "✓" : undefined,
      action: () => target ? openFile(target, item.id) : reopenWithEncoding(item.id)
    }));
  } else {
    paletteItems = commandItems().filter((item) => item.label.toLowerCase().includes(query.toLowerCase())).slice(0, 60);
  }
  paletteSelection = Math.max(0, Math.min(paletteSelection, paletteItems.length - 1));
  results.replaceChildren();
  if (!paletteItems.length) {
    input.removeAttribute("aria-activedescendant");
    const empty = document.createElement("div");
    empty.className = "palette-empty";
    empty.textContent = paletteMode === "files" && fileIndexPromise ? t("loadingFiles") :
      paletteMode === "files" ? t("noMatchingFiles") : t("noCommands");
    results.append(empty);
    return;
  }
  paletteItems.forEach((item, index) => {
    const row = document.createElement("button");
    row.type = "button";
    row.id = "palette-option-" + index;
    row.className = "palette-item" + (index === paletteSelection ? " selected" : "");
    row.setAttribute("role", "option");
    row.setAttribute("aria-selected", String(index === paletteSelection));
    if (item.token) {
      const token = document.createElement("span");
      token.className = "file-token " + (item.category ?? "");
      token.textContent = item.token;
      token.setAttribute("aria-hidden", "true");
      row.append(token);
    }
    const body = document.createElement("span");
    body.className = "palette-item-body";
    const label = document.createElement("span");
    label.className = "palette-item-label";
    label.textContent = item.label;
    if (item.previewFont) label.style.fontFamily = item.previewFont;
    body.append(label);
    if (item.detail) {
      const detail = document.createElement("span");
      detail.className = "palette-item-detail";
      detail.textContent = item.detail;
      if (item.previewFont) detail.style.fontFamily = item.previewFont;
      if (item.previewFont) detail.style.fontSize = "12px";
      body.append(detail);
    }
    row.append(body);
    if (item.selected) {
      const mark = document.createElement("span");
      mark.className = "palette-item-check";
      mark.textContent = "✓";
      mark.setAttribute("aria-label", paletteMode === "languages" ? (locale === "zh" ? "当前语言模式" : "Current language mode") : (locale === "zh" ? "当前字体" : "Current font"));
      row.append(mark);
    }
    if (item.shortcut) {
      const shortcut = document.createElement("span");
      shortcut.className = "palette-item-shortcut";
      shortcut.textContent = item.shortcut;
      row.append(shortcut);
    }
    row.onmouseenter = () => { setPaletteSelection(index); };
    row.onclick = () => { void choosePaletteItem(index); };
    results.append(row);
  });
  input.setAttribute("aria-activedescendant", "palette-option-" + paletteSelection);
}

function setPaletteSelection(index: number) {
  if (!paletteItems.length) { element("palette-input").removeAttribute("aria-activedescendant"); return; }
  paletteSelection = Math.max(0, Math.min(index, paletteItems.length - 1));
  element("palette-input").setAttribute("aria-activedescendant", "palette-option-" + paletteSelection);
  element("palette-results").querySelectorAll<HTMLElement>(".palette-item").forEach((row, rowIndex) => {
    row.classList.toggle("selected", rowIndex === paletteSelection);
    row.setAttribute("aria-selected", String(rowIndex === paletteSelection));
    if (rowIndex === paletteSelection) row.scrollIntoView({ block: "nearest" });
  });
}

async function choosePaletteItem(index: number) {
  const item = paletteItems[index];
  if (!item) return;
  hidePalette();
  await item.action();
}

function showPalette(mode: PaletteMode) {
  if (mode === "files" && !workspace) { void chooseFolder(); return; }
  if (mode === "languages" && !activeTab()) { newUntitledTab(); }
  if (mode === "encodings" && !pendingEncodingEntry && (!activeTab() || activeTab()?.untitled)) return;
  if (element("palette").hidden) paletteReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  paletteMode = mode;
  paletteSelection = 0;
  const input = element<HTMLInputElement>("palette-input");
  input.value = "";
  element("palette").hidden = false;
  renderPalette();
  input.focus();
  if (mode === "files") void ensureFileIndex().catch((error) => {
    showNotice(t("fileIndexFailed") + ": " + String(error instanceof Error ? error.message : error));
  });
}

function hidePalette() {
  element("palette").hidden = true;
  pendingEncodingEntry = null;
  paletteReturnFocus?.focus();
  paletteReturnFocus = null;
}

function wireEvents() {
  element("open-file").onclick = () => { void chooseFile(); };
  element("open-folder").onclick = () => { void chooseFolder(); };
  element("workspace-switcher").onclick = () => { void chooseFolder(); };
  element("welcome-open").onclick = () => { void chooseFolder(); };
  element("welcome-open-file").onclick = () => { void chooseFile(); };
  element("welcome-new").onclick = newUntitledTab;
  element("new-temporary-file").onclick = newUntitledTab;
  element("welcome-language").onclick = () => { newUntitledTab(); showPalette("languages"); };
  element("welcome").ondblclick = (event) => {
    if ((event.target as HTMLElement).closest("button, a, input")) return;
    newUntitledTab();
  };
  element("welcome-commands").onclick = () => showPalette("commands");
  element("quick-open").onclick = () => showPalette("files");
  element("find-file").onclick = () => showPalette("files");
  element("command-palette").onclick = () => showPalette("commands");
  element("new-file").onclick = () => showCreateModal("file");
  element("new-folder").onclick = () => showCreateModal("directory");
  element("toggle-theme").onclick = toggleTheme;
  element("toggle-sidebar").onclick = () => setSidebarVisible(!sidebarVisible);
  element("toggle-bottom-panel").onclick = () => setBottomPanelVisible(element("bottom-panel").hidden);
  element("close-bottom-panel").onclick = () => setBottomPanelVisible(false);
  element("output-tab").onclick = () => { bottomPanelTab = "output"; renderBottomPanel(); };
  element("terminal-tab").onclick = () => { bottomPanelTab = "terminal"; renderBottomPanel(); };
  element("problems-tab").onclick = () => { bottomPanelTab = "problems"; renderBottomPanel(); };
  element("file-type").onclick = () => showPalette("languages");
  element("file-encoding").onclick = () => showPalette("encodings");
  element("editor-font").onclick = () => showPalette("fonts");
  element("font-size-decrease").onclick = () => changeEditorFontSize(-1);
  element("font-size-increase").onclick = () => changeEditorFontSize(1);
  element("editor-font-size").onclick = () => changeEditorFontSize(0);
  document.querySelectorAll<HTMLButtonElement>(".menu-trigger").forEach((button) => {
    button.setAttribute("aria-haspopup", "menu");
    button.setAttribute("aria-expanded", "false");
    button.onclick = () => {
      const name = button.dataset.menu as MenuName;
      if (openMenu === name) hideMenu();
      else { openMenu = name; renderMenu(name); }
    };
    button.onmouseenter = () => {
      if (openMenu && openMenu !== button.dataset.menu) {
        openMenu = button.dataset.menu as MenuName;
        renderMenu(openMenu);
      }
    };
    button.onkeydown = (event) => {
      if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openMenu = button.dataset.menu as MenuName;
        renderMenu(openMenu);
        element("menu-popover").querySelector<HTMLButtonElement>(".menu-item:not(:disabled)")?.focus();
      }
    };
  });
  element("menu-popover").onkeydown = (event) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const rows = Array.from(element("menu-popover").querySelectorAll<HTMLButtonElement>(".menu-item:not(:disabled)"));
    const index = rows.indexOf(document.activeElement as HTMLButtonElement);
    rows[(index + (event.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length]?.focus();
  };
  document.addEventListener("pointerdown", (event) => {
    if (openMenu && !(event.target as HTMLElement).closest("#menu-bar")) hideMenu();
  });
  element("save-file").onclick = () => { void saveActive(); };
  element("toggle-markdown-preview").onclick = toggleMarkdownPreview;
  element("close-markdown-preview").onclick = toggleMarkdownPreview;
  element("find-in-file").onclick = findInFile;
  element("close-active-tab").onclick = () => { const tab = activeTab(); if (tab) void closeTab(tab); };
  element("refresh-tree").onclick = () => { void refreshTree(); };
  element("search-project").onclick = () => setProjectSearchMode(!projectSearchMode);
  element("expand-all-folders").onclick = () => { void expandFolders(); };
  element("collapse-all-folders").onclick = () => collapseFolders();
  element("project-search-submit").onclick = () => { window.clearTimeout(projectSearchTimer); void runProjectSearch(); };
  const projectSearchInput = element<HTMLInputElement>("project-search-input");
  projectSearchInput.oninput = () => {
    window.clearTimeout(projectSearchTimer);
    projectSearchSequence++;
    projectSearchResult = null;
    projectSearchState = "idle";
    renderProjectSearchResults();
    projectSearchTimer = window.setTimeout(() => { void runProjectSearch(); }, 350);
  };
  projectSearchInput.onkeydown = (event) => {
    if (event.key === "Enter") { event.preventDefault(); window.clearTimeout(projectSearchTimer); void runProjectSearch(); }
  };
  for (const id of ["project-search-case", "project-search-build"]) {
    element<HTMLInputElement>(id).onchange = () => { if (projectSearchInput.value.trim()) void runProjectSearch(); };
  }
  element("notice-close").onclick = hideNotice;
  element("palette").onclick = (event) => { if (event.target === element("palette")) hidePalette(); };
  const paletteInput = element<HTMLInputElement>("palette-input");
  paletteInput.oninput = () => { paletteSelection = 0; renderPalette(); };
  paletteInput.onkeydown = (event) => {
    if (event.key === "Tab") {
      event.preventDefault();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setPaletteSelection(paletteSelection + (event.key === "ArrowDown" ? 1 : -1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      void choosePaletteItem(paletteSelection);
    }
  };
  element("folder-cancel").onclick = hideFolderModal;
  element("folder-browse").onclick = () => { void chooseFolder(); };
  element("folder-confirm").onclick = () => { void submitFolder(); };
  element<HTMLInputElement>("folder-input").onkeydown = (event) => {
    if (event.key === "Enter") { event.preventDefault(); void submitFolder(); }
  };
  element("create-cancel").onclick = hideCreateModal;
  element("create-confirm").onclick = () => { void submitCreate(); };
  element<HTMLInputElement>("create-input").onkeydown = (event) => {
    if (event.key === "Enter") { event.preventDefault(); void submitCreate(); }
  };
  const resizer = element("sidebar-resizer");
  let resizing = false;
  const resizeSidebar = (width: number) => {
    const maximum = Math.max(165, Math.min(440, window.innerWidth - 220));
    const next = Math.max(165, Math.min(maximum, width));
    element("workspace-layout").style.setProperty("--sidebar-width", next + "px");
    resizer.setAttribute("aria-valuenow", String(next));
  };
  resizer.setAttribute("aria-valuemin", "165");
  resizer.setAttribute("aria-valuemax", "440");
  resizer.setAttribute("aria-valuenow", "250");
  resizer.onpointerdown = (event) => {
    resizing = true;
    resizer.setPointerCapture(event.pointerId);
    event.preventDefault();
  };
  resizer.onpointermove = (event) => {
    if (!resizing) return;
    resizeSidebar(event.clientX);
  };
  resizer.onpointerup = () => { resizing = false; };
  resizer.onpointercancel = () => { resizing = false; };
  resizer.onkeydown = (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const current = parseInt(getComputedStyle(element("workspace-layout")).getPropertyValue("--sidebar-width"), 10) || 250;
    resizeSidebar(current + (event.key === "ArrowRight" ? 16 : -16));
  };
  window.addEventListener("resize", () => {
    const value = element("workspace-layout").style.getPropertyValue("--sidebar-width");
    if (value) resizeSidebar(parseInt(value, 10));
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (openMenu) { event.preventDefault(); hideMenu(); return; }
      if (!element("palette").hidden) { event.preventDefault(); hidePalette(); return; }
      if (!element("folder-modal").hidden) { event.preventDefault(); hideFolderModal(); return; }
      if (!element("create-modal").hidden) { event.preventDefault(); hideCreateModal(); return; }
      if (!element("confirm-modal").hidden) { event.preventDefault(); element<HTMLButtonElement>("confirm-cancel").click(); return; }
      if (projectSearchMode && document.activeElement === element("project-search-input")) { event.preventDefault(); setProjectSearchMode(false); return; }
    }
    const mod = event.metaKey || event.ctrlKey;
    const key = event.code.startsWith("Key") ? event.code.slice(3).toLowerCase() : event.key.toLowerCase();
    if (!element("palette").hidden) {
      if (mod && event.shiftKey && key === "p") { event.preventDefault(); showPalette("commands"); }
      else if (mod && key === "p") { event.preventDefault(); showPalette("files"); }
      return;
    }
    if (!element("folder-modal").hidden || !element("create-modal").hidden || !element("confirm-modal").hidden) return;
    if (openMenu) hideMenu();
    if (event.altKey && (event.metaKey || event.ctrlKey) && !(event.metaKey && event.ctrlKey)) {
      if (event.code === "Equal" || event.code === "NumpadAdd") { event.preventDefault(); changeEditorFontSize(1); return; }
      if (event.code === "Minus" || event.code === "NumpadSubtract") { event.preventDefault(); changeEditorFontSize(-1); return; }
      if (!event.shiftKey && (event.code === "Digit0" || event.code === "Numpad0")) { event.preventDefault(); changeEditorFontSize(0); return; }
    }
    if (mod && event.shiftKey && key === "p") {
      event.preventDefault();
      showPalette("commands");
    } else if (mod && key === "p") {
      event.preventDefault();
      showPalette("files");
    } else if (mod && key === "s") {
      event.preventDefault();
      void saveActive();
    } else if (mod && key === "o") {
      event.preventDefault();
      void chooseFile();
    } else if (event.ctrlKey && event.altKey && key === "o") {
      event.preventDefault();
      void chooseFile();
    } else if (mod && event.altKey && !event.shiftKey && key === "n") {
      event.preventDefault();
      newUntitledTab();
    } else if (mod && event.shiftKey && key === "f") {
      if (workspace) { event.preventDefault(); setProjectSearchMode(true); }
    } else if (mod && key === "f") {
      if (editor) { event.preventDefault(); if (event.altKey) replaceInFile(); else findInFile(); }
    } else if (mod && key === "w") {
      const tab = activeTab();
      if (tab) { event.preventDefault(); void closeTab(tab); }
    } else if (mod && key === "b") {
      event.preventDefault();
      setSidebarVisible(!sidebarVisible);
    } else if (mod && event.shiftKey && key === "e") {
      event.preventDefault();
      focusExplorer();
    } else if (event.ctrlKey && event.key === "Tab") {
      event.preventDefault();
      cycleTab(event.shiftKey ? -1 : 1);
    } else if (event.altKey && key === "z") {
      event.preventDefault();
      toggleWordWrap();
    }
  }, true);
  document.addEventListener("keyup", (event) => { if (event.key === "Control") finishTabCycle(); }, true);
  window.addEventListener("blur", finishTabCycle);
  window.addEventListener("focus", () => { void checkExternalChange(); });
  window.addEventListener("dbx-plugin-env", () => {
    locale = bridge?.locale?.toLowerCase().startsWith("zh") ? "zh" : "en";
    applyTheme();
    applyLocale();
  });
}

async function init() {
  wireEvents();
  setSidebarVisible(true);
  if (!bridge) {
    showNotice(t("hostMissing"));
    return;
  }
  try {
    await bridge.ready;
    let savedSession: SavedSession | undefined;
    locale = bridge.locale?.toLowerCase().startsWith("zh") ? "zh" : "en";
    if (bridge.capabilities?.storage && bridge.storage) {
      try {
        const savedTheme = await bridge.storage.get("editorTheme");
        if (savedTheme === "dark" || savedTheme === "light") themePreference = savedTheme;
        const saved = await bridge.storage.get("recentFolders");
        if (Array.isArray(saved)) recentFolders = saved.filter((item): item is string => typeof item === "string").slice(0, 8);
        if (recentFolders.length === 0) {
          const legacy = await bridge.storage.get("recentFolder");
          if (typeof legacy === "string") recentFolders = [legacy];
        }
      } catch { /* Draft recovery is independent of host preferences. */ }
    }
    try {
      const preferences = await invoke<{ recentFolders: string[]; recentFiles: string[]; recentPositions?: SavedFilePosition[]; session?: SavedSession; theme: string; editorFont?: string; editorFontSize?: number }>("preferences/get", {});
      if (Array.isArray(preferences.recentFolders) && preferences.recentFolders.length) {
        recentFolders = preferences.recentFolders.filter((item): item is string => typeof item === "string").slice(0, 8);
      }
      if (Array.isArray(preferences.recentFiles)) recentFiles = preferences.recentFiles.filter((item): item is string => typeof item === "string").slice(0, 8);
      if (Array.isArray(preferences.recentPositions)) recentPositions = preferences.recentPositions.filter((item) =>
        item && typeof item.path === "string" && item.path.startsWith("/") && Number.isInteger(item.selection) && item.selection >= 0 && Number.isFinite(item.scrollTop) && item.scrollTop >= 0
      ).slice(0, 20);
      if (preferences.theme === "dark" || preferences.theme === "light") themePreference = preferences.theme;
      if (preferences.session && typeof preferences.session.workspacePath === "string") savedSession = preferences.session;
      if (editorFonts.some((font) => font.id === preferences.editorFont)) editorFontPreference = preferences.editorFont as EditorFontId;
      if (typeof preferences.editorFontSize === "number" && preferences.editorFontSize >= 10 && preferences.editorFontSize <= 24) editorFontSize = preferences.editorFontSize;
    } catch (error) {
      showNotice(`${t("preferencesSaveFailed")}: ${String(error instanceof Error ? error.message : error)}`);
    }
    applyTheme();
    applyEditorTypography();
    applyLocale();
    await restoreSavedSession(savedSession);
    try { await restoreDrafts(); }
    catch (error) { showNotice(`${t("draftRestoreFailed")}: ${String(error instanceof Error ? error.message : error)}`); }
    if (savedSession?.activeDraft && tabs.some((tab) => tab.path === `untitled:${savedSession.activeDraft}`)) activateTab(`untitled:${savedSession.activeDraft}`);
  } catch (error) {
    showNotice(String(error instanceof Error ? error.message : error));
  }
}

void init();
