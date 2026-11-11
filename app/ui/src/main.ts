import { taskAdvanced, bindTaskAdvanced, resetTaskAdvanced, readTaskChecksum } from "./advanced";
// BaaDash main window. Talks to the Rust backend through api.ts; opened
// in a normal browser, mock.ts stands in for the backend.

import "./styles.css";
import { invoke, listen, currentWindow, $ } from "./api";
import type {
  Item,
  Settings,
  IntegrationStatus,
  BrowserStatus,
  Incoming,
  ProbeInfo,
  Header,
  Status,
  Commands,
  UpdateInfo,
} from "./api";
import {
  icon,
  CATS,
  parts,
  bytes,
  speed,
  dur,
  when,
  esc,
  host,
  segBar,
  categoryLabel,
  displayText,
  extractLinks,
  firstUrl,
  cleanFilename,
} from "./util";

let bulkMode = false,
  bulkAnchor: number | null = null;
const bulkIds = new Set<number>();
const appWindow = currentWindow();
const target = (e: Event) => e.target as HTMLElement;

const hydrate = () =>
  document.querySelectorAll<HTMLElement>("i[data-icon]").forEach((el) => {
    const tpl = document.createElement("template");
    tpl.innerHTML = icon(el.dataset.icon || "file");
    const svg = tpl.content.firstElementChild as HTMLElement;
    if (el.className) svg.classList.add(...el.className.split(" "));
    el.replaceWith(svg);
  });

const cat = (it: { category: string }) => CATS[it.category] || CATS.Other;
const typeIcon = (name: string) =>
  `<span class="ni-type" style="--c:${(CATS[name] || CATS.Other).color}">${icon((CATS[name] || CATS.Other).icon)}</span>`;
const ftile = (it: { category: string }, lg = false) =>
  `<div class="ftile ${lg ? "lg" : ""}" style="--c:${cat(it).color}">${icon(cat(it).icon)}</div>`;

// Status glyph: a progress ring that fills clockwise while downloading
// (pause bars inside when paused), a dotted ring when queued, and filled
// badges for done and failed.
type StatusLike = { status: Status; size: number | null; downloaded: number };
function statusIcon(it: StatusLike) {
  const s = it.status;
  if (s === "completed")
    return `<svg class="status" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7.25" fill="var(--green)"/><path d="m5.1 8.2 2 2 3.8-4" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  if (s === "error")
    return `<svg class="status" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7.25" fill="var(--red)"/><path d="M8 4.6v4.2" stroke="#fff" stroke-width="1.7" stroke-linecap="round"/><circle cx="8" cy="11.2" r="1" fill="#fff"/></svg>`;
  if (s === "queued")
    return `<svg class="status" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.4" fill="none" stroke="var(--faint)" stroke-width="1.7" stroke-linecap="round" stroke-dasharray="0.1 3.25"/></svg>`;
  const color = s === "paused" ? "var(--amber)" : "var(--accent)";
  const r = 6.4,
    c = 2 * Math.PI * r,
    p = Math.max(0.03, Math.min(1, pct(it) / 100));
  const inner =
    s === "paused"
      ? `<path d="M6.6 6v4M9.4 6v4" stroke="${color}" stroke-width="1.5" stroke-linecap="round"/>`
      : `<path d="M8 5.4v4.6M6.1 8.3 8 10.2l1.9-1.9" fill="none" stroke="${color}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>`;
  return `<svg class="status" viewBox="0 0 16 16"><circle cx="8" cy="8" r="${r}" fill="none" stroke="var(--track)" stroke-width="1.7"/><circle cx="8" cy="8" r="${r}" fill="none" stroke="${color}" stroke-width="1.7" stroke-linecap="round" stroke-dasharray="${(c * p).toFixed(2)} ${c.toFixed(2)}" transform="rotate(-90 8 8)"/>${inner}</svg>`;
}

const pct = (it: StatusLike) =>
  it.size
    ? Math.min(100, (it.downloaded / it.size) * 100)
    : it.status === "completed"
      ? 100
      : 0;
const eta = (it: Item) =>
  it.speed > 0 && it.size ? (it.size - it.downloaded) / it.speed : Infinity;
const isActive = (it: Item) =>
  it.status === "downloading" || it.status === "queued";
const ext = (name: string) =>
  (/\.([a-z0-9]{1,5})$/i.exec(name || "") || [])[1]?.toUpperCase() || "";
const STATUS: Record<Status, string> = {
  downloading: "下载中",
  queued: "排队中",
  paused: "已暂停",
  completed: "已完成",
  error: "下载失败",
};

// ---------- state ----------
const HISTORY = 120;
const LIMITS = [0, 256, 1024, 5120, 10240];
interface State {
  version: string;
  items: Item[];
  settings: Settings | null;
  view: string;
  search: string;
  selected: number | null;
  pending: Incoming[];
  speedHist: Map<number, number[]>;
  totalHist: number[];
  typesOpen: boolean;
  integration: IntegrationStatus | null;
}
const state: State = {
  version: "",
  items: [],
  settings: null,
  view: "all",
  search: "",
  selected: null,
  pending: [],
  speedHist: new Map(),
  totalHist: [],
  typesOpen: true,
  integration: null,
};
const settings = (): Settings => state.settings as Settings;
interface View {
  name: string;
  icon: string;
  test: (i: Item) => boolean;
}
const VIEWS: Record<string, View> = {
  all: { name: "全部下载", icon: "inbox", test: () => true },
  active: {
    name: "正在下载",
    icon: "arrowDown",
    test: (i) => i.status !== "completed" && i.status !== "error",
  },
  completed: {
    name: "已完成",
    icon: "doneCircle",
    test: (i) => i.status === "completed",
  },
  failed: {
    name: "下载失败",
    icon: "alert",
    test: (i) => i.status === "error",
  },
};
const byId = (id: number | null) => state.items.find((i) => i.id === id);
function visible() {
  const v = VIEWS[state.view];
  const q = state.search.trim().toLowerCase();
  return state.items.filter(
    (it) =>
      (v ? v.test(it) : it.category === state.view) &&
      (!q ||
        it.filename.toLowerCase().includes(q) ||
        it.url.toLowerCase().includes(q)),
  );
}
const GROUPS: [Status, string][] = [
  ["downloading", "下载中"],
  ["queued", "排队中"],
  ["paused", "已暂停"],
  ["error", "下载失败"],
  ["completed", "已完成"],
];
function grouped(list: Item[]) {
  return GROUPS.map(([s, title]) => {
    const items = list.filter((i) => i.status === s);
    if (s !== "queued") items.sort(
      s === "completed"
        ? (a, b) => (b.completedAt || 0) - (a.completedAt || 0)
        : (a, b) => b.addedAt - a.addedAt,
    );
    return { s, title, items };
  }).filter((g) => g.items.length);
}
const orderIds = () =>
  grouped(visible()).flatMap((g) => g.items.map((i) => i.id));

// ---------- charts ----------
function areaChart(
  canvas: HTMLCanvasElement,
  data: number[],
  { grid = false, fill = true } = {},
) {
  const dpr = devicePixelRatio || 1,
    w = canvas.clientWidth,
    h = canvas.clientHeight;
  if (!w || !h) return;
  if (canvas.width !== Math.round(w * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const css = getComputedStyle(document.documentElement);
  const accent = css.getPropertyValue("--accent").trim();
  const line = css.getPropertyValue("--border").trim();
  const faint = css.getPropertyValue("--faint").trim();
  const max = Math.max(1, ...data) * 1.2;
  // With a scale, labels get their own margin on the right so the graph
  // never draws over them.
  const gutter = grid ? 58 : 0;
  const pw = w - gutter,
    top = grid ? 6 : 2,
    bottom = grid ? 6 : 2;
  const yOf = (v: number) => h - bottom - (v / max) * (h - top - bottom);
  if (grid) {
    ctx.lineWidth = 1;
    ctx.font = `500 10.5px ${css.getPropertyValue("--font")}`;
    ctx.textBaseline = "middle";
    const hasData = data.some((v) => v > 0);
    for (const frac of [1 / 1.2, 0.5 / 1.2, 0]) {
      const y = Math.round(yOf(max * frac)) + 0.5;
      ctx.strokeStyle = line;
      ctx.setLineDash(frac ? [3, 3] : []);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(pw, y);
      ctx.stroke();
      ctx.fillStyle = faint;
      if (hasData || !frac)
        ctx.fillText(frac ? speed(max * frac) : "0", pw + 8, y);
    }
    ctx.setLineDash([]);
  }
  const n = HISTORY,
    span = Math.max(Math.min(data.length, n), 30) - 1;
  const pts = data
    .slice(-n)
    .map((v, i, a): [number, number] => [
      pw - (a.length - 1 - i) * (pw / span),
      yOf(v),
    ]);
  if (pts.length < 2) return;
  const path = new Path2D();
  pts.forEach(([x, y], i) => {
    if (!i) path.moveTo(x, y);
    else {
      const [px, py] = pts[i - 1],
        cx = (px + x) / 2;
      path.bezierCurveTo(cx, py, cx, y, x, y);
    }
  });
  const area = new Path2D(path);
  area.lineTo(pts[pts.length - 1][0], h - bottom);
  area.lineTo(pts[0][0], h - bottom);
  area.closePath();
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, accent + "40");
  g.addColorStop(1, accent + "00");
  if (fill) {
    ctx.fillStyle = g;
    ctx.fill(area);
  }
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1.5;
  ctx.stroke(path);
}

// ---------- sidebar ----------
function renderNav() {
  const count = (fn: (i: Item) => boolean) => state.items.filter(fn).length;
  const live = state.items.some((i) => i.status === "downloading");
  const item = (
    view: string,
    label: string,
    ic: string,
    n: number,
    extra = "",
  ) =>
    `<button class="nav-item ${state.view === view ? "on" : ""}" data-view="${view}"><span class="ni-icon">${ic}</span><span class="ni-label">${label}</span>${extra}<span class="ni-count">${n || ""}</span></button>`;
  let html =
    item("all", "全部下载", icon("inbox"), state.items.length) +
    item(
      "active",
      "正在下载",
      icon("arrowDown"),
      count(VIEWS.active.test),
      live ? '<span class="ni-live"></span>' : "",
    ) +
    item(
      "completed",
      "已完成",
      icon("doneCircle"),
      count(VIEWS.completed.test),
    );
  const failed = count(VIEWS.failed.test);
  if (failed || state.view === "failed")
    html += item("failed", "下载失败", icon("alert"), failed);
  html += `<button class="nav-sec ${state.typesOpen ? "" : "closed"}" data-toggle="types">文件类型 ${icon("chevDown")}</button>`;
  if (state.typesOpen)
    for (const name of Object.keys(CATS))
      html += item(
        name,
        categoryLabel(name),
        typeIcon(name),
        count((i) => i.category === name),
      );
  if ($("nav").innerHTML !== html) $("nav").innerHTML = html;

  const active = state.items.filter((i) => i.status === "downloading");
  const queued = state.items.filter((i) => i.status === "queued").length;
  const total = active.reduce((s, i) => s + (i.speed || 0), 0);
  const [v, u] = total > 0 ? parts(total) : ["0", "B"];
  $("net-speed").textContent = v;
  $("net-unit").textContent = `${u}/s`;
  const left = active.reduce(
    (s, i) => s + Math.max(0, (i.size || 0) - i.downloaded),
    0,
  );
  $("net-foot").textContent = active.length
    ? `${active.length} 个下载中${queued ? ` · ${queued} 个排队中` : ""} · 剩余 ${bytes(left)}`
    : queued
      ? `${queued} 个排队中`
      : "空闲";
  const lim = state.settings?.speedLimitKib || 0;
  $("limit-btn").textContent = lim ? `≤ ${bytes(lim * 1024)}/s` : "不限速";
  $("limit-btn").classList.toggle("on", !!lim);
  areaChart($("net-graph"), state.totalHist);
}

// ---------- header ----------
function renderHeader(list: Item[]) {
  const v = VIEWS[state.view];
  $("h-icon").innerHTML = v ? icon(v.icon) : typeIcon(state.view);
  $("h-name").textContent = v ? v.name : categoryLabel(state.view);
  $("h-count").textContent = list.length ? String(list.length) : "";
  $("btn-pause-all").hidden = !list.some(isActive);
  $("btn-resume-all").hidden = !list.some(
    (i) => i.status === "paused" || i.status === "error",
  );
}

// ---------- list ----------
interface RowEl extends HTMLDivElement {
  _c: HTMLElement[];
  _k: string[];
}
const rowEls = new Map<number, RowEl>(),
  headEls = new Map<string, HTMLDivElement>();
function makeRow(id: number): RowEl {
  const el = document.createElement("div") as RowEl;
  el.className = "row";
  el.dataset.id = String(id);
  el.innerHTML = `<span class="r-status"></span><div class="r-main"></div><div class="r-meta"></div>`;
  el._c = [...el.children] as HTMLElement[];
  el._k = [];
  return el;
}
function set(el: RowEl, i: number, html: string) {
  if (el._k[i] !== html) {
    el._k[i] = html;
    el._c[i].innerHTML = html;
  }
}
function meta(it: Item) {
  const p = Math.floor(pct(it));
  const mini = (cls: string) =>
    `<span class="mini ${cls}"><i style="width:${pct(it)}%"></i></span><span class="pct">${it.size ? p + "%" : ""}</span>`;
  switch (it.status) {
    case "downloading":
      return `${mini("")}<span class="m-size">${bytes(it.downloaded)} / ${bytes(it.size)}</span><span class="m-speed">${it.speed > 0 ? speed(it.speed) : "正在连接…"}</span><span class="m-eta">${dur(eta(it))}</span>`;
    case "queued":
      return `${mini("queued")}<span class="m-size">${it.size ? bytes(it.size) : "—"}</span><span class="m-speed" style="color:var(--muted);font-weight:500">排队第 ${state.items.filter(i => i.status === "queued").findIndex(i => i.id === it.id) + 1} 位</span><span class="m-eta"></span>`;
    case "paused":
      return `${mini("paused")}<span class="m-size">${bytes(it.downloaded)} / ${bytes(it.size)}</span><span class="m-speed" style="color:var(--amber);font-weight:500">已暂停</span><span class="m-eta"></span>`;
    case "error":
      return `<span class="m-size">${bytes(it.size)}</span><span class="m-when">${when(it.addedAt)}</span>`;
    default:
      return `<span class="cat"><i style="background:${cat(it).color}"></i>${categoryLabel(it.category)}</span><span class="m-size">${bytes(it.size)}</span><span class="m-when">${when(it.completedAt)}</span>`;
  }
}
function updateRow(el: RowEl, it: Item) {
  el.classList.toggle("sel", state.selected === it.id);
  el.classList.toggle("bulk-picked", bulkMode && bulkIds.has(it.id));
  set(
    el,
    0,
    bulkMode
      ? `<input class="bulk-check" type="checkbox" aria-label="选择 ${esc(it.filename)}" data-bulk="${it.id}" ${bulkIds.has(it.id) ? "checked" : ""}>`
      : statusIcon(it),
  );
  const e = ext(it.filename);
  set(
    el,
    1,
    `<span class="r-name" title="${esc(it.filename)}">${esc(it.filename.replace(/\.[^.]+$/, "") || it.filename)}</span>${e ? `<span class="r-ext">${e}</span>` : ""}${it.status === "error" ? `<span class="r-err">${esc(displayText(it.error) || "下载失败")}</span>` : ""}`,
  );
  set(el, 2, meta(it));
}
function renderList() {
  const list = visible();
  const nodes = [];
  for (const g of grouped(list)) {
    let h = headEls.get(g.s);
    if (!h) {
      h = document.createElement("div");
      h.className = "ghead";
      headEls.set(g.s, h);
    }
    const right =
      g.s === "downloading"
        ? speed(g.items.reduce((s, i) => s + (i.speed || 0), 0))
        : g.s === "completed"
          ? bytes(g.items.reduce((s, i) => s + (i.size || 0), 0))
          : "";
    const html = `${statusIcon({ status: g.s, size: 4, downloaded: 3 })}<span>${g.title}</span><span class="gc">${g.items.length}</span><span class="gr">${right}</span>`;
    if (h.innerHTML !== html) h.innerHTML = html;
    nodes.push(h);
    for (const it of g.items) {
      let el = rowEls.get(it.id);
      if (!el) {
        el = makeRow(it.id);
        rowEls.set(it.id, el);
      }
      updateRow(el, it);
      nodes.push(el);
    }
  }
  for (const id of rowEls.keys()) if (!byId(id)) rowEls.delete(id);
  const root = $("rows");
  if (
    root.children.length !== nodes.length ||
    nodes.some((n, i) => root.children[i] !== n)
  )
    root.replaceChildren(...nodes);

  $("empty").hidden = list.length > 0;
  if (!list.length) {
    const q = state.search.trim();
    $("empty-title").textContent = q
      ? "没有找到结果"
      : state.items.length
        ? "这里还没有内容"
        : "还没有下载任务";
    $("empty-text").textContent = q
      ? `没有与“${q}”匹配的下载任务。`
      : state.items.length
        ? "此视图中的下载任务会显示在这里。"
        : "粘贴链接、将链接拖到此窗口，或在浏览器中开始下载。";
    $("empty-actions").hidden = !!q || state.items.length > 0;
  }
  return list;
}

// ---------- inspector ----------
let insKey: string | null = null;
function renderInspector() {
  const panel = $("inspector");
  const it = byId(state.selected);
  if (!it) {
    panel.hidden = true;
    insKey = null;
    return;
  }
  panel.hidden = false;
  const key = `${it.id}:${it.status}`;
  const dl = it.status === "downloading";
  if (insKey !== key) {
    insKey = key;
    panel.innerHTML = `<div class="ins-scroll">
        <div class="ins-top"><span class="ins-glyph">${icon(cat(it).icon)}</span><div class="ins-head"><div class="ins-title">${esc(it.filename)}</div><div class="ins-meta" id="ins-chips"></div></div><button class="sq-btn" data-ins="close" title="关闭（Esc）">${icon("x")}</button></div>
        <div class="ins-sec"><div class="ins-sec-head">下载进度<span id="ins-pct"></span></div><div class="segbar" id="ins-bar"></div><dl class="props" id="ins-stats"></dl></div>
        <div class="ins-sec" id="ins-graph-sec"><div class="ins-sec-head">下载速度<span id="ins-peak"></span></div><canvas id="ins-graph"></canvas></div>
        <div class="ins-sec"><div class="ins-sec-head">详细信息</div><dl class="props" id="ins-props"></dl></div>
      </div>
      <div class="ins-foot" id="ins-foot"></div>`;
  }
  const finishing = dl && !!it.size && it.downloaded >= it.size;
  const meta = `<span class="st-${it.status}">${finishing ? "正在完成…" : STATUS[it.status]}</span><span class="trunc">来自 ${esc(host(it.url))}</span>`;
  if ($("ins-chips").innerHTML !== meta) $("ins-chips").innerHTML = meta;

  $("ins-pct").textContent = it.size ? `${Math.floor(pct(it))}%` : "";
  const bar = $("ins-bar");
  bar.className = `segbar ${it.status}`;
  segBar(bar, null, undefined, pct(it));
  const row = (k: string, v: string) =>
    `<dt>${k}</dt><dd><span>${v}</span></dd>`;
  const stats =
    it.status === "completed"
      ? row("文件大小", bytes(it.size)) +
        row("完成时间", when(it.completedAt) || "—") + (it.verified ? row("文件校验", "SHA-256 一致") : "")
      : row(
          "已下载",
          it.size
            ? `${bytes(it.downloaded)} / ${bytes(it.size)}`
            : bytes(it.downloaded),
        ) +
        (dl && !finishing
          ? row("下载速度", speed(it.speed)) + row("剩余时间", dur(eta(it)))
          : "") +
        (dl && it.connections ? row("连接数", String(it.connections)) : "");
  if ($("ins-stats").innerHTML !== stats) $("ins-stats").innerHTML = stats;

  const hist = state.speedHist.get(it.id) || [];
  $("ins-graph-sec").hidden = !hist.some((v: number) => v > 0);
  if (!$("ins-graph-sec").hidden) {
    areaChart($("ins-graph"), hist, { fill: false });
    $("ins-peak").textContent = `峰值 ${speed(Math.max(...hist))}`;
  }

  const dir = it.path.replace(/[\\/][^\\/]*$/, "");
  const props = `
    <dt>保存位置</dt><dd><span class="link" data-ins="folder" title="${esc(it.path)}">${esc(dir)}</span><button class="copy" data-ins="copy-path" title="复制路径">${icon("copy")}</button></dd>
    <dt>来源地址</dt><dd><span title="${esc(it.url)}">${esc(it.url)}</span><button class="copy" data-ins="copy" title="复制链接">${icon("copy")}</button></dd>
    <dt>断点续传</dt><dd><span>${it.resumable ? "支持" : "不支持，服务器未提供此功能"}</span></dd>
    <dt>添加时间</dt><dd><span>${new Date(it.addedAt).toLocaleString("zh-CN", { dateStyle: "medium", timeStyle: "short" })}</span></dd>
    ${it.error ? `<dt>错误信息</dt><dd><span style="color:var(--red)" title="${esc(displayText(it.error))}">${esc(displayText(it.error))}</span></dd>` : ""}`;
  if ($("ins-props").innerHTML !== props) $("ins-props").innerHTML = props;

  const primary =
    it.status === "completed"
      ? `<button class="btn primary" data-ins="open">打开</button>`
      : it.status === "error"
        ? `<button class="btn" data-ins="browser">用浏览器下载</button><button class="btn primary" data-ins="resume">重试</button>`
        : isActive(it)
          ? `<button class="btn" data-ins="pause">暂停</button>`
          : `<button class="btn primary" data-ins="resume">继续</button>`;
  const foot = `<button class="btn" data-ins="folder">在文件夹中显示</button>${primary}<button class="btn icon" data-ins="more" title="更多操作">${icon("more")}</button>`;
  if ($("ins-foot").innerHTML !== foot) $("ins-foot").innerHTML = foot;
}

// ---------- browser integration ----------
let loadedOnce = false;
async function loadIntegration() {
  const before = state.integration?.lastSeen || 0;
  try {
    state.integration = await invoke("integration_status");
  } catch {
    state.integration = null;
  }
  const now = state.integration;
  // The extension checks in as soon as it is added or reloaded: say so at once.
  if (
    now?.lastSeen &&
    now.lastSeen > before &&
    (!before || $("dlg-ext").open)
  ) {
    const who = now.browsers
      .filter((x) => x.lastSeen)
      .sort((x, y) => (y.lastSeen || 0) - (x.lastSeen || 0))[0];
    if ($("dlg-ext").open) $("dlg-ext").close();
    if (loadedOnce) toast(`已在 ${who?.name || "浏览器"} 中连接`, "ok");
  }
  loadedOnce = true;
  renderOnboard();
  if ($("dlg-settings").open) renderBrowserPanel();
}
const installedBrowsers = (): BrowserStatus[] =>
  (state.integration?.browsers || []).filter((b) => b.installed);
function renderOnboard() {
  const card = $("onboard");
  const i = state.integration;
  const show =
    !!i &&
    !i.lastSeen &&
    !state.settings?.onboardingDismissed &&
    installedBrowsers().length > 0;
  card.hidden = !show;
  if (!show || !i) return;
  // Until the extension is on the Chrome Web Store, store buttons would lead
  // to a missing page, so offer the guided manual install instead.
  const actions = i.storeAvailable
    ? installedBrowsers()
        .slice(0, 3)
        .map(
          (b) =>
            `<button class="link-btn" data-store="${b.id}">添加到 ${b.name}</button>`,
        )
        .join("")
    : `<button class="link-btn" data-guide>添加扩展</button>`;
  const html = `<span class="ob-icon">${icon("globe")}</span>
    <span class="ob-text"><b>连接浏览器</b>自动接管下载，并为网页视频添加下载按钮</span>
    <span class="ob-actions">${actions}<button class="sq-btn" data-dismiss title="不再提示">${icon("x")}</button></span>`;
  // innerHTML never reads back identical, so compare with what we wrote last;
  // rebuilding it on every poll replaced the button mid-click.
  if (card.dataset.html !== html) {
    card.innerHTML = html;
    card.dataset.html = html;
  }
}
// One flow for every entry point: the banner, the empty state, the command
// palette and each browser in Settings → Browser.
const EXT_PAGE: Record<string, string> = {
  edge: "edge://extensions",
  brave: "brave://extensions",
  vivaldi: "vivaldi://extensions",
  firefox: "about:debugging",
};
let guidePoll = 0;
async function openExtensionGuide(browserId?: string) {
  const i = state.integration;
  // Firefox has its listing on Firefox Add-ons; Chromium browsers wait for the Chrome Web Store.
  if (browserId === "firefox" || (i?.storeAvailable && browserId))
    return openStore(browserId);
  const dir = await invoke("extension_dir").catch(() => null);
  const ff = browserId === "firefox";
  const path =
    (dir || "%LOCALAPPDATA%\\SwiftDL\\extension") + (ff ? "-firefox" : "");
  $("ext-path").textContent = path;
  $("ext-path").title = path;
  const b = installedBrowsers().find((x) => x.id === browserId);
  $("ext-step1").innerHTML = ff
    ? "Firefox：打开 <code>about:debugging</code>，选择“此 Firefox”，再点击“临时载入附加组件”，选择下方文件夹中的 <code>manifest.json</code>"
    : `在地址栏输入 <code>${EXT_PAGE[browserId || ""] || "chrome://extensions"}</code>${b ? `，或在 ${b.name} 中打开：` : ""}`;
  const choices = b
    ? [b]
    : installedBrowsers().filter((x) => x.id !== "firefox");
  $("ext-browsers").innerHTML = choices
    .map(
      (x) =>
        `<button type="button" class="btn sm" data-open-ext="${x.id}"><img class="blogo sm" src="browsers/${x.id}.svg" alt="">在 ${x.name} 中打开</button>`,
    )
    .join("");
  $("ext-wait").textContent = "正在等待扩展连接…";
  if (!$("dlg-ext").open) $("dlg-ext").showModal();
  if (b) openExtPage(b.id);
  // Check often while the guide is open, so it notices the connection at once.
  clearInterval(guidePoll);
  guidePoll = window.setInterval(() => {
    if (!$("dlg-ext").open) return clearInterval(guidePoll);
    loadIntegration();
  }, 1500);
}
async function openExtPage(id: string) {
  copy($("ext-path").textContent || "", "文件夹路径已复制，请粘贴到选择窗口");
  try {
    await invoke("open_extensions_page", { browser: id });
  } catch (e) {
    toast(esc(displayText(e)), "err");
  }
}
$("ext-browsers").addEventListener("click", (e) => {
  const b = target(e).closest<HTMLElement>("[data-open-ext]");
  if (b) openExtPage(b.dataset.openExt!);
});
$("ext-copy").innerHTML = icon("copy");
$("ext-copy").onclick = () =>
  copy($("ext-path").textContent || "", "文件夹路径已复制");
$("ext-open").onclick = () => call("open_extension_folder");
$("ext-ff-store").onclick = (e) => {
  e.preventDefault();
  openStore("firefox");
};
$("onboard").addEventListener("click", async (e) => {
  if (target(e).closest<HTMLElement>("[data-guide]"))
    return openExtensionGuide();
  const s = target(e).closest<HTMLElement>("[data-store]");
  if (s) return openStore(s.dataset.store!);
  if (target(e).closest<HTMLElement>("[data-dismiss]")) {
    await saveSettings({ ...settings(), onboardingDismissed: true });
    renderOnboard();
  }
});
async function openStore(browser: string) {
  await call("open_store", { browser });
  toast(
    browser === "firefox"
      ? "已打开 Firefox 附加组件页面，请点击“添加到 Firefox”。"
      : "已打开扩展页面，请点击“添加至浏览器”。",
    "ok",
  );
}
function renderBrowserPanel() {
  const i = state.integration;
  if (!i) return;
  const store = i.storeAvailable;
  const hint = "点击下方浏览器旁的“添加”按钮";
  const connected = i.browsers
    .filter((b) => b.lastSeen)
    .sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
  const logo = (b: BrowserStatus, cls = "") =>
    `<img class="blogo ${cls}" src="browsers/${b.id}.svg" alt="" width="28" height="28">`;
  $("ext-status").innerHTML = connected.length
    ? `${logo(connected[0])}<div class="sr-text"><b>已连接 ${connected.map((b) => b.name).join("、")}</b><span>最近活动：${when(connected[0].lastSeen)}</span></div>`
    : `<div class="sr-text"><b>尚未连接</b><span>${hint}</span></div>`;
  const rank = (b: BrowserStatus) => (b.lastSeen ? 2 : b.installed ? 1 : 0);
  $("browser-list").innerHTML = [...i.browsers]
    .sort((a, b) => rank(b) - rank(a))
    .map((b) => {
      const sub = b.lastSeen
        ? `已连接 · 最近活动：${when(b.lastSeen)}`
        : !b.installed
          ? "未安装"
          : store && b.autoOffer
            ? "已安装 · 下次启动时会询问是否启用扩展"
            : "已安装";
      return `<div class="set-row">
      ${logo(b, b.installed || b.lastSeen ? "" : "off")}
      <div class="sr-text"><b>${b.name}</b><span>${sub}</span></div>
      ${!b.lastSeen && b.installed ? `<button type="button" class="btn sm" data-add="${b.id}">添加到 ${b.name}</button>` : ""}</div>`;
    })
    .join("");
  $("ext-saveas").hidden = !connected.length;
  // The automatic offer only works once the extension is on the store.
  ($("set-offer").closest(".set-group") as HTMLElement).hidden = !store;
}
$("set-log").onclick = () => call("open_log");
$("browser-list").addEventListener("click", (e) => {
  const b = target(e).closest<HTMLElement>("[data-add]");
  if (b) openExtensionGuide(b.dataset.add);
});

function render() {
  if (state.selected != null && !byId(state.selected)) state.selected = null;
  const list = renderList();
  renderNav();
  renderHeader(list);
  renderBulk(list);
  renderInspector();
}

// ---------- toasts ----------
type ToastKind = "info" | "ok" | "err" | "dl";
function toast(msg: string, kind: ToastKind = "info") {
  const el = document.createElement("div");
  el.className = "toast";
  const ic =
    kind === "ok"
      ? "check"
      : kind === "err"
        ? "alert"
        : kind === "dl"
          ? "download"
          : "info";
  el.innerHTML = `<span class="t-ic ${kind}">${icon(ic)}</span><span>${msg}</span>`;
  $("toasts").append(el);
  setTimeout(() => {
    el.classList.add("out");
    setTimeout(() => el.remove(), 200);
  }, 2800);
  while ($("toasts").children.length > 3)
    $("toasts").firstElementChild?.remove();
}
/** invoke(), with any error shown as a toast. */
async function call<K extends keyof Commands>(
  cmd: K,
  ...args: Commands[K][0] extends void ? [] : [Commands[K][0]]
): Promise<Commands[K][1]> {
  try {
    return await invoke(cmd, ...args);
  } catch (e) {
    toast(esc(displayText(e)), "err");
    throw e;
  }
}

// ---------- actions ----------
const resume = (ids: number[]) => {
  if (ids.length) call("resume", { ids });
};
const pause = (ids: number[]) => {
  if (ids.length) call("pause", { ids });
};
const copy = (text: string, msg: string) =>
  navigator.clipboard.writeText(text).then(() => toast(msg, "ok"));
function toggle(it: Item | null | undefined) {
  if (!it || it.status === "completed") return;
  if (isActive(it)) pause([it.id]);
  else resume([it.id]);
}
function askDelete(it: Item | null | undefined) {
  if (!it) return;
  const dlg = $("dlg-delete");
  const label = $("del-files-row").querySelector("span");
  if (label) label.textContent = "同时删除磁盘上的文件";
  const live = it.status !== "completed";
  $("del-title").textContent = live ? "取消此下载？" : "从列表中移除？";
  $("del-text").textContent = live
    ? `“${it.filename}”将停止下载，已下载的临时数据也会被删除。`
    : `“${it.filename}”将从 BaaDash 列表中移除。`;
  $("del-ok").textContent = live ? "取消下载" : "移除";
  $("del-files").checked = false;
  $("del-files-row").hidden = live;
  dlg.returnValue = "";
  dlg.onclose = () => {
    if (dlg.returnValue !== "ok") return;
    call("remove", { ids: [it.id], deleteFiles: $("del-files").checked });
    toast(live ? "已取消下载" : "已从列表中移除", "ok");
  };
  dlg.showModal();
}
function act(name: string, it: Item | null | undefined, anchor?: HTMLElement) {
  if (!it) return;
  switch (name) {
    case "open":
      return void call("open_file", { id: it.id });
    case "folder":
      return void call("open_folder", { id: it.id });
    case "pause":
      return pause([it.id]);
    case "resume":
      return resume([it.id]);
    case "browser":
      return void invoke("open_url", {url: it.url.split("#")[0] + "#swiftdl-browser"});
    case "copy":
      return void copy(it.url, "链接已复制");
    case "copy-path":
      return void copy(it.path, "路径已复制");
    case "delete":
      return askDelete(it);
    case "more": {
      const r = anchor!.getBoundingClientRect();
      return itemMenu(it, r.right - 220, r.top - 8, true);
    }
  }
}
function select(id: number | null, scroll = true) {
  state.selected = id;
  render();
  if (scroll && id != null)
    rowEls.get(id)?.scrollIntoView({ block: "nearest" });
}
function move(d: number) {
  const ids = orderIds();
  if (!ids.length) return;
  const i = state.selected == null ? -1 : ids.indexOf(state.selected);
  select(
    ids[
      i < 0
        ? d > 0
          ? 0
          : ids.length - 1
        : Math.max(0, Math.min(ids.length - 1, i + d))
    ],
  );
}

// ---------- menus ----------
interface MenuEntry {
  label: string;
  icon?: string;
  keys?: string[];
  enabled?: boolean;
  danger?: boolean;
  checked?: boolean;
  dot?: string;
  run: () => void;
}
type MenuLine = MenuEntry | "-" | { title: string };
function showMenu(x: number, y: number, entries: MenuLine[], above = false) {
  const menu = $("menu");
  menu.innerHTML = entries
    .map((e, i) =>
      e === "-"
        ? `<div class="msep"></div>`
        : "title" in e
          ? `<div class="mtitle">${e.title}</div>`
          : `<button data-i="${i}" class="${e.danger ? "danger" : ""}" ${e.enabled === false ? "disabled" : ""}>${e.icon ? icon(e.icon) : e.dot ? `<span class="ni-dot" style="background:${e.dot};margin:0 3px"></span>` : ""}<span>${e.label}</span>${e.checked ? `<span class="mcheck">${icon("check")}</span>` : e.keys ? `<span class="mh">${e.keys.map((k) => `<kbd>${k}</kbd>`).join("")}</span>` : ""}</button>`,
    )
    .join("");
  menu.onclick = (ev) => {
    const b = target(ev).closest<HTMLElement>("button[data-i]");
    if (b) {
      menu.hidden = true;
      (entries[Number(b.dataset.i)] as MenuEntry).run();
    }
  };
  menu.hidden = false;
  const r = menu.getBoundingClientRect();
  if (above) y = y - r.height;
  menu.style.left = `${Math.max(8, Math.min(x, innerWidth - r.width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(y, innerHeight - r.height - 8))}px`;
}
async function replaceLink(it: Item) {
    const url = await navigator.clipboard.readText().catch(() => "");
    await call("replace_url", { id: it.id, url: url.trim() });
}
function itemMenu(it: Item, x: number, y: number, above = false) {
  showMenu(
    x,
    y,
    [
      { icon: "play", label: "下一个下载", enabled: it.status === "queued", run: () => void call("download_next", {id: it.id}) },
      { icon: "link", label: "从剪贴板替换失效链接", enabled: ["paused", "error"].includes(it.status) && !it.format && !it.torrentFiles, run: () => void replaceLink(it) },
      { icon: "link", label: "用浏览器下载", enabled: it.status === "error", run: () => void invoke("open_url", {url: it.url.split("#")[0] + "#swiftdl-browser"}) },
      {
        icon: "open",
        label: "打开",
        keys: ["Enter"],
        enabled: it.status === "completed",
        run: () => act("open", it),
      },
      {
        icon: "folder",
        label: "在文件夹中显示",
        keys: ["O"],
        run: () => act("folder", it),
      },
      "-",
      isActive(it)
        ? {
            icon: "pause",
            label: "暂停",
            keys: ["Space"],
            run: () => pause([it.id]),
          }
        : {
            icon: it.status === "error" ? "retry" : "play",
            label: it.status === "error" ? "重试" : "继续",
            keys: ["Space"],
            enabled: it.status !== "completed",
            run: () => resume([it.id]),
          },
      {
        icon: "link",
        label: "复制链接",
        keys: ["C"],
        run: () => act("copy", it),
      },
      "-",
      {
        icon: "trash",
        label: it.status === "completed" ? "移除…" : "取消下载…",
        keys: ["Del"],
        danger: true,
        run: () => askDelete(it),
      },
    ],
    above,
  );
}
document.addEventListener("mousedown", (e) => {
  if (
    !target(e).closest<HTMLElement>("#menu") &&
    !target(e).closest<HTMLElement>("#limit-btn") &&
    !target(e).closest<HTMLElement>("[data-ins=more]")
  )
    $("menu").hidden = true;
});
document.addEventListener("contextmenu", (e) => {
  if (!target(e).closest<HTMLElement>("input")) e.preventDefault();
});

// ---------- events ----------
// Double-click is read from mousedown's click count: a live row's details
// are replaced every half second, and "dblclick" doesn't fire when the
// element under the first click is gone by the second.
$("rows").addEventListener("mousedown", (e) => {
  const r = target(e).closest<HTMLElement>(".row"),
    it = r ? byId(Number(r.dataset.id)) : undefined;
  if (!it || e.button !== 0) return;
  if (bulkMode || e.ctrlKey || e.metaKey || e.shiftKey) {
    bulkMode = true;
    const ids = visible().map((i) => i.id);
    if (e.shiftKey && bulkAnchor !== null && ids.includes(bulkAnchor)) {
      const a = ids.indexOf(bulkAnchor),
        b = ids.indexOf(it.id);
      for (const id of ids.slice(Math.min(a, b), Math.max(a, b) + 1))
        bulkIds.add(id);
    } else {
      if (bulkIds.has(it.id)) bulkIds.delete(it.id);
      else bulkIds.add(it.id);
      bulkAnchor = it.id;
    }
    e.preventDefault();
    render();
    return;
  }
  if (e.detail === 2) {
    if (it.status === "completed") act("open", it);
    else toggle(it);
    return;
  }
  select(it.id, false);
});
$("rows").addEventListener("contextmenu", (e) => {
  const r = target(e).closest<HTMLElement>(".row");
  const it = r ? byId(Number(r.dataset.id)) : undefined;
  if (it) {
    e.preventDefault();
    itemMenu(it, e.clientX, e.clientY);
  }
});
$("list").addEventListener("mousedown", (e) => {
  if (
    !target(e).closest<HTMLElement>(".row") &&
    !target(e).closest<HTMLElement>(".ghead") &&
    !target(e).closest<HTMLElement>(".empty") &&
    state.selected != null
  ) {
    state.selected = null;
    render();
  }
});
$("inspector").addEventListener("click", (e) => {
  const b = target(e).closest<HTMLElement>("[data-ins]");
  if (!b) return;
  if (b.dataset.ins === "close") {
    state.selected = null;
    render();
    return;
  }
  act(b.dataset.ins!, byId(state.selected), b);
});
$("nav").addEventListener("click", (e) => {
  if (target(e).closest<HTMLElement>("[data-toggle]")) {
    state.typesOpen = !state.typesOpen;
    render();
    return;
  }
  const b = target(e).closest<HTMLElement>("[data-view]");
  if (b) {
    bulkIds.clear();
    bulkAnchor = null;
    state.view = b.dataset.view!;
    state.search = "";
    render();
  }
});
$("btn-pause-all").onclick = () =>
  pause(
    visible()
      .filter(isActive)
      .map((i) => i.id),
  );
$("btn-resume-all").onclick = () =>
  resume(
    visible()
      .filter((i: Item) => i.status === "paused" || i.status === "error")
      .map((i) => i.id),
  );
$("btn-add").onclick = $("empty-add").onclick = () => openComposer();
$("btn-palette").onclick = $("btn-search").onclick = () => openPalette();
$("btn-settings").onclick = () => openSettings();
$("empty-ext").onclick = () => openExtensionGuide();
$("w-min").onclick = () => appWindow?.minimize();
$("w-max").onclick = () => appWindow?.toggleMaximize();
$("w-close").onclick = () => appWindow?.close();
if (!appWindow) $("win-ctrls").hidden = true;

async function setLimit(k: number) {
  await saveSettings({ ...settings(), speedLimitKib: k });
  toast(k ? `下载速度已限制为 ${bytes(k * 1024)}/s` : "已取消下载限速", "ok");
}
const limitEntries = (): MenuLine[] => [
  { title: "下载限速" },
  ...LIMITS.map((k): MenuEntry => ({
    label: k ? `${bytes(k * 1024)}/s` : "不限速",
    checked: k === settings().speedLimitKib,
    run: () => setLimit(k),
  })),
  "-",
  { icon: "sliders", label: "自定义…", run: () => openSettings("downloads") },
];
$("limit-btn").onclick = (e) => {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
  showMenu(r.left, r.top - 6, limitEntries(), true);
};

document.addEventListener("keydown", (e) => {
  const mod = e.ctrlKey || e.metaKey,
    k = e.key;
  if (mod && k.toLowerCase() === "k") {
    e.preventDefault();
    if (!$("dlg-palette").open) openPalette();
    return;
  }
  if (document.querySelector("dialog[open]") || target(e).matches?.("input"))
    return;
  const it = byId(state.selected);
  if (mod && k.toLowerCase() === "a") {
    e.preventDefault();
    bulkMode = true;
    visible().forEach((i) => bulkIds.add(i.id));
    render();
  } else if (bulkMode && k === "Escape") {
    bulkMode = false;
    bulkIds.clear();
    render();
  } else if (bulkMode && (k === "Delete" || k === "Backspace")) {
    e.preventDefault();
    askBulk([...bulkIds]);
  } else if (mod && k.toLowerCase() === "n") {
    e.preventDefault();
    openComposer();
  } else if (mod && k === ",") {
    e.preventDefault();
    openSettings();
  } else if (mod) return;
  else if (k === "ArrowDown" || k === "j") {
    e.preventDefault();
    move(1);
  } else if (k === "ArrowUp" || k === "k") {
    e.preventDefault();
    move(-1);
  } else if (k === " ") {
    e.preventDefault();
    toggle(it);
  } else if (k === "Enter" && it) {
    e.preventDefault();
    if (it.status === "completed") act("open", it);
    else toggle(it);
  } else if ((k === "Delete" || k === "Backspace") && it) {
    e.preventDefault();
    askDelete(it);
  } else if (k === "o" && it) act("folder", it);
  else if (k === "c" && it) act("copy", it);
  else if (k === "n") openComposer();
  else if (k === "/") {
    e.preventDefault();
    openPalette();
  } else if (k === "Escape") {
    state.selected = null;
    render();
  }
});

function openPastedText(text: string | null | undefined) {
  const links = extractLinks(text);
  if (!links.length) return;
  const webLinks = links.filter((url) => /^https?:\/\//i.test(url));
  if (webLinks.length > 1) openBatch(text || "");
  else openComposer({ url: links[0] });
}
document.addEventListener("paste", (e) => {
  if (
    document.querySelector("dialog[open]") ||
    target(e).matches?.("input,textarea")
  )
    return;
  openPastedText(e.clipboardData?.getData("text"));
});
let drag = 0;
document.addEventListener("dragenter", (e) => {
  if (
    [...(e.dataTransfer?.types || [])].some(
      (t) => t === "text/uri-list" || t === "text/plain",
    )
  ) {
    drag++;
    $("drop").hidden = false;
  }
});
document.addEventListener("dragleave", () => {
  if (--drag <= 0) {
    drag = 0;
    $("drop").hidden = true;
  }
});
document.addEventListener("dragover", (e) => e.preventDefault());
document.addEventListener("drop", (e) => {
  e.preventDefault();
  drag = 0;
  $("drop").hidden = true;
  openPastedText(
    e.dataTransfer?.getData("text/uri-list") ||
      e.dataTransfer?.getData("text/plain"),
  );
});

// ---------- command palette ----------
interface PalItem {
  label: string;
  icon?: string;
  type?: string;
  status?: Item;
  sub?: string;
  keys?: string[];
  run: () => void;
}
type PalLine = PalItem | { title: string };
const pal: { items: PalLine[]; sel: number } = { items: [], sel: 0 };
const selectable = () => pal.items.filter((i): i is PalItem => !("title" in i));
function paletteItems(q: string): PalLine[] {
  q = q.trim().toLowerCase();
  const match = (s: string) => !q || s.toLowerCase().includes(q);
  const out: PalLine[] = [];
  const actions: PalItem[] = [
    {
      icon: "plus",
      label: "新建下载",
      keys: ["Ctrl", "N"],
      run: () => openComposer(),
    },
    {
      icon: "clipboard",
      label: "批量导入链接或分享文本",
      run: () => openBatch(),
    },
    {
      icon: "pause",
      label: "暂停全部下载",
      run: () => pause(state.items.filter(isActive).map((i) => i.id)),
    },
    {
      icon: "play",
      label: "继续全部下载",
      run: () =>
        resume(
          state.items
            .filter((i) => i.status === "paused" || i.status === "error")
            .map((i) => i.id),
        ),
    },
    ...LIMITS.map((k): PalItem => ({
      icon: "gauge",
      label: k ? `限速为 ${bytes(k * 1024)}/s` : "取消下载限速",
      run: () => setLimit(k),
    })),
    {
      icon: "settings",
      label: "打开设置",
      keys: ["Ctrl", ","],
      run: () => openSettings(),
    },
    { icon: "globe", label: "设置浏览器扩展", run: () => openExtensionGuide() },
  ].filter((a) => match(a.label));
  const views: PalItem[] = [
    ...Object.entries(VIEWS).map(([k, v]): PalItem => ({
      icon: v.icon,
      label: `前往${v.name}`,
      run: () => {
        state.view = k;
        render();
      },
    })),
    ...Object.keys(CATS).map((c): PalItem => ({
      type: c,
      label: `前往${categoryLabel(c)}`,
      run: () => {
        state.view = c;
        render();
      },
    })),
  ].filter((a) => match(a.label));
  const dls = state.items
    .filter(
      (i) =>
        q &&
        (i.filename.toLowerCase().includes(q) ||
          i.url.toLowerCase().includes(q)),
    )
    .slice(0, 8)
    .map((i): PalItem => ({
      status: i,
      label: i.filename,
      sub: STATUS[i.status],
      run: () => {
        state.view = "all";
        select(i.id);
      },
    }));
  if (dls.length) out.push({ title: "下载任务" }, ...dls);
  if (actions.length) out.push({ title: "操作" }, ...actions);
  if (views.length && q) out.push({ title: "导航" }, ...views);
  else if (!q) out.push({ title: "导航" }, ...views.slice(0, 4));
  return out;
}
function renderPalette() {
  const q = $("pal-q").value;
  pal.items = paletteItems(q);
  const sel = selectable();
  pal.sel = Math.min(pal.sel, Math.max(0, sel.length - 1));
  let n = -1;
  $("pal-list").innerHTML = sel.length
    ? pal.items
        .map((i) => {
          if ("title" in i) return `<div class="pal-sec">${i.title}</div>`;
          n++;
          const ic = i.status
            ? statusIcon(i.status)
            : i.type
              ? typeIcon(i.type)
              : icon(i.icon || "file");
          return `<button class="pal-item ${n === pal.sel ? "on" : ""}" data-n="${n}"><span class="pi-ic">${ic}</span><span class="pi-label">${esc(i.label)}${i.sub ? `<span class="pi-sub">${i.sub}</span>` : ""}</span>${i.keys ? `<span class="pi-right">${i.keys.map((k) => `<kbd>${k}</kbd>`).join("")}</span>` : ""}</button>`;
        })
        .join("")
    : `<div class="pal-empty">没有找到与“${esc(q)}”相关的结果</div>`;
  $("pal-list")
    .querySelector(".pal-item.on")
    ?.scrollIntoView({ block: "nearest" });
}
function openPalette() {
  pal.sel = 0;
  $("pal-q").value = "";
  renderPalette();
  $("dlg-palette").showModal();
  $("pal-q").focus();
}
function runPalette(n: number) {
  const item = selectable()[n];
  if (!item) return;
  $("dlg-palette").close();
  item.run();
}
$("pal-q").addEventListener("input", () => {
  pal.sel = 0;
  renderPalette();
});
$("pal-q").addEventListener("keydown", (e) => {
  const count = selectable().length;
  if (e.key === "ArrowDown") {
    e.preventDefault();
    pal.sel = (pal.sel + 1) % Math.max(1, count);
    renderPalette();
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    pal.sel = (pal.sel - 1 + count) % Math.max(1, count);
    renderPalette();
  } else if (e.key === "Enter") {
    e.preventDefault();
    runPalette(pal.sel);
  }
});
$("pal-list").addEventListener("mousemove", (e) => {
  const b = target(e).closest<HTMLElement>(".pal-item");
  if (b && Number(b.dataset.n) !== pal.sel) {
    pal.sel = Number(b.dataset.n);
    $("pal-list")
      .querySelectorAll(".pal-item")
      .forEach((x) => x.classList.toggle("on", x === b));
  }
});
$("pal-list").addEventListener("click", (e) => {
  const b = target(e).closest<HTMLElement>(".pal-item");
  if (b) runPalette(Number(b.dataset.n));
});
$("dlg-palette").addEventListener("click", (e) => {
  if (e.target === $("dlg-palette")) $("dlg-palette").close();
});

// ---------- batch import (links and Chinese app share text) ----------
let batchBusy = false;
const batchLinks = () =>
  extractLinks($("batch-text").value).filter((url) =>
    /^https?:\/\//i.test(url),
  );
function renderBatch() {
  const urls = batchLinks();
  const hasText = !!$("batch-text").value.trim();
  $("batch-start").disabled = $("batch-later").disabled =
    batchBusy || !urls.length;
  $("batch-paste").disabled = batchBusy;
  $("batch-state").classList.toggle("err", hasText && !urls.length);
  $("batch-state").textContent = urls.length
    ? `已识别 ${urls.length} 个不同的 HTTP／HTTPS 链接。`
    : hasText
      ? "没有识别到 HTTP／HTTPS 链接，请检查分享文本。"
      : "支持混合文字、多个链接和自动去重。";
  $("batch-list").innerHTML =
    urls
      .slice(0, 4)
      .map(
        (url) =>
          `<div class="batch-link">${icon("link")}<span title="${esc(url)}">${esc(url)}</span></div>`,
      )
      .join("") +
    (urls.length > 4
      ? `<div class="batch-more">以及另外 ${urls.length - 4} 个链接…</div>`
      : "");
}
function openBatch(text = "") {
  const dlg = $("dlg-batch");
  if (dlg.open) return;
  if ($("dlg-add").open) $("dlg-add").close();
  batchBusy = false;
  $("batch-text").value = text;
  renderBatch();
  dlg.showModal();
  $("batch-text").focus();
  if (!text)
    navigator.clipboard
      ?.readText?.()
      .then((clip) => {
        if (clip && !$("batch-text").value) {
          $("batch-text").value = clip;
          renderBatch();
        }
      })
      .catch(() => {});
}
async function submitBatch(start: boolean) {
  const urls = batchLinks();
  if (batchBusy || !urls.length) return;
  batchBusy = true;
  renderBatch();
  let added = 0,
    failed = 0,
    lastId: number | null = null;
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    $("batch-state").textContent =
      `正在检查第 ${i + 1}／${urls.length} 个链接…`;
    try {
      const special =
        (await invoke("is_media_url", { url }).catch(() => false)) ||
        (await invoke("is_torrent_url", { url, filename: null }).catch(
          () => false,
        ));
      if (special) throw new Error("视频或种子需要单独选择格式");
      const info = await invoke("probe_url", { url, headers: [] });
      lastId = await call("add_download", {
        req: {
          url,
          filename: cleanFilename(info.filename),
          dir: info.dir || settings().downloadDir,
          headers: [],
          start,
        },
      });
      added++;
    } catch (error) {
      failed++;
      console.warn("批量导入失败", url, error);
    }
  }
  batchBusy = false;
  renderBatch();
  if (added) {
    $("dlg-batch").close();
    state.view = "all";
    if (lastId !== null) select(lastId);
    toast(
      `${start ? "已开始" : "已添加"} ${added} 个下载${failed ? `，${failed} 个链接未能导入` : ""}`,
      failed ? "info" : "ok",
    );
  } else {
    $("batch-state").classList.add("err");
    $("batch-state").textContent =
      "没有链接成功导入。视频或种子请逐个添加，普通链接请检查是否有效。";
  }
}
$("batch-text").addEventListener("input", () => {
  if (!batchBusy) renderBatch();
});
$("batch-paste").onclick = async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (!extractLinks(text).length) return toast("剪贴板中没有可导入的链接");
    $("batch-text").value = text;
    renderBatch();
  } catch {
    toast("无法读取剪贴板", "err");
  }
};
$("batch-x").onclick = () => {
  if (!batchBusy) $("dlg-batch").close();
};
$("batch-later").onclick = () => submitBatch(false);
$("form-batch").addEventListener("submit", (e) => {
  e.preventDefault();
  submitBatch(true);
});
$("dlg-batch").addEventListener("close", () => setTimeout(nextPending, 150));

// ---------- composer (new download) ----------
const add: {
  headers: Header[];
  seq: number;
  timer: number;
  dirTouched: boolean;
  dir: string;
  info: ProbeInfo | null;
  suggest: string;
} = {
  headers: [],
  seq: 0,
  timer: 0,
  dirTouched: false,
  dir: "",
  info: null,
  suggest: "",
};
interface ComposerInput {
  url: string;
  headers?: Header[];
  filename?: string | null;
}
function openComposer(incoming?: ComposerInput) {
  const dlg = $("dlg-add");
  if (dlg.open) return;
  add.headers = incoming?.headers || [];
  add.suggest = incoming?.filename || "";
  add.dirTouched = false;
  add.info = null;
  add.dir = state.settings?.downloadDir || "";
  $("add-url").value = incoming?.url || "";
  $("add-file").hidden = true;
  renderChips();
  setState("idle");
  dlg.showModal();
  $("add-url").focus();
  if (incoming?.url) probe();
  else
    readClip().then((u) => {
      if (u && !$("add-url").value) {
        $("add-url").value = u;
        $("add-url").select();
        probe();
      }
    });
}
const readClip = (): Promise<string | undefined> =>
  (navigator.clipboard?.readText?.() || Promise.resolve(""))
    .then(firstUrl)
    .catch(() => undefined);
function setState(kind: "idle" | "loading" | "error" | "done", msg = "") {
  $("add-advanced-host").hidden = kind !== "done";
  if (kind !== "done") resetTaskAdvanced("add");
  const el = $("add-state");
  el.className = `comp-state ${kind === "error" ? "err" : ""}`;
  el.innerHTML =
    kind === "loading"
      ? `<span class="spinner"></span>正在获取文件信息…`
      : kind === "error"
        ? `${icon("alert")}${esc(msg)}`
        : kind === "idle"
          ? `BaaDash 会在下载前检查文件名和大小。`
          : "";
  el.hidden = kind === "done";
  $("add-start").disabled = $("add-later").disabled = kind !== "done";
}
function renderChips() {
  const i = add.info;
  const folder =
    add.dir.split(/[\\/]/).filter(Boolean).slice(-2).join(" / ") || add.dir;
  $("add-chips").innerHTML = i
    ? [
        `<span class="chip">${icon("hash")}<span>${i.size != null ? bytes(i.size) : "大小未知"}</span></span>`,
        `<span class="chip"><i class="dot" style="background:${(CATS[i.category] || CATS.Other).color}"></i><span>${categoryLabel(i.category)}</span></span>`,
        i.resumable
          ? `<span class="chip ok">${icon("bolt")}<span>${state.settings?.connections || 8} 个连接</span></span>`
          : `<span class="chip warn">${icon("info")}<span>单连接 · 不支持续传</span></span>`,
        `<button type="button" class="chip" id="add-folder" title="${esc(add.dir)}">${icon("folder")}<span>${esc(folder)}</span>${icon("chevDown")}</button>`,
      ].join("")
    : "";
}
async function probe() {
  const raw = $("add-url").value.trim();
  const url = firstUrl(raw) || raw;
  if (url !== raw) $("add-url").value = url;
  if (!/^(https?:\/\/|magnet:\?)\S+/i.test(url)) {
    add.info = null;
    $("add-file").hidden = true;
    renderChips();
    if (url)
      setState("error", "请粘贴网页链接（http:// 或 https://）或磁力链接");
    else setState("idle");
    return;
  }
  const seq = ++add.seq;
  // Video sites need a quality and torrents a file choice: their own window.
  const special =
    (await invoke("is_media_url", { url }).catch(() => false)) ||
    (await invoke("is_torrent_url", { url, filename: null }).catch(
      () => false,
    ));
  if (special) {
    $("dlg-add").close();
    invoke("open_new_download", { url });
    return;
  }
  setState("loading");
  try {
    const info = await invoke("probe_url", { url, headers: add.headers });
    if (seq !== add.seq) return;
    add.info = info;
    if (!add.dirTouched) add.dir = info.dir;
    // A name from the extension (e.g. the video page's title) beats a
    // generic server name like "videoplayback".
    $("add-filename").value = cleanFilename(
      /\.[a-z0-9]{2,5}$/i.test(add.suggest) ? add.suggest : info.filename,
    );
    $("add-tile").innerHTML = ftile(info);
    $("add-sub").textContent = host(url);
    $("add-file").hidden = false;
    renderChips();
    setState("done");
  } catch (e) {
    if (seq !== add.seq) return;
    add.info = null;
    $("add-file").hidden = true;
    renderChips();
    setState("error", `无法访问此链接：${displayText(e)}`);
  }
}
$("add-url").addEventListener("input", () => {
  clearTimeout(add.timer);
  add.timer = window.setTimeout(probe, 400);
});
$("add-url").addEventListener("paste", (e) => {
  const text = e.clipboardData?.getData("text") || "";
  const links = extractLinks(text);
  if (links.filter((url) => /^https?:\/\//i.test(url)).length > 1) {
    e.preventDefault();
    $("dlg-add").close();
    openBatch(text);
  } else if (links.length && text.trim() !== links[0]) {
    e.preventDefault();
    $("add-url").value = links[0];
    probe();
  }
});
$("add-chips").addEventListener("click", async (e) => {
  if (!target(e).closest<HTMLElement>("#add-folder")) return;
  const dir = await call("pick_folder", { start: add.dir || null });
  if (dir) {
    add.dir = dir;
    add.dirTouched = true;
    renderChips();
  }
});
$("add-paste").onclick = async () => {
  try {
    const text = await navigator.clipboard.readText();
    const links = extractLinks(text);
    if (!links.length) return toast("剪贴板中没有链接");
    if (links.filter((url) => /^https?:\/\//i.test(url)).length > 1) {
      $("dlg-add").close();
      openBatch(text);
    } else {
      $("add-url").value = links[0];
      probe();
    }
  } catch {
    toast("无法读取剪贴板", "err");
  }
};
$("add-batch").onclick = () => openBatch();
$("add-x").onclick = () => $("dlg-add").close();
$("add-later").onclick = () => submitAdd(false);
$("form-add").addEventListener("submit", (e) => {
  e.preventDefault();
  if (!$("add-start").disabled) submitAdd(true);
});
$("dlg-add").addEventListener("keydown", (e) => {
  if (
    (e.ctrlKey || e.metaKey) &&
    e.key === "Enter" &&
    !$("add-start").disabled
  ) {
    e.preventDefault();
    submitAdd(true);
  }
});
$("dlg-add").addEventListener("close", () => {
  add.seq++;
  setTimeout(nextPending, 150);
});
async function submitAdd(start: boolean) {
  const filename = cleanFilename($("add-filename").value);
  if (!filename) return;
  const checksum = readTaskChecksum("add");
  if (checksum === undefined) return;
  const id = await call("add_download", {
    req: {
      url: $("add-url").value.trim(),
      filename,
      checksum,
      dir: add.dir || settings().downloadDir,
      headers: add.headers,
      start,
    },
  });
  $("dlg-add").close();
  if (state.view !== "all" && state.view !== "active") state.view = "all";
  select(id);
  toast(
    start ? `正在下载 ${esc(filename)}` : `${esc(filename)} 已添加为稍后下载`,
    start ? "dl" : "ok",
  );
}
function nextPending() {
  if ($("dlg-add").open || $("dlg-batch").open) return;
  const inc = state.pending.shift();
  if (!inc) return;
  const headers: Header[] = [];
  if (inc.cookies) headers.push(["Cookie", inc.cookies]);
  if (inc.referrer) headers.push(["Referer", inc.referrer]);
  if (inc.userAgent) headers.push(["User-Agent", inc.userAgent]);
  openComposer({ url: inc.url, headers, filename: inc.filename });
}

// ---------- settings ----------
let setDir = "",
  setLimitKib = 0,
  setThemeChoice = "system",
  setSeed = "stop";
function renderSeed() {
  $("set-seed")
    .querySelectorAll<HTMLElement>("[data-v]")
    .forEach((b) => b.classList.toggle("on", b.dataset.v === setSeed));
}
$("set-seed").addEventListener("click", (e) => {
  const b = target(e).closest<HTMLElement>("[data-v]");
  if (b) {
    setSeed = b.dataset.v!;
    renderSeed();
  }
});
function renderThemeChoice() {
  $("set-theme")
    .querySelectorAll<HTMLElement>("[data-v]")
    .forEach((b) => b.classList.toggle("on", b.dataset.v === setThemeChoice));
}
// Picking a theme previews it at once; Cancel puts the saved one back.
$("set-theme").addEventListener("click", (e) => {
  const b = target(e).closest<HTMLElement>("[data-v]");
  if (!b) return;
  setThemeChoice = b.dataset.v!;
  renderThemeChoice();
  window.setTheme(setThemeChoice);
});
const restoreTheme = () => window.setTheme(settings().theme);
$("dlg-settings").addEventListener("cancel", restoreTheme); // Escape
$("dlg-settings").addEventListener("close", restoreTheme);
function openSettings(tab = "general") {
  const s = settings();
  setThemeChoice = s.theme || "system";
  renderThemeChoice();
  setSeed = s.seedUntil || "stop";
  renderSeed();
  setDir = s.downloadDir;
  $("set-dir").textContent = setDir;
  $("set-sort").checked = s.sortIntoCategories;
  $("set-ask").checked = s.askBeforeDownload;
  $("set-notify").checked = s.notifyOnComplete;
  $("set-offer").checked = s.offerExtension;
  $("set-progress-win").checked = s.showProgressWindow;
  $("set-tray").checked = s.closeToTray;
  loadIntegration();
  $("set-proxy").value = s.proxy || "";
  $("set-proxy-mode").value = s.proxy ? "manual" : "system";
  $("proxy-fields").hidden = !s.proxy;
  ($("network-advanced") as unknown as HTMLDetailsElement).open = !!s.bindAddress;
  $("set-schedule-enabled").checked = !!s.startAt;
  $("schedule-fields").hidden = !s.startAt;
  $("set-bind").value = s.bindAddress || "";
  $("set-scale").value = String(s.interfaceScale || 100);
  $("scale-value").textContent = (s.interfaceScale || 100) + "%";
  $("set-scale").style.setProperty("--range-progress", ((Number($("set-scale").value)-90)/60*100)+"%");
  $("set-clipboard").checked = !!s.clipboardWatch;
  $("set-finished").value = s.whenFinished || "";
  const date = s.startAt ? new Date(s.startAt) : null;
  $("set-start-at").value = date ? new Date(date.getTime() - date.getTimezoneOffset()*60000).toISOString().slice(0,16) : "";
  $("set-conns").value = String(s.connections);
  $("set-concurrent").value = String(s.maxConcurrent);
  setLimitKib = s.speedLimitKib;
  renderLimits();
  showTab(tab);
  $("dlg-settings").showModal();
}
function renderLimits() {
  $("set-limits").innerHTML = LIMITS.map(
    (k) =>
      `<button type="button" data-k="${k}" class="${k === setLimitKib ? "on" : ""}">${k ? bytes(k * 1024) + "/s" : "关闭"}</button>`,
  ).join("");
  const c = $("set-limit-custom");
  if (document.activeElement !== c)
    c.value = LIMITS.includes(setLimitKib) ? "" : String(setLimitKib);
}
$("set-limits").addEventListener("click", (e) => {
  const b = target(e).closest<HTMLElement>("[data-k]");
  if (b) {
    setLimitKib = Number(b.dataset.k);
    renderLimits();
  }
});
$("set-limit-custom").addEventListener("input", (e) => {
  setLimitKib = Math.max(
    0,
    Number.parseInt($("set-limit-custom").value, 10) || 0,
  );
  renderLimits();
});
function showTab(tab: string) {
  $("set-nav")
    .querySelectorAll<HTMLElement>("[data-tab]")
    .forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
  document
    .querySelectorAll<HTMLElement>("[data-panel]")
    .forEach((p) => (p.hidden = p.dataset.panel !== tab));
  // Nothing to save on these tabs (Browser has a setting only once the store listing exists).
  ($("dlg-settings").querySelector(".set-foot") as HTMLElement).hidden = tab === "about";
}
$("set-nav").addEventListener("click", (e) => {
  const b = target(e).closest<HTMLElement>("[data-tab]");
  if (b) showTab(b.dataset.tab!);
});
document.querySelectorAll<HTMLElement>(".stepper").forEach((st) =>
  st.addEventListener("click", (e) => {
    const b = target(e).closest<HTMLElement>("[data-d]");
    if (!b) return;
    const input = $(st.dataset.for!);
    input.value = String(
      Math.min(
        +input.max,
        Math.max(+input.min, (+input.value || 0) + Number(b.dataset.d)),
      ),
    );
  }),
);
$("set-browse").onclick = async () => {
  const d = await call("pick_folder", { start: setDir || null });
  if (d) {
    setDir = d;
    $("set-dir").textContent = d;
  }
};
$("settings-close").onclick = () => {
  restoreTheme();
  $("dlg-settings").close();
};
$("set-cancel").onclick = () => {
  restoreTheme();
  $("dlg-settings").close();
};
async function saveSettings(s: Settings) {
  await call("set_settings", { settings: s });
  state.settings = s;
  document.documentElement.style.zoom = String((s.interfaceScale || 100) / 100);
  render();
}
$("form-settings").addEventListener("submit", async (e) => {
  e.preventDefault();
  const clamp = (v: string, lo: number, hi: number, d: number) =>
    Math.min(hi, Math.max(lo, Number.parseInt(v, 10) || d));
  if ($("set-proxy-mode").value === "manual" && !$("set-proxy").value.trim()) { showTab("network"); $("set-proxy").focus(); toast("请输入代理地址，或选择跟随系统。", "err"); return; }
  if ($("set-schedule-enabled").checked && !$("set-start-at").value) { showTab("automation"); $("set-start-at").focus(); toast("请选择队列开始时间。", "err"); return; }
  await saveSettings({
    downloadDir: setDir || settings().downloadDir,
    sortIntoCategories: $("set-sort").checked,
    connections: clamp($("set-conns").value, 1, 32, 8),
    maxConcurrent: clamp($("set-concurrent").value, 1, 10, 3),
    speedLimitKib: setLimitKib,
    proxy: $("set-proxy-mode").value === "manual" ? $("set-proxy").value.trim() : "",
    bindAddress: $("set-bind").value.trim(),
    interfaceScale: clamp($("set-scale").value, 90, 150, 100),
    clipboardWatch: $("set-clipboard").checked,
    startAt: $("set-schedule-enabled").checked && $("set-start-at").value ? new Date($("set-start-at").value).getTime() : null,
    whenFinished: $("set-finished").value,
    askBeforeDownload: $("set-ask").checked,
    notifyOnComplete: $("set-notify").checked,
    offerExtension: $("set-offer").checked,
    showProgressWindow: $("set-progress-win").checked,
    closeToTray: $("set-tray").checked,
    onboardingDismissed: settings().onboardingDismissed,
    theme: setThemeChoice,
    seedUntil: setSeed,
  });
  $("dlg-settings").close();
  toast("设置已保存", "ok");
});

// ---------- data ----------
function ingest(items: Item[]) {
  state.items = items;
  let total = 0;
  for (const it of items) {
    if (it.status !== "downloading") continue;
    const h = state.speedHist.get(it.id) || [];
    h.push(it.speed || 0);
    if (h.length > HISTORY) h.shift();
    state.speedHist.set(it.id, h);
    total += it.speed || 0;
  }
  state.totalHist.push(total);
  if (state.totalHist.length > HISTORY) state.totalHist.shift();
  render();
}
// Updates: check a few seconds after start, then twice a day. A dismissed
// version stays quiet; the next one shows again.
let update: UpdateInfo | null = null;
const SKIP_KEY = "swiftdl.skipUpdate";
function renderUpdate(busy = false) {
  const card = $("update");
  let skipped = "";
  try {
    skipped = localStorage.getItem(SKIP_KEY) || "";
  } catch {}
  card.hidden = !update || update.version === skipped;
  if (card.hidden || !update) return;
  const install = update.asset
    ? update.asset.endsWith(".exe")
      ? "安装并重启"
      : "下载更新"
    : "获取更新";
  card.innerHTML = `<span class="ob-icon">${icon("download")}</span>
    <span class="ob-text"><b>BaaDash ${esc(update.version)} 已发布</b>${busy ? "正在下载更新…" : "当前版本 " + esc(state.version)}</span>
    <span class="ob-actions">${busy ? "" : `<button class="link-btn" data-notes>更新内容</button><button class="link-btn" data-install>${install}</button><button class="sq-btn" data-skip title="跳过此版本">${icon("x")}</button>`}</span>`;
}
async function checkUpdate(manual = false) {
  if (manual) {
    $("check-update").disabled = true;
    $("update-status").textContent = "正在检查…";
  }
  try {
    update = await invoke("check_update");
    if (manual) {
      localStorage.removeItem(SKIP_KEY);
      $("update-status").textContent = update
        ? `发现新版本 ${update.version}，关闭设置后可查看更新说明`
        : "已是当前更新渠道的最新版本";
    }
    renderUpdate();
  } catch (e) {
    if (manual) $("update-status").textContent = "检查失败：" + displayText(e);
  } finally {
    if (manual) $("check-update").disabled = false;
  }
}
$("check-update").onclick = () => checkUpdate(true);
$("update").addEventListener("click", async (e) => {
  const b = (e.target as HTMLElement).closest("button");
  if (!b || !update) return;
  if (b.hasAttribute("data-notes")) invoke("open_url", { url: update.page });
  else if (b.hasAttribute("data-skip")) {
    try {
      localStorage.setItem(SKIP_KEY, update.version);
    } catch {}
    renderUpdate();
  } else if (b.hasAttribute("data-install")) {
    renderUpdate(true);
    try {
      await invoke("install_update", { url: update.asset || update.page });
      renderUpdate();
    } catch (err) {
      renderUpdate();
      toast(`更新失败：${displayText(err)}`);
    }
  }
});
async function boot() {
  hydrate();
  const s = await invoke("get_state");
  listen("settings", (e) => { state.settings = e.payload; render(); });
  state.settings = s.settings;
  document.documentElement.style.zoom = String((s.settings.interfaceScale || 100) / 100);
  window.setTheme(s.settings.theme);
  state.pending = s.pending;
  state.version = s.version;
  $("version").textContent = `版本 ${s.version}`;
  ingest(s.items);
  nextPending();
  loadIntegration();
  // Every 2 s until a browser connects, so adding the extension shows up at
  // once; after that a slow check is enough. Also on coming back to the window.
  let tick = 0;
  setInterval(() => {
    if (!state.integration?.lastSeen || ++tick % 8 === 0) loadIntegration();
  }, 2000);
  window.addEventListener("focus", () => loadIntegration());
  setTimeout(() => checkUpdate(), 5000);
  setInterval(() => checkUpdate(), 12 * 60 * 60 * 1000);
  await listen("storage-error", (e) => toast(esc(e.payload), "err"));
  await listen("downloads", (e) => ingest(e.payload));
  await listen("incoming", () =>
    invoke("get_state").then((s) => {
      state.pending.push(...s.pending);
      nextPending();
    }),
  );
  setInterval(() => {
    if (!state.items.some((i) => i.status === "downloading")) {
      state.totalHist.push(0);
      if (state.totalHist.length > HISTORY) state.totalHist.shift();
      areaChart($("net-graph"), state.totalHist);
    }
  }, 500);
  addEventListener("resize", () => render());
}
boot();

// Batch operations never treat active work as disposable history.
function renderBulk(list: Item[]) {
  for (const id of bulkIds)
    if (!list.some((i) => i.id === id)) bulkIds.delete(id);
  $("bulk-bar").hidden = !bulkMode;
  $("btn-select").textContent = bulkMode ? "退出多选" : "多选";
  $("bulk-count").textContent = `已选 ${bulkIds.size} 项`;
  $("bulk-all").checked = list.length > 0 && bulkIds.size === list.length;
  ($("bulk-all") as HTMLInputElement).indeterminate =
    bulkIds.size > 0 && bulkIds.size < list.length;
  const picked = list.filter((i) => bulkIds.has(i.id));
  $("bulk-pause").disabled = !picked.some(isActive);
  $("bulk-resume").disabled = !picked.some((i) =>
    ["paused", "error"].includes(i.status),
  );
  $("bulk-remove").disabled = !picked.length;
  $("btn-history").hidden = state.view === "active";
  $("btn-history").disabled = !list.some((i) =>
    ["completed", "error"].includes(i.status),
  );
}
function exitBulk() {
  bulkMode = false;
  bulkIds.clear();
  bulkAnchor = null;
  render();
}
$("btn-select").onclick = () => {
  if (bulkMode) exitBulk();
  else {
    bulkMode = true;
    render();
  }
};
$("bulk-exit").onclick = exitBulk;
$("bulk-all").onchange = () => {
  bulkIds.clear();
  if ($("bulk-all").checked) visible().forEach((i) => bulkIds.add(i.id));
  render();
};
$("bulk-pause").onclick = () =>
  pause(
    visible()
      .filter((i) => bulkIds.has(i.id) && isActive(i))
      .map((i) => i.id),
  );
$("bulk-resume").onclick = () =>
  resume(
    visible()
      .filter(
        (i) => bulkIds.has(i.id) && ["paused", "error"].includes(i.status),
      )
      .map((i) => i.id),
  );
$("bulk-remove").onclick = () => askBulk([...bulkIds]);
$("btn-history").onclick = () =>
  askBulk(
    visible()
      .filter((i) => ["completed", "error"].includes(i.status))
      .map((i) => i.id),
    true,
  );
function askBulk(ids: number[], historyOnly = false) {
  const picked = state.items.filter((i) => ids.includes(i.id));
  if (!picked.length) return;
  const live = picked.some((i) => !["completed", "error"].includes(i.status));
  const dlg = $("dlg-delete");
  $("del-title").textContent = historyOnly
    ? "清理这些历史记录？"
    : live
      ? "取消并移除所选任务？"
      : "移除所选记录？";
  $("del-text").textContent = live
    ? `将取消 ${picked.length} 个所选任务，未完成的临时数据会被删除。已完成的文件保留。`
    : `将清理 ${picked.length} 条记录。默认保留已下载文件及失败任务的临时数据。`;
  $("del-ok").textContent = live ? "取消并移除" : "清理记录";
  $("del-files-row").hidden = live;
  $("del-files").checked = false;
  const label = $("del-files-row").querySelector("span");
  if (label) label.textContent = "同时删除所选记录的文件及临时数据";
  dlg.returnValue = "";
  dlg.onclose = async () => {
    if (dlg.returnValue !== "ok") return;
    try {
      if (live) await call("remove", { ids, deleteFiles: false });
      else
        await call("clear_history", {
          ids,
          deleteFiles: $("del-files").checked,
          deleteTemp: $("del-files").checked,
        });
      ingest((await invoke("get_state")).items);
      bulkIds.clear();
      render();
      toast("已处理所选记录", "ok");
    } catch {}
  };
  dlg.showModal();
}

$("add-advanced-host").innerHTML = taskAdvanced("add");
bindTaskAdvanced("add");
$("dlg-add").addEventListener("close", () => resetTaskAdvanced("add"));
let lastClipboard = "";
window.addEventListener("focus", async () => {
  if (!settings().clipboardWatch || document.querySelector("dialog[open]")) return;
  const text = await navigator.clipboard.readText().catch(() => "");
  if (text && text !== lastClipboard && extractLinks(text).length) { lastClipboard = text; openBatch(text); }
});

$("set-scale").addEventListener("input", () => { $("set-scale").style.setProperty("--range-progress", ((Number($("set-scale").value)-90)/60*100)+"%"); $("scale-value").textContent = $("set-scale").value + "%"; document.documentElement.style.zoom = String(Math.min(150, Math.max(90, Number($("set-scale").value) || 100))/100); });
$("dlg-settings").addEventListener("close", () => { document.documentElement.style.zoom = String((settings().interfaceScale || 100)/100); });

$("set-proxy-mode").addEventListener("change", () => { $("proxy-fields").hidden = $("set-proxy-mode").value !== "manual"; });
$("set-schedule-enabled").addEventListener("change", () => { $("schedule-fields").hidden = !$("set-schedule-enabled").checked; });
