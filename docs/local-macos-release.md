# 本机 Electron 更新流程

本机使用的应用固定为 `/Applications/QuickShot.app`（与 DMG 拖入的位置一致），名称保持 `QuickShot`，不附加版本号、不创建带版本号的第二个应用。维护分支为 `main`，Electron 实现位于 `src/` 和 `electron/`，本地 OCR 工具位于 `native/quickshot-ocr/`。独立 Swift 实验版本已移入可恢复归档，详见 [源码维护入口](source-of-truth.md)。

更新步骤：

1. 内部版本仅用于构建核验；需要修改时同步 `package.json` 和 `package-lock.json`，不要拼到应用名或托盘文字中。
2. 执行 `npm run test`。
3. 执行 `npm run install:mac:local`，构建并安装当前版本。
4. 核对安装回执与实际进程路径，再用 ⌘⇧X 验证选区、预览和保存。

安装脚本会校验包内主进程、预加载脚本和页面文件是否与本次构建一致，并验证签名和已安装应用的 designated requirement。新包必须满足旧包的签名身份要求，否则在停止进程或改动安装目录之前退出。这项检查同样适用于 ad-hoc 包，不可因为名称、路径或版本相同就跳过。

全部检查通过后，脚本才会停止同一 Bundle ID 的旧进程，保留安装包备份，再启动固定路径的新应用。它会撤销其他同 Bundle ID 副本的注册，并通过 NSWorkspace 核对唯一注册路径和默认路径均为当前应用，再确认只有一个 QuickShot 主进程。此操作不删除构建包。

新备份保留在 `~/Library/Application Support/quickshot/app-backups.noindex/`，不在应用目录中保留旧副本。注意：`.noindex` 不能保证 LaunchServices 不重新注册原始应用包；长期备份应压缩为 ZIP 并验证可恢复性。早期 `~/Applications/.quickshot-backups/` 中的备份仍可恢复；禁止直接从备份目录启动应用。

仅检查、完全不安装或重启：`node scripts/install-electron-mac.mjs --check`。

`release/last-local-install.json` 记录安装时间、实际路径、版本、进程号和文件哈希，可用于确认“源码已改，应用是否已更新”。

早期安装在 `~/Applications/QuickShot.app` 的副本，会在下次运行安装脚本时移到 `app-backups.noindex/legacy-home-*` 并取消注册，避免两份应用争用单实例锁和录屏授权。

自动化截图入口：`open -n "/Applications/QuickShot.app" --args --capture-region`。这会调用正常的系统选区流程；按 Esc 取消。`--capture-scroll` 直接进入滚动截图（macOS 14 起），框选后滚动页面，回车完成、Esc 取消。`--settings` 打开设置窗口（快捷键、语言、选区方式、登录时启动）。

本机签名以打包时实际可用的身份为准。ad-hoc 签名的 designated requirement 绑定构建哈希，每次构建都会变化，系统会把新包当作另一个应用而要求重新授权。因此本机使用登录钥匙串中的自签名代码签名证书 `QuickShot Local Signing`（2026-10-09 创建并完成迁移），签名脚本显式指定 `identifier "com.quickshot.app" and certificate leaf = …`，跨构建保持不变；日常更新直接运行 `npm run install:mac:local`，签名兼容性校验通过后原位替换。

截至公开版 1.3.3，CI 尚未配置固定证书，公开包仍使用 ad-hoc 签名。将公开版覆盖到本机构建上会改变签名身份，需要重新授权；本机构建带有 `local-build` 标记，会跳过自动更新检查。只有以后按 [发布签名配置](release-signing.md) 在 CI 启用同一证书并通过验签，才可以在两种构建间保持签名身份。

在没有这张证书的机器上：签名脚本会报错停止。可以在「钥匙串访问 → 证书助理 → 创建证书」中创建同名的自签名根证书（类型选“代码签名”），再运行一次 `node scripts/install-electron-mac.mjs --migrate-signing`；这次迁移需要用户重新授权一次。只有用户明确接受每次重新授权时，才使用 `--accept-reauthorization` 安装 ad-hoc 包。遇到签名不兼容应停止安装并向用户说明，不能承诺绝不弹窗。

安装脚本不会重置录屏授权、修改 TCC 数据库、放宽签名验证或自动安装信任证书。签名身份核验通过也不能代替用户实际截图的权限验收。

如果用户已打开权限仍持续弹窗，先读取仅筛选 `com.quickshot.app` 的 macOS TCC 诊断日志，对比授权记录的 CodeReq、实际请求所校验的 CodeReq 以及 `self.bundle` 路径。发生旧副本混用时，先撤销重复应用注册、将应用目录里的旧副本移到可恢复的非索引备份目录、原签名重启现有应用；不要直接再构建覆盖或重置全部权限。安装完成必须核对唯一注册路径，不能仅凭主进程路径正确就认定系统关联已更新。

清理重复注册不等于授权问题已解决。如果后续请求仍校验旧 CodeReq，应在保留新包和源码的前提下，恢复完整的、曾实际截图成功且匹配该 CodeReq 的原包，不要再次重签该原包。恢复后必须在实际安装的应用进程中验证授权和真实截图调用；只看到 `granted`、选区进程启动或单元测试通过均不足以宣称恢复。详情见 [本次权限恢复记录](permission-recovery-2026-09-05.md)。
