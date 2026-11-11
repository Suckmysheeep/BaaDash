# 第三方资源

## Lucide

- 用途：桌面功能图标，`lucide-static@1.72.0`，仅打包映射使用的 SVG。
- 项目：https://github.com/lucide-icons/lucide
- 映射：`tools/ui/icon-map.json`；生成：`tools/ui/build-icons.mjs`。
- ISC 及所含 Feather 图标许可全文：`app/ui/public/licenses/lucide-LICENSE`，随应用离线分发。

## lucide-animated

- 项目：https://github.com/pqoqubbw/icons ，官网 https://lucide-animated.com/ 。
- 参考版本：`9d1260d2722b63b3846eb97c1141f44f744365ff`，`icons/settings.tsx`、`icons/download.tsx`。
- `app/ui/src/icon-motion.ts` 将设置旋转、下载箭头移动适配为 Web Animations API，并限定触发入口、时长和减少动态效果行为；没有引入 React/Motion 运行时，曲线与原 Motion spring 不完全相同。
- MIT 许可全文：`app/ui/public/licenses/lucide-animated-LICENSE`。
