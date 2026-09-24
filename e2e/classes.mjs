// 職業驗證（練習場）：以正常操作輸入（WASD、方向鍵轉向、1/2/Q、左鍵）做出各職業的核心動作。
// 何時出手、往哪裡轉，是透過 ?dev=1 讀取狀態決定的（狀態讀取輔助，不是真人操作）；
// 「現在出手有效」的判定讀的是畫面上同一個提示（state().cue），不是另外算的。
import { Bot, OUT, launch, wrap, yawTo } from './lib.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:5173/';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

const { browser, page, errors } = await launch();
const bot = new Bot(page);
await page.goto(`${BASE}?dev=1&gfx=low`);
await page.mouse.move(640, 360);

const st = () => bot.st();
// 射擊場裡弩手（高台、面向南）視野內的站位；踏板在 (24.5, 11.5) 與 (31.5, 11.5)
const RANGE_SPOT = { x: 29.5, z: 11.0 };
const shot = (name) => page.screenshot({ path: `${OUT}cls-${name}.png` });

// ---------- 1) 選擇職業 ----------
await page.click('.class-card[data-cls="huntress"]');
check('點選獵手卡片後被選取', (await page.getAttribute('.class-card[data-cls="huntress"]', 'aria-checked')) === 'true');
const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('superdungeon.settings.v1') ?? '{}').cls);
check('職業選擇存進設定', saved === 'huntress', String(saved));
await page.reload();
await page.mouse.move(640, 360);
check('重新整理後仍是獵手', (await page.getAttribute('.class-card[data-cls="huntress"]', 'aria-checked')) === 'true');
const cardText = await page.textContent('.class-card[data-cls="warrior"]');
check('職業卡顯示名稱、承諾與能力', cardText.includes('戰士') && cardText.includes('反擊斬') && cardText.includes('擊開'), cardText.slice(0, 40));
await shot('menu');
await page.click('.class-card[data-cls="warrior"]');

async function startPractice(cls) {
  await page.click(`.class-card[data-cls="${cls}"]`);
  await page.click('#btn-practice');
  await page.waitForFunction(() => window.__sd?.state().mode === 'playing', null, { timeout: 90000 });
  await page.waitForTimeout(400);
  const s = await st();
  check(`練習場以${cls === 'warrior' ? '戰士' : '獵手'}開始`, s.player.cls === cls, s.player.cls);
  const badge = await page.textContent('#class-badge');
  check('HUD 顯示目前職業', badge.includes(cls === 'warrior' ? '戰士' : '獵手'), badge);
}

async function toMenu() {
  await bot.releaseAll();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  if ((await st()).mode !== 'paused') await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.click('#btn-quit');
  await page.waitForTimeout(300);
}

/** 沿導航路徑走到目標；遇到關閉的門就開門。 */
async function walkTo(tx, tz, arrive = 0.8, maxMs = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    const s = await st();
    const p = s.player;
    if (Math.hypot(tx - p.x, tz - p.z) <= arrive) break;
    const door = s.doors.find((d) => !d.arch && !d.barred && d.progress < 0.99 && Math.hypot(d.cx - p.x, d.cz - p.z) < 1.8);
    if (door && door.target === 0 && !p.action) {
      await bot.releaseAll();
      await bot.turnTo(yawTo(p.x, p.z, door.cx, door.cz), 0.15);
      await bot.tap('KeyE');
      await bot.waitIdle();
      continue;
    }
    const path = await page.evaluate(([x, z]) => window.__sd.pathTo(x, z), [tx, tz]);
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
  await bot.releaseAll();
}

async function aimAt(x, y, z, tol = 0.03) {
  const s = await st();
  const p = s.player;
  const d = Math.hypot(x - p.x, z - p.z);
  await bot.turnTo(yawTo(p.x, p.z, x, z), tol);
  await bot.pitchTo(Math.atan2(y - 1.55, d), tol);
}

// ---------- 2) 戰士：反擊斬（巡邏盾衛）與擊開（高台弩手） ----------
await startPractice('warrior');
{
  const s0 = await st();
  const guard = s0.enemies.find((e) => e.kind === 'guard' && e.state !== 'sleep');
  // 走到盾衛正前方約 3 m，讓它發現並上前
  await walkTo(guard.x + 3, guard.z, 0.6);
  let counterShot = false;
  let hpBefore = 0;
  let staggered = false;
  const t0 = Date.now();
  while (Date.now() - t0 < 45000) {
    const s = await st();
    const g = s.enemies.find((e) => e.id === guard.id);
    if (!g || !g.alive) break;
    if (s.cue.counter && s.cue.counter.kind === 'guard' && !s.player.action) {
      // 先出手，再截圖與驗證（真人看到提示就按）
      hpBefore = s.player.hp;
      await bot.click();
      counterShot = true;
      check('戰士：盾衛鎖定時準星下出現「反擊」', s.cueText === '反擊', s.cueText);
      await bot.waitIdle();
      const la = (await st()).lastAction;
      check('戰士：這一劍是反擊斬（更快出手）且成功跳過收招', !!la && la.counter && la.countered, JSON.stringify(la));
      const after = await st();
      const g2 = after.enemies.find((e) => e.id === guard.id);
      staggered = !!g2 && (g2.phase === 'stagger' || !g2.alive);
      await shot('warrior-counter-hit');
      check('戰士：反擊斬打斷盾衛（失衡）', staggered && after.stats.counters >= 1, `phase=${g2?.phase} counters=${after.stats.counters}`);
      check('戰士：反擊成功時沒有被那一劍打中', after.player.hp === hpBefore, `hp ${hpBefore} → ${after.player.hp}`);
      // 失衡中追擊
      await bot.click();
      await bot.waitIdle();
      await page.waitForTimeout(300);
      break;
    }
    // 面向盾衛等待（慢動作中）；舉劍期間不轉身，專心等鎖定
    const p = s.player;
    if (g.phase === 'windup') {
      if (g.locked && !counterShot) await shot('warrior-counter-ready');
      await page.waitForTimeout(15);
      continue;
    }
    if (Math.abs(wrap(yawTo(p.x, p.z, g.x, g.z) - p.yaw)) > 0.2) await bot.turnTo(yawTo(p.x, p.z, g.x, g.z), 0.1);
    await page.waitForTimeout(40);
  }
  if (!counterShot) check('戰士：盾衛鎖定時準星下出現「反擊」', false, '沒有等到反擊時機');
}
{
  // 高台弩手：站在它的視野內（先沿 z≈9.5 走，避開踏板）；有「反擊」提示就揮劍（弩矢或突進者）
  await walkTo(26.5, 9.5, 0.7);
  await walkTo(RANGE_SPOT.x, RANGE_SPOT.z, 0.5);
  const t0 = Date.now();
  let deflectShot = false;
  const kinds = {};
  while (Date.now() - t0 < 60000) {
    const s = await st();
    if (s.player.dead || s.mode !== 'playing') break;
    if (s.stats.deflects >= 1 && (s.enemies.find((e) => e.kind === 'archer')?.alive === false || Date.now() - t0 > 30000)) break;
    if (s.cue.counter && !s.player.action) {
      kinds[s.cue.counter.kind] = (kinds[s.cue.counter.kind] ?? 0) + 1;
      if (s.cue.counter.kind === 'bolt' && !deflectShot) {
        deflectShot = true;
        await shot('warrior-deflect-ready');
      }
      await bot.click();
      await page.waitForTimeout(60);
      continue;
    }
    const p = s.player;
    const charger = s.enemies.find((e) => e.kind === 'charger' && e.alive && (e.phase === 'windup' || e.phase === 'charge'));
    const bolt = s.projectiles.find((q) => q.kind === 'bolt' && q.owner !== 'player');
    const archer = s.enemies.find((e) => e.kind === 'archer' && e.alive);
    const tgt = charger ?? bolt ?? archer;
    if (tgt) {
      const ty = tgt.y !== undefined && tgt.kind === 'bolt' ? tgt.y : 1.4 + (tgt.y ?? 0);
      if (Math.abs(wrap(yawTo(p.x, p.z, tgt.x, tgt.z) - p.yaw)) > 0.12) await aimAt(tgt.x, ty, tgt.z, 0.08);
    }
    await page.waitForTimeout(40);
  }
  const s = await st();
  check('戰士：擊開弩矢（弩矢改由玩家擁有、打回去）', s.stats.deflects >= 1, `deflects=${s.stats.deflects} cues=${JSON.stringify(kinds)}`);
  await page.waitForTimeout(600);
  await shot('warrior-after-range');
  const a = (await st()).enemies.find((e) => e.kind === 'archer');
  console.log('INFO 弩手', a.alive ? `存活 hp=${a.hp}` : '被擊倒', ' 戰士生命', s.player.hp, ' 反擊', s.stats.counters, ' 擊開', s.stats.deflects, ' 弩箭', s.player.arrows);
}
await toMenu();

// ---------- 3) 獵手：疾射空爆與截擊弩矢 ----------
await startPractice('huntress');
{
  await bot.tap('Digit2');
  await bot.turnTo(-Math.PI / 2 + 0.25, 0.05);
  await bot.pitchTo(0.25, 0.04);
  await bot.tap('KeyQ');
  for (let k = 0; k < 50; k++) {
    const x = await st();
    if (x.player.action || x.projectiles.some((q) => q.kind === 'bottle')) break;
    await page.waitForTimeout(30);
  }
  await bot.waitIdle();
  // 在慢動作中追著瓶子瞄準，等它飛到拋物線下降段（自己選的引爆點）再射
  let ready = false;
  let spent = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) {
    const s = await st();
    const b = s.projectiles.find((q) => q.kind === 'bottle');
    if (!b) break;
    await aimAt(b.x, b.y, b.z, 0.04);
    const s2 = await st();
    const b2 = s2.projectiles.find((q) => q.id === b.id);
    // 等瓶子過了最高點（自己選一個比較晚的引爆點）
    if (b2 && s2.cue.quickTarget === b.id && b2.vy < 0.5) {
      ready = true;
      check('獵手：準星對準空中的瓶子時出現「疾射」', s2.cueText === '疾射', s2.cueText);
      await shot('huntress-quick-ready');
      await bot.click(30);
      await bot.waitIdle();
      const la = (await st()).lastAction;
      spent = la && la.quick ? la.spent : null;
      console.log('INFO 疾射行動', JSON.stringify(la));
      break;
    }
  }
  await page.waitForTimeout(500);
  const s = await st();
  await shot('huntress-airburst');
  check('獵手：等到下降段再引爆，疾射空中擊破瓶子', ready && s.stats.airbursts >= 1 && s.stats.quickshots >= 1, `airbursts=${s.stats.airbursts} quickshots=${s.stats.quickshots}`);
  check('獵手：疾射只花很少世界時間（< 0.2 秒，一般射擊 0.8 秒）', spent !== null && spent < 0.2, spent === null ? '沒有射擊' : `${spent.toFixed(3)} 秒`);
}
{
  // 高台弩手：面向弩手；弩矢飛來時準星自然在它的路線上 → 出現「疾射」就射
  await walkTo(26.5, 9.5, 0.7);
  await walkTo(RANGE_SPOT.x, RANGE_SPOT.z, 0.5);
  await bot.tap('Digit2');
  const t0 = Date.now();
  let readyShot = false;
  while (Date.now() - t0 < 60000) {
    const s = await st();
    if (s.player.dead || s.mode !== 'playing') break;
    if (s.stats.intercepts >= 1) break;
    const p = s.player;
    const charger = s.enemies.find((e) => e.kind === 'charger' && e.alive && ((e.phase === 'windup' && e.locked) || e.phase === 'charge'));
    if (charger) {
      // 突進者鎖定：往側面閃開（移動會推進世界時間）
      await bot.releaseAll();
      await bot.down('KeyA');
      await page.waitForTimeout(350);
      await bot.up('KeyA');
      continue;
    }
    if (s.cue.quickTarget >= 0 && !p.action && p.arrows > 0) {
      const tq = s.projectiles.find((q) => q.id === s.cue.quickTarget);
      if (tq && tq.kind === 'bolt') {
        if (!readyShot) {
          readyShot = true;
          await shot('huntress-intercept-ready');
        }
        await bot.click(30);
        await bot.waitIdle();
        continue;
      }
    }
    const archer = s.enemies.find((e) => e.kind === 'archer' && e.alive);
    if (!archer) break;
    if (!globalThis.__alog || Date.now() - globalThis.__alog > 3000) {
      globalThis.__alog = Date.now();
      const bolts = s.projectiles.filter((q) => q.kind === 'bolt').map((q) => `${q.x.toFixed(1)},${q.y.toFixed(1)},${q.z.toFixed(1)}`);
      console.log('INFO 獵手', p.x.toFixed(1), p.z.toFixed(1), 'hp', p.hp, '弩手', archer.state, archer.phase, 'bolts', bolts.join(' '), 'cue', s.cue.quickTarget);
    }
    if (Math.abs(wrap(yawTo(p.x, p.z, archer.x, archer.z) - p.yaw)) > 0.05) await aimAt(archer.x, archer.y + 1.45, archer.z, 0.03);
    await page.waitForTimeout(40);
  }
  await page.waitForTimeout(400);
  const s = await st();
  await shot('huntress-after-range');
  check('獵手：疾射截擊飛來的弩矢', s.stats.intercepts >= 1, `intercepts=${s.stats.intercepts} quickshots=${s.stats.quickshots} hp=${s.player.hp}`);
}

check('全程無 console 錯誤', errors.length === 0, errors.join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
