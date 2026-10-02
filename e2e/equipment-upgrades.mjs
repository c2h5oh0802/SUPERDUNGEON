// Explicit gear/item fixture injection; real inventory buttons and paid actions.
// This checks UI contracts, not natural loot acquisition or human game feel.
import assert from 'node:assert/strict';
import { launch, BASE, Bot, startRun, selectInventoryItem } from './lib.mjs';
const { browser, page, errors } = await launch({ viewport: { width: 860, height: 480 } });
const bot = new Bot(page);
const st = () => bot.st();
async function openBag() {
  await bot.tap('KeyI');
  await page.waitForFunction(() => window.__sd.state().mode === 'inventory');
}
async function use(id, level) {
  const index = (await st()).player.items.findIndex(it => it.id === id && (level === undefined || it.level === level));
  assert.ok(index >= 0, `${id} exists`);
  await selectInventoryItem(page, index);
  await page.click(`#inv-list button[data-k="${index}"][data-m="use"]`);
}
async function idle() {
  await page.waitForFunction(() => {
    const s = window.__sd.state();
    return s.mode === 'playing' && !s.player.action && !s.player.pendingUse;
  });
}
async function choice(target) {
  await page.waitForFunction(() => window.__sd.state().mode === 'choice');
  const s = await st();
  const index = s.pendingChoice.options.indexOf(target);
  assert.ok(index >= 0, `${target} offered`);
  return page.locator(`#choice-cards .choice-card[data-idx="${index}"]`);
}
try {
  await page.goto(`${BASE}?dev=1&gfx=low`);
  await page.click('.class-card[data-cls="warrior"]');
  await startRun(page, 'EQUIPMENT-UI');
  await page.evaluate(() => {
    window.__sd.debug.giveItem('weapon:longsword', 5);
    window.__sd.debug.giveItem('armor:mail');
    window.__sd.debug.giveItem('scroll:upgrade');
    window.__sd.debug.giveItem('scroll:upgrade');
    window.__sd.debug.giveItem('potion:frost');
  });
  await openBag();
  let text = await page.textContent('#inv-list');
  assert.ok(text.includes('主傷 9'));
  assert.ok(text.includes('對比目前'));
  assert.ok(!text.includes('冰霜藥水'));
  const beforePause = await st();
  await page.waitForTimeout(250);
  assert.equal((await st()).time, beforePause.time);
  assert.equal((await st()).player.hunger, beforePause.player.hunger);
  await use('weapon:longsword', 5); await idle();
  await openBag(); await use('armor:mail'); await idle();
  await openBag(); await use('scroll:upgrade');
  const armorCard = await choice('armor');
  assert.deepEqual((await st()).pendingChoice.options, ['armor']);
  assert.ok((await armorCard.textContent()).includes('2 → 3'));
  const choicePause = await st();
  await page.waitForTimeout(250);
  assert.equal((await st()).time, choicePause.time);
  assert.equal((await st()).player.hunger, choicePause.player.hunger);
  await armorCard.click(); await idle();
  assert.deepEqual((await st()).player.armor, { id: 'mail', level: 1 });
  await openBag();
  text = await page.textContent('#inv-gear');
  assert.ok(text.includes('減傷 3'));
  assert.ok(text.includes('6 m') && text.includes('40%'));
  const scrollIndex = (await st()).player.items.findIndex(it => it.id === 'scroll:upgrade');
  await selectInventoryItem(page, scrollIndex);
  assert.equal(await page.locator(`#inv-list button[data-k="${scrollIndex}"][data-m="use"]`).isDisabled(), true);
  assert.equal((await st()).player.items[scrollIndex].count, 1);
  // The short-viewport panel is scrollable, so expanded comparisons cannot trap controls.
  assert.equal(await page.locator('.inv-panel').evaluate(el => ['auto', 'scroll'].includes(window.getComputedStyle(el).overflowY)), true);
  await page.locator('#inv-gear .equipment-details summary').first().click();
  const close = page.locator('#btn-inv-close');
  await close.scrollIntoViewIfNeeded();
  assert.ok(await close.isVisible());
  const closeBounds = await close.boundingBox();
  assert.ok(closeBounds && closeBounds.y >= 0 && closeBounds.y + closeBounds.height <= 480);
  await selectInventoryItem(page, (await st()).player.items.length - 1);
  const lastAction = page.locator('#inv-list .inv-detail:not([hidden]) .acts button').last();
  await lastAction.scrollIntoViewIfNeeded();
  const actionBounds = await lastAction.boundingBox();
  assert.ok(actionBounds && actionBounds.y >= 0 && actionBounds.y + actionBounds.height <= 480);
  await bot.tap('KeyI'); await idle();
  await page.evaluate(() => window.__sd.debug.giveItem('armor:leather', 2));
  await openBag(); await use('armor:leather', 2); await idle();
  assert.ok((await st()).player.items.some(it => it.id === 'armor:mail' && it.level === 1));
  await openBag();
  assert.ok((await page.textContent('#inv-list')).includes('更吵'));
  await bot.tap('KeyI'); await idle();
  // Repeat opening/closing leaves one current inventory and no active action.
  await openBag(); await bot.tap('KeyI'); await idle();

  await page.goto(`${BASE}?dev=1&gfx=low`);
  await page.click('.class-card[data-cls="huntress"]');
  await startRun(page, 'EQUIPMENT-BOW-UI');
  await page.evaluate(() => {
    window.__sd.debug.giveItem('scroll:upgrade');
    window.__sd.debug.giveItem('scroll:upgrade');
  });
  for (const level of [0, 1]) {
    await openBag(); await use('scroll:upgrade');
    const bowCard = await choice('bow');
    const copy = await bowCard.textContent();
    assert.ok(copy.includes(`${3 + level} → ${4 + level}`));
    assert.ok(copy.includes(`${6 + level * 2} → ${8 + level * 2}`));
    await bowCard.click(); await idle();
  }
  await openBag();
  text = await page.textContent('#inv-gear');
  assert.ok(text.includes('身體 5') && text.includes('頭部 10'));
  assert.equal((await st()).player.bowLevel, 2);
  assert.deepEqual(errors, []);
  console.log('PASS equipment: actual values/comparison, armor cap/scroll retention, pause, swap investment, bow previews');
} finally { await browser.close(); }
