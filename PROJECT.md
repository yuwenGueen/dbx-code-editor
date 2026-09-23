# 项目信息：Code Editor for DBX

## 定位

在 DBX 桌面工作台中提供本地项目文件编辑能力。当前已实现项目树、多标签、临时草稿、语法模式、Markdown 预览、文件与项目搜索、会话恢复，以及保存前的外部修改检测。发布工作流构建 macOS、Windows 和 Linux 桌面包。

## 结构

- `frontend/`：TypeScript、Vite、CodeMirror 6 的工作台界面。
- `backend/`：Go Sidecar，通过 DBX JSON-RPC 桥接读取和保存用户选定的本地文件。
- `manifest.json`：插件身份、工作台、Sidecar 与 `host.storage` 权限。
- `assets/`：插件图标。
- `ui/`：构建输出；由 `npm run build` 生成，不手工修改或提交。
- `dist/`：未签名 `.dbxp` 及元数据；由插件 CLI 生成，不提交。

Sidecar 只为已打开的文件或项目目录建立访问范围；项目搜索跳过符号链接。保存请求携带原始文件修订值，发现外部修改时拒绝覆盖，写入同目录临时文件后替换。macOS 选择器通过 `/usr/bin/osascript` 调用，Windows 使用 PowerShell 的系统对话框，Linux 使用 `zenity` 或 `kdialog`；重复的选择请求会被忽略。

草稿和编辑器偏好存放在用户配置目录的 `io.github.yuwengueen.dbx-code-editor/drafts/`；项目文件仍保存在用户选定的原路径。插件不访问网络或 DBX 的数据库连接。

## 当前边界

- 现有文件上限 32 MiB；临时草稿上限 1 MiB。
- 编码自动识别有歧义时，需要用户手动选择编码重新打开。
- 终端、问题面板只有预留布局；Git、语言服务器、格式化、重命名与删除文件尚未实现。
- Windows 与 Linux 的选择器和完整桌面体验仍需在对应系统上验收；Linux 没有 `zenity`/`kdialog` 时可通过路径打开文件夹。

## 验证与发布

提交前运行 `npm run check`、`npm run build`、在 `backend/` 中运行 `go test ./...`，并用 `npm run plugin:package` 构建候选包。`manifest.json` 的 ID 和版本必须与 Go Sidecar 元数据一致。发布时为每个经过验证的平台上传未签名 `.dbxp` 和 `.artifact.json`，由 DBX Store 审核、签名并纳入目录。
