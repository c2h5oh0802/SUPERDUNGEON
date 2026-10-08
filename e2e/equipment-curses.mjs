// 未知裝備、詛咒、除咒卷軸與心眼藥水（生成版本 2，M-C）。
// 物品用「狀態注入」放進背包（debug.giveItem），其餘都走真實介面：I 打開背包、點選物品、按「裝備」「讀」「喝」。
// 讀狀態只用來驗證結果。數值與規則細節在 tests/gearV2.test.ts。
import { Bot, OUT, launch, selectInventoryItem, startRun } from './lib.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:5173/';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
const han = /\p{Script=Han}/u;

const { browser, page, errors } = await launch({ viewport: { width: 1280, height: 720 } });
const bot = new Bot(page);
await page.goto(`${BASE}?dev=1&gfx=low`);
await page.mouse.move(640, 360);
await page.evaluate(() => localStorage.removeItem('superdungeon.run.v1'));
await startRun(page, 'S8');
await page.waitForTimeout(400);
const lang = await page.evaluate(() => document.documentElement.lang);
const zh = !lang.startsWith('en');
const st = () => bot.st();
const idle = () => page.waitForFunction(() => {
  const s = window.__sd.state();
  return s.mode === 'playing' && !s.player.action && !s.player.pendingUse;
}, null, { timeout: 15000 });
const openBag = async () => {
  await page.waitForTimeout(300);
  await page.keyboard.press('KeyI');
  await page.waitForFunction(() => window.__sd.state().mode === 'inventory');
};
const indexOf = async (id) => (await st()).player.items.findIndex((it) => it.id === id);
const action = (index, mode) => page.locator(`#inv-list button[data-k="${index}"][data-m="${mode}"]`);
const toasts = () => page.evaluate(() => [...document.querySelectorAll('#toasts .toast')].map((t) => t.textContent ?? ''));

console.log('INFO 狀態注入：放進背包 未知的重斧（沉重的詛咒、−1）、未知的皮甲（寂靜 +1）、除咒卷軸、心眼藥水');
await page.evaluate(() => {
  const d = window.__sd.debug;
  d.giveItem('weapon:axe', -1, { unknown: true, curse: 'heavy' });
  d.giveItem('armor:leather', 1, { unknown: true, ench: 'silent' });
  d.giveItem('scroll:removecurse', 0);
  d.giveItem('potion:mindvision', 0);
});

// ---- 未知的裝備：只顯示種類 ----
await openBag();
let axe = await indexOf('weapon:axe');
await selectInventoryItem(page, axe);
const tile = await page.textContent(`#inv-list button[data-select="${axe}"]`);
check('未知的裝備只顯示種類', zh ? tile.includes('未知的重斧') && !tile.includes('詛咒') : /Unknown Heavy Axe/.test(tile) && !/Curse/.test(tile), tile);
const detail = await page.textContent(`#inv-list article[data-detail="${axe}"]`);
check('檢視說明提醒可能被詛咒', zh ? detail.includes('詛咒') && detail.includes('卸不下來') : /curse/i.test(detail), detail.slice(0, 120));
check('裝備按鈕標明未知', zh ? (await action(axe, 'use').textContent()).includes('未知') : /unknown/i.test(await action(axe, 'use').textContent()));
await page.screenshot({ path: `${OUT}equipment-curses-unknown.png` });

// ---- 穿上：揭曉並被詛咒 ----
await action(axe, 'use').click();
await idle();
let s = await st();
check('穿上才揭曉：重斧 −1、沉重的詛咒', s.player.weapon.id === 'axe' && s.player.weapon.level === -1 && s.player.weapon.curse === 'heavy', JSON.stringify(s.player.weapon));
const t1 = await toasts();
check('被詛咒的提示', t1.some((x) => (zh ? x.includes('詛咒') : /curse/i.test(x))), JSON.stringify(t1));
const tool = await page.textContent('#tools');
check('工具列顯示詛咒', zh ? tool.includes('沉重的詛咒') : /Heavy Curse/.test(tool), tool);
const buffs = await page.textContent('#buffs');
check('狀態列顯示詛咒', zh ? buffs.includes('沉重的詛咒') : /Heavy Curse/.test(buffs), buffs);

// ---- 詛咒：換不下來 ----
await openBag();
const sword = await indexOf('weapon:longsword');
await selectInventoryItem(page, sword);
check('被詛咒時其他武器的「裝備」停用', await action(sword, 'use').isDisabled());
const blocked = await page.textContent(`#inv-list article[data-detail="${sword}"]`);
check('停用原因：卸不下來', zh ? blocked.includes('卸不下來') : /cannot be removed/i.test(blocked), blocked.slice(0, 160));
const leather = await indexOf('armor:leather');
await selectInventoryItem(page, leather);
check('護甲那一格沒被詛咒，仍可裝備', !(await action(leather, 'use').isDisabled()));
await page.screenshot({ path: `${OUT}equipment-curses-blocked.png` });

// ---- 除咒卷軸 ----
const scroll = await indexOf('scroll:removecurse');
await selectInventoryItem(page, scroll);
await action(scroll, 'use').click();
await idle();
s = await st();
check('讀除咒卷軸：詛咒解除', !s.player.weapon.curse, JSON.stringify(s.player.weapon));
check('除咒卷軸被認得了', s.player.known.includes('scroll:removecurse'));
await openBag();
const sword2 = await indexOf('weapon:longsword');
await selectInventoryItem(page, sword2);
check('解除後可以換回長劍', !(await action(sword2, 'use').isDisabled()));
await page.keyboard.press('KeyI');
await idle();

// ---- 心眼藥水 ----
await openBag();
const potion = await indexOf('potion:mindvision');
await selectInventoryItem(page, potion);
await action(potion, 'use').click();
await idle();
s = await st();
check('喝下心眼藥水', (s.player.mindT ?? 0) > 15, `mindT=${s.player.mindT}`);
// 轉向最近的敵人（方向鍵，真實輸入）
const near = s.enemies.filter((e) => e.alive).sort((a, b) => Math.hypot(a.x - s.player.x, a.z - s.player.z) - Math.hypot(b.x - s.player.x, b.z - s.player.z))[0];
await bot.turnTo(Math.atan2(-(near.x - s.player.x), -(near.z - s.player.z)));
await page.waitForTimeout(500);
const mindIcons = await page.evaluate(() => [...document.querySelectorAll('.eicon.mind')].filter((e) => e.style.display !== 'none').length);
check('隔著牆看到敵人（心眼圖示）', mindIcons > 0, `icons=${mindIcons}`);
check('狀態列顯示心眼倒數', zh ? (await page.textContent('#buffs')).includes('心眼') : /Mind Vision/.test(await page.textContent('#buffs')));
await page.screenshot({ path: `${OUT}equipment-curses-mindvision.png` });

if (!zh) {
  const t = await toasts();
  check('英文介面的提示沒有中文', !t.some((x) => han.test(x)), JSON.stringify(t));
}
check('沒有頁面錯誤', errors.length === 0, errors.join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `\n${failed} 項失敗` : `\n全部 ${results.length} 項通過`);
process.exit(failed ? 1 : 0);
