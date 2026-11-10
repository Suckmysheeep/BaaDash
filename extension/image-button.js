// Shared, site-independent image download button. Site adapters may replace
// URL resolution, but positioning and native messaging stay standard DOM code.
(() => {
  if (window.__swiftdlImageUI) return;

  const cleanName = (value) =>
    String(value || "image")
      .replace(/[<>:"/\\|?*：？\u0000-\u001f]/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/[. ]+$/g, "")
      .slice(0, 110) || "image";
  const httpUrl = (value) => {
    try {
      const u = new URL(value, location.href);
      return /^https?:$/.test(u.protocol) ? u.href : "";
    } catch {
      return "";
    }
  };
  const extensionOf = (url) =>
    (/\.(jpe?g|png|webp|gif|avif|bmp|svg)(?:$|[?#])/i.exec(
      new URL(url).pathname,
    ) || [])[1]
      ?.toLowerCase()
      .replace("jpeg", "jpg") || "jpg";
  function directItem(img, url = "") {
    const source = httpUrl(url || img.currentSrc || img.src);
    if (!source) return null;
    const base = decodeURIComponent(
      new URL(source).pathname.split("/").pop() || "image",
    );
    const ext = extensionOf(source);
    const stem = base.replace(/\.[a-z0-9]{2,5}$/i, "");
    const name = cleanName(img.alt || stem || document.title || "image");
    return { url: source, filename: `${name}.${ext}` };
  }

  const ICON = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M5 21h14"/></svg>`;

  function attach(resolve, { collect = true, animation = null } = {}) {
    if (window.__swiftdlImageAttached) return;
    window.__swiftdlImageAttached = true;
    let host,
      root,
      button,
      current = null,
      hideTimer = 0,
      last = 0,
      busy = false;

    function build() {
      host = document.createElement("swiftdl-image-button");
      host.style.cssText =
        "all:initial;position:fixed;inset:0 auto auto 0;width:0;height:0;z-index:2147483647";
      root = host.attachShadow({ mode: "closed" });
      root.innerHTML = `<style>
        @font-face { font-family: BaaDashNoto; src: url("${chrome.runtime.getURL("fonts/NotoSansSC-Variable.woff2")}") format("woff2"); font-weight: 100 900; }
        * { box-sizing: border-box; font-family: BaaDashNoto, "Microsoft YaHei UI", sans-serif; }
        button { position: fixed; display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 11px; border: 1px solid rgba(255,255,255,.2); border-radius: 9px; background: rgba(23,26,34,.9); color: #fff; box-shadow: 0 5px 20px rgba(0,0,0,.3); backdrop-filter: blur(12px); cursor: pointer; font-size: 12px; font-weight: 650; opacity: 0; pointer-events: none; transform: translateX(-100%); transition: opacity .12s; }
        button.on { opacity: 1; pointer-events: auto; }
        button:hover { background: #ff0077; }
        button:disabled { cursor: wait; opacity: .8; }
        button.ok { background: #23864f; } button.err { background: #cf4540; }
      </style><button type="button" title="使用 BaaDash 下载此图片">${ICON}<span>下载</span></button>`;
      button = root.querySelector("button");
      button.addEventListener("mouseenter", () => clearTimeout(hideTimer));
      button.addEventListener("mouseleave", scheduleHide);
      button.addEventListener("click", click);
      (document.fullscreenElement || document.documentElement).append(host);
    }

    function position() {
      if (!current || !button) return;
      const r = current.getBoundingClientRect();
      if (
        r.bottom < 0 ||
        r.right < 0 ||
        r.top > innerHeight ||
        r.left > innerWidth
      )
        return hide();
      button.style.left = `${Math.max(38, Math.min(innerWidth - 8, r.right - 8))}px`;
      button.style.top = `${Math.max(8, r.top + 8)}px`;
    }
    function show(img) {
      if (busy) return;
      if (!host) build();
      (document.fullscreenElement || document.documentElement).append(host);
      current = img;
      clearTimeout(hideTimer);
      button.classList.remove("ok", "err");
      const animated = Boolean(animation?.(img));
      button.querySelector("span").textContent = animated ? "GIF" : "下载";
      button.title = animated
        ? "下载 Pixiv 动图并另存为 GIF"
        : "使用 BaaDash 下载此图片";
      button.classList.add("on");
      position();
    }
    function hide() {
      clearTimeout(hideTimer);
      current = null;
      button?.classList.remove("on");
    }
    function scheduleHide() {
      if (!busy) {
        clearTimeout(hideTimer);
        hideTimer = setTimeout(hide, 450);
      }
    }

    async function click(e) {
      e.preventDefault();
      e.stopPropagation();
      if (!current || busy) return;
      const img = current;
      busy = true;
      button.disabled = true;
      button.querySelector("span").textContent = "…";
      try {
        const items = (await resolve(img)).filter((x) => x && httpUrl(x.url));
        if (!items.length) throw new Error("没有找到可下载的图片地址");
        const res = await chrome.runtime.sendMessage({
          type: "quick",
          items,
          pageUrl: location.href,
        });
        if (!res?.ok) throw new Error(res?.error || "BaaDash 没有响应");
        button.classList.add("ok");
        button.querySelector("span").textContent = items.some(
          (item) => item.convertGif,
        )
          ? "GIF 已添加"
          : "已添加";
      } catch (error) {
        button.classList.add("err");
        button.querySelector("span").textContent = "重试";
        button.title = String(error?.message || error);
        console.warn("BaaDash image download:", error);
      }
      busy = false;
      button.disabled = false;
      hideTimer = setTimeout(hide, 1800);
    }

    document.addEventListener(
      "mousemove",
      (e) => {
        const now = performance.now();
        if (!window.__baadashPrefs?.images) {
          hide();
          return;
        }
        if (now - last < 80 || busy) return;
        last = now;
        if (host && e.composedPath().includes(host)) return;
        const img = document
          .elementsFromPoint(e.clientX, e.clientY)
          .find((el) => el.tagName === "IMG");
        if (!img) {
          if (current) scheduleHide();
          return;
        }
        const r = img.getBoundingClientRect();
        const player = img.closest(
          'video, [data-player], .video-js, .html5-video-player, [class*="video-player"], [class*="video-container"], [data-testid*="video"]',
        );
        const overVideo = [...document.querySelectorAll("video")].some((v) => {
          const b = v.getBoundingClientRect();
          return (
            b.width >= 160 &&
            b.height >= 90 &&
            e.clientX >= b.left &&
            e.clientX <= b.right &&
            e.clientY >= b.top &&
            e.clientY <= b.bottom
          );
        });
        const decoration =
          img.closest('header, nav, [role="banner"], [role="navigation"]') ||
          /\b(logo|avatar|icon|banner)\b/i.test(img.alt + " " + img.className);
        if (
          player ||
          overVideo ||
          decoration ||
          r.width / r.height > 4 ||
          img.naturalWidth < 240 ||
          img.naturalHeight < 160 ||
          r.width < 180 ||
          r.height < 120 ||
          !httpUrl(img.currentSrc || img.src)
        ) {
          if (current) scheduleHide();
          return;
        }
        if (img !== current) show(img);
        else position();
      },
      { passive: true, capture: true },
    );
    window.__baadashPrefs?.subscribe(hide);
    document.addEventListener("scroll", () => current && position(), {
      passive: true,
      capture: true,
    });
    document.addEventListener(
      "fullscreenchange",
      () => current && show(current),
    );
    window.addEventListener("resize", () => current && position(), {
      passive: true,
    });

    if (collect)
      chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
        if (msg?.type !== "collect-images") return;
        const seen = new Set(),
          items = [];
        for (const img of document.images) {
          if (img.naturalWidth < 240 || img.naturalHeight < 160) continue;
          const item = directItem(img);
          if (!item || seen.has(item.url)) continue;
          seen.add(item.url);
          items.push(item);
          if (items.length === 100) break;
        }
        respond({ items });
      });
  }

  window.__swiftdlImageUI = {
    attach,
    directItem,
    cleanName,
    extensionOf,
    httpUrl,
  };
})();
