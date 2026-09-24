// 死亡 → 結算 → 同種子重試（佈局相同）→ 再次死亡 → 新種子（佈局不同）。
// 以正常操作走向敵人並按住空白鍵讓時間流動直到倒下（不注入生命值）。
import { Bot, OUT, launch, startRun, yawTo } from './lib.mjs';

const { browser, page, errors } = await launch();
await page.goto(`${process.env.BASE_URL ?? 'http://127.0.0.1:5173/'}?dev=1&gfx=low`);
await page.mouse.move(640, 360);
const bot = new Bot(page);
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

const signature = async () =>
  page.evaluate(() => {
    const l = window.__sd.level();
    const s = window.__sd.state();
    return JSON.stringify({
      t: l.template,
      rooms: l.rooms.map((r) => [r.key, r.layoutId, r.x0, r.z0]),
      enemies: s.enemies.map((e) => [e.kind, e.x.toFixed(2), e.z.toFixed(2), e.state]),
      altars: l.altars.map((a) => a.offer),
    });
  });

/** 走進最近的敵人附近，按住空白讓時間流動直到死亡。 */
async function dieNormally() {
  for (let k = 0; k < 4000; k++) {
    const s = await bot.st();
    if (s.mode === 'results') return true;
    if (s.outcome === 'dead') {
      await page.waitForTimeout(200);
      continue;
    }
    const p = s.player;
    const alive = s.enemies.filter((e) => e.alive && !e.perched).map((e) => ({ e, d: Math.hypot(e.x - p.x, e.z - p.z) })).sort((a, b) => a.d - b.d);
    const target = alive[0];
    if (!target) return false;
    if (target.d < 1.3 || s.enemies.some((e) => e.state === 'alert' && Math.hypot(e.x - p.x, e.z - p.z) < 4)) {
      await bot.releaseAll();
      await bot.down('Space');
      await page.waitForTimeout(300);
      continue;
    }
    await bot.up('Space');
    const path = await page.evaluate(([x, z]) => window.__sd.pathTo(x, z), [target.e.x, target.e.z]);
    const door = s.doors.find((d) => !d.arch && !d.barred && d.progress < 0.99 && Math.hypot(d.cx - p.x, d.cz - p.z) < 1.8);
    if (door && door.target === 0) {
      await bot.releaseAll();
      await bot.turnTo(yawTo(p.x, p.z, door.cx, door.cz), 0.15);
      await bot.tap('KeyE');
      await bot.waitIdle();
      continue;
    }
    if (!path || !path.length) {
      await page.waitForTimeout(100);
      continue;
    }
    let wp = path[0];
    if (path.length > 1 && Math.hypot(wp.x - p.x, wp.z - p.z) < 0.6) wp = path[1];
    await bot.turnTo(yawTo(p.x, p.z, wp.x, wp.z), 0.2);
    await bot.down('KeyW');
    await page.waitForTimeout(80);
  }
  return false;
}

await startRun(page, 'RETRY1');
await page.waitForTimeout(400);
const sig1 = await signature();
check('第一局死亡後進入結算', await dieNormally());
await page.waitForTimeout(500);
check('結算標題顯示死亡', (await page.textContent('#res-title')) === '你倒下了');
const statsText = await page.textContent('#res-stats');
check('結算列出種子外的統計與受傷來源', statsText.includes('受到傷害') && statsText.includes('世界時間'), statsText.slice(0, 120));
await page.screenshot({ path: `${OUT}results-death.png` });
await page.click('#btn-retry');
await page.waitForFunction(() => window.__sd.state().mode === 'playing', null, { timeout: 30000 });
await page.waitForTimeout(400);
const sig2 = await signature();
check('同種子重試：初始佈局與內容完全相同', sig1 === sig2);
const st2 = await bot.st();
check('同種子重試：狀態重置（生命、時間、敵人）', st2.player.hp === st2.player.maxHp && st2.time < 0.5 && st2.enemies.every((e) => e.alive));
check('第二局死亡後進入結算', await dieNormally());
await page.waitForTimeout(500);
await page.click('#btn-new');
await page.waitForFunction(() => window.__sd.state().mode === 'playing', null, { timeout: 30000 });
await page.waitForTimeout(400);
const sig3 = await signature();
const st3 = await bot.st();
check('新種子：種子改變且佈局不同', st3.seed !== 'RETRY1' && sig3 !== sig1, st3.seed);
check('全程無 console 錯誤', errors.length === 0, errors.join(' | '));
await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);
