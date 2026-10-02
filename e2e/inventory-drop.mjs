// Debug-created inventory/position fixtures; real bag buttons and action clocks.
// This is a UI contract check, not evidence of natural acquisition or game feel.
import assert from 'node:assert/strict';
import { launch, BASE, Bot, startRun, selectInventoryItem } from './lib.mjs';
const { browser, page, errors } = await launch({ viewport: { width: 860, height: 480 } });
const bot = new Bot(page);
const count = (s, id) => s.player.items.filter(i => i.id === id).reduce((n, i) => n + i.count, 0);
async function openBag() {
  await bot.tap('KeyI');
  await page.waitForFunction(() => window.__sd.state().mode === 'inventory');
}
async function place(id, mode) {
  const index = (await bot.st()).player.items.findIndex(i => i.id === id);
  assert.ok(index >= 0);
  await selectInventoryItem(page, index);
  await page.click(`#inv-list button[data-k="${index}"][data-m="${mode}"]`);
  await page.waitForFunction(() => {
    const s = window.__sd.state();
    return s.mode === 'playing' && !s.player.action && !s.player.pendingUse;
  });
}
try {
  await page.goto(`${BASE}?dev=1&gfx=low`);
  await page.click('.class-card[data-cls="huntress"]');
  await startRun(page, 'DROP-UI');
  await page.evaluate(() => {
    for (let k = 0; k < 3; k++) window.__sd.debug.giveItem('potion:healing');
    for (let k = 0; k < 9; k++) window.__sd.debug.giveItem('weapon:spear', 5);
  });
  await openBag();
  let s = await bot.st();
  const origin = { x: s.player.x, z: s.player.z };
  assert.equal(s.player.items.length, 10);
  assert.ok(!(await page.textContent('#inv-list')).includes('治療藥水'));
  const paused = { time: s.time, hunger: s.player.hunger };
  await page.waitForTimeout(200);
  s = await bot.st();
  assert.equal(s.time, paused.time); assert.equal(s.player.hunger, paused.hunger);
  await place('potion:healing', 'drop');
  s = await bot.st();
  assert.equal(count(s, 'potion:healing'), 2);
  assert.equal(s.lastAction.kind, 'drop');
  assert.ok(s.time >= paused.time + .29);
  assert.equal(s.pickups.filter(p => p.item === 'potion:healing' && p.x === origin.x && p.z === origin.z).reduce((n,p) => n+p.amount,0), 1);
  await page.waitForTimeout(250);
  assert.equal(count(await bot.st(), 'potion:healing'), 2); // No instant re-pickup.
  await openBag(); await place('potion:healing', 'dropAll');
  s = await bot.st(); assert.equal(count(s, 'potion:healing'), 0); assert.equal(s.player.items.length, 9);
  const found = s.stats.healingFound;
  // Fixture relocation across the pickup radius, then actual frame-based re-acquisition.
  const awayAt = await page.evaluate(({x,z}) => {
    window.__sd.debug.teleport(x, z + 1.5);
    return window.__sd.state().realTime;
  }, origin);
  await page.waitForFunction(time => window.__sd.state().realTime > time, awayAt);
  await page.evaluate(({x,z}) => window.__sd.debug.teleport(x,z), origin);
  await page.waitForFunction(() => window.__sd.state().player.items.some(i => i.id === 'potion:healing' && i.count === 3));
  s = await bot.st(); assert.equal(s.stats.healingFound, found); assert.equal(s.stats.healingUsed, 0);
  assert.ok(!s.player.known.includes('potion:healing'));
  await openBag();
  await selectInventoryItem(page, (await bot.st()).player.items.length - 1);
  const lastDrop = page.locator('#inv-list .inv-detail:not([hidden]) button[data-m="drop"]').last();
  await lastDrop.scrollIntoViewIfNeeded();
  const bounds = await lastDrop.boundingBox();
  assert.ok(bounds && bounds.y >= 0 && bounds.y + bounds.height <= 480);
  await place('weapon:spear', 'drop');
  s = await bot.st(); assert.equal(count(s, 'weapon:spear'), 8);
  assert.ok(s.pickups.some(p => p.item === 'weapon:spear'));
  await openBag(); await bot.tap('KeyI'); await openBag(); await bot.tap('Escape');
  await page.waitForFunction(() => window.__sd.state().mode === 'playing');
  assert.deepEqual(errors, []);
  console.log('PASS inventory drop: one/all, full bag, paid action, intact unknown item, re-pickup gating, statistics, short viewport, repeated close');
} finally { await browser.close(); }
