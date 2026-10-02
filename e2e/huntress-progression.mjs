// Focused UI regression, explicit debug talent/item injection; not a full-run playtest.
import assert from 'node:assert/strict';
import { launch, BASE, Bot, startRun, selectInventoryItem } from './lib.mjs';
const { browser, page, errors } = await launch();
const bot = new Bot(page);
try {
  await page.goto(`${BASE}?dev=1&gfx=low`);
  await page.click('.class-card[data-cls="huntress"]');
  const copy = await page.locator('body').textContent();
  assert.ok(copy.includes('狩獵標記'));
  assert.ok(!copy.includes('下一次拉弓只要 0.4'));
  await startRun(page, 'HUNTRESS-V2-UI');
  await page.evaluate(() => {
    window.__sd.debug.giveTalent('apothecary');
    window.__sd.debug.giveItem('potion:frost');
    window.__sd.debug.giveItem('potion:frost');
  });
  await bot.tap('KeyI');
  await page.waitForFunction(() => window.__sd.state().mode === 'inventory');
  let s = await bot.st();
  let idx = s.player.items.findIndex(it => it.id === 'potion:frost');
  assert.equal(await page.locator(`#inv-list button[data-k="${idx}"][data-m="convert"]`).count(), 0);
  await selectInventoryItem(page, idx);
  await page.click(`#inv-list button[data-k="${idx}"][data-m="use"]`);
  await page.waitForFunction(() => window.__sd.state().player.known.includes('potion:frost'));
  await bot.tap('KeyI');
  await page.waitForFunction(() => window.__sd.state().mode === 'inventory');
  s = await bot.st(); idx = s.player.items.findIndex(it => it.id === 'potion:frost');
  await selectInventoryItem(page, idx);
  const convert = page.locator(`#inv-list button[data-k="${idx}"][data-m="convert"]`);
  assert.equal(await convert.count(), 1);
  assert.equal(await convert.isDisabled(), true); // 2/3 stock cannot fit batch of2
  await bot.tap('KeyI');
  await page.waitForFunction(() => window.__sd.state().mode === 'playing');
  // Slot3 initially paralysis, pressing again selects chill. Spend one real arrow.
  await bot.tap('Digit3'); await bot.tap('Digit3');
  await bot.click(50);
  await page.waitForFunction(() => window.__sd.state().player.tipped.chill === 1 && !window.__sd.state().player.action);
  await bot.tap('KeyI'); await page.waitForFunction(() => window.__sd.state().mode === 'inventory');
  s = await bot.st(); idx = s.player.items.findIndex(it => it.id === 'potion:frost');
  await selectInventoryItem(page, idx);
  assert.equal(await page.locator(`#inv-list button[data-k="${idx}"][data-m="convert"]`).isDisabled(), false);
  const before = s.time;
  await page.click(`#inv-list button[data-k="${idx}"][data-m="convert"]`);
  await page.waitForFunction(() => window.__sd.state().player.tipped.chill === 3);
  s = await bot.st(); assert.ok(s.time >= before + .59);
  assert.equal(s.player.items.some(it => it.id === 'potion:frost'), false);
  assert.deepEqual(errors, []);
  console.log('PASS Huntress: unknown recipe hidden, capacity protected, paid conversion completion');
} finally { await browser.close(); }
