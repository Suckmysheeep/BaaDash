import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "../../app/node_modules/typescript/lib/typescript.js";
import { start } from "./runtime.mjs";

const util = fs.readFileSync(new URL("../../app/ui/src/util.ts", import.meta.url), "utf8");
const js = ts.transpileModule(util, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { extractLinks } = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
assert.deepEqual(extractLinks("分享：https://files.test/file[01-03].zip，https://files.test/file02.zip"), [
  "https://files.test/file01.zip", "https://files.test/file02.zip", "https://files.test/file03.zip",
]);
assert.equal(extractLinks("https://files.test/file[1-500].zip").length, 500);
assert.equal(extractLinks("https://files.test/file[1-999999].zip").length, 0);
assert.equal(extractLinks("https://files.test/file[5-1].zip").length, 0);
for (const name of ["popup.js", "content.js"]) {
  const source = fs.readFileSync(new URL(`../../extension/${name}`, import.meta.url), "utf8");
  const begin = source.indexOf("function pickStream("), end = source.indexOf("\n}", begin)+2;
  const ctx = vm.createContext({}); vm.runInContext(source.slice(begin,end),ctx);
  const streams = [{kind:"hls",url:"new",at:100000,qualities:[{},{}]},{kind:"hls",url:"old",at:1,qualities:[{},{}]}];
  assert.equal(ctx.pickStream(streams).url,"new");
  assert.equal(ctx.pickStream([{kind:"file"}]),null);
}
const { browser, server, origin } = await start();
try {
  const page = await browser.newPage({viewport:{width:1120,height:760}});
  const errors=[];page.on("pageerror",e=>errors.push(e.message));
  await page.goto(origin+"/app/dist/index.html?video");
  await page.waitForSelector(".row");
  await page.locator("#btn-settings").click();
  await page.locator('[data-tab="speed"]').click();
  await page.locator("#set-proxy").fill("socks5h://127.0.0.1:1080");
  await page.locator("#set-bind").fill("127.0.0.1");
  await page.locator("#set-scale").fill("120");
  assert.equal(await page.evaluate(()=>document.documentElement.style.zoom),"1.2");
  await page.locator("#settings-close").click();
  await page.waitForFunction(()=>document.documentElement.style.zoom === "1");
  assert.equal(await page.evaluate(()=>document.documentElement.style.zoom),"1");
  await page.locator("#btn-settings").click();
  await page.locator('[data-tab="speed"]').click();
  assert.equal(await page.locator("#set-proxy").inputValue(),"");
  for(const width of [820,1120]) {
    await page.setViewportSize({width,height:760});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`settings overflow at ${width}`);
  }
  await page.locator("#settings-close").click();
  assert.equal(await page.locator("#add-checksum").getAttribute("maxlength"),"64");
  assert.deepEqual(errors,[]);
  console.log("PASS: v0.2.0 range expansion, newest streams, proxy controls, scale preview/cancel and settings layout.");
} finally {await browser.close();server.close();}
