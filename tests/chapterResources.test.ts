import { describe, expect, it } from 'vitest';
import { ACTIONS, ALL_POTIONS, ALL_SCROLLS, CLASS_KNOWLEDGE, ENEMIES, HUNGER, ITEM_FX, PLAYER, RUN, UPGRADE } from '../src/config';
import { yawFromDir } from '../src/core/math';
import { Rng } from '../src/core/rng';
import { levelSignature } from '../src/gen/generator';
import { rollConsumable } from '../src/gen/loot';
import { generateLevel, validateLevel } from '../src/gen/validate';
import { becomeAlert, damageEnemy, lullEnemy, updateEnemies } from '../src/sim/enemySys';
import { addItem, drinkPotion, isKnown, itemDesc, itemName, looksFor, queueUse, readScroll, shatterPotion } from '../src/sim/items';
import { Nav } from '../src/sim/nav';
import { findInteractTarget } from '../src/sim/playerSys';
import { updatePickups } from '../src/sim/propSys';
import { createFloorWorld, newRun, nextFloor, parseRun, serializeRun } from '../src/sim/run';
import { emptyInput } from '../src/sim/types';
import { World } from '../src/sim/world';
import { finishAction, makeWorld, OPEN_ROOM, run } from './helpers';

const hit = (w: World, id: number, amount = 1000) => {
  const e = w.enemies[id]!;
  damageEnemy(w, e, amount, { source: 'arrow', sneak: false, head: false, x: e.x, y: e.y, z: e.z });
  while (w.pendingChoice) w.resolveChoice(0);
};
const arena = () => new World(generateLevel('ARENA-V1', { floor: 5 }));
const faceHeart = (w: World) => {
  const h = w.level.heart!;
  w.player.x = h.x; w.player.z = h.z + 1.3;
  w.player.yaw = yawFromDir(h.x - w.player.x, h.z - w.player.z);
};

describe('Chapter 1: four exploration floors plus dedicated guardian arena', () => {
  it('has four separate guaranteed investments, six dispersed rations, then no arena random resources', () => {
    expect(RUN.floors).toBe(5); expect(RUN.explorationFloors).toBe(4);
    let food = 0, upgrades = 0;
    for (let f = 1; f <= 5; f++) {
      const l = generateLevel('BUDGET', { floor: f });
      expect(l.goal).toBe(f < 5 ? 'descend' : 'heart');
      const rations = l.pickups.filter((p) => p.item === 'food:ration');
      expect(rations).toHaveLength([1, 1, 2, 2, 0][f - 1]!);
      expect(rations.every((p) => Math.hypot(p.x - l.spawn.x, p.z - l.spawn.z) > 3)).toBe(true);
      food += rations.length; upgrades += l.pickups.filter((p) => p.item === 'scroll:upgrade').length;
      if (f === 5) {
        expect(l.templateId).toBe('arena'); expect(l.rooms).toHaveLength(2);
        expect(l.enemies).toHaveLength(1); expect(l.enemies[0]).toMatchObject({ kind: 'warden', boss: true });
        expect(l.pickups).toEqual([]); expect(l.chests).toEqual([]); expect(l.specialRooms).toEqual([]);
      }
    }
    expect(food).toBe(6); expect(upgrades).toBe(4);
    expect([HUNGER.hungryAt, HUNGER.starvingAt, HUNGER.foodRestore, UPGRADE.maxLevel]).toEqual([120, 180, 60, 5]);
  });

  it('Heart is disabled before the Warden is defeated; saved floor4 leads to5, then won world cannot tick', () => {
    let state = newRun('CHAPTER-SAVE', 'warrior');
    for (let floor = 1; floor <= 4; floor++) {
      const w = createFloorWorld(state); expect(w.level.goal).toBe('descend');
      w.player.hunger = floor * 20; addItem(w, 'food:ration');
      state = parseRun(serializeRun(nextFloor(state, w)))!;
      expect(state.floor).toBe(floor + 1);
    }
    const w = createFloorWorld(state);
    expect(w.player.hunger).toBe(80); expect(w.player.items.find((i) => i.id === 'food:ration')?.count).toBe(4);
    faceHeart(w); w.updateEncounter();
    expect(findInteractTarget(w)?.enabled).toBe(false); w.takeHeart(); expect(w.heartTaken).toBe(false);
    hit(w, 0); expect(w.heartAvailable).toBe(true);
    expect(w.pickups.filter((p) => p.kind === 'item')).toEqual([]);
    faceHeart(w); w.frame(1 / 60, { ...emptyInput(w.player.yaw), interact: true }); finishAction(w);
    expect(w.outcome).toBe('win'); expect(w.heartTaken).toBe(true);
    expect(w.events.some((e) => e.type === 'wake')).toBe(false);
    const snapshot = [w.time, w.player.hunger, w.player.hp, w.player.starvationT];
    w.advance(200); run(w, 120, { wait: true });
    expect([w.time, w.player.hunger, w.player.hp, w.player.starvationT]).toEqual(snapshot);
  });

  it('antechamber Hunger advances; entering the arena freezes Hunger before the boundary tick, actions still cost time', () => {
    const w = arena();
    w.player.hunger = 160; w.advance(3); expect(w.player.hunger).toBeCloseTo(163);
    expect(w.encounterState).toBe('dormant'); expect(w.enemies.every((e) => e.state === 'idle' && e.patrol.length === 0)).toBe(true);
    w.player.hunger = HUNGER.starvingAt; w.player.starvationT = HUNGER.damageEvery - .001;
    faceHeart(w); w.enemies.forEach((e) => e.paralyzeT = 30); const hp = w.player.hp;
    w.frame(1 / 60, { ...emptyInput(), wait: true });
    expect(w.encounterState).toBe('active'); expect(w.player.hp).toBe(hp);
    expect(w.player.starvationT).toBe(HUNGER.damageEvery - .001);
    addItem(w, 'food:ration'); queueUse(w, 0, 'use'); w.frame(1 / 60, emptyInput()); finishAction(w);
    expect(w.lastAction?.spent).toBeCloseTo(ACTIONS.eat.recovery);
    expect(w.player.hunger).toBe(120); expect(w.player.starvationT).toBe(0);
    const t = w.time; w.advance(2); expect(w.time).toBeGreaterThan(t); expect(w.player.hunger).toBe(120);
    readScroll(w, 'upgrade'); const paused = w.time; w.advance(1); expect(w.time).toBe(paused);
    w.resolveChoice(0); expect(w.player.weapon.level).toBe(1);
  });

  it('ranged initiation including lethal first strike activates freeze outside arena; Warden never sleeps', () => {
    const w = arena(); w.player.hunger = 150;
    for (const e of w.enemies) lullEnemy(e);
    expect(w.enemies.every((e) => e.state !== 'sleep' && !e.pendingSleep)).toBe(true);
    hit(w, 0, 1); expect(w.encounterState).toBe('active');
    w.enemies[0]!.paralyzeT = 30; w.advance(1); expect(w.player.hunger).toBe(150);
    hit(w, 0); expect(w.encounterState).toBe('resolved'); w.advance(1); expect(w.player.hunger).toBe(150);
    const lethal = arena(); lethal.player.hunger = 150; hit(lethal, 0);
    expect(lethal.encounterState).toBe('resolved'); lethal.advance(1); expect(lethal.player.hunger).toBe(150);
  });
});

describe('knowledge, appearances and conservative v2 migration', () => {
  it.each(['warrior', 'huntress'] as const)('%s receives exactly its initial knowledge, without bonus items or healing stock', (cls) => {
    const w = createFloorWorld(newRun('KNOWLEDGE', cls));
    expect(w.player.known).toEqual(CLASS_KNOWLEDGE[cls]); expect(w.player.items).toEqual([]); expect(w.player).not.toHaveProperty('potions');
    expect(isKnown(w, 'scroll:upgrade')).toBe(true);
    for (const id of ['potion:frost', 'scroll:sleep'] as const) {
      expect(isKnown(w, id)).toBe(false); expect(itemDesc(w, id)).toContain('未知');
      expect(itemName(w, id)).not.toMatch(/冰霜|沉睡/);
    }
  });

  it('same-seed classes have identical geometry, enemies, item identities/positions, loot RNG and appearances', () => {
    for (const seed of ['LOOK1', 'LOOK2', 'LOOK3']) for (let floor = 1; floor <= 5; floor++) {
      const a = new World(generateLevel(seed, { floor }), { cls: 'warrior' });
      const b = new World(generateLevel(seed, { floor }), { cls: 'huntress' });
      expect(levelSignature(a.level)).toBe(levelSignature(b.level));
      expect(a.pickups).toEqual(b.pickups); expect(a.enemies).toEqual(b.enemies);
      expect(Array.from({ length: 10 }, () => a.rng.next())).toEqual(Array.from({ length: 10 }, () => b.rng.next()));
    }
  });

  it('old glyphs and potion colors never remap; Sleep inherits old timeStop slot, Identify fills the unused former lure slot', () => {
    for (let k = 0; k < 50; k++) {
      const seed = `OLD-LOOK${k}`, rng = new Rng(`${seed}#looks`);
      const pi = rng.shuffle([0, 1, 2, 3, 4]), si = rng.shuffle([0, 1, 2, 3]);
      const looks = looksFor(seed, 1);
      ALL_POTIONS.filter((id) => id !== 'healing').forEach((id, index) => expect(looks.potion[id]).toBe(pi[index]));
      expect(looks.potion.healing).toBe(5);
      expect(looks.scroll).toEqual({ teleport: si[0], mapping: si[1], sleep: si[2], identify: si[3] });
    }
    expect(ALL_SCROLLS).toEqual(['teleport', 'mapping', 'sleep', 'identify']);
    const rng = new Rng('POOLS');
    for (let k = 0; k < 500; k++) expect(rollConsumable(rng).id).not.toMatch(/lure|timeStop|upgrade/);
  });

  it('unknown pickup text has no solution hint, use identifies and discovery survives floor boundary/save', () => {
    const run = newRun('UNKNOWN', 'warrior'), w = createFloorWorld(run);
    w.addPickup('item', 1, w.player.x, .1, w.player.z, null, 'potion:frost'); updatePickups(w);
    expect(w.events.filter((e) => e.type === 'pickup').every((e) => !e.text?.includes('冰霜'))).toBe(true);
    drinkPotion(w, 'frost');
    expect(isKnown(w, 'potion:frost')).toBe(true);
    const resumed = createFloorWorld(parseRun(serializeRun(nextFloor(run, w)))!);
    expect(resumed.player.known).toEqual(w.player.known);
  });

  it('legacy floor4 becomes exploration4; lure removed, timeStop aliases safely, food/HP/XP/investment preserved', () => {
    const w = createFloorWorld(newRun('LEGACY4', 'warrior'));
    w.player.hunger = 171; w.player.weapon.level = 4; addItem(w, 'food:ration');
    const saved = JSON.parse(serializeRun({ ...nextFloor(newRun('LEGACY4', 'warrior'), w), floor: 4 }));
    delete saved.chapter;
    saved.carry.items.push({ id: 'scroll:timeStop', count: 70, level: 0 }, { id: 'scroll:sleep', count: 40, level: 0 }, { id: 'scroll:lure', count: 3, level: 0 });
    saved.carry.known = ['scroll:timeStop', 'scroll:lure', 'potion:frost'];
    const parsed = parseRun(JSON.stringify(saved))!;
    expect(parsed).not.toBeNull(); expect(parsed.floor).toBe(4);
    expect(parsed.carry!.items.filter((i) => i.id === 'scroll:sleep').map((i) => i.count)).toEqual([99, 11]);
    expect(parsed.carry!.items).toContainEqual({ id: 'food:ration', count: 1, level: 0 });
    expect(parsed.carry!.known).toEqual(['scroll:sleep', 'potion:frost']);
    const resumed = createFloorWorld(parsed);
    expect(resumed.level.goal).toBe('descend'); expect(resumed.player.hunger).toBe(171);
    expect(resumed.player.weapon.level).toBe(4); expect(resumed.player.hp).toBe(w.player.hp); expect(resumed.player.xp).toBe(w.player.xp);
    expect(resumed.player.known).toEqual([...CLASS_KNOWLEDGE.warrior, 'scroll:sleep', 'potion:frost']);
    expect(addItem(resumed, 'scroll:sleep')).toBe(true);
    expect(resumed.player.items.filter((i) => i.id === 'scroll:sleep').map((i) => i.count)).toEqual([99, 12]);
    const encoded = serializeRun(nextFloor(parsed, resumed));
    expect(encoded).not.toMatch(/timeStop|lure/); expect(parseRun(encoded)?.floor).toBe(5);
    saved.carry.items.push({ id: 'scroll:madeUp', count: 1, level: 0 });
    expect(parseRun(JSON.stringify(saved))).toBeNull();
  });
});

describe('Sleep reuses living AI without canceling committed threats', () => {
  it.each([false, true])('ordinary precommit/veteran=%s sleeps, forgets chase, permits legal surprise and wakes to noise', (veteran) => {
    const w = makeWorld(OPEN_ROOM, [{ kind: 'guard', x: 9.5, z: 12.9, veteran }], 'huntress');
    const e = w.enemies[0]!; becomeAlert(w, e); e.phase = 'windup'; e.locked = false;
    readScroll(w, 'sleep'); expect(e.state).toBe('sleep'); expect(e.phase).toBe('none'); expect(e.lastKnown).toBeNull();
    const before = e.hp;
    w.frame(1 / 60, { ...emptyInput(), fire: true, firePressed: true }); finishAction(w);
    expect(before - e.hp).toBe(6); expect(w.stats.backstabs).toBe(1); expect(e.state).toBe('alert');
    lullEnemy(e); w.emitNoise(e.x, 1, e.z, 8, 'test'); expect(e.state).toBe('investigate');
  });

  it.each(['guard', 'archer', 'charger'] as const)('%s locked attack produces its original threat before Sleep, with no stuck state', (kind) => {
    const z = kind === 'archer' ? 9 : kind === 'charger' ? 10.5 : 12.4;
    const w = makeWorld(OPEN_ROOM, [{ kind, x: 9.5, z, yaw: Math.PI }]);
    const e = w.enemies[0]!; becomeAlert(w, e); e.seesPlayer = true;
    e.phase = kind === 'archer' ? 'aim' : 'windup'; e.locked = true; e.lockedYaw = Math.PI;
    e.aimPoint = { x: w.player.x, y: 1.2, z: w.player.z };
    e.phaseT = kind === 'archer' ? ENEMIES.archer.aim - .02 : kind === 'guard' ? ENEMIES.guard.windup - .02 : ENEMIES.charger.windup - .02;
    readScroll(w, 'sleep'); expect(e.pendingSleep).toBe(true); expect(e.state).toBe('alert');
    // Enemy-only stepping isolates the commitment from player collisions/HP death.
    let active = false;
    for (let k = 0; k < 300 && e.state !== 'sleep'; k++) {
      updateEnemies(w, 1 / 120); active ||= ['active', 'charge'].includes(e.phase) || w.projectiles.length > 0;
    }
    expect(active).toBe(true); expect(e.state).toBe('sleep'); expect(e.pendingSleep).toBe(false); expect(e.phase).toBe('none');
    if (kind === 'archer') expect(w.projectiles.some((p) => p.kind === 'bolt')).toBe(true);
  });

  it('radius does not freeze far enemies, missiles, world time or Hunger; uncommitted aim cancels safely', () => {
    const w = makeWorld(OPEN_ROOM, [{ kind: 'archer', x: 9.5, z: 10, yaw: Math.PI }, { kind: 'guard', x: 2, z: 2 }]);
    const a = w.enemies[0]!; becomeAlert(w, a); a.phase = 'aim'; a.aimPoint = { x: 9.5, y: 1.2, z: 14.5 };
    readScroll(w, 'sleep'); expect(a.state).toBe('sleep'); expect(a.aimPoint).toBeNull();
    expect(w.enemies[1]!.state).not.toBe('sleep'); w.advance(.1); expect(w.player.hunger).toBeCloseTo(.1);
    expect(w.enemies.every((e) => e.paralyzeT === 0)).toBe(true);
  });
});

describe('optional resource rooms have useful alternatives, never a main-route item lock', () => {
  it.each(['A', 'B'] as const)('%s rooms and matching supplies are reachable, and main route avoids every special room', (template) => {
    for (let k = 0; k < 12; k++) for (let floor = 1; floor <= 4; floor++) {
      const l = generateLevel(`SPECIAL${k}`, { floor, template });
      expect(validateLevel(l)).toEqual({ ok: true, errors: [] });
      expect(l.specialRooms?.map((s) => s.kind)).toEqual(['embers', 'sentries']);
      const nav = new Nav(l.grid, PLAYER.radius), seen = nav.flood(l.spawn.x, l.spawn.z, false);
      for (const room of l.specialRooms!) {
        const cell = nav.nearestPassable(room.supply.x, room.supply.z);
        expect(seen[cell]).toBe(1);
        expect(l.rooms.filter((r) => r.optional).every((r) => room.supply.x < r.x0 || room.supply.x > r.x0 + r.w || room.supply.z < r.z0 || room.supply.z > r.z0 + r.h)).toBe(true);
      }
    }
  }, 30000);

  it('local Frost removes fire HP exposure, leaves distant fires, and retains its ordinary slow role', () => {
    const w = new World(generateLevel('ROOM-ADVANTAGE'));
    const fire = w.areas.find((a) => a.kind === 'fire')!;
    w.enemies.splice(0); w.player.x = fire.x; w.player.z = fire.z; const hp = w.player.hp;
    w.advance(.51); expect(w.player.hp).toBeLessThan(hp);
    const distant = { ...fire, id: w.nextId++, x: fire.x + 10 }; w.areas.push(distant);
    shatterPotion(w, 'frost', fire.x, .1, fire.z);
    expect(w.areas.some((a) => a.id === fire.id)).toBe(false); expect(w.areas).toContain(distant);
    const after = w.player.hp; w.advance(1); expect(w.player.hp).toBe(after);
  });

  it('sentry room sightline sees a visible approach but invisibility permits opening the same optional chest', () => {
    const setup = () => {
      const w = new World(generateLevel('SENTRY-ADVANTAGE'));
      const special = w.level.specialRooms!.find((s) => s.kind === 'sentries')!;
      w.enemies.splice(0, w.enemies.length, ...w.enemies.filter((e) => e.roomKey === special.roomKey));
      const chest = w.interactables.find((i) => i.kind === 'chest' && i.roomKey === special.roomKey)!;
      w.player.x = chest.x; w.player.z = chest.z + 1.3; w.player.yaw = 0;
      return { w, chest };
    };
    const a = setup(); a.w.advance(1.2); expect(a.w.enemies.some((e) => e.seesPlayer)).toBe(true);
    const b = setup(); drinkPotion(b.w, 'invisibility'); b.w.advance(1.2);
    expect(b.w.enemies.every((e) => !e.seesPlayer && e.phase !== 'aim')).toBe(true);
    b.w.frame(1 / 60, { ...emptyInput(), interact: true }); finishAction(b.w);
    expect(b.chest.used).toBe(true); expect(b.w.player.invisT).toBeGreaterThan(0);
    expect(b.w.stats.chests).toBe(1); expect(b.w.player.hp).toBe(PLAYER.maxHp);
  });

  it('food on the ground survives full bag, then stacks without changing carry/save or Upgrade budget', () => {
    const w = new World(generateLevel('FULL-FOOD'));
    const food = w.pickups.find((p) => p.item === 'food:ration')!;
    w.player.x = food.x; w.player.z = food.z;
    for (let k = 0; k < ITEM_FX.slots; k++) addItem(w, 'weapon:axe');
    updatePickups(w); expect(food.taken).toBe(false);
    w.player.items.pop(); addItem(w, 'food:ration'); updatePickups(w); expect(food.taken).toBe(true);
    const carried = createFloorWorld(parseRun(serializeRun(nextFloor(newRun('FULL-FOOD', 'warrior'), w)))!);
    expect(carried.player.items.find((i) => i.id === 'food:ration')?.count).toBe(2);
    expect(carried.pickups.filter((p) => p.item === 'scroll:upgrade')).toHaveLength(1);
  });
});

describe('consumable responsibility edges', () => {
  it('throwing either buff potion does not identify it or produce a fake area', () => {
    const w = makeWorld();
    for (const id of ['invisibility', 'haste'] as const) {
      expect(isKnown(w, `potion:${id}`)).toBe(false);
      shatterPotion(w, id, w.player.x, 0, w.player.z);
      expect(isKnown(w, `potion:${id}`)).toBe(false);
    }
    expect(w.areas).toEqual([]); expect(w.player.invisT).toBe(0); expect(w.player.hasteT).toBe(0);
  });

  it('invisibility stops chase-position updates but preserves the last-known search and a locked bolt', () => {
    const w = makeWorld(OPEN_ROOM, [{ kind: 'archer', x: 9.5, z: 8.5, yaw: Math.PI }]);
    const e = w.enemies[0]!; becomeAlert(w, e); e.seesPlayer = true;
    e.phase = 'aim'; e.phaseT = ENEMIES.archer.aim - .02; e.locked = true; e.lockedYaw = Math.PI;
    e.aimPoint = { x: 9.5, y: 1.25, z: 14.5 }; const last = { ...e.lastKnown! };
    drinkPotion(w, 'invisibility'); w.player.x = 13;
    updateEnemies(w, .04);
    expect(w.projectiles).toHaveLength(1); expect(e.lastKnown).toEqual(last);
    for (let k = 0; k < 600; k++) updateEnemies(w, 1 / 120);
    expect(e.seesPlayer).toBe(false); expect(e.state).toBe('search'); expect(e.target).toEqual(last);
  });

  it('Frost room has a safe stock-opening approach; optional bag loot accepts a visible HP risk or local extinction', () => {
    const w = new World(generateLevel('FIRE-ALTERNATIVE'));
    w.enemies.splice(0); const room = w.level.specialRooms!.find((s) => s.kind === 'embers')!;
    const chest = w.interactables.find((i) => i.kind === 'chest' && i.roomKey === room.roomKey)!;
    const fire = w.areas[0]!, nav = new Nav(w.grid, PLAYER.radius), seen = nav.flood(w.player.x, w.player.z, false);
    const safe = Array.from(seen.keys()).filter((c) => seen[c]).map((c) => nav.center(c)).find((p) =>
      Math.hypot(p.x - chest.x, p.z - chest.z) < PLAYER.interactRange &&
      Math.hypot(p.x - fire.x, p.z - fire.z) > fire.radius + PLAYER.radius);
    expect(safe).toBeDefined(); w.player.x = safe!.x; w.player.z = safe!.z;
    const yaw = yawFromDir(chest.x - safe!.x, chest.z - safe!.z), hp = w.player.hp;
    w.frame(1 / 60, { ...emptyInput(yaw), interact: true }); finishAction(w);
    expect(chest.used).toBe(true); expect(w.player.hp).toBe(hp); expect(w.stats.chests).toBe(1);
    const item = w.pickups.find((p) => p.kind === 'item' && Math.hypot(p.x - chest.x, p.z - chest.z) < 1.1)!;
    expect(Math.hypot(item.x - fire.x, item.z - fire.z)).toBeLessThan(fire.radius);
    shatterPotion(w, 'frost', fire.x, .1, fire.z);
    w.player.x = item.x; w.player.z = item.z; updatePickups(w); w.advance(.6);
    expect(item.taken).toBe(true); expect(w.player.hp).toBe(hp);
  });
});
