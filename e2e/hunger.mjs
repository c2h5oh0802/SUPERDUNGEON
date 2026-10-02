// Hunger UI integration. Normal keyboard/menu actions; explicit debug.advance/giveItem
// are used only to reach thresholds quickly in the practice map, never as playthrough proof.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { launch, BASE, OUT, Bot, startRun, selectInventoryItem } from './lib.mjs';

mkdirSync(OUT, { recursive: true });
const { browser, page, errors } = await launch({ viewport: { width: 1000, height: 650 } });
const bot = new Bot(page);
const state = () => bot.st();
const waitPlaying = () => page.waitForFunction(() => window.__sd.state().mode === 'playing');
const frozen = async (name) => {
  const before = await state();
  await page.waitForTimeout(700);
  const after = await state();
  assert.equal(after.time, before.time, `${name}: world frozen`);
  assert.equal(after.player.hunger, before.player.hunger, `${name}: hunger frozen`);
  assert.equal(after.player.starvationT, before.player.starvationT, `${name}: damage timer frozen`);
  console.log(`PASS ${name} freezes world and Hunger`);
};
try {
  await page.goto(`${BASE}?dev=1&gfx=low`);
  await page.click('#btn-practice'); await waitPlaying();
  assert.ok((await page.textContent('#hunger-label')).includes('正常'));
  // Standing eye remains exactly the same under Shift, including while moving.
  await bot.down('ShiftLeft'); await bot.down('KeyW'); await page.waitForTimeout(200);
  await bot.up('KeyW');
  let s = await state();
  assert.equal(s.player.sneaking, true); assert.equal(s.player.hitHeight, 1.8); assert.equal(s.player.eyeY, 1.6);
  assert.ok((await page.textContent('#stealth')).includes('安靜'));
  await bot.releaseAll();
  const begin = await state(); await page.waitForTimeout(600); const idle = await state();
  assert.ok(Math.abs((idle.player.hunger - begin.player.hunger) - (idle.time - begin.time)) < 1e-6);
  await bot.down('Space'); await page.waitForTimeout(600); await bot.up('Space');
  const wait = await state();
  assert.ok(wait.player.hunger - idle.player.hunger > (idle.player.hunger - begin.player.hunger) * 3);

  await bot.tap('KeyI'); await page.waitForFunction(() => window.__sd.state().mode === 'inventory');
  await frozen('inventory'); await bot.tap('KeyI'); await waitPlaying();
  await bot.tap('Tab'); await page.waitForFunction(() => window.__sd.state().mode === 'map');
  await frozen('map'); await bot.tap('Tab'); await waitPlaying();
  await bot.tap('Escape'); await page.waitForFunction(() => window.__sd.state().mode === 'paused');
  await frozen('pause'); await page.click('#btn-resume'); await waitPlaying();

  // Upgrade/talent modal freezing uses existing practice items and debug XP.
  await bot.tap('KeyI'); await page.waitForFunction(() => window.__sd.state().mode === 'inventory');
  const upgrade = (await state()).player.items.findIndex((it) => it.id === 'scroll:upgrade');
  await selectInventoryItem(page, upgrade);
  await page.click(`#inv-list button[data-k="${upgrade}"][data-m="use"]`);
  await page.waitForFunction(() => window.__sd.state().mode === 'choice');
  await frozen('upgrade'); await page.click('#choice-cards button[data-idx="0"]'); await waitPlaying();
  await page.evaluate(() => window.__sd.debug.giveXp(10));
  await page.waitForFunction(() => window.__sd.state().mode === 'choice');
  await frozen('talent'); await page.click('#choice-cards button[data-idx="0"]'); await waitPlaying();

  // Threshold setup is labeled injection; following damage/eating checks use real input.
  await page.evaluate(() => { window.__sd.debug.setInvisible(300); window.__sd.debug.advance(120); window.__sd.debug.giveItem('food:ration'); });
  await page.waitForFunction(() => window.__sd.state().player.hungerState === 'hungry');
  assert.ok((await page.textContent('#hunger-label')).includes('飢餓'));
  await page.evaluate(() => window.__sd.debug.advance(60));
  await page.waitForFunction(() => window.__sd.state().player.hungerState === 'starving');
  s = await state(); const hp = s.player.hp;
  await bot.down('Space');
  await page.waitForFunction((hp) => window.__sd.state().player.hp === hp - 1, hp, { timeout: 20000 });
  await bot.up('Space');
  assert.ok((await page.textContent('#hunger-label')).includes('瀕餓'));
  await bot.tap('KeyI'); await page.waitForFunction(() => window.__sd.state().mode === 'inventory');
  const food = (await state()).player.items.findIndex((it) => it.id === 'food:ration');
  assert.ok((await page.textContent('#inv-list')).includes('乾糧'));
  await selectInventoryItem(page, food);
  await page.click(`#inv-list button[data-k="${food}"][data-m="use"]`);
  await page.waitForFunction(() => window.__sd.state().player.action?.kind === 'eat');
  assert.equal((await state()).player.hungerState, 'starving');
  await bot.waitIdle(); s = await state();
  assert.ok(s.player.hunger < 121); assert.equal(s.player.starvationT, 0);
  assert.equal(s.lastAction.kind, 'eat'); assert.ok(Math.abs(s.lastAction.spent - .8) < .02);
  await page.screenshot({ path: `${OUT}hunger-after-food.png` });

  // Real generated item; explicitly injected position at an exploration-room ration.
  await page.reload(); await startRun(page, 'HUNGER-UI');
  await page.evaluate(() => {
    const food = window.__sd.state().pickups.find((it) => it.item === 'food:ration');
    window.__sd.debug.teleport(food.x, food.z);
  });
  await page.waitForFunction(() => window.__sd.state().player.items.some((it) => it.id === 'food:ration'));
  assert.equal((await state()).player.items.find((it) => it.id === 'food:ration').count, 1);
  assert.deepEqual(errors, []);
  console.log('PASS Hunger HUD, standing Shift eye, time costs, all pause UIs, starvation, eat action and generated ration pickup');
} finally { await browser.close(); }
