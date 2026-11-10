import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import pngToIco from "png-to-ico";
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const get = (p) => fs.readFileSync(path.join(root, p), "utf8");
const put = (p, v) => {
  fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true });
  fs.writeFileSync(path.join(root, p), v);
};
const master = get("docs/assets/brand/logo-mark.svg").trim();
const word = get("docs/assets/brand/logo-wordmark.svg").trim();
const svg = (body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024" fill="none">${body}</svg>\n`;
const inner = master.slice(
  master.indexOf(">") + 1,
  master.lastIndexOf("</svg>"),
);
const shape = master.match(/<path[^>]+>/)[0];
const backing =
  '<rect x="32" y="32" width="960" height="960" rx="220" fill="#202126"/>';
const app = svg(backing + inner.replaceAll("#000000", "#08090B"));
// Optical small-size derivative: retain the supplied wool silhouette; remove
// sub-pixel speed flourishes; keep the original face and wool contours.
const detail = master.match(/<path[^>]+>/g)[1];
const optical = detail
  .replace(
    /d="([^"]+)"/,
    (_, d) =>
      'd="' +
      d
        .split(/(?= M )/)
        .filter((_, i) => ![1, 2, 9].includes(i))
        .join("") +
      '"',
  )
  .replaceAll("#000000", "#08090B");
const small = svg(
  backing +
    '<g transform="translate(96 167.46012269938646) scale(1.0208588957055216)">' +
    shape +
    optical +
    "</g>",
);
// Wordmarks stay transparent. Reverse only the outlined letter group; the
// black-and-white mascot remains intact on dark surfaces.
const reverse = word.replace(
  '<g fill="#202126" fill-rule="nonzero">',
  '<g fill="#FFFFFF" fill-rule="nonzero">',
);
// The selected C lettering is already outlined. Crop only its transparent canvas.
const letters = word.match(/<g fill="#202126"[\s\S]+(?=<\/svg>)/)[0];
const textCanvas = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="400" viewBox="0 0 1600 400">${letters}</svg>`;
const { data, info } = await sharp(Buffer.from(textCanvas))
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
let x0 = 1600,
  y0 = 400,
  x1 = 0,
  y1 = 0;
for (let y = 0; y < 400; y++)
  for (let x = 0; x < 1600; x++)
    if (data[(y * 1600 + x) * 4 + 3]) {
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
const typeLight = `<svg xmlns="http://www.w3.org/2000/svg" width="${x1 - x0 + 1}" height="${y1 - y0 + 1}" viewBox="${x0} ${y0} ${x1 - x0 + 1} ${y1 - y0 + 1}" fill="none">${letters}</svg>`;
const typeDark = typeLight.replace('fill="#202126"', 'fill="#FFFFFF"');
for (const dir of ["docs/assets/brand", "app/ui/public", "site/assets"]) {
  put(dir + "/logo-type.svg", typeLight);
  put(dir + "/logo-type-dark.svg", typeDark);
}
put("docs/assets/brand/logo-wordmark-dark.svg", reverse);
put("docs/assets/brand/app-icon.svg", app);
put("docs/assets/brand/app-icon-small.svg", small);
for (const p of [
  "app/icon.svg",
  "app/ui/public/logo.svg",
  "extension/logo.svg",
  "site/assets/logo.svg",
  "site/assets/mark.svg",
])
  put(p, small);
for (const dir of ["app/ui/public", "site/assets"]) {
  put(dir + "/logo-wordmark.svg", word);
  put(dir + "/logo-wordmark-dark.svg", reverse);
}
const render = (s, w, h = w) =>
  sharp(Buffer.from(s)).resize(w, h).png().toBuffer();
const icon = (n) => render(n <= 48 ? small : app, n);
put("docs/assets/brand/logo-mark-1024.png", await render(master, 1024));
put("docs/assets/brand/baadash-mark.png", await render(master, 1024));
put("docs/assets/brand/baadash-wordmark.png", await render(word, 1600, 400));
put("app/src-tauri/icons/icon.png", await icon(1024));
for (const n of [16, 32, 48, 64, 128, 256, 512, 1024])
  put(`docs/assets/brand/png/${n}.png`, await icon(n));
for (const n of [32, 64, 128])
  put(`app/src-tauri/icons/${n}x${n}.png`, await icon(n));
put("app/src-tauri/icons/128x128@2x.png", await icon(256));
for (const p of fs
  .readdirSync(path.join(root, "app/src-tauri/icons"))
  .filter((p) => /^(Square|Store).*png$/.test(p))) {
  const { width } = await sharp(
    path.join(root, "app/src-tauri/icons", p),
  ).metadata();
  put("app/src-tauri/icons/" + p, await icon(width));
}
for (const n of [16, 32, 48, 64, 128])
  put(`extension/icons/${n}.png`, await icon(n));
put(
  "app/src-tauri/icons/icon.ico",
  await pngToIco(await Promise.all([16, 24, 32, 48, 64, 128, 256].map(icon))),
);
const reps = [
  ["icp4", 16],
  ["icp5", 32],
  ["icp6", 64],
  ["ic07", 128],
  ["ic08", 256],
  ["ic09", 512],
  ["ic10", 1024],
  ["ic11", 32],
  ["ic12", 64],
  ["ic13", 256],
  ["ic14", 512],
];
const chunks = [];
for (const [type, n] of reps) {
  const data = await icon(n),
    h = Buffer.alloc(8);
  h.write(type);
  h.writeUInt32BE(data.length + 8, 4);
  chunks.push(h, data);
}
const body = Buffer.concat(chunks),
  head = Buffer.alloc(8);
head.write("icns");
head.writeUInt32BE(body.length + 8, 4);
put("app/src-tauri/icons/icon.icns", Buffer.concat([head, body]));
// Native installer dimensions: sidebar 164x314 and header 150x57, 24-bit BMP.
for (const [name, w, h] of [
  ["sidebar", 164, 314],
  ["header", 150, 57],
]) {
  const label = typeDark;
  const layers =
    name === "sidebar"
      ? [
          { input: await icon(92), left: 36, top: 48 },
          {
            input: await sharp(Buffer.from(label))
              .resize({
                width: 132,
                height: 30,
                fit: "contain",
                background: { r: 0, g: 0, b: 0, alpha: 0 },
              })
              .png()
              .toBuffer(),
            left: 16,
            top: 156,
          },
        ]
      : [{ input: await render(reverse, 138, 35), left: 6, top: 11 }];
  const { data } = await sharp({
    create: { width: w, height: h, channels: 3, background: "#202126" },
  })
    .composite(layers)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const stride = (w * 3 + 3) & ~3,
    bmp = Buffer.alloc(54 + stride * h);
  bmp.write("BM");
  bmp.writeUInt32LE(bmp.length, 2);
  bmp.writeUInt32LE(54, 10);
  bmp.writeUInt32LE(40, 14);
  bmp.writeInt32LE(w, 18);
  bmp.writeInt32LE(h, 22);
  bmp.writeUInt16LE(1, 26);
  bmp.writeUInt16LE(24, 28);
  bmp.writeUInt32LE(stride * h, 34);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 3,
        d = 54 + (h - 1 - y) * stride + x * 3;
      bmp[d] = data[s + 2];
      bmp[d + 1] = data[s + 1];
      bmp[d + 2] = data[s];
    }
  put(`app/src-tauri/windows/${name}.bmp`, bmp);
}
put(
  "docs/assets/brand/social-preview.png",
  await sharp({
    create: { width: 1200, height: 630, channels: 4, background: "#202126" },
  })
    .composite([
      { input: await render(reverse, 960, 240), left: 120, top: 175 },
    ])
    .png()
    .toBuffer(),
);
put(
  "site/assets/social-preview.png",
  fs.readFileSync(path.join(root, "docs/assets/brand/social-preview.png")),
);
// Small icon comparison at native resolution on black, white and gray.
const layers = [];
for (const [row, bg] of ["#000000", "#FFFFFF", "#808080"].entries())
  for (const [col, n] of [16, 32, 48, 128].entries()) {
    layers.push({
      input: await sharp({
        create: { width: 176, height: 176, channels: 4, background: bg },
      })
        .png()
        .toBuffer(),
      left: col * 176,
      top: row * 176,
    });
    layers.push({
      input: await icon(n),
      left: col * 176 + Math.floor((176 - n) / 2),
      top: row * 176 + Math.floor((176 - n) / 2),
    });
  }
put(
  "docs/assets/brand/icon-size-check.png",
  await sharp({
    create: { width: 704, height: 528, channels: 4, background: "#808080" },
  })
    .composite(layers)
    .png()
    .toBuffer(),
);
put(
  "extension/content.js",
  get("extension/content.js").replace(
    /const LOGO\s*=\s*`[^`]+`;/,
    () =>
      "const LOGO = `" +
      small
        .trim()
        .replace(
          'width="1024" height="1024"',
          'width="20" height="20" aria-hidden="true"',
        ) +
      "`;",
  ),
);
console.log(
  "Generated masters, app/extension icons, 7-size ICO, 11-representation ICNS, installer BMP and social preview.",
);

// About-page lockup: trim transparent canvas while preserving the master artwork.
const ab = await sharp(Buffer.from(word))
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
let ax = 1600,
  ay = 400,
  bx = 0,
  by = 0;
for (let y = 0; y < 400; y++)
  for (let x = 0; x < 1600; x++)
    if (ab.data[(y * 1600 + x) * 4 + 3] > 8) {
      ax = Math.min(ax, x);
      ay = Math.min(ay, y);
      bx = Math.max(bx, x);
      by = Math.max(by, y);
    }
for (const [name, art] of [
  ["logo-about.svg", word],
  ["logo-about-dark.svg", reverse],
]) {
  const cropped = art.replace(
    /<svg[^>]+>/,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${bx - ax + 1}" height="${by - ay + 1}" viewBox="${ax} ${ay} ${bx - ax + 1} ${by - ay + 1}" fill="none">`,
  );
  put("app/ui/public/" + name, cropped);
  put("docs/assets/brand/" + name, cropped);
}

// The README and About screen use the user-supplied icon unchanged.
put("app/ui/public/brand-icon.svg", get("docs/assets/brand/icon.svg"));
