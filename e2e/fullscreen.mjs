// Browser layout + optional native fullscreen regression. A desktop browser with
// touch emulation cannot establish actual Android toolbar/Back behavior.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { BASE, OUT } from './lib.mjs';

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_PATH,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  for (const unsupported of [false, true]) {
    const context = await browser.newContext({ viewport: { width: 667, height: 280 }, hasTouch: true, isMobile: true });
    await context.addInitScript(({ unsupported }) => {
      window.__fullscreenRequests = 0;
      window.__lockRequests = 0;
      const original = window.Element.prototype.requestFullscreen;
      window.Element.prototype.requestFullscreen = function (...args) {
        window.__fullscreenRequests++;
        return original.apply(this, args);
      };
      const lock = window.Element.prototype.requestPointerLock;
      window.Element.prototype.requestPointerLock = function (...args) {
        window.__lockRequests++;
        return lock.apply(this, args);
      };
      if (unsupported) Object.defineProperty(document, 'fullscreenEnabled', { get: () => false });
    }, { unsupported });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${BASE}?dev=1&gfx=low`);
    await page.locator('#btn-mobile-continue').tap();
    const menuButton = page.locator('#screen-menu [data-fullscreen]');
    await menuButton.scrollIntoViewIfNeeded();
    const menu = await page.locator('#screen-menu').evaluate(el => {
      const r = el.getBoundingClientRect();
      const title = el.querySelector('h1').getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, height: r.height, titleTop: title.top, visible: window.visualViewport?.height ?? window.innerHeight };
    });
    assert.ok(menu.top >= 0 && menu.height <= menu.visible + 1);
    assert.ok(menu.titleTop >= 0, 'title remains reachable from scroll origin');
    if (unsupported) {
      assert.equal(await menuButton.isDisabled(), true);
      assert.equal(await page.evaluate(() => window.__fullscreenRequests), 0);
    } else {
      assert.equal(await page.evaluate(() => window.__fullscreenRequests), 1);
      // Actual native fulfillment varies by headless environment; rejected entry
      // must leave a usable button and may not prevent the rest of the game.
      await page.waitForFunction(() => !document.querySelector('#screen-menu [data-fullscreen]').disabled);
      const active = await page.evaluate(() => document.fullscreenElement === document.documentElement);
      assert.equal(await menuButton.innerText(), active ? '退出全螢幕' : '全螢幕');
    }
    await page.locator('#btn-practice').tap();
    await page.waitForFunction(() => window.__sd.state().mode === 'playing');
    assert.equal(await page.evaluate(() => window.__lockRequests), 0);
    const bounds = await page.evaluate(() => ['game', 'hud', 'touch-controls'].map(id => {
      const r = document.getElementById(id).getBoundingClientRect();
      return [r.x, r.y, r.width, r.height];
    }));
    assert.deepEqual(bounds[0], bounds[1]); assert.deepEqual(bounds[1], bounds[2]);
    await page.locator('#touch-pause').tap();
    await page.waitForFunction(() => window.__sd.state().mode === 'paused');
    const pauseButton = page.locator('#screen-pause [data-fullscreen]');
    await pauseButton.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${OUT}fullscreen-${unsupported ? 'unsupported' : 'native'}-pause.png` });
    if (await page.evaluate(() => !!document.fullscreenElement)) {
      await pauseButton.tap();
      await page.waitForFunction(() => !document.fullscreenElement);
      assert.equal(await page.evaluate(() => window.__sd.state().mode), 'paused');
    }
    await page.locator('#btn-resume').tap();
    await page.waitForFunction(() => window.__sd.state().mode === 'playing');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#touch-rotate').waitFor({ state: 'visible' });
    await page.setViewportSize({ width: 844, height: 390 });
    await page.locator('#touch-rotate').waitFor({ state: 'hidden' });
    await page.locator('#btn-resume').tap();
    await page.waitForFunction(() => window.__sd.state().mode === 'playing');
    assert.deepEqual(errors, []);
    console.log(`PASS fullscreen ${unsupported ? 'unsupported' : 'native'} route, short viewport, aligned layers and rotation`);
    await context.close();
  }
} finally { await browser.close(); }
