// Mobile input regression: actual Chromium CDP touch contacts (including three
// simultaneous fingers), not synthetic PointerEvents or debug-triggered actions.
// Explicit debug.giveItem fixtures are used only to populate the inventory. World
// state is read through ?dev=1. This is not a real-phone FPS or human feel claim.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { BASE, OUT } from './lib.mjs';

mkdirSync(OUT, { recursive: true });
const landscape = { width: 844, height: 390 };
const portrait = { width: 390, height: 844 };
const compactLandscape = { width: 667, height: 375 };
const results = [];
const pass = (name, detail = '') => {
  results.push({ name, detail });
  console.log(`PASS ${name}${detail ? ` — ${detail}` : ''}`);
};

async function launchTouch() {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.BROWSER_PATH,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
  });
  const context = await browser.newContext({ viewport: landscape, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
  await context.addInitScript(() => {
    // Instrument the native request, without replacing its behavior.
    window.__pointerLockRequests = 0;
    const original = window.Element.prototype.requestPointerLock;
    window.Element.prototype.requestPointerLock = function (...args) {
      window.__pointerLockRequests++;
      return original.apply(this, args);
    };
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const cdp = await context.newCDPSession(page);
  return { browser, page, errors, touch: new Touches(page, cdp) };
}

class Touches {
  constructor(page, cdp) { this.page = page; this.cdp = cdp; this.points = new Map(); }
  async send(type) {
    await this.cdp.send('Input.dispatchTouchEvent', { type, touchPoints: [...this.points].map(([id, p]) => ({ id, x: p.x, y: p.y, radiusX: 3, radiusY: 3, force: 1 })) });
  }
  async down(id, point) { this.points.set(id, point); await this.send('touchStart'); }
  async move(id, point) { assert.ok(this.points.has(id)); this.points.set(id, point); await this.send('touchMove'); }
  async up(id) {
    assert.equal(this.points.size, 1, 'up() is for one-finger gestures; end() releases a multi-touch gesture');
    assert.ok(this.points.has(id));
    await this.end();
  }
  async end() { this.points.clear(); await this.send('touchEnd'); }
  async clear() { if (this.points.size) { this.points.clear(); await this.send('touchCancel'); } }
  async tap(selector) {
    const p = await hitPoint(this.page, selector, true);
    await this.down(20, p);
    await this.up(20);
  }
}

async function hitPoint(page, selector, scroll = false) {
  const control = page.locator(selector).first();
  await control.waitFor({ state: 'visible' });
  if (scroll) await control.scrollIntoViewIfNeeded();
  const point = await control.evaluate(el => {
    const r = el.getBoundingClientRect();
    // Look pads can share their bounding rectangle with higher-z-index buttons.
    // Use a point whose real hit target belongs to the requested control.
    for (const fy of [0.5, 0.25, 0.75, 0.1, 0.9]) for (const fx of [0.5, 0.25, 0.75, 0.1, 0.9]) {
      const x = r.left + r.width * fx, y = r.top + r.height * fy;
      const hit = document.elementFromPoint(x, y);
      if (x >= 0 && y >= 0 && x < window.innerWidth && y < window.innerHeight && hit && (hit === el || el.contains(hit))) return { x, y };
    }
    return null;
  });
  assert.ok(point, `real touch target reachable: ${selector}`);
  return point;
}

const selector = action => `#touch-controls [data-touch="${action}"]`;
const state = page => page.evaluate(() => window.__sd.state());
const waitMode = (page, mode) => page.waitForFunction(mode => window.__sd?.state().mode === mode, mode, { timeout: 30000 });
const waitIdle = page => page.waitForFunction(() => {
  const s = window.__sd.state();
  return s.mode === 'playing' && !s.player.action && !s.player.pendingUse;
}, null, { timeout: 20000 });
const settleFrames = (page, count = 3) => page.evaluate(count => new Promise(resolve => {
  let remaining = count;
  const next = () => { if (--remaining <= 0) resolve(); else requestAnimationFrame(next); };
  requestAnimationFrame(next);
}), count);
const neutralSnapshot = s => ({ x: s.player.x, z: s.player.z, yaw: s.player.yaw, pitch: s.player.pitch, shots: s.stats.shots, bottles: s.stats.bottlesThrown, items: s.player.items });

async function checkControls(page, cls) {
  const actions = ['move', 'look', 'fire', 'interact', 'slot1', 'slot2', 'inventory', 'map', 'escape', 'wait', 'sneak', 'bottle'];
  if (cls === 'huntress') actions.push('slot3');
  if (cls === 'warrior') actions.push('shield');
  for (const action of actions) await hitPoint(page, selector(action));
  const undersized = await page.locator('#touch-controls button:visible:not(:disabled)').evaluateAll(buttons => buttons.filter(button => {
    const r = button.getBoundingClientRect();
    return r.width < 43 || r.height < 43;
  }).map(button => ({ action: button.dataset.touch, width: button.getBoundingClientRect().width, height: button.getBoundingClientRect().height })));
  assert.deepEqual(undersized, [], 'all gameplay button touch targets are at least 44px (1px tolerance)');
}

async function inventoryReachability(page, viewport) {
  const itemCount = (await state(page)).player.items.length;
  for (let index = 0; index < itemCount; index++) {
    const tile = page.locator(`#inv-list button[data-select="${index}"]`);
    await tile.scrollIntoViewIfNeeded();
    await tile.tap(); // Browser-generated touchscreen tap, not debug selection.
    const detail = page.locator(`#inv-list article[data-detail="${index}"]`);
    await detail.waitFor({ state: 'visible' });
    const buttons = detail.locator('button:visible');
    for (let i = 0; i < await buttons.count(); i++) {
      const button = buttons.nth(i);
      await button.scrollIntoViewIfNeeded();
      const box = await button.boundingBox();
      assert.ok(box && box.x >= -1 && box.y >= -1 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1, `inventory action remains inside ${viewport.width}×${viewport.height}`);
      if (await button.isEnabled()) await button.tap({ trial: true });
    }
  }
  assert.equal(await page.locator('.inv-panel').evaluate(el => el.scrollWidth <= el.clientWidth + 1), true, 'no horizontal bag overflow');
  await hitPoint(page, '#btn-inv-close', true);
}

for (const cls of ['warrior', 'huntress']) {
  const { browser, page, errors, touch } = await launchTouch();
  try {
    await page.goto(`${BASE}?dev=1&gfx=low`);
    await page.locator('#screen-mobile').waitFor({ state: 'visible' });
    await touch.tap('#btn-mobile-continue');
    await touch.tap(`.class-card[data-cls="${cls}"]`);
    await page.locator('#seed-input').fill('MOBILE-CONTROLS');
    await touch.tap('#btn-start');
    await waitMode(page, 'playing');
    await page.locator('#touch-controls').waitFor({ state: 'visible' });
    assert.equal(await page.evaluate(() => window.matchMedia('(pointer: coarse)').matches), true);
    assert.equal(await page.evaluate(() => window.__pointerLockRequests), 0);
    assert.equal((await state(page)).locked, false);
    await checkControls(page, cls);
    await page.screenshot({ path: `${OUT}mobile-${cls}-844x390.png` });
    pass(`${cls}: auto touch mode, reachable landscape controls, no pointer-lock request`);
    await page.setViewportSize(compactLandscape);
    await settleFrames(page, 2);
    await checkControls(page, cls);
    await page.screenshot({ path: `${OUT}mobile-${cls}-667x375.png` });
    await page.setViewportSize(landscape);
    await settleFrames(page, 2);
    pass(`${cls}: compact 667×375 gameplay controls remain reachable`);

    // Centered thumb contact and tiny jitter are still idle, without spending
    // extra world time. Compare with simulation realTime, not wall-clock/FPS.
    const move = await hitPoint(page, selector('move'));
    const deadBefore = await state(page);
    await touch.down(1, move);
    await touch.move(1, { x: move.x + 2, y: move.y - 2 });
    await settleFrames(page, 5);
    await touch.up(1);
    const deadAfter = await state(page);
    assert.equal(deadAfter.player.x, deadBefore.player.x);
    assert.equal(deadAfter.player.z, deadBefore.player.z);
    assert.ok(Math.abs((deadAfter.time - deadBefore.time) - 0.1 * (deadAfter.realTime - deadBefore.realTime)) < 1e-7);
    pass(`${cls}: joystick dead-zone stays idle`);

    const look = await hitPoint(page, selector('look'));
    const lookBefore = await state(page);
    await touch.down(2, look);
    for (let i = 1; i <= 5; i++) {
      await touch.move(2, { x: look.x + i * 8, y: look.y - i * 2 });
      await settleFrames(page, 1);
    }
    await touch.up(2);
    await settleFrames(page, 2);
    const lookAfter = await state(page);
    assert.ok(Math.abs(lookAfter.player.yaw - lookBefore.player.yaw) > 0.01);
    assert.equal(lookAfter.player.x, lookBefore.player.x);
    assert.equal(lookAfter.player.z, lookBefore.player.z);
    assert.equal(lookAfter.stats.shots, lookBefore.stats.shots);
    assert.ok(Math.abs((lookAfter.time - lookBefore.time) - 0.1 * (lookAfter.realTime - lookBefore.realTime)) < 1e-7);
    pass(`${cls}: look-only keeps the unchanged idle-time rate`);

    // Select class-specific ranged tool via its real touch slot.
    const rangedSlot = (await state(page)).player.slots.indexOf(cls === 'warrior' ? 'stone' : 'bow') + 1;
    await touch.tap(selector(`slot${rangedSlot}`));
    await page.waitForFunction(tool => window.__sd.state().player.tool === tool, cls === 'warrior' ? 'stone' : 'bow');
    const fire = await hitPoint(page, selector('fire'));
    const beforeMulti = await state(page);
    await touch.down(1, move);
    await touch.move(1, { x: move.x + 28, y: move.y - 30 });
    await touch.down(2, look);
    await touch.down(3, fire);
    await touch.move(2, { x: look.x - 28, y: look.y + 5 });
    await page.waitForFunction(shots => window.__sd.state().stats.shots >= shots + 2, beforeMulti.stats.shots, { timeout: 20000 });
    const duringMulti = await state(page);
    await touch.end(); // CDP touchEnd with an empty list releases all three contacts.
    await waitIdle(page);
    await settleFrames(page, 5); // Existing acceleration decelerates after release.
    const afterMulti = await state(page);
    assert.ok(Math.hypot(duringMulti.player.x - beforeMulti.player.x, duringMulti.player.z - beforeMulti.player.z) > 0.1);
    assert.ok(Math.abs(duringMulti.player.yaw - beforeMulti.player.yaw) > 0.01);
    assert.ok(duringMulti.stats.shots >= beforeMulti.stats.shots + 2);
    await settleFrames(page, 8);
    assert.equal((await state(page)).stats.shots, afterMulti.stats.shots, 'release stops repeats');
    pass(`${cls}: real three-finger move + look + held-fire, release stops repeats`);

    // Explicit fixture injection only. Item selection, scrolling, actions and
    // dismissal below are browser touch input and the real inventory UI.
    const injected = await page.evaluate(() => [['weapon:axe', 2], ['armor:mail', 0], ['potion:haste', 0], ['food:ration', 0]].map(([id, level]) => window.__sd.debug.giveItem(id, level)));
    assert.ok(injected.every(Boolean));
    console.log(`INFO ${cls}: debug.giveItem injected four inventory fixtures; no gameplay action injection`);
    await touch.tap(selector('inventory'));
    await waitMode(page, 'inventory');
    const bagBefore = await state(page);
    await inventoryReachability(page, landscape);
    await page.screenshot({ path: `${OUT}mobile-${cls}-inventory-844x390.png` });
    const bagAfter = await state(page);
    assert.equal(bagAfter.time, bagBefore.time);
    assert.deepEqual(neutralSnapshot(bagAfter), neutralSnapshot(bagBefore));
    // Execute the selected tile's equip action through a real touchscreen tap.
    const axeIndex = bagAfter.player.items.findIndex(item => item.id === 'weapon:axe' && item.level === 2);
    assert.ok(axeIndex >= 0, 'find the injected +2 axe by identity, regardless of entrance pickups');
    await page.locator(`#inv-list button[data-select="${axeIndex}"]`).tap();
    await page.locator(`#inv-list button[data-k="${axeIndex}"][data-m="use"]`).tap();
    await waitIdle(page);
    const equipped = await state(page);
    assert.deepEqual(equipped.player.weapon, { id: 'axe', level: 2 });
    assert.ok(equipped.time > bagBefore.time, 'equipping still costs the existing action time');
    assert.equal(equipped.stats.shots, bagBefore.stats.shots);
    await touch.tap(selector('inventory'));
    await waitMode(page, 'inventory');
    await touch.tap('#btn-inv-close');
    await waitMode(page, 'playing');
    await settleFrames(page, 6);
    const closed = await state(page);
    assert.equal(closed.player.action, null);
    assert.equal(closed.player.pendingUse, null);
    assert.equal(closed.stats.shots, bagBefore.stats.shots);
    pass(`${cls}: bag inspection costs zero time, real equip works, close leaks no attack`);

    await touch.tap(selector('map'));
    await waitMode(page, 'map');
    const mapBefore = await state(page);
    await settleFrames(page, 4);
    assert.equal((await state(page)).time, mapBefore.time);
    await touch.tap('#btn-map-close');
    await waitMode(page, 'playing');
    pass(`${cls}: touch map opens frozen and closes with visible button`);

    // OS focus-loss is injected; all held gameplay input leading into it is real
    // CDP touch. A blur cannot be induced by clicking a second headless window.
    await touch.down(1, move);
    await touch.move(1, { x: move.x + 20, y: move.y - 30 });
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await waitMode(page, 'paused');
    await touch.clear();
    const paused = await state(page);
    await settleFrames(page, 5);
    assert.equal((await state(page)).time, paused.time);
    await touch.tap('#btn-resume');
    await waitMode(page, 'playing');
    await settleFrames(page, 8);
    const resumed = await state(page);
    await settleFrames(page, 5);
    const resumedAgain = await state(page);
    assert.equal(resumedAgain.player.x, resumed.player.x);
    assert.equal(resumedAgain.player.z, resumed.player.z);
    assert.equal(resumedAgain.player.action, null);
    assert.equal(resumedAgain.stats.shots, paused.stats.shots);
    pass(`${cls}: blur pauses and clears held contacts; resume is neutral`);

    await touch.down(1, move);
    await touch.move(1, { x: move.x + 25, y: move.y - 25 });
    await page.setViewportSize(portrait);
    await waitMode(page, 'paused');
    await touch.clear();
    await page.locator('#touch-rotate').waitFor({ state: 'visible' });
    const rotated = await state(page);
    await settleFrames(page, 5);
    assert.equal((await state(page)).time, rotated.time);
    await page.screenshot({ path: `${OUT}mobile-${cls}-390x844-rotate.png` });
    await page.setViewportSize(landscape);
    await page.locator('#touch-rotate').waitFor({ state: 'hidden' });
    await touch.tap('#btn-resume');
    await waitMode(page, 'playing');
    await settleFrames(page, 8);
    const landscapeAgain = await state(page);
    await settleFrames(page, 5);
    assert.equal((await state(page)).player.x, landscapeAgain.player.x);
    assert.equal((await state(page)).player.z, landscapeAgain.player.z);
    pass(`${cls}: portrait pauses with rotate hint; landscape resumes without stale movement`);

    // Portrait UI remains useful while the world is already paused in the bag.
    await touch.tap(selector('inventory'));
    await waitMode(page, 'inventory');
    const portraitBefore = await state(page);
    await page.setViewportSize(portrait);
    await inventoryReachability(page, portrait);
    await page.screenshot({ path: `${OUT}mobile-${cls}-inventory-390x844.png` });
    assert.equal((await state(page)).time, portraitBefore.time);
    await page.setViewportSize(landscape);
    await touch.tap('#btn-inv-close');
    await waitMode(page, 'playing');
    assert.equal(await page.evaluate(() => window.__pointerLockRequests), 0);
    assert.deepEqual(errors, []);
    pass(`${cls}: portrait inventory remains scrollable/reachable; no browser errors or pointer lock`);

    // The rotation notice must not trap a portrait player in a modal.
    await page.setViewportSize(portrait);
    await waitMode(page, 'paused');
    await page.locator('#touch-rotate').waitFor({ state: 'visible' });
    const exitBefore = await state(page);
    await touch.tap('#btn-rotate-pause');
    await page.locator('#touch-rotate').waitFor({ state: 'hidden' });
    await page.locator('#screen-pause').waitFor({ state: 'visible' });
    assert.equal((await state(page)).time, exitBefore.time);
    await touch.tap('#btn-quit');
    await waitMode(page, 'menu');
    await page.locator('#screen-menu').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#touch-rotate').isVisible(), false);
    pass(`${cls}: portrait rotation notice opens pause menu and allows a real touch exit`);
  } catch (error) {
    await page.screenshot({ path: `${OUT}mobile-${cls}-failure.png` }).catch(() => {});
    console.error('Mobile state at failure:', await state(page).catch(() => null));
    throw error;
  } finally {
    await browser.close();
  }
}

console.log(`\n${results.length} mobile browser checks passed (Chromium touch emulation, not real-phone performance)`);
