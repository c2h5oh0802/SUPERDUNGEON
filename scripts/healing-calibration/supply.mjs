/** Generated supply census; does not simulate route acquisition. */
import process from 'node:process';
import console from 'node:console';
import { writeFileSync } from 'node:fs';
import { CLASSES, PLAYER, RUN, ALL_POTIONS } from '__SOURCE__/src/config';
import { createFloorWorld, newRun } from '__SOURCE__/src/sim/run';
import { generateLevel } from '__SOURCE__/src/gen/validate';
const seeds = (process.env.SEEDS || 'FLOW1,FLOW2,LIVING1').split(',');
const healingId = 'potion:healing';
const healingItems = (items) => (items || []).filter((i) => i.id === healingId).length;
const results = seeds.map(seed => {
  const floors = [];
  for (let floor = 1; floor <= RUN.floors; floor++) {
    const level = generateLevel(seed, { floor });
    const chests = level.chests.map(c => ({ roomKey: c.roomKey, x: c.x, z: c.z, legacyHealing: c.contents.potions || 0,
      items: c.contents.items || (c.contents.item ? [c.contents.item] : []),
      healing: (c.contents.potions || 0) + healingItems(c.contents.items || (c.contents.item ? [c.contents.item] : [])) }));
    const looseHealing = level.pickups.filter(p => p.kind === 'potion' || p.item === healingId).map(p => ({ kind: p.kind, item: p.item, amount: p.amount, x: p.x, z: p.z }));
    floors.push({ floor, encounter: Boolean(level.encounter), chestCount: chests.length, chests,
      chestHealing: chests.reduce((n, c) => n + c.healing, 0), looseHealingCount: looseHealing.reduce((n, p) => n + p.amount, 0), looseHealing,
      foodCount: level.pickups.filter(p => p.item === 'food:ration').reduce((n, p) => n + p.amount, 0),
      upgradeCount: level.pickups.filter(p => p.item === 'scroll:upgrade').reduce((n, p) => n + p.amount, 0),
      allLooseItems: level.pickups.filter(p => p.kind === 'item').map(p => ({ id: p.item, count: p.amount, x: p.x, z: p.z })) });
  }
  return { seed, chestCount: floors.reduce((n, f) => n + f.chestCount, 0), generatedHealing: floors.reduce((n, f) => n + f.chestHealing + f.looseHealingCount, 0), floors };
});
const starts = Object.fromEntries(['warrior', 'huntress'].map(cls => {
  const p = createFloorWorld(newRun(seeds[0], cls)).player;
  return [cls, { loadout: CLASSES[cls].start, hp: p.hp, maxHp: p.maxHp, known: p.known, items: p.items,
    healing: (p.potions || 0) + p.items.filter(i => i.id === healingId).reduce((n, i) => n + i.count, 0) }];
}));
const out = { harnessVersion: 'healing-supply-census-v1', source: process.env.SOURCE_REPO, player: PLAYER, potionPool: ALL_POTIONS, starts, results };
writeFileSync(process.env.OUTPUT, JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify({ starts, supply: results.map(r => ({ seed: r.seed, chestCount: r.chestCount, generatedHealing: r.generatedHealing, floors: r.floors.map(f => ({ floor: f.floor, chestCount: f.chestCount, chestHealing: f.chestHealing, looseHealingCount: f.looseHealingCount, foodCount: f.foodCount, upgradeCount: f.upgradeCount })) })) }, null, 2));
