// Shared by the main window and the download windows: icons, file
// categories and number formatting.

const P: Record<string, string> = {
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  compose: '<path d="M12 4H6.5A2.5 2.5 0 0 0 4 6.5v11A2.5 2.5 0 0 0 6.5 20h11a2.5 2.5 0 0 0 2.5-2.5V12"/><path d="M17.6 3.6a2 2 0 0 1 2.8 2.8L12.5 14.3 9 15l.7-3.5z"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 20h14"/>',
  pause: '<path d="M9 6v12M15 6v12"/>',
  play: '<path d="M8 5.5v13l10.5-6.5z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5a13 13 0 0 1 0 17M12 3.5a13 13 0 0 0 0 17"/>',
  chevron: '<path d="m9.5 6 6 6-6 6"/>',
  chevDown: '<path d="m6 9.5 6 6 6-6"/>',
  chevUp: '<path d="m6 14.5 6-6 6 6"/>',
  x: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  folder: '<path d="M3.5 7.5A2 2 0 0 1 5.5 5.5H9l2 2h7.5a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
  open: '<path d="M14 4.5h5.5V10M19.5 4.5 11 13M18 14v4a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 5 18V8a1.5 1.5 0 0 1 1.5-1.5h4"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  retry: '<path d="M4.5 12a7.5 7.5 0 0 1 13.2-4.8L19.5 9M19.5 4.5V9H15M19.5 12a7.5 7.5 0 0 1-13.2 4.8L4.5 15M4.5 19.5V15H9"/>',
  trash: '<path d="M4.5 7h15M10 11v6M14 11v6M6.5 7l.8 11.2A2 2 0 0 0 9.3 20h5.4a2 2 0 0 0 2-1.8L17.5 7M9.5 7V5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2"/>',
  more: '<circle cx="6" cy="12" r="1.1"/><circle cx="12" cy="12" r="1.1"/><circle cx="18" cy="12" r="1.1"/>',
  gauge: '<path d="m12 14 3.5-3.5"/><path d="M4 18a8.5 8.5 0 1 1 16 0"/>',
  sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/>',
  clipboard: '<rect x="6" y="4.5" width="12" height="16" rx="2"/><path d="M9.5 4.5h5v2.5h-5z"/>',
  check: '<path d="m5.5 12.5 4 4 9-9"/>',
  inbox: '<path d="M4 13.5 6.5 6h11l2.5 7.5V18a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18z"/><path d="M4 13.5h4.5l1 2h5l1-2H20"/>',
  arrowDown: '<path d="M12 5v14M6.5 13.5 12 19l5.5-5.5"/>',
  doneCircle: '<circle cx="12" cy="12" r="8.5"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
  alert: '<circle cx="12" cy="12" r="8.5"/><path d="M12 8v5M12 16h.01"/>',
  bolt: '<path d="M13 3.5 5.5 13.5H11l-1 7 7.5-10H12z"/>',
  hash: '<path d="M5 9h14M5 15h14M10 4 8 20M16 4l-2 16"/>',
  keyboard: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10h.01M11 10h.01M15 10h.01M7 14h10"/>',
  video: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M7.5 4.5v15M16.5 4.5v15M3.5 9.5h4M3.5 14.5h4M16.5 9.5h4M16.5 14.5h4"/>',
  music: '<path d="M9 17.5V6.3l10-1.8v11"/><circle cx="6.5" cy="17.5" r="2.5"/><circle cx="16.5" cy="15.5" r="2.5"/>',
  app: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M3.5 9h17"/><path d="M6.6 6.8h.01M9 6.8h.01" stroke-width="2.2"/>',
  archive: '<path d="M12 3.3 20 7.4v9.2l-8 4.1-8-4.1V7.4z"/><path d="m4 7.4 8 4.1 8-4.1M12 11.5v9.2M8 5.3l8 4.1"/>',
  doc: '<path d="M14 3.5H7.5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V8z"/><path d="M14 3.5V8h4.5M9 12.5h6M9 16h6"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="10" r="1.7"/><path d="m20.5 15.5-4.5-4.5-9.5 8.5"/>',
  file: '<path d="M14 3.5H7.5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V8z"/><path d="M14 3.5V8h4.5"/>',
};
export type IconName = keyof typeof P | string;
export const icon = (n: IconName): string =>
  `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${P[n] || P.file}</svg>`;

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
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h} 小时 ${m} 分` : m ? `${m} 分 ${s} 秒` : `${s} 秒`;
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
