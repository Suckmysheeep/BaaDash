import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { start, root, extensionMock } from "./runtime.mjs";
const require = createRequire(new URL("./package.json", import.meta.url)),
  sharp = require("sharp");
const { browser, server, origin } = await start();
const report = [],
  errors = [];
const dir = path.join(root, "docs/assets/zh-cn");
fs.mkdirSync(dir, { recursive: true });
async function page(viewport = { width: 1120, height: 700 }) {
  const p = await browser.newPage({ viewport, deviceScaleFactor: 2 });
  p.on("pageerror", (e) => errors.push(e.message));
  await p.addInitScript(() => {
    let seed = 42;
    Math.random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    Date.now = () => 1794283200000;
  });
  return p;
}
async function settle(p) {
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(220);
}
async function shot(p, file, opts = {}) {
  await settle(p);
  await p.screenshot({ path: path.join(root, file), ...opts });
  report.push(file);
}
// README images cannot be styled by CSS; bake the site's 12px corner radius
// (24px at 2x capture) into the alpha channel so GitHub shows rounded windows.
async function round(file, r = 24) {
  const p = path.join(root, file);
  const { width, height } = await sharp(p).metadata();
  const mask = Buffer.from(
    `<svg width="${width}" height="${height}"><rect width="${width}" height="${height}" rx="${r}" fill="#fff"/></svg>`,
  );
  fs.writeFileSync(
    p,
    await sharp(p).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer(),
  );
}
async function shotRound(p, file, opts = {}) {
  await shot(p, file, opts);
  await round(file);
}
async function main(theme = "dark") {
  const p = await page();
  await p.goto(origin + "/app/dist/index.html?video");
  await p.waitForSelector(".row");
  await p.evaluate((t) => window.setTheme(t), theme);
  // The speed plot is a real 60s time window; warm the mock so the curve has history.
  for (let i = 0; i < 60; i++) {
    await p.evaluate(() => window.__video.step());
    await p.waitForTimeout(500);
  }
  return p;
}
try {
  for (const theme of ["dark", "light"]) {
    const p = await main(theme);
    await shotRound(p, `docs/assets/zh-cn/main-${theme}.png`);
    for (const f of [
      `docs/assets/app-${theme}.png`,
      `site/assets/app-${theme}.png`,
    ]) {
      fs.copyFileSync(path.join(dir, `main-${theme}.png`), path.join(root, f));
      report.push(f);
    }
    await p.close();
  }
  const p = await main("dark");
  await p.locator("#btn-add").click();
  await p.locator("#add-batch").click();
  await p
    .locator("#batch-text")
    .fill(
      "今日份下载清单：\nhttps://downloads.example.com/技术手册-网络协议.pdf\nhttps://downloads.example.com/海岸日记-4K.mp4\n同一个地址会自动去重：https://downloads.example.com/技术手册-网络协议.pdf",
    );
  await shotRound(p, "docs/assets/zh-cn/batch-import.png");
  await p.keyboard.press("Escape");
  await p.locator("#btn-search").click();
  await p.locator("#pal-q").fill("海岸");
  await shotRound(p, "docs/assets/zh-cn/command-palette.png");
  fs.copyFileSync(
    path.join(dir, "command-palette.png"),
    path.join(root, "docs/assets/palette.png"),
  );
  report.push("docs/assets/palette.png");
  await p.keyboard.press("Escape");
  await p.locator("#btn-select").click();
  await p.locator("#bulk-all").check();
  await shotRound(p, "docs/assets/zh-cn/batch-manage.png");
  await p.locator("#bulk-exit").click();
  for (const tab of ["general", "appearance", "downloads", "network", "automation", "browser", "about"]) {
    await p.locator("#btn-settings").click();
    await p.locator(`[data-tab="${tab}"]`).click();
    await shotRound(p, `docs/assets/zh-cn/settings-${tab}.png`);
    if (["appearance", "network", "automation"].includes(tab)) {
      const dest = `site/assets/gallery/settings-${tab}.png`;
      fs.copyFileSync(path.join(root, `docs/assets/zh-cn/settings-${tab}.png`), path.join(root, dest));
      report.push(dest);
    }
    await p.locator("#settings-close").click();
  }
  await p.locator("#btn-settings").click();
  await p.locator('[data-tab="about"]').click();
  await p.locator("#check-update").click();
  await shotRound(p, "docs/assets/zh-cn/check-update.png");
  await p.locator("#settings-close").click();
  await p.close();
  for (const [name, query, theme] of [
    ["download-new", "confirm=1", "dark"],
    ["download-video", "confirm=1&yt", "dark"],
    ["download-progress", "id=1", "dark"],
    ["window-new", "confirm=1", "dark"],
    ["window-progress", "id=1", "dark"],
    ["window-progress-light", "id=1", "light"],
    ["window-complete", "id=6", "dark"],
  ]) {
    const q = await page({ width: 584, height: 780 });
    await q.goto(`${origin}/app/dist/download.html?${query}&video`);
    await q.waitForSelector(".d-head");
    await q.evaluate((t) => {
      window.setTheme(t);
      window.__video.step();
    }, theme);
    if (name === "window-progress")
      await q.locator('[data-a="details"]').click();
    await settle(q);
    const height = await q.evaluate(() => {
      const bar = document.querySelector(".w-bar").getBoundingClientRect().height;
      return Math.ceil(bar + document.getElementById("view").scrollHeight);
    });
    const file = name.startsWith("download-")
      ? `docs/assets/zh-cn/${name}.png`
      : `docs/assets/${name}.png`;
    await shotRound(q, file, {
      clip: { x: 0, y: 0, width: 584, height: Math.min(height, 780) },
      omitBackground: true,
    });
    await q.close();
  }
  for (const theme of ["light", "dark"]) {
    const e = await page({ width: 320, height: 900 });
    await extensionMock(e);
    await e.addInitScript(() => {
      chrome.tabs = {
        query: async () => [{ id: 1, url: "https://example.com" }],
        sendMessage: async () => ({ items: [] }),
      };
    });
    await e.emulateMedia({ colorScheme: theme });
    await e.goto(origin + "/extension/popup.html");
    await settle(e);
    const height = await e.evaluate(() =>
      Math.ceil(document.body.getBoundingClientRect().height),
    );
    await shotRound(e, `docs/assets/zh-cn/extension-${theme}.png`, {
      clip: { x: 0, y: 0, width: 320, height },
    });
    await e.close();
  }
  // A controlled page scene demonstrates overlay behavior without impersonating a third-party website.
  const web = await page({ width: 1120, height: 700 });
  await extensionMock(web);
  await web.route("**/demo-page", (r) =>
    r.fulfill({
      contentType: "text/html",
      body: `<style>body{margin:0;background:#ececeb;color:#232429;font:15px 'Segoe UI',sans-serif}header{height:64px;padding:22px 42px;border-bottom:1px solid #ddd}main{width:840px;margin:28px auto}h1{font-size:24px;font-weight:500}video{display:block;width:840px;height:440px;background:#232429;border-radius:12px}p{font-size:12px;color:#777}</style><header>本地视频页面 · 演示场景</header><main><h1>奶龙写真 / 4K 高清重制</h1><video poster="/docs/assets/app-dark.png"></video><p>示例页面及资源信息为模拟数据，不代表真实站点或真实下载测速。</p></main><script>Object.defineProperty(document.querySelector('video'),'currentSrc',{value:'https://example.com/nailong-demo.mp4'});</script>`,
    }),
  );
  await web.goto(origin + "/demo-page");
  for (const f of [
    "preferences.js",
    "content.js",
    "image-button.js",
    "image.js",
  ])
    await web.addScriptTag({ path: path.join(root, "extension", f) });
  await shot(web, "docs/assets/zh-cn/browser-quiet.png");
  await web.mouse.move(700, 300);
  await web.waitForTimeout(400);
  await shot(web, "docs/assets/zh-cn/browser-video.png");
  await web.close();
  // Replace all legacy marketing rasters with freshly rendered layouts using these actual UI captures.
  const studios = [
    [
      "docs/assets/problem.png",
      "让页面留给内容。",
      "图片浮层默认关闭，视频入口按需显示。",
      "docs/assets/zh-cn/browser-quiet.png",
    ],
  ];
  for (const [file, title, sub, image] of studios) {
    const w = file.includes("problem") ? 1600 : 1280,
      h = file.includes("problem") ? 900 : 800;
    const c = await page({ width: w, height: h });
    await c.setContent(
      `<style>body{margin:0;background:#ECECE9;color:#202126;font-family:'Microsoft YaHei',sans-serif;padding:42px 56px}header{display:flex;justify-content:space-between;align-items:center}header img{width:220px}h1{font-size:30px;font-weight:500;margin:18px 0 8px}p{color:#797C83;font-size:14px;margin:0}.stage{height:${h - 240}px;display:flex;align-items:center;justify-content:center;margin-top:20px}.stage img{max-width:100%;max-height:100%;object-fit:contain;border-radius:10px}footer{font-size:11px;color:#888;margin-top:16px}</style><header><img src="${origin}/site/assets/logo-wordmark.svg"><span>BaaDash / 功能演示</span></header><h1>${title}</h1><p>${sub}</p><div class="stage"><img src="${origin}/${image}"></div><footer>真实界面预览 · 任务与资源信息为模拟数据 · 未宣称扩展已上架商店</footer>`,
    );
    await c.evaluate(() =>
      Promise.all([...document.images].map((i) => i.decode())),
    );
    await shot(c, file);
    await c.close();
  }
  fs.mkdirSync(path.join(root, "site/assets/gallery"), { recursive: true });
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".png")))
    fs.copyFileSync(
      path.join(dir, f),
      path.join(root, "site/assets/gallery", f),
    );
  fs.copyFileSync(
    path.join(root, "docs/assets/window-progress.png"),
    path.join(root, "site/assets/window-progress.png"),
  );
  report.push("site/assets/window-progress.png");
  const legacy = [
    "docs/assets/app-dark.png",
    "docs/assets/app-light.png",
    "docs/assets/palette.png",
    "docs/assets/problem.png",
    "docs/assets/window-complete.png",
    "docs/assets/window-new.png",
    "docs/assets/window-progress-light.png",
    "docs/assets/window-progress.png",
    "docs/assets/zh-cn/batch-import.png",
    "docs/assets/zh-cn/command-palette.png",
    "docs/assets/zh-cn/download-new.png",
    "docs/assets/zh-cn/download-progress.png",
    "docs/assets/zh-cn/download-video.png",
    "docs/assets/zh-cn/main-dark.png",
    "docs/assets/zh-cn/main-light.png",
    "docs/assets/zh-cn/settings-browser.png",
    "docs/assets/zh-cn/settings-general.png",
  ];
  for (const f of legacy)
    if (!report.includes(f)) throw Error("Legacy demo was not retaken: " + f);
  fs.writeFileSync(
    path.join(root, "tools/ui/capture-manifest.json"),
    JSON.stringify(
      {
        mode: "Actual browser rendering with deterministic mock backend; not native OS screenshots",
        captures: report,
        errors,
      },
      null,
      2,
    ),
  );
  if (errors.length) throw Error(errors.join("\n"));
  const shots = fs.readdirSync(dir).filter((f) => f.endsWith(".png"));
  const layers = [];
  for (const [i, f] of shots.entries()) {
    layers.push({
      input: await sharp(path.join(dir, f))
        .resize(330, 205, { fit: "contain", background: "#E6E6E2" })
        .png()
        .toBuffer(),
      left: (i % 4) * 350 + 10,
      top: Math.floor(i / 4) * 240 + 10,
    });
    layers.push({
      input: Buffer.from(
        `<svg width="340" height="22"><text x="8" y="16" font-family="Arial" font-size="12" fill="#444">${f}</text></svg>`,
      ),
      left: (i % 4) * 350,
      top: Math.floor(i / 4) * 240 + 218,
    });
  }
  fs.mkdirSync(path.join(root, "tools/ui/.artifacts"), { recursive: true });
  await sharp({
    create: {
      width: 1400,
      height: Math.ceil(shots.length / 4) * 240,
      channels: 4,
      background: "#E6E6E2",
    },
  })
    .composite(layers)
    .png()
    .toFile(path.join(root, "tools/ui/.artifacts/demo-contact-sheet.png"));
  console.log(
    `Retaken ${report.length} captures, including all ${legacy.length} legacy demo images. No page errors.`,
  );
} finally {
  await browser.close();
  server.close();
}
