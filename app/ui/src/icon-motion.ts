// Framework-free adaptations of lucide-animated's settings/download motions.
// Original: https://github.com/pqoqubbw/icons (MIT), notice in public/licenses/.
// Only explicit primary entry points animate; list actions remain static.
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
const active = new Map<SVGElement, Animation[]>();
function stop() { for (const animations of active.values()) animations.forEach(a => a.cancel()); active.clear(); }
reduced.addEventListener("change", stop);
function animate(target: EventTarget | null) {
  if (reduced.matches || !(target instanceof Element)) return;
  const button = target.closest("#btn-settings, #btn-add, #set-nav button[data-tab='downloads'], #set-nav button[data-tab='general']");
  const svg = button?.querySelector<SVGElement>(".lucide-icon");
  if (!svg || active.has(svg)) return;
  const settings = svg.dataset.icon === "settings";
  const nodes = svg.dataset.icon === "download" ? [...svg.querySelectorAll("path")].filter(p => !p.getAttribute("d")?.startsWith("M21")) : [svg];
  const animations = nodes.map(node => node.animate(settings ? [{transform: "rotate(0deg)"}, {transform: "rotate(180deg)"}] : [{transform: "translateY(0)"}, {transform: "translateY(2px)", offset: .45}, {transform: "translateY(0)"}], {duration: settings ? 650 : 420, easing: "cubic-bezier(.22,1,.36,1)"}));
  active.set(svg, animations);
  Promise.all(animations.map(a => a.finished.catch(() => {}))).then(() => active.delete(svg));
}
document.addEventListener("pointerover", e => {
  if (e.target instanceof Element && e.relatedTarget instanceof Node && e.target.closest("button")?.contains(e.relatedTarget)) return;
  animate(e.target);
});
document.addEventListener("focusin", e => animate(e.target));
