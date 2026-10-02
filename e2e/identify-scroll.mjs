// Explicit debug.giveItem / setInvisible / giveXp fixture injection only.
// Selection, read, cancel, keyboard, touch and inventory use the real UI.
// This verifies UI contracts, not natural loot acquisition or human game feel.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { BASE, OUT, launch, startRun, selectInventoryItem } from './lib.mjs';

mkdirSync(OUT, { recursive: true });
const { browser, page, errors } = await launch();
const ids = ['potion:fire', 'potion:frost', 'potion:gas', 'potion:invisibility', 'potion:haste', 'scroll:mapping', 'scroll:sleep'];
const effects = ['火焰藥水', '冰霜藥水', '麻痺氣體', '隱形藥水', '迅捷藥水', '地圖卷軸', '沉睡卷軸'];
const state = p => p.evaluate(() => window.__sd.state());
const mode = (p, desired) => p.waitForFunction(desired => window.__sd?.state().mode === desired, desired);
const count = (s, id) => s.player.items.filter(it => it.id === id).reduce((n, it) => n + it.count, 0);
const idle = p => p.waitForFunction(() => {
  const s = window.__sd.state(); return s.mode === 'playing' && !s.player.action && !s.player.pendingUse;
});
async function fixtures(p, targets = ids, scrolls = 2) {
  const injected = await p.evaluate(({ targets, scrolls }) => {
    const d = window.__sd.debug; d.setInvisible(1000);
    return [...Array.from({ length: scrolls }, () => d.giveItem('scroll:identify')),
      ...targets.flatMap(id => [d.giveItem(id), d.giveItem(id)])];
  }, { targets, scrolls });
  assert.ok(injected.every(Boolean));
}
async function readIdentify(p, touch = false) {
  if (touch) await p.locator('#touch-inventory').tap(); else await p.keyboard.press('KeyI');
  await mode(p, 'inventory');
  const index = (await state(p)).player.items.findIndex(it => it.id === 'scroll:identify');
  assert.ok(index >= 0);
  const tile = p.locator(`#inv-list button[data-select="${index}"]`);
  if (touch) await tile.tap(); else await tile.click();
  const button = p.locator(`#inv-list button[data-k="${index}"][data-m="use"]`);
  assert.equal(await button.isEnabled(), true);
  if (touch) await button.tap(); else await button.click();
  await mode(p, 'choice');
  const s = await state(p);
  assert.equal(s.pendingChoice.kind, 'identify');
  assert.equal(await p.textContent('#choice-title'), '選一件未知物品鑑定');
  const copy = await p.textContent('#choice-sub');
  assert.ok(copy.includes('同種類一起變已知') && copy.includes('其他種類不受影響'));
  return s;
}
async function privateFrozen(p) {
  const before = await state(p), html = await p.locator('#choice-cards').innerHTML();
  for (const id of ids) assert.ok(!html.includes(id), `no hidden item ID: ${id}`);
  for (const name of effects) assert.ok(!html.includes(name), `no effect label: ${name}`);
  assert.ok(!/data-item|data-effect/.test(html));
  await p.waitForFunction(() => [...document.querySelectorAll('#choice-cards img')].every(img => img.complete && img.naturalWidth > 0));
  for (const image of await p.locator('#choice-cards img').evaluateAll(images => images.map(img => ({ src: img.currentSrc, alt: img.alt })))) {
    assert.equal(image.alt, ''); assert.match(image.src, /\/(?:potion|scroll)-look-[a-z]+(?:-[a-zA-Z0-9_-]+)?\.webp$/);
  }
  await p.waitForTimeout(200);
  const after = await state(p);
  assert.equal(after.time, before.time); assert.equal(after.player.hunger, before.player.hunger);
  assert.deepEqual(after.player.items, before.player.items);
}
async function reachable(p, viewport) {
  const buttons = p.locator('#choice-cards button');
  for (let k = 0; k < await buttons.count(); k++) {
    const b = buttons.nth(k); await b.scrollIntoViewIfNeeded();
    await b.click({ trial: true });
    const r = await b.boundingBox();
    assert.ok(r && r.width >= 44 && r.height >= 44 && r.x >= 0 && r.y >= 0 && r.x + r.width <= viewport.width + 1 && r.y + r.height <= viewport.height + 1);
  }
  assert.equal(await p.locator('#screen-choice .panel').evaluate(el => el.scrollWidth <= el.clientWidth + 1), true);
}
try {
  await page.goto(`${BASE}?dev=1&gfx=low`);
  await page.click('.class-card[data-cls="warrior"]');
  await startRun(page, 'IDENTIFY-UI'); await fixtures(page);
  const initial = await state(page);
  for (const method of ['button', 'escape']) {
    await readIdentify(page); await privateFrozen(page);
    const first = page.locator('#choice-cards .choice-card').first(), cancel = page.locator('#btn-identify-cancel');
    await first.focus(); await page.keyboard.press('Shift+Tab');
    assert.equal(await cancel.evaluate(el => document.activeElement === el), true);
    await page.keyboard.press('Tab'); assert.equal(await first.evaluate(el => document.activeElement === el), true);
    if (method === 'button') await cancel.click(); else await page.keyboard.press('Escape');
    await idle(page);
    const after = await state(page);
    assert.equal(count(after, 'scroll:identify'), count(initial, 'scroll:identify'));
    assert.deepEqual(after.player.known, initial.player.known);
    assert.equal(after.stats.itemsUsed, initial.stats.itemsUsed);
    assert.deepEqual(await page.evaluate(() => window.__sd.inputState().held), []);
  }
  const pending = await readIdentify(page);
  assert.equal(pending.pendingChoice.options.length, 7);
  await privateFrozen(page);
  await reachable(page, { width: 1280, height: 720 });
  await page.screenshot({ path: `${OUT}identify-desktop.png` });
  const target = pending.pendingChoice.options[6].id;
  // Numeric selection beyond the previous three-option keyboard limit.
  await page.keyboard.press('Digit7'); await idle(page);
  const identified = await state(page);
  assert.deepEqual(identified.player.known.filter(id => !initial.player.known.includes(id)), [target]);
  for (const id of ids) assert.equal(count(identified, id), count(initial, id), 'selected and unrelated stacks are intact');
  assert.equal(count(identified, 'scroll:identify'), count(initial, 'scroll:identify') - 1);
  assert.equal(identified.stats.itemsUsed, initial.stats.itemsUsed + 1);
  // Native Space invokes the focused appearance card without leaking a wait key.
  const second = await readIdentify(page); await page.locator('.identify-card').first().focus();
  await page.keyboard.press('Space'); await idle(page);
  assert.ok((await state(page)).player.known.includes(second.pendingChoice.options[0].id));
  assert.deepEqual(await page.evaluate(() => window.__sd.inputState().held), []);

  // A new empty-bag run proves the no-target read action is disabled before consuming.
  await page.goto(`${BASE}?dev=1&gfx=low`); await startRun(page, 'IDENTIFY-EMPTY'); await fixtures(page, []);
  await page.keyboard.press('KeyI'); await mode(page, 'inventory');
  const noTarget = await state(page), index = noTarget.player.items.findIndex(it => it.id === 'scroll:identify');
  await selectInventoryItem(page, index);
  assert.equal(await page.locator(`#inv-list button[data-k="${index}"][data-m="use"]`).isDisabled(), true);
  assert.ok((await page.locator(`#inv-detail-${index}`).innerText()).includes('背包沒有未知的藥水或卷軸可鑑定'));
  await page.keyboard.press('Escape'); await idle(page);
  assert.equal(count(await state(page), 'scroll:identify'), count(noTarget, 'scroll:identify'));

  // Existing upgrade/talent offers keep their mandatory choice semantics.
  await page.evaluate(() => window.__sd.debug.giveItem('scroll:upgrade'));
  await page.keyboard.press('KeyI'); await mode(page, 'inventory');
  const upgrade = (await state(page)).player.items.findIndex(it => it.id === 'scroll:upgrade');
  await selectInventoryItem(page, upgrade); await page.click(`#inv-list button[data-k="${upgrade}"][data-m="use"]`);
  await mode(page, 'choice'); assert.equal((await state(page)).pendingChoice.kind, 'upgrade');
  assert.equal(await page.locator('#btn-identify-cancel').count(), 0);
  await page.keyboard.press('Escape'); await page.waitForTimeout(80); assert.equal((await state(page)).pendingChoice.kind, 'upgrade');
  await page.keyboard.press('Enter'); await idle(page);
  await page.evaluate(() => window.__sd.debug.giveXp(10)); await mode(page, 'choice');
  await page.keyboard.press('Escape'); await page.waitForTimeout(80); assert.equal((await state(page)).pendingChoice.kind, 'talent');
  assert.equal(await page.locator('#btn-identify-cancel').count(), 0);
  await page.keyboard.press('Digit1'); await idle(page);

  // Real touch in landscape plus portrait layout while the choice already pauses play.
  const mobile = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
  const mp = await mobile.newPage(); mp.on('pageerror', e => errors.push(e.message));
  await mp.goto(`${BASE}?dev=1&gfx=low`); await mp.locator('#btn-mobile-continue').tap();
  await mp.locator('.class-card[data-cls="warrior"]').tap();
  await mp.locator('#seed-input').fill('IDENTIFY-TOUCH'); await mp.locator('#btn-start').tap(); await mode(mp, 'playing');
  await fixtures(mp);
  const mobileInitial = await state(mp);
  await readIdentify(mp, true); await privateFrozen(mp);
  await reachable(mp, { width: 844, height: 390 });
  await mp.screenshot({ path: `${OUT}identify-touch-landscape.png` });
  await mp.setViewportSize({ width: 390, height: 844 });
  await reachable(mp, { width: 390, height: 844 });
  await mp.screenshot({ path: `${OUT}identify-touch-portrait.png` });
  await mp.setViewportSize({ width: 844, height: 390 });
  await mp.locator('#btn-identify-cancel').tap(); await idle(mp);
  assert.equal(count(await state(mp), 'scroll:identify'), count(mobileInitial, 'scroll:identify'));
  const touchChoice = await readIdentify(mp, true);
  await mp.locator('.identify-card[data-idx="1"]').tap(); await idle(mp);
  assert.deepEqual((await state(mp)).player.known.filter(id => !mobileInitial.player.known.includes(id)), [touchChoice.pendingChoice.options[1].id]);
  await mobile.close();
  assert.deepEqual(errors, []);
  console.log('PASS Identify: private appearance cards, paused time/hunger, cancel/refund, single-kind selection, intact stacks, native keyboard, no-target guard, mandatory choices, touch reachability');
} finally { await browser.close(); }
