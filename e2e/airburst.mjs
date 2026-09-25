// 練習模式：以正常動作鏈做出空中擊破煙霧瓶。
// 操作全部是正常輸入（方向鍵轉向、3 換投石、Q 投瓶、左鍵投石）；
// 瞄準時透過 __sd 讀取瓶子的位置與速度來決定要轉到哪裡（狀態讀取輔助，不是真人操作）。
import { Bot, OUT, launch } from './lib.mjs';

// 與 src/config.ts 相同的數值（投石 30 m/s、重力 6、準備 0.06 s；眼高 1.6−0.05；天花板 4.5 m）
const STONE = { speed: 30, gravity: 6, windup: 0.06 };
const EYE_Y = 1.55;
const CEILING = 4.5;

/** 依目前的視角，找出投石直線與瓶子拋物線最接近的時刻，回傳要在哪個世界時間按下左鍵。 */
function planIntercept(s, b) {
  const p = s.player;
  const cp = Math.cos(p.pitch);
  const v = { x: -Math.sin(p.yaw) * cp, y: Math.sin(p.pitch), z: -Math.cos(p.yaw) * cp };
  const f = { x: -Math.sin(p.yaw), z: -Math.cos(p.yaw) };
  const r = { x: Math.cos(p.yaw), z: -Math.sin(p.yaw) };
  const eye = { x: p.x, y: EYE_Y, z: p.z };
  const o = { x: eye.x + f.x * 0.45 + r.x * 0.16, y: EYE_Y - 0.12, z: eye.z + f.z * 0.45 + r.z * 0.16 };
  // 投石朝「準星射線打到的表面」收斂；開闊場地仰角瞄準時是天花板
  const aimDist = Math.max(2.5, v.y > 0.05 ? Math.min(60, (CEILING - EYE_Y) / v.y) : 60);
  const a = { x: eye.x + v.x * aimDist, y: eye.y + v.y * aimDist, z: eye.z + v.z * aimDist };
  const len = Math.hypot(a.x - o.x, a.y - o.y, a.z - o.z);
  const u = { x: (a.x - o.x) / len, y: (a.y - o.y) / len, z: (a.z - o.z) / len };
  let best = null;
  for (let t = 0.02; t < 2; t += 0.004) {
    const bt = { x: b.x + b.vx * t, y: b.y + b.vy * t - 0.5 * b.gravity * t * t, z: b.z + b.vz * t };
    if (bt.y < 0.3) break;
    const tau = Math.hypot(bt.x - o.x, bt.y - o.y, bt.z - o.z) / STONE.speed;
    const lead = t - tau - STONE.windup;
    if (lead < 0.03) continue;
    const st = { x: o.x + u.x * STONE.speed * tau, y: o.y + u.y * STONE.speed * tau - 0.5 * STONE.gravity * tau * tau, z: o.z + u.z * STONE.speed * tau };
    const miss = Math.hypot(st.x - bt.x, st.y - bt.y, st.z - bt.z);
    if (!best || miss < best.miss) best = { t, miss, dist: tau * STONE.speed, clickAt: s.time + lead };
  }
  return best;
}

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
  await bot.tap('Digit2');
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
  // 不轉向：瓶子沿著面向的方向飛，投石也從同一個出手點朝準星射出，兩者幾乎在同一個鉛直面上，
  // 投石的直線一定會穿過瓶子的拋物線。只要算出交會點，並在正確的世界時間按下左鍵（和真人「等它飛到準星再丟」一樣）。
  const plan = planIntercept(s, bottle);
  console.log(`attempt ${attempt}: 預計交會 ${plan.t.toFixed(2)} s 後、距離 ${plan.dist.toFixed(1)} m、預估偏差 ${plan.miss.toFixed(3)} m`);
  for (;;) {
    const x = await bot.st();
    if (x.time >= plan.clickAt - x.lastWorldDt * 0.5) break;
    await page.waitForTimeout(15);
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
