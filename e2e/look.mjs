// 視覺檢查：以除錯傳送（狀態注入，僅用於截圖檢視）到各處截圖。
import { chromium } from 'playwright';
const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:5173/';
const out = new URL('./out/', import.meta.url).pathname;
const seed = process.argv[2] ?? 'DEMO1';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(`${BASE}?dev=1`);
await page.fill('#seed-input', seed);
await page.click('#btn-start');
await page.waitForFunction(() => window.__sd?.state().mode === 'playing', null, { timeout: 20000 });
await page.waitForTimeout(500);
const st = await page.evaluate(() => window.__sd.state());
const lvl = await page.evaluate(() => window.__sd.level());
console.log('template', lvl.template, 'rooms', lvl.rooms.map((r) => `${r.key}:${r.layoutId}`).join(' '));
// 找各種敵人，傳送到其前方 4 m 面對它
const kinds = ['guard', 'archer', 'charger'];
for (const k of kinds) {
  const e = st.enemies.find((x) => x.kind === k && !x.perched);
  if (!e) continue;
  const fx = -Math.sin(e.yaw), fz = -Math.cos(e.yaw);
  const px = e.x + fx * 3.2, pz = e.z + fz * 3.2;
  await page.evaluate(([x, z]) => window.__sd.debug.teleport(x, z), [px, pz]);
  // 轉向敵人：直接移動滑鼠不可靠，改用方向鍵近似 → 以 yaw 注入
  const yaw = Math.atan2(-(e.x - px), -(e.z - pz));
  await page.evaluate((yaw) => window.__sd.debug.setView(yaw, -0.08), yaw);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}enemy-${k}.png` });
  console.log(k, e.state, 'at', e.x.toFixed(1), e.z.toFixed(1));
}
// 測試滑鼠移動是否能轉視角（鎖定狀態下）
const before = (await page.evaluate(() => window.__sd.state())).player.yaw;
await page.mouse.move(640, 360);
await page.mouse.move(700, 360, { steps: 5 });
await page.waitForTimeout(100);
const after = (await page.evaluate(() => window.__sd.state())).player.yaw;
console.log('mouse yaw delta', (after - before).toFixed(3), 'locked', (await page.evaluate(() => window.__sd.state())).locked);
console.log('errors', errors.join('\n') || 'none');
await browser.close();
