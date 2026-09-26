// 物品與成長（練習場）：背包、喝未知藥水、讀強化卷軸、裝備重斧、丟藥水、升級選天賦、潛行步。
// 練習場一開始背包裡就有幾樣東西；升級用的經驗是「狀態注入」（debug.giveXp），其餘都是正常輸入（按鍵、點按鈕）。
import { Bot, OUT, launch } from './lib.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:5173/';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

const { browser, page, errors } = await launch({ viewport: { width: 1000, height: 600 } });
const bot = new Bot(page);
await page.goto(`${BASE}?dev=1&gfx=low`);
await page.mouse.move(500, 300);
await page.click('.class-card[data-cls="warrior"]');
await page.click('#btn-practice');
await page.waitForFunction(() => window.__sd?.state().mode === 'playing', null, { timeout: 90000 });
await page.waitForTimeout(400);
const st = () => bot.st();
const idx = async (id) => (await st()).player.items.findIndex((i) => i.id === id);

async function openBag() {
  await bot.tap('KeyI');
  await page.waitForFunction(() => window.__sd.state().mode === 'inventory', null, { timeout: 5000 });
}
async function waitIdle() {
  // 排入的動作要先開始、再結束
  await page.waitForFunction(() => {
    const s = window.__sd.state();
    return s.mode === 'playing' && !s.player.action && !s.player.pendingUse;
  }, null, { timeout: 20000 });
}

let s = await st();
check('練習場：背包裡有 6 樣東西', s.player.items.length === 6, s.player.items.map((i) => i.id).join(','));

// 1) 背包：世界暫停，未知的藥水只顯示外觀
await openBag();
const t0 = (await st()).time;
await page.waitForTimeout(500);
check('打開背包時世界暫停', (await st()).time === t0);
const listText = await page.textContent('#inv-list');
check('未知的藥水只顯示顏色，不顯示效果', !listText.includes('冰霜藥水') && listText.includes('未知的藥水'), listText.slice(0, 60));
await page.screenshot({ path: `${OUT}items-bag.png` });

// 2) 喝未知的冰霜藥水：揭曉，腳下結冰
const frost = await idx('potion:frost');
await page.click(`#inv-list button[data-k="${frost}"][data-m="use"]`);
await waitIdle();
s = await st();
check('喝下未知的藥水：揭曉成「冰霜藥水」', s.player.known.includes('potion:frost'));
check('冰霜藥水喝下去：在腳下結冰', s.areas.some((a) => a.kind === 'frost'), JSON.stringify(s.areas));

// 3) 讀強化卷軸：選擇畫面，選武器
await openBag();
await page.click(`#inv-list button[data-k="${await idx('scroll:upgrade')}"][data-m="use"]`);
await page.waitForFunction(() => window.__sd.state().mode === 'choice', null, { timeout: 20000 });
const choiceText = await page.textContent('#choice-cards');
check('強化卷軸：跳出選擇畫面（武器、臂盾）', choiceText.includes('長劍') && choiceText.includes('臂盾'), choiceText.slice(0, 60));
await page.screenshot({ path: `${OUT}items-upgrade.png` });
await page.click('#choice-cards .rune-card[data-idx="0"]');
await page.waitForFunction(() => window.__sd.state().mode === 'playing', null, { timeout: 5000 });
s = await st();
check('選了武器：長劍 +1', s.player.weapon.id === 'longsword' && s.player.weapon.level === 1, JSON.stringify(s.player.weapon));
const toolHas = (t) => page.waitForFunction((t) => document.getElementById('tools').textContent.includes(t), t, { timeout: 3000 }).then(() => true, () => false);
check('工具列顯示「長劍 +1」', await toolHas('長劍 +1'), await page.textContent('#tools'));

// 4) 裝備重斧：長劍 +1 回到背包
await openBag();
await page.click(`#inv-list button[data-k="${await idx('weapon:axe')}"][data-m="use"]`);
await waitIdle();
s = await st();
check('換上重斧；長劍 +1 回到背包', s.player.weapon.id === 'axe' && s.player.items.some((i) => i.id === 'weapon:longsword' && i.level === 1));
check('工具列顯示「重斧」', await toolHas('重斧'), await page.textContent('#tools'));

// 5) 丟出火焰藥水：碎開處燒起來、揭曉
await bot.pitchTo(0.05, 0.05);
await openBag();
await page.click(`#inv-list button[data-k="${await idx('potion:fire')}"][data-m="throw"]`);
await page.waitForFunction(() => window.__sd.state().areas.some((a) => a.kind === 'fire'), null, { timeout: 30000 });
s = await st();
check('丟出的藥水碎開：燒起一片火，藥水被認出來', s.player.known.includes('potion:fire'));
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}items-fire.png` });

// 6) 升級：選天賦（經驗是狀態注入）
await page.evaluate(() => window.__sd.debug.giveXp(10));
console.log('INFO 狀態注入：給 10 經驗');
await page.waitForFunction(() => window.__sd.state().mode === 'choice', null, { timeout: 10000 });
s = await st();
check('升到第 2 級：跳出天賦選擇（兩個戰士天賦）', s.player.level === 2 && s.pendingChoice?.kind === 'talent' && s.pendingChoice.options.length === 2, JSON.stringify(s.pendingChoice));
await page.screenshot({ path: `${OUT}items-talent.png` });
await page.keyboard.press('Digit1');
await page.waitForFunction(() => window.__sd.state().mode === 'playing', null, { timeout: 5000 });
s = await st();
check('按 1 選了天賦', s.player.talents.length === 1, s.player.talents.join(','));

// 7) 潛行步
await bot.down('ShiftLeft');
await bot.down('KeyW');
await page.waitForTimeout(700);
s = await st();
const stealthText = await page.textContent('#stealth');
await bot.releaseAll();
check('按住 Shift 走：潛行步，HUD 顯示安靜', s.player.sneaking && stealthText.includes('潛行'), stealthText);

check('全程無 console 錯誤', errors.length === 0, errors.join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
