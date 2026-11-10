//! A plain-text log in the app's data folder, for bug reports. A desktop app
//! has no console, so anything worth knowing when something goes wrong goes
//! here. Settings → About opens it.

use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

static LOCK: Mutex<()> = Mutex::new(());
/// Past this the log starts over, keeping the previous one as `swiftdl.old.log`.
const MAX: u64 = 1024 * 1024;

pub fn path() -> PathBuf {
    crate::browser::data_dir().join("swiftdl.log")
}

pub fn line(msg: &str) {
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let p = path();
    if let Some(dir) = p.parent() { let _ = std::fs::create_dir_all(dir); }
    if std::fs::metadata(&p).is_ok_and(|m| m.len() > MAX) {
        let _ = std::fs::rename(&p, p.with_file_name("swiftdl.old.log"));
    }
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let (h, m, s) = ((secs / 3600) % 24, (secs / 60) % 60, secs % 60);
    let day = secs / 86400;
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&p) {
        let _ = writeln!(f, "day {day} {h:02}:{m:02}:{s:02} UTC  {}", msg.trim_end());
    }
    #[cfg(debug_assertions)]
    eprintln!("{msg}");
}

/// Records panics too, so a crash leaves a trace.
pub fn install_panic_hook() {
    let prev = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        line(&format!("panic: {info}"));
        prev(info);
    }));
}
