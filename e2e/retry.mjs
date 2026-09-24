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

// 生成結果的完整簽章（地形、門、敵人初始位置與狀態、補給、祭壇），不受開局後經過多少慢動作時間影響
const signature = async () => page.evaluate(() => window.__sd.level().signature);
// 開局後的即時狀態（巡邏中的敵人會在慢動作中移動，只在失敗時列出以供比對）
const liveSnapshot = async () =>
  page.evaluate(() => {
    const s = window.__sd.state();
    return { time: s.time, enemies: s.enemies.map((e) => [e.kind, +e.x.toFixed(2), +e.z.toFixed(2), e.state]) };
  });

/** 走進最近的敵人附近，按住空白讓時間流動直到死亡。 */
async function dieNormally(maxMs = 150000) {
  const t0 = Date.now();
  let lastLog = 0;
  for (let k = 0; k < 4000 && Date.now() - t0 < maxMs; k++) {
    const s = await bot.st();
    if (s.mode === 'results') return true;
    if (Date.now() - lastLog > 10000) {
      lastLog = Date.now();
      const e = s.enemies.filter((x) => x.alive).map((x) => `${x.kind}:${x.state}/${x.phase}@${Math.hypot(x.x - s.player.x, x.z - s.player.z).toFixed(1)}`);
      console.log('（進度）', s.mode, 'hp', s.player.hp, 'pos', s.player.x.toFixed(1), s.player.z.toFixed(1), 'world', s.time.toFixed(1), 'fallback', s.fallback, 'locked', s.locked, e.slice(0, 4).join(' '));
    }
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
const live1 = await liveSnapshot();
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
const live2 = await liveSnapshot();
check('同種子重試：生成結果完全相同（地形、門、敵人初始位置、補給、祭壇）', sig1 === sig2, `${sig1.length} 字元`);
const sameLive = JSON.stringify(live1.enemies) === JSON.stringify(live2.enemies);
if (!sameLive) console.log('（資訊）開局後的即時敵人狀態不同，原因是取樣時已經過的世界時間不同：', live1.time.toFixed(3), 'vs', live2.time.toFixed(3));
const st2 = await bot.st();
check('同種子重試：狀態重置（生命、時間、敵人）', st2.player.hp === st2.player.maxHp && st2.time < 0.5 && st2.enemies.every((e) => e.alive));
check('第二局死亡後進入結算', await dieNormally());
await page.waitForTimeout(500);
// 換職業、同種子：佈局不變，職業改變
const cls1 = (await bot.st()).player.cls;
const swapLabel = await page.textContent('#btn-swap');
await page.click('#btn-swap');
await page.waitForFunction(() => window.__sd.state().mode === 'playing', null, { timeout: 30000 });
await page.waitForTimeout(400);
const sigSwap = await signature();
const stSwap = await bot.st();
check('換職業（同種子）：職業改變、生成結果相同', stSwap.player.cls !== cls1 && stSwap.seed === 'RETRY1' && sigSwap === sig1, `${cls1} → ${stSwap.player.cls}（按鈕：${swapLabel}）`);
check('換職業後的一局死亡後進入結算', await dieNormally());
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
