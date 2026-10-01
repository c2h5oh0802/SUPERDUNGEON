import { describe, expect, it } from 'vitest';
import { ALL_POTIONS, CLASS_KNOWLEDGE, HEALING_POTION, ITEM_FX, POTION_LOOKS } from '../src/config';
import { Rng } from '../src/core/rng';
import { generateLevel } from '../src/gen/validate';
import { rollConsumable, rollItem, rollPotion } from '../src/gen/loot';
import { addItem, drinkPotion, isKnown, itemColor, itemName, knownHealingCount, looksFor, queueUse, shatterPotion, stunPlayer } from '../src/sim/items';
import { gainXp } from '../src/sim/progress';
import { updatePickups } from '../src/sim/propSys';
import { createFloorWorld, newRun, nextFloor, parseRun, serializeRun } from '../src/sim/run';
import { emptyInput } from '../src/sim/types';
import { World } from '../src/sim/world';
import { finishAction, makeWorld, OPEN_ROOM } from './helpers';
const dt = 1 / 60;
function drink(w: World, shortcut = false) {
  if (!shortcut) queueUse(w, w.player.items.findIndex((it) => it.id === 'potion:healing'), 'use');
  w.frame(dt, { ...emptyInput(), potion: shortcut }); finishAction(w);
}

describe('one seeded Potion identity system', () => {
  it('six distinct shuffled appearances include Healing, never a fixed healing color in new runs', () => {
    expect(ALL_POTIONS).toHaveLength(6); expect(ALL_POTIONS).toContain('healing');
    const colors = new Set<number>();
    for (let k = 0; k < 60; k++) {
      const seed = `HEAL${k}`, looks = looksFor(seed);
      expect(new Set(Object.values(looks.potion)).size).toBe(6);
      for (const i of Object.values(looks.potion)) expect(POTION_LOOKS[i]).toBeDefined();
      colors.add(looks.potion.healing);
    }
    expect(colors.size).toBe(6);
  });
  it('class knowledge differs without changing same-seed geometry, loot or looks', () => {
    const a = createFloorWorld(newRun('HEALCLASS', 'warrior'));
    const b = createFloorWorld(newRun('HEALCLASS', 'huntress'));
    expect(a.level.pickups).toEqual(b.level.pickups); expect(a.level.chests).toEqual(b.level.chests);
    expect(a.level.enemies).toEqual(b.level.enemies); expect(a.level.grid.tiles).toEqual(b.level.grid.tiles);
    expect(a.player.known).toEqual(['potion:healing', 'scroll:teleport']);
    expect(b.player.known).toEqual(['potion:invisibility', 'scroll:mapping']);
    expect(isKnown(a, 'potion:fire')).toBe(false); expect(isKnown(b, 'potion:healing')).toBe(false);
    for (const w of [a, b]) {
      expect(w.player.items).toEqual([]); expect(w.player).not.toHaveProperty('potions');
      expect(isKnown(w, 'scroll:upgrade')).toBe(true);
    }
    expect(itemName(a, 'potion:healing')).toBe('治療藥水');
    expect(itemName(b, 'potion:healing')).not.toBe('治療藥水');
    expect(itemColor(a.level.seed, 'potion:healing', a.level.potionLooksVersion)).toBe(itemColor(b.level.seed, 'potion:healing', b.level.potionLooksVersion));
  });
});

describe('drink/H share reservation, completion, world time and statistics', () => {
  it.each([10, 12, 16])('heals ceil(maxHp × 0.5) at %i max HP', (maxHp) => {
    const w = makeWorld(); w.player.maxHp = maxHp; w.player.hp = 1;
    addItem(w, 'potion:healing'); drink(w);
    expect(w.player.hp).toBe(1 + Math.ceil(maxHp * HEALING_POTION.fraction));
    expect(w.stats.healingRestored).toBe(Math.ceil(maxHp * HEALING_POTION.fraction));
  });
  it('level growth increases the same potion benefit', () => {
    const w = makeWorld(); const oldMax = w.player.maxHp; gainXp(w, 10); if (w.pendingChoice) w.resolveChoice(0);
    expect(w.player.maxHp).toBeGreaterThan(oldMax);
    w.player.hp = 1; addItem(w, 'potion:healing'); drink(w);
    expect(w.player.hp).toBe(1 + Math.ceil(w.player.maxHp * HEALING_POTION.fraction));
  });
  it('unknown Healing consumes, identifies and restores only at completion', () => {
    const w = makeWorld(OPEN_ROOM, [], 'huntress'); w.player.hp = 2;
    addItem(w, 'potion:healing'); queueUse(w, 0, 'use'); w.frame(dt, emptyInput());
    expect(w.player.items).toEqual([]); expect(w.player.hp).toBe(2); expect(isKnown(w, 'potion:healing')).toBe(false);
    expect(w.stats.healingUsed).toBe(0); finishAction(w);
    expect(w.player.hp).toBe(7); expect(isKnown(w, 'potion:healing')).toBe(true);
    expect(w.events.some((e) => e.type === 'identify' && e.kind === 'potion:healing')).toBe(true);
  });
  it('known full HP refuses from both H and bag without spending time/action/item', () => {
    for (const shortcut of [false, true]) {
      const w = makeWorld(); addItem(w, 'potion:healing'); drink(w, shortcut);
      expect(w.player.action).toBeNull(); expect(w.player.items[0]?.count).toBe(1);
      expect(w.stats.itemsUsed).toBe(0); expect(w.stats.healingUsed).toBe(0);
      expect(w.time).toBeCloseTo(dt * .1);
    }
  });
  it('unknown full HP can experiment manually but H cannot select or reveal it', () => {
    const w = makeWorld(OPEN_ROOM, [], 'huntress'); addItem(w, 'potion:healing');
    expect(knownHealingCount(w)).toBe(0); drink(w, true);
    expect(w.player.items[0]?.count).toBe(1); expect(isKnown(w, 'potion:healing')).toBe(false);
    drink(w); expect(w.player.items).toEqual([]); expect(isKnown(w, 'potion:healing')).toBe(true);
    expect(w.player.hp).toBe(w.player.maxHp); expect(w.stats.healingWasted).toBe(5); expect(w.stats.healingRestored).toBe(0);
  });
  it('wounded Huntress H never finds unknown actual Healing; later identified bottles work', () => {
    const w = makeWorld(OPEN_ROOM, [], 'huntress'); w.player.hp = 2; addItem(w, 'potion:healing'); drink(w, true);
    expect(w.player.hp).toBe(2); expect(w.player.items[0]?.count).toBe(1); expect(w.player.action).toBeNull();
    drink(w); addItem(w, 'potion:healing'); w.player.hp = 2; drink(w, true); expect(w.player.hp).toBe(7);
    const empty = makeWorld(); empty.player.hp = 2; drink(empty, true); expect(empty.player.hp).toBe(2);
  });
  it('H and bag have identical action, time, hunger, healing stats and clamp/waste', () => {
    const worlds = [makeWorld(), makeWorld()];
    worlds.forEach((w, k) => {
      w.player.hp = 8; addItem(w, 'potion:healing');
      if (!k) queueUse(w, 0, 'use');
      w.frame(dt, { ...emptyInput(), potion: !!k });
      expect(w.player.hp).toBe(8); expect(w.player.items).toEqual([]);
    });
    expect(worlds[0]!.player.action).toEqual(worlds[1]!.player.action);
    worlds.forEach((w) => finishAction(w));
    expect(worlds[0]!.time).toBeCloseTo(worlds[1]!.time); expect(worlds[0]!.stats).toEqual(worlds[1]!.stats);
    const w = worlds[0]!; expect(w.player.hp).toBe(10); expect(w.stats.healingRestored).toBe(2); expect(w.stats.healingWasted).toBe(3);
    expect(w.stats.itemsUsed).toBe(1); expect(w.stats.potionsUsed).toBe(1); expect(w.stats.healingUsed).toBe(1);
    expect(w.player.hunger).toBeCloseTo(w.time);
  });
  it('interruption consumes reserved bottle but never completes healing or identification', () => {
    const w = makeWorld(OPEN_ROOM, [], 'huntress'); w.player.hp = 1; addItem(w, 'potion:healing');
    queueUse(w, 0, 'use'); w.frame(dt, emptyInput()); stunPlayer(w, .1); finishAction(w);
    expect(w.player.items).toEqual([]); expect(w.player.hp).toBe(1); expect(isKnown(w, 'potion:healing')).toBe(false);
    expect(w.stats.healingUsed).toBe(0); expect(w.stats.itemsUsed).toBe(0);
  });
  it('throw does not heal any actor or spawn area; harmless throwing cannot identify it', () => {
    const w = makeWorld(OPEN_ROOM, [{ kind: 'guard', x: 9, z: 9 }], 'huntress');
    w.player.hp = 1; w.enemies[0]!.hp = 1; shatterPotion(w, 'healing', 9, .2, 9);
    expect(w.player.hp).toBe(1); expect(w.enemies[0]!.hp).toBe(1); expect(w.areas).toEqual([]);
    expect(isKnown(w, 'potion:healing')).toBe(false); expect(w.stats.healingUsed).toBe(0);
    const known = makeWorld(); addItem(known, 'potion:healing'); queueUse(known, 0, 'throw'); known.frame(dt, emptyInput());
    expect(known.player.action?.kind).toBe('bottle'); expect(known.player.items).toEqual([]);
  });
});

describe('healing supply is real inventory, never generic enemy stock', () => {
  it('converts each chest and loose source, keeps arena empty and food/upgrade totals', () => {
    for (const seed of ['FLOW1', 'FLOW2', 'LIVING1']) {
      let reliable = 0, foods = 0, upgrades = 0;
      for (let floor = 1; floor <= 5; floor++) {
        const l = generateLevel(seed, { floor });
        expect(l.pickups.every((p) => p.kind !== ('potion' as string))).toBe(true);
        if (floor === 5) { expect(l.chests).toHaveLength(0); expect(l.pickups).toHaveLength(0); continue; }
        expect(l.chests).toHaveLength(2);
        for (const c of l.chests) {
          expect(c.contents).not.toHaveProperty('potions'); expect(c.contents.items[0]?.id).toBe('potion:healing'); reliable++;
        }
        expect(l.pickups.some((p) => p.item === 'potion:healing')).toBe(true); reliable++;
        foods += l.pickups.filter((p) => p.item === 'food:ration').length;
        upgrades += l.pickups.filter((p) => p.item === 'scroll:upgrade').length;
      }
      expect(reliable).toBe(12); expect(foods).toBe(6); expect(upgrades).toBe(4);
    }
  });
  it('floor roll can contain Healing, ordinary AND veteran enemy pools cannot', () => {
    const rng = new Rng('HEAL-POOLS'), floor = new Set<string>();
    for (let k = 0; k < 2000; k++) {
      floor.add(rollPotion(rng).id);
      expect(rollConsumable(rng, 'enemy').id).not.toBe('potion:healing');
      expect(rollItem(rng, 4, 'enemy').id).not.toBe('potion:healing');
    }
    expect(floor.has('potion:healing')).toBe(true);
  });
  it('full bag retains physical bottle until room exists; pickup count increments once', () => {
    const w = makeWorld(); for (let k = 0; k < ITEM_FX.slots; k++) addItem(w, 'weapon:axe');
    const p = w.addPickup('item', 1, w.player.x, .1, w.player.z, null, 'potion:healing');
    updatePickups(w); expect(p.taken).toBe(false); expect(w.stats.healingFound).toBe(0);
    w.player.items.pop(); updatePickups(w); updatePickups(w);
    expect(p.taken).toBe(true); expect(w.stats.healingFound).toBe(1); expect(knownHealingCount(w)).toBe(1);
  });
  it('identity and item stack survive floor boundary/new save', () => {
    const run = newRun('HEAL-CARRY', 'huntress'), w = createFloorWorld(run);
    drinkPotion(w, 'healing'); addItem(w, 'potion:healing'); addItem(w, 'potion:healing');
    const b = createFloorWorld(parseRun(serializeRun(nextFloor(run, w)))!);
    expect(knownHealingCount(b)).toBe(2); expect(b.player.known).toContain('potion:healing');
    expect(b.player.known).toEqual(expect.arrayContaining([...CLASS_KNOWLEDGE.huntress]));
    expect(b.stats.healingUsed).toBe(1);
  });
  it.each(['weapon:spear', 'armor:mail'] as const)('overflow equip preserves outgoing %s as recoverable ground item', (oldId) => {
    const w = makeWorld(); w.player.items = Array.from({ length: ITEM_FX.slots }, () => ({ id: oldId.startsWith('weapon') ? 'weapon:axe' as const : 'armor:leather' as const, count: 1, level: 0 }));
    w.player.items.push({ id: 'potion:healing', count: 3, level: 0 });
    if (oldId === 'weapon:spear') w.player.weapon = { id: 'spear', level: 5 }; else w.player.armor = { id: 'mail', level: 5 };
    queueUse(w, 0, 'use'); w.frame(dt, emptyInput()); finishAction(w);
    const ground = w.pickups.find((p) => p.item === oldId && p.level === 5);
    expect(ground).toBeDefined(); expect(ground!.taken).toBe(false);
    expect(w.player.items.find((it) => it.id === 'potion:healing')?.count).toBe(3);
    w.player.items.pop(); updatePickups(w);
    expect(w.player.items.some((it) => it.id === oldId && it.level === 5)).toBe(true);
  });
  it('practice resupply grants normal stack + knowledge without changing campaign', () => {
    const level = generateLevel('HEAL-PRACTICE', { practice: true }), w = new World(level, { cls: 'huntress' });
    const supply = w.interactables.find((it) => it.kind === 'resupply')!;
    w.player.x = supply.x; w.player.z = supply.z + 1; w.player.yaw = 0;
    w.frame(dt, { ...emptyInput(), interact: true }); finishAction(w);
    expect(knownHealingCount(w)).toBe(HEALING_POTION.practiceCount);
    expect(createFloorWorld(newRun('HEAL-PRACTICE', 'huntress')).player.known).not.toContain('potion:healing');
  });
});
