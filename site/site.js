// Optional release discovery; failure keeps the safe Releases landing URL.
(async () => {
  try {
    const r = await fetch(
      "https://api.github.com/repos/Suckmysheeep/BaaDash/releases/latest",
      { headers: { Accept: "application/vnd.github+json" } },
    );
    if (!r.ok) return;
    const release = await r.json();
    const tests = {
      windows: /-setup\.exe$/i,
      macos: /\.dmg$/i,
      linux: /\.AppImage$/i,
    };
    for (const a of document.querySelectorAll("[data-platform]")) {
      const item = release.assets?.find((f) =>
        tests[a.dataset.platform].test(f.name),
      );
      if (item && new URL(item.browser_download_url).hostname === "github.com")
        a.href = item.browser_download_url;
    }
  } catch {}
})();
