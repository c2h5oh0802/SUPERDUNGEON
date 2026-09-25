// 職業驗證（練習場）：以正常操作輸入（WASD、方向鍵或滑鼠轉向、1/2/3/Q/F、左鍵）做出各職業的核心動作。
// 何時出手、往哪裡轉，是透過 ?dev=1 讀取狀態決定的（狀態讀取輔助，不是真人操作）；
// 「現在出手有效」的判定讀的是畫面上同一個提示（state().cue），不是另外算的。
import { Bot, OUT, launch, wrap, yawTo } from './lib.mjs';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:5173/';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

// 較小的視窗：軟體渲染下幀率較高、輸入延遲較低（反擊與疾射的時機檢查需要）
const { browser, page, errors } = await launch({ viewport: { width: 640, height: 360 } });
const bot = new Bot(page);
await page.goto(`${BASE}?dev=1&gfx=low`);
await page.mouse.move(320, 180);

const st = () => bot.st();

/**
 * 時機關鍵的點擊：直接對畫面送出 DOM 滑鼠事件（與真實點擊走同一個輸入處理流程）。
 * 這個環境裡自動化工具的 page.mouse 要 0.6–1.4 秒才送達頁面（實測），
 * 會吃掉大部分「反擊」窗口（慢動作下約 1.6 秒真實時間）；真人的輸入延遲只有一幀。
 */
async function fastClick() {
  await page.evaluate(() => {
    const c = document.getElementById('game');
    c.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true, cancelable: true }));
    setTimeout(() => window.dispatchEvent(new MouseEvent('mouseup', { button: 0, bubbles: true })), 30);
  });
}
// 射擊場裡弩手（高台、面向南）視野內的站位；踏板在 (24.5, 11.5) 與 (31.5, 11.5)
const RANGE_SPOT = { x: 29.5, z: 11.0 };
const shot = (name) => page.screenshot({ path: `${OUT}cls-${name}.png` });

/**
 * 精確轉向：送出真正的滑鼠移動事件（與玩家移動滑鼠走同一條輸入路徑）。
 * 滑鼠鎖定時直接移動；無法鎖定（無頭瀏覽器）時用遊戲的備用操作「按住右鍵拖曳」。
 * 軟體渲染約 8 fps，方向鍵一幀就轉 0.27 rad，獵人之眼需要更細的角度。
 */
async function mouseLook(dyaw, dpitch) {
  const k = 0.0022;
  await page.evaluate(
    ([mx, my]) => {
      const c = document.getElementById('game');
      const locked = document.pointerLockElement === c;
      if (!locked) c.dispatchEvent(new MouseEvent('mousedown', { button: 2, bubbles: true, cancelable: true }));
      const n = Math.max(1, Math.ceil(Math.max(Math.abs(mx), Math.abs(my)) / 200));
      for (let i = 0; i < n; i++) document.dispatchEvent(new MouseEvent('mousemove', { movementX: mx / n, movementY: my / n, bubbles: true }));
      if (!locked) window.dispatchEvent(new MouseEvent('mouseup', { button: 2, bubbles: true }));
    },
    [-dyaw / k, -dpitch / k],
  );
  await page.waitForFunction(() => window.__sd.state().lastRealDt > 0, null, { timeout: 2000 });
  await page.waitForTimeout(260);
}

async function lookAt(yaw, pitch, tol = 0.006) {
  for (let i = 0; i < 6; i++) {
    const p = (await st()).player;
    const dy = wrap(yaw - p.yaw);
    const dp = pitch - p.pitch;
    if (Math.abs(dy) < tol && Math.abs(dp) < tol) return true;
    await mouseLook(dy, dp);
  }
  return false;
}

async function lookAtPoint(x, y, z, tol = 0.006) {
  const p = (await st()).player;
  return lookAt(yawTo(p.x, p.z, x, z), Math.atan2(y - 1.55, Math.hypot(x - p.x, z - p.z)), tol);
}

// ---------- 1) 選擇職業 ----------
await page.click('.class-card[data-cls="huntress"]');
check('點選獵手卡片後被選取', (await page.getAttribute('.class-card[data-cls="huntress"]', 'aria-checked')) === 'true');
const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('superdungeon.settings.v1') ?? '{}').cls);
check('職業選擇存進設定', saved === 'huntress', String(saved));
await page.reload();
await page.mouse.move(320, 180);
check('重新整理後仍是獵手', (await page.getAttribute('.class-card[data-cls="huntress"]', 'aria-checked')) === 'true');
const cardText = await page.textContent('.class-card[data-cls="warrior"]');
check('職業卡顯示名稱、承諾與起始武器', cardText.includes('戰士') && cardText.includes('長劍') && cardText.includes('臂盾'), cardText.slice(0, 40));
const hDetail = await page.textContent('#class-detail');
check(
  '選中獵手：展開完整說明（起始裝備、職業規則、擅長與弱點、代表性的一刻）',
  ['起始裝備', '獵弓', '藥劑箭', '麻痺箭', '獵人之眼', '擅長與弱點', '代表性的一刻'].every((k) => hDetail.includes(k)),
  hDetail.slice(0, 60),
);
await shot('menu');
await page.click('.class-card[data-cls="warrior"]');
const wDetail = await page.textContent('#class-detail');
check('選中戰士：說明換成戰士（長劍、臂盾、反擊斬、盾推）', ['長劍', '臂盾', '投擲石', '反擊斬', '盾推的結果'].every((k) => wDetail.includes(k)), wDetail.slice(0, 60));

async function startPractice(cls) {
  await page.click(`.class-card[data-cls="${cls}"]`);
  await page.click('#btn-practice');
  await page.waitForFunction(() => window.__sd?.state().mode === 'playing', null, { timeout: 90000 });
  await page.waitForTimeout(400);
  const s = await st();
  check(`練習場以${cls === 'warrior' ? '戰士' : '獵手'}開始`, s.player.cls === cls, s.player.cls);
  const badge = await page.textContent('#class-badge');
  check('HUD 顯示目前職業', badge.includes(cls === 'warrior' ? '戰士' : '獵手'), badge);
  const tools = await page.textContent('#tools');
  const want = cls === 'warrior' ? ['長劍', '投擲石', '臂盾'] : ['獵刀', '獵弓', '麻痺箭'];
  check('工具列顯示這個職業的武器', want.every((k) => tools.includes(k)), tools);
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

/** 重置練習場（暫停選單「重置練習」），不移動玩家。 */
async function resetPractice(label) {
  await bot.releaseAll();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  if ((await st()).mode !== 'paused') await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.click('#btn-restart');
  await page.waitForFunction(() => window.__sd?.state().mode === 'playing' && window.__sd.state().time < 0.5, null, { timeout: 90000 });
  console.log(`INFO 重置練習場：${label}`);
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
      const r0 = Date.now();
      console.log('INFO 看到反擊提示時', gp(s));
      await fastClick();
      const r1 = Date.now();
      const r2 = r1;
      for (let k = 0; k < 200; k++) {
        const x = await st();
        if (x.player.action) {
          console.log('INFO 行動開始時', gp(x), 'action', JSON.stringify(x.player.action), `真實時間：按下 ${r1 - r0} ms、放開 ${r2 - r0} ms、看到行動 ${Date.now() - r0} ms`);
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
      // 等鎖定時不做耗時的事（截圖在軟體渲染下要 1–2 秒，會錯過窗口）；
      // 但盾衛在劍的範圍（±50°）外就先轉向它（轉身不花世界時間，真人用滑鼠會直接轉過去）
      if (Math.abs(wrap(yawTo(p.x, p.z, g.x, g.z) - p.yaw)) > 0.6) await bot.turnTo(yawTo(p.x, p.z, g.x, g.z), 0.25);
      else await page.waitForTimeout(15);
      continue;
    }
    if (Math.abs(wrap(yawTo(p.x, p.z, g.x, g.z) - p.yaw)) > 0.2) await bot.turnTo(yawTo(p.x, p.z, g.x, g.z), 0.1);
    await page.waitForTimeout(40);
  }
  if (!counterShot) check('戰士：盾衛鎖定時準星下出現「反擊」', false, '沒有等到反擊時機');
}
{
  // 臂盾：把睡著的盾衛往最近的牆推。一次推 2 m；還沒撞到牆，就繞回它與牆的反方向再推一次
  await resetPractice('戰士盾推');
  const s0 = await st();
  const g = s0.enemies.find((e) => e.kind === 'guard' && e.alive && e.state === 'sleep');
  let dir = null;
  for (let r = 1.5; r <= 6 && g && !dir; r += 0.5) {
    for (let k = 0; k < 16 && !dir; k++) {
      const a = (k / 16) * Math.PI * 2;
      const dx = Math.cos(a);
      const dz = Math.sin(a);
      const wall = !(await page.evaluate(([x, z, bx, bz]) => window.__sd.lineOfSight(x, 1, z, bx, 1, bz), [g.x, g.z, g.x + dx * r, g.z + dz * r]));
      const room = await page.evaluate(([x, z, bx, bz]) => window.__sd.lineOfSight(x, 1, z, bx, 1, bz), [g.x, g.z, g.x - dx * 2.2, g.z - dz * 2.2]);
      if (wall && room) dir = { dx, dz, r };
    }
  }
  if (!g || !dir) check('戰士：把盾衛推去撞牆', false, '找不到牆');
  else {
    console.log('INFO 推向牆', JSON.stringify(dir));
    await walkTo(g.x - dir.dx * 1.45, g.z - dir.dz * 1.45, 0.3);
    let first = true;
    const t0 = Date.now();
    while (Date.now() - t0 < 50000) {
      const s = await st();
      if (s.stats.wallSlams >= 1 || s.player.dead || s.mode !== 'playing') break;
      const gg = s.enemies.find((e) => e.id === g.id);
      if (!gg || !gg.alive) break;
      const p = s.player;
      if (gg.pushing || p.action) {
        await page.waitForTimeout(40);
        continue;
      }
      // 站位：盾衛與牆的反方向（盾衛大致在我和牆之間就推）
      const want = { x: gg.x - dir.dx * 1.5, z: gg.z - dir.dz * 1.5 };
      const off = Math.hypot(want.x - p.x, want.z - p.z);
      const gd = Math.hypot(gg.x - p.x, gg.z - p.z) || 1;
      const aligned = ((gg.x - p.x) * dir.dx + (gg.z - p.z) * dir.dz) / gd > 0.85;
      if (s.cue.push === g.id && aligned) {
        await lookAtPoint(gg.x, 1.2, gg.z, 0.05);
        const s2 = await st();
        if (s2.cue.push !== g.id) continue;
        if (first) check('戰士：盾衛就在身前時出現「盾推」提示', s2.cueText === '盾推', `cue.push=${s2.cue.push} text=${s2.cueText}`);
        first = false;
        console.log('INFO 盾推', `player=(${p.x.toFixed(1)},${p.z.toFixed(1)}) guard=(${gg.x.toFixed(1)},${gg.z.toFixed(1)}) ${gg.state}/${gg.phase}`);
        await bot.tap('KeyF');
        await bot.waitIdle();
        continue;
      }
      if (off > 0.25) {
        await lookAt(yawTo(p.x, p.z, want.x, want.z), 0, 0.08);
        await bot.down('KeyW');
        await page.waitForTimeout(Math.min(250, off * 250));
        await bot.up('KeyW');
      } else await page.waitForTimeout(40);
    }
    await page.waitForTimeout(300);
    const s = await st();
    const g2 = s.enemies.find((e) => e.id === g.id);
    await shot('warrior-shield-wall');
    check('戰士：盾推把盾衛推去撞牆（失衡）', s.stats.pushes >= 1 && s.stats.wallSlams >= 1, `pushes=${s.stats.pushes} wallSlams=${s.stats.wallSlams} phase=${g2?.phase}`);
    const la = s.lastAction;
    check('戰士：盾推花完整行動時間（0.4 秒）', !!la && la.kind === 'shield' && Math.abs(la.spent - 0.4) < 0.02, JSON.stringify(la));
  }
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
      await fastClick();
      if (s.cue.counter.kind === 'bolt' && !deflectShot) {
        deflectShot = true;
        await shot('warrior-deflect-ready');
      }
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
  console.log('INFO 弩手', a.alive ? `存活 hp=${a.hp}` : '被擊倒', ' 戰士生命', s.player.hp, ' 反擊', s.stats.counters, ' 擊開', s.stats.deflects, ' 投擲石', s.player.stones);
}
await toMenu();

// ---------- 3) 獵手：獵人之眼空爆、麻痺箭、冰寒箭 ----------
await startPractice('huntress');
{
  // 麻痺箭：射睡著的盾衛（靜止目標，身體沒有盾擋）
  const s0 = await st();
  const g = s0.enemies.find((e) => e.kind === 'guard' && e.alive && e.state === 'sleep');
  if (!g) check('獵手：麻痺箭讓盾衛定格', false, '找不到睡著的盾衛');
  else {
    const p0 = s0.player;
    const d0 = Math.hypot(g.x - p0.x, g.z - p0.z);
    const f = Math.max(0, (d0 - 6) / d0);
    await walkTo(p0.x + (g.x - p0.x) * f, p0.z + (g.z - p0.z) * f, 0.8);
    await bot.tap('Digit3');
    const pre = await st();
    check('獵手：按 3 拿藥劑箭（麻痺）', pre.player.tool === 'tipped' && pre.player.tipKind === 'paralysis', `${pre.player.tool}/${pre.player.tipKind}`);
    await lookAtPoint(g.x, 1.0, g.z, 0.01);
    await fastClick();
    for (let k = 0; k < 100 && !(await st()).player.action; k++) await page.waitForTimeout(10);
    let frozen = null;
    for (let k = 0; k < 200; k++) {
      const x = await st();
      const gg = x.enemies.find((e) => e.id === g.id);
      if (gg && gg.paralyzeT > 0) {
        frozen = gg;
        break;
      }
      if (!x.projectiles.some((q) => q.kind === 'arrow') && !x.player.action) break;
      await page.waitForTimeout(30);
    }
    await shot('huntress-paralysis');
    const s = await st();
    check('獵手：麻痺箭命中，盾衛的時間軸暫停', !!frozen, frozen ? `paralyzeT=${frozen.paralyzeT.toFixed(2)} phase=${frozen.phase}` : `tipHits=${s.stats.tipHits}`);
    check('獵手：藥劑箭少了一支（麻痺 2 → 1）', s.player.tipped.paralysis === 1, JSON.stringify(s.player.tipped));
  }
}
await resetPractice('獵手空爆');
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
  const s1 = await st();
  const eye0 = s1.cue.eye[0];
  check('獵人之眼：空中的瓶子有落點圈與提前量標記', !!eye0 && !!eye0.landing && !!eye0.aim, JSON.stringify(eye0 ?? null).slice(0, 80));
  const marks = await page.locator('#targets .tmark.lead').count();
  check('獵人之眼：畫面上出現提前量標記（菱形）', marks >= 1, `marks=${marks}`);
  await shot('huntress-eye');
  // 跟著標記轉動滑鼠，等瓶子過了最高點、準星對上標記（提示「放箭」）就射
  let fired = false;
  const t0 = Date.now();
  while (Date.now() - t0 < 25000 && !fired) {
    const s = await st();
    const b = s.projectiles.find((q) => q.kind === 'bottle');
    const e = s.cue.eye[0];
    if (!b || !e || !e.aim) {
      console.log('INFO 瓶子', b ? `y=${b.y.toFixed(2)} vy=${b.vy.toFixed(2)}` : '已落地', 'eye', JSON.stringify(e ?? null));
      break;
    }
    await lookAt(e.aim.yaw, e.aim.pitch, 0.008);
    const s2 = await st();
    const e2 = s2.cue.eye[0];
    console.log('INFO 瞄準標記', e2?.aim ? `dYaw=${wrap(e2.aim.yaw - s2.player.yaw).toFixed(4)} dPitch=${(e2.aim.pitch - s2.player.pitch).toFixed(4)}` : '-', 'cue', s2.cueText);
    if (s2.cueText === '放箭') {
      await fastClick();
      fired = true;
    }
  }
  for (let k = 0; k < 100 && !(await st()).player.action; k++) await page.waitForTimeout(10);
  await bot.waitIdle();
  const la = (await st()).lastAction;
  for (let k = 0; k < 400; k++) {
    const x = await st();
    if (!x.projectiles.some((q) => q.kind === 'bottle' || q.kind === 'arrow')) break;
    await page.waitForTimeout(50);
  }
  await page.waitForTimeout(400);
  const s = await st();
  await shot('huntress-airburst');
  check('獵手：對準提前量標記射擊，瓶子在空中炸開', fired && s.stats.airbursts >= 1, `fired=${fired} airbursts=${s.stats.airbursts}`);
  check('獵手：這一箭照常花完整射擊時間（0.8 秒，沒有時間特權）', !!la && la.kind === 'bow' && Math.abs(la.spent - 0.8) < 0.02, JSON.stringify(la));
}
{
  // 冰寒箭：射擊場的突進者（衝鋒以外的時候射它）
  await enterRange('獵手');
  await bot.tap('Digit3');
  // 兩次按鍵要落在不同幀（軟體渲染約 8 fps；同一幀內的兩次按下只算一次）
  await page.waitForFunction(() => window.__sd.state().player.tool === 'tipped', null, { timeout: 3000 });
  await page.waitForTimeout(250);
  await bot.tap('Digit3');
  await page.waitForTimeout(250);
  const pre = await st();
  check('獵手：再按一次 3 切換成冰寒箭', pre.player.tipKind === 'chill', pre.player.tipKind);
  let chilled = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 60000 && !chilled) {
    const s = await st();
    if (s.player.dead || s.mode !== 'playing') {
      console.log('INFO 獵手倒下', JSON.stringify(s.stats.damageTaken));
      break;
    }
    const c = s.enemies.find((e) => e.kind === 'charger' && e.alive);
    if (!c) break;
    if (!globalThis.__clog || Date.now() - globalThis.__clog > 2500) {
      globalThis.__clog = Date.now();
      console.log('INFO 突進者', c.state, c.phase, `d=${Math.hypot(c.x - s.player.x, c.z - s.player.z).toFixed(1)} hp=${s.player.hp} dmg=${JSON.stringify(s.stats.damageTaken)}`);
    }
    if (c.slowT > 0) {
      chilled = c;
      break;
    }
    if (c.phase !== 'charge' && !s.player.action && !s.projectiles.some((q) => q.kind === 'arrow')) {
      await lookAtPoint(c.x, 1.0, c.z, 0.01);
      const s3 = await st();
      const c3 = s3.enemies.find((e) => e.id === c.id);
      console.log('INFO 冰寒箭出手', `phase=${c3.phase} d=${Math.hypot(c3.x - s3.player.x, c3.z - s3.player.z).toFixed(1)} tool=${s3.player.tool} hp=${s3.player.hp}`);
      await fastClick();
      for (let k = 0; k < 100 && !(await st()).player.action; k++) await page.waitForTimeout(10);
      await bot.waitIdle();
      continue;
    }
    if (c.phase === 'charge') {
      // 衝鋒來了：側移閃開
      await bot.down('KeyA');
      await page.waitForTimeout(300);
      await bot.up('KeyA');
      continue;
    }
    // 看向突進者，等它蓄勢
    if (Math.abs(wrap(yawTo(s.player.x, s.player.z, c.x, c.z) - s.player.yaw)) > 0.15) await bot.turnTo(yawTo(s.player.x, s.player.z, c.x, c.z), 0.1);
    await page.waitForTimeout(40);
  }
  await shot('huntress-chill');
  const s = await st();
  check('獵手：冰寒箭命中突進者，時間軸變慢', !!chilled, chilled ? `slowT=${chilled.slowT.toFixed(2)} phase=${chilled.phase}` : `tipHits=${s.stats.tipHits} hp=${s.player.hp}`);
}

check('全程無 console 錯誤', errors.length === 0, errors.join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
