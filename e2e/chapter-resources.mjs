// Chapter identity/knowledge browser contracts. debug.giveItem is explicit fixture
// injection; class choice, bag inspection, inventory actions and menu pauses are UI.
import assert from 'node:assert/strict';
import { launch, BASE, Bot, startRun } from './lib.mjs';
const { browser, page, errors } = await launch();
const bot = new Bot(page);
try {
  let signature;
  for (const cls of ['warrior', 'huntress']) {
    await page.goto(`${BASE}?dev=1&gfx=low`);
    await page.click(`.class-card[data-cls="${cls}"]`);
    await startRun(page, 'CHAPTER-UI');
    const s = await bot.st();
    const expected = cls === 'warrior' ? ['potion:fire', 'scroll:teleport'] : ['potion:invisibility', 'scroll:mapping'];
    assert.deepEqual(s.player.known, expected);
    assert.equal(s.player.potions, 1);
    const current = await page.evaluate(() => window.__sd.level().signature);
    if (signature) assert.equal(current, signature); else signature = current;
    assert.equal(s.specialRooms.length, 2);
    assert.equal(s.pickups.filter((p) => p.item === 'scroll:upgrade').length, 1);
    assert.equal(s.pickups.filter((p) => p.item === 'food:ration').length, 1);
    await page.evaluate(() => { window.__sd.debug.giveItem('potion:frost'); window.__sd.debug.giveItem('scroll:sleep'); });
    await bot.tap('KeyI');
    await page.waitForFunction(() => window.__sd.state().mode === 'inventory');
    const txt = await page.textContent('#inv-list');
    assert.ok(!txt.includes('冰霜藥水') && !txt.includes('沉睡卷軸'));
    const t = (await bot.st()).time;
    await page.waitForTimeout(250); assert.equal((await bot.st()).time, t);
    const sleep = (await bot.st()).player.items.findIndex((it) => it.id === 'scroll:sleep');
    await page.click(`#inv-list button[data-k="${sleep}"][data-m="use"]`);
    await page.waitForFunction(() => window.__sd.state().player.known.includes('scroll:sleep'));
    assert.ok((await bot.st()).time > t);
    console.log(`PASS ${cls}: class-only knowledge, same seed content, hidden unknown effects, paid Sleep identification`);
    await page.reload();
  }
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
