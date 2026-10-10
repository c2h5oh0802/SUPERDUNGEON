// Time-play prototypes: the clockwork corridor and the crossfire arena with its replay.
// Real controls for entering, standing still, holding wait, walking, firing and skipping.
// State injection, labelled below: a teleport to the chest (the corridor's timing is
// covered by tests/timePrototypes.test.ts) and enemy defeats to reach the fight's goal.
// The replay itself is started by the developer hook replayNow(), which only plays
// what has been recorded; the natural trigger is covered in unit tests.
import { BASE, Bot, OUT, launch } from './lib.mjs';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

const { browser, page, errors } = await launch({ viewport: { width: 1280, height: 720 } });
const bot = new Bot(page);
const st = () => bot.st();
const mode = (m) => page.waitForFunction((m) => window.__sd?.state().mode === m, m, { timeout: 30000 });
const zh = async () => !(await page.evaluate(() => document.documentElement.lang)).startsWith('en');

try {
  await page.goto(`${BASE}?dev=1&gfx=low`);
  await page.click('.class-card[data-cls="huntress"]');
  await page.click('#btn-trials');
  for (const id of ['clockwork-corridor', 'crossfire-arena', 'crossfire-waves', 'crossfire-quick']) check(`練習選單有 ${id}`, await page.locator(`#btn-${id}`).isVisible());

  // ---- 機關走廊 ----
  await page.click('#btn-clockwork-corridor');
  await mode('playing');
  await page.waitForTimeout(400);
  let s = await st();
  check('進入機關走廊', s.practiceTrial === 'clockwork-corridor' && s.machines.length > 10, `machines=${s.machines.length}`);
  check('只用職業起始物資', s.player.items.length === 0, JSON.stringify(s.player.items));
  const t0 = s.time, r0 = s.realTime;
  await page.waitForTimeout(1500);
  s = await st();
  const idleRate = (s.time - t0) / (s.realTime - r0);
  check('站著不動：世界（機關）只走約 1/10', idleRate > 0.05 && idleRate < 0.15, `rate=${idleRate.toFixed(3)}`);
  const cycles = s.machines.map((m) => m.cycle);
  await bot.down('Space');
  await page.waitForFunction((t) => window.__sd.state().time > t + 1.6, s.time, { timeout: 20000 });
  await bot.releaseAll();
  s = await st();
  check('按住等待：機關照節奏發動', s.machines.some((m, k) => m.cycle > cycles[k]), `cycles ${cycles.slice(0, 3)} → ${s.machines.slice(0, 3).map((m) => m.cycle)}`);
  check('畫面上有正在預警或發動的機關', s.machines.some((m) => m.phase !== 'idle'));
  await page.screenshot({ path: `${OUT}time-corridor.png` });

  console.log('INFO 狀態注入：傳送到寶箱前（走廊的時機由單元測試的機器人驗證）');
  await page.evaluate(() => { window.__sd.debug.teleport(20.5, 3.75); window.__sd.debug.setView(0, 0); });
  await page.waitForTimeout(200);
  await bot.tap('KeyE');
  await page.waitForFunction(() => window.__sd.state().stats?.chests > 0 || window.__sd.state().player?.lastAction?.kind === 'open', null, { timeout: 5000 }).catch(() => {});
  await bot.down('Space');
  await page.waitForTimeout(800);
  await bot.releaseAll();
  const objective = await page.textContent('#objective');
  check('打開寶箱：目標完成並顯示停下來看的比例', (await zh()) ? objective.includes('目標完成') && objective.includes('停下來看') : /Objective complete/.test(objective) && /Stopped to read/.test(objective), objective);
  await page.screenshot({ path: `${OUT}time-corridor-done.png` });
  await bot.tap('Escape');
  await mode('paused');
  const pauseInfo = await page.textContent('#pause-info');
  check('暫停資訊也有停下來看的比例', (await zh()) ? pauseInfo.includes('停下來看') : /Stopped to read/.test(pauseInfo), pauseInfo);
  await page.click('#btn-quit');
  await mode('menu');

  // ---- 四面來襲 ----
  await page.click('#btn-trials');
  await page.click('#btn-crossfire-arena');
  await mode('playing');
  await page.waitForTimeout(400);
  s = await st();
  check('進入四面來襲：五名敵人，正在記錄', s.practiceTrial === 'crossfire-arena' && s.enemies.length === 5 && s.recording?.frames > 0, JSON.stringify(s.recording));
  // Real input: walk to the opening, look around, shoot a few times.
  await bot.down('KeyW');
  await page.waitForTimeout(900);
  await bot.releaseAll();
  await bot.tap('Digit2');
  for (let k = 0; k < 3; k++) {
    await page.mouse.down();
    await page.waitForTimeout(250);
    await page.mouse.up();
    await page.mouse.move(640 + (k + 1) * 30, 360);
    await page.waitForTimeout(250);
  }
  s = await st();
  const recorded = s.recording.frames;
  check('戰鬥中的輸入都被記錄', recorded > 30 && !s.recording.tainted, `frames=${recorded}`);
  const worldAtReplay = s.time;
  const ok = await page.evaluate(() => window.__sd.debug.replayNow());
  check('開始重播（開發者入口，只播已記錄的內容）', ok === true);
  await mode('replay');
  check('重播時顯示橫幅、隱藏 HUD', await page.locator('#replay-banner').isVisible() && !(await page.locator('#hud').isVisible()));
  const rp0 = (await st()).replay;
  await page.waitForTimeout(700);
  const rp1 = (await st()).replay;
  check('重播從頭快轉推進世界時間，沒有偏差', rp1 && rp0.from === 0 && rp1.time > rp0.time && !rp1.diverged, `from ${rp0.from.toFixed(2)} → ${rp1.time.toFixed(2)} / ${rp1.to.toFixed(2)}`);
  await page.screenshot({ path: `${OUT}time-replay.png` });
  await bot.tap('KeyF');
  await mode('playing');
  s = await st();
  check('任意鍵跳過重播，回到原本的世界', !(await page.locator('#replay-banner').isVisible()) && Math.abs(s.time - worldAtReplay) < 0.5 && s.replay === null, `time ${worldAtReplay.toFixed(2)} → ${s.time.toFixed(2)}`);

  // A fresh attempt records from the start again.
  await bot.tap('Escape');
  await mode('paused');
  await page.click('#btn-restart');
  await mode('playing');
  await page.waitForTimeout(400);
  s = await st();
  check('重置練習：重新開始記錄', s.recording?.frames > 0 && !s.recording.tainted, JSON.stringify(s.recording));
  console.log('INFO 狀態注入：直接擊倒五名敵人（之後不會自動重播：世界被開發工具改過）');
  await page.evaluate(() => { for (const e of window.__sd.state().enemies) window.__sd.debug.defeatEnemy(e.id); });
  await page.waitForTimeout(300);
  // Five kills are enough XP for a level: pick a talent with the real key first.
  if ((await st()).mode === 'choice') {
    console.log('INFO 升級：按 1 選天賦');
    await bot.tap('Digit1');
    await mode('playing');
  }
  await page.waitForTimeout(2200);
  s = await st();
  check('世界被開發工具改過：不重播', s.mode === 'playing' && s.recording?.tainted === true && s.replay === null, JSON.stringify(s.recording));
  const fightObjective = await page.textContent('#objective');
  check('清場：目標完成並顯示戰鬥中停下來看的比例', (await zh()) ? fightObjective.includes('目標完成') && fightObjective.includes('戰鬥中停下來看') : /Objective complete/.test(fightObjective) && /Stopped to read in combat/.test(fightObjective), fightObjective);
  await page.screenshot({ path: `${OUT}time-crossfire-done.png` });
  await bot.tap('Escape');
  await mode('paused');
  await page.click('#btn-quit');
  await mode('menu');

  // ---- 四面來襲 v2：三波 ----
  await page.click('#btn-trials');
  await page.click('#btn-crossfire-waves');
  await mode('playing');
  await page.waitForTimeout(400);
  s = await st();
  check('進入四面來襲 v2：第一波五名敵人，還有兩波', s.practiceTrial === 'crossfire-waves' && s.enemies.length === 5 && s.waves.left === 2 && s.enemies.every((e) => e.hp === 2), JSON.stringify(s.waves));
  console.log('INFO 狀態注入：每一波直接擊倒（之後不會自動重播）');
  const toastsSeen = [];
  for (let wave = 0; wave < 3; wave++) {
    await page.evaluate(() => { for (const e of window.__sd.state().enemies) if (e.alive) window.__sd.debug.defeatEnemy(e.id); });
    for (let k = 0; k < 20; k++) {
      await page.waitForTimeout(150);
      if ((await st()).mode === 'choice') { await bot.tap('Digit1'); await mode('playing'); }
      // Toasts fade after a couple of seconds: read them while they are up.
      toastsSeen.push(...await page.evaluate(() => [...document.querySelectorAll('#toasts .toast')].map((t) => t.textContent ?? '')));
    }
  }
  s = await st();
  const wavesText = [...new Set(toastsSeen)].join(' | ');
  check('後兩波依序進場（有提示）', s.waves.spawned === 2 && s.enemies.length === 14 && ((await zh()) ? wavesText.includes('第二波') && wavesText.includes('第三波') : /Second wave/.test(wavesText) && /Third wave/.test(wavesText)), wavesText);
  const v2Objective = await page.textContent('#objective');
  check('三波清完：目標完成', s.enemies.every((e) => !e.alive) && ((await zh()) ? v2Objective.includes('目標完成') : /Objective complete/.test(v2Objective)), v2Objective);
  await bot.tap('Escape');
  await mode('paused');
  await page.click('#btn-quit');
  await mode('menu');

  // ---- 四面來襲 v5：兩波、快、弩手全部預判、齊射一個接一個鎖定 ----
  await page.click('#btn-trials');
  await page.click('#btn-crossfire-quick');
  await mode('playing');
  await page.waitForTimeout(400);
  s = await st();
  check('進入四面來襲 v5：第一波五名敵人，還有一波', s.practiceTrial === 'crossfire-quick' && s.enemies.length === 5 && s.waves.left === 1 && s.enemies.every((e) => e.hp === 2), JSON.stringify(s.waves));
  check('弩手全部預判', s.enemies.filter((e) => e.kind === 'archer').map((e) => e.leads).join() === 'true,true', JSON.stringify(s.enemies.filter((e) => e.kind === 'archer').map((e) => [e.x, e.leads])));
  console.log('INFO 狀態注入：每一波直接擊倒（之後不會自動重播）');
  const v3Toasts = [];
  for (let wave = 0; wave < 2; wave++) {
    await page.evaluate(() => { for (const e of window.__sd.state().enemies) if (e.alive) window.__sd.debug.defeatEnemy(e.id); });
    for (let k = 0; k < 20; k++) {
      await page.waitForTimeout(150);
      if ((await st()).mode === 'choice') { await bot.tap('Digit1'); await mode('playing'); }
      v3Toasts.push(...await page.evaluate(() => [...document.querySelectorAll('#toasts .toast')].map((t) => t.textContent ?? '')));
    }
  }
  s = await st();
  const v3Text = [...new Set(v3Toasts)].join(' | ');
  check('第二波進場（有提示）', s.waves.spawned === 1 && s.enemies.length === 10 && ((await zh()) ? v3Text.includes('第二波') : /Second wave/.test(v3Text)), v3Text);
  const v3Objective = await page.textContent('#objective');
  check('兩波清完：目標完成', s.enemies.every((e) => !e.alive) && ((await zh()) ? v3Objective.includes('目標完成') : /Objective complete/.test(v3Objective)), v3Objective);
  check('沒有頁面錯誤', errors.length === 0, errors.join(' | '));
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `\n${failed} 項失敗` : `\n全部 ${results.length} 項通過`);
process.exit(failed ? 1 : 0);
