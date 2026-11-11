//! The download list: queueing, persistence, live progress, and the bridge
//! between the engine and the UI. All state sits behind one mutex that is
//! never held across an `.await`.

use crate::settings::Settings;
use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use baadash_engine::header::{HeaderMap, HeaderName, HeaderValue};
use baadash_engine::{CancellationToken, Client, Outcome, Progress, Request, SpeedLimiter};
use tauri::{AppHandle, Emitter};

#[derive(Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Queued,
    Downloading,
    Paused,
    Completed,
    Error,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    #[serde(default)]
    pub checksum: Option<String>,
    #[serde(default)]
    pub verified: bool,
    pub id: u64,
    pub url: String,
    pub filename: String,
    pub path: PathBuf,
    pub size: Option<u64>,
    pub downloaded: u64,
    pub status: Status,
    pub error: Option<String>,
    pub category: String,
    pub added_at: u64,
    pub completed_at: Option<u64>,
    pub resumable: bool,
    /// Cookie/Referer/User-Agent captured by the browser extension. Kept so
    /// resuming still works on sites that need a login; cleared on completion.
    #[serde(default)]
    pub headers: Vec<(String, String)>,
    /// Missing byte ranges, for the connection map. Empty when complete or
    /// when the server can't do ranges.
    #[serde(default)]
    pub remaining: Vec<(u64, u64)>,
    /// Live `(start, pos, end)` per connection segment, for the download
    /// window's connection view.
    #[serde(default, skip_deserializing)]
    pub segments: Vec<(u64, u64, u64)>,
    /// Bytes per second, smoothed. Live only, not meaningful on disk.
    #[serde(default, skip_deserializing)]
    pub speed: f64,
    #[serde(default, skip_deserializing)]
    pub connections: usize,
    /// yt-dlp format for downloads from video sites (YouTube and others),
    /// which go through yt-dlp instead of the engine.
    #[serde(default)]
    pub format: Option<String>,
    /// For a torrent or magnet link: the files chosen (empty = all). Its
    /// presence marks the download as a torrent.
    #[serde(default)]
    pub torrent_files: Option<Vec<usize>>,
    /// Live status text, such as "Merging video and audio".
    #[serde(default, skip_deserializing)]
    pub note: Option<String>,
    /// Quick image/batch downloads stay in the main window instead of opening
    /// one progress window per file. GIF conversion keeps the original video.
    #[serde(default)]
    pub background: bool,
    #[serde(default)]
    pub convert_gif: bool,
    #[serde(default)]
    pub gif_options: Option<crate::gif::GifOptions>,
}

/// A download sent by the browser extension, waiting for the user to
/// confirm it in the Add dialog.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Incoming {
    pub url: String,
    #[serde(default)]
    pub filename: Option<String>,
    #[serde(default)]
    pub referrer: Option<String>,
    #[serde(default)]
    pub cookies: Option<String>,
    #[serde(default)]
    pub user_agent: Option<String>,
    /// A video's qualities, read by the extension from the page itself, so
    /// the New download window can show them without asking yt-dlp.
    #[serde(default)]
    pub qualities: Option<Vec<crate::media::Quality>>,
    /// Which of `qualities` the user clicked.
    #[serde(default)]
    pub pick: Option<usize>,
    /// Convert a direct video to an additional GIF after downloading.
    #[serde(default)]
    pub convert_gif: bool,
    #[serde(default)]
    pub gif_options: Option<crate::gif::GifOptions>,
}

/// Preserve Chinese and other Unicode names while producing a safe Windows path.
pub fn clean_filename(value: &str) -> String {
    let mut name: String = value.chars().map(|c| if "<>:\"/\\|?*：？".contains(c) || c.is_control() { '_' } else { c }).collect();
    name = name.split_whitespace().collect::<Vec<_>>().join(" ");
    name = name.trim().trim_end_matches(|c| c == '.' || c == ' ').to_string();
    if name.is_empty() {
        name = "download.bin".into();
    }
    let stem = name.split('.').next().unwrap_or_default();
    if matches!(stem.to_ascii_uppercase().as_str(), "CON" | "PRN" | "AUX" | "NUL" | "COM1" | "COM2" | "COM3" | "COM4" | "COM5" | "COM6" | "COM7" | "COM8" | "COM9" | "LPT1" | "LPT2" | "LPT3" | "LPT4" | "LPT5" | "LPT6" | "LPT7" | "LPT8" | "LPT9") {
        name.insert(0, '_');
    }
    if name.chars().count() > 160 {
        let ext = Path::new(&name).extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
        let keep = 160_usize.saturating_sub(ext.chars().count());
        let shortened: String = name.chars().take(keep).collect();
        name = format!("{}{}", shortened.trim_end(), ext);
    }
    name
}

impl Incoming {
    /// A usable file name sent by the extension (e.g. a video page's title),
    /// if it has an extension; otherwise the server's name is better.
    pub fn suggested_name(&self) -> Option<String> {
        let name = clean_filename(self.filename.as_deref()?);
        Path::new(&name).extension().is_some().then_some(name)
    }

    pub fn headers(&self) -> Vec<(String, String)> {
        let mut h = vec![];
        if let Some(c) = self.cookies.as_ref().filter(|c| !c.is_empty()) {
            h.push(("Cookie".into(), c.clone()));
        }
        if let Some(r) = self.referrer.as_ref().filter(|r| !r.is_empty()) {
            h.push(("Referer".into(), r.clone()));
        }
        if let Some(u) = self.user_agent.as_ref().filter(|u| !u.is_empty()) {
            h.push(("User-Agent".into(), u.clone()));
        }
        h
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddRequest {
    #[serde(default)]
    pub checksum: Option<String>,
    pub url: String,
    pub filename: String,
    pub dir: PathBuf,
    #[serde(default)]
    pub headers: Vec<(String, String)>,
    /// False adds it paused ("Download later").
    pub start: bool,
    /// Label of the window this was added from (the "New download"
    /// window), which then becomes the download's progress window.
    #[serde(default)]
    pub window: Option<String>,
    /// yt-dlp format, for a video-site download (see `Item::format`).
    #[serde(default)]
    pub format: Option<String>,
    /// Expected size, when known up front (video qualities).
    #[serde(default)]
    pub size: Option<u64>,
    /// A torrent: the files to download (see `Item::torrent_files`).
    #[serde(default)]
    pub torrent_files: Option<Vec<usize>>,
    #[serde(default)]
    pub background: bool,
    #[serde(default)]
    pub convert_gif: bool,
    #[serde(default)]
    pub gif_options: Option<crate::gif::GifOptions>,
}

struct Running {
    path: PathBuf,
    cancel: CancellationToken,
    progress: Arc<Progress>,
    last: (u64, Instant),
    speed: f64,
    note: crate::media::Note,
}

struct Inner {
    items: Vec<Item>,
    settings: Settings,
    running: HashMap<u64, Running>,
    pending: Vec<Incoming>,
    /// Downloads caught from the browser, waiting in a "New download" window.
    confirms: HashMap<u64, Incoming>,
    next_confirm: u64,
    /// Download id -> label of the window showing its progress.
    windows: HashMap<u64, String>,
    next_id: u64,
    dirty: bool,
}

pub struct DownloadManager {
    app: AppHandle,
    client: Client,
    limiter: Arc<SpeedLimiter>,
    ignore_limit: AtomicBool,
    data_dir: PathBuf,
    inner: Mutex<Inner>,
}

impl DownloadManager {
    pub fn new(app: AppHandle, data_dir: PathBuf, default_download_dir: PathBuf) -> Result<Arc<Self>> {
        std::fs::create_dir_all(&data_dir)?;
        let mut settings: Settings = load_json(&data_dir.join("settings.json")).unwrap_or_default();
        if settings.download_dir.as_os_str().is_empty() {
            settings.download_dir = default_download_dir;
        }
        let mut items: Vec<Item> = load_json(&data_dir.join("downloads.json")).unwrap_or_default();
        for item in &mut items {
            // The app was closed mid-download: leave it paused, like IDM.
            if item.status == Status::Downloading {
                item.status = Status::Paused;
            }
            if item.status != Status::Completed && item.remaining.is_empty() {
                item.remaining = baadash_engine::saved_remaining(&item.path).unwrap_or_default();
            }
        }
        crate::media::set_proxy(&settings.proxy);
        crate::media::set_bind(&settings.bind_address);
        let next_id = items.iter().map(|i| i.id).max().unwrap_or(0) + 1;
        Ok(Arc::new(Self {
            app,
            client: baadash_engine::build_client_opts(&settings.proxy, &settings.bind_address)?,
            limiter: Arc::new(SpeedLimiter::new(settings.speed_limit_kib * 1024)),
            ignore_limit: AtomicBool::new(false),
            data_dir,
            inner: Mutex::new(Inner {
                items,
                settings,
                running: HashMap::new(),
                pending: vec![],
                confirms: HashMap::new(),
                next_confirm: 1,
                windows: HashMap::new(),
                next_id,
                dirty: false,
            }),
        }))
    }

    pub fn client(&self) -> &Client {
        &self.client
    }

    pub fn app_handle(&self) -> &AppHandle {
        &self.app
    }

    pub fn settings(&self) -> Settings {
        self.inner.lock().unwrap().settings.clone()
    }

    pub fn snapshot(&self) -> Vec<Item> {
        self.inner.lock().unwrap().items.clone()
    }

    /// Where a file of this category goes by default.
    pub fn default_dir(&self, category: &str) -> PathBuf {
        let s = self.settings();
        if s.sort_into_categories && category != "Other" {
            let folder = match category {
                "Video" => "视频",
                "Music" => "音乐",
                "Programs" => "程序",
                "Compressed" => "压缩文件",
                "Documents" => "文档",
                "Images" => "图片",
                _ => "其他",
            };
            s.download_dir.join(folder)
        } else {
            s.download_dir
        }
    }

    pub fn add(self: &Arc<Self>, req: AddRequest) -> u64 {
        let filename = clean_filename(&req.filename);
        let path = baadash_engine::resolve_dest(&req.dir, &filename);
        let id = {
            let mut g = self.inner.lock().unwrap();
            let id = g.next_id;
            g.next_id += 1;
            g.items.push(Item {
                checksum: req.checksum,
                verified: false,
                id,
                url: req.url,
                filename: path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or(filename.clone()),
                category: category_for(&filename).to_string(),
                path,
                size: req.size,
                downloaded: 0,
                status: if req.start { Status::Queued } else { Status::Paused },
                error: None,
                added_at: now_ms(),
                completed_at: None,
                resumable: true,
                headers: req.headers,
                remaining: vec![],
                segments: vec![],
                speed: 0.0,
                connections: 0,
                format: req.format,
                torrent_files: req.torrent_files,
                note: None,
                background: req.background,
                convert_gif: req.convert_gif,
                gif_options: req.gif_options,
            });
            if let Some(label) = req.window {
                g.windows.insert(id, label);
            }
            id
        };
        self.changed();
        self.schedule();
        id
    }

    pub fn download_next(self: &Arc<Self>, id: u64) -> Result<(), String> {
        {
            let mut g = self.inner.lock().unwrap();
            let index = g.items.iter().position(|i| i.id == id && i.status == Status::Queued).ok_or("任务不在等待队列中")?;
            let item = g.items.remove(index);
            g.items.insert(0, item);
            g.dirty = true;
        }
        self.save(); self.schedule(); Ok(())
    }

    pub fn replace_url(self: &Arc<Self>, id: u64, url: String) -> Result<(), String> {
        let parsed = url::Url::parse(url.trim()).map_err(|_| "链接无效")?;
        if !["http", "https"].contains(&parsed.scheme()) { return Err("仅支持 HTTP/HTTPS 链接".into()); }
        {
            let mut g = self.inner.lock().unwrap();
            if g.running.contains_key(&id) { return Err("请先等待任务暂停".into()); }
            let item = g.items.iter_mut().find(|i| i.id == id).ok_or("找不到任务")?;
            if !matches!(item.status, Status::Paused | Status::Error) || item.format.is_some() || item.torrent_files.is_some() { return Err("仅支持暂停或失败的普通文件任务".into()); }
            // Rebase only the address. Existing validators and range checks stay mandatory.
            let mut state_name = item.path.as_os_str().to_os_string();
            state_name.push(".baadash");
            let state_path = PathBuf::from(state_name);
            if state_path.exists() {
                let raw = std::fs::read(&state_path).map_err(|e| e.to_string())?;
                let mut saved: serde_json::Value = serde_json::from_slice(&raw).map_err(|e| e.to_string())?;
                saved["url"] = serde_json::Value::String(parsed.to_string());
                let tmp = state_path.with_extension("baadash.tmp");
                std::fs::write(&tmp, serde_json::to_vec(&saved).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
                std::fs::rename(tmp, state_path).map_err(|e| e.to_string())?;
            }
            item.url = parsed.to_string(); item.error = None;
        }
        self.resume(&[id]); Ok(())
    }

    pub fn toggle_limit(&self) {
        let limit = self.settings().speed_limit_kib * 1024;
        let ignored = !self.ignore_limit.fetch_xor(true, Ordering::Relaxed);
        self.limiter.set_rate(if ignored { 0 } else { limit });
    }

    pub fn pause(self: &Arc<Self>, ids: &[u64]) {
        {
            let mut g = self.inner.lock().unwrap();
            for id in ids {
                if let Some(r) = g.running.get(id) {
                    r.cancel.cancel(); // the task marks it paused when it stops
                } else if let Some(item) = g.items.iter_mut().find(|i| i.id == *id && i.status == Status::Queued) {
                    item.status = Status::Paused;
                }
            }
        }
        self.changed();
    }

    pub fn resume(self: &Arc<Self>, ids: &[u64]) {
        {
            let mut g = self.inner.lock().unwrap();
            for item in g.items.iter_mut().filter(|i| ids.contains(&i.id)) {
                if matches!(item.status, Status::Paused | Status::Error) {
                    item.status = Status::Queued;
                    item.error = None;
                }
            }
        }
        self.changed();
        self.schedule();
    }

    pub fn remove(self: &Arc<Self>, ids: &[u64], delete_files: bool) {
        let removed: Vec<Item> = {
            let mut g = self.inner.lock().unwrap();
            for id in ids {
                if let Some(r) = g.running.get(id) {
                    r.cancel.cancel();
                }
            }
            let (gone, keep) = std::mem::take(&mut g.items).into_iter().partition(|i| ids.contains(&i.id));
            g.items = keep;
            gone
        };
        for item in &removed {
            // Running ones clean up their own temp files when their task ends.
            if item.status != Status::Downloading {
                remove_temp_files(&item.path);
            }
            if delete_files && item.status == Status::Completed {
                let _ = std::fs::remove_file(&item.path);
            }
        }
        self.changed();
    }

    pub fn clear_history(&self, ids: &[u64], delete_files: bool, delete_temp: bool) -> Result<()> {
        let removed: Vec<Item> = {
            let mut g = self.inner.lock().unwrap();
            if g.items.iter().any(|i| ids.contains(&i.id) && (!matches!(i.status, Status::Completed | Status::Error) || g.running.contains_key(&i.id))) {
                anyhow::bail!("任务状态已改变，请刷新后重试；运行中或暂停的任务不能作为历史清理");
            }
            let (gone, keep) = std::mem::take(&mut g.items).into_iter().partition(|i| ids.contains(&i.id));
            g.items = keep; g.dirty = true; gone
        };
        for item in removed {
            if delete_temp { remove_temp_files(&item.path); }
            if delete_files && item.status == Status::Completed { if let Err(e)=std::fs::remove_file(&item.path) { crate::log::line(&format!("could not delete {}: {e}", item.path.display())); } }
        }
        self.save(); Ok(())
    }

    pub fn set_settings(self: &Arc<Self>, settings: Settings) {
        crate::media::set_proxy(&settings.proxy);
        crate::media::set_bind(&settings.bind_address);
        self.limiter.set_rate(if self.ignore_limit.load(Ordering::Relaxed) { 0 } else { settings.speed_limit_kib * 1024 });
        if let Err(e) = crate::browser::offer_extension(settings.offer_extension) {
            crate::log::line(&format!("could not update browser extension offer: {e:#}"));
        }
        // Open windows (download windows) follow the theme at once.
        let _ = self.app.emit("settings", &settings);
        self.inner.lock().unwrap().settings = settings;
        self.save();
        self.schedule();
    }

    pub fn item(&self, id: u64) -> Option<Item> {
        self.inner.lock().unwrap().items.iter().find(|i| i.id == id).cloned()
    }

    /// A download arrived from the browser extension. Like IDM, it gets its
    /// own small "New download" window rather than the main window.
    /// Starts looking a YouTube video up, so its download starts at once.
    pub fn prepare(self: &Arc<Self>, inc: &Incoming) {
        let (client, url, headers) = (self.client.clone(), inc.url.clone(), inc.headers());
        tauri::async_runtime::spawn(async move { crate::media::prepare(&client, &url, headers).await });
    }

    pub fn incoming(self: &Arc<Self>, inc: Incoming) {
        self.prepare(&inc);
        // Video sites always ask: there's a quality to choose.
        if self.settings().ask_before_download || crate::media::is_media_url(&inc.url) || crate::torrent::is_torrent(&inc.url, inc.filename.as_deref()) {
            self.new_download_window(inc);
            return;
        }
        // No dialog: probe for the real file name, then start right away.
        let this = self.clone();
        tauri::async_runtime::spawn(async move {
            let headers = inc.headers();
            let probed = baadash_engine::probe(&this.client, &inc.url, &to_header_map(&headers)).await.ok().map(|r| r.filename);
            let filename = inc.suggested_name().or(probed).unwrap_or_else(|| "download.bin".into());
            let dir = this.default_dir(category_for(&filename));
            this.add(AddRequest { checksum: None, url: inc.url, filename, dir, headers, start: true, window: None, format: None, size: None, torrent_files: None, background: false, convert_gif: false, gif_options: None });
        });
    }

    /// Direct images and videos from the browser's one-click actions. No
    /// confirmation or per-file progress windows: everything enters the main
    /// queue. A missing name is resolved concurrently, so a slow server does
    /// not hold up the other files in a batch.
    pub fn quick(self: &Arc<Self>, items: Vec<Incoming>) {
        let items: Vec<Incoming> = items.into_iter()
            .filter(|inc| inc.url.starts_with("http://") || inc.url.starts_with("https://"))
            .take(100)
            .collect();
        if items.is_empty() {
            return;
        }
        crate::show_main_window(&self.app);
        let this = self.clone();
        tauri::async_runtime::spawn(async move {
            let mut jobs = tokio::task::JoinSet::new();
            for inc in items {
                let client = this.client.clone();
                jobs.spawn(async move {
                    let headers = inc.headers();
                    // A GIF request may carry a video page or an HLS/DASH
                    // manifest instead of a plain file. Let yt-dlp fetch it,
                    // then run the same local conversion as direct videos.
                    let media = inc.convert_gif && crate::media::is_media_url(&inc.url);
                    let name = match inc.suggested_name() {
                        Some(name) => Some(name),
                        None if media => Some("video.mp4".into()),
                        None => baadash_engine::probe(&client, &inc.url, &to_header_map(&headers)).await.ok().map(|r| r.filename),
                    };
                    (inc, headers, name, media)
                });
            }
            while let Some(Ok((inc, headers, probed, media))) = jobs.join_next().await {
                let filename = probed.unwrap_or_else(|| "download.bin".into());
                let dir = this.default_dir(category_for(&filename));
                this.add(AddRequest { checksum: None,
                    url: inc.url,
                    filename,
                    dir,
                    headers,
                    start: true,
                    window: None,
                    format: media.then(|| "bv*+ba/b".into()),
                    size: None,
                    torrent_files: None,
                    background: true,
                    convert_gif: inc.convert_gif,
                    gif_options: inc.gif_options,
                });
            }
        });
    }

    /// Opens a "New download" window for `inc`.
    pub fn new_download_window(&self, inc: Incoming) {
        let token = {
            let mut g = self.inner.lock().unwrap();
            let token = g.next_confirm;
            g.next_confirm += 1;
            g.confirms.insert(token, inc);
            token
        };
        if let Err(e) = crate::windows::open(&self.app, &format!("new-{token}"), &format!("confirm={token}"), "New download") {
            crate::log::line(&format!("could not open the New download window: {e:#}"));
        }
    }

    pub fn take_pending(&self) -> Vec<Incoming> {
        std::mem::take(&mut self.inner.lock().unwrap().pending)
    }

    /// What a "New download" window was opened for.
    pub fn confirm_info(&self, token: u64) -> Option<Incoming> {
        self.inner.lock().unwrap().confirms.get(&token).cloned()
    }

    pub fn forget_confirm(&self, token: u64) {
        self.inner.lock().unwrap().confirms.remove(&token);
    }

    /// Opens (or keeps) the progress window for each newly started
    /// download, unless the user turned that off.
    fn open_progress_windows(&self, ids: &[u64]) {
        use tauri::Manager as _;
        let to_open: Vec<(u64, String)> = {
            let mut g = self.inner.lock().unwrap();
            if !g.settings.show_progress_window {
                return;
            }
            let missing: Vec<u64> = ids
                .iter()
                .copied()
                .filter(|id| g.items.iter().any(|item| item.id == *id && !item.background))
                .filter(|id| g.windows.get(id).is_none_or(|label| self.app.get_webview_window(label).is_none()))
                .collect();
            missing
                .into_iter()
                .map(|id| {
                    g.windows.insert(id, format!("dl-{id}"));
                    let title = g.items.iter().find(|i| i.id == id).map(|i| i.filename.clone()).unwrap_or_default();
                    (id, title)
                })
                .collect()
        };
        for (id, title) in to_open {
            if let Err(e) = crate::windows::open(&self.app, &format!("dl-{id}"), &format!("id={id}"), &title) {
                crate::log::line(&format!("could not open the download window: {e:#}"));
            }
        }
    }

    /// Starts queued downloads until `max_concurrent` are running.
    fn schedule(self: &Arc<Self>) {
        let to_start: Vec<(u64, Request, Kind, Arc<Progress>, crate::media::Note, CancellationToken, Option<crate::gif::GifOptions>)> = {
            let mut g = self.inner.lock().unwrap();
            let Inner { items, running, settings, .. } = &mut *g;
            if settings.start_at.is_some_and(|at| at > now_ms()) { return; }
            let free = settings.max_concurrent.max(1).saturating_sub(running.len());
            let connections = settings.connections;
            items
                .iter_mut()
                .filter(|i| i.status == Status::Queued)
                .take(free)
                .map(|item| {
                    let id = item.id;
                    item.status = Status::Downloading;
                    let req = Request {
                        url: item.url.clone(),
                        dest: item.path.clone(),
                        connections,
                        headers: to_header_map(&item.headers),
                        restart: false,
                    };
                    let progress = Arc::new(Progress::default());
                    progress.downloaded.store(item.downloaded, Ordering::Relaxed);
                    progress.total.store(item.size.unwrap_or(0), Ordering::Relaxed);
                    let cancel = CancellationToken::new();
                    let note = crate::media::Note::default();
                    running.insert(
                        id,
                        Running {
                            path: item.path.clone(),
                            cancel: cancel.clone(),
                            progress: progress.clone(),
                            last: (item.downloaded, Instant::now()),
                            speed: 0.0,
                            note: note.clone(),
                        },
                    );
                    let kind = match (&item.torrent_files, &item.format) {
                        (Some(files), _) => Kind::Torrent(files.clone()),
                        (None, Some(format)) => Kind::Media(format.clone()),
                        (None, None) => Kind::File,
                    };
                    let gif = item.convert_gif.then(|| item.gif_options.clone().unwrap_or_default());
                    (id, req, kind, progress, note, cancel, gif)
                })
                .collect()
        };
        if to_start.is_empty() {
            return;
        }
        self.open_progress_windows(&to_start.iter().map(|t| t.0).collect::<Vec<_>>());
        for (id, req, kind, progress, note, cancel, gif) in to_start {
            let this = self.clone();
            tauri::async_runtime::spawn(async move {
                let result = match kind {
                    // A stream picked in the extension: our own downloader.
                    Kind::Media(format) if crate::stream::parse_format(&format).is_some() => {
                        let (video, audio) = match crate::stream::parse_format(&format).unwrap_or_default() {
                            // Audio only: the sound track is the one to download.
                            (None, Some(a)) => (Some(a), None),
                            other => other,
                        };
                        let job = crate::stream::Job { video: video.unwrap_or_else(|| req.url.clone()), audio, dest: req.dest.clone(), headers: req.headers.clone() };
                        crate::stream::run(&this.client, job, progress, note.clone(), cancel).await
                    }
                    Kind::Media(format) => {
                        let headers = req.headers.iter()
                            .filter_map(|(k, v)| Some((k.as_str().to_string(), v.to_str().ok()?.to_string())))
                            .collect();
                        let job = crate::media::Job { url: req.url.clone(), format, dest: req.dest.clone(), headers };
                        crate::media::run(&this.client, job, progress, note.clone(), cancel).await
                    }
                    Kind::Torrent(files) => {
                        // A torrent saves into a folder; `dest` is its name inside it.
                        let dir = req.dest.parent().map(Path::to_path_buf).unwrap_or_default();
                        let seed = crate::torrent::Seed::from_setting(&this.settings().seed_until);
                        let job = crate::torrent::Job { url: req.url.clone(), headers: req.headers.clone(), dir, files, seed };
                        crate::torrent::run(&this.client, job, progress, note.clone(), cancel).await
                    }
                    Kind::File => baadash_engine::run(&this.client, &req, progress, cancel, this.limiter.clone()).await,
                };
                let result = this.verify(id, result, &note).await;
                let mut gif_path = None;
                let result = match (result, gif) {
                    (Ok(Outcome::Completed), Some(options)) => match crate::gif::convert(&this.client, &note, &req.dest, options).await {
                        Ok(path) => {
                            gif_path = Some(path);
                            Ok(Outcome::Completed)
                        },
                        Err(error) => Err(error),
                    },
                    (result, _) => result,
                };
                this.finish(id, result, gif_path);
            });
        }
        self.changed();
    }

    /// Checks a finished file against the SHA-256 the user gave, if any.
    async fn verify(self: &Arc<Self>, id: u64, result: Result<Outcome>, note: &crate::media::Note) -> Result<Outcome> {
        if !matches!(result, Ok(Outcome::Completed)) {
            return result;
        }
        let Some((want, path)) = self.item(id).and_then(|i| i.checksum.clone().map(|c| (c, i.path.clone()))) else { return result };
        *note.lock().unwrap() = Some("Checking the file".into());
        match tauri::async_runtime::spawn_blocking(move || sha256_file(&path)).await {
            Ok(Ok(got)) if got.eq_ignore_ascii_case(want.trim()) => {
                if let Some(i) = self.inner.lock().unwrap().items.iter_mut().find(|i| i.id == id) {
                    i.verified = true;
                }
                result
            }
            Ok(Ok(got)) => Err(anyhow::anyhow!("The file's SHA-256 doesn't match. Expected {}, got {got}. It may be corrupted or not the file you meant.", want.trim())),
            _ => Err(anyhow::anyhow!("The file finished, but couldn't be read to check it.")),
        }
    }

    /// Quit, sleep or shut down, with a notice first.
    fn power(&self, kind: &str) {
        use tauri_plugin_notification::NotificationExt;
        crate::log::line(&format!("all downloads finished: {kind}"));
        if kind == "close" {
            self.app.exit(0);
            return;
        }
        let body = if kind == "sleep" { "即将进入休眠。" } else { "即将关机。Windows 可在 60 秒内运行 shutdown /a 取消。" };
        let _ = self.app.notification().builder().title("下载全部完成").body(body).show();
        let kind = kind.to_string();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_secs(5));
            let mut cmd;
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                cmd = if kind == "sleep" {
                    let mut c = std::process::Command::new("rundll32.exe");
                    c.args(["powrprof.dll,SetSuspendState", "0,1,0"]);
                    c
                } else {
                    let mut c = std::process::Command::new("shutdown");
                    c.args(["/s", "/t", "60"]);
                    c
                };
                cmd.creation_flags(0x0800_0000);
            }
            #[cfg(target_os = "macos")]
            {
                cmd = if kind == "sleep" {
                    let mut c = std::process::Command::new("pmset");
                    c.arg("sleepnow");
                    c
                } else {
                    let mut c = std::process::Command::new("osascript");
                    c.args(["-e", "tell app \"System Events\" to shut down"]);
                    c
                };
            }
            #[cfg(all(unix, not(target_os = "macos")))]
            {
                cmd = std::process::Command::new("systemctl");
                cmd.arg(if kind == "sleep" { "suspend" } else { "poweroff" });
            }
            if let Err(e) = cmd.spawn() {
                crate::log::line(&format!("could not {kind}: {e}"));
            }
        });
    }

    fn record_gif(&self, source_id: u64, path: PathBuf) {
        let mut g = self.inner.lock().unwrap();
        let Some(source) = g.items.iter().find(|i| i.id == source_id).cloned() else { return };
        if g.items.iter().any(|i| i.path == path) { return; }
        let output = completed_gif(&source, g.next_id, path);
        g.next_id += 1;
        g.items.push(output);
        g.dirty = true;
    }

    fn finish(self: &Arc<Self>, id: u64, result: Result<Outcome>, gif_path: Option<PathBuf>) {
        let mut notify = None;
        let mut completed = false;
        {
            let mut g = self.inner.lock().unwrap();
            let running = g.running.remove(&id);
            let notify_enabled = g.settings.notify_on_complete;
            match g.items.iter_mut().find(|i| i.id == id) {
                None => {
                    // Removed while running: drop what it left behind.
                    if let Some(r) = &running {
                        remove_temp_files(&r.path);
                    }
                }
                Some(item) => {
                    if let Some(r) = &running {
                        item.downloaded = r.progress.downloaded.load(Ordering::Relaxed);
                        let total = r.progress.total.load(Ordering::Relaxed);
                        if total > 0 {
                            item.size = Some(total);
                        }
                        item.resumable = r.progress.resumable.load(Ordering::Relaxed);
                        item.remaining = r.progress.remaining.lock().unwrap().clone();
                        item.segments = r.progress.segments.lock().unwrap().clone();
                    }
                    item.speed = 0.0;
                    item.connections = 0;
                    item.note = None;
                    match result {
                        Ok(Outcome::Completed) => {
                            completed = true;
                            item.status = Status::Completed;
                            item.completed_at = Some(now_ms());
                            item.size = item.size.or(Some(item.downloaded));
                            item.downloaded = item.size.unwrap_or(item.downloaded);
                            item.headers.clear();
                            item.remaining.clear();
                            if notify_enabled {
                                notify = Some(item.filename.clone());
                            }
                        }
                        Ok(Outcome::Paused) => item.status = Status::Paused,
                        Err(e) => {
                            item.status = Status::Error;
                            item.error = Some(format!("{e:#}"));
                            crate::log::line(&format!("download {} failed ({}): {e:#}", item.filename, item.url));
                        }
                    }
                }
            }
        }
        if let Some(path) = gif_path {
            if notify.is_some() { notify = path.file_name().map(|n| n.to_string_lossy().into_owned()); }
            self.record_gif(id, path);
        }
        let action = {
            let mut g = self.inner.lock().unwrap();
            if completed && g.running.is_empty() && !g.items.is_empty() && g.items.iter().all(|i| i.status == Status::Completed) {
                std::mem::take(&mut g.settings.when_finished)
            } else { String::new() }
        };
        if let Some(name) = notify {
            use tauri_plugin_notification::NotificationExt;
            let _ = self.app.notification().builder().title("下载完成").body(name).show();
        }
        self.changed();
        self.save();
        self.schedule();
        if ["close", "sleep", "shutdown"].contains(&action.as_str()) {
            let _ = self.app.emit("settings", self.settings());
            self.power(&action);
        }
    }

    /// Called every 500 ms: copies live progress into items, computes
    /// speeds, and pushes a snapshot to the UI when something changed.
    pub fn tick(&self, n: u64) {
        let (snapshot, active) = {
            let mut g = self.inner.lock().unwrap();
            let Inner { items, running, dirty, .. } = &mut *g;
            let now = Instant::now();
            for (id, r) in running.iter_mut() {
                let done = r.progress.downloaded.load(Ordering::Relaxed);
                let dt = now.duration_since(r.last.1).as_secs_f64();
                if dt > 0.0 {
                    let instant = done.saturating_sub(r.last.0) as f64 / dt;
                    r.speed = if r.speed == 0.0 { instant } else { r.speed * 0.6 + instant * 0.4 };
                }
                r.last = (done, now);
                if let Some(item) = items.iter_mut().find(|i| i.id == *id) {
                    item.downloaded = done;
                    let total = r.progress.total.load(Ordering::Relaxed);
                    if total > 0 {
                        item.size = Some(total);
                    }
                    item.speed = r.speed;
                    item.connections = r.progress.connections.load(Ordering::Relaxed);
                    item.remaining = r.progress.remaining.lock().unwrap().clone();
                    item.segments = r.progress.segments.lock().unwrap().clone();
                    item.note = r.note.lock().unwrap().clone();
                }
            }
            let active = !running.is_empty();
            if !active && !*dirty {
                return;
            }
            *dirty = false;
            (items.clone(), active)
        };
        let _ = self.app.emit("downloads", snapshot);
        if active && n % 10 == 0 {
            self.save();
        }
    }

    fn changed(&self) {
        self.inner.lock().unwrap().dirty = true;
    }

    pub fn save(&self) {
        let (items, settings) = {
            let g = self.inner.lock().unwrap();
            (g.items.clone(), g.settings.clone())
        };
        static WARNED: std::sync::atomic::AtomicBool=std::sync::atomic::AtomicBool::new(false);
        let saved=save_json(&self.data_dir.join("downloads.json"),&items).and_then(|_|save_json(&self.data_dir.join("settings.json"),&settings));
        match saved {Ok(())=>{WARNED.store(false,Ordering::Relaxed);},Err(e)=>{crate::log::line(&format!("could not save application state: {e:#}"));if !WARNED.swap(true,Ordering::Relaxed){let _=self.app.emit("storage-error",format!("无法保存任务与设置，请检查磁盘空间及目录权限：{e}"));}}}
    }

    fn check_start_time(self: &Arc<Self>) {
        let due = {
            let mut g = self.inner.lock().unwrap();
            if g.settings.start_at.is_some_and(|at| at <= now_ms()) {
                g.settings.start_at = None;
                true
            } else { false }
        };
        if due {
            let _ = self.app.emit("settings", self.settings());
            self.save(); self.schedule();
        }
    }

    pub fn start_ticker(self: &Arc<Self>) {
        let this = self.clone();
        tauri::async_runtime::spawn(async move {
            let mut tick = tokio::time::interval(Duration::from_millis(500));
            for n in 0u64.. {
                tick.tick().await;
                this.tick(n);
                this.check_start_time();
            }
        });
        self.schedule();
    }

}

/// How a download is fetched.
enum Kind {
    File,
    /// A video site, through yt-dlp, with this format.
    Media(String),
    /// A torrent or magnet link, with these files (empty = all).
    Torrent(Vec<usize>),
}

pub fn to_header_map(headers: &[(String, String)]) -> HeaderMap {
    let mut map = HeaderMap::new();
    for (k, v) in headers {
        if let (Ok(k), Ok(v)) = (HeaderName::from_bytes(k.as_bytes()), HeaderValue::from_str(v)) {
            map.insert(k, v);
        }
    }
    map
}

pub fn category_for(filename: &str) -> &'static str {
    let ext = Path::new(filename).extension().map(|e| e.to_string_lossy().to_ascii_lowercase()).unwrap_or_default();
    match ext.as_str() {
        "zip" | "rar" | "7z" | "tar" | "gz" | "tgz" | "xz" | "bz2" | "zst" | "iso" | "img" => "Compressed",
        "pdf" | "doc" | "docx" | "xls" | "xlsx" | "ppt" | "pptx" | "odt" | "txt" | "rtf" | "epub" | "csv" | "md" => {
            "Documents"
        }
        "mp3" | "wav" | "flac" | "aac" | "ogg" | "m4a" | "opus" | "wma" => "Music",
        "mp4" | "mkv" | "avi" | "mov" | "webm" | "flv" | "wmv" | "m4v" | "mpg" | "mpeg" | "3gp" | "ts" => "Video",
        "exe" | "msi" | "dmg" | "pkg" | "deb" | "rpm" | "apk" | "appimage" | "msix" | "bat" | "jar" => "Programs",
        "jpg" | "jpeg" | "png" | "gif" | "webp" | "svg" | "bmp" | "heic" | "avif" => "Images",
        _ => "Other",
    }
}

fn remove_temp_files(path: &Path) {
    crate::media::cleanup(path);
    let _ = std::fs::remove_file(baadash_engine::part_path(path));
    let mut state = path.as_os_str().to_owned();
    state.push(".baadash");
    let _ = std::fs::remove_file(PathBuf::from(state));
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn load_json<T: serde::de::DeserializeOwned>(path: &Path) -> Option<T> {
    serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()
}

fn save_json<T: Serialize>(path: &Path, value: &T) -> Result<()> {
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_vec_pretty(value)?)?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::clean_filename;

    #[test]
    fn keeps_chinese_and_replaces_windows_punctuation() {
        assert_eq!(clean_filename("奶龙：写真/4K?.mp4"), "奶龙_写真_4K_.mp4");
        assert_eq!(clean_filename("  深夜\t电台\n第12集.mp3  "), "深夜_电台_第12集.mp3");
    }

    #[test]
    fn handles_empty_reserved_and_overlong_names() {
        assert_eq!(clean_filename(""), "download.bin");
        assert_eq!(clean_filename("CON.mp4"), "_CON.mp4");
        let name = clean_filename(&format!("{}.mp4", "猫".repeat(200)));
        assert_eq!(name.chars().count(), 160);
        assert!(name.ends_with(".mp4"));
        assert!(!name.contains("mp4.mp4"));
    }
}

fn sha256_file(path: &Path) -> std::io::Result<String> {
    use sha2::{Digest, Sha256};
    use std::io::Read;
    let mut file = std::fs::File::open(path)?;
    let mut hash = Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hash.update(&buf[..n]);
    }
    Ok(hash.finalize().iter().map(|b| format!("{b:02x}")).collect())
}


fn completed_gif(source: &Item, id: u64, path: PathBuf) -> Item {
        let mut output = source.clone();
        output.checksum = None;
        output.verified = false;
        output.id = id;
        output.filename = path.file_name().unwrap_or_default().to_string_lossy().into_owned();
        output.size = std::fs::metadata(&path).ok().map(|m| m.len());
        output.downloaded = output.size.unwrap_or(0);
        output.path = path;
        output.category = "Images".into();
        output.status = Status::Completed;
        output.completed_at = Some(now_ms());
        output.error = None;
        output.note = None;
        output.headers.clear();
        output.remaining.clear();
        output.segments.clear();
        output.connections = 0;
        output.speed = 0.0;
        output.resumable = false;
        output.format = None;
        output.torrent_files = None;
        output.convert_gif = false;
        output.gif_options = None;
    output
}

#[cfg(test)]
mod output_tests {
    use super::*;
    #[test]
    fn gif_history_has_its_own_persistent_path_and_size() {
        let dir = std::env::temp_dir().join(format!("baadash-gif-history-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("动画（1）.gif");
        std::fs::write(&path, b"GIF89a").unwrap();
        let source: Item = serde_json::from_value(serde_json::json!({
            "id":1,"url":"https://example.test/video.mp4","filename":"动画.mp4","path":dir.join("动画.mp4"),
            "size":1000,"downloaded":1000,"status":"downloading","error":null,"category":"Video",
            "addedAt":1,"completedAt":null,"resumable":true,"convertGif":true,"headers":[["Cookie","secret"]]
        })).unwrap();
        let output = completed_gif(&source, 2, path.clone());
        assert_eq!(output.status, Status::Completed);
        assert_eq!(output.filename, "动画（1）.gif");
        assert_eq!(output.size, Some(6));
        assert_eq!(output.downloaded, 6);
        assert_eq!(output.category, "Images");
        assert!(output.headers.is_empty());
        assert!(!output.convert_gif);
        assert!(source.convert_gif);
        assert_ne!(source.path, output.path);
        let restored: Item = serde_json::from_slice(&serde_json::to_vec(&output).unwrap()).unwrap();
        assert_eq!(restored.path, path);
        assert_eq!(restored.id, 2);
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn sha256_reads_the_actual_file() {
        let path = std::env::temp_dir().join(format!("baadash-sha-{}",std::process::id()));
        std::fs::write(&path,b"abc").unwrap();
        assert_eq!(sha256_file(&path).unwrap(),"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
        std::fs::remove_file(path).unwrap();
    }
}
