// Preview backend: only active when the page is opened in a normal browser
// (no Tauri). Simulates downloads, including per-connection segments and
// dynamic splitting, so the UI can be developed without building Rust.
// In the real app this file does nothing.
import type { Item, Settings, Status, Commands } from "./api";

declare global {
  interface Window {
    __video?: unknown;
  }
}

(() => {
  if (window.__TAURI__) return;
  // ?video: manual simulation mode driven by window.__video.step(),
  // so nothing runs on timers and answers come back at once.
  const VIDEO = location.search.includes("video");

  const MB = 1024 * 1024,
    GB = 1024 * MB;
  const now = Date.now();
  let nextId = 1;
  let settings: Settings = {
    downloadDir: "D:\\下载",
    connections: 8,
    maxConcurrent: 3,
    speedLimitKib: 0,
    sortIntoCategories: true,
    askBeforeDownload: true,
    notifyOnComplete: true,
    offerExtension: true,
    onboardingDismissed: false,
    showProgressWindow: true,
    closeToTray: true,
    theme: "system",
    accentColor: "#e3fa61",
    seedUntil: "stop",
    autoTrackers: true,
  };
  if (VIDEO)
    Object.assign(settings, {
      downloadDir: "D:\\下载",
      onboardingDismissed: true,
    });
  const catFor = (name: string) => {
    const ext = (name.split(".").pop() || "").toLowerCase();
    if (["zip", "rar", "7z", "gz", "iso", "xz", "tar"].includes(ext))
      return "Compressed";
    if (["pdf", "doc", "docx", "txt", "epub", "xlsx"].includes(ext))
      return "Documents";
    if (["mp3", "flac", "wav", "m4a", "ogg"].includes(ext)) return "Music";
    if (["mp4", "mkv", "webm", "mov", "avi"].includes(ext)) return "Video";
    if (["exe", "msi", "dmg", "deb", "apk"].includes(ext)) return "Programs";
    if (["jpg", "png", "gif", "webp"].includes(ext)) return "Images";
    return "Other";
  };
  const catDirs: Record<string, string> = {
    Video: "视频",
    Music: "音乐",
    Programs: "程序",
    Compressed: "压缩文件",
    Documents: "文档",
    Images: "图片",
  };
  const dirFor = (cat: string) =>
    settings.sortIntoCategories && catDirs[cat]
      ? `${settings.downloadDir}\\${catDirs[cat]}`
      : settings.downloadDir;

  // Each simulated download keeps a list of segments {pos, end} like the engine.
  interface Seg {
    start: number;
    pos: number;
    end: number;
    rate: number;
  }
  const sims = new Map<number, Seg[]>();
  function makeSegs(size: number, n: number, doneFrac = 0): Seg[] {
    const chunk = size / n,
      segs: Seg[] = [];
    for (let i = 0; i < n; i++) {
      const start = Math.floor(i * chunk),
        end = i === n - 1 ? size : Math.floor((i + 1) * chunk);
      segs.push({
        start,
        pos: Math.floor(
          start + (end - start) * doneFrac * (0.6 + Math.random() * 0.8),
        ),
        end,
        rate: 0.6 + Math.random() * 0.8,
      });
      segs[i].pos = Math.min(segs[i].pos, end);
    }
    return segs;
  }
  function item(
    filename: string,
    size: number,
    status: Status,
    ago: number,
    extra: Partial<Item> & { frac?: number } = {},
  ): Item {
    const category = catFor(filename);
    const { frac = 0, ...rest } = extra;
    const it: Item = {
      id: nextId++,
      url: `https://downloads.example.com/files/${encodeURIComponent(filename)}`,
      filename,
      path: `${dirFor(category)}\\${filename}`,
      size,
      downloaded: status === "completed" ? size : 0,
      status,
      error: null,
      category,
      addedAt: now - ago * 60000,
      completedAt: status === "completed" ? now - ago * 60000 + 90000 : null,
      resumable: true,
      headers: [],
      remaining: [],
      segments: [],
      speed: 0,
      connections: 0,
      format: null,
      torrentFiles: null,
      note: null,
      ...rest,
    };
    if (status !== "completed" && size)
      sims.set(it.id, makeSegs(size, settings.connections, frac));
    sync(it);
    return it;
  }
  function sync(it: Item) {
    const segs = sims.get(it.id);
    if (!segs) return;
    it.remaining = segs
      .filter((s) => s.pos < s.end)
      .map((s): [number, number] => [s.pos, s.end]);
    it.segments = segs
      .map((s): [number, number, number] => [s.start, s.pos, s.end])
      .sort((a, b) => a[0] - b[0]);
    it.downloaded =
      (it.size || 0) - it.remaining.reduce((a, [p, e]) => a + (e - p), 0);
  }

  const items = [
    item("海岸日记-4K.mp4", 2.8 * GB, "downloading", 3, {
      frac: 0.58,
    }),
    item("产品演示-高清版.mp4", 812 * MB, "downloading", 5, { frac: 0.24 }),
    item("BaaDash-安装程序.msi", 412 * MB, "queued", 6),
    item("会议录音-无损音轨.flac", 286 * MB, "paused", 75, {
      frac: 0.34,
    }),
    item("项目素材-归档.tar.gz", 3.4 * GB, "error", 180, {
      frac: 0.31,
      error: "服务器返回 403 禁止访问（链接可能已过期）",
    }),
    item("技术手册-网络协议.pdf", 14.2 * MB, "completed", 40),
    item("设计资源-组件库.zip", 88 * MB, "completed", 1500),
    item("音频素材-第12段.mp3", 61 * MB, "completed", 4000),
  ];

  type Listener = (e: { payload: unknown }) => void;
  const listeners: Record<string, Listener[]> = {};
  const emit = (ev: string, payload: unknown) =>
    (listeners[ev] || []).forEach((cb) => cb({ payload }));
  const clone = (): Item[] => JSON.parse(JSON.stringify(items));

  function schedule() {
    let running = items.filter((i) => i.status === "downloading").length;
    for (const it of items) {
      if (running >= settings.maxConcurrent) break;
      if (it.status === "queued") {
        it.status = "downloading";
        running++;
      }
    }
  }

  function step() {
    const limit = settings.speedLimitKib * 1024;
    const active = items.filter((i) => i.status === "downloading");
    for (const it of items) {
      if (it.status !== "downloading") {
        it.speed = 0;
        it.connections = 0;
        continue;
      }
      const segs =
        sims.get(it.id) ||
        (sims.set(it.id, makeSegs(it.size || 0, settings.connections)),
        sims.get(it.id)!);
      let perConn = (1.1 + Math.random() * 0.6) * MB; // like a server capping each connection
      if (limit)
        perConn = Math.min(
          perConn,
          limit / active.length / Math.max(1, segs.length),
        );
      let got = 0;
      for (const s of segs) {
        if (s.pos >= s.end) continue;
        const step = Math.min(s.end - s.pos, perConn * s.rate * 0.5);
        s.pos += step;
        got += step;
      }
      // Dynamic segmentation: a finished connection takes half of the biggest gap.
      const busy = segs.filter((s) => s.pos < s.end);
      while (busy.length < settings.connections) {
        const big = busy.sort((a, b) => b.end - b.pos - (a.end - a.pos))[0];
        if (!big || big.end - big.pos < 4 * MB) break;
        const mid = Math.floor(big.pos + (big.end - big.pos) / 2);
        const s: Seg = {
          start: mid,
          pos: mid,
          end: big.end,
          rate: 0.6 + Math.random() * 0.8,
        };
        big.end = mid;
        segs.push(s);
        busy.push(s);
      }
      const inst = got * 2;
      it.speed = it.speed ? it.speed * 0.6 + inst * 0.4 : inst;
      it.connections = busy.length;
      sync(it);
      if (!it.remaining.length) {
        Object.assign(it, {
          status: "completed",
          completedAt: Date.now(),
          speed: 0,
          connections: 0,
          downloaded: it.size || 0,
        });
        sims.delete(it.id);
      }
    }
    schedule();
    emit("downloads", clone());
  }
  if (VIDEO) {
    window.__video = {
      step,
      set(id: number, patch: Partial<Item>) {
        const it = items.find((i) => i.id === id);
        if (it) {
          Object.assign(it, patch);
          sims.delete(id);
        }
        emit("downloads", clone());
      },
      last: () => items.at(-1),
    };
  } else setInterval(step, 500);

  type Impl = {
    [K in keyof Commands]: (
      args: Commands[K][0],
    ) => Commands[K][1] | Promise<Commands[K][1]>;
  };
  const commands: Impl = {
    download_next: () => {},
    replace_url: () => {},
    get_state: () => ({
      items: clone(),
      settings: { ...settings },
      pending: [],
      version: "0.4.1",
    }),
    probe_url: async ({ url }) => {
      if (!VIDEO) await new Promise((r) => setTimeout(r, 700));
      const name = decodeURIComponent(
        new URL(url).pathname.split("/").filter(Boolean).pop() ||
          "download.bin",
      );
      const category = catFor(name);
      const size =
        VIDEO && /ubuntu/.test(name)
          ? 5.9 * GB
          : Math.round((40 + Math.random() * 900) * MB);
      return {
        filename: name,
        size,
        resumable: true,
        category,
        dir: dirFor(category),
        torrent: /\.torrent$/i.test(name),
      };
    },
    add_download: ({ req }) => {
      const it = item(
        req.filename,
        Math.round((120 + Math.random() * 600) * MB),
        req.start ? "queued" : "paused",
        0,
      );
      it.url = req.url;
      it.path = `${req.dir}\\${req.filename}`;
      it.addedAt = Date.now();
      items.push(it);
      schedule();
      return it.id;
    },
    pause: ({ ids }) =>
      items
        .filter(
          (i) =>
            ids.includes(i.id) && ["downloading", "queued"].includes(i.status),
        )
        .forEach((i) => {
          i.status = "paused";
          i.speed = 0;
        }),
    resume: ({ ids }) => {
      items
        .filter(
          (i) => ids.includes(i.id) && ["paused", "error"].includes(i.status),
        )
        .forEach((i) => {
          i.status = "queued";
          i.error = null;
        });
      schedule();
    },
    remove: ({ ids }) => {
      for (const id of ids) {
        const k = items.findIndex((i) => i.id === id);
        if (k >= 0) items.splice(k, 1);
        sims.delete(id);
      }
    },
    clear_history: ({ ids }) => {
      for (let n = items.length - 1; n >= 0; n--)
        if (
          ids.includes(items[n].id) &&
          ["completed", "error"].includes(items[n].status)
        )
          items.splice(n, 1);
    },
    set_settings: ({ settings: s }) => {
      settings = s;
      emit("settings", { ...settings });
      schedule();
    },
    pick_folder: () => "C:\\Users\\you\\Desktop",
    open_file: () => {},
    open_folder: () => {},
    open_url: () => {},
    open_extension_folder: () => {},
    extension_dir: () => "C:\\Users\\you\\AppData\\Local\\BaaDash\\extension",
    default_dir: ({ filename }) => dirFor(catFor(filename)),
    // ?noext previews the not-connected case.
    integration_status: () =>
      location.search.includes("noext")
        ? {
            browsers: [
              {
                id: "chrome",
                name: "Chrome",
                installed: true,
                autoOffer: true,
              },
              { id: "edge", name: "Edge", installed: true, autoOffer: true },
              { id: "brave", name: "Brave", installed: true, autoOffer: true },
              {
                id: "vivaldi",
                name: "Vivaldi",
                installed: false,
                autoOffer: false,
              },
              {
                id: "chromium",
                name: "Chromium",
                installed: false,
                autoOffer: false,
              },
              {
                id: "firefox",
                name: "Firefox",
                installed: true,
                autoOffer: false,
              },
            ],
            lastSeen: null,
            storeUrl: "",
            storeAvailable: false,
          }
        : {
            browsers: [
              {
                id: "chrome",
                name: "Chrome",
                installed: true,
                autoOffer: true,
              },
              { id: "edge", name: "Edge", installed: true, autoOffer: true },
              {
                id: "brave",
                name: "Brave",
                installed: true,
                autoOffer: true,
                lastSeen: Date.now() - 16 * 60000,
              },
              {
                id: "vivaldi",
                name: "Vivaldi",
                installed: false,
                autoOffer: false,
              },
              {
                id: "chromium",
                name: "Chromium",
                installed: false,
                autoOffer: false,
              },
              {
                id: "firefox",
                name: "Firefox",
                installed: true,
                autoOffer: false,
              },
            ],
            lastSeen: Date.now() - 16 * 60000,
            storeUrl:
              "https://chromewebstore.google.com/detail/knmfjbmojepkdiflnckpfjimfmjfcbgh",
            storeAvailable: false,
          },
    open_store: () => {},
    open_extensions_page: () => {},
    open_log: () => {},
    get_item: ({ id }) =>
      JSON.parse(JSON.stringify(items.find((i) => i.id === id) || null)),
    confirm_info: () =>
      location.search.includes("torrent")
        ? {
            url: "magnet:?xt=urn:btih:dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c&dn=Blender+Open+Movies",
            filename: "",
          }
        : VIDEO && !location.search.includes("yt")
          ? {
              url: "https://cdn.example.net/files/海岸日记-4K.mp4",
              filename: "",
              referrer: "https://example.net/share",
            }
          : location.search.includes("yt")
            ? { url: "https://media.example.net/watch/nailong", filename: "" }
            : {
                url: "https://cdn.example.net/files/BaaDash-安装程序.msi",
                filename: "",
                referrer: "https://example.net/share",
              },
    forget_confirm: () => {},
    probe_note: () => null,
    show_main: () => {},
    // Like the Rust backend, only strictly newer releases are reported.
    check_update: () => null,
    install_update: () => {},
    is_media_url: ({ url }) =>
      /(^|\.)(youtube\.com|youtu\.be|vimeo\.com|media\.example\.net)\//.test(
        url.replace(/^https?:\/\//, "").replace(/^www\./, ""),
      ),
    open_new_download: () => {},
    is_torrent_url: ({ url, filename }) =>
      /^magnet:|\.torrent($|\?)/i.test(url) ||
      /\.torrent$/i.test(filename || ""),
    probe_torrent: async () => {
      if (!VIDEO) await new Promise((r) => setTimeout(r, 1200));
      return {
        name: "Blender Open Movies Collection",
        size: 9.4 * GB,
        hash: "dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c",
        peers: 37,
        files: [
          { path: "Big Buck Bunny/big_buck_bunny_1080p.mp4", size: 3.1 * GB },
          { path: "Big Buck Bunny/subtitles/en.srt", size: 42 * 1024 },
          { path: "Sintel/sintel_1080p.mkv", size: 2.6 * GB },
          { path: "Tears of Steel/tears_of_steel_1080p.mov", size: 3.7 * GB },
          { path: "README.txt", size: 3 * 1024 },
        ],
      };
    },
    probe_media: async () => {
      if (!VIDEO) await new Promise((r) => setTimeout(r, 900));
      return {
        title: "海岸日记 4K · 高清素材",
        site: "示例站点",
        duration: 634,
        qualities: [
          {
            label: "2160p60",
            format: "bv*[height=2160]+ba",
            ext: "mp4",
            size: 1.9 * GB,
          },
          {
            label: "1440p60",
            format: "bv*[height=1440]+ba",
            ext: "mp4",
            size: 980 * MB,
          },
          {
            label: "1080p60",
            format: "bv*[height=1080]+ba",
            ext: "mp4",
            size: 412 * MB,
          },
          {
            label: "720p60",
            format: "bv*[height=720]+ba",
            ext: "mp4",
            size: 198 * MB,
          },
          {
            label: "Audio only",
            format: "ba[ext=m4a]/ba",
            ext: "m4a",
            size: 9.8 * MB,
          },
        ],
      };
    },
  };

  window.__TAURI__ = {
    core: {
      invoke: async (cmd: string, args: unknown = {}) => {
        const fn = (commands as Record<string, (a: unknown) => unknown>)[cmd];
        if (!fn) throw new Error(`mock: unknown command ${cmd}`);
        return fn(args);
      },
    },
    event: {
      listen: async (ev: string, cb: Listener) => {
        (listeners[ev] ||= []).push(cb);
        return () => {};
      },
    },
  };

  if (!VIDEO)
    document.addEventListener("DOMContentLoaded", () => {
      const b = document.createElement("div");
      b.className = "preview-banner";
      b.textContent = "预览模式 · 模拟下载数据";
      document.body.append(b);
    });
})();
