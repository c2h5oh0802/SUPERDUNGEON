// Real controls plus read-only dev snapshots. Death/win are not combat claims.
import assert from 'node:assert/strict';
import { launch, BASE, Bot, startRun } from './lib.mjs';
const { browser, page, errors } = await launch();
const bot = new Bot(page);
const playing = () => page.waitForFunction(() => window.__sd?.state().mode === 'playing');
const save = () => page.evaluate(() => localStorage.getItem('superdungeon.run.v1'));
async function pause() { await bot.tap('Escape'); await page.waitForFunction(() => window.__sd.state().mode === 'paused'); }
try {
  await page.goto(`${BASE}?dev=1`);
  await startRun(page, 'BOSS-TEST-SAVE'); await pause(); await page.click('#btn-quit');
  const campaignSave = await save(); assert.ok(campaignSave);
  await page.goto(`${BASE}?dev=1&boss=1`);
  assert.equal(await page.locator('#screen-boss-test').isVisible(), true);
  for (const preset of ['starting', 'split']) for (const cls of ['warrior', 'huntress']) {
    await page.selectOption('#boss-test-class', cls);
    await page.selectOption('#boss-test-preset', preset);
    const loadout = await page.textContent('#boss-test-loadout');
    assert.match(loadout, preset === 'split' ? /Lv5.*HP 18\/18/ : /Lv1.*HP 10\/10/);
    await page.click('#btn-boss-test-start'); await playing();
    let s = await bot.st();
    assert.equal(s.floor, 5); assert.equal(s.template, 'arena'); assert.equal(s.run, null);
    assert.equal(s.bossTest.preset, preset); assert.equal(s.player.cls, cls);
    assert.equal(s.enemies[0].hp, 80); assert.equal(s.enemies.length, 1);
    assert.equal(await save(), campaignSave);
    const signature = await page.evaluate(() => window.__sd.level().signature);
    await pause();
    assert.match(await page.textContent('#boss-test-pause-loadout'), /測試起始配裝/);
    await page.click('#btn-restart'); await playing();
    s = await bot.st(); assert.equal(s.player.hp, s.player.maxHp);
    assert.equal(s.enemies[0].hp, 80); assert.equal(s.enemies[0].warden.braced, false);
    assert.equal(s.projectiles.length, 0); assert.equal(s.player.action, null);
    assert.equal(await page.evaluate(() => window.__sd.level().signature), signature);
    await pause(); await page.click('#btn-boss-test-swap'); await playing();
    assert.equal((await bot.st()).player.cls, cls === 'warrior' ? 'huntress' : 'warrior');
    assert.equal(await save(), campaignSave);
    await pause(); await page.click('#btn-boss-test-options');
    assert.equal(await page.locator('#screen-boss-test').isVisible(), true);
  }
  await page.click('#btn-boss-test-exit'); await page.click('#btn-continue'); await playing();
  const resumed = await bot.st();
  assert.equal(resumed.seed, 'BOSS-TEST-SAVE'); assert.equal(resumed.practice, false);
  assert.equal(resumed.bossTest, null); assert.equal(await save(), campaignSave);
  assert.deepEqual(errors, []);
  console.log('PASS developer Boss entry, both classes/presets, reset/swap/options and unchanged campaign save');
} finally { await browser.close(); }
