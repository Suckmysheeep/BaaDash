// Light or dark: "system" follows the operating system, "light" and "dark"
// override it (Settings > General > Theme). Inlined into each page's <head>
// at build time (see vite.config.ts), so it runs before the page draws,
// using the last choice remembered on this machine: a window never flashes
// the wrong theme. The app then confirms it from its settings.

import {accentTokens, validAccent} from "./accent";
type ThemePref = "system" | "light" | "dark";

const media = matchMedia("(prefers-color-scheme: dark)");
const valid = (v: string | null): v is ThemePref => v === "system" || v === "light" || v === "dark";

let pref: ThemePref = "system";
let accent = "#007aff";
try {
  const saved = localStorage.getItem("theme");
  if (valid(saved)) pref = saved;
  const color = localStorage.getItem("accentColor");
  if (color && validAccent(color)) accent = color;
} catch {
  // Storage can be unavailable; follow the system.
}

const apply = () => {
  const dark = pref === "dark" || (pref === "system" && media.matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  const tokens = accentTokens(accent, dark);
  for (const [key, value] of Object.entries({accent: tokens.color, "accent-2": tokens.color, "accent-soft": tokens.soft, "on-accent": tokens.on})) document.documentElement.style.setProperty("--" + key, value);
};
media.addEventListener("change", apply);

window.setAccent = (next: string, persist = false) => {
  accent = validAccent(next) ? next.toLowerCase() : "#007aff";
  if (persist) { try { localStorage.setItem("accentColor", accent); } catch { /* optional cache */ } }
  apply();
};
window.setTheme = (next: string, persist = true) => {
  pref = valid(next) ? next : "system";
  if (persist) { try { localStorage.setItem("theme", pref); } catch { /* not remembered, still applied */ } }
  apply();
};
apply();
