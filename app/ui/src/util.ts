// Shared by the main window and the download windows: icons, file
// categories and number formatting.

import { icon } from "./icons";
export { icon } from "./icons";
export type { IconName } from "./icons";

export interface Cat { color: string; icon: string }
export const CATS: Record<string, Cat> = {
  Video: { color: "#8b5cf6", icon: "video" },
  Music: { color: "#ec4899", icon: "music" },
  Programs: { color: "#3b82f6", icon: "app" },
  Compressed: { color: "#f59e0b", icon: "archive" },
  Documents: { color: "#10b981", icon: "doc" },
  Images: { color: "#f97316", icon: "image" },
  Other: { color: "#8b8f98", icon: "file" },
};
export const catInfo = (name: string | null | undefined): Cat => CATS[name ?? ""] || CATS.Other;
const CAT_LABELS: Record<string, string> = {
  Video: "视频", Music: "音乐", Programs: "程序", Compressed: "压缩文件",
  Documents: "文档", Images: "图片", Other: "其他",
};
/** Category keys are part of the saved data format; only their labels change. */
export const categoryLabel = (name: string | null | undefined): string => CAT_LABELS[name ?? ""] || CAT_LABELS.Other;

/** The category a file name falls in, by extension (matches the backend). */
export function catOf(name: string | null | undefined): string {
  const e = (/\.([a-z0-9]{1,5})$/i.exec(name || "") || [])[1]?.toLowerCase() || "";
  if (/^(zip|rar|7z|tar|gz|tgz|xz|bz2|zst|iso|img)$/.test(e)) return "Compressed";
  if (/^(pdf|docx?|xlsx?|pptx?|odt|txt|rtf|epub|csv|md)$/.test(e)) return "Documents";
  if (/^(mp3|wav|flac|aac|ogg|m4a|opus|wma)$/.test(e)) return "Music";
  if (/^(mp4|mkv|avi|mov|webm|flv|wmv|m4v|mpe?g|3gp|ts)$/.test(e)) return "Video";
  if (/^(exe|msi|dmg|pkg|deb|rpm|apk|appimage|msix|bat|jar)$/.test(e)) return "Programs";
  if (/^(jpe?g|png|gif|webp|svg|bmp|heic|avif)$/.test(e)) return "Images";
  return "Other";
}

/** Extract web and magnet links from ordinary text or Chinese app share text. */
export function extractLinks(text: string | null | undefined): string[] {
  const matches = String(text || "").match(/(?:https?:\/\/|magnet:\?)[^\s<>"'“”‘’，。；！？、】）]+/gi) || [];
  const cleaned = matches.map((url) => url.replace(/[\]\[.,!?;:，。；！？、）】]+$/g, "")).filter(Boolean);
  const expanded: string[] = [];
  for (const url of cleaned) {
    const m = /\[(\d{1,6})-(\d{1,6})\]/.exec(url);
    if (!m) { expanded.push(url); continue; }
    const start = Number(m[1]), end = Number(m[2]);
    if (end < start || end - start >= 500) continue;
    for (let n = start; n <= end && expanded.length < 500; n++) expanded.push(url.replace(m[0], String(n).padStart(m[1].length, "0")));
  }
  return [...new Set(expanded)].slice(0, 500);
}
export const firstUrl = (text: string | null | undefined): string | undefined => extractLinks(text)[0];

/** Keep Unicode names intact while making them safe and manageable on Windows. */
export function cleanFilename(value: unknown, fallback = "download.bin"): string {
  const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'" };
  let name = String(value ?? "").replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|#39);/gi, (whole, key: string) => {
    if (/^#(?:x[\da-f]+|\d+)$/i.test(key)) {
      const hex = /^#x/i.test(key);
      const point = Number.parseInt(key.slice(hex ? 2 : 1), hex ? 16 : 10);
      return point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : whole;
    }
    return entities[key.toLowerCase()] ?? whole;
  });
  name = name.replace(/[<>:"/\\|?*：？\u0000-\u001f]/g, "_").replace(/\s+/g, " ").trim().replace(/[. ]+$/g, "");
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = `_${name}`;
  const chars = Array.from(name);
  if (chars.length > 160) {
    const extension = (/\.[a-z0-9]{1,10}$/i.exec(name) || [""])[0];
    const extChars = Array.from(extension);
    const stem = extension ? chars.slice(0, -extChars.length) : chars;
    name = `${stem.slice(0, 160 - extChars.length).join("").trimEnd()}${extension}`;
  }
  return name || fallback;
}

const UNITS = ["B", "KB", "MB", "GB", "TB"];
/** A byte count as [number, unit]. */
export function parts(n: number | null | undefined): [string, string] {
  if (n == null || !isFinite(n)) return ["—", ""];
  let i = 0;
  while (n >= 1024 && i < UNITS.length - 1) { n /= 1024; i++; }
  return [i === 0 ? String(Math.round(n)) : n < 10 ? n.toFixed(2) : n < 100 ? n.toFixed(1) : String(Math.round(n)), UNITS[i]];
}
export const bytes = (n: number | null | undefined): string => (n == null ? "—" : parts(n).join(" "));
export const speed = (b: number): string => (b > 0 ? `${bytes(b)}/s` : "—");
export function dur(sec: number): string {
  if (!isFinite(sec) || sec <= 0) return "—";
  sec = Math.ceil(sec);
  // Nobody reads "238471 小时": past two days the estimate is approximate,
  // past a month it is a shrug (the status line already says the speed).
  if (sec < 3600) {
    const m = Math.floor(sec / 60), s = sec % 60;
    return m ? `${m} 分 ${s} 秒` : `${s} 秒`;
  }
  const h = sec / 3600;
  if (h < 48) return `约 ${Math.round(h)} 小时`;
  const d = h / 24;
  if (d <= 30) return `约 ${Math.round(d)} 天`;
  return "超过 30 天";
}
/** A short relative time in Simplified Chinese. */
export function when(ms: number | null | undefined): string {
  if (!ms) return "";
  const d = new Date(ms), now = new Date();
  const mins = Math.round((now.getTime() - d.getTime()) / 60000);
  if (mins < 1) return "刚刚";
  if (mins < 60) return `${mins} 分钟前`;
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString("zh-CN", { hour: "numeric", minute: "2-digit" });
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "昨天";
  return d.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}

/** Translate backend status and common errors without changing API values. */
export function displayText(value: unknown): string {
  const text = String(value ?? "");
  const exact: Record<string, string> = {
    "This link opens a web page, not a file. The site may need you to sign in or confirm first.": "链接返回的是网页，可能需要先登录或确认下载。",
    "Checking the file": "正在校验文件",
    "Audio only": "仅音频", "Best quality": "最佳画质", "Original": "原始画质",
    "Getting yt-dlp": "正在获取 yt-dlp", "Getting ffmpeg": "正在获取 ffmpeg",
    "Unpacking ffmpeg": "正在解压 ffmpeg", "Getting video details": "正在获取视频信息",
    "Joining video and audio": "正在合成视频和音频", "Merging video and audio": "正在合并视频和音频",
    "Finding peers": "正在寻找节点", "Starting": "正在启动", "Looking for peers": "正在寻找节点",
    "Checking existing pieces": "正在检查已有分块", "Downloading from 1 peer": "正在从 1 个节点下载",
    "Only web links, magnet links and .torrent files are supported": "仅支持网页链接、磁力链接和 .torrent 文件",
    "File name is empty": "文件名不能为空", "not found": "未找到下载项目",
    "extension folder not found": "未找到扩展文件夹", "yt-dlp couldn't read this page": "yt-dlp 无法读取此页面",
    "The site didn't answer in 90 seconds. Check your connection and try again.": "网站在 90 秒内没有响应，请检查网络后重试。",
  };
  if (exact[text]) return exact[text];
  const peers = /^Downloading from (\d+) peers · (\d+) seeding$/.exec(text);
  if (peers) return `正在从 ${peers[1]} 个节点下载 · ${peers[2]} 个节点做种中`;
  return text
    .replace(/Getting yt-dlp/g, "正在获取 yt-dlp")
    .replace(/Getting ffmpeg/g, "正在获取 ffmpeg")
    .replace(/Server returned 403 Forbidden \(link may have expired\)/g, "服务器返回 403 禁止访问（链接可能已过期）")
    .replace(/couldn't reach|Couldn't reach/g, "无法连接")
    .replace(/couldn't download/g, "无法下载")
    .replace(/couldn't start/g, "无法启动");
}
const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (s: unknown): string => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);
export const host = (url: string): string => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } };

const extOf = (name: string) => (/\.([a-z0-9]{1,5})$/i.exec(name) || [])[1]?.toUpperCase() || "";

/** A document icon, like Finder's: a page with a folded corner, the kind's
 *  symbol in the middle and the extension along the bottom. */
export function fileIcon(name: string, category?: string, size = 36): string {
  const c = catInfo(category || catOf(name));
  const e = extOf(name).slice(0, 4);
  return `<span class="ficon" style="--s:${size}px">
    <svg class="page" viewBox="0 0 32 40" aria-hidden="true"><path d="M3 1.5h18.5L30.5 10.5V37a1.5 1.5 0 0 1-1.5 1.5H3A1.5 1.5 0 0 1 1.5 37V3A1.5 1.5 0 0 1 3 1.5z"/><path class="fold" d="M21.5 1.5v7.5a1.5 1.5 0 0 0 1.5 1.5h7.5"/></svg>
    <span class="glyph">${icon(c.icon)}</span>${e ? `<span class="ext">${e}</span>` : ""}</span>`;
}


// One progress bar for the whole file. Each connection fills its own part
// of it, with a hairline where one part ends and the next begins, so the bar
// shows both overall progress and how the parts are going.
export function segBar(el: HTMLElement, size: number | null, segments: [number, number, number][] | undefined, pct: number) {
  const segs = size ? (segments || []).filter(([s, , e]) => e > s) : [];
  const fills: [number, number][] = segs.length ? segs.map(([s, p]) => [(s / size!) * 100, ((p - s) / size!) * 100]) : [[0, pct]];
  const marks = segs.slice(1).map(([s]) => (s / size!) * 100);
  if (el.childElementCount !== fills.length + marks.length) el.innerHTML = "<i></i>".repeat(fills.length) + "<b></b>".repeat(marks.length);
  fills.forEach(([l, w], k) => { const i = el.children[k] as HTMLElement; i.style.left = `${l}%`; i.style.width = `${w}%`; });
  marks.forEach((l, k) => { (el.children[fills.length + k] as HTMLElement).style.left = `${l}%`; });
}
