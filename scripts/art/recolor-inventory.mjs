// 由既有的庫存圖重新上色，產生新外觀（M-C：第 7 種藥水、第 5、6 種卷軸）。
// 只改指定色相範圍內的像素（藥水的液體、卷軸的飾紋），瓶身、軟木塞、繩子與紙張不變。
// 用法：BROWSER_PATH=/opt/pw-browsers/chromium node scripts/art/recolor-inventory.mjs [--stats]
/* global Image, document */
import { Buffer } from 'node:buffer';
import { readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';
import { URL } from 'node:url';
import { chromium } from 'playwright';

const log = (text) => process.stdout.write(`${text}\n`);

const DIR = new URL('../../src/assets/inventory/', import.meta.url);
/** source：來源圖；hue：要換色的色相範圍（度）；minSat：最低飽和度；to：目標色相、飽和度倍率、明度倍率。 */
// 藥水：只換液體（紫色）的色相，瓶身與軟木塞不變。卷軸：整卷改色（鏽紅、霜白），飾紋形狀沿用來源。
const JOBS = [
  { out: 'potion-look-ink', source: 'potion-look-violet', hue: [225, 330], minSat: 0.2, to: { h: 236, s: 0.32, v: 0.5 } },
  { out: 'scroll-look-rust', source: 'scroll-look-star', hue: [0, 360], minSat: 0.08, to: { h: 10, s: 1.35, v: 0.82 } },
  { out: 'scroll-look-frost', source: 'scroll-look-tide', hue: [0, 360], minSat: 0.04, to: { h: 205, s: 0.45, v: 1.12 } },
];
const statsOnly = process.argv.includes('--stats');

const browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH || undefined });
const page = await browser.newPage();
for (const job of JOBS) {
  const src = await readFile(new URL(`${job.source}.webp`, DIR));
  const result = await page.evaluate(async ({ b64, job, statsOnly }) => {
    const img = new Image();
    img.src = `data:image/webp;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, c.width, c.height);
    const px = data.data;
    const hist = new Array(12).fill(0);
    let changed = 0;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] < 8) continue;
      const r = px[i] / 255, g = px[i + 1] / 255, b = px[i + 2] / 255;
      const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
      const s = max ? d / max : 0;
      let h = 0;
      if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h = (h * 60 + 360) % 360;
      if (s > 0.15) hist[Math.floor(h / 30)]++;
      if (statsOnly || s < job.minSat || h < job.hue[0] || h > job.hue[1]) continue;
      const nh = job.to.h, ns = Math.min(1, s * job.to.s), nv = Math.min(1, max * job.to.v);
      const f = (n) => { const k = (n + nh / 60) % 6; return nv - nv * ns * Math.max(0, Math.min(k, 4 - k, 1)); };
      px[i] = Math.round(f(5) * 255); px[i + 1] = Math.round(f(3) * 255); px[i + 2] = Math.round(f(1) * 255);
      changed++;
    }
    if (statsOnly) return { hist };
    ctx.putImageData(data, 0, 0);
    let x0 = c.width, y0 = c.height, x1 = 0, y1 = 0;
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (px[(y * c.width + x) * 4 + 3] > 0) {
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
    const url = c.toDataURL('image/webp', 0.9);
    return { hist, changed, url, bounds: [x0, y0, x1, y1], w: c.width, h: c.height };
  }, { b64: src.toString('base64'), job, statsOnly });
  if (statsOnly) { log(`${job.source} hue histogram (30° bins): ${result.hist.join(' ')}`); continue; }
  const bytes = Buffer.from(result.url.split(',')[1], 'base64');
  await writeFile(new URL(`${job.out}.webp`, DIR), bytes);
  log(JSON.stringify({ file: `${job.out}.webp`, width: result.w, height: result.h, bytes: bytes.length, alphaBounds: result.bounds, changedPixels: result.changed }));
}
await browser.close();
