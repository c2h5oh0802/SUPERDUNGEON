// Real menu, pause/reset, Continue and Heart controls. Teleport, invisibility and
// defeatGuardians are explicit state injections to isolate UI/progression. This
// is not evidence of a player winning the fight; simulation scenarios cover it.
import assert from 'node:assert/strict';
import { launch, BASE, Bot, startRun, yawTo } from './lib.mjs';

const { browser, page, errors } = await launch();
const bot = new Bot(page);
const playing = () => page.waitForFunction(() => window.__sd?.state().mode === 'playing');
const saved = () => page.evaluate(() => localStorage.getItem('superdungeon.run.v1'));
const pause = async () => {
  await bot.tap('Escape');
  await page.waitForFunction(() => window.__sd.state().mode === 'paused');
};
const menu = async () => { await pause(); await page.click('#btn-quit'); };
const clearChoices = async () => {
  while ((await bot.st()).pendingChoice) {
    await page.waitForFunction(() => window.__sd.state().mode === 'choice');
    await page.click('#choice-cards button[data-idx="0"]');
  }
  await playing();
};
const nearHeart = async () => {
  const h = (await bot.st()).interactables.find(i => i.kind === 'heart');
  assert.ok(h);
  await page.evaluate(([x, z, yaw]) => {
    window.__sd.debug.setInvisible(30);
    window.__sd.debug.teleport(x, z);
    window.__sd.debug.setView(yaw, 0);
  }, [h.x, h.z + 1.3, yawTo(h.x, h.z + 1.3, h.x, h.z)]);
  await page.waitForFunction(() => window.__sd.state().interactTarget?.kind === 'heart');
};

try {
  await page.goto(`${BASE}?dev=1&gfx=low`);
  await page.click('.class-card[data-cls="huntress"]');
  await startRun(page, 'WARDEN-MENU-SAVE'); await menu();
  const campaignSave = await saved();
  assert.ok(campaignSave);
  for (const cls of ['warrior', 'huntress']) {
    await page.click(`.class-card[data-cls="${cls}"]`);
    await page.click('#btn-trials'); await page.click('#btn-heart-warden'); await playing();
    let s = await bot.st();
    assert.equal(s.practiceTrial, 'heart-warden'); assert.equal(s.seed, 'TRIAL-WARDEN');
    assert.equal(s.floor, 5); assert.equal(s.template, 'arena'); assert.equal(s.run, null);
    assert.equal(s.enemies.length, 1); assert.equal(s.enemies[0].kind, 'warden'); assert.equal(s.enemies[0].hp, 80);
    assert.deepEqual(s.enemies[0].warden, { attack: null, phaseTwo: false, rangedCount: 0, braced: false, followup: false, cleavesLeft: 0, sequenceResolved: false });
    assert.equal(s.encounterState, 'dormant'); assert.equal(s.player.cls, cls);
    assert.deepEqual(s.player.items, []); assert.deepEqual(s.player.talents, []);
    assert.equal(s.player.arrows, cls === 'huntress' ? 8 : 0);
    assert.equal(s.pickups.length, 0); assert.equal(s.interactables.some(i => i.kind === 'resupply'), false);
    assert.equal(s.player.known.includes('potion:frost'), false);
    assert.equal(s.player.known.includes('potion:gas'), false);
    const signature = await page.evaluate(() => window.__sd.level().signature);
    assert.equal(await page.locator('#boss').isVisible(), true);
    assert.match(await page.textContent('#boss-health'), /80\s*\/\s*80/);
    assert.match(await page.textContent('#boss-guide'), /正面頭部/);
    assert.match(await page.textContent('#boss-state'), /尚未開戰/);
    assert.equal(await saved(), campaignSave);

    // State injection isolates the Heart lock and Hunger UI from combat damage.
    await nearHeart();
    await page.waitForFunction(() => window.__sd.state().encounterState === 'active');
    assert.equal((await bot.st()).interactTarget.enabled, false);
    await bot.tap('KeyE');
    s = await bot.st(); assert.equal(s.outcome, 'none'); assert.equal(s.heartTaken, false);
    assert.match(await page.textContent('#boss-state'), /冠甲/);
    const hunger = s.player.hunger;
    await bot.down('Space'); await page.waitForTimeout(200); await bot.up('Space');
    assert.equal((await bot.st()).player.hunger, hunger);

    await page.evaluate(() => window.__sd.debug.defeatGuardians()); await clearChoices();
    s = await bot.st();
    assert.equal(s.encounterState, 'resolved'); assert.equal(s.outcome, 'none');
    assert.equal(s.player.xp, 9); assert.equal(s.pickups.length, 0);
    assert.match(await page.textContent('#objective'), /取走沉眠之心/);
    // Defeat alone must not trigger a no-Heart practice win. Reset remains useful.
    await pause(); await page.click('#btn-restart'); await playing();
    s = await bot.st();
    assert.equal(await page.evaluate(() => window.__sd.level().signature), signature);
    assert.equal(s.enemies.length, 1); assert.equal(s.enemies[0].alive, true); assert.equal(s.enemies[0].hp, 80);
    assert.equal(s.enemies[0].warden.phaseTwo, false); assert.equal(s.enemies[0].paralyzeT, 0);
    assert.equal(s.player.hp, s.player.maxHp); assert.equal(s.player.xp, 0);
    assert.equal(s.encounterState, 'dormant'); assert.equal(s.heartTaken, false);
    assert.deepEqual(s.player.items, []); assert.deepEqual(s.player.talents, []);
    assert.equal(await saved(), campaignSave);

    await page.evaluate(() => window.__sd.debug.defeatGuardians()); await clearChoices();
    await nearHeart();
    assert.equal((await bot.st()).interactTarget.enabled, true);
    await bot.tap('KeyE');
    await page.waitForFunction(() => window.__sd.state().mode === 'results');
    s = await bot.st(); assert.equal(s.outcome, 'win'); assert.equal(s.heartTaken, true);
    assert.equal(await saved(), campaignSave);
    assert.match(await page.textContent('#res-sub'), /守心者/);
    await page.click('#btn-retry'); await playing();
    s = await bot.st(); assert.equal(s.practiceTrial, 'heart-warden'); assert.equal(s.enemies[0].hp, 80);
    assert.equal(s.heartTaken, false); assert.equal(s.outcome, 'none');
    await menu();
  }
  await page.click('#btn-continue'); await playing();
  const resumed = await bot.st();
  assert.equal(resumed.seed, 'WARDEN-MENU-SAVE'); assert.equal(resumed.practice, false);
  assert.equal(resumed.player.cls, 'huntress'); assert.equal(resumed.practiceTrial, null);
  assert.deepEqual(resumed.player.talents, []); assert.equal(await saved(), campaignSave);
  assert.deepEqual(errors, []);
  console.log('PASS Warden menu entry for both classes, base kits, crown HUD, Heart gate, Hunger pause, resets, 9 XP/zero loot and campaign save isolation');
} finally { await browser.close(); }
