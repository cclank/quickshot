# QuickShot 1.3.10

## 改动

- 新截图的浮层与二次编辑主窗口默认回到选择工具（默认快捷键 `V`），覆盖首次打开及后台窗口复用；同一张截图内正常保留当前工具。
- 不再持久化当前工具，忽略旧版保存的工具键；继续保留工具样式、美化偏好及传入编辑器的可编辑标注。
- 编辑器新会话同时清理上一张图的文字草稿、标注选择及临时平移状态，避免后台窗口复用时继续编辑旧图内容。
- 选区四边和四角显示对应方向的缩放光标，使用马赛克、数字等工具时也生效，拖动时保持光标；沿用现有选区命中及缩放几何逻辑。
- 同步 `package.json` / `package-lock.json`，补充说明和无头 Chrome 交互回归，并接入 Linux CI。

## Changes

- Every new capture starts with Select (default shortcut: `V`) in both the capture overlay and the editor, including reused windows. The active tool remains unchanged while working on the same capture.
- Active tools are no longer persisted. Legacy tool keys are ignored; tool styles, presentation preferences and editable incoming annotations are preserved.
- Selection edges and corners show directional resize cursors, including while annotation tools are active and during resizing. Existing hit targets and resize geometry are unchanged.

## 验证与交付边界

- `npm run verify`：单元测试、TypeScript/Vite 构建与既有体积限制。
- `npm run test:ocr-helper`：本机 Swift 辅助工具编译及中英文 OCR 样例。
- `npm run test:capture-interactions`：固定图片与模拟 IPC 下的工具复位、边框光标、缩放和提交尺寸；临时 Chrome 配置独立，服务器自动关闭。
- 本轮为源码及 PR 更新，不创建公开 Release、不修改官网或更新源、不替换或重启已安装应用。真实系统截图、正式应用预览及磁盘保存尚需发布时验收。

实现及手工验收入口：[截图浮层工具栏](capture-overlay-toolbar.md)、[编辑器](editor-view-and-crop.md)、[本机发布流程](local-macos-release.md)。
