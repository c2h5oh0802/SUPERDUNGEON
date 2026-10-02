// Focused UI contract. debug.setHp/giveItem are explicit fixture injection,
// not evidence for route survival or human potion discovery.
import assert from 'node:assert/strict';
import { launch, BASE, Bot, startRun, selectInventoryItem } from './lib.mjs';
const { browser, page, errors } = await launch();
const bot = new Bot(page);
const count = (s) => s.player.items.filter((it) => it.id === 'potion:healing').reduce((n, it) => n + it.count, 0);
let swatch;
try {
  for (const cls of ['warrior', 'huntress']) {
    await page.goto(`${BASE}?dev=1&gfx=low`);
    await page.click(`.class-card[data-cls="${cls}"]`);
    await startRun(page, 'HEAL-UI');
    let s = await bot.st();
    assert.equal(count(s), 0); assert.ok(!Object.hasOwn(s.player, 'potions'));
    assert.equal(s.player.known.includes('potion:healing'), cls === 'warrior');
    assert.ok(!s.player.known.includes('potion:fire'));
    await page.evaluate(() => { window.__sd.debug.giveItem('potion:healing'); window.__sd.debug.setHp(2); });
    await bot.tap('KeyI'); await page.waitForFunction(() => window.__sd.state().mode === 'inventory');
    const idx = (await bot.st()).player.items.findIndex((it) => it.id === 'potion:healing');
    const row = page.locator('.inv-row').nth(idx);
    const color = await row.locator('.swatch').evaluate((el) => el.style.background);
    if (swatch) assert.equal(color, swatch); else swatch = color;
    const name = await row.locator('.inv-tile-label').textContent();
    assert.equal(name.includes('治療藥水'), cls === 'warrior');
    const paused = (await bot.st()).time; await page.waitForTimeout(200); assert.equal((await bot.st()).time, paused);
    await bot.tap('KeyI'); await page.waitForFunction(() => window.__sd.state().mode === 'playing');
    const t0 = (await bot.st()).time;
    await bot.tap('KeyH');
    if (cls === 'huntress') {
      await page.waitForTimeout(120);
      s = await bot.st(); assert.equal(count(s), 1); assert.equal(s.player.hp, 2);
      assert.ok(!s.player.known.includes('potion:healing'));
      assert.equal(await page.textContent('#potions'), '0');
      await bot.tap('KeyI'); await page.waitForFunction(() => window.__sd.state().mode === 'inventory');
      await selectInventoryItem(page, idx);
      await page.click(`#inv-list button[data-k="${idx}"][data-m="use"]`);
    }
    await page.waitForFunction(() => window.__sd.state().stats.healingUsed === 1);
    s = await bot.st(); assert.equal(s.player.hp, 7); assert.equal(count(s), 0);
    assert.ok(s.player.known.includes('potion:healing')); assert.ok(s.time > t0 + .4);
    assert.equal(s.stats.itemsUsed, 1); assert.equal(s.stats.potionsUsed, 1);
    await page.evaluate(() => { window.__sd.debug.giveItem('potion:healing'); window.__sd.debug.setHp(window.__sd.state().player.maxHp); });
    await bot.tap('KeyH'); await page.waitForTimeout(100);
    assert.equal(count(await bot.st()), 1);
    await bot.tap('KeyI'); await page.waitForFunction(() => window.__sd.state().mode === 'inventory');
    const fullIdx = (await bot.st()).player.items.findIndex((it) => it.id === 'potion:healing');
    await selectInventoryItem(page, fullIdx);
    assert.equal(await page.locator(`#inv-list button[data-k="${fullIdx}"][data-m="use"]`).isDisabled(), true);
    await bot.tap('KeyI'); await page.waitForFunction(() => window.__sd.state().mode === 'playing');
    await page.evaluate(() => window.__sd.debug.setHp(2)); await bot.tap('KeyH');
    await page.waitForFunction(() => window.__sd.state().stats.healingUsed === 2);
    assert.equal((await bot.st()).player.hp, 7);
    console.log(`PASS ${cls}: known-only H, manual identification, shared paid healing, same appearance, full HP guard`);
  }
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
