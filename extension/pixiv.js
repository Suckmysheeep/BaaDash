// Pixiv: current artwork only. Static works use their original images;
// ugoira works carry the original timed-frame ZIP and metadata to the app.
(() => {
  const ui = window.__swiftdlImageUI;
  if (!ui) return;
  const cache = new Map();

  function cached(key, load) {
    if (!cache.has(key)) cache.set(key, load().catch((error) => { cache.delete(key); throw error; }));
    return cache.get(key);
  }
  async function json(path) {
    const response = await fetch(path, { credentials: "same-origin", headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`Pixiv HTTP ${response.status}`);
    const data = await response.json();
    if (data?.error) throw new Error(data?.message || "Pixiv 数据读取失败");
    return data?.body;
  }
  const illust = (id) => cached(`illust:${id}`, () => json(`/ajax/illust/${encodeURIComponent(id)}`));
  const pages = (id) => cached(`pages:${id}`, async () => {
    const body = await json(`/ajax/illust/${encodeURIComponent(id)}/pages`);
    if (!Array.isArray(body) || !body.length) throw new Error("无法读取当前作品图片");
    return body;
  });
  const ugoira = (id) => cached(`ugoira:${id}`, async () => {
    const body = await json(`/ajax/illust/${encodeURIComponent(id)}/ugoira_meta`);
    const url = ui.httpUrl(body?.originalZip || body?.zipUrls?.medium);
    const frames = Array.isArray(body?.frames) ? body.frames.map((f) => ({ file: String(f.file || ""), delay: Number(f.delay) || 0 })) : [];
    if (!url || !frames.length) throw new Error("Pixiv 动图缺少帧包或帧延迟");
    return { url, frames };
  });

  function workId(img) {
    const linked = img?.closest?.('a[href*="/artworks/"]')?.href || "";
    return (/artworks\/(\d+)/.exec(linked) || /artworks\/(\d+)/.exec(location.pathname) || [])[1] || "";
  }
  function pageIndex(img) {
    const source = img?.currentSrc || img?.src || img?.closest?.("a")?.href || "";
    return Number((/_p(\d+)(?:\.|$)/.exec(new URL(source, location.href).pathname) || [])[1] || 0);
  }
  const looksUgoira = (img) => /_ugoira\d*\./i.test(img?.currentSrc || img?.src || "");
  const baseName = (img, id, detail) => ui.cleanName(detail?.title || img?.alt || document.title.replace(/\s*-\s*pixiv\s*$/i, "") || id);
  function named(img, id, index, url, detail) {
    const ext = ui.extensionOf(url);
    return { url, filename: `${baseName(img, id, detail)}_${id}_p${index}.${ext}` };
  }
  async function animationItem(img, id, detail) {
    const meta = await ugoira(id);
    return {
      url: meta.url,
      filename: `${baseName(img, id, detail)}_${id}_ugoira.zip`,
      convertGif: true,
      gifOptions: { frames: meta.frames },
    };
  }
  async function workItems(img, id, all = false) {
    const detail = await illust(id).catch(() => null);
    if (Number(detail?.illustType) === 2 || looksUgoira(img)) return [await animationItem(img, id, detail)];
    const list = await pages(id);
    const indexes = all ? list.map((_, i) => i).slice(0, 100) : [Math.min(pageIndex(img), list.length - 1)];
    return indexes.map((index) => {
      const url = ui.httpUrl(list[index]?.urls?.original);
      if (!url) throw new Error("此图片没有公开原图地址");
      return named(img, id, index, url, detail);
    });
  }
  async function originalItem(img) {
    const direct = ui.directItem(img);
    const id = workId(img);
    if (!id) return direct ? [direct] : [];
    try {
      return await workItems(img, id);
    } catch (error) {
      // Never silently turn a failed animation lookup into a one-frame JPG.
      const detail = await illust(id).catch(() => null);
      if (looksUgoira(img) || Number(detail?.illustType) === 2) throw error;
      console.warn("BaaDash Pixiv original fallback:", error);
      return direct ? [direct] : [];
    }
  }

  ui.attach(originalItem, { collect: false, animation: looksUgoira });
  chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
    if (msg?.type !== "pixiv-current") return;
    (async () => {
      const id = workId(null);
      if (!id) return { items: [] };
      return { items: await workItems(null, id, true), id };
    })().then(respond).catch((error) => respond({ items: [], error: String(error?.message || error) }));
    return true;
  });
})();
