# QuickShot development rules

- 中文沟通避免使用“不是……而是……”句式。
- 本仓库只维护 Electron 应用，日常开发分支为 `main`。主进程在 `electron/`，界面在 `src/`。
- `native/quickshot-ocr/` 是 Electron 使用的本地文字识别工具，必须保留。独立 Swift/AppKit 应用已归档，不要重新作为正式实现引入。
- 本机正式应用固定为 `/Applications/QuickShot.app`（与 DMG 安装位置一致，不再使用 `~/Applications`）；`release/` 下的文件是构建产物或可恢复备份，不作为日常启动入口。
- 源码更新与应用发布分开。不要因整理源码、切换分支或运行测试而替换、重签或重启已安装应用。
- 用户要求安装更新时，先阅读 `docs/local-macos-release.md`，使用现有安装脚本校验签名兼容性；校验失败时停止，禁止绕过或重置系统录屏授权。
- 保留用户已有改动；移动或清理历史实现前做可恢复备份。不要顺带删除其他 worktree、分支或应用副本。
- 验证命令：`npm run verify`；macOS OCR 验证：`npm run test:ocr-helper`。构建通过不能代替真实截图、预览、保存的交互验证。
- 界面调整先用 `npm run dev:ui` 和 `test-fixtures/` 夹具验证。需要运行开发版 Electron 时，必须设置 `QUICKSHOT_USER_DATA_DIR` 指向独立目录并设 `QUICKSHOT_ENABLE_DEV_SHORTCUT=0`，否则开发版会与已安装应用共用数据目录和单实例锁；用 `QUICKSHOT_DEV_CAPTURE_FILE` 代替真实屏幕，避免触发录屏授权。
- 界面文案统一经过 `src/lib/i18n.ts` 的 `t()` 或 `electron/i18n.ts` 的 `mt()`，中英文同时补齐。
- 源码与已安装包的区别见 `docs/source-of-truth.md`。
