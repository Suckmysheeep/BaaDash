# 历史更新日志（归档）

> 本文件保存 BaaDash 重立项之前的开发历史，仅供追溯。
> 其中 0.1.0～0.3.5 为上游 [harshsinghsv/swiftdl](https://github.com/harshsinghsv/swiftdl) 的记录，0.3.6～0.4.0 为此前中文分支（旧仓库已归档停用）的记录。
> BaaDash 现行的版本记录见 [CHANGELOG.md](../CHANGELOG.md)。

---

# 更新日志

BaaDash（原 SwiftDLCN）的重要变更记录于此。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号参考[语义化版本](https://semver.org/lang/zh-CN/)。上游历史版本记录保留在下方。

## [Unreleased]

## [0.4.0] - 2026-11-10

### 功能完善

- 浏览器资源嗅探、视频／图片浮层独立控制，图片浮层默认关闭，并支持单站点开启。
- 视频入口延迟显示、静止自动隐藏；排除播放器封面，避免浮层重叠。
- 设置页固定关闭入口；下载列表增加显式多选与批量操作。
- 当前视图历史清理默认保留文件与失败任务临时数据。
- 关于页增加手动检查更新和结果反馈。
- 下载引擎增加分段响应、续传数据与接收长度校验，保存失败时提示。

### 品牌与介绍

- 采用石墨黑 MONO 图标和细体字标。
- 重新生成跨平台资源，全部演示图重拍，README 与官网介绍重写。
- 保留应用标识、数据目录、原生消息主机和当前更新来源；发布到原仓库，保留旧版数据与通信标识。

## [0.3.7] - 2026-11-10

### 新增

- 鼠标悬停在网页大图时显示「下载」按钮；扩展弹窗可一键下载本页已经加载的大图，自动去重，每批最多 100 张。
- Pixiv 图片按钮优先读取当前图片原图，扩展弹窗可下载当前静态作品的全部原图；静态作品页面数据读取失败时回退到已暴露的图片地址。
- Pixiv 当前 ugoira 作品可下载原始 ZIP 帧包，按逐帧延迟通过本地 FFmpeg 合成循环 GIF，原始 ZIP 保留。
- 普通 MP4、WebM、MOV 等直接视频文件可在下载后通过本地 FFmpeg 另存为循环 GIF，始终保留原视频。
- X 搜索页和时间线上的视频按钮会定位所属推文；普通直接视频和可解析的 X 视频可下载后另存 GIF。
- GIF 默认转换整段视频和原始尺寸，也可自定义开始／结束秒数、最长边、帧率和 64／128／256 色，不设固定 20 秒上限。

### 修复

- 主界面空任务页不再遮挡顶部「添加扩展」横幅，恢复点击打开扩展安装指南。
- 媒体识别下限从 512 KiB 调整为 32 KiB，避免漏掉 X 常见的短 MP4；分段流媒体过滤保持不变。
- X 视频使用 yt-dlp 时优先选择实际存在的单文件格式，下载先写入同目录短 ASCII 临时文件名，再重命名为 Unicode 目标文件名，降低特殊字符路径触发临时文件错误的概率。
- Pixiv 动图元数据读取失败时明确报错，不再静默回退成单帧 JPG。

### 说明

- README 补充未签名 Windows 安装包的 SmartScreen 提示、官方下载来源核对和“更多信息 → 仍要运行”操作说明；安装包本身仍需代码签名证书才能消除“发布者未知”。

### 调整

- 图片和 GIF 快捷任务直接进入主下载队列，不逐张弹出确认窗或进度窗。
- 大批量任务通过短期本地任务文件传递，避免长网址和 Cookie 超出 Windows 命令行长度限制。

## [0.3.6] - 2026-11-10

### 新增

- 基于上游 SwiftDL 0.3.5 完成主窗口、下载窗口、设置、命令面板、系统托盘、通知及浏览器扩展的简体中文适配。
- 应用与扩展本地内置完整的 Noto Sans SC 可变字体，并附带 SIL Open Font License 许可证。
- 使用独立品牌 SwiftDLCN，提供新图形标、右上角小号 CN 字标、各尺寸应用图标及 Windows 安装器素材。
- 支持从整段中文分享文本中提取 HTTP／HTTPS 链接，批量去重导入并选择立即或稍后下载。
- 浏览器右键菜单区分「下载链接」和「下载图片／媒体」。
- 新增中文界面展示图，演示任务和地址均为虚构数据。

### 调整

- 项目仓库、扩展下载链接与更新检查统一指向当时的中文分支仓库（已归档停用）。
- 新下载按“视频、音乐、程序、压缩文件、文档、图片”整理到中文分类目录。
- 文件名保留中文及其他 Unicode 字符，清理 Windows 非法字符、保留设备名和过长名称。
- 同名文件自动使用全角中文编号，例如 `奶龙（1）.mp4`。
- GitHub Actions 构建 Windows、macOS、Linux 安装包和浏览器扩展，并发布到 SwiftDLCN Releases。

### 安全边界

- 分享文本功能只提取普通链接，不增加站点专用解析，不绕过登录、会员、DRM、网盘限制或反爬机制。

## [0.3.5] - 2026-11-07

### Fixed

- YouTube downloads for signed-in browsers. The browser's YouTube cookies
  made the quick lookup find no formats, so the download fell back to a slow,
  single-connection yt-dlp run after 10-15 seconds. Quick lookups now go
  without cookies; the lookup with a JavaScript runtime keeps them.
- YouTube is looked up with the JavaScript runtime first, which solves its
  speed checks; without that, its servers send the file at a crawl.

### Changed

- The video quality menu is one short row per quality with its size, and
  fits without a scrollbar.
- On YouTube, the lookup starts once the pointer rests on a video for a
  second (not on every video watched), so the download usually starts the
  moment a quality is picked.

## [0.3.3] - 2026-11-07

### Added

- **Instant quality menu on any site.** The extension reads the qualities of
  the stream the page is already playing (HLS or DASH) and, on YouTube, from
  the player itself, so 1080p, 4K and the rest show at once.
- **SwiftDL downloads streams itself.** HLS and DASH pieces are fetched many
  at a time with the browser's cookies and joined into one MP4, with no wait
  for yt-dlp. Handles AES-128 streams, separate audio, and pause/resume.
- **Faster YouTube.** The video is looked up while you pick a quality, then
  downloaded directly over 16 connections (yt-dlp stays as the fallback).

### Changed

- The new logo everywhere: app, tray, installer, extension.
- A styled Windows installer (sidebar and header art, SwiftDL icons).
- The quality and category menus match the app instead of the system list.
- The app notices the extension within seconds of it being added.
- Tools (ffmpeg, yt-dlp) download over 8 connections; ffmpeg takes about a
  minute instead of up to twenty.
- The New download window says what it is actually waiting for, and gives
  up after 90 seconds instead of spinning forever.

## [0.3.2] - 2026-11-07

### Added

- **HLS and DASH streams** (`.m3u8` and `.mpd`). Videos that stream in
  pieces now download: the extension's video button and popup offer the
  stream, the New download window lists its qualities, and the pieces are
  joined into one MP4. Pasting a stream link into New download works too.
  The page's cookies, referrer and user agent go along, since stream
  servers often check them.
- **Update notifications.** SwiftDL checks GitHub for a new release a few
  seconds after it starts and twice a day. A banner shows the new version
  with "What's new" and an install button: on Windows it downloads the
  installer, closes SwiftDL, updates and reopens it; on macOS it downloads
  the .dmg, and on Linux it opens the release page. A skipped version stays
  quiet until the next one.
- **SwiftDL Integration is on Firefox Add-ons**
  (https://addons.mozilla.org/firefox/addon/swiftdl-integration/). Add to
  Firefox in Settings → Browser now opens the listing instead of the
  temporary-add-on steps.

### Changed

- **The interface is TypeScript.** `app/ui` is built by Vite in strict
  TypeScript, and every call to the backend is checked against the Rust
  types, so a mismatch is a build error. The look is unchanged.

### Added

- **Debug log.** SwiftDL writes what it does and any errors (failed
  downloads, yt-dlp errors, crashes) to `swiftdl.log` in its data folder.
  Settings → About → Open log, to attach to a bug report. (#4)

### Fixed

- **"Couldn't reach SwiftDL" from the video button** when the app was
  closed. The browser starts SwiftDL for each download, and a start that
  failed once is now retried. The message also says what really went wrong:
  after the extension is updated, pages that were already open must be
  reloaded, and the button now says so instead of blaming the app.
- **Pasting a YouTube or magnet link froze the app** on Windows: the New
  download window was created on the main thread, which deadlocks WebView2.
  Windows are now created on their own thread. (#4)
- Double-clicking a running download did nothing: the row's details are
  redrawn every half second, which swallowed the second click.
- The extension guide showed the folder path without its backslashes when
  SwiftDL couldn't look it up.
- Reading a video page gives up after 20 seconds without an answer instead
  of waiting forever.
- **Chromium forks can connect** (Helium, Thorium, ungoogled-chromium, Opera
  and others): on macOS and Linux SwiftDL now registers its native messaging
  host in any Chromium-style profile folder, not only five known browsers. (#2)
- **YouTube on systems without a bundled JavaScript runtime**: yt-dlp is told
  to use Deno, Node, Bun or QuickJS when one is installed, videos that only
  offer separate video and audio streams still download, and a missing
  runtime gets a clear message instead of "Requested format is not
  available". (#3)
- **Add the extension did nothing**: the banner was rebuilt every 15 seconds,
  which could swallow the click. (#1)

### Changed

- **One way to add the extension.** The banner, the empty state, the command
  palette and Settings → Browser all open the same guide. Each installed
  browser has an _Add to …_ button that opens that browser's extensions page
  and copies the folder path, and the guide closes by itself as soon as the
  extension connects. (#1)
- Settings → Browser explains how to stop the browser's own Save As prompt
  showing as well as SwiftDL's. (#4)
- Settings → Browser shows the browsers' real logos, with status as text, and
  hides Save and Cancel when there's nothing to save.

## [0.3.1] - 2026-11-04

### Fixed

- **Magnet links and .torrent files did nothing** when you clicked Start
  download or Download later: adding a download only accepted web links, and
  the window didn't show the error. Magnet links and .torrent files on your
  computer are now accepted, pasting a magnet link into New download works,
  and any error adding a download is shown in the window.

### Added

- **Firefox add-on.** The extension now runs in Firefox 140 and later, built
  from the same code with Firefox's manifest and shipped with the app and as
  `swiftdl-firefox.xpi`. SwiftDL registers its native messaging host for
  Firefox, and Settings → Browser lists Firefox.

## [0.3.0] - 2026-11-01

### Added

- **Torrents and magnet links.** SwiftDL downloads torrents with its own
  BitTorrent engine (librqbit): the New download window lists the files to
  pick from, and progress shows peers and seeds.
- **Opens magnet links and .torrent files.** SwiftDL registers as the
  computer's handler for both on Windows, macOS and Linux, and the browser
  extension sends magnet links and .torrent downloads to it.
- **Seeding choice.** Settings → General → After a torrent finishes: stop
  sharing, share until a ratio of 1 or 2, or keep sharing. The download is
  ready either way.

## [0.2.3] - 2026-10-31

### Changed

- The download window's progress bar is a solid, easy-to-read bar instead of a
  thin line, and the status no longer starts with a coloured dot.

## [0.2.2] - 2026-10-31

### Added

- **Theme setting.** Settings → General → Theme: System (follow the computer's
  light or dark mode), Light or Dark. Picking one previews it at once, and open
  download windows follow it.

### Fixed

- The extension's "Download video" button no longer breaks onto two lines on
  large videos.

## [0.2.1] - 2026-10-30

### Added

- **YouTube and other video sites.** The video button, the popup and the New
  download window offer each quality, from 4K down to audio only. These sites
  go through yt-dlp, with ffmpeg joining video and audio; both are fetched on
  first use (ffmpeg comes from the system on macOS and Linux) and yt-dlp is
  checked for updates daily. The download window shows yt-dlp's progress and
  steps such as merging.

### Changed

- **Adding the extension is a guided step.** Until the extension is on the
  Chrome Web Store, _Add the extension_ opens a four-step guide that points at
  the copy SwiftDL installs, with a button to open that folder, instead of
  store buttons that led nowhere. The automatic-offer switch is hidden until
  the listing exists.
- **Simpler extension popup.** A compact menu in the app's style: the status
  under the name, single-line settings, and the video list only when the page
  has something to download.
- The New download window comes to the front instead of flashing in the
  taskbar.
- The README now points at the installed extension folder rather than the zip.

### Fixed

- Settings → Browser showed every browser as needing the extension even when
  it was connected. SwiftDL now records which browser the extension talked to
  from, and marks that browser as connected.
- Contacts that didn't come from a browser (such as a test) no longer count
  as the extension being connected.
- The extension popup no longer shows "SwiftDL isn't installed" while it is
  connected.
- The download window's shadow no longer shows as a faint box around it.

## [0.2.0] - 2026-10-30

### Added

- **A window for every download.** A file caught from the browser opens a
  small _New download_ window (address, category, save location, size) instead
  of the main window. Starting it turns the same window into live progress, with
  each connection's start position and progress, and then a _Download complete_
  summary with Open and Show in folder.
- **Download video button.** The extension detects video and audio files a page
  loads and shows a button over video players that lists them. The popup lists
  them too, and the toolbar icon shows how many were found.
- **Automatic extension offer.** SwiftDL registers its extension with installed
  Chrome, Edge and Brave, which show a one-time _New extension added_ prompt
  (requires the Chrome Web Store listing). A _Connect your browser_ bar and a
  Browser settings page show which browsers were found and whether the
  extension has connected.
- **Alt+click bypass**, a per-site switch and a small-file threshold in the
  extension.
- **System tray.** Closing the main window keeps downloads and browser
  integration running; the tray menu opens or quits SwiftDL.
- The engine reports each connection's start, position and end.
- The uninstaller removes SwiftDL's browser registrations.
- Test pages for the extension in `tools/throttle_server.py`.

### Changed

- Calmer visual design: neutral buttons, one system-blue accent for progress
  and focus, no gradients, label/value details instead of boxed stat cards.
- New graphite logo.
- Redesigned extension popup in the app's style.
- Connections are shown as one rounded slot per connection, in both the main
  window and the download window.
- Softer file-type tiles throughout the app.

### Fixed

- Frameless windows no longer show the light Windows 11 border, and download
  windows no longer show white edges around their frame.

## [0.1.0] - 2026-10-30

### Added

- Segmented, resumable download engine: multiple connections per file, dynamic
  segmentation (idle connections take half of the largest remaining part),
  pre-allocated output written in place, resume file saved every second,
  retries with backoff, and a global speed limiter.
- `swiftdl` command-line tool.
- Desktop app (Tauri 2) with a queue, categories, settings, notifications,
  command palette, inspector with speed chart, and light and dark themes.
- Chromium extension (Manifest V3) that hands browser downloads to the app with
  cookies, referrer and user agent, plus a _Download with SwiftDL_ context menu.
- The app doubles as the native messaging host and registers itself per user.
- GitHub Actions for CI and tagged releases (Windows, macOS, Linux and the
  extension zip).

[0.3.5]: https://github.com/harshsinghsv/swiftdl/compare/v0.3.3...v0.3.5
[0.3.3]: https://github.com/harshsinghsv/swiftdl/compare/v0.3.2...v0.3.3
[0.3.2]: https://github.com/harshsinghsv/swiftdl/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/harshsinghsv/swiftdl/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/harshsinghsv/swiftdl/compare/v0.2.3...v0.3.0
[0.2.3]: https://github.com/harshsinghsv/swiftdl/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/harshsinghsv/swiftdl/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/harshsinghsv/swiftdl/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/harshsinghsv/swiftdl/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/harshsinghsv/swiftdl/releases/tag/v0.1.0
