// Keep theme startup and settings preview on the same color derivation.
export const ACCENTS = [
  ["#007aff", "海蓝"], ["#7c3aed", "鸢紫"], ["#db2777", "玫红"],
  ["#d97706", "琥珀"], ["#059669", "青绿"], ["#0891b2", "湖青"],
] as const;
export const validAccent = (v: string): boolean => /^#[0-9a-f]{6}$/i.test(v);
export function accentTokens(input: string, dark: boolean) {
  const hex = validAccent(input) ? input : "#007aff";
  let rgb = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const luminance = (c: number[]) => c.map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((s, v, i) => s + v * [.2126, .7152, .0722][i], 0);
  // >=4.5:1 on both panel and selected tinted surface, including extreme inputs.
  const contrast = (a: number[], b: number[]) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);
  const base = dark ? [16, 17, 20] : [255, 255, 255];
  const alpha = dark ? .16 : .1;
  for (let i = 0; i < 256; i++) {
    const tint = rgb.map((c, j) => Math.round(c * alpha + base[j] * (1 - alpha)));
    if (contrast(rgb, base) >= 4.6 && contrast(rgb, tint) >= 4.6) break;
    rgb = rgb.map(c => dark ? Math.min(255, c + 1) : Math.max(0, c - 1));
  }
  const color = "#" + rgb.map(c => c.toString(16).padStart(2, "0")).join("");
  return {color, soft: `rgba(${rgb.join(",")},${alpha})`, on: luminance(rgb) > .179 ? "#000000" : "#ffffff"};
}
