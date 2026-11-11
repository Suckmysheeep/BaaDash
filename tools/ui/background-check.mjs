import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";
const listeners = {},
  prefs = { sniffing: false, disabledSites: [] },
  session = { checkedIn: true };
const event = (name) => ({ addListener: (fn) => (listeners[name] = fn) });
const storage = (data) => ({
  get: async (q) =>
    q === null
      ? { ...data }
      : typeof q === "string"
        ? { [q]: data[q] }
        : { ...q, ...data },
  set: async (q) => Object.assign(data, q),
  remove: async (keys) => {
    for (const k of Array.isArray(keys) ? keys : [keys]) delete data[k];
  },
});
const chrome = {
  storage: {
    sync: storage(prefs),
    session: storage(session),
    local: storage({}),
    onChanged: event("storage"),
  },
  tabs: {
    get: async () => ({ url: "https://example.com" }),
    onCreated: event("tabCreated"),
    onUpdated: event("tabUpdated"),
    onRemoved: event("tabRemoved"),
  },
  cookies: { getAll: async () => [] },
  downloads: { onCreated: event("download") },
  webRequest: { onResponseStarted: event("response") },
  runtime: {
    onInstalled: event("installed"),
    onStartup: event("startup"),
    onMessage: event("message"),
  },
  contextMenus: { onClicked: event("menu") },
  action: { setBadgeText() {}, setBadgeBackgroundColor() {} },
};
const file = new URL("../../extension/background.js", import.meta.url);
vm.runInNewContext(fs.readFileSync(file, "utf8"), {
  chrome,
  console,
  URL,
  setTimeout,
  clearTimeout,
  fetch: async () => {
    throw Error("Unexpected network fetch");
  },
  navigator: { userAgent: "test" },
});
const request = {
  tabId: 1,
  statusCode: 200,
  url: "https://example.com/video.mp4",
  responseHeaders: [
    { name: "content-type", value: "video/mp4" },
    { name: "content-length", value: "10000000" },
  ],
};
await listeners.response(request);
assert.equal(session["media:1"], undefined);
prefs.sniffing = true;
await listeners.response(request);
assert.equal(session["media:1"].length, 1);
prefs.sniffing = false;
await listeners.storage({ sniffing: { newValue: false } }, "sync");
assert.equal(session["media:1"], undefined);
prefs.sniffing = true;
prefs.disabledSites = ["example.com"];
await listeners.response(request);
assert.equal(session["media:1"], undefined);
console.log(
  "PASS: background sniffing off stores nothing; enabled stores media; disabling purges old media; disabled site is ignored.",
);
