# BaaDash 功能演示源文件

launch.html 使用本轮重拍的界面图、MONO 图标和 C 字标，48 秒，完全由本地文件组成，不加载第三方视频网页或外部字体。

先构建 app 并运行 tools/ui 的截图脚本，再在此目录 npm install。node render.mjs --still 2,10,20,29,38,45 可导出关键帧；node render.mjs 可通过 FFmpeg 导出横版 MP4。设置 CHROME / FFMPEG 可指定路径。

这些画面明确标识模拟任务与速度，不是下载测速。移除旧的第三方页面捕获工具，演示只使用本地重新拍摄的界面。未生成的视频不能仅凭源文件声称已经渲染或通过验收。
