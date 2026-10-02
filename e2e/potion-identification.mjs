// Normal bag/input flow with explicit debug item supply; not a human playtest.
import assert from 'node:assert/strict';
import { launch, BASE, Bot, startRun, selectInventoryItem } from './lib.mjs';
const { browser, page, errors } = await launch();
const bot = new Bot(page);
try {
  await page.goto(`${BASE}?dev=1&gfx=low`);
  await page.click('.class-card[data-cls="warrior"]');
  await startRun(page, 'POTION-EVIDENCE');
  await bot.pitchTo(-.35);
  await page.evaluate(() => {
    for (let i = 0; i < 2; i++) window.__sd.debug.giveItem('potion:invisibility');
  });
  await bot.tap('KeyI');
  await page.waitForFunction(() => window.__sd.state().mode === 'inventory');
  const before = await bot.st();
  const idx = before.player.items.findIndex((it) => it.id === 'potion:invisibility');
  const unknownText = await page.locator('#inv-list').textContent();
  assert.ok(!unknownText.includes('隱形藥水'));
  await selectInventoryItem(page, idx);
  await page.click(`#inv-list button[data-k="${idx}"][data-m="throw"]`);
  await bot.down('Space'); await page.waitForTimeout(1800); await bot.up('Space');
  const after = await bot.st();
  assert.equal(after.player.known.includes('potion:invisibility'), false);
  assert.equal(after.player.items.find((it) => it.id === 'potion:invisibility').count, 1);
  await bot.tap('KeyI'); await page.waitForFunction(() => window.__sd.state().mode === 'inventory');
  assert.ok(!(await page.locator('#inv-list').textContent()).includes('隱形藥水'));
  const remaining = (await bot.st()).player.items.findIndex((it) => it.id === 'potion:invisibility');
  await selectInventoryItem(page, remaining);
  await page.click(`#inv-list button[data-k="${remaining}"][data-m="use"]`);
  await page.waitForFunction(() => window.__sd.state().player.known.includes('potion:invisibility'));
  assert.deepEqual(errors, []);
  console.log('PASS: harmless throw consumes but stays unknown; manual drinking identifies');
} finally { await browser.close(); }
