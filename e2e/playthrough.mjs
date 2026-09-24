// 完整冒險：潛入 → 取心 → 撤離 → 通關（或死亡）。
// 用法：node e2e/playthrough.mjs <seed> [--headed]
import { Bot, OUT, launch, startRun, wrap, yawTo } from './lib.mjs';

const seed = process.argv[2] ?? 'RUN1';
const headed = process.argv.includes('--headed');
const { browser, page, errors } = await launch({ headless: !headed });
const logs = [];
const log = (...a) => {
  const line = a.join(' ');
  logs.push(line);
  console.log(line);
};
await page.goto(`${process.env.BASE_URL ?? 'http://127.0.0.1:5173/'}?dev=1&gfx=low`);
await page.mouse.move(640, 360);
await startRun(page, seed);
const bot = new Bot(page, log);
const lvl = await page.evaluate(() => window.__sd.level());
log('seed', seed, 'template', lvl.template, 'rooms', lvl.rooms.map((r) => `${r.key}:${r.layoutId}`).join(' '));
await page.screenshot({ path: `${OUT}run-${seed}-start.png` });

const shots = new Set();
async function shot(name) {
  if (shots.has(name)) return;
  shots.add(name);
  await page.screenshot({ path: `${OUT}run-${seed}-${name}.png` });
}

async function sidestep(ms = 320) {
  const k = Math.random() < 0.5 ? 'KeyA' : 'KeyD';
  await bot.down(k);
  await page.waitForTimeout(ms);
  await bot.up(k);
}

/** 回傳 true 表示本輪做了戰鬥相關動作。 */
async function fight(s) {
  const p = s.player;
  globalThis.__why = 'none';
  if (p.action) {
    // 行動中仍可移動：盾衛舉劍或突進者蓄勢時先閃開
    const danger = s.enemies.find((e) => e.alive && !e.perched && e.state === 'alert' && Math.hypot(e.x - p.x, e.z - p.z) < 3.2 && (e.phase === 'windup' || e.phase === 'charge'));
    if (danger) {
      await bot.releaseAll();
      await bot.down(danger.kind === 'charger' ? 'KeyA' : 'KeyS');
      await page.waitForTimeout(260);
      await bot.releaseAll();
      return true;
    }
    return false;
  }
  const near = s.enemies
    .filter((e) => e.alive && !e.perched)
    .map((e) => ({ e, d: Math.hypot(e.x - p.x, e.z - p.z) }))
    .sort((a, b) => a.d - b.d);
  // 1) 未察覺且在劍的距離內：背刺
  const sneak = near.find((o) => o.e.state !== 'alert' && o.d < 2.3);
  if (sneak) {
    await bot.releaseAll();
    if (p.tool !== 'sword') await bot.tap('Digit1');
    await bot.turnTo(yawTo(p.x, p.z, sneak.e.x, sneak.e.z), 0.15);
    await bot.click();
    await bot.waitIdle(1500);
    await shot(`backstab-${sneak.e.kind}`);
    return true;
  }
  const t = near.find((o) => o.e.state === 'alert' && o.d < 6.5);
  if (!t) return false;
  const e = t.e;
  const d = t.d;
  await bot.releaseAll();
  if (p.tool !== 'sword') await bot.tap('Digit1');
  const face = yawTo(p.x, p.z, e.x, e.z);
  if (e.kind === 'guard') {
    await bot.turnTo(face, 0.2);
    if (e.phase === 'windup' || (e.phase === 'active' && e.phaseT < 0.08)) {
      // 讀到舉劍：往後退出揮擊範圍
      await bot.down('KeyS');
      await page.waitForTimeout(320);
      await bot.up('KeyS');
      await shot('dodge-guard');
      return true;
    }
    if (e.phase === 'recovery' || (e.phase === 'active' && e.phaseT >= 0.08)) {
      // 對方恢復中：上前出手
      if (d > 2.1) {
        await bot.down('KeyW');
        await page.waitForTimeout(Math.min(350, ((d - 1.8) / 4.5) * 1000));
        await bot.up('KeyW');
      }
      await bot.click();
      await bot.waitIdle(1500);
      await shot('fight-guard');
      return true;
    }
    // 對方還沒出手：保持在攻擊距離邊緣引誘它舉劍
    if (d < 1.9) {
      await bot.down('KeyS');
      await page.waitForTimeout(120);
      await bot.up('KeyS');
      return true;
    }
    if (d <= 3.0) {
      globalThis.__why = `bait guard ${e.id} d=${d.toFixed(2)} phase=${e.phase} state=${e.state}`;
      await page.waitForTimeout(80);
      return true;
    }
    return false;
  }
  if (e.kind === 'charger') {
    if (e.phase === 'windup' || e.phase === 'charge') {
      // 垂直於鎖定方向側移
      await bot.turnTo(face, 0.3);
      await sidestep(e.phase === 'charge' ? 250 : 420);
      await shot('dodge-charger');
      return true;
    }
    if ((e.phase === 'stun' || e.phase === 'recovery') && d < 4) {
      await bot.turnTo(face, 0.15);
      if (d > 2.0) {
        await bot.down('KeyW');
        await page.waitForTimeout(Math.min(400, (d - 1.6) * 230));
        await bot.up('KeyW');
      }
      await bot.click();
      await bot.waitIdle(1500);
      await shot('fight-charger');
      return true;
    }
    if (d <= 2.2) {
      await bot.turnTo(face, 0.15);
      await bot.click();
      await bot.waitIdle(1500);
      return true;
    }
    return false;
  }
  // 弩手：靠近砍一刀；瞄準中則邊走邊側移
  if (e.kind === 'archer') {
    if (d <= 2.2) {
      await bot.turnTo(face, 0.15);
      await bot.click();
      await bot.waitIdle(1500);
      await shot('fight-archer');
      return true;
    }
    if (e.phase === 'aim' && e.locked) {
      await sidestep(300);
      return true;
    }
    await bot.turnTo(face, 0.2);
    await bot.down('KeyW');
    await page.waitForTimeout(250);
    await bot.up('KeyW');
    return true;
  }
  return false;
}

/** 沿路徑走到目標附近；途中處理門、戰鬥與治療。 */
async function goTo(tx, tz, arrive = 1.0, maxMs = 90000) {
  const t0 = Date.now();
  let lastProgress = Date.now();
  let lastD = Infinity;
  while (Date.now() - t0 < maxMs) {
    const s = await bot.st();
    if (s.mode === 'results' || s.outcome !== 'none') {
      await bot.releaseAll();
      return 'ended';
    }
    if (s.mode === 'rune') {
      await bot.releaseAll();
      await bot.tap('Digit1');
      await page.waitForTimeout(100);
      continue;
    }
    if (s.mode !== 'playing') {
      await bot.releaseAll();
      await page.waitForTimeout(100);
      continue;
    }
    const p = s.player;
    const d = Math.hypot(tx - p.x, tz - p.z);
    if (d <= arrive) {
      await bot.releaseAll();
      return 'arrived';
    }
    if (!globalThis.__lp || Math.hypot(p.x - globalThis.__lp.x, p.z - globalThis.__lp.z) > 0.8 || s.player.action) {
      globalThis.__lp = { x: p.x, z: p.z };
      lastProgress = Date.now();
    }
    void lastD;
    // 治療
    if (p.hp <= 4 && p.potions > 0 && !p.action) {
      await bot.releaseAll();
      await bot.tap('KeyH');
      await bot.waitIdle();
      continue;
    }
    // 戰鬥：讀預備動作 → 閃避 → 在對方恢復時出手；未察覺的敵人直接背刺
    if (await fight(s)) continue;
    // 門：路徑上的關閉的門
    const path = await page.evaluate(([x, z]) => window.__sd.pathTo(x, z), [tx, tz]);
    if (!path || !path.length) {
      await bot.releaseAll();
      log('no path from', p.x.toFixed(1), p.z.toFixed(1));
      await page.waitForTimeout(200);
      if (Date.now() - lastProgress > 30000) return 'stuck';
      continue;
    }
    const closed = s.doors.find((dd) => !dd.arch && dd.progress < 0.99 && Math.hypot(dd.cx - p.x, dd.cz - p.z) < 1.8);
    if (Date.now() - lastProgress > 4000 && (globalThis.__dbg2 ?? 0) < 1) {
      globalThis.__dbg2 = 1;
      for (let q = 0; q < 8; q++) {
        const z = await page.evaluate(() => { const s = window.__sd.state(); return [s.player.x.toFixed(3), s.player.z.toFixed(3), s.lastWorldDt.toFixed(4), s.lastRealDt.toFixed(4), s.player.yaw.toFixed(3), JSON.stringify(window.__sd.inputState().held)]; });
        log('SEQ', z.join(' '));
        await page.waitForTimeout(100);
      }
    }
    if (Date.now() - lastProgress > 4000 && (globalThis.__dbg ?? 0) < 3) {
      globalThis.__dbg = (globalThis.__dbg ?? 0) + 1;
      log('DEBUG stall p', p.x.toFixed(2), p.z.toFixed(2), 'yaw', p.yaw.toFixed(2), 'path', JSON.stringify(path.slice(0, 3).map((q) => [q.x.toFixed(2), q.z.toFixed(2)])), 'closed', JSON.stringify(closed), 'action', JSON.stringify(p.action),
        'doors', JSON.stringify(s.doors.filter((dd) => Math.hypot(dd.cx - p.x, dd.cz - p.z) < 4)),
        'enemies', JSON.stringify(s.enemies.filter((e) => Math.hypot(e.x - p.x, e.z - p.z) < 5).map((e) => [e.kind, e.state, e.alive, e.x.toFixed(1), e.z.toFixed(1)])),
        'target', JSON.stringify(s.interactTarget),
        'input', JSON.stringify(await page.evaluate(() => window.__sd.inputState())), 'botHeld', [...bot.held].join(','),
        'why', globalThis.__why, 'fps', await page.evaluate(async () => { let n = 0; const t0 = performance.now(); await new Promise((r) => { const f = () => { n++; if (performance.now() - t0 < 1000) requestAnimationFrame(f); else r(); }; requestAnimationFrame(f); }); return n; }),
        'perf', JSON.stringify(await page.evaluate(() => window.__sd.perf())), 'render', JSON.stringify(await page.evaluate(() => window.__sd.renderInfo())));
    }
    if (closed) {
      // 門是否在前進方向上
      const wp = path[0];
      const toDoor = Math.hypot(closed.cx - p.x, closed.cz - p.z);
      const toWp = Math.hypot(wp.x - p.x, wp.z - p.z);
      const doorAhead = toDoor < toWp + 1.5 || Math.hypot(closed.cx - wp.x, closed.cz - wp.z) < 1.8;
      if (doorAhead && closed.target === 0 && !closed.barred) {
        await bot.releaseAll();
        await bot.turnTo(yawTo(p.x, p.z, closed.cx, closed.cz), 0.15);
        await bot.tap('KeyE');
        await bot.waitIdle();
        // 等門打開（按住空白讓時間正常流動）
        await bot.down('Space');
        await page.waitForTimeout(450);
        await bot.up('Space');
        continue;
      }
    }
    // 沿路徑前進
    let wp = path[0];
    if (path.length > 1 && Math.hypot(wp.x - p.x, wp.z - p.z) < 0.6) wp = path[1];
    const want = yawTo(p.x, p.z, wp.x, wp.z);
    const diff = wrap(want - p.yaw);
    if (Math.abs(diff) > 0.5) {
      await bot.up('KeyW');
      await bot.turnTo(want, 0.1);
    } else if (Math.abs(diff) > 0.1) {
      const key = diff > 0 ? 'ArrowLeft' : 'ArrowRight';
      await page.keyboard.down(key);
      await page.waitForTimeout(Math.max(10, (Math.abs(diff) / 2.2) * 1000 - 8));
      await page.keyboard.up(key);
    }
    await bot.down('KeyW');
    await page.waitForTimeout(60);
    if (Date.now() - lastProgress > 30000) {
      await bot.releaseAll();
      return 'stuck';
    }
  }
  await bot.releaseAll();
  return 'timeout';
}

async function useAt(x, z, label) {
  const s = await bot.st();
  await bot.turnTo(yawTo(s.player.x, s.player.z, x, z), 0.1);
  const t = (await bot.st()).interactTarget;
  log('interact target', JSON.stringify(t));
  await bot.tap('KeyE');
  await bot.waitIdle();
  await page.waitForTimeout(200);
  await shot(label);
}

const heart = lvl.heart;
const stairs = lvl.stairs;
let r = await goTo(heart.x + 0.0, heart.z + 1.3, 1.0, 240000);
log('to heart:', r);
if (r === 'arrived') {
  await useAt(heart.x, heart.z, 'heart');
  const s = await bot.st();
  log('heartTaken', s.heartTaken, 'awakened', s.awakened);
  await page.waitForTimeout(600);
  await shot('awake');
  r = await goTo(stairs.front.x, stairs.front.z, 0.8, 300000);
  log('to stairs:', r);
  if (r === 'arrived') await useAt(stairs.front.x - stairs.rise.x * 1.5, stairs.front.z - stairs.rise.z * 1.5, 'stairs');
}
await page.waitForTimeout(1500);
const fin = await bot.st();
log('final mode', fin.mode, 'outcome', fin.outcome, 'hp', fin.player.hp, 'time', fin.time.toFixed(1), 'real', fin.realTime.toFixed(1));
log('stats', JSON.stringify(fin.stats));
await page.screenshot({ path: `${OUT}run-${seed}-end.png` });
log('errors', errors.length ? errors.join('\n') : 'none');
await browser.close();
process.exit(fin.outcome === 'win' ? 0 : 2);
