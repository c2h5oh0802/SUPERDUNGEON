// Normal adventure entry and normal inventory/input paths. Gear grants and
// starting-position teleport are explicit test setup injections, not a full playthrough.
import { mkdirSync, writeFileSync } from 'node:fs';
import { BASE, OUT, launch } from './lib.mjs';

mkdirSync(OUT, { recursive: true });
const { browser, page, errors } = await launch();
const results = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`);
  if (!ok) throw new Error(name);
};
try {
  await page.goto(`${BASE}?dev=1&gfx=low`);
  await page.click('.class-card[data-cls="huntress"]');
  await page.fill('#seed-input', 'LIVING1');
  await page.click('#btn-start');
  await page.waitForFunction(() => window.__sd?.state().mode === 'playing', null, { timeout: 90000 });
  check('uses normal four-floor adventure entry', !(await page.evaluate(() => window.__sd.state())).practice);
  const level = await page.evaluate(() => window.__sd.level());
  const room = level.rooms.find(r => r.key === 'E');
  const start = { x: room.x0 + room.w / 2, z: room.z0 + room.h / 2 };
  const state = () => page.evaluate(() => window.__sd.state());
  for (const [id, caps] of [['knife', [0.85, 0.8, 0.95]], ['longsword', [0.65, 0.55, 0.8]], ['spear', [0.4, 0.25, 0.65]], ['axe', [0.35, 0.2, 0.45]]]) {
    if ((await state()).player.weapon.id !== id) {
      await page.evaluate(id => window.__sd.debug.giveItem(`weapon:${id}`), id);
      await page.keyboard.press('KeyI');
      await page.waitForFunction(() => window.__sd.state().mode === 'inventory');
      const index = (await state()).player.items.findIndex(i => i.id === `weapon:${id}`);
      if (id === 'spear') {
        const text = await page.textContent('#inv-list');
        check('inventory communicates thrust time and movement commitment', text.includes('0.85 秒') && text.includes('分階段減速'));
      }
      await page.click(`#inv-list button[data-k="${index}"][data-m="use"]`);
      await page.waitForFunction(id => {
        const s = window.__sd.state();
        return s.mode === 'playing' && s.player.weapon.id === id && !s.player.action && !s.player.pendingUse;
      }, id, { timeout: 20000 });
    }
    await page.evaluate(({ x, z }) => { window.__sd.debug.teleport(x, z); window.__sd.debug.setView(0, 0); }, start);
    await page.keyboard.press('Digit1');
    const samples = page.evaluate(() => new Promise(resolve => {
      const rows = [];
      const begin = performance.now();
      const sample = () => {
        const s = window.__sd.state();
        rows.push({ realTime: s.realTime, worldTime: s.time, x: s.player.x, z: s.player.z, action: s.player.action });
        if (performance.now() - begin > 1600) resolve(rows);
        else requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    }));
    await page.keyboard.down('KeyD');
    await page.mouse.down();
    const rows = await samples;
    await page.mouse.up();
    await page.keyboard.up('KeyD');
    await page.waitForFunction(() => !window.__sd.state().player.action);
    const phase = a => a.t < a.windup ? 0 : a.t < a.windup + a.active ? 1 : 2;
    const speeds = rows.slice(1).flatMap((r, i) => {
      const prev = rows[i];
      const dt = r.realTime - prev.realTime;
      if (dt <= 0 || !r.action || !prev.action || r.action.kind !== 'melee' || prev.action.kind !== 'melee' || r.action.t < prev.action.t || phase(r.action) !== phase(prev.action)) return [];
      return [{ phase: phase(r.action), speed: Math.hypot(r.x - prev.x, r.z - prev.z) / dt }];
    });
    for (let k = 0; k < 3; k++) {
      const samples = speeds.filter(s => s.phase === k);
      const top = Math.max(...samples.map(s => s.speed));
      check(`${id} phase ${k} normal attack/input cap ${caps[k] * 100}%`, samples.length >= 2 && top <= 4.5 * caps[k] + 0.03 && top >= 4.5 * caps[k] - 0.15, `observed=${top.toFixed(3)}m/s samples=${samples.length}`);
    }
    results.push({ id, caps, speeds, rows });
    if (id === 'spear') await page.screenshot({ path: `${OUT}melee-spear-adventure.png` });
  }
  check('no browser console errors', errors.length === 0, errors.join(' | '));
  writeFileSync(`${OUT}melee-movement.json`, JSON.stringify(results, null, 2));
} finally { await browser.close(); }
