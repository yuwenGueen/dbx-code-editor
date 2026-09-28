# Code Editor for DBX

在 DBX 桌面工作台中浏览和编辑本地项目文件的插件。界面基于 CodeMirror 6，提供文件树、多标签、命令面板、搜索和常用编辑快捷键。

发布工作流构建 macOS Intel/Apple Silicon、Windows x64、Linux x64/ARM64 五种桌面包。macOS 使用系统文件对话框，Windows 使用 PowerShell 的系统对话框；Linux 使用已安装的 `zenity` 或 `kdialog`，没有这两个组件时仍可输入文件夹路径，再从项目树打开文件。当前开发环境是 macOS，Windows 和 Linux 的实际桌面交互仍需在对应系统上验收。

## 功能

- 从系统选择器打开文件或项目文件夹，也可输入文件夹路径；欢迎页和“文件”菜单显示最近使用的文件与文件夹。
- 在项目树中按需展开目录、递归展开或折叠文件夹；通过文件名模糊查找文件，在整个项目中搜索文字。搜索默认跳过 `.git`、依赖和构建目录，可选择包含构建目录。
- 多标签编辑、切换与关闭；可创建项目内文件和文件夹，也可创建不属于项目的临时文件。临时文件会保存在本机，下次打开插件时恢复，关闭并丢弃后删除。
- 按文件名和内容自动选择语言模式，也可手动指定。使用 CodeMirror 语言目录提供多种语法模式，并支持 Markdown 侧边预览。
- 从“文件 → 导入 Word 为 Markdown”或欢迎页导入 `.docx`，在临时标签中编辑并预览标题、粗体/斜体、列表、表格、链接和图片。转换在本机完成，原 Word 不变；草稿和图片会保留到下次打开。
- 文件内查找与替换、撤销重做、多光标、折叠、自动换行、字体与字号调整、明暗主题、中英文界面。常用编辑快捷键按 VS Code 的默认键位配置。
- 重新打开上次会话的文件、光标及滚动位置；保存前检测磁盘外部修改，避免无提示覆盖。
- 新版本首次打开时显示一次更新说明，也可以随时从“帮助 → 更新说明”或命令面板查看历次变更。
- 自动识别 UTF-8、带 BOM 的 UTF-8、UTF-16 及部分旧编码；可手动用 GB18030、Big5、Shift-JIS、EUC-KR、Windows-1252 等编码重新打开。旧编码的自动判断可能存在歧义，请在文字乱码时手动选择。

单个现有文件最多 **32 MiB**，解码后的文本最多 **64 MiB**；单个临时文件草稿最多 **1 MiB**。项目文件名索引最多 12,000 个文件，项目文本搜索最多返回 500 条匹配。符号链接不会在项目树内继续遍历。底部的“终端”和“问题”目前是布局预留，**不能执行 shell 命令**；也没有 Git、语言服务器或代码格式化功能。

## Word 导入

Word 导入目前支持 `.docx`（最多 16 MiB，解压内容最多 64 MiB）；旧版 `.doc` 需先另存为 `.docx`。转换后的 Markdown 草稿仍受 1 MiB 限制，最多保留 100 张 PNG/JPEG/GIF/WebP 图片，单张最多 2 MiB。无法转换的图片和公式会提示；页眉页脚、批注、复杂排版及合并单元格不会完整保留，修订按接受后的正文处理。

导入后按保存，默认在当前项目中使用原文档名加 `.md`，可通过“选择保存目录”切换目录。图片写入同名 `.assets/` 文件夹，并使用相对路径引用。已有 Markdown 或资源目录不会被覆盖；关闭并丢弃临时草稿会删除对应的临时图片。也可以在 Markdown 预览中加载已打开项目范围内的本地图片。

## 常用快捷键

键位参考 [VS Code 官方 macOS 速查表](https://code.visualstudio.com/shortcuts/keyboard-shortcuts-macos.pdf)和 [Windows 速查表](https://code.visualstudio.com/shortcuts/keyboard-shortcuts-windows.pdf)。

| 功能 | macOS | Windows / Linux |
| --- | --- | --- |
| 文件名查找 / 命令面板 | `⌘P` / `⌘⇧P`（或 `F1`） | `Ctrl+P` / `Ctrl+Shift+P`（或 `F1`） |
| 打开文件 / 保存 | `⌘O` / `⌘S` | `Ctrl+O` / `Ctrl+S` |
| 新建临时文件 / 关闭当前标签 | `⌘N` / `⌘W` | `Ctrl+N` / `Ctrl+W`（或 `Ctrl+F4`） |
| 文件内查找 / 替换 / 项目搜索 | `⌘F` / `⌘⌥F` / `⌘⇧F` | `Ctrl+F` / `Ctrl+H` / `Ctrl+Shift+F` |
| 切换标签 / 显示项目面板 | `⌃Tab` / `⌘B` | `Ctrl+Tab` / `Ctrl+B` |
| 转到行 / 选择当前行 | `⌃G` / `⌘L` | `Ctrl+G` / `Ctrl+L` |
| 注释当前行 / 块注释 | `⌘/` / `⇧⌥A` | `Ctrl+/` / `Shift+Alt+A` |
| 移动当前行 / 复制当前行 | `⌥↑/↓` / `⇧⌥↑/↓` | `Alt+↑/↓` / `Shift+Alt+↑/↓` |
| 删除当前行 / 在下方或上方插入一行 | `⌘⇧K` / `⌘Enter`、`⌘⇧Enter` | `Ctrl+Shift+K` / `Ctrl+Enter`、`Ctrl+Shift+Enter` |
| 选择下一个相同内容 / 全部相同内容 | `⌘D` / `⌘⇧L` | `Ctrl+D` / `Ctrl+Shift+L` |
| 在上方或下方添加光标 | `⌘⌥↑/↓` | `Ctrl+Alt+↑/↓` |
| 折叠 / 展开当前代码块 | `⌘⌥[` / `⌘⌥]` | `Ctrl+Shift+[` / `Ctrl+Shift+]` |
| 切换底部面板 / 选择语言模式 | `⌘J` / `⌘K M` | `Ctrl+J` / `Ctrl+K M` |
| 增大、减小、重置编辑器字号 | `⌘⌥+`、`⌘⌥-`、`⌘⌥0` | `Ctrl+Alt++`、`Ctrl+Alt+-`、`Ctrl+Alt+0` |
| 自动换行 | `⌥Z` | `Alt+Z` |

行编辑、多光标和折叠快捷键需要先让编辑区获得焦点。浏览器或 DBX 宿主可能优先处理新建窗口、关闭窗口等系统级快捷键。新建临时文件另可用 `⌘⌥N` / `Ctrl+Alt+N`，关闭当前标签另可用 `Ctrl+Alt+W`；工具栏和菜单也能执行这些操作。上述是当前支持的常用 VS Code 键位，并非完整的 VS Code 快捷键映射；调试、真实终端、语言服务器等功能尚未实现。

## 数据与权限

打开的项目文件仍在其原来的本地路径，保存时写回原文件。Go Sidecar 以当前用户身份运行，只允许访问用户打开的文件或文件夹范围，并在写入前检查文件修订值。插件不连接外部服务，也不读取 DBX 数据库连接或凭据。

临时文件草稿、最近使用的路径、会话、字体和主题偏好存放在系统用户配置目录下的 `io.github.yuwengueen.dbx-code-editor/drafts/`。在 macOS 上，这通常位于 `~/Library/Application Support/io.github.yuwengueen.dbx-code-editor/drafts/`。界面也使用 DBX 提供的 `host.storage` 保存少量插件状态；插件不会自动把文件内容上传到网络。

更新说明的已读版本号随本机编辑器偏好保存，用于避免同一版本重复弹窗。

## 本地开发与打包

需要 Node.js 22+ 和 Go 1.22+：

```bash
npm ci
npm run check
npm run build
npm run plugin:dev
```

开发宿主会打印 `http://127.0.0.1:5190/` 一类的本地地址。请打开该地址；直接打开 `frontend/index.html` 无法连接 DBX Host Bridge 或 Go Sidecar。

在 `backend/` 运行 `go test ./...` 验证后端。构建当前平台的未签名安装包：

```bash
npm run plugin:package
```

输出位于 `dist/`，不提交到 Git。未签名包只能在 DBX 插件中心启用“允许未签名的开发包”后用于本地测试；正式商店包需由 DBX Store 审核并签名。发布方式见 [DBX 插件开发文档](https://dbxio.com/en/docs/plugin-development) 和 [DBX Store 投稿指南](https://github.com/t8y2/dbx-store/blob/main/CONTRIBUTING.md)。

每次准备发布用户可见的更新时，在 `frontend/src/release-notes.json` 最前面增加中英文条目，并同步 `manifest.json`、`package.json`、`package-lock.json` 和 `backend/main.go` 的版本号。运行 `npm run notes:sync` 生成商店文案和 [更新日志](CHANGELOG.md)；`npm run check` 会检查这些内容是否一致。提交信息应概括改动，发布说明可直接取自更新日志。

## 许可证

[Apache License 2.0](LICENSE)。
