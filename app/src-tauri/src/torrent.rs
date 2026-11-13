//! Torrents and magnet links, through librqbit (a BitTorrent engine in Rust).
//!
//! A torrent is read first for its file list (the New download window lets
//! the user pick files), then run as a download like any other: progress,
//! speed, pause and resume. When it finishes it stops sharing, which is what
//! people expect from a download manager. BaaDash also registers itself as
//! the computer's handler for magnet links and .torrent files.

use anyhow::{Context, Result, anyhow, bail};
use librqbit::{AddTorrent, AddTorrentOptions, AddTorrentResponse, DhtSessionConfig, ListenerOptions, Session, SessionOptions};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicBool, Ordering};
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

/// A magnet link's v1 info hash (its `xt=urn:btih:` parameter).
fn magnet_hash(url: &str) -> Option<String> {
    let query = url.trim().strip_prefix("magnet:")?.split(['?', '#']).nth(1)?;
    let xt = url::form_urlencoded::parse(query.as_bytes()).find(|(k, _)| k == "xt")?.1.into_owned();
    let hash = xt.strip_prefix("urn:btih:")?;
    (hash.len() == 40 && hash.bytes().all(|b| b.is_ascii_hexdigit())).then(|| hash.to_ascii_lowercase())
}

/// Public torrent caches keep .torrent files keyed by info hash. On networks
/// where DHT is poisoned or filtered they answer in seconds while the swarm
/// stays silent; the caller still verifies the hash of what comes back.
async fn fetch_cached_metadata(client: &Client, hash: &str) -> Result<Vec<u8>> {
    let url = format!("https://itorrents.net/torrent/{hash}.torrent");
    let bytes = tokio::time::timeout(Duration::from_secs(20), async {
        let resp = client.get(&url).send().await?.error_for_status()?;
        resp.bytes().await
    })
    .await
    .context("the metadata cache didn't answer")??;
    if bytes.first() != Some(&b'd') || bytes.len() > 20 * 1024 * 1024 {
        bail!("the metadata cache returned junk");
    }
    Ok(bytes.to_vec())
}

/// One BitTorrent session for the whole app, started on first use.
static SESSION: OnceCell<Arc<Session>> = OnceCell::const_new();

/// DHT bootstrap nodes. librqbit's built-in list is only two of these, and
/// both are unreachable from some networks (DNS poisoning, UDP filtering),
/// which leaves magnets unfindable; asking a wider set gets in far more often.
const BOOTSTRAP: [&str; 6] = [
    "router.bittorrent.com:6881",
    "router.utorrent.com:6881",
    "dht.transmissionbt.com:6881",
    "dht.libtorrent.org:25401",
    "dht.aelitis.com:6881",
    "bttracker.debian.org:6881",
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
            // Listen for incoming connections too — TCP and uTP (UDP),
            // which reaches peers behind stricter NATs — and ask the router
            // to forward the port (UPnP). Without this the engine only ever
            // dials out, which halves the reachable swarm — and on CGNAT
            // networks incoming is often the only way to reach rare swarms.
            let listen = ListenerOptions {
                mode: librqbit::ListenerMode::TcpAndUtp,
                enable_upnp_port_forwarding: true,
                ..Default::default()
            };
            // 200 peers per torrent (the engine caps at 128 by default):
            // dead peers holding slots is the norm on residential networks.
            let opts = SessionOptions { dht: Some(dht), listen: Some(listen), peer_limit: Some(200), ..Default::default() };
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

/// Public trackers give magnets far more peers than the link itself carries.
/// XIU2's list (selected for reachability from Chinese networks) is the
/// primary source; ngosang/trackerslist's full list, via jsDelivr or GitHub,
/// is the fallback.
const TRACKER_SOURCES: [&str; 3] = [
    "https://cf.trackerslist.com/best.txt",
    "https://cdn.jsdelivr.net/gh/ngosang/trackerslist@master/trackers_all.txt",
    "https://raw.githubusercontent.com/ngosang/trackerslist/master/trackers_all.txt",
];
const TRACKER_TTL: Duration = Duration::from_secs(24 * 3600);

static PUBLIC_TRACKERS: std::sync::RwLock<Vec<String>> = std::sync::RwLock::new(Vec::new());

fn public_trackers() -> Vec<String> {
    PUBLIC_TRACKERS.read().unwrap_or_else(|e| e.into_inner()).clone()
}

/// Loads the cached tracker list, then refreshes it in the background when
/// it's more than a day old. Called once at startup.
pub async fn refresh_trackers(client: &Client, data_dir: &Path) {
    let file = data_dir.join("trackers.txt");
    if let Ok(text) = std::fs::read_to_string(&file) {
        let list: Vec<String> = text.lines().map(str::trim).filter(|l| !l.is_empty()).take(100).map(str::to_string).collect();
        if !list.is_empty() {
            *PUBLIC_TRACKERS.write().unwrap_or_else(|e| e.into_inner()) = list;
        }
    }
    let fresh = std::fs::metadata(&file)
        .and_then(|m| m.modified())
        .map(|t| t.elapsed().unwrap_or_default() < TRACKER_TTL)
        .unwrap_or(false);
    if fresh {
        return;
    }
    for url in TRACKER_SOURCES {
        let fetched = async {
            let resp = client.get(url).send().await?.error_for_status()?;
            resp.text().await
        };
        if let Ok(Ok(text)) = tokio::time::timeout(Duration::from_secs(15), fetched).await {
            let list: Vec<String> = text.lines().map(str::trim).filter(|l| !l.is_empty()).take(100).map(str::to_string).collect();
            if list.len() >= 10 {
                crate::log::line(&format!("public tracker list updated: {} trackers", list.len()));
                *PUBLIC_TRACKERS.write().unwrap_or_else(|e| e.into_inner()) = list.clone();
                let _ = std::fs::write(&file, list.join("\n"));
                return;
            }
        }
    }
    crate::log::line("could not refresh the public tracker list");
}

/// The private flag inside .torrent bytes: private (PT) swarms must never
/// be announced to public trackers. A file that won't parse is treated as
/// private — caution costs nothing here.
fn torrent_private(bytes: &[u8]) -> bool {
    librqbit::torrent_from_bytes(bytes).map(|t| t.info.data.private).unwrap_or(true)
}

/// What to give the engine: magnets as they are; .torrent files are read
/// (local) or fetched with the page's cookies (web), since many sites only
/// hand them out to a signed-in browser. The bytes come along too: they
/// carry the private flag.
async fn source(client: &Client, url: &str, headers: &HeaderMap) -> Result<(AddTorrent<'static>, Option<Vec<u8>>)> {
    let url = url.trim();
    if url.starts_with("magnet:") {
        return Ok((AddTorrent::from_url(url.to_string()), None));
    }
    let bytes = if url.starts_with("http://") || url.starts_with("https://") {
        let resp = client.get(url).headers(headers.clone()).send().await?.error_for_status()?;
        resp.bytes().await?.to_vec()
    } else {
        let path = url.strip_prefix("file://").unwrap_or(url);
        std::fs::read(path).with_context(|| format!("couldn't read {path}"))?
    };
    if bytes.first() != Some(&b'd') {
        bail!("that link didn't return a .torrent file");
    }
    Ok((AddTorrent::from_bytes(bytes.clone()), Some(bytes)))
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
#[derive(Clone)]
struct Probed {
    bytes: Vec<u8>,
    peers: Vec<std::net::SocketAddr>,
    /// Private swarms (PT) must never see public trackers.
    private: bool,
    at: std::time::Instant,
}
static PROBED: Mutex<Vec<(String, Probed)>> = Mutex::new(Vec::new());
const PROBED_TTL: Duration = Duration::from_secs(15 * 60);

fn keep_probed(url: &str, bytes: &[u8], peers: Vec<std::net::SocketAddr>, private: bool) {
    let mut g = PROBED.lock().unwrap();
    g.retain(|(_, p)| p.at.elapsed() < PROBED_TTL);
    g.retain(|(u, _)| u != url);
    if g.len() >= 8 {
        g.remove(0);
    }
    g.push((url.to_string(), Probed { bytes: bytes.to_vec(), peers, private, at: std::time::Instant::now() }));
}

fn get_probed(url: &str) -> Option<Probed> {
    let mut g = PROBED.lock().unwrap();
    g.retain(|(_, p)| p.at.elapsed() < PROBED_TTL);
    g.iter().find(|(u, _)| u == url).map(|(_, p)| p.clone())
}

/// Paused downloads stay in the engine — files open, peers warm, checked
/// pieces remembered — so resuming is instant instead of a cold start.
/// Keyed by the job's link.
static PAUSED: Mutex<Vec<(String, Arc<librqbit::ManagedTorrent>)>> = Mutex::new(Vec::new());

fn take_paused(url: &str) -> Option<Arc<librqbit::ManagedTorrent>> {
    let mut g = PAUSED.lock().unwrap();
    g.iter().position(|(u, _)| u == url).map(|i| g.remove(i).1)
}

/// A paused task that gets deleted leaves the engine too (its files unlock).
pub fn drop_paused(url: &str) {
    if let (Some(handle), Some(session)) = (take_paused(url), SESSION.get()) {
        let session = session.clone();
        tauri::async_runtime::spawn(async move {
            let _ = session.delete(handle.id().into(), false).await;
        });
    }
}

/// Reads a torrent's name and files without downloading it. For a magnet
/// link this asks peers for the details first, which can take a moment.
pub async fn probe(client: &Client, url: &str, headers: &HeaderMap, cancel: CancellationToken, auto_trackers: bool) -> Result<TorrentInfo> {
    // Each stage goes to the log: if a probe ever hangs again, the last line
    // says exactly where it stopped.
    let short: String = url.trim().chars().take(80).collect();
    crate::log::line(&format!("torrent probe started: {short}"));
    let started = std::time::Instant::now();
    let session = tokio::select! {
        s = session() => s?,
        _ = cancel.cancelled() => { crate::log::line("torrent probe cancelled before the engine was up"); bail!("cancelled") }
    };
    let (add, src_bytes) = source(client, url, headers).await?;
    // Public trackers join in, except for private swarms (PT), where they
    // must never be announced. Magnets are public by nature; a .torrent's
    // flag is in its bytes — plenty of public torrents ship with trackers
    // long dead, and asking the public list finds peers for them too.
    let private = src_bytes.as_deref().is_some_and(torrent_private);
    let extra: Vec<String> = if auto_trackers && !private { public_trackers() } else { vec![] };
    let list_opts = || AddTorrentOptions { list_only: true, trackers: (!extra.is_empty()).then(|| extra.clone()), ..Default::default() };
    // Two roads to a magnet's metadata race each other: the swarm
    // (DHT/trackers) and public caches keyed by info hash. On networks where
    // DHT is poisoned the cache answers in seconds.
    let deadline = tokio::time::Instant::now() + Duration::from_secs(90);
    let from_swarm = session.add_torrent(add, Some(list_opts()));
    tokio::pin!(from_swarm);
    let from_swarm_log = |r: &Result<Result<AddTorrentResponse>, tokio::time::error::Elapsed>| match r {
        Ok(Ok(_)) => crate::log::line(&format!("torrent probe: swarm answered in {:.1}s: {short}", started.elapsed().as_secs_f64())),
        Ok(Err(e)) => crate::log::line(&format!("torrent probe failed in {:.1}s: {e:#}: {short}", started.elapsed().as_secs_f64())),
        Err(_) => crate::log::line(&format!("torrent probe timed out after 90s: {short}")),
    };
    let resp = if let Some(hash) = magnet_hash(url) {
        let from_cache = fetch_cached_metadata(client, &hash);
        tokio::pin!(from_cache);
        tokio::select! {
            r = tokio::time::timeout_at(deadline, &mut from_swarm) => {
                from_swarm_log(&r);
                r.map_err(|_| anyhow!("couldn't find anyone sharing this torrent"))??
            }
            b = &mut from_cache => match b {
                Ok(bytes) => {
                    crate::log::line(&format!("torrent probe: metadata cache answered in {:.1}s: {short}", started.elapsed().as_secs_f64()));
                    match session.add_torrent(AddTorrent::from_bytes(bytes), Some(list_opts())).await {
                        Ok(cached @ AddTorrentResponse::ListOnly(_)) => {
                            // The cache is fast but knows no peers (a file
                            // list from bytes needs no swarm). Give the swarm
                            // a moment to name who's sharing, then prefer it.
                            match tokio::time::timeout(Duration::from_secs(4), &mut from_swarm).await {
                                Ok(Ok(swarm @ AddTorrentResponse::ListOnly(_))) => {
                                    crate::log::line(&format!("torrent probe: swarm answered in {:.1}s: {short}", started.elapsed().as_secs_f64()));
                                    swarm
                                }
                                _ => cached,
                            }
                        }
                        other => {
                            let why = other.err().map(|e| format!("{e:#}")).unwrap_or_else(|| "unexpected answer".into());
                            crate::log::line(&format!("torrent probe: cached metadata rejected ({why}); waiting on the swarm"));
                            let r = tokio::time::timeout_at(deadline, &mut from_swarm).await;
                            from_swarm_log(&r);
                            r.map_err(|_| anyhow!("couldn't find anyone sharing this torrent"))??
                        }
                    }
                }
                Err(e) => {
                    crate::log::line(&format!("torrent probe: no luck from the metadata cache ({e:#}); waiting on the swarm"));
                    let r = tokio::time::timeout_at(deadline, &mut from_swarm).await;
                    from_swarm_log(&r);
                    r.map_err(|_| anyhow!("couldn't find anyone sharing this torrent"))??
                }
            },
            _ = cancel.cancelled() => { crate::log::line(&format!("torrent probe cancelled after {:.1}s: {short}", started.elapsed().as_secs_f64())); bail!("cancelled") }
        }
    } else {
        tokio::select! {
            r = tokio::time::timeout_at(deadline, &mut from_swarm) => {
                from_swarm_log(&r);
                r.map_err(|_| anyhow!("couldn't find anyone sharing this torrent"))??
            }
            _ = cancel.cancelled() => { crate::log::line(&format!("torrent probe cancelled after {:.1}s: {short}", started.elapsed().as_secs_f64())); bail!("cancelled") }
        }
    };
    let AddTorrentResponse::ListOnly(list) = resp else { bail!("unexpected answer from the torrent engine") };
    // Whatever answered, the metadata must belong to the link asked about.
    if let Some(h) = magnet_hash(url) {
        if !list.info_hash.as_string().eq_ignore_ascii_case(&h) {
            crate::log::line(&format!("torrent probe: metadata hash mismatch, rejected: {short}"));
            bail!("the metadata found belongs to a different torrent");
        }
    }
    let info = &list.info;
    let name = info.name().map(|n| n.to_string()).unwrap_or_else(|| "torrent".into());
    let files: Vec<TorrentFile> = info
        .iter_file_details()
        .map(|f| TorrentFile { path: f.filename.to_pathbuf().to_string_lossy().replace('\\', "/"), size: f.len })
        .collect();
    let size = files.iter().map(|f| f.size).sum();
    let private = info.info().private;
    keep_probed(url.trim(), &list.torrent_bytes, list.seen_peers.clone(), private);
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
    /// Settings > General: ask public trackers for more peers (never for
    /// private swarms).
    pub auto_trackers: bool,
    /// Cleared when the task is being deleted: pausing then removes the
    /// engine task instead of keeping it warm.
    pub warm_pause: Arc<AtomicBool>,
}

/// Downloads a torrent, reporting into `progress` and `note`. Cancelling
/// stops it and keeps what's done; running it again checks the existing
/// pieces and continues.
pub async fn run(client: &Client, job: Job, progress: Arc<Progress>, note: crate::media::Note, cancel: CancellationToken) -> Result<Outcome> {
    let set_note = |t: Option<String>| *note.lock().unwrap() = t;
    set_note(Some(if job.url.starts_with("magnet:") { "Finding peers".into() } else { "Starting".into() }));
    let session = session().await?;
    std::fs::create_dir_all(&job.dir)?;
    // A paused download is still in the engine: resuming it keeps the warm
    // peers and skips the disk re-check entirely.
    let mut resumed = take_paused(job.url.trim());
    if let Some(h) = &resumed {
        match session.unpause(h).await {
            Ok(()) => set_note(Some("Resuming".into())),
            Err(e) => {
                crate::log::line(&format!("paused torrent would not resume ({e:#}); starting it fresh"));
                let _ = session.delete(h.id().into(), false).await;
                resumed = None;
            }
        }
    }
    let handle = match resumed {
        Some(h) => h,
        None => {
            // The New download window already probed this torrent: reuse its
            // bytes and the peers that answered, skipping a second swarm
            // lookup. The bytes carry no trackers, so the magnet's own `tr=`
            // list goes back in — on networks where DHT is blocked those
            // trackers are the only peers.
            let probed = get_probed(job.url.trim());
            let (add, initial_peers, private) = match probed {
                Some(p) => {
                    set_note(Some("Starting".into()));
                    (AddTorrent::from_bytes(p.bytes), (!p.peers.is_empty()).then_some(p.peers), p.private)
                }
                None => {
                    let (add, bytes) = source(client, &job.url, &job.headers).await?;
                    (add, None, bytes.as_deref().is_some_and(torrent_private))
                }
            };
            // Public trackers join in, except for private swarms (PT), where
            // they must never be announced. Magnets are public by nature; a
            // .torrent's flag is in its bytes — the probe's answer, or the
            // file itself when there's no probe (resuming after a restart).
            let allow_public = job.auto_trackers && !private;
            let mut trackers = magnet_trackers(&job.url).unwrap_or_default();
            if allow_public {
                for t in public_trackers() {
                    if !trackers.contains(&t) {
                        trackers.push(t);
                    }
                }
            }
            let opts = AddTorrentOptions {
                output_folder: Some(job.dir.to_string_lossy().into_owned()),
                only_files: (!job.files.is_empty()).then(|| job.files.clone()),
                overwrite: true, // lets a fresh start pick up the pieces already on disk
                ratelimits: librqbit::limits::LimitsConfig { upload_bps: None, download_bps: job.limit_bps },
                initial_peers,
                trackers: (!trackers.is_empty()).then_some(trackers),
                ..Default::default()
            };
            tokio::select! {
                r = session.add_torrent(add, Some(opts)) => r?.into_handle().ok_or_else(|| anyhow!("the torrent wasn't started"))?,
                _ = cancel.cancelled() => { set_note(None); return Ok(Outcome::Paused); }
            }
        }
    };

    let mut silent_since: Option<std::time::Instant> = None;
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
                if peers == 0 {
                    // Say the quiet part out loud after a while: waiting
                    // forever without a word is the worst BT experience.
                    let silent = silent_since.get_or_insert_with(std::time::Instant::now);
                    set_note(Some(if silent.elapsed() >= Duration::from_secs(300) {
                        "找不到有文件的节点：这个种子可能已经没人分享了".into()
                    } else {
                        "Looking for peers".into()
                    }));
                } else {
                    silent_since = None;
                    set_note(Some(match peers {
                        1 => "Downloading from 1 peer".into(),
                        n => format!("Downloading from {n} peers · {seeds} seeding"),
                    }));
                }
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
        // Paused: keep the engine task warm — its peers stay connected and
        // its checked pieces stay known, so resuming is instant. A task
        // being deleted has cleared its warm flag and falls through to
        // removal instead.
        (Ok(Outcome::Paused), _) if job.warm_pause.load(Ordering::Relaxed) => {
            match session.pause(&handle).await {
                Ok(()) => {
                    // Deletion may have landed while the pause was in flight;
                    // re-check the flag under the lock so drop_paused and
                    // this store can't pass each other.
                    let mut g = PAUSED.lock().unwrap();
                    if job.warm_pause.load(Ordering::Relaxed) {
                        g.retain(|(u, _)| u != job.url.trim());
                        g.push((job.url.trim().to_string(), handle));
                    } else {
                        drop(g);
                        let _ = session.delete(handle.id().into(), false).await;
                    }
                }
                Err(e) => {
                    crate::log::line(&format!("could not keep the paused torrent warm ({e:#}); removing it from the engine"));
                    let _ = session.delete(handle.id().into(), false).await;
                }
            }
        }
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

    #[test]
    fn reads_the_private_flag() {
        // Minimal hand-built torrents (dict keys in bencode order).
        let public = b"d4:infod6:lengthi1e4:name1:a12:piece lengthi16384e6:pieces20:aaaaaaaaaaaaaaaaaaaaee";
        let private = b"d4:infod6:lengthi1e4:name1:a12:piece lengthi16384e6:pieces20:aaaaaaaaaaaaaaaaaaaa7:privatei1eee";
        assert!(!torrent_private(public));
        assert!(torrent_private(private));
        assert!(torrent_private(b"garbage")); // unparseable: better safe than announcing PT
    }

    #[test]
    fn pulls_the_hash_out_of_a_magnet() {
        let h40 = "dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c";
        assert_eq!(magnet_hash(&format!("magnet:?xt=urn:btih:{h40}&dn=Name")), Some(h40.to_string()));
        assert_eq!(magnet_hash("magnet:?xt=urn:btih:DD8255ECDC7CA55FB0BBF81323D87062DB1F6D1C"), Some(h40.to_string()));
        assert_eq!(magnet_hash("magnet:?xt=urn:btih:tooshort"), None);
        assert_eq!(magnet_hash("magnet:?xt=urn:btmh:1220abcd"), None); // v2-only links have no v1 cache entry
        assert_eq!(magnet_hash("https://example.com/f.torrent"), None);
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
            let info = probe(&client, url, &HeaderMap::new(), CancellationToken::new(), true).await.unwrap();
            println!("{} · {} file(s) · {} bytes", info.name, info.files.len(), info.size);
            let progress = Arc::new(Progress::default());
            let note = crate::media::Note::default();
            let cancel = CancellationToken::new();
            let dir = std::env::temp_dir().join("baadash-torrent-test");
            let job = Job { url: url.into(), headers: HeaderMap::new(), dir: dir.clone(), files: vec![], seed: Seed::Stop, limit_bps: None, auto_trackers: true, warm_pause: Arc::new(AtomicBool::new(true)) };
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
