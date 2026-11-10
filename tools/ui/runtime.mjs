import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
export const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
export const browserPath =
  process.env.CHROME ||
  [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ].find(fs.existsSync);
export async function start() {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split("?")[0]);
    const p = path.resolve(root, "." + url);
    if (
      !p.startsWith(root + path.sep) ||
      !fs.existsSync(p) ||
      fs.statSync(p).isDirectory()
    ) {
      res.writeHead(404).end();
      return;
    }
    res.setHeader(
      "Content-Type",
      {
        ".html": "text/html",
        ".js": "text/javascript",
        ".css": "text/css",
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".woff2": "font/woff2",
        ".json": "application/json",
      }[path.extname(p)] || "application/octet-stream",
    );
    res.end(fs.readFileSync(p));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const browser = await chromium.launch({
    executablePath: browserPath,
    headless: true,
  });
  return {
    server,
    browser,
    origin: `http://127.0.0.1:${server.address().port}`,
  };
}
export async function extensionMock(page, initial = {}) {
  await page.addInitScript((initial) => {
    const state = {
        sniffing: true,
        videoButtons: true,
        imageButtons: false,
        imageSites: [],
        disabledSites: [],
        ...initial,
      },
      listeners = [];
    window.__prefsState = state;
    window.__setPrefs = async (patch) => {
      const changes = {};
      for (const [k, v] of Object.entries(patch)) {
        changes[k] = { oldValue: state[k], newValue: v };
        state[k] = v;
      }
      listeners.forEach((fn) => fn(changes, "sync"));
    };
    const native = Element.prototype.attachShadow;
    window.__testShadows = [];
    Element.prototype.attachShadow = function (o) {
      const r = native.call(this, o);
      window.__testShadows.push(r);
      return r;
    };
    window.chrome = {
      storage: {
        sync: {
          get: async (d) => ({ ...d, ...state }),
          set: (patch) => window.__setPrefs(patch),
        },
        onChanged: { addListener: (fn) => listeners.push(fn) },
      },
      runtime: {
        getURL: (p) => "/extension/" + p,
        onMessage: { addListener() {} },
        sendMessage: async () => ({ ok: true, items: [] }),
      },
    };
  }, initial);
}
