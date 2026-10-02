// Focused presentation/input contracts. debug.giveItem supplies explicit fixtures;
// one legacy localStorage checkpoint exercises the real save migration path.
// Selection, keyboard activation, equip/drink/drop, and close use real controls.
// This is not evidence of natural loot acquisition, survival, or human game feel.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { BASE, OUT, Bot, launch, selectInventoryItem, startRun } from './lib.mjs';

mkdirSync(OUT, { recursive: true });
const { browser, page, errors } = await launch();
const bot = new Bot(page);
const viewports = [{ width: 1280, height: 720 }, { width: 860, height: 480 }, { width: 390, height: 844 }];
const fixture = [
  ['weapon:axe', 1, 1], ['weapon:axe', 1, 5], ['armor:mail', 1, 2],
  ['potion:haste', 2, 0], ['potion:gas', 99, 0], ['potion:healing', 1, 0],
  ['scroll:sleep', 1, 0], ['scroll:upgrade', 1, 0], ['food:ration', 2, 0], ['potion:frost', 2, 0],
];
const effectNames = ['治療藥水', '火焰藥水', '冰霜藥水', '麻痺氣體', '隱形藥水', '迅捷藥水', '傳送卷軸', '地圖卷軸', '沉睡卷軸'];
const tile = index => page.locator(`#inv-list button[data-select="${index}"]`);
const detail = index => page.locator(`#inv-list article[data-detail="${index}"]`);
const action = (index, mode) => page.locator(`#inv-list button[data-k="${index}"][data-m="${mode}"]`);
const playing = () => page.waitForFunction(() => window.__sd?.state().mode === 'playing');
const idle = () => page.waitForFunction(() => {
  const s = window.__sd.state();
  return s.mode === 'playing' && !s.player.action && !s.player.pendingUse;
});
async function openBag() {
  await page.keyboard.press('KeyI');
  await page.waitForFunction(() => window.__sd.state().mode === 'inventory');
}
async function closeBag(key = 'KeyI') { await page.keyboard.press(key); await playing(); }
const frozenState = s => ({ time: s.time, hunger: s.player.hunger, player: s.player, stats: s.stats });
async function assertFrozen(before, label) {
  await page.waitForTimeout(80);
  assert.deepEqual(frozenState(await bot.st()), frozenState(before), label);
}
async function assertSelected(index) {
  assert.equal(await tile(index).getAttribute('aria-pressed'), 'true');
  assert.equal(await tile(index).getAttribute('aria-controls'), `inv-detail-${index}`);
  assert.equal(await page.locator('#inv-list button[data-select][aria-pressed="true"]').count(), 1);
  assert.equal(await page.locator('#inv-list article[data-detail]:not([hidden])').count(), 1);
  assert.equal(await detail(index).isVisible(), true);
}
async function inspectAppearance(index) {
  return {
    tileSrc: await tile(index).locator('img').getAttribute('src'),
    inspectorSrc: await detail(index).locator('img').getAttribute('src'),
    swatch: await tile(index).locator('.swatch').evaluate(el => el.style.background),
    text: await detail(index).locator('.inv-appearance').textContent(),
  };
}
async function assertImagesLoaded() {
  const images = page.locator('#screen-inventory img');
  assert.ok(await images.count() > 0);
  await page.waitForFunction(() => [...document.querySelectorAll('#screen-inventory img')].every(img => img.complete), null, { timeout: 10000 });
  const decoded = await images.evaluateAll(images => images.map(img => ({ src: img.currentSrc, alt: img.alt, width: img.naturalWidth, height: img.naturalHeight })));
  for (const image of decoded) {
    assert.ok(image.width > 0 && image.height > 0, `inventory asset decodes: ${image.src}`);
    assert.equal(image.alt, '', 'redundant images remain decorative; accessible item names are on the controls');
    assert.ok(image.src.includes('.webp'), image.src);
  }
}
async function assertControlsReachable(viewport) {
  const controls = page.locator('#screen-inventory button:visible, #screen-inventory summary:visible');
  for (let index = 0; index < await controls.count(); index++) {
    const control = controls.nth(index);
    await control.scrollIntoViewIfNeeded();
    if (await control.isEnabled()) await control.click({ trial: true, timeout: 5000 });
    const bounds = await control.boundingBox();
    assert.ok(bounds && bounds.x >= -1 && bounds.y >= -1 && bounds.x + bounds.width <= viewport.width + 1 && bounds.y + bounds.height <= viewport.height + 1,
      `control remains reachable at ${viewport.width}×${viewport.height}: ${await control.textContent()}`);
  }
  assert.equal(await page.locator('.inv-panel').evaluate(el => el.scrollWidth <= el.clientWidth + 1), true, 'no horizontal inventory overflow');
}
async function keyboardContract(viewport) {
  const before = await bot.st();
  await tile(0).focus();
  await page.keyboard.press('Tab');
  assert.equal(await tile(1).evaluate(el => document.activeElement === el), true, 'Tab moves natively between tiles');
  await page.keyboard.press('Space');
  await assertSelected(1);
  if (viewport.width <= 700) {
    assert.equal(await detail(1).locator('h3').evaluate(el => document.activeElement === el), true, 'narrow selection brings focus to the inspector');
    await detail(1).locator('button[data-return]').click();
    assert.equal(await tile(1).evaluate(el => document.activeElement === el), true, 'return restores the selected slot focus');
  }
  await page.keyboard.press('Tab');
  assert.equal(await tile(2).evaluate(el => document.activeElement === el), true);
  await page.keyboard.press('Enter');
  await assertSelected(2);
  await assertFrozen(before, 'native Tab/Space/Enter selection does not queue gameplay');

  // Exercise both wrap directions and every enabled control in a full native Tab cycle.
  const targets = () => page.evaluate(() => {
    const screen = document.getElementById('screen-inventory');
    const controls = [...screen.querySelectorAll('button:not(:disabled), summary, [tabindex="0"]')].filter(el => !el.closest('[hidden]') && el.getClientRects().length > 0);
    return { count: controls.length, active: controls.indexOf(document.activeElement) };
  });
  await page.locator('#btn-inv-close').focus();
  let focus = await targets();
  assert.equal(focus.active, focus.count - 1);
  await page.keyboard.press('Tab');
  assert.equal((await targets()).active, 0, 'forward Tab wraps to first control');
  await page.keyboard.press('Shift+Tab');
  assert.equal((await targets()).active, focus.count - 1, 'reverse Tab wraps to last control');
  const visited = new Set();
  for (let k = 0; k < focus.count; k++) {
    await page.keyboard.press('Tab');
    focus = await targets();
    assert.ok(focus.active >= 0, 'focus stays inside the inventory dialog');
    visited.add(focus.active);
  }
  assert.equal(visited.size, focus.count, 'every enabled control is in the native keyboard loop');
  await assertFrozen(before, 'focus navigation keeps inventory and world unchanged');
}
async function repeatedCloseContract() {
  for (const key of ['KeyI', 'Escape', 'KeyI', 'Escape']) {
    if ((await bot.st()).mode !== 'inventory') await openBag();
    await tile(0).focus();
    const before = await bot.st();
    const held = ['KeyW', 'KeyD', 'KeyQ', 'KeyE', 'KeyF', 'Digit2', 'ArrowLeft', 'Space'];
    for (const code of held) await page.keyboard.down(code);
    // A press that began on a UI tile must not become a held gameplay attack.
    await tile(0).scrollIntoViewIfNeeded();
    const bounds = await tile(0).boundingBox();
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.mouse.down();
    await page.keyboard.down(key);
    await playing();
    await page.keyboard.down(key); // Real browser repeat, not a second fresh close/open.
    for (const code of held) await page.keyboard.down(code);
    await page.waitForTimeout(100);
    const after = await bot.st();
    assert.equal(after.mode, 'playing', `${key} repeat cannot reopen/pause`);
    assert.equal(after.player.action, null);
    assert.equal(after.player.pendingUse, null);
    assert.equal(after.player.x, before.player.x);
    assert.equal(after.player.z, before.player.z);
    assert.equal(after.player.yaw, before.player.yaw);
    assert.equal(after.stats.shots, before.stats.shots);
    assert.equal(after.stats.bottlesThrown, before.stats.bottlesThrown);
    assert.deepEqual(after.player.items, before.player.items);
    assert.deepEqual(await page.evaluate(() => window.__sd.inputState().held), []);
    await page.mouse.up();
    for (const code of held) await page.keyboard.up(code);
    await page.keyboard.up(key);
  }
}

try {
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.goto(`${BASE}?dev=1&gfx=low`);
    await page.click('.class-card[data-cls="huntress"]');
    await startRun(page, 'INVENTORY-UI');
    await openBag();
    assert.equal(await page.textContent('#inv-count'), '0 / 10 格');
    assert.equal(await page.locator('.inv-empty-slot').count(), 10);
    assert.equal(await page.locator('#inv-list button[data-select]').count(), 0);
    assert.equal(await page.locator('.inv-inspect-empty').isVisible(), true);
    assert.equal(await page.locator('#btn-inv-close').evaluate(el => document.activeElement === el), true);
    assert.equal(await page.locator('#inv-gear .equipped-item').count(), 3);
    assert.ok((await page.textContent('#inv-gear')).includes('獵弓 +0'));
    assert.ok((await page.textContent('#inv-status')).includes('生命'));
    assert.ok((await page.textContent('#inv-status')).includes('飢餓'));
    await assertImagesLoaded();
    await assertControlsReachable(viewport);
    await closeBag();

    const granted = await page.evaluate(entries => entries.map(([id, count, level]) => {
      let ok = true;
      for (let k = 0; k < count; k++) ok = window.__sd.debug.giveItem(id, level) && ok;
      return ok;
    }), fixture);
    assert.ok(granted.every(Boolean), 'explicit debug fixtures all fit in the ten actual slots');
    await openBag();
    assert.equal(await page.textContent('#inv-count'), '10 / 10 格');
    assert.equal(await page.locator('.inv-empty-slot').count(), 0);
    assert.equal(await page.locator('#inv-list button[data-select]').count(), 10);
    const paused = await bot.st();
    assert.deepEqual(paused.player.items.map(it => [it.id, it.count, it.level]), fixture);
    for (let index = 0; index < fixture.length; index++) {
      await selectInventoryItem(page, index);
      await assertSelected(index);
      const [id, count, level] = fixture[index];
      const category = id.split(':')[0];
      const expectedModes = category === 'potion' ? ['use', 'throw', 'drop'] : ['use', 'drop'];
      if (count > 1) expectedModes.push('dropAll');
      assert.deepEqual(await detail(index).locator('button[data-m]').evaluateAll(buttons => buttons.map(button => button.dataset.m)), expectedModes);
      assert.equal(await tile(index).locator('.inv-tile-quantity').textContent(), ['weapon', 'armor'].includes(category) ? `+${level}` : `×${count}`);
      assert.ok((await detail(index).locator('h3').textContent()).includes(`×${count}`));
      if ((category === 'potion' || category === 'scroll') && id !== 'scroll:upgrade' && !paused.player.known.includes(id)) {
        const markup = await tile(index).evaluate(el => el.outerHTML) + await detail(index).evaluate(el => el.outerHTML);
        for (const name of effectNames) assert.ok(!markup.includes(name), `unknown ${id} does not leak ${name}`);
        assert.ok(!/potion:|scroll:|data-effect|data-item|title=/.test(markup), `unknown ${id} attributes are safe`);
        assert.ok(!/(?:potion|scroll)-(?:fire|frost|gas|invisibility|haste|healing|teleport|mapping|sleep)(?:[.-])/.test(markup));
        assert.ok((await detail(index).locator('.inv-inspect-type').textContent()).includes('未辨識'));
      }
      await assertControlsReachable(viewport);
    }
    await assertImagesLoaded();
    await assertFrozen(paused, 'all item inspection, scrolling and reachability checks preserve the world');
    await keyboardContract(viewport);
    await selectInventoryItem(page, 4);
    await page.screenshot({ path: `${OUT}inventory-presentation-${viewport.width}x${viewport.height}.png` });

    // A native Enter equips the selected duplicate's exact level, preserving the other axe.
    await selectInventoryItem(page, 1);
    await action(1, 'use').focus();
    await page.keyboard.press('Enter');
    await idle();
    let s = await bot.st();
    assert.deepEqual(s.player.weapon, { id: 'axe', level: 5 });
    assert.ok(s.player.items.some(it => it.id === 'weapon:axe' && it.level === 1));
    assert.ok(s.player.items.some(it => it.id === `weapon:${paused.player.weapon.id}` && it.level === paused.player.weapon.level));
    assert.ok(s.time > paused.time);
    await openBag();
    assert.ok((await page.textContent('#inv-gear')).includes('重斧 +5'));

    // Space on a real action drinks one, identifies, and leaves the same appearance.
    let index = (await bot.st()).player.items.findIndex(it => it.id === 'potion:haste');
    await selectInventoryItem(page, index);
    const appearanceBefore = await inspectAppearance(index);
    const beforeUse = await bot.st();
    await action(index, 'use').focus();
    await page.keyboard.press('Space');
    await idle();
    s = await bot.st();
    assert.ok(s.player.known.includes('potion:haste'));
    assert.equal(s.player.items.find(it => it.id === 'potion:haste').count, 1);
    assert.equal(s.stats.itemsUsed, beforeUse.stats.itemsUsed + 1);
    assert.ok(s.time > beforeUse.time);
    await openBag();
    index = (await bot.st()).player.items.findIndex(it => it.id === 'potion:haste');
    await selectInventoryItem(page, index);
    assert.deepEqual(await inspectAppearance(index), appearanceBefore);
    assert.ok((await detail(index).textContent()).includes('迅捷藥水'));
    assert.equal(await tile(index).locator('.inv-unknown').count(), 0);
    assert.equal(await action(index, 'dropAll').count(), 0);
    await repeatedCloseContract();
    console.log(`PASS inventory ${viewport.width}×${viewport.height}: empty/full slots, current gear, unknown HTML, decoded art, controls, native keys, pause, exact actions, repeated close`);
  }

  // Real supported legacy save migration: ten existing stacks + old numeric healing stock.
  // The existing debug API intentionally cannot create an over-capacity new inventory.
  const savedPlayer = (await bot.st()).player;
  const carryKeys = ['hp', 'maxHp', 'hunger', 'starvationT', 'arrows', 'stones', 'tipped', 'tipKind', 'bottles', 'weapon', 'armor', 'bowLevel', 'shieldLevel', 'xp', 'level', 'talents'];
  const carry = Object.fromEntries(carryKeys.map(key => [key, savedPlayer[key]]));
  carry.items = Array.from({ length: 10 }, (_, k) => ({ id: k % 2 ? 'armor:mail' : 'weapon:spear', count: 1, level: k % 6 }));
  carry.known = [];
  carry.potions = 3;
  const legacy = { v: 2, chapter: 2, seed: 'INVENTORY-LEGACY', cls: 'huntress', floor: 1, carry, stats: null };
  await page.evaluate(save => localStorage.setItem('superdungeon.run.v1', JSON.stringify(save)), legacy);
  await page.reload();
  await page.click('#btn-continue');
  await playing();
  assert.equal((await bot.st()).seed, 'INVENTORY-LEGACY');
  assert.equal((await bot.st()).player.items.length, 11);
  assert.deepEqual((await bot.st()).player.items[10], { id: 'potion:healing', count: 3, level: 0 });
  await openBag();
  assert.equal(await page.textContent('#inv-count'), '11 / 10 格');
  assert.equal(await page.locator('#inv-list button[data-select]').count(), 11);
  assert.equal(await page.locator('.inv-empty-slot').count(), 0);
  assert.equal(await page.locator('.inv-overflow').isVisible(), true);
  await selectInventoryItem(page, 10);
  await assertSelected(10);
  await assertImagesLoaded();
  await assertControlsReachable(viewports.at(-1));
  await action(10, 'dropAll').click();
  await idle();
  assert.equal((await bot.st()).player.items.length, 10);
  assert.ok((await bot.st()).pickups.some(p => p.item === 'potion:healing' && p.amount === 3));
  await openBag();
  assert.equal(await page.textContent('#inv-count'), '10 / 10 格');
  assert.equal(await page.locator('.inv-overflow').count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS inventory legacy migration: eleventh stack fully selectable, inspectable, and droppable through normal controls');
} finally { await browser.close(); }
