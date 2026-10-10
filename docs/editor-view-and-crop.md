# 编辑器缩放、平移与裁剪

这些功能已加入 `main` 开发源码。已发布的 1.3.3 安装包尚不包含这次更新。

## 查看图片

- 底部的 − / + 放大或缩小画布，也可以输入缩放百分比（1%–800%）。
- **100%** 按截图的原始显示比例查看，**适应窗口** 显示整张图片。
- 滚轮或触控板滚动可平移；按住 Ctrl / ⌘ 滚轮、触控板双指捏合可缩放，缩放以指针位置为中心。
- 点击底部手形按钮拖动画布，或按住空格拖动；鼠标中键也可拖动。
- 查看比例不改变保存、复制或贴图的输出尺寸。长图按可见区域渲染，放大时保留细节。

## 裁剪

1. 点击顶部 **裁剪**（默认 `C`）。
2. 拖动框选要保留的原图区域；拖动框内移动选区，拖边角调整大小；在框外拖动可重新选区。
3. 点 **确认裁剪** 或按回车；点 **取消裁剪** 或按 Esc 放弃。
4. 裁剪和标注使用同一份撤销/重做记录。原图保留，连续裁剪也可逐步撤销。

裁剪保留区域内的标注，部分跨越边界的标注会被裁切。后续 OCR、智能打码、保存、复制和贴图使用裁剪后的内容。再次拼接时，以当前裁剪结果作为第一张图片，撤销仍能恢复裁剪前的来源。

裁剪、放大、缩小、原尺寸和适应窗口的快捷键可以在设置中修改。默认缩放键为 `⌘/Ctrl =`、`⌘/Ctrl -`、`⌘/Ctrl 0`、`⌘/Ctrl 9`。

## 本地验收

先启动 `npm run dev:ui`，在以下夹具中验证；开发服务器不启动正式应用、不调用录屏授权：

- [普通截图](http://localhost:5188/test-fixtures/screenshot-preview.html?windowType=screenshot-preview&sessionId=1&fixtureSource=/test-fixtures/sample-ui.svg&scaleFactor=2)
- [3 万像素长图](http://localhost:5188/test-fixtures/screenshot-preview.html?windowType=screenshot-preview&sessionId=1&fixtureSource=/test-fixtures/long-grid.svg&scaleFactor=1&style=%7B%22beautify%22%3Afalse%7D)

点击夹具里的“保存到下载”后，可以用“下载导出的 PNG”获取实际生成的图片，检查尺寸与内容。构建和测试命令为 `npm run verify`；OCR 原生工具检查为 `npm run test:ocr-helper`。
