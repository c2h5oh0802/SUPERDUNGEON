// 逐層骨架：第 1 層 → 往下的階梯 → … → 第 4 層取得沉眠之心；中途重新整理，從主選單「繼續」。
// 走到每層目標旁邊用的是「狀態注入」（debug.teleport），其餘都是正常輸入（E 互動、點按鈕）。
// 原因：自動化腳本無法可靠地打穿四層；這裡要驗證的是樓層切換、跨層保留與存檔。
import { Bot, OUT, launch, startRun, yawTo } from './lib.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:5173/';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

const { browser, page, errors } = await launch({ viewport: { width: 800, height: 450 } });
const bot = new Bot(page);
await page.goto(`${BASE}?dev=1&gfx=low`);
await page.mouse.move(400, 225);
await page.evaluate(() => localStorage.removeItem('superdungeon.run.v1'));
await page.reload();
await page.mouse.move(400, 225);
check('沒有存檔時不顯示「繼續」', await page.locator('#btn-continue').isHidden());
await page.click('.class-card[data-cls="huntress"]');
await startRun(page, 'FLOORS1');
await page.waitForTimeout(400);
const st = () => bot.st();

/** 狀態注入：傳送到目標旁邊可以站的位置，再用 E 互動。 */
async function useGoal() {
  const s = await st();
  const h = s.interactables.find((i) => i.kind === 'heart');
  let spot = null;
  for (let k = 0; k < 16 && !spot; k++) {
    const a = (k / 16) * Math.PI * 2;
    const x = h.x + Math.cos(a) * 1.25;
    const z = h.z + Math.sin(a) * 1.25;
    const clear = await page.evaluate(([x, z, hx, hz]) => window.__sd.lineOfSight(x, 1.6, z, hx, 1.6, hz) && window.__sd.pathTo(x, z) !== null, [x, z, h.x, h.z]);
    if (clear) spot = { x, z };
  }
  await page.evaluate(([x, z]) => window.__sd.debug.teleport(x, z), [spot.x, spot.z]);
  console.log(`INFO 狀態注入：第 ${s.floor} 層傳送到目標旁`, spot.x.toFixed(1), spot.z.toFixed(1));
  const p = (await st()).player;
  await page.evaluate(([yaw]) => window.__sd.debug.setView(yaw, 0), [yawTo(p.x, p.z, h.x, h.z)]);
  await page.waitForTimeout(300);
  const t = (await st()).interactTarget;
  await bot.tap('KeyE');
  return t;
}

async function waitFloor(f) {
  await page.waitForFunction((f) => window.__sd?.state().mode === 'playing' && window.__sd.state().floor === f, f, { timeout: 90000 });
  await page.waitForTimeout(300);
}

const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('superdungeon.run.v1') ?? 'null'));

let s = await st();
check('第 1 層開始', s.floor === 1 && s.goal === 'descend', `floor=${s.floor} goal=${s.goal}`);
check('HUD 目標顯示樓層', (await page.textContent('#objective')).includes('第 1 / 4 層'), await page.textContent('#objective'));
check('第 1 層開頭自動存檔', (await saved())?.floor === 1);
const t1 = await useGoal();
check('目標提示是「走下階梯」', !!t1 && t1.label.includes('走下階梯'), t1?.label);
await waitFloor(2);
s = await st();
check('走下階梯後進入第 2 層', s.floor === 2 && s.run?.floor === 2);
check('第 2 層開頭自動存檔（樓層、物資）', (await saved())?.floor === 2 && (await saved())?.carry?.arrows === s.player.arrows);
await page.screenshot({ path: `${OUT}floors-2.png` });

// 換掉一點物資，再重新整理，從「繼續」回來
await page.evaluate(() => window.__sd.debug.setHp(7));
const before = await saved();
await page.reload();
await page.mouse.move(400, 225);
const cont = page.locator('#btn-continue');
check('重新整理後出現「繼續」', await cont.isVisible(), await cont.textContent());
check('「繼續」顯示樓層、職業、種子', (await cont.textContent()).includes('第 2 / 4 層') && (await cont.textContent()).includes('獵手'), await cont.textContent());
await cont.click();
await waitFloor(2);
s = await st();
check('從存檔繼續：同一個種子的第 2 層、同一個職業', s.seed === 'FLOORS1' && s.floor === 2 && s.player.cls === 'huntress');
check('從存檔繼續：生命是進入這一層時的值（不是之後改的 7）', s.player.hp === before.carry.hp, `hp=${s.player.hp} saved=${before.carry.hp}`);

await useGoal();
await waitFloor(3);
await useGoal();
await waitFloor(4);
s = await st();
check('第 4 層（最底層）目標是沉眠之心', s.goal === 'heart' && (await page.textContent('#objective')).includes('最底層'), await page.textContent('#objective'));
await page.screenshot({ path: `${OUT}floors-4.png` });
const t4 = await useGoal();
check('最底層的提示是「取走沉眠之心」', !!t4 && t4.label.includes('沉眠之心'), t4?.label);
await page.waitForFunction(() => window.__sd.state().mode === 'results', null, { timeout: 30000 });
s = await st();
check('取得沉眠之心就通關', s.outcome === 'win');
const res = await page.textContent('#res-stats');
check('結算顯示到達樓層', res.includes('第 4 / 4 層'), res.slice(0, 80));
check('通關後清除存檔', (await saved()) === null);
await page.screenshot({ path: `${OUT}floors-results.png` });

check('全程無 console 錯誤', errors.length === 0, errors.join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
