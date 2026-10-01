// Focused UI contract, normal buttons/keyboard only; dev state is read-only evidence.
import assert from 'node:assert/strict';
import { launch, BASE, OUT, Bot } from './lib.mjs';
const { browser, page, errors } = await launch({ viewport: { width: 960, height: 640 } });
try {
  await page.goto(`${BASE}?dev=1&gfx=low`);
  const detail = await page.textContent('#class-detail');
  assert.ok(detail.includes('推擊') && detail.includes('不格擋'));
  assert.ok(!detail.includes('鐵壁'));
  await page.click('#btn-practice');
  await page.waitForFunction(() => window.__sd?.state().mode === 'playing');
  const tools = await page.textContent('#tools');
  assert.ok(tools.includes('推擊') && !tools.includes('臂盾'));
  const bot = new Bot(page);
  await bot.tap('KeyF');
  await bot.waitIdle();
  const state = await bot.st();
  assert.equal(state.lastAction.kind, 'shield'); // Legacy internal action ID, now position-only shove.
  assert.ok(Math.abs(state.lastAction.spent - .4) < .02);
  assert.equal(state.stats.blocks, 0);
  await page.screenshot({ path: `${OUT}combat-economy-practice.png` });
  assert.deepEqual(errors, []);
  console.log('PASS combat economy class copy, HUD, F shove action cost and no passive block');
} finally { await browser.close(); }
