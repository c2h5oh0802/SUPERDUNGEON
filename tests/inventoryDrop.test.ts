import { afterEach, describe, expect, it, vi } from 'vitest';
import { ACTIONS, HUNGER, ITEM_FX, PLAYER, type ItemId } from '../src/config';
import { addItem, drinkPotion, isKnown, itemName, queueUse, takeForAction } from '../src/sim/items';
import { updatePickups } from '../src/sim/propSys';
import { createFloorWorld, newRun, nextFloor, parseRun, serializeRun } from '../src/sim/run';
import { emptyInput } from '../src/sim/types';
import type { World } from '../src/sim/world';
import { renderInventory } from '../src/ui/inventory';
import { finishAction, makeWorld } from './helpers';

const dt = 1 / 120;
const frame = (w: World) => w.frame(dt, emptyInput(w.player.yaw, w.player.pitch));
function drop(w: World, index = 0, all = false) {
  queueUse(w, index, all ? 'dropAll' : 'drop');
  frame(w);
  finishAction(w, dt);
}
function leaveAndReturn(w: World) {
  const x = w.player.x;
  w.player.x += PLAYER.pickupRadius + 0.1;
  updatePickups(w);
  w.player.x = x;
  updatePickups(w);
}
function fullBag(w: World) {
  w.player.items = Array.from({ length: ITEM_FX.slots }, () => ({ id: 'weapon:axe' as ItemId, count: 1, level: 2 }));
}

afterEach(() => vi.unstubAllGlobals());

describe('intact inventory drops use the ordinary committed action clock', () => {
  it.each(['warrior', 'huntress'] as const)('%s can place one item or its complete stack and recover it only after leaving', cls => {
    const w = makeWorld(undefined, [], cls);
    w.player.items = [{ id: 'potion:frost', count: 3, level: 0 }];
    const known = [...w.player.known];
    const name = itemName(w, 'potion:frost');
    queueUse(w, 0, 'drop');
    expect(w.player.items[0]!.count).toBe(3);
    expect(w.pickups).toHaveLength(0);
    expect(w.time).toBe(0); // Menu selection does not mutate the paused world.
    frame(w);
    expect(w.player.action?.kind).toBe('drop');
    expect(w.player.items[0]!.count).toBe(2);
    expect(w.pickups[0]).toMatchObject({ item: 'potion:frost', amount: 1, playerDropped: true, pickupBlockedUntilExit: true, taken: false });
    finishAction(w, dt);
    expect(w.lastAction).toMatchObject({ kind: 'drop', spent: ACTIONS.drop.recovery });
    for (let k = 0; k < 120; k++) frame(w);
    expect(w.pickups[0]!.taken).toBe(false);
    drop(w, 0, true);
    expect(w.player.items).toHaveLength(0);
    expect(w.pickups.map(p => p.amount)).toEqual([1, 2]);
    leaveAndReturn(w);
    expect(w.player.items).toEqual([{ id: 'potion:frost', count: 3, level: 0 }]);
    expect(w.pickups.every(p => p.taken)).toBe(true);
    expect(w.player.known).toEqual(known);
    expect(itemName(w, 'potion:frost')).toBe(name);
    expect(w.stats.itemsUsed).toBe(0);
    expect(w.stats.bottlesThrown).toBe(0);
    expect(w.projectiles).toHaveLength(0);
    expect(w.areas).toHaveLength(0);
  });

  it('charges recovery and Hunger time; haste halves the same action', () => {
    for (const haste of [false, true]) {
      const w = makeWorld();
      addItem(w, 'weapon:spear', 3);
      if (haste) w.player.hasteT = 5;
      drop(w);
      expect(w.time).toBeCloseTo(ACTIONS.drop.recovery * (haste ? .5 : 1), 7);
      expect(w.player.hunger).toBeCloseTo(w.time, 7);
    }
  });

  it('repeated clicks reserve only one action and intact transfer survives an interruption', () => {
    const w = makeWorld();
    w.player.items = [{ id: 'scroll:upgrade', count: 4, level: 0 }];
    queueUse(w, 0, 'dropAll'); queueUse(w, 0, 'dropAll'); frame(w);
    expect(w.pickups).toHaveLength(1);
    expect(w.pickups[0]!.amount).toBe(4);
    drinkPotion(w, 'gas'); // An existing effect can replace the action with stunned.
    finishAction(w, dt);
    expect(w.player.items).toHaveLength(0);
    expect(w.pickups[0]!.amount).toBe(4);
    leaveAndReturn(w);
    expect(w.player.items).toEqual([{ id: 'scroll:upgrade', count: 4, level: 0 }]);
  });

  it('does not redirect a stale queued selection to another item at its former index', () => {
    const w = makeWorld();
    addItem(w, 'weapon:axe', 4); addItem(w, 'armor:mail', 5);
    queueUse(w, 0, 'dropAll');
    w.player.items.splice(0, 1);
    frame(w);
    expect(w.pickups).toHaveLength(0);
    expect(w.player.items).toEqual([{ id: 'armor:mail', count: 1, level: 5 }]);
    expect(w.player.action).toBeNull();
  });

  it('follows the selected stack when another item leaves an earlier index', () => {
    const w = makeWorld();
    addItem(w, 'weapon:axe'); addItem(w, 'armor:mail', 5);
    queueUse(w, 1, 'drop');
    w.player.items.splice(0, 1);
    frame(w); finishAction(w, dt);
    expect(w.player.items).toHaveLength(0);
    expect(w.pickups[0]).toMatchObject({ item: 'armor:mail', level: 5, amount: 1 });
  });

  it.each(['use', 'throw', 'convert'] as const)('stale queued %s cannot use a replacement stack', mode => {
    const w = makeWorld(undefined, [], 'huntress');
    w.player.talents.push('apothecary'); w.player.known.push('potion:frost');
    w.player.tipped.chill = 0;
    addItem(w, 'potion:frost'); queueUse(w, 0, mode);
    expect(w.player.pendingUse).not.toBeNull();
    w.player.items[0] = { id: 'potion:healing', count: 2, level: 0 };
    frame(w);
    expect(w.player.action).toBeNull();
    expect(w.player.items[0]!.count).toBe(2);
    expect(w.projectiles).toHaveLength(0);
    expect(w.stats.itemsUsed).toBe(0);
  });

  it('death after the atomic transfer neither duplicates nor refunds the item', () => {
    const w = makeWorld(); addItem(w, 'weapon:spear', 5);
    queueUse(w, 0, 'drop'); frame(w);
    w.damagePlayer(100, 'test', w.player.x, w.player.z);
    for (let k = 0; k < 120; k++) frame(w);
    expect(w.player.dead).toBe(true);
    expect(w.player.items).toHaveLength(0);
    expect(w.pickups).toHaveLength(1);
    expect(w.pickups[0]).toMatchObject({ item: 'weapon:spear', level: 5, amount: 1, taken: false });
  });

  it('a queued drop waits for a drink, never copies the already-reserved bottle', () => {
    const w = makeWorld(); w.player.hp = 2;
    w.player.items = [{ id: 'potion:healing', count: 3, level: 0 }];
    queueUse(w, 0, 'use'); frame(w);
    expect(w.player.items[0]!.count).toBe(2);
    queueUse(w, 0, 'dropAll');
    finishAction(w, dt);
    expect(w.stats.healingUsed).toBe(1);
    expect(w.pickups).toHaveLength(0);
    frame(w); finishAction(w, dt);
    expect(w.pickups[0]!.amount).toBe(2);
    expect(w.player.items).toHaveLength(0);
    expect(w.stats.healingUsed).toBe(1);
  });

  it('full-health healing and full-hunger food can be placed without using or identifying them', () => {
    const w = makeWorld(undefined, [], 'huntress');
    w.player.items = [{ id: 'potion:healing', count: 1, level: 0 }, { id: 'food:ration', count: 2, level: 0 }];
    drop(w); drop(w, 0, true);
    expect(isKnown(w, 'potion:healing')).toBe(false);
    expect(w.player.hp).toBe(w.player.maxHp);
    expect(w.stats.healingUsed).toBe(0);
    expect(w.stats.itemsUsed).toBe(0);
    expect(w.pickups.map(p => [p.item, p.amount])).toEqual([['potion:healing', 1], ['food:ration', 2]]);
  });

  it('the consumable reservation entry point refuses intact drop modes', () => {
    const w = makeWorld(); addItem(w, 'potion:healing');
    expect(takeForAction(w, 0, 'drop')).toBeNull();
    expect(takeForAction(w, 0, 'dropAll')).toBeNull();
    expect(w.player.items[0]!.count).toBe(1);
  });
});

describe('capacity, provenance and old saves remain lossless', () => {
  it('placing gear frees one slot for nearby loot without auto-picking the old gear', () => {
    const w = makeWorld(); fullBag(w);
    const oldGear = { ...w.player.weapon };
    const wanted = w.addPickup('item', 1, w.player.x, .15, w.player.z, null, 'armor:mail', 3);
    drop(w);
    expect(wanted.taken).toBe(true);
    expect(w.player.items).toHaveLength(10);
    expect(w.player.items).toContainEqual({ id: 'armor:mail', count: 1, level: 3 });
    const placed = w.pickups.find(p => p.playerDropped)!;
    expect(placed).toMatchObject({ item: 'weapon:axe', level: 2, amount: 1, taken: false });
    expect(w.player.weapon).toEqual(oldGear);
    leaveAndReturn(w); // Still full: item remains recoverable, not lost.
    expect(placed.taken).toBe(false);
    drop(w, w.player.items.findIndex(i => i.id === 'armor:mail'));
    updatePickups(w);
    expect(placed.taken).toBe(true);
    expect(w.player.items.filter(i => i.id === 'weapon:axe')).toHaveLength(10);
  });

  it('large stacks recover only what fits and keep the remainder on the floor', () => {
    const w = makeWorld();
    w.player.items = [{ id: 'potion:healing', count: 99, level: 0 }];
    drop(w, 0, true);
    fullBag(w);
    w.player.items[0] = { id: 'potion:healing', count: 98, level: 0 };
    leaveAndReturn(w);
    expect(w.player.items[0]!.count).toBe(99);
    expect(w.pickups[0]).toMatchObject({ amount: 98, taken: false });
    w.player.items.splice(1, 1);
    updatePickups(w);
    expect(w.player.items.filter(i => i.id === 'potion:healing').map(i => i.count)).toEqual([99, 98]);
    expect(w.pickups[0]!.taken).toBe(true);
  });

  it('ration stack cap and leftover amounts survive repeated visits', () => {
    const w = makeWorld();
    w.player.items = [{ id: 'food:ration', count: HUNGER.foodStackMax, level: 0 }];
    drop(w, 0, true);
    addItem(w, 'food:ration'); leaveAndReturn(w);
    expect(w.player.items[0]!.count).toBe(HUNGER.foodStackMax);
    expect(w.pickups[0]).toMatchObject({ amount: 1, taken: false });
    w.player.items[0]!.count--;
    updatePickups(w);
    expect(w.pickups[0]!.taken).toBe(true);
  });

  it('repeated Healing re-pickup never farms found/used/restored statistics', () => {
    const w = makeWorld();
    w.addPickup('item', 3, w.player.x, .15, w.player.z, null, 'potion:healing');
    updatePickups(w);
    expect(w.stats.healingFound).toBe(3);
    for (let n = 0; n < 5; n++) { drop(w, 0, true); leaveAndReturn(w); }
    expect(w.player.items).toEqual([{ id: 'potion:healing', count: 3, level: 0 }]);
    expect(w.stats).toMatchObject({ healingFound: 3, healingUsed: 0, healingRestored: 0, healingWasted: 0, itemsUsed: 0 });
  });

  it.each([false, true])('an eleven-slot migrated bag survives drop, re-pickup and boundary saves (drop healing=%s)', healing => {
    const run = newRun('DROP-LEGACY', 'warrior');
    const w = createFloorWorld(run); fullBag(w);
    w.player.items.push({ id: 'potion:healing', count: 3, level: 0 });
    drop(w, healing ? 10 : 0, true);
    expect(w.player.items).toHaveLength(10);
    const saved = parseRun(serializeRun(nextFloor(run, w)))!;
    expect(saved).not.toBeNull();
    expect(createFloorWorld(saved).player.items).toEqual(w.player.items);
    leaveAndReturn(w);
    expect(w.pickups.find(p => p.playerDropped)!.taken).toBe(false);
    drop(w, 0, true); // Free a real slot; recovery remains available on this floor.
    updatePickups(w);
    expect(w.pickups.find(p => p.playerDropped)!.taken).toBe(true);
  });

  it('only carried items move floors or enter boundary saves; recovered upgrades retain their level', () => {
    const run = newRun('DROP-FLOOR', 'warrior');
    const w = createFloorWorld(run);
    addItem(w, 'weapon:spear', 5); addItem(w, 'armor:mail', 5);
    drop(w, 0); leaveAndReturn(w);
    expect(w.player.items).toContainEqual({ id: 'weapon:spear', count: 1, level: 5 });
    drop(w, w.player.items.findIndex(i => i.id === 'armor:mail'));
    const carried = createFloorWorld(parseRun(serializeRun(nextFloor(run, w)))!);
    expect(carried.player.items).toEqual([{ id: 'weapon:spear', count: 1, level: 5 }]);
    expect(carried.pickups.some(p => p.playerDropped)).toBe(false);
  });
});

describe('inventory drop presentation', () => {
  it('offers one/all per stack without exposing unknown identities or removing existing actions', () => {
    const w = makeWorld(undefined, [], 'huntress');
    w.player.items = [{ id: 'potion:healing', count: 6, level: 0 }, { id: 'weapon:spear', count: 1, level: 5 }, { id: 'scroll:upgrade', count: 2, level: 0 }];
    const nodes = { 'inv-gear': { innerHTML: '' }, 'inv-count': { textContent: '' }, 'inv-list': { innerHTML: '', querySelectorAll: () => [] } };
    vi.stubGlobal('document', { getElementById: (id: keyof typeof nodes) => nodes[id] });
    renderInventory(w, vi.fn());
    const html = nodes['inv-list'].innerHTML;
    expect(html).toContain('data-m="drop"');
    expect(html).toContain('全部放下（6）');
    expect(html).toContain('全部放下（2）');
    expect(html).not.toContain('全部放下（1）');
    expect(html).not.toContain('治療');
    expect(html).toContain('data-m="throw"');
    expect(html).toContain('裝備');
    expect(html).toContain('長矛 +5');
    expect(nodes['inv-gear'].innerHTML).toContain('0.3 世界秒');
    expect(nodes['inv-gear'].innerHTML).toContain('下樓前');
  });
});
