// Shared page UI policy. Download interception is a separate preference.
(() => {
  if (window.__baadashPrefs) return;
  const defaults = {
    sniffing: true,
    videoButtons: true,
    imageButtons: false,
    imageSites: [],
    disabledSites: [],
  };
  let settings = { ...defaults },
    ready = false;
  const listeners = new Set();
  const host = location.hostname.replace(/^www\./, "");
  const blocked = () => !ready || settings.disabledSites.includes(host);
  const api = {
    get video() {
      return !blocked() && settings.sniffing && settings.videoButtons;
    },
    get images() {
      return (
        !blocked() &&
        (settings.imageButtons || settings.imageSites.includes(host))
      );
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
  window.__baadashPrefs = api;
  chrome.storage.sync.get(defaults).then((s) => {
    settings = { ...defaults, ...s };
    ready = true;
    listeners.forEach((fn) => fn());
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area && area !== "sync") return;
    for (const k of Object.keys(defaults))
      if (changes[k]) settings[k] = changes[k].newValue ?? defaults[k];
    listeners.forEach((fn) => fn());
  });
})();
