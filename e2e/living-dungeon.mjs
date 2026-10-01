// 真實練習場的 AI／HUD 整合。debug 隱形、傳送、噪音、煙霧與世界時間推進都是狀態注入；
// 不是正常輸入流程或真人玩法證據。各狀態的規則由 livingDungeon.test.ts 另外覆蓋。
import { mkdirSync } from 'node:fs';
import { BASE, OUT, launch, yawTo } from './lib.mjs';

mkdirSync(OUT, { recursive: true });
const { browser, page, errors } = await launch();
const checkpoints = [];
const check = (name, ok) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (!ok) throw new Error(name);
};
try {
  await page.goto(`${BASE}?dev=1&gfx=low`);
  await page.click('#btn-practice');
  await page.waitForFunction(() => window.__sd?.state().mode === 'playing', null, { timeout: 90000 });
  await page.evaluate(() => window.__sd.debug.setInvisible(1000));
  const state = () => page.evaluate(() => window.__sd.state());
  const level = await page.evaluate(() => window.__sd.level());
  const start = await state();
  const id = start.enemies.find((e) => e.kind === 'guard' && e.state === 'patrol').id;
  const enemy = async () => (await state()).enemies.find((e) => e.id === id);
  const advance = async (seconds) => page.evaluate((t) => window.__sd.debug.advance(t), seconds);
  const roomAt = (e) => level.rooms.find((r) => e.x >= r.x0 && e.x < r.x0 + r.w && e.z >= r.z0 && e.z < r.z0 + r.h)?.key;
  const original = await enemy();
  const firstRoom = roomAt(original);
  let roaming = original;
  for (let k = 0; k < 90; k++) {
    await advance(1);
    roaming = await enemy();
    if (roomAt(roaming) && roomAt(roaming) !== firstRoom) break;
  }
  check('玩家未接觸時，醒著的盾衛沿既有導航跨房活動', roomAt(roaming) && roomAt(roaming) !== firstRoom);
  check('活動時實際開門', (await state()).doors.some((d) => !d.arch && d.target === 1));
  checkpoints.push({ stage: 'roam', enemy: roaming });

  // 在盾衛所在房間選附近可站點作為聲源。只讀 pathTo 用玩家導航確認目標。
  const room = level.rooms.find((r) => r.key === roomAt(roaming));
  let target;
  for (const [dx, dz] of [[3, 0], [-3, 0], [0, 3], [0, -3]]) {
    const x = roaming.x + dx;
    const z = roaming.z + dz;
    if (x < room.x0 + 1 || x > room.x0 + room.w - 1 || z < room.z0 + 1 || z > room.z0 + room.h - 1) continue;
    if (await page.evaluate(([x, z]) => window.__sd.pathTo(x, z) !== null, [x, z])) { target = { x, z }; break; }
  }
  check('測試聲源可達', !!target);
  await page.evaluate(({ x, z }) => window.__sd.debug.noise(x, z, 8), target);
  let e = await enemy();
  check('只聽見聲音進入調查，沒有玩家位置記憶', e.state === 'investigate' && e.lastKnown === null);
  checkpoints.push({ stage: 'investigate', enemy: e });
  await page.evaluate(({ x, z }) => {
    window.__sd.debug.teleport(x, z);
    window.__sd.debug.setInvisible(0);
  }, target);
  await page.evaluate((yaw) => window.__sd.debug.setView(yaw, 0), yawTo(target.x, target.z, e.x, e.z));
  for (let k = 0; k < 30 && (await enemy()).state !== 'alert'; k++) await advance(0.1);
  e = await enemy();
  check('調查途中真正看到玩家才追擊', e.state === 'alert');
  checkpoints.push({ stage: 'hunt', enemy: e });

  await page.evaluate(({ x, z }) => window.__sd.debug.smoke(x, z), { x: e.x, z: e.z });
  await advance(0.1);
  e = await enemy();
  check('煙霧阻擋實際感知', !e.seesPlayer);
  const memory = { ...e.lastKnown };
  await page.evaluate(({ x, z }) => window.__sd.debug.teleport(x, z), level.spawn);
  for (let k = 0; k < 15 && (await enemy()).state !== 'search'; k++) await advance(0.5);
  e = await enemy();
  check('切 LOS 後依最後已知位置搜索，不更新成入口玩家位置', e.state === 'search' &&
    e.target.x === memory.x && e.target.z === memory.z && e.lastKnown.x === memory.x && e.lastKnown.z === memory.z);
  checkpoints.push({ stage: 'search', enemy: e });
  // 把視角帶回搜索現場，仍用遮蔽避免再被看見，驗證搜索 HUD 與渲染整合。
  await advance(5.5); // 煙霧自然消散，仍在有限搜索時間內。
  e = await enemy();
  const viewSpot = { x: roaming.x, z: roaming.z };
  await page.evaluate(({ x, z }) => {
    window.__sd.debug.setInvisible(1000);
    window.__sd.debug.teleport(x, z);
  }, viewSpot);
  await page.evaluate((yaw) => window.__sd.debug.setView(yaw, 0), yawTo(viewSpot.x, viewSpot.z, e.x, e.z));
  await page.waitForTimeout(100);
  await page.screenshot({ path: `${OUT}living-search.png` });
  for (let k = 0; k < 45 && (await enemy()).state !== 'patrol'; k++) await advance(1);
  e = await enemy();
  check('有限搜索結束後恢復跨房活動，清除記憶', e.state === 'patrol' && e.lastKnown === null && e.target === null);
  checkpoints.push({ stage: 'resume', enemy: e });
  check('實際瀏覽器無執行錯誤', errors.length === 0);
  console.log(JSON.stringify(checkpoints));
} finally {
  await browser.close();
}
