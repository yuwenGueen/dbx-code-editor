# Code Editor for DBX

在 DBX 桌面工作台中浏览和编辑本地项目文件的插件。界面基于 CodeMirror 6，提供文件树、多标签、命令面板、搜索和常用编辑快捷键。

发布工作流构建 macOS Intel/Apple Silicon、Windows x64、Linux x64/ARM64 五种桌面包。macOS 使用系统文件对话框，Windows 使用 PowerShell 的系统对话框；Linux 使用已安装的 `zenity` 或 `kdialog`，没有这两个组件时仍可输入文件夹路径，再从项目树打开文件。当前开发环境是 macOS，Windows 和 Linux 的实际桌面交互仍需在对应系统上验收。

## 功能

- 从系统选择器打开文件或项目文件夹，也可输入文件夹路径；欢迎页和“文件”菜单显示最近使用的文件与文件夹。
- 在项目树中按需展开目录、递归展开或折叠文件夹；通过文件名模糊查找文件，在整个项目中搜索文字。搜索默认跳过 `.git`、依赖和构建目录，可选择包含构建目录。
- 多标签编辑、切换与关闭；可创建项目内文件和文件夹，也可创建不属于项目的临时文件。临时文件会保存在本机，下次打开插件时恢复，关闭并丢弃后删除。
- 按文件名和内容自动选择语言模式，也可手动指定。使用 CodeMirror 语言目录提供多种语法模式，并支持 Markdown 侧边预览。
- 文件内查找与替换、撤销重做、多光标、折叠、自动换行、字体与字号调整、明暗主题、中英文界面。
- 重新打开上次会话的文件、光标及滚动位置；保存前检测磁盘外部修改，避免无提示覆盖。
- 自动识别 UTF-8、带 BOM 的 UTF-8、UTF-16 及部分旧编码；可手动用 GB18030、Big5、Shift-JIS、EUC-KR、Windows-1252 等编码重新打开。旧编码的自动判断可能存在歧义，请在文字乱码时手动选择。

单个现有文件最多 **32 MiB**，解码后的文本最多 **64 MiB**；单个临时文件草稿最多 **1 MiB**。项目文件名索引最多 12,000 个文件，项目文本搜索最多返回 500 条匹配。符号链接不会在项目树内继续遍历。底部的“终端”和“问题”目前是布局预留，**不能执行 shell 命令**；也没有 Git、语言服务器或代码格式化功能。

## 常用快捷键

| 功能 | macOS | Windows / Linux |
| --- | --- | --- |
| 文件名查找 / 命令面板 | `⌘P` / `⌘⇧P` | `Ctrl+P` / `Ctrl+Shift+P` |
| 打开文件 / 保存 | `⌘O` / `⌘S` | `Ctrl+O` / `Ctrl+S` |
| 新建临时文件 / 关闭当前标签 | `⌘⌥N` / `⌘W` | `Ctrl+Alt+N` / `Ctrl+W` |
| 文件内查找 / 项目搜索 | `⌘F` / `⌘⇧F` | `Ctrl+F` / `Ctrl+Shift+F` |
| 切换标签 / 显示项目面板 | `⌃Tab` / `⌘B` | `Ctrl+Tab` / `Ctrl+B` |
| 增大、减小、重置编辑器字号 | `⌘⌥+`、`⌘⌥-`、`⌘⌥0` | `Ctrl+Alt++`、`Ctrl+Alt+-`、`Ctrl+Alt+0` |
| 自动换行 | `⌥Z` | `Alt+Z` |

浏览器可能优先处理系统级快捷键。安装在 DBX 桌面版后，可通过工具栏和菜单执行相同操作。

## 数据与权限

打开的项目文件仍在其原来的本地路径，保存时写回原文件。Go Sidecar 以当前用户身份运行，只允许访问用户打开的文件或文件夹范围，并在写入前检查文件修订值。插件不连接外部服务，也不读取 DBX 数据库连接或凭据。

临时文件草稿、最近使用的路径、会话、字体和主题偏好存放在系统用户配置目录下的 `io.github.yuwengueen.dbx-code-editor/drafts/`。在 macOS 上，这通常位于 `~/Library/Application Support/io.github.yuwengueen.dbx-code-editor/drafts/`。界面也使用 DBX 提供的 `host.storage` 保存少量插件状态；插件不会自动把文件内容上传到网络。

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

## 许可证

[Apache License 2.0](LICENSE)。
