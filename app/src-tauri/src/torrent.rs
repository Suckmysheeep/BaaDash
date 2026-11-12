//! Torrents and magnet links, through librqbit (a BitTorrent engine in Rust).
//!
//! A torrent is read first for its file list (the New download window lets
//! the user pick files), then run as a download like any other: progress,
//! speed, pause and resume. When it finishes it stops sharing, which is what
//! people expect from a download manager. BaaDash also registers itself as
//! the computer's handler for magnet links and .torrent files.

use anyhow::{Context, Result, anyhow, bail};
use librqbit::{AddTorrent, AddTorrentOptions, AddTorrentResponse, DhtSessionConfig, Session, SessionOptions};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::sync::atomic::Ordering;
use std::time::Duration;
use baadash_engine::header::HeaderMap;
use baadash_engine::{CancellationToken, Client, Outcome, Progress};
use tokio::sync::OnceCell;

/// A magnet link, or the address or path of a .torrent file.
pub fn is_torrent(url: &str, filename: Option<&str>) -> bool {
    let url = url.trim();
    let path = url.split(['?', '#']).next().unwrap_or(url).to_ascii_lowercase();
    url.starts_with("magnet:") || path.ends_with(".torrent") || filename.is_some_and(|f| f.to_ascii_lowercase().ends_with(".torrent"))
}

/// A probed response that is really a torrent, whatever the link looked like:
/// some sites hand torrents out under names like "attach-download-10.htm" and
/// only the response (its filename or Content-Type) gives them away.
pub fn is_torrent_response(filename: &str, content_type: Option<&str>) -> bool {
    filename.to_ascii_lowercase().ends_with(".torrent")
        || content_type.is_some_and(|c| c == "application/x-bittorrent" || c == "application/octet-stream+torrent")
}

/// The tracker addresses embedded in a magnet link (its `tr=` parameters).
fn magnet_trackers(url: &str) -> Option<Vec<String>> {
    let query = url.trim().strip_prefix("magnet:")?.split(['?', '#']).nth(1)?;
    let trackers: Vec<String> = url::form_urlencoded::parse(query.as_bytes())
        .filter(|(k, _)| k == "tr")
        .map(|(_, v)| v.into_owned())
        .filter(|v| !v.is_empty())
        .collect();
    (!trackers.is_empty()).then_some(trackers)
}

/// One BitTorrent session for the whole app, started on first use.
static SESSION: OnceCell<Arc<Session>> = OnceCell::const_new();

/// DHT bootstrap nodes. librqbit's built-in list is only two of these, and
/// both are unreachable from some networks (DNS poisoning, UDP filtering),
/// which leaves magnets unfindable; asking a wider set gets in far more often.
const BOOTSTRAP: [&str; 5] = [
    "router.bittorrent.com:6881",
    "router.utorrent.com:6881",
    "dht.transmissionbt.com:6881",
    "dht.libtorrent.org:25401",
    "dht.aelitis.com:6881",
];

async fn session() -> Result<Arc<Session>> {
    SESSION
        .get_or_try_init(|| async {
            let dir = crate::browser::data_dir().join("torrents");
            std::fs::create_dir_all(&dir)?;
            let dht = DhtSessionConfig {
                bootstrap_addrs: Some(BOOTSTRAP.iter().map(|s| s.to_string()).collect()),
                ..Default::default()
            };
            let opts = SessionOptions { dht: Some(dht), ..Default::default() };
            let started = std::time::Instant::now();
            let session = tokio::time::timeout(Duration::from_secs(30), Session::new_with_opts(dir, opts))
                .await
                .map_err(|_| anyhow!("the torrent engine took too long to start"))??;
            crate::log::line(&format!("torrent engine started in {:.1}s", started.elapsed().as_secs_f64()));
            Ok(session)
        })
        .await
        .cloned()
}

/// What to give the engine: magnets as they are; .torrent files are read
/// (local) or fetched with the page's cookies (web), since many sites only
/// hand them out to a signed-in browser.
async fn source(client: &Client, url: &str, headers: &HeaderMap) -> Result<AddTorrent<'static>> {
    let url = url.trim();
    if url.starts_with("magnet:") {
        return Ok(AddTorrent::from_url(url.to_string()));
    }
    if url.starts_with("http://") || url.starts_with("https://") {
        let resp = client.get(url).headers(headers.clone()).send().await?.error_for_status()?;
        let bytes = resp.bytes().await?;
        if bytes.first() != Some(&b'd') {
            bail!("that link didn't return a .torrent file");
        }
        return Ok(AddTorrent::from_bytes(bytes.to_vec()));
    }
    let path = url.strip_prefix("file://").unwrap_or(url);
    Ok(AddTorrent::from_bytes(std::fs::read(path).with_context(|| format!("couldn't read {path}"))?))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TorrentFile {
    pub path: String,
    pub size: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TorrentInfo {
    pub name: String,
    pub files: Vec<TorrentFile>,
    pub size: u64,
    /// Info hash (hex), so the user can verify the resource.
    pub hash: String,
    /// Peers that answered the probe; the download starts with them.
    pub peers: usize,
}

/// A probe's result, kept briefly: starting the download then adds the
/// torrent from the bytes already fetched and the peers already found,
/// instead of asking the swarm for the metadata a second time.
struct Probed {
    bytes: Vec<u8>,
    peers: Vec<std::net::SocketAddr>,
    at: std::time::Instant,
}
static PROBED: Mutex<Vec<(String, Probed)>> = Mutex::new(Vec::new());
const PROBED_TTL: Duration = Duration::from_secs(15 * 60);

fn keep_probed(url: &str, bytes: &[u8], peers: Vec<std::net::SocketAddr>) {
    let mut g = PROBED.lock().unwrap();
    g.retain(|(_, p)| p.at.elapsed() < PROBED_TTL);
    g.retain(|(u, _)| u != url);
    if g.len() >= 8 {
        g.remove(0);
    }
    g.push((url.to_string(), Probed { bytes: bytes.to_vec(), peers, at: std::time::Instant::now() }));
}

fn take_probed(url: &str) -> Option<Probed> {
    let mut g = PROBED.lock().unwrap();
    g.retain(|(_, p)| p.at.elapsed() < PROBED_TTL);
    let i = g.iter().position(|(u, _)| u == url)?;
    Some(g.remove(i).1)
}

/// Reads a torrent's name and files without downloading it. For a magnet
/// link this asks peers for the details first, which can take a moment.
pub async fn probe(client: &Client, url: &str, headers: &HeaderMap, cancel: CancellationToken) -> Result<TorrentInfo> {
    // Each stage goes to the log: if a probe ever hangs again, the last line
    // says exactly where it stopped.
    let short: String = url.trim().chars().take(80).collect();
    crate::log::line(&format!("torrent probe started: {short}"));
    let started = std::time::Instant::now();
    let session = tokio::select! {
        s = session() => s?,
        _ = cancel.cancelled() => { crate::log::line("torrent probe cancelled before the engine was up"); bail!("cancelled") }
    };
    let add = source(client, url, headers).await?;
    let opts = AddTorrentOptions { list_only: true, ..Default::default() };
    let resp = tokio::select! {
        r = tokio::time::timeout(Duration::from_secs(90), session.add_torrent(add, Some(opts))) => {
            match &r {
                Ok(Ok(_)) => crate::log::line(&format!("torrent probe found peers in {:.1}s: {short}", started.elapsed().as_secs_f64())),
                Ok(Err(e)) => crate::log::line(&format!("torrent probe failed in {:.1}s: {e:#}: {short}", started.elapsed().as_secs_f64())),
                Err(_) => crate::log::line(&format!("torrent probe timed out after 90s: {short}")),
            }
            r.map_err(|_| anyhow!("couldn't find anyone sharing this torrent"))??
        }
        _ = cancel.cancelled() => { crate::log::line(&format!("torrent probe cancelled after {:.1}s: {short}", started.elapsed().as_secs_f64())); bail!("cancelled") }
    };
    let AddTorrentResponse::ListOnly(list) = resp else { bail!("unexpected answer from the torrent engine") };
    let info = &list.info;
    let name = info.name().map(|n| n.to_string()).unwrap_or_else(|| "torrent".into());
    let files: Vec<TorrentFile> = info
        .iter_file_details()
        .map(|f| TorrentFile { path: f.filename.to_pathbuf().to_string_lossy().replace('\\', "/"), size: f.len })
        .collect();
    let size = files.iter().map(|f| f.size).sum();
    keep_probed(url.trim(), &list.torrent_bytes, list.seen_peers.clone());
    Ok(TorrentInfo { name, files, size, hash: list.info_hash.as_string(), peers: list.seen_peers.len() })
}

/// What happens after a torrent finishes (Settings > General).
#[derive(Clone, Copy)]
pub enum Seed {
    /// Stop sharing straight away.
    Stop,
    /// Keep sharing until this much has been uploaded, relative to its size.
    Ratio(f64),
    /// Keep sharing while BaaDash is running.
    Forever,
}

impl Seed {
    pub fn from_setting(s: &str) -> Self {
        match s {
            "forever" => Seed::Forever,
            r => r.parse::<f64>().ok().filter(|r| *r > 0.0).map_or(Seed::Stop, Seed::Ratio),
        }
    }
}

pub struct Job {
    pub url: String,
    pub headers: HeaderMap,
    /// The folder it's saved into.
    pub dir: PathBuf,
    /// Indexes of the files to download; empty means all of them.
    pub files: Vec<usize>,
    pub seed: Seed,
    /// The global download speed limit as it stood when the job started
    /// (the engine's own limiter can't reach into the torrent session).
    pub limit_bps: Option<std::num::NonZeroU32>,
}

/// Downloads a torrent, reporting into `progress` and `note`. Cancelling
/// stops it and keeps what's done; running it again checks the existing
/// pieces and continues.
pub async fn run(client: &Client, job: Job, progress: Arc<Progress>, note: crate::media::Note, cancel: CancellationToken) -> Result<Outcome> {
    let set_note = |t: Option<String>| *note.lock().unwrap() = t;
    set_note(Some(if job.url.starts_with("magnet:") { "Finding peers".into() } else { "Starting".into() }));
    let session = session().await?;
    std::fs::create_dir_all(&job.dir)?;
    // The New download window already probed this torrent: reuse its bytes
    // and the peers that answered, skipping a second swarm lookup. The bytes
    // carry no trackers, so the magnet's own `tr=` list goes back in —
    // on networks where DHT is blocked those trackers are the only peers.
    let probed = take_probed(job.url.trim());
    let (add, initial_peers, trackers) = match probed {
        Some(p) => {
            set_note(Some("Starting".into()));
            (AddTorrent::from_bytes(p.bytes), (!p.peers.is_empty()).then_some(p.peers), magnet_trackers(&job.url))
        }
        None => (source(client, &job.url, &job.headers).await?, None, None),
    };
    let opts = AddTorrentOptions {
        output_folder: Some(job.dir.to_string_lossy().into_owned()),
        only_files: (!job.files.is_empty()).then(|| job.files.clone()),
        overwrite: true, // lets a paused torrent pick up the pieces already on disk
        ratelimits: librqbit::limits::LimitsConfig { upload_bps: None, download_bps: job.limit_bps },
        initial_peers,
        trackers,
        ..Default::default()
    };
    let handle = tokio::select! {
        r = session.add_torrent(add, Some(opts)) => r?.into_handle().ok_or_else(|| anyhow!("the torrent wasn't started"))?,
        _ = cancel.cancelled() => { set_note(None); return Ok(Outcome::Paused); }
    };

    let outcome = loop {
        let stats = handle.stats();
        if let Some(e) = &stats.error {
            break Err(anyhow!("{e}"));
        }
        progress.total.store(stats.total_bytes, Ordering::Relaxed);
        progress.resumable.store(true, Ordering::Relaxed);
        // While the engine checks the disk first, progress_bytes counts the
        // check, not data; report it only once the torrent is live.
        if stats.live.is_some() || stats.finished {
            progress.downloaded.store(stats.progress_bytes, Ordering::Relaxed);
        }
        if stats.finished {
            break Ok(Outcome::Completed);
        }
        match &stats.live {
            Some(live) => {
                let peers = live.snapshot.peer_stats.live;
                let seeds = live.snapshot.peer_stats.live_seeders;
                progress.connections.store(peers as usize, Ordering::Relaxed);
                set_note(Some(match peers {
                    0 => "Looking for peers".into(),
                    1 => "Downloading from 1 peer".into(),
                    n => format!("Downloading from {n} peers · {seeds} seeding"),
                }));
            }
            None => set_note(Some("Checking existing pieces".into())),
        }
        tokio::select! {
            _ = tokio::time::sleep(Duration::from_millis(500)) => {}
            _ = cancel.cancelled() => break Ok(Outcome::Paused),
        }
    };
    progress.connections.store(0, Ordering::Relaxed);
    set_note(None);
    match (&outcome, job.seed) {
        // Finished and set to keep sharing: the download is complete now,
        // and sharing carries on in the background until its limit.
        (Ok(Outcome::Completed), seed @ (Seed::Ratio(_) | Seed::Forever)) => {
            let session = session.clone();
            tauri::async_runtime::spawn(async move {
                if let Seed::Ratio(ratio) = seed {
                    loop {
                        tokio::time::sleep(Duration::from_secs(5)).await;
                        let stats = handle.stats();
                        if stats.error.is_some() || stats.total_bytes == 0 || stats.uploaded_bytes as f64 >= stats.total_bytes as f64 * ratio {
                            break;
                        }
                    }
                    let _ = session.delete(handle.id().into(), false).await;
                }
                // Forever: the torrent stays in the session until BaaDash quits.
            });
        }
        // Otherwise stop sharing and let go of the files; what was
        // downloaded stays on disk.
        _ => {
            let _ = session.delete(handle.id().into(), false).await;
        }
    }
    outcome
}

// ---------- the computer's handler for magnet links and .torrent files ----------

/// Makes BaaDash open magnet links and .torrent files. Windows won't let an
/// app override a choice the user already made for another program; there
/// BaaDash is listed in Default apps so it can be picked.
pub fn register_handlers() -> Result<()> {
    #[cfg(windows)]
    {
        use winreg::RegKey;
        use winreg::enums::HKEY_CURRENT_USER;
        let exe = std::env::current_exe()?.to_string_lossy().into_owned();
        let open = format!("\"{exe}\" --open \"%1\"");
        let icon = format!("\"{exe}\",0");
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let classes = hkcu.create_subkey(r"Software\Classes")?.0;

        // magnet: links
        let magnet = classes.create_subkey("magnet")?.0;
        magnet.set_value("", &"URL:Magnet link")?;
        magnet.set_value("URL Protocol", &"")?;
        magnet.create_subkey("DefaultIcon")?.0.set_value("", &icon)?;
        magnet.create_subkey(r"shell\open\command")?.0.set_value("", &open)?;

        // .torrent files
        let progid = classes.create_subkey("BaaDash.Torrent")?.0;
        progid.set_value("", &"Torrent file")?;
        progid.create_subkey("DefaultIcon")?.0.set_value("", &icon)?;
        progid.create_subkey(r"shell\open\command")?.0.set_value("", &open)?;
        let ext = classes.create_subkey(".torrent")?.0;
        ext.set_value("", &"BaaDash.Torrent")?;
        ext.set_value("Content Type", &"application/x-bittorrent")?;
        ext.create_subkey("OpenWithProgids")?.0.set_value("BaaDash.Torrent", &"")?;

        // Listed in Settings > Apps > Default apps.
        let caps = hkcu.create_subkey(r"Software\BaaDash\Capabilities")?.0;
        caps.set_value("ApplicationName", &"BaaDash")?;
        caps.set_value("ApplicationDescription", &"支持多连接与断点续传的开源下载管理器")?;
        caps.create_subkey("FileAssociations")?.0.set_value(".torrent", &"BaaDash.Torrent")?;
        caps.create_subkey("URLAssociations")?.0.set_value("magnet", &"magnet")?;
        hkcu.create_subkey(r"Software\RegisteredApplications")?.0.set_value("BaaDash", &r"Software\BaaDash\Capabilities")?;

        #[link(name = "shell32")]
        unsafe extern "system" {
            fn SHChangeNotify(event: i32, flags: u32, a: *const std::ffi::c_void, b: *const std::ffi::c_void);
        }
        const SHCNE_ASSOCCHANGED: i32 = 0x0800_0000;
        unsafe { SHChangeNotify(SHCNE_ASSOCCHANGED, 0, std::ptr::null(), std::ptr::null()) };
    }
    #[cfg(target_os = "linux")]
    linux::register()?;
    #[cfg(target_os = "macos")]
    macos::set_default_handler();
    Ok(())
}

/// Linux: a hidden desktop entry for magnet links and .torrent files, set
/// Clears file-type registrations left by the pre-rename SwiftDL identifiers.
pub fn unregister_legacy() {
    #[cfg(windows)]
    {
        use winreg::enums::{HKEY_CURRENT_USER, KEY_SET_VALUE};
        use winreg::RegKey;
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let _ = hkcu.delete_subkey_all(r"Software\Classes\SwiftDL.Torrent");
        let _ = hkcu.delete_subkey_all(r"Software\SwiftDL");
        if let Ok(k) = hkcu.open_subkey_with_flags(r"Software\RegisteredApplications", KEY_SET_VALUE) {
            let _ = k.delete_value("SwiftDL");
        }
        if let Ok(k) = hkcu.open_subkey_with_flags(r"Software\Classes\.torrent\OpenWithProgids", KEY_SET_VALUE) {
            let _ = k.delete_value("SwiftDL.Torrent");
        }
        let legacy_default = hkcu
            .open_subkey(r"Software\Classes\.torrent")
            .and_then(|k| k.get_value::<String, _>(""))
            .ok()
            .as_deref()
            == Some("SwiftDL.Torrent");
        if legacy_default {
            if let Ok(k) = hkcu.open_subkey_with_flags(r"Software\Classes\.torrent", KEY_SET_VALUE) {
                let _ = k.delete_value("");
            }
        }
        let legacy_magnet = hkcu
            .open_subkey(r"Software\Classes\magnet\shell\open\command")
            .and_then(|k| k.get_value::<String, _>(""))
            .map(|c| c.to_lowercase().contains("swiftdl"))
            .unwrap_or(false);
        if legacy_magnet {
            let _ = hkcu.delete_subkey_all(r"Software\Classes\magnet");
        }
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let apps = std::env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local/share")));
        if let Some(apps) = apps {
            let _ = std::fs::remove_file(apps.join("applications/swiftdl-handler.desktop"));
        }
    }
}

/// as the default with xdg-mime. Opening one starts `BaaDash --open <it>`.
#[cfg(target_os = "linux")]
mod linux {
    use anyhow::Result;
    use std::path::PathBuf;
    use std::process::Command;

    const ENTRY: &str = "baadash-handler.desktop";
    const TYPES: [&str; 2] = ["x-scheme-handler/magnet", "application/x-bittorrent"];

    pub fn register() -> Result<()> {
        // An AppImage runs from a temporary mount; $APPIMAGE is the file itself.
        let exe = std::env::var_os("APPIMAGE").map(PathBuf::from).map_or_else(std::env::current_exe, Ok)?;
        let apps = std::env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local/share")))
            .ok_or_else(|| anyhow::anyhow!("no home folder"))?
            .join("applications");
        std::fs::create_dir_all(&apps)?;
        // Desktop entries quote the program and escape \ and " inside it.
        let exec = exe.to_string_lossy().replace('\\', "\\\\").replace('"', "\\\"");
        let entry = format!(
            "[Desktop Entry]\nType=Application\nName=BaaDash\nComment=使用 BaaDash打开种子和磁力链接\n\
             Exec=\"{exec}\" --open %u\nIcon=baadash\nTerminal=false\nNoDisplay=true\nMimeType={};\n",
            TYPES.join(";")
        );
        std::fs::write(apps.join(ENTRY), entry)?;
        for t in TYPES {
            let _ = Command::new("xdg-mime").args(["default", ENTRY, t]).status();
        }
        let _ = Command::new("update-desktop-database").arg(&apps).status();
        Ok(())
    }
}

/// macOS: the app bundle declares magnet links and .torrent files
/// (Info.plist); this makes BaaDash their default handler, and the system
/// hands them over as "opened" events (see main.rs).
#[cfg(target_os = "macos")]
mod macos {
    use std::ffi::c_void;

    type CFStringRef = *const c_void;
    const UTF8: u32 = 0x0800_0100;
    const ALL_ROLES: u32 = 0xFFFF_FFFF;

    #[link(name = "CoreFoundation", kind = "framework")]
    unsafe extern "C" {
        fn CFStringCreateWithBytes(alloc: *const c_void, bytes: *const u8, len: isize, encoding: u32, external: u8) -> CFStringRef;
        fn CFRelease(cf: *const c_void);
    }
    #[link(name = "CoreServices", kind = "framework")]
    unsafe extern "C" {
        fn LSSetDefaultHandlerForURLScheme(scheme: CFStringRef, bundle_id: CFStringRef) -> i32;
        fn LSSetDefaultRoleHandlerForContentType(content_type: CFStringRef, role: u32, bundle_id: CFStringRef) -> i32;
    }

    fn cf(s: &str) -> CFStringRef {
        unsafe { CFStringCreateWithBytes(std::ptr::null(), s.as_ptr(), s.len() as isize, UTF8, 0) }
    }

    pub fn set_default_handler() {
        let (scheme, uti, app) = (cf("magnet"), cf("org.bittorrent.torrent"), cf("com.baadash.app"));
        unsafe {
            LSSetDefaultHandlerForURLScheme(scheme, app);
            LSSetDefaultRoleHandlerForContentType(uti, ALL_ROLES, app);
            for r in [scheme, uti, app] {
                CFRelease(r);
            }
        }
    }
}

/// A magnet link or .torrent file the app was opened with (by the system,
/// as their handler), as `--open <arg>` or as a bare argument.
pub fn parse_open_arg(args: &[String]) -> Option<crate::manager::Incoming> {
    let arg = args.iter().skip(1).find(|a| a.starts_with("magnet:") || (a.to_ascii_lowercase().ends_with(".torrent") && Path::new(a).exists()))?;
    Some(crate::manager::Incoming { url: arg.clone(), filename: None, referrer: None, cookies: None, user_agent: None, qualities: None, pick: None, convert_gif: false, gif_options: None })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognises_torrents() {
        assert!(is_torrent("magnet:?xt=urn:btih:dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c", None));
        assert!(is_torrent("https://example.com/files/ubuntu.iso.torrent?key=1", None));
        assert!(is_torrent(r"C:\Users\me\Downloads\film.TORRENT", None));
        assert!(is_torrent("https://tracker.example/download.php?id=42", Some("film.torrent")));
        assert!(!is_torrent("https://example.com/ubuntu.iso", None));
    }

    #[test]
    fn reads_the_seeding_setting() {
        assert!(matches!(Seed::from_setting("stop"), Seed::Stop));
        assert!(matches!(Seed::from_setting("1"), Seed::Ratio(r) if r == 1.0));
        assert!(matches!(Seed::from_setting("2"), Seed::Ratio(r) if r == 2.0));
        assert!(matches!(Seed::from_setting("forever"), Seed::Forever));
        assert!(matches!(Seed::from_setting("nonsense"), Seed::Stop));
    }

    #[test]
    fn finds_the_link_to_open() {
        let args = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert_eq!(parse_open_arg(&args(&["baadash", "--open", "magnet:?xt=urn:btih:abc"])).unwrap().url, "magnet:?xt=urn:btih:abc");
        assert!(parse_open_arg(&args(&["baadash", "--add", "xyz"])).is_none());
    }

    #[test]
    fn sniffs_torrents_from_the_response() {
        // The "attach-download-10.htm" case: the link name lies, the
        // Content-Disposition filename or Content-Type tells the truth.
        assert!(is_torrent_response("attach-download-10.htm", Some("application/x-bittorrent")));
        assert!(is_torrent_response("film.torrent", Some("application/octet-stream")));
        assert!(!is_torrent_response("attach-download-10.htm", Some("application/octet-stream")));
        assert!(!is_torrent_response("page.htm", Some("text/html")));
    }

    #[test]
    fn pulls_trackers_out_of_a_magnet() {
        let m = "magnet:?xt=urn:btih:abc&tr=udp%3A%2F%2Ftracker.one%3A1337%2Fannounce&tr=http://tracker.two/announce&dn=Name";
        assert_eq!(magnet_trackers(m), Some(vec!["udp://tracker.one:1337/announce".to_string(), "http://tracker.two/announce".to_string()]));
        assert_eq!(magnet_trackers("magnet:?xt=urn:btih:abc"), None);
        assert_eq!(magnet_trackers("https://example.com/f.torrent"), None);
    }
}

/// Downloads from the real BitTorrent network for a while; run on demand:
/// `cargo test -p baadash-app live_torrent -- --ignored --nocapture`
#[cfg(test)]
mod live {
    use super::*;

    #[test]
    #[ignore]
    fn live_torrent() {
        tauri::async_runtime::block_on(async {
            let client = baadash_engine::build_client().unwrap();
            let url = "https://releases.ubuntu.com/26.04.1/ubuntu-26.04.1-desktop-amd64.iso.torrent";
            let info = probe(&client, url, &HeaderMap::new(), CancellationToken::new()).await.unwrap();
            println!("{} · {} file(s) · {} bytes", info.name, info.files.len(), info.size);
            let progress = Arc::new(Progress::default());
            let note = crate::media::Note::default();
            let cancel = CancellationToken::new();
            let dir = std::env::temp_dir().join("baadash-torrent-test");
            let job = Job { url: url.into(), headers: HeaderMap::new(), dir: dir.clone(), files: vec![], seed: Seed::Stop, limit_bps: None };
            let (p, n, c) = (progress.clone(), note.clone(), cancel.clone());
            let watch = tauri::async_runtime::spawn(async move {
                for s in 0..30 {
                    tokio::time::sleep(Duration::from_secs(1)).await;
                    if s % 5 == 4 {
                        println!("{s:>2}s {:>6.1} MB of {:.0} MB, {} peers, {:?}", p.downloaded.load(Ordering::Relaxed) as f64 / 1e6,
                            p.total.load(Ordering::Relaxed) as f64 / 1e6, p.connections.load(Ordering::Relaxed), n.lock().unwrap());
                    }
                }
                c.cancel();
            });
            let outcome = run(&client, job, progress.clone(), note, cancel).await.unwrap();
            watch.await.unwrap();
            println!("outcome: {:?}, kept {} MB", matches!(outcome, Outcome::Paused), progress.downloaded.load(Ordering::Relaxed) / 1_000_000);
            assert!(progress.downloaded.load(Ordering::Relaxed) > 0, "nothing downloaded");
            let _ = std::fs::remove_dir_all(dir);
        });
    }
}
