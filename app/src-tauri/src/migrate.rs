//! One-time move off the legacy SwiftDL identifiers: data folders, native
//! host manifests and file-type registrations. Runs on every launch and
//! does nothing once the old folders and registrations are gone.

use std::path::{Path, PathBuf};

const LEGACY_ID: &str = "com.swiftdl.app";

pub fn run() {
    for base in bases() {
        move_dir(&base.join(LEGACY_ID), &base.join(crate::browser::APP_ID));
    }
    let host_dir = crate::browser::data_dir().join("native-host");
    for name in ["com.swiftdl.host.json", "com.swiftdl.host.firefox.json"] {
        let _ = std::fs::remove_file(host_dir.join(name));
    }
    crate::browser::unregister_legacy();
    crate::torrent::unregister_legacy();
}

/// Every per-user base that may hold an identifier-named folder: Tauri's
/// data dir plus the local/WebKit caches the webview keeps beside it.
fn bases() -> Vec<PathBuf> {
    let mut v = Vec::new();
    #[cfg(windows)]
    {
        for var in ["APPDATA", "LOCALAPPDATA"] {
            if let Some(p) = std::env::var_os(var) {
                v.push(PathBuf::from(p));
            }
        }
    }
    #[cfg(target_os = "macos")]
    {
        if let Some(h) = std::env::var_os("HOME") {
            let h = PathBuf::from(h);
            v.push(h.join("Library/Application Support"));
            v.push(h.join("Library/Caches"));
            v.push(h.join("Library/WebKit"));
        }
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let home = || std::env::var_os("HOME").map(PathBuf::from);
        if let Some(p) = std::env::var_os("XDG_DATA_HOME").map(PathBuf::from).or_else(|| home().map(|h| h.join(".local/share"))) {
            v.push(p);
        }
        if let Some(p) = std::env::var_os("XDG_CACHE_HOME").map(PathBuf::from).or_else(|| home().map(|h| h.join(".cache"))) {
            v.push(p);
        }
    }
    v
}

fn move_dir(old: &Path, new: &Path) {
    if !old.is_dir() {
        return;
    }
    if !new.exists() {
        match std::fs::rename(old, new) {
            Ok(()) => crate::log::line(&format!("migrated legacy data folder {} -> {}", old.display(), new.display())),
            Err(e) => crate::log::line(&format!("legacy data folder busy, migration deferred: {e}")),
        }
        return;
    }
    // Both generations present: keep the new folder, pull over what it lacks.
    if let Ok(entries) = std::fs::read_dir(old) {
        for e in entries.flatten() {
            let dest = new.join(e.file_name());
            if !dest.exists() {
                let _ = std::fs::rename(e.path(), dest);
            }
        }
    }
}