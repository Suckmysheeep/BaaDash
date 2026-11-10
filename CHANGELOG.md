# 更新日志

BaaDash 的重要变更记录于此。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号参考[语义化版本](https://semver.org/lang/zh-CN/)。

版本记录从 BaaDash 立项起算。此前的开发历史（上游 SwiftDL 0.1.0～0.3.5 与早期中文分支 0.3.6～0.4.0）见 [历史更新日志](docs/CHANGELOG-archive.md)。

## [Unreleased]

暂无。

## [0.1.0] - 2026-11-10

BaaDash 的首个正式版本，以新的项目身份发布，承接此前中文分支的功能积累。

### 下载引擎

- 对支持 HTTP Range 的服务器进行多连接分段下载，动态把剩余分段分配给空闲连接；不支持时自动回落单连接。
- 断点续传、失败重试与退避；全局限速与同时下载数量可配置。
- 校验分段响应范围、续传记录和已知文件长度，不一致时停止或重新下载，避免直接拼接错误内容。
- 保存任务或设置失败时明确提示，并记录调试日志。

### 桌面端

- Windows、macOS 与 Linux 三平台，基于 Rust 与 Tauri 2。
- 任务队列与分类目录整理：视频、音乐、程序、压缩文件、文档、图片。
- 暂停、继续、重试，以及多选、Shift 连选、全选与批量操作。
- “清理历史”只处理当前视图中的已完成与失败记录，默认保留已下载文件与失败任务临时数据；清理后界面立即刷新。
- 命令面板（Ctrl / Cmd + K）、深浅主题、系统托盘与通知。
- 关于页可手动检查更新并查看结果，后台自动检查同时保留。
- 从整段分享文字中提取 HTTP / HTTPS 链接，去重后批量导入，可选择立即或稍后下载。
- 下载前确认文件信息与保存目录，下载中显示速度、进度与连接状态。

### 浏览器扩展（BaaDash 下载助手）

- 接管浏览器普通下载，随任务携带 Cookie、Referer 与 User-Agent。
- 资源嗅探、视频浮层与图片浮层分别控制；图片浮层默认关闭，可按站点单独开启。
- 视频入口延迟出现、静止约 2 秒自动隐藏；排除播放器封面与常见导航图片，减少误出现和按钮重叠。
- 鼠标悬停网页大图显示下载按钮；可收集当前页面已加载的图片并自动去重。
- 支持 Pixiv 当前静态作品与 ugoira 动图，X 视频按钮会定位所属推文。
- 支持 Chromium 系浏览器（Chrome、Edge、Brave、Vivaldi）与 Firefox 140+。
- 右键菜单区分“下载链接”与“下载图片／媒体”，按住 Alt 点击链接可临时交给浏览器下载。

### 视频与格式

- HLS / DASH 流媒体：多连接抓取分片后合并为单个 MP4，支持 AES-128 与音视频分离，可暂停续传。
- 可解析站点提供清晰度选择；保留 yt-dlp 与 FFmpeg 集成作为兜底。
- 视频下载后可另存 GIF：支持片段起止、最长边、帧率与 64 / 128 / 256 色，始终保留原视频。
- 支持 BitTorrent 种子与磁力链接。

### 中文体验与品牌

- 完整简体中文界面，应用与扩展内置 Noto Sans SC 可变字体，随附 SIL Open Font License。
- 中文文件名保留 Unicode 字符，清理 Windows 非法字符与过长名称；同名文件使用全角中文编号，如 `奶龙（1）.mp4`。
- 品牌统一为 BaaDash：石墨黑 MONO 图标与细体 C 字标，重新生成 Windows、macOS、Linux 全套图标与安装器素材。
- README、官网与全部界面展示图按新品牌重做。

### 工程与发布

- GitHub Actions 在打 tag 后构建 Windows、macOS、Linux 安装包与两个浏览器扩展包，按 CHANGELOG 生成中文 Release 说明。
- 提供品牌资源生成与校验脚本（SVG、PNG、ICO、ICNS、BMP），以及界面截图重拍工具链。
- 发布包命名统一为 `BaaDash_*_x64-setup.exe`、`BaaDash_*_universal.dmg`、`baadash-extension.zip`、`baadash-firefox.xpi`。

### 说明

- 为兼容已有安装与扩展授权，内部应用标识 `com.swiftdl.app`、原生消息主机名、Firefox 扩展 ID 与 Chromium 扩展密钥暂时保留；对外名称与发行包名已统一为 BaaDash。
- 分享文本功能只提取普通链接，不增加站点专用解析，不绕过登录、会员、DRM 或网站访问限制。
- 多连接不能突破实际带宽，速度取决于服务器、网络与磁盘；续传取决于服务器是否支持及文件是否变更。

[Unreleased]: https://github.com/Suckmysheeep/BaaDash/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Suckmysheeep/BaaDash/releases/tag/v0.1.0
