# BaaDash MONO 品牌资产

README 和关于页直接使用用户提供的 icon.svg，不使用组合字标；源文件原样保存并复制到 app/ui/public/brand-icon.svg。

采用用户确认的石墨黑背景与细体 C 方案，文字可见高度为图形约 2/3，横版组合尺寸 1600×400。

- logo-mark.svg：用户提供的羊头母版，1024×1024，保持原始路径。
- logo-wordmark.svg / logo-wordmark-dark.svg：新 C 方案组合标，透明背景，分别适配浅／深环境。
- logo-type.svg / logo-type-dark.svg：由 C 方案裁出的纯文字轮廓，用于侧栏等紧凑位置。
- app-icon.svg：石墨黑 #202126 圆角底，羊头使用近黑 #08090B 和白色，圆角外透明。
- app-icon-small.svg：16～48px 派生版，删去部分容易糊掉的速度细线，保留羊头轮廓。

C 方案由 Bahnschrift 字形路径排版而来，不宣称原创字体，未分发其字体程序。母版已转换为路径，不要求用户安装该字体。

## 平台输出

| 格式      | 位置及内容                                                           |
| --------- | -------------------------------------------------------------------- |
| PNG 1024² | logo-mark-1024.png 为原标；app/src-tauri/icons/icon.png 为系统图标   |
| ICO       | app/src-tauri/icons/icon.ico：16/24/32/48/64/128/256px               |
| ICNS      | app/src-tauri/icons/icon.icns：标准与 Retina 共 11 图层，最大 1024px |
| Tauri PNG | 32×32、128×128、128×128@2x（实际 256px）                             |
| 扩展 PNG  | extension/icons/：16/32/48/64/128px，均已在 manifest 声明            |
| NSIS BMP  | app/src-tauri/windows/：164×314 侧栏，150×57 顶部；24 位             |
| 分享 PNG  | social-preview.png：1200×630，网站已接入                             |
| 检查图    | icon-size-check.png：列 16/32/48/128px，行黑／白／灰底               |
| 演示总览  | demo-contact-sheet.png：本轮全部中文演示图                           |

## 生成与检查

在仓库根目录执行 npm ci --prefix tools/brand、npm run build --prefix tools/brand、npm run check --prefix tools/brand。锁文件随脚本提交。

validate.mjs 检查 SVG 编码与矢量元素、PNG 尺寸和透明角、ICO 目录、ICNS 每层尺寸、BMP 位深与尺寸及扩展 manifest 路径，结果写入 validation.txt。

界面图使用 tools/ui/screenshots.mjs 从当前构建后的界面重新渲染，使用确定的模拟数据与 2 倍像素密度。capture-manifest.json 记录所有捕获路径。它们不是原生操作系统截图；原生构建、任务栏与系统图标缓存仍需发布前实机验收。

历史 swiftdlcn-*.png 别名素材已随品牌迁移移除，生产素材统一使用 baadash-* 前缀。
