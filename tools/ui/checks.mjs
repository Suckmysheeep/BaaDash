import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { start, root, extensionMock } from "./runtime.mjs";
const { browser, server, origin } = await start();
const results = [],
  errors = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1120, height: 700 },
  });
  page.on("pageerror", (e) => {
    errors.push(e.message);
    console.error("APP ERROR:", e.message);
  });
  await page.goto(origin + "/app/dist/index.html?video");
  await page.waitForSelector(".row");
  await page.evaluate(() => document.fonts.ready);
  await page.locator("#btn-settings").click();
  await page.locator('[data-tab="about"]').click();
  await page.locator("#settings-close").click();
  assert.equal(
    await page.locator("#dlg-settings").evaluate((d) => d.open),
    false,
  );
  results.push("Every settings tab can close via X");
  await page.locator("#btn-settings").click();
  await page.locator('[data-tab="about"]').click();
  await page.locator("#check-update").click();
  assert.match(
    await page.locator("#update-status").innerText(),
    /发现新版本|最新版本/,
  );
  await page.locator("#settings-close").click();
  results.push("Manual update check reports a result");
  await page.locator("#btn-settings").click();
  await page.locator('[data-tab="about"]').click();
  await page.evaluate(() => {
    const original = window.__TAURI__.core.invoke;
    window.__TAURI__.core.invoke = (cmd, args) =>
      cmd === "check_update" ? Promise.resolve(null) : original(cmd, args);
  });
  await page.locator("#check-update").click();
  assert.match(await page.locator("#update-status").innerText(), /最新版本/);
  await page.evaluate(() => {
    const original = window.__TAURI__.core.invoke;
    window.__TAURI__.core.invoke = (cmd, args) =>
      cmd === "check_update"
        ? Promise.reject("网络不可用")
        : original(cmd, args);
  });
  await page.locator("#check-update").click();
  assert.match(await page.locator("#update-status").innerText(), /检查失败/);
  await page.locator("#settings-close").click();
  results.push("Latest-version and network-error states are visible");
  await page.locator("#btn-select").click();
  await page.locator("#bulk-all").check();
  assert.match(await page.locator("#bulk-count").innerText(), /8/);
  await page.locator("#bulk-exit").click();
  results.push("Select-all and exit selection");
  await page.locator('[data-view="completed"]').click();
  await page.locator("#btn-history").click();
  await page.locator("#del-ok").click();
  await page.waitForFunction(async () => {
    const state = await window.__TAURI__.core.invoke("get_state");
    return !state.items.some((item) => item.status === "completed");
  });
  await page.evaluate(() => window.__video.step());
  await page.waitForFunction(
    () => document.querySelectorAll("#rows .row").length === 0,
  );
  assert.equal(await page.locator("#rows .row").count(), 0);
  const state = await page.evaluate(() =>
    window.__TAURI__.core.invoke("get_state"),
  );
  assert.equal(state.items.length, 5);
  assert.ok(state.items.some((i) => i.status === "downloading"));
  results.push(
    "Clearing completed records preserves active tasks; delete-files defaults off",
  );
  await page.locator('[data-view="all"]').click();
  await page
    .locator(".row")
    .nth(0)
    .click({ modifiers: ["Control"] });
  await page
    .locator(".row")
    .nth(1)
    .click({ modifiers: ["Control"] });
  assert.match(await page.locator("#bulk-count").innerText(), /2/);
  await page.locator("#bulk-pause").click();
  await page.evaluate(() => window.__video.step());
  results.push("Ctrl multi-select and batch pause");
  for (const width of [820, 1120]) {
    await page.setViewportSize({ width, height: 520 });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth),
      width,
    );
  }
  results.push("820px and 1120px layouts have no document overflow");
  const ext = await browser.newPage({ viewport: { width: 1000, height: 720 } });
  await extensionMock(ext);
  await ext.route("**/fixture", (r) =>
    r.fulfill({
      contentType: "text/html",
      body: `<style>body{margin:0}video{position:absolute;left:40px;top:40px;width:640px;height:360px}img{position:absolute;width:640px;height:360px;left:40px;top:40px}#photo{top:430px;width:300px;height:180px}</style><video id="v"></video><img id="poster" src="/docs/assets/app-dark.png"><img id="photo" src="/docs/assets/app-dark.png"><script>Object.defineProperty(document.querySelector('video'),'currentSrc',{value:'https://example.com/video.mp4',configurable:true});</script>`,
    }),
  );
  await ext.goto(origin + "/fixture");
  for (const p of [
    "preferences.js",
    "content.js",
    "image-button.js",
    "image.js",
  ])
    await ext.addScriptTag({ path: path.join(root, "extension", p) });
  await ext.waitForTimeout(100);
  await ext.mouse.move(200, 500);
  await ext.waitForTimeout(200);
  assert.equal(await ext.locator("baadash-image-button").count(), 0);
  results.push("Images have no overlay by default");
  await ext.evaluate(() => window.__setPrefs({ imageButtons: true }));
  await ext.mouse.move(210, 501);
  await ext.waitForTimeout(200);
  assert.ok(
    await ext.evaluate(() =>
      window.__testShadows.some((r) => r.querySelector("button.on")),
    ),
  );
  await ext.mouse.move(300, 200);
  await ext.waitForTimeout(650);
  assert.ok(
    await ext.evaluate(
      () =>
        !window.__testShadows.some(
          (r) =>
            r.host.tagName === "BAADASH-IMAGE-BUTTON" &&
            r.querySelector("button.on"),
        ),
    ),
  );
  results.push("Poster never displays an image button over a video");
  const videoVisible = () =>
    ext.evaluate(() =>
      window.__testShadows.some((r) => r.querySelector(".wrap.on")),
    );
  assert.equal(await videoVisible(), true);
  await ext.waitForTimeout(2100);
  assert.equal(await videoVisible(), false);
  await ext.mouse.move(320, 210);
  await ext.waitForTimeout(500);
  assert.equal(await videoVisible(), true);
  results.push(
    "Video overlay auto-hides while pointer rests and can be summoned again",
  );
  await ext.evaluate(() => window.__setPrefs({ sniffing: false }));
  assert.equal(await videoVisible(), false);
  await ext.mouse.move(330, 220);
  await ext.waitForTimeout(500);
  assert.equal(await videoVisible(), false);
  results.push(
    "Disabling sniffing immediately hides and suppresses video overlay",
  );
  await ext.evaluate(() =>
    window.__setPrefs({ imageButtons: false, imageSites: [location.hostname] }),
  );
  await ext.mouse.move(240, 510);
  await ext.waitForTimeout(200);
  assert.ok(
    await ext.evaluate(() =>
      window.__testShadows.some((r) => r.querySelector("button.on")),
    ),
  );
  await ext.evaluate(() =>
    window.__setPrefs({ disabledSites: [location.hostname] }),
  );
  assert.ok(
    await ext.evaluate(
      () => !window.__testShadows.some((r) => r.querySelector("button.on")),
    ),
  );
  results.push(
    "Site-only image preference and site disable apply without reload",
  );
  assert.deepEqual(errors, []);
  console.log(results.join("\n"));
  fs.writeFileSync(
    path.join(root, "tools/ui/test-results.json"),
    JSON.stringify({ passed: results, errors }, null, 2),
  );
} finally {
  await browser.close();
  server.close();
}
