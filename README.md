# DBX Code Editor

一个运行在 DBX 工作台中的轻量代码编辑器插件。首版面向桌面端的本地项目文件：打开目录、浏览文件树、同时编辑多个 UTF-8 文本文件，并安全保存。

## 当前功能

- 可调宽度的项目面板、目录树与多标签编辑；切换标签会保留撤销历史
- 文件快速查找与命令面板，支持键盘操作目录树
- JavaScript/TypeScript、JSON、Python、SQL、HTML、CSS、Markdown 语法高亮
- 文件内查找与替换、自动换行、常用编辑快捷键
- 未保存状态提示；保存时检测磁盘上的外部修改
- 记住上次打开的目录；跟随 DBX 明暗主题；中英文界面

打开目录时，输入本机绝对路径或 `~/...`。目前只处理 2 MiB 以内的 UTF-8 文本文件；符号链接会显示，但不开放编辑。
文件快速查找会跳过常见的依赖与构建目录，最多索引 4000 个文件和 500 个子目录；达到上限时会在查找面板提示。

## 常用快捷键

| 功能 | macOS | Windows / Linux |
| --- | --- | --- |
| 前往文件 | `Cmd+P` | `Ctrl+P` |
| 命令面板 | `Cmd+Shift+P` | `Ctrl+Shift+P` |
| 保存 | `Cmd+S` | `Ctrl+S` |
| 打开目录 | `Cmd+O` | `Ctrl+O` |
| 文件内查找 | `Cmd+F` | `Ctrl+F` |
| 关闭当前标签 | `Cmd+W` | `Ctrl+W` |
| 按最近使用顺序切换标签 | `Ctrl+Tab` | `Ctrl+Tab` |
| 显示或隐藏项目面板 | `Cmd+B` | `Ctrl+B` |
| 聚焦项目面板 | `Cmd+Shift+E` | `Ctrl+Shift+E` |
| 自动换行 | `Alt+Z` | `Alt+Z` |

编辑区还提供 CodeMirror 的撤销、重做、多光标、注释、折叠和补全快捷键。当前未集成项目级搜索、代码格式化、Git、终端或语言服务器。

## 本地开发

需要 Node.js 22+、Go 1.22+。

```bash
npm ci
npm run check
npm run build
npm run plugin:dev
```

开发宿主启动后，打开它打印的本地地址。它会通过 DBX Host Bridge 运行插件界面和 Go Sidecar。单独打开 `frontend/index.html` 无法访问本地文件。

在 `backend/` 中执行 `go test ./...` 验证文件访问逻辑。生成当前系统的本地测试包：

```bash
npm run plugin:package
```

打包结果在 `dist/`。这是未签名的本地开发包；在 DBX 插件中心启用「允许未签名的开发包」后才可安装。首版只在本地开发，尚未发布。

## 项目文档

- [PROJECT.md](PROJECT.md)：目标、范围、架构与验收标准
- [Agent.md](Agent.md)：后续开发者和 Agent 的工作约定
- [DBX 插件开发文档](https://dbxio.com/cn/docs/plugin-development)
