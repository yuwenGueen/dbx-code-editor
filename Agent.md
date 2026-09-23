# DBX Code Editor 开发约定

本仓库只开发 DBX 的轻量代码编辑器插件。产品文案、README 和界面描述围绕 DBX、本地项目文件与编辑任务展开。

## 工作原则

- 优先完成可运行、可验证的小步功能，保持界面紧凑、键盘可用。
- 只编辑 `frontend/`、`backend/` 和配置源文件。不要手工编辑 `ui/` 或 `dist/` 构建产物。
- 插件 UI 运行在隔离 iframe 中；只通过公开的 `window.dbxPlugin` API 与宿主通信。
- 本地目录访问由 Go Sidecar 执行。所有文件路径必须限制在用户打开的根目录内；符号链接也要校验。
- 保存文件前核对修订值；遇到外部修改时保留用户草稿并显示明确错误。
- 不把连接信息、密钥、文件内容或开发宿主数据写入日志、测试快照或提交。
- 当前阶段只做本地版本；不要推送仓库、创建 Release 或提交 DBX Store。

## 常用命令

在仓库根目录：

```bash
npm ci
npm run check
npm run build
npm run plugin:dev
npm run plugin:package
```

在 `backend/`：

```bash
go test ./...
```

提交前确认 `manifest.json` 的插件 ID、版本与 `backend/main.go` 中的 Sidecar 元数据一致。插件包只包含声明的 `assets/` 与 `ui/`，Go 可执行文件由 DBX 插件 CLI 构建。
