const DEFAULTS = {
  enabled: true,
  sniffing: true,
  videoButtons: true,
  imageButtons: false,
  imageSites: [],
  minSizeKB: 0,
  disabledSites: [],
};
const $ = (id) => document.getElementById(id);
const DL_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 20h14"/></svg>`;
const CHECK = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5.5 12.5 4 4 9-9"/></svg>`;

const bytes = (n) => {
  if (!n) return "";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n < 10 && i ? n.toFixed(1) : Math.round(n)} ${u[i]}`;
};
const VIDEO_SITE =
  /(^|\.)(youtube\.com|youtube-nocookie\.com|vimeo\.com|x\.com|twitter\.com|reddit\.com|instagram\.com|tiktok\.com|facebook\.com|twitch\.tv|dailymotion\.com|bilibili\.com)$/i;
const esc = (s) =>
  String(s).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );
const cleanName = (value) => {
  let name = String(value || "download")
    .replace(/[<>:"/\\|?*：？\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name))
    name = `_${name}`;
  return Array.from(name).slice(0, 120).join("") || "download";
};

async function main() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const settings = await chrome.storage.sync.get(DEFAULTS);
  // Only real websites get the per-site switch, not browser or extension pages.
  let host = "";
  try {
    const u = new URL(tab.url);
    if (/^https?:$/.test(u.protocol)) host = u.hostname.replace(/^www\./, "");
  } catch {}

  for (const key of ["sniffing", "videoButtons", "imageButtons"]) {
    $("pref-" + key).checked = settings[key];
    $("pref-" + key).onchange = async (e) => {
      await chrome.storage.sync.set({ [key]: e.target.checked });
      location.reload();
    };
  }
  $("image-site-row").hidden = !host;
  $("pref-imageSite").checked = settings.imageSites.includes(host);
  $("pref-imageSite").onchange = async (e) => {
    const latest = await chrome.storage.sync.get({ imageSites: [] });
    await chrome.storage.sync.set({
      imageSites: e.target.checked
        ? [...new Set([...latest.imageSites, host])]
        : latest.imageSites.filter((h) => h !== host),
    });
  };
  $("pref-videoButtons").disabled = !settings.sniffing;
  $("pref-imageSite").disabled = settings.imageButtons;
  $("enabled").checked = settings.enabled;
  $("min-size").value = String(settings.minSizeKB);
  $("site").textContent = host;
  $("site-row").hidden = !host;
  $("site-on").checked = !settings.disabledSites.includes(host);

  $("enabled").onchange = (e) =>
    chrome.storage.sync.set({ enabled: e.target.checked });
  $("min-size").onchange = (e) =>
    chrome.storage.sync.set({ minSizeKB: Number(e.target.value) });
  $("site-on").onchange = async () => {
    await chrome.runtime.sendMessage({
      type: "toggle-site",
      tabId: tab.id,
      pageUrl: tab.url,
    });
    location.reload();
  };
  $("open").onclick = () =>
    chrome.runtime.sendMessage({ type: "show" }).then(() => window.close());

  chrome.runtime.sendMessage({ type: "ping" }).then((r) => {
    $("status").className = `status ${r?.ok ? "ok" : "off"}`;
    $("status").querySelector("span").textContent = r?.ok ? "已连接" : "未连接";
    $("missing").hidden = !!r?.ok;
    $("main").hidden = !r?.ok;
    $("open").hidden = !r?.ok;
  });

  const { items = [] } = await chrome.runtime.sendMessage({
    type: "media",
    tabId: tab.id,
    pageUrl: tab.url,
  });
  const files = items.filter((m) => m.kind === "file");
  // The oldest stream is the player's main playlist, with every quality.
  const stream = items.filter((m) => m.kind !== "file").at(-1);
  const title = cleanName(tab.title);
  const ext = (m) =>
    (/\.([a-z0-9]{2,4})(?:$|[?#])/i.exec(new URL(m.url).pathname) ||
      [])[1]?.toLowerCase() ||
    (m.mime.split("/")[1] || "mp4").replace(/^x-/, "").slice(0, 4);

  let html = files
    .map((m, i) => {
      const e = ext(m);
      const audio =
        /^audio/.test(m.mime) || /mp3|m4a|aac|ogg|opus|flac|wav/.test(e);
      return `<div class="m"><span class="tag">${e.toUpperCase()}</span><span class="mt"><b>${audio ? "音频" : "视频"}</b><span title="${esc(m.url)}">${m.size ? bytes(m.size) : esc(new URL(m.url).hostname)}</span></span><button class="dl" data-i="${i}" title="使用 BaaDash 下载">${DL_ICON}</button></div>`;
    })
    .join("");
  if (stream)
    html += `<div class="m"><span class="tag stream">${stream.kind.toUpperCase()}</span><span class="mt"><b>流媒体</b><span>在 BaaDash 中选择清晰度</span></span><button class="dl" data-stream title="使用 BaaDash 下载">${DL_ICON}</button></div>`;
  // Video sites go through BaaDash's quality picker, whatever the page loaded.
  if (
    settings.sniffing &&
    !settings.disabledSites.includes(host) &&
    host &&
    VIDEO_SITE.test(host)
  ) {
    html = `<div class="m"><span class="tag">PAGE</span><span class="mt"><b>当前视频</b><span>在 BaaDash 中选择清晰度</span></span><button class="dl" data-page title="使用 BaaDash 下载">${DL_ICON}</button></div>`;
  }
  $("media").innerHTML = html;
  $("found").hidden = !html;
  $("media").onclick = async (e) => {
    const b = e.target.closest(".dl");
    if (!b) return;
    const m = b.hasAttribute("data-page")
      ? { url: tab.url }
      : b.hasAttribute("data-stream")
        ? stream
        : files[Number(b.dataset.i)];
    const name = b.hasAttribute("data-page")
      ? title
      : b.hasAttribute("data-stream")
        ? `${title}.mp4`
        : `${title}.${ext(m)}`;
    const r = await chrome.runtime.sendMessage({
      type: "grab",
      url: m.url,
      filename: name,
      tabId: tab.id,
      pageUrl: tab.url,
    });
    b.innerHTML = r?.ok ? CHECK : DL_ICON;
    b.classList.toggle("done", !!r?.ok);
  };

  // One-click actions read only the current tab's already loaded DOM. Pixiv's
  // adapter may return original images for the current work; generic pages
  // return their loaded large images without pagination or crawling.
  const quickButtons = [$("pixiv-download"), $("images-download")];
  async function loadQuick() {
    const ask = (type) =>
      chrome.tabs.sendMessage(tab.id, { type }).catch(() => null);
    const [pixiv, images] = await Promise.all([
      ask("pixiv-current"),
      ask("collect-images"),
    ]);
    if (pixiv?.items?.length) {
      $("pixiv-download").hidden = false;
      $("pixiv-count").textContent =
        `${pixiv.items.length} 张原图 · 一键全部下载`;
      $("pixiv-download").onclick = () =>
        runQuick($("pixiv-download"), pixiv.items, $("pixiv-count"));
    }
    if (images?.items?.length) {
      $("images-download").hidden = false;
      $("images-count").textContent =
        `${images.items.length} 张 · 已去重，最多 100 张`;
      $("images-download").onclick = () =>
        runQuick($("images-download"), images.items, $("images-count"));
    }
    $("quick").hidden = !pixiv?.items?.length && !images?.items?.length;
  }
  async function runQuick(button, items, label) {
    quickButtons.forEach((b) => {
      b.disabled = true;
    });
    $("quick-error").hidden = true;
    try {
      const r = await chrome.runtime.sendMessage({
        type: "quick",
        items,
        tabId: tab.id,
        pageUrl: tab.url,
      });
      if (!r?.ok) throw new Error(r?.error || "BaaDash 没有响应");
      label.textContent = `已提交 ${r.count} 个下载 · 可在应用中查看`;
      button.classList.add("done");
    } catch (error) {
      $("quick-error").textContent = String(error?.message || error);
      $("quick-error").hidden = false;
    }
    quickButtons.forEach((b) => {
      b.disabled = false;
    });
  }
  await loadQuick();
}
main();
