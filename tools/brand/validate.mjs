import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const bytes = (p) => fs.readFileSync(path.join(root, p));
const checks = [];
for (const [p, w, h] of [
  ["docs/assets/brand/logo-mark-1024.png", 1024, 1024],
  ["app/src-tauri/icons/icon.png", 1024, 1024],
  ["app/src-tauri/icons/32x32.png", 32, 32],
  ["app/src-tauri/icons/128x128.png", 128, 128],
  ["app/src-tauri/icons/128x128@2x.png", 256, 256],
  ["docs/assets/brand/social-preview.png", 1200, 630],
  ...[16, 32, 48, 128].map((n) => [`extension/icons/${n}.png`, n, n]),
]) {
  const m = await sharp(bytes(p)).metadata();
  assert.equal(m.width, w, p);
  assert.equal(m.height, h, p);
  assert.ok(m.hasAlpha, p);
  checks.push(`${p}: ${w}x${h}, alpha`);
}
for (const n of [16, 32, 48, 128, 1024]) {
  const { data, info } = await sharp(bytes(`docs/assets/brand/png/${n}.png`))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  for (const pixel of [0, n - 1, n * (n - 1), n * n - 1])
    assert.equal(
      data[pixel * 4 + 3],
      0,
      "Rounded icon corners must stay transparent",
    );
}
const manifest = JSON.parse(bytes("extension/manifest.json"));
for (const n of [16, 32, 48, 128]) {
  assert.ok(fs.existsSync(path.join(root, "extension", manifest.icons[n])));
  assert.equal(manifest.action.default_icon[n], manifest.icons[n]);
}
const ico = bytes("app/src-tauri/icons/icon.ico");
assert.equal(ico.readUInt16LE(2), 1);
const icoSizes = [];
for (let i = 0; i < ico.readUInt16LE(4); i++) {
  const o = 6 + 16 * i,
    n = ico[o] || 256;
  assert.equal(ico[o + 1] || 256, n);
  assert.ok(ico.readUInt32LE(o + 12) + ico.readUInt32LE(o + 8) <= ico.length);
  icoSizes.push(n);
}
assert.deepEqual(icoSizes, [16, 24, 32, 48, 64, 128, 256]);
checks.push("ICO: " + icoSizes.join(", "));
const icns = bytes("app/src-tauri/icons/icon.icns");
assert.equal(icns.toString("ascii", 0, 4), "icns");
assert.equal(icns.readUInt32BE(4), icns.length);
const sizes = {
  icp4: 16,
  icp5: 32,
  icp6: 64,
  ic07: 128,
  ic08: 256,
  ic09: 512,
  ic10: 1024,
  ic11: 32,
  ic12: 64,
  ic13: 256,
  ic14: 512,
};
const reps = [];
for (let o = 8; o < icns.length;) {
  const type = icns.toString("ascii", o, o + 4),
    len = icns.readUInt32BE(o + 4);
  assert.ok(len > 8 && o + len <= icns.length);
  const m = await sharp(icns.subarray(o + 8, o + len)).metadata();
  assert.equal(m.width, sizes[type]);
  assert.equal(m.height, sizes[type]);
  reps.push(type);
  o += len;
}
assert.deepEqual(reps, Object.keys(sizes));
checks.push("ICNS: " + reps.join(", "));
for (const [name, w, h] of [
  ["sidebar", 164, 314],
  ["header", 150, 57],
]) {
  const b = bytes(`app/src-tauri/windows/${name}.bmp`);
  assert.equal(b.toString("ascii", 0, 2), "BM");
  assert.equal(b.readInt32LE(18), w);
  assert.equal(b.readInt32LE(22), h);
  assert.equal(b.readUInt16LE(28), 24);
  const raw = Buffer.alloc(w * h * 3),
    stride = (w * 3 + 3) & ~3;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const s = 54 + (h - y - 1) * stride + x * 3,
        d = (y * w + x) * 3;
      raw[d] = b[s + 2];
      raw[d + 1] = b[s + 1];
      raw[d + 2] = b[s];
    }
  await sharp(raw, { raw: { width: w, height: h, channels: 3 } })
    .png()
    .toFile(path.join(root, `docs/assets/brand/installer-${name}-preview.png`));
  checks.push(`BMP ${name}: ${w}x${h}, 24-bit`);
}
for (const name of [
  "logo-mark",
  "logo-wordmark",
  "logo-wordmark-dark",
  "app-icon",
  "app-icon-small",
]) {
  const s = bytes(`docs/assets/brand/${name}.svg`).toString("utf8");
  assert.ok(s.includes('xmlns="http://www.w3.org/2000/svg"'));
  assert.ok(s.includes("viewBox="));
  assert.ok(
    !/<(?:text|image|script|foreignObject|style|filter|animate)\b|currentColor|var\(|data:|href=/.test(
      s,
    ),
    name,
  );
  assert.ok(!s.includes("\uFFFD"));
  const tags = [...s.matchAll(/<\/?([\w-]+)/g)].map((m) => m[1]);
  assert.ok(
    tags.every((t) =>
      ["svg", "g", "path", "rect", "circle", "ellipse", "polygon"].includes(t),
    ),
  );
  const colors = new Set(
    [...s.matchAll(/#[0-9A-Fa-f]{6}/g)].map((m) => m[0].toUpperCase()),
  );
  assert.ok(colors.size <= 3);
  checks.push(`${name}.svg: vector only, UTF-8, ${colors.size} colors`);
}
const { data, info } = await sharp(bytes("docs/assets/brand/logo-mark.svg"))
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
let minX = 1024,
  minY = 1024,
  maxX = 0,
  maxY = 0;
for (let y = 0; y < info.height; y++)
  for (let x = 0; x < info.width; x++)
    if (data[(y * info.width + x) * 4 + 3] > 16) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
assert.ok(minX >= 95 && minY >= 95 && maxX <= 928 && maxY <= 928);
checks.push(`Master visible bounds: ${minX},${minY} to ${maxX},${maxY}`);
fs.writeFileSync(
  path.join(root, "docs/assets/brand/validation.txt"),
  checks.join("\n") + "\n",
);
console.log(checks.join("\n"));
