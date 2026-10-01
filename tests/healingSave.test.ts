import { describe, expect, it } from 'vitest';
import { HUNGER, ITEM_FX, PLAYER, RUN, TALENT_FX, XP } from '../src/config';
import { addItem, queueUse } from '../src/sim/items';
import { createFloorWorld, newRun, nextFloor, parseRun, serializeRun } from '../src/sim/run';
import { emptyInput, type InvItem } from '../src/sim/types';
import { World } from '../src/sim/world';
import { finishAction, makeWorld, OPEN_ROOM, testLevel } from './helpers';

const legacySave = (potions = 2) => {
  const run = newRun('HEALING-SAVE', 'huntress');
  const w = makeWorld(undefined, [], 'huntress');
  w.player.items = [];
  w.player.known = ['potion:frost', 'scroll:mapping'];
  const save = JSON.parse(serializeRun(nextFloor(run, w)));
  delete save.inventoryVersion;
  delete save.potionLooksVersion;
  save.carry.potions = potions;
  for (const key of ['healingFound', 'healingUsed', 'healingRestored', 'healingWasted']) delete save.stats[key];
  return save;
};

const gearBag = (size: number = ITEM_FX.slots): InvItem[] => Array.from({ length: size }, (_, k) => ({
  id: k % 2 === 0 ? 'weapon:axe' : 'armor:mail', count: 1, level: k % 4,
}));

describe('Healing stock save migration', () => {
  it.each([0, 1, 2, 3])('moves legacy stock %i into real items exactly once without retaining a numeric pool', (stock) => {
    const old = legacySave(stock);
    old.carry.items = [{ id: 'food:ration', count: 2, level: 0 }];
    const parsed = parseRun(JSON.stringify(old))!;
    expect(parsed).not.toBeNull();
    expect(parsed.carry).not.toHaveProperty('potions');
    expect(parsed.carry!.items).toEqual([
      { id: 'food:ration', count: 2, level: 0 },
      ...(stock > 0 ? [{ id: 'potion:healing', count: stock, level: 0 }] : []),
    ]);
    expect(parsed.carry!.known.includes('potion:healing')).toBe(stock > 0);
    const encoded = serializeRun(parsed);
    expect(JSON.parse(encoded).carry).not.toHaveProperty('potions');
    expect(parseRun(encoded)).toEqual(parsed);
    const world = createFloorWorld(parsed);
    expect(world.player).not.toHaveProperty('potions');
    expect(world.player.items).toEqual(parsed.carry!.items);
    expect(parseRun(serializeRun(nextFloor(parsed, world)))!.carry!.items).toEqual(parsed.carry!.items);
  });

  it('fills every existing partial healing stack without overwriting, dropping or overfilling any stack', () => {
    const old = legacySave(3);
    old.carry.items = [
      { id: 'potion:healing', count: 98, level: 0 },
      { id: 'food:ration', count: 2, level: 0 },
      { id: 'potion:healing', count: 98, level: 0 },
    ];
    const parsed = parseRun(JSON.stringify(old))!;
    expect(parsed.carry!.items).toEqual([
      { id: 'potion:healing', count: 99, level: 0 },
      { id: 'food:ration', count: 2, level: 0 },
      { id: 'potion:healing', count: 99, level: 0 },
      { id: 'potion:healing', count: 1, level: 0 },
    ]);
    expect(parseRun(serializeRun(parsed))).toEqual(parsed);
  });

  it('merges into the bag even when all ordinary slots are occupied', () => {
    const old = legacySave(3);
    const items = gearBag(ITEM_FX.slots - 1);
    old.carry.items = [...items, { id: 'potion:healing', count: 8, level: 0 }];
    const parsed = parseRun(JSON.stringify(old))!;
    expect(parsed.carry!.items).toEqual([...items, { id: 'potion:healing', count: 11, level: 0 }]);
    expect(parsed.carry!.items).toHaveLength(ITEM_FX.slots);
  });

  it('keeps a full old bag and one temporary extra healing stack through reloads and consumption', () => {
    const old = legacySave(3), gear = gearBag();
    old.carry.items = gear;
    let parsed = parseRun(JSON.stringify(old))!;
    expect(parsed.carry!.items).toEqual([...gear, { id: 'potion:healing', count: 3, level: 0 }]);
    expect(parseRun(serializeRun(parsed))).toEqual(parsed);
    for (let remaining = 2; remaining >= 0; remaining--) {
      const w = new World(testLevel(OPEN_ROOM), { cls: parsed.cls, carry: parsed.carry!, stats: parsed.stats! });
      expect(addItem(w, 'weapon:longsword')).toBe(false);
      w.player.hp = 1;
      queueUse(w, w.player.items.findIndex((item) => item.id === 'potion:healing'), 'use');
      w.frame(1 / 60, emptyInput());
      finishAction(w);
      expect(w.player.items).toEqual([...gear,
        ...(remaining ? [{ id: 'potion:healing', count: remaining, level: 0 }] : []),
      ]);
      parsed = parseRun(serializeRun(nextFloor(parsed, w)))!;
      expect(parsed).not.toBeNull();
    }
    expect(parsed.carry!.items).toHaveLength(ITEM_FX.slots);
    const w = createFloorWorld(parsed);
    w.player.items.pop();
    expect(addItem(w, 'weapon:longsword')).toBe(true);
    expect(parseRun(serializeRun(nextFloor(parsed, w)))!.carry!.items).toHaveLength(ITEM_FX.slots);
  });

  it('preserves overflow after healing is reordered or stacks grow through ordinary pickups', () => {
    const old = legacySave(3);
    old.carry.items = gearBag();
    const parsed = parseRun(JSON.stringify(old))!;
    const w = createFloorWorld(parsed);
    w.player.items.unshift(w.player.items.pop()!);
    expect(addItem(w, 'potion:healing')).toBe(true);
    expect(w.player.items[0]).toEqual({ id: 'potion:healing', count: 4, level: 0 });
    const next = nextFloor(parsed, w);
    expect(parseRun(serializeRun(next))).toEqual(next);
  });

  it('keeps saturated healing and the migrated remainder as separate valid stacks in a full bag', () => {
    const old = legacySave(3);
    old.carry.items = [...gearBag(ITEM_FX.slots - 1), { id: 'potion:healing', count: 99, level: 0 }];
    const parsed = parseRun(JSON.stringify(old))!;
    expect(parsed.carry!.items).toHaveLength(ITEM_FX.slots + 1);
    expect(parsed.carry!.items.slice(-2)).toEqual([
      { id: 'potion:healing', count: 99, level: 0 }, { id: 'potion:healing', count: 3, level: 0 },
    ]);
    expect(parseRun(serializeRun(parsed))).toEqual(parsed);
  });

  it('retains Rune cleanup, old scroll aliases, hunger defaults and chapter-2 floor migration together', () => {
    const old = legacySave(2);
    delete old.chapter;
    old.floor = RUN.explorationFloors;
    old.carry.level = 3;
    old.carry.talents = ['toughness'];
    const maxHp = PLAYER.maxHp + 2 * XP.hpPerLevel + TALENT_FX.toughnessHp;
    old.carry.maxHp = maxHp + 4;
    old.carry.hp = maxHp + 4;
    old.carry.runes = ['vigor', 'vigor', 'future-unknown'];
    delete old.carry.hunger;
    delete old.carry.starvationT;
    old.carry.items = [
      { id: 'scroll:timeStop', count: 98, level: 0 },
      { id: 'scroll:sleep', count: 3, level: 0 },
      { id: 'scroll:lure', count: 1, level: 0 },
      { id: 'food:ration', count: 2, level: 0 },
    ];
    old.carry.known.push('scroll:timeStop', 'scroll:lure');
    const parsed = parseRun(JSON.stringify(old))!;
    expect(parsed.floor).toBe(RUN.explorationFloors);
    expect(parsed.carry).toMatchObject({ maxHp, hp: maxHp, hunger: 0, starvationT: 0 });
    expect(parsed.carry).not.toHaveProperty('runes');
    expect(parsed.carry!.items).toEqual([
      { id: 'scroll:sleep', count: 99, level: 0 },
      { id: 'scroll:sleep', count: 2, level: 0 },
      { id: 'food:ration', count: 2, level: 0 },
      { id: 'potion:healing', count: 2, level: 0 },
    ]);
    expect(parsed.carry!.known).toEqual(['potion:frost', 'scroll:mapping', 'scroll:sleep', 'potion:healing']);
    expect(parseRun(serializeRun(parsed))).toEqual(parsed);
    parsed.carry!.hunger = HUNGER.starvingAt;
    parsed.carry!.starvationT = 2;
    expect(parseRun(serializeRun(parsed))!.carry).toEqual(parsed.carry);
  });

  it('defaults absent healing statistics to zero and preserves new statistics through every boundary', () => {
    const old = legacySave();
    old.stats.potionsUsed = 7;
    const parsed = parseRun(JSON.stringify(old))!;
    expect(parsed.stats).toMatchObject({ potionsUsed: 7, healingFound: 0, healingUsed: 0, healingRestored: 0, healingWasted: 0 });
    Object.assign(parsed.stats!, { healingFound: 8, healingUsed: 4, healingRestored: 13, healingWasted: 11 });
    expect(parseRun(serializeRun(parsed))).toEqual(parsed);
    expect(createFloorWorld(parsed).stats).toMatchObject({ healingFound: 8, healingUsed: 4, healingRestored: 13, healingWasted: 11 });
  });
});

describe('Healing save validation and appearance compatibility', () => {
  it.each([-1, 4, .5, null, '2', true, {}, [], 1e100])('rejects malformed legacy stock %j', (stock) => {
    const old = legacySave();
    old.carry.potions = stock;
    expect(parseRun(JSON.stringify(old))).toBeNull();
  });

  it('rejects nonfinite numeric stock and malformed healing item data', () => {
    expect(parseRun(JSON.stringify(legacySave()).replace('"potions":2', '"potions":1e309'))).toBeNull();
    for (const patch of [{ count: 0 }, { count: 100 }, { count: .5 }, { level: -1 }, { id: 'potion:heal' }]) {
      const old = legacySave();
      old.carry.items = [{ id: 'potion:healing', count: 1, level: 0, ...patch }];
      expect(parseRun(JSON.stringify(old))).toBeNull();
    }
  });

  it('allows only one marked healing overflow and never arbitrary excess inventory or repeated migration', () => {
    const old = legacySave();
    old.carry.items = [...gearBag(), { id: 'potion:healing', count: 1, level: 0 }];
    expect(parseRun(JSON.stringify(old))).toBeNull();
    old.inventoryVersion = 1;
    expect(parseRun(JSON.stringify(old))).toBeNull();
    delete old.carry.potions;
    expect(parseRun(JSON.stringify(old))).not.toBeNull();
    delete old.inventoryVersion;
    expect(parseRun(JSON.stringify(old))).toBeNull();
    old.inventoryVersion = 1;
    old.carry.items.push({ id: 'potion:healing', count: 1, level: 0 });
    expect(parseRun(JSON.stringify(old))).toBeNull();
    old.carry.items = gearBag(ITEM_FX.slots + 1);
    expect(parseRun(JSON.stringify(old))).toBeNull();
    old.carry.items = [];
    old.inventoryVersion = 2;
    expect(parseRun(JSON.stringify(old))).toBeNull();
  });

  it('new saves have no numeric stock, and old cosmetics stay on version 1 across floors', () => {
    const fresh = newRun('NEW-HEALING', 'huntress');
    expect(fresh.potionLooksVersion).toBe(2);
    expect(parseRun(serializeRun(fresh))).toEqual(fresh);
    expect(createFloorWorld(fresh).level.potionLooksVersion).toBe(2);
    const parsed = parseRun(JSON.stringify(legacySave()))!;
    expect(parsed.potionLooksVersion).toBe(1);
    const w = createFloorWorld(parsed);
    expect(w.level.potionLooksVersion).toBe(1);
    const next = parseRun(serializeRun(nextFloor(parsed, w)))!;
    expect(next.potionLooksVersion).toBe(1);
    expect(createFloorWorld(next).level.potionLooksVersion).toBe(1);
    expect(JSON.parse(serializeRun(next)).carry).not.toHaveProperty('potions');
  });

  it.each([0, 3, null, '1', true])('rejects malformed appearance version %j', (version) => {
    const old = legacySave();
    old.potionLooksVersion = version;
    expect(parseRun(JSON.stringify(old))).toBeNull();
  });

  it('does not serialize a retired numeric stock field leaked by an old runtime caller', () => {
    const parsed = parseRun(JSON.stringify(legacySave()))!;
    Object.assign(parsed.carry!, { potions: 2 });
    expect(JSON.parse(serializeRun(parsed)).carry).not.toHaveProperty('potions');
    expect(parsed.carry).toHaveProperty('potions', 2);
  });
});
