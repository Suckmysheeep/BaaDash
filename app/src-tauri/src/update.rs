//! Tells the user about a newer BaaDash release on GitHub, and installs it.
//!
//! On Windows the installer is downloaded and run in place; elsewhere the
//! download opens in the browser, since a .dmg or Linux package needs the
//! user's hands anyway.

use anyhow::{Context, Result, bail};
use serde::Serialize;
use serde_json::Value;
use baadash_engine::Client;

const LATEST: &str = "https://api.github.com/repos/Suckmysheeep/BaaDash/releases/latest";

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Update {
    pub version: String,
    /// The release page, with the full notes.
    pub page: String,
    /// This platform's installer, when the release has one.
    pub asset: Option<String>,
}

fn parts(v: &str) -> Vec<u64> {
    v.trim().trim_start_matches('v').split(['.', '-', '+']).map_while(|p| p.parse().ok()).collect()
}

/// Whether `remote` is a later version than `local` (both like "0.3.1").
pub fn is_newer(remote: &str, local: &str) -> bool {
    let (r, l) = (parts(remote), parts(local));
    !r.is_empty() && r > l
}

/// This platform's installer among the release's assets.
fn pick_asset(names: &[(String, String)]) -> Option<String> {
    let suffix = if cfg!(windows) {
        "-setup.exe"
    } else if cfg!(target_os = "macos") {
        ".dmg"
    } else {
        return None; // Linux: .deb, .rpm or AppImage; let the user choose on the page.
    };
    names.iter().find(|(name, _)| name.ends_with(suffix)).map(|(_, url)| url.clone())
}

/// The latest release, if it is newer than this build.
pub async fn check(client: &Client) -> Result<Option<Update>> {
    let body = client
        .get(LATEST)
        .header("User-Agent", "BaaDash")
        .header("Accept", "application/vnd.github+json")
        .send()
        .await?
        .error_for_status()?
        .text()
        .await?;
    let rel: Value = serde_json::from_str(&body).context("GitHub sent an unexpected reply")?;
    let tag = rel["tag_name"].as_str().unwrap_or_default();
    if rel["draft"].as_bool() == Some(true) || rel["prerelease"].as_bool() == Some(true) || !is_newer(tag, env!("CARGO_PKG_VERSION")) {
        return Ok(None);
    }
    let assets: Vec<(String, String)> = rel["assets"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|a| Some((a["name"].as_str()?.to_string(), a["browser_download_url"].as_str()?.to_string())))
        .collect();
    Ok(Some(Update {
        version: tag.trim_start_matches('v').to_string(),
        page: rel["html_url"].as_str().unwrap_or("https://github.com/Suckmysheeep/BaaDash/releases/latest").to_string(),
        asset: pick_asset(&assets),
    }))
}

/// Downloads the Windows installer and starts it. The caller then quits the
/// app so the installer can replace it; `/P` shows only a progress bar, `/UPDATE` keeps
/// the user's shortcuts, and `/R` starts BaaDash again afterwards.
#[cfg(windows)]
pub async fn run_installer(client: &Client, url: &str) -> Result<()> {
    if !url.starts_with("https://github.com/Suckmysheeep/BaaDash/releases/download/") {
        bail!("refusing to install from {url}");
    }
    let bytes = client.get(url).header("User-Agent", "BaaDash").send().await?.error_for_status()?.bytes().await?;
    let path = std::env::temp_dir().join(url.rsplit('/').next().unwrap_or("BaaDash-setup.exe"));
    std::fs::write(&path, &bytes).with_context(|| format!("could not save {}", path.display()))?;
    std::process::Command::new(&path).args(["/P", "/R", "/UPDATE"]).spawn().context("could not start the installer")?;
    Ok(())
}

/// Downloads the macOS disk image, mounts it, and replaces this app bundle
/// through a helper script that waits for the app to quit, then relaunches
/// the new copy. The image is fetched by the app itself, so it carries no
/// quarantine attribute and the copied app opens without a Gatekeeper stop.
#[cfg(target_os = "macos")]
pub async fn run_installer(client: &Client, url: &str) -> Result<()> {
    if !url.starts_with("https://github.com/Suckmysheeep/BaaDash/releases/download/") {
        bail!("refusing to install from {url}");
    }
    let bytes = client.get(url).header("User-Agent", "BaaDash").send().await?.error_for_status()?.bytes().await?;
    let dmg = std::env::temp_dir().join(url.rsplit('/').next().unwrap_or("BaaDash.dmg"));
    std::fs::write(&dmg, &bytes).with_context(|| format!("could not save {}", dmg.display()))?;
    let out = std::process::Command::new("hdiutil")
        .args(["attach", "-nobrowse", "-readonly"])
        .arg(&dmg)
        .output()
        .context("could not mount the downloaded image")?;
    if !out.status.success() {
        bail!("无法挂载下载的安装镜像：{}", String::from_utf8_lossy(&out.stderr).trim());
    }
    let stdout = String::from_utf8_lossy(&out.stdout);
    let mount = stdout
        .lines()
        .filter_map(|l| l.split('\t').next_back().map(str::trim))
        .find(|s| s.starts_with("/Volumes/"))
        .context("无法识别安装镜像的挂载点")?
        .to_string();
    let source = std::fs::read_dir(&mount)?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .find(|p| p.extension().is_some_and(|e| e == "app"))
        .context("安装镜像中没有找到应用")?;
    // The running bundle, e.g. /Applications/BaaDash.app from
    // /Applications/BaaDash.app/Contents/MacOS/baadash.
    let exe = std::env::current_exe()?;
    let bundle = exe
        .ancestors()
        .find(|p| p.extension().is_some_and(|e| e == "app"))
        .context("当前并非从应用包运行，无法原地更新")?
        .to_path_buf();
    // Fail early rather than from the detached script.
    let probe = bundle.with_extension("write-test");
    std::fs::write(&probe, b"").context("没有写入应用所在目录的权限，请从页面手动安装")?;
    let _ = std::fs::remove_file(&probe);
    let script = std::env::temp_dir().join("baadash-update.sh");
    std::fs::write(
        &script,
        format!(
            "#!/bin/sh\nwhile kill -0 {} 2>/dev/null; do sleep 0.2; done\nditto \"{}\" \"{}\"\nhdiutil detach \"{}\" -quiet\nopen \"{}\"\n",
            std::process::id(),
            source.display(),
            bundle.display(),
            mount,
            bundle.display(),
        ),
    )?;
    std::process::Command::new("/bin/sh")
        .arg(&script)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .context("could not start the install helper")?;
    Ok(())
}

#[cfg(not(any(windows, target_os = "macos")))]
pub async fn run_installer(_client: &Client, _url: &str) -> Result<()> {
    bail!("installing in place is only supported on Windows and macOS")
}

#[cfg(test)]
mod tests {
    use super::is_newer;

    #[test]
    fn compares_versions() {
        assert!(is_newer("v0.3.2", "0.3.1"));
        assert!(is_newer("0.10.0", "0.9.9"));
        assert!(is_newer("v1.0.0", "0.99.0"));
        assert!(!is_newer("v0.3.1", "0.3.1"));
        assert!(!is_newer("v0.3.0", "0.3.1"));
        assert!(!is_newer("nightly", "0.3.1"));
    }
}
