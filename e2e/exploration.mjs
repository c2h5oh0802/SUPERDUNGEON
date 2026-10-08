// 地城探索（生成版本 2）：秘密門與搜索、寶庫鑰匙與上鎖門、三選一台座、陷阱、深坑墜落、地圖。
// 到達目標位置用的是「狀態注入」（debug.teleport、debug.descend），其餘都是正常輸入：
// 按住空白鍵等待（搜索）、E 互動、W 前進、Tab 地圖。讀狀態只用來決定位置與驗證結果。
import { Bot, OUT, launch, startRun, yawTo } from './lib.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:5173/';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
const han = /\p{Script=Han}/u;

const { browser, page, errors } = await launch({ viewport: { width: 960, height: 540 } });
const bot = new Bot(page);
await page.goto(`${BASE}?dev=1&gfx=low`);
await page.mouse.move(480, 270);
await page.evaluate(() => localStorage.removeItem('superdungeon.run.v1'));
// S8：第 2 層同時有上鎖寶庫與秘密藏室
await startRun(page, 'S8');
await page.waitForTimeout(400);
const st = () => bot.st();
const dungeon = () => page.evaluate(() => window.__sd.dungeon());
const inject = async (label, x, z, yaw = null) => {
  await page.evaluate(([x, z]) => window.__sd.debug.teleport(x, z), [x, z]);
  if (yaw !== null) await page.evaluate(([y]) => window.__sd.debug.setView(y, 0), [yaw]);
  console.log(`INFO 狀態注入：傳送到${label}`, x.toFixed(1), z.toFixed(1));
  await page.waitForTimeout(250);
};
const toasts = () => page.evaluate(() => [...document.querySelectorAll('#toasts .toast')].map((t) => t.textContent ?? ''));

let d = await dungeon();
check('新局使用程序化樓層（生成版本 2）', d.gen === 2, `gen=${d.gen}`);
const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('superdungeon.run.v1') ?? 'null'));
check('存檔記錄生成版本 2', saved?.gen === 2, JSON.stringify({ gen: saved?.gen, floor: saved?.floor }));

console.log('INFO 狀態注入：直接走下第 1 層（debug.descend）');
await page.evaluate(() => window.__sd.debug.descend());
await page.waitForFunction(() => window.__sd?.state().mode === 'playing' && window.__sd.state().floor === 2, null, { timeout: 90000 });
await page.waitForTimeout(400);
d = await dungeon();
const secret = d.doors.find((x) => x.hidden);
const locked = d.doors.find((x) => x.locked);
check('第 2 層有秘密門與上鎖的寶庫門', !!secret && !!locked, JSON.stringify(d.doors));

/** 門前可以站的一側。 */
async function doorSide(door, dist) {
  const off = door.axis === 'x' ? [[0, dist], [0, -dist]] : [[dist, 0], [-dist, 0]];
  for (const [dx, dz] of off) {
    const x = door.cx + dx;
    const z = door.cz + dz;
    const ok = await page.evaluate(([x, z]) => window.__sd.pathTo(x, z) !== null, [x, z]);
    if (ok) return { x, z };
  }
  return null;
}

// ---- 秘密門：按住空白鍵等待＝搜索 ----
const sSpot = await doorSide(secret, 2.4);
await inject('秘密門前', sSpot.x, sSpot.z, yawTo(sSpot.x, sSpot.z, secret.cx, secret.cz) + Math.PI);
let s = await st();
const t0 = s.time;
check('秘密門被發現前不能互動', s.interactTarget?.kind !== 'door', JSON.stringify(s.interactTarget));
await page.keyboard.down('Space');
await page.waitForFunction((id) => !window.__sd.dungeon().doors.find((x) => x.id === id).hidden, secret.id, { timeout: 20000 }).catch(() => {});
await page.keyboard.up('Space');
d = await dungeon();
s = await st();
check('按住空白鍵搜索揭開秘密門', !d.doors.find((x) => x.id === secret.id).hidden);
check('搜索要付世界時間', s.time - t0 >= 0.9, `${(s.time - t0).toFixed(2)} 世界秒`);
const tt = await toasts();
const lang = await page.evaluate(() => document.documentElement.lang);
if (lang.startsWith('en')) check('發現秘密門的提示（英文介面）', tt.some((x) => /secret door/i.test(x)) && !tt.some((x) => han.test(x)), JSON.stringify(tt));
else check('發現秘密門的提示（繁中介面）', tt.some((x) => x.includes('秘密門')), JSON.stringify(tt));
const sNear = await doorSide(secret, 1.6);
await inject('秘密門前（靠近）', sNear.x, sNear.z, yawTo(sNear.x, sNear.z, secret.cx, secret.cz));
s = await st();
check('秘密門現在可以打開', s.interactTarget?.kind === 'door' && s.interactTarget.enabled, JSON.stringify(s.interactTarget));
await bot.tap('KeyE');
await page.waitForTimeout(900);
d = await dungeon();
check('E 打開秘密門', d.doors.find((x) => x.id === secret.id).progress > 0.5);
await page.screenshot({ path: `${OUT}exploration-secret.png` });

// ---- 上鎖的寶庫：沒有鑰匙打不開 ----
const lSpot = await doorSide(locked, 1.5);
await inject('寶庫門前', lSpot.x, lSpot.z, yawTo(lSpot.x, lSpot.z, locked.cx, locked.cz));
s = await st();
check('沒有鑰匙時寶庫門顯示需要鑰匙', s.interactTarget?.kind === 'door' && !s.interactTarget.enabled, s.interactTarget?.label);
const key = d.keyPickups[0];
await inject('鑰匙旁', key.x, key.z + 1.2, 0);
await bot.down('KeyW');
await page.waitForFunction(() => window.__sd.dungeon().keys > 0, null, { timeout: 8000 }).catch(() => {});
await bot.up('KeyW');
d = await dungeon();
check('走過去撿到寶庫鑰匙', d.keys === 1, `keys=${d.keys}`);
await inject('寶庫門前', lSpot.x, lSpot.z, yawTo(lSpot.x, lSpot.z, locked.cx, locked.cz));
await bot.tap('KeyE');
await page.waitForTimeout(1200);
d = await dungeon();
check('用鑰匙打開寶庫（鑰匙用掉）', !d.doors.find((x) => x.id === locked.id).locked && d.keys === 0);

// ---- 寶庫三選一 ----
const ped = d.pedestals[1];
await inject('台座前', ped.x, ped.z + 1.2, 0);
s = await st();
check('台座標明寶物種類（三選一）', s.interactTarget?.kind === 'pedestal' && /三選一|choose one of three/i.test(await page.textContent('#prompt').catch(() => '') || s.interactTarget.label), s.interactTarget?.label);
const bagBefore = s.player.items?.length ?? 0;
await bot.tap('KeyE');
await page.waitForTimeout(1200);
d = await dungeon();
s = await st();
check('選了一件，三座台座都用掉', d.pedestals.every((p) => p.used));
check('寶物進了背包', (s.player.items?.length ?? 0) > bagBefore, `${bagBefore} → ${s.player.items?.length}`);
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}exploration-vault.png` });

// ---- 地圖 ----
await bot.tap('Tab');
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}exploration-map.png` });
await bot.tap('Tab');

// ---- 深坑：走進去掉到下一層 ----
const floor = (await st()).floor;
let hole = null;
for (let f = floor; f <= 4 && !hole; f++) {
  d = await dungeon();
  if (d.cells.chasm.length) {
    for (const [i, j] of d.cells.chasm) {
      for (const [dx, dz] of [[0, 1.6], [0, -1.6], [1.6, 0], [-1.6, 0]]) {
        const x = i + 0.5 + dx;
        const z = j + 0.5 + dz;
        if (await page.evaluate(([x, z]) => window.__sd.pathTo(x, z) !== null, [x, z])) { hole = { i, j, x, z }; break; }
      }
      if (hole) break;
    }
  }
  if (!hole) {
    console.log('INFO 狀態注入：這一層沒有深坑，走下去找下一層');
    await page.evaluate(() => window.__sd.debug.descend());
    await page.waitForFunction((f) => window.__sd?.state().mode === 'playing' && window.__sd.state().floor === f + 1, f, { timeout: 90000 });
    await page.waitForTimeout(300);
  }
}
if (hole) {
  const from = (await st()).floor;
  await page.evaluate(() => window.__sd.debug.setHp(10));
  await inject('深坑邊緣', hole.x, hole.z, yawTo(hole.x, hole.z, hole.i + 0.5, hole.j + 0.5));
  await page.screenshot({ path: `${OUT}exploration-chasm.png` });
  await bot.down('KeyW');
  await page.waitForFunction((f) => window.__sd?.state().floor === f + 1 && window.__sd.state().mode === 'playing', from, { timeout: 90000 }).catch(() => {});
  await bot.up('KeyW');
  await page.waitForTimeout(500);
  s = await st();
  check('走進深坑掉到下一層', s.floor === from + 1, `floor ${from} → ${s.floor}`);
  check('墜落受傷但還活著', s.player.hp < 10 && s.player.hp > 0, `hp=${s.player.hp}`);
  const sv = await page.evaluate(() => JSON.parse(localStorage.getItem('superdungeon.run.v1') ?? 'null'));
  check('存檔記錄是掉下來的', sv?.arrival === 'fall', JSON.stringify({ floor: sv?.floor, arrival: sv?.arrival }));
} else check('找到可以走進去的深坑', false);

check('沒有頁面錯誤', errors.length === 0, errors.join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `\n${failed} 項失敗` : `\n全部 ${results.length} 項通過`);
process.exit(failed ? 1 : 0);
