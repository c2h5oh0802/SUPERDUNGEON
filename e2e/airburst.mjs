// 練習模式：以正常動作鏈做出空中擊破煙霧瓶。
// 操作全部是正常輸入（方向鍵轉向、3 換投石、Q 投瓶、左鍵投石）；
// 瞄準時透過 __sd 讀取瓶子的位置與速度來決定要轉到哪裡（狀態讀取輔助，不是真人操作）。
import { Bot, OUT, launch, wrap } from './lib.mjs';

const { browser, page, errors } = await launch();
await page.goto(`${process.env.BASE_URL ?? 'http://127.0.0.1:5173/'}?dev=1&gfx=low`);
await page.mouse.move(640, 360);
await page.click('#btn-practice');
await page.waitForFunction(() => window.__sd?.state().mode === 'playing', null, { timeout: 30000 });
await page.waitForTimeout(500);
const bot = new Bot(page);

let success = false;
for (let attempt = 1; attempt <= 3 && !success; attempt++) {
  // 面向東方的開闊處、略微抬頭
  await bot.turnTo(-Math.PI / 2 + 0.25, 0.05);
  await bot.pitchTo(0.28, 0.05);
  await bot.tap('Digit3');
  await page.waitForTimeout(100);
  const before = await bot.st();
  if (before.player.bottles <= 0) {
    // 走到補給台（E）補滿
    const lvl = await page.evaluate(() => window.__sd.state().interactables.find((i) => i.kind === 'resupply'));
    const p = before.player;
    await bot.turnTo(Math.atan2(-(lvl.x - p.x), -(lvl.z - p.z)), 0.05);
    for (let k = 0; k < 80; k++) {
      const x = await bot.st();
      if (Math.hypot(lvl.x - x.player.x, lvl.z - x.player.z) < 1.4) break;
      await bot.down('KeyW');
      await page.waitForTimeout(60);
    }
    await bot.up('KeyW');
    await bot.tap('KeyE');
    await bot.waitIdle(3000);
    await page.waitForTimeout(300);
    console.log('補給後瓶子', (await bot.st()).player.bottles);
    attempt--;
    continue;
  }
  await bot.tap('KeyQ');
  // 等投瓶行動開始，再等它結束（不可取消）
  for (let k = 0; k < 50; k++) {
    const x = await bot.st();
    if (x.player.action || x.projectiles.some((q) => q.kind === 'bottle')) break;
    await page.waitForTimeout(30);
  }
  await bot.waitIdle(3000);
  let s = await bot.st();
  const bottle = s.projectiles.find((q) => q.kind === 'bottle');
  if (!bottle) {
    console.log('瓶子已經落地（不應發生）');
    continue;
  }
  console.log(`attempt ${attempt}: 投瓶後行動結束時瓶子仍在空中 y=${bottle.y.toFixed(2)}`);
  await page.screenshot({ path: `${OUT}airburst-${attempt}-bottle.png` });
  // 瞄準：預測瓶子在投石命中時的位置（投石 30 m/s、準備 0.06 s、重力 6）
  for (let iter = 0; iter < 3; iter++) {
    s = await bot.st();
    const b = s.projectiles.find((q) => q.kind === 'bottle');
    if (!b) break;
    const ex = s.player.x;
    const ey = 1.55;
    const ez = s.player.z;
    let t = 0.2;
    let tx = b.x;
    let ty = b.y;
    let tz = b.z;
    for (let k = 0; k < 4; k++) {
      tx = b.x + b.vx * t;
      ty = b.y + b.vy * t - 0.5 * b.gravity * t * t;
      tz = b.z + b.vz * t;
      const d = Math.hypot(tx - ex, ty - ey, tz - ez);
      t = 0.06 + d / 30 + 0.02;
    }
    const d = Math.hypot(tx - ex, tz - ez);
    const drop = 0.5 * 6 * (d / 30) ** 2;
    const yaw = Math.atan2(-(tx - ex), -(tz - ez));
    const pitch = Math.atan2(ty + drop - ey, d);
    await bot.turnTo(yaw, 0.012);
    await bot.pitchTo(pitch, 0.012);
    const now = await bot.st();
    if (Math.abs(wrap(now.player.yaw - yaw)) < 0.02 && Math.abs(now.player.pitch - pitch) < 0.02) break;
  }
  await bot.click();
  await page.waitForTimeout(80);
  await page.screenshot({ path: `${OUT}airburst-${attempt}-throw.png` });
  for (let k = 0; k < 60; k++) {
    const x = await bot.st();
    if (!x.player.action && !x.projectiles.length) break;
    await page.waitForTimeout(100);
  }
  await page.waitForTimeout(300);
  const end = await bot.st();
  console.log(`attempt ${attempt}: airbursts=${end.stats.airbursts} smokes=${end.smokes.length} air=${end.smokes.map((q) => q.air).join(',')}`);
  if (end.stats.airbursts > 0) {
    success = true;
    await page.screenshot({ path: `${OUT}airburst-smoke.png` });
    const ev = await page.evaluate(() => window.__sd.events().filter((e) => e.type === 'bottleBreak' || e.type === 'throw'));
    console.log('events', JSON.stringify(ev.map((e) => [e.type, e.kind ?? '', e.air ?? '', e.t.toFixed(2)])));
  } else {
    // 補給台補瓶子：走回去太麻煩，直接等煙霧散了再試（練習場起始有 1 瓶）
    await page.keyboard.down('Space');
    await page.waitForTimeout(3000);
    await page.keyboard.up('Space');
  }
}
console.log(success ? 'AIRBURST OK' : 'AIRBURST FAILED');
console.log('errors', errors.join(' | ') || 'none');
await browser.close();
process.exit(success ? 0 : 1);
