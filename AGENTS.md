# QuickShot development rules

- 中文沟通避免使用“不是……而是……”句式。
- 本仓库只维护 Electron 应用，日常开发分支为 `main`。主进程在 `electron/`，界面在 `src/`。
- `native/quickshot-ocr/` 是 Electron 使用的本地文字识别工具，必须保留。独立 Swift/AppKit 应用已归档，不要重新作为正式实现引入。
- 本机正式应用固定为 `/Users/lank/Applications/QuickShot.app`；`release/` 下的文件是构建产物或可恢复备份，不作为日常启动入口。
- 源码更新与应用发布分开。不要因整理源码、切换分支或运行测试而替换、重签或重启已安装应用。
- 用户要求安装更新时，先阅读 `docs/local-macos-release.md`，使用现有安装脚本校验签名兼容性；校验失败时停止，禁止绕过或重置系统录屏授权。
- 保留用户已有改动；移动或清理历史实现前做可恢复备份。不要顺带删除其他 worktree、分支或应用副本。
- 验证命令：`npm run verify`；macOS OCR 验证：`npm run test:ocr-helper`。构建通过不能代替真实截图、预览、保存的交互验证。
- 源码与已安装包的区别见 `docs/source-of-truth.md`。
