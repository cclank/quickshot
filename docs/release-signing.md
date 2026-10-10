# macOS 发布签名

macOS 把录屏权限记在应用的签名身份（designated requirement）上。ad-hoc 签名的身份绑定构建哈希，每次构建都会变，更新后可能需要重新授权。本机安装已使用自签名证书 `QuickShot Local Signing`（2026-10-09 创建，2036-10-06 到期）。截至公开版 1.3.1，CI 尚未配置这张证书，公开包仍使用 ad-hoc 签名。以下配置步骤用于在决定启用 CI 签名时统一两种构建的身份：

```
identifier "com.quickshot.app" and certificate leaf = H"04da0be632515e04ce46fe9be3f36a8ee76597c6"
```

这个值写在 `scripts/mac-signing-policy.mjs` 的 `RELEASE_REQUIREMENT` 中。本机构建由 `scripts/sign-mac-local.mjs` 显式指定证书和 designated requirement 后签名。配置 `CSC_LINK` 后，发布构建由 CI 导入证书，再由 `scripts/mac-sign.mjs` 签名。macOS 把这张自签名证书判定为“不受信任”，electron-builder 默认会跳过它并退回 ad-hoc 签名，`mac-sign.mjs` 负责改用导入的证书。启用证书签名后，CI 会运行 `scripts/check-mac-signature.mjs` 核对两个架构的应用，签名身份不符时发布失败；未配置证书时，这项检查会跳过。

## 对公开版用户的影响

- 第一个用证书签名的版本发布后，之后的每次更新都会保留录屏权限。
- 从 ad-hoc 签名的旧版（包括 1.3.1）升级到第一个证书签名版本时，用户还需要重新授权一次。
- 证书没有经过 Apple 公证，首次打开 DMG 里的应用仍会出现“无法验证开发者”提示，处理方式与以前相同。应用内自动更新会清除隔离属性，所以不会再出现这个提示。
- CI 启用同一本机证书并通过验签后，本机安装和公开版才能保持相同身份。当前两种构建的签名身份不同。

## 私钥保管

私钥代表 QuickShot 的身份：拿到它的人能做出继承用户录屏权限的程序。它只放在 GitHub Secrets 和你自己的加密备份里，不要提交进仓库，也不要发给别人。证书一旦丢失，只能换新证书，所有用户都要重新授权一次。

## 配置步骤（只需一次）

1. **导出证书和私钥。** 打开「钥匙串访问」，在左侧选「登录」，上方选「我的证书」，右键「QuickShot Local Signing」，选「导出」。格式选「个人信息交换 (.p12)」，存为桌面上的 `quickshot-signing.p12`，设置一个导出密码，再按提示输入登录密码允许导出。请只导出这一项：命令行的 `security export` 会把钥匙串里所有身份一起导出。

2. **核对导出的文件。** 下面的命令会提示输入导出密码：

   ```bash
   openssl pkcs12 -in ~/Desktop/quickshot-signing.p12 -nokeys | openssl x509 -noout -subject -fingerprint -sha1
   ```

   输出应包含 `CN=QuickShot Local Signing` 和 `04:DA:0B:E6:32:51:5E:04:CE:46:FE:9B:E3:F3:6A:8E:E7:65:97:C6`。

3. **上传到 GitHub Secrets。** 第一条上传证书文件：

   ```bash
   base64 -i ~/Desktop/quickshot-signing.p12 | gh secret set CSC_LINK --repo cclank/quickshot
   ```

   第二条会提示粘贴导出密码，密码不会显示在屏幕上，也不会进入命令历史：

   ```bash
   gh secret set CSC_KEY_PASSWORD --repo cclank/quickshot
   ```

4. **备份后删除桌面文件。** 把 `.p12` 和导出密码存进密码管理器或其他加密备份，然后删除桌面上的文件：

   ```bash
   rm ~/Desktop/quickshot-signing.p12
   ```

5. **试跑一次。** 手动运行 Release 工作流，它只打包、不发布：

   ```bash
   gh workflow run release.yml --repo cclank/quickshot --ref main
   ```

   在 macOS 任务里，「Check the macOS signature」步骤会打印两个 `QuickShot.app` 的签名身份，都应以 `certificate leaf = H"04da0be6…"` 结尾。

之后照常推送 `v*` 标签发版即可。Windows 安装包不使用这张证书。

## 换证书

只有证书丢失或泄露时才换。新建证书后，同时更新 `RELEASE_REQUIREMENT`、本机钥匙串和 `CSC_LINK`，并在发布说明里提醒用户需要重新授权一次。
