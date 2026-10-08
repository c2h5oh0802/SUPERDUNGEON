// 新敵人（生成版本 2）：溝鼠群、投彈手、號角哨兵、寶箱怪、石像守衛、精英持鑰者。
// 到達位置用「狀態注入」（debug.teleport、debug.descend、debug.setInvisible、debug.advance 快轉世界時間），
// 互動用正常輸入（E）。讀狀態只用來決定位置與驗證結果。出手時機、打斷與數值在 tests/enemiesV2.test.ts。
import { Bot, OUT, launch, startRun, yawTo } from './lib.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:5173/';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

const { browser, page, errors } = await launch({ viewport: { width: 960, height: 540 } });
const bot = new Bot(page);
await page.goto(`${BASE}?dev=1&gfx=low`);
await page.mouse.move(480, 270);
await page.evaluate(() => localStorage.removeItem('superdungeon.run.v1'));
await startRun(page, 'S8');
await page.waitForTimeout(400);
const st = () => bot.st();
const dungeon = () => page.evaluate(() => window.__sd.dungeon());
const toasts = () => page.evaluate(() => [...document.querySelectorAll('#toasts .toast')].map((t) => t.textContent ?? ''));
const lang = await page.evaluate(() => document.documentElement.lang);
const zh = !lang.startsWith('en');
const descend = async (f) => {
  console.log(`INFO 狀態注入：直接走下第 ${f - 1} 層（debug.descend）`);
  await page.evaluate(() => window.__sd.debug.descend());
  await page.waitForFunction((f) => window.__sd?.state().mode === 'playing' && window.__sd.state().floor === f, f, { timeout: 90000 });
  await page.waitForTimeout(400);
};
/** 找一個能站、看得到目標、不在深坑旁的位置，傳送過去並面向目標。 */
async function faceFrom(label, tx, tz, radii = [3.2, 2.6, 4]) {
  const chasm = (await dungeon()).cells.chasm;
  for (const r of radii) for (let a = 0; a < 8; a++) {
    const x = tx + Math.sin(a * Math.PI / 4) * r;
    const z = tz + Math.cos(a * Math.PI / 4) * r;
    if (chasm.some(([i, j]) => Math.hypot(i + 0.5 - x, j + 0.5 - z) < 2.2)) continue;
    const ok = await page.evaluate(([x, z, tx, tz]) => window.__sd.pathTo(x, z) !== null && window.__sd.lineOfSight(x, 1.6, z, tx, 1.0, tz), [x, z, tx, tz]);
    if (!ok) continue;
    await page.evaluate(([x, z, yaw]) => { window.__sd.debug.teleport(x, z); window.__sd.debug.setView(yaw, -0.15); }, [x, z, yawTo(x, z, tx, tz)]);
    console.log(`INFO 狀態注入：傳送到${label}前`, x.toFixed(1), z.toFixed(1));
    await page.waitForTimeout(400);
    return { x, z };
  }
  return null;
}

// ---- 第 1 層：溝鼠群 ----
let s = await st();
const rats = s.enemies.filter((e) => e.kind === 'rat');
check('第 1 層有溝鼠群（三隻以上）', rats.length >= 3, `rats=${rats.length}`);
check('第 1 層沒有投彈手、號角哨兵、石像', !s.enemies.some((e) => ['bomber', 'sentry', 'statue'].includes(e.kind)));
await page.evaluate(() => window.__sd.debug.setInvisible(60));
if (await faceFrom('溝鼠', rats[0].x, rats[0].z)) await page.screenshot({ path: `${OUT}enemies-v2-rats.png` });

// ---- 第 2 層：精英持鑰者、投彈手、石像守衛 ----
await descend(2);
s = await st();
check('第 2 層出現投彈手', s.enemies.some((e) => e.kind === 'bomber'));
const carrier = s.enemies.find((e) => e.carriesKey);
const d2 = await dungeon();
check('寶庫鑰匙由精英敵人攜帶（地上沒有鑰匙）', !!carrier && carrier.veteran && !!carrier.elite && d2.keyPickups.length === 0,
  JSON.stringify(carrier && { kind: carrier.kind, veteran: carrier.veteran, elite: carrier.elite }));
await page.evaluate(() => window.__sd.debug.setInvisible(60));
if (carrier && await faceFrom('持鑰者', carrier.x, carrier.z)) {
  await page.waitForTimeout(300);
  const icon = await page.evaluate(() => [...document.querySelectorAll('.eicon.keyed')].filter((e) => e.style.display !== 'none').map((e) => e.textContent));
  check('持鑰者頭上有金色★', icon.length > 0 && icon.every((t) => t.includes('★')), JSON.stringify(icon));
  await page.screenshot({ path: `${OUT}enemies-v2-carrier.png` });
} else check('找到可以看見持鑰者的位置', false);

const statue = s.enemies.find((e) => e.kind === 'statue');
check('第 2 層有石像大廳，石像沉睡不動', !!statue && (await st()).enemies.find((e) => e.id === statue.id).dormant);
const ped = d2.pedestals.find((p) => p.roomKey === statue?.roomKey);
let statueWoke = false;
if (ped) {
  await page.evaluate(() => window.__sd.debug.setInvisible(0));
  for (const [dx, dz] of [[0, 1.2], [0, -1.2], [1.2, 0], [-1.2, 0]]) {
    const x = ped.x + dx;
    const z = ped.z + dz;
    if (!(await page.evaluate(([x, z]) => window.__sd.pathTo(x, z) !== null, [x, z]))) continue;
    await page.evaluate(([x, z, yaw]) => { window.__sd.debug.teleport(x, z); window.__sd.debug.setView(yaw, -0.3); }, [x, z, yawTo(x, z, ped.x, ped.z)]);
    await page.waitForTimeout(300);
    if ((await st()).interactTarget?.kind === 'pedestal') break;
  }
  console.log('INFO 狀態注入：傳送到石像前的台座');
  s = await st();
  check('台座上的武器標明種類', s.interactTarget?.kind === 'pedestal', s.interactTarget?.label);
  await bot.tap('KeyE');
  await page.waitForFunction((id) => !window.__sd.state().enemies.find((e) => e.id === id).dormant, statue.id, { timeout: 8000 }).catch(() => {});
  s = await st();
  const st2 = s.enemies.find((e) => e.id === statue.id);
  statueWoke = !st2.dormant && st2.state === 'alert';
  check('拿走台座上的武器，石像醒來', statueWoke, JSON.stringify({ dormant: st2.dormant, state: st2.state }));
  const t = await toasts();
  check('石像醒來的提示', t.some((x) => (zh ? x.includes('石像') : /statue/i.test(x))), JSON.stringify(t));
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}enemies-v2-statue.png` });
} else check('石像房裡有台座', false);

// ---- 第 3 層：寶箱怪、號角哨兵 ----
await page.evaluate(() => window.__sd.debug.setHp(10));
await descend(3);
s = await st();
const mimic = s.enemies.find((e) => e.kind === 'mimic');
check('第 3 層有一隻寶箱怪，外表是寶箱', !!mimic && mimic.disguised);
if (mimic) {
  // 在寶箱怪正前方 1.5 m 找能站的位置
  let ok = false;
  for (const [dx, dz] of [[0, 1.5], [0, -1.5], [1.5, 0], [-1.5, 0]]) {
    const x = mimic.x + dx;
    const z = mimic.z + dz;
    if (!(await page.evaluate(([x, z]) => window.__sd.pathTo(x, z) !== null, [x, z]))) continue;
    await page.evaluate(([x, z, yaw]) => { window.__sd.debug.teleport(x, z); window.__sd.debug.setView(yaw, -0.45); }, [x, z, yawTo(x, z, mimic.x, mimic.z)]);
    await page.waitForTimeout(250);
    if ((await st()).interactTarget?.kind === 'mimic') { ok = true; break; }
  }
  console.log('INFO 狀態注入：傳送到寶箱怪前');
  s = await st();
  check('寶箱怪的互動提示和普通寶箱一樣', ok && /寶箱|chest/i.test(s.interactTarget?.label ?? ''), s.interactTarget?.label);
  const hud = await page.evaluate(() => [...document.querySelectorAll('.eicon')].filter((e) => e.style.display !== 'none').length);
  check('偽裝中的寶箱怪頭上沒有任何圖示', hud === 0, `visible icons=${hud}`);
  await page.screenshot({ path: `${OUT}enemies-v2-mimic-closed.png` });
  await bot.tap('KeyE');
  await page.waitForFunction((id) => !window.__sd.state().enemies.find((e) => e.id === id).disguised, mimic.id, { timeout: 8000 }).catch(() => {});
  s = await st();
  const m2 = s.enemies.find((e) => e.id === mimic.id);
  check('按 E 打開：寶箱怪醒來', !m2.disguised && m2.state === 'alert', JSON.stringify({ disguised: m2.disguised, state: m2.state }));
  const t = await toasts();
  check('寶箱怪的提示', t.some((x) => (zh ? x.includes('不是寶箱') : /no chest|not a chest/i.test(x))), JSON.stringify(t));
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}enemies-v2-mimic-open.png` });
}

const sentry = s.enemies.find((e) => e.kind === 'sentry');
check('第 3 層有號角哨兵', !!sentry);
if (sentry) {
  await page.evaluate(() => window.__sd.debug.setHp(10));
  await page.evaluate(() => window.__sd.debug.setInvisible(0));
  if (await faceFrom('號角哨兵', sentry.x, sentry.z, [5, 4, 6])) {
    // 睡著的哨兵先用一聲響叫醒，再讓它發現你並舉起號角：快轉世界時間（都是狀態注入）
    if ((await st()).enemies.find((e) => e.id === sentry.id).state === 'sleep') {
      console.log('INFO 狀態注入：在哨兵旁製造聲響叫醒它（debug.noise）');
      await page.evaluate(([x, z]) => window.__sd.debug.noise(x, z, 6), [sentry.x, sentry.z]);
    }
    let blown = false;
    for (let k = 0; k < 16 && !blown; k++) {
      await page.evaluate(() => window.__sd.debug.advance(0.5));
      await page.waitForTimeout(60);
      const se = (await st()).enemies.find((e) => e.id === sentry.id);
      blown = se.hornUsed;
      if (k % 4 === 0) console.log('INFO 哨兵', se.state, se.phase, se.awareness.toFixed(2));
      if (!blown && k === 3) await page.screenshot({ path: `${OUT}enemies-v2-sentry.png` });
    }
    console.log('INFO 狀態注入：快轉世界時間等哨兵吹號角（debug.advance）');
    const d3 = await dungeon();
    check('哨兵吹完號角：整層戒備', blown && d3.alarm, JSON.stringify({ blown, alarm: d3.alarm }));
    const t = await toasts();
    check('號角的提示', t.some((x) => (zh ? x.includes('號角') : /horn/i.test(x))), JSON.stringify(t));
  } else check('找到可以看見號角哨兵的位置', false);
}

if (!zh) {
  const t = await toasts();
  check('英文介面的提示沒有中文', !t.some((x) => /\p{Script=Han}/u.test(x)), JSON.stringify(t));
}
check('沒有頁面錯誤', errors.length === 0, errors.join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `\n${failed} 項失敗` : `\n全部 ${results.length} 項通過`);
process.exit(failed ? 1 : 0);
