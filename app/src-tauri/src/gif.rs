//! Local, site-independent video-to-GIF conversion. The source is retained,
//! and users choose the time range, dimensions and frame rate in the browser.

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use std::io::{Read as _, Write as _};
use std::path::{Path, PathBuf};
use std::process::ExitStatus;
use swiftdl_engine::Client;
use crate::media::Note;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct UgoiraFrame {
    pub file: String,
    /// Pixiv's display delay for this frame, in milliseconds.
    pub delay: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GifOptions {
    /// Start and end in seconds. An absent end means the entire source.
    #[serde(default)]
    pub start: f64,
    #[serde(default)]
    pub end: Option<f64>,
    /// Target long side; aspect ratio is always retained. None = exact source size.
    #[serde(default)]
    pub size: Option<u32>,
    #[serde(default = "default_fps")]
    pub fps: u32,
    #[serde(default = "default_colors")]
    pub colors: u32,
    /// Present only for a Pixiv ugoira ZIP: file names and per-frame delays.
    #[serde(default)]
    pub frames: Option<Vec<UgoiraFrame>>,
}

const fn default_fps() -> u32 { 12 }
const fn default_colors() -> u32 { 128 }

impl Default for GifOptions {
    fn default() -> Self {
        Self { start: 0.0, end: None, size: None, fps: default_fps(), colors: default_colors(), frames: None }
    }
}

impl GifOptions {
    fn validated(mut self) -> Result<Self> {
        if !self.start.is_finite() || self.start < 0.0 || self.end.is_some_and(|end| !end.is_finite() || end <= self.start) {
            bail!("GIF 的开始时间或结束时间无效");
        }
        if !(1..=60).contains(&self.fps) || !(2..=256).contains(&self.colors) || self.size.is_some_and(|size| !(16..=7680).contains(&size)) {
            bail!("GIF 的帧率、尺寸或颜色参数无效");
        }
        if self.frames.as_ref().is_some_and(|frames| frames.is_empty() || frames.len() > 10_000 || frames.iter().any(|f| f.file.is_empty() || !(1..=60_000).contains(&f.delay))) {
            bail!("Pixiv 动图帧信息无效");
        }
        // GIF stores frame delays in hundredths of a second.
        self.start = (self.start * 100.0).round() / 100.0;
        self.end = self.end.map(|end| (end * 100.0).round() / 100.0);
        Ok(self)
    }

    #[cfg(test)]
    fn filter(&self) -> String { filter(self) }
}

fn filter(options: &GifOptions) -> String {
    // GIF has no even-dimension requirement. Without a size choice, do not
    // resize at all; otherwise fit to the requested long side, retaining ratio.
    let scale = options.size.map_or_else(String::new, |size| {
        format!(",scale={size}:{size}:force_original_aspect_ratio=decrease:flags=lanczos")
    });
    format!("fps={}{scale},split[a][b];[a]palettegen=max_colors={}[p];[b][p]paletteuse=dither=sierra2_4a", options.fps, options.colors)
}

fn video(ffmpeg: &Path, source: &Path, dest: &Path, options: &GifOptions) -> Result<ExitStatus> {
    let mut cmd = crate::media::quiet_command(ffmpeg);
    cmd.args(["-hide_banner", "-loglevel", "error", "-y"]);
    if options.start > 0.0 {
        cmd.arg("-ss").arg(options.start.to_string());
    }
    cmd.arg("-i").arg(source).arg("-an");
    if let Some(end) = options.end {
        cmd.arg("-t").arg((end - options.start).to_string());
    }
    Ok(cmd.arg("-vf").arg(filter(options)).args(["-loop", "0"]).arg(dest).status()?)
}

struct TempFolder(PathBuf);
impl Drop for TempFolder {
    fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.0); }
}

/// Converts Pixiv's timed JPEG/PNG frames without losing their individual
/// delays. Only our own ASCII file names are written to the temporary folder.
fn ugoira(ffmpeg: &Path, source: &Path, dest: &Path, options: &GifOptions) -> Result<ExitStatus> {
    let frames = options.frames.as_deref().context("Pixiv 动图缺少帧信息")?;
    let nonce = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_nanos();
    let temp = TempFolder(std::env::temp_dir().join(format!("swiftdl-ugoira-{}-{nonce}", std::process::id())));
    std::fs::create_dir_all(&temp.0)?;
    let mut archive = zip::ZipArchive::new(std::fs::File::open(source)?)?;
    let mut script = String::from("ffconcat version 1.0\n");
    let mut last = String::new();
    for (index, frame) in frames.iter().enumerate() {
        let ext = Path::new(&frame.file).extension().map(|e| e.to_string_lossy().to_ascii_lowercase()).unwrap_or_default();
        if !matches!(ext.as_str(), "jpg" | "jpeg" | "png" | "webp") {
            bail!("不支持的 Pixiv 帧格式：{ext}");
        }
        let local = format!("frame-{index:06}.{ext}");
        let mut entry = archive.by_name(&frame.file).with_context(|| format!("Pixiv 帧包缺少 {}", frame.file))?;
        let mut bytes = vec![];
        entry.read_to_end(&mut bytes)?;
        std::fs::write(temp.0.join(&local), bytes)?;
        script.push_str(&format!("file '{local}'\nduration {:.3}\n", frame.delay as f64 / 1000.0));
        last = local;
    }
    // The concat demuxer needs the last file repeated for its final delay.
    script.push_str(&format!("file '{last}'\n"));
    std::fs::write(temp.0.join("frames.ffconcat"), script)?;

    // The repeated final image and GIF's own final delay can otherwise add a
    // spurious tail. Clamp to the timed-frame duration, or the user's range.
    let total = frames.iter().map(|frame| frame.delay as f64 / 1000.0).sum::<f64>();
    let end = options.end.unwrap_or(total).min(total);
    if end <= options.start {
        bail!("GIF 的时间范围超出 Pixiv 动图片段");
    }
    let mut cmd = crate::media::quiet_command(ffmpeg);
    cmd.current_dir(&temp.0).args(["-hide_banner", "-loglevel", "error", "-y"]);
    if options.start > 0.0 {
        cmd.arg("-ss").arg(options.start.to_string());
    }
    cmd.args(["-f", "concat", "-safe", "0", "-i", "frames.ffconcat", "-an"]);
    cmd.arg("-t").arg((end - options.start).to_string());
    Ok(cmd.arg("-vf").arg(filter(options)).args(["-loop", "0"]).arg(dest).status()?)
}

pub async fn convert(client: &Client, note: &Note, input: &Path, options: GifOptions) -> Result<PathBuf> {
    let options = options.validated()?;
    crate::media::ensure_ffmpeg(client, note).await?;
    let ffmpeg = crate::media::ffmpeg_path().context("GIF 转换需要 FFmpeg，请安装后重试")?;
    let parent = input.parent().unwrap_or_else(|| Path::new("."));
    let stem = input.file_stem().map(|s| s.to_string_lossy()).unwrap_or_else(|| "animation".into());
    let output = swiftdl_engine::resolve_dest(parent, &format!("{stem}.gif"));
    crate::media::set_note(note, "正在转换 GIF");

    let source = input.to_path_buf();
    let dest = output.clone();
    let status = tauri::async_runtime::spawn_blocking(move || {
        if options.frames.is_some() {
            ugoira(&ffmpeg, &source, &dest, &options)
        } else {
            video(&ffmpeg, &source, &dest, &options)
        }
    }).await?;
    match status {
        Ok(status) if status.success() => Ok(output),
        Ok(_) => {
            let _ = std::fs::remove_file(&output);
            bail!("GIF 转换失败；原始文件已保留");
        }
        Err(error) => {
            let _ = std::fs::remove_file(&output);
            Err(error)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn full_length_source_size_is_the_default() {
        let options = GifOptions::default().validated().unwrap();
        assert_eq!(options.end, None);
        assert_eq!(options.size, None);
        assert!(options.filter().starts_with("fps=12,split"));
        assert!(!options.filter().contains("scale="));
        assert!(options.filter().contains("max_colors=128"));
    }

    #[test]
    fn custom_range_size_and_rate_are_preserved() {
        let options = GifOptions { start: 2.5, end: Some(8.0), size: Some(720), fps: 20, colors: 256, frames: None }.validated().unwrap();
        assert_eq!(options.start, 2.5);
        assert_eq!(options.end, Some(8.0));
        assert!(options.filter().starts_with("fps=20,scale=720:720"));
        assert!(options.filter().contains("max_colors=256"));
    }

    #[test]
    fn ugoira_frames_are_validated() {
        let valid = GifOptions { frames: Some(vec![UgoiraFrame { file: "000000.jpg".into(), delay: 80 }]), ..Default::default() };
        assert!(valid.validated().is_ok());
        let missing = GifOptions { frames: Some(vec![]), ..Default::default() };
        assert!(missing.validated().is_err());
        let zero_delay = GifOptions { frames: Some(vec![UgoiraFrame { file: "000000.jpg".into(), delay: 0 }]), ..Default::default() };
        assert!(zero_delay.validated().is_err());
    }

    #[test]
    fn invalid_ranges_and_extreme_settings_are_refused() {
        assert!(GifOptions { end: Some(0.0), ..Default::default() }.validated().is_err());
        assert!(GifOptions { fps: 0, ..Default::default() }.validated().is_err());
        assert!(GifOptions { colors: 300, ..Default::default() }.validated().is_err());
    }
}
