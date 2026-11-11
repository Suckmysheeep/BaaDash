// Keep the committed site preview and deployed site in sync with CHANGELOG.md.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const changelog = fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8");
const release = /^## \[(\d+\.\d+\.\d+)\] - (\d{4}-\d{2}-\d{2})\r?\n([\s\S]*?)(?=^## |$(?![\s\S]))/m.exec(changelog);
if (!release) throw new Error("CHANGELOG.md 中未找到正式版本记录");
const [, version, date, notes] = release;
const escape = value => value.replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const inline = value => escape(value).replace(/`([^`]+)`/g, "<code>$1</code>");
const sections = [];
let list = false;
const closeList = () => { if (list) { sections.push("</ul>"); list = false; } };
for (const raw of notes.trim().split(/\r?\n/)) {
  const line = raw.trim();
  if (!line) { closeList(); continue; }
  if (line.startsWith("### ")) { closeList(); sections.push(`<h2>${inline(line.slice(4))}</h2>`); }
  else if (line.startsWith("- ")) {
    if (!list) { sections.push("<ul>"); list = true; }
    sections.push(`<li>${inline(line.slice(2))}</li>`);
  } else { closeList(); sections.push(`<p>${inline(line)}</p>`); }
}
closeList();
const homePath = path.join(root, "site/index.html");
const home = fs.readFileSync(homePath, "utf8");
const summary = /BaaDash v\d+\.\d+\.\d+ 已发布/;
if (!summary.test(home)) throw new Error("首页版本文案标记不存在");
fs.writeFileSync(homePath, home.replace(summary, `BaaDash v${version} 已发布`));
const pagePath = path.join(root, "site/changelog.html");
const page = fs.readFileSync(pagePath, "utf8");
if (!/<main class="document">[\s\S]*?<\/main>/.test(page)) throw new Error("更新记录页面结构不匹配");
fs.writeFileSync(pagePath, page.replace(/<main class="document">[\s\S]*?<\/main>/, () => `<main class="document">
      <div class="eyebrow">CHANGELOG</div>
      <h1>每一次更新，都有记录。</h1>
      <p class="lede">v${version} · ${date}</p>
      <section class="section">
        ${sections.join("\n        ")}
        <p><a class="button" href="https://github.com/Suckmysheeep/BaaDash/releases/tag/v${version}">查看此版本 ↗</a>
        <a class="button" href="https://github.com/Suckmysheeep/BaaDash/blob/main/CHANGELOG.md">完整历史记录 ↗</a></p>
      </section>
    </main>`));
console.log(`官网已从 CHANGELOG.md 同步至 v${version}（${date}）`);
