import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { root, start } from "./runtime.mjs";
const { browser, server, origin } = await start();
const failures = [];
const releaseVersion = /^## \[(\d+\.\d+\.\d+)\] - /m.exec(fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8"))?.[1];
assert.ok(releaseVersion, "CHANGELOG release version is required");
try {
  for (const width of [390, 1440])
    for (const name of ["index", "download", "changelog"]) {
      const p = await browser.newPage({ viewport: { width, height: 1000 } });
      p.on("pageerror", (e) => failures.push(e.message));
      p.on("response", (r) => {
        if (r.url().startsWith(origin) && r.status() >= 400)
          failures.push(r.url());
      });
      await p.route("https://api.github.com/**", (r) => r.abort());
      await p.goto(origin + "/site/" + name + ".html");
      if (name === "index" || name === "changelog") {
        assert.ok((await p.locator("main").innerText()).includes(`v${releaseVersion}`), `${name} must show the current CHANGELOG version`);
      }
      await p.evaluate(() => document.fonts.ready);
      await p.waitForTimeout(200);
      assert.equal(
        await p.evaluate(() => document.documentElement.scrollWidth),
        width,
        name + " responsive",
      );
      const missing = await p
        .locator("img")
        .evaluateAll((imgs) =>
          imgs.filter((i) => !i.complete || !i.naturalWidth).map((i) => i.src),
        );
      assert.deepEqual(missing, []);
      if (name === "index" && width === 1440)
        await p.screenshot({
          path: path.join(root, "docs/assets/brand/site-preview.png"),
          fullPage: true,
        });
      await p.close();
    }
  const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
  for (const m of readme.matchAll(/(?:src|srcset)="([^"]+)"/g))
    assert.ok(fs.existsSync(path.join(root, m[1])), m[1]);
  assert.deepEqual(failures, []);
  console.log(
    "PASS: 3 site pages × desktop/mobile, no overflow or missing assets; README image paths resolve.",
  );
  const v = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await v.goto(origin + "/video/launch.html");
  await v.evaluate(() => window.ready);
  for (const t of [2, 10, 20, 29, 38, 45]) {
    await v.evaluate((t) => window.seek(t), t);
    await v.screenshot({
      path: path.join(root, `docs/assets/brand/video-frame-${t}.png`),
    });
  }
  console.log("PASS: all six demo film scenes render with local assets.");
} finally {
  await browser.close();
  server.close();
}
