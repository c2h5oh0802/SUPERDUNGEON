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

/**
 * 重置練習場，再以狀態注入把玩家放到射擊場站位（只擺位置，之後的動作都是正常輸入）。
 * 目的：隔離這項檢查，避免練習場的盾衛一路跟過來或途中陣亡導致練習場自動重置。
 */
async function enterRange(label) {
  await bot.releaseAll();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  if ((await st()).mode !== 'paused') await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.click('#btn-restart');
  await page.waitForFunction(() => window.__sd?.state().mode === 'playing' && window.__sd.state().time < 0.5, null, { timeout: 90000 });
  await page.evaluate(([x, z]) => window.__sd.debug.teleport(x, z), [RANGE_SPOT.x, RANGE_SPOT.z]);
  console.log(`INFO 狀態注入：${label}傳送到射擊場站位`, RANGE_SPOT.x, RANGE_SPOT.z);
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
      const gp = (x) => {
        const gg = x.enemies.find((e) => e.id === guard.id);
        const ang = Math.abs(wrap(yawTo(x.player.x, x.player.z, gg.x, gg.z) - x.player.yaw));
        return `phase=${gg.phase} phaseT=${gg.phaseT.toFixed(3)} locked=${gg.locked} d=${Math.hypot(gg.x - x.player.x, gg.z - x.player.z).toFixed(2)} ang=${ang.toFixed(2)} cue=${JSON.stringify(x.cue.counter)} time=${x.time.toFixed(3)} dt=${x.lastWorldDt.toFixed(4)}/${x.lastRealDt.toFixed(3)}`;
      };
      console.log('INFO 看到反擊提示時', gp(s));
      await bot.click();
      for (let k = 0; k < 60; k++) {
        const x = await st();
        if (x.player.action) {
          console.log('INFO 行動開始時', gp(x), 'action', JSON.stringify(x.player.action));
          break;
        }
        await page.waitForTimeout(10);
      }
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
    if (globalThis.__lastHp !== undefined && p.hp < globalThis.__lastHp)
      console.log('INFO 被盾衛打中前最後看到的狀態', globalThis.__lastSeen ?? '（沒有看到舉劍）');
    globalThis.__lastHp = p.hp;
    if (g.phase === 'windup') {
      globalThis.__lastSeen = `phaseT=${g.phaseT.toFixed(3)} locked=${g.locked} d=${Math.hypot(g.x - p.x, g.z - p.z).toFixed(2)} ang=${Math.abs(wrap(yawTo(p.x, p.z, g.x, g.z) - p.yaw)).toFixed(2)} cue=${JSON.stringify(s.cue.counter)} dt=${s.lastWorldDt.toFixed(4)}/${s.lastRealDt.toFixed(3)}`;
      // 等鎖定時不做任何耗時的事（截圖在軟體渲染下要 1–2 秒，會錯過窗口）
      await page.waitForTimeout(15);
      continue;
    }
    if (Math.abs(wrap(yawTo(p.x, p.z, g.x, g.z) - p.yaw)) > 0.2) await bot.turnTo(yawTo(p.x, p.z, g.x, g.z), 0.1);
    await page.waitForTimeout(40);
  }
  if (!counterShot) check('戰士：盾衛鎖定時準星下出現「反擊」', false, '沒有等到反擊時機');
}
{
  // 高台弩手：站在它的視野內；有「反擊」提示就揮劍（弩矢或衝過來的突進者）
  await enterRange('戰士');
  const t0 = Date.now();
  let deflectShot = false;
  const kinds = {};
  while (Date.now() - t0 < 60000) {
    const s = await st();
    if (s.player.dead || s.mode !== 'playing') {
      console.log('INFO 戰士在射擊場倒下', JSON.stringify(s.stats.damageTaken));
      break;
    }
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
    // 還在上升、提示已出現：趁等待時截圖（不影響出手時機）
    if (b2 && s2.cue.quickTarget === b.id && b2.vy >= 1.2 && !globalThis.__qsShot) {
      globalThis.__qsShot = true;
      await shot('huntress-quick-ready');
      continue;
    }
    // 等瓶子過了最高點（自己選一個比較晚的引爆點）
    if (b2 && s2.cue.quickTarget === b.id && b2.vy < 0.5) {
      ready = true;
      check('獵手：準星對準空中的瓶子時出現「疾射」', s2.cueText === '疾射', s2.cueText);
      // 看到提示就出手（截圖在出手後；軟體渲染下截圖要 1–2 秒，瓶子會飛出錐角）
      await bot.click(30);
      await bot.waitIdle();
      const la = (await st()).lastAction;
      spent = la && la.quick ? la.spent : null;
      console.log('INFO 疾射行動', JSON.stringify(la));
      await shot('huntress-quick-fired');
      await page.waitForTimeout(800);
      const ev = await page.evaluate(() =>
        window.__sd
          .events()
          .filter((e) => ['quickshot', 'fire', 'bottleBreak', 'hitWall', 'hitEnemy', 'shield', 'throw'].includes(e.type))
          .map((e) => `${e.type}:${e.kind ?? ''}${e.air !== undefined ? (e.air ? ':air' : ':ground') : ''}@${[e.x, e.y, e.z].map((v) => (typeof v === 'number' ? v.toFixed(1) : '-')).join(',')} t=${e.t.toFixed(2)}`),
      );
      console.log('INFO 空爆事件', ev.join(' | '));
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
  await enterRange('獵手');
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
      // 弩矢還在 3.5 m 外就出手（越近角度變化越快；軟體渲染約 8 fps，按鍵要一幀以上才生效）
      if (tq && tq.kind === 'bolt' && Math.hypot(tq.x - p.x, tq.z - p.z) >= 3.5) {
        await bot.click(30);
        await bot.waitIdle();
        if (!readyShot) {
          readyShot = true;
          console.log('INFO 截擊出手', JSON.stringify((await st()).lastAction));
          await shot('huntress-intercept-fired');
        }
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
