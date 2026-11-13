use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// Empty means "the system Downloads folder", filled in at startup.
    pub download_dir: PathBuf,
    /// Connections per download.
    pub connections: usize,
    /// Downloads running at the same time; the rest wait in the queue.
    pub max_concurrent: usize,
    /// Global limit across all downloads, KiB/s. 0 = unlimited.
    pub speed_limit_kib: u64,
    /// Save into Downloads\Video, Downloads\Music... by file type.
    pub sort_into_categories: bool,
    /// Show the Add dialog for downloads caught from the browser.
    pub ask_before_download: bool,
    pub notify_on_complete: bool,
    /// Ask installed browsers to offer the extension (they prompt once).
    pub offer_extension: bool,
    /// The user closed the "connect your browser" card.
    pub onboarding_dismissed: bool,
    /// Open a small progress window for each download as it starts.
    pub show_progress_window: bool,
    /// Closing the main window keeps BaaDash running in the tray.
    pub close_to_tray: bool,
    /// "system", "light" or "dark".
    pub theme: String,
    pub accent_color: String,
    pub interface_density: String,
    pub reduce_motion: bool,
    /// After a torrent finishes: "stop", a share ratio such as "1" or "2",
    /// or "forever".
    pub seed_until: String,
    /// Ask public trackers for more peers on public swarms (Settings >
    /// General). Private swarms are always left alone.
    pub auto_trackers: bool,
    pub proxy: String,
    pub bind_address: String,
    pub interface_scale: u32,
    pub clipboard_watch: bool,
    pub start_at: Option<u64>,
    pub when_finished: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            download_dir: PathBuf::new(),
            connections: 8,
            max_concurrent: 3,
            speed_limit_kib: 0,
            sort_into_categories: true,
            ask_before_download: true,
            notify_on_complete: true,
            offer_extension: true,
            onboarding_dismissed: false,
            show_progress_window: true,
            close_to_tray: true,
            theme: "system".into(),
            accent_color: "#e3fa61".into(),
            interface_density: "compact".into(),
            reduce_motion: false,
            seed_until: "stop".into(),
            auto_trackers: true,
            proxy: String::new(),
            bind_address: String::new(),
            interface_scale: 100,
            clipboard_watch: false,
            start_at: None,
            when_finished: String::new(),
        }
    }
}

pub fn native_settings() -> Option<Settings> {
    #[cfg(windows)]
    let root = PathBuf::from(std::env::var_os("APPDATA")?);
    #[cfg(target_os = "macos")]
    let root = PathBuf::from(std::env::var_os("HOME")?).join("Library/Application Support");
    #[cfg(all(unix, not(target_os = "macos")))]
    let root = std::env::var_os("XDG_DATA_HOME").map(PathBuf::from).or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local/share")))?;
    let path = root.join("com.baadash.app/settings.json");
    match std::fs::read(path) {
        Ok(raw) => serde_json::from_slice(&raw).ok(),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Some(Settings::default()),
        Err(_) => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn existing_settings_gain_default_accent_without_losing_preferences() {
        let settings: Settings = serde_json::from_str(r##"{"theme":"dark","connections":16,"downloadDir":"downloads"}"##).unwrap();
        assert_eq!(settings.accent_color, "#e3fa61");
        assert_eq!(settings.theme, "dark");
        assert_eq!(settings.connections, 16);
        let mut updated = settings;
        updated.accent_color = "#7c3aed".into();
        let restored: Settings = serde_json::from_slice(&serde_json::to_vec(&updated).unwrap()).unwrap();
        assert_eq!(restored.accent_color, "#7c3aed");
        assert_eq!(restored.download_dir, PathBuf::from("downloads"));
    }
}
