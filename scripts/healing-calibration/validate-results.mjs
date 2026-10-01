import process from 'node:process';
import console from 'node:console';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const files = process.argv.slice(2);
assert(files.length, 'Pass result files to validate');
for (const file of files) {
  const data = JSON.parse(readFileSync(file, 'utf8'));
  const seen = new Set();
  for (const r of data.results) {
    const id = [r.seed, r.cls, r.policy, r.guard, r.bot, r.eatEnabled].join('/');
    assert(!seen.has(id), `Duplicate scenario: ${id}`); seen.add(id);
    for (const key of ['damageTotal', 'healingInitial', 'healingFound', 'healingUsed', 'healingRemaining', 'healingCompleted', 'healingRestored', 'healingWasted', 'worldTime']) {
      assert(Number.isFinite(r[key]) && r[key] >= 0, `${id}: ${key} must be finite and nonnegative`);
    }
    for (const key of new Set([...Object.keys(r.initial), ...Object.keys(r.found), ...Object.keys(r.granted), ...Object.keys(r.used), ...Object.keys(r.remaining)])) {
      assert.equal((r.initial[key] || 0) + (r.found[key] || 0) + (r.granted[key] || 0) - (r.used[key] || 0), r.remaining[key] || 0, `${id}: resource conservation ${key}`);
    }
    const healingGranted = (r.granted.potions || 0) + (r.granted['potion:healing'] || 0);
    assert.equal(r.healingInitial + r.healingFound + healingGranted - r.healingUsed, r.healingRemaining, `${id}: normalized healing conservation`);
    if (r.productionHealingStats.found !== null) assert.equal(r.productionHealingStats.found, r.healingFound, `${id}: production healing acquisition counter`);
    if (r.productionHealingStats.used !== null) assert.equal(r.productionHealingStats.used, r.healingCompleted, `${id}: production healing completion counter`);
    assert(r.healingCompleted <= r.healingUsed, `${id}: completed healing cannot exceed reserved units`);
    assert.equal(r.complete, r.floors.length === r.expectedFloors && r.floors.at(-1).outcome === 'win', `${id}: completion`);
    assert.equal(r.floorReached, r.floors.at(-1).floor, `${id}: floor reached`);
    assert.equal(r.finalHp, r.floors.at(-1).hp, `${id}: final HP`);
    for (const key of ['damage', 'healingFound', 'healingUsed', 'upgradeChoices']) {
      assert.equal(r.floors.reduce((n, f) => n + f[key], 0), r[key === 'damage' ? 'damageTotal' : key], `${id}: per-floor ${key}`);
    }
    assert.equal(r.foodFound, r.found['food:ration'] || 0, `${id}: food found`);
    assert.equal(r.foodRemaining, r.remaining['food:ration'] || 0, `${id}: food remaining`);
    for (let i = 1; i < r.floors.length; i++) assert.equal(r.floors[i].hpAtStart, r.floors[i - 1].hp, `${id}: HP carries to next floor`);
    if (r.guard) assert.equal(r.healingUsed, 0, `${id}: HP-restored proxy must not consume healing`);
  }
  console.log(`${file}: ${data.results.length} unique scenarios; resource/HP/healing/floor accounting passed`);
}
