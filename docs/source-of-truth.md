# 唯一维护的应用源码

## 开发入口

- 仓库：`/Users/lank/code/quickshot`
- 日常开发分支：`main`
- 实现：Electron + React + TypeScript
- 主进程、系统截图和 IPC：`electron/`
- 截图预览、标注、背景和导出：`src/`
- 本地文字识别：`native/quickshot-ocr/main.swift`
- 测试和构建工具：`scripts/`、`test-fixtures/`、各模块的测试文件

独立的 Swift/AppKit 应用不再放在维护源码中。OCR 的 Swift 工具仍是 Electron 的必要组件，不能因为使用 Swift 就删除它。

## 已安装应用与源码更新

本机日常使用入口固定为 `/Applications/QuickShot.app`。

2026-09-25 整理时，该包的 `app.asar` SHA-256 为：

```text
20d108fea1ff8839b7150931e5a4b9e67278f173ccf1b6ec20a557e62e9c5bff
```

这是先前为恢复录屏授权而保留的 Electron 包。本次保留了工作区内后续的 Electron 功能与修复，包括文字提取、悬浮置顶、截图稳定性、可调背景边距、预览与导出一致性和高清渲染等更新。

当前源码含有已安装包之后的更新，不能将其称为该包的逐字节可重建快照。安装包不包含源码映射，单凭包内容无法证明每个源码文件对应哪个历史版本。本次没有从压缩后的程序反推源码，也没有丢弃后续更新。

整理源码、切换分支和运行验证不会发布这些更新。正式替换应用前必须完成 [本机更新流程](local-macos-release.md) 的签名身份检查及实际截图验证；不重新命名应用，不重置 TCC，不绕过签名检查。

## 本次归档与恢复

2026-09-25 的整理备份位于：

```text
release/source-backups/electron-main-20260925-gEPoPs/
```

- `workspace-source.tar.gz`：整理前全部 132 个受版本管理或未被忽略的源文件，包含当时的未提交更新。
- `manifest.json`：整理前分支、提交、文件哈希和已安装包哈希。
- `verified-source/`：已解压并逐文件验证内容和权限的恢复副本。
- `tracked-updates.patch`：整理前相对 HEAD 的已有跟踪文件改动。
- `repository.bundle`：整理前 Git 引用和提交历史。
- `retired/native-macos/`：独立 Swift 应用源码及原有构建缓存，完整移动保留。
- `retired/scripts/`：独立 Swift 应用的构建、安装与图标导出脚本。
- `retired/design-qa.md`：独立 Swift 界面的历史检查记录。

恢复时先将归档解压到一个新目录，对照 manifest 校验后再挑选需要的文件，不要直接覆盖当前工作区或正式应用。

归档由 `release/` 的现有忽略规则排除，不会提交进日常源码；测试入口同样排除 `release/`，避免重复运行恢复副本中的测试。其他 worktree、历史分支、旧应用包和远程仓库未在本次操作中删除或改写。

## 整理后的验证

- 132 个原始源文件全部可追溯：96 个保留文件及 33 个归档文件内容未变，另外 3 个文件仅做入口文档和测试范围整理。
- `npm run verify` 通过：12 个测试文件、60 项测试、TypeScript/Vite 构建及产物体积检查。
- OCR 工具从保留源码重新编译成功，中英文两行识别样例通过。受限沙箱内的 `sips` 图片转换失败，使用相同脚本在沙箱外复验通过，未为此修改应用代码。
- 已安装应用签名校验通过，`app.asar` 哈希与整理前一致；未执行应用替换、重签或授权重置。
- 本轮没有重做真实屏幕框选、预览与保存的交互验证，也没有发布新版应用。
